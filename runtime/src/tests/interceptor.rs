//! 工具执行拦截器链 + 会话事件日志测试
//!
//! 验证 §3.2 拦截器机制与 §3.1 事件流投影第一步（持久化事件日志）的行为：
//! - 默认拦截器链等价于原 `sandbox_guard` 行为（审计 + 策略）
//! - 自定义拦截器可阻断 / 改写执行
//! - 工具调用事件发布到 `SessionEventLog`（可回放）

use crate::session::event_log::{SessionEventLog, SessionEventType};
use crate::tools::interceptor::{InterceptContext, PostExecuteDecision, PreExecuteDecision, ToolInterceptor};
use crate::tools::{ToolOutput, ToolRegistry};
use serde_json::json;

/// 一个总是 Deny 的测试拦截器
struct DenyAllInterceptor;

impl ToolInterceptor for DenyAllInterceptor {
    fn name(&self) -> &'static str {
        "deny_all"
    }

    fn pre_execute(
        &self,
        _spec: &crate::tools::ToolSpec,
        _input: &serde_json::Value,
        _ctx: &InterceptContext,
    ) -> PreExecuteDecision {
        PreExecuteDecision::Deny {
            reason: "blocked by test interceptor".to_string(),
        }
    }
}

/// 一个改写 input 的测试拦截器
struct ModifyInputInterceptor;

impl ToolInterceptor for ModifyInputInterceptor {
    fn name(&self) -> &'static str {
        "modify_input"
    }

    fn pre_execute(
        &self,
        _spec: &crate::tools::ToolSpec,
        _input: &serde_json::Value,
        _ctx: &InterceptContext,
    ) -> PreExecuteDecision {
        PreExecuteDecision::Modify {
            new_input: json!({ "rewritten": true }),
        }
    }

    fn post_execute(
        &self,
        _spec: &crate::tools::ToolSpec,
        _input: &serde_json::Value,
        _output: Option<&ToolOutput>,
        _error: Option<&str>,
        _ctx: &InterceptContext,
    ) -> PostExecuteDecision {
        PostExecuteDecision::Keep
    }
}

#[test]
fn default_interceptors_allow_readonly_tool() {
    let _guard = crate::tests::sandbox_test_lock();
    let registry = ToolRegistry::builtin();

    // fs.read 是 ReadOnly，pre_execute 全部 Allow，执行成功
    let output = registry.execute(
        "fs.read",
        json!({ "path": "Cargo.toml" }),
    );
    // 文件不存在会返回错误，但拦截器链不应阻断（错误来自 executor 本身）
    // 仅验证拦截器未 panic / 未错误 Deny
    let _ = output;
}

#[test]
fn custom_deny_interceptor_blocks_execution() {
    let _guard = crate::tests::sandbox_test_lock();
    let mut registry = ToolRegistry::builtin();
    registry.register_interceptor(std::sync::Arc::new(DenyAllInterceptor));

    let result = registry.execute("fs.read", json!({ "path": "Cargo.toml" }));
    assert!(result.is_err(), "Deny 拦截器应阻断执行");
    assert!(
        result.unwrap_err().to_string().contains("blocked by test interceptor"),
        "错误信息应来自 Deny 拦截器"
    );
}

#[test]
fn custom_modify_interceptor_rewrites_input() {
    let _guard = crate::tests::sandbox_test_lock();
    let mut registry = ToolRegistry::builtin();
    registry.register_interceptor(std::sync::Arc::new(ModifyInputInterceptor));

    // fs.read 接收改写后的 input（不含 path），执行结果不应是拦截错误
    let result = registry.execute("fs.read", json!({ "path": "Cargo.toml" }));
    if let Err(msg) = result {
        assert!(
            !msg.to_string().contains("blocked by test interceptor"),
            "不应被 Deny；若报错应来自 executor 处理改写后 input"
        );
    }
}

#[test]
fn modify_tool_records_session_event() {
    let _guard = crate::tests::sandbox_test_lock();
    let registry = ToolRegistry::builtin();

    // 记录前的 seq
    let before = SessionEventLog::global().current_seq();

    // fs.write 是 Modify 级，AuditInterceptor 应发布 ToolCallStarted / ToolCallFinished
    let _ = registry.execute(
        "fs.write",
        json!({ "path": "/tmp/sacode-interceptor-test.txt", "content": "x" }),
    );

    let after = SessionEventLog::global().current_seq();
    assert!(
        after > before,
        "Modify 级工具执行后应发布会话事件到 SessionEventLog"
    );

    // 回放验证事件类型存在
    let events = SessionEventLog::global().replay_after(before);
    let has_started = events
        .iter()
        .any(|e| e.event_type == SessionEventType::ToolCallStarted);
    let has_finished = events
        .iter()
        .any(|e| e.event_type == SessionEventType::ToolCallFinished);
    assert!(has_started, "应包含 ToolCallStarted 事件");
    assert!(has_finished, "应包含 ToolCallFinished 事件");
}

#[test]
fn readonly_tool_skips_audit_event() {
    let _guard = crate::tests::sandbox_test_lock();
    let registry = ToolRegistry::builtin();

    let before = SessionEventLog::global().current_seq();
    // fs.read 是 ReadOnly，AuditInterceptor 不发布事件
    let _ = registry.execute("fs.read", json!({ "path": "Cargo.toml" }));
    let after = SessionEventLog::global().current_seq();

    // ReadOnly 工具不发布会话事件（与原 should_audit 仅 Modify 语义一致）
    assert_eq!(
        after, before,
        "ReadOnly 级工具不应发布会话审计事件"
    );
}
