# PRD 全程跟进台账（F01–F21：完成 / 未完成 / 缺陷）

- 建立：2026-10-16
- 读数基线：分支 `refactor/dsh-learning`，HEAD `7a249a1c2ca03f5d4ad7a7c5e82eb81d60a00238`（2026-10-16 11:45:32），工作区存在未提交改动；各条目均标注取证时点，过期读数以时点区分。
- 上级索引：[product/README.md](README.md)｜需求与验收口径权威：[PRD.md](PRD.md)
- 定位：本文件是 F01–F21「推进到哪一步」的**唯一实时跟进入口**。只登记现状与证据，不改需求、不宣布验收通过、不计算整体完成率；口径冲突时以 PRD.md 为准。

## 0. 怎么读（状态口径）

| 状态 | 含义 |
|---|---|
| **已验证** | 有当前基线（近两周、可追溯）的实际运行证据，结论范围与限制已写明 |
| **已接通** | 源码接线存在（core + Host 分派 + 桌面/CLI 入口至少两级），但未取得（或未完成）运行验收 |
| **部分完成** | 主链部分环节已实现/接通，剩余缺口在「未完成 / 缺口」列逐条列明 |
| **未接通** | 实现文件存在但未接入主链（如执行层孤岛） |
| **未开始 / 待核** | 无实现证据；「待核」表示本轮未找到专项证据，不据此断言实现不存在 |

- 与 PRD 三档口径（2026-10-09 节）映射：已验证 ≈「已实现」加运行验收；已接通 =「真实入口已接通」；未接通/未开始 =「仍未验证或缺失」的细分。
- 状态可带括号细化（如「已接通（部分）」「已接通（带缺陷）」），细化词只描述缺口性质，不改口径定义。
- 测试通过 ≠ 产品完成；单测、契约、页面接线各自只是证据的一种。每条结论都必须能落到「提交 / 入口 / 平台 / 证据」四要素。
- 证据引用均为本仓可读路径；带日期文件在 `../evidence/` 或 `../plans/` 下。

## 1. F01–F21 逐域跟进

| 域 | 状态 | 已完成事实（含证据） | 未完成 / 缺口 |
|---|---|---|---|
| **F01** 项目与会话 | 已接通 | 项目/会话树、新建/切换/命名/归档、草稿按会话保留（桌面）；会话持久化与并发修复：专项 13/13 通过，全 core 会话/执行集成 58 条 57 PASS、1 ERROR（[session-persistence-repair-2026-10-13.md](../evidence/session-persistence-repair-2026-10-13.md)） | 该 1 ERROR 为真实子进程启动缺沙箱后端（见缺陷 D14）；归档不假删在途任务未见专项验收；修复后未重建 Host/CLI/daemon/Electron |
| **F02** 自有 Agent 主循环 | 已接通 | Host 模型中心可用（本地真实 HTTP 发送）；read→精确审批 edit→文件变化→驱动语法检查/单测（合成模型，非模型自主 shell）；待审批取消后无修改、不补执行；执行历史列表（`b512b65`）、执行审查与产物工作台页（`f0f3634`/`7a249a1`）接入（[self-core-verification](../evidence/2026-10-15-self-core-verification.md)） | 真实模型自主工具循环未验；CLI 普通会话无工具 schema（D06）；远程模型 task 待验；执行页测试 8/9（D13） |
| **F03** 消息队列 | 待核 | 队列/即时补充/停止的渲染层交互存在（历史原型批） | 排队→消费幂等、编辑/消费竞争、附件引用整体保存无当前专项证据，需重新取证 |
| **F04** 持续目标 | 已接通 | preload 6 个 goal 动词（describe/create/edit/pause/resume/clear，对应创建/修改/暂停/继续/结束）；RPC 面已接线（[host-capabilities.json](../plans/host-capabilities.json) 记录 `goal/` 6 条） | 预算强约束、暂停/继续边界、跨轮证据核验的针对性验收未见 |
| **F05** 输入快捷能力 | 部分完成 | 文件/技能/MCP/知识引用与 @ / 斜杠菜单代码存在；知识引用链已随 F11 接通（[knowledge-management-wiring](../evidence/2026-10-15-knowledge-management-wiring.md)） | review/compress/init 无完整执行接线；clear 仅清前端投影（10-09 审计 P1）；失效引用不静默发送待验收 |
| **F06** 上下文与用量 | 已接通（部分修复） | 容量/占用/累计用量与事后提示存在；零预算拒绝有证据；**请求侧预算已应用（D02 已闭合：超限不派发、`max_tokens` 较小值入请求、零预留）** | 压缩仍仅记录（D03）；精确 tokenizer 未支持（字节守卫）、图片请求明确拒绝；「预算未知如实显示」未验收 |
| **F07** 模型中心 | 已接通 | Host 模型中心可用：凭据、发现、路由 RPC 面；真实 HTTP 结算与健康冷却有证据（[self-core-verification](../evidence/2026-10-15-self-core-verification.md) 收口表 1）；**模型调用日志页（2026-10-17）：`session/request-trace` RPC 接通核心既有 `requestTraceProjection`，渲染层 `model-call-log` 适配器全局聚合回放各会话最近调用、tab 落在供应商之后**（[证据](../evidence/2026-10-17-model-center-call-log.md)；宿主编译/渲染单测 15/15/IPC 门禁 5/5 全 PASS） | CLI 环境配置不与模型中心同源（D06）；变更发送对象的独立授权验收未见 |
| **F08** 代码、预览与 Git | 已接通（部分） | 编辑器恢复、Git 状态解析/迟到保护通过；新构建 Host 真实 Git 只读用例 16/16；安全 Git 目标查询（`46623c4`）、编辑保存后刷新差异（`4d06d64`）、执行审查与 Git 授权操作接入（`f0f3634`：stage/commit/push 提案＋路径/上游安全校验，拒绝强推与自动设 upstream）（[product-closure-goal](../plans/product-closure-goal-2026-10-15.md) 10-16 复验） | 写操作以“提案＋执行授权”链接入（页面级）；真实写执行（push 拒绝/失败不显示已提交）待验收（设计见 [git-write-integration](../plans/2026-10-12-git-write-integration.md)）；默认 `dist` Host 仍旧载荷，重打包后需重跑真实用例 |
| **F09** 终端与验证 | 已接通（部分） | BuildTestPage 接线：tests 资源开放、报告判定含退出事实/EOF/计数一致（[build-test-page](../evidence/2026-10-15-build-test-page-and-cjpm-retry.md)） | 无真实 Host 构建/命令执行/桌面端到端验收（当前只证明页面与判定逻辑）；PTY resize/中断/退出码验收未见 |
| **F10** ACP 协作 | 已接通（部分） | OpenCode 诊断修复（[10-14](../evidence/2026-10-14-acp-opencode-readiness.md)）；委派面板与精确审批操作（`7e34b68`/`be03bda`）、持久委派记录双入口与工作台（`c3d1ce3`）；CodeBuddy 独立配置 initialize/sessionNew/持久诊断通过、Node 默认 hy3 成功、假提供方链路（[takeover](../evidence/2026-10-15-codebuddy-acp-takeover.md)） | 默认用户配置原生 session/new -32603（D09）；Electron 正常模式不可启动（D10）阻塞真实窗口验收；真实 session/prompt 未授权 |
| **F11** 知识、记忆与个人记录 | 部分接通，继续验收 | core KnowledgeStore + Host 5 RPC + CLI 5 命令 + 页面接通（`50d7e50`）＋Electron bridge（`97ddad1`）。2026-10-17 当前工作区重编：核心 5/5、CLI 跨轮集成 1/1、Host 自动检索 1/1、Host 管理/显式引用 2/2、Electron 页面 1/1；验证来源失效、无正文审计，并更正页面模型发送说明（[当前页面与 Host 复验](../evidence/2026-10-15-knowledge-management-wiring.md)、[核心/CLI §11](../evidence/2026-10-17-cli-launch-0xc0000135-stdx-dll-missing.md)） | 未提交快照；Electron 为隔离夹具，完整桌面外壳/默认安全启动、损坏日志回放、安装态、源码/符号索引与检索效果对照未验；记忆/速记/批注未收口 |
| **F12** 扩展管理 | 已接通（部分） | 扩展市场方案落地（[extension-market](../plans/sacode-extension-market-2026-10-11.md)）；本地 Agent 预设（[local-agent-presets](../plans/sacode-local-agent-presets-2026-10-11.md)）；市场/预设页面与 IPC；extjs 帧校验与扩展路径限制加固（`63d9f33`） | 完整生命周期（安装/更新/卸载结算/失败保留）验收未做；Skill/MCP 运行同 D04 |
| **F13** 自动化与 Hooks | 已接通（部分） | 定义保存/CRUD/CAS/重启（UTC）通过；自动化页面接通（`50d7e50`）；RPC `list/save/control` 补齐声明（Host 169 条）；628 个 zoneinfo 随包 + `CJ_TZPATH` 修复命名时区（[automation-product-wiring](../plans/automation-product-wiring-2026-10-15.md)、[gate-triad-repair](../evidence/2026-10-16-gate-triad-repair.md)） | 执行器未实现（D07，`executorAvailable=false`）；从未触发过自动化任务；Hooks 磁盘配置加载未闭环 |
| **F14** 浏览器与电脑操控 | 已接通（部分） | **页面工具经核心授权与会话绑定执行（`fbae797`，10-14）**：核心 `page_tool.cj` 4 工具规格（click/input/scroll 一次性审批）＋`page_tool_channel.cj`、Host `page_tool_rpc.cj`（attach/poll/claim/result）、桌面桥接会话＋窗口绑定 | 页面工具授权修复待运行读数（D05）；web 执行层孤立未接 Host 分派（D08）；跨域/凭据隔离未验收 |
| **F15** SSH 与部署 | 未接通 | 无 | `ssh_exec.cj` 孤立未接 Host 分派（D08）；首次信任/指纹变化、部署独立授权未实现验收 |
| **F16** 数据库面板 | 待核 | 无 | MySQL/PostgreSQL/达梦连接与查询链未见实现证据；默认只读与写入授权边界未落地 |
| **F17** 三层安全扫描 | 部分完成 | 扫描/导入适配器（数据层，提交 `d03a9f1`，[product-closure-goal](../plans/product-closure-goal-2026-10-15.md) 快照段） | 适配器明确不执行扫描、不提供 UI/IPC；三层能力（静态/轻量/深度）分别验收未开始 |
| **F18** 语音与提示词增强 | 未接通 | 无 | `voice_exec.cj` 孤立未接 Host 分派（D08）；录音/转写/增强链未验收 |
| **F19** 数据导入 | 待核 | 无 | 导入实现与验收证据未见；字段映射/去重/报告未落地 |
| **F20** 设置与交付 | 已接通（部分） | 网络搜索设置面接通（`ef5d923`：web/settings describe/apply/set-credential 三动词＋插件配置页，密钥独立凭证通道；`a55bff0` 补齐 IPC 注册）；IPC 142/142 通过（10-17 增 `appVersion` 关于页版本读数、`autoLaunchGet`/`autoLaunchSet` 开机自启；[gate-triad-repair](../evidence/2026-10-16-gate-triad-repair.md)）；设置页与主题/字号 | 安装态验收（D10 阻塞）；更新/诊断/代理分项验收未见 |
| **F21** LSP 语义工具 | 已接通（部分） | 7 verb 契约（define/lookup/references/rename/implementation/diagnostics/call-hierarchy）；`preload.cjs` 7 动词在列；L1 入口接线（[lsp-l1-entry-wiring-2026-10-07](../plans/lsp-l1-entry-wiring-2026-10-07.md)） | 真实 language server 装配/崩溃恢复验收未做；rename 跨文件差异审查未验收 |

### 1.1 页面与视觉对齐（2026-10-12 起的持续线，横切快照）

> 本小节汇总跨域页面工作，不重复上表 F 行状态；组件/私有快照读数 ≠ 安装态验收。

| 范围 | 状态 | 关键读数 / 证据 |
|---|---|---|
| 目标栏 goal-bar | 组件级对齐完成 | 8/8＋22 项内部几何检查；亮暗 720/320px 截图；紧凑时长（[10-12 批](../evidence/2026-10-12-goal-bar-visual-alignment.md)；`0bbd9ca` 10-16 收尾） |
| 对话面气泡 | 用户裁决修正（10-16） | 移除「角色 · N 条消息」组标签；ui-smoke 断言翻转为「为 0」并通过（293 OK／5 条既有 FAIL，基线副本对照零新增）（[证据](../evidence/2026-10-17-role-label-removal.md)） |
| 关于页版本 | 已展示真实读数（10-17） | 新增只读通道 `sacode:appVersion`（壳层事实：应用/Electron/Chromium/Node/平台/运行形态）；更新检查仍如实写「尚未开放」。IPC 门禁 PASS、settings-state 12/12（[证据](../evidence/2026-10-17-about-version-panel.md)） |
| 新会话默认权限 | 已接通（10-17） | 四档＝核心 `PermissionPolicy` 的 plan/build/auto/yolo；持久化进 `general-settings.txt` 的 `defaultPermissionMode`，只在 `session/create` 时套用一次（只作用于新会话、不动当前会话）；未知值回落最保守的 build。host 侧新 RPC `global/settings/set-default-permission`；settings-state 18/18（[证据](../evidence/2026-10-17-default-permission-and-autolaunch.md)） |
| 开机自启 | 已接通（10-17） | 壳层登录项接口 `app.getLoginItemSettings/setLoginItemSettings`，新增 `autoLaunchGet`/`autoLaunchSet`；状态以回读为准，未打包时照实说明注册的是开发壳；写失败抛错不伪报。设置页与账户菜单均不再是「待接入」占位（[证据](../evidence/2026-10-17-default-permission-and-autolaunch.md)） |
| 工作台导航（键盘） | 组件级完成 | 方向键/Home/End/关闭标签焦点 16/16（10-12 批） |
| 产品设计冒烟 | 私有快照级通过 | PRODUCT_DESIGN_PASS 81 checks（私有快照＋既有 Host，非安装态）（10-12 批） |
| 管理页入口（知识库/自动化/连接） | 知识库、自动化已真实接通；连接待服务 | 10-12 入口批 134 项＋12 截图 → 10-16 `50d7e50` 接通两页；连接仍“未连接管理服务”态（F15/F16） |
| 设置页 | 一轮逐页复核完成 | 产品冒烟 121 项＋36 张截图（[10-12 复核](../evidence/2026-10-12-settings-workbench-page-review.md)）；网络搜索设置面 10-16 接通 |
| 右侧资源页 | 部分接通 | 构建测试（10-15）、执行产物（`7a249a1`）；扫描/部署/记忆/来源/技能 MCP 仍待接入 |
| 未收口 | — | 连接管理、扩展市场目录；整页/安装态视觉验收受 D10 阻塞；高数据态逐图复核继续 |

## 2. 缺陷登记（P1 / P2；闭合项保留历史行）

> 级别沿用 PRD：P0 阻断主线；P1 红线/主线缺陷；P2 体验与工程债。闭合后**不删行**，改状态并附证据。

### 2.1 P1（未闭合）

| 编号 | 现象 | 现状与边界 | 证据 |
|---|---|---|---|
| **D03** | 上下文压缩仅记录（`CompactionLedger` 只记 marker）：无摘要执行器与请求投影接线 | 未证实有可回放摘要；未修复 | [self-core-verification](../evidence/2026-10-15-self-core-verification.md) 收口表 3 |
| **D04** | MCP 真实 stdio 客户端源码存在，但无生产模型工具桥；schema/参数构造/逐调用授权/有界关闭为接入前缺口 | 先补回归再接统一授权桥；未接通 | [self-core-verification](../evidence/2026-10-15-self-core-verification.md) 收口表 4 |
| **D05** | 页面工具授权缺口：`main.cjs:810–823` 页面 handler 直接执行，未走核心审批/守卫/结算（10-13 审计曾升 P0："公开载荷更新前仍列 P0"） | **修复已实施（2026-10-14 `fbae797`）**：页面链改经核心队列（`page/tool/attach\|poll\|claim\|result`＋会话/窗口绑定＋64KiB 结果上限），核心新增 `page_tool.cj`/`page_tool_channel.cj`（click/input/scroll 一次性审批），随提交含真实 Host 用例；**待独立运行读数与载荷重打复验** | [preflight-source-audit](../plans/sacode-2026-10-11-preflight-source-audit.md)、[full-wiring-audit](../evidence/2026-10-13-full-wiring-audit.md) 第 32 轮 |
| **D06** | CLI 与模型中心装配不同源：普通会话无工具 schema；CLI 环境配置独立于模型中心 | 统一共享装配与支持边界，不另写 Agent 循环；未修复 | [self-core-verification](../evidence/2026-10-15-self-core-verification.md) 收口表 1 |
| **D07** | 自动化执行器未实现：`executorAvailable=false`；RPC 已宣告只代表可调用 | 不制造成功历史；执行器/火次准入/去重未实现 | [gate-triad-repair](../evidence/2026-10-16-gate-triad-repair.md) |
| **D08** | `ssh_exec.cj` / `web_exec.cj` / `voice_exec.cj` 三个执行层孤立未接 Host 分派 | PRD §8 已登记；F15/F18/F14 受此阻塞 | [PRD.md](PRD.md) §8 |
| **D09** | CodeBuddy 默认用户配置原生 `session/new` 返回 -32603（可复现） | 实测 Low/Medium 后代完整性标签差异与 Node/原生启动路径差异为线索；**不得等同认证错误**；不得读密钥/改默认配置/关隔离来"修"；修复未开始 | [stage2](../evidence/2026-10-15-codebuddy-acp-stage2.md)、[takeover](../evidence/2026-10-15-codebuddy-acp-takeover.md) 第 8–9 轮 |
| **D10** | Electron 默认安全启动 `0x80000003`（STATUS_BREAKPOINT）：正常模式 smoke 与最小脚本均无诊断输出 | **根因已定位（2026-10-16 复核）：构建产物继承仓库根 Low Mandatory Level 标签（可继承 OI/CI）→ 主进程低完整性 → 沙箱创建匿名窗口站被拒（Win32 5）→ STATUS_BREAKPOINT**；Low 标签只在本仓库根（上级目录/用户目录均无）；修复路径＝交付位置中性导出（`scripts/export-windows-artifact.mjs`，10-08 同字节产物 SMOKE PASS，本轮中性副本**默认沙箱与 `--no-sandbox` 均全链路 SMOKE PASS**）。（前轮排除项保留：缺 `S-1-15-2-2` RX ACE 解释已排除并复原、WER/Code Integrity 无事件。）**未完成**：重打包、交付流程固化、真实双击通道复验（agent 通道取证含 GPU 崩溃噪音，最终验收以真实双击为准）；`--no-sandbox` 仍仅作诊断、不得作默认。阻塞：桌面验收、ACP 真实窗口、安装态 | [三问题排查](../evidence/2026-10-16-windows-startup-three-issues-diagnosis.md) §2、[low-integrity 10-08](../evidence/windows-low-integrity-delivery-fix-2026-10-08.md)、[stage2](../evidence/2026-10-15-codebuddy-acp-stage2.md) 第 4 轮 |
| **D18** | NSIS 安装器临时文件错误：`Error writing temporary file. Make sure your temp folder is valid.`（用户截图 10-11） | **根因已定位（2026-10-16 探针实证）：安装器继承 Low 标签 → 启动器解压自身到默认 `%TEMP%`（Medium）被 MIC no-write-up 拒绝**；最小 NSIS 探针三格对照（中性成功 / 仓库内失败 / 中性写 Low 目录成功）。修复路径＝重打安装器 + 中性导出 + 双击复验；当前无安装器产物 | [三问题排查](../evidence/2026-10-16-windows-startup-three-issues-diagnosis.md) §4、[takeover](../evidence/2026-10-11-takeover-regression-and-plugin-delivery.md) §9.9–9.13 |
| **D19** | 分发载荷 runtime DLL 未同步修正版：`npm/sacode-cli-win32-x64/bin`（`ca65f2b8…`）与 `dist/electron/project-picker-final-20261012` 宿主（`ca65f2b8…`）仍带哨兵误读旧版（`ReadWinModuleAtInit`）；10-16 win-unpacked 候选宿主已是修正版（`8b1d0783…`）并通过 Host smoke | 重打 npm 平台包（`scripts/pack-cli-windows.mjs` 工作区已修复并经 A/B 验证，见 §3 证据）后同步替换；**重打前不得对外分发 CLI 包与 dist 目录版** | [三问题排查](../evidence/2026-10-16-windows-startup-three-issues-diagnosis.md) §3 |

### 2.2 P2（未闭合）

| 编号 | 现象 | 现状 | 证据 |
|---|---|---|---|
| **D11** | `host-capabilities.json` 与 Host 不同步：文件 120 条，Host 工作区 169 条声明（HEAD 158 条） | 需同步或改为生成式；knowledge/automation/profile/web-settings/workspace-recent 等域在文件内缺失 | [gate-triad-repair](../evidence/2026-10-16-gate-triad-repair.md)、[host-capabilities.json](../plans/host-capabilities.json) |
| **D12** | CLI 包装探针缺 MinGW 运行库（`libgcc_s_seh-1.dll`、`libstdc++-6.dll`）退出 1 | 未借旧 npm 包 DLL，未安装；CLI 安装态待验 | [product-closure-goal](../plans/product-closure-goal-2026-10-15.md) 10-16 段 |
| **D13** | 原执行页面测试 8/9：真实 Host 夹具缺 runtime/stdx 运行路径 | **原执行页待复验**。2026-10-17 知识库 CLI 夹具已按既有运行路径约定修复；当前源码重编后 CLI 跨轮集成 1/1、核心检索 5/5 通过。先前两份旧 CLI 产物的 goal/save 差异本轮未复现，不能据此认定 D20/D21 为当前逻辑缺陷，也不能用知识库测试替代本行原执行页验收。历史环境及失败记录保留，见证据 §6/§11 | [专项复验](../evidence/2026-10-17-cli-launch-0xc0000135-stdx-dll-missing.md)；[产品主链](../plans/product-closure-goal-2026-10-15.md) |
| **D14** | 全 core 执行集成 1 ERROR：真实子进程启动失败 `execution-provider-failed`（缺沙箱后端） | **仍未解除**。2026-10-17 身份专项 5/5；新增 AppContainer/双流/Job 原生组件 35 项实测通过，含恢复前停止和后代收束。包内仓颉适配及共享 ShellResult 转换已实测，含创建回执失败不恢复线程、取消、超时和输出排空（[记录](../evidence/2026-10-17-windows-process-collector.md)）；共享核心显式装配已通过真实任务审批/执行/停止/持久回放（[13/13](../evidence/2026-10-17-windows-execution-supervisor-integration.md)）；Host/CLI 默认装配、工作区 ACL、网络/逃逸反向验证及打包尚未完成，产品继续拒绝；不代表完整执行成功 | [原失败](../evidence/session-persistence-repair-2026-10-13.md)、[身份](../evidence/2026-10-17-appcontainer-minimal-environment.md)、[原生进程组件](../evidence/2026-10-17-windows-owned-process-provider.md) |

### 2.3 已闭合（保留历史行）

| 编号 | 现象 | 闭合事实 | 证据 |
|---|---|---|---|
| **D01** | 静默 SSE 流取消无界（取消诊断通过是复现缺陷，不是修复） | **2026-10-16 `cdb31a1` 修复并取得读数**：`core/src/sse.cj` 每次阻塞 read 配属独占 Client 取消监视（20ms 检查 token，取消仅 close 本请求 Client；读取线程保留解析/资源/账本所有权）；Host 套件 **18PASS/0FAIL**（严格取消 0.48s、重复取消三轮每轮 <3s、零重发、预留释放、待核算事实保留）、close 探针 1PASS、统一入口退出 0。**边界**：绑定 10-16 修正运行库（两字节修正、来源未明、非官方发布）；未覆盖连接建立/错误响应体阶段取消、其他平台、安装态 | [p1-cancel-budget-fix](../evidence/2026-10-15-p1-cancel-budget-fix.md) 第 13–18 轮 |
| **D02** | 请求侧上下文/输出预算未应用：窗口与输出限制均保存为 1 后仍发送全文，无 `max_tokens` 字段 | **2026-10-16 `cdb31a1` 修复并取得读数**：`AttemptPlan` 新增三字段由 `planFor` 读取，`max_tokens` 写较小正值；上下文超限 `request-context-limit`（异步终态 `finishReason=error:request-context-limit`，零上游请求/零预留、原文完整）；预算单测 **6PASS**、Host 超限与较小值用例实测。**边界**：字节守卫非精确 tokenizer；图片请求明确拒绝（`request-context-image-unestimated`）；仅 OpenAI completions 路线 | [p1-cancel-budget-fix](../evidence/2026-10-15-p1-cancel-budget-fix.md) 第 11–18 轮 |
| **D15** | Windows 载荷缺 zoneinfo，命名时区保存被拒（通用拒绝压掉原因） | 2026-10-16 闭合：628 个 TZif 随 Host 打包 + `CJ_TZPATH` 发现；Host 回归 14/14、平台测试 27/27 | [gate-triad-repair](../evidence/2026-10-16-gate-triad-repair.md)、[product-closure-goal](../plans/product-closure-goal-2026-10-15.md) 10-16 段 |
| **D16** | 冻结提交 `ef5d923` 的 `webSettingsDescribe/Apply/SetCredential` 未注册 handler | 已闭合（当前工作区）：IPC 141/141 通过；冻结提交仍按设计标红（旧缺口不改写为绿） | [gate-triad-repair](../evidence/2026-10-16-gate-triad-repair.md) |
| **D17** | 10-15 早期快照 host 用例失败：55 项中 6 失败（5 例 `host-gone: 3221225477` + 1 例无任务投影，默认旧 Host 10-11 载荷） | 已闭合（复验）：新构建 Host 下文件编辑恢复 + 真实 Git/只读用例 16/16；默认 `dist` Host 仍旧，重打包后需重跑全量 | [product-closure-goal](../plans/product-closure-goal-2026-10-15.md) 10-15/10-16 段 |

## 3. 平台与交付快照（2026-10-16）

| 平台 | 构建 | 运行 / 真实任务 | 安装 / 分发 | 说明 |
|---|---|---|---|---|
| Windows | core/CLI/Host/daemon 4/4 构建 rc=0（私有 target） | Host 协议 smoke 仅 `--no-sandbox` 通过；桌面默认启动被 D10 阻塞（根因已定位＝Low 标签继承，修复＝中性导出＋双击复验） | 桌面候选 win-unpacked 已生成（719/719 文件一致；宿主已带修正 DLL）；D18 安装器待重打、D19 npm 包/dist 载荷待换修正 DLL；安装态未验 | 主线平台 |
| Linux | core/CLI/daemon 构建通过（`2c56c76` 实测，CLI 约 14 MB）；Host 未编 | 未验 | 未验 | 下一步优先桌面可用；不能描述为"Linux 可完成真实任务" |
| macOS | 未验证 | 未验证 | 未验 | 缺设备只影响验收状态，不取消目标 |
| 鸿蒙 | CLI 保留在范围内 | 未验 | 未验 | 前端后续独立 ArkTS/ArkUI 项目 |

分发目标：npm 便捷安装 + 目标环境独立压缩包 + GitHub Actions 构建产物可下载（workflow 已建，实际运行未验证）。详见 [platform-and-distribution.md](platform-and-distribution.md)。

## 4. 关键分母与读数（易过期；重测方式附后）

| 项 | 当前读数 | 基线 / 时点 | 重测方式 |
|---|---|---|---|
| 桌面 IPC 顶层 key | **142**（10-17 增 `appVersion` 关于页版本读数、`autoLaunchGet`/`autoLaunchSet` 开机自启、`requestTrace` 模型调用日志；门禁 5/5 通过） | 10-17 工作区 | `grep -cE '^  [A-Za-z0-9_]+:' apps/desktop/preload.cjs`；`node scripts/check_ipc_surface_parity.cjs` |
| Host 能力声明（工作区） | **169** = 164 字面路由 + 5 目标路由 | 10-16 门禁 PASS | `node scripts/check_host_method_surface.cjs` |
| Host 能力声明（HEAD 冻结） | **158** | 同上 | 同上 |
| `host-capabilities.json` | 120（已过期，见 D11） | 10-16 | 与上两行对账后同步 |
| `remote-capability-contract.json` | 119 | 10-16 | `node scripts/check_contract_anchor_audit.cjs` |
| 当前 HEAD | `7a249a1c`（2026-10-16 11:45:32） | — | `git log -1` |

## 5. 更新规则（与 AGENTS.md「文档同步规则」配套，强制）

1. **完成一个功能或闭合一个缺陷，必须同批更新本台账与 PRD**：改对应 Fxx 行的状态、已完成事实、剩余缺口；不得留到后续批次补记。
2. **缺陷闭合**：状态改为已闭合、保留历史行、补证据路径与日期；不得直接删行或静默改写。
3. **验证门槛**：未取得「提交 / 入口 / 平台 / 实际运行证据」四要素前，不得标「已验证」；测试通过、页面接线、RPC 宣告各自不足以升级状态。
4. **证据落位**：新证据写入 `docs/evidence/`（带日期），本台账引用；接口/契约变化同步 `docs/interfaces/README.md`、对接状态同步 `docs/integration/README.md`。
5. **不计算完成率**：不汇总"已完成域数/百分比"；域级状态与缺口清单就是进度表达。
6. 本文件的建立与每次更新，须同批登记 [product/README.md](README.md) 与 [docs/README.md](../README.md) 维护记录。


2026-10-17 EX-01/D14 增量：[私有任务目录组件](../evidence/2026-10-17-windows-private-workspace-scope.md)47 项实际文件访问/拒绝/独立清理通过，父 DACL 保持不变；尚未接入仓颉工作区快照、受保护子树排除及差异合入，不能解除 D14 或默认执行门禁。


2026-10-17 后续装配：[仓颉私有 cwd 真实任务](../evidence/2026-10-17-cangjie-private-workspace-task.md)新增 WindowsPrivateWorkspace 生命周期与同一共享审批/执行链的私有文件读写，当前定向 16/16。生产树快照、排除清单、源修订与差异导出/合入仍未完成；D14 和默认执行门禁保持未解除。
