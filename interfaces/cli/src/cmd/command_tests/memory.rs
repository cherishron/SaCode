use std::fs;

use super::super::memory::render_memory;
use super::support::HomeEnvGuard;
use crate::cmd::mistakes;
use crate::mistakes::MistakeBookStore;

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
    assert!(workdir.join(".sacode/wiki/project.md").exists());
    assert!(workdir.join(".sacode/wiki/experience.md").exists());
    assert!(workdir.join(".sacode/wiki/preferences.md").exists());
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

    let stored =
        fs::read_to_string(workdir.join(".sacode/wiki/experience.md")).expect("read experience");
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

    let project_index =
        fs::read_to_string(workdir.join(".sacode/wiki/index.json")).expect("read project index");
    let value: serde_json::Value =
        serde_json::from_str(&project_index).expect("parse project index");
    let entry_id = value["entries"][0]["id"]
        .as_str()
        .expect("entry id")
        .to_string();

    let promote_output =
        render_memory(workdir, &["promote".to_string(), entry_id.clone()]).expect("promote memory");
    assert!(promote_output.contains("已提升记忆条目到用户级"));

    let user_index_path = home_dir.path().join(".sacode/wiki/index.json");
    let user_index = fs::read_to_string(&user_index_path).expect("read user index");
    assert!(user_index.contains("cargo test --workspace"));

    let archive_output =
        render_memory(workdir, &["archive".to_string(), entry_id.clone()]).expect("archive memory");
    assert!(archive_output.contains("已归档记忆条目"));

    let search_output = render_memory(workdir, &["search".to_string(), "cargo test".to_string()])
        .expect("search memory");
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
#[serial_test::serial]
fn render_memory_candidate_entries_require_approval_to_be_searchable() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();
    let home_dir = tempfile::tempdir().expect("create temp home");
    let _home_guard = HomeEnvGuard::set(home_dir.path());

    super::super::memory::append_project_candidate(
        workdir,
        sacode_runtime::MemoryKind::Workflow,
        "修复失败后优先检查日志与超时配置".to_string(),
        "测试生成 candidate".to_string(),
    )
    .expect("append candidate");

    let list_output = render_memory(workdir, &["list".to_string()]).expect("list memory");
    assert!(list_output.contains("candidate"));

    let search_output = render_memory(workdir, &["search".to_string(), "超时配置".to_string()])
        .expect("search memory");
    assert!(!search_output.contains("修复失败后优先检查日志与超时配置"));

    let project_index =
        fs::read_to_string(workdir.join(".sacode/wiki/index.json")).expect("read project index");
    let value: serde_json::Value =
        serde_json::from_str(&project_index).expect("parse project index");
    let entry_id = value["entries"][0]["id"]
        .as_str()
        .expect("entry id")
        .to_string();

    let approve_output =
        render_memory(workdir, &["approve".to_string(), entry_id.clone()]).expect("approve memory");
    assert!(approve_output.contains("已批准候选记忆条目"));

    let search_output = render_memory(workdir, &["search".to_string(), "超时配置".to_string()])
        .expect("search approved memory");
    assert!(search_output.contains("Status: active"));
    assert!(search_output.contains("修复失败后优先检查日志与"));
    assert!(search_output.contains("<<超时配置>>"));
}

#[test]
#[serial_test::serial]
fn render_memory_reject_marks_candidate_as_rejected() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();
    let home_dir = tempfile::tempdir().expect("create temp home");
    let _home_guard = HomeEnvGuard::set(home_dir.path());

    super::super::memory::append_project_candidate(
        workdir,
        sacode_runtime::MemoryKind::Workflow,
        "发布失败后先检查版本号一致性".to_string(),
        "测试 reject".to_string(),
    )
    .expect("append candidate");

    let project_index =
        fs::read_to_string(workdir.join(".sacode/wiki/index.json")).expect("read project index");
    let value: serde_json::Value =
        serde_json::from_str(&project_index).expect("parse project index");
    let entry_id = value["entries"][0]["id"]
        .as_str()
        .expect("entry id")
        .to_string();

    let reject_output =
        render_memory(workdir, &["reject".to_string(), entry_id.clone()]).expect("reject memory");
    assert!(reject_output.contains("已拒绝候选记忆条目"));

    let list_output = render_memory(workdir, &["list".to_string()]).expect("list memory");
    assert!(list_output.contains("rejected"));
}

#[test]
#[serial_test::serial]
fn mistakes_learn_generates_candidate_memory_entry() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let workdir = temp_dir.path();
    let home_dir = tempfile::tempdir().expect("create temp home");
    let _home_guard = HomeEnvGuard::set(home_dir.path());

    MistakeBookStore::new(workdir)
        .append("tool:test.run", "测试失败", "检查超时配置和工作目录")
        .expect("append mistake");

    let original_dir = std::env::current_dir().expect("read current dir");
    std::env::set_current_dir(workdir).expect("enter workdir");
    let run_result = mistakes::run(vec!["learn".to_string(), "1".to_string()]);
    std::env::set_current_dir(original_dir).expect("restore current dir");
    run_result.expect("learn mistake");

    let list_output = render_memory(workdir, &["list".to_string()]).expect("list memory");
    assert!(list_output.contains("candidate"));
    assert!(list_output.contains("测试失败"));
    assert!(list_output.contains("检查超时配置和工作目录"));
}
