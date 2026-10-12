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
