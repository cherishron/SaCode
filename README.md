# SaCode

SaCode 是一个终端优先的 Rust AI 编程工具，面向习惯在 Shell、Git、CLI 和代码库上下文里完成工作的开发者。

它的目标很直接：把“问模型”升级成“理解仓库、调用工具、执行任务、保留可控性”的完整终端工作流。

## 为什么用 SaCode

- 终端优先：默认入口就是 TUI，也支持单次任务、REPL、管道输入和服务模式。
- 工作区感知：围绕真实仓库结构、文件、Git diff、工具结果组织上下文。
- 可控执行：支持 `plan`、`build`、`yolo` 三种执行模式，对副作用操作做分级控制。
- 可扩展：内置 tools、skills、MCP、memory、wiki、checkpoint、insight 等能力。
- Rust workspace 架构：`kernel` 负责纯逻辑，`runtime` 负责副作用，`interfaces/*` 负责入口和协议适配。

## 安装

```bash
npm install -g @cherishron/sacode
sacode --version
```

当前 npm 包支持：

- Linux x64
- Windows x64
- macOS x64 (Intel)
- macOS arm64 (Apple Silicon)

## 30 秒上手

### 1. 打开交互界面

```bash
sacode
```

### 2. 配置模型 Provider

在 TUI 或 REPL 中输入：

```text
/login
```

依次填写：

1. Base URL，例如 `https://api.openai.com/v1`
2. API Key

### 3. 选择模型

```text
/models
```

`/models` 会展示所有已配置 provider 的模型，选择一次即可同时切换当前 provider 和默认 model。

### 4. 执行一个真实任务

```bash
sacode "分析当前仓库最值得优先修复的问题"
```

### 5. 初始化项目上下文

```bash
sacode init
```

这会为当前项目补齐 `AGENTS.md` 和 `.sacode/` 运行配置。

## 使用方式

### TUI 模式

```bash
sacode
```

TUI 是默认入口，适合持续对话、队列任务和多步执行。

常用快捷键：

- `Ctrl+Q`：退出
- `Esc`：清空输入或取消当前执行
- `Ctrl+T`：开启或关闭 thinking
- `Ctrl+M`：轮转执行模式 `plan` / `build` / `yolo`

常用内置命令：

- `/login`
- `/connect`
- `/providers`
- `/models`
- `/loop <task>`
- `/agents`
- `/memory`
- `/wiki`
- `/insight`
- `/update rollback`

### 单次任务模式

```bash
sacode "分析代码结构"
sacode "设计认证模块重构方案" --mode plan
sacode "修复当前测试失败" --mode build
sacode "批量格式化本仓库" --mode yolo
```

### 管道模式

```bash
git diff | sacode "生成提交说明"
cat README.md | sacode "总结当前文档缺口"
```

### REPL 模式

```bash
sacode repl
```

### 服务模式

```bash
sacode serve --acp --lsp
sacode acp serve
sacode lsp serve
```

### 诊断与状态

```bash
sacode status       # 查看 MCP、插件状态
sacode doctor       # 诊断 Provider、Memory、MCP 配置
```

### MCP 服务模式

```bash
sacode mcp serve    # 启动内置 MCP stdio server，暴露 fs.read/fs.list/git.diff
```

## 执行模式

| 模式 | 适用场景 | 特征 |
|------|----------|------|
| `plan` | 方案设计、任务拆解 | 只规划，不执行修改 |
| `build` | 日常开发任务 | 允许执行，修改类操作走审批 |
| `yolo` | 明确低风险批处理 | 自动执行，适合高确定性任务 |

## 项目结构

```text
.
├── Cargo.toml
├── kernel/              # 纯逻辑层
├── runtime/             # tools/provider/memory/wiki/orchestrator 等副作用层
├── interfaces/cli/      # sacode / sacode-tui 入口
├── interfaces/acp/      # ACP 服务
├── interfaces/lsp/      # LSP 服务
├── docs/                # 用户与开发文档
├── npm-package/         # npm 发布包
└── legacy/              # 历史归档，不参与当前 Rust 构建
```

## `.sacode/` 目录

SaCode 会在项目根目录维护运行数据：

```text
.sacode/
├── provider.json
├── mcp.json
├── profile.json
├── mistakes.json
├── project.json
├── audit.log          # 沙箱审计日志
├── skills/
└── checkpoints/
```

常见用途：

- `provider.json`：多 provider 和默认模型
- `mcp.json`：远程 MCP 服务配置
- `profile.json`：项目级偏好配置
- `mistakes.json`：错题本
- `audit.log`：所有 Modify 级工具操作审计记录
- `checkpoints/`：任务恢复点

## 核心能力

### Tools

内置工具覆盖文件、Shell、Git、Web、Browser、交互问答、媒体读取等能力。

| 工具 | 描述 | 审批 |
|------|------|------|
| `fs.read` | 读取文件 | 否 |
| `fs.search` | 搜索文件内容 | 否 |
| `fs.write` | 写入文件 | 是 |
| `fs.edit` | 编辑文件（精确替换） | 是 |
| `fs.patch` | 批量应用 patch | 是 |
| `fs.read_multi` | 批量读取文件 | 否 |
| `fs.list` | 列出目录 | 否 |
| `shell.exec` | 执行命令 | 是 |
| `git.diff` | 查看 Git 差异 | 否 |
| `git.commit` | 创建 Git 提交 | 是 |
| `web.fetch` | 抓取网页 | 否 |
| `web.search` | 联网搜索（百度/搜狗/360/必应） | 否 |
| `test.run` | 运行测试（cargo/npm/go/pytest） | 否 |
| `code.symbols` | 提取代码符号（5 语言） | 否 |
| `code.deps` | 分析文件依赖关系 | 否 |
| `media.read` | 读取媒体文件 | 否 |
| `media.vision` | 图片视觉识别（OCR/描述） | 否 |
| `interaction.ask` | 向用户提问 | 否 |
| `browser.*` | 浏览器相关操作 | 视工具而定 |
| `task.spawn` | 派生子任务 | 否 |

### Skills

- 工作区目录：`skills/`
- 项目级覆盖目录：`.sacode/skills/`
- 支持 slash 调用，例如 `sacode /commit`
- 支持 `skill list`、`skill show`、`skill run`

### MCP

- 配置文件：`.sacode/mcp.json`
- 支持安装、启停、探测、列工具、直接调用远程 MCP tools
- 内置 MCP stdio server：`sacode mcp serve`，暴露 `fs.read`、`fs.list`、`git.diff`

### Memory / Wiki / Insight

- `memory`：项目记忆与检索入口
- `wiki`：项目知识库与文档上下文
- `insight`：从历史交互总结个人使用习惯和优化建议

## 文档导航

- `docs/README.md`：文档总览
- `docs/guides/getting-started.md`：快速上手与常见操作
- `docs/guides/tutorials.md`：按真实任务组织的场景教程
- `docs/guides/examples.md`：可直接复制的提示词与命令示例
- `docs/reference/command-reference.md`：CLI / TUI 命令速查
- `docs/reference/architecture.md`：架构与模块分层
- `docs/reference/API.md`：CLI / TUI / 配置 / 工具接口说明
- `docs/reference/development.md`：本地开发、测试、调试与贡献
- `docs/release/RELEASE.md`：发布流程
- `docs/build/CROSS_COMPILE.md`：交叉编译说明
- `docs/product/PRD.md`：产品需求文档

## 开发命令

```bash
cargo test --workspace
cargo build --release
cargo run -p sacode-cli --bin sacode
node scripts/check-release.js
node scripts/check-release.js --strict-platforms
```

## 当前状态

SaCode 已具备可用的终端 AI 编程主线能力，包括：

- **23 个内置工具**：覆盖文件、Git、测试、代码智能、Web 搜索、媒体视觉、浏览器等
- **3 种执行模式**：`plan` / `build` / `yolo`，分级控制副作用操作
- **多 Agent 编排**：`/agents` 入口，支持 planner/coder/reviewer/tester 角色协作
- **MCP 生态**：支持远程 MCP 接入 + 内置 stdio server
- **沙箱审计**：所有 Modify 级工具操作记录到 `.sacode/audit.log`
- **Daemon + SSE**：11 个 REST 端点 + 实时事件流，支持外部集成
- **搜索引擎**：百度/搜狗/360/必应多引擎交叉验证
- **视觉识别**：`media.vision` 支持 OCR 和图片内容描述

当前仍在持续补齐多 agent 协作深度、tree-sitter 精确代码解析和 Windows 原生命令适配。

## 许可证

[MulanPSL-2.0](./LICENSE)
