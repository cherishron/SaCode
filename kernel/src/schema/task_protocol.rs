use serde::{Deserialize, Serialize};
use std::fmt;

use super::{ExecutionMode, TaskState};

pub const TASK_PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EntrySource {
    Cli,
    Tui,
    Repl,
    Vscode,
    Automation,
    Sdk,
    Daemon,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskPhase {
    Queued,
    Executing,
    WaitingForUser,
    WaitingForApproval,
    Cancelling,
    Finished,
}

impl From<TaskState> for TaskPhase {
    fn from(state: TaskState) -> Self {
        match state {
            TaskState::Pending | TaskState::Ready | TaskState::Retrying => Self::Queued,
            TaskState::Running => Self::Executing,
            TaskState::WaitingForUser => Self::WaitingForUser,
            TaskState::WaitingForApproval => Self::WaitingForApproval,
            TaskState::Cancelling => Self::Cancelling,
            TaskState::Completed | TaskState::Failed | TaskState::Cancelled => Self::Finished,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TerminalOutcome {
    Success,
    Failure,
    Cancelled,
}

impl TerminalOutcome {
    pub fn task_state(self) -> TaskState {
        match self {
            Self::Success => TaskState::Completed,
            Self::Failure => TaskState::Failed,
            Self::Cancelled => TaskState::Cancelled,
        }
    }
}

impl TryFrom<TaskState> for TerminalOutcome {
    type Error = TaskProtocolError;

    fn try_from(state: TaskState) -> Result<Self, Self::Error> {
        match state {
            TaskState::Completed => Ok(Self::Success),
            TaskState::Failed => Ok(Self::Failure),
            TaskState::Cancelled => Ok(Self::Cancelled),
            _ => Err(TaskProtocolError::NonTerminalState(state)),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FailureCategory {
    Provider,
    Permission,
    Approval,
    Tool,
    Validation,
    Recovery,
    Compatibility,
    System,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SuggestedAction {
    Retry,
    ReconfigureProvider,
    RequestApproval,
    CheckPermissions,
    UpdateClient,
    ReviewRecoverySource,
    ReportIssue,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FailureDetail {
    pub category: FailureCategory,
    pub code: String,
    pub retryable: bool,
    pub suggested_action: SuggestedAction,
    pub safe_message: String,
}

impl FailureDetail {
    pub fn system(code: impl Into<String>, safe_message: impl Into<String>) -> Self {
        Self {
            category: FailureCategory::System,
            code: code.into(),
            retryable: false,
            suggested_action: SuggestedAction::ReportIssue,
            safe_message: safe_message.into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspaceBoundary {
    pub root: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExplicitContextRef {
    pub path: String,
    #[serde(default)]
    pub start_line: Option<u32>,
    #[serde(default)]
    pub end_line: Option<u32>,
    #[serde(default)]
    pub character_count: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskCreateRequest {
    pub schema_version: u32,
    pub prompt: String,
    pub mode: ExecutionMode,
    pub source: EntrySource,
    pub workspace: WorkspaceBoundary,
    #[serde(default)]
    pub explicit_contexts: Vec<ExplicitContextRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ResultSummary {
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub changed_objects: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RouteSummary {
    pub provider: String,
    pub model: String,
    pub switched: bool,
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ValidationStatus {
    Passed,
    Failed,
    NotRun,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ValidationSummary {
    pub status: ValidationStatus,
    #[serde(default)]
    pub checks: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskTimestamps {
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskSnapshot {
    pub schema_version: u32,
    pub task_id: String,
    pub mode: ExecutionMode,
    pub source: EntrySource,
    pub state: TaskState,
    pub phase: TaskPhase,
    #[serde(default)]
    pub terminal_outcome: Option<TerminalOutcome>,
    #[serde(default)]
    pub failure: Option<FailureDetail>,
    #[serde(default)]
    pub result: Option<ResultSummary>,
    #[serde(default)]
    pub validation: Option<ValidationSummary>,
    #[serde(default)]
    pub route: Option<RouteSummary>,
    pub timestamps: TaskTimestamps,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TaskFinalization {
    pub state: TaskState,
    pub applied: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TaskProtocolError {
    LegacySchema,
    UnsupportedSchema(u32),
    EmptyPrompt,
    EmptyTaskId,
    EmptyWorkspace,
    NonTerminalState(TaskState),
    StatePhaseMismatch,
    TerminalMismatch {
        state: TaskState,
        outcome: Option<TerminalOutcome>,
    },
    FailureMismatch,
}

impl fmt::Display for TaskProtocolError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::LegacySchema => write!(formatter, "legacy task protocol is unsupported"),
            Self::UnsupportedSchema(version) => {
                write!(formatter, "unsupported task protocol version: {version}")
            }
            Self::EmptyPrompt => write!(formatter, "task prompt cannot be empty"),
            Self::EmptyTaskId => write!(formatter, "task id cannot be empty"),
            Self::EmptyWorkspace => write!(formatter, "workspace root cannot be empty"),
            Self::NonTerminalState(state) => {
                write!(formatter, "task state is not terminal: {state}")
            }
            Self::StatePhaseMismatch => write!(formatter, "task phase does not match task state"),
            Self::TerminalMismatch { state, outcome } => {
                write!(
                    formatter,
                    "terminal outcome {outcome:?} does not match state {state}"
                )
            }
            Self::FailureMismatch => {
                write!(formatter, "failure detail does not match task outcome")
            }
        }
    }
}

impl std::error::Error for TaskProtocolError {}

impl TaskCreateRequest {
    pub fn validate(&self) -> Result<(), TaskProtocolError> {
        validate_protocol_version(self.schema_version)?;
        if self.prompt.trim().is_empty() {
            return Err(TaskProtocolError::EmptyPrompt);
        }
        if self.workspace.root.trim().is_empty() {
            return Err(TaskProtocolError::EmptyWorkspace);
        }
        Ok(())
    }
}

impl TaskSnapshot {
    pub fn validate(&self) -> Result<(), TaskProtocolError> {
        validate_protocol_version(self.schema_version)?;
        if self.task_id.trim().is_empty() {
            return Err(TaskProtocolError::EmptyTaskId);
        }
        if self.phase != TaskPhase::from(self.state) {
            return Err(TaskProtocolError::StatePhaseMismatch);
        }
        let expected_outcome = if self.state.is_terminal() {
            Some(TerminalOutcome::try_from(self.state)?)
        } else {
            None
        };
        if self.terminal_outcome != expected_outcome {
            return Err(TaskProtocolError::TerminalMismatch {
                state: self.state,
                outcome: self.terminal_outcome,
            });
        }
        if (self.state == TaskState::Failed) != self.failure.is_some() {
            return Err(TaskProtocolError::FailureMismatch);
        }
        Ok(())
    }
}

fn validate_protocol_version(version: u32) -> Result<(), TaskProtocolError> {
    match version {
        0 => Err(TaskProtocolError::LegacySchema),
        TASK_PROTOCOL_VERSION => Ok(()),
        other => Err(TaskProtocolError::UnsupportedSchema(other)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> TaskCreateRequest {
        TaskCreateRequest {
            schema_version: TASK_PROTOCOL_VERSION,
            prompt: "inspect the repository".to_string(),
            mode: ExecutionMode::Build,
            source: EntrySource::Cli,
            workspace: WorkspaceBoundary {
                root: ".".to_string(),
            },
            explicit_contexts: Vec::new(),
        }
    }

    fn snapshot(state: TaskState) -> TaskSnapshot {
        TaskSnapshot {
            schema_version: TASK_PROTOCOL_VERSION,
            task_id: "task-1".to_string(),
            mode: ExecutionMode::Build,
            source: EntrySource::Cli,
            state,
            phase: TaskPhase::from(state),
            terminal_outcome: TerminalOutcome::try_from(state).ok(),
            failure: (state == TaskState::Failed)
                .then(|| FailureDetail::system("system/unknown", "Task failed")),
            result: None,
            validation: None,
            route: None,
            timestamps: TaskTimestamps::default(),
        }
    }

    #[test]
    fn task_create_request_accepts_yolo_only_as_input_alias() {
        let mut value = serde_json::to_value(request()).unwrap();
        value["mode"] = serde_json::json!("yolo");
        let parsed: TaskCreateRequest = serde_json::from_value(value).unwrap();
        assert_eq!(parsed.mode, ExecutionMode::Yolo);
        assert_eq!(serde_json::to_value(parsed).unwrap()["mode"], "auto");
    }

    #[test]
    fn task_create_request_rejects_empty_prompt() {
        let mut value = request();
        value.prompt = "  ".to_string();
        assert_eq!(value.validate(), Err(TaskProtocolError::EmptyPrompt));
    }

    #[test]
    fn task_snapshot_roundtrip_preserves_terminal_outcome() {
        for state in [
            TaskState::Completed,
            TaskState::Failed,
            TaskState::Cancelled,
        ] {
            let expected = snapshot(state);
            let serialized = serde_json::to_string(&expected).unwrap();
            let actual: TaskSnapshot = serde_json::from_str(&serialized).unwrap();
            assert_eq!(actual, expected);
            assert!(actual.validate().is_ok());
        }
    }

    #[test]
    fn task_snapshot_rejects_multiple_terminal_meanings() {
        let mut value = snapshot(TaskState::Completed);
        value.failure = Some(FailureDetail::system("system/unknown", "Task failed"));
        assert_eq!(value.validate(), Err(TaskProtocolError::FailureMismatch));
    }

    #[test]
    fn task_snapshot_rejects_unknown_enums() {
        let mut value = serde_json::to_value(snapshot(TaskState::Running)).unwrap();
        value["source"] = serde_json::json!("unknown");
        assert!(serde_json::from_value::<TaskSnapshot>(value).is_err());
    }
}
