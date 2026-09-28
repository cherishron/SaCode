//! saai License v1 offline verification (ENT-07).
//!
//! Contract: `docs/licensing/license-format-v1.md`.
//! Signature input: `UTF8("SAAI-LICENSE-V1\n") || JCS(signing_object)`.
//! Unknown top-level fields are rejected. Client never signs.

use std::collections::BTreeMap;

use anyhow::{anyhow, bail, Context, Result};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const LICENSE_SCHEMA: &str = "saai-license/v1";
pub const LICENSE_ALG: &str = "Ed25519";
pub const LICENSE_DOMAIN_PREFIX: &str = "SAAI-LICENSE-V1\n";
pub const PRODUCT_SACODE: &str = "sacode";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LicenseSubject {
    #[serde(rename = "type")]
    pub subject_type: String,
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LicenseDeviceBinding {
    #[serde(rename = "type")]
    pub binding_type: String,
    pub fingerprint: String,
    pub version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LicenseClaims {
    pub license_id: String,
    pub entitlement_id: String,
    pub issuer: String,
    pub subject: LicenseSubject,
    pub product: String,
    #[serde(default)]
    pub edition: Option<String>,
    #[serde(default)]
    pub capabilities: Vec<String>,
    pub issued_at: String,
    pub not_before: String,
    pub expires_at: String,
    pub policy_version: u32,
    #[serde(default)]
    pub device_binding: Option<LicenseDeviceBinding>,
    #[serde(default)]
    pub metadata: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LicenseFile {
    pub schema: String,
    pub alg: String,
    pub kid: String,
    pub claims: LicenseClaims,
    pub signature: String,
}

/// Public keys by `kid`. Client only holds public keys (ENT-05).
pub type PublicKeyRegistry = BTreeMap<String, [u8; 32]>;

/// Parse and structurally validate a license document (no crypto).
pub fn parse_license(raw: &str) -> Result<LicenseFile> {
    if raw.len() > 64 * 1024 {
        bail!("license exceeds 64 KiB");
    }
    let value: Value = serde_json::from_str(raw).context("license is not JSON")?;
    let obj = value.as_object().ok_or_else(|| anyhow!("license must be an object"))?;
    const ALLOWED: [&str; 5] = ["schema", "alg", "kid", "claims", "signature"];
    for key in obj.keys() {
        if !ALLOWED.contains(&key.as_str()) {
            bail!("unknown top-level field in license: {key}");
        }
    }
    if obj.get("schema").and_then(Value::as_str) != Some(LICENSE_SCHEMA) {
        bail!("unsupported license schema");
    }
    if obj.get("alg").and_then(Value::as_str) != Some(LICENSE_ALG) {
        bail!("unsupported license alg");
    }
    let license: LicenseFile =
        serde_json::from_value(value).context("license fields invalid")?;
    if license.kid.trim().is_empty() {
        bail!("license kid is empty");
    }
    if license.signature.trim().is_empty() {
        bail!("license signature is empty");
    }
    Ok(license)
}

/// RFC 8785 JCS for JSON values (objects: keys sorted by UTF-16 code units / code points for ASCII).
pub fn jcs_canonicalize(value: &Value) -> Result<String> {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort_by(|a, b| a.as_str().cmp(b.as_str()));
            let mut out = String::from("{");
            for (i, key) in keys.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&json_string(key));
                out.push(':');
                out.push_str(&jcs_canonicalize(&map[*key])?);
            }
            out.push('}');
            Ok(out)
        }
        Value::Array(items) => {
            let mut out = String::from("[");
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&jcs_canonicalize(item)?);
            }
            out.push(']');
            Ok(out)
        }
        Value::String(s) => Ok(json_string(s)),
        Value::Number(n) => Ok(n.to_string()),
        Value::Bool(b) => Ok(if *b { "true" } else { "false" }.into()),
        Value::Null => Ok("null".into()),
    }
}

fn json_string(s: &str) -> String {
    serde_json::Value::String(s.to_string()).to_string()
}

/// Domain-separated signing bytes for a license.
pub fn license_signing_bytes(license: &LicenseFile) -> Result<Vec<u8>> {
    let claims: Value = serde_json::to_value(&license.claims)?;
    let signing = serde_json::json!({
        "schema": license.schema,
        "alg": license.alg,
        "kid": license.kid,
        "claims": claims,
    });
    let jcs = jcs_canonicalize(&signing)?;
    let mut out = LICENSE_DOMAIN_PREFIX.as_bytes().to_vec();
    out.extend_from_slice(jcs.as_bytes());
    Ok(out)
}

/// Verify signature + time + product policy. Fails closed.
pub fn verify_license(
    raw: &str,
    keys: &PublicKeyRegistry,
    now: chrono::DateTime<chrono::Utc>,
    expected_product: &str,
    device_fingerprint: Option<&str>,
) -> Result<LicenseFile> {
    let license = parse_license(raw)?;
    let pk = keys
        .get(&license.kid)
        .ok_or_else(|| anyhow!("unknown license kid {}", license.kid))?;
    let sig_bytes = URL_SAFE_NO_PAD
        .decode(license.signature.as_bytes())
        .context("signature is not base64url")?;
    if sig_bytes.len() != 64 {
        bail!("signature must be 64 bytes");
    }
    let mut sig_arr = [0u8; 64];
    sig_arr.copy_from_slice(&sig_bytes);
    let verifying = ed25519_dalek::VerifyingKey::from_bytes(pk).context("bad public key")?;
    let sig = ed25519_dalek::Signature::from_bytes(&sig_arr);
    let msg = license_signing_bytes(&license)?;
    verifying
        .verify_strict(&msg, &sig)
        .map_err(|_| anyhow!("license signature invalid"))?;

    if license.claims.product != expected_product {
        bail!(
            "license product mismatch: {} != {}",
            license.claims.product,
            expected_product
        );
    }
    let not_before = parse_rfc3339(&license.claims.not_before)?;
    let expires = parse_rfc3339(&license.claims.expires_at)?;
    if now < not_before {
        bail!("license not yet valid");
    }
    if now >= expires {
        bail!("license expired");
    }
    if let Some(binding) = &license.claims.device_binding {
        let Some(fp) = device_fingerprint else {
            bail!("license is device-bound but no local fingerprint");
        };
        if binding.fingerprint != fp {
            bail!("device fingerprint mismatch");
        }
    }
    Ok(license)
}

fn parse_rfc3339(s: &str) -> Result<chrono::DateTime<chrono::Utc>> {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.with_timezone(&chrono::Utc))
        .context("invalid RFC3339 timestamp")
}

/// Capability gate helper: only exact capability IDs, unknown are ignored.
pub fn license_grants(license: &LicenseFile, capability: &str) -> bool {
    license.claims.capabilities.iter().any(|c| c == capability)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn sample_claims() -> LicenseClaims {
        LicenseClaims {
            license_id: "lic_test".into(),
            entitlement_id: "ent_test".into(),
            issuer: "saai-entitlement".into(),
            subject: LicenseSubject {
                subject_type: "user".into(),
                id: "sub1".into(),
            },
            product: PRODUCT_SACODE.into(),
            edition: Some("enterprise".into()),
            capabilities: vec!["sacode_audit_export".into()],
            issued_at: "2026-01-01T00:00:00Z".into(),
            not_before: "2026-01-01T00:00:00Z".into(),
            expires_at: "2027-01-01T00:00:00Z".into(),
            policy_version: 1,
            device_binding: None,
            metadata: Value::Object(Default::default()),
        }
    }

    fn signed_license(sk: &SigningKey, kid: &str, claims: LicenseClaims) -> String {
        let mut lic = LicenseFile {
            schema: LICENSE_SCHEMA.into(),
            alg: LICENSE_ALG.into(),
            kid: kid.into(),
            claims,
            signature: String::new(),
        };
        let msg = license_signing_bytes(&lic).unwrap();
        let sig = sk.sign(&msg);
        lic.signature = URL_SAFE_NO_PAD.encode(sig.to_bytes());
        serde_json::to_string_pretty(&lic).unwrap()
    }

    #[test]
    fn parse_rejects_unknown_top_level_fields() {
        let raw = r#"{"schema":"saai-license/v1","alg":"Ed25519","kid":"k","claims":{},"signature":"aa","extra":1}"#;
        assert!(parse_license(raw).unwrap_err().to_string().contains("unknown"));
    }

    #[test]
    fn verify_accepts_valid_signature_and_time() {
        let sk = SigningKey::from_bytes(&[7u8; 32]);
        let pk = sk.verifying_key().to_bytes();
        let raw = signed_license(&sk, "k1", sample_claims());
        let mut keys = PublicKeyRegistry::new();
        keys.insert("k1".into(), pk);
        let now = chrono::DateTime::parse_from_rfc3339("2026-06-01T00:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let lic = verify_license(&raw, &keys, now, PRODUCT_SACODE, None).unwrap();
        assert!(license_grants(&lic, "sacode_audit_export"));
    }

    #[test]
    fn verify_fails_on_tamper_wrong_product_expired_unknown_kid() {
        let sk = SigningKey::from_bytes(&[9u8; 32]);
        let pk = sk.verifying_key().to_bytes();
        let mut keys = PublicKeyRegistry::new();
        keys.insert("k1".into(), pk);
        let now = chrono::DateTime::parse_from_rfc3339("2026-06-01T00:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);

        let mut lic = sample_claims();
        lic.product = "other".into();
        let raw = signed_license(&sk, "k1", lic);
        assert!(verify_license(&raw, &keys, now, PRODUCT_SACODE, None).is_err());

        let mut lic = sample_claims();
        lic.expires_at = "2026-02-01T00:00:00Z".into();
        let raw = signed_license(&sk, "k1", lic);
        assert!(verify_license(&raw, &keys, now, PRODUCT_SACODE, None)
            .unwrap_err()
            .to_string()
            .contains("expired"));

        let raw = signed_license(&sk, "other-kid", sample_claims());
        assert!(verify_license(&raw, &keys, now, PRODUCT_SACODE, None)
            .unwrap_err()
            .to_string()
            .contains("unknown license kid"));

        // tamper
        let raw = signed_license(&sk, "k1", sample_claims()).replace("lic_test", "lic_evil");
        assert!(verify_license(&raw, &keys, now, PRODUCT_SACODE, None).is_err());
    }

    #[test]
    fn device_binding_must_match() {
        let sk = SigningKey::from_bytes(&[11u8; 32]);
        let pk = sk.verifying_key().to_bytes();
        let mut keys = PublicKeyRegistry::new();
        keys.insert("k1".into(), pk);
        let mut claims = sample_claims();
        claims.device_binding = Some(LicenseDeviceBinding {
            binding_type: "sha256".into(),
            fingerprint: "AAAA".into(),
            version: 1,
        });
        let raw = signed_license(&sk, "k1", claims);
        let now = chrono::DateTime::parse_from_rfc3339("2026-06-01T00:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        assert!(verify_license(&raw, &keys, now, PRODUCT_SACODE, None).is_err());
        assert!(verify_license(&raw, &keys, now, PRODUCT_SACODE, Some("BBBB")).is_err());
        assert!(verify_license(&raw, &keys, now, PRODUCT_SACODE, Some("AAAA")).is_ok());
    }
}
