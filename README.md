# SaCode

SaCode 是一个终端优先的 Rust AI 编程工具。

## 安装

```bash
npm install -g @cherishron/sacode
sacode --version
```

## 项目结构

```text
.
├── Cargo.toml           # Workspace 配置
├── kernel/              # 纯逻辑层
├── runtime/             # 副作用层
├── interfaces/cli/      # CLI / TUI / REPL 入口
├── interfaces/acp/      # ACP 服务
├── interfaces/lsp/      # LSP 服务
├── npm-package/         # npm 发布包
├── docs/                # 文档
└── legacy/              # 历史归档，不参与当前构建
```

## 核心架构

### `kernel/`

纯逻辑层，无副作用：

- `agent`: Planner、Coder、Reviewer、Supervisor
- `schema`: Task、Session、Plan、Step、Checkpoint
- `event`: 统一事件模型
- `error`: 统一错误类型

### `runtime/`

副作用和能力层：

- `tools`: FS、Shell、Git、Web 工具
- `provider`: ProviderClient (OpenAI、DeepSeek、Ollama)
- `plugin`: WASM 插件加载
- `acp`: ACP 服务
- `lsp`: LSP 服务
- `skills`: 本地 skill 模板注册
- `mcp`: MCP 远程服务配置
- `sandbox`: 执行沙箱

### `interfaces/cli/`

CLI 入口 `sacode` 命令：

- 默认进入聊天式 TUI
- 支持任务执行、REPL、TUI，以及 `serve` 聚合服务模式

## CLI 使用

### TUI 模式（默认）

```bash
sacode                    # 进入聊天式终端 UI
```

TUI 界面为聊天式交互：
- 上方显示对话历史
- 底部输入框接收任务（支持多行输入，第 8 行停止增长）
- 支持 Ctrl+Q 退出、Esc 清空输入
- 支持 Ctrl+T 切换 thinking 模式、Ctrl+M 轮转执行模式（plan/build/yolo）
- 支持 `/login` 配置 OpenAI 兼容接口
- 支持 `/providers` 切换当前 provider
- 支持 `/provider-rename <old> <new>` 重命名 provider
- 支持 `/provider-remove <name>` 删除非当前 provider
- 支持 `/models` 拉取并选择默认模型
- 支持 `/loop <task>` 循环执行任务，最多 10 轮，连续失败 3 次自动停止
- 支持 `/init` 生成项目 AGENTS.md（增量更新，保留用户修改）
- Modal 弹窗统一使用 `render_modal_block`，避免穿透问题

模型接入流程：

```text
1. 输入 /login
2. 填写 Base URL，例如 https://api.openai.com/v1
3. 填写 API Key
4. 输入 /providers 切换当前 provider
5. 输入 /models
6. 选择默认模型
```

配置文件保存到 `.sacode/provider.json`。

### 任务执行模式

```bash
sacode "分析代码结构"              # Build 模式执行
sacode /commit                     # 使用内置 skill
sacode "设计方案" --mode plan      # 仅规划
sacode "格式化代码" --mode yolo    # 全自动执行
cat README.md | sacode "总结"      # stdin 输入
sacode "找 bug" --json             # JSON 输出
```

### REPL 模式

```bash
sacode repl               # 进入 REPL 交互
```

REPL 支持同样的 provider 配置命令：
- `/login`
- `/providers`
- `/provider-rename`
- `/provider-remove`
- `/models`

### 服务模式

```bash
sacode serve --acp --lsp  # 同时启动 ACP / LSP 服务
sacode acp serve          # 单独启动 ACP 服务
sacode lsp serve          # 单独启动 LSP 服务
```

## 子命令

```bash
sacode orchestrator "<task>"
sacode profile ls         # 列出 profile（项目级）
sacode profile use <name> # 切换 profile
sacode profile show       # 显示当前 profile
sacode plugin list        # 列出插件与 MCP 工具
sacode doctor
sacode diff [--cached]
sacode hooks
sacode ide [status|vscode|cursor|jetbrains|config ...]
sacode config [show|path|user ...|project ...|set <key> <value>|clear <key>]
sacode keybindings
sacode outstyle [show|concise|explain|teach|clear|path|project ...]
sacode vim [show|on|off|project show|on|off]
sacode skill [search|install|list|show|update|remove|run]
sacode mcp [search|install|list|show|enable|disable|remove|inspect|tools|call]
sacode mcp call <server> <tool> <json>
sacode memory [show|search <query>|append <content>|path|summary]
sacode insight
sacode acp [serve|status] [--host HOST] [--port PORT]
sacode lsp [serve|status] [--tcp] [--host HOST] [--port PORT]
sacode serve [--acp] [--lsp]
sacode mistakes list      # 列出错题本
sacode mistakes show <index> # 查看单条错题详情
sacode checkpoint list    # 列出 checkpoint
sacode init               # 轻量初始化项目，生成 AGENTS.md
sacode init-deep          # 深度初始化项目，补充工作流与 MCP 模板
sacode status
sacode update [--check|--force]
```

## 工具系统

| 工具 | 描述 | 需审批 |
|------|------|--------|
| fs.read | 读取文件 | 否 |
| fs.search | 搜索内容 | 否 |
| fs.write | 写入文件 | 是 |
| git.diff | Git diff | 否 |
| shell.exec | Shell 命令 | 是 |
| web.fetch | 抓取网页内容 | 否 |
| web.search | 联网公开搜索 | 否 |

## Skills 与 MCP

### Skills

- 工作区默认目录：`skills/`
- 项目级覆盖目录：`.sacode/skills/`（同名优先）
- 内置默认 skill 会随运行时注册表变化，以 `sacode skill list` 为准
- 支持 slash 调用：`sacode /commit`
- 支持 CLI 管理：
  - `sacode skill add <name> <description> <prompt>`
  - `sacode skill remove <name>`
  - `sacode skill run <name> [args...]`
- 支持 REPL/TUI 管理：
  - `/skills`、`/skill show|run|add|remove`
- 支持模板变量：`{{args}}`、`{{cwd}}`、`{{skill_name}}`、`{{description}}`

### MCP

- 配置文件：`.sacode/mcp.json`
- 支持远程 MCP 服务安装、启停、探测和工具发现
- 支持直接调用远程 MCP tool
- CLI 子命令集合以 `sacode mcp --help` / 根帮助输出为准

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

### Provider

- 配置文件：`.sacode/provider.json`
- 当前支持 OpenAI 兼容接口
- 支持多个 provider，并通过 `current` 指向当前默认 provider
- 当前使用 `GET /models` 拉取模型列表
- 当前使用 `POST /chat/completions` 发送聊天请求

示例：

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

## 项目级配置

SaCode 在项目根目录下维护 `.sacode/` 目录：

```
.sacode/
├── provider.json    # 多 provider 配置
├── mcp.json         # MCP 服务配置
├── profile.json     # 项目级 profile
├── mistakes.json    # 错题本
├── project.json     # init 元信息
├── skills/          # 项目级 skills 覆盖
└── checkpoints/     # 任务检查点
```

`init` 命令会：

1. 调用当前 provider 分析项目结构
2. 生成 `AGENTS.md`（优先使用模型，失败则本地模板）
3. 初始化 `.sacode/` 下的配置文件

`init-deep` 会在上述基础上额外生成：

1. `.sacode/workflows.json`
2. `.sacode/mcp.json`

当前 init 实现已经拆成“构建草稿 -> 应用草稿”的两阶段逻辑，TUI 和 REPL 会先展示草稿再确认写入。

## 文档

- `docs/PRD.md`: 产品需求文档
- `docs/API.md`: API/CLI 文档
- `docs/release/RELEASE.md`: 发布流程
- `docs/build/CROSS_COMPILE.md`: 交叉编译
- `CHANGELOG.md`: 版本变更

## 发布

```bash
# 版本同步
node scripts/sync-version.js <version>

# Linux 发布构建
cargo build --release

# 本地 Windows GNU 交叉构建
cargo build --release --target x86_64-pc-windows-gnu

# 平台清单
node scripts/write-platform-manifest.js <version>

# 发布检查
node scripts/check-release.js --strict-platforms
```

CI 发布 workflow 使用的 Windows 目标是 `x86_64-pc-windows-msvc`，与本地 `.cargo/config.toml` 的 GNU 目标不同。

## 归档

`legacy/` 目录不参与当前 Rust workspace 的构建、测试和发布。

## 许可证

[MulanPSL-2.0](./LICENSE)
