//! 灵枢 · 自组织 — 自定义 Agent 定义文件加载
//!
//! 设计目标：
//! - 支持用户通过 YAML/TOML 文件定义自定义 Agent 角色
//! - 与 Claude Code 的 `.claude/agents/*.md` 和 Codex CLI 的 TOML 角色配置对齐
//! - 自动发现并加载项目级和用户级 Agent 定义
//!
//! 文件格式（YAML frontmatter）：
//! ```yaml
//! # .sacode/agents/security-auditor.yaml
//! id: security-auditor
//! name: Security Auditor
//! system_prompt: "审查代码安全漏洞，包括注入、XSS、认证绕过等"
//! responsibilities:
//!   - 检查 SQL 注入和命令注入风险
//!   - 验证认证和授权逻辑
//!   - 识别敏感数据泄露风险
//! preferred_context:
//!   - security
//!   - authentication
//! deliverables:
//!   - security_report
//! model_policy:
//!   thinking: true
//!   auto_route: true
//!   primary_model: claude-3.7-sonnet
//! ```
//!
//! 搜索路径：
//! - 项目级：`.sacode/agents/*.yaml` / `.sacode/agents/*.yml`
//! - 用户级：`~/.sacode/agents/*.yaml` / `~/.sacode/agents/*.yml`

use std::fs;
use std::path::Path;

use sacode_kernel::{AgentRole, RoleModelPolicy, RoleStage};

/// 从文件系统加载自定义 Agent 定义
pub fn load_custom_agents(workdir: &Path) -> Vec<AgentRole> {
    let mut agents = Vec::new();

    // 项目级 Agent 定义
    let project_agents_dir = workdir.join(".sacode").join("agents");
    if project_agents_dir.exists() {
        if let Ok(files) = collect_agent_files(&project_agents_dir) {
            for file in files {
                match load_agent_from_file(&file) {
                    Ok(role) => {
                        tracing::info!("加载项目级 Agent 定义: {} ({})", role.id, role.name);
                        agents.push(role);
                    }
                    Err(e) => {
                        tracing::warn!("加载 Agent 定义失败 [{}]: {}", file.display(), e);
                    }
                }
            }
        }
    }

    // 用户级 Agent 定义
    if let Some(home) = dirs_home() {
        let user_agents_dir = home.join(".sacode").join("agents");
        if user_agents_dir.exists() {
            if let Ok(files) = collect_agent_files(&user_agents_dir) {
                for file in files {
                    match load_agent_from_file(&file) {
                        Ok(role) => {
                            // 避免与项目级 Agent ID 冲突
                            if agents.iter().any(|a| a.id == role.id) {
                                tracing::warn!(
                                    "用户级 Agent [{}] 与项目级冲突，跳过",
                                    role.id
                                );
                                continue;
                            }
                            tracing::info!("加载用户级 Agent 定义: {} ({})", role.id, role.name);
                            agents.push(role);
                        }
                        Err(e) => {
                            tracing::warn!("加载 Agent 定义失败 [{}]: {}", file.display(), e);
                        }
                    }
                }
            }
        }
    }

    agents
}

/// 收集目录中的 Agent 定义文件
fn collect_agent_files(dir: &Path) -> anyhow::Result<Vec<std::path::PathBuf>> {
    let mut files = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if matches!(ext, "yaml" | "yml" | "toml") {
            files.push(path);
        }
    }
    files.sort();
    Ok(files)
}

/// 从文件加载 Agent 定义
fn load_agent_from_file(path: &Path) -> anyhow::Result<AgentRole> {
    let content = fs::read_to_string(path)?;
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");

    match ext {
        "yaml" | "yml" => parse_yaml_agent(&content),
        "toml" => parse_toml_agent(&content),
        _ => anyhow::bail!("不支持的 Agent 定义文件格式: {}", ext),
    }
}

/// 解析 YAML 格式的 Agent 定义
fn parse_yaml_agent(content: &str) -> anyhow::Result<AgentRole> {
    // 简易 YAML 解析（避免引入 yaml 依赖）
    // 支持的键：id, name, system_prompt, responsibilities, preferred_context,
    //          deliverables, handoff_to, stage, model_policy.thinking,
    //          model_policy.auto_route, model_policy.primary_model, model_policy.provider
    let mut id = String::new();
    let mut name = String::new();
    let mut system_prompt = String::new();
    let mut responsibilities = Vec::new();
    let mut preferred_context = Vec::new();
    let mut deliverables = Vec::new();
    let mut handoff_to = Vec::new();
    let mut stage: Option<RoleStage> = None;
    let mut thinking: Option<bool> = None;
    let mut auto_route = true;
    let mut primary_model: Option<String> = None;
    let mut provider: Option<String> = None;

    let mut list_key = String::new();
    let mut in_model_policy = false;

    for line in content.lines() {
        let trimmed = line.trim();

        // 跳过注释和空行
        if trimmed.starts_with('#') || trimmed.is_empty() {
            continue;
        }

        // 检测 model_policy 嵌套块
        if trimmed.starts_with("model_policy:") {
            in_model_policy = true;
            continue;
        }

        // 非缩进行结束 model_policy 块
        if in_model_policy && !trimmed.starts_with('-') && !line.starts_with(' ') && !line.starts_with('\t') {
            in_model_policy = false;
        }

        // 列表项
        if trimmed.starts_with("- ") {
            let value = trimmed.strip_prefix("- ").unwrap_or("").trim().to_string();
            match list_key.as_str() {
                "responsibilities" => responsibilities.push(value),
                "preferred_context" => preferred_context.push(value),
                "deliverables" => deliverables.push(value),
                "handoff_to" => handoff_to.push(value),
                _ => {}
            }
            continue;
        }

        // 键值对
        if let Some((key, value)) = trimmed.split_once(':') {
            let key = key.trim();
            let value = value.trim().trim_matches('"').trim_matches('\'');

            // 重置列表状态

            if in_model_policy {
                match key {
                    "thinking" => thinking = parse_bool(value),
                    "auto_route" => auto_route = parse_bool(value).unwrap_or(true),
                    "primary_model" => primary_model = Some(value.to_string()),
                    "provider" => provider = Some(value.to_string()),
                    _ => {}
                }
                continue;
            }

            match key {
                "id" => id = value.to_string(),
                "name" => name = value.to_string(),
                "system_prompt" => system_prompt = value.to_string(),
                "stage" => stage = parse_stage(value),
                "responsibilities" | "preferred_context" | "deliverables" | "handoff_to" => {
                    list_key = key.to_string();
                }
                _ => {}
            }
        }
    }

    if id.is_empty() {
        anyhow::bail!("Agent 定义缺少必填字段: id");
    }

    if name.is_empty() {
        name = id.clone();
    }

    Ok(AgentRole {
        id,
        name,
        stage,
        system_prompt,
        responsibilities,
        preferred_context,
        deliverables,
        handoff_to,
        model_policy: RoleModelPolicy {
            thinking,
            auto_route,
            primary_model,
            provider,
            ..RoleModelPolicy::default()
        },
        ..AgentRole::default()
    })
}

/// 解析 TOML 格式的 Agent 定义
///
/// 支持 TOML 语法：
/// - `key = value`（字符串 / 布尔）
/// - `key = ["a", "b"]`（字符串数组）
/// - `[model_policy]` 表头（进入 model_policy 块）
fn parse_toml_agent(content: &str) -> anyhow::Result<AgentRole> {
    let mut id = String::new();
    let mut name = String::new();
    let mut system_prompt = String::new();
    let mut responsibilities = Vec::new();
    let mut preferred_context = Vec::new();
    let mut deliverables = Vec::new();
    let mut handoff_to = Vec::new();
    let mut stage: Option<RoleStage> = None;
    let mut thinking: Option<bool> = None;
    let mut auto_route = true;
    let mut primary_model: Option<String> = None;
    let mut provider: Option<String> = None;

    let mut in_model_policy = false;

    for line in content.lines() {
        let trimmed = line.trim();

        // 跳过注释和空行
        if trimmed.starts_with('#') || trimmed.is_empty() {
            continue;
        }

        // 表头：`[model_policy]`
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            let section = trimmed.trim_start_matches('[').trim_end_matches(']').trim();
            in_model_policy = section == "model_policy";
            continue;
        }

        // 键值对：`key = value`
        let Some((key, value)) = trimmed.split_once('=') else {
            continue;
        };
        let key = key.trim();
        let value = value.trim();

        if in_model_policy {
            match key {
                "thinking" => thinking = parse_bool(value),
                "auto_route" => auto_route = parse_bool(value).unwrap_or(true),
                "primary_model" => primary_model = Some(unquote_toml(value)),
                "provider" => provider = Some(unquote_toml(value)),
                _ => {}
            }
            continue;
        }

        match key {
            "id" => id = unquote_toml(value),
            "name" => name = unquote_toml(value),
            "system_prompt" => system_prompt = unquote_toml(value),
            "stage" => stage = parse_stage(&unquote_toml(value)),
            "responsibilities" => responsibilities = parse_toml_array(value),
            "preferred_context" => preferred_context = parse_toml_array(value),
            "deliverables" => deliverables = parse_toml_array(value),
            "handoff_to" => handoff_to = parse_toml_array(value),
            _ => {}
        }
    }

    if id.is_empty() {
        anyhow::bail!("Agent 定义缺少必填字段: id");
    }

    if name.is_empty() {
        name = id.clone();
    }

    Ok(AgentRole {
        id,
        name,
        stage,
        system_prompt,
        responsibilities,
        preferred_context,
        deliverables,
        handoff_to,
        model_policy: RoleModelPolicy {
            thinking,
            auto_route,
            primary_model,
            provider,
            ..RoleModelPolicy::default()
        },
        ..AgentRole::default()
    })
}

/// 去除 TOML 字符串值的首尾引号
fn unquote_toml(value: &str) -> String {
    value.trim().trim_matches('"').trim_matches('\'').to_string()
}

/// 解析 TOML 字符串数组：`["a", "b"]`
fn parse_toml_array(value: &str) -> Vec<String> {
    let value = value.trim();
    if !value.starts_with('[') || !value.ends_with(']') {
        return Vec::new();
    }
    let inner = &value[1..value.len() - 1];
    inner
        .split(',')
        .map(|item| unquote_toml(item))
        .filter(|item| !item.is_empty())
        .collect()
}

fn parse_bool(value: &str) -> Option<bool> {
    match value.to_lowercase().as_str() {
        "true" | "yes" | "1" => Some(true),
        "false" | "no" | "0" => Some(false),
        _ => None,
    }
}

fn parse_stage(value: &str) -> Option<RoleStage> {
    match value.to_lowercase().as_str() {
        "requirements" | "requirement" => Some(RoleStage::Requirements),
        "design" => Some(RoleStage::Design),
        "implementation" | "implement" => Some(RoleStage::Implementation),
        "quality" | "test" | "validation" => Some(RoleStage::Quality),
        "delivery" | "deploy" => Some(RoleStage::Delivery),
        _ => None,
    }
}

/// 获取用户主目录
fn dirs_home() -> Option<std::path::PathBuf> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()
        .map(std::path::PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_yaml_agent_basic() {
        let yaml = r#"
# 安全审查 Agent
id: security-auditor
name: Security Auditor
system_prompt: "审查代码安全漏洞"
stage: quality
responsibilities:
  - 检查 SQL 注入风险
  - 验证认证逻辑
preferred_context:
  - security
  - authentication
deliverables:
  - security_report
model_policy:
  thinking: true
  auto_route: true
  primary_model: claude-3.7-sonnet
"#;
        let role = parse_yaml_agent(yaml).unwrap();
        assert_eq!(role.id, "security-auditor");
        assert_eq!(role.name, "Security Auditor");
        assert_eq!(role.system_prompt, "审查代码安全漏洞");
        assert_eq!(role.responsibilities.len(), 2);
        assert_eq!(role.preferred_context.len(), 2);
        assert_eq!(role.deliverables.len(), 1);
        assert_eq!(role.model_policy.thinking, Some(true));
        assert_eq!(role.model_policy.primary_model.as_deref(), Some("claude-3.7-sonnet"));
    }

    #[test]
    fn parse_yaml_agent_minimal() {
        let yaml = r#"
id: my-agent
name: My Agent
system_prompt: "Do something"
"#;
        let role = parse_yaml_agent(yaml).unwrap();
        assert_eq!(role.id, "my-agent");
        assert_eq!(role.name, "My Agent");
        assert!(role.responsibilities.is_empty());
        assert!(role.model_policy.auto_route);
    }

    #[test]
    fn parse_yaml_agent_missing_id() {
        let yaml = r#"
name: No ID Agent
system_prompt: "Missing ID"
"#;
        let result = parse_yaml_agent(yaml);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("id"));
    }

    #[test]
    fn parse_stage_variants() {
        assert!(matches!(parse_stage("requirements"), Some(RoleStage::Requirements)));
        assert!(matches!(parse_stage("design"), Some(RoleStage::Design)));
        assert!(matches!(parse_stage("implementation"), Some(RoleStage::Implementation)));
        assert!(matches!(parse_stage("quality"), Some(RoleStage::Quality)));
        assert!(matches!(parse_stage("delivery"), Some(RoleStage::Delivery)));
        assert!(parse_stage("unknown").is_none());
    }

    #[test]
    fn parse_bool_variants() {
        assert_eq!(parse_bool("true"), Some(true));
        assert_eq!(parse_bool("false"), Some(false));
        assert_eq!(parse_bool("yes"), Some(true));
        assert_eq!(parse_bool("no"), Some(false));
        assert_eq!(parse_bool("1"), Some(true));
        assert_eq!(parse_bool("0"), Some(false));
        assert_eq!(parse_bool("maybe"), None);
    }

    #[test]
    fn parse_toml_agent_basic() {
        let toml = r#"
# 安全审查 Agent (TOML)
id = "security-auditor"
name = "Security Auditor"
system_prompt = "审查代码安全漏洞"
stage = "quality"
responsibilities = ["检查 SQL 注入风险", "验证认证逻辑"]
preferred_context = ["security", "authentication"]
deliverables = ["security_report"]

[model_policy]
thinking = true
auto_route = true
primary_model = "claude-3.7-sonnet"
"#;
        let role = parse_toml_agent(toml).unwrap();
        assert_eq!(role.id, "security-auditor");
        assert_eq!(role.name, "Security Auditor");
        assert_eq!(role.system_prompt, "审查代码安全漏洞");
        assert_eq!(role.responsibilities.len(), 2);
        assert_eq!(role.preferred_context.len(), 2);
        assert_eq!(role.deliverables.len(), 1);
        assert_eq!(role.model_policy.thinking, Some(true));
        assert_eq!(role.model_policy.primary_model.as_deref(), Some("claude-3.7-sonnet"));
    }

    #[test]
    fn parse_toml_array_variants() {
        assert_eq!(parse_toml_array("[\"a\", \"b\"]"), vec!["a".to_string(), "b".to_string()]);
        assert_eq!(parse_toml_array("[]"), Vec::<String>::new());
        assert_eq!(parse_toml_array("not-an-array"), Vec::<String>::new());
    }

    #[test]
    fn load_custom_agents_handles_missing_dir() {
        let dir = tempfile::tempdir().unwrap();
        // .sacode/agents 不存在时应返回空列表
        let agents = load_custom_agents(dir.path());
        assert!(agents.is_empty());
    }
}
