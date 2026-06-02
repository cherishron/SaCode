use std::fs;

use super::super::memory::render_memory;
use super::support::HomeEnvGuard;

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
