use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Review {
    pub passed: bool,
    pub issues: Vec<ReviewIssue>,
    pub suggestions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewIssue {
    pub severity: IssueSeverity,
    pub message: String,
    pub location: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IssueSeverity {
    Critical,
    Warning,
    Info,
}

impl Review {
    pub fn passed() -> Self {
        Self {
            passed: true,
            issues: Vec::new(),
            suggestions: Vec::new(),
        }
    }

    pub fn failed(issues: Vec<ReviewIssue>) -> Self {
        Self {
            passed: false,
            issues,
            suggestions: Vec::new(),
        }
    }

    pub fn with_suggestion(mut self, suggestion: impl Into<String>) -> Self {
        self.suggestions.push(suggestion.into());
        self
    }

    pub fn has_critical(&self) -> bool {
        self.issues.iter().any(|issue| issue.severity == IssueSeverity::Critical)
    }
}

impl ReviewIssue {
    pub fn critical(message: impl Into<String>) -> Self {
        Self {
            severity: IssueSeverity::Critical,
            message: message.into(),
            location: None,
        }
    }

    pub fn warning(message: impl Into<String>) -> Self {
        Self {
            severity: IssueSeverity::Warning,
            message: message.into(),
            location: None,
        }
    }

    pub fn info(message: impl Into<String>) -> Self {
        Self {
            severity: IssueSeverity::Info,
            message: message.into(),
            location: None,
        }
    }

    pub fn at(mut self, location: impl Into<String>) -> Self {
        self.location = Some(location.into());
        self
    }
}