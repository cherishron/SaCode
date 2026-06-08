use crate::{
    execution::LifecyclePoint,
    hook::{HookContext, HookResult},
};

pub trait Hook: Send + Sync {
    fn name(&self) -> &str;

    fn supports(&self, point: LifecyclePoint) -> bool;

    fn execute(&self, context: &HookContext) -> HookResult;
}
