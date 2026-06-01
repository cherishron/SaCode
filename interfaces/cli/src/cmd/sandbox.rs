use std::path::{Path, PathBuf};

use anyhow::Result;
use serde::Serialize;
use sacode_kernel::ExecutionMode;
use sacode_runtime::{SandboxConfig, SandboxConfigStore, SandboxModeConfig, SandboxPolicy};

pub fn run(args: Vec<String>) -> Result<()> {
    let workdir = PathBuf::from(".");
    let output = render_sandbox(&workdir, &args)?;
    println!("{}", output);
    Ok(())
}

pub fn render_sandbox(workdir: &Path, args: &[String]) -> Result<String> {
    match args.first().map(|value| value.as_str()) {
        None => render_show(workdir, &[]),
        Some("show") | Some("status") => render_show(workdir, &args[1..]),
        Some("diff") => render_diff(workdir, &args[1..]),
        Some("doctor") => render_doctor(workdir, &args[1..]),
        Some("init") => render_init(workdir),
        Some("path") => Ok(SandboxConfigStore::new(workdir).path().display().to_string()),
        Some("set") => render_set(workdir, &args[1..]),
        Some("clear") => render_clear(workdir, &args[1..]),
        _ => Ok("用法: sacode sandbox [show [plan|build|yolo] [--json]|diff [plan|build|yolo] [--json]|doctor [plan|build|yolo] [--json]|init|path|set <mode> <key> <value>|clear <mode> <key>]".to_string()),
    }
}

fn render_show(workdir: &Path, args: &[String]) -> Result<String> {
    let store = SandboxConfigStore::new(workdir);
    let json = args.iter().any(|arg| arg == "--json");
    let mode = args.iter().find_map(|arg| parse_mode(arg));
    let modes = match mode {
        Some(mode) => vec![mode],
        None => vec![ExecutionMode::Plan, ExecutionMode::Build, ExecutionMode::Yolo],
    };

    if json {
        return render_show_json(&store, &modes);
    }

    let mut lines = vec!["Sandbox Policies".to_string()];
    for mode in modes {
        let policy = store.policy_for_mode(mode)?;
        lines.push(String::new());
        lines.push(format!("[{}]", mode));
        lines.push(format!("network_allowed: {}", policy.network_allowed));
        lines.push(format!("timeout_ms: {:?}", policy.timeout_ms));
        lines.push(format!("max_memory_mb: {:?}", policy.max_memory_mb));
        lines.push(format!("allowed_commands: {:?}", policy.allowed_commands));
        lines.push(format!("allowed_paths: {:?}", display_paths(&policy.allowed_paths)));
        lines.push(format!("denied_paths: {:?}", display_paths(&policy.denied_paths)));
    }
    Ok(lines.join("\n"))
}

fn render_show_json(store: &SandboxConfigStore, modes: &[ExecutionMode]) -> Result<String> {
    let policies = modes
        .iter()
        .map(|mode| {
            Ok(ModePolicyView {
                mode: mode.to_string(),
                policy: PolicyView::from_policy(store.policy_for_mode(*mode)?),
            })
        })
        .collect::<Result<Vec<_>>>()?;

    Ok(serde_json::to_string_pretty(&SandboxShowResponse { policies })?)
}

fn render_diff(workdir: &Path, args: &[String]) -> Result<String> {
    let store = SandboxConfigStore::new(workdir);
    let config = store.load()?;
    let json = args.iter().any(|arg| arg == "--json");
    let mode = args.iter().find_map(|arg| parse_mode(arg));
    let modes = match mode {
        Some(mode) => vec![mode],
        None => vec![ExecutionMode::Plan, ExecutionMode::Build, ExecutionMode::Yolo],
    };

    let diffs = modes
        .iter()
        .map(|mode| diff_mode_view(&config, *mode))
        .collect::<Vec<_>>();

    if json {
        return Ok(serde_json::to_string_pretty(&SandboxDiffResponse { diffs })?);
    }

    let mut lines = vec!["Sandbox Policy Diff".to_string()];
    for diff in diffs {
        let mode = diff.mode.as_str();

        lines.push(String::new());
        lines.push(format!("[{}]", mode));
        if !diff.changed {
            lines.push("无项目级覆盖".to_string());
            continue;
        }

        for field in diff.fields {
            lines.push(format!("{}: {} -> {}", field.key, field.default_value, field.effective_value));
        }
    }

    Ok(lines.join("\n"))
}

fn render_doctor(workdir: &Path, args: &[String]) -> Result<String> {
    let store = SandboxConfigStore::new(workdir);
    let config = store.load()?;
    let json = args.iter().any(|arg| arg == "--json");
    let mode = args.iter().find_map(|arg| parse_mode(arg));
    let modes = match mode {
        Some(mode) => vec![mode],
        None => vec![ExecutionMode::Plan, ExecutionMode::Build, ExecutionMode::Yolo],
    };

    let mut findings = Vec::new();
    for mode in modes {
        findings.extend(doctor_findings_for_mode(&config, mode));
    }

    if json {
        return Ok(serde_json::to_string_pretty(&SandboxDoctorResponse { findings })?);
    }

    let mut lines = vec!["Sandbox Doctor".to_string()];
    if findings.is_empty() {
        lines.push(String::new());
        lines.push("未发现高优先级配置问题".to_string());
        return Ok(lines.join("\n"));
    }

    for finding in findings {
        lines.push(String::new());
        lines.push(format!("[{}] {}", finding.mode, finding.title));
        lines.push(format!("说明: {}", finding.message));
        lines.push(format!("建议: {}", finding.suggestion));
    }

    Ok(lines.join("\n"))
}

fn render_init(workdir: &Path) -> Result<String> {
    let store = SandboxConfigStore::new(workdir);
    let path = store.path().to_path_buf();

    if path.exists() {
        return Ok(format!("沙箱配置已存在: {}", path.display()));
    }

    let config = SandboxConfig {
        plan: SandboxModeConfig {
            network_allowed: Some(false),
            max_memory_mb: Some(256),
            timeout_ms: Some(15_000),
            ..SandboxModeConfig::default()
        },
        build: SandboxModeConfig {
            network_allowed: Some(true),
            max_memory_mb: Some(512),
            timeout_ms: Some(30_000),
            ..SandboxModeConfig::default()
        },
        yolo: SandboxModeConfig {
            network_allowed: Some(true),
            max_memory_mb: Some(1024),
            timeout_ms: Some(60_000),
            ..SandboxModeConfig::default()
        },
    };
    store.save(&config)?;

    Ok(format!("已生成沙箱配置: {}", path.display()))
}

fn render_set(workdir: &Path, args: &[String]) -> Result<String> {
    if args.len() < 3 {
        return Ok("用法: sacode sandbox set <mode> <key> <value>".to_string());
    }

    let Some(mode) = parse_mode(&args[0]) else {
        return Ok("mode 仅支持: plan, build, yolo".to_string());
    };
    let key = args[1].as_str();
    let value = args[2..].join(" ");

    let store = SandboxConfigStore::new(workdir);
    let mut config = store.load()?;
    let mode_config = mode_config_mut(&mut config, mode);
    apply_set(mode_config, key, &value)?;
    store.save(&config)?;

    Ok(format!("已设置 sandbox.{}.{} = {}", mode, key, value))
}

fn render_clear(workdir: &Path, args: &[String]) -> Result<String> {
    if args.len() < 2 {
        return Ok("用法: sacode sandbox clear <mode> <key>".to_string());
    }

    let Some(mode) = parse_mode(&args[0]) else {
        return Ok("mode 仅支持: plan, build, yolo".to_string());
    };
    let key = args[1].as_str();

    let store = SandboxConfigStore::new(workdir);
    let mut config = store.load()?;
    let mode_config = mode_config_mut(&mut config, mode);
    apply_clear(mode_config, key)?;
    store.save(&config)?;

    Ok(format!("已清除 sandbox.{}.{}", mode, key))
}

fn parse_mode(value: &str) -> Option<ExecutionMode> {
    match value {
        "plan" => Some(ExecutionMode::Plan),
        "build" => Some(ExecutionMode::Build),
        "yolo" => Some(ExecutionMode::Yolo),
        _ => None,
    }
}

fn mode_config_mut(config: &mut SandboxConfig, mode: ExecutionMode) -> &mut SandboxModeConfig {
    match mode {
        ExecutionMode::Plan => &mut config.plan,
        ExecutionMode::Build => &mut config.build,
        ExecutionMode::Yolo => &mut config.yolo,
    }
}

fn apply_set(config: &mut SandboxModeConfig, key: &str, value: &str) -> Result<()> {
    match key {
        "network_allowed" => config.network_allowed = Some(parse_bool(value)?),
        "timeout_ms" => config.timeout_ms = Some(parse_u64(value)?),
        "max_memory_mb" => config.max_memory_mb = Some(parse_usize(value)?),
        "allowed_commands" => config.allowed_commands = parse_list(value),
        "allowed_paths" => config.allowed_paths = parse_list(value),
        "denied_paths" => config.denied_paths = parse_list(value),
        _ => anyhow::bail!("支持的 key: network_allowed, timeout_ms, max_memory_mb, allowed_commands, allowed_paths, denied_paths"),
    }
    Ok(())
}

fn apply_clear(config: &mut SandboxModeConfig, key: &str) -> Result<()> {
    match key {
        "network_allowed" => config.network_allowed = None,
        "timeout_ms" => config.timeout_ms = None,
        "max_memory_mb" => config.max_memory_mb = None,
        "allowed_commands" => config.allowed_commands.clear(),
        "allowed_paths" => config.allowed_paths.clear(),
        "denied_paths" => config.denied_paths.clear(),
        _ => anyhow::bail!("支持的 key: network_allowed, timeout_ms, max_memory_mb, allowed_commands, allowed_paths, denied_paths"),
    }
    Ok(())
}

fn parse_bool(value: &str) -> Result<bool> {
    match value {
        "true" | "1" | "yes" | "on" => Ok(true),
        "false" | "0" | "no" | "off" => Ok(false),
        _ => anyhow::bail!("布尔值仅支持: true/false"),
    }
}

fn parse_u64(value: &str) -> Result<u64> {
    Ok(value.parse::<u64>()?)
}

fn parse_usize(value: &str) -> Result<usize> {
    Ok(value.parse::<usize>()?)
}

fn parse_list(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_string)
        .collect()
}

#[derive(Debug, Serialize)]
struct SandboxShowResponse {
    policies: Vec<ModePolicyView>,
}

#[derive(Debug, Serialize)]
struct SandboxDiffResponse {
    diffs: Vec<ModeDiffView>,
}

#[derive(Debug, Serialize)]
struct SandboxDoctorResponse {
    findings: Vec<DoctorFinding>,
}

#[derive(Debug, Serialize)]
struct ModePolicyView {
    mode: String,
    policy: PolicyView,
}

#[derive(Debug, Serialize)]
struct PolicyView {
    network_allowed: bool,
    timeout_ms: Option<u64>,
    max_memory_mb: Option<usize>,
    allowed_commands: Vec<String>,
    allowed_paths: Vec<String>,
    denied_paths: Vec<String>,
}

#[derive(Debug, Serialize)]
struct ModeDiffView {
    mode: String,
    changed: bool,
    fields: Vec<FieldDiffView>,
}

#[derive(Debug, Serialize)]
struct FieldDiffView {
    key: String,
    default_value: String,
    effective_value: String,
}

#[derive(Debug, Serialize)]
struct DoctorFinding {
    mode: String,
    title: String,
    message: String,
    suggestion: String,
}

impl PolicyView {
    fn from_policy(policy: sacode_runtime::SandboxPolicy) -> Self {
        Self {
            network_allowed: policy.network_allowed,
            timeout_ms: policy.timeout_ms,
            max_memory_mb: policy.max_memory_mb,
            allowed_commands: policy.allowed_commands,
            allowed_paths: display_paths(&policy.allowed_paths),
            denied_paths: display_paths(&policy.denied_paths),
        }
    }
}

fn diff_mode_view(config: &SandboxConfig, mode: ExecutionMode) -> ModeDiffView {
    let default_policy = SandboxPolicy::for_mode(mode);
    let effective_policy = config.apply(mode, default_policy.clone());
    let fields = diff_policy(&default_policy, &effective_policy);

    ModeDiffView {
        mode: mode.to_string(),
        changed: !fields.is_empty(),
        fields,
    }
}

fn diff_policy(default_policy: &SandboxPolicy, effective_policy: &SandboxPolicy) -> Vec<FieldDiffView> {
    let mut diffs = Vec::new();

    push_diff(
        &mut diffs,
        "network_allowed",
        default_policy.network_allowed.to_string(),
        effective_policy.network_allowed.to_string(),
    );
    push_diff(
        &mut diffs,
        "timeout_ms",
        format!("{:?}", default_policy.timeout_ms),
        format!("{:?}", effective_policy.timeout_ms),
    );
    push_diff(
        &mut diffs,
        "max_memory_mb",
        format!("{:?}", default_policy.max_memory_mb),
        format!("{:?}", effective_policy.max_memory_mb),
    );
    push_diff(
        &mut diffs,
        "allowed_commands",
        format!("{:?}", default_policy.allowed_commands),
        format!("{:?}", effective_policy.allowed_commands),
    );
    push_diff(
        &mut diffs,
        "allowed_paths",
        format!("{:?}", display_paths(&default_policy.allowed_paths)),
        format!("{:?}", display_paths(&effective_policy.allowed_paths)),
    );
    push_diff(
        &mut diffs,
        "denied_paths",
        format!("{:?}", display_paths(&default_policy.denied_paths)),
        format!("{:?}", display_paths(&effective_policy.denied_paths)),
    );

    diffs
}

fn push_diff(diffs: &mut Vec<FieldDiffView>, key: &str, default_value: String, effective_value: String) {
    if default_value != effective_value {
        diffs.push(FieldDiffView {
            key: key.to_string(),
            default_value,
            effective_value,
        });
    }
}

fn doctor_findings_for_mode(config: &SandboxConfig, mode: ExecutionMode) -> Vec<DoctorFinding> {
    let default_policy = SandboxPolicy::for_mode(mode);
    let effective_policy = config.apply(mode, default_policy.clone());
    let mut findings = Vec::new();

    let overlapping_paths = overlapping_paths(&effective_policy);
    if !overlapping_paths.is_empty() {
        findings.push(DoctorFinding {
            mode: mode.to_string(),
            title: "allowed_paths 与 denied_paths 重叠".to_string(),
            message: format!("同一路径同时出现在 allow/deny 列表: {:?}", overlapping_paths),
            suggestion: "保留单一方向的路径规则，避免同一路径同时允许和拒绝".to_string(),
        });
    }

    if mode == ExecutionMode::Plan && effective_policy.network_allowed {
        findings.push(DoctorFinding {
            mode: mode.to_string(),
            title: "plan 模式已开启网络".to_string(),
            message: "plan 默认用于只读分析，启网会扩大外部依赖与数据外传面".to_string(),
            suggestion: "执行 `sacode sandbox set plan network_allowed false` 恢复默认限制".to_string(),
        });
    }

    if mode == ExecutionMode::Plan && effective_policy.timeout_ms > default_policy.timeout_ms {
        findings.push(DoctorFinding {
            mode: mode.to_string(),
            title: "plan 模式超时高于默认值".to_string(),
            message: format!("当前超时为 {:?}，默认值为 {:?}", effective_policy.timeout_ms, default_policy.timeout_ms),
            suggestion: "保持 plan 为短时分析模式，建议清除自定义超时或回调到默认值".to_string(),
        });
    }

    if mode == ExecutionMode::Plan && effective_policy.max_memory_mb > default_policy.max_memory_mb {
        findings.push(DoctorFinding {
            mode: mode.to_string(),
            title: "plan 模式内存高于默认值".to_string(),
            message: format!("当前内存为 {:?}MB，默认值为 {:?}MB", effective_policy.max_memory_mb, default_policy.max_memory_mb),
            suggestion: "保持 plan 为轻量分析模式，建议清除自定义内存上限或回调到默认值".to_string(),
        });
    }

    if mode != ExecutionMode::Plan && effective_policy.allowed_paths.is_empty() && effective_policy.allowed_commands.is_empty() {
        findings.push(DoctorFinding {
            mode: mode.to_string(),
            title: "路径与命令边界都较宽".to_string(),
            message: "当前配置没有显式路径限制，命令也没有白名单，执行边界较宽".to_string(),
            suggestion: "按项目需要增加 allowed_paths 或 allowed_commands，缩小工具执行范围".to_string(),
        });
    }

    findings
}

fn overlapping_paths(policy: &SandboxPolicy) -> Vec<String> {
    let allowed = display_paths(&policy.allowed_paths);
    let denied = display_paths(&policy.denied_paths);
    allowed
        .into_iter()
        .filter(|path| denied.contains(path))
        .collect()
}

fn display_paths(paths: &[std::path::PathBuf]) -> Vec<String> {
    paths.iter().map(|path| path.display().to_string()).collect()
}

#[cfg(test)]
mod tests {
    use super::render_sandbox;

    #[test]
    fn render_sandbox_show_displays_all_modes() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let output = render_sandbox(temp_dir.path(), &[]).expect("render sandbox");

        assert!(output.contains("Sandbox Policies"));
        assert!(output.contains("[plan]"));
        assert!(output.contains("[build]"));
        assert!(output.contains("[yolo]"));
    }

    #[test]
    fn render_sandbox_show_json_displays_all_modes() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let output = render_sandbox(temp_dir.path(), &["show".to_string(), "--json".to_string()])
            .expect("render sandbox json");

        assert!(output.contains("\"policies\""));
        assert!(output.contains("\"mode\": \"plan\""));
        assert!(output.contains("\"mode\": \"build\""));
        assert!(output.contains("\"mode\": \"yolo\""));
    }

    #[test]
    fn render_sandbox_show_json_supports_single_mode() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let output = render_sandbox(
            temp_dir.path(),
            &["show".to_string(), "plan".to_string(), "--json".to_string()],
        )
        .expect("render sandbox single mode json");

        assert!(output.contains("\"mode\": \"plan\""));
        assert!(!output.contains("\"mode\": \"build\""));
        assert!(!output.contains("\"mode\": \"yolo\""));
    }

    #[test]
    fn render_sandbox_diff_reports_project_overrides() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        render_sandbox(
            temp_dir.path(),
            &[
                "set".to_string(),
                "plan".to_string(),
                "timeout_ms".to_string(),
                "20000".to_string(),
            ],
        )
        .expect("set sandbox timeout");

        let output = render_sandbox(temp_dir.path(), &["diff".to_string(), "plan".to_string()])
            .expect("render sandbox diff");

        assert!(output.contains("Sandbox Policy Diff"));
        assert!(output.contains("[plan]"));
        assert!(output.contains("timeout_ms: Some(15000) -> Some(20000)"));
    }

    #[test]
    fn render_sandbox_diff_reports_no_overrides() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let output = render_sandbox(temp_dir.path(), &["diff".to_string(), "build".to_string()])
            .expect("render sandbox diff without overrides");

        assert!(output.contains("[build]"));
        assert!(output.contains("无项目级覆盖"));
    }

    #[test]
    fn render_sandbox_diff_json_reports_project_overrides() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        render_sandbox(
            temp_dir.path(),
            &[
                "set".to_string(),
                "plan".to_string(),
                "timeout_ms".to_string(),
                "20000".to_string(),
            ],
        )
        .expect("set sandbox timeout");

        let output = render_sandbox(
            temp_dir.path(),
            &["diff".to_string(), "plan".to_string(), "--json".to_string()],
        )
        .expect("render sandbox diff json");

        assert!(output.contains("\"diffs\""));
        assert!(output.contains("\"mode\": \"plan\""));
        assert!(output.contains("\"changed\": true"));
        assert!(output.contains("\"key\": \"timeout_ms\""));
        assert!(output.contains("\"default_value\": \"Some(15000)\""));
        assert!(output.contains("\"effective_value\": \"Some(20000)\""));
    }

    #[test]
    fn render_sandbox_diff_json_reports_unchanged_mode() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let output = render_sandbox(
            temp_dir.path(),
            &["diff".to_string(), "build".to_string(), "--json".to_string()],
        )
        .expect("render sandbox unchanged diff json");

        assert!(output.contains("\"mode\": \"build\""));
        assert!(output.contains("\"changed\": false"));
        assert!(output.contains("\"fields\": []"));
    }

    #[test]
    fn render_sandbox_doctor_reports_plan_network_risk() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        render_sandbox(
            temp_dir.path(),
            &[
                "set".to_string(),
                "plan".to_string(),
                "network_allowed".to_string(),
                "true".to_string(),
            ],
        )
        .expect("enable plan network");

        let output = render_sandbox(temp_dir.path(), &["doctor".to_string(), "plan".to_string()])
            .expect("render sandbox doctor");

        assert!(output.contains("Sandbox Doctor"));
        assert!(output.contains("[plan] plan 模式已开启网络"));
        assert!(output.contains("sacode sandbox set plan network_allowed false"));
    }

    #[test]
    fn render_sandbox_doctor_reports_no_issues_for_default_plan() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let output = render_sandbox(temp_dir.path(), &["doctor".to_string(), "plan".to_string()])
            .expect("render sandbox doctor without issues");

        assert!(output.contains("Sandbox Doctor"));
        assert!(output.contains("未发现高优先级配置问题"));
    }

    #[test]
    fn render_sandbox_doctor_json_reports_plan_network_risk() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        render_sandbox(
            temp_dir.path(),
            &[
                "set".to_string(),
                "plan".to_string(),
                "network_allowed".to_string(),
                "true".to_string(),
            ],
        )
        .expect("enable plan network");

        let output = render_sandbox(
            temp_dir.path(),
            &["doctor".to_string(), "plan".to_string(), "--json".to_string()],
        )
        .expect("render sandbox doctor json");

        assert!(output.contains("\"findings\""));
        assert!(output.contains("\"mode\": \"plan\""));
        assert!(output.contains("\"title\": \"plan 模式已开启网络\""));
        assert!(output.contains("\"suggestion\": \"执行 `sacode sandbox set plan network_allowed false` 恢复默认限制\""));
    }

    #[test]
    fn render_sandbox_doctor_json_reports_empty_findings() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let output = render_sandbox(
            temp_dir.path(),
            &["doctor".to_string(), "plan".to_string(), "--json".to_string()],
        )
        .expect("render sandbox doctor empty json");

        assert!(output.contains("\"findings\": []"));
    }

    #[test]
    fn render_sandbox_init_creates_config_file() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let output = render_sandbox(temp_dir.path(), &["init".to_string()]).expect("init sandbox config");

        assert!(output.contains("已生成沙箱配置"));
        assert!(temp_dir.path().join(".sacode/sandbox.json").exists());
    }

    #[test]
    fn render_sandbox_set_updates_mode_config() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let output = render_sandbox(
            temp_dir.path(),
            &[
                "set".to_string(),
                "build".to_string(),
                "allowed_commands".to_string(),
                "git,cargo".to_string(),
            ],
        )
        .expect("set sandbox config");

        assert!(output.contains("已设置 sandbox.build.allowed_commands"));
        let content = std::fs::read_to_string(temp_dir.path().join(".sacode/sandbox.json")).expect("read sandbox config");
        assert!(content.contains("git"));
        assert!(content.contains("cargo"));
    }

    #[test]
    fn render_sandbox_clear_resets_mode_config() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        render_sandbox(
            temp_dir.path(),
            &[
                "set".to_string(),
                "plan".to_string(),
                "network_allowed".to_string(),
                "true".to_string(),
            ],
        )
        .expect("seed sandbox config");

        let output = render_sandbox(
            temp_dir.path(),
            &[
                "clear".to_string(),
                "plan".to_string(),
                "network_allowed".to_string(),
            ],
        )
        .expect("clear sandbox config");

        assert!(output.contains("已清除 sandbox.plan.network_allowed"));
        let show = render_sandbox(temp_dir.path(), &["show".to_string(), "plan".to_string()]).expect("show sandbox config");
        assert!(show.contains("network_allowed: false"));
    }
}
