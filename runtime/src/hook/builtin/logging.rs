use sacode_kernel::{Hook, HookContext, HookResult, LifecyclePoint};

#[derive(Debug, Default, Clone)]
pub struct LoggingHook;

impl LoggingHook {
    pub fn new() -> Self {
        Self
    }
}

impl Hook for LoggingHook {
    fn name(&self) -> &str {
        "logging"
    }

    fn supports(&self, _point: LifecyclePoint) -> bool {
        true
    }

    fn execute(&self, context: &HookContext) -> HookResult {
        let task_label = context
            .execution
            .task_id
            .clone()
            .unwrap_or_else(|| "task".to_string());
        let message = match &context.execution.current_step {
            Some(step) => format!(
                "hook=logging point={:?} task={} step={} desc={}",
                context.point,
                task_label,
                step.step_id,
                step.description
            ),
            None => format!(
                "hook=logging point={:?} task={}",
                context.point,
                task_label,
            ),
        };
        HookResult::success_with_message(message)
    }
}
