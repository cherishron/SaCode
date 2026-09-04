# SaCode 版本变更记录

所有重要变更都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增

- daemon 新增 `GET /task/:id/approvals`，客户端可恢复连接前或离线期间仍在等待的审批。
- daemon 新增 `GET /metrics`，暴露审批 requested/pending/approved/denied/timed_out/cancelled 与等待时间指标。
- `/metrics` 增加 SSE 连接、投递、回放、lagged 与 executor forwarder 丢包指标。
- VSCode 任务流意外中断后携带 `Last-Event-ID` 自动重连，并在每次连接成功后查询待审批列表对账。
- VSCode 对 `fs.edit` / `fs.apply_patch` 审批使用原生 Diff Editor；多文件 patch 可逐文件接受或拒绝。
- 审批 API 支持受限 `args_override.paths`，用于只执行经用户接受的 `fs.apply_patch` 文件。
- 会话投影支持 checkpoint 增量回放：`.sacode/checkpoints/<session_id>.json`，重启后续号，旧 `events.log` 缺 `seq` 仍可回放。
- 文档明确 `audit.log` 与 `events.log` 的职责边界、关联方式、保留策略与敏感字段。
- VSCode 扩展发布工程化：兼容矩阵、VSIX SHA-256、Ubuntu/Windows/macOS 打包冒烟；VSIX 不自动发布 Marketplace/Open VSX。

## [1.1.1] - 2026-09-03

### 新增

- VSCode 扩展 0.2.1 声明最低 daemon 1.1.1，运行时拒绝连接更旧版本。
- 发布门禁增加审批 smoke、pytest quarantine、VSCode compile/test、确定性 VSIX 双次 SHA-256 和归档 metadata 检查。
- `docs/release/1.1.1.md` 提供升级、回滚与已知限制说明。

- **VSCode 扩展 v0.2.0**（`f5f79fa`）
  - 自动探测并管理本地 `sacode serve` daemon，支持自定义 `sacode.binaryPath`、状态栏和重启命令
  - 将编辑器选区注入任务上下文，并在面板中展示 `fs.edit` / `fs.apply_patch` diff
  - `sacode serve` 无协议参数时启动 HTTP daemon；默认仍只监听 `127.0.0.1:8080`

- **VSCode 审批流可视化**（`7576005`）
  - daemon 新增 `approval_requested` / `approval_resolved` SSE 事件与 `POST /task/:id/approve` 回传端点
  - Build 模式工具调用可在 VSCode QuickPick 中显式允许或拒绝
  - **安全影响**：未收到有效审批、审批通道关闭或等待超时时默认拒绝，不再由 daemon 自动批准交互式工具调用
  - **兼容性影响**：HTTP/SSE 协议为增量扩展；旧客户端可继续连接，但无法应答的新审批请求会安全拒绝

- **Phase2 平台化补全**
  - Windows 命令适配：内置命令自动 `cmd.exe /C` 包裹、危险命令检测、进程组隔离（`CREATE_NEW_PROCESS_GROUP` + `taskkill /T`）
  - macOS 支持：CI release 双架构（`x86_64` + `aarch64`）、npm darwin 二进制映射
  - 增量索引缓存：`code/cache.rs` 中的 AstCache + FileListCache，基于 mtime 驱动失效
  - CI 自动修复：`cargo fmt --check` + `cargo clippy` + `auto-fix.yml` PR 自动格式化

- **模型库全面升级**
  - DeepSeek：`deepseek-v4-pro` / `v4-flash` 升级至 1M 上下文 / 384K 输出
  - OpenAI：`gpt-5.4`（128K/16K）/ `gpt-5.5`（1M，输出待定）
  - LongCat：精简为 `LongCat-2.0-Preview`（1M/128K，免费）
  - MiMo：移除 `v2-omni`，保留 `v2.5-pro`（图文）/ `v2.5`（文本）
  - Ollama：`glm-4.7-flash`

- **TUI 三态渲染验证**（report-plan 步骤 2）
  - `render_messages_panel_groups_thinking_and_status_messages` 断言恢复为真实状态渲染：运行中▶/成功✓/失败✗图标与文案验证
  - 工具名、摘要字段渲染测试

- **PendingApprovalRequest 操作摘要增强**（report-plan 步骤 5.2/6.2）
  - 增加 `input_summary: Option<String>` 字段，来源：tool_approval JSON args.command / args.path
  - 审批面板渲染：工具名 + 操作摘要 + 影响范围（allowed_dir）+ 确认/拒绝快捷键提示

- **events.log 事件日志格式文档**（report-plan 步骤 B2）
  - `.sacode/events.log` 字段定义（type/session_id/ts/seq/tool/input/output/success/error/reason）
  - SIEM 接入示例（Filebeat/Logstash，索引 sacode-events-*）

- **拦截器按 Profile 挂载**（`with_profile_interceptors`）
  - 从 Profile manifest `extra.interceptors` 数组解析并追加到默认链
  - `interceptor_by_name()` 注册表支持 5 种拦截器按需加载

### 变更

- release workflow 将 `sacode-vscode-0.2.1.vsix` 与四平台 CLI 二进制附加到同一 `v1.1.1` release。
- VSIX 使用固定 `@vscode/vsce` 3.9.2，并对 ZIP metadata 做确定性规范化。
- VSCode SSE 解析与 daemon 的 `event_type` / `payload` 协议对齐，保留旧 `event` / `kind` 字段回退
- 测试文件中的旧模型名更新为当前模型库
- `.gitignore` 新增 `dist/`、`build/`、`.monkeycode/` 忽略

### 修复

- daemon 审批使用一次性 `approval_id`，修复注册竞态和同任务并发审批覆盖。
- daemon 审批等待改为异步，超时、取消和通道关闭均默认拒绝。
- VSCode 审批弹窗关闭按显式拒绝处理，SSE 解析和错误报告更加健壮。
- Windows Rust CI 使用非 doctest workspace 测试、逐 crate 串行 doctest 和独立 quarantine。
- Provider 配置降级链：`resolve_provider` 在 model 为空时不再跌入 `ModelProvider::openai`
- `connect_provider` 始终保存 provider 配置，确保 `default_model` 不为空
- MiMo `base_url` 对齐：构造函数与 preset 统一为 `token-plan-cn.xiaomimimo.com`
- T7 事件投影 `project_session_state()`：total_calls/completed/failed/denied 计数
- T8 Profile-based interceptor mounting（单 Agent 路径接线）
- T9 test.run `timeout_ms` 参数 + 最小值钳制（1000ms）
- `--remote` Run 路径静默忽略告警（N3）
- profile.extra.interceptors 非数组类型校验警告（N4）
- RemoteContext 路径单引号引用（shell 注入防护）
- read_bytes_partial LocalContext 覆写为 File::take 流式读取
- orchestrator_entry.rs 未使用 subsystems 变量清理
- TUI 断言 `contains("...running")` 恢复为真实状态渲染

---

## [1.1.0] - 2026-08-20

### 新增

- **v1.1 稳定化**：编译器 10 条 warning 清零，预提交钩子升级为 fmt → clippy → build → test 全关卡

- **C1 远程路径映射层**
  - `ExecutionContext::resolve_path` trait 方法，LocalContext / RemoteContext 分别实现
  - 14 个 FS 工具调用点从 `resolve_allowed_path` 迁移到 `current_context().resolve_path()`
  - RemoteContext `read_bytes` 二进制安全（base64 编码传输）

- **C2 LoopSubsystems 贯穿**：自防护门控下沉至干预点，修复闭环受 `self_protection` 控制

- **C3 事件流投影收尾**（`SessionEventLog`）
  - `seq` 字段落盘（`#[serde(default)]`），旧 events.log 可兼容回放
  - `replay_disk_after(last_seq)`：磁盘 JSON 行回放，旧日志按行序重建 seq
  - `project_session_state_complete()`：磁盘全量 + 内存增量合并投影
  - `SessionStateProjection.truncated` 标志暴露缓冲环状淘汰状态
  - `new_with_path()` 构造器支持注入落盘路径（测试隔离，消除 `.sacode/events.log` 污染）
  - 测试：磁盘回放 seq 连续性 / 旧日志兼容 / 投影幂等（内存+磁盘）/ 淘汰恢复

- **§3.2 拦截器补缺**（Retry 重试闭环 + 异步拦截器基建）
  - `execute_with_ctx` 重试循环：执行失败且有 Retry 决策时按 `max_attempts` 重试（上限 `MAX_RETRY_ATTEMPTS = 3`）
  - 每轮重试重跑完整 pre/post 链（审计完整），成功时 Retry 决策等价 Keep（默认行为零变化）
  - `AsyncToolInterceptor` trait + `BoxFuture`（手写，零 async_trait 依赖）
  - `SyncInterceptorAsAsync` 适配器：既有同步链逻辑可被异步入口复用
  - `execute_with_ctx_async`：同步链先跑 + 异步链后跑，Retry 在 async 入口生效
  - 测试：Retry 直到成功 / 超限返回失败 / 成功忽略 Retry / Deny 不重试 / 异步 Deny 阻断 / 异步 Allow 放行 / 同步+异步链顺序 / async 入口 Retry / 同步入口忽略异步链

### 变更

- `SessionEventLog::new()` 内部结构调整：增加 `evicted_total` 计数与 `new_with_path` 构造器（原签名不变）
- `record()` 落盘 double-lock 修复：一次 lock 取 path clone 后立即释放，消除 TOCTOU 窗口

### 修复

- `record()` 内存缓冲环状淘汰时 `evicted_total` 未递增
- `project_session_state()` 静默偏低问题：新增 `truncated` 标志显式暴露淘汰状态

## [1.0.0] - 2026-08-19

### 新增

- **v1.0+ 产品就绪四大里程碑**
  - M1 自动修复闭环：`test.fix` 失败后进入 `FixLoopState` 迭代状态机，orchestrator 桥接 `dispatch_fix_loop`，记录 `FixOutcome` 修复度量
  - M2 Agent 协作协议：`AgentMessage` 扩展 `task_state`/`priority`/`reply_to`/`deadline`，`request_and_wait` 双向通信，`validation_conflict` 实时触发修复，`role_registry` 动态角色，消息历史持久化
  - M3 学习型记忆：`AutoLearner` 自动学习回路 + BM25 搜索 + 记忆衰减 + SQLite 双写（`memory_entries`/`mistake_entries`）
  - M4 多模态产品化：`media.vision` 超时/降级/缓存/错误分类加固；`media.video` 视频帧提取（ffmpeg 调用，不可用优雅降级）

- **VSCode 扩展 MVP**（`interfaces/vscode/`）
  - 侧边栏 Webview 面板：输入框 + 消息流
  - 4 个命令：`sacode: Start`、`sacode: Stop`、`sacode: Clear`、`sacode: Toggle Sidebar`
  - SSE 连接 daemon（`/health`、`POST /task`、`GET /task/:id/result`、`/api/stream`）
  - `sacode ide install` 自动检测 VSCode CLI 并安装扩展

- **TUI Loop 阶段进度条**
  - 顶部 `[OK] [>>] [  ]` 阶段标签可视化多 Agent 执行阶段
  - `loop_state: Option<LoopState>` 跟踪轮次与阶段

- **`/goal` 轻量命令**
  - 替代四层自治架构：`/goal <完成条件>` 设定任务完成条件
  - 任务执行完毕后自动关键词匹配检查

- **yolo → auto 模式重命名**
  - 内部变体名保留 `Yolo`，Display 输出 `auto`，serde 序列化 `auto`，反序列化兼容旧值 `yolo`
  - CLI `--mode` 接受 `auto|yolo`，TUI/REPL 显示 `auto`

- **Provider 零配置接入**
  - 内置预设：DeepSeek、通义千问（Qwen）、智谱 GLM、MiMo、LongCat、OpenAI、Ollama
  - `/login` 交互式两步配置：选择预设 → 输入 API Key
  - 自动检测 Provider 类型并匹配模型库

- **知识系统 9→3 文件合并**
  - `project.md`（项目事实与通用记忆）
  - `experience.md`（工作流与决策经验）
  - `preferences.md`（偏好与策略）

- **统一任务状态机**
  - `TaskState` 枚举 + 合法转移图 + 统一 `task_id` 生成
  - Session SQLite 持久化，`TaskRunState::Cancelled` 区分取消与失败
  - daemon 跨进程 checkpoint 恢复桥接

- **LSP 代码智能深度**
  - 5 语言 AST 解析（rust/python/javascript/typescript/go）
  - LSP 诊断（cargo / tsc / py_compile / go vet）
  - `documentSymbol` / `workspaceSymbol` / `hover` 诊断联动
  - 跨文件引用（`references` / `goto_definition`）

- **工具链扩展**
  - `test.run`：自动检测框架（cargo/npm/go/pytest），失败测试 `location` 提取
  - `test.fix`：自动修复闭环（分析→修补→验证→成功/超限）
  - `git.commit` / `git.push` / `git.pr`（close/reopen/merge）
  - `fs.apply_patch`：标准 Git patch format 解析应用
  - `code.symbols` / `code.deps`（Rust 模块路径解析）
  - `media.vision` / `media.video`

- **MCP/ACP 生态**
  - MCP stdio server（`sacode mcp serve`）
  - 插件发现、配置安装、远端元信息搜索
  - WASM 插件下载安装

- **CI/CD 与发布**
  - `check-release.js` Windows 兼容（`npm.cmd` + `shell:true`、tar CRLF 解析）
  - 自动发布流程：GitHub Actions 四平台构建 + npm publish + GitHub Release
  - 沙箱审计日志（`.sacode/audit.log`，JSON 行格式）

### 变更

- `yolo` 模式重命名为 `auto`（`--mode yolo` 仍兼容，serde alias）
- 平台化收敛：ACP/LSP/Daemon 维持现状，资源集中到 IDE 插件/provider 零配置/首次体验
- 冲突检测五维矩阵 → 审批流 + 危险命令拦截
- Provider 配置降级链修复，默认模型不再跌入 OpenAI
- 搜索引擎从 DuckDuckGo 替换为 Baidu/Sogou/360/Bing

### 修复

- LSP active_connections 计数器泄漏
- LSP UTF-16 偏移导致 panic
- LSP 多处 document mutex poisoned expect
- cache.rs RwLock unwrap panic
- provider/client.rs tool_calls unwrap panic
- git/pr.rs truncate_str 非字符安全切片
- ACP max_connections 未强制执行
- ACP 不支持的 JSON-RPC 方法返回成功
- MistakeRecorder 参数语义错乱
- MCP 工具注册错误被静默忽略
- 单 Agent 模式 ExecutionReport 缺失字段
- 测试运行器缺少超时强制
- 编排器 current_dir 竞态
- shell/exec.rs split_command 反斜杠 panic
- serial_test 依赖位置和 session sleep 竞争
- 跨平台稳定性：shell.exec/stty/id 命令平台条件编译
## [0.1.28] - 2026-06-08

### 新增

- macOS 平台支持
  - GitHub Actions CI 支持 macOS 测试和构建
  - npm 安装链路支持 macOS x64（Intel）和 arm64（Apple Silicon）
  - 发布检查脚本支持 macOS 平台验证
  - 交叉编译文档添加 macOS 构建指南

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

## [0.1.7] - 2026-05-22

### 变更

- TUI 重构为聊天式交互界面
  - 消息区域显示时间戳 + 用户/SaCode 标识
  - 底部输入框，placeholder 提示输入任务
  - 支持滚动浏览历史消息

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

## 版本规划

### 近期

- 真实 LLM provider streaming ✅ (0.1.27)
- 完善审批流 UI ✅ (Plan 模式跳过 tool_approval)
- Checkpoint 持久化
- 测试覆盖提升
- tree-sitter 精确代码解析（替代正则）
- similar diff 算法引入（增强 fs.patch 容错）

### 中期

- macOS 构建、测试与发布链路 ✅（真实 npm 发布安装仍需版本发布后验证）
- 多语言 SDK (Python, Go)
- Web UI

### 远期

- 多 agent 协作深度增强
- VSCode IDE 插件 ✅（v0.2.0，含 daemon 管理、SSE、diff 与审批交互）
- 云端部署

## 获取最新版本

```bash
npm install -g @cherishron/sacode
sacode --version
```

或查看 npm registry:

```bash
npm view @cherishron/sacode version
```
