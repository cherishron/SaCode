pub mod agent;
pub mod error;
pub mod event;
pub mod execution;
pub mod ffi;
pub mod hook;
pub mod model;
pub mod schema;
pub mod util;

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
    generate_task_id, AcceptanceEnvironment, AcceptanceEvidenceKind, AcceptanceEvidenceRef,
    AcceptanceMetricSample, AcceptanceOutcome, AcceptanceOutcomeCounts, AcceptanceRecord,
    AcceptanceReleaseSummary, AcceptanceSchemaError, BackoffStrategy, Checkpoint, EntrySource,
    ExecutionMode, ExplicitContextRef, FailureCategory, FailureDetail, Plan, QueueStats,
    ResultSummary, RetryCondition, RetryPolicy, Review, RouteSummary, ScheduledTask,
    StateTransitionError, Step, StepStatus, SuggestedAction, Task, TaskCreateRequest,
    TaskFinalization, TaskPhase, TaskPriority, TaskProtocolError, TaskQueueStatus, TaskResult,
    TaskSnapshot, TaskState, TaskTimestamps, TerminalOutcome, ValidationStatus, ValidationSummary,
    WorkspaceBoundary, ACCEPTANCE_SCHEMA_VERSION, TASK_PROTOCOL_VERSION,
};
