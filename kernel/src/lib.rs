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

pub use agent::{AgentExecutionPlan, AgentOutput, AgentRole, CoderAgent, CoderOutput, ExecutionResult, OrchestrationHint, OrchestrationMode, PlannedRole, PlannerAgent, ReviewerAgent, RoleModelPolicy, RoleScore, RoleStage, SubAgentResult, SubAgentTask, Supervisor, TaskAnalysis, TaskScope, TaskType, ToolCallIntent};
pub use execution::{ApprovalPolicy, ConflictRecord, ExecutionContext, ExecutionReport, HookRecord, LifecyclePoint, RouteRecord, RoutedModelRecord, StepContext, SummaryItemRecord, SummaryRecord, ToolExecutionContext, ToolExecutionRecord};
pub use event::{Event, ApprovalAction, FileChangeType};
pub use hook::{Hook, HookContext, HookResult};
pub use schema::{
    BackoffStrategy, Checkpoint, ExecutionMode, Plan, QueueStats, RetryCondition, RetryPolicy,
    Review, ScheduledTask, Step, StepStatus, Task, TaskPriority, TaskQueueStatus, TaskResult,
};
