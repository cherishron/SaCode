//! sa-entitlement resource client: `GET /v1/entitlements/me`.
//!
//! Contract: `sa-entitlement` README + `docs/licensing/architecture.md`.
//! Requires access_token with aud=saai-entitlement and scope `entitlement:read`.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EntitlementCapability {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EntitlementItem {
    pub id: String,
    #[serde(default)]
    pub product: Option<String>,
    #[serde(default)]
    pub subject_type: Option<String>,
    #[serde(default)]
    pub subject_id: Option<String>,
    #[serde(default)]
    pub valid_from: Option<String>,
    #[serde(default)]
    pub valid_until: Option<String>,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub status: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct EntitlementsMeResponse {
    #[serde(default)]
    pub items: Vec<EntitlementItem>,
}

/// HTTP surface for entitlement queries. Injectable for tests.
pub trait EntitlementHttp: Send + Sync {
    fn list_my_entitlements(
        &self,
        url: &str,
        access_token: &str,
        product: Option<&str>,
    ) -> impl std::future::Future<Output = Result<EntitlementsMeResponse>> + Send;
}

#[derive(Debug, Clone, Default)]
pub struct ReqwestEntitlementHttp {
    pub client: reqwest::Client,
}

impl ReqwestEntitlementHttp {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .unwrap_or_default(),
        }
    }
}

impl EntitlementHttp for ReqwestEntitlementHttp {
    async fn list_my_entitlements(
        &self,
        url: &str,
        access_token: &str,
        product: Option<&str>,
    ) -> Result<EntitlementsMeResponse> {
        let mut req = self
            .client
            .get(url)
            .bearer_auth(access_token)
            .header("Cache-Control", "no-store");
        if let Some(p) = product {
            req = req.query(&[("product", p)]);
        }
        let resp = req.send().await.with_context(|| format!("GET {url}"))?;
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            anyhow::bail!("entitlements/me {status}: {body}");
        }
        serde_json::from_str(&body).with_context(|| format!("parse entitlements body: {body}"))
    }
}

/// Product id for SaCode in the capability registry.
pub const PRODUCT_SACODE: &str = "sacode";
/// Capability required for enterprise audit export (capabilities.md).
pub const CAPABILITY_AUDIT_EXPORT: &str = "sacode_audit_export";

/// True when `capability` is present on any item (exact ID match).
pub fn grants_capability(items: &[EntitlementItem], capability: &str) -> bool {
    items
        .iter()
        .any(|item| item.capabilities.iter().any(|c| c == capability))
}

/// Active status values (sa-entitlement only returns current-effective rows,
/// but defense-in-depth: reject anything not clearly active).
fn item_is_active_status(item: &EntitlementItem) -> bool {
    match item.status.as_deref() {
        None | Some("") => true,
        Some(s) => {
            let s = s.to_ascii_lowercase();
            s == "active" || s == "granted" || s == "valid"
        }
    }
}

fn parse_rfc3339(s: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    chrono::DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|dt| dt.with_timezone(&chrono::Utc))
}

/// True when item is effective at `now` (status + time window). Fail closed on unparseable bounds.
pub fn entitlement_is_effective(item: &EntitlementItem, now: chrono::DateTime<chrono::Utc>) -> bool {
    if !item_is_active_status(item) {
        return false;
    }
    if let Some(from) = item.valid_from.as_deref().filter(|s| !s.is_empty()) {
        match parse_rfc3339(from) {
            Some(t) if now < t => return false,
            None => return false,
            _ => {}
        }
    }
    if let Some(until) = item.valid_until.as_deref().filter(|s| !s.is_empty()) {
        match parse_rfc3339(until) {
            Some(t) if now >= t => return false,
            None => return false,
            _ => {}
        }
    }
    true
}

/// Capability check on **effective** items only (status + valid_from/valid_until).
pub fn grants_capability_effective(
    items: &[EntitlementItem],
    capability: &str,
    now: chrono::DateTime<chrono::Utc>,
) -> bool {
    items
        .iter()
        .filter(|item| entitlement_is_effective(item, now))
        .any(|item| item.capabilities.iter().any(|c| c == capability))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grants_capability_matches_exact_id_only() {
        let items = vec![EntitlementItem {
            id: "e1".into(),
            product: Some("sacode".into()),
            subject_type: Some("user".into()),
            subject_id: Some("sub1".into()),
            valid_from: None,
            valid_until: None,
            capabilities: vec!["sacode_audit_export".into(), "unknown_cap".into()],
            status: Some("active".into()),
        }];
        assert!(grants_capability(&items, "sacode_audit_export"));
        assert!(grants_capability(&items, "unknown_cap"));
        assert!(!grants_capability(&items, "desktop_external_storage"));
    }

    #[test]
    fn empty_list_grants_nothing() {
        assert!(!grants_capability(&[], CAPABILITY_AUDIT_EXPORT));
    }

    #[test]
    fn effective_grants_reject_expired_and_future() {
        let now = chrono::DateTime::parse_from_rfc3339("2026-06-01T00:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let active = EntitlementItem {
            id: "e1".into(),
            product: Some("sacode".into()),
            subject_type: None,
            subject_id: None,
            valid_from: Some("2026-01-01T00:00:00Z".into()),
            valid_until: Some("2027-01-01T00:00:00Z".into()),
            capabilities: vec![CAPABILITY_AUDIT_EXPORT.into()],
            status: Some("active".into()),
        };
        assert!(grants_capability_effective(&[active.clone()], CAPABILITY_AUDIT_EXPORT, now));

        let mut expired = active.clone();
        expired.valid_until = Some("2026-02-01T00:00:00Z".into());
        assert!(!grants_capability_effective(&[expired], CAPABILITY_AUDIT_EXPORT, now));

        let mut future = active.clone();
        future.valid_from = Some("2027-01-01T00:00:00Z".into());
        assert!(!grants_capability_effective(&[future], CAPABILITY_AUDIT_EXPORT, now));

        let mut revoked = active.clone();
        revoked.status = Some("revoked".into());
        assert!(!grants_capability_effective(&[revoked], CAPABILITY_AUDIT_EXPORT, now));

        let mut bad_until = active.clone();
        bad_until.valid_until = Some("not-a-date".into());
        assert!(!grants_capability_effective(&[bad_until], CAPABILITY_AUDIT_EXPORT, now));
    }
}
