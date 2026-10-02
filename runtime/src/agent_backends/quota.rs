//! O5/O6: per-backend daily quota state machine + queue-hold + UTC+8 day rollover.
//!
//! Contract §13.4–13.5. Persistence: `.sacode/agent_backends.json`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use sacode_kernel::AgentBackendQuota;

/// Detect rate-limit / quota exhaustion in error text (O5).
pub fn is_quota_exhausted_message(text: &str) -> bool {
    let lower = text.to_lowercase();
    const MARKERS: &[&str] = &[
        "429",
        "quota",
        "rate limit",
        "rate_limit",
        "ratelimit",
        "too many requests",
        "exceeded",
        "额度",
    ];
    MARKERS.iter().any(|m| lower.contains(m))
}

/// Extract a sanitized reason from a rate-limit error message.
pub fn quota_reason_from_message(text: &str) -> String {
    let first = text.lines().next().unwrap_or("").trim();
    let sanitized: String = first
        .chars()
        .map(|c| if c.is_ascii_graphic() || c == ' ' { c } else { '?' })
        .take(200)
        .collect();
    if sanitized.is_empty() {
        "rate limit exceeded".to_string()
    } else {
        sanitized
    }
}

/// In-memory quota store keyed by backend_id, with optional file persistence.
pub struct QuotaStore {
    inner: Mutex<HashMap<String, AgentBackendQuota>>,
    persist_path: Option<PathBuf>,
}

impl QuotaStore {
    pub fn new(persist_path: Option<PathBuf>) -> Self {
        let store = Self {
            inner: Mutex::new(HashMap::new()),
            persist_path,
        };
        store.load();
        store
    }

    /// Store without file persistence (tests).
    pub fn in_memory() -> Self {
        Self::new(None)
    }

    fn load(&self) {
        let Some(path) = &self.persist_path else { return };
        let Ok(raw) = std::fs::read_to_string(path) else { return };
        let Ok(parsed) = serde_json::from_str::<HashMap<String, AgentBackendQuota>>(&raw) else {
            return;
        };
        let mut inner = self.inner.lock().expect("quota store lock");
        *inner = parsed;
    }

    fn save(&self) {
        let Some(path) = &self.persist_path else { return };
        let inner = self.inner.lock().expect("quota store lock");
        if let Ok(json) = serde_json::to_string_pretty(&*inner) {
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::write(path, json);
        }
    }

    /// Get quota for a backend, creating a fresh one and rolling the day if needed.
    pub fn get_or_create(&self, backend_id: &str) -> AgentBackendQuota {
        let mut inner = self.inner.lock().expect("quota store lock");
        let entry = inner
            .entry(backend_id.to_string())
            .or_insert_with(|| AgentBackendQuota::fresh(AgentBackendQuota::today_utc8()));
        entry.roll_day();
        entry.clone()
    }

    /// Check whether the backend is currently exhausted (after day-rollover check).
    pub fn is_exhausted(&self, backend_id: &str) -> bool {
        self.get_or_create(backend_id).exhausted
    }

    /// Record one use; auto-rolls the day first.
    pub fn record_use(&self, backend_id: &str) -> AgentBackendQuota {
        let mut inner = self.inner.lock().expect("quota store lock");
        let entry = inner
            .entry(backend_id.to_string())
            .or_insert_with(|| AgentBackendQuota::fresh(AgentBackendQuota::today_utc8()));
        entry.roll_day();
        entry.record_use();
        let snapshot = entry.clone();
        drop(inner);
        self.save();
        snapshot
    }

    /// Mark exhausted (O5).
    pub fn mark_exhausted(&self, backend_id: &str, reason: &str) -> AgentBackendQuota {
        let mut inner = self.inner.lock().expect("quota store lock");
        let entry = inner
            .entry(backend_id.to_string())
            .or_insert_with(|| AgentBackendQuota::fresh(AgentBackendQuota::today_utc8()));
        entry.roll_day();
        entry.mark_exhausted(reason);
        let snapshot = entry.clone();
        drop(inner);
        self.save();
        snapshot
    }

    /// Check for day rollover across all backends. Returns list of backend_ids
    /// that were reset (and therefore can release held tasks). (O6)
    pub fn roll_day_all(&self) -> Vec<String> {
        let mut reset = Vec::new();
        {
            let mut inner = self.inner.lock().expect("quota store lock");
            for (id, quota) in inner.iter_mut() {
                if quota.roll_day() {
                    reset.push(id.clone());
                }
            }
        }
        if !reset.is_empty() {
            self.save();
        }
        reset
    }

    /// Set optional limit for a backend.
    pub fn set_limit(&self, backend_id: &str, limit: Option<u32>) {
        {
            let mut inner = self.inner.lock().expect("quota store lock");
            let entry = inner
                .entry(backend_id.to_string())
                .or_insert_with(|| AgentBackendQuota::fresh(AgentBackendQuota::today_utc8()));
            entry.limit = limit;
        }
        self.save();
    }
}

/// Sentinel dependency prefix for quota-held tasks (O6).
pub const QUOTA_HOLD_PREFIX: &str = "__quota_hold__:";

/// Build the sentinel dependency id for a backend.
pub fn quota_hold_dep(backend_id: &str) -> String {
    format!("{QUOTA_HOLD_PREFIX}{backend_id}")
}

/// True when a dependency string is a quota hold sentinel.
pub fn is_quota_hold_dep(dep: &str) -> bool {
    dep.starts_with(QUOTA_HOLD_PREFIX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quota_fresh_and_roll_day() {
        let mut q = AgentBackendQuota::fresh(AgentBackendQuota::today_utc8());
        assert!(!q.exhausted);
        assert_eq!(q.used, 0);
        // Same day: no reset
        assert!(!q.roll_day());
        // Force an old date
        q.date = "2020-01-01".into();
        q.used = 42;
        q.exhausted = true;
        q.reason = Some("test".into());
        assert!(q.roll_day());
        assert_eq!(q.used, 0);
        assert!(!q.exhausted);
        assert!(q.reason.is_none());
    }

    #[test]
    fn quota_record_use_respects_limit() {
        let mut q = AgentBackendQuota::fresh(AgentBackendQuota::today_utc8());
        q.limit = Some(2);
        q.record_use();
        assert!(!q.exhausted);
        q.record_use();
        assert!(q.exhausted);
        assert!(q.reason.is_some());
    }

    #[test]
    fn detect_rate_limit_markers() {
        assert!(is_quota_exhausted_message("429 Too Many Requests"));
        assert!(is_quota_exhausted_message("quota exceeded for today"));
        assert!(is_quota_exhausted_message("Rate limit reached"));
        assert!(is_quota_exhausted_message("今日额度已用完"));
        assert!(!is_quota_exhausted_message("file not found"));
        assert!(!is_quota_exhausted_message("connection refused"));
    }

    #[test]
    fn quota_reason_sanitized() {
        let reason = quota_reason_from_message("429 Too Many Requests\nsecret=abc123");
        assert!(reason.starts_with("429"));
        assert!(!reason.contains("abc123"));
    }

    #[test]
    fn quota_store_exhaust_and_reset() {
        let store = QuotaStore::in_memory();
        assert!(!store.is_exhausted("opencode"));
        store.mark_exhausted("opencode", "429");
        assert!(store.is_exhausted("opencode"));
        // Force old date and roll
        {
            let mut inner = store.inner.lock().unwrap();
            inner.get_mut("opencode").unwrap().date = "2020-01-01".into();
        }
        let reset = store.roll_day_all();
        assert!(reset.contains(&"opencode".to_string()));
        assert!(!store.is_exhausted("opencode"));
    }

    #[test]
    fn quota_hold_dep_roundtrip() {
        let dep = quota_hold_dep("opencode");
        assert!(is_quota_hold_dep(&dep));
        assert!(!is_quota_hold_dep("normal-task-id"));
    }

    #[test]
    fn utc8_today_format() {
        let today = AgentBackendQuota::today_utc8();
        // YYYY-MM-DD
        assert_eq!(today.len(), 10);
        assert_eq!(today.chars().nth(4), Some('-'));
        assert_eq!(today.chars().nth(7), Some('-'));
    }
}
