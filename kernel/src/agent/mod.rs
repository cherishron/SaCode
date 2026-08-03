mod coder;
mod orchestration;
// planner/supervisor 整模块已废弃，模块内部对自身 deprecated 项的引用统一 allow
#[allow(deprecated)]
mod planner;
mod reviewer;
mod state_machine;
#[allow(deprecated)]
mod supervisor;

pub use coder::{CoderAgent, CoderOutput, ToolCallIntent};
pub use orchestration::{
    AgentExecutionPlan, AgentRole, OrchestrationHint, OrchestrationMode, PlannedRole,
    RoleModelPolicy, RoleScore, RoleStage, SubAgentResult, SubAgentTask, TaskAnalysis, TaskScope,
    TaskType,
};
// PlannerAgent/Supervisor 已废弃但保留供 ffi.rs（C ABI）和 runtime::executor::TaskExecutor 占位路径使用，
// 待 v0.5 阶段四 task_runner 完全替代后再统一移除。
#[allow(deprecated)]
pub use planner::{AgentOutput, PlannerAgent};
pub use reviewer::{ReviewerAgent, ReviewerOutput};
pub use state_machine::{AgentAction, SessionMode};
#[allow(deprecated)]
pub use supervisor::{ExecutionResult, Supervisor};
