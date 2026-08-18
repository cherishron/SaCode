//! 默认工具拦截器 — 等价于原 `sandbox_guard` 行为
//!
//! 把原 `sandbox_guard::preflight` / `audit_execution_result` 的检查逻辑
//! 拆为独立 [`ToolInterceptor`] 实现，保证拦截器链默认注册后的行为与
//! 改造前完全一致（向后兼容）。
//!
//! 拦截器拆分：
//! - [`NetworkPolicyInterceptor`]：网络访问策略检查
//! - [`TaskSpawnInterceptor`]：`task.spawn` 权限检查
//! - [`CommandPolicyInterceptor`]：命令黑名单检查
//! - [`PathPolicyInterceptor`]：路径访问检查
//! - [`AuditInterceptor`]：执行前后审计 + 发布事件到 `SessionEventLog`

use anyhow::Result;
use serde_json::Value;

use crate::session::event_log::{SessionEventLog, SessionEventType};
use crate::tools::interceptor::{InterceptContext, PostExecuteDecision, PreExecuteDecision, ToolInterceptor};
use crate::tools::sandbox_guard::{
    audit_network_blocked, audit_path_blocked, audit_preflight_allowed, audit_preflight_start,
    audit_command_blocked, audit_task_spawn_blocked, extract_command, extract_paths,
    path_access_for_tool, required_network_access,
};
use crate::tools::sandbox_guard::{should_audit as sg_should_audit};
use crate::tools::{ToolOutput, ToolSpec};

/// 网络访问策略拦截器
pub struct NetworkPolicyInterceptor;

impl ToolInterceptor for NetworkPolicyInterceptor {
    fn name(&self) -> &'static str {
        "network_policy"
    }

    fn pre_execute(
        &self,
        spec: &ToolSpec,
        input: &Value,
        _ctx: &InterceptContext,
    ) -> PreExecuteDecision {
        let policy = crate::sandbox::active_policy();
        if let Some(network_access) = required_network_access(&spec.name, input) {
            if !policy.check_network(network_access) {
                audit_network_blocked(&spec.name, input);
                return PreExecuteDecision::Deny {
                    reason: "network access blocked by sandbox policy".to_string(),
                };
            }
        }
        PreExecuteDecision::Allow
    }
}

/// task.spawn 权限拦截器
pub struct TaskSpawnInterceptor;

impl ToolInterceptor for TaskSpawnInterceptor {
    fn name(&self) -> &'static str {
        "task_spawn"
    }

    fn pre_execute(
        &self,
        spec: &ToolSpec,
        input: &Value,
        _ctx: &InterceptContext,
    ) -> PreExecuteDecision {
        if spec.name == "task.spawn" {
            let policy = crate::sandbox::active_policy();
            if !policy.check_task_spawn() {
                audit_task_spawn_blocked(&spec.name, input);
                return PreExecuteDecision::Deny {
                    reason: "task spawn blocked by sandbox policy".to_string(),
                };
            }
        }
        PreExecuteDecision::Allow
    }
}

/// 命令黑名单拦截器
pub struct CommandPolicyInterceptor;

impl ToolInterceptor for CommandPolicyInterceptor {
    fn name(&self) -> &'static str {
        "command_policy"
    }

    fn pre_execute(
        &self,
        spec: &ToolSpec,
        input: &Value,
        _ctx: &InterceptContext,
    ) -> PreExecuteDecision {
        if let Some(command) = extract_command(&spec.name, input) {
            let policy = crate::sandbox::active_policy();
            if !policy.check_command(&command) {
                audit_command_blocked(&spec.name, input, &command);
                return PreExecuteDecision::Deny {
                    reason: format!("command '{}' is blocked by sandbox policy", command),
                };
            }
        }
        PreExecuteDecision::Allow
    }
}

/// 路径访问拦截器
pub struct PathPolicyInterceptor;

impl ToolInterceptor for PathPolicyInterceptor {
    fn name(&self) -> &'static str {
        "path_policy"
    }

    fn pre_execute(
        &self,
        spec: &ToolSpec,
        input: &Value,
        _ctx: &InterceptContext,
    ) -> PreExecuteDecision {
        let path_access = path_access_for_tool(&spec.name);
        for path in extract_paths(input) {
            let resolved = if path.is_absolute() {
                path
            } else {
                match std::env::current_dir() {
                    Ok(cwd) => cwd.join(path),
                    Err(_) => path,
                }
            };

            let policy = crate::sandbox::active_policy();
            if !policy.check_path(&resolved, path_access) {
                audit_path_blocked(&spec.name, input, &resolved);
                return PreExecuteDecision::Deny {
                    reason: "path is blocked by sandbox policy".to_string(),
                };
            }
        }
        PreExecuteDecision::Allow
    }
}

/// 审计拦截器 — 执行前后写 `audit.log` 并发布事件到 `SessionEventLog`
///
/// 等价原 `sandbox_guard::audit_execution_result` 的审计行为，
/// 额外把工具调用事件持久化到 `.sacode/events.log`（§3.1 事件流投影第一步）。
pub struct AuditInterceptor;

impl ToolInterceptor for AuditInterceptor {
    fn name(&self) -> &'static str {
        "audit"
    }

    fn pre_execute(
        &self,
        spec: &ToolSpec,
        input: &Value,
        ctx: &InterceptContext,
    ) -> PreExecuteDecision {
        if sg_should_audit(spec) {
            audit_preflight_start(&spec.name, input);
            audit_preflight_allowed(&spec.name, input);
            // 发布 ToolCallStarted 事件到持久化事件流
            SessionEventLog::global().record(
                &ctx.session_id,
                SessionEventType::ToolCallStarted,
                serde_json::json!({
                    "tool": spec.name,
                    "input": input,
                }),
            );
        }
        PreExecuteDecision::Allow
    }

    fn post_execute(
        &self,
        spec: &ToolSpec,
        input: &Value,
        output: Option<&ToolOutput>,
        error: Option<&str>,
        ctx: &InterceptContext,
    ) -> PostExecuteDecision {
        if !sg_should_audit(spec) {
            return PostExecuteDecision::Keep;
        }

        let status = if error.is_some() {
            "error"
        } else if output.is_some_and(|r| r.success) {
            "success"
        } else {
            "failure"
        };

        // 构造审计 extra（与原 `audit_execution_result` 一致）
        let result_payload = output.map(|r| {
            serde_json::json!({
                "success": r.success,
                "message": r.message,
                "data": r.data,
            })
        });
        let extra = match (result_payload, error) {
            (Some(payload), Some(message)) => {
                serde_json::json!({ "result": payload, "error": message })
            }
            (Some(payload), None) => serde_json::json!({ "result": payload }),
            (None, Some(message)) => serde_json::json!({ "error": message }),
            (None, None) => Value::Null,
        };

        // 原 audit.log 行为（直接写审计日志，避免回调 AuditInterceptor 造成递归）
        crate::tools::sandbox_guard::write_audit_log(
            &spec.name,
            "execution",
            status,
            Some(input),
            Some(extra.clone()),
        );

        // 发布 ToolCallFinished 事件到持久化事件流（§3.1）
        SessionEventLog::global().record(
            &ctx.session_id,
            SessionEventType::ToolCallFinished,
            serde_json::json!({
                "tool": spec.name,
                "input": input,
                "status": status,
                "extra": extra,
            }),
        );

        PostExecuteDecision::Keep
    }
}

/// 构建默认拦截器链（等价于原 `sandbox_guard` 行为）
///
/// 顺序：审计(preflight_start) → 网络 → task.spawn → 命令 → 路径 → 执行 → 审计(result)
/// 注意审计拦截器同时处理 pre/post，放在链首确保 preflight_start 最先记录。
pub fn default_interceptors() -> Vec<Box<dyn ToolInterceptor>> {
    vec![
        Box::new(AuditInterceptor),
        Box::new(NetworkPolicyInterceptor),
        Box::new(TaskSpawnInterceptor),
        Box::new(CommandPolicyInterceptor),
        Box::new(PathPolicyInterceptor),
    ]
}

/// 供 `sandbox_guard::preflight` 向后兼容入口使用：若某拦截器 Deny，返回其 reason
pub fn run_preflight_chain(
    spec: &ToolSpec,
    input: &Value,
    ctx: &InterceptContext,
    interceptors: &[Box<dyn ToolInterceptor>],
) -> Result<Value> {
    let mut current_input = input.clone();
    for interceptor in interceptors {
        match interceptor.pre_execute(spec, &current_input, ctx) {
            PreExecuteDecision::Allow => {}
            PreExecuteDecision::Deny { reason } => {
                // 发布 ToolCallDenied 事件
                if sg_should_audit(spec) {
                    SessionEventLog::global().record(
                        &ctx.session_id,
                        SessionEventType::ToolCallDenied,
                        serde_json::json!({
                            "tool": spec.name,
                            "input": &current_input,
                            "reason": reason,
                        }),
                    );
                }
                anyhow::bail!(reason);
            }
            PreExecuteDecision::Modify { new_input } => {
                current_input = new_input;
            }
        }
    }
    Ok(current_input)
}
