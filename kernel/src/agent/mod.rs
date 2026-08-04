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
// PlannerAgent/Supervisor 已废弃，FFI 和 runtime 均已迁移到自包含实现。
// 保留导出仅为向后兼容第三方代码可能的对 kernel::Supervisor 的直接引用。
#[allow(deprecated)]
pub use planner::{AgentOutput, PlannerAgent};
pub use reviewer::{ReviewerAgent, ReviewerOutput};
pub use state_machine::{AgentAction, SessionMode};
#[allow(deprecated)]
pub use supervisor::{ExecutionResult, Supervisor};
