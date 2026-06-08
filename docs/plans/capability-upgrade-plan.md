## 用户需求

基于 SaCode 与 7 款竞品（Claude Code、Codex CLI、OpenCode、CodeBuddy Code、KimiCode、iFlow CLI、QwenCode）的全维度对比分析，给出从当前状态到功能完整态的完整升级方案。

## 当前状态校准

以下能力已在当前代码中部分或全部落地，本计划已按最新仓库状态去除过时判断：

- `/update rollback` 已实现，CLI、REPL、TUI 文案已接入
- `/loop` 已具备 `hit_round_limit` 透传、上一轮摘要续接、外层轮数配置 `loop_max_iterations`
- `Plan` 模式已支持跳过 `tool_approval` 并追加执行确认提示
- provider SSE 增量解析已在 `runtime/src/provider/client.rs` 中实现
- footer 上下文显示已恢复为圆环加百分比
- 默认值校准已完成：CLI、REPL、TUI 默认内层迭代统一为 `3`
- 核心工具已补齐：`test.run`、`git.commit`、`fs.patch`、`code.symbols`、`code.deps`
- 架构能力暴露已完成：`/agents`、沙箱审计日志、`/loop` 轮次续跑策略、Daemon SSE 输出入口
- 生态能力已完成：`media.vision`、内置 MCP `stdio` server、`sacode mcp serve`
- 能力可发现性已补齐：`status`、`doctor`、API 文档、命令参考均已同步

当前主线能力已基本闭环，后续重点转为增强测试覆盖、补更多端到端用例和文档持续校准。

## 核心目标

1. 收尾 2 项执行稳定性问题（`max_iterations` 默认值过低、搜索引擎单点故障）
2. 补齐 4 项核心功能缺口（`git.commit`、`test.run`、`fs.patch`、代码库语义理解）
3. 激活 4 项架构就绪但未完全暴露的能力（Sub-agents 入口、沙箱审计日志、`/loop` 轮次策略优化、Daemon SSE 输出入口）
4. 补齐 1 项生态能力（多模态图片输入）

## 预期效果

- 工具数从 17 个增至 23 个
- 默认内层工具迭代从 1 升至 3，反思循环更可用
- `/loop` 外层轮数与内层工具迭代彻底解耦
- 搜索引擎已改为国内引擎优先，并支持多引擎交叉校验
- 代码库理解从盲搜升级为符号索引 + 依赖图
- Daemon 侧提供统一 SSE 输出入口，前端和外部集成可直接消费

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

```toml
similar = "2"
tree-sitter = "0.24"
tree-sitter-rust = "0.23"
tree-sitter-python = "0.23"
tree-sitter-javascript = "0.23"
tree-sitter-typescript = "0.23"
tree-sitter-go = "0.23"
```

说明：

- `similar` 仅用于生成和校验 diff，不直接假设其具备完整 patch 容错能力
- `tree-sitter` 第一阶段只做符号索引和轻量依赖提取，不一次性引入复杂增量缓存

## 工具注册目标

```rust
registry.register_fn(git::commit::spec(), git::commit::execute);
registry.register_fn(test::runner::spec(), test::runner::execute);
registry.register_fn(fs::patch::spec(), fs::patch::execute);
registry.register_fn(code::symbol::spec(), code::symbol::execute);
registry.register_fn(code::deps::spec(), code::deps::execute);
registry.register_fn(media::vision::spec(), media::vision::execute);
```

## 实现方案

### 第 0 批：执行稳定性收尾（1 到 2 天）

#### 0.1 内层迭代默认值校准

当前状态：

- `interfaces/cli/src/cmd/config.rs` 默认 `max_iterations` 已统一为 `3`
- `interfaces/cli/src/repl.rs` 配置缺失回退值已统一为 `3`
- `/loop` 外层已独立使用 `loop_max_iterations`，默认值为 `10`

本批目标：

1. 已将 `max_iterations` 默认值从 `1` 提升到 `3`
2. 已将 REPL 的配置缺失回退值从 `1` 提升到 `3`
3. 已保持 `/loop` 外层 `loop_max_iterations` 独立，不与内层迭代混用
4. 已补以下场景测试：
   - 配置缺失时默认值生效
   - 用户配置覆盖默认值
   - `/loop` 外层读取 `loop_max_iterations`

说明：

- `interfaces/cli/src/tui/task_runtime.rs` 之前“`unwrap_or(6)` 对 Option 不生效”的问题，不再作为未修复缺陷记录；当前重点转为默认值统一和测试覆盖。

#### 0.2 搜索引擎 Multi-Provider Fallback

文件：`runtime/src/tools/web/search.rs`

实现要点：

1. 已移除 DuckDuckGo 路径
2. 已优先使用国内搜索引擎：`baidu`、`sogou`、`so360`
3. 已保留 `bing` 作为补充来源
4. `auto` 模式已支持多引擎交叉校验与 `confirmed_by` 排序

### 第 1 批：核心工具补齐（4 到 5 天）

#### 1.1 `test.run`

文件：`runtime/src/tools/test/runner.rs`

优先级最高，先于 `git.commit` 实现。

实现要点：

- 自动检测框架：Rust、Node、Go、Python
- 参数：`target`、`filter`、`framework`
- 输出：passed/failed、失败详情、stdout/stderr 摘要
- timeout: 120s
- `SideEffectLevel::ReadOnly`

#### 1.2 `git.commit`

文件：`runtime/src/tools/git/commit.rs`

实现要点：

- 先检查 `git status --porcelain`
- 仅在调用参数明确允许时执行提交
- 禁止无差别吞并无关工作区改动
- `commit message` 可由 LLM 辅助生成，但保留显式 message 入参
- 输出 `commit_hash` 与 `message`
- `SideEffectLevel::Modify`
- 同步更新沙箱命令识别

说明：

- 该工具必须遵守当前仓库“仅在用户明确要求时提交”的协作规则

#### 1.3 `fs.patch`

文件：`runtime/src/tools/fs/patch.rs`

实现要点：

- 已支持输入多文件 patch 数组
- 当前采用严格上下文匹配
- 冲突时返回结构化 `conflicts`
- 采用两阶段执行：先内存校验全部 patch，再统一落盘
- `SideEffectLevel::Modify`

测试重点：

- 已覆盖单文件 patch
- 已覆盖多文件 patch
- 已覆盖上下文失配
- 已覆盖 CRLF/LF 兼容

### 第 2 批：代码智能（分两阶段，5 到 7 天）

#### 2.1 第一阶段：`code.symbols`

文件：`runtime/src/tools/code/symbol.rs`

实现要点：

- 首批支持 Rust、Python、JavaScript、TypeScript、Go
- 输出：symbol name、kind、path、line、signature preview
- 支持工作区范围过滤
- `SideEffectLevel::ReadOnly`

#### 2.2 第二阶段：`code.deps`

文件：`runtime/src/tools/code/deps.rs`

实现要点：

- 先做文件级依赖关系，不直接追求精确语义图
- 提取 `import` / `use` / `include`
- 输出 `imports` 与 `imported_by`
- `SideEffectLevel::ReadOnly`

说明：

- 本批不做增量索引缓存，先拿到可用版本

### 第 3 批：架构能力暴露（3 天）

#### 3.1 `/agents` 用户入口

文件：`interfaces/cli/src/tui/mode_actions.rs` 或相邻命令入口

实现要点：

- 展示 planner/coder/reviewer/tester 等内置角色
- 支持显式触发 role-driven orchestration
- `/loop` 是否自动接入 orchestration 作为第二阶段决策，不在第一版硬绑定

#### 3.2 沙箱审计日志

文件：`runtime/src/tools/sandbox_guard.rs`

实现要点：

- 记录写操作审批与执行结果到 `.sacode/audit.log`
- 至少覆盖 `fs.write`、`fs.edit`、`fs.patch`、`git.commit`

#### 3.3 `/loop` 轮次策略优化

文件：`interfaces/cli/src/tui/async_actions.rs`

当前状态：

- 已完成 `hit_round_limit` 透传
- 已完成“命中单轮迭代上限后继续下一轮”
- 已补缩小范围提示与连续失败 3 次停止保护

本批目标：

- 已将 `hit_round_limit` 从“立即停止”调整为“继续下一轮”
- 已在续跑时附带缩小范围提示
- 已保留连续失败 3 次停止的总保护

#### 3.4 Daemon SSE 输出入口

文件：`runtime/src/streaming/sse.rs`、`runtime/src/daemon/`

当前状态：

- provider SSE 帧解析已存在
- 已完成 daemon 侧统一 SSE endpoint
- 已提供 `GET /api/stream` 与 `task_id` 过滤
- 已统一 SSE `data` 结构为 `task_id`、`event_type`、`timestamp`、`payload`
- 已保留 `result`、`task_run` 顶层兼容字段

本批目标：

- 已提供 `GET /api/stream`
- 已复用现有 `StreamChunk` 相关输出链路
- 已为外部前端或 IDE 集成提供统一实时输出协议

### 第 4 批：生态能力（3 到 4 天）

#### 4.1 多模态图片输入

文件：`runtime/src/tools/media/vision.rs`

实现要点：

- 读取本地图片并编码
- 适配支持多模态的 provider 请求格式
- 复用 `media/read.rs` 基础

#### 4.2 内置 MCP Server

文件：`runtime/src/mcp/servers/`

实现要点：

- 已提供本地 `stdio` server
- 已支持 `initialize`、`tools/list`、`tools/call`
- 首批暴露内置工具：`fs.read`、`fs.list`、`git.diff`
- 已提供 CLI 入口：`sacode mcp serve`
- 与现有 remote MCP 协议互补

说明：

- 该项优先级低于 `test.run`、`git.commit`、`code.symbols`
- 当前实现采用一行一个 JSON request 的 `stdin/stdout` 交互模式

## 执行优先级建议

按收益和风险排序，主线实现已按以下顺序基本完成：

1. 第 0 批：默认值校准 + 搜索降级
2. 第 1 批：`test.run`
3. 第 1 批：`git.commit`
4. 第 2 批：`code.symbols`
5. 第 3 批：`/loop` 轮次策略优化
6. 第 1 批：`fs.patch`
7. 第 2 批：`code.deps`
8. 第 3 批：Daemon SSE 输出入口
9. 第 4 批：多模态图片输入
10. 第 4 批：内置 MCP Server

## 风险与边界

| 项目 | 风险 | 处理方式 |
| --- | --- | --- |
| `git.commit` | 误提交无关改动 | 强制显式参数 + 工作区检查 |
| `fs.patch` | patch 兼容性和失败率 | 先做严格匹配，再补容错 |
| `code.symbols` | 多语言 grammar 差异 | 先统一输出格式，再逐语言补齐 |
| `code.deps` | 性能和误报 | 第一版只做轻量文件级关系 |
| Daemon SSE | 协议兼容与消费方接入 | 先复用现有 `StreamChunk` |

## 本次不纳入主线的项

- `shell.exec` 的 Windows 原生命令适配大改
- `fs.search` 的 Unix grep 依赖替换
- 复杂增量符号缓存与索引持久化

这些项保留到后续 P2/P3。

## 第一阶段任务清单

第一阶段 4 项已全部完成：默认值校准、`test.run`、`git.commit`、`code.symbols`。

### 任务 1：默认值校准

目标已完成：统一内层工具迭代默认值，保持配置优先级清晰。

改动点：

1. `interfaces/cli/src/cmd/config.rs`
   - 将 `EffectiveConfig` 默认 `max_iterations` 从 `1` 改为 `3`
2. `interfaces/cli/src/repl.rs`
   - 将配置缺失回退值从 `1` 改为 `3`
3. 测试补齐
   - 配置缺失默认值生效
   - 用户配置覆盖默认值
   - `/loop` 外层仍读取 `loop_max_iterations`

完成标准：

- CLI、REPL、TUI 在无配置时都使用内层 `3` 轮默认值
- 外层 `/loop` 轮数继续由 `loop_max_iterations` 控制

### 任务 2：`test.run`

目标已完成：Agent 已具备统一的“运行测试并读取结果”能力。

建议文件：

- `runtime/src/tools/test/mod.rs`
- `runtime/src/tools/test/runner.rs`
- `runtime/src/tools/mod.rs`
- `runtime/src/tests/tools.rs`

最小实现范围：

1. 检测项目类型
   - `Cargo.toml` -> `cargo test`
   - `package.json` -> `npm test`
   - `go.mod` -> `go test ./...`
   - `pyproject.toml` 或 `pytest.ini` -> `pytest`
2. 支持参数
   - `framework`
   - `target`
   - `filter`
3. 返回结构
   - `success`
   - `framework`
   - `command`
   - `stdout`
   - `stderr`
   - `summary`

完成标准：

- 至少覆盖 Rust 项目的成功和失败测试输出
- tool spec 已注册到 runtime

### 任务 3：`git.commit`

目标已完成：Agent 在用户明确要求提交时，已可通过工具安全完成提交。

建议文件：

- `runtime/src/tools/git/commit.rs`
- `runtime/src/tools/git/mod.rs`
- `runtime/src/tools/mod.rs`
- `runtime/src/tools/sandbox_guard.rs`
- `runtime/src/tests/tools.rs`

最小实现范围：

1. 输入参数
   - `message` 可选
   - `paths` 可选
   - `add_all` 可选，默认 `false`
2. 安全约束
   - 无变更时直接返回
   - 默认只提交显式路径或已暂存内容
   - `add_all=true` 时才允许 `git add -A`
3. 输出结构
   - `commit_hash`
   - `message`
   - `summary`

完成标准：

- 能处理“已有 staged 变更”的提交
- 能处理“指定路径提交”
- 不会默认吞并工作区全部改动

### 任务 4：`code.symbols`

目标已完成：已解决“找函数、找结构体、找入口”的高频问题。

建议文件：

- `runtime/src/tools/code/symbol.rs`
- `runtime/src/tools/code/mod.rs`
- `runtime/src/tools/mod.rs`
- `runtime/src/tests/tools.rs`

最小实现范围：

1. 第一版只优先支持 Rust
2. 输入参数
   - `path`
   - `query` 可选
   - `kind` 可选
3. 输出结构
   - `name`
   - `kind`
   - `path`
   - `line`
   - `preview`

完成标准：

- 能正确提取函数、结构体、枚举、trait、impl 方法
- 能用于当前 SaCode 仓库自身检索

## 第一阶段推荐顺序

1. 默认值校准
2. `test.run`
3. `git.commit`
4. `code.symbols`

该顺序已按主线完成。原因：

- 默认值校准收益最大且改动最小
- `test.run` 最快形成代码修改后的验证闭环
- `git.commit` 需要在验证能力具备后上线更稳
- `code.symbols` 最适合在工具闭环初步完成后补进来
