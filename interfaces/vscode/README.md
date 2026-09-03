# SaCode for VS Code

SaCode 的 VSCode 客户端，连接本地 `sacode serve` daemon，提供：

- 任务发起与停止；
- 编辑器选区上下文注入；
- SSE 流式消息、工具调用和 diff 展示；
- Build 模式工具审批。

## 要求

- VS Code 1.85.0 或更高版本；
- SaCode daemon 1.1.1 或更高版本；
- daemon 默认监听 `127.0.0.1:8080`。

如 `sacode` 不在 PATH，请设置 `sacode.binaryPath`。完整安装、配置和排障指南见仓库中的 `docs/guides/vscode-extension.md`。

## 安全

`sacode serve` 当前没有内建认证或 TLS。请保持默认 loopback 监听，不要把 daemon 直接暴露到不可信网络。
