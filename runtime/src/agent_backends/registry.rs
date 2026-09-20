use std::collections::BTreeMap;
use std::sync::Mutex;

use sacode_kernel::{
    AgentBackendHealth, AgentBackendId, AgentDescriptor, BackendFailureCode,
    DEFAULT_AGENT_BACKEND_ID,
};

use super::NativeBackend;

/// Error when dispatching to a backend fails before tool execution starts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackendDispatchError {
    pub code: BackendFailureCode,
    pub safe_message: String,
}

impl BackendDispatchError {
    pub fn not_found(id: &str) -> Self {
        Self {
            code: BackendFailureCode::BackendNotFound,
            safe_message: format!("agent backend not registered: {id}"),
        }
    }

    pub fn unavailable(id: &str) -> Self {
        Self {
            code: BackendFailureCode::BackendUnavailable,
            safe_message: format!("agent backend unavailable: {id}"),
        }
    }
}

/// Registry of Agent Backends. Default registers only native `sacode`.
pub struct BackendRegistry {
    inner: Mutex<RegistryState>,
}

struct RegistryState {
    /// id → descriptor
    descriptors: BTreeMap<String, AgentDescriptor>,
}

impl Default for BackendRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl BackendRegistry {
    pub fn new() -> Self {
        let mut descriptors = BTreeMap::new();
        descriptors.insert(
            DEFAULT_AGENT_BACKEND_ID.to_string(),
            AgentDescriptor::sacode(),
        );
        Self {
            inner: Mutex::new(RegistryState { descriptors }),
        }
    }

    pub fn list(&self) -> Vec<AgentDescriptor> {
        self.inner
            .lock()
            .expect("backend registry lock")
            .descriptors
            .values()
            .cloned()
            .collect()
    }

    pub fn get(&self, id: &AgentBackendId) -> Option<AgentDescriptor> {
        self.inner
            .lock()
            .expect("backend registry lock")
            .descriptors
            .get(id.as_str())
            .cloned()
    }

    pub fn resolve(
        &self,
        id: Option<AgentBackendId>,
    ) -> Result<(AgentBackendId, AgentDescriptor), BackendDispatchError> {
        let id = sacode_kernel::normalize_backend_id(id);
        let state = self.inner.lock().expect("backend registry lock");
        match state.descriptors.get(id.as_str()) {
            Some(d) => {
                // Registered backends are creatable even when health is Unknown
                // (e.g. env-configured OpenCode before probe). Hard-reject only
                // when explicitly marked Unavailable.
                if d.health == AgentBackendHealth::Unavailable && !id.is_default() {
                    return Err(BackendDispatchError {
                        code: BackendFailureCode::BackendUnavailable,
                        safe_message: format!(
                            "agent backend {} is unavailable: {}",
                            d.id,
                            d.diagnostic
                                .clone()
                                .unwrap_or_else(|| "health=unavailable".into())
                        ),
                    });
                }
                Ok((id, d.clone()))
            }
            None => Err(BackendDispatchError::not_found(id.as_str())),
        }
    }

    /// Register or update a non-native backend descriptor (e.g. opencode probe).
    pub fn register(&self, descriptor: AgentDescriptor) {
        let mut state = self.inner.lock().expect("backend registry lock");
        state
            .descriptors
            .insert(descriptor.id.as_str().to_string(), descriptor);
    }

    pub fn unregister(&self, id: &AgentBackendId) -> bool {
        if id.is_default() {
            return false;
        }
        let mut state = self.inner.lock().expect("backend registry lock");
        state.descriptors.remove(id.as_str()).is_some()
    }

    /// Thin native adapter factory. Does not re-implement TaskExecutor.
    pub fn native(&self) -> NativeBackend {
        NativeBackend
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sacode_kernel::{AgentBackendKind, AgentCapabilities};

    #[test]
    fn default_registry_only_sacode() {
        let reg = BackendRegistry::new();
        let list = reg.list();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id.as_str(), "sacode");
        assert_eq!(list[0].kind, AgentBackendKind::Native);
        assert!(list[0].capabilities.approvals);
    }

    #[test]
    fn missing_backend_resolves_to_not_found() {
        let reg = BackendRegistry::new();
        let err = reg
            .resolve(Some(AgentBackendId::new("opencode")))
            .unwrap_err();
        assert_eq!(err.code, BackendFailureCode::BackendNotFound);
        assert!(err.safe_message.contains("opencode"));
    }

    #[test]
    fn unknown_health_registered_backend_still_resolves() {
        let reg = BackendRegistry::new();
        reg.register(AgentDescriptor {
            id: AgentBackendId::new("opencode"),
            display_name: "OpenCode".into(),
            kind: AgentBackendKind::Acp,
            health: AgentBackendHealth::Unknown,
            capabilities: AgentCapabilities::default(),
            executable: Some("bun".into()),
            version: None,
            diagnostic: None,
        });
        let (id, _) = reg
            .resolve(Some(AgentBackendId::new("opencode")))
            .expect("unknown health should still create");
        assert_eq!(id.as_str(), "opencode");
    }

    #[test]
    fn unavailable_health_rejects_non_default() {
        let reg = BackendRegistry::new();
        reg.register(AgentDescriptor {
            id: AgentBackendId::new("broken"),
            display_name: "Broken".into(),
            kind: AgentBackendKind::Acp,
            health: AgentBackendHealth::Unavailable,
            capabilities: AgentCapabilities::default(),
            executable: None,
            version: None,
            diagnostic: Some("binary missing".into()),
        });
        let err = reg
            .resolve(Some(AgentBackendId::new("broken")))
            .unwrap_err();
        assert_eq!(err.code, BackendFailureCode::BackendUnavailable);
        assert!(err.safe_message.contains("binary missing"));
    }

    #[test]
    fn none_backend_id_resolves_to_sacode() {
        let reg = BackendRegistry::new();
        let (id, desc) = reg.resolve(None).unwrap();
        assert_eq!(id.as_str(), "sacode");
        assert_eq!(desc.id.as_str(), "sacode");
    }

    #[test]
    fn register_then_resolve_opencode() {
        let reg = BackendRegistry::new();
        reg.register(AgentDescriptor {
            id: AgentBackendId::new("opencode"),
            display_name: "OpenCode".into(),
            kind: AgentBackendKind::Acp,
            health: AgentBackendHealth::Ready,
            capabilities: AgentCapabilities {
                streaming: true,
                tool_calls: true,
                approvals: true,
                cancel: true,
                sessions: true,
                modes: vec!["build".into()],
                notes: None,
            },
            executable: Some("opencode".into()),
            version: None,
            diagnostic: None,
        });
        let (id, desc) = reg.resolve(Some(AgentBackendId::new("opencode"))).unwrap();
        assert_eq!(id.as_str(), "opencode");
        assert_eq!(desc.kind, AgentBackendKind::Acp);
        assert!(reg.unregister(&AgentBackendId::new("opencode")));
        assert!(!reg.unregister(&AgentBackendId::sacode()));
    }
}
