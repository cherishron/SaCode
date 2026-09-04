# SaCode 发布流程

本文档说明 CLI/npm 与 VSCode 扩展的版本发布门禁。当前采用双版本：CLI/npm 使用 `MAJOR.MINOR.PATCH` 与 tag `v<version>`，VSCode 扩展独立使用自己的版本号。

## 1. 自动发布

`.github/workflows/release.yml` 在推送 `v*` tag 后执行。`workflow_dispatch` 只运行门禁和构建演练，`release` job 有 tag 条件保护，不会发布 npm 或创建 release：

1. **发布前门禁**
   - 校验 tag、Cargo、npm 版本，以及扩展最低 daemon 版本源/VSIX 一致性；
   - `cargo fmt --all -- --check`；
   - `cargo clippy --workspace --all-targets -- -D warnings`；
   - workspace 测试、审批 smoke 和 pytest quarantine；
   - VSCode `npm ci`、compile、test；
   - 双次构建 VSIX，要求 SHA-256 完全一致；
   - 检查 VSIX 文件集合、扩展版本和最低 daemon 元数据。
2. **四平台构建**
   - Linux x64：`sacode-linux-x64`；
   - Windows x64：`sacode-win32-x64.exe`；
   - macOS x64：`sacode-darwin-x64`；
   - macOS arm64：`sacode-darwin-arm64`。
3. **npm 门禁与发布**
   - 生成 `platforms/manifest.json`；
   - 执行 `node scripts/check-release.js --strict-platforms`；
   - `npm pack` 后全局安装 tarball，验证 `sacode --version` 与 tag 一致；
   - 发布 GitHub Packages；配置 `NPM_TOKEN` 时同时发布 npmjs.org。
4. **GitHub Release**
   - 附加四个平台二进制和 `sacode-vscode-<version>.vsix`；
   - release body 使用 `docs/release/<CLI版本>.md`。

> 当前 `origin` 可能不是 GitHub remote。推送 tag 前必须确认目标远端能够执行 `.github/workflows/release.yml`；否则 tag 仅存在于该远端，不代表 GitHub Packages、npm 或 GitHub Release 已发布。

## 2. 发布前本地门禁

Windows 上按 CI 策略执行：

```text
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --lib --bins --tests
cargo test -p sacode-kernel --doc
cargo test -p sacode-runtime --doc
cargo test -p sacode-acp --doc
cargo test -p sacode-lsp --doc
cargo test -p sacode-cli --doc
cargo test -p sacode-runtime tests::approval_flow::approval_registration_precedes_notification -- --exact
cargo test -p sacode-runtime tools::test::autofix::tests::e2e_pytest_fix_context_generates_and_repair_verifies -- --ignored --exact
```

VSCode 扩展：

```text
cd interfaces/vscode
npm ci
npm run compile
npm test
npm run package:vsix
cd ../..
node scripts/check-vscode-release.js <CLI版本> <扩展版本>
node scripts/vscode-install-smoke.js
```

`package:vsix` 使用固定版本的 `@vscode/vsce`，再由 `scripts/normalize-vsix.py` 固定 ZIP 条目顺序、时间戳和压缩参数。发布前应连续构建两次并比较 SHA-256。

npm tarball/CLI：

```text
cargo build --release -p sacode-cli --bin sacode
node scripts/prepare-npm-platforms.js <CLI版本> --clean --platform win32-x64 --source-file win32-x64 target/release/sacode.exe
node scripts/check-release.js
cd npm-package
npm pack
```

从 tarball 解包或安装后执行 `sacode --version`，输出必须是 `sacode <CLI版本>`。本地生成的 `.tgz`、`.vsix`、`.vsix.sha256` 和平台二进制不得提交。

## 3. 版本同步

```text
node scripts/sync-version.js <CLI版本>
```

该脚本同步 workspace `Cargo.toml`、npm package 与 API 示例。随后运行 Cargo 命令更新 `Cargo.lock`。

VSCode 版本独立维护，需同步：

- `interfaces/vscode/package.json` 的 `version`；
- `interfaces/vscode/package-lock.json` 根版本；
- `package:vsix` 输出文件名；
- `sacode.minimumDaemonVersion`；
- `src/SseClient.ts` 的 `MINIMUM_DAEMON_VERSION`；
- `docs/release/compatibility.json` 的 `current` 与 `releases`；
- `docs/release/<CLI版本>.md`。

`scripts/check-vscode-release.js` 会检查这些来源、`docs/release/compatibility.json` 以及 VSIX 内部 metadata 一致性，并写出 `sacode-vscode-<version>.vsix.sha256`。

## 4. Tag 与发布

完成门禁、提交并推送发布准备 commit 后：

```text
git fetch origin --tags
git tag --list "v<CLI版本>"
git ls-remote --tags origin "refs/tags/v<CLI版本>"
git tag -a v<CLI版本> -m "SaCode <CLI版本>"
git push origin v<CLI版本>
```

禁止覆盖已有 tag。推送后必须核实 CI、npm registry 和 release assets 的实际结果；不能仅凭本地 tag 宣称发布完成。

## 5. 回滚

- npm 版本不可覆盖或删除后重发；发现问题应发布新的 patch，必要时使用 registry deprecate；
- Git tag 和已发布 release 不应强制移动；
- CLI 回滚时必须同时考虑 VSCode 最低 daemon 版本；
- 具体版本的升级、回滚与已知限制写入 `docs/release/<CLI版本>.md`。

## 6. 发布文件

- `.github/workflows/release.yml`：自动门禁、构建与发布；
- `.github/workflows/vscode.yml`：Ubuntu / Windows / macOS 扩展编译、打包与冒烟；
- `scripts/sync-version.js`：CLI/npm 版本同步；
- `scripts/prepare-npm-platforms.js`：平台产物和 manifest；
- `scripts/check-release.js`：npm/二进制/tarball 检查；
- `scripts/check-vscode-release.js`：VSIX、版本、兼容矩阵和 SHA-256 检查；
- `scripts/vscode-install-smoke.js`：兼容矩阵与可选 `code --install-extension` 冒烟；
- `scripts/normalize-vsix.py`：确定性 VSIX 重打包；
- `docs/release/compatibility.json` / `compatibility.md`：扩展与 daemon 配对真源；
- `docs/release/<version>.md`：release notes。

## 7. Marketplace / Open VSX

**不自动发布**到 VS Code Marketplace 或 Open VSX。VSIX 只作为 GitHub / Gitee Release 附件分发。`docs/release/compatibility.json` 的 `distribution.vscodeMarketplace` / `openVsx` 必须为 `false`，由检查脚本锁定。

商店分发需要独立的 publisher 验证与审核任务，禁止把 `vsce publish` 接到现有 tag 发布工作流。
