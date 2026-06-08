# SaCode 版本变更记录

所有重要变更都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

---

## [0.1.27] - 2026-06-08

### 新增

- 核心工具补齐（6 个新工具，总数从 17 升至 23）
  - `test.run`：自动检测框架（cargo/npm/go/pytest），运行测试并返回结果
  - `git.commit`：安全 Git 提交，支持 `add_all`、`paths` 参数，强制显式授权
  - `fs.patch`：批量应用 unified diff patch，两阶段执行（先校验后落盘），CRLF/LF 兼容
  - `code.symbols`：提取代码符号（Rust/Python/JS/TS/Go），支持名称和类型过滤
  - `code.deps`：分析文件级依赖关系，构建 `imported_by` 反向映射
  - `media.vision`：图片视觉识别，支持 OCR 和内容描述两种模式

- 搜索引擎升级
  - 移除 DuckDuckGo，替换为百度/搜狗/360/必应多引擎
  - `auto` 模式按优先级尝试，交叉验证结果排序

- 默认值校准
  - `max_iterations` 默认值从 1 升至 3，反思循环激活
  - `/loop` 外层 `loop_max_iterations` 默认 10，与内层迭代解耦
  - CLI/REPL/TUI 配置缺失回退值统一

- 沙箱审计日志
  - 所有 Modify 级工具（`fs.write`、`fs.edit`、`fs.patch`、`git.commit`）写入 `.sacode/audit.log`
  - JSON 行格式，记录时间戳、工具名、阶段、状态、输入参数

- Daemon + SSE 统一输出
  - 11 个 REST 端点：任务 CRUD、重试、取消、状态追踪
  - `GET /api/stream` 和 `GET /events` SSE 事件流，支持 `task_id` 过滤
  - 统一 SSE `data` 协议

- MCP 生态
  - 内置 MCP stdio server（`sacode mcp serve`）
  - 暴露 `fs.read`、`fs.list`、`git.diff` 三个只读工具
  - 支持 `initialize`、`tools/list`、`tools/call` MCP 方法

- CLI 命令
  - `sacode status`：查看 MCP、插件状态
  - `sacode doctor`：诊断 Provider、Memory、MCP 配置

- TUI `/agents` 入口
  - `/agents list`：列出内置角色（planner/coder/reviewer/tester）
  - `/agents run <任务>`：启动多角色编排执行

- `/loop` 轮次策略优化
  - `hit_round_limit` 从"立即停止"改为"继续下一轮"
  - 续跑附带缩小范围提示，连续失败 3 次自动停止

- `/update rollback` 版本回滚支持

### 变更

- provider SSE 增量解析已在 `runtime/src/provider/client.rs` 中实现
- Plan 模式支持跳过 `tool_approval` 并追加执行确认提示
- footer 上下文显示恢复为圆环加百分比

---

## [0.1.9] - 2026-05-25

### 新增

- LLM-driven tool calling（替代硬编码 supervisor 流程）
  - `tool_chat()` 多轮工具调用循环（最多 12 轮）
  - 模型自主决定调用哪些工具、解析结果、继续对话
  - `ToolDefinition` / `ToolCall` / `FunctionCall` 结构体
  - `ChatMessage` 支持 `tool_calls`、`tool_call_id`、`name`、`reasoning_content`
  - `ChatRequest` 支持 `tools`、`thinking` 字段
  - Approval policy 集成：基于 `ToolSpec.needs_approval()` 判断

- 小米 MiMo thinking 模式（仅 MiMo 系列模型）
  - 请求自动附带 `thinking: {type: "enabled"}`
  - 响应解析 `reasoning_content` 字段
  - 多轮对话保留 `reasoning_content`（否则 MiMo API 返回 400）
  - `ProviderKind::Mimo` 自动检测（URL 含 xiaomimimo/token-plan 或 model 以 mimo 开头）

- `/connect` 快速接入预设 Provider
  - REPL: 交互式选择预设 + 输入 API key
  - TUI: `/connect` 显示预设列表，`/connect <编号> [key]` 快速配置
  - 预设: MiMo Token Plan、OpenAI、DeepSeek、Ollama

- 共享 runner 模块
  - `interfaces/cli/src/runner.rs` 统一 CLI/REPL/TUI 执行链
  - `format_output()` / `format_chat_output()` 含 reasoning 展示

- 单元测试覆盖
  - kernel: ChatRequest 构造、needs_thinking、ChatMessage 工厂方法、ToolDefinition 序列化
  - runtime: ChatResponse 反序列化（含 reasoning_content + tool_calls）、ToolChatResult
  - cli: detect_provider_kind 5 种场景

### 变更

- `ChatMessage.content` 从 `String` 改为 `Option<String>`（所有消费方已更新）
- CLI/REPL/TUI 执行路径统一调用 `run_task()` → `run_tool_chat()`
- 旧 `cmd/mod.rs` 执行逻辑标记 `#[cfg(test)]` 仅供测试保留

---

## [0.1.8] - 2026-05-22

### 新增

- skills 系统基础版
  - `skills/` 目录
  - `skill list` / `skill show`
  - slash skill 调用：`/commit`、`/review-pr`、`/explain`

- MCP 配置基础版
  - `.sacode/mcp.json`
  - `mcp list` / `mcp add` / `mcp enable` / `mcp disable`
  - `mcp inspect` / `mcp tools`
  - `mcp call`

- 联网工具基础版
  - `web.fetch`
  - `web.search`

### 修复

- TUI 键绑定调整
  - Ctrl+Q 退出（替代 Esc）
  - Esc 清空当前输入（取消单次对话）

---

## [0.1.7] - 2026-05-22

### 变更

- TUI 重构为聊天式交互界面
  - 消息区域显示时间戳 + 用户/SaCode 标识
  - 底部输入框，placeholder 提示输入任务
  - 支持滚动浏览历史消息

---

## [0.1.6] - 2026-05-22

### 新增

- 平台清单机制 (`platforms/manifest.json`)
  - 记录发布版本和包含的二进制文件
  - 发布检查脚本强制验证清单一致性
  - 防止"新壳旧核"问题

- 交叉编译支持
  - Linux 环境可直接编译 Windows 二进制
  - `.cargo/config.toml` 配置 mingw-w64 linker

- 文档分类
  - `docs/release/RELEASE.md` - 发布流程文档
  - `docs/build/CROSS_COMPILE.md` - 交叉编译指南

### 变更

- CLI 默认行为改为进入 TUI
  - `sacode` 无参数直接启动终端 UI
  - 保留 `sacode tui` 显式入口
  - 保留 `sacode repl` REPL 模式

- 发布检查增强
  - 新增 manifest.json 校验
  - 新增版本一致性强制检查
  - CI 流程写入 manifest 再发布

- npm 包内容更新
  - 包含 `platforms/manifest.json`
  - Linux 二进制大小: 9.4MB
  - Windows 二进制大小: 45.2MB

### 修复

- 修复 Windows 用户安装后仍是旧版本的 bug
  - 根因: npm 包包含旧 Windows 二进制
  - 解决: 重新构建并验证 manifest 机制

---

## [0.1.5] - 2026-05-22

### 新增

- TUI 模块提取为共享代码
  - `interfaces/cli/src/tui.rs`
  - `sacode` 主入口可调用 TUI

### 变更

- 文档更新入口行为说明
  - `README.md`
  - `docs/reference/API.md`
  - `npm-package/README.md`

### 问题

- 发布后发现 Windows 二进制仍是旧版本
- 缺少平台清单校验机制

---

## [0.1.4] - 之前版本

历史版本记录待补充。

### 已实现功能

- 工作区结构: `kernel/`, `runtime/`, `interfaces/cli/`
- Kernel: agents, events, schema, supervisor, reviews, checkpoints
- Runtime: tools, provider client, plugin host, daemon, sandbox
- CLI: run, profile, plugin, init, repl, checkpoint 子命令
- FFI: `cdylib` 导出, C header
- SSE daemon: 任务状态跟踪, 事件流
- npm 发布: `@cherishron/sacode`
- CI: test.yml, npm-test.yml, release.yml

---

## 版本规划

### 近期

- 真实 LLM provider streaming ✅ (0.1.27)
- 完善审批流 UI ✅ (Plan 模式跳过 tool_approval)
- Checkpoint 持久化
- 测试覆盖提升
- tree-sitter 精确代码解析（替代正则）
- similar diff 算法引入（增强 fs.patch 容错）

### 中期

- macOS 支持
- 多语言 SDK (Python, Go)
- Web UI

### 远期

- 多 agent 协作深度增强
- IDE 插件
- 云端部署

---

## 获取最新版本

```bash
npm install -g @cherishron/sacode
sacode --version
```

或查看 npm registry:

```bash
npm view @cherishron/sacode version
```
