use std::{
    collections::BTreeMap,
    env, fs,
    path::{Path, PathBuf},
};

use sacode_kernel::model::{
    preset_providers, ModelProvider, ProviderKind, ProviderSpec, SaCodeConfig,
};
use sacode_kernel::{AgentRole, RoleModelPolicy};
use serde::Deserialize;

use crate::model_routing::{ModelRoutePlan, RoutedModel, TaskProfile};

const SACODE_CONFIG_FILE: &str = ".sacode/config.json";
const MODEL_HEALTH_FILE: &str = ".sacode/model-health.json";

#[derive(Debug, Clone)]
pub struct ResolvedRoleRoute {
    pub plan: ModelRoutePlan,
    pub summary: String,
}

pub fn build_route_plan_from_candidates(
    workdir: &Path,
    candidates: &[(String, String, ModelProvider)],
    policy: Option<&RoleModelPolicy>,
    profile: &TaskProfile,
    route_reason: String,
) -> Option<ModelRoutePlan> {
    if candidates.is_empty() {
        return None;
    }

    let config = load_effective_sacode_config(workdir).unwrap_or_else(default_sacode_config);
    let effective_policy = policy.cloned().unwrap_or_default();
    let health_store = load_model_health_store(workdir).unwrap_or_default();
    let mut routed = candidates
        .iter()
        .cloned()
        .map(|(provider_name, model_name, provider)| {
            score_candidate(
                RouteCandidate {
                    provider_name,
                    model_name,
                    provider,
                },
                &effective_policy,
                profile,
                &health_store,
            )
        })
        .collect::<Vec<_>>();

    routed.sort_by(|a, b| b.route_score.cmp(&a.route_score));
    apply_route_overrides(&config, profile, &mut routed);
    apply_role_preferences(&effective_policy, &mut routed);

    let primary = routed.first().cloned()?;
    let fallbacks = routed.into_iter().skip(1).collect::<Vec<_>>();
    Some(ModelRoutePlan {
        primary,
        fallbacks,
        route_reason,
    })
}

pub fn resolve_config_model_candidates(workdir: &Path) -> Vec<(String, String, ModelProvider)> {
    let config = load_effective_sacode_config(workdir).unwrap_or_else(default_sacode_config);
    resolve_model_candidates_from_config(&config)
        .into_iter()
        .map(|candidate| {
            (
                candidate.provider_name,
                candidate.model_name,
                candidate.provider,
            )
        })
        .collect()
}

#[derive(Debug, Clone)]
struct RouteCandidate {
    provider_name: String,
    model_name: String,
    provider: ModelProvider,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct ModelHealthStore {
    #[serde(default)]
    entries: BTreeMap<String, ModelHealthEntry>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct ModelHealthEntry {
    #[serde(default)]
    success_count: u32,
    #[serde(default)]
    failure_count: u32,
    #[serde(default)]
    last_status: String,
    #[serde(default)]
    last_error: Option<String>,
}

pub fn resolve_role_route(
    workdir: &Path,
    role: &AgentRole,
    profile: &TaskProfile,
) -> Option<ResolvedRoleRoute> {
    let candidates = resolve_config_model_candidates(workdir);
    let plan = build_route_plan_from_candidates(
        workdir,
        &candidates,
        Some(&role.model_policy),
        profile,
        format!(
            "role={} auto_route={}",
            role.id, role.model_policy.auto_route
        ),
    )?;
    let summary = format_route_summary(role, &plan.primary, plan.fallbacks.len());

    Some(ResolvedRoleRoute { plan, summary })
}

fn resolve_model_candidates_from_config(config: &SaCodeConfig) -> Vec<RouteCandidate> {
    let mut candidates = Vec::new();

    if !config.model.trim().is_empty() {
        if let Some((provider_name, model_name)) = config.resolve_model(&config.model) {
            if let Some(provider) = config.provider.get(&provider_name) {
                candidates.push(RouteCandidate {
                    provider_name: provider_name.clone(),
                    model_name: model_name.clone(),
                    provider: provider_spec_to_model_provider(provider, &model_name),
                });
            }
        }
    }

    for (provider_name, provider) in &config.provider {
        for model_name in provider.models.keys() {
            let exists = candidates.iter().any(|entry| {
                entry.provider_name == *provider_name && entry.model_name == *model_name
            });
            if exists {
                continue;
            }
            candidates.push(RouteCandidate {
                provider_name: provider_name.clone(),
                model_name: model_name.clone(),
                provider: provider_spec_to_model_provider(provider, model_name),
            });
        }
    }

    candidates
}

fn score_candidate(
    candidate: RouteCandidate,
    policy: &RoleModelPolicy,
    profile: &TaskProfile,
    health_store: &ModelHealthStore,
) -> RoutedModel {
    let mut score = 0;
    let mut reasons = Vec::new();
    let model_lower = candidate.model_name.to_lowercase();

    if profile.languages.iter().any(|lang| lang == "rust")
        && (model_lower.contains("deepseek")
            || model_lower.contains("mimo")
            || model_lower.contains("claude"))
    {
        score += 20;
        reasons.push("good for rust tasks".to_string());
    }

    if profile.needs_reasoning
        && (model_lower.contains("deepseek-v4")
            || model_lower.contains("mimo")
            || model_lower.contains("reasoner"))
    {
        score += 30;
        reasons.push("supports extended reasoning".to_string());
    }

    if candidate
        .provider
        .rule
        .as_ref()
        .map(|rule| rule.thinking)
        .unwrap_or(false)
        && profile.needs_reasoning
    {
        score += 15;
        reasons.push("model has thinking enabled".to_string());
    }

    if let Some(preferred_provider) = policy.provider.as_ref() {
        if candidate.provider_name == *preferred_provider {
            score += 50;
            reasons.push("matched role provider preference".to_string());
        }
    }

    if let Some(preferred_model) = policy.primary_model.as_ref() {
        if candidate.model_name == *preferred_model {
            score += 80;
            reasons.push("matched role primary model".to_string());
        }
    }

    if policy.fallback_models.iter().any(|model| {
        model == &candidate.model_name
            || model == &format!("{}/{}", candidate.provider_name, candidate.model_name)
    }) {
        score += 20;
        reasons.push("listed in role fallback models".to_string());
    }

    if let Some(health) = health_store
        .entries
        .get(&health_key(&candidate.provider_name, &candidate.model_name))
    {
        let delta = model_health_score_delta(health);
        score += delta;
        reasons.push(format!("health cache adjusted score by {}", delta));
        if let Some(last_error) = health
            .last_error
            .as_ref()
            .filter(|_| health.last_status != "healthy")
        {
            reasons.push(format!("last error: {}", last_error));
        }
    }

    if score == 0 {
        reasons.push("fallback candidate".to_string());
    }

    let needs_thinking = policy.thinking.unwrap_or_else(|| {
        candidate
            .provider
            .rule
            .as_ref()
            .map(|rule| rule.thinking)
            .unwrap_or(false)
    });

    RoutedModel {
        provider_name: candidate.provider_name,
        model_name: candidate.model_name,
        route_score: score,
        needs_thinking,
        reasons,
    }
}

fn apply_role_preferences(policy: &RoleModelPolicy, routed: &mut Vec<RoutedModel>) {
    if let Some(preferred_model) = policy.primary_model.as_ref() {
        bump_preferred_model(routed, preferred_model, 0, "role primary model override");
    }

    for (index, preferred) in policy.fallback_models.iter().enumerate() {
        bump_preferred_model(routed, preferred, index + 1, "role fallback model override");
    }
}

fn bump_preferred_model(
    routed: &mut Vec<RoutedModel>,
    preferred: &str,
    target_index: usize,
    reason: &str,
) {
    let Some(position) = routed.iter().position(|entry| {
        format!("{}/{}", entry.provider_name, entry.model_name) == preferred
            || entry.model_name == preferred
    }) else {
        return;
    };

    let mut entry = routed.remove(position);
    entry.route_score += 1000 - target_index as i32;
    entry.reasons.push(reason.to_string());
    let insert_at = target_index.min(routed.len());
    routed.insert(insert_at, entry);
}

fn apply_route_overrides(
    config: &SaCodeConfig,
    profile: &TaskProfile,
    routed: &mut Vec<RoutedModel>,
) {
    for rule in &config.model_routing.overrides {
        if !override_matches_profile(&rule.r#match, profile) {
            continue;
        }
        for (index, preferred) in rule.prefer.iter().enumerate() {
            bump_preferred_model(routed, preferred, index, "route override matched");
        }
    }
}

fn override_matches_profile(
    rule: &sacode_kernel::model::ModelRouteMatch,
    profile: &TaskProfile,
) -> bool {
    let languages_match = rule.languages.is_empty()
        || rule
            .languages
            .iter()
            .any(|lang| profile.languages.iter().any(|value| value == lang));
    let surfaces_match = rule.surfaces.is_empty()
        || rule
            .surfaces
            .iter()
            .any(|surface| profile.surfaces.iter().any(|value| value == surface));
    languages_match && surfaces_match
}

fn format_route_summary(role: &AgentRole, primary: &RoutedModel, fallback_count: usize) -> String {
    format!(
        "role={}, provider={}, model={}, thinking={}, score={}, fallbacks={}",
        role.id,
        primary.provider_name,
        primary.model_name,
        primary.needs_thinking,
        primary.route_score,
        fallback_count
    )
}

fn load_effective_sacode_config(workdir: &Path) -> Option<SaCodeConfig> {
    let user_path = env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(SACODE_CONFIG_FILE);
    let project_path = workdir.join(SACODE_CONFIG_FILE);

    let mut config = load_sacode_config_path(&user_path).unwrap_or_else(default_sacode_config);
    if let Some(project) = load_sacode_config_path(&project_path) {
        merge_project_config(&mut config, project);
    }
    Some(config)
}

fn load_sacode_config_path(path: &Path) -> Option<SaCodeConfig> {
    if !path.exists() {
        return None;
    }
    let content = fs::read_to_string(path).ok()?;
    let mut config: SaCodeConfig = serde_json::from_str(&content).ok()?;
    normalize_sacode_config(&mut config);
    Some(config)
}

fn merge_project_config(config: &mut SaCodeConfig, project: SaCodeConfig) {
    if !project.model.trim().is_empty() {
        config.model = project.model;
    }
    if !project.small_model.trim().is_empty() {
        config.small_model = project.small_model;
    }
    if !project.outstyle.trim().is_empty() {
        config.outstyle = project.outstyle;
    }
    if project.vim_mode {
        config.vim_mode = true;
    }
    config.provider.extend(project.provider);
    if !project.model_routing.overrides.is_empty() {
        config.model_routing = project.model_routing;
    }
    normalize_sacode_config(config);
}

fn normalize_sacode_config(config: &mut SaCodeConfig) {
    for (name, provider) in &mut config.provider {
        if provider.name.trim().is_empty() {
            provider.name = name.clone();
        }
        provider.base_url = normalize_base_url(&provider.base_url);
        let mut normalized_models = BTreeMap::new();
        for (model_name, mut rule) in provider.models.clone() {
            if model_name.trim().is_empty() {
                continue;
            }
            if rule.name.trim().is_empty() {
                rule.name = model_name.clone();
            }
            normalized_models.insert(model_name, rule);
        }
        provider.models = normalized_models;
    }
}

fn load_model_health_store(workdir: &Path) -> Option<ModelHealthStore> {
    let path = workdir.join(MODEL_HEALTH_FILE);
    if !path.exists() {
        return None;
    }
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

fn model_health_score_delta(entry: &ModelHealthEntry) -> i32 {
    let success = entry.success_count.min(10) as i32 * 2;
    let failure = entry.failure_count.min(10) as i32 * 4;
    let status_bonus = if entry.last_status == "healthy" {
        8
    } else {
        -12
    };
    success - failure + status_bonus
}

fn health_key(provider_name: &str, model_name: &str) -> String {
    format!("{}/{}", provider_name, model_name)
}

fn default_sacode_config() -> SaCodeConfig {
    SaCodeConfig {
        model: String::new(),
        small_model: String::new(),
        outstyle: String::new(),
        vim_mode: false,
        provider: preset_providers(),
        model_routing: Default::default(),
    }
}

fn provider_spec_to_model_provider(spec: &ProviderSpec, model_name: &str) -> ModelProvider {
    let kind = detect_provider_kind(&spec.base_url, model_name);
    ModelProvider {
        kind,
        model: model_name.to_string(),
        base_url: Some(normalize_base_url(&spec.base_url)),
        api_key: Some(spec.api_key.clone()),
        rule: spec.models.get(model_name).cloned(),
    }
}

fn detect_provider_kind(base_url: &str, model: &str) -> ProviderKind {
    let lower_url = base_url.to_lowercase();
    let lower_model = model.to_lowercase();
    if lower_url.contains("xiaomimimo")
        || lower_url.contains("token-plan")
        || lower_model.starts_with("mimo")
    {
        ProviderKind::Mimo
    } else if lower_url.contains("longcat") || lower_model.contains("longcat") {
        ProviderKind::Longcat
    } else if lower_url.contains("deepseek") {
        ProviderKind::Deepseek
    } else if lower_url.contains("127.0.0.1:11434") || lower_url.contains("ollama") {
        ProviderKind::Ollama
    } else {
        ProviderKind::Custom("openai-compatible".to_string())
    }
}

fn normalize_base_url(value: &str) -> String {
    value.trim().trim_end_matches('/').to_string()
}
