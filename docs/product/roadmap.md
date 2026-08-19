# SaCode 产品路线图

> 更新时间：2026-08-19
> 当前版本：1.0.0
> 配套文档：`docs/product/PRD.md`、`docs/report.md`、`docs/report-plan.md`

本文件只回答三件事：当前处在哪个阶段、下一阶段交付什么、后续能力按什么顺序演进。

## 平台化收敛声明（2026-08-18）

基于《SaCode 可行性评估报告》（docs/report.md）维度三"整体方向是否跑偏"结论：

- **定位调整**：明确为"面向国内开发者的终端 AI 编程工具"，平台化是结果不是起点
- **核心叙事**："Claude Code 的体验，国内模型原生适配，企业级可审计"
- **资源重新分配**：停止 ACP/LSP/Daemon 的深度投入，资源集中到三个最高 ROI：
  1. IDE 插件（VSCode 扩展，P1）
  2. 国内 provider 零配置接入（P0）
  3. 首次使用体验优化（P0）
- **过度设计简化**（详见 docs/report-plan.md 步骤 4）：
  - Loop 四层自治架构 → 轻量 `/goal`
  - 知识系统 9 文件分类 → 3 文件
  - 五维冲突检测 → 审批 + 拦截

ACP/LSP/Daemon 维持现有能力，不在本期扩展新功能。

## 当前阶段判断

SaCode 当前已经具备可用的终端 AI 编程主线能力，核心优势集中在：

1. CLI / TUI / REPL 多入口
2. 多 Agent 编排
3. 模型智能路由
4. 结构化记忆与项目知识能力

当前代码中已经完成或基本完成的能力包括：

1. provider SSE 增量流式解析
2. `test.run`、`git.commit`、`fs.patch`、`fs.apply_patch`、`git.push`
3. `code.symbols`、`code.deps`（含 Rust 模块路径解析）
4. `media.vision`
5. MCP `stdio` server 与 `sacode mcp serve`
6. 插件发现、配置安装、远端元信息搜索
7. AST 解析（5 语言：rust/python/javascript/typescript/go）
8. LSP 诊断（cargo / tsc / py_compile / go vet）+ documentSymbol / workspaceSymbol / hover 诊断联动
9. Session SQLite 持久化
10. daemon SSE 中间事件透传

当前阶段：**v0.3、v0.5、v0.7 已完成收口，v1.0+ 产品就绪里程碑已进入实施（M1 自动修复闭环 / M2 Agent 协作协议 / M3 学习型记忆 / M4 多模态产品化 均已落地）**。

v1.0+ 四大瓶颈的实施顺序（推荐方案 B，调整为 1→3→4→2）：

1. ✅ 自动修复闭环 — `test.fix` 失败后进入 `FixLoopState` 迭代状态机，orchestrator 桥接 `dispatch_fix_loop`，记录 `FixOutcome` 修复度量
2. ✅ Agent 协作协议 — `AgentMessage` 扩展 `task_state`/`priority`/`reply_to`/`deadline`，`request_and_wait` 双向通信，`validation_conflict` 实时触发修复，`role_registry` 支持动态角色，消息历史持久化 `.sacode/agent-messages.json`
3. ✅ 学习型记忆 — `AutoLearner` 于 session 压缩后自动提取 mistakes / preferences / code_patterns；`search_memory_index` 升级 BM25；`decay_memory_entries` 低频衰减；`StoreDb` 新增 `memory_entries` / `mistake_entries` 双写
4. ✅ 多模态产品化 — `media.vision` 超时控制 + 多级降级链 + `VisionCache` LRU 缓存 + `VisionError` 错误分类；新增 `media.video` 视频帧提取（ffmpeg 调用，ffmpeg 不可用优雅降级）

## 版本路线

### v0.3：核心体验闭环 ✅ 已完成（2026-08-12）

目标：让 SaCode 的终端主回路达到"可持续执行、可实时反馈、可精确修改、可形成提交"的完成态。

**完成状态**：四项重点交付全部闭环，详见 [plan-optimization.md](../plans/plan-optimization.md) "v0.3 核心体验闭环收口" 章节。

重点交付：

1. ✅ SSE / 实时流式输出 — daemon 透传 task_runner 中间事件（工具调用 / 模型切换 / 节点评分）到 `/api/stream`，支持 `task_id` 过滤
2. ✅ 持久化任务存储 — Session SQLite 持久化，`store/db.rs` 带 timeout lock；`TaskRunState::Cancelled` 区分用户取消与失败
3. ✅ `apply_patch` / `diff_edit` — `fs.apply_patch` Git patch format 解析应用；`fs.edit` 与 `fs.patch` 容错策略对齐 + preflight 预检
4. ✅ Git 提交闭环工具 — `git.commit` LLM 自动生成消息；`git.push` 独立推送；`git.pr` close/reopen/merge

### v0.5：代码智能深度 ✅ 已完成（2026-08-12）

目标：从文本级辅助进入语义级代码理解与验证。

**完成状态**：四项重点交付全部闭环，路径 C 收口（聚焦已有能力但未桥接的缺口），详见 [plan-optimization.md](../plans/plan-optimization.md) "v0.5 代码智能深度 — 路径 C 收口" 章节。

重点交付：

1. ✅ AST 解析 — tree-sitter 5 语言（rust/python/javascript/typescript/go），`AstCache` 512 条 LRU + mtime 失效
2. ✅ 符号索引 — `code.symbols` AST 符号提取；`code.deps` 依赖图含 Rust 模块路径解析（`crate::` / `super::` / `self::`）；LSP `documentSymbol` 嵌套 children + `workspaceSymbol` 跨文档搜索
3. ✅ LSP 诊断集成 — cargo / tsc / py_compile / go vet 四语言诊断；`last_diagnostics` 缓存；hover 附加位置重叠诊断段落
4. ✅ `test.run` 测试运行器 — 自动检测框架（cargo/npm/go/pytest）；失败测试 `location` 提取（cargo `panicked at` 与 `error[E0XXX]` 两种格式）

**延后项**（低 ROI，非功能缺口）：AstCache 改真 LRU、`test.run` 扩展 Node 框架（vitest/playwright）。

### v0.7：生态与集成 ✅ 已完成（2026-08-12）

目标：把 SaCode 从本地 CLI 工具扩展为可被集成的能力平台。

**完成状态**：9 项重点交付全部闭环，测试总数 41 个新增 + 既有的 runtime（468 测试）、CLI（206 测试）、LSP（30 测试）、ACP（4 测试）全部通过。

重点交付：

1. ✅ MCP stdio 协议完备 — server 支持完整 JSON-RPC 错误码（-32700/-32601/-32602/-32603）+ notifications + resources/prompts 协议方法（12 测试）；client 支持 stdio 子进程 transport（`StdioMcpClient` + 4 个 transport 分派函数 + CLI `mcp add --stdio`）
2. ✅ 插件发现与分发 — 发现层与配置层已就绪，`plugin install` 支持从 `download_url` 下载 WASM 文件到 `.sacode/plugins/wasm/`
3. ✅ 检查点增强 — `task_id → file` 索引 + `restore` 真正恢复执行（增强 prompt 注入工具历史 + `--dry-run`/`--mode`/`--max-iter`/`--approve`） + `diff` 对比（4 种差异类型：Added/Removed/CountChanged/ResultChanged）
4. ✅ ACP 流式推送 + stdio — `run_stdio_server` 子进程模式 + `session/prompt` 事件流式推送（event notification 前缀）+ `initialize` 声明 streaming 能力
5. ✅ IDE 配置生成 — `/ide generate` 创建 `.vscode/settings.json`（合并保留现有配置）+ `tasks.json`（ACP/LSP 启动任务，按 label 去重）+ `extensions.json`（推荐扩展）
6. ✅ WASM 插件下载 — `PluginEntry` 新增 `download_url`/`wasm_path` 字段，`install_plugin` 自动下载 WASM 文件
7. ✅ LSP 跨文件引用 — `references` 和 `goto_definition` 从单文件搜索扩展为遍历所有已打开文档

### v1.0+：产品就绪 ✅ 已发布（1.0.0）

目标：形成自动化闭环、协作协议和长期平台能力。

> **状态说明**：v1.0+ 四大产品就绪里程碑（M1-M4）能力维度已完成落地，版本号已发布为 `1.0.0`（`Cargo.toml` `[workspace.package].version` / `npm-package/package.json` / platform manifest 均已同步）。正式发布流程：`node scripts/sync-version.js 1.0.0` + `node scripts/check-release.js --strict-platforms` + GitHub release。

重点交付（实施顺序 1→3→4→2）：

1. ✅ 自动修复闭环 — `FixLoopState` 状态机驱动 "分析→修补→验证→成功/超限"，最大 3 轮硬上限（详见 `runtime/src/tools/test/autofix.rs`、`runtime/src/agents/orchestrator.rs`）
2. ✅ 多模态产品化 — `media.vision` 超时/降级/缓存/错误分类加固；新增 `media.video` 视频帧提取（详见 `runtime/src/tools/media/`）
3. ✅ Agent 协作协议 — 结构化消息协议 + 双向通信 + 实时干预 + 动态角色（详见 `runtime/src/agents/message_bus.rs`、`worker.rs`、`orchestrator.rs`、`role_registry.rs`）
4. ✅ 学习型记忆 — `AutoLearner` 自动学习回路 + BM25 搜索 + 记忆衰减 + SQLite 双写（详见 `runtime/src/memory/learner.rs`、`mod.rs`、`runtime/src/store/db.rs`）

### v1.2+：体验闭环与简化（2026-08-18 启动，详见 docs/report-plan.md）

基于评估报告四维结论制定的 12 周改进规划，6 个阶段：

| 阶段 | 目标 | 周次 | 状态 |
|------|------|------|------|
| P0 体验闭环 | 首次配置 ≤2 步、渐进式文档 | W1-W2 | ✅ 已落地（/login 2 步交互配置） |
| P1 VSCode 扩展 MVP | 复用 sacode serve、侧边栏对话 | W3-W5 | ✅ 已落地（interfaces/vscode/） |
| P2 定位聚焦 | PRD/roadmap 修订、平台化收敛 | W6 | ✅ 已落地（PRD v1.4、roadmap v1.0.0） |
| P3 简化过度设计 | /goal 轻量、知识 9→3、冲突简化 | W7-W8 | ✅ 已落地（/goal、3 文件记忆、审批+拦截） |
| P4 强化核心机制 | 三级模式视觉、沙箱审计文档、审批可视化 | W9-W10 | 🚧 部分落地（Loop 阶段进度条；沙箱审计文档/审批可视化待补） |
| P5 场景补齐 | CI/CD、代码审查、远程开发、测试编写 | W11-W12 | 🚧 部分落地（ci-integration.md、review-pr skill；远程/测试文档待补） |

## 并行推进主线

除版本交付外，SaCode 还会持续推进一条平台主线：统一运行时。

这条主线的演进顺序是：

1. ✅ 统一任务运行时与状态机（v0.3 已完成）
2. ✅ Sub-agents（多 Agent 编排已落地）
3. ✅ Daemon + HTTP API（11 REST 端点 + SSE）
4. ⬜ Scheduled Tasks（**延后**，平台化收敛，不在本期）
5. ⬜ Agent Teams（**延后**，平台化收敛，不在本期）
6. ⬜ Channels（**延后**，平台化收敛，不在本期）

> **调整说明（2026-08-18）**：基于评估报告维度三结论，Scheduled Tasks / Agent Teams / Channels 三项延后，资源集中到 IDE 插件、provider 零配置、首次体验。

这条顺序决定了高阶能力的落地依赖关系，也决定了方案文档在 `docs/plans/archive/` 中的组织方式。

## 阶段优先级表

| 阶段 | 目标 | 代表能力 | 状态 |
|------|------|----------|------|
| `v0.3` | 补齐终端体验闭环 | 持久化任务、统一状态机、跨入口一致性、Git 提交闭环 | ✅ 已完成 |
| `v0.5` | 提升代码智能深度 | AST、语义索引、测试运行器、LSP 诊断 | ✅ 已完成 |
| `v0.7` | 扩展生态与集成 | MCP stdio、ACP 流式、检查点增强、IDE 配置生成、插件运行时、LSP 跨文件 | ✅ 已完成 |
| `v1.0+` | 达到产品就绪 | 自动修复、多模态、协作协议、学习记忆 | ✅ 能力已落地 / ✅ 版本号已发布（1.0.0） |
| `v1.2+` | 体验闭环与简化 | IDE 插件、provider 零配置、首次体验、过度设计简化 | ✅ 核心已落地（P0-P3 完成）；🚧 P4/P5 部分落地（沙箱审计文档、远程/测试场景待补） |

## 参考关系

1. [产品 PRD](PRD.md) — 产品定位、能力范围、当前现状、优先级总表
2. [可行性评估报告](../report.md) — 四维评估（竞争差距/规则审查/方向/UI）
3. [改进规划方案](../report-plan.md) — 基于评估报告的 12 周实施方案
4. [功能升级方案](../plans/capability-upgrade-plan.md) — 基于竞品对比的能力补齐
5. [项目优化计划](../plans/plan-optimization.md) — 当前问题修复与优化计划
6. [历史方案归档](../plans/archive/README.md) — 统一运行时与平台演进的历史完整方案
