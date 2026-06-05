## 用户需求

基于 SaCode 与 7 款竞品（Claude Code、Codex CLI、OpenCode、CodeBuddy Code、KimiCode、iFlow CLI、QwenCode）的全维度对比分析，给出从当前状态到功能完整态的完整升级方案。

## 核心目标

1. 修复 2 项阻断性缺陷（max_iterations=1、搜索引擎单点故障）
2. 补齐 4 项核心功能缺口（git.commit、test.run、fs.patch、代码库语义理解）
3. 激活 5 项架构就绪但未暴露的能力（Sub-agents入口、沙箱审计日志、hit_round_limit不短路/loop、SSE流式输出、内置MCP server）
4. 补齐 1 项生态能力（多模态图片输入）

## 预期效果

- 工具数从 17 个增至 23 个
- max_iterations 默认从 1 升至 3，反思循环激活
- 搜索引擎支持 DuckDuckGo + web.fetch 降级链
- 代码库理解从盲人摸象变为符号索引 + 依赖图
- SSE 流式实时输出，不再等待完整结果

## 技术栈

### 现有技术栈（不改变）

- **语言**: Rust 2021 edition，rust-version 1.75
- **架构**: kernel（纯逻辑）→ runtime（副作用/工具/Agent）→ interfaces（CLI/TUI/LSP/ACP）
- **TUI**: ratatui 0.29 + crossterm 0.28
- **HTTP**: reqwest 0.12（rustls-tls, blocking）
- **异步**: tokio + async-stream + futures
- **持久化**: rusqlite 0.32（bundled SQLite）
- **序列化**: serde + serde_json
- **插件**: extism 1.0

### 新增依赖（仅 runtime/Cargo.toml）

```
similar = "2"                      # diff/patch 应用（轻量纯 Rust）
tree-sitter = "0.24"               # AST 解析核心
tree-sitter-rust = "0.23"          # Rust grammar
tree-sitter-python = "0.23"        # Python grammar
tree-sitter-javascript = "0.23"    # JavaScript grammar
tree-sitter-typescript = "0.23"    # TypeScript grammar
tree-sitter-go = "0.23"            # Go grammar
```

### 工具注册变更

```rust
// runtime/src/tools/mod.rs builtin() 新增 6 个:
registry.register_fn(git::commit::spec(), git::commit::execute);
registry.register_fn(test::runner::spec(), test::runner::execute);
registry.register_fn(fs::patch::spec(), fs::patch::execute);
registry.register_fn(code::symbol::spec(), code::symbol::execute);
registry.register_fn(code::deps::spec(), code::deps::execute);
registry.register_fn(media::vision::spec(), media::vision::execute);
// 17 → 23 个内置工具
```

## 实现方案

### 第 0 批：阻断性修复（1 天，3 文件，~20 行改动）

**0.1 max_iterations 三重修复**

| 文件 | 位置 | 当前 | 改为 |
| --- | --- | --- | --- |
| `interfaces/cli/src/cmd/config.rs` | 第 680 行 | `max_iterations: 1` | `max_iterations: 3` |
| `interfaces/cli/src/tui/task_runtime.rs` | 第 222-227 行 | `unwrap_or(6)` 对 Option 不生效 | 提取 `raw` 后 `.max(3)` 对值做硬下限 |
| `interfaces/cli/src/repl.rs` | 第 183 行 | `unwrap_or(1)` | `unwrap_or(3)` |


核心修复逻辑：

```rust
// task_runtime.rs 原有代码：
let effective = config::effective_config(workdir).ok();
let max_iterations = effective
    .as_ref()
    .map(|value| value.max_iterations)
    .unwrap_or(6)    // ← effective_config 永远返回 Some，此行从未触发
    .max(1)
    .to_string();

// 修复后：
let effective = config::effective_config(workdir).ok();
let raw = effective
    .as_ref()
    .map(|value| value.max_iterations)
    .unwrap_or(6);
let max_iterations = raw.max(3).max(1).to_string();
//  ^^^^^^^^^^^^ 硬下限 3，确保 ReAct 反思循环至少 3 轮
```

**0.2 搜索引擎 Multi-Provider Fallback**

文件：`runtime/src/tools/web/search.rs`

改动方案：

1. 新增 `try_search()` 内部函数，封装 DuckDuckGo 单次请求
2. `execute()` 中先尝试 DuckDuckGo，失败后自动调用 `super::fetch::execute()` 直接抓取百度/必应搜索结果页作为降级
3. 最终失败返回友好错误消息，不再暴露 DNS 超时堆栈
4. 无需新增 crate 依赖，复用现有 `send_with_retries` 和 `web.fetch`

### 第 1 批：核心功能补齐（4 天，4 文件，~500 行）

**1.1 git.commit 工具**

文件：`runtime/src/tools/git/commit.rs`（扩展现有空壳 `pub struct GitCommitTool;`）

实现要点：

- 用 `std::process::Command` 调用 `git add -A` + `git commit -m`
- 先检查 `git status --porcelain` 确保有变更
- commit message 自动生成：获取 `git diff --staged` 内容，注入 prompt 让 LLM 生成
- 输出 `commit_hash`（前 8 位）+ `message`
- SideEffectLevel::Modify，approval_required: true
- 同步更新 `sandbox_guard.rs` extract_command() 支持 `git.commit`

**1.2 test.run 工具**

新增文件：`runtime/src/tools/test/runner.rs` + `mod.rs`

实现要点：

- 自动检测框架：Cargo.toml → `cargo test`，package.json+jest → `npm test`，go.mod → `go test`，pyproject.toml → `pytest`
- 参数：`target`（可选）、`filter`（可选）、`framework`（手动指定）
- 输出：passed/failed 计数、failures 详情数组、stdout
- timeout: 120s，SideEffectLevel::ReadOnly，无需审批

**1.3 fs.patch 精确 Diff 编辑**

新增文件：`runtime/src/tools/fs/patch.rs`

实现要点：

- 使用 `similar` crate 解析和应用 unified diff
- 输入：`patches` 数组，每项 `{path, diff}`
- 执行：读取原文 → 应用 patch → 写回
- 支持多文件批量修改
- SideEffectLevel::Modify，需要审批

### 第 2 批：代码智能（5 天，3 文件，~400 行）

**2.1 code.symbols 符号提取**

文件：`runtime/src/tools/code/symbol.rs`（扩展现有空壳）

实现要点：

- 使用 `tree-sitter` 解析 Rust/Python/JavaScript/TypeScript/Go
- 用 Query 匹配函数、结构体、类、方法、接口定义
- 提取符号名、类型、文件路径、行号、签名预览
- SideEffectLevel::ReadOnly，无需审批

**2.2 code.deps 依赖关系图**

新增文件：`runtime/src/tools/code/deps.rs`

实现要点：

- 递归扫描工作区源码文件
- 用 regex + tree-sitter 提取 import/use/include
- 构建双向依赖图（imports + imported_by）
- SideEffectLevel::ReadOnly，无需审批

### 第 3 批：架构激活（3 天，4 文件，~300 行）

**3.1 Sub-agents 用户入口**

文件：`interfaces/cli/src/tui/mode_actions.rs`

实现要点：

- 新增 `/agents` 命令，展示可用的内置角色（planner/coder/reviewer/tester）
- 含 `/loop` 前缀的复杂任务自动走 `execute_role_driven_orchestration` 路径

**3.2 沙箱审计日志**

文件：`runtime/src/tools/sandbox_guard.rs`

实现要点：

- `preflight()` 中所有 fs.write/edit 操作记录到 `.sacode/audit.log`
- 格式：`[timestamp] tool=fs.write path=... result=allowed`

**3.3 hit_round_limit 不短路 /loop**

文件：`interfaces/cli/src/tui/async_actions.rs` 第 280-291 行

实现要点：

- 移除 `hit_round_limit` 处的直接 `return`
- 改为继续下一轮循环，注入缩小任务范围的提示信息
- 错误计数器正常递增，3 次连续失败才真正停止

**3.4 SSE 流式输出**

文件：`runtime/src/streaming/sse.rs`（扩展现有空壳）

实现要点：

- 基于现有 Axum 0.7 框架实现 `GET /api/stream` endpoint
- 复用 `StreamChunk` 数据结构
- 挂载到现有 Daemon HTTP API（`runtime/src/daemon/`）

### 第 4 批：生态建设（4 天，3 文件，~300 行）

**4.1 内置 MCP Server**

新增目录：`runtime/src/mcp/servers/`，含 `filesystem.rs`、`git.rs`

实现要点：

- 实现 MCP stdio 协议本地 server
- `mcp.server.filesystem`：包装 fs.* 工具
- `mcp.server.git`：包装 git.* 工具
- 可与现有 `mcp/mod.rs` 的 remote 协议互补

**4.2 多模态图片输入**

新增文件：`runtime/src/tools/media/vision.rs`

实现要点：

- 读取本地图片文件，base64 编码
- 传递给支持多模态的模型使用
- 复用 `media/read.rs` 现有基础

## 遗漏与可升级项检查结果

经过逐项与竞品对比和代码审查，确认以下也已发现并纳入方案：

| 序号 | 遗漏项 | 状态 |
| --- | --- | --- |
| 1 | SseStream 空壳（streaming/sse.rs） | 第 3.4 批实现 |
| 2 | sandbox 审计日志缺失 | 第 3.2 批实现 |
| 3 | git.commit 的 sandbox_guard 未更新 | 第 1.1 批附带修复 |
| 4 | shell.exec 的 Unix 命令依赖（AGENTS.md 已知限制） | 本次不做大改（风险大），但 test.run/git.commit 使用 Rust 原生替代 shell |
| 5 | fs.search 的 Unix grep 依赖 | 纳入后续 P2 计划 |