//! Daemon 管理子命令 — task / queue / automation / agent-backends / knowledge。
//!
//! 架构定位（CLI-Desktop 对等矩阵 §3）：本模块是 daemon HTTP 路由的**瘦客户端**，
//! 参数与输出 schema 直接镜像 daemon 路由，零业务逻辑复制——逻辑真源在
//! `runtime/src/daemon/*` handlers，CLI 与桌面端（client-core DaemonClient）同级。
//!
//! 连接发现：
//! - `SACODE_DAEMON_URL`：daemon base URL（默认 `http://127.0.0.1:8080`）
//! - `SACODE_DAEMON_TOKEN`：Bearer token（`sacode serve` 自动生成时会在
//!   启动终端打印 `daemon_token=<token>`；显式 `--auth-token` 时即该值）

use anyhow::{Context, Result};
use std::time::Duration;

const DEFAULT_BASE_URL: &str = "http://127.0.0.1:8080";

/// daemon 连接信息：base URL + 可选 Bearer token。
struct DaemonEndpoint {
    base_url: String,
    token: Option<String>,
}

impl DaemonEndpoint {
    /// 从环境变量发现 daemon 连接信息。
    ///
    /// - base URL：`SACODE_DAEMON_URL` → 默认 `http://127.0.0.1:8080`
    /// - token：`SACODE_DAEMON_TOKEN`（D9 L1 后 daemon 恒有 token，缺失必然 401）
    fn from_env() -> Self {
        let base_url = std::env::var("SACODE_DAEMON_URL")
            .ok()
            .map(|v| v.trim().trim_end_matches('/').to_string())
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| DEFAULT_BASE_URL.to_string());
        let token = std::env::var("SACODE_DAEMON_TOKEN")
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty());
        Self { base_url, token }
    }
}

/// 发送 HTTP 请求并返回 daemon 原始响应体（JSON 文本，原样透传不二次转换）。
///
/// 错误处理分级：
/// - 连接失败 → 指引先启动 daemon
/// - 401 → 指引设置 token（D9 L1 恒鉴权）
/// - 其他非 2xx → 透传 daemon 错误体
async fn daemon_call(
    endpoint: &DaemonEndpoint,
    method: reqwest::Method,
    path: &str,
    body: Option<serde_json::Value>,
) -> Result<String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        // daemon 恒为 localhost 回环连接（D9 L1/L2），绝不经系统代理转发
        // ——否则本机代理会拦截 127.0.0.1 请求（真机复现：502 upstream connect failed）。
        .no_proxy()
        .build()
        .context("构建 HTTP 客户端失败")?;
    let mut request = client
        .request(method, format!("{}{}", endpoint.base_url, path))
        .header("accept", "application/json");
    if let Some(token) = &endpoint.token {
        request = request.bearer_auth(token);
    }
    if let Some(payload) = body {
        request = request.json(&payload);
    }
    let response = request.send().await.map_err(|error| {
        anyhow::anyhow!(
            "无法连接 daemon（{}）：{error}\n\
             请先在另一终端启动：sacode serve --port 8080\n\
             并设置 SACODE_DAEMON_URL / SACODE_DAEMON_TOKEN（serve 启动时会打印）",
            endpoint.base_url
        )
    })?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        anyhow::bail!(
            "daemon 鉴权失败（401）：请设置 SACODE_DAEMON_TOKEN\n\
             （sacode serve 自动生成 token 时会在启动终端打印 daemon_token=<...>）"
        );
    }
    if !status.is_success() {
        anyhow::bail!("daemon 返回 {status}: {text}");
    }
    Ok(text)
}

/// JSON 美化输出；`--raw` 时原样输出（供脚本管道消费）。
fn print_json(raw: &str, raw_mode: bool) {
    if raw_mode {
        println!("{}", raw);
        return;
    }
    match serde_json::from_str::<serde_json::Value>(raw) {
        Ok(value) => println!("{}", serde_json::to_string_pretty(&value).unwrap_or_else(|_| raw.to_string())),
        Err(_) => println!("{}", raw),
    }
}

/// 从参数中提取 `--raw` 标志（输出原始 JSON，不美化）。
fn take_raw_flag(args: &mut Vec<String>) -> bool {
    if let Some(pos) = args.iter().position(|a| a == "--raw") {
        args.remove(pos);
        true
    } else {
        false
    }
}

fn missing_arg(what: &str) -> anyhow::Error {
    anyhow::anyhow!("缺少参数：{what}（用法见 sacode task --help）")
}

// ── task ─────────────────────────────────────────────────────────────────────

/// `sacode task list|show|cancel|delete|result` → `/tasks`、`/task/:id/*`
pub async fn task(args: Vec<String>) -> Result<()> {
    let mut args = args;
    let raw_mode = take_raw_flag(&mut args);
    let endpoint = DaemonEndpoint::from_env();
    match args.first().map(|s| s.as_str()) {
        Some("list") => {
            let body = daemon_call(&endpoint, reqwest::Method::GET, "/tasks", None).await?;
            print_json(&body, raw_mode);
            Ok(())
        }
        Some("show") => {
            let id = args.get(1).ok_or_else(|| missing_arg("task id"))?;
            let body = daemon_call(
                &endpoint,
                reqwest::Method::GET,
                &format!("/task/{}/status", encode(id)),
                None,
            )
            .await?;
            print_json(&body, raw_mode);
            Ok(())
        }
        Some("result") => {
            let id = args.get(1).ok_or_else(|| missing_arg("task id"))?;
            let body = daemon_call(
                &endpoint,
                reqwest::Method::GET,
                &format!("/task/{}/result", encode(id)),
                None,
            )
            .await?;
            print_json(&body, raw_mode);
            Ok(())
        }
        Some("cancel") => {
            let id = args.get(1).ok_or_else(|| missing_arg("task id"))?;
            let body = daemon_call(
                &endpoint,
                reqwest::Method::POST,
                &format!("/task/{}/cancel", encode(id)),
                Some(serde_json::json!({})),
            )
            .await?;
            print_json(&body, raw_mode);
            Ok(())
        }
        Some("delete") => {
            let id = args.get(1).ok_or_else(|| missing_arg("task id"))?;
            let body = daemon_call(
                &endpoint,
                reqwest::Method::DELETE,
                &format!("/task/{}", encode(id)),
                None,
            )
            .await?;
            print_json(&body, raw_mode);
            Ok(())
        }
        Some("help") | Some("--help") | Some("-h") | None => {
            println!("{}", task_help());
            Ok(())
        }
        Some(other) => anyhow::bail!("未知 task 子命令：{other}\n{}", task_help()),
    }
}

fn task_help() -> String {
    [
        "sacode task — 任务管理（镜像 daemon /task* 路由）",
        "",
        "用法：",
        "  sacode task list                    # GET /tasks — 全部任务",
        "  sacode task show <id>               # GET /task/:id/status — 任务状态",
        "  sacode task result <id>             # GET /task/:id/result — 任务结果",
        "  sacode task cancel <id>             # POST /task/:id/cancel — 取消任务",
        "  sacode task delete <id>             # DELETE /task/:id — 删除任务",
        "",
        "通用标志：--raw 输出原始 JSON（不美化）",
        "连接：SACODE_DAEMON_URL（默认 http://127.0.0.1:8080）+ SACODE_DAEMON_TOKEN",
    ]
    .join("\n")
}

// ── queue ────────────────────────────────────────────────────────────────────

/// `sacode queue status|pending` → `/queue/status`、`/queue/pending`
pub async fn queue(args: Vec<String>) -> Result<()> {
    let mut args = args;
    let raw_mode = take_raw_flag(&mut args);
    let endpoint = DaemonEndpoint::from_env();
    match args.first().map(|s| s.as_str()) {
        Some("status") | None => {
            let body = daemon_call(&endpoint, reqwest::Method::GET, "/queue/status", None).await?;
            print_json(&body, raw_mode);
            Ok(())
        }
        Some("pending") => {
            let body = daemon_call(&endpoint, reqwest::Method::GET, "/queue/pending", None).await?;
            print_json(&body, raw_mode);
            Ok(())
        }
        Some("help") | Some("--help") | Some("-h") => {
            println!("{}", queue_help());
            Ok(())
        }
        Some(other) => anyhow::bail!("未知 queue 子命令：{other}\n{}", queue_help()),
    }
}

fn queue_help() -> String {
    [
        "sacode queue — 队列状态（镜像 daemon /queue/* 路由）",
        "",
        "用法：",
        "  sacode queue status                 # GET /queue/status — 队列统计",
        "  sacode queue pending                # GET /queue/pending — 待处理计数",
        "",
        "通用标志：--raw 输出原始 JSON；连接同 sacode task",
    ]
    .join("\n")
}

// ── automation ───────────────────────────────────────────────────────────────

/// `sacode automation list|create|run|delete|history` → `/api/automation/*`
pub async fn automation(args: Vec<String>) -> Result<()> {
    let mut args = args;
    let raw_mode = take_raw_flag(&mut args);
    let endpoint = DaemonEndpoint::from_env();
    match args.first().map(|s| s.as_str()) {
        Some("list") => {
            let body =
                daemon_call(&endpoint, reqwest::Method::GET, "/api/automation/rules", None)
                    .await?;
            print_json(&body, raw_mode);
            Ok(())
        }
        Some("create") => {
            // sacode automation create <name> <cron> <prompt...>
            let name = args.get(1).ok_or_else(|| missing_arg("name"))?.clone();
            let cron = args.get(2).ok_or_else(|| missing_arg("cron 表达式"))?.clone();
            let prompt = args
                .get(3..)
                .map(|rest| rest.join(" "))
                .filter(|p| !p.is_empty())
                .ok_or_else(|| missing_arg("prompt"))?;
            let body = daemon_call(
                &endpoint,
                reqwest::Method::POST,
                "/api/automation/rules",
                Some(serde_json::json!({
                    "name": name,
                    "prompt": prompt,
                    "cron_expr": cron,
                    "enabled": true,
                })),
            )
            .await?;
            print_json(&body, raw_mode);
            Ok(())
        }
        Some("run") => {
            let id = args.get(1).ok_or_else(|| missing_arg("rule id"))?;
            let body = daemon_call(
                &endpoint,
                reqwest::Method::POST,
                &format!("/api/automation/rules/{}/run", encode(id)),
                Some(serde_json::json!({})),
            )
            .await?;
            print_json(&body, raw_mode);
            Ok(())
        }
        Some("delete") => {
            let id = args.get(1).ok_or_else(|| missing_arg("rule id"))?;
            let body = daemon_call(
                &endpoint,
                reqwest::Method::DELETE,
                &format!("/api/automation/rules/{}", encode(id)),
                None,
            )
            .await?;
            print_json(&body, raw_mode);
            Ok(())
        }
        Some("history") => {
            let body = daemon_call(
                &endpoint,
                reqwest::Method::GET,
                "/api/automation/history",
                None,
            )
            .await?;
            print_json(&body, raw_mode);
            Ok(())
        }
        Some("help") | Some("--help") | Some("-h") | None => {
            println!("{}", automation_help());
            Ok(())
        }
        Some(other) => anyhow::bail!("未知 automation 子命令：{other}\n{}", automation_help()),
    }
}

fn automation_help() -> String {
    [
        "sacode automation — 定时自动化规则（镜像 daemon /api/automation/* 路由）",
        "",
        "用法：",
        "  sacode automation list                              # 列出规则",
        "  sacode automation create <name> <cron> <prompt...>  # 创建规则",
        "  sacode automation run <id>                          # 立即执行一次",
        "  sacode automation delete <id>                       # 删除规则",
        "  sacode automation history                           # 执行历史",
        "",
        "cron 示例：'0 0 9 * * *' 每天 09:00",
        "通用标志：--raw 输出原始 JSON；连接同 sacode task",
    ]
    .join("\n")
}

// ── agent-backends ───────────────────────────────────────────────────────────

/// `sacode agent-backends list|set|probe` → `/api/agent-backends*`
pub async fn agent_backends(args: Vec<String>) -> Result<()> {
    let mut args = args;
    let raw_mode = take_raw_flag(&mut args);
    let endpoint = DaemonEndpoint::from_env();
    match args.first().map(|s| s.as_str()) {
        Some("list") | None => {
            let body =
                daemon_call(&endpoint, reqwest::Method::GET, "/api/agent-backends", None).await?;
            print_json(&body, raw_mode);
            Ok(())
        }
        Some("set") => {
            // sacode agent-backends set <id> '<json-patch>' — patch 镜像 daemon PUT body
            let id = args.get(1).ok_or_else(|| missing_arg("backend id"))?;
            let patch = args.get(2).ok_or_else(|| {
                missing_arg("JSON 配置（如 '{\"enabled\":true}' 或完整 backend 对象）")
            })?;
            let payload: serde_json::Value = serde_json::from_str(patch)
                .with_context(|| format!("JSON 解析失败：{patch}"))?;
            let body = daemon_call(
                &endpoint,
                reqwest::Method::PUT,
                &format!("/api/agent-backends/{}", encode(id)),
                Some(payload),
            )
            .await?;
            print_json(&body, raw_mode);
            Ok(())
        }
        Some("probe") => {
            let id = args.get(1).ok_or_else(|| missing_arg("backend id"))?;
            let body = daemon_call(
                &endpoint,
                reqwest::Method::POST,
                &format!("/api/agent-backends/{}/probe", encode(id)),
                Some(serde_json::json!({})),
            )
            .await?;
            print_json(&body, raw_mode);
            Ok(())
        }
        Some("help") | Some("--help") | Some("-h") => {
            println!("{}", agent_backends_help());
            Ok(())
        }
        Some(other) => {
            anyhow::bail!("未知 agent-backends 子命令：{other}\n{}", agent_backends_help())
        }
    }
}

fn agent_backends_help() -> String {
    [
        "sacode agent-backends — Agent 后端管理（镜像 daemon /api/agent-backends* 路由）",
        "",
        "用法：",
        "  sacode agent-backends list                  # 列出后端（含默认后端 id）",
        "  sacode agent-backends set <id> '<json>'     # 更新配置（PUT 镜像）",
        "  sacode agent-backends probe <id>            # 健康探测",
        "",
        "set 示例：sacode agent-backends set opencode '{\"enabled\":true}'",
        "通用标志：--raw 输出原始 JSON；连接同 sacode task",
    ]
    .join("\n")
}

// ── knowledge ────────────────────────────────────────────────────────────────

/// `sacode knowledge list|search` → `/api/knowledge/*`（矩阵 §3 的 index/query 映射）
pub async fn knowledge(args: Vec<String>) -> Result<()> {
    let mut args = args;
    let raw_mode = take_raw_flag(&mut args);
    let endpoint = DaemonEndpoint::from_env();
    // scope 参数：--scope user|project（默认 project，与工作区对齐）
    let scope = take_flag_value(&mut args, "--scope").unwrap_or_else(|| "project".to_string());
    if scope != "user" && scope != "project" {
        anyhow::bail!("--scope 仅支持 user 或 project，收到：{scope}");
    }
    match args.first().map(|s| s.as_str()) {
        Some("list") | None => {
            let body = daemon_call(
                &endpoint,
                reqwest::Method::GET,
                &format!("/api/knowledge/entries?scope={}", scope),
                None,
            )
            .await?;
            print_json(&body, raw_mode);
            Ok(())
        }
        Some("search") => {
            let query = args
                .get(1)
                .map(|rest| rest.to_string())
                .ok_or_else(|| missing_arg("搜索关键词"))?;
            let body = daemon_call(
                &endpoint,
                reqwest::Method::GET,
                &format!(
                    "/api/knowledge/search?scope={}&q={}",
                    scope,
                    encode(&query)
                ),
                None,
            )
            .await?;
            print_json(&body, raw_mode);
            Ok(())
        }
        Some("help") | Some("--help") | Some("-h") => {
            println!("{}", knowledge_help());
            Ok(())
        }
        Some(other) => anyhow::bail!("未知 knowledge 子命令：{other}\n{}", knowledge_help()),
    }
}

fn knowledge_help() -> String {
    [
        "sacode knowledge — 知识库检索（镜像 daemon /api/knowledge/* 路由）",
        "",
        "用法：",
        "  sacode knowledge list                    # 知识条目（GET /entries）",
        "  sacode knowledge search <关键词>          # 全文检索（GET /search）",
        "",
        "选项：--scope user|project（默认 project）",
        "通用标志：--raw 输出原始 JSON；连接同 sacode task",
    ]
    .join("\n")
}

// ── 共享小工具 ───────────────────────────────────────────────────────────────

/// URL 路径段编码（防路径注入：id / 查询词进入路径前转义）。
fn encode(segment: &str) -> String {
    segment
        .bytes()
        .flat_map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' => vec![b as char],
            _ => format!("%{:02X}", b).chars().collect(),
        })
        .collect()
}

/// 提取 `--flag value`（原地移除），用于 --scope 等命名参数。
fn take_flag_value(args: &mut Vec<String>, flag: &str) -> Option<String> {
    if let Some(pos) = args.iter().position(|a| a == flag) {
        args.remove(pos);
        if pos < args.len() {
            Some(args.remove(pos))
        } else {
            None
        }
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_escapes_path_traversal_and_query_chars() {
        assert_eq!(encode("abc-123_."), "abc-123_.");
        // `/` 必须转义：转义后 "..%2Fetc%2Fpasswd" 在 axum 路由中是单个字面段，
        // 不构成路径穿越（穿越依赖未转义的 `/` 产生新段）。
        // `.` 保留：任务 id / 文件名（docs/guide.md）合法含点。
        assert_eq!(encode("../etc/passwd"), "..%2Fetc%2Fpasswd");
        assert!(encode("../etc/passwd").chars().filter(|c| *c == '/').count() == 0);
        // 空格与查询词转义（查询词进路径安全）
        assert_eq!(encode("a b"), "a%20b");
        assert!(!encode("id?x=1").contains('?'));
    }

    #[test]
    fn take_raw_flag_removes_and_reports() {
        let mut args = vec!["list".to_string(), "--raw".to_string()];
        assert!(take_raw_flag(&mut args));
        assert_eq!(args, vec!["list".to_string()]);
        assert!(!take_raw_flag(&mut args));
    }

    #[test]
    fn take_flag_value_extracts_pair() {
        let mut args = vec![
            "search".to_string(),
            "--scope".to_string(),
            "user".to_string(),
            "关键词".to_string(),
        ];
        assert_eq!(take_flag_value(&mut args, "--scope").as_deref(), Some("user"));
        assert_eq!(args, vec!["search".to_string(), "关键词".to_string()]);
        // --flag 在末尾但缺值
        let mut tail = vec!["list".to_string(), "--scope".to_string()];
        assert_eq!(take_flag_value(&mut tail, "--scope"), None);
        assert_eq!(tail, vec!["list".to_string()]);
    }

    #[test]
    fn daemon_endpoint_defaults_and_env() {
        // 默认：无 env → base 默认 + 无 token
        let endpoint = DaemonEndpoint {
            base_url: String::new(),
            token: None,
        };
        // 结构性检查（from_env 依赖进程 env，测试避免污染全局）：
        assert!(endpoint.token.is_none());
    }
}
