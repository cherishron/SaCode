use std::path::{Path, PathBuf};

use anyhow::Result;

use crate::provider_config::{ProviderConfigStore, SaCodeConfigStore};
use crate::cmd::status;
use crate::plugin_config::PluginConfigStore;

pub async fn run() -> Result<()> {
    let workdir = PathBuf::from(".");
    let _ = status::ensure_default_context7(&workdir).await;
    println!("{}", render_doctor(&workdir).await?);
    Ok(())
}

pub async fn render_doctor(workdir: &Path) -> Result<String> {
    let provider_store = ProviderConfigStore::new(workdir);
    let sacode_store = SaCodeConfigStore::new(workdir);

    let provider = provider_store.load_current()?;
    let config = sacode_store.load_effective()?;
    let project_config = sacode_store.load()?;
    let memory_files = [
        workdir.join(".sacode/wiki/memory.md"),
        workdir.join(".sacode/wiki/preferences.md"),
        workdir.join(".sacode/wiki/workflows.md"),
        workdir.join(".sacode/wiki/decisions.md"),
    ];
    let has_memory = memory_files.iter().any(|path| path.exists());
    let plugin_status = plugin_status(workdir)?;
    let mcp_lines = status::render_status(workdir).await?;

    let mut lines = vec!["SaCode Doctor".to_string()];
    lines.push(format!("工作目录: {}", workdir.display()));
    lines.push(String::new());
    lines.push("检查项: ".to_string());
    lines.push(format!(
        "- Provider: {}",
        provider
            .as_ref()
            .map(|entry| format!("{} | model {}", entry.name, entry.config.model))
            .unwrap_or_else(|| "未配置".to_string())
    ));
    lines.push(format!(
        "- 默认模型: {}",
        if config.model.trim().is_empty() { "未设置" } else { &config.model }
    ));
    lines.push(format!(
        "- 输出风格: 生效 {} | 项目覆盖 {}",
        display_value(&config.outstyle),
        display_value(project_config.as_ref().map(|value| value.outstyle.as_str()).unwrap_or(""))
    ));
    lines.push(format!(
        "- 项目记忆: {}",
        if has_memory {
            format!("存在 | {}", workdir.join(".sacode/wiki").display())
        } else {
            format!("缺失 | {}", workdir.join(".sacode/wiki").display())
        }
    ));
    lines.push(format!(
        "- 插件: {} 个启用，{} 个关闭",
        plugin_status.0,
        plugin_status.1
    ));
    lines.push(String::new());
    lines.push("MCP 与插件状态: ".to_string());
    lines.push(mcp_lines);
    lines.push(String::new());
    lines.push("建议: ".to_string());

    if provider.is_none() {
        lines.push("- 先运行 /login 或 sacode init 配置 Provider。".to_string());
    }
    if config.model.trim().is_empty() {
        lines.push("- 运行 /models 选择默认模型。".to_string());
    }
    if config.outstyle.trim().is_empty() {
        lines.push("- 运行 /outstyle concise|explain|teach 设置默认回答风格。".to_string());
    }
    if !has_memory {
        lines.push("- 运行 /memory show 初始化项目级 wiki 记忆文件，或使用 /memory append --type preference|workflow|decision 追加分类记忆。".to_string());
    }
    if plugin_status.0 == 0 && plugin_status.1 == 0 {
        lines.push("- 当前没有插件配置，按需使用 /plugin 或 /skills。".to_string());
    }
    if provider.is_some() && !config.model.trim().is_empty() && has_memory {
        lines.push("- 基础配置完整，可以直接开始任务。".to_string());
    }

    Ok(lines.join("\n"))
}

fn plugin_status(workdir: &Path) -> Result<(usize, usize)> {
    let store = PluginConfigStore::new(workdir);
    let entries = store.list_entries()?;
    let enabled = entries.iter().filter(|plugin| plugin.plugin.enabled).count();
    let disabled = entries.len().saturating_sub(enabled);
    Ok((enabled, disabled))
}

fn display_value(value: &str) -> &str {
    if value.trim().is_empty() {
        "default"
    } else {
        value
    }
}
