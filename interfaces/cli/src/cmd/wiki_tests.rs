use std::fs;

use crate::learning::learn_from_task;
use super::memory::render_memory;
use super::wiki::render_wiki;

#[test]
fn render_wiki_reports_project_sources() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();
    fs::create_dir_all(workdir.join(".sacode/wiki")).expect("create wiki dir");
    fs::write(
        workdir.join(".sacode/wiki/project.md"),
        "# Project\n\n- 当前项目使用 Rust workspace",
    )
    .expect("write wiki");
    fs::write(
        workdir.join(".sacode/project.json"),
        r#"{"name":"demo-project"}"#,
    )
    .expect("write project json");

    let output = render_wiki(workdir, &[]).expect("render wiki");
    assert!(output.contains("Wiki Status"));
    assert!(output.contains("项目级知识源"));
    assert!(output.contains("project.md"));
    assert!(output.contains("demo-project"));
}

#[test]
fn render_memory_initializes_typed_files() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();

    let output = render_memory(workdir, &[]).expect("render memory");
    assert!(output.contains("用户级"));
    assert!(output.contains("项目级"));
    assert!(workdir.join(".sacode/wiki/memory.md").exists());
    assert!(workdir.join(".sacode/wiki/preferences.md").exists());
    assert!(workdir.join(".sacode/wiki/workflows.md").exists());
    assert!(workdir.join(".sacode/wiki/decisions.md").exists());
}

#[test]
fn render_memory_append_writes_typed_file() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();

    let args = vec![
        "append".to_string(),
        "每次修改后先检查交互状态".to_string(),
        "--type".to_string(),
        "workflow".to_string(),
    ];
    let output = render_memory(workdir, &args).expect("append memory");
    assert!(output.contains("工作流记忆"));

    let stored = fs::read_to_string(workdir.join(".sacode/wiki/workflows.md")).expect("read workflows");
    assert!(stored.contains("Kind: workflow"));
    assert!(stored.contains("每次修改后先检查交互状态"));
}

#[test]
fn render_wiki_shows_auto_learned_entries() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();

    learn_from_task(
        workdir,
        "以后回复保持简洁。提交前先检查再继续。",
        "当前项目以 .sacode/wiki 作为知识落点。",
    )
    .expect("learn from task");

    let output = render_wiki(workdir, &[]).expect("render wiki");
    assert!(output.contains("自动学习回写"));
    assert!(output.contains("preferences.md") || output.contains("workflows.md") || output.contains("decisions.md"));
}
