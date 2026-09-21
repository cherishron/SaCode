use anyhow::Result;
use std::path::PathBuf;

use sacode_kernel::model::ModelProvider;
use sacode_runtime::code_audit::{
    ensure_audit_provider, fix_prompt_from_report, load_report, run_audit, AuditScanOptions,
};

pub async fn run(sub_args: Vec<String>) -> Result<()> {
    let first = sub_args.first().map(|s| s.as_str()).unwrap_or("help");
    match first {
        "fix" => run_fix(sub_args[1..].to_vec()).await,
        "help" | "--help" | "-h" => {
            print!("{}", help());
            Ok(())
        }
        _ => run_scan(sub_args).await,
    }
}

fn help() -> String {
    [
        "sacode audit — AI code audit & fix loop",
        "",
        "Usage:",
        "  sacode audit [path] [--json] [--no-ai] [--ai]",
        "  sacode audit fix --from <report.json|report.md> [--max N]",
        "",
        "Config: code_audit.ai (bool, default true) controls AI pass;",
        "        CLI --ai / --no-ai override the config value.",
        "Reports: <root>/.sacode/code-audit/<stamp>/report.{json,md}",
        "",
    ]
    .join("\n")
}

/// Parse scan args. Returns `(root, ai_override, json)`.
/// `ai_override` is `Some(false)` for `--no-ai`, `Some(true)` for `--ai`,
/// `None` when neither flag is present (caller falls back to config).
fn parse_scan_args(args: &[String]) -> (PathBuf, Option<bool>, bool) {
    let mut root = PathBuf::from(".");
    let mut ai_override: Option<bool> = None;
    let mut json = false;
    for a in args {
        match a.as_str() {
            "--json" => json = true,
            "--no-ai" => ai_override = Some(false),
            "--ai" => ai_override = Some(true),
            _ if !a.starts_with("--") => root = PathBuf::from(a),
            _ => {}
        }
    }
    (root, ai_override, json)
}

/// Resolve `use_ai`: CLI flags override when present; otherwise config
/// `code_audit.ai` (default true).
fn resolve_use_ai(root: &std::path::Path, ai_override: Option<bool>) -> bool {
    if let Some(v) = ai_override {
        return v;
    }
    crate::cmd::config::effective_config(root)
        .ok()
        .map(|c| {
            crate::cmd::config::current_raw_value(&c, "code_audit.ai")
                .map(|v| v != "false")
                .unwrap_or(true)
        })
        .unwrap_or(true)
}

async fn run_scan(sub_args: Vec<String>) -> Result<()> {
    let (root, ai_override, json) = parse_scan_args(&sub_args);
    let mut opts = AuditScanOptions::default();
    opts.use_ai = resolve_use_ai(&root, ai_override);
    let provider = current_model_provider(&root);
    if opts.use_ai && provider.is_none() {
        eprintln!(
            "warn: 无可用模型 provider，将仅运行启发式扫描（可用 /login 或 sacode account login）"
        );
    }
    let outcome = run_audit(&root, &opts, provider.as_ref()).await?;
    if json {
        println!("{}", serde_json::to_string_pretty(&outcome.report)?);
    } else {
        println!(
            "audit done: high={} medium={} low={} info={} ai={} (heuristic={} ai_found={})",
            outcome.report.summary.high,
            outcome.report.summary.medium,
            outcome.report.summary.low,
            outcome.report.summary.info,
            outcome.report.ai_used,
            outcome.heuristic_count,
            outcome.ai_count
        );
        for f in outcome.report.findings.iter().take(15) {
            println!(
                "  [{}] {} {}:{} {}",
                f.severity.as_str(),
                f.id,
                f.file,
                f.line.unwrap_or(0),
                f.title
            );
        }
        if outcome.report.findings.len() > 15 {
            println!("  ... {} more", outcome.report.findings.len() - 15);
        }
        if let Some(p) = &outcome.report_json_path {
            println!("report: {}", p.display());
            println!("fix:   sacode audit fix --from {}", p.display());
        }
    }
    Ok(())
}

async fn run_fix(sub_args: Vec<String>) -> Result<()> {
    let mut from = None;
    let mut max = 20usize;
    let mut i = 0;
    while i < sub_args.len() {
        match sub_args[i].as_str() {
            "--from" => {
                i += 1;
                from = sub_args.get(i).cloned();
            }
            "--max" => {
                i += 1;
                max = sub_args.get(i).and_then(|s| s.parse().ok()).unwrap_or(20);
            }
            _ => {}
        }
        i += 1;
    }
    let from = from.ok_or_else(|| anyhow::anyhow!("audit fix --from <report.json> required"))?;
    let report = load_report(&PathBuf::from(&from))?;
    let prompt = fix_prompt_from_report(&report, max);
    println!("starting fix task from {from} ...");
    crate::cmd::run_fix_prompt(prompt, max.max(3)).await?;
    Ok(())
}

fn current_model_provider(root: &std::path::Path) -> Option<ModelProvider> {
    use crate::provider_runtime::resolve_provider;
    let mp = resolve_provider(root);
    // Gateway-style model fallback only when base_url is present; do not invent secrets.
    ensure_audit_provider(mp)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_scan_args_defaults() {
        let (root, ai, json) = parse_scan_args(&[]);
        assert_eq!(root, PathBuf::from("."));
        assert_eq!(ai, None);
        assert!(!json);
    }

    #[test]
    fn parse_scan_args_ai_flags() {
        let args: Vec<String> = vec!["--no-ai".into()];
        let (_, ai, _) = parse_scan_args(&args);
        assert_eq!(ai, Some(false));

        let args: Vec<String> = vec!["--ai".into()];
        let (_, ai, _) = parse_scan_args(&args);
        assert_eq!(ai, Some(true));
    }

    #[test]
    fn parse_scan_args_path_and_json() {
        let args: Vec<String> = vec!["src".into(), "--json".into(), "--no-ai".into()];
        let (root, ai, json) = parse_scan_args(&args);
        assert_eq!(root, PathBuf::from("src"));
        assert_eq!(ai, Some(false));
        assert!(json);
    }

    #[test]
    fn resolve_use_ai_cli_overrides_config() {
        // CLI flag wins regardless of config
        assert!(!resolve_use_ai(std::path::Path::new("."), Some(false)));
        assert!(resolve_use_ai(std::path::Path::new("."), Some(true)));
    }

    #[test]
    fn resolve_use_ai_defaults_true_without_config() {
        // With no config file, default is true
        let tmp = tempfile::tempdir().unwrap();
        assert!(resolve_use_ai(tmp.path(), None));
    }

    #[test]
    fn fix_prompt_from_loaded_report_contains_findings_and_reaudit() {
        let tmp = tempfile::tempdir().unwrap();
        let report = sacode_runtime::code_audit::AuditReport::new(
            tmp.path(),
            vec![sacode_runtime::code_audit::Finding::new(
                "CA-001",
                sacode_runtime::code_audit::Severity::High,
                "security",
                "src/x.rs",
                Some(3),
                "t",
                "d",
                "s",
                "heuristic",
            )],
        );
        let path = sacode_runtime::code_audit::save_report(tmp.path(), &report).unwrap();
        let loaded = load_report(&path).unwrap();
        let prompt = fix_prompt_from_report(&loaded, 10);
        assert!(prompt.contains("CA-001"));
        assert!(prompt.contains("sacode audit"));
    }
}
