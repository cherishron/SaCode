# SaCode Agent Notes

## Repo Shape

- This is a Rust workspace. Real members come from root `Cargo.toml`: `kernel/`, `runtime/`, `interfaces/cli/`, `interfaces/acp/`, `interfaces/lsp/`.
- Dependency direction is strict: `interfaces/* -> runtime -> kernel`.
- `kernel` holds pure execution logic and shared data structures. `runtime` holds side effects and wiring. User-facing CLI/TUI/REPL code lives in `interfaces/cli/`.
- `npm-package/` is the publishable wrapper.

## Real Entrypoints

- CLI dispatch lives in `interfaces/cli/src/cmd/mod.rs`.
- Running `sacode` with no args opens the TUI.
- Actual binaries are defined in `interfaces/cli/Cargo.toml`: `sacode` and `sacode-tui`.
- Current top-level commands include `repl`, `tui`, `serve`, `acp`, `lsp`, `init`, `init-deep`, `status`, `doctor`, `mcp serve`, and direct task execution via `sacode "<task>"`.
- `run_with_orchestrator(...)` in `interfaces/cli/src/cmd/mod.rs` is the current multi-agent / structured summary path.

## Built-in Tools (29 total)

29 个内置工具按分层注入策略管理，详见下一节「Tool Layering & Context Optimization」。

| 工具名 | 类别 | SideEffect | 分层 | 文件 |
|--------|------|------------|------|------|
| `browser.open` | 浏览器 | ReadOnly | Extended | `runtime/src/tools/browser/open.rs` |
| `browser.navigate` | 浏览器 | ReadOnly | Extended | `runtime/src/tools/browser/navigate.rs` |
| `browser.snapshot` | 浏览器 | ReadOnly | Extended | `runtime/src/tools/browser/snapshot.rs` |
| `browser.extract` | 浏览器 | ReadOnly | Extended | `runtime/src/tools/browser/extract.rs` |
| `code.deps` | 代码智能 | ReadOnly | Extended | `runtime/src/tools/code/deps.rs` |
| `code.search` | 代码智能 | ReadOnly | Extended | `runtime/src/tools/code/search.rs` |
| `code.symbols` | 代码智能 | ReadOnly | Extended | `runtime/src/tools/code/symbol.rs` |
| `fs.read` | 文件 | ReadOnly | **Core** | `runtime/src/tools/fs/read.rs` |
| `fs.search` | 文件 | ReadOnly | Extended | `runtime/src/tools/fs/search.rs` |
| `fs.write` | 文件 | Modify | **Core** | `runtime/src/tools/fs/write.rs` |
| `fs.edit` | 文件 | Modify | **Core** | `runtime/src/tools/fs/edit.rs` |
| `fs.patch` | 文件 | Modify | Extended | `runtime/src/tools/fs/patch.rs` |
| `fs.apply_patch` | 文件 | Modify | Extended | `runtime/src/tools/fs/apply_patch.rs` |
| `fs.read_multi` | 文件 | ReadOnly | Extended | `runtime/src/tools/fs/read_multi.rs` |
| `fs.list` | 文件 | ReadOnly | Extended | `runtime/src/tools/fs/list.rs` |
| `git.commit` | Git | Modify | Extended | `runtime/src/tools/git/commit.rs` |
| `git.diff` | Git | ReadOnly | Extended | `runtime/src/tools/git/diff.rs` |
| `git.pr` | Git | Modify | Extended | `runtime/src/tools/git/pr.rs` |
| `git.push` | Git | Modify | Extended | `runtime/src/tools/git/push.rs` |
| `interaction.ask` | 交互 | ReadOnly | Extended | `runtime/src/tools/interaction/ask.rs` |
| `media.read` | 媒体 | ReadOnly | Extended | `runtime/src/tools/media/read.rs` |
| `media.vision` | 媒体 | ReadOnly | Extended | `runtime/src/tools/media/vision.rs` |
| `media.video` | 媒体 | ReadOnly | Extended | `runtime/src/tools/media/video.rs` |
| `shell.exec` | Shell | Modify | **Core** | `runtime/src/tools/shell/exec.rs` |
| `task.spawn` | 任务 | ReadOnly | Extended | `runtime/src/tools/task/spawn.rs` |
| `test.fix` | 测试 | Modify | Extended | `runtime/src/tools/test/autofix.rs` |
| `test.run` | 测试 | ReadOnly | Extended | `runtime/src/tools/test/runner.rs` |
| `web.fetch` | Web | ReadOnly | Extended | `runtime/src/tools/web/fetch.rs` |
| `web.search` | Web | ReadOnly | Extended | `runtime/src/tools/web/search.rs` |

## Tool Layering & Context Optimization

灵枢 · 上下文优化机制 — 借鉴 Pi Coding Agent 的极简+可扩展哲学，
在保持灵枢自组织 / 自防护 / 自愈合三大优势的前提下，
把 29 个工具的 schema 注入压缩到「按需」级别，目标降低 system prompt token 60-70%。

### 分层定义（`runtime/src/tools/spec.rs`）

| 分层 | 数量 | 工具 | 注入策略 |
|------|------|------|----------|
| **Core** | 4 | `fs.read` / `fs.write` / `fs.edit` / `shell.exec` | 始终注入 prompt |
| **Extended** | 22 | 其余全部 | 按角色白名单或任务画像命中注入 |

`ToolLayer` 标签不污染 `ToolSpec`（避免修改全部 26 个 `spec()` 函数），
而是在 `ToolRegistry` 注册后由 `apply_default_layers()` 标注到内部 `RegisteredTool.layer`。

### 关键 API（`runtime/src/tools/mod.rs`）

| 方法 | 用途 |
|------|------|
| `ToolRegistry::builtin()` | 注册全部 26 工具（向后兼容入口） |
| `ToolRegistry::core_tools()` | 仅注册 4 个核心层工具 — SDK / 极简 prompt 场景 |
| `ToolRegistry::extended_tools()` | 仅注册 22 个扩展层工具 |
| `ToolRegistry::specs_by_layer(layer)` | 按分层返回工具 spec |
| `ToolRegistry::for_prompt(role, profile, budget)` | **核心**：按角色 + 任务画像 + token 预算筛选注入工具，返回 `(specs, budget_trimmed)` |

### `for_prompt` 筛选规则（优先级递减）

1. **核心层始终注入**：保证 LLM 基础可用性
2. **角色白名单**：`role.allowed_tools` 非空时，扩展层仅注入白名单工具
3. **任务画像命中**：无白名单时，按 `TaskProfile::task_kinds` 映射扩展工具（`code`→`code.symbols`/`code.deps`/`code.search`/`git.diff` 等，`test`→`test.run`/`test.fix`，`web`→`web.search`/`web.fetch`，详见 `extended_tools_for_task_profile`）
4. **token 预算裁剪**：`context_budget` 给定时按 4 字符 / token 近似累加，超出预算则截断并返回 `budget_trimmed=true`

## SDK Module（`runtime/src/sdk.rs`）

极简调用入口 — 把 SaCode 核心能力封装为一行 API，便于嵌入式集成或 RPC 模式复用。

### 关键类型

| 类型 | 用途 |
|------|------|
| `SdkClient` | 构建器模式客户端，默认仅注入核心层 4 工具 |
| `SdkResult` | 执行结果（text / success / usage / injected_tools / budget_trimmed） |
| `sdk::execute_task(workdir, prompt)` | 便捷入口函数 |

### 默认行为（最省 token）

- mode = `Build`，max_iterations = 5
- 仅注入核心层 4 工具（`fs.read` / `fs.write` / `fs.edit` / `shell.exec`）
- 无角色 / 无任务画像 / 无 token 预算
- 复用 `execute_task_with_provider`，沙箱审计与工具循环自动接管

### 构建器方法

```rust
let client = SdkClient::new(workdir).await?
    .with_full_tools()           // 启用全部 26 工具
    .with_role(role)              // 绑定角色（启用 allowed_tools 白名单）
    .with_task_profile(profile)  // 设置任务画像（按 task_kinds 命中扩展）
    .with_context_budget(8000)   // prompt token 预算（字符数近似）
    .with_mode(ExecutionMode::Yolo)
    .with_max_iterations(10)
    .with_extra_instruction("优先 Rust 严格模式");
```

底层仍走灵枢路由：`resolve_config_model_candidates` 取首个 provider 候选，
MCP 工具（`.sacode/mcp.json`）按既有流程加载。

## High-Value Commands

- Full test suite: `cargo test --workspace`
- Release build: `cargo build --release`
- Run CLI: `cargo run -p sacode-cli --bin sacode`
- Focused package tests:
  - `cargo test -p sacode-kernel`
  - `cargo test -p sacode-runtime`
  - `cargo test -p sacode-cli`
- Release consistency check: `node scripts/check-release.js`
- Strict release artifact check: `node scripts/check-release.js --strict-platforms`

## CI Order

- `.github/workflows/test.yml` runs in this order:
  1. `cargo test --workspace`
  2. `cargo build --release`
  3. `node scripts/check-release.js`
  4. `./target/release/sacode --version`
- If your change affects packaging or release flow, verify in that same order.
- `npm-package/**` changes also trigger `.github/workflows/npm-test.yml`, which copies built binaries into `npm-package/platforms/` and validates `node npm-package/bin/sacode.js --version` on Linux and Windows.

## Release Truths

- Version source of truth is root `Cargo.toml` `[workspace.package].version`.
- npm package name is fixed: `@cherishron/sacode`.
- Version sync script: `node scripts/sync-version.js <version>`.
- Platform manifest script: `node scripts/write-platform-manifest.js <version>`.
- `scripts/check-release.js` enforces:
  - npm version matches workspace version
  - `bin.sacode` points to `./bin/sacode.js`
  - install script is `node bin/install.js`
  - npm README mentions `npm install -g @cherishron/sacode`
  - only Linux x64 and Windows x64 are advertised
  - `npm-package/platforms/manifest.json` matches expected files

## Platform Constraints

- npm artifacts currently support only:
  - `sacode-linux-x64`
  - `sacode-win32-x64.exe`
- GitHub release builds Windows with `x86_64-pc-windows-msvc`.
- Local cross-compile docs and `.cargo/config.toml` use `x86_64-pc-windows-gnu`.
- Keep local-flow changes and GitHub Actions changes distinct; they target different Windows toolchains.

## Init Behavior

- `sacode init` and `sacode init-deep` are both implemented in `interfaces/cli/src/cmd/init.rs`.
- Init is a two-step design: build draft first, then apply draft. Reuse `build_init_draft(...)` and `apply_init_draft(...)` instead of bypassing that flow.
- `.gitignore` handling uses the `ignore` crate for real gitignore semantics.
- Root `AGENTS.md` updates merge existing content instead of blind overwrite when the file already exists.

## Runtime Data

- Project runtime data lives under `.sacode/`.
- Important files and dirs:
  - `provider.json`
  - `mcp.json`
  - `profile.json`
  - `mistakes.json`
  - `project.json`
  - `audit.log`（沙箱审计日志，JSON 行格式）
  - `skills/`
  - `checkpoints/`
- TUI log file: `~/.sacode/logs/tui.log`

## 灵枢架构

SaCode 核心技术优势命名为 **灵枢**（Ling Shu），源自《黄帝内经》经络体系，隐喻智能系统的自组织、自防护、自愈合能力。

灵枢架构由三个核心子系统构成：

| 子系统 | 代码位置 | 职责 | 灵枢隐喻 |
|--------|----------|------|----------|
| **自组织 — 角色驱动编排** | `runtime/src/agents/` | 多角色协同、动态任务分配 | 经络协调脏腑 |
| **自防护 — 五维冲突检测 + 实时干预** | `runtime/src/agents/summary_compactor.rs`、`runtime/src/agents/orchestrator.rs` | 多维度冲突识别；`validation_conflict` 触发 `InterventionRequest` 实时呼叫修复闭环（`dispatch_fix_loop`） | 诊察经脉病候，即时调方 |
| **学习型记忆 — 自动学习回路** | `runtime/src/memory/learner.rs`、`runtime/src/memory/mod.rs`、`runtime/src/wiki/mod.rs` | session 压缩后自动提取 mistakes / preferences / code_patterns 沉淀为跨会话记忆；BM25 搜索 + 低频衰减 | 久病成医，经验入经 |
| **多模态 — 视觉与视频理解** | `runtime/src/tools/media/vision.rs`、`runtime/src/tools/media/video.rs` | 图片/视频帧理解、超时控制、多级降级链、`VisionCache` 缓存 | 望闻问切，观其形 |
| **自愈合 — 故障转移路由** | `runtime/src/model_routing/` | 智能路由 + 模型故障自动切换 | 表里经备用通路 |

## Current Architecture Hotspots

- `runtime/src/agents/` contains current role-driven orchestration, worker summaries, and structured conflict handling.
- `kernel/src/execution/report.rs` is the data source for `SummaryRecord`, `ConflictRecord`, and related structured output.
- `runtime/src/model_routing/` holds task profiling and routed model types.
- `runtime/src/memory/` and `runtime/src/wiki/` back the current knowledge / memory flow.
- `runtime/src/sdk.rs` 极简 SDK 入口（`SdkClient` + `execute_task`），默认仅注入核心层工具，复用 `execute_task_with_provider` 走灵枢沙箱审计。
- `runtime/src/tools/mod.rs` 工具分层注册：`core_tools()` / `extended_tools()` / `builtin()`，`for_prompt(role, profile, budget)` 按角色 + 任务画像 + token 预算筛选注入工具。
- `runtime/src/daemon/` 提供 11 个 REST 端点 + SSE 事件流（`/api/stream`、`/events`）。
- `runtime/src/streaming/sse.rs` 统一 SSE 输出协议，支持 `task_id` 过滤。
- `runtime/src/mcp/servers/` 内置 MCP stdio server，暴露 `fs.read`、`fs.list`、`git.diff`。
- `runtime/src/tools/sandbox_guard.rs` 覆盖所有 Modify 级工具的审批审计，写入 `.sacode/audit.log`。
- `runtime/src/tools/test/runner.rs` 自动检测框架（cargo/npm/go/pytest）并运行测试。
- `runtime/src/tools/code/ast.rs` 基于 tree-sitter 的 AST 解析（5 语言：rust/python/javascript/typescript/go），`symbol.rs` 和 `deps.rs` 通过 `ast_cache()` 复用解析结果；`search.rs` 在 AST 符号索引上叠加 BM25 语义搜索。
- `runtime/src/tools/web/search.rs` 使用百度/搜狗/360/必应多引擎搜索，`auto` 模式交叉验证。

## Easy-to-Guess Wrong

- This repo has no root `package.json`, no `rustfmt.toml`, no `clippy.toml`, and no `.pre-commit-config.yaml`; do not assume extra JS or hook workflows exist.
- `shell.exec` uses platform-specific shell wrappers: Windows wraps with `cmd.exe /C` when shell operators (`|` `>` `&&` etc.) or builtins are detected (`needs_cmd_wrapper`); Unix wraps with `sh -c` symmetrically (`needs_sh_wrapper`). `fs.search` is pure Rust (`std::fs` + `regex`), no external `grep` dependency. When adding new shell-invoking tools, mirror this wrapper pattern for both platforms.
- If prose docs disagree with scripts or workflows, trust `Cargo.toml`, `.github/workflows/*`, and `scripts/check-release.js`.
- `max_iterations` 默认值为 `3`（`interfaces/cli/src/cmd/config.rs`），`/loop` 外层轮数默认 `10`（`loop_max_iterations`），二者独立不应混用。
- `task_runtime.rs` 中的 `unwrap_or(6)` 对 Option 不生效的问题已解决，当前以 EffectiveConfig 默认值为准。
- 代码智能工具（`code.symbols`、`code.deps`、`code.search`）基于 tree-sitter AST 解析（`runtime/src/tools/code/ast.rs`），5 语言覆盖完整。`AstCache`（512 条 LRU + mtime 失效）缓存解析结果，`FileListCache` 缓存目录扫描。复杂嵌套结构由 tree-sitter 容错解析处理，语法错误不阻塞提取。
- `fs.patch` 使用纯字符串匹配，非 `similar` crate 的 diff 算法，上下文失配时容错有限。
- **工具总数是 29**（4 核心 + 25 扩展）：`git.pr` / `git.push` / `fs.apply_patch` / `media.video` 等均已计入。新增工具请同步更新「Built-in Tools」表与 `core_tools()` / `extended_tools()` 的分层归属，并递增 `runtime/src/tests/tools.rs` 中的 `ling_shu_builtin_registry_has_29_tools` / `ling_shu_extended_tools_registry_has_25_tools` 计数断言。
- **`ToolSpec` 没有 `layer` 字段**：分层标签存于 `ToolRegistry` 内部 `RegisteredTool.layer`，由 `apply_default_layers()` 标注。新增核心层工具需把工具名加入 `CORE_TOOL_NAMES` 常量，不要在 `spec()` 里设 `layer`。
- `ToolRegistry::for_prompt()` 的 token 预算按 4 字符 / token 近似估算（不引入 tokenizer 依赖），仅用于相对裁剪，非精确计数。

## 文档导航

项目文档位于 `docs/`，通过 [docs/README.md](docs/README.md) 统一索引：

- **用户上手** → [快速上手](docs/guides/getting-started.md) | [场景教程](docs/guides/tutorials.md) | [示例集](docs/guides/examples.md)
- **开发者参考** → [架构说明](docs/reference/architecture.md) | [API 文档](docs/reference/API.md) | [命令参考](docs/reference/command-reference.md) | [开发指南](docs/reference/development.md)
- **产品与路线** → [PRD](docs/product/PRD.md) | [路线图](docs/product/roadmap.md)
- **方案与演进** → [功能升级方案](docs/plans/capability-upgrade-plan.md) | [优化计划](docs/plans/plan-optimization.md) | [历史归档](docs/plans/archive/README.md)
- **发布与构建** → [发布流程](docs/release/RELEASE.md) | [交叉编译](docs/build/CROSS_COMPILE.md)
