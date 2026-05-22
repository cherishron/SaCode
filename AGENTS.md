# SaCode 开发指南

## 项目结构

Rust workspace，三个成员：
- `kernel/`：纯逻辑层（agent, schema, event, supervisor）
- `runtime/`：副作用层（tools, provider, daemon, sandbox）
- `interfaces/cli/`：CLI 入口（`sacode` 命令）

依赖方向：`cli -> runtime -> kernel`

## 开发命令

```bash
cargo test --workspace           # 全量测试
cargo build --release            # 发布构建
cargo run -p sacode-cli --bin sacode  # 运行 CLI
```

测试特定包：
```bash
cargo test -p sacode-kernel
cargo test -p sacode-runtime
cargo test -p sacode-cli
```

## CLI 入口行为

`interfaces/cli/src/cmd/mod.rs` 定义入口：
- 无参数：默认进入 TUI（终端 UI），不是打印 usage
- `sacode tui`：显式进入 TUI
- `sacode repl`：REPL 模式
- `sacode "<task>"`：任务执行

## 发布流程

自动发布（推荐）：
```bash
git tag v0.1.x
git push origin v0.1.x
# GitHub Actions 自动构建 + npm 发布
```

手动发布前必须：
```bash
node scripts/check-release.js --strict-platforms
```

检查项：版本一致性、manifest.json、平台二进制文件。

## 交叉编译（Linux 上编译 Windows）

`.cargo/config.toml` 已配置 mingw-w64 linker：
```bash
cargo build --release --target x86_64-pc-windows-gnu
```

产物位置：
- Linux: `target/release/sacode`
- Windows: `target/x86_64-pc-windows-gnu/release/sacode.exe`

## 版本同步

版本号定义在 `[workspace.package]`：
```bash
node scripts/sync-version.js 0.1.x  # 同步 Cargo.toml + npm package.json + docs
node scripts/write-platform-manifest.js 0.1.x  # 写入 npm-package/platforms/manifest.json
```

## npm 包

- 包名：`@cherishron/sacode`
- 包含：`platforms/sacode-linux-x64` + `platforms/sacode-win32-x64.exe` + `manifest.json`
- 启动器：`npm-package/bin/sacode.js`

## 注意事项

- `legacy/` 是旧 Node/TS 代码归档，不参与编译
- 版本变更记录在 `CHANGELOG.md`
- 详细发布流程见 `docs/release/RELEASE.md`
- 交叉编译指南见 `docs/build/CROSS_COMPILE.md`