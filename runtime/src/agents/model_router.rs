//! 灵枢 · 自愈合 — 角色模型路由
//!
//! 核心模块：为每个角色智能选择最优模型，支持故障自动转移
//! 对应 AGENTS.md 中「自愈合 — 故障转移路由」
//!
//! 设计理念源自《黄帝内经》表里经互为备用通路的隐喻：
//! - 主模型如同正经，执行主要任务
//! - 备选模型如同别络，故障时自动接管

use std::{
    cmp::Reverse,
    collections::BTreeMap,
    env, fs,
    path::{Path, PathBuf},
};

use sacode_kernel::model::{
    detect_provider_kind, normalize_base_url, preset_providers, ModelProvider, ProviderSpec,
    SaCodeConfig,
};
use sacode_kernel::{AgentRole, RoleModelPolicy};
use serde::{Deserialize, Serialize};

use crate::model_routing::{ModelRoutePlan, RoutedModel, TaskProfile};

const SACODE_CONFIG_FILE: &str = ".sacode/config.json";
const MODEL_HEALTH_FILE: &str = ".sacode/model-health.json";
/// 灵枢·自愈合：健康记录恢复窗口（秒）。超过此窗口后，失败惩罚衰减为 0，
/// 使曾因瞬态故障被标记为 unhealthy 的模型可被重新试探。1 小时。
const MODEL_HEALTH_RECOVERY_SECS: u64 = 3600;

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

    routed.sort_by_key(|route| Reverse(route.route_score));
    apply_default_model_preference(&config, &mut routed);
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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ModelHealthStore {
    #[serde(default)]
    entries: BTreeMap<String, ModelHealthEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ModelHealthEntry {
    #[serde(default)]
    success_count: u32,
    #[serde(default)]
    failure_count: u32,
    #[serde(default)]
    last_status: String,
    #[serde(default)]
    last_error: Option<String>,
    /// 最后一次健康记录更新时间（unix 秒）。由写入侧（provider_runtime）填充。
    /// 0 表示旧文件无此字段，此时不应用时间衰减。
    #[serde(default)]
    updated_at: u64,
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

/// 让 config.json 中 model 字段指定的默认模型获得最高优先分
fn apply_default_model_preference(config: &SaCodeConfig, routed: &mut [RoutedModel]) {
    if config.model.trim().is_empty() {
        return;
    }
    let Some((provider_name, model_name)) = config.resolve_model(&config.model) else {
        return;
    };
    for route in routed.iter_mut() {
        if route.provider_name == provider_name && route.model_name == model_name {
            route.route_score += 100;
            route.reasons.push("config default model".to_string());
            return;
        }
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
    // 用户级配置目录：Windows 上 USERPROFILE 指向 C:\Users\<name>，
    // Unix 上 HOME 指向 /home/<name>。二者都缺失时退化为当前目录。
    let user_home = env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    let user_path = user_home.join(SACODE_CONFIG_FILE);
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

    // 灵枢·自愈合：时间窗口衰减
    // updated_at 为最后一次健康记录更新时间（成功或失败均更新）。
    // 超过恢复窗口后，失败惩罚与 unhealthy 状态扣分衰减为 0，
    // 仅保留成功加分，使曾因瞬态故障被标记为 unhealthy 的模型可被重新试探。
    // updated_at == 0（旧文件无此字段）时不应用衰减，保持原有行为。
    if entry.updated_at > 0 {
        let elapsed = current_unix_ts().saturating_sub(entry.updated_at);
        if elapsed >= MODEL_HEALTH_RECOVERY_SECS {
            return success;
        }
    }

    success - failure + status_bonus
}

/// 当前 unix 时间戳（秒）。与写入侧（provider_runtime::current_unix_ts）保持一致语义。
fn current_unix_ts() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0)
}

fn health_key(provider_name: &str, model_name: &str) -> String {
    format!("{}/{}", provider_name, model_name)
}

/// 灵枢 · 自愈合 — 记录模型健康状态到 `.sacode/model-health.json`
///
/// 供多 Agent 编排路径（worker.rs）调用，闭合自愈合反馈回路。
/// 与 interfaces/cli 的 `record_model_health` 写入同一文件，格式兼容。
pub fn record_model_health(
    workdir: &Path,
    provider_name: &str,
    model_name: &str,
    success: bool,
    error: Option<&str>,
) {
    let mut store = load_model_health_store(workdir).unwrap_or_default();
    let key = health_key(provider_name, model_name);
    let entry = store.entries.entry(key).or_default();
    if success {
        entry.success_count += 1;
        entry.last_status = "healthy".to_string();
        entry.last_error = None;
    } else {
        entry.failure_count += 1;
        entry.last_status = "unhealthy".to_string();
        entry.last_error = error.map(|value| value.to_string());
    }
    entry.updated_at = current_unix_ts();
    let path = workdir.join(MODEL_HEALTH_FILE);
    save_model_health_store(&path, &store);
}

fn save_model_health_store(path: &Path, store: &ModelHealthStore) {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(content) = serde_json::to_string(store) {
        let _ = fs::write(path, content);
    }
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
