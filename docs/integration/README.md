# integration/ — 对接方案文档（总览）

> 类别：④ 实施计划（对接类）。上级索引：[docs/README.md](../README.md)｜接口面速查见 [`../interfaces/README.md`](../interfaces/README.md)。
> 本页汇总"把外部系统、外部 Agent 与远程通道接进共享核心与产品页面"的方案文档、状态边界与验收出口。方案描述当时设计；**完成状态以 PRD、证据与当前源码为准**，没有真实任务证据的条目不标完成。

## 1. 对接面总览

2026-10-21 D23：[核心局部修复证据](../evidence/2026-10-21-d23-reasoning-content.md)。reasoning独立增量经Agent保存为assistant.reasoning_content，日志flush/load后重建请求回传；不混content，不改Host/前端。隔离core构建成功，新增及Agent/请求/附件回归25/25。SSE全文件23通过/1真实供应商跳过/9网络夹具临时目录EPERM错误；真实DeepSeek、统一候选和GUI待验，不据此闭合产品链。


2026-10-21 MCP-E-2：[`客户端`](../../core/src/mcp_client.cj)新增显式env净化后覆盖及mcp/server策略读取；不改mcp.cj/main.cj/前端。隔离源码与依赖快照 `target/tmp/mcp-e2-20261021/snapshot` 中core构建rc=0（35警告），[新增测试](../../core/src/mcp_env_policy_test.cj)2项+既有客户端15项合计17/17通过、0跳过/失败/错误。覆盖子进程实际接收显式env且日志不含值、旧事件默认、配置名字隔离、指数延迟、显式策略优先、JSON与扩展注册格式、非法配置回退。策略在构造时冻结；Trae MCP-B-2配置事件需符合[接口格式](../interfaces/README.md)，JSON配置不代替注册授权。既有请求失败重连不等于空闲退出监视；本轮未验证真实服务/Host/GUI，不发布。


2026-10-21 MCP-E局部实现：[`mcp_client.cj`](../../core/src/mcp_client.cj) 新增重连 supervisor 与环境净化。重连由 `McpReconnectPolicy.delayForAttempt` 驱动指数退避，`listTools`/`callTool` 经 `requestWithReconnect` 包裹：传输层失败且非 `close()` 触发时自动重连，成功后原样重试一次请求；`close()` 置 `closing=true` 跳过重连；`maxAttempts` 后返回 `mcp-reconnect-exhausted`。重连期间 `isConnected()` 为 false（`closeProcess` 保证）。`launchServer` 调 `scrubEnvironment`：从 `getVariables()` 复制全量环境，命中 KEY/PASSWORD/SECRET/TOKEN（大小写不敏感）或 SACODE_* 的键值替换为 `<redacted>`，记 `mcp/env-scrub` 事件只记键名。私有 core 构建 `target/tmp/mcp-supervisor/build` rc=0（35 警告无错误）；[定向测试](../../core/src/mcp_client_test.cj) 15/15 通过（4 项新增：env 净化返回 `<redacted>` 且子进程不见原值且 `mcp/env-scrub` 记键名、崩溃后按策略重连成功、`close()` 后不重连返回 `mcp-not-connected`、重连耗尽返回 `mcp-reconnect-exhausted`）。不改 mcp.cj/main.cj/preload/前端；生产模型工具桥与真实 MCP 服务器接入仍待验。


2026-10-21 SK-F局部实现：新增[`tool_skill.cj`](../../core/src/tool_skill.cj)，[ModelToolRuntime](../../core/src/model_tool_runtime.cj)始终登记一个skill_load，执行器复用内部ToolRuntime.skillRegistry（含既有FilesystemSkillProvider），可选注入替代仓；无需修改agent.cj或Host装配。正文按调用getSkill加载返回，诊断日志只记skill-loaded不复制全文；modelInvocable=false拒绝，四档只读权限免审批，guard仍保留。私有core构建 `target/tmp/skill-load-skf/build` rc=0、35警告无错误；[定向测试](../../core/src/tool_skill_test.cj)2/2通过（唯一声明/schema/正文/缺失/坏参数/四档零审批/模型禁用/guard及默认文件系统仓）。无编译阻塞；真实供应商Host回合/GUI/全量回归待验，不代表技能产品链交付。初轮编译发现初始化闭包捕获成员限制，已用局部绑定修复；共享目标由其他会话使用，本轮独立输出未干扰。


2026-10-21 R8-HOST后续：[`main.cj`](../../apps/host/src/main.cj) 两处ModelToolRuntime注入可信子代理绑定；覆盖下方R8历史“Host未注入”状态。角色仓用户→项目覆盖后写轮次私有快照（不改源配置），运行根在会话日志父目录下原子创建，工作目录/父权限与工具集取本轮可信快照；执行前重查取消、目录和权限deny。模型工厂使用本轮供应商/key及Runner独立body/childToken，只接受继承模型；子审批复用Host通知、精确消费父票、持久后签发独立子票。子流使用独立有界sink，不污染父正文。私有Host构建 `target/tmp/r8-host/build/release/bin/main.exe` rc=0（core35/Host33警告）；[真实Host回环测试](../../apps/host/test/subagent/subagent-host.test.mjs)3/3通过：声明/批准→Runner→摘要、拒绝零子请求、项目角色覆盖用户角色；同轮core库复验[兼容测试](../../core/src/subagent_delegate_test.cj)1/1通过（含无注入不宣告与父取消）。CLI、角色独立模型路由、子写操作审批端到端、持续目标自动起轮实跑、真实供应商与GUI仍待验。无并发编译阻塞，不提交/安装/发布。


2026-10-21 HOST-COMPACT-FIX：仅在 [`main.cj`](../../apps/host/src/main.cj) 的 CompactRpcWiring 装配处注入安全探针。CompactSafety依次为 providerActive/awaitingApproval/awaitingPlan/awaitingQuestion；未结算工具并入providerActive。状态来自绑定shared日志快照（turn、关联模型调用/结果、审批、计划、提问）及Host在途状态，不取RPC参数；绑定变化或解析失败保持queued。私有构建 `target/tmp/host-compact-fix/build/release/bin/main.exe` 成功，core35/Host33警告、无错误；[协议测试](../../apps/host/test/compact/compact-safety-host.test.mjs)1/1通过，实际Host+合成日志验证安全分支与ready/compact-published产物及输入缩小。要求已持有真实写租约，未改租约取得逻辑，无租约仍报compact-not-writer；未测真实供应商流中竞争/GUI/安装态。本轮不改compact适配文件、core、preload或前端。


2026-10-21 R8 主模型子代理工具（核心局部验证）：[`SubagentDelegateTool`](../../core/src/tool_subagent.cj) 通过 [`ModelToolRuntime`](../../core/src/model_tool_runtime.cj) 可选绑定注册 `subagent_delegate(roleId, task)`；角色仓加载 → Runner 独立执行 → JSON 摘要，复用审批/guard/父取消。独立输出 `target/tmp/subagent-delegate-r8/build` 的 `cjpm build` 成功（35个既有/并发源码警告，无错误）；[`定向合成测试`](../../core/src/subagent_delegate_test.cj) 1/1通过，覆盖声明、build审批不获准零启动、角色缺失、成功摘要、执行中父取消。当前 Runner 已有 isClosed，本轮未修改。存在他会话共享目标构建/测试及临时移动测试源码的并发活动，本轮使用私有库与独立测试链接避开共享输出，没有并发编译阻塞。Host/CLI 尚未注入角色仓/可信Runner/模型工厂/子审批，真实供应商及产品入口未验，不升级为主链完成。


2026-10-21 网页工具内联结果（局部验证）：[`msgfold.js`](../../apps/desktop/renderer/msgfold.js) 兼容核心 `{result,text}` 信封及直接结果对象，严格 `externalContent===true`，抓取须 HTTP(S) 来源 URL，搜索须 sources 数组；查询优先取已关联工具调用参数，缺失不猜测。正文按500个Unicode字符预览，展开还原已返回正文；来源、HTTP、发布时间、上游截断与低信任提示独立展示。[工具卡](../../apps/desktop/renderer/pages/tool-card.ts) 全部按文本 VNode 渲染，不执行网页HTML或来源URL；旧工具与复制功能保留。解析/渲染相关29项通过，页面构建及静态CSP门禁通过；未改Host/主进程/preload，真实网络消息流与GUI仍待验。

2026-10-21 输入区统计 pill（局部验证）：[`composer-stats.ts`](../../apps/desktop/renderer/pages/composer-stats.ts) 已接 composer 上方一行。Activity 只收 `turn/poll` 的 `elapsedMs/ttftMs/tokensPerSecond`；模型切换或新轮次清旧值，会话/轮询换代拒绝迟到结果。Usage 调既有 `usageStatus` / `ledgerStats`，完整四维优先读取 `tokenTotals` 或顶层 `input/cacheRead/cacheWrite/output`；缓存命中为 `cacheRead/(cacheRead+input)`，缓存写入计总量但不计命中率。当前 Host 尚无上述性能与累计 token 明细，只可回退会话 `used`，详情以未知展示；未新增 IPC/后端字段。组件、ContextMeter、轮询、模型目录相关20项通过，页面构建及静态 CSP 门禁通过；完整 GUI/真实提供方待验。

2026-10-21 Web 执行适配（实施中）：[`WebRpc`](../../apps/host/src/web_rpc.cj) 已提供 `web/fetch` / `web/search` 的共享核心调用与出帧接缝，见[接口登记](../interfaces/README.md)。按本次范围不修改主路由，公开 Host/桌面入口、授权归属接线及真实网络验收仍待完成，D08 不闭合。

2026-10-19桌面交互接线：[第一批增量证据](../evidence/2026-10-19-first-batch-interactions.md)、[接口契约](../interfaces/session-interactions-2026-10-19.md)。模型提问等待与应答复用共享问题日志，同一模型轮续答；不授予工具执行许可，不自动开放daemon/ACP远程面。第一批尚未验收。

| 对接对象 | 方案文档 | 状态与边界 | 验收出口 |
|---|---|---|---|
| ACP · OpenCode | [opencode-acp-diagnostics-repair-2026-10-14](../plans/opencode-acp-diagnostics-repair-2026-10-14.md) | F10-ACP-01 待验收；02–04 实施中；05–06 未开始。关闭零启动、诊断分列、复用现有任务链 | 真实实例 + Host/CLI/桌面共用任务/审批/取消/结算 |
| ACP · CodeBuddy | [codebuddy-acp-entry-2026-10-14](../plans/codebuddy-acp-entry-2026-10-14.md) | CB01–CB04 有独立构建、IPC/页面测试与假提供方证据；CB05 真实模型任务未授权；默认配置 `session/new` 仍 -32603（根因未确认）；窗口验收未通过 | 见原文「接管更新」节；不以协议初始化代替任务成功 |
| 远程 / 移动端 | [unified-remote-mobile 规格](../superpowers/specs/2026-10-10-unified-remote-mobile-design.md)｜[计划](../superpowers/plans/2026-10-10-unified-remote-mobile.md) | 设计；远程身份、会话归属与部署独立验收 | [remote-capability-contract.json](../plans/remote-capability-contract.json) + [daemon 复核](../plans/sacode-daemon-contract-review-2026-10-08.md) |
| 桌面业务链 | [2026-10-11-desktop-business-integration](../plans/2026-10-11-desktop-business-integration.md) | 大改实施方案；B1 已实施并构建；默认 C 盘存储限制未收口；用户已要求停止反复测试与新增探针 | 真实业务链逐项取证，UI 检查数不代替 |
| 页面接线与闭环 | [product-closure-goal-2026-10-15](../plans/product-closure-goal-2026-10-15.md)、[remaining-product-pages-2026-10-12](../plans/2026-10-12-remaining-product-pages.md) | 目标：知识库/自动化/连接三个主页面 + 七类工作台资源闭环；快照含 4 例 `host-gone` 失败待核 | 文件编辑 → 受控执行 → 差异审查 → 分别授权 Git |
| Windows 执行隔离前置 | [身份](../evidence/2026-10-17-appcontainer-minimal-environment.md)、[原生进程组件](../evidence/2026-10-17-windows-owned-process-provider.md)、[设计](../plans/appcontainer-sandbox-cffi-design.md) | 2026-10-17 身份 5/5、AppContainer/管道/Job 组件 35 项实测；公共执行器尚未消费 | 包内仓颉句柄适配及共享结果转换已实测（[记录](../evidence/2026-10-17-windows-process-collector.md)）；显式共享监督层取消/持久结算已验（[13/13](../evidence/2026-10-17-windows-execution-supervisor-integration.md)）；Host/CLI 默认装配、私有 ACL 撤销、文件/网络/逃逸反向测试及打包；当前门禁关闭 |
| Git 写操作（F08） | [2026-10-12-git-write-integration](../plans/2026-10-12-git-write-integration.md) | **待用户批准**；当前仅 `status`/`diff` 只读链 | 提案 + 绑定不可变提案的一次性工单；禁 `add .`/强推等 |
| 知识库（F11） | [管理契约](../plans/2026-10-12-knowledge-management-contract.md)、[核心/CLI](../evidence/2026-10-17-cli-launch-0xc0000135-stdx-dll-missing.md)、[Host/页面当前复验](../evidence/2026-10-15-knowledge-management-wiring.md) | 2026-10-17 未提交工作区：核心 5/5、CLI 跨轮请求 1/1、Host 自动检索 1/1、管理/显式引用 2/2、Electron 隔离页面 1/1；项目来源失效、作用域、上下文上限与无正文审计已验，页面明确模型发送 | 完整桌面/默认安全启动/安装态、源码符号索引与 KN01–KN08 效果对照待验；不升级为完整 F11 通过 |
| 自动化（F13） | [automation-product-wiring-2026-10-15](../plans/automation-product-wiring-2026-10-15.md) | 实施边界已定：保存不执行；启用/手动触发/取消为显式动作 | 真实定时或手动触发、独立会话任务与审批、取消与去重 |
| 插件与扩展市场 | [sacode-extension-market-2026-10-11](../plans/sacode-extension-market-2026-10-11.md)；[实施前审计](../plans/sacode-2026-10-11-preflight-source-audit.md) | 方案；Skill/MCP 宿主分派缺口见审计（接通线排在市场之前） | 可信目录来源 + 现有 inspect/start/授权链 |
| LSP（F21） | [lsp-l1-entry-wiring-2026-10-07](../plans/lsp-l1-entry-wiring-2026-10-07.md) | 契约与入口接线登记 | 见 [接口总览](../interfaces/README.md) §1 |

## 2. 对接共同红线

2026-10-18第2项[页面未知态补强](../evidence/2026-10-18-model-pull-unknown-verification.md)：核对请求失败不覆盖操作/收束事实，刷新目录/查无旧ID不解锁重复；未知与核对失败在页签重挂后持续显示。63/63与默认沙箱真实Electron失败路径通过；不扩展远程面或跨应用持久恢复范围。

模型发现桌面控制面（2026-10-18，待验收）：[总预算/取消/关联结果契约](../interfaces/model-pull-lifecycle-2026-10-17.md)、[Host运行记录](../evidence/2026-10-17-model-pull-host-lifecycle.md)与[桌面新记录](../evidence/2026-10-18-model-pull-desktop-lifecycle.md)。已接发送前ID持有、页签内存保留、精确查询/可见取消；58/58、桥接2/2、中性默认沙箱Electron/Host2/2，IPC149条。查询不重发、cancelRequested不等于settled；跨renderer重启恢复、未知人工解除策略和正式安装态仍未验，不自动开放daemon远程面。

1. **复用共享核心**：任务、审批（一次性工单）、取消与结算不建第二套；外部 Agent 的凭据不复制、不改写。
2. **真实任务验收**：协议探针、单测、目录读取结果都不等于对接完成；未授权的模型任务不发送。
3. **归属边界**：并发会话按交付线归属；公共接线只做增量，不覆盖他人差异、不替他人提交。
4. **失败与恢复**：取消、断连、重连、迟到响应、未知副作用按各自文档门槛逐项取证；缺证保持待验收。

## 3. 维护规则

- 新增对接方案落 `plans/`（有规格的成对进 `superpowers/`），同批在本页登记；
- 状态列只用：方案｜设计中｜实施中｜待验收｜已验收（附证据）｜已移交，不写"基本完成"；
- 方案中列出的"完成门槛"证据出具后，回本页更新状态并注明证据出处。


2026-10-17 EX-01/D14 增量：[私有任务目录组件](../evidence/2026-10-17-windows-private-workspace-scope.md)47 项实际文件访问/拒绝/独立清理通过，父 DACL 保持不变；尚未接入仓颉工作区快照、受保护子树排除及差异合入，不能解除 D14 或默认执行门禁。


2026-10-17 Windows 生产装配必要切片：[完整提案绑定](../evidence/2026-10-17-windows-process-proposal-binding.md)拒绝进程参数与限制篡改；非空私有目录安全回收及失败所有权保留仍阻断，Host/CLI 默认提供方未接入，不升级 ready。

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
