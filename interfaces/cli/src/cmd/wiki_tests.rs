use std::fs;

use crate::learning::learn_from_task;
use super::memory::render_memory;
use super::wiki::render_wiki;

struct HomeEnvGuard {
    old_home: Option<std::ffi::OsString>,
}

impl HomeEnvGuard {
    fn set(path: &std::path::Path) -> Self {
        let old_home = std::env::var_os("HOME");
        std::env::set_var("HOME", path);
        Self { old_home }
    }
}

impl Drop for HomeEnvGuard {
    fn drop(&mut self) {
        match self.old_home.take() {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }
    }
}

#[test]
#[serial_test::serial]
fn render_wiki_reports_project_sources() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();
    let home_dir = tempfile::tempdir().expect("create temp home");
    let _home_guard = HomeEnvGuard::set(home_dir.path());
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
#[serial_test::serial]
fn render_memory_initializes_typed_files() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();
    let home_dir = tempfile::tempdir().expect("create temp home");
    let _home_guard = HomeEnvGuard::set(home_dir.path());

    let output = render_memory(workdir, &[]).expect("render memory");
    assert!(output.contains("用户级"));
    assert!(output.contains("项目级"));
    assert!(workdir.join(".sacode/wiki/memory.md").exists());
    assert!(workdir.join(".sacode/wiki/preferences.md").exists());
    assert!(workdir.join(".sacode/wiki/workflows.md").exists());
    assert!(workdir.join(".sacode/wiki/decisions.md").exists());

}

#[test]
#[serial_test::serial]
fn render_memory_append_writes_typed_file() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();
    let home_dir = tempfile::tempdir().expect("create temp home");
    let _home_guard = HomeEnvGuard::set(home_dir.path());

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
    let index = fs::read_to_string(workdir.join(".sacode/wiki/index.json")).expect("read index");
    assert!(index.contains("每次修改后先检查交互状态"));

}

#[test]
#[serial_test::serial]
fn render_memory_search_uses_structured_index() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();
    let home_dir = tempfile::tempdir().expect("create temp home");
    let _home_guard = HomeEnvGuard::set(home_dir.path());

    let append_args = vec![
        "append".to_string(),
        "以后统一使用 cargo test --workspace".to_string(),
        "--type".to_string(),
        "preference".to_string(),
    ];
    render_memory(workdir, &append_args).expect("append memory");

    let search_args = vec!["search".to_string(), "cargo test".to_string()];
    let output = render_memory(workdir, &search_args).expect("search memory");
    assert!(output.contains("preferences.md"));
    assert!(output.contains("cargo test"));

}

#[test]
#[serial_test::serial]
fn render_memory_list_promote_and_archive_manage_index_entries() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();
    let home_dir = tempfile::tempdir().expect("create temp home");
    let _home_guard = HomeEnvGuard::set(home_dir.path());

    let append_args = vec![
        "append".to_string(),
        "以后统一使用 cargo test --workspace".to_string(),
        "--type".to_string(),
        "preference".to_string(),
    ];
    render_memory(workdir, &append_args).expect("append memory");

    let list_output = render_memory(workdir, &["list".to_string()]).expect("list memory");
    assert!(list_output.contains("confidence=1.00"));
    assert!(list_output.contains("active"));

    let project_index = fs::read_to_string(workdir.join(".sacode/wiki/index.json")).expect("read project index");
    let value: serde_json::Value = serde_json::from_str(&project_index).expect("parse project index");
    let entry_id = value["entries"][0]["id"].as_str().expect("entry id").to_string();

    let promote_output = render_memory(workdir, &["promote".to_string(), entry_id.clone()]).expect("promote memory");
    assert!(promote_output.contains("已提升记忆条目到用户级"));

    let user_index_path = home_dir.path().join(".sacode/wiki/index.json");
    let user_index = fs::read_to_string(&user_index_path).expect("read user index");
    assert!(user_index.contains("cargo test --workspace"));

    let archive_output = render_memory(workdir, &["archive".to_string(), entry_id.clone()]).expect("archive memory");
    assert!(archive_output.contains("已归档记忆条目"));

    let search_output = render_memory(workdir, &["search".to_string(), "cargo test".to_string()]).expect("search memory");
    assert!(!search_output.contains("项目级"));

}

#[test]
#[serial_test::serial]
fn render_memory_list_supports_type_and_scope_filters() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();
    let home_dir = tempfile::tempdir().expect("create temp home");
    let _home_guard = HomeEnvGuard::set(home_dir.path());

    render_memory(
        workdir,
        &[
            "append".to_string(),
            "以后统一使用 cargo test --workspace".to_string(),
            "--type".to_string(),
            "preference".to_string(),
        ],
    )
    .expect("append project preference");

    render_memory(
        workdir,
        &[
            "append".to_string(),
            "每次发布前先核对版本号".to_string(),
            "--type".to_string(),
            "workflow".to_string(),
            "--global".to_string(),
        ],
    )
    .expect("append user workflow");

    let output = render_memory(
        workdir,
        &[
            "list".to_string(),
            "--type".to_string(),
            "workflow".to_string(),
            "--scope".to_string(),
            "user".to_string(),
        ],
    )
    .expect("list filtered memory");

    assert!(output.contains("每次发布前先核对版本号"));
    assert!(!output.contains("cargo test --workspace"));

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
