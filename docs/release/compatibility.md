# VSCode 扩展兼容矩阵

本文件与 `docs/release/compatibility.json` 是扩展 / daemon / CLI 配对的真源。发版脚本会校验 JSON 与 `Cargo.toml`、`interfaces/vscode/package.json` 一致。

## 当前配对

| 组件 | 版本 |
|------|------|
| VSCode 扩展 | 0.2.1 |
| CLI / daemon | 1.1.1 |
| 扩展最低 daemon | 1.1.1 |
| VS Code 引擎 | `^1.85.0` |

新 daemon 可服务旧扩展（只要协议未删除字段）。新扩展不可连接低于 `minimumDaemonVersion` 的 daemon；运行时会报不兼容，而不会在同一端口再拉起第二个进程。

## 历史配对

| 扩展 | 配套 CLI / daemon | 最低 daemon | 说明 |
|------|-------------------|-------------|------|
| 0.2.1 | 1.1.1 | 1.1.1 | 当前；`approval_id`、Diff 审批、SSE 重连 |
| 0.2.0 | 1.1.0 | 1.1.0 | 回滚目标；不支持 0.2.1 的审批协议 |

明确不兼容：扩展 **0.2.1 + daemon 1.1.0**。

## 升级

1. 先升级 CLI / daemon 到扩展要求的最低版本或更高；
2. 停止旧的 `sacode serve` 并重新启动；
3. 安装新 VSIX：`code --install-extension sacode-vscode-<扩展版本>.vsix --force`；
4. 执行 **Developer: Reload Window**；
5. **SaCode: Check Status** 确认 `/health` 版本满足最低要求。

## 降级

1. 停止当前 daemon；
2. 安装与目标扩展匹配的 CLI（例如回到 `1.1.0`）；
3. 安装对应旧 VSIX（例如 `0.2.0`），不要把 0.2.1 留给 1.1.0 daemon；
4. 重启 `sacode serve` 并重载窗口。

## 安装 / 升级冒烟

不依赖 VS Code UI。打包后执行：

```text
cd interfaces/vscode
npm ci
npm run compile
npm test
npm run package:vsix
cd ../..
node scripts/check-vscode-release.js
node scripts/vscode-install-smoke.js
```

`vscode-install-smoke.js` 会：

- 在无 `code` CLI 时检查 VSIX 元数据与兼容矩阵（CI 默认路径）；
- 若本机有 `code`，再执行一次 `--force` 安装并核对扩展版本。

跨平台由 `.github/workflows/vscode.yml` 在 Ubuntu / Windows / macOS 上各跑一遍打包 + 检查 + 冒烟。

## 分发策略

**不自动发布** VS Code Marketplace 或 Open VSX。正式包只作为 GitHub / Gitee Release 的 `sacode-vscode-<version>.vsix`（及同名 `.sha256`）提供。

原因：

- 扩展与 CLI 双版本，必须和 daemon 门禁一起发布；
- 当前 publisher 与商店审核流程未就绪；
- 远端不一定是能跑 Marketplace 发布的 GitHub。

需要商店分发时，另开任务处理 publisher 验证、签名和审核清单，不要把 `vsce publish` 接到现有 `release.yml`。
