# 全功能接线审计：首轮证据清单

日期：2026-10-13。固定提交：`b4a095cb51c10b6f8e2cf72213e2bacdad13238c`。产品仓库 D:/Project/sa/saai/sa-code，refactor/dsh-learning。

范围按当前 PRD F01–F21；包含核心 → Host/CLI → IPC → 页面 → 真实提供方 → 当前产物。下表为首轮源码证据与定向已有宿主探针，未核字段明确保留，不声称全域验收结束，也不按域数量计算完成率。未提交实现由同名 hashes.json 记录工作区哈希与状态，不吸收其他会话改动。

|需求|能力|当前裁决|已核线索|缺口与下一步|
|---|---|---|---|---|
|F01|项目会话|部分接通|catalog/session/workspace 核心；Host 会话/工作区接口；app.js 消费|CLI 用户动作、目录恢复、归档和最新产物需逐项复验|
|F02|Agent 执行|部分接通／提供方阻塞|model_agent/agent/execution_*；Host task/start 和执行六动作；CLI job；桌面 execution-task|execution_api.cj 状态 providerAvailable=false；公开提供方开放、隔离监督与恢复验收|
|F03|队列|部分接通|inbox/attach；queue 三动作；queue-dock/app|排序消费、编辑竞态与恢复的当前双入口证据|
|F04|目标|部分接通|goal_runner/claim/evidence；goal 控制 RPC；goal-bar；CLI goal|真实轮次 claim+evidence 自动完成与恢复产物验收|
|F05|快捷引用|部分接通|cmds/skill/xref/attach；附件接口和 composer 页面|命令技能 MCP 搜索选择到实际调用及修订引用|
|F06|压缩用量|部分接通／压缩缺实现|meter/ledger 与 usage/ledger 接口；compact.cj 仅 CompactionLedger 事件记录|真实摘要生成与上下文原子替换、在途工具保护|
|F07|模型中心|配置CRUD主窗口链已验证；全域仍部分接通|供应商实例添加、自定义表单、编辑/删除、凭据独立重试、默认选择；真实Host与完整主窗口定向证据见§54–56|费用/路由/全部协议真实提供方、模型实际调用、统一固定源码产物与默认安全启动仍待验；不把配置成功等同模型可用|
|F08|编辑 Git|部分接通|fs_tools/git_workbench；workspace/files/git-status/git-diff；文件编辑页面|显式暂存/提交/推送授权入口与真实差异、冲突验收|
|F09|终端验证|部分接通／提供方阻塞|执行监督输出核心；Host/CLI 执行动作；terminal-output/execution-task|公开执行提供方、PTY、真实报告；退出 0 不等于测试通过|
|F10|ACP|缺公开入口|acp 核心八组契约/进程/委派/审批/门控/设置/权重/探测文件|当前 Host/CLI/preload 定向检索未见 ACP 分派；持久事实与真实外部委派|
|F11|知识记忆|缺管理入口|知识页面目前只保留内存草稿、保存禁用；既有引用不等于知识索引|权威存储、用户/项目索引失效、检索进入模型|
|F12|扩展|部分接通|plugin 核心、Host 有限接口、插件管理页|市场提供方、完整贡献撤销和在途卸载；真实生命周期需当前快照复验|
|F13|自动化 Hooks|缺产品管理入口|schedule/workflow/webhook 核心候选；自动化页面保存禁用|持久管理、调度启动、错过策略、执行授权和恢复|
|F14|浏览器电脑|部分接通／待核装配|bu_exec/cu_exec/web_exec 驱动候选|产品驱动装配、租约权限、真实控制与紧急停止|
|F15|SSH 部署|部分接通／缺连接管理|ssh_exec/ssh 核心候选；连接页面测试按钮禁用|主机指纹、凭据、远程未知状态、独立部署授权|
|F16|数据库|缺入口／驱动待核|数据库连接表单存在但测试与保存禁用|结构化驱动、只读事务与写授权；不能以页面存在宣称支持|
|F17|安全扫描|待核／缺产品证据|三层扫描需求存在；本轮未证实真实扫描调用链|全目录定位实际实现、分别探测三层结果及修复版本保护|
|F18|语音增强|部分接通|prompt_enhance/voice_exec；增强 RPC/页面|真实 ASR 提供方、撤销与迟到回执当前快照复验|
|F19|数据导入|部分接通／范围不足|migration_pack 与模型配置导入接口/页面|通用来源预览映射、去重追加、损坏报告和取消恢复|
|F20|设置交付|部分接通／产物不齐|settings/global_appearance；设置页；源码声明 profile/recent|已有二进制未声明 profile/get/workspace/recent；统一重建、安装升级卸载|
|F21|LSP|契约接通／真实语义阻塞|七verb、Host/CLI/IPC；只读不推进GoalEvidence，权限模式允许LSP查询和rename预览|尚未发现产品语言插件LspServer注册及页面API消费；真实语义服务器、诊断产品注入、rename审查仍待验|

## 本轮已有宿主探针

Node 22.23.2，独占 TEMP/TMP 与设置目录；只读 initialize 和两次 LSP 请求，不发执行任务。apps/desktop/.tmp-test/wiring-audit-probe.cjs，原件 wiring-audit-XiEjna/probe.json。

已有 Host 声明 LSP 七方法与 execution/propose，未声明 acp/create、profile/get、workspace/recent。源码却声明后两项，证明当前载荷与源码接口不齐。lsp/define(path=test.cj,line=0,character=0) 返回 -32030 lsp-no-server；不是语义成功。diagnostics 首次误带 line/character 被严格参数契约拒绝 -32602，本条不能作为服务器缺失证据，需用正确参数重探。

Host SHA256 73131303DEF182F3F5728E09DE9D15265AA95137DD97CD0A25BEBF7A4B0519CC（本轮重新核实一致）。未重建 Host/CLI，不将源码声明当作载荷接口可用。

## 审计门槛与实施顺序

目前没有一个完整能力域被本轮证明为“所有前后端与当前安装产物全打通”。局部通过保留局部范围：模型页公开测试入口 17/17、内部渲染 432 项，不替代核心或真实服务。

1. 继续补每域 CLI 用户动作、IPC 实际处理函数、页面消费、提供方装配与当前产物证据；未核项不能直接改成“缺实现”。
2. 优先统一载荷与源码的接口差异，收口现有入口，再接 ACP 持久事实/公开委派与 LSP 语言插件真实语义。
3. 模型页继续修配置/密钥部分成功回执；不从页面读回猜测写入阶段。
4. 知识、自动化、数据库、扫描等缺口先沿用现有共享核心制定并落实有限契约，禁用入口不模拟成功。

责任：本审计与前端定向修复由当前 Codex 负责；共享 Host/CLI、ACP/LSP、执行与持久化的在飞文件需核实具体写者及接口责任，尚未完成责任确认，不虚填主责。下一轮应补实际接口与调用方逐路径定位、正确 LSP 探针以及产物哈希复核。

正确参数复探：diagnostics 只传 path 后返回 -32030 lsp-no-server；define 同样返回 lsp-no-server。原件 apps/desktop/.tmp-test/wiring-audit-OVuprd/probe.json。两次探针进程退出码均 0，只表示探针执行成功，不把无服务器错误算功能通过。

## 第二轮：ACP、LSP、执行的逐层定位

当前源码未改产品实现；依据工作区实读结果，不沿用交接推断。

|能力|核心|Host/CLI|IPC|页面消费|提供方与产物|裁决|
|---|---|---|---|---|---|---|
|ACP|acp_contract/process/delegation/approval_bridge/gate/settings/weight/env|对 apps/host/src、apps/cli/src、preload 与 renderer 定向检索 Acp/acp/ 未见调用；不以此代替全协议适配审计|无已核直接 ACP 通道|无已核公开委派页面调用|已有 Host 不声明 acp/create；真实委派提供方及生命周期未验|核心存在、公开接线缺口|
|LSP|lsp_contract.cj:285 LspServer，:570 register；model_tool_runtime 与 agent 使用 sharedRouter|main.cj:2784–2817 七动作分派；CLI builtinTools 注册七个 lsp 工具|lsp-ipc.cjs 有限七动作与字段守卫，preload 同名 API|renderer 全目录文本检索七个 API 未命中；不排除通用插件间接调用|生产 core/src 非测试未定位 LspServer 具体实现或 router 注册调用；Host 无服务器时失败|L1 契约接通、页面/语言插件装配缺口|
|执行|execution_api/service/supervisor；stateJson providerAvailable=false|Host main.cj:1040 分派；CLI main.cj:235 job 对应 dispatch|execution-ipc/preload 六动作|app.js:862 → SaCodeSlots.TerminalOutput；client-slots 导出 → terminal-output.ts → ExecutionTask → execution-task-state 六动作|providerAvailable=false，页面 control(start) 明确禁止启动；没有放开沙箱探针门禁|准入/描述/取消接线、公开真实执行阻塞|

代码行号仅本轮定位提示，工作区并发编辑后可能漂移；哈希清单及固定提交共同限定范围。

## 本轮定向测试与边界

私有 TEMP/TMP，每轮唯一。Node --test apps/desktop/test/execution-task.test.mjs：9/9，含一条实际已有 Host 的工作区/提案/审批/门禁/取消/重载场景，退出码 0。它不执行已关闭提供方的真实任务。

Node --test --test-name-pattern=LSP apps/desktop/test/bridge.test.mjs：4/4，退出码 0，覆盖 preload 字段、主进程拒绝、文档版本、真实已有 Host 七个无插件失败与非语义线索。无服务器失败符合 L1 契约，不是 L2 语义通过。

## 可复跑接口库存

Node docs/qa/wiring-inventory.mjs 只读扫描 preload 单行 invoke、桌面处理函数候选、非 vendor renderer 文本引用，写入忽略目录 JSON。本轮定位 111 个动作，处理函数文本候选未出现空项；不能用此声明所有 handler 已实际注册。16 个动作未发现 renderer 文本引用，含 LSP 七动作以及 teamApprovalAnswer/teamMessageBroadcast/teamTaskClaim/teamTaskComplete/appearanceGet/appearanceSetTheme/modelsList/modelUpstreamUpsert/pageToolsList。旧接口、别名与通用贡献装配需人工裁决，未命中只记待核，不判死代码。

输出 apps/desktop/.tmp-test/wiring-inventory-1791832617744.json。该库存包含工作区未提交处理函数，不能作为固定提交可运行证明；后续逐域核真实授权、状态和提供方仍未完成。

## 第三轮：队列、目标控制、插件接线及缺口修复

前置提交 7dfae32。页面调用定位：send-queue-state.js → queueDescribe/queueUpdate/queueEnqueue；app.js 的 GoalBar 适配器 → goal 六动作；plugin-manager-adapter → 插件有限 API。增强 enhance.js → promptEnhance/promptPoll/promptCancel，真实增强专项尚未在此轮运行，不升状态。

独占 TEMP/TMP 运行 Node --test apps/desktop/test/goal-control.test.mjs apps/desktop/test/message-queue.test.mjs apps/desktop/test/plugin-manager-wiring.test.mjs：14/14，通过，退出码 0。分项为目标控制 1、队列 5、插件 8。实际已有 Host 覆盖目标持久化与跨会话/陈旧修订拒绝、队列提交去重/跨进程持久/轮次与步边界送达、插件本机生命周期及重启读面；部分插件守卫为模拟 request 单测。队列模型使用本地夹具，不代表真实远端模型。目标控制不包含 GoalRunner 自动完成，插件不包含远程市场完整提供方。

发现并实施：refreshQueue 吞掉读取失败且缺同会话乱序保护；updateQueue 在等待期间切会话会继续回读新会话。本批增加队列读取序号与会话绑定，失败显示真实原因并保留旧条目/待确认项，成功重试清除队列读取错误；无 nextTurn 数组的回执拒绝，投影与待确认裁决准备完成后才更新；更新回执跨会话不再回读新会话。

Node --test apps/desktop/test/send-queue-state.test.mjs：16/16，退出码 0；新增 5 条针对同会话乱序、失败保留与重试、迟到错误、更新后切会话、损坏回执。纯控制器测试不等于真实 Electron 页面；核心与宿主没有修改，不新增完成状态。

## 第四轮：增强真实请求、结算与迟到失败保护

前置提交 a56639c。独占 TEMP/TMP 运行 Node --test apps/desktop/test/prompt-enhance.test.mjs apps/desktop/test/model-context.test.mjs：7/7，退出码 0。真实已有 Host 与本地 HTTP/SSE 提供方夹具覆盖正文和历史入请求、响应落盘、增强固定模型/独立草稿/零工具、不写会话消息、用量一次结算、跨会话及重启保留、空白/未配置拒绝、取消不影响主轮次。不是远端模型或最新源码重建产物验收。

页面 enhance.js 的失败回执原先绕过草稿修订与会话代数校验；两条新增独占测试先复现旧会话网络错误覆盖当前错误、编辑后旧失败覆盖当前提示。身份校验移至成功/失败分支之前后，Node --test apps/desktop/test/state-wiring.test.mjs apps/desktop/test/prompt-enhance-ipc.test.mjs：9/9，退出码 0。纯控制器与模拟主进程校验，不替代 Electron 原生撤销顺序验收。

上下文环当前链路 app.js → modelDirectory 容量 + tipsPressure → ContextMeter；settings-state.js 从 tipsAfterReply/tipsGet 回执更新压力。尚待核实同会话乱序、切会话迟到回执、可靠性丢失时旧读数清除，以及实际请求 token 计量来源。语音按钮当前禁用，不能算 F18 全域完成。

## 第五轮：上下文读面与回执修复

前置提交 53810b6。读取 tips_surface.cj，分子来自 currentContextTokens(log)，分母来自模型注册表窗口；tips/get 以 reliable 显式标识，after-reply 以 percent>=0 标识。已有 Host 无可靠分子时 reliable=false/percent=-1，提醒隐藏偏好跨进程留存、非法参数拒绝；结合设置测试，本轮独占 TMP 下 10/10，退出码 0。此测试不证明实际远端模型的采样正确或当前源码载荷一致。

发现 settings-state.js 的无可靠数据回执不清除旧压力，且两条压力读取函数没有会话和乱序守卫。新增两条测试先红，修复为共享读取序号及会话代数校验，失败/无可靠/负用量清除当前压力，旧回执不更新当前状态。工作区测试 10/10；HEAD 加仅本批函数段的私有候选复跑 10/10，退出码 0。提交不含并发个人资料实现。

仍未收口：session-state.js 切换会话目前不清空 tipsPressure 或回读提醒；app.js 将目录容量与 tipsPressure 分子组合，需验证模型变更时样本是否失效及容量身份是否一致。下一步需接会话切换清空/重读并完成实际采样探针，不能宣称上下文全链路已完成。

## 第六轮：会话切换时清空并回读上下文

前置提交 bd4e407。session-state.js 在成功切换并递增会话代数后立即清除 tipsPressure/旧提醒，完成基础回读后 refreshTips；app.js 注入这三个已有状态/动作。新增 session-context-reset.test.mjs 先复现旧用量残留，修复后与会话及设置控制器测试共 21/21，退出码 0。该组为页面控制器夹具，不是实际 Electron/Host 会话切换验收；既有 session-state.test.mjs 包含并发新增用例，不纳入本批提交。

核心采样核对：tips.cj occupancyKey 仅 messages.size 与尾消息，OccupancySample 未包含会话/模型身份；Host tips_surface 读取当前注册表窗口。不同会话相同消息形态及模型切换的采样归属仍需契约与实测修正，此处登记为明确缺口，不宣称上下文计量已闭合。app.js 提交候选从 HEAD 加一行注入构造，通过 Node --check，排除其他在飞页面变更。

## 第七轮：模型配置与凭据的实际接线审计

前置提交 72b53c1。Node --test models-ipc/provider-registry/model-write-approval/models-validate 四文件首次聚合结果 11 tests / 10 pass / 1 fail，rc=1；唯一失败为 models-validate 加载 esbuild 缺失，不是断言失败。使用忽略目录中已有隔离依赖、只对 esbuild/vue 的 ESM 解析定向映射后，models-validate 单独 5/5，rc=0；不得合并成首次全绿。其他 10 条包括 preload/字段守卫、真实已有 Host 的配置读写/冲突、凭据旋转/跨进程保留、注册表驱动请求、协议拒绝、环境密钥只读、本地模型夹具发起文件写的审批允许/拒绝链。后者不代表模型配置动作自身审批，也不代表所有协议或远端服务通过。

沿调用链核：provider-settings → model-center-adapter.save → modelsSave → models-ipc.cjs → model/registry/update → credential/set。当前 models-ipc.cjs 属未落库并发提取文件，不整文件纳入此提交。故障注入原件 apps/desktop/.tmp-test/model-save-stage-probe.cjs：registry/update 返回新 revision 后 credential/set 失败，调用顺序已确认；返回只有 credential-store-unavailable，stageExposed=false。页面 mutate catch 保留原草稿/修订，后续重试面临 settings-conflict，不能明确报告配置已保存。

修复契约：配置失败返回原有错误；配置已保存而密钥失败必须返回稳定阶段标识及配置修订，不回显密钥/底层敏感消息。页面保持草稿、明确显示“配置已保存，密钥未保存”，回读新目录并更新该提案修订；允许只重试凭据，不通过重复注册表写入恢复。需要同步 modelsSave 有限响应、适配器与供应商页面，以及“配置失败/凭据失败/成功、回读失败、跨会话迟到”测试。配置与凭据保持共享核心权威，不由页面猜测实际写入阶段。该修复尚未实施，不升级 F07 状态。

## 第八轮：模型部分保存阶段回执实施

新增 models-save.cjs：注册表失败仍抛原错误且不写凭据；注册表成功、凭据写入或派生名称失败时返回新注册表视图与 saveStatus(configuration=saved,credential=failed,reason=credential-save-failed)，不转发底层敏感错误。旧提交态主进程 inline handler 与工作区提取态 models-ipc handler 均使用此共享操作；提取文件保持未落库，不整文件提交。package.json 仅新增该文件载荷项，主进程和包清单从 HEAD 构造精确候选排除并发改动。

供应商适配器消费部分保存状态，拒绝报告整次成功，明确配置已保存/密钥未保存并保留页面草稿；正常成功保持旧返回形状。models-save-stage + provider-adapter-revision：9/9，rc=0；models-save-stage + models-ipc：6/6，rc=0。测试为阶段函数与适配器/IPC 字段守卫，不是实际 Electron 凭据失败场景。凭据单独重试、自动回读修订以及打包重建仍未实施，不能把本轮当成全功能收口。

## 第九轮：文件编辑、Git 只读和载荷清单复验

前置提交 edf998a。独占 TEMP/TMP、隔离 esbuild/vue 解析运行 Node --test git-workbench.test.mjs file-editor.test.mjs file-editor-recovery.test.mjs：24/24，rc=0。包括纯编辑控制器的畸形审批/读写回执、重复点击、卸载迟到回执、差异限额；真实已有 Host 的审批保存空白与中文、外部冲突拒绝、磁盘核对；真实 Git 仓库与 Host 的暂存/未暂存/重命名/未跟踪读取、身份及路径拒绝，以及 Git 不可用明确失败。测试中的“暂存”是夹具预先设置的索引状态，不是产品暂存动作通过。

F08 链路：app.js/客户端槽位的 GitWorkbench → workspaceGitStatus/workspaceGitDiff → Host workspace/git-status 与 workspace/git-diff → 只读 Git 查询；git-workbench.ts 明确写“暂存、提交、推送尚未开放”。文件编辑器经审批工具路径可真实写入并拒绝外部冲突，但 CLI 同场景用户动作、实际 Electron 页面与最终载荷仍待验。不得把只读 Git 和文件写入合计成完整开发闭环。

Node --test packaging-contract.test.mjs：7/7，rc=0；递归本地 CJS 清单覆盖（51 入口、52 文件、49 依赖边）包含 models-save.cjs，删项反证仍拒绝。清单和部分测试有并发未提交变化，这是工作区门禁；不是 edf998a 固定提交的完整打包验收，更不是新安装产物启动证明。

模型凭据恢复仍缺有限独立动作：preload 没有凭据单独保存入口，仅 modelsSave 整次配置保存。下一步需要以核心派生凭据名称、提供方身份和有效修订建立有限重试契约，不能新增可由页面任意点名凭据的通道。模型部分保存可见性已修，单独重试尚未交付。

## 第十轮：知识、自动化与连接页面逐层审计

前置提交 4488198。app.js managementPage → SaCodeSlots.ProductManagementPage → product-management.ts；唯一已核读取动作是自动化 readRecent → workspaceRecent，模型清单来自父级 customModels。知识文档、自动化定义、连接配置均只写入父级内存草稿；检索/保存/测试连接/启动禁用。preload、Host 主分派及 CLI 主文件定向检查未发现 schedule/knowledge/connection 管理入口，不能将已有核心文件等同于公开接线。

|域|已有可沿用|当前产品缺口|下一步与验收|
|---|---|---|---|
|知识 F11|用户/项目草稿隔离、来源表单|无服务清单、保存、索引、检索上下文注入|先定义共享核心文档身份/作用域/修订/来源及持久化契约；有限双入口和 IPC 后验跨项目隔离、更新失效、真实检索入请求|
|自动化 F13|核心 schedule 与 goal_scheduler 源码；页面目录/模型/Cron/时区/四权限字段|没有页面创建/暂停/运行接线；最近项目读取不等于调度|沿已有 schedule 定义梳理持久事实及运行授权，明确 Cron/时区与漏跑恢复；真实双入口验证创建不执行、启动独立准入、恢复不重复副作用|
|连接 F14/F15/F16|MCP/SSH 驱动源码与分类表单|配置保存、测试、启停管理均无入口；数据库提供方未核|先核注册表与驱动装配并定义有限类型动作，凭据由核心派生；分别验拒绝授权、超时/取消、断连重连、数据库只读探针|

本轮不修改仓颉实现；本地技能定向查找未得到可用 CangjieSkills 副本，后续 .cj 实施前须取得并读取相应技能或登记 SDK 探针替代限制。上表为源码定位，不宣称核心编译或服务实测通过。当前 Codex 负责审计及本批页面断言，核心/公共入口实施责任需与在飞路径确认。

product-management.test.mjs 扩展三页夹具，新增受阻状态、保存/搜索/连接测试禁用判据；隔离依赖运行 5/5，rc=0。这是无服务时诚实呈现的检查，不升级任何管理能力完成状态。后续必须实现真实管理服务，不能以长期禁用替代需求交付。

## 第十一轮：团队与页面工具的真实接线及红项

前置提交 906e2ba。独占 TMP，隔离 esbuild/vue 解析及 Node require 路径运行 team-host/team-panel-entry/page-tools-ipc：24 条，15 pass / 9 fail，rc=1。页面 8 条红为夹具提取 app 装配段时缺 managementPage 注入；工作区补 ref 后页面专项 11/11，rc=0。该文件已有并发 team-state.js 装配夹具变更，新增注入与之耦合，暂不单独提交或整文件吸收，保留工作区供该线合并。

真实团队首例 team/describe 超时；独占新 TMP 单独 --test-name-pattern=成员消息进入 复跑仍 1 条 / 0 pass / 1 fail，rc=1，17.2 秒请求超时、20.1 秒进程终结。不是运行观察超时，不保留假等待；原因尚未定位，不能归因并发或环境。另两条真实 Host 场景（精确审批成员认领/完成，团队创建及持久恢复）本轮通过，但不抵消该失败。团队动作与 ACP 外部委派是不同链路，不能用团队通过证明 ACP 入口完成。

页面工具 10/10 为 VM 模拟主进程/页面注册表。关键事实：main.cjs pageToolCall 通过 executeJavaScript 直接调用 tool.handler；page-tools.js 注册 readState/clickElement/inputText/scroll。字段校验与 WebMCP 转主进程成立，但没有核心一次性审批、任务身份、取消及日志结算，尤其 click/input 可触发后续产品动作。因此该组绿不能证明统一授权。后续需共享核心执行契约登记贡献工具、动作分类与不可变提案，副作用动作无核心许可拒绝；终结、错误、取消事实走同一结算。不能仅把执行迁至主进程当作安全闭环。

本轮裁决：团队部分接通且真实用例存在重复失败；ACP 缺公开委派接线；页面工具缺统一授权/结算，为交付前优先缺口。审计仍未结束，CLI 同场景、真实 Electron 与最终载荷尚待核。

## 第十二轮：团队超时逐请求定位与技能前置

前置提交 957acb9。对失败用例在忽略目录创建仅增加请求计时/提供方计数的私有探针 team-trace.test.mjs，不记录请求正文或凭据。原测试 target 目录下追踪得到：member/create 3381ms、task/create 895ms、task/assign 2065ms、首次 describe 4847ms；发送消息 981ms、随后 describe 4820ms，后续空闲 describe 1–3ms。提供方两次真实夹具请求均发生，成员正文及消息持久/权限拒绝断言通过：1/1，rc=0，整体17.97秒。此前原用例两次 describe 超时仍有效，不能因本次通过撤销红项或报告稳定通过。

目录变量必须保留：私有 .tmp-test 工作目录下两轮探针在 member/create 5001/5007ms 超时；其中后一轮使用独占 TMP。不能归为只需私有 TMP，不能据此断言死锁或某种目录缺陷；没有延长请求窗口。已有 Host 二进制哈希再次核为73131303DEF182F3F5728E09DE9D15265AA95137DD97CD0A25BEBF7A4B0519CC，11,183,104字节，时间2026-10-11 18:27:06。本轮没有重建源码。

下一步定位重点：执行在途的 team/describe 是否同步等待成员过程、创建/分派的进程启动与日志读取是否阻塞协议线程；对比真实空闲和在途延迟，并检验非阻塞权威快照、取消与审批可响应。尚未定位根因，不改测试超时制造绿。

仓颉技能前置：已在线读取 https://gitcode.com/Cangjie-SIG/CangjieSkills 展示的实际 README，当前页面分支为 cangjie-1.0.5，不能假定与本机1.1.3匹配；相应 cangjie-coding/SKILL.md 网页读取失败。仅完成 README 获取，未宣称已使用技能，未修改 .cj。后续需取得匹配版本技能及实际内容再开展核心诊断。

## 第十三轮：仓颉技能取得与团队锁域定位

前置提交 53997f3。在忽略目录 shallow clone 官方 CangjieSkills cangjie-1.0.5，精确提交 efdf73fec28a97986dbd6a13db0b71c88b707143；读取本地 README 及 .agents/skills/cangjie-coding/SKILL.md，通过规定 search_docs.py 同一进程批量查询 Future get timeout、Mutex synchronized。结果确认 Future.get 阻塞等待、锁域操作需核查；未运行 stdx 配置/clean，也未改变公共环境或 .cj。技能来源已核，但1.0.5与项目1.1.3差异仍须当前编译探针裁决。

HostTeamRuntime 源码实读：describe 在 synchronized(mtx) 内 panel(state())；poll 整段同锁，调用 member 的日志 load/租约接管、deliver 的 durableCheckpointBatched、start 的工作区准备/日志检查点等。answer 同锁并在回答后 durable。TeamMemberRunner.poll 仅 handle 非 running 时才 result()，没有证明它直接等待正在执行的 Future；start 使用 DeferredProvider 把 config.open 放到执行线程，不能臆造主线程网络等待。锁域存在慢 I/O 与协议响应竞争的结构性风险，具体本轮4.8秒尚未通过操作计时定位，不能升级为已证根因。

下一实施切片：先在私有 Host 副本测 teamRuntime 锁等待/持锁及各持久操作耗时；确认后将慢准备/持久结算与权威状态发布拆分，保留租约与一次性授权，描述不得启动执行或隐瞒未持久状态。覆盖在途响应、审批/停止并发、冻结/检查点失败，使用原5秒请求判据，不能以扩超时或跳过持久屏障收口。当前 Host 源码 main.cj 有并发在飞修改，隔离构建证据需注明源码快照，不能沿用旧二进制结果。

## 第十四轮：固定提交 Host 构建发现基线阻断

将 ca04115f4d9f 的 core 与 apps/host 用 git archive 导出到 apps/desktop/.tmp-test/team-host-fixed-ca04115f4d9f，不含工作区改动；snapshot.json 记录 committed-only。沿提交态已配置的 stdx1.1.3.1，本机 cjpm/cjc1.1.3，在独占 TEMP/TMP 下 cd apps/host && cjpm build；终态 rc=1，core 编译失败，4 errors / 112 warnings，未生成 Host。原件 apps/host/build.log 与 build.exit.txt 保存在该私有快照中。不是计时观察未完成，也不把零测试集计绿。

明确错误位于提交态 core/src/cmds.cj：第11行带默认值的 parse 缺具名参数标记，expected ',' or ')' found '='；第64行使用非仓颉的对象形态返回类型 {spec:...,args:...}，产生 expected type/operator 与 delimiter 三条后续错误。工作区该文件已存在并发修复（parse! 与 CommandResolveResult 等），不能另外覆盖或整文件代提交。没有宣称吸收修复后的源码已可编，尚须核实调用方及测试依赖并固定落库。

这改变下一优先级：在编译基线未收口前，旧 Host 团队延迟证据仅能描述旧二进制；不能拿它证明 ca04115 最新实现。先切清已有 cmds 修复及依赖、提交级复建，再做团队锁域计时。其他域审计仍可推进，不把一个构建阻断当成所有任务不可进展。

## 第十五轮：依赖叠加与新 Host 的真实团队复验

在第十四轮 ca04115 私有提交快照仅叠加工作区 cmds.cj（哈希留 cmds-overlay-hash.txt）后构建，rc=1。原语法错误消失，进一步暴露 GitQueryResult 缺失、webUrlEncode 重名、SessionLog 缺 isDurableFrozen/freezeAfterDurableFailure/durableCheckpointBatched 等。这证明 cmds 不能单独切为“恢复构建”；现有已提交团队依赖尚未落库的 Git/持久化等实现。

另建 team-host-working-snapshot，逐字复制工作区 core/src、apps/host/src 共355个.cj并记录 source-hashes.json，私有配置仅指向仓库已有 stdx 绝对路径，不修改公共环境/配置。独占 TEMP/TMP 运行 cjpm build，rc=0（Host阶段30 warnings）；这是含未提交源码的哈希快照成功，不是固定提交通过。

私有新Host: target/private-host-bin/sacode-host.exe，SHA256 E605F1657DD1E6AA26C98B0F0DA354EAD6C800CA74C9F2948015C4A133C61106，DLL及信任锚来自现有本机载荷，未做无SDK依赖验收。原5秒请求窗口下私有追踪1/1通过：member/create571ms，task/create8ms，assign9ms，消息发送3ms，在途describe43/45ms，其余1–2ms；整个场景2.29秒。随后指定新SACODE_HOST运行原team-host.test.mjs，3/3，rc=0，原件私有 apps/host/team-full.log 与 team-full.exit.txt。没有修改测试超时。

裁决更新：此前旧Host重复超时仍保留，但不能扩大成当前哈希源码必然超时；当前工作区快照团队真实局部链通过，固定提交仍不可构建，产物一致性缺口成为收口前置。源码、DLL和配置差异尚未逐项归因，不能凭新快照更快宣称某个锁改动已修复。下一步核现有持久化/Git/命令/网络冲突修复的责任与提交切分，形成可复建提交后重打载荷，不能直接将355文件混批提交。

## 第十六轮：最小构建依赖闭包复核

以 b312025 提交归档为基底，在忽略目录 baseline-closure-candidate 逐层叠加工作区源码，未修改公共实现或暂存共享文件。首轮8文件叠加后核心可进入Host编译，但Host依赖尚未入库的ExecutionApi/Service/Run及GoalRunner.start。进一步补执行服务四文件、目标运行器/运行时，再补shlex的outputLimit监督契约、goal_scheduler轮次契约与goal_claim.claimedFor；每轮独占TEMP/TMP，日志build-v2至build-v5及真实退出码保留。

v5核心编译阶段通过，Host仍5条编译错误：terminalOutputJson缺实现；main/team_runtime的askForCall双参数调用与提交态审批三参数契约不符；SessionWorkspace.revision缺失；RealSseProvider.reportedUsage缺失。终态rc=1，不能记为可构建基线。该结果进一步证明已提交入口与未提交核心依赖交叉，不能只提交最初8文件或把工作区全量成功当提交态通过。下一步核terminal_view、approval、workspace与sse各契约及调用方，固定候选再跑真实入口；未做发布或替换公共Host。

## 第十七轮：Host缺失接口与审批占位实现核查

在v5候选叠加terminal_view.cj、approval.cj、workspace.cj与sse.cj，逐文件SHA记录在私有host-dependencies-overlay.json。已读取实际差异：terminalOutputJson从日志只读分页；workspace.revision按目录事件派生；sse增加供应商LedgerUsage读面；approval工作区实现精确参数绑定、一次性消费及已批准未消费票的过期。

重要风险：提交态approval.cj底部askForCall/consumeExactForCall/consumeForCall仍为工具名审批包装，argumentsMatch恒为true；它不是精确授权实现。工作区补丁移除这些占位并以不可变arguments匹配，不能只为补默认ttl参数而保留旧放行逻辑。必须覆盖参数挪用、旧未绑定票、过期、重复消费，并与执行/模型/团队调用方一起收口。

v6构建核心阶段输出168 warnings，继续进入Host编译。观察时执行句柄85803与cjc进程32896均仍存活，尚无终态，不将等待或无错误输出算通过；后续读取同一执行句柄与build-v6.exit.txt，再用新Host复验模型写审批和持久任务入口。

## 第十八轮：精确审批专项与提交态反证

新增当前Codex自有approval_binding_test.cj三条用例，覆盖错误参数及工具名消费不得放行且不烧正确票、旧未绑定票不得进入精确授权、批准未消费票到期拒绝且过期事件幂等。独立approval-binding-candidate副本只保留生产文件和本批测试，独占TMP运行cjpm test：TOTAL3/PASSED3/SKIPPED0/ERROR0/FAILED0，rc0。

将副本approval.cj替换为HEAD占位实现后，使用显式ttl以避免默认参数编译差异，binding-old-v2.log实际TOTAL3/PASSED0/ERROR0/FAILED3，rc1，逐项命中越权与过期缺陷。第一次恢复运行仍得到旧红结果；更新恢复文件mtime强制重编后binding-restored-v2.log重新TOTAL3/PASSED3/ERROR0/FAILED0，rc0。源文件恢复SHA在restored-approval-hash.json，不能把第一次恢复失败隐去。未提交新测试，因其依赖共享审批修复，需同批落库避免提交态红。

Host v6仍在LLVM编译，句柄85803及其llc子进程13984已确认存活，CPU累计从237秒增长到572秒；无终态不报通过、不重启同一构建。

## 第十九轮：精确审批修复与原有回归收口

approval-binding-candidate加入原有approval_test.cj，与新增三条测试共同运行：最终Summary TOTAL17/PASSED17/SKIPPED0/ERROR0/FAILED0，真实rc0；包括真实单调时钟过期、并发发号应答消费及错误工具不烧票。原件approval-regression.log/exit.txt。拟吸收共享approval.cj的完整精确参数与过期修复（51增19删），未包含执行、会话或Host其他在飞文件；与本批测试同提交，不能据17条绿扩大为全仓可构建或全链路授权完成。

## 第二十轮：终端投影与工作区修订依赖收口

新增workbench_projection_test.cj三条测试：目录无操作/非目录事件不增加修订、持久重放保持修订；终端分页跳过畸形chunk并保留游标；中文8192字节边界截断保持完整UTF8并拒绝非法分页。与审批17条共同运行，projection-replay-test.log最终TOTAL20/PASSED20/SKIPPED0/ERROR0/FAILED0，rc0。读取实现确认terminalOutputJson只投影日志，不启动进程或推断退出事实；SessionWorkspace.revision只数目录事件。

吸收workspace.cj的7行修订读面及terminal_view.cj，与本批测试同提交，不包含其余共享修改。测试基底仍含前述未落库持久化依赖，不能当完整固定提交验收。Host v6同一构建仍在LLVM后端，继续保留句柄85803等待终态。

## 第二十一轮：模型SSE用量维度读面验证

读取sse.cj与Host model_routing：Host结算读取RealSseProvider.reportedUsage，提交态缺该字段。工作区实现按供应商usage提取input/output/cacheRead/cacheWrite，缺失维度保留-1，普通prompt扣缓存维度避免重复计费。新增sse_ledger_usage_test.cj四条：缺usage与仅total不冒充各维度0；标准缓存拆分；供应商命中/未命中维度；缓存超过prompt拒绝。

首轮夹具缺finish_reason结束帧导致3 ERROR，纠正夹具后独占TMP复跑最终TOTAL24/PASSED24/SKIPPED0/ERROR0/FAILED0，rc0；原件sse-ledger-test.log与sse-ledger-v2.log均保留。该证据仅为可控字节流，未宣称真实供应商价格协议全覆盖或端到端费用准确。吸收sse用量读面与测试，不带其他账本/模型调用在飞实现；完整Host候选仍未终态。

## 第二十二轮：模型中心费用读面非法数据保护

继续核模型页发现groupByCurrency仅判断number类型，负数/非整数/NaN/Infinity与合计安全整数溢出可能成为展示值；modelTotals重复模型行直接覆盖，跨币种可冒充单模型用量。适配器现拒绝这些数值，整组费用返回null并注明待核算，重复或非法模型用量返回null；有效零值与正常同币种合计保留。provider-adapter-revision.test.mjs新增三组语义断言，与原五条合计8/8，rc0（Node22.23.2，可控API夹具）。

这只是读面诚实保护，不能代替Int64金额跨IPC无损传输设计；密钥失败的独立重试入口当前仍缺，尚未新增通道。Host v6句柄85803仍存活，LLVM子进程13984累计CPU已到1291秒，未重启、未延长任何测试请求超时、未把未终态算绿。

## 第二十三轮：命令注册表编译修复及参数回归

读取cmds.cj完整差异并将工作区cmds_test.cj加入独立验收副本。9条命令测试覆盖注册/未知/重名/空名、普通无解析器不推断参数、内置命令登记、review目标/effort/布尔选项与非法重复拒绝；与前24条合计最终TOTAL33/PASSED33/SKIPPED0/ERROR0/FAILED0，rc0，原件command-regression.log/exit.txt。源码与测试哈希核对后同批吸收具名parse参数、CommandResolveResult结构、仓颉合法空串/Option解析及内置解析器。不宣称review/compress/init真实执行已闭环，登记解析与执行分开判定。

密钥独立重试需核心修订/提供方身份绑定，不能仅把credential/set透传给页面后宣称安全恢复；当前仍是明确部分保存提示。Host构建同一句柄85803尚未终态，继续等待。

## 第二十四轮：URL编码编译冲突与行为收口

吸收web_network.cj已有修复：移除两份重复webUrlEncode，以UTF8字节及固定大写hex表实现百分号编码，避免不存在的radix/padStart调用；其他地址准入实现不变。新增web_encoding_test.cj两条，覆盖ASCII未保留字符、查询分隔符、空串、中文及单字节补零；与前33条最终TOTAL35/PASSED35/SKIPPED0/ERROR0/FAILED0，rc0，原件web-encoding-test.log/exit.txt。

本轮发现web_search.cj相对HEAD差异已被并发修改为tinyfish分支返回，和此前候选叠加的import修复口径不同，不代提交、不以旧哈希代表当前文件。Host v6仍保持原副本继续编译，句柄85803存活，LLVM CPU已超过1483秒；未将持续活动误判为挂死。

## 第二十五轮：Windows持久屏障及租约依赖收口

完整读取SessionLog发布差异与原生文件提供方：逐字节核对已提交前缀、持有写者租约、同句柄追加并FlushFileBuffers；写入阶段失败冻结后续发布；普通flush在未打开写句柄时允许重试，显式准入失败冻结。坏尾修复与load共用口径，中段损坏/前缀分叉拒绝；投影改为新快照，不修改先前返回的消息数组。

persistence_repair_test九条实际覆盖并发120次刷新、真实Windows读句柄阻挡写入及重试、外来租约拒绝、UTF8坏尾重放、投影稳定、大批量检查点、失败冻结和租约丢失。与已有验收35条先44/44，加入会话/租约测试工作区80/80。session_test.cj含并发Hook测试，提交候选仅吸收3行死亡判据修正（越界PID不等于确认死亡，改注入dead）；剔除三条Hook测试后实际候选77/77，rc0，原件persistence-commit-candidate.log/exit.txt。

本批只吸收session/lease/filewin/durable_checkpoint及对应测试夹具，不吞Hook改动。平台边界：非Windows nativeAppendDurableStatus返回unavailable，nativeReplaceFile明确拒绝，Linux/鸿蒙仍阻塞。并发租约接管的完整原子性未由此证明；不是整体会话格式迁移完成。Host构建同一句柄85803仍在LLVM编译，CPU超过1804秒，不宣称新Host已经可用。

## 第二十六轮：Git只读工作台依赖验证

读取git_workbench.cj全部实现：有限status/diff动作、literal pathspec、禁用外部diff/textconv、关闭可选索引锁、查询根目录校验，分流输出262144字节限额后排空。新增git_workbench_test.cj三条：写动作与越界路径在启动前拒绝；独占真实Git仓库区分working/index patch并逐字节比较索引不变，子目录查询拒绝父仓扩大；限额后管道读到EOF。与前77条候选合计TOTAL80/PASSED80/SKIPPED0/ERROR0/FAILED0，rc0，原件git-workbench-test.log/exit.txt。这次80是77+Git3，不是包含并发Hook3的此前80。

仅吸收只读GitQueryResult/queryWorkspaceGit及测试，供已提交团队与工作台依赖，不开放Git写操作。当前目录路径准入与2秒进程等待是局部界限，输出线程收束/真实CLI与打包页面仍需端到端验收。Host v6保持同一句柄85803运行，尚无终态。

## 第二十七轮：持久任务依赖与沙箱默认拒绝收口

执行四组测试加入隔离候选后99/99，但补Shell回归时发现缺SandboxRuntime.provider契约。读取差异确认提交态backendAvailable默认true且confine原样返回argv，不能算真实隔离。吸收工作区无后端默认拒绝修复，并给ExecutionSupervisor新增显式executor注入（默认仍ShellExecutor拒绝）；真实进程测试仅注入固定无副作用测试后端。合并Shell与Sandbox回归115/115，再增加“providerReady=true不能替代沙箱提供方、不得产生owned-subprocess身份”反向用例，最终TOTAL116/PASSED116/SKIPPED0/ERROR0/FAILED0，rc0，原件execution-enforcing-v2.log/exit.txt。

本批吸收execution_api/service/output/supervisor及测试、shlex与sandbox对应实现/测试，包含请求去重、精确授权、启动/停止/自然退出、损坏输出、恢复不重执行、取消/超时和双流限额事实。公开ExecutionApi仍providerAvailable=false且默认门禁关闭，不以测试passthrough证明产品隔离或真实公开执行已完成。

重要载荷边界：正在编译的Host v6副本早于本次Sandbox/监督器注入修复，即便随后成功也只代表该旧候选快照，不能升级为最新安全载荷；需下一固定提交重新构建。保持原句柄85803，不把持续活动重启为新构建。

## 第二十八轮：目标声明真实工具循环与旧候选构建终态

读取上一轮原件：goal-claim-regression.log 最终 TOTAL177/PASSED176/SKIPPED0/ERROR0/FAILED1，rc1。唯一失败是新增测试误把 GoalService 的实际完成状态 complete 断言为 completed；stopReason=completed 与同轮自动完成其余断言成立。按 goal.cj 既有状态契约纠正测试，不修改生产状态来凑绿。新增 claim-only 不得完成的反向用例，隔离副本、独占TMP运行 goal-claim-v2.log，尚待读取终态，不预报通过。

Host build-v6.log 已实际 cjpm build success，build-v6.exit.txt=0。同一构建已终态，不再等待或重启该句柄。它是 b312025 基底加多层工作区依赖的旧候选，且早于默认沙箱拒绝修复，不能作为最新安全产物，不替换公共载荷。下一步须从收口后的固定源码重建，并进行真实 Host/CLI 和打包态验收。

第二十八轮后续：v2 最终 TOTAL178/PASSED177/SKIPPED0/ERROR0/FAILED1，rc1。新增独占受害用例 goalRunnerClaimWithoutMechanicalEvidenceDoesNotComplete 复现声明单独自动完成。根因位于 ModelAgentLoop：任意 allowed 工具都增加 successfulToolCalls，包含 update_goal，声明本身因而被 GoalRunner 用作机械证据。修复排除 update_goal 的进展计数，工具结果仍正常结算；公共工作区保留并发 LSP 排除及结构化结果修改。私有候选从 HEAD model_agent.cj 仅应用本批排除，未吞 LSP 共享修改，启动 v3 178条回归等待终态。
v3 终态：TOTAL178/PASSED178/SKIPPED0/ERROR0/FAILED0，rc0；正向同轮 todo 证据+日志 claim 完成，反向仅 claim 不完成。五个目标源码/测试逐字哈希与候选一致。model_agent 使用 HEAD 派生候选只提交 update_goal 排除，不带并发 LSP 结果与计数改动；局部回归不替代最新 Host/CLI 产品验收。

## 第二十九轮：固定提交重建与LSP完成证据复验

6b82c03 已推送 refactor/dsh-learning。git archive 导出 core/apps/host 到 fixed-host-6b82c03 前缀私有目录，source-sha.txt 记录完整提交，独占TEMP/TMP直接 cjpm build，未叠加公共未提交实现或改配置；执行句柄92562，尚无终态。不能以核心 warnings 输出替代 Host 构建成功。

复核 model_agent 未提交差异仍包含 LSP 只读/rename预览不计进展及 structured 失败结果直传。将该文件与现有 lsp_contract_test 加入178条隔离候选复跑；为避免额外纳入整个 model_agent_test，私有测试仅将三个流夹具 AgentChunks 构造改用已存在的等价 RunnerChunks（相同 Provider/Resource 接口与序列），生产源码未改夹具。lsp-goal-regression.log / exit.txt 记录终态；执行句柄40499，未预报通过。真实语言服务器和页面消费仍缺，此批只验L1契约。
第二十九轮终态：LSP38条加入目标与相关回归178条后，TOTAL216/PASSED216/SKIPPED0/ERROR0/FAILED0，rc0。覆盖无服务器非语义回退、扩展路由、注销迟到结果、参数与位置校验、rename预览不落盘、诊断进入模型但不提供GoalEvidence、结构化失败内容。model_agent生产文件与隔离候选SHA一致；本批吸收已验证LSP计数排除与structured结果直传，不宣称真实语言服务器可用。

## 第三十轮：绑定供应商修订的凭据重试核心

新增ProviderRegistry.saveCredential：非负明确修订、有限非空值；注册表写租约内重放并核对修订、按供应商派生引用，凭据写入后释放。禁止调用方指定任意引用，配置变更/缺供应商/租约占用/无修订拒绝且不改密钥；成功不重写注册表。独占TEMP回归新增一条含上述多个断言，首次夹具coreTestRoot误传参数导致编译失败（零Summary），修正后v2实际TOTAL217/PASSED217/SKIPPED0/ERROR0/FAILED0，rc0，源码哈希匹配。CredentialStore现有明文文件提供方及自身写入并发/持久性边界不因此升级。

models-guard修订校验从isInteger改isSafeInteger，拒绝浮点精度丢失后冒充CAS版本；model-revision-precision专项1/1，rc0。该批仅核心方法与IPC守卫，不宣称Host/IPC/页面重试已接通，下一步有限provider credential动词及独立重试UI，不重写配置。

## 第三十一轮：凭据重试接线与页面状态回归

工作区新增model/registry/save-credential有限Host动作（供应商ID/expectedRevision/key严格三字段，turnBusy拒绝，不回显秘密）、独立IPC模块/preload；首次models-save凭据步骤也绑定配置成功回执修订。适配器将部分成功的configurationRevision传给页面，页面显示仅重试密钥，草稿快照变化拒绝旧重试，不重复写配置；新模块列入package files。尚未提交共享入口或产物。

模型首次保存绑定/冲突保留与IPC及适配器专项11/11 rc0。新增provider-credential-retry-state两条执行真实Page.setup/render事件，使用最小Vue接口夹具：不修改草稿时只调用一次saveCredential且沿回执revision=2，后续编辑时零凭据写入，两者均仅一次配置写入；2/2 rc0。这是页面状态层证据，不是Electron渲染或真实Host请求。

Host候选从13d967d提交归档覆盖已终态的旧私有构建目录，仅增本批Host模块、main的5行分派与声明；复用缓存，build-credential.log/exit.txt，句柄54820尚待读终态。另一固定6b82c03构建92562仍在运行，不改其文件、不杀进程、不将任一未终态宣称通过。公共Host和安装包尚未更新。
第三十一轮补充：模型页面组合首次28项17通过11失败，esbuild无法解析Vue；私有loader给build显式nodePaths后24项21通过3失败，不能记全绿。其中两条模型表单行为断言需继续定位，models-validate导入buildSync仍需私有wrapper导出。未改公共依赖/锁文件，未将进程shell返回码当测试通过。

第三十一轮页面复验收口：私有esbuild wrapper补buildSync与Vue定位后，model-center旧新增夹具须等待onMounted内部异步reload，保存按钮原来仍disabled；增加读取完成断言，等待setImmediate，不放宽生产校验。URL/key测试补必填模型目录。组合实际28/28 rc0。

新增provider-credential-retry-render真实Electron离屏+独立user-data+CSP script-src self，装配实际Vue runtime与供应商页面，点击编辑/保存/重试并派发input；部分保存后一次配置写入，未编辑时凭据调用绑定回执revision=2，编辑后零凭据调用。1/1 rc0；首次run-pItgiX原件及独占retry-electron目录日志保留。测试改用常规require electron后NODE_PATH指向本机已有私有依赖再次1/1 rc0，不把依赖路径固化为测试代码。使用可控适配器，真实Host和打包载荷尚未通过。

第三十一轮提交候选：credential-desktop-candidate从13d967d归档派生main/preload/package仅一条注册/一条API/一条files记录，provider-settings逆掉别组blank模型草稿及model-catalog编辑块，保留其公共工作区原样；独立候选先15/16（未追踪vendor/runtime缺失，Vue undefined），补本机生成Vue runtime并记录vue-runtime-hash.json后实际16/16 rc0，包括真实Electron。不能把依赖补入说成提交态自包含。新增model-credential-retry-host真实协议测试，尚未执行，等54820本批Host终态后指定SACODE_HOST；不得使用旧公开Host冒充新动作通过。

## 第三十二轮：页面工具授权绕行实读

main.cjs pageToolCall仅校验name/args外形，然后executeJavaScript直调渲染注册表handler；page-tools.js将WebMCP execute回此IPC，仍没有核心精确审批/一次性消费/任务取消与日志结算。四个内置handler中clickElement直接el.click，inputText直接改value并派发input/change，scroll改变界面；readState读DOM。宿主来源/会话/文档修订/请求身份没有绑定，不能用“固定四工具”证明所有页面动作只读。原page-tools-ipc十条在独占TMP下10/10 rc0，只证明VM注册表/媒介链工作，不证明授权；本轮没有将其升为全链路统一授权。

下一实现须沿用共享精确ApprovalDesk与权威工具契约，把窗口/会话/任务/请求及参数提案绑定到核心票、取消与结算；迟到结果/页面切换不得转送另一会话。不能仅让渲染层自报needsApproval，也不能只关闭按钮后宣称能力完成。公开载荷更新前仍列P0缺口。两个Host构建54820/92562仍可轮询且LLVM CPU增长，未重启或替换公共二进制。
第三十一轮候选纠错：固定HEAD Host没有工作区拆分后的handleRpc1，首次候选.Replace未检查锚点，实际只更新声明、未增加分派。54820即使编译成功也不证明新动作可调用；已生成基于HEAD原providerSurfaceRequest和实际配置分派条件的修正源码host-main-corrected.cj，两个锚点均显式拒绝缺失。当前活构建不改文件，终态后再应用修正并验真实RPC；不能把等待中的候选当完成。

## 第三十三轮：凭据独立重试真实 Host 与前端候选验收

修正后的 HEAD 派生 Host 入口使用 providerSurfaceRequest 与实际配置分派条件接线，私有 credential-host-debug-candidate 执行 cjpm build -g --jobs 1，build.exit.txt=0。该调试构建不替代正式发布构建；旧的两份 release 构建仍有存活 LLVM 子进程，本轮未停止或重启。

复制既有载荷的 DLL 与 CA 到私有 runtime-bin，未替换公开 Host。独占 TMP 下 model-credential-retry-host.test.mjs 真实请求 1/1、rc0（rpc-test.log）：保存成功、修订不变、读取不回显密钥；陈旧修订、缺失供应商、负修订、额外 ref 与空密钥拒绝，拒绝前后凭据文件一致。

独立桌面候选六文件共17/17、rc0（credential-desktop-candidate/verify-v5.log），含真实 Electron+Vue+CSP 页面、适配器、IPC/preload/清单、草稿变化拒绝旧重试。该页面使用可控适配器，真实 Host 单独验证，尚非安装产物端到端。先前 verify-v3 为 Windows loader URL 调用错误；verify-v4 因 loader 基于 cwd 查找私有 wrapper 而失败，改从产品根执行候选绝对范围后通过，未改生产代码或断言。正式载荷、统一安装包以及其余能力域依旧待验收。

## 第三十四轮：模型注册表与 preload→IPC→真实 Host 联验

同一私有调试 Host（SHA256 6754D8457C330A3679D88CFA909A77B1F0D0E43319C52BB93E1F94A40995825D）在独占 TMP 运行 provider-registry.test.mjs：6/6 rc0，registry-test.log。覆盖注册表读写拒绝、凭据旋转及重启持久化、按配置发模型请求、未支持方言拒绝、草稿模型清单查询与环境凭据只读。模型服务为本地HTTP夹具，不宣称远端供应商协议全覆盖。

增加 model-credential-retry-host 第二条：执行实际 preload 源码，以 VM 的 Electron invoke 桥接实际 registerModelCredentialIpc，处理器请求实际 HostBridge。配置后的凭据保存可达核心；陈旧修订在 Host 拒绝、不安全整数在 IPC 拒绝。两条2/2 rc0，ipc-host-test.log。Electron传输在本条是VM媒介，不能扩大成已安装 Electron 全链路；真实窗口页面另有候选17/17证据。release子进程23372/27900本轮仍存活且累计CPU3125/2191秒，未重启。


## 第三十五轮：真实 Electron IPC 与真实 Host

新增 model-credential-electron-host.test.mjs，实际 Electron BrowserWindow（offscreen、contextIsolation、nodeIntegration=false、CSP script-src self）加载产品 preload；renderer 调用 sacode.modelsSaveCredential，经 ipcMain 的产品处理器与 HostBridge 请求同一私有调试 Host。保存后配置修订仍为1、keyConfigured=true，陈旧修订明确拒绝。1/1 rc0；补显式 bridge.stop 后再跑仍1/1 rc0，未检测到遗留 sacode-host 进程。窗口使用最小检查页面而非完整模型中心；no-sandbox 为本机离屏测试参数，不代表默认安全启动验收。此证据补上实际 Electron 传输，但发布载荷与完整供应商页面实际操作仍待验收。


## 第三十六轮：实际供应商页面保存到真实核心

扩展真实Electron测试，esbuild装配实际 provider-settings.ts 与 model-center-adapter.ts，实际Vue runtime挂载页面，点击编辑、输入密钥、点击保存；通过产品 preload、实际凭据处理模块、models-guard及models-save到同一私有调试Host。保存成功文案出现、编辑表单关闭，Host修订由1升2且keyConfigured=true，私有凭据文件包含页面新值且无被拒绝的陈旧值。独占TMP运行1/1 rc0。测试窗口的describe/catalog/save IPC注册由夹具装配等价转发与生产守卫/保存函数，不加载整个产品main，不扩大为完整主窗口启动或安装验收；独立retry IPC使用生产注册模块。命令使用本机私有model-render-loader解析esbuild，生成Vue runtime为既有构建文件。


## 第三十七轮：修复内置供应商密钥被静默忽略

实际页面对 credentialWritable 内置供应商显示密钥输入，但适配器 declared 分支原先只调用 set-enabled，直接丢弃填写的 key。增加成功与部分失败两条独占测试，先11条/9通过/2失败复现；改为启停成功后凭据单独沿回执revision保存，不发送内置目录草稿。凭据失败只给安全文案及configurationRevision供现有重试，启停失败不会继续凭据动作。适配器与重试状态13/13 rc0；实际Electron页面/Host保存与部分保存渲染回归2/2 rc0（独占builtin-key目录）。内置凭据分支本轮验证为适配器受控API，仍需完整内置供应商真实Host页面场景，不扩大到所有内置提供方已可用。


## 第三十八轮：内置供应商实际页面凭据闭环与来源标识

真实Electron场景参数化为自定义和内置stepfun实例。内置实例由真实Host add-catalog生成，页面编辑密钥经真实适配器set-enabled回执、独立credential IPC落盘；两类均验证保存后revision=2、keyConfigured与实际凭据新值、陈旧写入未落盘，2/2 rc0。没有调用供应商远端API。随后发现declared来源标签反向，修复为内置/自定义并更新内置编辑可保存密钥提示，增加实际DOM来源标签断言，两场景再次2/2 rc0。共享provider-settings仅吸收HEAD派生两处文案差异，其他工作区模型表单变更保留。正式release进程23372/27900本轮仍存活CPU3695/2761秒，未重启。


## 第三十九轮：真实模型拉取契约与目录添加缺口

新增model-pull-host测试，真实私有Host与本地HTTP提供方：Bearer凭据现取、模型ID去重追加且保留原模型、修订递增、旧修订拒绝、401失败不改目录、停止完成后重启读取相同目录，1/1 rc0。初次误按替换目录断言失败，核applyPulledModels→mergePulledIds既有契约后改为追加；第二次未await异步stop造成host-already-running，修正等待真实终态后通过，未修改生产实现。原件独占model-pull目录。

确认provider-settings读取catalog但不消费选择/添加，preload未提供modelsAddCatalog；Host有model/registry/add-catalog但当前核心addFromCatalog不接expectedRevision。下一步需核心受租约保护且带预期修订的目录实例创建→有限Host→IPC→目录选择页面，不能只补无修订按钮。默认模型Host/IPC存在但当前供应商适配器没有选择动作，仍登记产品入口缺口。


## 第四十轮：默认模型产品页面入口

供应商适配器保留defaultProviderId/defaultModel读面并增加modelsSetDefault透传，页面逐供应商显示模型选择，沿当前目录修订提交且成功后回读；禁用供应商/空模型/编辑中/读面未就绪均不可选。真实Electron两种供应商页面保存密钥后选择模型，核心revision升3且defaultProviderId/defaultModel一致，2/2 rc0；适配器默认读写及既有回归12/12 rc0。仍为专用测试窗口与调试Host；测试默认动作注册为夹具直转既有Host，非完整产品main初始化证明。共享provider-settings暂存仅接口/默认状态/回读/选择处理及DOM五hunk，保留其他作者新建草稿/模型编辑两个hunk。未将默认选择等同于当前会话自动切换或真实模型成功。


## 第四十一轮：默认模型拒绝与重启读面

新增model-default-host真实私有调试Host测试1/1 rc0：已有模型默认选择、修订递增，陈旧修订/未知模型/未知供应商拒绝且原默认不变，等待stop终态再重启后默认身份及修订一致。独占default-recovery目录原件。核setDefault当前核心只校验身份和在册模型，未校验enabled；页面禁用供应商不可选不等于核心统一拒绝，记录待修共享规则。当前默认选择是注册表配置事实，不证明模型实际可调用。release进程23372/27900仍存活CPU4379/3442秒，观察未终结不重启。


## 第四十二轮：禁用供应商默认选择共享规则

ProviderRegistry.setDefault加入enabled拒绝，避免页面守卫被直接Host/CLI绕过。新增测试覆盖已选默认→禁用→拒绝改选且修订/默认不变→重新启用后成功。按已读取CangjieSkills通过search_docs批量查询ExpectThrows/Exception message；复用明确1.1.3 stdx环境，不修改公共配置。首轮218条217通过1ERROR，直跑独占用例定位清理非空目录漏recursive参数；修正测试后私有v2终态TOTAL218/PASSED218/SKIPPED0/ERROR0/FAILED0、rc0，生产与测试两文件哈希同候选。局部核心回归，不是全仓/新Host验收；旧debug Host不含此修复，后续重建后需真实拒绝探针。


## 第四十三轮：目录实例准入与接线在途

新增核心addCatalogInstance：显式非负修订、WriteLease内回放校验及实例创建，凭据名由实例身份派生；SessionLog.flush借用本机持有租约。私有核心TOTAL219/PASSED219/SKIPPED0/ERROR0/FAILED0、rc0。新model/registry/create-instance严格catalogId/expectedRevision两个字段，Host在途轮次拒绝，IPC拒绝额外凭据引用及不安全整数；preload及页面目录选择/添加与适配器已在工作区接入，未提交。IPC+既有凭据真实Host回归5/5 rc0，只新IPC参数守卫已验，新Host目录动作与页面尚未验证。一次错误调用未指定SACODE_HOST/TMP导致旧公开Host与系统Temp失败2条，改为明确私有debug Host及独占TMP后5/5，不归因源码。须固定候选重建与真实目录添加后再提交。


## 第四十四轮：目录添加真实Host与Electron验收

固定HEAD派生Host main三处create-instance接线，叠加本批核心及RPC文件，cjpm build -g --jobs1 rc0。私有runtime-bin沿既有DLL/CA，新Host SHA256 E5952DB2258078F5F1D4519DA5B4F7A219EAA0705AD1BDED013463173CECA14B，不替换公共产物。独占TMP联合model-catalog-instance-host、model-credential-electron-host两场景、model-default-host共4/4 rc0：新实例身份及凭据引用独立、陈旧/未知/额外引用拒绝、跨重启；实际Vue供应商页从空目录选stepfun添加实例，继续密钥与默认选择，状态落核心。另适配器及IPC16/16 rc0。该验收不调用远端供应商且专用窗口部分IPC由夹具装配，发布/完整主窗口未完成。新目录动作是create-instance，旧add-catalog仍兼容但未暴露给本批页面。共享Host/preload/provider页面暂存固定候选或精选hunk，不吸收并发入口重构与新增表单。


## 第四十五轮：完整装配供应商写动作目录刷新

app.js现有modelCenterAdapters装配仅包裹save/remove/reorder/pullModels，新增saveCredential/createInstance/setDefault未刷新输入区modelDirectory。新增执行实际装配段的VM行为用例，初次1条红4≠7；补三动作后与适配器联合14/14 rc0。成功回执和冲突异常均保持且七动作各触发一次目录load，避免部分配置成功或新实例后输入区目录陈旧。此为产品装配段验证，不是完整主窗口加载。app共享文件只暂存HEAD派生单行列表更新，其他会话差异保留。


## 第四十六轮：固定桌面快照与完整UI冒烟失败

固定8b91110 git archive桌面/scripts，packaging-contract3/3 rc0（46入口47文件44依赖边、删项反证）。初次私有依赖目录缺@opentiny/vue-button，未沿用旧组件；快照独立npm install --ignore-scripts --no-audit --no-fund rc0，790包，未改公共lock/依赖。随后pack-vendor/tinyvue/tinyrobot/pages/next-sdk全rc0。使用同本批私有debug Host拷到快照dist，独占用户/会话/TMP、no-sandbox测试模式。完整main --smoke协议PASS、stop forced=false code0；该分支不证明窗口。真正--ui-smoke rc1：preload旧白名单未登记多项已提交API、时间线节点探针缺失、旧测试要求状态筛选但实际[]，随后脚本异常中断。窗口附件及会话目录/搜索多项通过，不以通过数量掩盖中断。原件fixed-desktop-8b91110/full-ui-smoke.log。用户已要求移除日志完整性常驻筛选，不恢复过期UI以满足旧断言；后续更新当前设计的验收契约并定位时间线探针。不能宣称完整窗口收口。


## 第四十七轮：UI契约诊断与固定允许面校正

在8b91110私有桌面只叠加当前未提交ui-smoke测试作诊断，未改变产品源码。该测试有其他会话新增插件真实安装场景，固定Host不支持其链路，出现approval/get-mode -32601及插件点击失败，随后关闭按钮不可达中断、rc1；原件ui-contract.log。不得把这条工作区测试当固定提交验收，也不删除失败场景制造绿。当前工作区已有人调整日志筛选到目录弹窗及trace资源打开，保留作者改动，不整文件吞并。

本批仅修正固定preload显式允许清单：111项从固定源码逐名校验，运行实际preload的VM读到名称和function类型完全一致，额外键拒绝断言保留；候选语法rc0。暂存HEAD派生仅静态清单替换，未带其他新增测试。完整UI与approval模式/插件产品接线仍未收口。


## 第四十八轮：权限模式实际消费缺口与未知工具策略

核现有ModeController只追加mode/mode不持久发布；工作区mode_rpc只返回配置状态，固定Host缺入口。ModelToolRuntime/ToolRuntime未消费ModeController/PermissionPolicy，CLI仅runStreamTests创建独立mode-cli.log，不是真实用户动作。不能把四选项显示等同执行策略。PermissionPolicy原先非固定write工具全部allow，未知插件/部署/Git/完整命令字符串可被误判只读；改为显式已知读工具允许，Plan未知拒绝，Build/Auto/Yolo未知ask，合法已知write原语义保留。新增未知工具/复合命令/空名回归，私有TOTAL221/PASSED221/SKIPPED0/ERROR0/FAILED0、rc0。两源码测试同私有候选，未开Host模式写接口。接线下一步须ToolRuntime支持模式额外审批并走desk精确消费，不能只调用回调绕过requiresApproval=false工具的工单结算；已有静态必须审批工具也不因模式而跳过。


## 第四十九轮：模式接入模型工具与精确工单

ToolRuntime.executeWithApproval新增policyApproval具名参数：策略额外要求审批时，即使ToolSpec免审批，也必须desk.consumeExactForCall；旧工具名票、换参数、无票拒绝，正确票一次性used。ModelToolRuntime读取同会话显式mode/mode，Plan deny先拒绝，ask调用审批并传额外消费标志；静态requiresApproval始终保留。无显式模式旧日志维持原审批规则，尚非四模式全量迁移；Auto分类器、Yolo自主授权与关键动作分级未在此完成。

私有阶段222/222，首次联编额外sandboxRuntime参数属于未提交并发线，与私有Agent构造不匹配；候选仅排除该线。新测试捕获局部var编译拒绝，按CangjieSkills search_docs捕获规则改用let对象可变成员后224/224。补取消及已有写审批保护最终TOTAL226/PASSED226/SKIPPED0/ERROR0/FAILED0、rc0（mode-integration-v4）。Agent HEAD派生候选与已测源码除换行一致，model_tool_runtime提交私有已测不带沙箱版本；未改公共并发内容。Host模式持久入口与CLI真实用户动作尚待接线，新产物亦未重建。


## 第五十轮：模式切换持久屏障与失败冻结

ModeController新增setDurable，先核写租约与未冻结状态，再设置及durableCheckpoint；只有发布成功返回committed/noop。无租约不追加，非法值拒绝，重复设置及重启回放通过。current读取冻结状态拒绝，ModelToolRuntime冻结会话先拒绝，阻止失败发布后内存中的更宽模式继续执行。新增真实File.writeTo制造磁盘前缀分叉，切换yolo持久失败、日志冻结、模式读取拒绝、工具结果session-persistence-unsettled。私有首轮227/227，新增故障后TOTAL228/PASSED228/SKIPPED0/ERROR0/FAILED0、rc0（mode-persistence-v2）。Host新approval_mode_rpc模块已起草严格模式参数与持久调用，尚未编译/接入口，不纳此提交；旧工作区mode_rpc不替代新持久链。


## 第五十一轮：Host模式有限持久入口与LSP只读判据

固定018dad7派生Host增加approval/get-mode及set-mode分派/声明；读取未持租约时重载当前会话，切换取得写租约、loadForWrite、调用严格单字段mode模块及核心setDurable；在途只允许get不放行set。私有cjpm build -g --jobs1 rc0，新runtime沿既有DLL/CA不替换公开Host。approval-mode-host真实请求1/1 rc0：四枚举持久切换、noop、错型/额外字段/未知模式拒绝且事件不增、pending0、重启plan回读。没有真实模型工具请求，不扩成全执行四模式验收。

前端权限菜单14/14、实际IPC处理器模式4/4为本地组件/VM范围。发现Plan安全名单遗漏LSP，补七个readonly语义工具含rename预览（真正写文件仍需F08），新核心最终TOTAL229/PASSED229/SKIPPED0/ERROR0/FAILED0、rc0；该补丁晚于本Host快照，产物还不含此LSP名单。Host main只提交已编译HEAD候选，工作区分派重构与旧mode_rpc保留，不吞并。CLI、跨会话迟到操作身份绑定、Auto分类器与Yolo授权边界仍待实现/验收。


## 第五十二轮：权限菜单真实Electron与Host回读

新增approval-mode-electron-host，实际PermissionMenu/Vue/CSP/preload，真实BrowserWindow隔离上下文，无nodeIntegration；点击Plan/Auto/Yolo/Build/Plan，菜单等待实际Host读回才关闭，最终Host停止完成后重启读取Plan。独占TMP运行1/1 rc0。IPC在专用测试窗口装配具名模式转发及合法枚举守卫，不是完整main启动；已有主进程守卫由此前4条VM证明。使用--no-sandbox离屏测试参数，不扩大为默认安全启动；未请求模型工具，不证明四模式全部执行语义。新测试沿实际Host模式持久接口，无假模式回执。


## 第五十三轮：CLI模式命令与Host共享事实

新增sacode mode get/set四枚举，明确消费当前工作目录session.log；写获取同一WriteLease、重载日志、ModeController.setDurable，读不写文件。模式命令不使用旧自测mode-cli.log。固定5af2980派生CLI冷编首先报WorktreeRef具名参数后位置参数不合法，改value!:使已有value:调用合法（工作区作者已有同修复，仅吸收该行）；其次旧main流自测ModeController(log)引用未定义log，按自测局部SessionLog修正，并补新命令std.env.getStdErr导入（已search_docs确认包）。v3 cjpm build -g --jobs1 rc0。

新CLI私有runtime沿既有DLL/CA，approval-mode-cli-host真实命令1/1 rc0：读取Host所存Plan；Host持租约时CLI写rc5且日志逐字不变；非法命令rc64不落事件；Host退出后CLI Build提交/noop，Host重启读回Build。独占TMP及双二进制不替换公开载荷。仅当前目录session.log模式动作；--resume及远端模式路由仍待扩展，未宣称所有CLI会话入口模式完整。

共享main/worktree只提交已编译HEAD派生候选，不吞并工作区重构。


## 第五十四轮：完整产品主窗口模型中心定向验收

新增model-center-main-smoke，复用产品createWindow/preload/main实际IPC/真实Host，不注册夹具处理器。从设置导航点击模型中心→供应商标签→选择stepfun添加实例→编辑密钥保存→默认模型选择→关闭设置，bridge直接核权威实例、keyConfigured与默认身份。8b91110固定桌面重建资源+模式私有Host；首轮漏点默认模型分类下的供应商标签而超时，加入真实标签点击后PASS rc0（model-main-v2）。新增SACODE_UI_SMOKE_SUITE=model-center定向分派后原main --ui-smoke再跑PASS rc0（v3），全新会话/用户/TMP。未替换全部UI套件的通过判据，其他套件依旧待修；不声称全部UI通过。

新的支持脚本纳入既有test-support/**打包范围，原ui-smoke仅提交HEAD派生一行分派，其他会话测试变更保留。运行--no-sandbox属当前测试环境，未完成默认安全启动或安装包验收。未调用供应商远端模型。


## 第五十五轮：新增自定义供应商主窗口落库

审计固定HEAD空草稿仍declared=true且无模型ID输入，新增误走内置启停。工作区已有其他会话的两处补全（空草稿declared=false/初始模型、模型ID/名称及增删行），本轮逐差异确认后仅叠加此文件到独立桌面候选重编pack-pages rc0，不重复重写。扩展完整main定向验收：添加主窗口自定义供应商，填写ID/name/baseUrl/key/modelId/modelName并保存，真实Host核declared=false、keyConfigured、modelID及既有默认不变，MODEL_MAIN_SMOKE PASS rc0（custom-main.log）。无远端模型请求。

工作区model-center页面及适配器联合27/27 rc0，含新增草稿与字段提交两测试、已有装配/安全校验。本批吸收上述已验收表单差异及对应测试，之前不吸收它们的在途边界现按实测解除；不吸收其他未完成路径。完整默认安全启动和安装包仍待验收。


## 第五十六轮：供应商删除真实凭据清理与保留事实

完整main扩展编辑模型（空密钥仍保留原凭据）和删除，先红deleted-provider-credential-retained，证明旧Host只删配置但页面承诺删密钥。新增核心removeWithCredential：显式修订、注册表WriteLease内重载/校验；本实例独立用户凭据先unset成功再发布配置移除，共享引用或环境来源保留并返回具名结果。凭据清理失败配置不先删除，重试可以完成；发布失败后凭据可能已清理，不能宣称跨文件原子事务。CredentialStore既有文件写并发/持久屏障缺口未被本批解决。

核心首轮230/230、共享与环境232/232、真实目录阻断清理失败并修复重试最终TOTAL233/PASSED233/SKIPPED0/ERROR0/FAILED0 rc0。Host固定候选叠加核心及remove分派，调试build rc0，返回原注册表投影加credentialRemoval；真实请求1/1 rc0涵盖陈旧拒绝、独立删除、共享最后引用清理与环境保留。页面据回执显示清理/保留/未确认，15/15 rc0。重编实际主窗口页面+新Host后此前失败定向套件MODEL_MAIN_SMOKE PASS rc0（deletion-main.log），默认其他供应商保持。不是正式安装或全UI验收。


## 第五十七轮：模型阶段更新及ACP/LSP重新取证

当前提交641cc78。重新检索Host/CLI所有源码和preload，仍无acp/分派或AcpDelegationService实例；不能用team动作证明ACP。AcpDelegationService仅核心及其测试引用，当前工作区文件另有未提交作者改动。create经过gate后写内存索引、启动procFactory/process并协商，未消费checkpoint；其默认checkpoint返回true，尚不能保证启动前委派事实持久及恢复不重复执行。在途容量计数仅running/awaiting-permission/awaiting-input，initializing未计入，属于需并发探针验证的风险，未以源码推测直接宣称已复现。未代改并发ACP文件。

LspRouter有register接口，产品入口仅sharedRouter路由；未见具体语言插件注册，七IPC页面消费仍缺。更新F07/F21首表，移除已完成的配置阶段旧缺口；F07仍保留费用调度/全部协议/当前统一产物，整表不按已修页面数量宣称产品完成。下一实施优先是页面工具统一授权、ACP启动持久准入与真实插件LSP装配，同时固定产物门禁保留。


## 第五十八轮：ACP启动前持久准入

AcpDelegationService默认checkpoint由true改false，创建完成内存提案后、procFactory前强制调用检查；缺失/false/抛异常统一failed+persistence-failed:delegation-create，不构造进程。同请求回原失败条目，不自动重启。新增用例零factory证明及明确true许可后原spawn失败链；既有spawn失败测试显式供测试许可，不假装持久事实。先234/234，加入10条已有委派回归后TOTAL244/PASSED244/SKIPPED0/ERROR0/FAILED0 rc0（acp-admission-v2）。工作区原有sha256任务全文摘要修复与长体冲突测试同时实测通过，吸收这两处已完成差异，不覆盖其他ACP审批文件。

这仍是可信入口注入checkpoint的准入钩子；未实现委派事实写入/恢复投影，不宣称真实持久委派完成。Host/CLI公开ACP入口仍缺，initializing容量与身份绑定等风险仍在，下一步必须实际SessionLog记录不可变提案及恢复不重放。此前Gitee推送失败已终结，本轮重试3e5720f成功，不重启未终态操作。


## 第五十九轮：ACP请求身份与初始化容量

委派内部保存不可变workspace，requestId复用同时核taskDigest/taskId/peerId/workspace；同正文但身份变化明确revision-conflict，不返回别的委派。新identity测试245/245 rc0。容量计入pending/initializing等全部非终态，避免仅running/awaiting计数放过启动中的委派。新增可信checkpoint重入探针：四个初始化预约重叠，第五个busy并未留条目，零factory；最终TOTAL246/PASSED246/SKIPPED0/ERROR0/FAILED0 rc0（acp-capacity-regression）。本轮并发证据为重入初始化重叠，不扩大为多线程实际进程隔离或跨进程协调。仍需真实持久提案与恢复投影、终态记录和完整外部委派入口。

## 第六十轮：ACP持久准入事实与恢复投影

基线跟进至 f0e7cb6a，本地/远端差集0/0。1abe340d为生产警告与资源释放修复，其提交说明保留Host编译超时及daemon原有阻塞；f0e7cb6a为Linux环境变量依赖配置，无Linux产物验收。两提交不改变ACP/LSP产品接线缺口。

新增AcpDelegationJournal，同一SessionLog/WriteLease发布不可变acp/admission：会话、任务、请求、供应方、工作区、任务全文摘要及修订绑定。持久检查成功之前不构造外部进程；发布失败冻结日志且factory为零。恢复只读已发布事实，拒绝畸形和重复请求，重建幂等索引和ID序列，不恢复授权、不启动进程。恢复为outcome-unknown，无进程身份时cancel/close拒绝伪造终态。

私有approval-binding-candidate最终acp-journal-v5.log：TOTAL250/PASSED250/SKIPPED0/ERROR0/FAILED0，真实rc0。三份本批源码与测试候选SHA256逐字相同。候选沿用此前隔离核心快照，并非最新HEAD全量回归；错误相对路径造成v4仍是249条旧集，不能作为新增用例证据。v5为修正绝对路径后的250条。测试覆盖缺租约、真实磁盘分歧导致发布失败、恢复不重放、跨会话拒绝、未知状态不冒充取消/完成、pending事实忽略、已发布畸形及重复请求拒绝。

仅准入事实持久及保守恢复，不含running/终态持久结算、真实session/prompt发送、权限请求回传和内容消费。Host/CLI/IPC/页面公开委派入口仍缺；LSP真实服务器插件与页面消费仍缺。不升级整域完成状态。

## 第六十一轮：ACP关闭不冒充任务完成

核提交态close无条件completed，create尚未调用sessionPrompt，关闭失败准入条目也可覆盖failed。取消/关闭保留已完成、失败、已取消、拒绝、未完成终态，先核预期修订，再原样返回，不改原因/修订。活动连接关闭仅记incomplete及closed-without-task-completion-evidence，不能凭进程关闭证明任务完成。恢复outcome-unknown的既有身份核对保护保留。

新增acpClosingFailedAdmissionCannotClaimCompletion真实服务回归（缺准入授权不启进程），私有acp-close.log TOTAL251/PASSED251/SKIPPED0/ERROR0/FAILED0、rc0。覆盖失败后close/cancel状态与修订不变；活动进程关闭尚无真实提供方证据。仅本批两文件与审计提交，不包含在途ACP审批桥改动。协议drainStdout目前只入ReplyTable，服务onUpdate/onPermissionRequest/onElicitation未装配，必须接请求/通知消费及审批回传后才能开放prompt，不以当前修复声明委派产品闭环。

## 第六十二轮：ACP双向协议帧分类与真实管道探针

参考2026-10-13读取的官方v1协议 https://agentclientprotocol.com/protocol/v1/overview ：请求/回复与无回复通知分开，session/update为通知，session/request_permission为服务端请求。新增AcpInboundFrame/Inbox，JSON-RPC版本、请求与结果互斥、合法ID及参数对象校验，64KiB帧与128项队列上限。服务端请求不进入本机ReplyTable，支持整数/字符串服务端ID；未知请求返回-32601，队列满请求返回具名错误，通知不发送回复。普通本机回复仍按原Int64请求ID配对。

私有acp-inbound.log 254/254；最终acp-inbound-pipe.log TOTAL255/PASSED255/SKIPPED0/ERROR0/FAILED0，rc0。Node v22本地真实子进程管道夹具同时发送与本机请求相同ID的审批、进度通知、未知fs/write_text_file请求，实际读到-32601后回送确认；权限/通知各自可取且unsolicited为零。夹具非真实ACP供应方、不执行文件或模型任务。当前队列尚未消费到审批工单及内容投影，未公开prompt入口，不扩大为委派全链路。

发现旧sessionCancel仍按request等待回复，与当前官方通知契约冲突；sessionResume及close方法亦需与冻结供应方探针分别对齐，不直接改变兼容性假设。入站队列满/畸形有计数，但丢失通知后的任务完整性投影尚待接入；原StringReader.readln的读取前内存上限仍需额外监督。仅新增分类和管道安全接收，不宣称这些剩余缺口已解决。

## 第六十三轮：ACP取消通知与未确认停止

重新核官方 https://agentclientprotocol.com/protocol/v1/prompt-turn ，session/cancel为通知，停止确认来自对应prompt的终止结果。AcpProcess.sessionCancel改Bool发送事实，不带id、不登记ReplyTable、不等待不存在的取消回复；空session和非NDJSON拒绝。委派取消保留outcome-unknown，sent-awaiting-turn-end/send-failed分明；不把管道发送、进程alive=false或缺句柄直接判cancelled，不markIdle开放重启。

私有acp-cancel-notification.log TOTAL256/PASSED256/SKIPPED0/ERROR0/FAILED0，rc0；新增真实Node管道夹具验证取消不含id且准确session，通知后原prompt请求回复正常配对，无额外入站队列或unsolicited。并非真实供应方停止证据。服务终态持久、对应prompt停止结算和初始化期间取消令牌消费仍待接线（当前create未检查cancelled），不宣称启动竞态已闭合；这些缺口继续阻止公开委派入口。

## 第六十四轮：ACP初始化取消准入与工厂重入

新增两独占探针：checkpoint重入cancel后factory必须为零；procFactory重入cancel后不能继续start覆盖取消结果。未修代码acp-cancel-race-red.log TOTAL258/PASSED256/SKIPPED0/ERROR0/FAILED2，rc1，失败恰两用例。修复initializing发布在条目锁内；准入后先检查取消，再允许构造；工厂保持锁外、返回后锁内检查取消/start/发布句柄；initialize和session/new返回时锁内检查取消，取消则收束本次自有进程且保持unknown，不写running。最后checkpoint返回读取锁保护投影，不回陈旧快照。

acp-cancel-race-green.log TOTAL258/PASSED258/SKIPPED0/ERROR0/FAILED0，rc0。私有候选源与本批一致；两用例为同步回调重入，并非多线程真实Agent端到端。初始化RPC在途取消仍受其timeout约束，停止事实/终态持久/审批回传尚未闭合。procFactory注入必须只构造、不执行外部进程；该工厂契约仍需公共装配守卫。

## 第六十五轮：ACP协商结果与顶层回复身份

原create把任意initialize回复当成功，并文本扫描sessionId（空白、转义、嵌套字段可误取），错误session/new也能running。新增acpRpcResult/Initialization/CreatedSession校验：仅合法JSON-RPC response/result对象、远端error拒绝并保留数字错误码、协议version1、顶层非空sessionId。移除文本扫描；阶段失败关闭本次自有进程，取消判断仍先于失败状态覆盖。AcpProcess按已解析顶层ID入ReplyTable，避免旧字节扫描对空白或嵌套id误配。

私有acp-rpc-results.log TOTAL261/PASSED261，最终acp-rpc-results-v2.log TOTAL262/PASSED262/SKIPPED0/ERROR0/FAILED0、rc0。四种真实Node子进程错误/版本/空会话场景均failed，协议ID实际管道响应含嵌套id=999及顶层空白id=1仍正确配对。纯结果解析覆盖转义会话ID、嵌套伪身份、空身份及初始化错误。夹具非真实供应方，不证明能力协商完整、客户端capabilities装配、prompt/审批/内容/终态及产品入口。候选沿用之前隔离核心，不是当前提交全量验收。

## 第六十六轮：ACP初始化请求与会话参数对齐

官方2026-10-13读取 https://agentclientprotocol.com/protocol/v1/initialization 和 session-setup：initialize发送clientInfo/clientCapabilities（原client错误），当前空能力对象不宣称尚未接线的fs/terminal/elicitation；session/new canonicalize成绝对cwd并发送mcpServers=[]，无效目录不发请求。旧10月8日探针脚本同样使用client字段，历史输出仍保留，但只能说明当时供应方宽容接受，不证明正确契约。MCP服务注入、可选session能力消费仍待插件/授权装配。

新增真实Node管道验证clientInfo、空能力、无client别名、绝对cwd及空MCP数组；首轮测试误把init关键字当变量导致编译失败（无Summary，不作通过读数），改handshake后acp-handshake-contract-v2.log TOTAL263/PASSED263/SKIPPED0/ERROR0/FAILED0、rc0。该测试不调用真实模型或远端认证，不证明真实委派。核心初始结果目前只校版本，不完整验证/保存agentCapabilities、authMethods，必须继续补协商投影与认证/能力门控后接产品入口。

## 第六十七轮：ACP可选关闭能力与会话绑定

按官方session-setup可选close契约，原close无协商且params={}违反协议。初始化结果读取agentCapabilities.sessionCapabilities.close对象声明，未声明/非法/协商失败禁用；session/new仅保存JSON验证成功的身份；关闭仅有声明且有非空身份时带sessionId发送。进程重新start清空旧能力与会话，状态访问独立互斥。未声明时只收束本机进程，保留forced/退出事实，不造协议成功或任务完成。

acp-close-gate.log 265/265；补重启状态清空后acp-close-gate-v2.log TOTAL265/PASSED265/SKIPPED0/ERROR0/FAILED0、rc0。真实Node管道两分支：支持则日志实际出现session/close并检查fixture身份；不支持则日志不出现，子进程自然退出。纯契约覆盖合法声明、缺声明、非法boolean声明。重启完整通讯及session/list/resume/认证等可选能力门控仍未完成；不升级ACP产品全链路，不含最新提交全量核心或真实供应方验收。

## 第六十八轮：审批桥遗留差异纳入与当前固定基线

当前f6f8b4973d2dd7ad62f5c3154322627d7db38f50经git archive core/extjs建立只读current-core-f6f8b4973d2d，source.zip SHA256 EF0D16898BAEA1135DF1BE798F5AFD3D0591B8027CE618519708C06D98B9D485。启动私有TMP完整cjpm test --no-color --no-progress --parallel1 --timeout-each=30s，full-core.log/full-core.exit.txt；记录时cjc PID21032仍活、CPU157.83，无Summary，不记通过，不重启。

跟进工作区ACP审批两份遗留：bridge批准此前未desk.answer，直接consume pending导致合法批准失败；补answer后精确一次性consume。测试用对象假钟代替逃逸lambda捕获var，补used与二次批准拒绝。逐hunk核对并吸收已完成修复，不吞并其他共享路径。此前私有265集未包含acp_approval_test且其bridge仍HEAD原版，本轮曾口头误说包含、已立即哈希核对撤回；265不能证明审批桥，旧专项范围不扩大。

将这两份实源复制专项候选，acp-approval-included.log TOTAL275/PASSED275/SKIPPED0/ERROR0/FAILED0、rc0，增加恰10条审批桥。工作区bridge SHA256 0EFCFFEF544948392A5A8D8078DB3816E1725C561D26C9BFF02837AEF4F59DF1，test 8AB1504E305023ABD14EAF21112DB31B2FE10C122D82ECF14D883AD8D5072475。仅审批桥进程内行为，未证明委派身份/会话/修订绑定、持久审批及真实协议回传；pendingFor仍返回全局pending，elicitation为未接线入口。当前全量基线结果必须后续单独结算。

## 第六十九轮：ACP审批委派身份与修订约束

AcpApprovalBridge构造核会话相同，ask仅接受已有运行/等待审批委派与非空协议会话；工单保存发号快照。allowed-once在AcpDelegationService共用状态锁内核会话/任务/请求/供应方/协议身份/修订与取消令牌，再desk.answer及精确消费，失配不放行并拒绝旧pending票。pendingFor仅数本桥对应委派且实际pending，不把别的委派或会话工单算入。

旧10条单测补显式核心运行态夹具，不宣称真实进程；新增4条覆盖不存在/非活动/跨会话发号拒绝、委派独立待决数、修订/协议身份变化拒绝、取消令牌使旧票失效。acp-approval-scope.log TOTAL279/PASSED279/SKIPPED0/ERROR0/FAILED0、rc0。取消竞争批准由共享锁约束，尚未有多线程实际协议发回竞争探针；批准后外部回传必须继续绑定原请求身份，不能以该核心验收冒充产品入口。审批事实持久屏障、elicitation伪成功、请求options与一次性回复绑定仍待补。

固定f6f8b49全量核心仍无Summary，tool session64903保持运行；记录时cjc21032 CPU已从157.83到471.45秒，不能因为日志未增长重启或登记通过。此全量源码不含后续审批修复，终态后必须明确其基线。

## 第七十轮：固定核心回归的编译阻塞与单行修复

固定f6f8b4973d2dd7ad62f5c3154322627d7db38f50完整冷编已终态，full-core.exit.txt=1，无Summary。full-core.log两编译错误恰为acp_approval_test.cj:109 fakeNow逃逸lambda与worktree_setup_test.cj:153 longName逃逸lambda。前者后续2a7e974已修；后者工作区已有frozenLongName修复，另有私有TMP改动不属于本批，不整文件提交。

从HEAD worktree_setup_test生成仅该不可变变量hunk候选，复制到专项集后编译及--filter wsTEntriesRejectExternalPathsAndDotDotSegments；worktree-compile-probe.log TOTAL286/PASSED1/SKIPPED285/ERROR0/FAILED0、rc0。仅1条拒绝越界/超长条目用例运行，不能登记286通过。使用HEAD派生blob暂存，该文件TMP改动保留工作区。当前固定全量未通过，需新提交重新验收。

本轮开头识别的elicitation合法决定伪成功仍待实施，未把计划当已修。全产品ACP/LSP与统一桌面载荷缺口保持，不能因专项测试升级完成状态。

## 第七十一轮：未接线elicitation不冒充成功

原answerElicitation对submitted/abandoned/expired调用空onElicitation并true，无法证明记录或回传。现在未建立请求绑定/回传通道时false；服务直接调用抛unsupported:acp-elicitation-not-connected。初始化声明clientCapabilities={}，入站elicitation/create据未支持能力返回-32601，不进入待决队列。保留完整信息表单实施需求，这只是先消除伪成功，不把禁用当能力完成。

acp-elicitation-fail-closed.log --filter acp*：TOTAL287/PASSED47/SKIPPED240/ERROR0/FAILED0，rc0，仅47条运行。真实Node管道收到未声明的elicitation/create后获得错误；无待决表单/回传的合法决定均false，服务unsupported明确。非真实供应方/页面/Host验收，不登记287通过。固定31b4a79完整核心仍在编，session94520、cjc21996，未有Summary；不重启、不同基线结果不混用。

## 第七十二轮：ACP权限选项与一次性原请求回传

按官方tool-calls权限结构，新增AcpWirePermission解析会话/toolCallId/options，拒空/重复/未知选项、最多32项；allowed-once必须显式匹配allow_once，denied匹配reject_once，取消使用cancelled outcome，不选首项、不把allow_always降级伪装一次。新增AcpPermissionReplies绑定进程代际、请求ID和原始提案，128项上限；缺批准回调不消费、不发送，写失败先消费禁止自动重发。AcpProcess内部replyPermission再核当前协议会话，只有已登记原请求可以回复，不开放任意写RPC。启动清理待决与队列，旧reader携带原代际，旧授权不能跨新进程复用。

acp-permission-wire-v2.log --filter acp*：TOTAL291/PASSED51/SKIPPED240/ERROR0/FAILED0，rc0。真实Node管道完成initialize/session-new→两权限请求→一次批准/一次拒绝→原prompt确认，默认无权威回调拒绝、永久选项拒绝、改提案拒绝、重复回传拒绝。纯探针覆盖写失败消费、拒绝后再批准、跨代际旧回复拒绝与旧reader拒入。批准回调在测试中显式为夹具许可，尚未对到实际ApprovalDesk/持久屏障/Host用户工单，不称真实授权产品闭环。新增核心契约文件登记本轮；未接真模型或供应方。

本批仅权限回传代际边界；整进程restart普通ReplyTable复用及全部RPC竞争仍需独立复核，不能扩成全部恢复可靠。固定31b4a79全量核心session94520仍在编、cjc21996；无Summary，不升级通过。下一步将精确工单与持久批准事实接入该回调，并逐请求结算送达/unknown。
