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
    detect_provider_kind, normalize_base_url, preset_providers, ModelProvider,
    ProviderRuntimeState, ProviderSpec, SaCodeConfig,
};
use sacode_kernel::{AgentRole, RoleModelPolicy};
use serde::{Deserialize, Serialize};

use crate::identity::{resolve_secret_ref, IdentitySession};
use crate::task_routing::{ModelRoutePlan, RoutedModel, TaskProfile};

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

    let mut config = load_effective_sacode_config(workdir).unwrap_or_else(default_sacode_config);
    merge_identity_session(&mut config);
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
    let mut config = load_effective_sacode_config(workdir).unwrap_or_else(default_sacode_config);
    merge_identity_session(&mut config);
    resolve_model_candidates_from_config(&config)
        .into_iter()
        .filter(|candidate| {
            candidate
                .provider
                .api_key
                .as_deref()
                .is_some_and(|key| !key.trim().is_empty())
        })
        .map(|candidate| {
            (
                candidate.provider_name,
                candidate.model_name,
                candidate.provider,
            )
        })
        .collect()
}

/// User-selected models are separate from automatic failover candidates.
pub fn resolve_selectable_model_candidates(workdir: &Path) -> Vec<(String, String, ModelProvider)> {
    let mut config = load_effective_sacode_config(workdir).unwrap_or_else(default_sacode_config);
    merge_identity_session(&mut config);
    resolve_selectable_models_from_config(&config)
}

fn resolve_selectable_models_from_config(
    config: &SaCodeConfig,
) -> Vec<(String, String, ModelProvider)> {
    config
        .provider
        .iter()
        .flat_map(|(name, spec)| {
            spec.models.keys().filter_map(|model| {
                if !config.provider_is_authorized(name, model) {
                    return None;
                }
                let candidate =
                    provider_spec_to_model_provider(spec, config.provider_state.get(name), model);
                if candidate
                    .api_key
                    .as_deref()
                    .is_none_or(|key| key.trim().is_empty())
                {
                    return None;
                }
                Some((name.clone(), model.clone(), candidate))
            })
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

fn merge_identity_session(config: &mut SaCodeConfig) {
    let Ok(Some(session)) = IdentitySession::load(None) else {
        return;
    };
    merge_identity_session_data(config, &session);
}

fn identity_provider_base_url(gateway_base_url: &str) -> String {
    let base = gateway_base_url.trim().trim_end_matches('/');
    if base.ends_with("/v1") {
        base.to_string()
    } else {
        format!("{base}/v1")
    }
}

fn merge_identity_session_data(config: &mut SaCodeConfig, session: &IdentitySession) {
    let Some(key_ref) = session.gateway_key_ref.as_ref() else {
        return;
    };
    if session.models.is_empty() {
        return;
    }
    let name = session.provider_name.trim();
    if name.is_empty() || session.gateway_base_url.trim().is_empty() {
        return;
    }
    if config.provider.contains_key(name) && !crate::identity::is_identity_provider_name(name) {
        return;
    }
    let entry = config
        .provider
        .entry(name.to_string())
        .or_insert_with(|| ProviderSpec {
            name: name.to_string(),
            base_url: identity_provider_base_url(&session.gateway_base_url),
            api_key: String::new(),
            models: BTreeMap::new(),
            auth_header: None,
            auth_scheme: None,
        });
    entry.base_url = identity_provider_base_url(&session.gateway_base_url);
    entry.api_key.clear();
    entry
        .models
        .retain(|model, _| session.models.iter().any(|available| available == model));
    for model in &session.models {
        entry
            .models
            .entry(model.clone())
            .or_insert_with(|| sacode_kernel::model::ModelRule {
                name: model.clone(),
                ..Default::default()
            });
    }
    let state = config
        .provider_state
        .entry(name.to_string())
        .or_insert_with(ProviderRuntimeState::default);
    state.credential_ref = Some(key_ref.clone());
    state.authorization.allow_task_content = true;
    state.authorization.models = session.models.clone();
    state.authorization.source = sacode_kernel::model::ProviderAuthorizationSource::Explicit;
    if !config.model.trim().is_empty()
        && config.model.starts_with(&format!("{name}/"))
        && !session
            .models
            .iter()
            .any(|m| config.model == format!("{name}/{m}"))
    {
        config.model.clear();
    }
    let configured_model_available = !config.model.trim().is_empty()
        && config
            .resolve_model(&config.model)
            .is_some_and(|(provider, model)| {
                config.provider_is_authorized(&provider, &model)
                    && config.provider.get(&provider).is_some_and(|spec| {
                        provider_spec_to_model_provider(
                            spec,
                            config.provider_state.get(&provider),
                            &model,
                        )
                        .api_key
                        .as_deref()
                        .is_some_and(|key| !key.trim().is_empty())
                    })
            });
    if !configured_model_available && session.models.iter().any(|m| m == &session.default_model) {
        config.model = format!("{name}/{}", session.default_model);
    }
}

fn resolve_model_candidates_from_config(config: &SaCodeConfig) -> Vec<RouteCandidate> {
    let mut candidates = Vec::new();

    if !config.model.trim().is_empty() {
        if let Some((provider_name, model_name)) = config.resolve_model(&config.model) {
            // 灵枢·自防护：主候选必须是已授权 Provider（含旧配置兼容授权），
            // 产品预设与未验证 Provider 不得自动成为执行候选。
            if config.provider_is_authorized(&provider_name, &model_name) {
                if let Some(provider) = config.provider.get(&provider_name) {
                    candidates.push(RouteCandidate {
                        provider_name: provider_name.clone(),
                        model_name: model_name.clone(),
                        provider: provider_spec_to_model_provider(
                            provider,
                            config.provider_state.get(&provider_name),
                            &model_name,
                        ),
                    });
                }
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
            // 灵枢·自防护：备选候选要求三重授权——策略开启自动降级、
            // Provider 允许接收任务内容、Provider 允许自动降级。
            if !failover_permitted(config, provider_name, model_name) {
                continue;
            }
            candidates.push(RouteCandidate {
                provider_name: provider_name.clone(),
                model_name: model_name.clone(),
                provider: provider_spec_to_model_provider(
                    provider,
                    config.provider_state.get(provider_name),
                    model_name,
                ),
            });
        }
    }

    candidates
}

/// 判断某 Provider/模型是否满足自动降级授权（不含运行时策略开关，
/// 供候选生成使用；发送前二次防线请使用 `failover_is_authorized`）。
fn failover_permitted(config: &SaCodeConfig, provider_name: &str, model_name: &str) -> bool {
    config.provider_policy.auto_failover
        && config
            .provider_state
            .get(provider_name)
            .is_some_and(|state| {
                state.authorization.allow_auto_failover
                    && state.authorization.permits_model(model_name)
            })
}

/// 发送任务内容到 fallback Provider 前的二次授权防线。
///
/// 以当前磁盘上的有效配置为准：策略必须开启 `auto_failover`，
/// 且该 Provider 同时具备 `allow_task_content` 与 `allow_auto_failover` 授权，
/// 模型还必须落在授权范围内。
pub fn failover_is_authorized(workdir: &Path, provider_name: &str, model_name: &str) -> bool {
    let mut config = load_effective_sacode_config(workdir).unwrap_or_else(default_sacode_config);
    merge_identity_session(&mut config);
    failover_permitted(&config, provider_name, model_name)
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
    let user_home = env::var_os("SACODE_HOME")
        .filter(|value| !value.to_string_lossy().trim().is_empty())
        .or_else(|| env::var_os("USERPROFILE"))
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
    config.migrate_provider_compatibility();
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
    config.provider_state.extend(project.provider_state);
    if project.provider_schema_version > 0 {
        config.provider_schema_version = project.provider_schema_version;
        config.provider_policy = project.provider_policy;
    }
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
        provider_schema_version: sacode_kernel::model::PROVIDER_CONFIG_SCHEMA_VERSION,
        model: String::new(),
        small_model: String::new(),
        outstyle: String::new(),
        vim_mode: false,
        provider: preset_providers(),
        provider_state: Default::default(),
        provider_policy: Default::default(),
        model_routing: Default::default(),
    }
}

fn provider_spec_to_model_provider(
    spec: &ProviderSpec,
    state: Option<&ProviderRuntimeState>,
    model_name: &str,
) -> ModelProvider {
    let kind = detect_provider_kind(&spec.base_url, model_name);
    let key = match state.and_then(|state| state.credential_ref.as_ref()) {
        Some(reference) => {
            let secret = if reference
                .locator
                .as_deref()
                .is_some_and(|locator| locator.starts_with("os-keyring:sacode/provider-"))
            {
                let store = crate::identity::OsKeyringSecretStore::new();
                resolve_secret_ref(reference, Some(&store))
            } else {
                resolve_secret_ref(reference, None)
            };
            secret
                .ok()
                .flatten()
                .filter(|value| !value.trim().is_empty())
        }
        None => (!spec.api_key.trim().is_empty()).then(|| spec.api_key.clone()),
    };
    ModelProvider {
        kind,
        model: model_name.to_string(),
        base_url: Some(normalize_base_url(&spec.base_url)),
        api_key: key,
        rule: spec.models.get(model_name).cloned(),
        auth_header: spec.auth_header.clone(),
        auth_scheme: spec.auth_scheme.clone(),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use sacode_kernel::model::{
        ModelRule, ProviderAuthorization, ProviderAuthorizationSource, ProviderRuntimeState,
        ProviderSpec,
    };

    fn rule(name: &str) -> ModelRule {
        ModelRule {
            name: name.to_string(),
            ..Default::default()
        }
    }

    fn spec(base_url: &str, api_key: &str, models: &[&str]) -> ProviderSpec {
        ProviderSpec {
            name: String::new(),
            base_url: base_url.to_string(),
            api_key: api_key.to_string(),
            models: models
                .iter()
                .map(|model| (model.to_string(), rule(model)))
                .collect(),
            auth_header: None,
            auth_scheme: None,
        }
    }

    fn base_config() -> SaCodeConfig {
        let mut config = SaCodeConfig {
            provider_schema_version: sacode_kernel::model::PROVIDER_CONFIG_SCHEMA_VERSION,
            model: "primary/model-a".to_string(),
            small_model: String::new(),
            outstyle: String::new(),
            vim_mode: false,
            provider: BTreeMap::new(),
            provider_state: BTreeMap::new(),
            provider_policy: Default::default(),
            model_routing: Default::default(),
        };
        config.provider.insert(
            "primary".to_string(),
            spec(
                "https://primary.example/v1",
                "sk-primary",
                &["model-a", "model-b"],
            ),
        );
        config.provider.insert(
            "fallback".to_string(),
            spec(
                "https://fallback.example/v1",
                "sk-fallback",
                &["model-f", "model-g"],
            ),
        );
        config
    }

    #[test]
    fn selectable_models_require_authorization_and_usable_credentials() {
        let mut config = base_config();
        config.provider.get_mut("primary").unwrap().api_key.clear();
        config.provider_state.insert(
            "primary".to_string(),
            ProviderRuntimeState {
                authorization: ProviderAuthorization::legacy_current(),
                ..Default::default()
            },
        );
        assert!(resolve_selectable_models_from_config(&config).is_empty());
        config.provider.get_mut("primary").unwrap().api_key = "sk-test".into();
        let names = resolve_selectable_models_from_config(&config)
            .into_iter()
            .map(|(provider, model, _)| (provider, model))
            .collect::<Vec<_>>();
        assert_eq!(
            names,
            vec![
                ("primary".into(), "model-a".into()),
                ("primary".into(), "model-b".into())
            ]
        );
    }

    #[test]
    fn missing_secret_ref_never_falls_back_to_plaintext_key() {
        let provider = spec(
            "https://primary.example/v1",
            "stale-plaintext",
            &["model-a"],
        );
        let state = ProviderRuntimeState {
            credential_ref: sacode_kernel::model::SecretRef::legacy_inline("stale-secret"),
            ..Default::default()
        };
        assert!(
            provider_spec_to_model_provider(&provider, Some(&state), "model-a")
                .api_key
                .is_none()
        );
    }

    #[test]
    fn identity_models_merge_without_granting_automatic_failover() {
        let mut config = base_config();
        config.provider_state.insert(
            "primary".to_string(),
            ProviderRuntimeState {
                authorization: ProviderAuthorization::legacy_current(),
                ..Default::default()
            },
        );
        let session = IdentitySession {
            provider_name: "gateway".into(),
            gateway_base_url: "https://gateway.example/v1".into(),
            models: vec!["model-1".into(), "model-2".into()],
            default_model: "model-1".into(),
            gateway_key_ref: sacode_kernel::model::SecretRef::legacy_inline("unavailable"),
            ..Default::default()
        };
        // No process-global environment mutation: a missing session credential cannot
        // silently promote gateway models to the selectable list.
        merge_identity_session_data(&mut config, &session);
        assert!(resolve_selectable_models_from_config(&config)
            .iter()
            .all(|(provider, _, _)| provider != "gateway"));
        assert!(candidate_pairs(&config)
            .iter()
            .all(|(provider, _)| provider != "gateway"));
        assert_eq!(config.provider["gateway"].models.len(), 2);
        assert_eq!(
            config.provider["gateway"].base_url,
            "https://gateway.example/v1"
        );
        assert!(
            !config.provider_state["gateway"]
                .authorization
                .allow_auto_failover
        );
    }

    #[test]
    fn identity_gateway_root_routes_model_requests_to_v1() {
        let mut config = base_config();
        let session = IdentitySession {
            provider_name: "sa-ai".into(),
            gateway_base_url: "http://127.0.0.1:8090/".into(),
            models: vec!["deepseek-v4.1-flash".into()],
            default_model: "deepseek-v4.1-flash".into(),
            gateway_key_ref: sacode_kernel::model::SecretRef::legacy_inline("test-key"),
            ..Default::default()
        };
        merge_identity_session_data(&mut config, &session);
        assert_eq!(
            config.provider["sa-ai"].base_url,
            "http://127.0.0.1:8090/v1"
        );
        assert_eq!(config.provider["sa-ai"].models.len(), 1);
    }

    fn candidate_pairs(config: &SaCodeConfig) -> Vec<(String, String)> {
        resolve_model_candidates_from_config(config)
            .into_iter()
            .map(|candidate| (candidate.provider_name, candidate.model_name))
            .collect()
    }

    #[test]
    fn legacy_config_keeps_only_current_provider_as_candidate() {
        let mut config = base_config();
        config.provider_state.insert(
            "primary".to_string(),
            ProviderRuntimeState {
                authorization: ProviderAuthorization::legacy_current(),
                ..Default::default()
            },
        );
        let candidates = candidate_pairs(&config);
        assert_eq!(
            candidates,
            vec![("primary".to_string(), "model-a".to_string())]
        );
    }

    #[test]
    fn fallback_requires_policy_gate_even_with_explicit_authorization() {
        let mut config = base_config();
        config.provider_state.insert(
            "primary".to_string(),
            ProviderRuntimeState {
                authorization: ProviderAuthorization::legacy_current(),
                ..Default::default()
            },
        );
        config.provider_state.insert(
            "fallback".to_string(),
            ProviderRuntimeState {
                authorization: ProviderAuthorization {
                    allow_task_content: true,
                    allow_auto_failover: true,
                    source: ProviderAuthorizationSource::Explicit,
                    models: Vec::new(),
                    updated_at: None,
                },
                ..Default::default()
            },
        );
        assert_eq!(
            candidate_pairs(&config),
            vec![("primary".to_string(), "model-a".to_string())]
        );
    }

    #[test]
    fn authorized_fallback_enters_candidates_only_when_policy_enabled() {
        let mut config = base_config();
        config.provider_state.insert(
            "primary".to_string(),
            ProviderRuntimeState {
                authorization: ProviderAuthorization::legacy_current(),
                ..Default::default()
            },
        );
        config.provider_state.insert(
            "fallback".to_string(),
            ProviderRuntimeState {
                authorization: ProviderAuthorization {
                    allow_task_content: true,
                    allow_auto_failover: true,
                    source: ProviderAuthorizationSource::Explicit,
                    models: vec!["model-f".to_string()],
                    updated_at: None,
                },
                ..Default::default()
            },
        );
        config.provider_policy.auto_failover = true;

        let candidates = candidate_pairs(&config);
        assert!(candidates.contains(&("primary".to_string(), "model-a".to_string())));
        assert!(candidates.contains(&("fallback".to_string(), "model-f".to_string())));
        assert!(!candidates.contains(&("fallback".to_string(), "model-g".to_string())));
    }

    #[test]
    fn unverified_preset_provider_never_becomes_candidate() {
        let mut config = base_config();
        // 预设 provider 无任何 provider_state（未验证、未授权）
        config.provider.insert(
            "preset".to_string(),
            spec("https://preset.example/v1", "", &["preset-model"]),
        );
        config.provider_state.insert(
            "primary".to_string(),
            ProviderRuntimeState {
                authorization: ProviderAuthorization::legacy_current(),
                ..Default::default()
            },
        );
        config.provider_policy.auto_failover = true;
        let candidates = candidate_pairs(&config);
        assert!(!candidates.iter().any(|(provider, _)| provider == "preset"));
    }

    #[test]
    fn failover_is_authorized_reads_policy_and_state_from_workdir() {
        let workdir = tempfile::tempdir().expect("tempdir");
        let mut config = base_config();
        config.provider_state.insert(
            "fallback".to_string(),
            ProviderRuntimeState {
                authorization: ProviderAuthorization {
                    allow_task_content: true,
                    allow_auto_failover: true,
                    source: ProviderAuthorizationSource::Explicit,
                    models: vec!["model-f".to_string()],
                    updated_at: None,
                },
                ..Default::default()
            },
        );
        let sacode_dir = workdir.path().join(".sacode");
        std::fs::create_dir_all(&sacode_dir).expect("create .sacode");
        std::fs::write(
            sacode_dir.join("config.json"),
            serde_json::to_string(&config).expect("serialize config"),
        )
        .expect("write config");

        // 策略关闭时不授权
        assert!(!failover_is_authorized(
            workdir.path(),
            "fallback",
            "model-f"
        ));

        config.provider_policy.auto_failover = true;
        std::fs::write(
            sacode_dir.join("config.json"),
            serde_json::to_string(&config).expect("serialize config"),
        )
        .expect("write config");
        assert!(failover_is_authorized(
            workdir.path(),
            "fallback",
            "model-f"
        ));
        // 授权范围外的模型不得降级
        assert!(!failover_is_authorized(
            workdir.path(),
            "fallback",
            "model-g"
        ));
    }
}
