use sacode_kernel::{AgentBackendId, AgentDescriptor};

use super::BackendTaskContext;

/// Thin wrapper around the existing SaCode native execution path.
///
/// Does **not** own a second TaskQueue or rewrite TaskExecutor. Daemon
/// executor remains the lifecycle owner; native backend only tags context
/// and validates the request before handing off to task_runner.
#[derive(Debug, Clone, Copy, Default)]
pub struct NativeBackend;

impl NativeBackend {
    pub fn id(&self) -> AgentBackendId {
        AgentBackendId::sacode()
    }

    pub fn descriptor(&self) -> AgentDescriptor {
        AgentDescriptor::sacode()
    }

    /// Validate a dispatch context is eligible for the native path.
    pub fn accepts(&self, ctx: &BackendTaskContext) -> bool {
        ctx.backend_id.is_default() && !ctx.prompt.trim().is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sacode_kernel::ExecutionMode;

    #[test]
    fn native_accepts_default_backend() {
        let backend = NativeBackend;
        let ok = BackendTaskContext {
            task_id: "t1".into(),
            prompt: "run tests".into(),
            mode: ExecutionMode::Build,
            backend_id: AgentBackendId::sacode(),
            session_id: None,
            workspace_root: ".".into(),
        };
        assert!(backend.accepts(&ok));
        assert_eq!(backend.id().as_str(), "sacode");
        assert!(backend.descriptor().capabilities.streaming);
    }

    #[test]
    fn native_rejects_other_backends_and_empty_prompt() {
        let backend = NativeBackend;
        let wrong_backend = BackendTaskContext {
            task_id: "t2".into(),
            prompt: "x".into(),
            mode: ExecutionMode::Build,
            backend_id: AgentBackendId::new("opencode"),
            session_id: None,
            workspace_root: ".".into(),
        };
        assert!(!backend.accepts(&wrong_backend));
        let empty = BackendTaskContext {
            prompt: "   ".into(),
            ..wrong_backend
        };
        assert!(!backend.accepts(&empty));
    }
}
