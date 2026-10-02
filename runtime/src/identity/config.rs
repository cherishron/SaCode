use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use url::Url;

use super::{
    DEFAULT_CLIENT_ID, DEFAULT_ENTITLEMENT_BASE_URL, DEFAULT_ENTITLEMENT_CLIENT_ID,
    DEFAULT_GATEWAY_BASE_URL, DEFAULT_IDP_BASE_URL, DEFAULT_PROVIDER_NAME,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IdentityConfig {
    pub idp_base_url: String,
    pub gateway_base_url: String,
    /// sa-entitlement 基址（权益查询 / License 状态）。
    #[serde(default)]
    pub entitlement_base_url: String,
    #[serde(default = "default_client_id")]
    pub client_id: String,
    /// OAuth client for entitlement tokens (aud=saai-entitlement).
    #[serde(default = "default_entitlement_client_id")]
    pub entitlement_client_id: String,
    /// Loopback redirect. When empty, CLI binds an ephemeral port.
    #[serde(default)]
    pub redirect_uri: Option<String>,
    #[serde(default = "default_provider_name")]
    pub provider_name: String,
}

fn default_client_id() -> String {
    DEFAULT_CLIENT_ID.to_string()
}

fn default_entitlement_client_id() -> String {
    DEFAULT_ENTITLEMENT_CLIENT_ID.to_string()
}

fn default_provider_name() -> String {
    DEFAULT_PROVIDER_NAME.to_string()
}

impl Default for IdentityConfig {
    fn default() -> Self {
        Self {
            idp_base_url: String::new(),
            gateway_base_url: String::new(),
            entitlement_base_url: String::new(),
            client_id: default_client_id(),
            entitlement_client_id: default_entitlement_client_id(),
            redirect_uri: None,
            provider_name: default_provider_name(),
        }
    }
}

impl IdentityConfig {
    pub fn user_config_path() -> PathBuf {
        home_dir()
            .join(".sacode")
            .join("identity")
            .join("config.json")
    }

    pub fn load(user_root: Option<&Path>) -> Result<Self> {
        let mut cfg = Self::load_stored(user_root)?;
        cfg.apply_env_overrides();
        Ok(cfg)
    }

    /// Load only the persisted identity settings, without temporary env overrides.
    pub fn load_stored(user_root: Option<&Path>) -> Result<Self> {
        let path = match user_root {
            Some(root) => root.join(".sacode").join("identity").join("config.json"),
            None => Self::user_config_path(),
        };
        if path.exists() {
            let raw = std::fs::read_to_string(&path)
                .with_context(|| format!("read identity config {}", path.display()))?;
            serde_json::from_str(&raw)
                .with_context(|| format!("parse identity config {}", path.display()))
        } else {
            Ok(Self::default())
        }
    }

    pub fn save(&self, user_root: Option<&Path>) -> Result<()> {
        let path = match user_root {
            Some(root) => root.join(".sacode").join("identity").join("config.json"),
            None => Self::user_config_path(),
        };
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let raw = serde_json::to_string_pretty(self)?;
        std::fs::write(&path, raw).with_context(|| format!("write {}", path.display()))?;
        Ok(())
    }

    /// 应用环境变量覆盖。全部可选——**不设也完全正常（缺省即 Local Mode）**，
    /// 不会 panic，也不要求任何云地址可达。
    ///
    /// 仅云增强用：`SACODE_IDP_BASE_URL` / `SACODE_GATEWAY_BASE_URL` /
    /// `SACODE_ENTITLEMENT_BASE_URL` / `SACODE_IDENTITY_CLIENT_ID` /
    /// `SACODE_ENTITLEMENT_CLIENT_ID` / `SACODE_IDENTITY_PROVIDER_NAME`。
    pub fn apply_env_overrides(&mut self) {
        if let Ok(v) = std::env::var("SACODE_IDP_BASE_URL") {
            let v = v.trim().to_string();
            if !v.is_empty() {
                self.idp_base_url = v;
            }
        }
        if let Ok(v) = std::env::var("SACODE_GATEWAY_BASE_URL") {
            let v = v.trim().to_string();
            if !v.is_empty() {
                self.gateway_base_url = v;
            }
        }
        if let Ok(v) = std::env::var("SACODE_IDENTITY_CLIENT_ID") {
            let v = v.trim().to_string();
            if !v.is_empty() {
                self.client_id = v;
            }
        }
        if let Ok(v) = std::env::var("SACODE_ENTITLEMENT_BASE_URL") {
            let v = v.trim().to_string();
            if !v.is_empty() {
                self.entitlement_base_url = v;
            }
        }
        if let Ok(v) = std::env::var("SACODE_ENTITLEMENT_CLIENT_ID") {
            let v = v.trim().to_string();
            if !v.is_empty() {
                self.entitlement_client_id = v;
            }
        }
        if let Ok(v) = std::env::var("SACODE_IDENTITY_PROVIDER_NAME") {
            let v = v.trim().to_string();
            if !v.is_empty() {
                self.provider_name = v;
            }
        }
    }

    pub fn with_overrides(
        mut self,
        idp: Option<String>,
        gateway: Option<String>,
        client_id: Option<String>,
        redirect_uri: Option<String>,
        provider_name: Option<String>,
    ) -> Self {
        if let Some(v) = idp {
            self.idp_base_url = v;
        }
        if let Some(v) = gateway {
            self.gateway_base_url = v;
        }
        if let Some(v) = client_id {
            self.client_id = v;
        }
        if let Some(v) = redirect_uri {
            self.redirect_uri = if v.trim().is_empty() { None } else { Some(v) };
        }
        if let Some(v) = provider_name {
            self.provider_name = v;
        }
        self
    }

    pub fn normalize(&mut self) {
        self.idp_base_url = self.idp_base_url.trim().trim_end_matches('/').to_string();
        self.gateway_base_url = self
            .gateway_base_url
            .trim()
            .trim_end_matches('/')
            .to_string();
        self.entitlement_base_url = self
            .entitlement_base_url
            .trim()
            .trim_end_matches('/')
            .to_string();
        self.client_id = self.client_id.trim().to_string();
        if self.client_id.is_empty() {
            self.client_id = DEFAULT_CLIENT_ID.to_string();
        }
        self.entitlement_client_id = self.entitlement_client_id.trim().to_string();
        if self.entitlement_client_id.is_empty() {
            self.entitlement_client_id = DEFAULT_ENTITLEMENT_CLIENT_ID.to_string();
        }
        if self.provider_name.trim().is_empty() {
            self.provider_name = DEFAULT_PROVIDER_NAME.to_string();
        } else {
            self.provider_name = self.provider_name.trim().to_string();
        }
    }

    /// Fill empty IdP/gateway URLs with local saai defaults (dev smoke / TUI first-run).
    ///
    /// 这些 localhost 缺省**仅云增强用**（登录/权益/同步模型），不是启动门槛：
    /// Local Mode 不设任何云 env、三件套全停也完全正常，任务路径不读它们的可达性。
    /// 已显式配置的地址不受影响；空值才填缺省。
    pub fn fill_local_defaults_if_empty(&mut self) {
        if self.idp_base_url.trim().is_empty() {
            self.idp_base_url = DEFAULT_IDP_BASE_URL.to_string();
        }
        if self.gateway_base_url.trim().is_empty() {
            self.gateway_base_url = DEFAULT_GATEWAY_BASE_URL.to_string();
        }
        if self.entitlement_base_url.trim().is_empty() {
            self.entitlement_base_url = DEFAULT_ENTITLEMENT_BASE_URL.to_string();
        }
    }

    pub fn ensure_ready_for_network(&self) -> Result<()> {
        if self.idp_base_url.is_empty() {
            anyhow::bail!(
                "idp_base_url is empty; set SACODE_IDP_BASE_URL or ~/.sacode/identity/config.json"
            );
        }
        if self.gateway_base_url.is_empty() {
            anyhow::bail!(
                "gateway_base_url is empty; set SACODE_GATEWAY_BASE_URL or ~/.sacode/identity/config.json"
            );
        }
        Ok(())
    }

    pub fn authorize_endpoint(&self) -> String {
        format!("{}{}", self.idp_base_url, super::IDP_AUTHORIZE_PATH)
    }

    pub fn token_endpoint(&self) -> String {
        format!("{}{}", self.idp_base_url, super::IDP_TOKEN_PATH)
    }

    pub fn discovery_endpoint(&self) -> String {
        format!("{}/.well-known/openid-configuration", self.idp_base_url)
    }

    pub fn revoke_endpoint(&self) -> String {
        format!("{}{}", self.idp_base_url, super::IDP_REVOKE_PATH)
    }

    pub fn gateway_exchange_url(&self) -> String {
        format!(
            "{}{}",
            self.gateway_base_url,
            super::GATEWAY_KEY_EXCHANGE_PATH
        )
    }

    pub fn gateway_models_url(&self) -> String {
        format!("{}{}", self.gateway_base_url, super::GATEWAY_MODELS_PATH)
    }

    pub fn gateway_model_connections_url(&self) -> String {
        format!(
            "{}{}",
            self.gateway_base_url,
            super::GATEWAY_MODEL_CONNECTIONS_PATH
        )
    }

    pub fn provider_base_url(&self) -> String {
        format!("{}/v1", self.gateway_base_url.trim_end_matches('/'))
    }

    pub fn entitlement_me_url(&self) -> String {
        format!(
            "{}{}",
            self.entitlement_base_url.trim_end_matches('/'),
            super::ENTITLEMENT_ME_PATH
        )
    }

    pub fn dry_run_summary(&self) -> String {
        format!(
            "idp_base_url={}\ngateway_base_url={}\nentitlement_base_url={}\nclient_id={}\nentitlement_client_id={}\nredirect_uri={}\nprovider_name={}\ntoken_endpoint={}\nexchange_url={}\nmodels_url={}\nentitlement_me_url={}",
            self.idp_base_url,
            self.gateway_base_url,
            self.entitlement_base_url,
            self.client_id,
            self.entitlement_client_id,
            self.redirect_uri.as_deref().unwrap_or("(loopback ephemeral)"),
            self.provider_name,
            self.token_endpoint(),
            self.gateway_exchange_url(),
            self.gateway_models_url(),
            self.entitlement_me_url(),
        )
    }
}

fn home_dir() -> PathBuf {
    if let Ok(v) = std::env::var("SACODE_HOME") {
        if !v.trim().is_empty() {
            return PathBuf::from(v.trim());
        }
    }
    if let Ok(v) = std::env::var("USERPROFILE") {
        if !v.trim().is_empty() {
            return PathBuf::from(v.trim());
        }
    }
    if let Ok(v) = std::env::var("HOME") {
        if !v.trim().is_empty() {
            return PathBuf::from(v.trim());
        }
    }
    PathBuf::from(".")
}

/// Public alias for identity modules (headless pending-login path).
pub fn home_dir_fallback() -> PathBuf {
    home_dir()
}

/// 校验并规范化 IdP/网关/权益服务的 base URL。
///
/// 规则：trim 后去掉尾部 `/`；拒绝空值、非 http/https 协议、缺少 host、
/// 带 userinfo（账号密码）、带 query、带 fragment 以及包含控制字符的输入。
/// 返回规范化后的值；失败时给出含字段语义的中文错误。
pub fn validate_base_url(value: &str) -> Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        anyhow::bail!("地址不能为空，需为 http:// 或 https:// 开头的服务地址");
    }
    if trimmed.chars().any(char::is_control) {
        anyhow::bail!("地址不能包含控制字符");
    }
    let url = Url::parse(trimmed).with_context(|| format!("URL 解析失败：{trimmed}"))?;
    match url.scheme() {
        "http" | "https" => {}
        other => anyhow::bail!("协议「{other}」不被支持，仅允许 http/https"),
    }
    if url.host_str().is_none() {
        anyhow::bail!("地址缺少主机名，例如 https://idp.example.com");
    }
    if !url.username().is_empty() || url.password().is_some() {
        anyhow::bail!("地址不允许携带账号或密码");
    }
    if url.query().is_some() {
        anyhow::bail!("地址不允许携带查询参数（?…）");
    }
    if url.fragment().is_some() {
        anyhow::bail!("地址不允许携带片段标识（#…）");
    }
    Ok(trimmed.trim_end_matches('/').to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn env_overrides_file_values() {
        let _g = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::set_var("SACODE_IDP_BASE_URL", "https://idp.test");
        std::env::set_var("SACODE_GATEWAY_BASE_URL", "https://gw.test/");
        std::env::set_var("SACODE_IDENTITY_CLIENT_ID", "sacode-cli");
        std::env::set_var("SACODE_IDENTITY_PROVIDER_NAME", "sa-gateway");
        let mut cfg = IdentityConfig::default();
        cfg.apply_env_overrides();
        cfg.normalize();
        assert_eq!(cfg.idp_base_url, "https://idp.test");
        assert_eq!(cfg.gateway_base_url, "https://gw.test");
        assert_eq!(cfg.client_id, "sacode-cli");
        assert_eq!(cfg.provider_name, "sa-gateway");
        std::env::remove_var("SACODE_IDP_BASE_URL");
        std::env::remove_var("SACODE_GATEWAY_BASE_URL");
        std::env::remove_var("SACODE_IDENTITY_CLIENT_ID");
        std::env::remove_var("SACODE_IDENTITY_PROVIDER_NAME");
    }

    #[test]
    fn endpoint_builders_join_paths() {
        let cfg = IdentityConfig {
            idp_base_url: "https://idp.example.com".into(),
            gateway_base_url: "https://gw.example.com".into(),
            ..Default::default()
        };
        assert_eq!(cfg.token_endpoint(), "https://idp.example.com/oauth/token");
        assert_eq!(
            cfg.gateway_exchange_url(),
            "https://gw.example.com/api/auth/exchange"
        );
        assert_eq!(cfg.provider_base_url(), "https://gw.example.com/v1");
    }

    #[test]
    fn fill_local_defaults_only_when_empty() {
        let mut cfg = IdentityConfig::default();
        cfg.fill_local_defaults_if_empty();
        assert_eq!(cfg.idp_base_url, DEFAULT_IDP_BASE_URL);
        assert_eq!(cfg.gateway_base_url, DEFAULT_GATEWAY_BASE_URL);
        assert_eq!(cfg.entitlement_base_url, DEFAULT_ENTITLEMENT_BASE_URL);

        let mut cfg = IdentityConfig {
            idp_base_url: "https://idp.custom".into(),
            gateway_base_url: String::new(),
            entitlement_base_url: "https://ent.custom".into(),
            ..Default::default()
        };
        cfg.fill_local_defaults_if_empty();
        assert_eq!(cfg.idp_base_url, "https://idp.custom");
        assert_eq!(cfg.gateway_base_url, DEFAULT_GATEWAY_BASE_URL);
        assert_eq!(cfg.entitlement_base_url, "https://ent.custom");
    }

    #[test]
    fn entitlement_client_defaults_and_env_override() {
        let _g = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut cfg = IdentityConfig::default();
        cfg.fill_local_defaults_if_empty();
        cfg.normalize();
        assert_eq!(cfg.entitlement_client_id, DEFAULT_ENTITLEMENT_CLIENT_ID);
        assert_eq!(
            cfg.entitlement_me_url(),
            format!("{}/v1/entitlements/me", DEFAULT_ENTITLEMENT_BASE_URL)
        );

        std::env::set_var("SACODE_ENTITLEMENT_BASE_URL", "https://ent.test/");
        std::env::set_var("SACODE_ENTITLEMENT_CLIENT_ID", "sacode-ent-dev");
        let mut cfg = IdentityConfig::default();
        cfg.apply_env_overrides();
        cfg.normalize();
        assert_eq!(cfg.entitlement_base_url, "https://ent.test");
        assert_eq!(cfg.entitlement_client_id, "sacode-ent-dev");
        assert_eq!(cfg.entitlement_me_url(), "https://ent.test/v1/entitlements/me");
        std::env::remove_var("SACODE_ENTITLEMENT_BASE_URL");
        std::env::remove_var("SACODE_ENTITLEMENT_CLIENT_ID");
    }

    #[test]
    fn legacy_config_json_without_entitlement_fields_still_loads() {
        let json = r#"{"idp_base_url":"https://idp.test","gateway_base_url":"https://gw.test","client_id":"sacode","provider_name":"sa-ai"}"#;
        let cfg: IdentityConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.entitlement_client_id, DEFAULT_ENTITLEMENT_CLIENT_ID);
        assert_eq!(cfg.entitlement_base_url, "");
    }

    #[test]
    fn validate_base_url_accepts_and_normalizes() {
        assert_eq!(
            validate_base_url("https://idp.example.com").unwrap(),
            "https://idp.example.com"
        );
        assert_eq!(
            validate_base_url("http://127.0.0.1:8080/").unwrap(),
            "http://127.0.0.1:8080"
        );
        assert_eq!(
            validate_base_url("  https://gw.example.com/  ").unwrap(),
            "https://gw.example.com"
        );
    }

    #[test]
    fn validate_base_url_rejects_unsafe_values() {
        let cases: [(&str, &str); 9] = [
            ("javascript:alert(1)", "javascript 协议"),
            ("data:text/html;base64,AAAA", "data 协议"),
            ("https://idp.example.com/?a=b", "查询参数"),
            ("https://idp.example.com/#frag", "片段标识"),
            ("https://user:pass@idp.example.com", "账号密码"),
            ("https://", "缺少主机名"),
            ("ftp://files.example.com", "ftp 协议"),
            ("", "空串"),
            ("   ", "纯空白"),
        ];
        for (bad, why) in cases {
            let err = validate_base_url(bad)
                .expect_err(&format!("应拒绝 {why}：{bad:?}"));
            let msg = format!("{err:#}");
            assert!(!msg.is_empty(), "应拒绝 {why} 并给出中文错误：{bad:?}");
        }
    }
}
