use serde::{Deserialize, Serialize};

use crate::schema::ExecutionMode;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub mode: ExecutionMode,
}
