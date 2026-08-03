use crate::ffi::{sacode_execute, sacode_free, sacode_free_string, sacode_new};
use crate::model::ModelRule;
use crate::schema::ReviewIssue;
use crate::*;
use std::ffi::{CStr, CString};

#[test]
fn test_task_creation() {
    let task = Task::new("测试任务", ExecutionMode::Build, None);
    assert_eq!(task.prompt, "测试任务");
    assert_eq!(task.mode, ExecutionMode::Build);
    assert!(task.stdin.is_none());
}

#[test]
fn test_execution_mode_default() {
    let mode = ExecutionMode::default();
    assert_eq!(mode, ExecutionMode::Build);
}

#[test]
fn test_review_passed() {
    let review = Review::passed();
    assert!(review.passed);
    assert!(review.issues.is_empty());
}

#[test]
fn test_review_failed() {
    let issues = vec![ReviewIssue::critical("错误")];
    let review = Review::failed(issues);
    assert!(!review.passed);
    assert!(review.has_critical());
}

#[test]
fn test_checkpoint_creation() {
    let task = Task::new("测试", ExecutionMode::Build, None);
    let checkpoint = Checkpoint::new(task);

    assert_eq!(checkpoint.current_step, 0);
    assert!(checkpoint.executed_tools.is_empty());
    assert!(checkpoint.pending_approval.is_none());
}

#[test]
fn test_event_creation() {
    let event = Event::message("测试消息");
    assert!(matches!(event, Event::Message { .. }));

    let done = Event::done("完成");
    assert!(done.is_terminal());
}

#[test]
fn test_plan_status() {
    let mut plan = Plan::new(
        "测试".to_string(),
        vec![Step::new(
            1,
            "步骤1".to_string(),
            vec![],
            "结果1".to_string(),
        )],
        "build".to_string(),
    );

    assert!(plan.current_step().is_some());
    assert!(!plan.is_done());

    plan.steps[0].mark_completed();
    assert!(plan.is_done());
}

#[test]
fn test_ffi_roundtrip() {
    let handle = sacode_new();
    assert!(!handle.is_null());

    let prompt = CString::new("分析代码结构").expect("create c string");
    let result = unsafe { sacode_execute(handle, prompt.as_ptr(), 0) };
    assert!(!result.is_null());

    let output = unsafe { CStr::from_ptr(result) }
        .to_string_lossy()
        .into_owned();
    assert!(output.contains("steps"));

    unsafe {
        sacode_free_string(result);
        sacode_free(handle);
    }
}

#[test]
fn test_model_rule_pricing_is_backward_compatible() {
    let parsed: ModelRule = serde_json::from_str(
        r#"{
        "name": "gpt-5.4",
        "thinking": false
    }"#,
    )
    .expect("parse model rule");

    assert_eq!(parsed.name, "gpt-5.4");
    assert!(parsed.pricing.is_none());
}
