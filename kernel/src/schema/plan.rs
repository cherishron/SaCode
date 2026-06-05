use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plan {
    pub task: String,
    pub steps: Vec<Step>,
    pub mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Step {
    pub id: usize,
    pub description: String,
    pub tools: Vec<String>,
    pub expected_output: String,
    pub status: StepStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StepStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Skipped,
}

impl Plan {
    pub fn new(task: String, steps: Vec<Step>, mode: String) -> Self {
        Self { task, steps, mode }
    }

    pub fn current_step(&self) -> Option<&Step> {
        self.steps
            .iter()
            .find(|s| s.status == StepStatus::Running || s.status == StepStatus::Pending)
    }

    pub fn completed_count(&self) -> usize {
        self.steps
            .iter()
            .filter(|s| s.status == StepStatus::Completed)
            .count()
    }

    pub fn is_done(&self) -> bool {
        self.steps
            .iter()
            .all(|s| s.status == StepStatus::Completed || s.status == StepStatus::Skipped)
    }
}

impl Step {
    pub fn new(
        id: usize,
        description: String,
        tools: Vec<String>,
        expected_output: String,
    ) -> Self {
        Self {
            id,
            description,
            tools,
            expected_output,
            status: StepStatus::Pending,
        }
    }

    pub fn mark_running(&mut self) {
        self.status = StepStatus::Running;
    }

    pub fn mark_completed(&mut self) {
        self.status = StepStatus::Completed;
    }

    pub fn mark_failed(&mut self) {
        self.status = StepStatus::Failed;
    }
}
