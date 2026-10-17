# 自研核心现有链路验证台账

## 第十二轮收口：五项结论与优先级

本次目标是验证审查，不是修完缺陷或发布验收。以下以分轮详证为依据；“待验”保留，不用历史PASS填充。

| 项 | 当前结论 | 本次运行证据 / 限制 | 后续优先级 |
|---|---|---|---|
| 1 入口/协议/凭据 | Host模型中心可用；CLI环境配置不与模型中心同源，普通会话没有工具schema；daemon复用Host而非另一模型实现 | Host本地真实HTTP；CLI两进程会话恢复1通过；daemon真实授权/转发6通过。远程模型task、CLI goal实际工具链仍待验，非completions协议明确拒绝 | P1统一共享装配与支持边界；不另写Agent循环 |
| 2 SSE/工具/路由 | 工具分片、两实例独立凭据/步骤轮询、健康冷却、零预算拒绝、500不重发有证据；静默流取消失败 | 当前Host整套16项15通过1失败。取消诊断通过是复现缺陷，不是修复；正金额预算、并发预留、复杂failover待验 | P1先修有界取消并核连接/Reader/账本清理；再补预算与失败策略矩阵 |
| 3 上下文与压缩 | 累计usage预算/事后占用提示存在；当前请求未应用已保存窗口/输出上限；CompactionLedger只是记录 | 限制设1仍发送全文且无输出上限字段，诊断通过。未证实有摘要执行器/请求投影接线 | P1统一请求预算计划与可回放摘要，保留原日志 |
| 4 MCP | 真实stdio客户端源码存在；无生产模型工具桥；schema/参数构造/逐调用授权/有界关闭存在接入前缺口 | 本次完成静态调用链与既有测试覆盖审查，未取得MCP单测运行PASS | P1接入前补schema与参数/生命周期回归，再复用统一授权接桥；不引外部框架 |
| 5 隔离代码任务 | 模型read→精确审批edit→文件变化→驱动语法检查/真实单测→冷启动不重发通过；待审批取消后无修改、不补执行 | 本地合成模型，子单测1通过；命令由测试驱动执行，不是模型自主shell构建。真实仓颉工程/系统沙箱/安装态任务仍待验 | P1把当前合成回归作为修复闸；P2另授权真实任务/平台验收 |

核心整包`cjpm test`任务pwsh-598长时间停留test-only编译，CPU累计增长，本轮主动取消并收集killed状态；不是编译失败或测试失败，也不是PASS，没有单测计数。启动整包之前未充分隔离所有既有夹具是本次操作不足；未重复启动。进程检查已无cjpm/cjc，后续应先完成测试夹具隔离再运行全包。

检查工作树发现三个旧游离测试产物（时间为10月12/13日），未读取其内容、未删除，原样迁入忽略临时根`core-verification-preserved-round12`保留；并非本轮测试遗留，不把整棵dirty工作树算作本目标改动。既有源码改动保持。所有相关后台任务均已收集或取消，无遗留编译任务。未调用真实模型、安装、提交或推送；本目标内未改生产业务代码。

下一阶段建议单独授权：首先处理静默SSE取消与请求预算两项实测缺口，再处理MCP客户端加固与生产桥；每项以红测转绿和资源/日志证据验收，不能仅调大超时或依赖历史报告。此前“已有13个可运行提供方”等过度结论继续撤回；模板条目不是上游可用证明。

## 边界（以下保留分轮过程，状态以收口表为准）

2026-10-15，持续目标第一轮。基线是当前未提交工作区，不是固定提交发布验收。当前只有本会话工作；保留既有修改。不读真实凭据、不发外部模型请求、不修改生产业务代码。本轮CangjieSkills本地副本未找到，未改.cj，不宣称已使用技能；后续仓颉代码排查/编译探针前取得并读取实际README和相关SKILL。

已读需求：[PRD](../product/PRD.md)、[平台要求](../product/platform-and-distribution.md)、[文档导航](../README.md)、[测试规范](../testing.md)。历史进度不作为当前实现不存在的证明。

## 入口核查（静态证据，未运行模型任务）

| 路径 | 已读事实 | 尚待验证 |
|---|---|---|
| Host模型中心 | [model_routing.cj](../../apps/host/src/model_routing.cj)查自定义模型、提供商、健康、凭据、预算后构建AttemptPlan；select明确拒绝非openai-completions；main turn/start引用该类 | 循环中provider factory调用、失败后行为、隔离账户与预算黑盒验证 |
| CLI goal run | [goal_runtime.cj:30–35](../../apps/cli/src/goal_runtime.cj#L30-L35)直接读三个SACODE_PROVIDER环境变量；94–107构造RealSseProvider和GoalRunner。文件未引用ProviderRegistry、CustomModelRegistry或HostModelRoute | 不同入口未达到模型中心配置同源。CLI此命令可有明确独立配置契约，但不能宣称已支持模型中心池；还须核普通task/worktree命令和后续模型步骤是否一致 |
| daemon | [host_proxy.cj:43–68](../../apps/daemon/src/host_proxy.cj#L43-L68)白名单覆盖模型注册、上游、自定义绑定、凭据、task/start和turn/cancel；代理不自行拼模型请求 | 这里只是白名单证据，真实远程身份、params转发、Host环境/设置根和会话归属仍需运行验证 |

## 本轮运行证据

命令（仓库根）：

```powershell
node --test apps/daemon/test/remote-capability-contract.test.mjs
```

实际退出码0，15通过/0失败/0跳过。覆盖方法唯一性、权限与scope、白名单/契约/声明能力集合一致性。这是静态契约测试，不是daemon启动或模型请求通过。

## 现有测试风险（不重复开发前先核）

[host-routing-real.test.mjs](../../apps/desktop/test/host-routing-real.test.mjs)是外部模型测试，读取真实凭据并调用StepFun，本目标不执行。该测试登记模型只含text输出和available，未声明tools/stream，而当前HostModelRoute要求text-output/stream/tools，历史通过不能证明目前仍会通过。应另找/补本地合成服务测试，且测试按Host/models归属，不因使用HostBridge而归desktop。

[remote-method-surface.test.mjs](../../apps/daemon/test/remote-method-surface.test.mjs)需真实daemon和Host产物，含旧绝对DLL路径默认值。后续必须新构建并显式指定依赖，不能直接沿用私有dist或读到二进制就当新产物。

## 下一轮

1. 获取技能固定版本并读取README/相关技能；查现有本地SSE合成驱动、Host路由账本测试与构建配置。
2. 新构建前检查cjpm/cjc进程（本轮未发现占用），构建完整工作区并明确退出码，不靠PowerShell stderr提示判失败。
3. 以隔离设置根和本地合成服务运行Host模型中心最小请求，核工具/流能力筛选与SSE终态，不使用真实账户。后续补取消、故障和预算。

目标五项仍未全部验证，保持活跃，不标完成。

## 第二轮：新构建与本地真实发送

- 技能来源：`https://gitcode.com/Cangjie-SIG/CangjieSkills.git`，版本`277f2e1234ca5217496966887243c679653887a8`。已读实际README和`.agents/skills/cangjie-coding/SKILL.md`，未执行安装或stdx自动配置；项目已匹配1.1.3/1.1.3.1，不套用技能默认1.0.5。未修改.cj。
- 根目录`cjpm build`原生退出码0，日志结尾`cjpm build success`，全workspace生产构建通过，有warning；不以PowerShell的stderr格式判断失败。实际输出为`target/release/bin/{host,cli,daemon}.exe`，不是之前假定的成员目录main.exe。
- 用新产物组装私有Host到统一临时根`host-model-verification/host-round2`，运行库来自项目stdx与本机SDK，pack退出0，91个文件。没有覆盖正式desktop dist。
- 新增[Host本地路由测试](../../apps/host/test/models/local-routing.test.mjs)。仅绑定127.0.0.1，子进程环境白名单排除真实提供方变量，使用明确无效合成凭据、独立设置根，结束删除自有会话夹具。

复现（仓库根，先按当前SDK路径组装独立Host）：

```powershell
cjpm build
# 在不存在的专用输出目录运行pack-host；输入为target/release/bin/host.exe及已匹配stdx/SDK运行库。
$env:SACODE_HOST = (Resolve-Path 'apps/desktop/.tmp-test/host-model-verification/host-round2/bin/sacode-host.exe').Path
node --test apps/host/test/models/local-routing.test.mjs
```

实际退出码0，3通过/0失败/0跳过：

1. task/start自定义模型经实际POST `/v1/chat/completions`，收到分段SSE并形成完整文本；请求确实含模型ID、stream和工具目录。
2. 不存在的自定义模型明确拒绝，服务端收到0请求，没有退回其他配置。
3. HTTP500本次结算为中断，仅1次请求，预算预留释放。这里只证明本次不自动重发，不等于有另一个有效候选时的完整故障切换策略已验收。

仍待：工具调用增量、流中取消、多个实例/健康/预算及恢复；CLI与daemon黑盒、压缩接线、MCP和读改构建闭环。现有测试源码不重复实现业务逻辑；未修改生产代码、未发外部模型请求、未提交推送。技能获取、构建和本地测试后台任务均已收集退出结果。

## 第四至五轮补记：取消失败优先于此前PASS

第四轮全套结果为11通过/1失败（退出1），不是12通过：新加的工具能力缺失、非Chat-Completions协议、缺凭据均在发送前拒绝；冷启动保留自定义模型和待核算记录且不重发。取消未在轮询期限内结算。

第五轮同一旧测试单跑曾通过，提示时序敏感。强化测试要求Host先回传首个文本帧，再等待200ms发取消；初版误读运行态text（该字段只在终态出现），已改为实际frames握手。修正测试后定向运行再次失败，错误为“本地模型回合未在期限内结算”，总耗时约18秒含清理。保留红测，不增加超时、不标skip。

```powershell
$env:SACODE_HOST = (Resolve-Path 'apps/desktop/.tmp-test/host-model-verification/host-round2/bin/sacode-host.exe').Path
node --test --test-name-pattern='活跃流取消' apps/host/test/models/local-routing.test.mjs
```

源码证据：[sse.cj:148–217](../../core/src/sse.cj#L148-L217)在同步body.read前后检查取消，read本身未在所读函数内被token唤醒；open默认readTimeout为30秒。[Host取消入口](../../apps/host/src/main.cj#L2028-L2053)调用handle.cancel并返回请求事实，不保证退出。当前证据支持“等待静默流下一块数据时取消无法在本测试期限内结算”；最终因果仍需追handle.cancel和SDK HTTP关闭语义，不把代码模式等同完整根因证明。

优先级P1：应在不削弱TLS/不重放请求的前提下设计可唤醒阻塞读取或有界监督机制，验证取消后的连接关闭、Reader退出、资源清理和账本结算。生产修改仍需用户授权。本轮仅修测试并记录，不修改业务实现。目标其他项继续推进，不因一个产品缺陷把整个审查标blocked。

### 取消对照与预算语义续核

新增诊断对照定向执行`--test-name-pattern='取消诊断对照'`，退出0，1通过（约0.81秒）。Host先交付首文本帧，等待200ms后取消得到cancelRequested=true；再等300ms仍未settled；服务端主动end响应后，Host结算cancelled=true，仅1次请求。该对照通过是缺陷证据，不是取消验收通过，原严格红测保留。

[TurnHandle.cancel](../../core/src/cancel.cj#L198-L220)只执行token.cancel和future.cancel；[TurnToken.cancel](../../core/src/cancel.cj#L33-L61)只设置原子标志。结合静默失败/服务端关闭即结算的对照，取消请求已进入，但阻塞读取未及时返回是当前主要解释。SDK跨线程关闭是否安全、读取超时行为仍需精确API核实，不能直接跨线程调用非线程安全对象。

预算分层补充：[TokenMeter](../../core/src/meter.cj)是会话累计用量账本，GoalUsageMeter重放后检查是否超额；不是发送前的上下文窗口估算或摘要。[tips_surface.cj:62–80](../../apps/host/src/tips_surface.cj#L62-L80)读取默认提供商的contextWindow并在回合结算时记占用采样；该提示面存在不证明自定义模型选路对应窗口预算已进入请求组装。自动压缩与请求预检仍待接线核查，不能说没有任何token预算，也不能说已有上下文压缩闭环。

## 第十一轮：完整回归与待审批取消

当前整套Host本地验证运行退出1：**16项，15通过/1失败/0跳过**，约22.32秒；子Node加法测试另1通过，不累计进父集成用例数。唯一失败仍是静默活跃SSE取消，约17.81秒后达到轮询期限，未扩大期限或skip。

新增待审批edit取消通过：先显式绑定隔离工作区，模型read后发edit请求并进入审批等待；turn/cancel后回合cancelled=true、pendingToolCalls=0，原文件未改；重启Host、读投影后仍未改、上游请求仍为2。说明审批等待取消链可用，不代表网络阻塞取消可用。

通过技能查询脚本分别检索HttpResponse close与Future cancel：返回前者可关闭未读完body连接释放资源，后者为“发送取消请求”；检索未匹配thread/safety与IO关键词，没有获得跨线程安全或可中断同步read保证。仅据此提出跨线程close修复并不充分，仍需匹配1.1.3.1 SDK实现/探针，不能将技能默认文档版本当已核SDK。

复现整套：

```powershell
$env:SACODE_HOST = (Resolve-Path 'apps/desktop/.tmp-test/host-model-verification/host-round2/bin/sacode-host.exe').Path
node --test apps/host/test/models/local-routing.test.mjs
```

核心整包任务pwsh-598仍在test-only编译，CPU累计持续增长，无测试计数，不登记PASS。剩余收口工作：核该任务最终结果/夹具清理，汇总五项结论与证据限制、优先级；不因发现产品缺陷自动扩权修业务。

## 第十轮：隔离read→审批edit→实际测试→恢复

定向运行Host本地测试`--test-name-pattern='隔离代码闭环'`，最终退出0，父集成1通过/0跳过；子Node真实单测“加法”1通过，语法检查退出0。

夹具创建有错误的sum.cjs，由合成模型SSE先调read，再调edit；收到approval/asked后核对精确参数并allowed-once；磁盘从a-b变a+b。测试驱动（不是模型/Host shell）实际执行`node --check sum.cjs`和`node --test sum.test.cjs`，重启Host后投影存在且上游请求数仍为3。临时源码/日志随后清理。

中间失败如实记录：最初未绑定会话工作区，read/edit得到unregistered-tool，未收到审批。源码[main.cj:1922](../../apps/host/src/main.cj#L1922)要求显式可用工作区才注册文件工具；补workspace/set-directory后通过，这不是业务修复。第一次子单测继承NODE_TEST_CONTEXT导致Node提示递归运行而跳过，退出0不能当测试通过；改子进程最小环境白名单后重新运行，确有“加法”测试结果。

边界：这是一条合成模型驱动、精确审批的编辑及外部验收链，不是模型自主选择命令/真实模型任务，不是OS沙箱shell执行验收。静默SSE取消红测仍独立存在；没有因为编辑通过抹掉取消失败。未改生产代码、未读真实凭据。核心整包测试任务仍未结束。

## 第九轮：daemon真实授权与Host转发

修正既有[remote-method-surface测试驱动](../../apps/daemon/test/remote-method-surface.test.mjs)：动态夹具改统一临时根并删除前校验父目录；环境改最小白名单，移除个人绝对DLL默认路径。未改业务断言和生产代码。该测试只在隔离本机daemon生成临时设备认证材料，内存传递、不输出/提交，不读取真实用户凭据。

复用第二轮构建daemon.exe，配套运行库单独组装daemon-round9。运行命令：

```powershell
$env:SACODE_DAEMON = (Resolve-Path 'apps/desktop/.tmp-test/daemon-method-surface/daemon-round9/bin/sacode-host.exe').Path
$env:SACODE_HOST_EXE = (Resolve-Path 'apps/desktop/.tmp-test/host-model-verification/host-round2/bin/sacode-host.exe').Path
node --test apps/daemon/test/remote-method-surface.test.mjs
```

退出0，6通过/0失败/0跳过，约6.78秒。包括：运行Host能力覆盖转发白名单；remote initialize；tips/get实际Host响应；model/list缺workspace先拒、带归属可达；credential/set缺management scope拒；session/events由daemon自行处理且未盲转发。

边界：证明本机远程身份/权限/有限方法转发链可运行，不证明远程task/start已发送模型、金额授权或断连取消通过。测试采用旧有强杀停止流程，不当作优雅关机验收；临时设备票据/凭据随隔离目录清除。后续若测模型请求需显式给予本地合成权限，不降低正式授权规则。

## 第八轮：CLI普通会话黑盒

新增[CLI本地会话测试](../../apps/cli/test/models/local-session.test.mjs)。复用第二轮workspace构建的`target/release/bin/cli.exe`，通过pack-host脚本单独复制到临时根cli-round8（脚本输出文件名仍为sacode-host.exe，但输入明确是CLI，不将文件名当宿主身份），配套SDK/stdx运行库，不覆盖正式CLI分发。

```powershell
$env:SACODE_CLI = (Resolve-Path 'apps/desktop/.tmp-test/cli-model-verification/cli-round8/bin/sacode-host.exe').Path
node --test apps/cli/test/models/local-session.test.mjs
```

退出0，1通过/0失败/0跳过：两个独立CLI进程各执行`--resume current --json <合成消息>`；本地实际请求model来自环境变量，首请求确实无tools字段；第二进程请求保留第一轮user和assistant消息，恢复成功。子进程使用环境白名单和无效合成凭据，只有127.0.0.1服务，结束清理动态目录。

这证明普通会话请求/恢复可运行，也证实它不是工具编程闭环；不能由此推导goal run、模型中心、系统中断或remote已通过。建议先明确CLI普通会话与goal run职责，在同一共享装配层统一配置/工具/预算，而非第三套Agent循环。后续daemon黑盒和隔离读改构建验证仍未完成。核心整包测试仍在test-only编译，任务pwsh-598未结束，未登记结果；不重复启动。

## 第七轮：上下文/输出限制的实际请求证据

定向运行Host本地测试`--test-name-pattern='预算诊断对照'`：退出0，1通过。该PASS表示成功复现缺口，不是预算验收。

将上游contextWindow/maxTokens均保存为`1`，自定义maxOutputTokens保存为`1`并读回确认；提交约1800字符合成文本。Host仍发送完整原文并正常结算，本地实际请求没有max_tokens或max_completion_tokens字段。结论限定当前Host模型中心路径：配置限制尚未作用于该请求的输入预检/输出参数。与[model_request.cj](../../core/src/model_request.cj)直接投影事件、[planFor](../../core/src/model_router.cj#L374-L407)未传这些限制一致。不能用累计用量预算/事后tips替代这个能力。

建议P1：统一生成请求预算计划（实际选中上游窗口、自定义输出上限、必保留的工具配对和权限事实），再生成消息投影；明确unknown与用户显式值，超限需拒绝或受控摘要，不能静默截断原日志。不在本目标内修改生产逻辑。

CLI静态进一步确认：[runCliSession](../../apps/cli/src/worktree_command.cj#L664-L750)使用环境变量providerConfig，直接TurnLoop+RealSseProvider，未传模型工具目录也未进入ModelAgentLoop；系统提示却由builtinTools构造。该会话路径与goal run工具循环、Host模型中心并不等价，不能以“共享core”推导所有入口功能一致。需要黑盒核对并明确支持边界/后续适配方案。

## 第六轮：MCP入口与接入前缺口

静态核查，不当作运行通过：

- Host、CLI、daemon的src中检索McpClient/McpRegistry/mcp调用没有生产构造点；[ModelToolRuntime](../../core/src/model_tool_runtime.cj)全文未注册MCP工具、未注入MCP执行器。[CLI worktree入口说明](../../apps/cli/src/worktree_command.cj#L25-L33)明确未接MCP配置文件加载，相关参数只冻结绝对路径并拒绝，不能称已可用。
- [mcp.cj](../../core/src/mcp.cj)的公开工具命名、资源请求编码和重连策略只见定义与测试引用；不是模型生产桥。旧注册表明示为历史log-only标记。
- [McpToolInfo](../../core/src/mcp_client.cj#L28-L37)仅name/description；[listTools](../../core/src/mcp_client.cj#L289-L321)没有保留inputSchema。不能拿它直接生成正确工具schema。既有测试合成服务也只返回name/description，没有覆盖schema保真。
- [callTool](../../core/src/mcp_client.cj#L324-L368)将工具名与argumentsJson直接拼成请求：工具名未jsonEscapeText，argumentsJson未在该函数验证为对象。现有普通hello参数测试不能排除带引号名称、非法JSON、非对象参数的错误行为。此为静态风险，不声称已造成实际攻击。
- connect只查服务器已登记，callTool未消费ApprovalDesk。后续桥必须显式保存server/rawName身份、schema和效果授权，不能把注册即授权扩大为所有工具副作用可执行。
- [closeProcess](../../core/src/mcp_client.cj#L502-L511)terminate(force:true)后无期限wait；stdout/stderr线程Future未持有，不能证明关闭有界或读线程已退出。现有测试覆盖连接前取消、握手超时，不覆盖调用中取消与顽固进程关闭。

建议顺序：先复用客户端、补schema保真/JSON构造与结构化拒绝/生命周期监督的合成回归，再接共享授权的模型工具桥及有限应用入口。不要引另一框架或只补UI宣称MCP完成。所有生产修改仍需授权。

现有core整包单测已启动（pwsh-598），结果待收集；未在此登记PASS。当前测试驱动会在包cwd生成并清理历史临时夹具，后续应按现行测试规范收口；不将其旧目录方式复制到新测试。

## 第三轮：工具分片、取消、健康与独立实例（历史PASS，取消结论已由上文降级）

继续使用第二轮独立Host（本轮仅修改测试，生产源码未改），同一复现命令最新结果：退出码0，8通过/0失败/0跳过，耗时约1.78秒。不是将三次运行的用例数累计。

新增证据：

- `todo_write`参数由两条SSE事件分片发送，完整参数`{"todos":[]}`进入下一步请求；对应call ID恰有一条tool结果，随后第二次模型请求正常结算。
- 本地服务保持SSE不结束，turn/cancel后回合在6秒上限内结算为cancelled，无需服务端主动发DONE。此用例限本机短流，不能推广为所有网络和工具子进程均有界。
- 同一上游连续三次500后，第四次task/start报route-cooling，本地服务只收到三次请求。
- 同一地址、同一上游model ID的两个提供商实例保持不同凭据引用；两步工具循环轮询first/second合成凭据标签，证明凭据与实例绑定未混淆。认证头不输出。
- 保留有效绑定的自定义模型显式零金额预算在派发前拒绝，收到零请求。未知费率的正预算约束、并发预留、日/月周期仍未验，不能称完整预算实现通过。

所有测试仅有无效合成凭据和本机HTTP，结束清理各自动态会话；后台任务结果已收集，无生产改动。仍待协议/能力拒绝、冷启动恢复、多候选失败策略、CLI/daemon黑盒、上下文和MCP及编程闭环。目标继续活跃。


