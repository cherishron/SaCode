use std::{
    collections::{BTreeSet, HashMap},
    path::{Path, PathBuf},
};

use anyhow::Result;

use super::report::{
    mask_probable_secrets, parse_findings_json, AuditReport, Finding, Severity,
    REPORT_SCHEMA_VERSION,
};
use crate::provider::client::ProviderClient;
use sacode_kernel::model::ModelProvider;

#[derive(Debug, Clone)]
pub struct AuditScanOptions {
    pub use_ai: bool,
    pub max_files: usize,
    pub max_ai_files: usize,
    pub max_findings_per_file: usize,
}

impl Default for AuditScanOptions {
    fn default() -> Self {
        Self {
            use_ai: true,
            max_files: 400,
            max_ai_files: 12,
            max_findings_per_file: 8,
        }
    }
}

#[derive(Debug)]
pub struct AuditScanOutcome {
    pub report: AuditReport,
    pub report_json_path: Option<PathBuf>,
    pub heuristic_count: usize,
    pub ai_count: usize,
}

const SKIP_DIRS: &[&str] = &[
    "target",
    "node_modules",
    ".git",
    ".sacode",
    "dist",
    "build",
    ".codegraph",
];

const CODE_EXTS: &[&str] = &[
    "rs", "ts", "tsx", "js", "jsx", "go", "py", "java", "kt", "swift", "cs", "php", "rb",
];

/// Count findings whose `source` equals the given tag.
pub fn count_findings_by_source(findings: &[Finding], source: &str) -> usize {
    findings.iter().filter(|f| f.source == source).count()
}

/// Merge AI findings into the heuristic list (dedupe by file+title) and
/// return `(merged, heuristic_count, ai_count)`.
pub fn merge_findings(heuristic: Vec<Finding>, ai: Vec<Finding>) -> (Vec<Finding>, usize, usize) {
    let mut findings = heuristic;
    for f in ai {
        if !findings
            .iter()
            .any(|e| e.file == f.file && e.title == f.title)
        {
            findings.push(f);
        }
    }
    let h = count_findings_by_source(&findings, "heuristic");
    let a = count_findings_by_source(&findings, "ai");
    (findings, h, a)
}

/// Normalize parsed AI findings: force `source = "ai"` and assign ids when missing.
pub fn normalize_ai_findings(mut list: Vec<Finding>) -> Vec<Finding> {
    for (i, f) in list.iter_mut().enumerate() {
        if f.schema_version == 0 {
            f.schema_version = REPORT_SCHEMA_VERSION;
        }
        f.source = "ai".to_string();
        if f.id.trim().is_empty() {
            f.id = format!("CA-AI-{}", i + 1);
        }
        f.detail = mask_probable_secrets(&f.detail);
        f.suggestion = mask_probable_secrets(&f.suggestion);
        f.title = mask_probable_secrets(&f.title);
    }
    list
}

pub fn heuristic_scan_workspace(root: &Path, opts: &AuditScanOptions) -> Vec<Finding> {
    let mut files = Vec::new();
    collect_files(root, root, &mut files, opts.max_files);
    let mut out = Vec::new();
    for file in files {
        scan_file_heuristics(root, &file, &mut out, opts.max_findings_per_file, None);
    }
    out
}

pub fn is_supported_code_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| CODE_EXTS.contains(&ext))
}

fn collect_files(root: &Path, dir: &Path, out: &mut Vec<PathBuf>, limit: usize) {
    if out.len() >= limit {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if out.len() >= limit {
            return;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            if SKIP_DIRS.contains(&name.as_str()) || name.starts_with('.') {
                continue;
            }
            collect_files(root, &path, out, limit);
        } else if path.is_file() {
            if is_supported_code_path(&path) {
                out.push(path);
            }
        }
    }
}

fn scan_file_heuristics(
    root: &Path,
    file: &Path,
    out: &mut Vec<Finding>,
    max_per_file: usize,
    allowed_lines: Option<&BTreeSet<u32>>,
) {
    let Ok(content) = std::fs::read_to_string(file) else {
        return;
    };
    let rel = file
        .strip_prefix(root)
        .unwrap_or(file)
        .to_string_lossy()
        .replace('\\', "/");
    scan_content_heuristics(&rel, &content, out, max_per_file, allowed_lines);
}

fn scan_content_heuristics(
    rel: &str,
    content: &str,
    out: &mut Vec<Finding>,
    max_per_file: usize,
    allowed_lines: Option<&BTreeSet<u32>>,
) {
    let mut added = 0;
    for (idx, line) in content.lines().enumerate() {
        if added >= max_per_file {
            break;
        }
        let current_line = (idx + 1) as u32;
        if allowed_lines.is_some_and(|lines| !lines.contains(&current_line)) {
            continue;
        }
        let line_no = Some(current_line);
        let path = rel.to_string();

        // secrets
        if looks_like_secret_line(line) {
            out.push(Finding::new(
                format!("CA-S-{}", out.len() + 1),
                Severity::High,
                "security",
                path.clone(),
                line_no,
                "疑似硬编码密钥/Token",
                mask_line(line),
                "改为环境变量或密钥管理；不要提交明文",
                "heuristic",
            ));
            added += 1;
            continue;
        }

        // SQL concat
        if looks_like_sql_concat(line) {
            out.push(Finding::new(
                format!("CA-Q-{}", out.len() + 1),
                Severity::Medium,
                "security",
                path.clone(),
                line_no,
                "疑似 SQL 字符串拼接",
                "可能存在注入风险",
                "使用参数化查询",
                "heuristic",
            ));
            added += 1;
            continue;
        }

        // dangerous shell string concat
        if looks_like_shell_concat(line) {
            out.push(Finding::new(
                format!("CA-H-{}", out.len() + 1),
                Severity::High,
                "security",
                path.clone(),
                line_no,
                "疑似危险 shell 字符串拼接",
                mask_line(line).trim().to_string(),
                "避免将不可信输入拼进 shell；使用参数数组或白名单",
                "heuristic",
            ));
            added += 1;
            continue;
        }

        // unwrap outside tests
        if !rel.contains("/tests/")
            && !rel.starts_with("tests/")
            && !rel.ends_with("_test.rs")
            && !rel.contains(".test.")
            && line.contains(".unwrap()")
            && (rel.ends_with(".rs") || rel.ends_with(".go"))
        {
            out.push(Finding::new(
                format!("CA-U-{}", out.len() + 1),
                Severity::Low,
                "correctness",
                path.clone(),
                line_no,
                "生产路径使用 unwrap()",
                mask_line(line).trim().to_string(),
                "使用 ? / 映射错误，避免 panic",
                "heuristic",
            ));
            added += 1;
        }
    }
}

fn looks_like_sql_concat(line: &str) -> bool {
    if line.trim_start().starts_with("//") {
        return false;
    }
    let has_sql = line.contains("SELECT")
        || line.contains("INSERT")
        || line.contains("UPDATE")
        || line.contains("DELETE");
    let has_concat = line.contains("+ \"") || line.contains("+ '") || line.contains("format!(");
    has_sql && has_concat
}

fn looks_like_shell_concat(line: &str) -> bool {
    if line.trim_start().starts_with("//") || line.trim_start().starts_with('*') {
        return false;
    }
    let lower = line.to_ascii_lowercase();
    let has_shell = lower.contains("sh -c")
        || lower.contains("bash -c")
        || lower.contains("cmd /c")
        || lower.contains("cmd.exe")
        || lower.contains("powershell")
        || lower.contains("os.system")
        || lower.contains("child_process")
        || lower.contains("runtime.getruntime");
    let has_concat = line.contains("+ \"")
        || line.contains("+ '")
        || line.contains("format!(")
        || line.contains("${")
        || lower.contains("+ user")
        || lower.contains("+ input");
    has_shell && has_concat
}

fn looks_like_secret_line(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    if lower.contains("password") && (line.contains('"') || line.contains('\'')) {
        if lower.contains("password_hash") || lower.contains("placeholder") {
            return false;
        }
        if line.contains(": \"") || line.contains("= \"") || line.contains("'") {
            return true;
        }
    }
    for token in [
        "sk-",
        "ghp_",
        "github_pat_",
        "AKIA",
        "xoxb-",
        "sa-ee7",
        "sa-real-",
        "BEGIN RSA PRIVATE KEY",
        "BEGIN OPENSSH PRIVATE KEY",
    ] {
        if line.contains(token) && !line.contains("****") && !line.trim_start().starts_with("//") {
            // avoid docs samples that are clearly masked
            return true;
        }
    }
    false
}

fn mask_line(line: &str) -> String {
    mask_probable_secrets(line.trim())
}

pub fn scan_files(root: &Path, files: &[PathBuf], max_per_file: usize) -> Vec<Finding> {
    let mut out = Vec::new();
    for f in files {
        scan_file_heuristics(root, f, &mut out, max_per_file, None);
    }
    out
}

pub fn scan_changed_lines(
    contents: &HashMap<String, String>,
    changed_lines: &HashMap<String, BTreeSet<u32>>,
    max_per_file: usize,
) -> Vec<Finding> {
    let mut out = Vec::new();
    for (relative, lines) in changed_lines {
        if lines.is_empty() {
            continue;
        }
        if let Some(content) = contents.get(relative) {
            scan_content_heuristics(relative, content, &mut out, max_per_file, Some(lines));
        }
    }
    out
}

/// Full audit: heuristics + optional AI pass via current ModelProvider.
/// AI failure never fails the audit; heuristic results still write the report.
pub async fn run_diff_audit(
    root: &Path,
    opts: &AuditScanOptions,
    provider: Option<&ModelProvider>,
    contents: &HashMap<String, String>,
    changed_lines: &HashMap<String, BTreeSet<u32>>,
    scan_kind: &str,
    target: String,
) -> Result<AuditScanOutcome> {
    let mut findings = scan_changed_lines(contents, changed_lines, opts.max_findings_per_file);
    let mut ai_used = false;
    let mut provider_label = None;

    if opts.use_ai {
        if let Some(mp) = provider {
            provider_label = Some(format!("{:?}", mp.kind));
            match ai_diff_audit_pass(mp, contents, changed_lines, &findings).await {
                Ok(ai_findings) => {
                    ai_used = true;
                    if !ai_findings.is_empty() {
                        let (merged, _, _) =
                            merge_findings(std::mem::take(&mut findings), ai_findings);
                        findings = merged;
                    }
                }
                Err(e) => tracing::warn!("AI diff audit pass failed: {e}"),
            }
        }
    }

    let heuristic_count = count_findings_by_source(&findings, "heuristic");
    let ai_count = count_findings_by_source(&findings, "ai");
    let mut report = AuditReport::new(root, findings);
    report.ai_used = ai_used;
    report.provider = provider_label;
    report.scan_kind = scan_kind.to_string();
    report.scan_target = Some(target);
    report.files_scanned = changed_lines.len();
    report.changed_lines = changed_lines.values().map(BTreeSet::len).sum();
    let path = super::report::save_report(root, &report)?;
    Ok(AuditScanOutcome {
        report,
        report_json_path: Some(path),
        heuristic_count,
        ai_count,
    })
}

/// Full audit: heuristics + optional AI pass via current ModelProvider.
/// AI failure never fails the audit; heuristic results still write the report.
pub async fn run_audit(
    root: &Path,
    opts: &AuditScanOptions,
    provider: Option<&ModelProvider>,
) -> Result<AuditScanOutcome> {
    let heuristic = heuristic_scan_workspace(root, opts);
    let mut findings = heuristic;
    let mut ai_used = false;
    let mut provider_label = None;

    if opts.use_ai {
        if let Some(mp) = provider {
            provider_label = Some(format!("{:?}", mp.kind));
            match ai_audit_pass(root, mp, opts, &findings).await {
                Ok(ai_findings) => {
                    // AI pass ran successfully — even zero findings counts as AI used.
                    ai_used = true;
                    if !ai_findings.is_empty() {
                        let (merged, _, _) =
                            merge_findings(std::mem::take(&mut findings), ai_findings);
                        findings = merged;
                    }
                }
                Err(e) => {
                    tracing::warn!("AI audit pass failed: {e}");
                }
            }
        }
    }

    let heuristic_count = count_findings_by_source(&findings, "heuristic");
    let ai_count = count_findings_by_source(&findings, "ai");
    let mut report = AuditReport::new(root, findings);
    report.ai_used = ai_used;
    report.provider = provider_label;
    let path = super::report::save_report(root, &report)?;
    Ok(AuditScanOutcome {
        report,
        report_json_path: Some(path),
        heuristic_count,
        ai_count,
    })
}

async fn ai_diff_audit_pass(
    provider: &ModelProvider,
    contents: &HashMap<String, String>,
    changed_lines: &HashMap<String, BTreeSet<u32>>,
    heuristics: &[Finding],
) -> Result<Vec<Finding>> {
    let client = ProviderClient::new();
    let mut excerpts = String::new();
    for (path, lines) in changed_lines.iter().take(20) {
        let Some(content) = contents.get(path) else {
            continue;
        };
        let all_lines: Vec<&str> = content.lines().collect();
        let mut visible_lines = BTreeSet::new();
        for line in lines.iter().take(200) {
            let start = line.saturating_sub(3).max(1);
            let end = line.saturating_add(3).min(all_lines.len() as u32);
            visible_lines.extend(start..=end);
        }
        let rendered = visible_lines
            .into_iter()
            .filter_map(|line| {
                all_lines
                    .get((line as usize).saturating_sub(1))
                    .map(|text| {
                        let marker = if lines.contains(&line) { '+' } else { ' ' };
                        format!("{marker}{line}: {}", mask_probable_secrets(text))
                    })
            })
            .collect::<Vec<_>>();
        if !rendered.is_empty() {
            excerpts.push_str(&format!("### FILE {path}\n{}\n\n", rendered.join("\n")));
        }
    }
    if excerpts.is_empty() {
        return Ok(vec![]);
    }
    let heuristic_summary = heuristics
        .iter()
        .take(20)
        .map(|f| {
            format!(
                "{}:{} {}",
                mask_probable_secrets(&f.file),
                f.line.unwrap_or(0),
                mask_probable_secrets(&f.title)
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let prompt = format!(
        r#"你是本地代码差分审查助手。只审查下面列出的新增行，不要报告未列出的旧代码。请只输出 JSON 数组（不要 markdown），每个元素:
{{"id":"CA-AI-n","severity":"high|medium|low|info","category":"security|correctness|maintainability","file":"path","line":1,"title":"...","detail":"...","suggestion":"...","source":"ai"}}
重点找：本次改动引入的安全漏洞、明显逻辑缺陷、危险默认值。不要输出风格偏好。密钥类详情请打码。

已有启发式命中：
{}

本次新增行：
{}
"#,
        heuristic_summary, excerpts
    );
    let text = client.simple_chat(provider, &prompt).await?;
    let parsed = normalize_ai_findings(parse_findings_json(&extract_json_payload(&text)));
    Ok(parsed
        .into_iter()
        .filter(|f| {
            f.line.is_some_and(|line| {
                changed_lines
                    .get(&f.file.replace('\\', "/"))
                    .is_some_and(|lines| lines.contains(&line))
            })
        })
        .collect())
}

async fn ai_audit_pass(
    root: &Path,
    provider: &ModelProvider,
    opts: &AuditScanOptions,
    heuristics: &[Finding],
) -> Result<Vec<Finding>> {
    let client = ProviderClient::new();
    // sample files: prefer ones with heuristic hits, then first code files
    let mut samples: Vec<PathBuf> = heuristics.iter().map(|f| root.join(&f.file)).collect();
    let mut extra = Vec::new();
    collect_files(root, root, &mut extra, opts.max_ai_files);
    for e in extra {
        if !samples.contains(&e) {
            samples.push(e);
        }
    }
    samples.truncate(opts.max_ai_files);
    let mut excerpts = String::new();
    for f in &samples {
        if let Ok(content) = std::fs::read_to_string(f) {
            let rel = f.strip_prefix(root).unwrap_or(f).display().to_string();
            // Mask secrets before including in AI prompt
            let masked_content =
                mask_probable_secrets(&content.chars().take(4000).collect::<String>());
            excerpts.push_str(&format!("### FILE {}\n{}\n\n", rel, masked_content));
        }
    }
    if excerpts.is_empty() {
        return Ok(vec![]);
    }
    // Mask heuristic summary lines too (titles are usually clean, but be safe)
    let heuristic_summary = heuristics
        .iter()
        .take(20)
        .map(|f| {
            format!(
                "{}:{} {}",
                mask_probable_secrets(&f.file),
                f.line.unwrap_or(0),
                mask_probable_secrets(&f.title)
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let prompt = format!(
        r#"你是代码审计助手。请只输出 JSON 数组（不要 markdown），每个元素:
{{"id":"CA-AI-n","severity":"high|medium|low|info","category":"security|correctness|maintainability","file":"path","line":1,"title":"...","detail":"...","suggestion":"...","source":"ai"}}
重点找：安全漏洞、明显逻辑缺陷、危险默认值。不要输出与代码无关内容。密钥类详情请打码。

已有启发式命中：
{}

代码摘录：
{}
"#,
        heuristic_summary, excerpts
    );
    let text = client.simple_chat(provider, &prompt).await?;
    // extract first JSON array or object with findings
    let json = extract_json_payload(&text);
    let parsed = parse_findings_json(&json);
    Ok(normalize_ai_findings(parsed))
}

/// Extract a JSON payload (array or object) from model output that may be
/// wrapped in markdown fences or surrounding prose.
fn extract_json_payload(text: &str) -> String {
    // Prefer object with findings key
    if let Some(start) = text.find('{') {
        if let Some(end) = text.rfind('}') {
            if end > start {
                let candidate = &text[start..=end];
                if candidate.contains("findings") {
                    return candidate.to_string();
                }
            }
        }
    }
    // Fall back to first JSON array
    if let Some(start) = text.find('[') {
        if let Some(end) = text.rfind(']') {
            if end > start {
                return text[start..=end].to_string();
            }
        }
    }
    text.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diff_scan_only_reports_allowed_added_lines() {
        let contents = HashMap::from([(
            "src/a.rs".to_string(),
            "fn old() { old.unwrap(); }\nfn new() { new.unwrap(); }\n".to_string(),
        )]);
        let changed = HashMap::from([("src/a.rs".to_string(), BTreeSet::from([2]))]);
        let findings = scan_changed_lines(&contents, &changed, 50);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].line, Some(2));
    }

    #[test]
    fn heuristic_finds_hardcoded_secret() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("src");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(
            src.join("bad.rs"),
            "let api_key = \"sk-abcdef1234567890\";\nfn main() { foo.unwrap(); }\n",
        )
        .unwrap();
        let findings = heuristic_scan_workspace(tmp.path(), &AuditScanOptions::default());
        assert!(findings.iter().any(|f| f.severity == Severity::High));
        assert!(findings.iter().any(|f| f.title.contains("unwrap")));
        assert!(!findings
            .iter()
            .any(|f| f.detail.contains("sk-abcdef1234567890")));
    }

    #[test]
    fn extract_json_from_markdown_fence() {
        let t = "```json\n[{\"id\":\"CA-1\"}]\n```";
        let arr = extract_json_payload(t);
        assert!(arr.starts_with('['));
        assert!(arr.ends_with(']'));
    }

    #[test]
    fn extract_json_payload_prefers_findings_object() {
        let t = "```json\n{\"findings\":[{\"id\":\"CA-1\",\"severity\":\"low\",\"category\":\"security\",\"file\":\"a.rs\",\"line\":1,\"title\":\"t\",\"detail\":\"d\",\"suggestion\":\"s\",\"source\":\"ai\"}]}\n```";
        let payload = extract_json_payload(t);
        assert!(payload.contains("findings"));
        let parsed = parse_findings_json(&payload);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].id, "CA-1");
    }

    #[test]
    fn parse_findings_object_wrapper() {
        let json = r#"{"findings":[{"id":"CA-2","severity":"high","category":"security","file":"b.rs","line":1,"title":"t","detail":"d","suggestion":"s","source":"ai"}]}"#;
        let list = parse_findings_json(json);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "CA-2");
    }

    #[test]
    fn normalize_ai_findings_forces_source_and_masks() {
        let raw = vec![Finding::new(
            "",
            Severity::Medium,
            "security",
            "a.rs",
            Some(1),
            "token sk-abcdefghijklmnop leaked",
            "uses ghp_secretabcdefghijklmnop",
            "rotate AKIAabcdefghijklmnop",
            "",
        )];
        let out = normalize_ai_findings(raw);
        assert_eq!(out[0].source, "ai");
        assert_eq!(out[0].id, "CA-AI-1");
        assert!(!out[0].detail.contains("ghp_secretabcdefghijklmnop"));
        assert!(!out[0].title.contains("sk-abcdefghijklmnop"));
        assert!(!out[0].suggestion.contains("AKIAabcdefghijklmnop"));
    }

    #[test]
    fn heuristic_detects_shell_concat() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("src");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(
            src.join("sh.rs"),
            "let cmd = format!(\"sh -c {}\", user_input);\n",
        )
        .unwrap();
        let findings = heuristic_scan_workspace(tmp.path(), &AuditScanOptions::default());
        assert!(findings
            .iter()
            .any(|f| f.title.contains("shell") && f.severity == Severity::High));
        assert!(findings.iter().all(|f| f.schema_version >= 1));
    }

    #[test]
    fn merge_findings_counts_ai_and_heuristic() {
        let h = vec![Finding::new(
            "CA-H-1",
            Severity::High,
            "security",
            "x.rs",
            Some(1),
            "h1",
            "d",
            "s",
            "heuristic",
        )];
        let ai = vec![
            Finding::new(
                "CA-AI-1",
                Severity::Medium,
                "security",
                "y.rs",
                Some(2),
                "ai1",
                "d",
                "s",
                "ai",
            ),
            // duplicate of heuristic by file+title → should be dropped
            Finding::new(
                "CA-AI-2",
                Severity::Low,
                "correctness",
                "x.rs",
                Some(1),
                "h1",
                "d",
                "s",
                "ai",
            ),
        ];
        let (merged, h_count, a_count) = merge_findings(h, ai);
        assert_eq!(merged.len(), 2);
        assert_eq!(h_count, 1);
        assert_eq!(a_count, 1);
    }

    #[test]
    fn run_audit_without_provider_writes_heuristic_report() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("src");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(
            src.join("bad.rs"),
            "let api_key = \"sk-abcdef1234567890\";\nfn main() { foo.unwrap(); }\n",
        )
        .unwrap();
        let opts = AuditScanOptions {
            use_ai: true,
            ..Default::default()
        };
        // provider = None → AI skipped, heuristic still runs and report is saved
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let outcome = rt
            .block_on(run_audit(tmp.path(), &opts, None))
            .expect("audit should succeed without provider");
        assert!(outcome.report_json_path.is_some());
        assert!(outcome.heuristic_count >= 1);
        assert_eq!(outcome.ai_count, 0);
        assert!(!outcome.report.ai_used);
        let path = outcome.report_json_path.unwrap();
        assert!(path.exists());
        let loaded = super::super::report::load_report(&path).unwrap();
        assert!(!loaded.findings.is_empty());
        assert!(!loaded
            .findings
            .iter()
            .any(|f| f.detail.contains("sk-abcdef1234567890")));
    }
}
