//! Device fingerprint + activation request v1 (ENT-09).
//!
//! Contract: `docs/licensing/device-activation-request-v1.md`.
//! device_secret lives only in SecretStore (OS keyring).

use anyhow::{Context, Result};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::secret_store::SecretStore;

pub const DEVICE_SECRET_LOCATOR: &str = "os-keyring:sacode/identity/device-secret";
pub const ACTIVATION_REQUEST_SCHEMA: &str = "saai-device-activation-request/v1";
pub const FINGERPRINT_PREFIX: &str = "SAAI-DEVICE-FINGERPRINT-V1\n";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeviceBinding {
    #[serde(rename = "type")]
    pub binding_type: String,
    pub fingerprint: String,
    pub version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ClientInfo {
    pub name: String,
    pub version: String,
    pub platform: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ActivationRequest {
    pub schema: String,
    pub request_id: String,
    pub product: String,
    pub device_binding: DeviceBinding,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_name: Option<String>,
    pub client: ClientInfo,
    pub created_at: String,
}

/// Ensure a 32-byte device secret exists in the secret store; returns it.
pub fn ensure_device_secret(store: &dyn SecretStore) -> Result<Vec<u8>> {
    if let Some(existing) = store
        .get(DEVICE_SECRET_LOCATOR)
        .ok()
        .flatten()
        .and_then(|s| URL_SAFE_NO_PAD.decode(s.as_bytes()).ok())
        .filter(|b| b.len() == 32)
    {
        return Ok(existing);
    }
    let mut secret = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut secret);
    store
        .set(
            DEVICE_SECRET_LOCATOR,
            &URL_SAFE_NO_PAD.encode(secret),
        )
        .context("store device secret")?;
    Ok(secret.to_vec())
}

/// Fingerprint v1 = base64url(SHA256(prefix || device_secret)).
/// Prefix is ASCII domain separation per the frozen protocol.
pub fn device_fingerprint(secret: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(FINGERPRINT_PREFIX.as_bytes());
    hasher.update(secret);
    URL_SAFE_NO_PAD.encode(hasher.finalize())
}

/// Build a complete activation request document.
pub fn build_activation_request(
    store: &dyn SecretStore,
    product: &str,
    device_name: Option<&str>,
    client: ClientInfo,
    created_at: chrono::DateTime<chrono::Utc>,
) -> Result<ActivationRequest> {
    if product.trim().is_empty() {
        anyhow::bail!("product is required");
    }
    if let Some(name) = device_name {
        let len = name.chars().count();
        if len > 128 {
            anyhow::bail!("device_name too long");
        }
    }
    if client.name.is_empty() || client.name.len() > 64 {
        anyhow::bail!("client.name invalid");
    }
    if client.version.is_empty() || client.version.len() > 64 {
        anyhow::bail!("client.version invalid");
    }
    let platform = client.platform.to_ascii_lowercase();
    if !matches!(platform.as_str(), "windows" | "macos" | "linux") {
        anyhow::bail!("client.platform must be windows|macos|linux");
    }
    let secret = ensure_device_secret(store)?;
    let fingerprint = device_fingerprint(&secret);
    let request_id = format!(
        "req_{}",
        URL_SAFE_NO_PAD.encode({
            let mut b = [0u8; 16];
            rand::thread_rng().fill_bytes(&mut b);
            b
        })
    );
    Ok(ActivationRequest {
        schema: ACTIVATION_REQUEST_SCHEMA.into(),
        request_id,
        product: product.into(),
        device_binding: DeviceBinding {
            binding_type: "sha256".into(),
            fingerprint,
            version: 1,
        },
        device_name: device_name.map(|s| s.to_string()),
        client: ClientInfo {
            platform,
            ..client
        },
        created_at: created_at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
    })
}

/// Serialize request to pretty JSON (≤16 KiB enforced by caller/UI).
pub fn activation_request_json(req: &ActivationRequest) -> Result<String> {
    let raw = serde_json::to_string_pretty(req)?;
    if raw.len() > 16 * 1024 {
        anyhow::bail!("activation request exceeds 16 KiB");
    }
    Ok(raw)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::secret_store::MemorySecretStore;

    #[test]
    fn fingerprint_is_stable_for_same_secret() {
        let fp1 = device_fingerprint(&[1u8; 32]);
        let fp2 = device_fingerprint(&[1u8; 32]);
        assert_eq!(fp1, fp2);
        assert_ne!(fp1, device_fingerprint(&[2u8; 32]));
        assert_eq!(URL_SAFE_NO_PAD.decode(fp1.as_bytes()).unwrap().len(), 32);
    }

    #[test]
    fn secret_reused_from_store() {
        let store = MemorySecretStore::new();
        let a = ensure_device_secret(&store).unwrap();
        let b = ensure_device_secret(&store).unwrap();
        assert_eq!(a, b);
        assert_eq!(a.len(), 32);
    }

    #[test]
    fn activation_request_matches_v1_shape() {
        let store = MemorySecretStore::new();
        let now = chrono::DateTime::parse_from_rfc3339("2026-09-26T08:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let req = build_activation_request(
            &store,
            "sacode",
            Some("研发工作站-01"),
            ClientInfo {
                name: "SaCode Desktop".into(),
                version: "0.1.0".into(),
                platform: "windows".into(),
            },
            now,
        )
        .unwrap();
        assert_eq!(req.schema, ACTIVATION_REQUEST_SCHEMA);
        assert_eq!(req.product, "sacode");
        assert_eq!(req.device_binding.binding_type, "sha256");
        assert_eq!(req.device_binding.version, 1);
        assert!(req.request_id.starts_with("req_"));
        assert_eq!(req.created_at, "2026-09-26T08:00:00Z");
        let json = activation_request_json(&req).unwrap();
        assert!(json.contains("saai-device-activation-request/v1"));
        // no secrets in request
        let secret = ensure_device_secret(&store).unwrap();
        let encoded = URL_SAFE_NO_PAD.encode(secret);
        assert!(!json.contains(&encoded));
    }
}
