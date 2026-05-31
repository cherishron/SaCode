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

- CLI 命令或参数：更新 `docs/API.md` 和 `README.md`
- 架构层次或模块边界：更新 `docs/architecture.md`
- 开发/构建流程：更新 `docs/development.md`
- 发布行为：更新 `docs/release/RELEASE.md`

## 7. npm 发布链路

版本相关真源和脚本：

- 根 `Cargo.toml`：workspace 版本号
- `node scripts/sync-version.js <version>`：同步版本
- `node scripts/write-platform-manifest.js <version>`：写平台清单
- `node scripts/check-release.js --strict-platforms`：发布检查

npm 包当前只支持：

- Linux x64
- Windows x64

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
