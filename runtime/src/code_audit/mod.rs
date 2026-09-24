//! AI 代码审计与修复报告（Compose code-audit-loop）。

pub mod report;
pub mod scan;

pub use report::{
    audit_report_path, load_report, parse_findings_json, save_report, AuditReport, Finding,
    Severity, REPORT_SCHEMA_VERSION,
};
pub use scan::{
    count_findings_by_source, heuristic_scan_workspace, is_supported_code_path, merge_findings,
    normalize_ai_findings, run_audit, run_diff_audit, scan_changed_lines, scan_files,
    AuditScanOptions, AuditScanOutcome,
};

/// Default model used for gateway-style fallback when provider.model is empty
/// but a base_url is configured. Do not invent API keys.
pub const GATEWAY_FALLBACK_MODEL: &str = "sensenova-6.8-flash-lite";

/// Apply provider readiness checks + optional gateway model fallback.
/// Returns `None` when neither base_url nor api_key is present, or when model
/// is empty and no base_url exists to fall back on.
pub fn ensure_audit_provider(
    mut mp: sacode_kernel::model::ModelProvider,
) -> Option<sacode_kernel::model::ModelProvider> {
    let no_base = mp.base_url.is_none();
    let empty_key = mp.api_key.as_ref().map(|k| k.is_empty()).unwrap_or(true);
    if no_base && empty_key {
        return None;
    }
    if mp.model.trim().is_empty() {
        // Gateway-style fallback only when base_url is present; do not invent secrets.
        if mp.base_url.is_some() {
            mp.model = GATEWAY_FALLBACK_MODEL.to_string();
        } else {
            return None;
        }
    }
    Some(mp)
}

/// Build fix prompt from report for `sacode audit fix`.
pub fn fix_prompt_from_report(report: &AuditReport, max_findings: usize) -> String {
    let mut findings: Vec<_> = report.findings.iter().collect();
    findings.sort_by_key(|f| f.severity.rank());
    let selected: Vec<_> = findings.into_iter().take(max_findings).collect();
    let mut body = String::new();
    body.push_str("根据以下代码审计报告修复问题。要求：\n");
    body.push_str("1. 按 severity 从高到低处理；每条尽量给出最小修复；\n");
    body.push_str("2. 不要扩大重构范围；保持现有行为与测试；\n");
    body.push_str("3. 修复后说明改了哪些文件；\n");
    body.push_str("4. 修复完成后可再次运行 `sacode audit` 对比前后报告，确认问题是否消除。\n\n");
    body.push_str("## 审计报告\n");
    for f in &selected {
        body.push_str(&format!(
            "- [{severity}] {id} {file}:{line} {title}\n  {detail}\n  建议: {suggestion}\n",
            severity = f.severity.as_str(),
            id = f.id,
            file = f.file,
            line = f.line.unwrap_or(0),
            title = f.title,
            detail = f.detail,
            suggestion = f.suggestion,
        ));
    }
    if report.findings.len() > selected.len() {
        body.push_str(&format!(
            "\n（共 {} 条，已列出前 {} 条）\n",
            report.findings.len(),
            selected.len()
        ));
    }
    body.push_str("\n提示：修复后可再次运行 `sacode audit` 对比报告，检查是否仍有未解决项。\n");
    body
}

/// Mask secrets in display paths.
pub fn mask_secret(s: &str) -> String {
    report::mask_probable_secrets(s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::code_audit::report::{AuditReport, Finding, Severity};

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
    fn fix_prompt_contains_reaudit_hint() {
        let report = AuditReport::new(std::path::Path::new("."), vec![sample_finding()]);
        let p = fix_prompt_from_report(&report, 10);
        assert!(p.contains("CA-001"), "prompt must include findings");
        assert!(p.contains("sacode audit"), "prompt must remind re-audit");
    }

    #[test]
    fn fix_prompt_masks_secrets() {
        let report = AuditReport::new(std::path::Path::new("."), vec![sample_finding()]);
        let p = fix_prompt_from_report(&report, 10);
        assert!(!p.contains("sk-abcdefghijklmnop"));
    }

    #[test]
    fn ensure_audit_provider_none_without_credentials() {
        let mp = sacode_kernel::model::ModelProvider {
            kind: sacode_kernel::model::ProviderKind::Openai,
            base_url: None,
            api_key: None,
            model: String::new(),
            rule: None,
            auth_header: None,
            auth_scheme: None,
        };
        assert!(ensure_audit_provider(mp).is_none());
    }

    #[test]
    fn ensure_audit_provider_gateway_fallback_when_base_url_present() {
        let mut mp = sacode_kernel::model::ModelProvider::openai("");
        mp.base_url = Some("https://gw.example.com".to_string());
        mp.model = String::new();
        let resolved = ensure_audit_provider(mp).expect("should resolve");
        assert_eq!(resolved.model, GATEWAY_FALLBACK_MODEL);
    }

    #[test]
    fn ensure_audit_provider_no_fallback_without_base_url() {
        let mut mp = sacode_kernel::model::ModelProvider::openai("");
        mp.base_url = None;
        mp.api_key = Some("sk-test".to_string());
        mp.model = String::new();
        assert!(ensure_audit_provider(mp).is_none());
    }
}
