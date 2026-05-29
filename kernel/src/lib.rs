pub mod agent;
pub mod execution;
pub mod error;
pub mod event;
pub mod ffi;
pub mod hook;
pub mod model;
pub mod schema;

#[cfg(test)]
mod tests;

pub use agent::{AgentOutput, CoderAgent, CoderOutput, ToolCallIntent, PlannerAgent, ReviewerAgent, Supervisor, ExecutionResult};
pub use execution::{ApprovalPolicy, ExecutionContext, ExecutionReport, HookRecord, LifecyclePoint, StepContext, ToolExecutionContext, ToolExecutionRecord};
pub use event::{Event, ApprovalAction, FileChangeType};
pub use hook::{Hook, HookContext, HookResult};
pub use schema::{
    BackoffStrategy, Checkpoint, ExecutionMode, Plan, QueueStats, RetryCondition, RetryPolicy,
    Review, ScheduledTask, Step, StepStatus, Task, TaskPriority, TaskQueueStatus, TaskResult,
};
