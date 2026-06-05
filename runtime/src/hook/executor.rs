use std::sync::Arc;

use sacode_kernel::{Hook, HookContext, HookRecord, HookResult, LifecyclePoint};

#[derive(Default)]
pub struct HookExecutor {
    hooks: Vec<Arc<dyn Hook>>,
}

impl HookExecutor {
    pub fn new() -> Self {
        Self { hooks: Vec::new() }
    }

    pub fn register<H>(&mut self, hook: H)
    where
        H: Hook + 'static,
    {
        self.hooks.push(Arc::new(hook));
    }

    pub fn register_shared(&mut self, hook: Arc<dyn Hook>) {
        self.hooks.push(hook);
    }

    pub fn is_empty(&self) -> bool {
        self.hooks.is_empty()
    }

    pub fn len(&self) -> usize {
        self.hooks.len()
    }

    pub fn names(&self) -> Vec<String> {
        self.hooks
            .iter()
            .map(|hook| hook.name().to_string())
            .collect()
    }

    pub fn execute(&self, point: LifecyclePoint, context: &HookContext) -> Vec<HookRecord> {
        self.hooks
            .iter()
            .filter(|hook| hook.supports(point))
            .map(|hook| {
                let HookResult { success, message } = hook.execute(context);
                HookRecord {
                    hook_name: hook.name().to_string(),
                    point,
                    success,
                    message,
                }
            })
            .collect()
    }
}
