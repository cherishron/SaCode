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
        Some("generate") => render_generate(workdir, &config, &args[1..]),
        Some("config") => render_config(workdir, &mut config, &args[1..], &store),
        Some("install") => render_install(workdir),
        Some(_) => Ok("用法: /ide [status|vscode|cursor|jetbrains|generate|install|config show|path|set acp|lsp --host HOST --port PORT]".to_string()),
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

/// 生成 IDE 配置文件（.vscode/settings.json 等）
///
/// 可选目标：vscode（默认）, cursor
fn render_generate(
    workdir: &Path,
    config: &sacode_runtime::IdeServerConfig,
    args: &[String],
) -> Result<String> {
    let target = args.first().map(|value| value.as_str()).unwrap_or("vscode");
    let vscode_dir = workdir.join(".vscode");

    match target {
        "vscode" | "cursor" => {
            std::fs::create_dir_all(&vscode_dir)?;

            // 生成 .vscode/settings.json — LSP 客户端配置
            let settings = serde_json::json!({
                "sacode.lsp.host": config.lsp.host,
                "sacode.lsp.port": config.lsp.port,
                "sacode.acp.host": config.acp.host,
                "sacode.acp.port": config.acp.port,
            });
            let settings_path = vscode_dir.join("settings.json");
            let existing_settings = if settings_path.exists() {
                let content = std::fs::read_to_string(&settings_path).unwrap_or_default();
                serde_json::from_str::<serde_json::Value>(&content).unwrap_or(serde_json::json!({}))
            } else {
                serde_json::json!({})
            };

            // 合并现有配置，不覆盖已有值
            let mut merged = existing_settings;
            if let Some(obj) = merged.as_object_mut() {
                for (key, value) in settings.as_object().unwrap() {
                    if !obj.contains_key(key) {
                        obj.insert(key.clone(), value.clone());
                    }
                }
            }
            let settings_content = serde_json::to_string_pretty(&merged)?;
            std::fs::write(&settings_path, &settings_content)?;

            // 生成 .vscode/tasks.json — 定义启动 acp 和 lsp 的 task
            let tasks = serde_json::json!({
                "version": "2.0.0",
                "tasks": [
                    {
                        "label": "Start SaCode ACP",
                        "type": "shell",
                        "command": "sacode",
                        "args": [
                            "acp",
                            "serve",
                            "--host", config.acp.host,
                            "--port", config.acp.port.to_string()
                        ],
                        "group": "none",
                        "presentation": {
                            "reveal": "always",
                            "panel": "new"
                        },
                        "problemMatcher": []
                    },
                    {
                        "label": "Start SaCode LSP",
                        "type": "shell",
                        "command": "sacode",
                        "args": [
                            "lsp",
                            "serve",
                            "--tcp",
                            "--host", config.lsp.host,
                            "--port", config.lsp.port.to_string()
                        ],
                        "group": "none",
                        "presentation": {
                            "reveal": "always",
                            "panel": "new"
                        },
                        "problemMatcher": []
                    }
                ]
            });
            tasks_path(&vscode_dir, &tasks)?;

            // 生成 .vscode/extensions.json — 推荐 SaCode 扩展
            let extensions = serde_json::json!({
                "recommendations": [
                    "cherishron.sacode-vscode"
                ]
            });
            let ext_path = vscode_dir.join("extensions.json");
            std::fs::write(&ext_path, serde_json::to_string_pretty(&extensions)?)?;

            let ide_name = if target == "cursor" {
                "Cursor"
            } else {
                "VS Code"
            };
            Ok(format!(
                "已生成 {} 配置文件:\n\
                 - .vscode/settings.json（LSP/ACP 连接地址）\n\
                 - .vscode/tasks.json（启动 ACP + LSP 服务）\n\
                 - .vscode/extensions.json（推荐扩展）\n\n\
                 下一步操作:\n\
                 1. 在 {} 中打开此项目\n\
                 2. 运行任务: Terminal → Run Task → Start SaCode ACP / Start SaCode LSP\n\
                 3. 或手动启动: sacode acp serve & sacode lsp serve --tcp",
                ide_name, ide_name
            ))
        }
        other => Ok(format!(
            "不支持的 IDE 目标: {}。可选: vscode, cursor",
            other
        )),
    }
}

/// 写入 .vscode/tasks.json（合并现有配置）
fn tasks_path(vscode_dir: &Path, tasks: &serde_json::Value) -> Result<()> {
    let tasks_path = vscode_dir.join("tasks.json");
    let existing = if tasks_path.exists() {
        let content = std::fs::read_to_string(&tasks_path).unwrap_or_default();
        serde_json::from_str::<serde_json::Value>(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    let mut merged = existing;
    // 合并 tasks 数组
    if let Some(new_tasks) = tasks.get("tasks").and_then(|v| v.as_array()) {
        if let Some(existing_tasks) = merged.get_mut("tasks").and_then(|v| v.as_array_mut()) {
            // 按 label 去重 — 先收集已存在的 label
            let existing_labels: Vec<String> = existing_tasks
                .iter()
                .filter_map(|t| t.get("label").and_then(|l| l.as_str()))
                .map(str::to_string)
                .collect();
            for task in new_tasks {
                let label = task.get("label").and_then(|l| l.as_str()).unwrap_or("");
                if !existing_labels.iter().any(|l| l == label) {
                    existing_tasks.push(task.clone());
                }
            }
        } else {
            merged["tasks"] = tasks["tasks"].clone();
        }
    }
    // 确保 version 字段存在
    if merged.get("version").is_none() {
        merged["version"] = serde_json::json!("2.0.0");
    }

    std::fs::write(&tasks_path, serde_json::to_string_pretty(&merged)?)?;
    Ok(())
}

fn render_config(
    workdir: &Path,
    config: &mut sacode_runtime::IdeServerConfig,
    args: &[String],
    store: &IdeServerConfigStore,
) -> Result<String> {
    match args.first().map(|value| value.as_str()) {
        None | Some("show") | Some("status") => render_config_status(workdir, config),
        Some("path") => Ok(SaCodeConfig::new(workdir)
            .project_server_config()
            .display()
            .to_string()),
        Some("set") => {
            apply_set(config, args)?;
            store.save(config)?;
            render_config_status(workdir, config)
        }
        Some(_) => {
            Ok("用法: /ide config [show|path|set acp|lsp --host HOST --port PORT]".to_string())
        }
    }
}

fn render_config_status(
    workdir: &Path,
    config: &sacode_runtime::IdeServerConfig,
) -> Result<String> {
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

/// 安装 SaCode VSCode 扩展到本地扩展目录
fn render_install(workdir: &Path) -> Result<String> {
    let extension_dir = workdir.join("interfaces").join("vscode");
    if !extension_dir.exists() {
        return Ok(
            "未找到 VSCode 扩展目录 (interfaces/vscode/)。请确认在 SaCode 项目根目录下运行。"
                .to_string(),
        );
    }

    let code_path = find_code_cli();
    let mut lines = Vec::new();
    lines.push("=== SaCode VSCode 扩展安装 ===".to_string());
    lines.push("".to_string());
    lines.push(format!("扩展源目录: {}", extension_dir.display()));
    lines.push("".to_string());

    if let Some(code) = code_path {
        lines.push(format!("code CLI 已找到: {}", code.display()));
        lines.push("".to_string());
        lines.push("执行以下步骤：".to_string());
        lines.push("".to_string());
        lines.push(format!(
            "  cd {} && npm install && npm run compile",
            extension_dir.display()
        ));
        lines.push("  code --install-extension cherishron.sacode-vscode-0.1.0 --force".to_string());
        lines.push("  code --reload-window".to_string());
        lines.push("".to_string());
        lines.push("或在 VS Code 中按 F5 打开扩展开发宿主窗口。".to_string());
    } else {
        lines.push("未检测到 code CLI。请手动安装扩展：".to_string());
        lines.push("".to_string());
        lines.push("1. 打开 VS Code".to_string());
        lines.push("2. 打开扩展视图 (Ctrl+Shift+X)".to_string());
        lines.push("3. 点击 ... 菜单 → Install from VSIX...".to_string());
        lines.push("4. 编译后选择 VSIX 文件".to_string());
        lines.push("".to_string());
        lines.push("编译扩展：".to_string());
        lines.push(format!(
            "  cd {} && npm install && npx vsce package",
            extension_dir.display()
        ));
    }

    lines.push("".to_string());
    lines.push("启动 daemon 后扩展将自动连接：".to_string());
    lines.push("  sacode serve".to_string());
    lines.push("".to_string());
    lines.push(
        "配置 daemon 地址：Settings → 搜索 sacode.daemonHost / sacode.daemonPort".to_string(),
    );

    Ok(lines.join("\n"))
}

fn find_code_cli() -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        for name in &["code", "code.cmd", "code.exe"] {
            let candidate = dir.join(name);
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use sacode_runtime::ProtocolServerConfig;

    fn test_config() -> sacode_runtime::IdeServerConfig {
        sacode_runtime::IdeServerConfig {
            acp: ProtocolServerConfig {
                host: "127.0.0.1".to_string(),
                port: 9527,
            },
            lsp: ProtocolServerConfig {
                host: "127.0.0.1".to_string(),
                port: 9000,
            },
        }
    }

    #[test]
    fn render_generate_creates_vscode_files() {
        let temp = tempfile::tempdir().unwrap();
        let config = test_config();
        let result = render_generate(temp.path(), &config, &[]).unwrap();
        assert!(result.contains("VS Code"));
        assert!(result.contains("settings.json"));
        assert!(result.contains("tasks.json"));
        assert!(result.contains("extensions.json"));

        // 验证文件实际存在
        assert!(temp.path().join(".vscode/settings.json").exists());
        assert!(temp.path().join(".vscode/tasks.json").exists());
        assert!(temp.path().join(".vscode/extensions.json").exists());
    }

    #[test]
    fn render_generate_merges_existing_settings() {
        let temp = tempfile::tempdir().unwrap();
        let vscode = temp.path().join(".vscode");
        std::fs::create_dir_all(&vscode).unwrap();

        // 预写已有的 settings.json
        let existing = serde_json::json!({
            "editor.fontSize": 14,
            "files.autoSave": "onFocusChange",
        });
        std::fs::write(
            vscode.join("settings.json"),
            serde_json::to_string_pretty(&existing).unwrap(),
        )
        .unwrap();

        let config = test_config();
        render_generate(temp.path(), &config, &[]).unwrap();

        // 读取合并后的 settings.json
        let content = std::fs::read_to_string(vscode.join("settings.json")).unwrap();
        let merged: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert_eq!(merged["editor.fontSize"], 14);
        assert_eq!(merged["files.autoSave"], "onFocusChange");
        assert_eq!(merged["sacode.lsp.host"], "127.0.0.1");
        assert_eq!(merged["sacode.acp.port"], 9527);
    }

    #[test]
    fn render_generate_merges_existing_tasks() {
        let temp = tempfile::tempdir().unwrap();
        let vscode = temp.path().join(".vscode");
        std::fs::create_dir_all(&vscode).unwrap();

        // 预写已有的 tasks.json
        let existing = serde_json::json!({
            "version": "2.0.0",
            "tasks": [
                {
                    "label": "Build Project",
                    "type": "shell",
                    "command": "cargo build"
                }
            ]
        });
        std::fs::write(
            vscode.join("tasks.json"),
            serde_json::to_string_pretty(&existing).unwrap(),
        )
        .unwrap();

        let config = test_config();
        render_generate(temp.path(), &config, &[]).unwrap();

        // 读取合并后的 tasks.json
        let content = std::fs::read_to_string(vscode.join("tasks.json")).unwrap();
        let merged: serde_json::Value = serde_json::from_str(&content).unwrap();
        let tasks = merged["tasks"].as_array().unwrap();
        assert_eq!(tasks.len(), 3); // 原有的 1 + 新增的 2
        assert!(tasks.iter().any(|t| t["label"] == "Build Project"));
        assert!(tasks.iter().any(|t| t["label"] == "Start SaCode ACP"));
        assert!(tasks.iter().any(|t| t["label"] == "Start SaCode LSP"));
    }

    #[test]
    fn render_generate_unsupported_target_returns_error() {
        let temp = tempfile::tempdir().unwrap();
        let config = test_config();
        let result = render_generate(temp.path(), &config, &["intellij".to_string()]).unwrap();
        assert!(result.contains("不支持的 IDE 目标"));
    }

    #[test]
    fn tasks_path_creates_file_when_not_exists() {
        let temp = tempfile::tempdir().unwrap();
        let tasks = serde_json::json!({
            "version": "2.0.0",
            "tasks": [{"label": "test", "type": "shell", "command": "echo"}]
        });
        tasks_path(temp.path(), &tasks).unwrap();
        let path = temp.path().join("tasks.json");
        assert!(path.exists());
        let content = std::fs::read_to_string(path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert_eq!(parsed["tasks"].as_array().unwrap().len(), 1);
    }
}
