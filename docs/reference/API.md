# SaCode API 文档

本文档汇总 SaCode 当前公开的 CLI、TUI、工具系统和配置文件接口。建议配合 `docs/guides/getting-started.md`、`docs/guides/tutorials.md` 与 `docs/reference/architecture.md` 一起阅读。

## 文档范围

- CLI 子命令
- TUI / REPL 常用交互命令
- tools / skills / MCP
- provider 与项目级配置
- daemon HTTP、SSE 与审批协议（详见 [daemon-api.md](daemon-api.md)）

## CLI 命令

### 基本命令

```bash
sacode                              # 默认进入聊天式 TUI
sacode "分析代码结构"                # 默认 Build 模式
sacode "修复 bug" --mode build       # Build 模式（需要审批）
sacode "格式化代码" --mode auto       # auto 模式（全自动）
sacode "设计方案" --mode plan         # Plan 模式（仅规划）
sacode --version                     # 显示版本
sacode --help                        # 显示帮助
```

### TUI 界面

默认进入聊天式终端 UI：

- **界面布局**：上方显示对话历史，底部输入框
- **Ctrl+Q**：退出 TUI
- **Esc**：清空当前输入
- **Ctrl+T**：开启或关闭思考功能
- **Ctrl+M**：在 `plan` / `build` / `auto` 间切换执行模式
- **↑/↓**：滚动历史消息
- **PageUp/PageDown**：快速滚动
- **Enter**：发送任务
- **/login**：配置 OpenAI 兼容 provider
- **/connect**：快速接入预设 provider
- **/providers**：查看并切换当前 provider
- **/provider-rename**：重命名 provider
- **/provider-remove**：删除非当前 provider
- **/models**：拉取模型列表并选择默认模型
- **/memory**：查看或管理分类项目记忆
- **/wiki**：查看分层知识库加载状态
- **/loop**：循环执行任务直到完成或达到熔断阈值
- **/answer**：回答当前等待中的问题

TUI provider 配置流程：

```text
1. 输入 /login
2. 输入 Base URL
3. 输入 API Key
4. 输入 `/models`
5. 选择模型

`/models` 会展示所有已配置 provider 的模型，确认后同时切换 provider 和默认模型。
```

### 子命令

```bash
sacode profile ls                    # 列出所有 profile（项目级）
sacode profile use <name>            # 切换 profile
sacode profile show                  # 显示当前 profile

sacode plugin ls                     # 列出插件与 MCP 工具

sacode doctor                        # 检查 provider、模型、wiki、memory 等是否就绪
sacode diff [--cached]               # 查看 Git 差异摘要
sacode hooks                         # 查看 hooks 生命周期
sacode ide [status|vscode|cursor|jetbrains|config ...]
sacode config [show|path|user ...|project ...|set <key> <value>|clear <key>]
sacode keybindings                   # 查看快捷键
sacode outstyle [show|concise|explain|teach|clear|path|project ...]
sacode prompt [show|path|set|clear]
sacode wiki [show|status|path|refresh]
sacode vim [show|on|off|project show|on|off]

sacode skill list                    # 列出 skills
sacode skill show <name>             # 查看 skill 定义
sacode skill add <name> <desc> <prompt> # 新增项目级 skill
sacode skill remove <name>           # 删除项目级 skill
sacode skill run <name> [args...]    # 渲染 skill prompt

sacode mcp list                      # 列出 MCP 服务
sacode mcp show <name>               # 查看 MCP 服务配置
sacode mcp add <name> <url>          # 添加远程 MCP 服务
sacode mcp enable <name>             # 启用 MCP 服务
sacode mcp disable <name>            # 停用 MCP 服务
sacode mcp remove <name>             # 删除 MCP 服务
sacode mcp inspect <name>            # 探测远程 MCP 服务信息
sacode mcp tools <name>              # 列出远程 MCP 工具
sacode mcp call <server> <tool> <json> # 调用远程 MCP 工具
sacode mcp serve                     # 启动内置 MCP stdio server

sacode mistakes list                 # 列出错题本
sacode mistakes show <index>         # 查看单条错题详情

sacode memory show                   # 查看项目级记忆
sacode memory summary                # 查看记忆摘要
sacode memory path                   # 查看记忆落点
sacode memory search <query>         # 搜索记忆
sacode memory append <content>       # 追加记忆

sacode insight                       # 生成使用习惯与优化建议

sacode checkpoint list               # 列出所有 checkpoint
sacode checkpoint show <file>        # 查看 checkpoint 详情
sacode checkpoint restore <file>     # 恢复 checkpoint
sacode checkpoint clean              # 清理所有 checkpoint

sacode init                          # 轻量初始化项目，生成 AGENTS.md
sacode init-deep                     # 深度初始化项目，补充工作流与 MCP 模板
sacode tui                           # 显式进入终端 TUI
sacode repl                          # 进入 REPL 模式
```

REPL/TUI 内置命令补充：

```text
/login      配置 OpenAI 兼容 provider
/connect    快速接入 Provider
/providers  查看并切换当前 provider
/provider-rename 重命名 provider
/provider-remove 删除非当前 provider
/models     拉取模型列表并设置默认模型
/memory     查看或管理分类项目记忆
/wiki       查看分层知识库加载状态
/loop       循环执行任务直到完成
/answer     回答当前等待中的问题
/skills     列出可用 skills
/skill show|run|add|remove 管理 skills
/mcps       列出 MCP 服务
/mcps-show <name> 查看 MCP 服务
/mcps-remove <name> 删除 MCP 服务
```

## 工具系统

### 内置工具

| 工具 | 描述 | 需要审批 |
|------|------|----------|
| fs.read | 读取文件内容 | 否 |
| fs.search | 搜索文件内容 | 否 |
| fs.write | 写入工作区内文件内容 | 是 |
| fs.patch | 按严格上下文批量应用文件补丁 | 是 |
| git.diff | 获取 git diff | 否 |
| shell.exec | 执行 shell 命令 | 是 |
| web.fetch | 获取网页内容 | 否 |
| web.search | 联网搜索公开信息 | 否 |

运行时还包含 `browser.*`、`interaction.*`、`media.*`、`task.*`、`code.*` 等模块，具体以运行时注册表为准。

### Skills

- 工作区默认目录：`skills/`
- 项目级覆盖目录：`.sacode/skills/`（同名优先）
- 可通过 `sacode /commit`、`sacode /review-pr` 直接调用
- 当前内置 skill：`commit`、`review-pr`、`explain`
- 新增 CLI 命令：
  - `skill add <name> <desc> <prompt>`
  - `skill remove <name>`
  - `skill run <name> [args...]`
- 支持 REPL/TUI：
  - `/skills`
  - `/skill show|run|add|remove`
- 支持模板变量：`{{args}}`、`{{cwd}}`、`{{skill_name}}`、`{{description}}`

### MCP 配置

配置文件位置：`.sacode/mcp.json`

示例：

```json
{
  "mcp": {
    "exa": {
      "type": "remote",
      "url": "https://mcp.exa.ai/mcp",
      "enabled": true
    }
  }
}
```

当前 MCP 子命令能力：

- `mcp list`
- `mcp show <name>`
- `mcp add`
- `mcp enable`
- `mcp disable`
- `mcp remove <name>`
- `mcp inspect`
- `mcp tools`
- `mcp call`
- `mcp serve`

内置 MCP `stdio` server 当前能力：

- 支持方法：`initialize`、`tools/list`、`tools/call`
- 首批工具：`fs.read`、`fs.list`、`git.diff`
- 传输方式：标准输入输出，每行一条 JSON-RPC 请求/响应

示例：

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize"}' | sacode mcp serve
```

REPL/TUI 新增：

- `/mcps`
- `/mcps-show <name>`
- `/mcps-remove <name>`

### 工具调用格式

```json
{
  "name": "fs.read",
  "input": {
    "path": "/path/to/file"
  }
}
```

```json
{
  "name": "fs.write",
  "input": {
    "path": "/path/to/file",
    "content": "file content",
    "mode": "write"
  }
}
```

```json
{
  "name": "shell.exec",
  "input": {
    "command": "cargo build"
  }
}
```

## 模型配置

### 本地 provider 配置

位置：`.sacode/provider.json`

```json
{
  "current": "openai",
  "providers": {
    "openai": {
      "base_url": "https://api.openai.com/v1",
      "api_key": "YOUR_API_KEY",
      "model": "gpt-4o-mini"
    },
    "local": {
      "base_url": "http://127.0.0.1:11434/v1",
      "api_key": "ollama",
      "model": "qwen2.5-coder"
    }
  }
}
```

当前行为：

- TUI 和 REPL 优先读取 `.sacode/provider.json`
- `current` 决定当前默认 provider
- `/login` 会新增或覆盖命名 provider
- `/providers` 用于切换当前 provider
- `/provider-rename <old> <new>` 用于重命名 provider
- `/provider-remove <name>` 用于删除非当前 provider
- 未配置本地 provider 时，CLI 继续回退到环境变量模型选择逻辑
- OpenAI 兼容接口要求支持 `/models` 和 `/chat/completions`

### Profile 配置文件

位置：项目级 `.sacode/profile.json`

```json
{
  "current": "default",
  "profiles": {
    "default": {
      "planner": "gpt-4o",
      "coder": "deepseek-coder",
      "reviewer": "gpt-4o-mini"
    },
    "economy": {
      "planner": "deepseek-chat",
      "coder": "deepseek-coder",
      "reviewer": "gpt-4o-mini"
    },
    "local": {
      "planner": "ollama/qwen2.5-coder:7b",
      "coder": "ollama/qwen2.5-coder:7b",
      "reviewer": "gpt-4o-mini"
    }
  }
}
```

当前行为：

- `sacode profile ls` 列出项目级 profiles
- `sacode profile use <name>` 切换项目级当前 profile
- 配置保存在 `.sacode/profile.json`

### 错题本

位置：项目级 `.sacode/mistakes.json`

当前行为：

- 记录三类失败：
  - `/init` 过程中模型生成失败
  - 工具调用失败
  - 主模型调用失败
- 命令：
  - `sacode mistakes list`
  - `sacode mistakes show <index>`

### 项目初始化

`sacode init` 当前行为：

1. 创建 `.sacode/` 目录
2. 调用当前 provider 分析项目结构
3. 生成项目级 `AGENTS.md`
4. 初始化 `.sacode/profile.json`
5. 初始化 `.sacode/mistakes.json`
6. 写入 `.sacode/project.json` 记录元信息

### 环境变量

```bash
export OPENAI_API_KEY="YOUR_API_KEY"
export DEEPSEEK_API_KEY="YOUR_API_KEY"
export SACODE_MODEL="gpt-4o-mini"
export SACODE_PROFILE="default"
```

## 服务接口

SaCode 当前公开的服务入口以 ACP 和 LSP 为主。

### 启动 ACP 服务

```bash
sacode acp serve
sacode acp serve --host 127.0.0.1 --port 8765
```

### 启动 LSP 服务

```bash
sacode lsp serve
sacode lsp serve --tcp --host 127.0.0.1 --port 8766
```

### Daemon 入口

```bash
sacode serve
sacode serve --host=127.0.0.1 --port=8080
```

无协议参数时，`sacode serve` 启动 HTTP/SSE daemon，默认监听 `127.0.0.1:8080`。`--acp` 或 `--lsp` 当前只提示使用对应的独立子命令；同时传入二者的组合模式仍是 scaffold。daemon 没有内建认证或 TLS，不应直接暴露到不可信网络。

### Daemon HTTP 接口

SaCode runtime 当前提供以下最小可用 Daemon 路由：

- `GET /health`
- `POST /task`
- `GET /task/:id/status`
- `GET /task/:id/result`
- `POST /task/:id/retry`
- `POST /task/:id/cancel`
- `POST /task/:id/approve`
- `GET /task/:id/approvals`
- `GET /task/:id/checkpoint`
- `GET /metrics`
- `GET /events`
- `GET /events/:id`
- `GET /api/stream`
- `GET /tools`
- `GET /queue/status`
- `GET /queue/pending`

创建任务示例：

```bash
curl -X POST http://127.0.0.1:8080/task \
  -H "content-type: application/json" \
  -d '{"prompt":"分析代码结构","mode":"build"}'
```

返回示例：

```json
{
  "task_id": "task-1717670400000",
  "status": "queued",
  "message": "Task created and submitted to queue",
  "queue_status": "pending"
}
```

### SSE 事件流

Daemon 当前支持三种 SSE 入口：

- `GET /events`
  - 订阅全部任务事件
- `GET /events/:id`
  - 订阅指定任务事件
- `GET /api/stream`
  - 统一 SSE 入口
- `GET /api/stream?task_id=<TASK_ID>`
  - 统一 SSE 入口的任务过滤模式

事件名示例：

- `task_created`
- `task_started`
- `task_completed`
- `task_failed`
- `retry_scheduled`
- `retry_started`
- `message`
- `thinking`
- `tool_call_started`
- `tool_call_finished`
- `approval_requested`
- `approval_resolved`
- `task_cancelled`
- `lagged`

统一 SSE `data` 结构：

```json
{
  "task_id": "task-1717670400000",
  "event_type": "task_completed",
  "timestamp": "2026-06-06T12:34:56Z",
  "payload": {
    "result": {
      "task_id": "task-1717670400000",
      "status": "completed",
      "output": "任务完成",
      "error": null,
      "duration_ms": 123
    },
    "task_run": {
      "task_id": "task-1717670400000",
      "state": "Completed",
      "output_text": "任务完成"
    }
  },
  "result": {
    "task_id": "task-1717670400000",
    "status": "completed",
    "output": "任务完成",
    "error": null,
    "duration_ms": 123
  },
  "task_run": {
    "task_id": "task-1717670400000",
    "state": "Completed",
    "output_text": "任务完成"
  }
}
```

说明：

- `task_id`、`event_type`、`timestamp`、`payload` 是统一后的稳定字段
- `result`、`task_run` 等顶层字段当前继续保留，用于兼容旧消费方
- 新接入方建议优先消费 `payload.*`
- `/events/:id` 与 `/api/stream` 支持 `Last-Event-ID` 内存回放；`/events` 不支持
- 单任务流在 `task_completed`、`task_failed`、`task_cancelled` 后关闭；全局流保持打开
- `fs.apply_patch` 审批可通过受限 `args_override.paths` 只应用经用户接受的文件；该覆盖不能改写 patch 或扩大原 paths 白名单
- 审批事件、HTTP 400/404/409、一次性幂等和重连语义详见 [Daemon HTTP、SSE 与审批 API](daemon-api.md)
- VSCode 安装与 daemon 自动管理排障详见 [VSCode 扩展使用与排障](../guides/vscode-extension.md)

## 工具注册表

当前内置工具由 `runtime/src/tools/mod.rs` 中的 `ToolRegistry::builtin()` 注册。

已注册模块包括：

- `browser.open`
- `browser.navigate`
- `browser.snapshot`
- `browser.extract`
- `fs.read`
- `fs.search`
- `fs.write`
- `fs.edit`
- `fs.read_multi`
- `fs.list`
- `git.diff`
- `interaction.ask`
- `media.read`
- `media.vision`
- `shell.exec`
- `task.spawn`
- `web.fetch`
- `web.search`

多媒体工具说明：

- `media.read`
  - 适合读取原始图片/PDF 数据
  - 支持 `base64`、`ocr`、`describe`
- `media.vision`
  - 适合理解图片内容
  - 支持 `ocr`、`describe`
  - 支持可选 `prompt` 自定义视觉任务

查看当前可用工具：

```bash
sacode plugin list
```

`plugin list` 会同时展示：

- built-in tools
- 已启用 MCP tools
- 已配置 plugins

## 插件与 MCP

### 插件命令

```bash
sacode plugin list
sacode plugin search <keyword>
sacode plugin show <name>
sacode plugin install <name> [--global|-g]
sacode plugin remove <name> [--global|-g]
sacode plugin enable <name> [--global|-g]
sacode plugin disable <name> [--global|-g]
```

当前 `plugin` 子命令管理的是配置层接入，不是文档中旧版的 `plugin load <wasm>` 工作流。

`plugin install` 现在会优先尝试从当前可发现能力中解析目标，并在 `.sacode/plugins.json` 中保留 `kind`、`description`、`source_ref` 等元信息。

`plugin search` 和 `plugin show` 会优先展示本地可发现能力，并在 SkillHub 可用时补充远端插件结果。

### MCP 命令

```bash
sacode mcp list
sacode mcp show <name>
sacode mcp inspect <name>
sacode mcp tools <name>
sacode mcp call <server> <tool> <json>
sacode mcp serve
```

项目级配置文件位置：`.sacode/mcp.json`

内置 `stdio` server 返回 MCP 兼容 JSON-RPC 响应。当前 `tools/list` 会暴露：

- `fs.read`
- `fs.list`
- `git.diff`

## 沙箱系统

### 沙箱策略

```rust
// 只读策略
let policy = SandboxPolicy::readonly();

// 构建策略
let policy = SandboxPolicy::build();

// Yolo 策略（允许网络）
let policy = SandboxPolicy::yolo();

// 自定义策略
let policy = SandboxPolicy::new()
    .allow_path(PathBuf::from("."))
    .allow_command("cargo".to_string())
    .timeout(30000);
```

### 执行限制

- 命令白名单检查
- 路径访问限制
- 执行超时控制
- 网络访问控制

当前实现重心在命令与路径约束；如需了解限制边界，优先看 `runtime/src/sandbox/` 和 `runtime/src/tools/shell/`。

## Checkpoint 系统

### Checkpoint 结构

```json
{
  "task": {
    "prompt": "修复 bug",
    "mode": "build"
  },
  "current_step": 2,
  "executed_tools": [
    {
      "name": "fs.read",
      "input": { "path": "src/main.rs" },
      "output": { "content": "..." },
      "success": true,
      "timestamp": "1234567890Z"
    }
  ],
  "pending_approval": null,
  "recent_events": [],
  "created_at": "1234567890Z",
  "updated_at": "1234567890Z"
}
```

### Checkpoint 存储

位置: `.sacode/checkpoints/`

## 工作区扫描

### WorkspaceScanner API

```rust
let scanner = WorkspaceScanner::new();
let info = scanner.scan(&PathBuf::from("."));

println!("Files: {}", info.total_files);
println!("Languages: {}", info.languages.len());
println!("Total size: {}KB", info.total_size / 1024);

// 查找文件
let rust_files = scanner.by_language(&PathBuf::from("."), "Rust");

// 搜索模式
let matches = scanner.find_files(&PathBuf::from("."), "main");
```

## 事件系统

### 事件类型

| 事件 | 描述 |
|------|------|
| `message` | 普通消息 |
| `thinking` | 思考过程 |
| `plan_generated` | 计划生成 |
| `tool_call_started` | 工具调用开始 |
| `tool_call_finished` | 工具调用完成 |
| `approval_requested` | 需要审批 |
| `approval_resolved` | 审批完成 |
| `file_changed` | 文件变更 |
| `command_output` | 命令输出 |
| `done` | 任务完成 |
| `error` | 错误 |

### 事件输出格式

```json
{
  "type": "tool_call_started",
  "name": "fs.read",
  "input": {
    "path": "src/main.rs"
  }
}
```

事件类型真源在 `kernel/src/event.rs`。

## Orchestrator 输出

当使用：

```bash
sacode orchestrator "<task>"
```

CLI 会额外输出结构化编排信息。JSON 模式下会包含：

- `route_records`
- `conflicts`
- `conflict_records`
- `summary_record`
- `orchestration_plan`

这些结构主要来自：

- `kernel/src/execution/report.rs`
- `runtime/src/agents/orchestrator.rs`

## Ghost / 管道模式

### stdin 输入

```bash
cat main.rs | sacode "找 bug" --json
git diff | sacode "生成提交信息"
ls -la | sacode "分析目录结构"
```

### JSON 输出

```bash
sacode "分析代码" --json

Output:
{
  "prompt": "分析代码",
  "mode": "build",
  "tools": ["fs.read", "fs.search", "git.diff"],
  "workspace": "/path/to/project",
  "plan": { ... },
  "events": [ ... ],
  "tool_results": [ ... ]
}
```
