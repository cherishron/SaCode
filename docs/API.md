# SaCode API 文档

## CLI 命令

### 基本命令

```bash
sacode                              # 默认进入终端 TUI
sacode "分析代码结构"                # 默认 Build 模式
sacode "修复 bug" --mode build       # Build 模式（需要审批）
sacode "格式化代码" --mode yolo       # Yolo 模式（全自动）
sacode "设计方案" --mode plan         # Plan 模式（仅规划）
sacode --version                     # 显示版本
sacode --help                        # 显示帮助
```

### 子命令

```bash
sacode profile ls                    # 列出所有 profile
sacode profile use <name>            # 切换 profile
sacode profile add <name> <config>   # 添加 profile

sacode plugin ls                     # 列出插件
sacode plugin load <wasm_path>       # 加载 WASM 插件
sacode plugin unload <name>          # 卸载插件

sacode checkpoint list               # 列出所有 checkpoint
sacode checkpoint show <file>        # 查看 checkpoint 详情
sacode checkpoint restore <file>     # 恢复 checkpoint
sacode checkpoint clean              # 清理所有 checkpoint

sacode init                          # 初始化项目配置
sacode tui                           # 显式进入终端 TUI
sacode repl                          # 进入 REPL 模式
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

### Profile 配置文件

位置: `~/.sacode/profiles.yaml`

```yaml
current: default

providers:
  openai:
    api_key_env: OPENAI_API_KEY
    base_url: https://api.openai.com/v1
  deepseek:
    api_key_env: DEEPSEEK_API_KEY
    base_url: https://api.deepseek.com/v1
  ollama:
    base_url: http://127.0.0.1:11434

profiles:
  default:
    agents:
      planner: { provider: openai, model: gpt-4o }
      coder: { provider: deepseek, model: deepseek-coder }
      reviewer: { provider: openai, model: gpt-4o-mini }
  
  economy:
    agents:
      planner: { provider: deepseek, model: deepseek-chat }
      coder: { provider: deepseek, model: deepseek-coder }
      reviewer: { provider: ollama, model: llama3 }
  
  local:
    agents:
      planner: { provider: ollama, model: qwen2 }
      coder: { provider: ollama, model: qwen2-coder }
      reviewer: { provider: ollama, model: llama3 }
```

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
  "version": "0.1.7"
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
