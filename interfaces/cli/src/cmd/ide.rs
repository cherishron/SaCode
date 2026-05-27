use std::path::{Path, PathBuf};

use anyhow::Result;
use sacode_runtime::{IdeServerConfigStore, ProtocolServerConfig, SaCodeConfig};

pub fn run(args: Vec<String>) -> Result<()> {
    let workdir = PathBuf::from(".");
    let output = render_ide(&workdir, &args)?;
    println!("{}", output);
    Ok(())
}

pub fn render_ide(workdir: &Path, args: &[String]) -> Result<String> {
    let store = IdeServerConfigStore::new(workdir);
    let mut config = store.load()?;

    match args.first().map(|value| value.as_str()) {
        None | Some("status") => render_status(workdir, &config),
        Some("vscode") => render_vscode(workdir, &config),
        Some("cursor") => render_cursor(workdir, &config),
        Some("jetbrains") => render_jetbrains(workdir, &config),
        Some("config") => render_config(workdir, &mut config, &args[1..], &store),
        Some(_) => Ok("用法: /ide [status|vscode|cursor|jetbrains|config show|path|set acp|lsp --host HOST --port PORT]".to_string()),
    }
}

fn render_status(workdir: &Path, config: &sacode_runtime::IdeServerConfig) -> Result<String> {
    let path = SaCodeConfig::new(workdir).project_server_config();
    Ok(format!(
        "IDE 集成状态\n配置文件: {}\nACP: {}:{}\nLSP: {}:{}\n推荐命令:\n- /ide vscode\n- /ide cursor\n- /ide jetbrains\n- /ide config show",
        path.display(),
        config.acp.host,
        config.acp.port,
        config.lsp.host,
        config.lsp.port,
    ))
}

fn render_vscode(_workdir: &Path, config: &sacode_runtime::IdeServerConfig) -> Result<String> {
    Ok(format!(
        "VS Code 接入说明\n1. 启动 ACP 服务: sacode acp serve --host {} --port {}\n2. 启动 LSP 服务: sacode lsp serve --tcp --host {} --port {}\n3. 在 VS Code 扩展或外部工具配置中填入对应地址\n4. 当前项目配置可用 /ide config show 查看",
        config.acp.host,
        config.acp.port,
        config.lsp.host,
        config.lsp.port,
    ))
}

fn render_cursor(_workdir: &Path, config: &sacode_runtime::IdeServerConfig) -> Result<String> {
    Ok(format!(
        "Cursor 接入说明\n1. 启动 ACP 服务: sacode acp serve --host {} --port {}\n2. 启动 LSP 服务: sacode lsp serve --tcp --host {} --port {}\n3. 在 Cursor 的外部工具或 MCP/LSP 集成配置中填写地址\n4. 当前项目配置可用 /ide config show 查看",
        config.acp.host,
        config.acp.port,
        config.lsp.host,
        config.lsp.port,
    ))
}

fn render_jetbrains(_workdir: &Path, config: &sacode_runtime::IdeServerConfig) -> Result<String> {
    Ok(format!(
        "JetBrains 接入说明\n1. 启动 ACP 服务: sacode acp serve --host {} --port {}\n2. 启动 LSP 服务: sacode lsp serve --tcp --host {} --port {}\n3. 在 IntelliJ IDEA / WebStorm 插件或外部工具配置中填写地址\n4. 当前项目配置可用 /ide config show 查看",
        config.acp.host,
        config.acp.port,
        config.lsp.host,
        config.lsp.port,
    ))
}

fn render_config(
    workdir: &Path,
    config: &mut sacode_runtime::IdeServerConfig,
    args: &[String],
    store: &IdeServerConfigStore,
) -> Result<String> {
    match args.first().map(|value| value.as_str()) {
        None | Some("show") | Some("status") => render_config_status(workdir, config),
        Some("path") => Ok(SaCodeConfig::new(workdir).project_server_config().display().to_string()),
        Some("set") => {
            apply_set(config, args)?;
            store.save(&config)?;
            render_config_status(workdir, config)
        }
        Some(_) => Ok("用法: /ide config [show|path|set acp|lsp --host HOST --port PORT]".to_string()),
    }
}

fn render_config_status(workdir: &Path, config: &sacode_runtime::IdeServerConfig) -> Result<String> {
    let path = SaCodeConfig::new(workdir).project_server_config();
    Ok(format!(
        "IDE 集成配置\n配置文件: {}\nACP: {}:{}\nLSP: {}:{}\n命令:\n- sacode acp serve --host {} --port {}\n- sacode lsp serve --tcp --host {} --port {}",
        path.display(),
        config.acp.host,
        config.acp.port,
        config.lsp.host,
        config.lsp.port,
        config.acp.host,
        config.acp.port,
        config.lsp.host,
        config.lsp.port,
    ))
}

fn apply_set(config: &mut sacode_runtime::IdeServerConfig, args: &[String]) -> Result<()> {
    let Some(target) = args.get(1).map(|value| value.as_str()) else {
        anyhow::bail!("用法: /ide config set acp|lsp --host HOST --port PORT")
    };

    let target_config = match target {
        "acp" => &mut config.acp,
        "lsp" => &mut config.lsp,
        _ => anyhow::bail!("set 目标仅支持 acp 或 lsp"),
    };

    apply_server_args(target_config, &args[2..])?;
    Ok(())
}

fn apply_server_args(config: &mut ProtocolServerConfig, args: &[String]) -> Result<()> {
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--host" => {
                let Some(value) = iter.next() else {
                    anyhow::bail!("缺少 --host 参数值")
                };
                config.host = value.clone();
            }
            "--port" => {
                let Some(value) = iter.next() else {
                    anyhow::bail!("缺少 --port 参数值")
                };
                config.port = value
                    .parse()
                    .map_err(|_| anyhow::anyhow!("端口必须是数字"))?;
            }
            other => anyhow::bail!("未知参数: {}", other),
        }
    }
    Ok(())
}
