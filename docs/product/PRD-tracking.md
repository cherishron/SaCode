# PRD 全程跟进台账（F01–F21：完成 / 未完成 / 缺陷）

- 建立：2026-10-16
- 读数基线：分支 `refactor/dsh-learning`，HEAD `7a249a1c2ca03f5d4ad7a7c5e82eb81d60a00238`（2026-10-16 11:45:32），工作区存在未提交改动；各条目均标注取证时点，过期读数以时点区分。
- 上级索引：[product/README.md](README.md)｜需求与验收口径权威：[PRD.md](PRD.md)
- 定位：本文件是 F01–F21「推进到哪一步」的**唯一实时跟进入口**。只登记现状与证据，不改需求、不宣布验收通过、不计算整体完成率；口径冲突时以 PRD.md 为准。

## 当前交付卡（2026-10-18 用户确认）

**当前结论：尚未交付一个经用户完整走通的同源版本。** 下方局部测试、私有候选和历史通过读数不能替代该结论。所有 IDE / AI 会话按 [交付主线 §0](../plans/product-closure-goal-2026-10-15.md#0-当前执行顺序先交付一个走通版本2026-10-18-用户确认) 跟进，项目规则见根 `AGENTS.md`。

| 项 | 当前登记 |
|---|---|
| 唯一近期目标 | 正常双击 → 配置供应商/选择模型 → 打开小项目 → AI 读取并提出修改 → 用户审批 → 实际修改/真实差异 → 关闭重开后记录和文件正确；若承诺构建/测试，须在产品中真实执行成功 |
| 当前阶段 | 阶段2进行中（2026-10-18）：本会话按用户指令冻结 `SC-20261018-R1` 源码与依赖，随后同源构建；本会话另将同期在途改动分 5 批提交至 `8dbce58`（工作区清空）。尚未生成可供用户复验的新入口 |
| 交付主责 | 本次 OpenCode 会话负责 `SC-20261018-R1` 的快照、同源构建与候选验证；既有codex/workbuddy实现保留，不代提交，不让并发改动混入已冻结候选；其他会话不要另出“最新包” |
| 候选源码/依赖/运行库 | `SC-20261018-R1`，来源HEAD `5c22a36`+冻结时工作区，快照/哈希将落 `target/tmp/delivery-SC-20261018-R1/`；本机runtime SHA256 `8b1d0783…`为已知非官方修正版、来源未明：只用于本机验收候选，阻止对外发布，不据此宣称普通用户分发达标 |
| 对外测试入口 | 本轮候选 `D:/tmp/sacode-delivery-R2-20261018/win-unpacked`（协议冒烟 PASS；GUI 受 A3 GPU 阻断未通）。用户已有旧包不自动升级；中性副本不作为多个可选用户版本 |
| 当前主阻塞 | 正在固定统一输入，尚未取得该候选完整应用真实任务证据；非官方runtime仍为正式分发阻塞，不能以本机通过解除。另：项目工作区内仓颉进程文件 I/O 与熵源受环境限制（同产物在 `D:/tmp` 正常），打包须走中性位置，未关沙箱 |
| 下一步 | 完成快照与输入哈希 → 独立构建Host/CLI/daemon与桌面资源 → 同源完整候选 → 默认安全启动与本地合成预验 → 用户授权真实模型任务并亲手复验；不读取用户真实凭据、不主动发送收费请求 |
| 暂缓与安全边界 | 无关功能扩展/重构先入待办；F01–F21与平台范围不删；不关闭沙箱、不丢授权/取消/结算/恢复，不让用户补构建环境 |
| 汇报约定 | 当前阶段/候选身份、主阻塞、当次动作、下一步验收；“单测/接口/页面通过”≠“版本交付”，未过用户完整复验不报“闭环/收官” |

维护时更新此卡的当前值，保留后文带日期的历史证据；提交/安装/收费请求/发布仍须独立授权。此卡不计算完成率，也不代替逐域缺陷台账。

## 2026-10-18 01:30 候选提交与构建验证补记

- 按用户授权主导：审查工作区 123 项在途改动（61 已改 + 62 新增），确认无真实密钥泄漏、无调试残留；分 5 批提交（core / host+cli+daemon / desktop / docs / scripts）至 `8dbce58`，工作区清空。与 `SC-20261018-R1` 为同期同一批改动。
- 构建验证：`cjpm build` 编译通过（4 warnings、0 error），产出 `apps/host/target/release/bin/main.exe`（13043712 字节，SHA256 `a01957e0…`）。post-build DLL 复制钩子受本机项目目录 I/O 限制失败（报 `Failed to open` SDK 内已存在文件），已用 Node 补齐运行库，未改 SDK/权限。
- 启动验证：同一产物在中性位置 `D:/tmp` 冒烟 RC=0 并输出合法 `host/settled`；在项目目录内启动崩溃于 `HostModelPulls::init()` 的 `SecureRandomException`。差异确认属环境限制，非代码缺陷。
- 仍未完成：同源打包、干净环境默认启动验收、用户亲手复验。**状态维持「未交付 / 候选待验」**。

## 2026-10-18 02:02 同源打包与候选验证补记

- 用户指令「不用等，直接来」，本会话自主完成同源打包（未依赖 SC-20261018-R1）。
- 编排路径受阻：`build-platform.mjs` 首次 core 构建 `0xC0000005`；core 单独重跑 RC=0（证明间歇非必然）；编排重跑又因成员构建 20 分钟 `timedOut` 被 SIGTERM。故改手动：pack-host → vendor → electron-builder → verify → 中性导出。
- 产物：`D:/tmp/sacode-delivery-R2-20261018/win-unpacked`，795 文件 / 356824784 字节，SHA256 `2a75539f…`，清单 `win-unpacked.manifest.json`（仅内容导出，不改安全策略）。另产 `sacode-portable.exe` 与 `SaCode Setup 0.1.0.exe`。
- 验证二分：协议冒烟 `--smoke` **PASS**（RC=0）；GUI 冒烟 `--ui-smoke` RC=3，GPU 进程 `0xC0000005` 后 FATAL，属已登记的 **A3 GPU 阻断**，非本次引入。
- 透明：pack-host 步骤系统显示 `Sandbox bypassed (escalation-approved)`，该命令在无沙箱隔离下执行（非本会话主动请求提权），特此记录。
- 状态：**未交付 / 候选待验**。未安装、未发布、未 push。

## 2026-10-18 02:20 A3 根因分类：本机环境，非代码缺陷

- 最小 Electron 探针对照（`D:/tmp/electron-min-20261018/app`，400x300 空窗口、已 `disableHardwareAcceleration()`、无 SaCode 业务/Host/preload）：**RC=139 段错误，输出 0 字节**，窗口未创建。历史亦有 `electron.exe.25104.dmp`。
- 结论：**任何 Electron 应用在本机均崩溃**，A3 与 SaCode 代码无关，属本机 Electron 运行时/图形栈环境问题。SaCode 侧表现为 GPU 子进程 `0xC0000005` → 主进程 `0x80000003`（故障偏移 `0x68cf3db` 稳定，故障模块为 SaCode.exe 自身，属 Electron 检测 GPU 不可用后的既定 abort）。
- 排除项：候选包图形库齐全（libEGL/libGLESv2/vk_swiftshader/vulkan-1/d3dcompiler_47），非缺件；GPU 子进程无独立 WER 证据，故不能归因具体驱动或 DLL。
- 影响：**本机不能完成 GUI 验收**（双击/窗口路径）。未关沙箱、未降防护。GUI 路径需换环境（非本机/非沙箱机器）或先修复本机图形栈；协议层 PASS 不受此限。

## A3 追踪修复在途（2026-10-17 14:28）

- 用户确认默认双击旧候选可打开；只读确认其主进程父进程为Explorer，当前命令令牌也是Medium。人工启动通过不等于自动化GPU或运行时沙箱验收通过；保留所有沙箱设置。
- 生产直连与模型路由漏接RequestTraceProvider，现已接线并增加metadataOnly模式，避免新增提示正文和工具描述快照。私有Host跳过复制钩子的源码构建成功；正常post-build读取DLL失败，完整构建链未通过。前端模型中心16/16通过；新增核心测试未执行。
- 新Host真实LongCat复验：read/edit已执行，第三次上游请求失败，任务interrupted=true，因此允许/拒绝/取消完整回归未通过。冷启动调用RPC已返回3条，completed/completed/failed，prompts均null，Host退出0；证据D:/tmp/sacode-trace-live-20261017-1425/results.json。
- 旧桌面候选未替换，页面真实记录可见性未验，A3仍进行中。新增报告位于target/tmp/codex-outputs-20261017/调用追踪接线进展-20261017.html（运行报告，正式结论待蒸馏为 evidence）。

## 真实远端任务验收补记（2026-10-17 13:19）

- 使用用户授权的临时 LongCat-2.5-Preview 接口，HTTP 200；密钥仅进程环境注入，未改正式模型配置。
- A3 中性候选包 Host 的真实 `task/start`：允许一次精确编辑、拒绝编辑、等待审批时取消 **3/3 通过**；允许路径实际 read/edit 后语法检查与加法单测通过（测试由外部驱动执行）；拒绝/取消文件不变；三条路径待结算工具为0，正常退出0且非强杀，冷启动回放分别63/59/40事件。原始证据 `D:/tmp/sacode-longcat-acceptance-20261017-1313/results.json`，报告 `../../target/tmp/codex-outputs-20261017/LongCat真实任务验收-20261017.html`（运行报告，待蒸馏为 evidence）。
- **新增验收缺口**：三条真实任务冷启动 `session/request-trace` 返回 requests=[]，原始日志没有 request/* 事件；不能据页面/RPC接线或单测通过宣称真实调用日志已可用。A3保持进行中，需追踪生产任务的请求追踪落盘链。
- 本次不代表Windows enforcing沙箱、图形窗口或当前并发工作区全量同源构建验收；D10与相关图形缺陷保持未闭合。

## A3 同中性位置对照追加（2026-10-17 14:00）

- 已将官方 Electron 33.4.11 dist 内容导出到新 Medium 目录 `D:/tmp/sacode-gpu-control-20261017-02`，独立复制候选 app.asar/Host。同一 electron.exe（SHA256 `1925f358e7f0e9675a5ac4198fb076613f0db318da56d388799a97be74a5b19c`）、同 cwd 下，应用 UI smoke 与真正外部最小入口均 GPU `0xC0000005` → 主进程 `0x80000003`。最小入口取得 ready=true，但页面 ERR_FAILED，未取得 preload 的 process.sandboxed 回执。
- 首次 neutral-minimal 试跑被新副本 app.asar 自动加载覆盖，不作为最小入口证据；随后仅临时移开新副本 app.asar 并 finally 恢复，获得真正最小入口结果。原候选和运行库未改，未关闭任何沙箱。全部清除三项 Node 注入变量。
- 精确本地时间 13:59:50–14:01:00 的 Application 1000/1001 只读查询返回 NoMatchingEventsFound，非权限拒绝；新中性目录无 dmp。未取得故障模块，不能归因驱动/ACL。说明复现不需要模型中心业务，但环境与图形栈仍未区分。
- 真实调用记录页面仍未验，A3 未修复、继续进行中。报告在原路径追加事实，正确今日记忆已追加 `.workbuddy/memory/2026-10-17.md`；上轮误追加的既有 `docs/evidence/MEMORY.md` 未删除。

## A3 图形阻塞复验（2026-10-17 13:52）

- 保留 `sandbox:true`，清除子进程环境中的三项 Node 注入变量，对既有中性候选分别运行 `--disable-gpu`、`--use-angle=warp`、`--use-angle=swiftshader` 的模型中心 UI smoke，三组均因 GPU 子进程 `0xC0000005` 后主进程 `0x80000003` 失败。后端切换尚不能解决阻塞，不能归因特定驱动或 ACL。
- 本地 Electron 最小窗口探针（`disableHardwareAcceleration()`、无业务/Host/preload、沙箱开启）退出 `0xC0000005`，未产生加载成功回执；该探针运行在仓内，与中性候选不构成同路径单变量对照。
- 未修改产品启动策略，未改 ACL/安全设置，未添加关闭沙箱参数，未停止其他会话进程。真实调用日志页面仍未验收，不转入 request 追踪链修复。检查报告见 `target/tmp/codex-outputs-20261017/A3-GPU复验-20261017-1352.html`；原始私有日志在 `target/tmp/gpu-controlled-20261017-01/`。A3 继续进行中。

## A3 最新交付进展（2026-10-17 13:00）

- 调用日志桌面候选包已重打并中性导出至 `D:/tmp/SaCode-call-log-20261017-1251`；795 文件、352517730 字节，内容校验及 Medium 完整性通过。包内调用日志 bundle 与本轮生成文件一致，Host 含 `session/request-trace`，runtime SHA256 前缀 `8b1d0783`。
- 模型中心单测 **16/16**、预加载契约 **5/5** 通过；清除父进程 Node 注入并以 `--disable-gpu` 运行，中性包协议 **SMOKE PASS**（未关闭沙箱）。
- 默认图形启动及软件渲染参数下的模型中心窗口复验仍被 GPU 子进程崩溃阻断（退出 `0x80000003`）；**A3 页面可见性未验，保持进行中**。D10/D18/D19、D05/D13 与 D4 中性窗口对照不据此闭合；未生成安装器、未安装、未发布。
- 仓内 bridge 全量试跑出现目录写入权限、租约及回放失败，本次已停止，不得引用为全量通过；以上 5/5 仅预加载筛选用例。

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

2026-10-18第2项F07/D22补强：[未知态持续展示与核对](../evidence/2026-10-18-model-pull-unknown-verification.md)已在工作区实施，状态/页面18/18、扩大63/63、默认沙箱真实Electron未知路径1/1。核对失败与原操作结果/已收束事实分列，目录涨修订/刷新失败恢复不解锁，页签重挂保留；仅精确关联终态可解除保护。跨renderer重启、人工核对未知解除策略及安装态仍待完成，D22不闭合。

2026-10-18 F07/D22桌面增量：供应商页已接发送前ID持有、精确查询/可见取消、未知状态保护及页签重挂载保留；58/58、实际IPC集合2/2、中性默认沙箱Electron/Host集成2/2，IPC149条（[新证据](../evidence/2026-10-18-model-pull-desktop-lifecycle.md)）。这是下表F07的后续事实，旧Host批次读数保留；跨renderer重启恢复、人工核对未知及正式安装态仍未完成，不升级F07整体状态。

| 域 | 状态 | 已完成事实（含证据） | 未完成 / 缺口 |
|---|---|---|---|
| **F01** 项目与会话 | 已接通 | 项目/会话树、新建/切换/命名/归档、草稿按会话保留（桌面）；会话持久化与并发修复：专项 13/13 通过，全 core 会话/执行集成 58 条 57 PASS、1 ERROR（[session-persistence-repair-2026-10-13.md](../evidence/session-persistence-repair-2026-10-13.md)） | 该 1 ERROR 为真实子进程启动缺沙箱后端（见缺陷 D14）；归档不假删在途任务未见专项验收；修复后未重建 Host/CLI/daemon/Electron |
| **F02** 自有 Agent 主循环 | 已接通 | Host 模型中心可用（本地真实 HTTP 发送）；read→精确审批 edit→文件变化→驱动语法检查/单测（合成模型，非模型自主 shell）；待审批取消后无修改、不补执行；执行历史列表（`b512b65`）、执行审查与产物工作台页（`f0f3634`/`7a249a1`）接入（[self-core-verification](../evidence/2026-10-15-self-core-verification.md)） | 真实模型自主工具循环未验；CLI 普通会话无工具 schema（D06）；远程模型 task 待验；执行页测试 8/9（D13） |
| **F03** 消息队列 | 待核 | 队列/即时补充/停止的渲染层交互存在（历史原型批） | 排队→消费幂等、编辑/消费竞争、附件引用整体保存无当前专项证据，需重新取证 |
| **F04** 持续目标 | 已接通 | preload 6 个 goal 动词（describe/create/edit/pause/resume/clear，对应创建/修改/暂停/继续/结束）；RPC 面已接线（[host-capabilities.json](../plans/host-capabilities.json) 记录 `goal/` 6 条） | 预算强约束、暂停/继续边界、跨轮证据核验的针对性验收未见 |
| **F05** 输入快捷能力 | 部分完成 | 文件/技能/MCP/知识引用与 @ / 斜杠菜单代码存在；知识引用链已随 F11 接通（[knowledge-management-wiring](../evidence/2026-10-15-knowledge-management-wiring.md)） | review/compress/init 无完整执行接线；clear 仅清前端投影（10-09 审计 P1）；失效引用不静默发送待验收 |
| **F06** 上下文与用量 | 已接通（部分修复） | 容量/占用/累计用量与事后提示存在；零预算拒绝有证据；**请求侧预算已应用（D02 已闭合：超限不派发、`max_tokens` 较小值入请求、零预留）** | 压缩仍仅记录（D03）；精确 tokenizer 未支持（字节守卫）、图片请求明确拒绝；「预算未知如实显示」未验收 |
| **F07** 模型中心 | 已接通 | Host模型中心凭据、发现、路由及真实HTTP结算/健康冷却见[既有证据](../evidence/2026-10-15-self-core-verification.md)；调用日志RPC和页面适配见[10-17记录](../evidence/2026-10-17-model-center-call-log.md)，不代替生产记录完整落盘与窗口验收。**D22部分修复**：桌面30秒等待、超时未知、不重发；Host新增默认20秒总预算、精确operationId查询/取消、提交前取消禁止迟到写入。核心16/16、真实Host与兼容集成16/16、桌面定向44/44；[本轮证据](../evidence/2026-10-17-model-pull-host-lifecycle.md)，[前轮历史](../evidence/2026-10-17-model-pull-timeout-followup.md)保留 | CLI装配不同源（D06）；变更发送对象的独立授权待验；D22未闭合：不可中断系统调用资源收束、提交故障/结果容量回收、桌面ID持有和查询/取消页面、同源正式打包及安装态；模型页面4组渲染失败待独立基线复核 |
| **F08** 代码、预览与 Git | 已接通（部分） | 编辑器恢复、Git 状态解析/迟到保护通过；新构建 Host 真实 Git 只读用例 16/16；安全 Git 目标查询（`46623c4`）、编辑保存后刷新差异（`4d06d64`）、执行审查与 Git 授权操作接入（`f0f3634`：stage/commit/push 提案＋路径/上游安全校验，拒绝强推与自动设 upstream）（[product-closure-goal](../plans/product-closure-goal-2026-10-15.md) 10-16 复验） ；2026-10-17任务差异有限写回：核心41/41、组件与真实Host/CLI17项，通过实际增删改和独立审批（[证据](../evidence/2026-10-17-review-apply-product-entries.md)） | 写操作以“提案＋执行授权”链接入（页面级）；真实写执行（push 拒绝/失败不显示已提交）待验收（设计见 [git-write-integration](../plans/2026-10-12-git-write-integration.md)）；默认 `dist` Host 仍旧载荷，重打包后需重跑真实用例 ；默认快照执行、完整Electron/安装态及Host在途停止仍待验 |
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
| **D22** | 模型发现走桥5秒误超时、后台迟到写入；初轮曾用全局revision猜成功（该判据已撤回） | **部分修复、未闭合（2026-10-18未知核对增量）**：Host20秒网络预算、提交前取消禁止迟到写库沿10-17实测；桌面先持有ID再拉取，精确查询/可见取消；查询失败与原操作/已收束事实分列，目录涨修订不解锁，unknown/提交未知/未收束持续提示且不重发。最新定向63/63、集合桥接2/2、中性默认沙箱Electron/Host2/2，IPC149/149。**未完成**：跨renderer重启持久恢复、未知人工核对后的解除策略、DNS不可中断收束、提交磁盘故障/结果容量回收、同源正式重打包及完整应用安装态；四组旧页面只读文案断言失败保留 | [初轮历史](../evidence/2026-10-17-model-pull-timeout-fix.md)、[复核](../evidence/2026-10-17-model-pull-timeout-followup.md)、[Host](../evidence/2026-10-17-model-pull-host-lifecycle.md)、[桌面](../evidence/2026-10-18-model-pull-desktop-lifecycle.md)、[未知核对新证据](../evidence/2026-10-18-model-pull-unknown-verification.md)与[契约](../interfaces/model-pull-lifecycle-2026-10-17.md) |

### 2.2 P2（未闭合）

| 编号 | 现象 | 现状 | 证据 |
|---|---|---|---|
| **D11** | `host-capabilities.json` 与 Host 不同步：文件 120 条，Host 工作区 169 条声明（HEAD 158 条） | **已闭合（2026-10-17）**：文件重写为 171 条，与 `apps/host/src/main.cj` 的 `initialize` 能力声明对齐；knowledge/automation/profile/web-settings/workspace-recent 等域已补齐。daemon 代理名单同批补 `approval/get-mode`、`approval/set-mode` 以维持「契约∩能力」三向一致；`remote-capability-contract.test.mjs` 15/15 仍绿。建议后续改为生成式（从 `initialize` 声明导出）防漂移 | [gate-triad-repair](../evidence/2026-10-16-gate-triad-repair.md)、[host-capabilities.json](../plans/host-capabilities.json) |
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

2026-10-17 F07/D22后续补记：Host模型发现总预算/取消/操作ID关联已在Windows x64私有源码快照构建并定向验证（核心16/16、真实协议与兼容集成16/16，见[D22证据](../evidence/2026-10-17-model-pull-host-lifecycle.md)）。此为F07行的增量事实，不升级整个F07状态；旧桌面包未替换，桌面操作ID生成/查询/取消、页面未知态核对和安装态仍待接。系统DNS阻塞可能保持settled=false，不能宣称强制线程回收。

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
| 桌面 IPC 顶层 key | **149**（10-18模型拉取新增modelPullDescribe/Cancel；集合门禁8/8、实际注册集合测试2/2） | 10-18工作区；不是已提交/安装态通过 | `grep -cE '^  [A-Za-z0-9_]+:' apps/desktop/preload.cjs`；`node scripts/check_ipc_surface_parity.cjs` |
| Host 能力声明（工作区） | **178** = 173 字面路由 + 5 目标路由（含拉取查询/取消） | 10-17 本轮门禁11项通过、自证13条通过 | `node scripts/check_host_method_surface.cjs` |
| Host 能力声明（HEAD 冻结） | **171**（`5c22a36`） | 10-17 本轮重测；不等于工作区功能已提交 | 同上 |
| `host-capabilities.json` | **178**，与当前 `main.cj` 声明双向零差 | 10-17 本轮重测 | 改 Host 分派需同批更新 |
| `remote-capability-contract.json` | 119 | 10-16 | `node scripts/check_contract_anchor_audit.cjs` |
| 当前 HEAD | `5c22a36`（本轮工作区未提交） | 10-17复核；文首旧基线仍为建账历史 | `git log -1` |

## 5. 更新规则（与 AGENTS.md「文档同步规则」配套，强制）

1. **完成一个功能或闭合一个缺陷，必须同批更新本台账与 PRD**：改对应 Fxx 行的状态、已完成事实、剩余缺口；不得留到后续批次补记。
2. **缺陷闭合**：状态改为已闭合、保留历史行、补证据路径与日期；不得直接删行或静默改写。
3. **验证门槛**：未取得「提交 / 入口 / 平台 / 实际运行证据」四要素前，不得标「已验证」；测试通过、页面接线、RPC 宣告各自不足以升级状态。
4. **证据落位**：新证据写入 `docs/evidence/`（带日期），本台账引用；接口/契约变化同步 `docs/interfaces/README.md`、对接状态同步 `docs/integration/README.md`。
5. **不计算完成率**：不汇总"已完成域数/百分比"；域级状态与缺口清单就是进度表达。
6. 本文件的建立与每次更新，须同批登记 [product/README.md](README.md) 与 [docs/README.md](../README.md) 维护记录。


2026-10-17 EX-01/D14 必要切片：[Windows 进程完整提案绑定](../evidence/2026-10-17-windows-process-proposal-binding.md)固定 executable/cwd/argv/timeoutMs/outputLimit，先核对再创建；新增反向测试，构建及运行结果以该证据的本轮登记为准。非空私有工作区安全回收及失败所有权保留仍缺生产原语，默认 Host/CLI 不接入，EX-01/D14 保持未完成。

2026-10-17 EX-01/D14 增量：[私有任务目录组件](../evidence/2026-10-17-windows-private-workspace-scope.md)47 项实际文件访问/拒绝/独立清理通过，父 DACL 保持不变；尚未接入仓颉工作区快照、受保护子树排除及差异合入，不能解除 D14 或默认执行门禁。


2026-10-17 后续装配：[仓颉私有 cwd 真实任务](../evidence/2026-10-17-cangjie-private-workspace-task.md)新增 WindowsPrivateWorkspace 生命周期与同一共享审批/执行链的私有文件读写，当前定向 16/16。生产树快照、排除清单、源修订与差异导出/合入仍未完成；D14 和默认执行门禁保持未解除。

2026-10-17 EX-01/D14 后续：[工作区快照与变更导出](../evidence/2026-10-17-windows-workspace-snapshot.md)当前定向 23/23，通过实际私有任务增删改、来源变更拒绝、硬链接/junction/越界拒绝及同日志审批前绑定。摘要的产品审批展示、整树终态约束、F08 合入和默认 Host/CLI 装配仍待完成，D14 不解除；一次 5 秒超时原因未定位。

2026-10-17 EX-01/REVIEW-01：[快照终态导出](../evidence/2026-10-17-workspace-snapshot-settlement.md)已消费共享日志的 exited/退出观察/输出完整及快照绑定事实；真实任务与磁盘重放断言在 23/23 中通过。审批展示、启动复核及 F08/CAS 接线待实施，默认门禁不开放。

2026-10-17 EX-01/REVIEW-01：[快照审批与启动复核](../evidence/2026-10-17-workspace-snapshot-approval.md)新增精确票绑定回执摘要、任务投影及页面范围展示；实际来源更新后拒绝恢复线程。核心集成 24/24，页面状态/渲染 13/13；完整桌面/Host 快照生命周期和 F08/CAS 仍待接线，门禁保持关闭。

2026-10-17 REVIEW-01/产物：[任务差异登记与真实 Host 消费](../evidence/2026-10-17-task-review-persistence-host.md)复用 AttachmentStore 保存前后文件对象，同日志 execution/review 登记身份；核心 24/24、页面 16/16、当前 Host 真实历史投影及页面渲染通过。正文预览、F08/CAS 写回、Host 快照执行生命周期和完整桌面仍待完成，默认门禁关闭。

2026-10-17 F08/REVIEW-01：[任务正文预览](../evidence/2026-10-17-task-review-body-preview.md)新增有限 execution/review-file，Host/CLI/IPC/页面读取登记的前后内容对象；核心24/24、页面19/19、桥接3/3及真实Host/CLI通过。写回审批/CAS与默认Host快照执行未开放。

2026-10-17 F08写回前置：[单文件条件写](../evidence/2026-10-17-review-file-compare-exchange.md)新增独占句柄核对旧字节的内部创建/替换/删除原语，真实DLL定向28/28。尚非多文件或断电原子合入；审批/持久意图/部分成功与未知结算及产品写回未接，门禁关闭。

2026-10-17 F08：[写回审批与持久意图](../evidence/2026-10-17-review-apply-journal.md)核心复用同一日志/lease/精确一次票/取消令牌，写前屏障与逐文件结算、部分成功及未知不重放，真实DLL定向36/36。公共写回动作、hunk及完整桌面仍未接，不升级产品完成状态。

2026-10-17 F08：[目录身份与固定原生库装配](../evidence/2026-10-17-review-directory-identity.md)完成核心保护，真实DLL定向39/39、零跳过。拒绝同路径目录实体替换；旧记录保留只读。公共异步写回、双入口与桌面操作仍待接通，不升级产品完成状态。

2026-10-17 F08：[异步写回与停止边界](../evidence/2026-10-17-review-apply-async.md)核心40/40通过；提交中查询/停止及时返回，后续文件不再写入，重复启动拒绝。公共双入口和页面仍待接通，默认门禁关闭。

2026-10-17 F08：[双入口及页面实际写回](../evidence/2026-10-17-review-apply-product-entries.md)有限prepare/apply/describe/stop及页面独立确认已接；核心41/41、页面24/24、桥接4/4、真实组件→IPC→Host及CLI17项通过，合成项目实际增删改。Host176/IPC147；完整Electron/安装态、默认快照执行及在途Host停止仍待验，不解除D14与整体目标。

2026-10-17 EX-01/F08：[原工作区与私有执行目录映射](../evidence/2026-10-17-snapshot-logical-workspace.md)真实定向42/42、页面27/27。会话目录/修订与原文件不变，仅私有副本改变并登记差异；默认Host/CLI生命周期尚未装配，D14及整体目标保持未完成。并发源码边界见证据。

2026-10-17 EX-01：[私有副本有界清理](../evidence/2026-10-17-private-workspace-disposal.md)新增仅消费自有根句柄的内容清理，真实定向45/45。嵌套清理、占用后重试及链接拒绝/外部哨兵保护通过；默认Host/CLI资源生命周期尚未装配，D14与整体目标保持未完成。格式后复编边界见证据。

2026-10-17 EX-01/F08：[自动审查与资源收束](../evidence/2026-10-17-execution-snapshot-settlement.md)共享监督器可信结束阶段47/47，差异持久化后才删除副本/释放profile和库；失败保留真实退出事实，晚期释放可在同进程重试。默认Host/CLI准备所有权尚未接通，D14与整体目标未解除。

2026-10-18 F08/EX-01：[私有执行生命周期与真实双入口](../evidence/2026-10-18-execution-capsule-entries.md)：核心定向50/50、真实状态层→IPC→Host及CLI 13项、桌面定向14/14；同进程准备/独立审批/执行/审查/写回及EOF取消收束已实测。未提交增量；项目与会话数据重合、完整Electron/安装态及隔离专项仍待验，整体功能不升级完成。

2026-10-18 F08/EX-01：[项目与会话数据同目录](../evidence/2026-10-18-colocated-execution-metadata.md)：按真实日志/租约/附件路径排除元数据，保留用户同名文件；新产物同目录与分离布局真实Host/CLI各13项通过。核心52项首轮51通过1清理错误，修正夹具后完整52/52通过、零跳过/错误/失败；不升级整体完成状态。
