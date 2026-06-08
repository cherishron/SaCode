# SaCode 命令参考

本文档收敛当前高频 CLI 子命令和 TUI 常用命令。完整行为以 `interfaces/cli/src/cmd/mod.rs` 和对应子命令模块为准。

## 1. 主入口

```bash
sacode "<task>" [--mode plan|build|yolo] [--max-iterations N] [--json] [--prompt|--approve|--deny]
sacode repl
sacode tui
```

说明：

- 无参数运行 `sacode` 会直接进入 TUI
- `--json` 适合脚本化输出
- `--approve` / `--deny` 控制审批策略

## 2. 日常高频命令

```bash
sacode doctor
sacode status
sacode diff [--cached]
sacode hooks
sacode keybindings
sacode outstyle [show|concise|explain|teach|clear|path|project ...]
sacode prompt [show [task...]|doctor|edit project]
sacode wiki
sacode vim [show|on|off|project show|on|off]
```

## 3. 配置与接入

```bash
sacode ide [status|vscode|cursor|jetbrains|config show|path|set acp|lsp --host HOST --port PORT]
sacode config [show|path|user ...|project ...|set <key> <value>|clear <key>]
sacode profile [ls|use <name>|show]
```

说明：

- `ide` 侧重 ACP/LSP 接入说明
- `config` 管理用户级与项目级配置
- `profile` 管理项目级模型配置组合

## 4. Skills / MCP / 插件

```bash
sacode skill [search|install|list|show|update|remove|run]
sacode mcp [search|install|list|show|enable|disable|remove|inspect|tools|call|serve]
sacode plugin [list|search|show|install|remove|enable|disable]
```

说明：

- skills 目录默认在 `skills/`，项目级覆盖在 `.sacode/skills/`
- MCP 配置文件在 `.sacode/mcp.json`
- `status` 会自动确保默认 `context7` MCP 存在并启用
- `mcp serve` 会启动本地内置 MCP `stdio` server，当前暴露 `fs.read`、`fs.list`、`git.diff`
- `plugin search` / `plugin show` 会在本地发现结果之外补充 SkillHub 远端插件信息

## 5. 记忆 / 知识 / 洞察

```bash
sacode memory [show|search <query>|path|summary|append <content> [--type memory|preference|workflow|decision] [--global|-g]]
sacode insight
sacode wiki
```

重点：

- 项目级 wiki 目录是 `.sacode/wiki`
- `memory append` 支持分类写入和用户级写入
- `wiki` 用于看知识源是否已被加载

## 6. 服务与协议

```bash
sacode acp [serve|status] [--host HOST] [--port PORT]
sacode lsp [serve|status] [--tcp] [--host HOST] [--port PORT]
sacode serve [--acp] [--lsp]
```

说明：

- 协议服务主入口是 `acp` 和 `lsp`
- `serve` 目前是聚合入口

## 7. 初始化与运维类命令

```bash
sacode init
sacode init-deep
sacode mistakes [list|show <index>]
sacode checkpoint [list|show <file>|restore <file>|clean]
sacode update [--check|--force]
```

说明：

- `init` / `init-deep` 会更新 `AGENTS.md` 和 `.sacode/`
- `mistakes` 用于查看失败记录
- `checkpoint` 用于恢复执行现场
- `update` 通过 npm 全局更新安装新版本

## 8. TUI 常用命令

TUI 内常见斜杠命令包括：

- `/providers`
- `/models`
- `/login`
- `/connect`
- `/status`
- `/doctor`
- `/prompt`
- `/diff`
- `/hooks`
- `/ide`
- `/config`
- `/keybindings`
- `/outstyle`
- `/vim`
- `/memory`
- `/wiki`
- `/insight`
- `/tools`
- `/stats`
- `/theme`
- `/loop`
- `/cancel`
- `/help`
- `/quit`

TUI 还支持这些分组命令：

- `/skills list|show|run|add|remove`
- `/mcps list|show|remove`
- `/todo show|confirm|clear`
- `/tasks list|add|show|edit|start|done|cancel|clear|export`

## 9. TUI 快捷键

- `Ctrl+Q`：退出
- `Esc`：清空输入或取消当前执行
- `Ctrl+T`：开启或关闭思考功能
- `Ctrl+M`：切换 `plan` / `build` / `yolo`

## 10. 推荐阅读顺序

1. [快速上手](../guides/getting-started.md) — 安装与基本配置
2. [场景教程](../guides/tutorials.md) — 按真实任务组织
3. [API 文档](API.md) — 工具系统、Daemon、MCP 接口
4. [架构说明](architecture.md) — 分层与执行链路
