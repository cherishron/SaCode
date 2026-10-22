# plans/ — 设计 · 详细设计 · 计划 · 治理（索引）

> 类别：②设计文档 ③详细设计文档 ④实施计划 ⑤测试 ⑥工程治理 的混合区。
> 上级索引：[docs/README.md](../README.md)｜带规格的实施计划在 [`../superpowers/`](../superpowers/README.md)｜专项总览：[接口与契约](../interfaces/README.md)、[对接方案](../integration/README.md)
> **本目录是"可能过期"区**：所有条目描述当时设计或计划，使用前核当前源码与 PRD 口径。

## A. 概要 / 总体设计（体系级）

| 文件 | 一句话 | 状态 |
|---|---|---|
| [`plan-deepseek-harness-replication.md`](plan-deepseek-harness-replication.md) | DSH 全系统复刻总体方案（v0.2） | **已历史化**（2026-10-13）：仅追溯用，不作当前定位 |
| [`dsh-capability-matrix.md`](dsh-capability-matrix.md) | 63 子系统能力矩阵 + 阶段状态回填 | **冻结快照**，≠ 现完成率 |
| [`plan-qwen-batch-replication.md`](plan-qwen-batch-replication.md) | Qwen Code Batch API 复刻草案（v0.1） | 未实现 |

## B. 功能与界面设计（方案级）

| 文件 | 一句话 | 状态 |
|---|---|---|
| [`sacode-workbench-visual-direction-2026-10-07.md`](sacode-workbench-visual-direction-2026-10-07.md) | 工作台视觉修订 | **已并入** [`../product/desktop-design-standard.md`](../product/desktop-design-standard.md)（2026-10-16；本文件降为指针） |
| [`sacode-extension-market-2026-10-11.md`](sacode-extension-market-2026-10-11.md) | 扩展市场方案 | 方案 |
| [`sacode-local-agent-presets-2026-10-11.md`](sacode-local-agent-presets-2026-10-11.md) | 本地 Agent 预设与自定义模式方案 | **方向废弃**（2026-10-21）：核心"四模式=给当前 Agent 选工具集"定位由下条取代；存储/作用域/修订/导入导出与生命周期约束仍可复用 |
| [`sacode-orchestrator-agent-2026-10-21.md`](sacode-orchestrator-agent-2026-10-21.md) | 调度者 Agent 与团队方案：主 Agent 只委派 subagent；ACP 作为 subagent 可持有的能力（非顶层委派通道）；预设团队（explorer/planner/implementer/reviewer）+可编辑员工；外部 Agent 继承 subagent 权限边界；额度来源记账；主 Agent 直调 ACP 默认关、subagent 默认开 | 方案 |
| [`sacode-memory-daily-evolution-2026-10-21.md`](sacode-memory-daily-evolution-2026-10-21.md) | 记忆与每日自动进化方案：三态（draft/confirmed/archived）+ draft 不注入铁律；与知识库分工（记忆=agent 自动事实、知识库=用户显式文档）；轮末自动提取+启动时合并 pass（避开 F13 未实现）；密钥擦除；记忆分类与配额；设置四开关（总/自动学习/自动晋升/每日进化，默认关自动学习与晋升）；`memory/*` RPC + 记忆页 | 方案 |
| [`sacode-self-learning-loop-2026-10-21.md`](sacode-self-learning-loop-2026-10-21.md) | 自学习闭环总方案（蓝图）：串联调度者/记忆/skill 三子方案；错题本（ErrorBook，按技术语言 java/cangjie/rust 分类，test/build/syntax 失败自动捕获，不直接注入）；错题本→skill 草稿（用户审阅才启用，版本化可回滚，不让步）；会话内 knowledge_save 工具（走审批）；skill 启用开关（D2 用户决定跨会话持久）；skill 本地/线上/一键发布（密钥擦除+确认，平台接口待研究）；内置 create-skill 元技能；自动化生成文章列为后续阶段（F13） | 方案 |
| [`sacode-self-performance-monitoring-2026-10-11.md`](sacode-self-performance-monitoring-2026-10-11.md) | 自身性能监控方案 | 方案 |
| [`appcontainer-sandbox-cffi-design.md`](appcontainer-sandbox-cffi-design.md) | 仓颉 CFFI 版 AppContainer 隔离接入方案 | 设计 |
| [`mcp-integration-design-2026-10-20.md`](mcp-integration-design-2026-10-20.md) | MCP 接入方案：DSH 调研 + SaCode 现状对照 + 推荐路径（配置加载/`mcp/*` RPC/工具桥/审批/重连/UI） | 设计（纯调研，未实施） |
| [`skill-integration-design-2026-10-20.md`](skill-integration-design-2026-10-20.md) | 技能清单接入方案：DSH 调研（技能＝指令文本非工具打包、provider 注册表+目录扫描、`/name` 手势注入、只注入文本不注册工具、与 MCP 完全分离）+ SaCode 现状对照（`SkillRegistry` log-only 存根、"技能"卡片误接 `extension/list`）+ 推荐路径 | 设计（纯调研，未实施） |
| [`plan-todo-integration-design-2026-10-20.md`](plan-todo-integration-design-2026-10-20.md) | 「创建计划」接入方案：DSH Plan(plan mode)/Todo/Goal 调研 + SaCode 现状对照（Todo/Goal 已完整、计划缺闭环）+ 推荐路径（复用 vs 新增 RPC/前端）+ 三者状态机 | 设计（纯调研，未实施） |
| [`2026-10-20-terminal-interactive-design.md`](2026-10-20-terminal-interactive-design.md) | F09 实时交互终端设计：三条车道分开（历史回放/一次性 execution/新 terminal/* 交互 PTY），ConPTY FFI 不改现有执行 DLL，Host 新增 terminal/create\|input\|resize\|interrupt\|describe\|output\|close\|kill\|action/run | 设计（纯调研，未实施） |
| [`2026-10-20-browser-control-design.md`](2026-10-20-browser-control-design.md) | F14 浏览器与电脑操控设计：Host 新增 browser/*+computer/* 两条方法面与 page/tool 并列，Electron WebContentsView 内置浏览器，独立 Node provider 驱动 Agent 浏览器，截图复用 attachmentImageRead，关面板不停 provider | 设计（纯调研，未实施） |
| [`2026-10-20-database-panel-design.md`](2026-10-20-database-panel-design.md) | F16 数据库面板设计：驱动承载在 extjs（pg/mysql2/dmdb 纯 JS），core 经 extension/host 通道调用，连接池在 extjs 侧，写入走 execution/review-apply 审批，默认只读，DDL 不可靠回滚标注 | 设计（纯调研，未实施） |
| [`2026-10-20-security-scan-design.md`](2026-10-20-security-scan-design.md) | F17 三层安全扫描设计：static（内置规则+自动可修走 review-apply）、incremental（增量+可选 Semgrep）、deep（仅手动+真数据流+无引擎则禁用），禁止规则匹配冒充深度扫描 | 设计（纯调研，未实施） |
| [`2026-10-20-knowledge-index-design.md`](2026-10-20-knowledge-index-design.md) | F11 知识库索引服务设计（CodeArts 版）：源码索引构建、符号/路径/修订绑定、知识注入模型请求闭环（PRD §4.2.1），冲突处理（当前代码决定实现事实），反向验收设计 | 设计（纯调研，未实施） |
| [`2026-10-20-knowledge-index-design-monkeycode.md`](2026-10-20-knowledge-index-design-monkeycode.md) | F11 知识库索引设计（MonkeyCode 版）：三库分开（文档/源码索引/记忆），注入前核磁盘 digest/符号，一期关键词+符号不标向量，冲突时代码为实现事实用户确认不静默删除 | 设计（纯调研，未实施） |
| [`2026-10-20-data-import-design-opencode.md`](2026-10-20-data-import-design-opencode.md) | F19 数据导入设计（OpenCode 版）：migration_pack 现状盘点，按来源×数据类型分适配器，fail-soft 逐条解析，稳定 ID 去重，Host 新增 import/* 6 条 RPC | 设计（纯调研，未实施） |
| [`2026-10-20-data-import-design-qoder.md`](2026-10-20-data-import-design-qoder.md) | F19 数据导入设计（Qoder 版，1515 行详细版）：源码事实复核发现 migration_pack 无 apply/坏条目静默丢弃，Host 新增 import/* 8 条 RPC，会话导入走 staging+flush+原子改名，配置导入拒绝 secret-bundle | 设计（纯调研，未实施） |
| [`2026-10-20-git-backend-design.md`](2026-10-20-git-backend-design.md) | F08 Git 工作台后端设计：新增 core 有限 Git 动作服务（stage/unstage/commit/log/stash），Git 提交不走 execution/review-apply 走独立动作提案，受控 index 事务，必须作用于核定源仓库 | 设计（纯调研，未实施） |
| [`2026-10-20-hooks-automation-design.md`](2026-10-20-hooks-automation-design.md) | F13 自动化与 Hooks 设计：磁盘声明/实际装载/执行结果三状态分开，复用 core CronSpec，默认错过触发 skip，F13 决定触发 F04 决定轮次 F13-E 执行，无人审批只能等待或阻断 | 设计（纯调研，未实施） |
| [`2026-10-20-terminal-frontend-design.md`](2026-10-20-terminal-frontend-design.md) | F09 终端交互前端页面设计：与 terminal-output.ts 并存+子标签切换，xterm.js 构建期折叠成 IIFE（pack-xterm.mjs），8 个 preload 新通道（terminalCreate/Input/Resize/Interrupt/Describe/Output/Close/Kill），输入直发 terminal/input 不经 composer | 设计（纯调研，未实施） |
| [`2026-10-20-ssh-backend-design.md`](2026-10-20-ssh-backend-design.md) | F15 SSH 后端设计：ssh.cj 仅日志登记状态不建真实连接，ssh_exec.cj 有单次执行器但关主机密钥校验/输出无界；设计 ssh/connect\|exec\|disconnect\|describe 受审动作提案，首次指纹独立确认变化即阻断，不走 execution/review-apply | 设计（纯调研，未实施） |
| [`2026-10-20-voice-enhancement-design.md`](2026-10-20-voice-enhancement-design.md) | F18 语音与提示词增强设计：录音/转写未接 Host 但增强已有 prompt/enhance\|poll\|cancel 通路；设计 voice/record\|transcribe\|enhance\|describe，转写只回填可编辑草稿不自动发送，复用 draftRevision+sessionGeneration 保护，麦克风权限与云上传分别授权 | 设计（纯调研，未实施） |
| [`2026-10-20-context-compression-design.md`](2026-10-20-context-compression-design.md) | F06 上下文压缩设计：D03 缺陷“压缩仅记录”的修复方案，CompactionLedger 现状盘点，摘要执行器与请求投影接线设计，一期截断+标记不引入外部 LLM | 设计（纯调研，未实施） |
| [`2026-10-22-web-deployment-design.md`](2026-10-22-web-deployment-design.md) | Web 部署方案：现状盘点（只有 CLI/Desktop，无 Web）+ 方案对比（A 改桌面 renderer vs B WS 桥+独立前端）+ 推荐方案 B 架构（复用 HostBridge 逻辑、pack-service 底座、WS 桥透传 NDJSON、独立 Vite SPA）+ 方法面映射表 + 分阶段工作量估算（17-28 人天，S1-S2 即证“Web 部署有了”）+ 验收出口与风险边界 | 设计（待评审） |

## C. 详细设计（接口 / 契约 / 模块级）

> 接口面速查（各入口真源、实测读数与机器可读契约）见 [`../interfaces/README.md`](../interfaces/README.md)。

| 文件 | 一句话 | 状态 |
|---|---|---|
| [`sacode-product-interfaces-2026-10-07.md`](sacode-product-interfaces-2026-10-07.md) | 自主产品接口与状态设计（对象/状态机/固定十值错误原因） | 历史登记（10-13 补正），实施前核当前协议 |
| [`sacode-execution-contract-2026-10-07.md`](sacode-execution-contract-2026-10-07.md) | 执行与构建测试增量契约（含 10-08 执行口径更新） | 契约 |
| [`w10-persistence-barrier-recovery-contract-2026-10-06.md`](w10-persistence-barrier-recovery-contract-2026-10-06.md) | 持久化屏障与恢复契约 | 设计稿，待评审 |
| [`goal-claim-tool-interface-2026-10-07.md`](goal-claim-tool-interface-2026-10-07.md) | 完成证据声明侧接口变更单（update_goal 分支） | 变更单 |
| [`goal-execution-scheduling-design-2026-10-20.md`](goal-execution-scheduling-design-2026-10-20.md) | F04 自动跨轮执行：DSH round-driver 对照与 Host 空闲边接入方案 | 设计（待评审） |
| [`lsp-l1-entry-wiring-2026-10-07.md`](lsp-l1-entry-wiring-2026-10-07.md) | L1 LSP 语义工具契约与入口接线登记 | 登记单 |
| [`sacode-daemon-contract-review-2026-10-08.md`](sacode-daemon-contract-review-2026-10-08.md) | 本地守护进程复核与接线门禁 | 复核 |
| [`2026-10-12-knowledge-management-contract.md`](2026-10-12-knowledge-management-contract.md) | F11 知识库管理增量契约 | 设计中（基线 `1bf46d8`） |
| [`host-capabilities.json`](host-capabilities.json) | 宿主能力契约（机器可读） | 数据契约 |
| [`remote-capability-contract.json`](remote-capability-contract.json) | 远程能力契约（机器可读） | 数据契约 |

## D. 实施计划与接入清单

> 对接类方案（ACP / 远程 / 页面 / Git / 知识库 / 自动化）的状态汇总见 [`../integration/README.md`](../integration/README.md)。

| 文件 | 一句话 |
|---|---|
| [`2026-10-11-desktop-business-integration.md`](2026-10-11-desktop-business-integration.md) | 桌面前后端业务接通计划 |
| [`2026-10-12-git-write-integration.md`](2026-10-12-git-write-integration.md) | Git 写操作完整接入方案（待用户批准） |
| [`2026-10-12-remaining-product-pages.md`](2026-10-12-remaining-product-pages.md) | 未完成产品页面接线清单 |
| [`automation-product-wiring-2026-10-15.md`](automation-product-wiring-2026-10-15.md) | F13 自动化接线实施边界 |
| [`codebuddy-acp-entry-2026-10-14.md`](codebuddy-acp-entry-2026-10-14.md) | CodeBuddy CLI ACP 产品接线 |
| [`opencode-acp-diagnostics-repair-2026-10-14.md`](opencode-acp-diagnostics-repair-2026-10-14.md) | OpenCode ACP：用户控制、诊断与后台修复 |
| [`product-closure-goal-2026-10-15.md`](product-closure-goal-2026-10-15.md) | **当前先读 §0（10-18 用户确认）**：先交付一条真实任务，同源固定候选包→用户复验再扩能力；原多页面范围保留历史，当前状态由PRD台账交付卡维护 |
| [`sacode-sidebar-session-brief-2026-10-08.md`](sacode-sidebar-session-brief-2026-10-08.md) | 侧边会话历史开发简报 |
| [`verb-wiring-checklist-2026-10-04.md`](verb-wiring-checklist-2026-10-04.md) | 51 行 ◐ verb 接入清单 |

## E. 测试与验收

| 文件 | 一句话 | 状态 |
|---|---|---|
| [`test-layout-2026-10-15.md`](test-layout-2026-10-15.md) | 测试目录整理台账（按模块/功能分类） | 进行中 |
| [`dsh-frontend-acceptance.md`](dsh-frontend-acceptance.md) | 冻结 DSH 前端与交互验收清单 | 历史快照 |

## F. 审计与预检

| 文件 | 一句话 |
|---|---|
| [`sacode-2026-10-11-preflight-source-audit.md`](sacode-2026-10-11-preflight-source-audit.md) | 三份 2026-10-11 设计方案的实施前源码审计 |

## G. 工程治理

| 文件 | 一句话 | 状态 |
|---|---|---|
| [`w00-path-ownership-and-isolation-2026-10-06.md`](w00-path-ownership-and-isolation-2026-10-06.md) | 路径所有权表与隔离工作安排（门禁解析的真源） | 契约 |
| [`windows-dependency-and-compatibility-2026-10-16.md`](windows-dependency-and-compatibility-2026-10-16.md) | Windows 依赖与兼容性评估：构建/桌面/CLI 三层安装清单、11 项特有问题、普通用户可行性与降级策略 | 2026-10-16 评估 |
| [`artifact-layout-and-retention-2026-10-16.md`](artifact-layout-and-retention-2026-10-16.md) | 产物统一与保留策略 | **已执行**（target/tmp 单根、守卫上线；遗留：安装包重打、守卫接线） |
| [`sacode-product-traceability-2026-10-07.md`](sacode-product-traceability-2026-10-07.md) | 需求追踪与第一批责任表 | 历史追踪（以 PRD F01–F21 为准） |

## 详细设计覆盖速览（粗清点，随文档增长更新）

| 主题 | 现有详细设计 / 契约 | 状态 |
|---|---|---|
| 全局对象与状态（会话/草稿/队列/目标/计划） | `sacode-product-interfaces` | 历史登记，实施前核当前协议 |
| 执行引擎（F02/F09） | `sacode-execution-contract` | 契约 + 10-08 口径 |
| 持久化屏障与恢复 | `w10-…-contract` | 设计稿待评审 |
| 目标完成证据（F04） | `goal-claim-tool-interface` | 变更单 |
| 目标持续执行调度（F04） | `goal-execution-scheduling-design-2026-10-20` | 设计（待评审）；空闲边驱动，不新开 RPC |
| LSP（F21） | `lsp-l1-entry-wiring` | 登记 |
| 终端交互（F09） | `2026-10-20-terminal-interactive-design` | 设计（纯调研） |
| 浏览器与操控（F14） | `2026-10-20-browser-control-design` | 设计（纯调研） |
| 数据库面板（F16） | `2026-10-20-database-panel-design` | 设计（纯调研） |
| 安全扫描（F17） | `2026-10-20-security-scan-design` | 设计（纯调研） |
| 知识库索引（F11） | `2026-10-20-knowledge-index-design` + `2026-10-20-knowledge-index-design-monkeycode` | 设计（纯调研，两份互补） |
| 数据导入（F19） | `2026-10-20-data-import-design-qoder`（实施基线）+ `2026-10-20-data-import-design-opencode`（适配器参考） | 设计（纯调研；调度方判定以 Qoder 版为准：8 RPC 泵模型、桌面解析+Host 权威、staging+原子改名、拒绝 secret-bundle） |
| Git 写操作后端（F08） | `2026-10-20-git-backend-design` | 设计（纯调研） |
| Hooks 与调度（F13） | `2026-10-20-hooks-automation-design` | 设计（纯调研） |
| 终端交互前端（F09） | `2026-10-20-terminal-frontend-design` | 设计（纯调研） |
| SSH 后端（F15） | `2026-10-20-ssh-backend-design` | 设计（纯调研） |
| 语音与提示词增强（F18） | `2026-10-20-voice-enhancement-design` | 设计（纯调研） |
| 上下文压缩（F06/D03） | `2026-10-20-context-compression-design` | 设计（纯调研） |
| daemon / 远程接入 | `sacode-daemon-contract-review` + `../superpowers/specs/2026-10-10-unified-remote-mobile-design.md` | 设计 |
| 知识库（F11） | `2026-10-12-knowledge-management-contract` | 设计中 |
| 执行隔离（安全） | `appcontainer-sandbox-cffi-design` | 方案 |
| 模型中心（F07） | `../superpowers/specs/2026-10-05-model-center-design.md` | 规格 |
| 压缩 / 审批 / 斜杠 / Hooks | `../superpowers/specs/2026-10-09-*-design.md` | 规格（待实施） |
| Git 写操作 | `2026-10-12-git-write-integration` | 待批准 |
| 能力契约（机器可读） | `host-capabilities.json`、`remote-capability-contract.json` | 数据契约 |
| Web 部署 | `2026-10-22-web-deployment-design` | 设计（待评审；方案 B：WS 桥 + 独立前端，复用 HostBridge 与 pack-service） |

> 缺口登记规则：新发现"某主题无专文"时，先在此表标「缺（待补）」，补文后改为实际文件。

## 落点与登记规则

1. 新增设计/契约/计划落本目录（或 `superpowers/`：规格+计划成对）；
2. 状态标注四选一：**方案｜设计（待评审）｜已评审（待实施）｜已执行/历史**；
3. 涉及 PRD 需求 ID 的，文档头必须写明 Fxx 关联与基线；
4. 完成后同批在本索引与 [`../README.md`](../README.md) 维护记录登记。
