use super::*;

#[test]
fn test_runtime_system_prompt_loads_agents_and_project_prompt() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();
    fs::create_dir_all(workdir.join(".sacode")).expect("create .sacode");
    fs::write(
        workdir.join("AGENTS.md"),
        "# Repo\n\n## Workspace 边界\n- kernel only logic\n\n## 开发命令\n- cargo test --workspace\n\n## 其他\n- ignored",
    )
    .expect("write agents");
    fs::write(
        workdir.join(".sacode/prompt.md"),
        "# Project Prompt\n\n- 回答使用中文\n- 修改后同步文档",
    )
    .expect("write project prompt");

    let tool_names = vec!["fs.read".to_string(), "apply_patch".to_string()];
    let prompt = build_runtime_system_prompt(&PromptContext {
        workdir,
        mode: ExecutionMode::Build,
        tool_names: &tool_names,
    })
    .expect("build prompt");

    assert!(prompt.contains("[Platform Rules]"));
    assert!(prompt.contains("[Repository Rules]"));
    assert!(prompt.contains("kernel only logic"));
    assert!(prompt.contains("cargo test --workspace"));
    assert!(prompt.contains("[Project Prompt]"));
    assert!(prompt.contains("回答使用中文"));
    assert!(prompt.contains("[Skill Usage]"));
    assert!(prompt.contains("~/.sacode/skills/"));
}

#[test]
fn test_runtime_system_prompt_loads_layered_wiki_context() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();
    fs::create_dir_all(workdir.join(".sacode/wiki")).expect("create project wiki");
    fs::write(
        workdir.join(".sacode/wiki/project.md"),
        "# Project Wiki\n\n- 使用 cargo test -p sacode-cli",
    )
    .expect("write project wiki");
    fs::write(
        workdir.join(".sacode/mistakes.json"),
        r#"{"entries":[{"timestamp":"1","scope":"tui","summary":"光标错位","details":"多行输入时出现偏移"}]}"#,
    )
    .expect("write mistakes");

    let tool_names = vec!["fs.read".to_string()];
    let prompt = build_runtime_system_prompt(&PromptContext {
        workdir,
        mode: ExecutionMode::Build,
        tool_names: &tool_names,
    })
    .expect("build prompt");

    assert!(prompt.contains("[Project Knowledge]"));
    assert!(prompt.contains("Project Wiki"));
    assert!(prompt.contains("光标错位"));
}

#[test]
fn test_rebuild_memory_index_from_markdown_entries() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let root = temp_dir.path().join(".sacode/wiki");
    fs::create_dir_all(&root).expect("create wiki root");
    fs::write(
        root.join("preferences.md"),
        "# 项目级偏好记忆\n\n## 条目\n\n[记忆条目]\n- Date: 2026-05-29\n- Scope: 项目级\n- Kind: preference\n- Context: 手工录入\n- Content:\n  - 以后统一使用 cargo test\n",
    )
    .expect("write preferences");

    let index = rebuild_memory_index(&root, MemoryScope::Project).expect("rebuild memory index");
    assert_eq!(index.entries.len(), 1);
    assert!(index.entries[0].content.contains("cargo test"));

    let loaded = load_memory_index(&root).expect("load rebuilt index");
    assert_eq!(loaded.entries.len(), 1);
}

#[test]
fn test_load_wiki_context_uses_rebuilt_memory_index_summary() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();
    fs::create_dir_all(workdir.join(".sacode/wiki")).expect("create project wiki");
    fs::write(
        workdir.join(".sacode/wiki/workflows.md"),
        "# 项目级工作流记忆\n\n## 条目\n\n[自动学习条目]\n- Date: 2026-05-29\n- Scope: 项目级\n- Kind: workflow\n- Context: 自动学习\n- Content:\n  - 提交前先检查 diff 再继续\n",
    )
    .expect("write workflows");

    let wiki = load_wiki_context(workdir).expect("load wiki context");
    let project_summary = wiki.project_summary.expect("project summary should exist");
    assert!(project_summary.contains("提交前先检查 diff 再继续"));
    assert!(workdir.join(".sacode/wiki/index.json").exists());
}

#[test]
fn test_load_wiki_context_reads_project_sources() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();
    fs::create_dir_all(workdir.join(".sacode/wiki")).expect("create project wiki");
    fs::write(
        workdir.join(".sacode/project.json"),
        r#"{"name":"demo","stack":["rust"]}"#,
    )
    .expect("write project config");
    fs::write(
        workdir.join(".sacode/wiki/architecture.md"),
        "# Architecture\n\n- interfaces -> runtime -> kernel",
    )
    .expect("write architecture wiki");

    let wiki = load_wiki_context(workdir).expect("load wiki context");
    let project_summary = wiki.project_summary.expect("project summary should exist");
    assert!(project_summary.contains("demo"));
    assert!(project_summary.contains("interfaces -> runtime -> kernel"));
}

#[test]
fn test_runtime_skill_prompt_expansion() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();
    let registry = SkillRegistry::new(workdir);
    registry
        .save_project_skill("review", "代码审查", "请审查 {{args}} in {{cwd}}")
        .expect("save skill");

    let rendered =
        crate::maybe_expand_skill_prompt("/review src/main.rs", workdir).expect("expand skill");

    assert!(rendered.contains("src/main.rs"));
    assert!(rendered.contains(&workdir.display().to_string()));
}

#[test]
fn test_skill_registry_prefers_project_over_user_over_workspace() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let home_dir = temp_dir.path().join("home");
    let workdir = temp_dir.path().join("workspace");

    fs::create_dir_all(home_dir.join(".sacode/skills")).expect("create user skills dir");
    fs::create_dir_all(workdir.join("skills")).expect("create workspace skills dir");
    fs::create_dir_all(workdir.join(".sacode/skills")).expect("create project skills dir");

    fs::write(
        workdir.join("skills/deploy.md"),
        "# deploy\n\nDescription: workspace\n\n## Prompt\n\nworkspace prompt\n",
    )
    .expect("write workspace skill");
    fs::write(
        home_dir.join(".sacode/skills/deploy.md"),
        "# deploy\n\nDescription: user\n\n## Prompt\n\nuser prompt\n",
    )
    .expect("write user skill");
    fs::write(
        workdir.join(".sacode/skills/deploy.md"),
        "# deploy\n\nDescription: project\n\n## Prompt\n\nproject prompt\n",
    )
    .expect("write project skill");

    let _home = HomeEnvGuard::set(&home_dir);

    let registry = SkillRegistry::new(&workdir);
    let skill = registry.get("deploy").expect("load merged skill");

    assert_eq!(skill.description, "project");
    assert_eq!(skill.prompt, "project prompt");
    assert_eq!(skill.source.label(), "project");
}

#[test]
fn test_mcp_store_prefers_project_over_user() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let home_dir = temp_dir.path().join("home");
    let workdir = temp_dir.path().join("workspace");

    fs::create_dir_all(&home_dir).expect("create home dir");
    fs::create_dir_all(&workdir).expect("create workspace dir");

    let _home = HomeEnvGuard::set(&home_dir);

    let config = SaCodeConfig::new(&workdir);
    let store = McpConfigStore::new_from_config(config.clone());

    store
        .save_to_source(
            &McpConfig {
                mcp: std::collections::BTreeMap::from([(
                    "github".to_string(),
                    McpServerConfig {
                        server_type: "remote".to_string(),
                        url: "https://user.example/mcp".to_string(),
                        enabled: true,
                    },
                )]),
            },
            McpSource::User,
        )
        .expect("save user mcp config");

    store
        .save_to_source(
            &McpConfig {
                mcp: std::collections::BTreeMap::from([(
                    "github".to_string(),
                    McpServerConfig {
                        server_type: "remote".to_string(),
                        url: "https://project.example/mcp".to_string(),
                        enabled: false,
                    },
                )]),
            },
            McpSource::Project,
        )
        .expect("save project mcp config");

    let merged = store.load().expect("load merged mcp config");
    let entries = store.list_entries().expect("list merged entries");

    let github = merged.mcp.get("github").expect("merged github config");
    assert_eq!(github.url, "https://project.example/mcp");
    assert!(!github.enabled);
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].source.label(), "project");
}

#[test]
fn test_register_enabled_mcp_tools_sync_keeps_registry_stable_without_servers() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();
    let config = SaCodeConfig::new(workdir);
    let store = McpConfigStore::new_from_config(config.clone());
    store
        .save_to_source(
            &McpConfig {
                mcp: [(
                    "offline".to_string(),
                    McpServerConfig {
                        server_type: "remote".to_string(),
                        url: "https://127.0.0.1:9/mcp".to_string(),
                        enabled: true,
                    },
                )]
                .into_iter()
                .collect(),
            },
            McpSource::Project,
        )
        .expect("save mcp config");

    let mut registry = ToolRegistry::builtin();
    let names = register_enabled_mcp_tools_sync(&store, &mut registry).expect("register mcp tools");

    assert!(names.is_empty());
    assert!(registry.get("fs.read").is_some());
}
