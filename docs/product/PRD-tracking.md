# PRD 全程跟进台账（F01–F21：完成 / 未完成 / 缺陷）

- 建立：2026-10-16
- 读数基线：分支 `refactor/dsh-learning`，HEAD `7a249a1c2ca03f5d4ad7a7c5e82eb81d60a00238`（2026-10-16 11:45:32），工作区存在未提交改动；各条目均标注取证时点，过期读数以时点区分。
- 上级索引：[product/README.md](README.md)｜需求与验收口径权威：[PRD.md](PRD.md)
- 定位：本文件是 F01–F21「推进到哪一步」的**唯一实时跟进入口**。只登记现状与证据，不改需求、不宣布验收通过、不计算整体完成率；口径冲突时以 PRD.md 为准。

2026-10-21 Trae MCP-ALL（未提交工作区、Windows，局部证据）：`apps/host/src/mcp_rpc.cj` 接受 connect 原始 args 中可选 `env:[{key,value}]`，校验后传入既有 `McpClient(env:)`，保留原始参数审批绑定；补齐 tools 的 inputSchema JSON 透传及缺失兜底。客户端 env 净化后覆盖、事件重连策略及配置加载注册已有实现，本轮未重复改写。新增可维护测试 `apps/host/test/mcp/env-host.test.mjs`、`core/src/mcp_config_test.cj`；隔离副本 `D:/tmp/sacode-mcp-all-20261021-f49c82` 单成员 Host 构建rc=0，Host5/5、配置5/5、既有env/policy2/2，共12/12，0失败/错误/跳过。最终Host SHA-256 `40648d1b4de3c027f56d523878a8333271140aaa8f02f195e5fc81595931ed26`；日志 `target/tmp/mcp-all-r2-20261021-f49c82/{host-build.log,host-tests.log,core-directed-final-test.log}`，源码清单保留于隔离副本。配置加载器API可读文件并注册，但未接生产入口自动加载；未跑完整core测试、工具桥专用回归、取消回归、桌面/真实外部服务/安装态，不升级F域完成状态，不改变下方候选身份及主阻塞。接口口径同步[接口索引](../interfaces/README.md)。未提交、推送、安装或发布。

## 当前交付卡（2026-10-18 用户确认）

**当前结论：尚未交付一个经用户完整走通的同源版本。** 下方局部测试、私有候选和历史通过读数不能替代该结论。所有 IDE / AI 会话按 [交付主线 §0](../plans/product-closure-goal-2026-10-15.md#0-当前执行顺序先交付一个走通版本2026-10-18-用户确认) 跟进，项目规则见根 `AGENTS.md`。

| 项 | 当前登记 |
|---|---|
| 唯一近期目标 | 正常双击 → 配置供应商/选择模型 → 打开小项目 → AI 读取并提出修改 → 用户审批 → 实际修改/真实差异 → 关闭重开后记录和文件正确；若承诺构建/测试，须在产品中真实执行成功 |
| 当前阶段 | 2026-10-21 T11：**全部在途任务完成**。用户决定完成当前阶段所有任务再走通。8 个在途任务全部交付：✅Q1-C(D24 failover 六项修复) ✅CB-3-B(隔离快照构建 4/4 rc=0) ✅CP-1(桌面IPC 198/198) ✅SK-F(技能端到端 19/19) ✅D23(reasoning_content 25/25) ✅Q3-A(dist重打 smoke PASS) ✅MCP-ALL(Host env透传+inputSchema+重连策略 12/12) ✅UI-FIX-7(clear UI验收脚本+门禁SKIP)。5批提交已推送至 origin/dev（9c85fed→6e6c6c8）。下一步：统一构建候选包 → 用户亲手复验走通。 |
| 交付主责 | 本会话按执行方回报归拢进度、产品判断与派任务，不亲自复核源码/哈希或代跑构建。OpenCode负责技能编译；Trae负责计划批准持久性；MonkeyCode负责目标三项；CodeArts负责前端与GUI；CodeBuddy负责shell收口及唯一统一core/Host构建；Qoder负责独立原生诊断及阶段协议验收。阶段失败打回负责人，共享文件串行交接，独立工作并行，不代提交推送。 |
| 候选源码/依赖/运行库 | c4 / sacode-c4-delivery-20261019-final，dev/f7cef5f 加96项覆盖，source.zip SHA256 7a306e85…；125包内文件与构建树一致，完整782文件哈希，80DLL，Host82845184…，asar d3ac5d5d…。用户data-paths.cjs SHA256 19abb997…已纳入；仍排除在途文件。vendor及目录打包成功，递归无沙箱旁路启动文件。 |
| 对外测试入口 | C:/Users/jingg/.codex/worktrees/225e/sa-code/target/tmp/sacode-c4-delivery-20261019-final/package/win-unpacked/SaCode.exe；本轮唯一c4手动验收入口。R4/c3/内部旧c4保留不覆盖，不安装、不发布。 |
| 当前主阻塞 | 段错误已解除（core lib 构建 PASS）。当前无编译阻塞。`git_service_test.cj` `init` 关键字冲突已修复。D23 DeepSeek `reasoning_content` 缺口登记为后续待办，不阻断当前候选（若用户验收选 DeepSeek 思考模式+工具调用则需升级为必要修复）。5 个推迟缺口不变。 |
| 下一步 | **全部在途任务已完成**。进入统一构建候选包阶段：①冻结当前工作区源码快照 → ②CodeBuddy 统一 core/Host 构建 → ③Qoder dist 宿主重打（解除 PID 38136 锁后）+ 候选包打包 → ④用户亲手复验走通（双击→配置→打开项目→AI 修改→审批→真实差异→重开验证）。UI-FIX-7 clear 实机验收归用户桌面环境。所有交接回本会话，不提交推送。 |
| 暂缓与安全边界 | 无关功能扩展/重构先入待办；F01–F21与平台范围不删；不关闭沙箱、不丢授权/取消/结算/恢复，不让用户补构建环境 |
| 汇报约定 | 当前阶段/候选身份、主阻塞、当次动作、下一步验收；“单测/接口/页面通过”≠“版本交付”，未过用户完整复验不报“闭环/收官” |

2026-10-20 协调复核：前端r2证据根 `target/tmp/frontend-regression-20261020-r2-023411/`，8份原始TAP已读且与summary相符；16个列出文件历史前后哈希相等，复核时当前字节仍匹配，仅证明这些取样点和文件，不推广为全部无副作用。第二轮原始日志 `target/tmp/shell-build-precheck-20261020/logs/core-build-round2.log` 记录02:34:10–02:34:30、rc=1；未执行core测试/Host构建。goal-bar当前与明确c4候选只读比对保留InlineEditor/CAS/迟到响应防护/正文展开/休眠占位，但c4去换行后等于HEAD，不是覆盖前原脏字节，不能据此宣布完整恢复；现有7项测试未覆盖disarmed/remaining分支。各方任务书形成、用户转发和执行方接收分列，不把本轮回派写成已通知。

2026-10-20 Trae计划持久性审查已收到：记录 `target/tmp/plan-durability-audit-20261020-a1/audit.md` 实际存在；定点核对确认 `plan_review.ask` 批准分支调用非持久的 `PlanModeController.exit()`，批准与权限恢复只有append，普通轮末才flush，存在副作用先于批准持久化的窗口。普通轮末flush失败分支仅写stderr，不能据此称完全无日志，但未见该分支冻结或向用户返回明确持久失败。属源码级缺口，未运行复现；手动durable模式切换与execution启动屏障不等于覆盖此路径。Trae继续停写，不新增审查任务；先完成当前编译轮，交接共享文件窗口后只修“批准/恢复权限持久化成功再继续，失败冻结阻断”，补成功/持久失败两条定向验证，不扩通用执行框架。修复前不验收计划批准后的执行闭环；不阻止诊断性统一构建。新安排待用户转发，未宣称已通知。

2026-10-20 技能兼容样例复核：`target/tmp/skill-compatibility-cases-20261020-01/`实有25场景、27份技能输入及1份矩阵；60058B/70058B大小已核，7接受/16拒绝/2裁决只是预期，解析器未运行。modelInvocable/userInvocable目前仅见类型/解析/测试，Host/CLI加载与slash消费未接入，不能把#03/#04写成既成产品行为；#25应为resourceBase.kind/path。原矩阵#23等复现省略userDirOverride、现有部分测试也走真实HOME默认值，后续统一运行前须改合成用户层。静态新缺口为readBounded超预算块读/读异常返回前缀及祖先提前break，未做运行复现。四份技能文件当前内容仍匹配T7，第二轮编译失败状态不变。审核与更新后的自包含回派见 `target/tmp/coordination-20261020-r3/outputs/OpenCode-技能样例审核与定点回派-20261020.txt`；新任务仅形成，未确认转发/接收，不开放第3段或自行构建。

2026-10-20 原生准备复核：Qoder方案 `target/tmp/native-rebuild-preparation-20261020-a3k7/plan.md` 已读，独立核对4/6源码漂移及DLL与自身manifest相符；实际Clang 22.1.0/MSVC x64与指定新中性路径父目录implicit-medium已只读核验，未编译或跑探针。须纠正：`build-windows-process.mjs --verify`仍先覆盖.deps，工作区驱动亦自动重建；manifest是10字段/7哈希，同一次脚本调用不证明输入未漂移。分阶段任务仅内部独立构建+35项进程探针诊断，不改共享脚本/.deps/ACL/token；47/54及正式Host另排，core仍由CodeBuddy独占。新DLL不自动晋级正式候选，不解除D14与shell两缺口。具体转发裁定见 `target/tmp/native-rebuild-preparation-20261020-a3k7/outputs/Qoder-原生重建裁定与可转发任务.txt`；任务书形成不等于已转发/接收或已执行。

2026-10-19 c4交接：[候选身份、配置共享5/5与五项验收清单](../evidence/2026-10-19-c4-delivery.md)。配置默认共享 `~/.sacode/user`，显式 `SACODE_USER_SETTINGS_DIR` 仍优先；仅设置数据根不隔离供应商。两份真实Host进程回读一致，不冒充两窗口GUI。

维护时更新此卡的当前值，保留后文带日期的历史证据；提交/安装/收费请求/发布仍须独立授权。此卡不计算完成率，也不代替逐域缺陷台账。

2026-10-21 CodeArts 串行 IPC 接线（未提交工作区、Windows）：按用户授权在 `apps/desktop/main.cjs` 增补 36 个具名 handler，闭集参数校验后固定映射至 Host；preload/主进程集合门禁 **191/191**。入口 `apps/desktop` 下 `node --test test/bridge.test.mjs` 实跑 **67 项、66 通过、1 失败、0 跳过**；新增映射/实际回执与错误传播、非法负载、可选参数与导入分支 3 项通过。失败为原有「残留租按持有者死活分别接管与拒绝」真实 Host 用例（`session-owner-unknown`），本轮未改租约/Host。同批修正 import 域契约对齐：Host `import_rpc.cj` 要求全部 8 个 import 方法顶层 `sessionId` 等于活跃会话、决策值域含 `dismiss`，此前 `main.cjs`/`preload.cjs` 漏 `sessionId` 且漏放行 `dismiss`；现两侧 8 条通道均加必填 `sessionId`（单参数通道首位传入），`importConfirm` 值域扩为 `append|overwrite|skip|dismiss`，夹具改用 `dismiss` 端到端覆盖，测试读数不变（66/67）。对应 F11/F13/F15–F19 仅增加适配层证据，状态仍未完成，不据此宣布新增域真实任务或 GUI 通过；接口说明见 [接口索引](../interfaces/README.md)。未构建新候选、未提交/安装/发布，候选身份及当前主阻塞不变。

2026-10-21 OpenCode Q1-B failover 契约测试与 bug 发现（未提交工作区、隔离副本）：新增 `core/src/model_agent_failover_test.cj`（4 条契约测试，隔离副本全绿）；隔离 probe 3 条失败正好对应当前未实现的 failover 缺口，已登记为 **D24**（6 项缺陷：首次 429 不立即降级、连接超时不触发切换、首个 Provider 失败直接结束本轮、双候选冷却拒绝不保留 TransportFailure、降级无跨轮粘滞、Retry-After:0 被当未提供）。生产代码未修改。仓库内全量 `cjpm test` 编译/链接超时未取得最终计数，OpenCode 主动终止自己的编译进程并改用隔离副本完成验证。**不阻断当前候选**：单供应商场景不受影响；多供应商降级场景需修才能可用。

2026-10-21 Qoder clear 命令 Host/IPC 层验收（未提交工作区、Windows）：会话日志真源清空链路已打通：Host `session/clear` → preload `sessionClear` → 主进程 handler → 渲染层 `clearConversation()`。10 条消息 Host 级验收通过（seed=10 → clear → projection=0 → 盘上无旧消息 → 重启 → 0 → 追加 1 条 → 1）。桥接 5/5、composer 命令 8/8。preload 顶层 key 实测 196。本会话唯一写入：`composer-commands.test.mjs:69/78` 两条旧断言更新（原断言要求 `frontendOnly===true` 且"无 IPC 调用"，与新契约相反，改为"非 frontendOnly + 必须调 sessionClear"）。**残留风险**：①`clearConversation()` 未重置 turn 状态，清空后可能显示 live 气泡；②`clearSessionHistory` 未保留 `session/archived` 事件，清空已归档会话会丢失归档标记。**未执行**：Electron UI 实机点击验收（归 CodeArts）、Host 重建、候选打包、提交推送安装发布。

2026-10-21 Qoder Q2-A clear 残留风险修复与 IPC 计数更正（未提交工作区、Windows）：①`clearConversation()` 在 `sessionClear` 成功后按切换会话同一口径重置 turn（running/settled/text/finishReason/cancelled/interrupted/delivered），新增行为用例（从 app.js 取出该函数实跑，取消轮次残留夹具）先红后绿；②`clearSessionHistory` 基线快照加入 `session/archived`，新增桥接用例先红后绿（清空后事件保留、重启后 catalog archived=true）。单成员 `cjpm build`（apps/host）rc=0，新宿主 19:03 构建、main.exe 15,960,576 B、83 个 DLL、干净 PATH 启动 rc=0；以 `SACODE_HOST=apps/host/target/release/bin/main.exe` 复跑 clear 桥接 4/4、10 条消息验收 8/8。IPC 计数更正：上一行 196 是 `grep -cE '^  [A-Za-z0-9_]+:'` 把 `ipcMapping` 内 4 个嵌套键（titleMode/prefix/conflictPolicy/credentialBindings）也计入；按 `check_ipc_surface_parity.cjs` 结构解析与门禁为 **192/192**（GATE PASS，8 checks），较 10-18 基线 149 新增 43、删除 0。用户给的 `^ `（单空格）命令实测 0，正确前缀是两个空格。**未执行**：dist 宿主重打与候选打包、Electron UI 实机点击、提交推送安装发布。

2026-10-21 MonkeyCode MCP-C 工具桥接入（未提交工作区、隔离副本）：新增 `core/src/mcp_tool_bridge.cj`（`McpToolBridge`：把已连接 `McpClient` 的工具注册到 `ToolRegistry` + `runtime.executors`，公开名 `mcp__<server>__<name>`，通用 schema `{"type":"object"}`）；`core/src/model_tool_runtime.cj` 新增可选参数 `mcpBridges!`，构造末尾遍历调 `bridge.sync()`（与 subagent/skill 注入一致）。隔离 Core `cjpm build` 通过（35 既有告警无错误）；`cjpm test --no-run` 通过；定向测试 **52/52 通过**（含 7 个新增桥接测试：注册/转发/isError 归一/断开注销/未连接不在表/重复 sync 不累积/guard=false 前置拒绝）。`McpToolInfo` 当前只有 name+description 无 inputSchema，后续补。未改 `mcp.cj`/`mcp_client.cj`/`main.cj`/`preload.cjs`/前端。

2026-10-21 Trae MCP-B Host RPC 六动词接线（未提交工作区、中性快照 `D:/tmp/sacode-mcp-b-20261021`）：新增 `apps/host/src/mcp_rpc.cj`（`McpRpc` 适配类，约 200 行），`main.cj` 5 处改动（字段 L1024、会话切换清理 L1125、分派 L1251-L1266、capabilities L1495、退出清理 L4030）。六 RPC：`mcp/list`（投影已注册服务器）、`mcp/connect`（真 `McpClient.connect()` spawn+initialize 握手）、`mcp/disconnect`（`close()` 强杀子进程）、`mcp/tools`（`listTools()`）、`mcp/call`（`callTool()`）、`mcp/status`（`isConnected()`）。安全：connect/call 需 `approvalId` 精确匹配+权限模式非 deny；工具名限制 `[A-Za-z0-9_.-]`；argumentsJson 必须可解析为 JSON 对象；传输异常不回显原始 message。负例全命中：未注册/会话不符/票据不匹配/spawn-failed/transport/timeout/同一票据二次拒绝。中性快照单成员 `cjpm build` rc=0（33 既有警告）；32 次真实 NDJSON 调用全过。Host initialize SecureRandomException 根因定位：构建钩子只在设 `OPENSSL_HOME` 时复制 `libcrypto-3-x64.dll`/`libssl-3-x64.dll`，设 `OPENSSL_HOME=C:\Program Files\Huawei\BasicService` 后产物带库、可正常启动。**未接 preload/前端**；无 `mcp/register` 动词（注册靠 `session/append` 写 `mcp/server` 事件或等 MCP-A 配置加载器）；connect/tools/call 同步阻塞最长 30s 且传默认 `TurnToken()` 不支持取消；core `McpClient` 不收 `env`。

2026-10-21 DSH MCP-E 重连 supervisor 与环境净化（未提交工作区、隔离副本）：`core/src/mcp_client.cj` 新增重连逻辑（`requestWithReconnect` 按指数退避等待→重新 `connect()`，达 `maxAttempts` 返回 `mcp-reconnect-exhausted`）、`closing` 标志（区分预期关闭与异常崩溃，前者不重连）、环境净化（`scrubEnvironment`：匹配 KEY/PASSWORD/SECRET/TOKEN 大小写不敏感或 `SACODE_*` 前缀→值替换 `<redacted>`，记 `mcp/env-scrub` 事件只记键名）。隔离 Core `cjpm build` rc=0（35 既有告警）；定向测试 **15/15 通过**（4 新增+11 既有：env 净化/崩溃后重连/close 不重连/重连耗尽）。未改 `mcp.cj`/`main.cj`/`preload.cjs`/前端。D04 不升级为已接通（生产模型工具桥 schema/参数构造/逐调用授权仍待接入）。

2026-10-21 MonkeyCode SK-D MCP inputSchema 传递（未提交工作区、隔离副本）：`core/src/mcp_client.cj` 两处改动：①`McpToolInfo` 新增 `inputSchema: String` 字段（默认空串，向后兼容）；②`listTools()` 解析 tools/list 响应时用新增 `jsonRaw()` 辅助函数读取 `inputSchema` JSON 原文。`core/src/mcp_tool_bridge.cj`：`sync()` 用 `info.inputSchema` 非空时注册到 `ToolSpec.params`，空时用通用 `{"type":"object"}` 兜底。隔离 Core `cjpm build` 通过；定向测试 **59/59 通过**（含 3 个新增 schema 测试：inputSchema 传递/缺失兜底/字段可读）。MCP-B-2 取消支持已在之前轮次实现（connect/listTools/callTool 均收 `token!: TurnToken`，precheck 与轮询循环检查 cancelled）；env 下发阻塞——需改 `mcp_client.cj` 属 DSH 范围，等 DSH 确认。

2026-10-21 CodeArts UI 修复批次 UI-FIX-2/3/4/5/6（未提交工作区、Windows，**纯渲染层，IPC 面不变 192/192，session/clear 链路 IPC 已由上行 Qoder 条目登记**）：①折叠重做（UI-FIX-2）：`msgfold.js` 阈值 240→600；`app.js` TextBubble 全文恒在 DOM（user 恒传全文、assistant 恒走 `SaCodeMarkdown.Body`），折叠改 CSS 视觉裁剪（`styles.css` folded 态 max-height+overflow+`::after` 渐变遮罩，底色 `--tr-bubble-box-bg`），折叠/复制按钮改 16×16 SVG 图标按钮（chevron/clipboard/check）+ tooltip；②z-index（UI-FIX-3）：`frame.css` `.turn-nav` 15、`.turn-nav-card` 16，高于 composer-seat(7)/error-bar(9)；③计划模式配色（UI-FIX-4）：`plan-review.css` 硬编码色全部替换为 CSS 变量（深浅两套）；④侧栏滚动条（UI-FIX-5）：`.sidebar-session-list` 细窄半透明自定义滚动条；⑤权限菜单（UI-FIX-6）：`pages/permission-menu.ts` 选项 disabled 仅看 busy，模式读取失败（current=null）仍可点选并触发 `approvalSetMode`。测试：permission-menu 15/15（1 用例重写为「读取失败仍可点选」）、msgfold 4/4、msg-copy 8/8、renderer-el-shape 2/2；`bridge.test.mjs` 全量 68 过/2 败（#21/#25 为其他会话 core 新工具 `project_init` 致 extension/list 多一项，非本批引入；IPC 集合门禁 #70 通过）。ui-smoke.cjs 折叠验收段已适配新判据（650 字、全文在 DOM 但视觉裁剪、aria-expanded），但 **Electron 实机冒烟在本工具环境不可运行**（electron.exe 从该 shell 启动携带受限 token：`ELECTRON_RUN_AS_NODE` 下 `fs.mkdir` 对 TEMP 与 `D:\tmp` 均 EPERM，powershell 可写同目录；无 `--no-sandbox` 时 `electron --version` 即 0x80000003）——GUI 端到端验收须在用户桌面环境执行。详见[接口索引](../interfaces/README.md)。未改 preload.cjs/main.cjs/main.cj/core，未构建候选、未提交/安装/发布。

2026-10-21 CodeArts UI-FIX-7 clear 命令 Electron UI 实机验收脚本（未提交工作区、Windows，**纯测试侧，零产品代码改动，IPC 面不变 192/192**）：新增 `apps/desktop/test/clear-ui-acceptance.test.mjs`（node:test 包装器）+ `apps/desktop/test-support/clear-acceptance-main-smoke.cjs`（两阶段冒烟：fill-and-clear / reopen-and-send，共用同一 `--session-dir` 模拟「清空 → 关闭重开 → 再发」），`test-support/ui-smoke.cjs` 加一行 `SACODE_UI_SMOKE_SUITE=clear-acceptance` 分发。链路全部真实：spawn 整个 `electron .` → main.cjs `--ui-smoke` → 真 BrowserWindow + 真 preload IPC + 真仓颉宿主 + 真 session.log；消息经 `#composer` input 事件 + `#send` click 真实发送（无模型配置是正常前提，`taskStart` 显式报错属预期口径，断言双信号=计数到位+`.error` 回执）；清空经输入 `/` 触发 slashTrigger 唤出命令菜单点「清空对话」卡片（真实 card onClick→emit('command')→`clearConversation()`）。断言口径与实现逐条对齐：种子 5 事件中消息面可见 2 条（system 被 `conversationMessages` 滤掉）→ 界面发 8 条凑满 10；清空后 `clearSessionHistory` 只保留 7 类基线事件（本夹具仅 `session/title` 1 条）、projection=0；重开阶段用 `proj.events>=1 && !!catalog` 双正向信号防「投影未加载时空 DOM」假绿。本代理环境 Electron 受限（探针 0x80000003）实测 `node --test test/clear-ui-acceptance.test.mjs` 输出 **SKIP env-blocked-electron（pass 0/fail 0/skipped 1，不计失败）**，须用户在已登录交互会话实跑；配套手动验收清单 `target/tmp/manual-verification-checklist.md`（自动化命令 + 7 步 GUI 走查 + 通过判据 + 失败取证）。**未执行**：Electron 实机点击验收（本环境门禁拦截，归用户桌面环境）、未改 preload.cjs/main.cjs/main.cj/core、未构建候选、未提交/安装/发布。

2026-10-21 CodeArts 前端 subagent 角色定义编辑器（未提交工作区、Windows）：按编排方案 §4.3 新增 `apps/desktop/renderer/pages/subagent-role-editor.ts`（+`subagent-role-editor.css`），导出 `SaCodeSubagentRoleEditor` 组件：4 内置预设 + 自定义角色列表，名称/描述/system prompt 编辑，工具集 8 项 checkbox（读/写/跑命令/浏览器/ssh/数据库/MCP/skill）、ACP 能力开关（外部 Agent 继承 subagent 权限边界提示，不含密钥）、模型选择（未知模型标注不可用）、预算设置、复制内置角色为自定义、CAS 修订号显示与 `role-conflict` 冲突态（放弃修改并重读）。注册走 `scripts/pack-pages.mjs` 折叠对 + `renderer/index.html` CSS/JS 标签；**未改 `preload.cjs`/`main.cjs`，IPC 通道与 Host RPC 契约未定义**（数据访问为页面 props 适配器模式，与 subagent-settings 同模式），后续接线须同步接口索引与 bridge 测试。验证：新增 `test/subagent-role-editor.test.mjs` 17/17（真实 Vue 响应式）；`pack-pages.mjs` 编译过且 bundle 守卫无 `import(`/`new Function`/裸 `vue`；定向回归 renderer-syntax/renderer-bundle-guard/page-sources-parse 及 index.html 依赖的 renderer-el-shape/worktree-render/worktree/team-panel-entry 共 39/39（不含新增 17 项）；`bridge.test.mjs` 66/67（1 失败为预存 #38 残留租用例，与本轮无关）。仅渲染层组件证据，不升级任何 F 域状态，不代表角色管理域真实任务或 GUI 验收通过。未构建新候选、未提交/安装/发布。

2026-10-19增量：[第一批交互证据](../evidence/2026-10-19-first-batch-interactions.md)。已补工具身份关联、取消工单收束、持久重命名/归档及结构化提问；Host12/12、仓颉定向7/7，元信息完整页面正常重启已验。选择卡片GUI与产品真实任务仍待验。历史读数不回写为当前整批通过。

2026-10-19 c4验收bug修复批次：[证据](../evidence/2026-10-19-c4-acceptance-bugfix.md)。修6项：①权限模式切换turn-in-flight友好提示（permission-menu.ts）；②流式消息折叠跳位（app.js TextBubble，live消息跳过foldPlan）；③工具结果卡复制按钮（tool-card.ts）；④重命名CAS冲突自动重读catalog再试（session-state.js+session-catalog.js）；⑤request-provider-failed携带已分类reason（request_trace.cj+turn-poll-state.js）；⑥shell执行通路诊断折叠（shlex.cj catch返回ShellResult而非None）+bash变体测试。桌面58/58通过。仓颉端request_trace_test.cj断言已更新，待构建验证。

2026-10-18 Codex追加更正：[R4运行时与流式修复](../evidence/2026-10-18-r4-runtime-and-stream-repair.md)。R4空窗口已实见；源码修复与诊断检查仅属局部证据。下方R4历史记录中的「render返回null会卸载组件」「extension/list即技能」「218失败统一环境归因」均不作为当前结论；工具调用关联、会话重命名/归档及AI选择卡片仍未完成。

2026-10-18 03:20 UX批次R4（用户十条反馈逐项落实）：`D:/tmp/sacode-delivery-R4-20261018/win-unpacked`，795文件/SHA `766bca1c…`，**包内Host与R2/R3逐字节相同**（`a01957e0…`），协议证据链不断；RPC冒烟（initialize/get-mode/tips/extension-list）RC=0。已修：①目标栏「设置目标无反应」=hideCreate 时组件整体卸载致 editRequest 无人接收，改休眠占位保持挂载；②流式正文卡补 `--tr-bubble-box-bg` 背景与圆角，与落库气泡同容器；③新增工具结果卡（ToolCard+msgfold.parseToolResult，解析 ok-read/ok-edit/ok/denied/cancelled/bad-args/通用，Windows 盘符路径按末段数字切，9 例单测全过），tool 行不再平铺原始文本；④＋菜单与斜杠命令改两列卡片网格；⑤技能清单接 `extension/list`（复用既有 toolsList 通道，**IPC 面不变**，parity 8/8）；⑥上下文 meter 补模型目录修订号订阅（修装载完成后不重渲的 staleness）；⑦侧栏会话加事件数元信息与右键菜单（复制 ID 真实可用）。**后端缺口（未接，界面诚实禁用/标注）**：会话重命名需 core「末条标题胜出」语义+新RPC（现 entry() 首条标题胜出，追加改名无效）；会话移除需删除语义与目录索引收尾；创建计划无 plan 后端；MCP 连接 plugin/registries 未接；模型容量因拉取规格 `ModelSpec(...,"","",false)` 无 contextWindow 且 GUI 无上游规格编辑入口。桌面测试：命中本轮改动的 msgfold/goal-bar/composer-menu 28/28 通过；全套 218 失败均为真实 Host 启动类集成测试（Host 在本环境 main.cj:3465 退出，与 renderer 改动零交集）。打包有一次 `Sandbox bypassed (escalation-approved)` 系统记录（非主动提权）。GUI 效果待用户双击 R4 复验。

2026-10-18 02:56 R3候选（权限菜单修复）：`D:/tmp/sacode-delivery-R3-20261018/win-unpacked`，795文件。仅改 renderer（权限模式四档配色区分与选中态、展开时current为null重试读取，提交`1a4c5b0`）；**包内Host与R2逐字节相同**（SHA256 `a01957e0…`），RPC握手（initialize/get-mode/set-mode/回读/host-settled）RC=0。故R2协议层证据对R3继续有效，无需重跑；GUI配色效果待用户双击复验，未安装/未发布。

2026-10-18 F01/F02/R2持久性增量：[实际冷启动证据](../evidence/2026-10-18-r2-cold-restart-persistence.md)。真实Host获批edit及外部单测后，PID36216退出0/非强杀，再起PID9528在同目录仅发只读RPC；40事件/8消息正文、分页事件、plan权限、工作区与请求追踪一致，文件保持a+b且单测继续通过，日志哈希不变，模型请求仍3次。`coldRestartVerified:true`来自本轮实际重启；前轮driver的false不改。GUI、crash恢复、真实供应商及产品受控测试仍待验，不升级整体交付状态。

2026-10-18 R2协议验收补记：[mock三路径证据](../evidence/2026-10-18-r2-three-path-protocol.md)。仅修测试驱动VM依赖与单次任务/修订号判据；allowed修改后外部测试0，denied/cancelled保持原文件和预期失败测试；三Host退出0且未强杀、pendingToolCalls=0。真实LongCat未运行，未验证冷启动回放、GUI或产品受控测试，不升级F02/F09或整体交付状态。

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
- 影响（已修正定性）：**本机有可用 GUI**（当前交互 SessionId=1、explorer.exe 运行、存在交互登录会话），且用户此前确认「双击旧候选可打开、父进程为 Explorer」。故 A3 不是机器缺 GUI，而是**在 WorkBuddy 沙箱（进程加载 tsbx.dll）内代跑时，Electron GPU 子进程初始化被阻断**。用户手动双击（沙箱外）不受此限；**GUI 验收应由用户手动双击完成，不由本会话代跑**。未关沙箱、未降防护，也未加 --disable-gpu-sandbox 类参数。协议层 PASS 不受影响。

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
| **F01** 项目与会话 | 已接通，局部验证 | 2026-10-19新增最后标题胜出、修订号/租约保护、追加式归档/恢复及真实更新时间；新Host协议与完整生产页面正常关闭重启回读/恢复通过（[第一批证据](../evidence/2026-10-19-first-batch-interactions.md)）。既有会话持久化修复历史仍见原证据 | 当前为未提交源码和内部诊断副本；完整同源候选、真实开发任务、安装态与跨平台未验，不升级为功能完成 |
| **F02** 自有 Agent 主循环 | 已接通，局部验证 | 2026-10-21 R8 [`subagent_delegate`](../../core/src/tool_subagent.cj) 可选绑定注册与审批/guard/父取消接缝已实现，私有目录core构建成功，[定向合成测试](../../core/src/subagent_delegate_test.cj)1/1通过（声明/未批准零执行/角色缺失/真实Runner合成摘要/执行中父取消）；后续R8-HOST已在Host两处装配注入：用户/项目角色合并为轮次快照，真实Host+回环模型测试3/3（批准摘要/拒绝零启动/项目覆盖用户）与同轮core兼容取消1/1通过，Host私有构建rc=0；CLI尚未注入，独立角色模型路由/真实供应商/子任务写审批及GUI待验，不升级完成状态；详见[对接登记](../integration/README.md)。2026-10-19标准工具ID关联及用户结构化提问已接原模型轮；合成供应商经真实Host回答后继续读取文件，拒绝/取消/失败与正常重启有12/12证据（[第一批记录](../evidence/2026-10-19-first-batch-interactions.md)）；必要工单取消收束已修 | 卡片完整GUI、真实供应商、产品内受控测试执行及同源交付仍待验；既有CLI/远程/执行缺口不据本轮局部通过解除 |
| **F03** 消息队列 | 前端局部验证，核心消费链待验 | 2026-10-20 r2原始send-queue-state TAP 21/21已核对，含sendBusy不静默丢弃、双消息/失败恢复/不提前释放busy及回读保护；证据 `target/tmp/frontend-regression-20261020-r2-023411/send-queue-state.tap.log`，本会话未重跑 | 纯状态层夹具不证明真实userSend→queueEnqueue→核心消费链的幂等/顺序；真实GUI连续发送、编辑/消费竞争与附件整体保存仍待验 |
| **F04** 持续目标 | 已接通，当前集成待验 | 既有goal六动词与RPC接线保留；Host idle驱动和GoalActivation源码见[方案](../plans/goal-execution-scheduling-design-2026-10-20.md)。r2 goal-bar TAP 7/7已核；现有编辑/CAS/迟到保护/展开保留。MonkeyCode只读记录 `target/tmp/goal-scheduling-audit-20261020-f04r2/FINDINGS.md` 已收并实读：按静态链限额从日志累计、输入仍在队列，未运行验证 | 验收前聚焦三项：cancel后自动再驱动、空闲预检满额未转blocked、最后一轮补充输入静默挂起；不能将挂起称数据丢失，亦不能为消费队列突破限额。当前编译主线不打断，MonkeyCode保持停写，后续共享Host窗口与Trae串行交接，不改goal-bar.ts或重写调度器。跨HostGoalRun计数/时序及GUI待测；goal-bar覆盖前原脏内容完整性仍未知，现有7项不覆盖disarmed/remaining |
| **F05** 输入快捷能力 | 部分完成 | 文件/技能/MCP/知识引用与 @ / 斜杠菜单代码存在；知识引用链已随 F11 接通（[knowledge-management-wiring](../evidence/2026-10-15-knowledge-management-wiring.md)） | review/compress/init 无完整执行接线；clear 仅清前端投影（10-09 审计 P1）；2026-10-21失效引用发送前检查已接入普通/补充发送：[`attachment-state.js`](../../apps/desktop/renderer/attachment-state.js) 逐级读工作区目录，缺失弹确认、取消保留草稿、确认仅剔除失效引用行；读取失败/部分列表/200项截断阻止发送，不伪判删除。[定向测试](../../apps/desktop/test/reference-send-guard.test.mjs)连同附件/发送队列35/35通过，JS语法与diff检查通过；真实GUI四场景仍待验收，发送前检查不保证检查后文件不会再变化 |
| **F06** 上下文与用量 | 已接通（部分修复） | 2026-10-21 新增 composer 上方左对齐 activity / usage pill，保留尾部 ContextMeter；[组件与适配](../../apps/desktop/renderer/pages/composer-stats.ts)、[定向测试](../../apps/desktop/test/composer-stats.test.mjs)覆盖缺值隐藏、四维累计与命中率、非模态关闭及会话迟到防护，相关回归20/20通过。当前 Host 缺性能三字段和累计 token 明细，activity 无数据隐藏，usage 仅总量可回退 usage/status.used、明细未知，不宣称真实完整统计链已验；容量/占用/累计用量与事后提示存在；零预算拒绝有证据；**请求侧预算已应用（D02 已闭合：超限不派发、`max_tokens` 较小值入请求、零预留）** | 2026-10-21 HOST-COMPACT-FIX：[`Host装配`](../../apps/host/src/main.cj) 注入真实安全探针（providerActive/awaitingApproval/awaitingPlan/awaitingQuestion），从绑定日志快照折叠未结算状态，叠加turnBusy/inflight；私有Host构建rc=0，[真实Host合成事件协议测试](../../apps/host/test/compact/compact-safety-host.test.mjs)1/1通过，含空闲/turn/pending工具/三类等待及实际compact-published产物节省输入。既有写租约前提未改，无租约仍compact-not-writer；真实供应商流中竞争与GUI未验，D03不据局部修复闭合；精确 tokenizer 未支持（字节守卫）、图片请求明确拒绝；「预算未知如实显示」未验收 |
| **F07** 模型中心 | 已接通 | Host模型中心凭据、发现、路由及真实HTTP结算/健康冷却见[既有证据](../evidence/2026-10-15-self-core-verification.md)；调用日志RPC和页面适配见[10-17记录](../evidence/2026-10-17-model-center-call-log.md)，不代替生产记录完整落盘与窗口验收。**D22部分修复**：桌面30秒等待、超时未知、不重发；Host新增默认20秒总预算、精确operationId查询/取消、提交前取消禁止迟到写入。核心16/16、真实Host与兼容集成16/16、桌面定向44/44；[本轮证据](../evidence/2026-10-17-model-pull-host-lifecycle.md)，[前轮历史](../evidence/2026-10-17-model-pull-timeout-followup.md)保留 | CLI装配不同源（D06）；变更发送对象的独立授权待验；D22未闭合：不可中断系统调用资源收束、提交故障/结果容量回收、桌面ID持有和查询/取消页面、同源正式打包及安装态；模型页面4组渲染失败待独立基线复核 |
| **F08** 代码、预览与 Git | 已接通（部分） | 编辑器恢复、Git 状态解析/迟到保护通过；新构建 Host 真实 Git 只读用例 16/16；安全 Git 目标查询（`46623c4`）、编辑保存后刷新差异（`4d06d64`）、执行审查与 Git 授权操作接入（`f0f3634`：stage/commit/push 提案＋路径/上游安全校验，拒绝强推与自动设 upstream）（[product-closure-goal](../plans/product-closure-goal-2026-10-15.md) 10-16 复验） ；2026-10-17任务差异有限写回：核心41/41、组件与真实Host/CLI17项，通过实际增删改和独立审批（[证据](../evidence/2026-10-17-review-apply-product-entries.md)） | 写操作以“提案＋执行授权”链接入（页面级）；真实写执行（push 拒绝/失败不显示已提交）待验收（设计见 [git-write-integration](../plans/2026-10-12-git-write-integration.md)）；默认 `dist` Host 仍旧载荷，重打包后需重跑真实用例 ；默认快照执行、完整Electron/安装态及Host在途停止仍待验 |
| **F09** 终端与验证 | 已接通（部分） | BuildTestPage 接线：tests 资源开放、报告判定含退出事实/EOF/计数一致（[build-test-page](../evidence/2026-10-15-build-test-page-and-cjpm-retry.md)） | 无真实 Host 构建/命令执行/桌面端到端验收（当前只证明页面与判定逻辑）；PTY resize/中断/退出码验收未见 |
| **F10** ACP 协作 | 已接通（部分） | OpenCode 诊断修复（[10-14](../evidence/2026-10-14-acp-opencode-readiness.md)）；委派面板与精确审批操作（`7e34b68`/`be03bda`）、持久委派记录双入口与工作台（`c3d1ce3`）；CodeBuddy 独立配置 initialize/sessionNew/持久诊断通过、Node 默认 hy3 成功、假提供方链路（[takeover](../evidence/2026-10-15-codebuddy-acp-takeover.md)） | 默认用户配置原生 session/new -32603（D09）；Electron 正常模式不可启动（D10）阻塞真实窗口验收；真实 session/prompt 未授权 |
| **F11** 知识、记忆与个人记录 | 部分接通，继续验收 | core KnowledgeStore + Host 5 RPC + CLI 5 命令 + 页面接通（`50d7e50`）＋Electron bridge（`97ddad1`）。2026-10-17 当前工作区重编：核心 5/5、CLI 跨轮集成 1/1、Host 自动检索 1/1、Host 管理/显式引用 2/2、Electron 页面 1/1；验证来源失效、无正文审计，并更正页面模型发送说明（[当前页面与 Host 复验](../evidence/2026-10-15-knowledge-management-wiring.md)、[核心/CLI §11](../evidence/2026-10-17-cli-launch-0xc0000135-stdx-dll-missing.md)） | 未提交快照；Electron 为隔离夹具，完整桌面外壳/默认安全启动、损坏日志回放、安装态、源码/符号索引与检索效果对照未验；记忆/速记/批注未收口 |
| **F12** 扩展管理 | 已接通（部分），技能工具局部验证 | 扩展市场方案落地（[extension-market](../plans/sacode-extension-market-2026-10-11.md)）；本地Agent预设（[local-agent-presets](../plans/sacode-local-agent-presets-2026-10-11.md)）；既有市场/预设页面与IPC、extjs帧校验和扩展路径加固（`63d9f33`）保留。2026-10-20技能provider/解析源码及18项测试声明存在但未运行；25个兼容场景已核实际文件、27份输入，矩阵明确只列预期，不是通过证据 | 2026-10-21 SK-F核心私有构建已成功（35警告无错误），新增唯一[`skill_load`](../../core/src/tool_skill.cj)按需返回正文，复用已装配仓；[定向测试](../../core/src/tool_skill_test.cj)2/2通过（schema/唯一入口/存在与缺失/四档免审批/禁模型调用/guard/默认文件系统读取）。历史技能编译阻塞已被本轮构建覆盖，但18项及兼容矩阵未据此宣告全过；读取预算/异常、祖先链接检查、用户层隔离仍须各自证据。userInvocable与真实Host模型回合/GUI未验；Host技能RPC及IPC/UI第3/4段未据本轮放行，不能用extension/list代替技能。扩展完整生命周期未验；MCP运行仍同D04 |
| **F13** 自动化与 Hooks | 已接通（部分） | 定义保存/CRUD/CAS/重启（UTC）通过；自动化页面接通（`50d7e50`）；RPC `list/save/control` 补齐声明（Host 169 条）；628 个 zoneinfo 随包 + `CJ_TZPATH` 修复命名时区（[automation-product-wiring](../plans/automation-product-wiring-2026-10-15.md)、[gate-triad-repair](../evidence/2026-10-16-gate-triad-repair.md)） | 执行器未实现（D07，`executorAvailable=false`）；从未触发过自动化任务；Hooks 磁盘配置加载未闭环 |
| **F14** 浏览器与电脑操控 | 已接通（部分） | 2026-10-21 网页工具消息内联卡片局部验证：[`msgfold.js`](../../apps/desktop/renderer/msgfold.js) 新增 web-fetch/web-search 分支，严格外部标记、来源/HTTP/查询与来源列表、Unicode 500字预览及不可信提示；[`tool-card.ts`](../../apps/desktop/renderer/pages/tool-card.ts) 展示及中文名已接，解析/渲染/复制相关29/29通过，页面构建与静态CSP门禁通过，真实模型/GUI未验。**页面工具经核心授权与会话绑定执行（`fbae797`，10-14）**：核心 `page_tool.cj` 4 工具规格（click/input/scroll 一次性审批）＋`page_tool_channel.cj`、Host `page_tool_rpc.cj`（attach/poll/claim/result）、桌面桥接会话＋窗口绑定 | 页面工具授权修复待运行读数（D05）；2026-10-21 新增 [`WebRpc`](../../apps/host/src/web_rpc.cj) 的 `web/fetch` / `web/search` 薄适配，参数/回执见[接口登记](../interfaces/README.md)，未修改 main 或公开能力，Host 分派仍待接线（D08 不闭合）；跨域/凭据隔离未验收 |
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
| **D04** | MCP 真实 stdio 客户端源码存在，但无生产模型工具桥；schema/参数构造/逐调用授权/有界关闭为接入前缺口 | 2026-10-21 MCP-E：[`mcp_client.cj`](../../core/src/mcp_client.cj) 新增重连 supervisor（`McpReconnectPolicy` 驱动）与 spawn 前环境净化（KEY/PASSWORD/SECRET/TOKEN/SACODE_* 值替换 `<redacted>`，记 `mcp/env-scrub` 只记键名）。close() 不重连；异常崩溃按指数退避重连，maxAttempts 后返回 `mcp-reconnect-exhausted`；重连期间 `isConnected()` 为 false。私有 core 构建 rc=0（35 警告无错误），[定向测试](../../core/src/mcp_client_test.cj) 15/15 通过（含 4 项新增：env 净化、崩溃后重连、close 不重连、重连耗尽）。后续MCP-E-2支持显式env在净化后覆盖、同名mcp/server事件读取maxAttempts/baseDelayMs（显式策略优先，旧事件默认10次/500ms，非法回退）；隔离副本core构建rc=0，[新增2项](../../core/src/mcp_env_policy_test.cj)+既有15项共17/17通过。更正边界：既有重连为请求传输失败触发，不是空闲主动退出监视。生产模型工具桥仍待接，不升级为已接通 | [self-core-verification](../evidence/2026-10-15-self-core-verification.md) 收口表 4 |
| **D05** | 页面工具授权缺口：`main.cjs:810–823` 页面 handler 直接执行，未走核心审批/守卫/结算（10-13 审计曾升 P0："公开载荷更新前仍列 P0"） | **修复已实施（2026-10-14 `fbae797`）**：页面链改经核心队列（`page/tool/attach\|poll\|claim\|result`＋会话/窗口绑定＋64KiB 结果上限），核心新增 `page_tool.cj`/`page_tool_channel.cj`（click/input/scroll 一次性审批），随提交含真实 Host 用例；**待独立运行读数与载荷重打复验** | [preflight-source-audit](../plans/sacode-2026-10-11-preflight-source-audit.md)、[full-wiring-audit](../evidence/2026-10-13-full-wiring-audit.md) 第 32 轮 |
| **D06** | CLI 与模型中心装配不同源：普通会话无工具 schema；CLI 环境配置独立于模型中心 | 统一共享装配与支持边界，不另写 Agent 循环；未修复 | [self-core-verification](../evidence/2026-10-15-self-core-verification.md) 收口表 1 |
| **D07** | 自动化执行器未实现：`executorAvailable=false`；RPC 已宣告只代表可调用 | 不制造成功历史；执行器/火次准入/去重未实现 | [gate-triad-repair](../evidence/2026-10-16-gate-triad-repair.md) |
| **D08** | `ssh_exec.cj` / `web_exec.cj` / `voice_exec.cj` 三个执行层孤立未接 Host 分派 | PRD §8 已登记；F15/F18/F14 受此阻塞 | [PRD.md](PRD.md) §8 |
| **D09** | CodeBuddy 默认用户配置原生 `session/new` 返回 -32603（可复现） | 实测 Low/Medium 后代完整性标签差异与 Node/原生启动路径差异为线索；**不得等同认证错误**；不得读密钥/改默认配置/关隔离来"修"；修复未开始 | [stage2](../evidence/2026-10-15-codebuddy-acp-stage2.md)、[takeover](../evidence/2026-10-15-codebuddy-acp-takeover.md) 第 8–9 轮 |
| **D10** | Electron 默认安全启动 `0x80000003`（STATUS_BREAKPOINT）：正常模式 smoke 与最小脚本均无诊断输出 | **根因已定位（2026-10-16 复核）：构建产物继承仓库根 Low Mandatory Level 标签（可继承 OI/CI）→ 主进程低完整性 → 沙箱创建匿名窗口站被拒（Win32 5）→ STATUS_BREAKPOINT**；Low 标签只在本仓库根（上级目录/用户目录均无）；修复路径＝交付位置中性导出（`scripts/export-windows-artifact.mjs`，10-08 同字节产物 SMOKE PASS，本轮中性副本**默认沙箱与 `--no-sandbox` 均全链路 SMOKE PASS**）。（前轮排除项保留：缺 `S-1-15-2-2` RX ACE 解释已排除并复原、WER/Code Integrity 无事件。）**未完成**：重打包、交付流程固化、真实双击通道复验（agent 通道取证含 GPU 崩溃噪音，最终验收以真实双击为准）；`--no-sandbox` 仍仅作诊断、不得作默认。阻塞：桌面验收、ACP 真实窗口、安装态 | [三问题排查](../evidence/2026-10-16-windows-startup-three-issues-diagnosis.md) §2、[low-integrity 10-08](../evidence/windows-low-integrity-delivery-fix-2026-10-08.md)、[stage2](../evidence/2026-10-15-codebuddy-acp-stage2.md) 第 4 轮 |
| **D18** | NSIS 安装器临时文件错误：`Error writing temporary file. Make sure your temp folder is valid.`（用户截图 10-11） | **根因已定位（2026-10-16 探针实证）：安装器继承 Low 标签 → 启动器解压自身到默认 `%TEMP%`（Medium）被 MIC no-write-up 拒绝**；最小 NSIS 探针三格对照（中性成功 / 仓库内失败 / 中性写 Low 目录成功）。修复路径＝重打安装器 + 中性导出 + 双击复验；当前无安装器产物 | [三问题排查](../evidence/2026-10-16-windows-startup-three-issues-diagnosis.md) §4、[takeover](../evidence/2026-10-11-takeover-regression-and-plugin-delivery.md) §9.9–9.13 |
| **D19** | 分发载荷 runtime DLL 未同步修正版：`npm/sacode-cli-win32-x64/bin`（`ca65f2b8…`）与 `dist/electron/project-picker-final-20261012` 宿主（`ca65f2b8…`）仍带哨兵误读旧版（`ReadWinModuleAtInit`）；10-16 win-unpacked 候选宿主已是修正版（`8b1d0783…`）并通过 Host smoke | 重打 npm 平台包（`scripts/pack-cli-windows.mjs` 工作区已修复并经 A/B 验证，见 §3 证据）后同步替换；**重打前不得对外分发 CLI 包与 dist 目录版** | [三问题排查](../evidence/2026-10-16-windows-startup-three-issues-diagnosis.md) §3 |
| **D22** | 模型发现走桥5秒误超时、后台迟到写入；初轮曾用全局revision猜成功（该判据已撤回） | **部分修复、未闭合（2026-10-18未知核对增量）**：Host20秒网络预算、提交前取消禁止迟到写库沿10-17实测；桌面先持有ID再拉取，精确查询/可见取消；查询失败与原操作/已收束事实分列，目录涨修订不解锁，unknown/提交未知/未收束持续提示且不重发。最新定向63/63、集合桥接2/2、中性默认沙箱Electron/Host2/2，IPC149/149。**未完成**：跨renderer重启持久恢复、未知人工核对后的解除策略、DNS不可中断收束、提交磁盘故障/结果容量回收、同源正式重打包及完整应用安装态；四组旧页面只读文案断言失败保留 | [初轮历史](../evidence/2026-10-17-model-pull-timeout-fix.md)、[复核](../evidence/2026-10-17-model-pull-timeout-followup.md)、[Host](../evidence/2026-10-17-model-pull-host-lifecycle.md)、[桌面](../evidence/2026-10-18-model-pull-desktop-lifecycle.md)、[未知核对新证据](../evidence/2026-10-18-model-pull-unknown-verification.md)与[契约](../interfaces/model-pull-lifecycle-2026-10-17.md) |
| **D23** | DeepSeek 思考模式 `reasoning_content` 链路缺口：SSE 增量解析不处理 `delta.reasoning_content`；Agent 保存阶段不保存思考字段；请求重建靠透传无法补齐 | **核心修复已实施、局部隔离验证，真实供应商及候选待验（2026-10-21 DSH）**。保留历史：原SSE只处理content/tool_calls，Agent不保存思考字段，请求透传无法补齐。现SSE独立reasoning增量，Agent普通回答与工具调用均保存reasoning_content，请求重建校验并回传，正文不混思考；旧日志不补造字段。隔离core构建rc=0（35警告），新增及Agent/请求/附件回归25/25；SSE全文件23通过/1跳过/9网络夹具临时目录EPERM错误，不记全套通过。[本轮证据](../evidence/2026-10-21-d23-reasoning-content.md)。未改Host/前端，未发真实DeepSeek请求；统一候选思考模式+工具调用验收仍待，不据单测宣称缺陷全量闭合。原不阻断当前候选口径保留 | 调研报告 2026-10-21；官方协议 https://api-docs.deepseek.com/guides/thinking_mode |
| **D24** | 多供应商 failover 六项缺陷（OpenCode Q1-B 隔离副本 probe 发现，2026-10-21）：①首次 429 不立即降级——`route_health.cj:84` coolingThreshold=3，需累计 3 次 effective 失败才冷却，Retry-After 只在进入冷却后生效；②连接超时不触发候选切换——`model_router.cj:212-215` route 只查 upstream+credentialRef，不查 channel 作用域；③首个 Provider 失败直接结束本轮——`model_agent.cj:112-118` nextProvider 只在工具步成功后调用，provider.next() 抛出的失败被外层 catch 收束为 error:...；④双候选冷却拒绝不保留 TransportFailure——`model_router.cj:106-113` RouteRejection 只有 code/detail；⑤降级无跨轮粘滞状态——`main.cj:2602-2606` 宿主每步重新路由，窗口结束后首选恢复；⑥Retry-After:0 被当未提供——`route_health.cj:135` 用 `> 0` 判断 | **核心修复已实施、隔离验证通过（2026-10-21 OpenCode Q1-C）**。六项缺陷已修：①`route_health.cj:157` 429 带 Retry-After 首次即冷却（`retryAfterSeconds >= 0` 含 0）；②`model_router.cj:223-229` route 查三档作用域（upstream + credentialRef + channel/transport）；③`model_agent.cj:83-94` TransportFailureException 捕获后零增量时调 `nextProvider(stepRequest)` 换候选，上限 8 次防死循环；④`model_router.cj:114` RouteRejection 新增 `failure: Option<TransportFailure>`；⑤route_health 跨轮持久化；⑥`route_health.cj:174` 用 `>= 0` 判断。隔离 core `cjpm test` **84 PASSED / 1 SKIPPED / 0 FAILED**（跳过项为缺真实供应商 key 的 SSE 集成用例）。隔离快照四入口构建均 rc=0（core/CLI/Host/daemon）。**不阻断当前候选**：单供应商场景不受影响。OpenCode 隔离快照证据 `target/tmp/cb3b-snapshot-20261021-232240/`，正式测试文件 `core/src/model_agent_failover_test.cj` 已入库。台账原写"未修复"系 OpenCode 未同批更新，现已更正 | OpenCode Q1-C 回报 2026-10-21；测试文件 `core/src/model_agent_failover_test.cj`；隔离快照 `target/tmp/cb3b-snapshot-20261021-232240/` |

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
| 桌面 IPC 顶层 key | **198**（10-21未提交工作区结构解析；10-18基线149 → 10-21 Qoder 阶段192 → CatPaw CP-1 新增6条MCP通道→198；原始 `grep -cE '^  [A-Za-z0-9_]+:'` 读数202含4个嵌套键，不作分母） | 10-21工作区；不是已提交/安装态通过 | `node scripts/check_ipc_surface_parity.cjs`（GATE 198/198） |
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

2026-10-20 模型 shell/EX-01 诊断折叠：[io-error:shell-pwsh 修复](../evidence/2026-10-20-model-shell-io-error-diagnosis-and-windows-wiring.md)：`ShellExecutor` 不再把 confine 异常吞成 None，真实 Host 回执由裸 `io-error:shell-pwsh` 变为 `io-error:shell-pwsh:SANDBOX_UNAVAILABLE`；根因确认为 Windows 默认 `platformSandbox` 无 provider。既有 AppContainer 私有通路已接入模型 shell（仅 `SACODE_WINDOWS_ENFORCING`+原生 DLL 时启用，默认 fail-closed，未改 ACL/未关沙箱）；enforcing 下命令真实启动并观测真实退出码，但 AppContainer 内 PowerShell 与工作区 ACL 未完成，`node --test` 未取得通过结算。D14 与默认 Windows 执行门禁保持不解除；不声称"读取→审批→修改→运行测试→通过结算"已走通。

2026-10-21 CodeBuddy CB-3-A D14 原生层 token 构造修复尝试（未提交工作区，代码完全还原）：基线复现 `verify-windows-process.c` 17 项/失败 1（`real-exit-code`），与 10-20 记录一致。独立诊断程序确认根因：子进程 token `isAppContainer=1`、14 个组、**缺 S-1-15-2-1（ALL APPLICATION PACKAGES）**、无任何 `S-1-15-3-*` 能力组，cmd 退出 1。已尝试方案：①`CapabilityCount=1`+registryRead 能力→能力进 token（72 字节）但组不变，仍失败；②直接注入 S-1-15-2-1→TokenGroups 只读不可行；③不同 profile 包标识→不改变 LPAC 判定；④`ALL_APPLICATION_PACKAGES_POLICY`→SDK 只有 `OPT_OUT=0x01`（WinBase.h:3981-3984）无 opt-in；⑤`CreateAppContainerToken`→kernelbase 导出存在但无公开头/签名，属未文档化 ABI。全部撤回，`git diff` 为空，代码与基线逐字节一致。**结论：原生层修复在当前文档化 API 下无法达成**。产品侧容错建议（未实现，需批准）：原生 create 时枚举 token 组，缺 S-1-15-2-1 就返回专用错误码，adapter 映射为 `appcontainer-init-failed:token-missing-all-application-packages`，对外报 `SANDBOX_INIT_FAILED`。证据 `target/tmp/d14-token-20261021-a1/`（baseline.log、r2.log、diag.c/diag.log、probe.c）。D14 不解除，默认 Windows 执行门禁保持不解除。

2026-10-21 CodeBuddy CB-3-B SANDBOX_INIT_FAILED 容错（未提交工作区）：按批准实施产品侧错误分类。`core/native/windows_process.c`：原有 token 校验后新增 `token_has_group()`（枚举 `TokenGroups` + `EqualSid` 比对，不使用 `CheckTokenMembership` 因对主令牌返回 1309），检测子进程 token 是否含 `S-1-15-2-1`（ALL APPLICATION PACKAGES）；缺失则返回 `ERROR_NOT_SUPPORTED(50)`，走既有终止/清理路径，不 resume、不返回可用进程。`core/native/windows_process.h`：同步声明。`core/src/windows_process_adapter.cj`：`appContainerFailureCategory` 新增 `windows-process-create:50 → SANDBOX_INIT_FAILED:token-missing-all-application-packages` 映射。`core/src/shlex_test.cj`：新增 1 条断言验证映射。验证：原生验证器 `create-error=50`、拒绝创建、cleanup confirmed（行为变化：基线 17/1 失败在 `real-exit-code`（子进程 exit 1），现按设计拒绝创建）；core `cjpm build` exit 0；`shlex_test.cj` 编译 0 错误。**效果边界**：修复的是错误分类，不是执行能力——26H2 下 AppContainer 仍不可用，命令仍无法执行；没有降级，失败即终止。Host 未重建（本轮只改 core+原生 DLL，无接口变化）。证据 `target/tmp/d14-token-20261021-a1/`（sanit2.log、core-build.log、shlex-check.log）。

2026-10-21 Qoder Q3-A dist 宿主重打验收（未提交工作区、Windows）：dist 宿主被 PID 38136（18:12:54 启动）锁定（`open(…/sacode-host.exe,'r+')` 实测 EBUSY），未对 dist 执行重打（`pack-host.mjs` 会先整目录 `rmSync`，锁定时删成半残）。按预案改打私有目录 `target/tmp/q3a-host-repack-20261021/host/bin`，92 个文件（含 OpenSSL 3、libwinpthread、zoneinfo），exe 15,989,760 B、sha256 `0cc4c7f5…`，与 `apps/host/target/release/bin/main.exe`（23:05:02 构建，稳定复核 4 秒无变化）逐字节一致。独立壳副本（appRoot 指向副本、hostExePath 解析到私有新宿主）跑同一 `protocol-smoke.cjs`：**SMOKE PASS**、RC=0、7 条 SMOKE 行；durability 屏障通过、未知方法 -32601、stop forced=false code=0。归档基线用例 1/1（`SACODE_HOST` 指向私有包）、clear 端到端 8/8 步全 ok。旧 dist 的 smoke 亦 PASS 作为对照（但加载的是 17:56 旧宿主，非重打证据）。**新宿主 capabilities 比旧 dist 多了 `mcp/*` 与 `skill/*` 一组方法**，这是运行期证据，证明 smoke 加载的是 23:05 新构建。未终止 PID 38136、未替换 dist、未改源码。我方 smoke 残留的 Electron GPU/NetworkService 子进程已核实退出。dist 解锁后的收尾命令：关闭 PID 38136 → `node scripts/pack-host.mjs apps/host/target/release/bin/main.exe apps/desktop/dist/host <stdx-dll-dir> <runtime-dll-dir>` → `cd apps/desktop && npm run smoke -- --no-sandbox`。smoke 日志保留在 `target/tmp/q3a-host-repack-20261021/smoke-new.log`。

2026-10-21 CatPaw CP-1 MCP 桌面 IPC 接入（未提交工作区、Windows）：`preload.cjs` 新增 `ipcMcpName` 校验器（`[A-Za-z0-9_.-]{1,128}`，与 Host `mcp_rpc.cj` 字节白名单一致）+ 6 个顶层 key（`mcpList`/`mcpConnect`/`mcpDisconnect`/`mcpTools`/`mcpCall`/`mcpStatus`）；`main.cjs` 新增 `domainMcpName` 校验器 + `MCP_DEFAULT_TIMEOUT=15000` + 6 个 `ipcMain.handle`，安全约束：`mcpConnect`/`mcpCall` 双重校验 `approvalId`，`mcpCall` 的 `argumentsJson` 主进程侧 `JSON.parse` 验证为 JSON 对象（非法/数组拒绝，只报 `mcp-bad-arguments`），主进程负责打包扁平参数为 Host 期望的嵌套 `args` JSON 字符串。`bridge.test.mjs` 新增 10 个 MCP 专用测试（mcpList 只传 sessionId、mcpConnect/mcpCall 缺 approvalId 拒绝、mcpDisconnect/mcpTools/mcpStatus 只传 sessionId+name、mcpCall 非法 JSON 拒绝、mcpConnect 参数打包、mcpTools 补默认 timeoutMs、原样转发、主进程拒绝多余字段、preload 名字校验）。IPC 顶层 key **198**（202 grep - 4 嵌套键），GATE 198/198 PASS。`node --test --test-name-pattern="MCP" test/bridge.test.mjs` **10/10 pass**。未改 core/Host/前端渲染层，未提交推送安装发布。

2026-10-21 OpenCode Q1-C D24 failover 六项缺陷修复 + CodeBuddy 隔离快照构建（未提交工作区、隔离快照）：D24 六项缺陷全部修复：①`route_health.cj:157` 429 带 Retry-After 首次即冷却（`retryAfterSeconds >= 0` 含 0）；②`model_router.cj:223-229` route 查三档作用域（upstream + credentialRef + channel/transport）；③`model_agent.cj:83-94` TransportFailureException 捕获后零增量时调 `nextProvider(stepRequest)` 换候选，上限 8 次防死循环；④`model_router.cj:114` RouteRejection 新增 `failure: Option<TransportFailure>`；⑤route_health 跨轮持久化；⑥`route_health.cj:174` 用 `>= 0` 判断。隔离 core `cjpm test` **84 PASSED / 1 SKIPPED / 0 FAILED**。隔离快照 `target/tmp/cb3b-snapshot-20261021-232240/`（源清单 SHA256 984E3ECC…），四入口构建均 rc=0：core(libcore.a 10,683,006 B sha 7E8C581F…)、CLI(main.exe 14,497,792 B sha 857C462C…)、Host(main.exe 16,007,680 B sha 7D77AAE3…)、daemon(main.exe 14,602,240 B sha DD20FDFD…)。快照不含 23:39 后 D23 reasoning_content 改动。台账原写"未修复"系 OpenCode 未同批更新，已更正。

2026-10-21 MonkeyCode SK-F 技能 provider 端到端验证（未提交工作区、隔离临时目录）：无源码修改，纯验证任务。9 个集成测试写在隔离临时目录。完整端到端链路验证通过：合成 SKILL.md → `FilesystemSkillProvider` 扫描四层目录发现 → `SkillRegistry.getSkill()` 返回 `SkillDefinition` → `ModelToolRuntime` 构造时注册 `skill_load` 工具（`ToolSpec` schema）→ `specs()` 输出含 `skill_load` + 结构化 schema → 模型调用 → `SkillLoadTool.execute()` → `SkillRegistry.getSkill()` 读取正文 → 返回 content。9/9 新增测试通过（全链路返回正文、schema 结构化、`modelInvocable=false` 阻止、`userInvocable=false` 不阻止模型、不存在返回 `skill-not-found`、project-native 覆盖 project-agents、多技能同时可加载、坏参数拒绝、listSummaries 包含合成技能）。既有技能测试 10/10 也通过（共 19/19 skill 相关 PASS）。Host/CLI 已接入：`skill_rpc.cj` 实现 `skill/list`+`skill/get`，`main.cj:1665` 构造 `ModelToolRuntime` 不传 `skillRegistry` 但 `ToolRuntime.skillRegistry` 自动配置 `FilesystemSkillProvider`。预先存在失败（与 SK-F 无关）：`modelRunnerUsesInjectedRegistry...` 硬编码 17 过时（DSH LSP 工具扩展后工具数变化）、`sseNetwork*` 需真实服务器。

2026-10-21 DSH D23 reasoning_content 链路修复（未提交工作区、隔离验证）：`core/src/sse.cj` 解析 `delta.reasoning_content` 产出独立 `reasoning` 增量（不混入 `content`）；`core/src/model_agent.cj` 按单次请求拼接思考正文，普通回答和工具调用消息均保存 `reasoning_content`；`core/src/model_request.cj` 校验历史思考字段为字符串并在重建请求时保留回传；新增 `core/src/reasoning_content_test.cj`。旧消息不补造思考字段，`TurnResult.text` 不包含思考正文。隔离 core 构建 rc=0（35 警告），新增及 Agent/请求/附件回归 **25/25 通过**。SSE 全文件 23 通过/1 跳过/9 网络夹具 EPERM 错误（隔离环境限制）。未改 Host/前端，未发真实 DeepSeek 请求。[本轮证据](../evidence/2026-10-21-d23-reasoning-content.md)。统一候选思考模式+工具调用验收仍待，不据单测宣称缺陷全量闭合。

2026-10-21 Trae MCP-ALL Host env 透传+inputSchema+重连策略集成验证（未提交工作区、隔离副本 `D:/tmp/sacode-mcp-all-20261021-f49c82`）：`apps/host/src/mcp_rpc.cj` `mcp/connect` 接受内层原始 `args` 中可选 `env:[{key,value}]`，校验后传给 `McpClient(env:)`，env 仍受原始参数逐字审批保护（修改 env 后原审批票失效）；修复 `mcp/tools` 漏返回 `inputSchema`，JSON 值透传，缺失时兜底 `{"type":"object"}`。新增测试 `apps/host/test/mcp/env-host.test.mjs`、`core/src/mcp_config_test.cj`。隔离副本单成员 Host 构建 rc=0，Host 5/5（env 透传、净化后覆盖、非法输入拒绝、审批防篡改、Schema 透传）+配置 5/5+core env 与事件重连策略 2/2，共 **12/12 通过**，0 失败/错误/跳过。**剩余边界**：`McpConfigLoader.load(path, registry)` 已验证可读文件并注册但尚未接入生产入口自动加载；未运行全量 core、工具桥专用回归、取消回归或桌面 GUI/安装态验收。未改 preload/前端。

2026-10-21 CodeArts UI-FIX-7 clear 命令 Electron UI 实机验收脚本（未提交工作区、Windows，**纯测试侧，零产品代码改动，IPC 面不变 198/198**）：新增 `apps/desktop/test/clear-ui-acceptance.test.mjs`（node:test 包装器）+ `apps/desktop/test-support/clear-acceptance-main-smoke.cjs`（两阶段冒烟：fill-and-clear / reopen-and-send，共用同一 `--session-dir` 模拟「清空 → 关闭重开 → 再发」），`test-support/ui-smoke.cjs` 加一行 `SACODE_UI_SMOKE_SUITE=clear-acceptance` 分发。链路全部真实：spawn 整个 `electron .` → main.cjs `--ui-smoke` → 真 BrowserWindow + 真 preload IPC + 真仓颉宿主 + 真 session.log。本代理环境 Electron 受限（探针 0x80000003）实测 `node --test test/clear-ui-acceptance.test.mjs` 输出 **SKIP env-blocked-electron（pass 0/fail 0/skipped 1，不计失败）**，须用户在已登录交互会话实跑；配套手动验收清单 `target/tmp/manual-verification-checklist.md`。未改 preload.cjs/main.cjs/main.cj/core，未构建候选、未提交/安装/发布。

2026-10-20 EX-01/AppContainer 根因：[AppContainer exit 1 诊断](../evidence/2026-10-20-appcontainer-exit1-root-cause.md)：`cmd`/`powershell`/`hostname`/最小静态 exe 在 AppContainer 内全部 exit 1、stdout/stderr 空；普通进程同管道/环境 exit 0；子进程 token `caps=0`、无 `S-1-15-2-1`（LPAC 形态），且项目原始 `verify-windows-process.c` 在本机重编译后 `FAIL real-exit-code`（10-17 记录为 35 项全过）。结论：失败在 AppContainer 进程初始化阶段，非 PowerShell 参数（`-NoProfile` 已在）、非工作区 ACL、非本轮 shell 源码；修复需改原生层 token 构造，属单独授权项。未改 ACL/产品源码；D14 与默认 Windows 执行门禁继续保持不解除。
