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
|F07|模型中心|部分接通|配置/凭据核心、Host 注册表接口、IPC 和页面；本轮定向检查|配置成功密钥失败的阶段回执；完整 Electron IPC 和新产物|
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
|F21|LSP|契约接通／真实语义阻塞|lsp_contract 七 verb；Host 分派；CLI 工具注册；preload 七通道|renderer 定向检索未发现 lsp* API 消费；sharedRouter 语言插件装配待核；真实语义、诊断注入与 rename 审查|

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
