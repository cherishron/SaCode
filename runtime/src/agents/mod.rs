mod model_router;
mod orchestrator;
mod planner;
mod role_registry;
mod worker;

pub use model_router::{ResolvedRoleRoute, build_route_plan_from_candidates, resolve_config_model_candidates, resolve_role_route};
pub use planner::{analyze_task, build_execution_plan, parse_orchestration_hint, score_roles, strip_orchestration_prefix};
pub use orchestrator::execute_role_driven_orchestration;
pub use role_registry::{builtin_roles, find_role, RoleRegistry};
pub use worker::{WorkerRunResult, run_sub_agent};
