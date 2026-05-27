# SaCode

SaCode 是一个终端优先的 AI 编程工具，已完成从 Node/TS 到 Rust 的完整迁移。

## 安装

```bash
npm install -g @cherishron/sacode
sacode --version
```

## 项目结构

```text
.
├── Cargo.toml          # Workspace 配置
├── kernel/             # 纯逻辑层
├── runtime/            # 副作用层
├── interfaces/cli/     # CLI 入口
├── npm-package/        # npm 发布包
└── docs/               # 文档
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
- `daemon`: SSE 服务
- `skills`: 本地 skill 模板注册
- `mcp`: MCP 远程服务配置
- `sandbox`: 执行沙箱

### `interfaces/cli/`

CLI 入口 `sacode` 命令：

- 默认进入聊天式 TUI
- 支持 Ghost、REPL、Daemon 模式

## CLI 使用

### TUI 模式（默认）

```bash
sacode                    # 进入聊天式终端 UI
```

TUI 界面为聊天式交互：
- 上方显示对话历史
- 底部输入框接收任务
- 支持 Ctrl+Q 退出、Esc 清空输入
- 支持 `/login` 配置 OpenAI 兼容接口
- 支持 `/providers` 切换当前 provider
- 支持 `/provider-rename <old> <new>` 重命名 provider
- 支持 `/provider-remove <name>` 删除非当前 provider
- 支持 `/models` 拉取并选择默认模型

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

### Ghost 模式

```bash
sacode "分析代码结构"              # Build 模式执行
sacode /commit                     # 使用内置 skill
sacode /review-pr                  # 使用代码审查 skill
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

### Daemon 模式

```bash
sacode daemon --port 3000 # 启动 HTTP + SSE 服务
```

## 子命令

```bash
sacode profile ls         # 列出 profile（项目级）
sacode profile use <name> # 切换 profile
sacode profile show       # 显示当前 profile
sacode plugin ls          # 列出插件与 MCP 工具
sacode skill list         # 列出 skills
sacode skill show commit  # 查看 skill 定义
sacode skill add <name> <desc> <prompt> # 新增项目级 skill
sacode skill remove <name> # 删除项目级 skill
sacode skill run <name> [args...] # 渲染 skill prompt
sacode mcp list           # 列出 MCP 服务
sacode mcp show <name>    # 查看 MCP 服务配置
sacode mcp add <name> <url> # 添加远程 MCP 服务
sacode mcp enable <name>  # 启用 MCP 服务
sacode mcp disable <name> # 停用 MCP 服务
sacode mcp remove <name>  # 删除 MCP 服务
sacode mcp inspect <name> # 探测远程 MCP 服务信息
sacode mcp tools <name>   # 查看远程 MCP 工具列表
sacode mcp call <server> <tool> <json>
sacode mistakes list      # 列出错题本
sacode mistakes show <index> # 查看单条错题详情
sacode checkpoint list    # 列出 checkpoint
sacode init               # 轻量初始化项目，生成 AGENTS.md
sacode init-deep          # 深度初始化项目，补充工作流与 MCP 模板
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
- 内置默认 skill：`commit`、`review-pr`、`explain`
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
- 支持远程 MCP 服务注册、启停、探测和工具发现
- 支持直接调用远程 MCP tool
- 新增 CLI 命令：
  - `sacode mcp show <name>`
  - `sacode mcp remove <name>`
- 新增 REPL/TUI 命令：
  - `/mcps-show <name>`
  - `/mcps-remove <name>`

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

# 构建产物
cargo build --release
cargo build --release --target x86_64-pc-windows-gnu

# 平台清单
node scripts/write-platform-manifest.js <version>

# 发布检查
node scripts/check-release.js --strict-platforms

# npm 发布
cd npm-package && npm publish --access public
```

## 归档

`legacy/` 保留旧 Node/TS 代码作为历史参考，不参与编译。

## 许可证

[MulanPSL-2.0](./LICENSE)
