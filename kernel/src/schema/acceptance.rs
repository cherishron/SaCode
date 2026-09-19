use serde::{Deserialize, Serialize};
use std::fmt;

pub const ACCEPTANCE_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AcceptanceOutcome {
    Passed,
    Failed,
    Blocked,
    NotApplicable,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AcceptanceEvidenceKind {
    CommandOutput,
    TestReport,
    MetricReport,
    ManualReview,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AcceptanceEnvironment {
    pub entry: String,
    pub platform: String,
    pub provider_type: String,
    #[serde(default)]
    pub preconditions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AcceptanceMetricSample {
    pub name: String,
    pub value: f64,
    pub unit: String,
    #[serde(default)]
    pub threshold: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AcceptanceEvidenceRef {
    pub kind: AcceptanceEvidenceKind,
    pub path: String,
    #[serde(default)]
    pub sha256: Option<String>,
    #[serde(default)]
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AcceptanceRecord {
    #[serde(default)]
    pub schema_version: u32,
    pub requirement_id: String,
    pub scenario_id: String,
    pub product_version: String,
    pub environment: AcceptanceEnvironment,
    pub expected: String,
    pub outcome: AcceptanceOutcome,
    pub actual_summary: String,
    #[serde(default)]
    pub metrics: Vec<AcceptanceMetricSample>,
    #[serde(default)]
    pub evidence: Vec<AcceptanceEvidenceRef>,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct AcceptanceOutcomeCounts {
    pub passed: usize,
    pub failed: usize,
    pub blocked: usize,
    pub not_applicable: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AcceptanceReleaseSummary {
    #[serde(default)]
    pub schema_version: u32,
    pub product_version: String,
    pub generated_at: String,
    pub counts: AcceptanceOutcomeCounts,
    #[serde(default)]
    pub blocking_requirement_ids: Vec<String>,
    #[serde(default)]
    pub known_limitations: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AcceptanceSchemaError {
    LegacySchema,
    UnsupportedSchema(u32),
    MissingField(&'static str),
}

impl fmt::Display for AcceptanceSchemaError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::LegacySchema => write!(formatter, "legacy acceptance schema cannot release"),
            Self::UnsupportedSchema(version) => {
                write!(
                    formatter,
                    "unsupported acceptance schema version: {version}"
                )
            }
            Self::MissingField(field) => write!(formatter, "missing acceptance field: {field}"),
        }
    }
}

impl std::error::Error for AcceptanceSchemaError {}

impl AcceptanceRecord {
    pub fn validate_for_release(&self) -> Result<(), AcceptanceSchemaError> {
        validate_schema_version(self.schema_version)?;
        validate_non_empty(&self.requirement_id, "requirement_id")?;
        validate_non_empty(&self.scenario_id, "scenario_id")?;
        validate_non_empty(&self.product_version, "product_version")?;
        validate_non_empty(&self.expected, "expected")?;
        validate_non_empty(&self.actual_summary, "actual_summary")?;
        Ok(())
    }
}

impl AcceptanceReleaseSummary {
    pub fn validate_for_release(&self) -> Result<(), AcceptanceSchemaError> {
        validate_schema_version(self.schema_version)?;
        validate_non_empty(&self.product_version, "product_version")?;
        validate_non_empty(&self.generated_at, "generated_at")?;
        Ok(())
    }
}

fn validate_schema_version(version: u32) -> Result<(), AcceptanceSchemaError> {
    match version {
        0 => Err(AcceptanceSchemaError::LegacySchema),
        ACCEPTANCE_SCHEMA_VERSION => Ok(()),
        other => Err(AcceptanceSchemaError::UnsupportedSchema(other)),
    }
}

fn validate_non_empty(value: &str, field: &'static str) -> Result<(), AcceptanceSchemaError> {
    if value.trim().is_empty() {
        return Err(AcceptanceSchemaError::MissingField(field));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record() -> AcceptanceRecord {
        AcceptanceRecord {
            schema_version: ACCEPTANCE_SCHEMA_VERSION,
            requirement_id: "PN-BASELINE-001".to_string(),
            scenario_id: "PN-SC-DOC-001".to_string(),
            product_version: "1.1.1".to_string(),
            environment: AcceptanceEnvironment {
                entry: "release_validation".to_string(),
                platform: "repository".to_string(),
                provider_type: "not_applicable".to_string(),
                preconditions: Vec::new(),
            },
            expected: "documents are consistent".to_string(),
            outcome: AcceptanceOutcome::Passed,
            actual_summary: "validation passed".to_string(),
            metrics: Vec::new(),
            evidence: vec![AcceptanceEvidenceRef {
                kind: AcceptanceEvidenceKind::CommandOutput,
                path: "acceptance/evidence/doc-consistency.json".to_string(),
                sha256: None,
                summary: Some("exit code 0".to_string()),
            }],
            notes: None,
        }
    }

    #[test]
    fn acceptance_outcome_serializes_as_stable_snake_case() {
        assert_eq!(
            serde_json::to_string(&AcceptanceOutcome::NotApplicable).unwrap(),
            "\"not_applicable\""
        );
    }

    #[test]
    fn acceptance_record_v1_roundtrip_is_stable() {
        let expected = record();
        let serialized = serde_json::to_string(&expected).unwrap();
        let actual: AcceptanceRecord = serde_json::from_str(&serialized).unwrap();
        assert_eq!(actual, expected);
        assert!(actual.validate_for_release().is_ok());
    }

    #[test]
    fn acceptance_record_rejects_unknown_outcome() {
        let mut value = serde_json::to_value(record()).unwrap();
        value["outcome"] = serde_json::json!("unknown");
        assert!(serde_json::from_value::<AcceptanceRecord>(value).is_err());
    }

    #[test]
    fn acceptance_record_rejects_future_schema() {
        let mut value = record();
        value.schema_version = ACCEPTANCE_SCHEMA_VERSION + 1;
        assert_eq!(
            value.validate_for_release(),
            Err(AcceptanceSchemaError::UnsupportedSchema(2))
        );
    }

    #[test]
    fn acceptance_record_v0_cannot_release() {
        let mut value = serde_json::to_value(record()).unwrap();
        value.as_object_mut().unwrap().remove("schema_version");
        let actual: AcceptanceRecord = serde_json::from_value(value).unwrap();
        assert_eq!(actual.schema_version, 0);
        assert_eq!(
            actual.validate_for_release(),
            Err(AcceptanceSchemaError::LegacySchema)
        );
    }

    #[test]
    fn acceptance_record_optional_fields_are_backward_compatible() {
        let mut value = serde_json::to_value(record()).unwrap();
        let object = value.as_object_mut().unwrap();
        object.remove("metrics");
        object.remove("evidence");
        object.remove("notes");
        let actual: AcceptanceRecord = serde_json::from_value(value).unwrap();
        assert!(actual.metrics.is_empty());
        assert!(actual.evidence.is_empty());
        assert_eq!(actual.notes, None);
    }

    #[test]
    fn acceptance_record_does_not_contain_secret_fixture() {
        let serialized = serde_json::to_string(&record()).unwrap();
        assert!(!serialized.contains("sk-test-secret"));
    }
}
