use anyhow::Result;
use std::path::PathBuf;

use sacode_kernel::model::ModelProvider;
use sacode_runtime::code_audit::{
    ensure_audit_provider, fix_prompt_from_report, load_report, run_audit, run_diff_audit,
    AuditScanOptions, AuditScanOutcome,
};

use super::{
    audit_diff::{collect_audit_diff, DiffScope},
    audit_pr::{
        current_branch, discover_github_repo, repo_root, GitHubPrClient, PublishedReview,
        PullRequestInfo,
    },
};

pub async fn run(sub_args: Vec<String>) -> Result<()> {
    let first = sub_args.first().map(|s| s.as_str()).unwrap_or("help");
    match first {
        "fix" => run_fix(sub_args[1..].to_vec()).await,
        "diff" => run_diff(sub_args[1..].to_vec()).await,
        "pr" => run_pr(sub_args[1..].to_vec()).await,
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
        "  sacode audit diff [--staged | --base <ref>] [--json] [--no-ai] [--ai]",
        "  sacode audit pr [number] [--repo owner/name] [--publish] [--json] [--no-ai] [--ai]",
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

#[derive(Debug, Clone, PartialEq, Eq)]
struct DiffArgs {
    scope: DiffScope,
    ai_override: Option<bool>,
    json: bool,
}

fn parse_diff_args(args: &[String]) -> Result<DiffArgs> {
    let mut scope = DiffScope::Worktree;
    let mut scope_set = false;
    let mut ai_override = None;
    let mut json = false;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--staged" | "--cached" => {
                if scope_set {
                    anyhow::bail!("--staged/--cached 与 --base 不能同时使用");
                }
                scope = DiffScope::Staged;
                scope_set = true;
            }
            "--base" => {
                if scope_set {
                    anyhow::bail!("--base 与 --staged/--cached 不能同时使用");
                }
                i += 1;
                let reference = args
                    .get(i)
                    .filter(|value| !value.starts_with('-'))
                    .cloned()
                    .ok_or_else(|| anyhow::anyhow!("--base <ref> required"))?;
                scope = DiffScope::Base(reference);
                scope_set = true;
            }
            "--json" => json = true,
            "--no-ai" => ai_override = Some(false),
            "--ai" => ai_override = Some(true),
            other => anyhow::bail!("未知 audit diff 参数: {other}"),
        }
        i += 1;
    }
    Ok(DiffArgs {
        scope,
        ai_override,
        json,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PrArgs {
    number: Option<u64>,
    repo: Option<String>,
    publish: bool,
    ai_override: Option<bool>,
    json: bool,
}

fn parse_pr_args(args: &[String]) -> Result<PrArgs> {
    let mut parsed = PrArgs {
        number: None,
        repo: None,
        publish: false,
        ai_override: None,
        json: false,
    };
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--repo" => {
                i += 1;
                parsed.repo = Some(
                    args.get(i)
                        .filter(|value| !value.starts_with('-'))
                        .cloned()
                        .ok_or_else(|| anyhow::anyhow!("--repo owner/name required"))?,
                );
            }
            "--publish" => parsed.publish = true,
            "--json" => parsed.json = true,
            "--no-ai" => parsed.ai_override = Some(false),
            "--ai" => parsed.ai_override = Some(true),
            value if !value.starts_with('-') && parsed.number.is_none() => {
                let number = value
                    .parse::<u64>()
                    .map_err(|_| anyhow::anyhow!("PR 编号必须是正整数: {value}"))?;
                if number == 0 {
                    anyhow::bail!("PR 编号必须大于 0");
                }
                parsed.number = Some(number);
            }
            other => anyhow::bail!("未知 audit pr 参数: {other}"),
        }
        i += 1;
    }
    Ok(parsed)
}

async fn run_pr(sub_args: Vec<String>) -> Result<()> {
    let args = parse_pr_args(&sub_args)?;
    let root = repo_root(std::path::Path::new("."))?;
    let repo = discover_github_repo(&root, args.repo.as_deref())?;
    let token =
        sacode_runtime::git_auth::token_for_host(sacode_runtime::git_auth::AuthHost::Github, None)?
            .filter(|token| !token.trim().is_empty())
            .ok_or_else(|| {
                anyhow::anyhow!(
            "未找到 GitHub 凭据；请运行 `sacode git auth login github`，或通过 set-token 配置 PAT"
        )
            })?;
    let github = GitHubPrClient::new(token)?;
    let branch = current_branch(&root)?;
    let pr = github.resolve_pr(&repo, args.number, &branch).await?;
    let opts = AuditScanOptions::default();
    let input = github.fetch_diff(&repo, pr, opts.max_files).await?;
    let mut opts = opts;
    opts.use_ai = resolve_use_ai(&root, args.ai_override);
    let provider = current_model_provider(&root);
    if opts.use_ai && provider.is_none() {
        eprintln!(
            "warn: 无可用模型 provider，将仅运行启发式 PR 扫描（可用 /login 或 sacode account login）"
        );
    }
    let target = format!("github:{}/pull/{}", repo.slug(), input.pr.number);
    let outcome = run_diff_audit(
        &root,
        &opts,
        provider.as_ref(),
        &input.contents,
        &input.changed_lines,
        "pr",
        target,
    )
    .await?;
    let published = if args.publish {
        if input.pr.state != "open" {
            anyhow::bail!("PR #{} 不是 open 状态，拒绝发布 review", input.pr.number);
        }
        Some(
            github
                .publish_review(&repo, &input.pr, &outcome.report, &input.changed_lines)
                .await?,
        )
    } else {
        None
    };
    print_pr_outcome(
        &outcome,
        &input.pr,
        input.skipped_files,
        published.as_ref(),
        args.json,
    )?;
    Ok(())
}

fn print_pr_outcome(
    outcome: &AuditScanOutcome,
    pr: &PullRequestInfo,
    skipped_files: usize,
    published: Option<&PublishedReview>,
    json: bool,
) -> Result<()> {
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&serde_json::json!({
                "pr": pr,
                "report": outcome.report,
                "report_json_path": outcome.report_json_path,
                "skipped_files": skipped_files,
                "published_review": published,
            }))?
        );
        return Ok(());
    }
    println!("audit pr #{}: {} ({})", pr.number, pr.title, pr.html_url);
    if skipped_files > 0 {
        println!(
            "skipped files: {skipped_files} (unsupported, removed, binary, or patch unavailable)"
        );
    }
    print_outcome(outcome, false, "audit pr")?;
    if let Some(review) = published {
        println!(
            "published review: id={} new_inline_comments={}{}",
            review.review_id,
            review.comments,
            review
                .html_url
                .as_ref()
                .map(|url| format!(" url={url}"))
                .unwrap_or_default()
        );
        match review.posted_review {
            Some(id) => println!("  created review id={id}"),
            None => println!(
                "  summary review id={} already posted, not duplicated",
                review.existing_review_id.unwrap_or(review.review_id)
            ),
        }
        if review.skipped_existing_comments > 0 {
            println!(
                "  {} inline comment(s) already present, not reposted",
                review.skipped_existing_comments
            );
        }
    } else {
        println!("publish: not requested (use --publish to create a GitHub review)");
    }
    Ok(())
}

async fn run_diff(sub_args: Vec<String>) -> Result<()> {
    let args = parse_diff_args(&sub_args)?;
    let opts = AuditScanOptions::default();
    let input = collect_audit_diff(std::path::Path::new("."), args.scope, opts.max_files)?;
    let mut opts = opts;
    opts.use_ai = resolve_use_ai(&input.root, args.ai_override);
    let provider = current_model_provider(&input.root);
    if opts.use_ai && provider.is_none() {
        eprintln!(
            "warn: 无可用模型 provider，将仅运行启发式差分扫描（可用 /login 或 sacode account login）"
        );
    }
    let outcome = run_diff_audit(
        &input.root,
        &opts,
        provider.as_ref(),
        &input.contents,
        &input.changed_lines,
        "diff",
        input.scope.label(),
    )
    .await?;
    print_outcome(&outcome, args.json, "audit diff")?;
    Ok(())
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
    print_outcome(&outcome, json, "audit")?;
    Ok(())
}

fn print_outcome(outcome: &AuditScanOutcome, json: bool, label: &str) -> Result<()> {
    if json {
        println!("{}", serde_json::to_string_pretty(&outcome.report)?);
        return Ok(());
    }
    println!(
        "{label} done: high={} medium={} low={} info={} ai={} (heuristic={} ai_found={})",
        outcome.report.summary.high,
        outcome.report.summary.medium,
        outcome.report.summary.low,
        outcome.report.summary.info,
        outcome.report.ai_used,
        outcome.heuristic_count,
        outcome.ai_count
    );
    if outcome.report.scan_kind == "diff" || outcome.report.scan_kind == "pr" {
        println!(
            "scope: {} files={} added_lines={}",
            outcome.report.scan_target.as_deref().unwrap_or("diff"),
            outcome.report.files_scanned,
            outcome.report.changed_lines
        );
    }
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
    fn parse_pr_args_defaults_to_local_current_branch_review() {
        let args = parse_pr_args(&[]).unwrap();
        assert_eq!(args.number, None);
        assert!(!args.publish);
        assert!(!args.json);
    }

    #[test]
    fn parse_pr_args_accepts_number_repo_and_publish() {
        let args = parse_pr_args(&[
            "42".into(),
            "--repo".into(),
            "owner/repo".into(),
            "--publish".into(),
            "--no-ai".into(),
        ])
        .unwrap();
        assert_eq!(args.number, Some(42));
        assert_eq!(args.repo.as_deref(), Some("owner/repo"));
        assert!(args.publish);
        assert_eq!(args.ai_override, Some(false));
    }

    #[test]
    fn parse_pr_args_rejects_duplicate_or_invalid_number() {
        assert!(parse_pr_args(&["0".into()]).is_err());
        assert!(parse_pr_args(&["1".into(), "2".into()]).is_err());
    }

    #[test]
    fn parse_diff_args_supports_each_scope() {
        let args = parse_diff_args(&[]).unwrap();
        assert_eq!(args.scope, DiffScope::Worktree);

        let args = parse_diff_args(&["--staged".into(), "--no-ai".into()]).unwrap();
        assert_eq!(args.scope, DiffScope::Staged);
        assert_eq!(args.ai_override, Some(false));

        let args = parse_diff_args(&["--base".into(), "main".into(), "--json".into()]).unwrap();
        assert_eq!(args.scope, DiffScope::Base("main".into()));
        assert!(args.json);
    }

    #[test]
    fn parse_diff_args_rejects_conflicting_scopes() {
        let error =
            parse_diff_args(&["--staged".into(), "--base".into(), "main".into()]).unwrap_err();
        assert!(error.to_string().contains("不能同时使用"));
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
    fn audit_secret_masking_handles_bare_prefix() {
        let value =
            sacode_runtime::code_audit::mask_secret("document sk- then sk-real-secret-token");
        assert!(value.starts_with("document sk- then "));
        assert!(!value.contains("sk-real-secret-token"));
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
