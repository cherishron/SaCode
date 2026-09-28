//! Enterprise audit export gated by capability `sacode_audit_export`.
//!
//! Contract: `docs/licensing/capabilities.md` — missing/invalid license must
//! only block this export, never basic startup, login, or model sync.

use std::path::{Path, PathBuf};

use axum::{extract::State, http::StatusCode, Json};
use serde_json::{json, Value};
use std::sync::Arc;

use super::DaemonState;
use crate::identity::{
    self, grants_capability_effective, license_grants, EntitlementItem, CAPABILITY_AUDIT_EXPORT,
    LICENSE_PRODUCT_SACODE,
};

fn error_json(status: StatusCode, message: &str, code: &str) -> (StatusCode, Json<Value>) {
    (
        status,
        Json(json!({ "error": message, "code": code })),
    )
}

fn license_file_path() -> PathBuf {
    identity::config::home_dir_fallback()
        .join(".sacode")
        .join("identity")
        .join("license.json")
}

fn audit_log_path(workdir: Option<&Path>) -> PathBuf {
    let root = workdir
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    root.join(".sacode").join("audit.log")
}

/// True when the user may export enterprise audit records from online entitlements.
/// Offline license grants require prior signature verification (`license_verified_grants`).
pub fn has_audit_export_capability(entitlements: &[EntitlementItem]) -> bool {
    grants_capability_effective(entitlements, CAPABILITY_AUDIT_EXPORT, chrono::Utc::now())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::EntitlementItem;

    #[test]
    fn capability_gate_only_exact_audit_export() {
        let items = vec![EntitlementItem {
            id: "e1".into(),
            product: Some("sacode".into()),
            subject_type: None,
            subject_id: None,
            valid_from: None,
            valid_until: None,
            capabilities: vec!["sacode_audit_export".into()],
            status: None,
        }];
        assert!(has_audit_export_capability(&items));
        let other = vec![EntitlementItem {
            capabilities: vec!["desktop_external_storage".into()],
            ..items[0].clone()
        }];
        assert!(!has_audit_export_capability(&other));
        assert!(!has_audit_export_capability(&[]));
    }
}

/// Grant only after signature verification (offline license).
pub fn license_verified_grants(license: &identity::LicenseFile) -> bool {
    license_grants(license, CAPABILITY_AUDIT_EXPORT)
        && license.claims.product == LICENSE_PRODUCT_SACODE
}

/// POST /api/audit/export — export bounded audit lines when capable.
pub async fn export_audit(State(state): State<Arc<DaemonState>>) -> (StatusCode, Json<Value>) {
    let cfg = match identity::IdentityConfig::load(None) {
        Ok(mut c) => {
            c.fill_local_defaults_if_empty();
            c.normalize();
            c
        }
        Err(_) => {
            return error_json(
                StatusCode::INTERNAL_SERVER_ERROR,
                "配置不可用",
                "config_unavailable",
            )
        }
    };

    // Online capability check (preferred).
    let store = identity::select_secret_store(false, None);
    let mut capable = false;
    let mut source = "none";
    if let Ok(access) =
        identity::ensure_entitlement_access_token(&cfg, store.as_ref(), None, 120).await
    {
        let http = identity::ReqwestEntitlementHttp::new();
        use identity::entitlement_client::EntitlementHttp;
        if let Ok(resp) = http
            .list_my_entitlements(&cfg.entitlement_me_url(), &access, Some(LICENSE_PRODUCT_SACODE))
            .await
        {
            if grants_capability_effective(
                &resp.items,
                CAPABILITY_AUDIT_EXPORT,
                chrono::Utc::now(),
            ) {
                capable = true;
                source = "online_entitlement";
            }
        }
    }

    // Offline license path: only if keys are configured via env SACODE_LICENSE_PUBLIC_KEYS
    // format: kid=base64url32;kid2=base64url32
    if !capable {
        let raw = std::fs::read_to_string(license_file_path()).ok();
        if let Some(raw) = raw.as_deref() {
            if let Ok(keys) = load_public_keys_from_env() {
                if !keys.is_empty() {
                    let store = identity::select_secret_store(false, None);
                    let fingerprint = identity::ensure_device_secret(store.as_ref())
                        .ok()
                        .map(|secret| identity::device_fingerprint(&secret));
                    if let Ok(verified) = identity::verify_license(
                        raw,
                        &keys,
                        chrono::Utc::now(),
                        LICENSE_PRODUCT_SACODE,
                        fingerprint.as_deref(),
                    ) {
                        if license_verified_grants(&verified) {
                            capable = true;
                            source = "offline_license";
                        }
                    }
                }
            }
        }
    }

    if !capable {
        return error_json(
            StatusCode::FORBIDDEN,
            "缺少 sacode_audit_export 能力：请先登录并获取权益，或导入有效 License",
            "capability_denied",
        );
    }

    let workdir = state.workdir.clone();
    let path = audit_log_path(workdir.as_deref());
    let content = std::fs::read_to_string(&path).unwrap_or_default();
    let lines: Vec<&str> = content.lines().take(5000).collect();
    (
        StatusCode::OK,
        Json(json!({
            "ok": true,
            "source": source,
            "path": path.display().to_string(),
            "lines": lines.len(),
            "content": lines.join("\n"),
        })),
    )
}

fn load_public_keys_from_env() -> anyhow::Result<identity::PublicKeyRegistry> {
    let mut map = identity::PublicKeyRegistry::new();
    let Ok(raw) = std::env::var("SACODE_LICENSE_PUBLIC_KEYS") else {
        return Ok(map);
    };
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    for pair in raw.split(';') {
        let pair = pair.trim();
        if pair.is_empty() {
            continue;
        }
        let Some((kid, b64)) = pair.split_once('=') else {
            continue;
        };
        let bytes = URL_SAFE_NO_PAD.decode(b64.trim())?;
        if bytes.len() != 32 {
            anyhow::bail!("public key for {kid} must be 32 bytes");
        }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&bytes);
        map.insert(kid.trim().to_string(), arr);
    }
    Ok(map)
}
