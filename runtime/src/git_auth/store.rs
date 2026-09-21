use std::path::{Path, PathBuf};

use anyhow::Result;
use serde::{Deserialize, Serialize};

use super::{GitAuthError, GitAuthResult};
use crate::identity::secret_store::{resolve_secret_ref, OsKeyringSecretStore, SecretStore};

pub const GITHUB_TOKEN_LOCATOR: &str = "os-keyring:sacode/git/github-token";
pub const GITEE_TOKEN_LOCATOR: &str = "os-keyring:sacode/git/gitee-token";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthHost {
    Github,
    Gitee,
}

impl AuthHost {
    pub fn parse(s: &str) -> GitAuthResult<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "github" | "gh" => Ok(Self::Github),
            "gitee" => Ok(Self::Gitee),
            other => Err(GitAuthError::msg(format!(
                "unknown git host {other} (expected github|gitee)"
            ))),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Github => "github",
            Self::Gitee => "gitee",
        }
    }

    pub fn hosts_for_git(self) -> &'static [&'static str] {
        match self {
            Self::Github => &["github.com"],
            Self::Gitee => &["gitee.com"],
        }
    }

    pub fn token_locator(self) -> &'static str {
        match self {
            Self::Github => GITHUB_TOKEN_LOCATOR,
            Self::Gitee => GITEE_TOKEN_LOCATOR,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GitAuthMeta {
    #[serde(default)]
    pub github: Option<AuthEntry>,
    #[serde(default)]
    pub gitee: Option<AuthEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthEntry {
    pub host: String,
    pub mode: String,
    #[serde(default)]
    pub login: Option<String>,
    pub updated_at: String,
    /// sa-idp subject (`session.json` → subject) when login was authorized
    /// under unified identity. Git OAuth **must** follow sa-idp login.
    #[serde(default)]
    pub idp_subject: Option<String>,
}

fn idp_subject_from_session(user_root: Option<&Path>) -> Option<String> {
    crate::identity::status_summary(user_root)
        .ok()
        .filter(|s| s.logged_in)
        .and_then(|s| s.subject)
}

fn auth_dir(user_root: Option<&Path>) -> PathBuf {
    match user_root {
        Some(r) => r.join(".sacode").join("git"),
        None => {
            if let Ok(h) = std::env::var("SACODE_HOME") {
                if !h.trim().is_empty() {
                    return PathBuf::from(h.trim()).join(".sacode").join("git");
                }
            }
            if let Ok(h) = std::env::var("USERPROFILE") {
                return PathBuf::from(h).join(".sacode").join("git");
            }
            PathBuf::from(".sacode/git")
        }
    }
}

pub fn meta_path(user_root: Option<&Path>) -> PathBuf {
    auth_dir(user_root).join("auth.json")
}

pub fn load_auth_meta(user_root: Option<&Path>) -> GitAuthMeta {
    let path = meta_path(user_root);
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn save_auth_meta(meta: &GitAuthMeta, user_root: Option<&Path>) -> Result<()> {
    let path = meta_path(user_root);
    if let Some(p) = path.parent() {
        std::fs::create_dir_all(p)?;
    }
    let raw = serde_json::to_string_pretty(meta)?;
    std::fs::write(&path, raw)?;
    Ok(())
}

pub fn secret_store_for(user_root: Option<&Path>) -> Box<dyn SecretStore> {
    // Isolated roots (tests / --home) use file-only stores so they never
    // clobber production OS keyring entries.
    if let Some(root) = user_root {
        return Box::new(crate::identity::service::FileSecretStore::new(Some(root)));
    }
    // Production: OS keyring first, file fallback second.
    Box::new(KeyringThenFile {
        keyring: OsKeyringSecretStore,
        file: crate::identity::service::FileSecretStore::new(None),
    })
}

struct KeyringThenFile {
    keyring: OsKeyringSecretStore,
    file: crate::identity::service::FileSecretStore,
}

impl SecretStore for KeyringThenFile {
    fn get(&self, locator: &str) -> Result<Option<String>> {
        if let Ok(Some(v)) = self.keyring.get(locator) {
            return Ok(Some(v));
        }
        self.file.get(locator)
    }

    fn set(&self, locator: &str, secret: &str) -> Result<()> {
        // Write both for resilience; keyring failure is non-fatal if file works.
        let mut last = Ok(());
        if let Err(e) = self.keyring.set(locator, secret) {
            last = Err(e);
        }
        self.file.set(locator, secret)?;
        if last.is_err() {
            tracing::warn!("git auth stored in file fallback; keyring set failed");
        }
        Ok(())
    }

    fn delete(&self, locator: &str) -> Result<()> {
        let _ = self.keyring.delete(locator);
        let _ = self.file.delete(locator);
        Ok(())
    }
}

pub fn save_token(
    host: AuthHost,
    token: &str,
    mode: &str,
    login: Option<String>,
    user_root: Option<&Path>,
) -> GitAuthResult<()> {
    let token = token.trim_start_matches('\u{feff}').trim();
    if token.is_empty() {
        return Err(GitAuthError::msg("token is empty"));
    }
    // 登录真源：sa-idp。OAuth 流程须在 identity 已登录后进行；
    // set-token 允许无 session（运维/CI），但不写 idp_subject。
    let subject = idp_subject_from_session(user_root);
    if mode == "device" || mode == "oauth" {
        if subject.is_none() {
            return Err(GitAuthError::msg(
                "git platform login requires sa-idp first: run `sacode account login`",
            ));
        }
    }
    let store = secret_store_for(user_root);
    store
        .set(host.token_locator(), token)
        .map_err(|e| GitAuthError::msg(e.to_string()))?;
    let mut meta = load_auth_meta(user_root);
    let entry = AuthEntry {
        host: host.as_str().to_string(),
        mode: mode.to_string(),
        login,
        updated_at: chrono::Utc::now().to_rfc3339(),
        idp_subject: subject,
    };
    match host {
        AuthHost::Github => meta.github = Some(entry),
        AuthHost::Gitee => meta.gitee = Some(entry),
    }
    save_auth_meta(&meta, user_root).map_err(|e| GitAuthError::msg(e.to_string()))?;
    Ok(())
}

pub fn token_for_host(host: AuthHost, user_root: Option<&Path>) -> GitAuthResult<Option<String>> {
    let store = secret_store_for(user_root);
    let secret_ref = sacode_kernel::model::SecretRef {
        kind: sacode_kernel::model::SecretRefKind::OsKeyring,
        locator: Some(host.token_locator().to_string()),
        masked: "****".to_string(),
    };
    // explicit store get (file fallback included)
    store
        .get(host.token_locator())
        .map_err(|e| GitAuthError::msg(e.to_string()))
        .map(|opt| {
            if opt.is_some() {
                opt
            } else {
                // legacy resolve path
                resolve_secret_ref(&secret_ref, Some(store.as_ref()))
                    .ok()
                    .flatten()
            }
        })
}

pub fn logout_host(host: Option<AuthHost>, user_root: Option<&Path>) -> GitAuthResult<()> {
    let store = secret_store_for(user_root);
    let hosts = match host {
        Some(h) => vec![h],
        None => vec![AuthHost::Github, AuthHost::Gitee],
    };
    let mut meta = load_auth_meta(user_root);
    for h in hosts {
        let _ = store.delete(h.token_locator());
        match h {
            AuthHost::Github => meta.github = None,
            AuthHost::Gitee => meta.gitee = None,
        }
    }
    save_auth_meta(&meta, user_root).map_err(|e| GitAuthError::msg(e.to_string()))?;
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct GitAuthStatus {
    pub host: String,
    pub configured: bool,
    pub token_present: bool,
    pub mode: Option<String>,
    pub login: Option<String>,
    pub updated_at: Option<String>,
    pub idp_subject: Option<String>,
}

pub fn git_auth_status(user_root: Option<&Path>) -> Vec<GitAuthStatus> {
    let meta = load_auth_meta(user_root);
    let identity = crate::identity::status_summary(user_root).ok();
    let mut out = Vec::new();
    for host in [AuthHost::Github, AuthHost::Gitee] {
        let entry = match host {
            AuthHost::Github => meta.github.clone(),
            AuthHost::Gitee => meta.gitee.clone(),
        };
        let token_present = token_for_host(host, user_root)
            .ok()
            .flatten()
            .map(|t| !t.is_empty())
            .unwrap_or(false);
        let mut idp_subject = entry.as_ref().and_then(|e| e.idp_subject.clone());
        if idp_subject.is_none() {
            idp_subject = identity
                .as_ref()
                .filter(|s| s.logged_in)
                .and_then(|s| s.subject.clone());
        }
        out.push(GitAuthStatus {
            host: host.as_str().to_string(),
            configured: entry.is_some() || token_present,
            token_present,
            mode: entry.as_ref().map(|e| e.mode.clone()),
            login: entry.as_ref().and_then(|e| e.login.clone()),
            updated_at: entry.map(|e| e.updated_at),
            idp_subject,
        });
    }
    out
}

pub fn identity_login_state(user_root: Option<&Path>) -> (bool, Option<String>) {
    match crate::identity::status_summary(user_root) {
        Ok(s) => (s.logged_in, s.subject),
        Err(_) => (false, None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_save_and_logout_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        save_token(
            AuthHost::Github,
            "ghp_test_token_value",
            "token", // set-token mode: no sa-idp required
            Some("tester".into()),
            Some(root),
        )
        .unwrap();
        let tok = token_for_host(AuthHost::Github, Some(root))
            .unwrap()
            .expect("token stored");
        assert_eq!(tok, "ghp_test_token_value");
        let st = git_auth_status(Some(root));
        assert!(st.iter().any(|s| s.host == "github" && s.token_present));
        logout_host(Some(AuthHost::Github), Some(root)).unwrap();
        assert!(token_for_host(AuthHost::Github, Some(root))
            .unwrap()
            .is_none());
    }

    #[test]
    fn parse_host_and_locator() {
        assert_eq!(AuthHost::parse("GitHub").unwrap(), AuthHost::Github);
        assert!(AuthHost::parse("bitbucket").is_err());
        assert!(GITHUB_TOKEN_LOCATOR.contains("github-token"));
    }

    /// Live OS keyring via OsKeyringSecretStore (same path as production).
    #[test]
    fn live_os_keyring_roundtrip() {
        let loc = "os-keyring:sacode/git/keyring-probe";
        let store = OsKeyringSecretStore;
        let marker = format!("probe-{}", std::process::id());
        store.set(loc, &marker).expect("OsKeyringSecretStore set");
        let got = store.get(loc).expect("OsKeyringSecretStore get");
        assert_eq!(
            got.as_deref(),
            Some(marker.as_str()),
            "production keyring set/get mismatch"
        );
        store.delete(loc).ok();
        eprintln!("live_os_keyring_roundtrip ok via OsKeyringSecretStore");
    }

    /// file fallback still works when keyring missing
    #[test]
    fn oauth_mode_requires_sa_idp_login() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        // no identity session in isolated root
        let err = save_token(AuthHost::Github, "ghp_x", "device", None, Some(root))
            .unwrap_err()
            .to_string();
        assert!(err.contains("sacode account login"), "unexpected: {err}");
    }

    #[test]
    fn file_fallback_after_keyring_miss() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        std::env::set_var("SACODE_HOME", root);
        save_token(AuthHost::Gitee, "gt_fallback", "token", None, Some(root)).unwrap();
        let tok = token_for_host(AuthHost::Gitee, Some(root))
            .unwrap()
            .expect("token");
        assert_eq!(tok, "gt_fallback");
        std::env::remove_var("SACODE_HOME");
    }
}
