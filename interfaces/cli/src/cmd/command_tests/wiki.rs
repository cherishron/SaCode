use std::fs;

use crate::learning::learn_from_task;

use super::super::wiki::render_wiki;
use super::support::HomeEnvGuard;

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
    fs::write(workdir.join(".sacode/project.json"), r#"{"name":"demo-project"}"#).expect("write project json");

    let output = render_wiki(workdir, &[]).expect("render wiki");
    assert!(output.contains("Wiki Status"));
    assert!(output.contains("项目级知识源"));
    assert!(output.contains("project.md"));
    assert!(output.contains("demo-project"));
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
