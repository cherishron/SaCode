#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionMode {
    Plan,
    Build,
    Yolo,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentAction {
    ShowPlan,
    ExecuteWithApproval,
    ExecuteAutomatically,
}
