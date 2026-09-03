# SaCode 1.1.1 / VSCode 扩展 0.2.1

本次补丁发布包含 **CLI / daemon 1.1.1** 与 **VSCode 扩展 0.2.1**。

## 主要变更

- 审批协议改用一次性 `approval_id`，修复注册竞态和同任务并发审批覆盖；
- daemon 审批等待改为异步，不再阻塞 Tokio worker；超时、取消和通道关闭默认拒绝；
- VSCode 审批 UI 展示副作用与操作摘要，关闭弹窗等价于显式拒绝，并支持失败重试；
- SSE 客户端按任务过滤、健壮解析 CRLF/多行帧，并报告 HTTP 错误；
- Windows Rust CI、串行 doctest 与外部依赖 quarantine 门禁落地；
- daemon HTTP/SSE/审批协议和 VSCode 排障文档补齐。

## 升级

### CLI / daemon 1.1.1

```bash
npm install -g @cherishron/sacode@1.1.1
sacode --version
```

预期输出：

```text
sacode 1.1.1
```

从二进制安装时，请选择对应平台的 `sacode-*` release artifact。升级后重启已有 `sacode serve` 进程。

### VSCode 扩展 0.2.1

从 release 下载 `sacode-vscode-0.2.1.vsix`，执行：

```bash
code --install-extension sacode-vscode-0.2.1.vsix --force
```

扩展 0.2.1 要求 daemon 1.1.1 或更高版本；检测到旧 daemon 时会报告不兼容，而不是尝试在同一端口启动第二个进程。

## 回滚

1. 停止当前 daemon；
2. 安装上一稳定 CLI/npm 版本 `1.1.0`；
3. 重新启动 `sacode serve`；
4. 如需回滚扩展，安装保存的 0.2.0 VSIX，或在 VS Code 扩展页选择旧版本。

```bash
npm install -g @cherishron/sacode@1.1.0
sacode --version
```

注意：VSCode 扩展 0.2.1 不支持 daemon 1.1.0。CLI 回滚到 1.1.0 时，应同时把扩展回滚到 0.2.0，或暂时停用扩展。

## 已知限制

- daemon 当前没有内建认证、授权或 TLS，只应默认监听 `127.0.0.1`；
- VSCode SSE 客户端当前不会自动携带 `Last-Event-ID` 重连，断线后需查询任务状态/结果；
- 审批等待上限为 300 秒，超时自动拒绝；
- 旧客户端不支持 `approval_id`，无法完成新审批，最终会安全拒绝；
- VSIX 作为 release artifact 提供，本次不自动发布到 VS Code Marketplace 或 Open VSX；
- macOS npm 安装链路已纳入构建配置，但仍需真实发布产物和 Intel/Apple Silicon 环境验证。

## 发布门禁

tag `v1.1.1` 前必须通过：

- `cargo fmt --all -- --check`
- `cargo clippy --workspace --all-targets -- -D warnings`
- Windows workspace 非 doctest 测试、逐 crate doctest 和 pytest quarantine exact 测试
- 审批协议 smoke test
- VSCode `npm ci`、compile、tests
- VSIX 双次构建 SHA-256 一致性检查
- npm tarball 中 CLI `--version` 与 `1.1.1` 一致
- `node scripts/check-vscode-release.js 1.1.1 0.2.1`
