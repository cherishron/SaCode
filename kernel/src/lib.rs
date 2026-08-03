pub mod agent;
pub mod error;
pub mod event;
pub mod execution;
pub mod ffi;
pub mod hook;
pub mod model;
pub mod schema;

#[cfg(test)]
mod tests;

#[allow(deprecated)]
pub use agent::{
    AgentExecutionPlan, AgentOutput, AgentRole, CoderAgent, CoderOutput, ExecutionResult,
    OrchestrationHint, OrchestrationMode, PlannedRole, PlannerAgent, ReviewerAgent,
    RoleModelPolicy, RoleScore, RoleStage, SubAgentResult, SubAgentTask, Supervisor, TaskAnalysis,
    TaskScope, TaskType, ToolCallIntent,
};
pub use event::{ApprovalAction, Event, FileChangeType};
pub use execution::{
    ApprovalPolicy, ConflictRecord, ExecutionContext, ExecutionReport, HookRecord, LifecyclePoint,
    LoopNextAction, LoopPhase, LoopPhaseResult, LoopPhaseStatus, LoopProjectPlan, LoopState,
    RouteRecord, RoutedModelRecord, SessionRun, StepContext, SummaryItemRecord, SummaryRecord,
    TaskRun, TaskRunState, ToolExecutionContext, ToolExecutionRecord, WorkerRun,
};
pub use hook::{Hook, HookContext, HookResult};
pub use schema::{
    BackoffStrategy, Checkpoint, ExecutionMode, Plan, QueueStats, RetryCondition, RetryPolicy,
    Review, ScheduledTask, Step, StepStatus, Task, TaskPriority, TaskQueueStatus, TaskResult,
};
