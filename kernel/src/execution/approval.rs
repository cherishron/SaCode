use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ApprovalPolicy {
    Prompt,
    AutoApprove,
    AutoDeny,
}

impl Default for ApprovalPolicy {
    fn default() -> Self {
        Self::Prompt
    }
}
