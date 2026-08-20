use std::path::{Path, PathBuf};

use anyhow::Result;

use crate::cmd::status;
use crate::plugin_config::PluginConfigStore;
use crate::provider_config::{ProviderConfigStore, SaCodeConfigStore};

pub async fn run() -> Result<()> {
    let workdir = PathBuf::from(".");
    let _ = status::ensure_default_context7(&workdir).await;
    println!("{}", render_doctor(&workdir).await?);
    Ok(())
}

pub async fn render_doctor(workdir: &Path) -> Result<String> {
    let provider_store = ProviderConfigStore::new(workdir);
    let sacode_store = SaCodeConfigStore::new(workdir);

    let provider = provider_store
        .load_current()
        .map_err(|e| anyhow::anyhow!("load_current failed: {e}"))?;
    let config = sacode_store
        .load_effective()
        .map_err(|e| anyhow::anyhow!("load_effective failed: {e}"))?;
    let project_config = sacode_store
        .load()
        .map_err(|e| anyhow::anyhow!("load failed: {e}"))?;
    let memory_files = [
        workdir.join(".sacode/wiki/project.md"),
        workdir.join(".sacode/wiki/preferences.md"),
        workdir.join(".sacode/wiki/experience.md"),
    ];
    let has_memory = memory_files.iter().any(|path| path.exists());
    let plugin_status =
        plugin_status(workdir).map_err(|e| anyhow::anyhow!("plugin_status failed: {e}"))?;
    let mcp_lines = status::render_status(workdir)
        .await
        .map_err(|e| anyhow::anyhow!("render_status failed: {e}"))?;

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
        if config.model.trim().is_empty() {
            "未设置"
        } else {
            &config.model
        }
    ));
    lines.push(format!(
        "- 路由覆盖: {} 条",
        config.model_routing.overrides.len()
    ));
    lines.push(format!(
        "- 输出风格: 生效 {} | 项目覆盖 {}",
        display_value(&config.outstyle),
        display_value(
            project_config
                .as_ref()
                .map(|value| value.outstyle.as_str())
                .unwrap_or("")
        )
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
        plugin_status.0, plugin_status.1
    ));
    lines.push(
        "- 内置 MCP: sacode-built-in-mcp | stdio | tools fs.read, fs.list, git.diff".to_string(),
    );
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
    if provider.is_some() && config.model_routing.overrides.is_empty() {
        lines.push("- 如需按技术栈或界面类型固定优先模型，可在 .sacode/config.json 中配置 model_routing.overrides。".to_string());
    }
    if !has_memory {
        lines.push("- 运行 /memory show 初始化项目级 wiki 记忆文件，或使用 /memory append --type preference|workflow|decision 追加分类记忆。".to_string());
    }
    if plugin_status.0 == 0 && plugin_status.1 == 0 {
        lines.push("- 当前没有插件配置，按需使用 /plugin 或 /skills。".to_string());
    }
    lines.push(
        "- 如需把内置文件与 Git 能力暴露给外部 MCP Client，可运行 `sacode mcp serve`。".to_string(),
    );
    if provider.is_some() && !config.model.trim().is_empty() && has_memory {
        lines.push("- 基础配置完整，可以直接开始任务。".to_string());
    }

    Ok(lines.join("\n"))
}

fn plugin_status(workdir: &Path) -> Result<(usize, usize)> {
    let store = PluginConfigStore::new(workdir);
    let entries = store.list_entries()?;
    let enabled = entries
        .iter()
        .filter(|plugin| plugin.plugin.enabled)
        .count();
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

#[cfg(test)]
mod tests {
    use super::render_doctor;

    #[tokio::test]
    async fn render_doctor_mentions_builtin_mcp_serve() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let output = render_doctor(temp_dir.path()).await.expect("render doctor");

        assert!(output.contains("sacode-built-in-mcp"));
        assert!(output.contains("sacode mcp serve"));
    }
}
