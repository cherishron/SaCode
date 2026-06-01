use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::Result;
use serde::Serialize;
use sacode_kernel::ExecutionMode;
use sacode_runtime::{SandboxBackendConfig, SandboxBackendKind, SandboxConfig, SandboxConfigStore, SandboxFsConfig, SandboxModeConfig, SandboxNetworkConfig, SandboxPolicy, SandboxResourceConfig, SandboxShellConfig, SandboxTaskConfig};

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
    let config = store.load()?;
    lines.push(format!("backend.kind: {}", backend_kind_label(config.backend.kind)));
    for mode in modes {
        let policy = store.policy_for_mode(mode)?;
        lines.push(String::new());
        lines.push(format!("[{}]", mode));
        lines.push(format!("fs.read_paths: {:?}", display_paths(&policy.fs.read_paths)));
        lines.push(format!("fs.write_paths: {:?}", display_paths(&policy.fs.write_paths)));
        lines.push(format!("fs.deny_paths: {:?}", display_paths(&policy.fs.denied_paths)));
        lines.push(format!("network.search_allowed: {}", policy.network.search_allowed));
        lines.push(format!("network.fetch_allowed: {}", policy.network.fetch_allowed));
        lines.push(format!("network.browser_allowed: {}", policy.network.browser_allowed));
        lines.push(format!("shell.enabled: {}", policy.shell.enabled));
        lines.push(format!("shell.allowed_commands: {:?}", policy.shell.allowed_commands));
        lines.push(format!("task.spawn_allowed: {}", policy.task.spawn_allowed));
        lines.push(format!("resources.timeout_ms: {:?}", policy.timeout_ms()));
        lines.push(format!("resources.max_memory_mb: {:?}", policy.max_memory_mb()));
    }
    Ok(lines.join("\n"))
}

fn render_show_json(store: &SandboxConfigStore, modes: &[ExecutionMode]) -> Result<String> {
    let config = store.load()?;
    let backend_kind = backend_kind_label(config.backend.kind).to_string();
    let policies = modes
        .iter()
        .map(|mode| {
            Ok(ModePolicyView {
                mode: mode.to_string(),
                backend_kind: backend_kind.clone(),
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
    if config.backend.kind == SandboxBackendKind::Docker {
        findings.extend(docker_backend_findings(&config));
    }
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
            backend: SandboxBackendConfig {
                kind: SandboxBackendKind::Local,
                ..SandboxBackendConfig::default()
            },
            plan: SandboxModeConfig {
                fs: SandboxFsConfig {
                    read_paths: vec![".".to_string()],
                    ..SandboxFsConfig::default()
                },
                network: SandboxNetworkConfig {
                    search_allowed: Some(true),
                    fetch_allowed: Some(false),
                    browser_allowed: Some(false),
                    ..SandboxNetworkConfig::default()
                },
                shell: SandboxShellConfig {
                    enabled: Some(false),
                    ..SandboxShellConfig::default()
                },
                task: SandboxTaskConfig {
                    spawn_allowed: Some(false),
                },
                resources: SandboxResourceConfig {
                    max_memory_mb: Some(256),
                    timeout_ms: Some(15_000),
                },
                ..SandboxModeConfig::default()
        },
        build: SandboxModeConfig {
                fs: SandboxFsConfig {
                    read_paths: vec![".".to_string()],
                    write_paths: vec![".".to_string()],
                    ..SandboxFsConfig::default()
                },
                network: SandboxNetworkConfig {
                    search_allowed: Some(true),
                    fetch_allowed: Some(true),
                    browser_allowed: Some(false),
                    ..SandboxNetworkConfig::default()
                },
                shell: SandboxShellConfig {
                    enabled: Some(true),
                    ..SandboxShellConfig::default()
                },
                task: SandboxTaskConfig {
                    spawn_allowed: Some(true),
                },
                resources: SandboxResourceConfig {
                    max_memory_mb: Some(512),
                    timeout_ms: Some(30_000),
                },
                ..SandboxModeConfig::default()
        },
        yolo: SandboxModeConfig {
                fs: SandboxFsConfig {
                    read_paths: vec![".".to_string()],
                    write_paths: vec![".".to_string()],
                    ..SandboxFsConfig::default()
                },
                network: SandboxNetworkConfig {
                    search_allowed: Some(true),
                    fetch_allowed: Some(true),
                    browser_allowed: Some(true),
                    ..SandboxNetworkConfig::default()
                },
                shell: SandboxShellConfig {
                    enabled: Some(true),
                    ..SandboxShellConfig::default()
                },
                task: SandboxTaskConfig {
                    spawn_allowed: Some(true),
                },
                resources: SandboxResourceConfig {
                    max_memory_mb: Some(1024),
                    timeout_ms: Some(60_000),
                },
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
        "fs.read_paths" => config.fs.read_paths = parse_list(value),
        "fs.write_paths" => config.fs.write_paths = parse_list(value),
        "fs.deny_paths" => config.fs.deny_paths = parse_list(value),
        "network.search_allowed" => config.network.search_allowed = Some(parse_bool(value)?),
        "network.fetch_allowed" => config.network.fetch_allowed = Some(parse_bool(value)?),
        "network.browser_allowed" => config.network.browser_allowed = Some(parse_bool(value)?),
        "shell.enabled" => config.shell.enabled = Some(parse_bool(value)?),
        "shell.allowed_commands" => config.shell.allowed_commands = parse_list(value),
        "task.spawn_allowed" => config.task.spawn_allowed = Some(parse_bool(value)?),
        "resources.timeout_ms" => config.resources.timeout_ms = Some(parse_u64(value)?),
        "resources.max_memory_mb" => config.resources.max_memory_mb = Some(parse_usize(value)?),
        _ => anyhow::bail!("支持的 key: fs.read_paths, fs.write_paths, fs.deny_paths, network.search_allowed, network.fetch_allowed, network.browser_allowed, shell.enabled, shell.allowed_commands, task.spawn_allowed, resources.timeout_ms, resources.max_memory_mb"),
    }
    Ok(())
}

fn apply_clear(config: &mut SandboxModeConfig, key: &str) -> Result<()> {
    match key {
        "fs.read_paths" => config.fs.read_paths.clear(),
        "fs.write_paths" => config.fs.write_paths.clear(),
        "fs.deny_paths" => config.fs.deny_paths.clear(),
        "network.search_allowed" => config.network.search_allowed = None,
        "network.fetch_allowed" => config.network.fetch_allowed = None,
        "network.browser_allowed" => config.network.browser_allowed = None,
        "shell.enabled" => config.shell.enabled = None,
        "shell.allowed_commands" => config.shell.allowed_commands.clear(),
        "task.spawn_allowed" => config.task.spawn_allowed = None,
        "resources.timeout_ms" => config.resources.timeout_ms = None,
        "resources.max_memory_mb" => config.resources.max_memory_mb = None,
        _ => anyhow::bail!("支持的 key: fs.read_paths, fs.write_paths, fs.deny_paths, network.search_allowed, network.fetch_allowed, network.browser_allowed, shell.enabled, shell.allowed_commands, task.spawn_allowed, resources.timeout_ms, resources.max_memory_mb"),
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
    backend_kind: String,
    policy: PolicyView,
}

#[derive(Debug, Serialize)]
struct PolicyView {
    fs_read_paths: Vec<String>,
    fs_write_paths: Vec<String>,
    fs_deny_paths: Vec<String>,
    network_search_allowed: bool,
    network_fetch_allowed: bool,
    network_browser_allowed: bool,
    shell_enabled: bool,
    shell_allowed_commands: Vec<String>,
    task_spawn_allowed: bool,
    resources_timeout_ms: Option<u64>,
    resources_max_memory_mb: Option<usize>,
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
            fs_read_paths: display_paths(&policy.fs.read_paths),
            fs_write_paths: display_paths(&policy.fs.write_paths),
            fs_deny_paths: display_paths(&policy.fs.denied_paths),
            network_search_allowed: policy.network.search_allowed,
            network_fetch_allowed: policy.network.fetch_allowed,
            network_browser_allowed: policy.network.browser_allowed,
            shell_enabled: policy.shell.enabled,
            shell_allowed_commands: policy.shell.allowed_commands.clone(),
            task_spawn_allowed: policy.task.spawn_allowed,
            resources_timeout_ms: policy.timeout_ms(),
            resources_max_memory_mb: policy.max_memory_mb(),
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
        "fs.read_paths",
        format!("{:?}", display_paths(&default_policy.fs.read_paths)),
        format!("{:?}", display_paths(&effective_policy.fs.read_paths)),
    );
    push_diff(
        &mut diffs,
        "fs.write_paths",
        format!("{:?}", display_paths(&default_policy.fs.write_paths)),
        format!("{:?}", display_paths(&effective_policy.fs.write_paths)),
    );
    push_diff(
        &mut diffs,
        "fs.deny_paths",
        format!("{:?}", display_paths(&default_policy.fs.denied_paths)),
        format!("{:?}", display_paths(&effective_policy.fs.denied_paths)),
    );
    push_diff(
        &mut diffs,
        "network.search_allowed",
        default_policy.network.search_allowed.to_string(),
        effective_policy.network.search_allowed.to_string(),
    );
    push_diff(
        &mut diffs,
        "network.fetch_allowed",
        default_policy.network.fetch_allowed.to_string(),
        effective_policy.network.fetch_allowed.to_string(),
    );
    push_diff(
        &mut diffs,
        "network.browser_allowed",
        default_policy.network.browser_allowed.to_string(),
        effective_policy.network.browser_allowed.to_string(),
    );
    push_diff(
        &mut diffs,
        "shell.enabled",
        default_policy.shell.enabled.to_string(),
        effective_policy.shell.enabled.to_string(),
    );
    push_diff(
        &mut diffs,
        "shell.allowed_commands",
        format!("{:?}", default_policy.shell.allowed_commands),
        format!("{:?}", effective_policy.shell.allowed_commands),
    );
    push_diff(
        &mut diffs,
        "task.spawn_allowed",
        default_policy.task.spawn_allowed.to_string(),
        effective_policy.task.spawn_allowed.to_string(),
    );
    push_diff(
        &mut diffs,
        "resources.timeout_ms",
        format!("{:?}", default_policy.timeout_ms()),
        format!("{:?}", effective_policy.timeout_ms()),
    );
    push_diff(
        &mut diffs,
        "resources.max_memory_mb",
        format!("{:?}", default_policy.max_memory_mb()),
        format!("{:?}", effective_policy.max_memory_mb()),
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
            title: "allow 路径与 deny 路径重叠".to_string(),
            message: format!("同一路径同时出现在 allow/deny 列表: {:?}", overlapping_paths),
            suggestion: "保留单一方向的路径规则，避免同一路径同时允许和拒绝".to_string(),
        });
    }

    if mode == ExecutionMode::Plan && !effective_policy.fs.write_paths.is_empty() {
        findings.push(DoctorFinding {
            mode: mode.to_string(),
            title: "plan 模式存在可写路径".to_string(),
            message: format!("当前可写路径为 {:?}", display_paths(&effective_policy.fs.write_paths)),
            suggestion: "清空 plan 的 fs.write_paths，保持只读分析模式".to_string(),
        });
    }

    if mode == ExecutionMode::Plan && effective_policy.network.fetch_allowed {
        findings.push(DoctorFinding {
            mode: mode.to_string(),
            title: "plan 模式已开启 fetch 网络".to_string(),
            message: "plan 默认只允许搜索类联网，fetch 会扩大外部请求面".to_string(),
            suggestion: "执行 `sacode sandbox set plan network.fetch_allowed false` 恢复默认限制".to_string(),
        });
    }

    if mode == ExecutionMode::Plan && effective_policy.network.browser_allowed {
        findings.push(DoctorFinding {
            mode: mode.to_string(),
            title: "plan 模式已开启 browser 网络".to_string(),
            message: "plan 默认不需要浏览器会话，开启后会放宽交互式外部访问".to_string(),
            suggestion: "执行 `sacode sandbox set plan network.browser_allowed false` 恢复默认限制".to_string(),
        });
    }

    if mode == ExecutionMode::Plan && effective_policy.shell.enabled {
        findings.push(DoctorFinding {
            mode: mode.to_string(),
            title: "plan 模式已开启 shell".to_string(),
            message: "plan 默认用于轻量分析，shell 执行会提升副作用风险".to_string(),
            suggestion: "执行 `sacode sandbox set plan shell.enabled false` 恢复默认限制".to_string(),
        });
    }

    if mode == ExecutionMode::Plan && effective_policy.task.spawn_allowed {
        findings.push(DoctorFinding {
            mode: mode.to_string(),
            title: "plan 模式已开启 task.spawn".to_string(),
            message: "plan 默认不派生子任务，开启后会扩大执行面".to_string(),
            suggestion: "执行 `sacode sandbox set plan task.spawn_allowed false` 恢复默认限制".to_string(),
        });
    }

    if mode == ExecutionMode::Plan && effective_policy.timeout_ms() > default_policy.timeout_ms() {
        findings.push(DoctorFinding {
            mode: mode.to_string(),
            title: "plan 模式超时高于默认值".to_string(),
            message: format!("当前超时为 {:?}，默认值为 {:?}", effective_policy.timeout_ms(), default_policy.timeout_ms()),
            suggestion: "保持 plan 为短时分析模式，建议清除自定义超时或回调到默认值".to_string(),
        });
    }

    if mode == ExecutionMode::Plan && effective_policy.max_memory_mb() > default_policy.max_memory_mb() {
        findings.push(DoctorFinding {
            mode: mode.to_string(),
            title: "plan 模式内存高于默认值".to_string(),
            message: format!("当前内存为 {:?}MB，默认值为 {:?}MB", effective_policy.max_memory_mb(), default_policy.max_memory_mb()),
            suggestion: "保持 plan 为轻量分析模式，建议清除自定义内存上限或回调到默认值".to_string(),
        });
    }

    if mode != ExecutionMode::Plan && effective_policy.fs.write_paths.is_empty() && effective_policy.shell.allowed_commands.is_empty() && effective_policy.shell.enabled {
        findings.push(DoctorFinding {
            mode: mode.to_string(),
            title: "shell 已启用且缺少细粒度边界".to_string(),
            message: "当前 shell 已启用，命令白名单为空，同时没有显式可写路径限制".to_string(),
            suggestion: "按项目需要增加 fs.write_paths 或 shell.allowed_commands，缩小执行范围".to_string(),
        });
    }

    findings
}

fn overlapping_paths(policy: &SandboxPolicy) -> Vec<String> {
    let mut allowed = display_paths(&policy.fs.read_paths);
    allowed.extend(display_paths(&policy.fs.write_paths));
    let denied = display_paths(&policy.fs.denied_paths);
    allowed
        .into_iter()
        .filter(|path| denied.contains(path))
        .collect()
}

fn display_paths(paths: &[std::path::PathBuf]) -> Vec<String> {
    paths.iter().map(|path| path.display().to_string()).collect()
}

fn backend_kind_label(kind: SandboxBackendKind) -> &'static str {
    match kind {
        SandboxBackendKind::Local => "local",
        SandboxBackendKind::Docker => "docker",
    }
}

fn docker_backend_findings(config: &SandboxConfig) -> Vec<DoctorFinding> {
    let mut findings = Vec::new();
    let docker = &config.backend.docker;

    if !docker_available() {
        findings.push(DoctorFinding {
            mode: "global".to_string(),
            title: "当前环境缺少 docker 可执行文件".to_string(),
            message: "已选择 docker backend，但当前环境无法调用 docker".to_string(),
            suggestion: "安装 docker 并确保 `docker --version` 可执行后再启用 docker backend".to_string(),
        });
    }

    if docker.image.as_deref().unwrap_or("").trim().is_empty() {
        findings.push(DoctorFinding {
            mode: "global".to_string(),
            title: "docker backend 缺少 image".to_string(),
            message: "当前已选择 docker backend，但未配置容器镜像".to_string(),
            suggestion: "在 .sacode/sandbox.json 的 backend.docker.image 中配置可执行镜像".to_string(),
        });
    }

    if docker.workspace_mount.as_deref().unwrap_or("").trim().is_empty() {
        findings.push(DoctorFinding {
            mode: "global".to_string(),
            title: "docker backend 未显式声明工作区挂载点".to_string(),
            message: "当前将使用默认容器工作目录 /workspace".to_string(),
            suggestion: "如镜像内部工作目录不同，请设置 backend.docker.workspace_mount".to_string(),
        });
    }

    if docker.user.as_deref().unwrap_or("").trim().is_empty() {
        findings.push(DoctorFinding {
            mode: "global".to_string(),
            title: "docker backend 未显式声明运行用户".to_string(),
            message: "当前会自动回退到宿主机 uid:gid 推导结果".to_string(),
            suggestion: "如镜像需要固定权限模型，请设置 backend.docker.user".to_string(),
        });
    }

    if docker.read_only_rootfs == Some(false) {
        findings.push(DoctorFinding {
            mode: "global".to_string(),
            title: "docker backend 已关闭只读根文件系统".to_string(),
            message: "关闭 read-only rootfs 会扩大容器内写入面".to_string(),
            suggestion: "将 backend.docker.read_only_rootfs 设为 true，保留最小写面".to_string(),
        });
    }

    if docker.tmpfs.is_empty() {
        findings.push(DoctorFinding {
            mode: "global".to_string(),
            title: "docker backend 使用默认 tmpfs 策略".to_string(),
            message: "当前默认只挂载 /tmp:rw,noexec,nosuid,size=64m".to_string(),
            suggestion: "如工具需要额外临时目录，可在 backend.docker.tmpfs 中显式声明".to_string(),
        });
    }

    if let Some(network_mode) = docker.network_mode.as_deref() {
        let allowed = ["none", "bridge", "host"];
        if !allowed.contains(&network_mode) {
            findings.push(DoctorFinding {
                mode: "global".to_string(),
                title: "docker backend 的 network_mode 不受支持".to_string(),
                message: format!("当前 network_mode 为 {}", network_mode),
                suggestion: "使用 none、bridge 或 host 之一".to_string(),
            });
        }
    }

    findings
}

fn docker_available() -> bool {
    Command::new("docker")
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::render_sandbox;

    #[test]
    fn render_sandbox_show_displays_all_modes() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let output = render_sandbox(temp_dir.path(), &[]).expect("render sandbox");

        assert!(output.contains("Sandbox Policies"));
        assert!(output.contains("backend.kind: local"));
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
                "resources.timeout_ms".to_string(),
                "20000".to_string(),
            ],
        )
        .expect("set sandbox timeout");

        let output = render_sandbox(temp_dir.path(), &["diff".to_string(), "plan".to_string()])
            .expect("render sandbox diff");

        assert!(output.contains("Sandbox Policy Diff"));
        assert!(output.contains("[plan]"));
        assert!(output.contains("resources.timeout_ms: Some(15000) -> Some(20000)"));
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
                "resources.timeout_ms".to_string(),
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
        assert!(output.contains("\"key\": \"resources.timeout_ms\""));
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
                "network.fetch_allowed".to_string(),
                "true".to_string(),
            ],
        )
        .expect("enable plan network");

        let output = render_sandbox(temp_dir.path(), &["doctor".to_string(), "plan".to_string()])
            .expect("render sandbox doctor");

        assert!(output.contains("Sandbox Doctor"));
        assert!(output.contains("[plan] plan 模式已开启 fetch 网络"));
        assert!(output.contains("sacode sandbox set plan network.fetch_allowed false"));
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
                "network.fetch_allowed".to_string(),
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
        assert!(output.contains("\"title\": \"plan 模式已开启 fetch 网络\""));
        assert!(output.contains("\"suggestion\": \"执行 `sacode sandbox set plan network.fetch_allowed false` 恢复默认限制\""));
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
    fn render_sandbox_doctor_reports_docker_backend_config_gap() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        std::fs::create_dir_all(temp_dir.path().join(".sacode")).expect("create sandbox dir");
        std::fs::write(
            temp_dir.path().join(".sacode/sandbox.json"),
            r#"{
  "backend": {
    "kind": "docker",
    "docker": {}
  }
}"#,
        )
        .expect("write sandbox config");

        let output = render_sandbox(temp_dir.path(), &["doctor".to_string()]).expect("render docker doctor");

        assert!(output.contains("docker backend 缺少 image"));
        assert!(output.contains("docker backend 未显式声明运行用户"));
        assert!(output.contains("docker backend 使用默认 tmpfs 策略"));
        assert!(output.contains("docker") || output.contains("工作区挂载点"));
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
                "shell.allowed_commands".to_string(),
                "git,cargo".to_string(),
            ],
        )
        .expect("set sandbox config");

        assert!(output.contains("已设置 sandbox.build.shell.allowed_commands"));
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
                "network.fetch_allowed".to_string(),
                "true".to_string(),
            ],
        )
        .expect("seed sandbox config");

        let output = render_sandbox(
            temp_dir.path(),
            &[
                "clear".to_string(),
                "plan".to_string(),
                "network.fetch_allowed".to_string(),
            ],
        )
        .expect("clear sandbox config");

        assert!(output.contains("已清除 sandbox.plan.network.fetch_allowed"));
        let show = render_sandbox(temp_dir.path(), &["show".to_string(), "plan".to_string()]).expect("show sandbox config");
        assert!(show.contains("network.fetch_allowed: false"));
    }
}
