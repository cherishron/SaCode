# SaCode API 文档

## CLI 命令

### 基本命令

```bash
sacode                              # 默认进入聊天式 TUI
sacode "分析代码结构"                # 默认 Build 模式
sacode "修复 bug" --mode build       # Build 模式（需要审批）
sacode "格式化代码" --mode yolo       # Yolo 模式（全自动）
sacode "设计方案" --mode plan         # Plan 模式（仅规划）
sacode --version                     # 显示版本
sacode --help                        # 显示帮助
```

### TUI 界面

默认进入聊天式终端 UI：

- **界面布局**：上方显示对话历史，底部输入框
- **Ctrl+Q**：退出 TUI
- **Esc**：清空当前输入
- **↑/↓**：滚动历史消息
- **PageUp/PageDown**：快速滚动
- **Enter**：发送任务
- **/login**：配置 OpenAI 兼容 provider
- **/providers**：查看并切换当前 provider
- **/provider-rename**：重命名 provider
- **/provider-remove**：删除非当前 provider
- **/models**：拉取模型列表并选择默认模型

TUI provider 配置流程：

```text
1. 输入 /login
2. 输入 Base URL
3. 输入 API Key
4. 输入 /providers 并切换当前 provider
5. 输入 /models
6. 使用上下键选择模型并回车确认
```

### 子命令

```bash
sacode profile ls                    # 列出所有 profile（项目级）
sacode profile use <name>            # 切换 profile
sacode profile show                  # 显示当前 profile

sacode plugin ls                     # 列出插件与 MCP 工具

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

sacode mistakes list                 # 列出错题本
sacode mistakes show <index>         # 查看单条错题详情

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
/providers  查看并切换当前 provider
/provider-rename 重命名 provider
/provider-remove 删除非当前 provider
/models     拉取模型列表并设置默认模型
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
| git.diff | 获取 git diff | 否 |
| shell.exec | 执行 shell 命令 | 是 |
| web.fetch | 获取网页内容 | 否 |
| web.search | 联网搜索公开信息 | 否 |

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
      "api_key": "sk-xxx",
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
export OPENAI_API_KEY="sk-xxx"
export DEEPSEEK_API_KEY="sk-xxx"
export SACODE_MODEL="gpt-4o-mini"
export SACODE_PROFILE="default"
```

## Daemon API

### 启动 Daemon

```bash
sacode daemon --port 3000
```

### HTTP API

#### 健康检查

```bash
GET /health

Response:
{
  "status": "healthy",
  "version": "0.1.12"
}
```

#### 创建任务

```bash
POST /task
Content-Type: application/json

{
  "prompt": "分析代码结构",
  "mode": "build"
}

Response:
{
  "task_id": "task-1234567890",
  "status": "queued",
  "message": "Task created: 分析代码结构"
}
```

#### 查询任务状态

```bash
GET /task/:id/status

Response:
{
  "task_id": "task-1234567890",
  "status": "running",
  "progress": 50
}
```

#### 订阅全部事件流

```bash
GET /events

event: task_started
data: {"task_id":"task-1234567890","event_type":"task_started","data":{}}
```

#### 订阅单个任务事件流

```bash
GET /events/:id
```

#### 列出工具

```bash
GET /tools

Response:
{
  "tools": ["fs.read", "fs.search", "fs.write", "git.diff", "shell.exec"]
}
```

## FFI 接口

### C/C++ 接口

```c
#include "sacode.h"

// 创建实例
SacodeHandle* handle = sacode_new();

// 执行任务
// mode: 0=Build, 1=Plan, 2=Yolo
char* result = sacode_execute(handle, "分析代码结构", 0);
printf("Result: %s\n", result);

// 释放资源
sacode_free_string(result);
sacode_free(handle);
```

### Python 接口

```python
import ctypes

lib = ctypes.CDLL('./libsacode_kernel.so')
lib.sacode_new.restype = ctypes.c_void_p
lib.sacode_execute.restype = ctypes.c_char_p

handle = lib.sacode_new()
result = lib.sacode_execute(handle, "分析代码结构".encode(), 0)
print(result.decode())

lib.sacode_free_string(result)
lib.sacode_free(handle)
```

### Node.js 接口

```javascript
const ffi = require('ffi-napi');
const ref = require('ref-napi');

const lib = ffi.Library('./libsacode_kernel.so', {
  'sacode_new': ['pointer', []],
  'sacode_execute': ['string', ['pointer', 'string', 'int32']],
  'sacode_free': ['void', ['pointer']],
  'sacode_free_string': ['void', ['string']]
});

const handle = lib.sacode_new();
const result = lib.sacode_execute(handle, '分析代码结构', 0);
console.log(result);

lib.sacode_free_string(result);
lib.sacode_free(handle);
```

## WASM 插件系统

### 插件规范

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "My custom plugin",
  "wasm_path": "/path/to/plugin.wasm",
  "functions": [
    {
      "name": "process",
      "description": "Process input",
      "input_schema": { "type": "object" },
      "output_schema": { "type": "object" }
    }
  ]
}
```

### 加载插件

```bash
sacode plugin load /path/to/plugin.wasm --spec spec.json
```

### 调用插件

插件可以通过 Agent 在任务执行中被调用。

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

### 支持的语言

- Rust, JavaScript, TypeScript, Python, Go
- Java, C, C++, Ruby, PHP, Swift, Kotlin
- Scala, Vue, Svelte, HTML, CSS
- Config (JSON, YAML, TOML), Markdown, Shell, SQL

## 事件系统

### 事件类型

| 事件 | 描述 |
|------|------|
| Message | 普通消息 |
| Thinking | 思考过程 |
| PlanGenerated | 计划生成 |
| ToolCallStarted | 工具调用开始 |
| ToolCallFinished | 工具调用完成 |
| ApprovalRequested | 需要审批 |
| ApprovalResolved | 审批完成 |
| FileChanged | 文件变更 |
| CommandOutput | 命令输出 |
| Done | 任务完成 |
| Error | 错误 |

### 事件输出格式

```json
{
  "type": "ToolCallStarted",
  "data": {
    "name": "fs.read",
    "input": { "path": "src/main.rs" }
  }
}
```

## 多 Agent 系统

### Agent 角色

| Agent | 职责 |
|-------|------|
| Planner | 任务规划 |
| Coder | 代码执行 |
| Reviewer | 结果审查 |
| Supervisor | 调度协调 |

### AgentDispatcher API

```rust
let dispatcher = AgentDispatcher::new();

// 分发任务
dispatcher.dispatch_plan(task);

// 分发步骤
dispatcher.dispatch_step(step);

// 分发审查
dispatcher.dispatch_review(step, result);

// 收集消息
let messages = dispatcher.collect_messages(5000);

// 关闭
dispatcher.shutdown();
```

## Ghost 模式

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
