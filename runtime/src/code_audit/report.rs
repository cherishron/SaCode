use std::path::{Path, PathBuf};

use anyhow::Result;
use serde::{Deserialize, Serialize};

pub const REPORT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    High,
    Medium,
    Low,
    Info,
}

impl Severity {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::High => "high",
            Self::Medium => "medium",
            Self::Low => "low",
            Self::Info => "info",
        }
    }

    /// Lower rank = more severe (sort ascending).
    pub fn rank(self) -> u8 {
        match self {
            Self::High => 0,
            Self::Medium => 1,
            Self::Low => 2,
            Self::Info => 3,
        }
    }
}

fn default_finding_schema() -> u32 {
    REPORT_SCHEMA_VERSION
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Finding {
    #[serde(default = "default_finding_schema")]
    pub schema_version: u32,
    pub id: String,
    pub severity: Severity,
    pub category: String,
    pub file: String,
    #[serde(default)]
    pub line: Option<u32>,
    pub title: String,
    pub detail: String,
    pub suggestion: String,
    pub source: String,
}

impl Finding {
    pub fn new(
        id: impl Into<String>,
        severity: Severity,
        category: impl Into<String>,
        file: impl Into<String>,
        line: Option<u32>,
        title: impl Into<String>,
        detail: impl Into<String>,
        suggestion: impl Into<String>,
        source: impl Into<String>,
    ) -> Self {
        Self {
            schema_version: REPORT_SCHEMA_VERSION,
            id: id.into(),
            severity,
            category: category.into(),
            file: file.into(),
            line,
            title: title.into(),
            detail: detail.into(),
            suggestion: suggestion.into(),
            source: source.into(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SummaryCounts {
    pub high: usize,
    pub medium: usize,
    pub low: usize,
    pub info: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditReport {
    pub schema_version: u32,
    pub created_at: String,
    pub root: String,
    pub findings: Vec<Finding>,
    pub summary: SummaryCounts,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub ai_used: bool,
}

impl AuditReport {
    pub fn new(root: &Path, findings: Vec<Finding>) -> Self {
        // Mask secrets in all findings so report.json and report.md never leak.
        let findings: Vec<Finding> = findings
            .into_iter()
            .map(|mut f| {
                f.detail = mask_probable_secrets(&f.detail);
                f.suggestion = mask_probable_secrets(&f.suggestion);
                f.title = mask_probable_secrets(&f.title);
                f
            })
            .collect();
        let mut summary = SummaryCounts::default();
        for f in &findings {
            match f.severity {
                Severity::High => summary.high += 1,
                Severity::Medium => summary.medium += 1,
                Severity::Low => summary.low += 1,
                Severity::Info => summary.info += 1,
            }
        }
        Self {
            schema_version: REPORT_SCHEMA_VERSION,
            created_at: chrono::Utc::now().to_rfc3339(),
            root: root.display().to_string(),
            findings,
            summary,
            provider: None,
            ai_used: false,
        }
    }

    pub fn to_markdown(&self) -> String {
        let mut md = String::new();
        md.push_str("# SaCode 代码审计报告\n\n");
        md.push_str(&format!("- 时间: {}\n", self.created_at));
        md.push_str(&format!("- 根目录: {}\n", self.root));
        md.push_str(&format!(
            "- 汇总: high={} medium={} low={} info={}\n",
            self.summary.high, self.summary.medium, self.summary.low, self.summary.info
        ));
        if let Some(p) = &self.provider {
            md.push_str(&format!("- Provider: {p}\n"));
        }
        md.push_str(&format!(
            "- AI 审计: {}\n\n",
            if self.ai_used { "是" } else { "否" }
        ));
        if self.findings.is_empty() {
            md.push_str("未发现明显问题（启发式/AI 扫描范围有限，不等于绝对安全）。\n");
            return md;
        }
        md.push_str("## 发现\n\n");
        let mut f = self.findings.clone();
        f.sort_by_key(|x| x.severity.rank());
        for item in &f {
            md.push_str(&format!(
                "### {} · {} · `{}`\n\n",
                item.severity.as_str(),
                item.id,
                item.file
            ));
            if let Some(line) = item.line {
                md.push_str(&format!("- 行号: {line}\n"));
            }
            md.push_str(&format!("- 标题: {}\n", item.title));
            md.push_str(&format!("- 详情: {}\n", item.detail));
            md.push_str(&format!("- 建议: {}\n", item.suggestion));
            md.push_str(&format!("- 来源: {}\n\n", item.source));
        }
        md.push_str("## 下一步\n\n");
        md.push_str(
            "```bash\nsacode audit fix --from .sacode/code-audit/<stamp>/report.json\n```\n",
        );
        md
    }
}

pub fn audit_report_dir(root: &Path) -> PathBuf {
    root.join(".sacode").join("code-audit")
}

pub fn audit_report_path(root: &Path, stamp: &str) -> PathBuf {
    audit_report_dir(root).join(stamp)
}

pub fn save_report(root: &Path, report: &AuditReport) -> Result<PathBuf> {
    let stamp = report.created_at.replace(':', "-").replace('+', "p");
    let dir = audit_report_path(root, &stamp);
    std::fs::create_dir_all(&dir)?;
    let json_path = dir.join("report.json");
    let md_path = dir.join("report.md");
    std::fs::write(&json_path, serde_json::to_string_pretty(report)?)?;
    std::fs::write(&md_path, report.to_markdown())?;
    Ok(json_path)
}

pub fn load_report(path: &Path) -> Result<AuditReport> {
    let mut path = path.to_path_buf();
    // Spec allows --from report.md; resolve sibling report.json when present.
    if path.extension().and_then(|e| e.to_str()) == Some("md") {
        let sibling = path.with_file_name("report.json");
        if sibling.is_file() {
            path = sibling;
        } else {
            anyhow::bail!(
                "未找到与 report.md 同目录的 report.json。请使用: sacode audit fix --from <dir>/report.json"
            );
        }
    }
    let raw = std::fs::read_to_string(&path)?;
    Ok(serde_json::from_str(&raw)?)
}

pub fn parse_findings_json(text: &str) -> Vec<Finding> {
    // Try full array, then {findings:[...]}
    if let Ok(list) = serde_json::from_str::<Vec<Finding>>(text) {
        return list.into_iter().map(sanitize_finding).collect();
    }
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(text) {
        if let Some(arr) = v.get("findings").and_then(|f| f.as_array()) {
            let mut out = Vec::new();
            for item in arr {
                if let Ok(f) = serde_json::from_value::<Finding>(item.clone()) {
                    out.push(sanitize_finding(f));
                }
            }
            return out;
        }
    }
    Vec::new()
}

fn sanitize_finding(mut f: Finding) -> Finding {
    if f.schema_version == 0 {
        f.schema_version = REPORT_SCHEMA_VERSION;
    }
    f.detail = mask_probable_secrets(&f.detail);
    f.suggestion = mask_probable_secrets(&f.suggestion);
    f.title = mask_probable_secrets(&f.title);
    if f.id.trim().is_empty() {
        f.id = "CA-AI".into();
    }
    if f.source.trim().is_empty() {
        f.source = "ai".into();
    }
    f
}

pub fn mask_probable_secrets(s: &str) -> String {
    let mut out = s.to_string();
    // Prefer specific SaCode/gateway tokens over broad prefixes like "sa-".
    for prefix in [
        "sk-",
        "ghp_",
        "github_pat_",
        "sa-ee7",
        "sa-real-",
        "AKIA",
        "xoxb-",
    ] {
        while let Some(pos) = out.find(prefix) {
            let rest = out[pos..].to_string();
            let token_len = rest
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
                .count();
            if token_len <= prefix.len() {
                break;
            }
            let masked = sacode_kernel::model::SecretRef::mask_secret(&rest[..token_len]);
            out.replace_range(pos..pos + token_len, &masked);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::code_audit::fix_prompt_from_report;

    fn sample_finding() -> Finding {
        Finding::new(
            "CA-001",
            Severity::High,
            "security",
            "src/x.rs",
            Some(10),
            "possible secret",
            "key sk-abcdefghijklmnop exposed",
            "remove hard-coded secret",
            "heuristic",
        )
    }

    #[test]
    fn report_markdown_and_json_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let report = AuditReport::new(tmp.path(), vec![sample_finding()]);
        assert_eq!(report.summary.high, 1);
        let path = save_report(tmp.path(), &report).unwrap();
        let loaded = load_report(&path).unwrap();
        assert_eq!(loaded.findings.len(), 1);
        let md = report.to_markdown();
        assert!(md.contains("CA-001"));
        assert!(md.contains("high"));
        // secret masked in markdown
        assert!(!md.contains("sk-abcdefghijklmnop"));
    }

    #[test]
    fn parse_ai_findings_array() {
        let json = r#"[{"id":"CA-9","severity":"medium","category":"security","file":"a.rs","line":3,"title":"t","detail":"d","suggestion":"s","source":"ai"}]"#;
        let list = parse_findings_json(json);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].severity, Severity::Medium);
        assert_eq!(list[0].source, "ai");
    }

    #[test]
    fn parse_ai_findings_object_wrapper() {
        let json = r#"{"findings":[{"id":"CA-8","severity":"high","category":"security","file":"b.rs","line":1,"title":"t","detail":"d","suggestion":"s","source":"ai"}]}"#;
        let list = parse_findings_json(json);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "CA-8");
        assert_eq!(list[0].severity, Severity::High);
    }

    #[test]
    fn parse_ai_findings_masks_secrets() {
        let json = r#"[{"id":"CA-7","severity":"high","category":"security","file":"c.rs","line":1,"title":"key sk-abcdefghijklmnop here","detail":"token ghp_abcdefghijklmnop","suggestion":"remove AKIAabcdefghijklmnop","source":"ai"}]"#;
        let list = parse_findings_json(json);
        assert_eq!(list.len(), 1);
        assert!(!list[0].title.contains("sk-abcdefghijklmnop"));
        assert!(!list[0].detail.contains("ghp_abcdefghijklmnop"));
        assert!(!list[0].suggestion.contains("AKIAabcdefghijklmnop"));
    }

    #[test]
    fn report_json_serialization_masks_secrets() {
        let tmp = tempfile::tempdir().unwrap();
        let report = AuditReport::new(tmp.path(), vec![sample_finding()]);
        let path = save_report(tmp.path(), &report).unwrap();
        let raw = std::fs::read_to_string(&path).unwrap();
        assert!(!raw.contains("sk-abcdefghijklmnop"));
        assert!(raw.contains("CA-001"));
    }

    #[test]
    fn fix_prompt_contains_findings() {
        let report = AuditReport::new(Path::new("."), vec![sample_finding()]);
        let p = fix_prompt_from_report(&report, 10);
        assert!(p.contains("CA-001"));
        assert!(p.contains("sacode audit"));
    }

    #[test]
    fn load_report_accepts_md_via_sibling_json() {
        let tmp = tempfile::tempdir().unwrap();
        let report = AuditReport::new(tmp.path(), vec![sample_finding()]);
        let json_path = save_report(tmp.path(), &report).unwrap();
        let md_path = json_path.with_file_name("report.md");
        let loaded = load_report(&md_path).unwrap();
        assert_eq!(loaded.findings.len(), 1);
        let orphan = tmp.path().join("orphan.md");
        std::fs::write(&orphan, "# no json").unwrap();
        assert!(load_report(&orphan).is_err());
    }

    #[test]
    fn finding_schema_version_present() {
        let f = sample_finding();
        assert_eq!(f.schema_version, REPORT_SCHEMA_VERSION);
        let json = serde_json::to_string(&f).unwrap();
        assert!(json.contains("schema_version"));
        let legacy = r#"{"id":"CA-x","severity":"low","category":"c","file":"f","title":"t","detail":"d","suggestion":"s","source":"heuristic"}"#;
        let parsed: Finding = serde_json::from_str(legacy).unwrap();
        assert_eq!(parsed.schema_version, REPORT_SCHEMA_VERSION);
    }
}
