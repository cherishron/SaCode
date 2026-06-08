# SaCode Agent Notes

## Repo Shape

- This is a Rust workspace. Real members come from root `Cargo.toml`: `kernel/`, `runtime/`, `interfaces/cli/`, `interfaces/acp/`, `interfaces/lsp/`.
- Dependency direction is strict: `interfaces/* -> runtime -> kernel`.
- `kernel` holds pure execution logic and shared data structures. `runtime` holds side effects and wiring. User-facing CLI/TUI/REPL code lives in `interfaces/cli/`.
- `npm-package/` is the publishable wrapper. `legacy/` is archive material and does not participate in current builds.

## Real Entrypoints

- CLI dispatch lives in `interfaces/cli/src/cmd/mod.rs`.
- Running `sacode` with no args opens the TUI.
- Actual binaries are defined in `interfaces/cli/Cargo.toml`: `sacode` and `sacode-tui`.
- Current top-level commands include `repl`, `tui`, `serve`, `acp`, `lsp`, `init`, `init-deep`, `status`, `doctor`, `mcp serve`, and direct task execution via `sacode "<task>"`.
- `run_with_orchestrator(...)` in `interfaces/cli/src/cmd/mod.rs` is the current multi-agent / structured summary path.

## Built-in Tools (23 total)

| 工具名 | 类别 | SideEffect | 文件 |
|--------|------|------------|------|
| `browser.open` | 浏览器 | ReadOnly | `runtime/src/tools/browser/open.rs` |
| `browser.navigate` | 浏览器 | ReadOnly | `runtime/src/tools/browser/navigate.rs` |
| `browser.snapshot` | 浏览器 | ReadOnly | `runtime/src/tools/browser/snapshot.rs` |
| `browser.extract` | 浏览器 | ReadOnly | `runtime/src/tools/browser/extract.rs` |
| `code.deps` | 代码智能 | ReadOnly | `runtime/src/tools/code/deps.rs` |
| `code.symbols` | 代码智能 | ReadOnly | `runtime/src/tools/code/symbol.rs` |
| `fs.read` | 文件 | ReadOnly | `runtime/src/tools/fs/read.rs` |
| `fs.search` | 文件 | ReadOnly | `runtime/src/tools/fs/search.rs` |
| `fs.write` | 文件 | Modify | `runtime/src/tools/fs/write.rs` |
| `fs.edit` | 文件 | Modify | `runtime/src/tools/fs/edit.rs` |
| `fs.patch` | 文件 | Modify | `runtime/src/tools/fs/patch.rs` |
| `fs.read_multi` | 文件 | ReadOnly | `runtime/src/tools/fs/read_multi.rs` |
| `fs.list` | 文件 | ReadOnly | `runtime/src/tools/fs/list.rs` |
| `git.commit` | Git | Modify | `runtime/src/tools/git/commit.rs` |
| `git.diff` | Git | ReadOnly | `runtime/src/tools/git/diff.rs` |
| `interaction.ask` | 交互 | ReadOnly | `runtime/src/tools/interaction/ask.rs` |
| `media.read` | 媒体 | ReadOnly | `runtime/src/tools/media/read.rs` |
| `media.vision` | 媒体 | ReadOnly | `runtime/src/tools/media/vision.rs` |
| `shell.exec` | Shell | Modify | `runtime/src/tools/shell/exec.rs` |
| `task.spawn` | 任务 | ReadOnly | `runtime/src/tools/task/spawn.rs` |
| `test.run` | 测试 | ReadOnly | `runtime/src/tools/test/runner.rs` |
| `web.fetch` | Web | ReadOnly | `runtime/src/tools/web/fetch.rs` |
| `web.search` | Web | ReadOnly | `runtime/src/tools/web/search.rs` |

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

## Current Architecture Hotspots

- `runtime/src/agents/` contains current role-driven orchestration, worker summaries, and structured conflict handling.
- `kernel/src/execution/report.rs` is the data source for `SummaryRecord`, `ConflictRecord`, and related structured output.
- `runtime/src/model_routing/` holds task profiling and routed model types.
- `runtime/src/memory/` and `runtime/src/wiki/` back the current knowledge / memory flow.
- `runtime/src/daemon/` 提供 11 个 REST 端点 + SSE 事件流（`/api/stream`、`/events`）。
- `runtime/src/streaming/sse.rs` 统一 SSE 输出协议，支持 `task_id` 过滤。
- `runtime/src/mcp/servers/` 内置 MCP stdio server，暴露 `fs.read`、`fs.list`、`git.diff`。
- `runtime/src/tools/sandbox_guard.rs` 覆盖所有 Modify 级工具的审批审计，写入 `.sacode/audit.log`。
- `runtime/src/tools/test/runner.rs` 自动检测框架（cargo/npm/go/pytest）并运行测试。
- `runtime/src/tools/code/symbol.rs` 和 `deps.rs` 基于正则的符号索引和依赖提取（5 语言）。
- `runtime/src/tools/web/search.rs` 使用百度/搜狗/360/必应多引擎搜索，`auto` 模式交叉验证。

## Easy-to-Guess Wrong

- This repo has no root `package.json`, no `rustfmt.toml`, no `clippy.toml`, and no `.pre-commit-config.yaml`; do not assume extra JS or hook workflows exist.
- `shell.exec` and `fs.search` currently rely on Unix commands (`sh`, `grep`), so Windows behavior is still a real constraint in runtime code.
- If prose docs disagree with scripts or workflows, trust `Cargo.toml`, `.github/workflows/*`, and `scripts/check-release.js`.
- `max_iterations` 默认值为 `3`（`interfaces/cli/src/cmd/config.rs`），`/loop` 外层轮数默认 `10`（`loop_max_iterations`），二者独立不应混用。
- `task_runtime.rs` 中的 `unwrap_or(6)` 对 Option 不生效的问题已解决，当前以 EffectiveConfig 默认值为准。
- 代码智能工具（`code.symbols`、`code.deps`）当前使用正则解析，非 tree-sitter AST，复杂嵌套结构可能不完整。
- `fs.patch` 使用纯字符串匹配，非 `similar` crate 的 diff 算法，上下文失配时容错有限。

## 文档导航

项目文档位于 `docs/`，通过 [docs/README.md](docs/README.md) 统一索引：

- **用户上手** → [快速上手](docs/guides/getting-started.md) | [场景教程](docs/guides/tutorials.md) | [示例集](docs/guides/examples.md)
- **开发者参考** → [架构说明](docs/reference/architecture.md) | [API 文档](docs/reference/API.md) | [命令参考](docs/reference/command-reference.md) | [开发指南](docs/reference/development.md)
- **产品与路线** → [PRD](docs/product/PRD.md) | [路线图](docs/product/roadmap.md)
- **方案与演进** → [功能升级方案](docs/plans/capability-upgrade-plan.md) | [优化计划](docs/plans/plan-optimization.md) | [历史归档](docs/plans/archive/README.md)
- **发布与构建** → [发布流程](docs/release/RELEASE.md) | [交叉编译](docs/build/CROSS_COMPILE.md)
