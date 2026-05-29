# SaCode 仓库说明

## Workspace 边界

- 这是 Rust workspace，成员以根 `Cargo.toml` 为准：`kernel/`、`runtime/`、`interfaces/cli/`、`interfaces/acp/`、`interfaces/lsp/`。
- 依赖方向按 crate 约束理解：`interfaces/* -> runtime -> kernel`。`kernel` 放纯逻辑，`runtime` 放 provider/tools/MCP/skills 等副作用层，CLI/TUI/REPL 入口都在 `interfaces/cli/`。
- 发布到 npm 的产物在 `npm-package/`，`legacy/` 只是旧 Node/TS 归档，不参与当前 Rust 构建。
- 新增 workspace 依赖 `ignore = "0.4"` 用于 init 的 `.gitignore` 语义解析。

## 真实入口

- CLI 主入口在 `interfaces/cli/src/cmd/mod.rs`。
- 无参数运行会进入 TUI；显式子命令有 `tui`、`repl`、`daemon`，以及直接任务执行 `sacode "<task>"`。
- 二进制定义在 `interfaces/cli/Cargo.toml`：`sacode` 和 `sacode-tui`。
- TUI 模块拆分：`interfaces/cli/src/tui/mod.rs`（主模块）和 `interfaces/cli/src/tui/input.rs`（输入框逻辑），后续可继续拆分 modal 和 render 模块。

## 开发命令

- 全量测试：`cargo test --workspace`
- 发布构建：`cargo build --release`
- 运行 CLI：`cargo run -p sacode-cli --bin sacode`
- 指定包测试：
  - `cargo test -p sacode-kernel`
  - `cargo test -p sacode-runtime`
  - `cargo test -p sacode-cli`
- 常见发布前检查：`node scripts/check-release.js`
- 严格发布检查：`node scripts/check-release.js --strict-platforms`

## CI 对齐

- `.github/workflows/test.yml` 的顺序是：`cargo test --workspace` -> `cargo build --release` -> `node scripts/check-release.js` -> `./target/release/sacode --version`。
- 改动影响发布链路时，至少按上面的顺序做人肉验证，避免只跑单测。
- npm 相关 PR 还会跑 `.github/workflows/npm-test.yml`，要求能把二进制复制进 `npm-package/platforms/` 后再执行 `node npm-package/bin/sacode.js --version`。

## 发布与版本

- workspace 版本源是根 `Cargo.toml` 的 `[workspace.package].version`；`npm-package/package.json` 和平台 manifest 必须与它一致。
- 版本同步脚本：`node scripts/sync-version.js <version>`。
- 平台 manifest 脚本：`node scripts/write-platform-manifest.js <version>`。
- `scripts/check-release.js` 会校验：npm 包名固定为 `@cherishron/sacode`、`bin/sacode.js` 映射、README 安装文案、`npm-package/platforms/manifest.json`、以及 Linux/Windows 平台文件集合。
- tag 发布 workflow 使用的 Windows 目标是 `x86_64-pc-windows-msvc`；本地交叉编译文档和 `.cargo/config.toml` 配的是 `x86_64-pc-windows-gnu`。改发布链路时先确认你改的是本地流程还是 GitHub Actions 流程。

## 平台产物

- npm 包当前只支持 Linux x64 和 Windows x64；`check-release.js` 会把多余平台声明判为失败。
- 目标产物名固定：`sacode-linux-x64`、`sacode-win32-x64.exe`。

## Init 相关

- `sacode init` 和 `sacode init deep` 的分发都在 `interfaces/cli/src/cmd/mod.rs`，实际逻辑在 `interfaces/cli/src/cmd/init.rs`。
- 当前 init 设计是两阶段：先构建草稿，再应用草稿。改 TUI/REPL 的 init 行为时，优先复用 `build_init_draft` / `apply_init_draft`，不要再退回"直接生成并写盘"的单阶段实现。
- `.gitignore` 语义使用 `ignore` crate 实现完整 git 忽略逻辑（通配符、否定模式、目录匹配），不再使用简单字符串匹配。
- AGENTS.md 增量更新：已有文件时读取旧内容，追加到 `## Auto-generated updates` 段落，保留用户手动修改部分。

## `/loop` 循环任务

- `/loop` 命令用于循环执行任务，持续检查结果并修复问题，直到任务达到可用完成态。
- 熔断机制：`max_iterations = 10`（最多 10 轮），`error_threshold = 3`（连续失败 3 次自动停止）。
- 成功时重置 `error_count = 0`，达到上限提示"已达到最大轮次上限"。
- 失败时累计 `error_count`，达到阈值提示"循环任务已连续失败 X 次，自动停止"。

## 项目配置落点

- 项目级运行数据写在 `.sacode/`，README 已明确列出：`provider.json`、`mcp.json`、`profile.json`、`mistakes.json`、`project.json`、`skills/`、`checkpoints/`。
- 日志文件：`~/.sacode/logs/tui.log` 记录 stderr 和 JSON 解析错误，方便排查问题。
- 当前仓库没有 `.gitmodules`，不需要 submodule 流程。

## 改动时容易猜错的点

- 现有 `AGENTS.md`、README、发布脚本三者里如果信息冲突，以根 `Cargo.toml`、GitHub workflow、`scripts/check-release.js` 这些可执行来源为准。
- 这个仓库没有 `package.json` 根项目、没有 `rustfmt.toml`、没有 `clippy.toml`、没有 `.pre-commit-config.yaml`；不要假设存在额外前端或预提交链路。
- shell.exec 和 fs.search 工具使用 Unix 命令（`sh`、`grep`），Windows 上需要后续改造为跨平台实现。
