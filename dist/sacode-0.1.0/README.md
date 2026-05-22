# SaCode

SaCode 是一个终端优先的 AI 编程工具。

当前仓库已经完成第一步骨架迁移：从根目录单体 Rust 程序切换为 workspace 结构，为后续由不同模型和开发者协作扩展功能提供稳定基础。

## 当前结构

```text
.
├── Cargo.toml
├── rust-toolchain.toml
├── .cargo/
│   └── config.toml
├── kernel/
├── runtime/
├── interfaces/
│   └── cli/
├── docs/
├── legacy/
│   └── src/
└── LICENSE
```

## 已落地骨架

### `kernel/`

负责纯逻辑层，当前包含：

1. `agent`：Planner（规划）、Coder（执行意图生成）、Reviewer（审查）、Supervisor（调度闭环）
2. `model`：Profiles、Provider、Router、ChatRequest/Response
3. `schema`：Task、Session、Choice、ExecutionMode、Checkpoint、Review、Plan、Step
4. `event`：统一事件模型（Event、ApprovalAction、FileChangeType）
5. `error`：统一结果类型

### `runtime/`

负责副作用和能力层，当前包含：

1. `tools`：FS（read/search/edit）、Shell（exec 带超时和安全限制）、Git（diff/commit）、Code（ast/symbol）
2. `workspace`：Scanner、Graph、Context
3. `store`：DB、Cache
4. `plugin`：Loader、Registry
5. `streaming`：SSE
6. `spec`：ToolSpec 协议定义
7. `provider`：ProviderClient（OpenAI、DeepSeek、Ollama）

### `interfaces/cli/`

负责 `sacode` 命令入口，当前包含：

1. `bin/sacode.rs`：可执行入口
2. `cmd/`：命令解析、主执行回路、profile、plugin、init 子命令
3. `ui/`：Ghost、Chat、Agent、Palette、Widgets 占位
4. `repl.rs`：可运行 REPL 模式

## 当前可用能力

已经可以运行完整 CLI 功能：

```bash
# 任务执行
cargo run -p sacode-cli --bin sacode -- "分析这个仓库" --mode plan
cargo run -p sacode-cli --bin sacode -- "找 bug" --mode yolo --json

# Profile 管理
cargo run -p sacode-cli --bin sacode -- profile ls
cargo run -p sacode-cli --bin sacode -- profile show

# Plugin/Tool 查看
cargo run -p sacode-cli --bin sacode -- plugin list

# REPL 模式
cargo run -p sacode-cli --bin sacode -- repl
```

支持：

1. `--mode plan|build|yolo`
2. `--json`
3. 从 `stdin` 读取输入
4. 输出规划结果和工具清单
5. Profile 和 Plugin 子命令
6. REPL 交互模式

示例：

```bash
cat README.md | cargo run -p sacode-cli --bin sacode -- "总结输入内容" --json
```

## 文档

1. 产品需求文档：`docs/PRD.md`

## 归档

1. 旧单体代码已归档到 `legacy/src/`，约 5200 行，不再参与编译，可作为历史参考。

## 下一步建议

1. 接入真实工具执行（fs.read、shell.exec）
2. 实现审批流（ApprovalRequested/ApprovalResolved）
3. 实现完整 TUI 界面（Ratatui）
4. 补充单元测试和集成测试
5. 添加 streaming 响应支持
6. 实现真实的 Checkpoint 保存和恢复
| @sacode/database | Prisma ORM，多数据库适配 |
| @sacode/auth | Passport.js 认证，JWT，OAuth |
| @cherishron/sacode-cli | CLI 工具（npm 全局安装包） |
| @sacode/capabilities | 文件/浏览器/Shell 自动化 |
| @sacode/api | Hono REST API + WebSocket (Bun.serve()) |
| @sacode/web | Vue 3 + TinyVue + Tailwind CSS |

### 消息流

```
用户输入 (CLI/Web/IM)
       ↓
   SACODEClient
       ↓
   AI Provider (OpenAI/Anthropic/...)
       ↓
    AI 模型响应
       ↓
  ┌────┴────┐
  ↓         ↓
工具调用   直接响应
  ↓
ToolBridge
  ↓
┌────────┴────────┐
↓                 ↓
内置工具      外部工具
(think/plan)  (MCP/Capabilities)
  ↓
继续对话循环
  ↓
   输出到用户
```

### Agentic 流程

```
用户请求
    ↓
复杂度评估
    ↓
┌────┴────┐
↓         ↓
简单     复杂
↓         ↓
直接执行  生成计划
          ↓
      Orchestrator
          ↓
    ┌────┴────┐
    ↓         ↓
  Agent    执行步骤
  分配     (带重试)
    ↓         ↓
    └────┬────┘
         ↓
      结果汇总
         ↓
      输出响应
```

## 测试

```bash
bun test                 # 运行所有测试
bun test --watch         # 监视模式
bun test --coverage      # 测试覆盖率
```

## 贡献

欢迎贡献代码！请阅读 [贡献指南](./CONTRIBUTING.md) 了解详情。

- 提交 Issue 报告 Bug 或建议新功能
- 提交 Pull Request 贡献代码
- 遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范

## 许可证

[MIT](./LICENSE) © STAND-ALONE

## 作者

**STAND-ALONE**
- Email: 1635936133@qq.com
- GitHub: [@STAND-ALONE](https://github.com/STAND-ALONE)
