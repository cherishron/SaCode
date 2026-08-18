# SaCode 开发指南

本文档面向维护者和贡献者，说明如何在本地开发、测试、调试和发布 SaCode。

## 1. 环境要求

- Rust `1.75+`
- Node.js 用于发布脚本和 npm 包检查
- 可访问的 OpenAI 兼容 Provider，用于真实交互验证

## 2. 本地开发

### 运行 CLI

```bash
cargo run -p sacode-cli --bin sacode
```

### 运行 TUI 二进制

```bash
cargo run -p sacode-cli --bin sacode-tui
```

### 常用测试命令

```bash
cargo test --workspace
cargo test -p sacode-kernel
cargo test -p sacode-runtime
cargo test -p sacode-cli
```

### 发布构建

```bash
cargo build --release
```

## 3. 推荐开发顺序

当改动影响主链路时，建议按下面顺序自检：

1. 定向单元测试
2. `cargo test --workspace`
3. `cargo build --release`
4. `node scripts/check-release.js`
5. `./target/release/sacode --version`

这与 CI 主链路保持一致。

## 4. 代码分层约定

### `kernel`

- 放纯逻辑
- 放结构化类型和执行语义
- 放稳定抽象

### `runtime`

- 放 provider、tools、memory、wiki、plugin、sandbox 等副作用层
- 放 orchestrator、model routing、workspace 扫描

### `interfaces/*`

- 放入口、协议适配和交互层
- CLI / TUI / REPL 都在 `interfaces/cli/`

## 5. 常见入口文件

- `interfaces/cli/src/cmd/mod.rs`：CLI 分发主入口
- `interfaces/cli/src/tui/mod.rs`：TUI 主模块
- `interfaces/cli/src/runner.rs`：执行协调与格式化
- `runtime/src/lib.rs`：runtime 对外导出能力
- `kernel/src/lib.rs`：kernel 对外导出模型和语义

## 6. 文档同步要求

当你修改以下内容时，建议同步更新文档：

- CLI 命令或参数：更新 `docs/reference/API.md` 和 `README.md`
- 架构层次或模块边界：更新 `docs/reference/architecture.md`
- 开发/构建流程：更新 `docs/reference/development.md`
- 发布行为：更新 `docs/release/RELEASE.md`
- 产品定位、目标用户、核心场景：更新 `docs/product/PRD.md`
- 版本路线、阶段状态：更新 `docs/product/roadmap.md`
- 用户上手、命令用法：更新 `docs/guides/getting-started.md`、`docs/guides/tutorials.md`、`docs/guides/examples.md`

### 6.1 文档真相源约定

为避免文档表述冲突（如 roadmap.md 历史版本第 86 行"v1.0+ 已落地"与第 119 行"🚧 进行中"矛盾），以以下为事实真相源：

- 版本号：`Cargo.toml` `[workspace.package].version`
- 平台支持与发布校验：`.github/workflows/*`、`scripts/check-release.js`
- 工具总数与分层：`runtime/src/tests/tools.rs` 计数断言

文档须与上述真相源一致；如真相源变更，相关文档应在同一 PR 内同步更新，并在文件头标注更新时间。

### 6.2 文档一致性检查

提交前建议确认：

1. PRD 定位与 roadmap 阶段状态一致
2. getting-started.md / tutorials.md 的命令与 `interfaces/cli/src/cmd/mod.rs` 实际实现一致
3. 所有新增方案文档在 `docs/README.md` 索引登记

## 7. npm 发布链路

版本相关真源和脚本：

- 根 `Cargo.toml`：workspace 版本号
- `node scripts/sync-version.js <version>`：同步版本
- `node scripts/write-platform-manifest.js <version>`：写平台清单
- `node scripts/check-release.js --strict-platforms`：发布检查

npm 包当前只支持：

- Linux x64
- Windows x64
- macOS x64（Intel）与 arm64（Apple Silicon）

## 8. 调试建议

### 查看 TUI 日志

```bash
ls ~/.sacode/logs
```

重点日志：

- `~/.sacode/logs/tui.log`

### 定位命令入口

先看：

- `interfaces/cli/src/cmd/mod.rs`

再沿着子命令模块进入具体实现。

### 定位多 agent 摘要问题

优先看：

- `runtime/src/agents/orchestrator.rs`
- `runtime/src/agents/worker.rs`
- `runtime/src/agents/summary_compactor.rs`
- `kernel/src/execution/report.rs`

## 9. 发布前核对项

1. 版本号是否已同步到 workspace 和 npm 包
2. `npm-package/platforms/manifest.json` 是否已更新
3. Linux / Windows 平台文件名是否符合约定
4. README 安装说明和平台说明是否与当前产物一致
5. `sacode --version` 是否能正常输出

## 10. 相关文档

- [架构说明](architecture.md) — 分层与执行链路
- [API 文档](API.md) — 工具系统与接口
- [命令参考](command-reference.md) — CLI / TUI 命令速查
- [发布流程](../release/RELEASE.md) — 版本发布链路
- [交叉编译指南](../build/CROSS_COMPILE.md) — 跨平台构建
