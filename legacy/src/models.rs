use std::{collections::HashMap, sync::Arc};

use serde::{Deserialize, Serialize};
use sqlx::{Pool, Sqlite};
use tokio::sync::RwLock;

#[derive(Clone)]
pub(crate) struct AppState {
    pub(crate) app_name: Arc<str>,
    pub(crate) app_version: Arc<str>,
    pub(crate) default_model: Arc<str>,
    pub(crate) db_pool: Option<Pool<Sqlite>>,
    pub(crate) db_path: Option<Arc<str>>,
    pub(crate) notifications: Arc<RwLock<Vec<NotificationResponse>>>,
    pub(crate) session_model_map: Arc<RwLock<HashMap<String, String>>>,
}

pub(crate) enum AppCommand {
    Shell,
    Serve {
        host: Option<String>,
        port: Option<u16>,
    },
    Start {
        host: Option<String>,
        port: Option<u16>,
        api_only: bool,
        web_only: bool,
    },
    Chat,
    Code,
    Cron,
    Plugin,
    Help,
    Version,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CliConfigData {
    pub(crate) language: Option<String>,
    pub(crate) agent_mode: String,
    pub(crate) max_agent_iterations: u32,
    pub(crate) auto_approve_tools: Vec<String>,
    pub(crate) work_mode: String,
    pub(crate) ui_style: String,
    pub(crate) codingplan_default_account: Option<String>,
}

#[derive(Deserialize, Serialize)]
pub(crate) struct MemoryIndexData {
    pub(crate) version: String,
    pub(crate) last_updated: String,
    pub(crate) entries: Vec<MemoryIndexEntry>,
}

#[derive(Deserialize, Serialize, Clone)]
pub(crate) struct MemoryIndexEntry {
    pub(crate) file: String,
    pub(crate) summary: String,
    pub(crate) r#type: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionInfo {
    pub(crate) id: String,
    pub(crate) channel: String,
    pub(crate) chat_id: String,
    pub(crate) last_active_at: String,
    pub(crate) message_count: u64,
    pub(crate) token_count: u64,
    pub(crate) model: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderStoreData {
    pub(crate) providers: Vec<ProviderStoreEntry>,
    pub(crate) default_model: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderStoreEntry {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) adapter: String,
    pub(crate) base_url: Option<String>,
    pub(crate) api_key_env: String,
    pub(crate) models: Vec<ProviderModelEntry>,
}

#[derive(Clone, Deserialize)]
pub(crate) struct ProviderModelEntry {
    pub(crate) id: String,
    pub(crate) label: Option<String>,
    pub(crate) capabilities: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderStoreWriteData {
    pub(crate) providers: Vec<ProviderStoreWriteEntry>,
    pub(crate) default_model: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderStoreWriteEntry {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) adapter: String,
    pub(crate) base_url: Option<String>,
    pub(crate) api_key_env: String,
    pub(crate) models: Vec<ProviderModelWriteEntry>,
}

#[derive(Serialize)]
pub(crate) struct ProviderModelWriteEntry {
    pub(crate) id: String,
    pub(crate) label: Option<String>,
    pub(crate) capabilities: Vec<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthStoreData {
    pub(crate) accounts: Vec<AuthAccountEntry>,
    pub(crate) active_account_id: String,
    pub(crate) global_defaults: AuthGlobalDefaults,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthGlobalDefaults {
    pub(crate) max_tokens: u32,
    pub(crate) temperature: f32,
    pub(crate) preferred_protocol: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthAccountEntry {
    pub(crate) id: String,
    pub(crate) alias: String,
    pub(crate) provider: String,
    pub(crate) api_key: String,
    pub(crate) base_url: String,
    pub(crate) protocol: String,
    pub(crate) default_model: Option<String>,
    pub(crate) is_active: bool,
    pub(crate) created_at: String,
    pub(crate) last_used_at: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SettingsKeyEntry {
    pub(crate) name: String,
    pub(crate) provider: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentStoreData {
    pub(crate) agents: Vec<AgentStoreEntry>,
    pub(crate) default_agent: Option<String>,
    pub(crate) collaboration_enabled: bool,
    pub(crate) sub_agent_dispatch_enabled: bool,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentStoreEntry {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) model: String,
    pub(crate) tools: Vec<String>,
    pub(crate) permission_profile: String,
    pub(crate) enabled: bool,
    pub(crate) sub_agents: Vec<String>,
    pub(crate) description: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentStoreWriteData {
    pub(crate) agents: Vec<AgentStoreWriteEntry>,
    pub(crate) default_agent: Option<String>,
    pub(crate) collaboration_enabled: bool,
    pub(crate) sub_agent_dispatch_enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentStoreWriteEntry {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) model: String,
    pub(crate) tools: Vec<String>,
    pub(crate) permission_profile: String,
    pub(crate) enabled: bool,
    pub(crate) sub_agents: Vec<String>,
    pub(crate) description: Option<String>,
}

pub(crate) const AI_PROVIDERS: &[AiProvider] = &[
    AiProvider {
        id: "openai",
        name: "OpenAI",
        default_base_url: "https://api.openai.com/v1",
    },
    AiProvider {
        id: "anthropic",
        name: "Anthropic",
        default_base_url: "https://api.anthropic.com",
    },
    AiProvider {
        id: "deepseek",
        name: "DeepSeek",
        default_base_url: "https://api.deepseek.com/v1",
    },
    AiProvider {
        id: "moonshot",
        name: "Moonshot",
        default_base_url: "https://api.moonshot.cn/v1",
    },
    AiProvider {
        id: "zhipu",
        name: "智谱 AI",
        default_base_url: "https://open.bigmodel.cn/api/paas/v4",
    },
    AiProvider {
        id: "google",
        name: "Google AI",
        default_base_url: "https://generativelanguage.googleapis.com/v1",
    },
    AiProvider {
        id: "azure",
        name: "Azure OpenAI",
        default_base_url: "",
    },
];

pub(crate) const OAUTH_PROVIDERS: &[OAuthProviderMeta] = &[
    OAuthProviderMeta {
        id: "github",
        name: "GitHub",
        requires_callback: true,
        requires_corp_id: false,
        requires_agent_id: false,
    },
    OAuthProviderMeta {
        id: "google",
        name: "Google",
        requires_callback: true,
        requires_corp_id: false,
        requires_agent_id: false,
    },
    OAuthProviderMeta {
        id: "wechat",
        name: "微信",
        requires_callback: true,
        requires_corp_id: false,
        requires_agent_id: false,
    },
    OAuthProviderMeta {
        id: "qq",
        name: "QQ",
        requires_callback: true,
        requires_corp_id: false,
        requires_agent_id: false,
    },
    OAuthProviderMeta {
        id: "wework",
        name: "企业微信",
        requires_callback: true,
        requires_corp_id: true,
        requires_agent_id: true,
    },
];

#[derive(Serialize)]
pub(crate) struct HealthResponse {
    pub(crate) status: &'static str,
    pub(crate) timestamp: String,
}

#[derive(Serialize)]
pub(crate) struct ApiInfoResponse {
    pub(crate) name: String,
    pub(crate) version: String,
    pub(crate) runtime: &'static str,
    pub(crate) endpoints: Vec<&'static str>,
    pub(crate) default_model: String,
    pub(crate) database: DatabaseStatus,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DatabaseStatus {
    pub(crate) connected: bool,
    pub(crate) path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrendData {
    pub(crate) value: i32,
    pub(crate) direction: &'static str,
    pub(crate) last_week: i64,
    pub(crate) previous_week: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Trends {
    pub(crate) sessions: TrendData,
    pub(crate) messages: TrendData,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecentSession {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) platform: Option<String>,
    pub(crate) message_count: i64,
    pub(crate) updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Activity {
    pub(crate) id: String,
    pub(crate) r#type: &'static str,
    pub(crate) title: String,
    pub(crate) description: String,
    pub(crate) timestamp: String,
    pub(crate) icon: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiStatus {
    pub(crate) status: &'static str,
    pub(crate) model: String,
    pub(crate) latency: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StatsResponse {
    pub(crate) total_sessions: i64,
    pub(crate) total_messages: i64,
    pub(crate) active_connections: i64,
    pub(crate) plugins_count: i64,
    pub(crate) trends: Trends,
    pub(crate) recent_sessions: Vec<RecentSession>,
    pub(crate) activities: Vec<Activity>,
    pub(crate) ai_status: AiStatus,
    pub(crate) data_source: &'static str,
}

#[derive(Serialize)]
pub(crate) struct ErrorResponse {
    pub(crate) message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NotificationReadAllRequest {
    pub(crate) r#type: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModelSwitchRequest {
    pub(crate) model_id: String,
    pub(crate) session_id: Option<String>,
    pub(crate) reason: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModelSwitchResponse {
    pub(crate) success: bool,
    pub(crate) model: ModelResponse,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveApiKeyRequest {
    pub(crate) provider: String,
    pub(crate) api_key: Option<String>,
    pub(crate) base_url: Option<String>,
    pub(crate) name: String,
    pub(crate) enabled: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PatchApiKeyRequest {
    pub(crate) api_key: Option<String>,
    pub(crate) base_url: Option<String>,
    pub(crate) name: Option<String>,
    pub(crate) enabled: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveApiKeyResponse {
    pub(crate) success: bool,
    pub(crate) key: ApiKeyConfigResponse,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveOAuthConfigRequest {
    pub(crate) provider: String,
    pub(crate) name: String,
    pub(crate) client_id: String,
    pub(crate) client_secret: String,
    pub(crate) callback_url: Option<String>,
    pub(crate) corp_id: Option<String>,
    pub(crate) agent_id: Option<String>,
    pub(crate) enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveOAuthConfigResponse {
    pub(crate) success: bool,
    pub(crate) config: OAuthConfigResponse,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SuccessMessageResponse {
    pub(crate) success: bool,
    pub(crate) message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarkReadResponse {
    pub(crate) success: bool,
    pub(crate) notification: NotificationResponse,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarkAllReadResponse {
    pub(crate) success: bool,
    pub(crate) marked_read: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ToggleOAuthResponse {
    pub(crate) success: bool,
    pub(crate) enabled: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiProvider {
    pub(crate) id: &'static str,
    pub(crate) name: &'static str,
    pub(crate) default_base_url: &'static str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OAuthProviderMeta {
    pub(crate) id: &'static str,
    pub(crate) name: &'static str,
    pub(crate) requires_callback: bool,
    pub(crate) requires_corp_id: bool,
    pub(crate) requires_agent_id: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModelResponse {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) provider: String,
    pub(crate) model_id: String,
    pub(crate) capabilities: Vec<&'static str>,
    pub(crate) is_default: bool,
    pub(crate) enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SettingsKeysResponse {
    pub(crate) keys: Vec<ApiKeyConfigResponse>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SettingsProvidersResponse {
    pub(crate) providers: Vec<AiProvider>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiKeyConfigResponse {
    pub(crate) id: String,
    pub(crate) provider: String,
    pub(crate) name: String,
    pub(crate) masked_key: String,
    pub(crate) base_url: Option<String>,
    pub(crate) enabled: bool,
    pub(crate) last_used_at: Option<String>,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OAuthProvidersResponse {
    pub(crate) providers: Vec<OAuthProviderMeta>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OAuthConfigsResponse {
    pub(crate) configs: Vec<OAuthConfigResponse>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OAuthConfigResponse {
    pub(crate) id: String,
    pub(crate) provider: String,
    pub(crate) name: String,
    pub(crate) masked_client_id: String,
    pub(crate) masked_client_secret: String,
    pub(crate) callback_url: Option<String>,
    pub(crate) corp_id: Option<String>,
    pub(crate) agent_id: Option<String>,
    pub(crate) enabled: bool,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NotificationsResponse {
    pub(crate) notifications: Vec<NotificationResponse>,
    pub(crate) total: usize,
    pub(crate) unread_count: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NotificationResponse {
    pub(crate) id: String,
    pub(crate) r#type: &'static str,
    pub(crate) priority: &'static str,
    pub(crate) title: String,
    pub(crate) message: String,
    pub(crate) data: serde_json::Value,
    pub(crate) read: bool,
    pub(crate) created_at: String,
    pub(crate) expires_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UnreadCountResponse {
    pub(crate) unread_count: usize,
}

#[derive(sqlx::FromRow)]
pub(crate) struct RecentSessionRow {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) platform: Option<String>,
    pub(crate) message_count: i64,
    pub(crate) updated_at: String,
}

#[derive(sqlx::FromRow)]
pub(crate) struct ConnectionActivityRow {
    pub(crate) id: String,
    pub(crate) platform: String,
    pub(crate) name: Option<String>,
    pub(crate) status: String,
    pub(crate) updated_at: String,
}

#[derive(sqlx::FromRow)]
pub(crate) struct TaskActivityRow {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) enabled: i64,
    pub(crate) last_run_at: Option<String>,
    pub(crate) updated_at: String,
}

#[derive(sqlx::FromRow)]
pub(crate) struct SessionActivityRow {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) platform: Option<String>,
    pub(crate) updated_at: String,
}

#[derive(sqlx::FromRow)]
pub(crate) struct ApiKeyRow {
    pub(crate) id: String,
    pub(crate) provider: String,
    pub(crate) name: String,
    pub(crate) base_url: Option<String>,
    pub(crate) enabled: i64,
    pub(crate) last_used_at: Option<String>,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
}

#[derive(sqlx::FromRow)]
pub(crate) struct OAuthConfigRow {
    pub(crate) id: String,
    pub(crate) provider: String,
    pub(crate) name: String,
    pub(crate) callback_url: Option<String>,
    pub(crate) corp_id: Option<String>,
    pub(crate) agent_id: Option<String>,
    pub(crate) enabled: i64,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
}

pub(crate) struct ActivitySortable {
    pub(crate) timestamp_key: String,
    pub(crate) item: Activity,
}
