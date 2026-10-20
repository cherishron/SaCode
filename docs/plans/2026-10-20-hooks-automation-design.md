# F13 自动化与 Hooks 接入设计（2026-10-20）

> 状态：纯设计建议，未实施、未运行配置加载或Hook/模型/网络任务。仅只读仓库源码，不读取真实用户 `settings.json`；不改 core、Host、前端、共享索引或台账，不构建、不提交推送。HEAD取证为 `f7cef5f4548c71b32e4ce3398209b0be074af80b`，当前含并发改动，以下事实不等于固定候选验收。

## 1. 目标与范围拆分

对齐 PRD F13、AU01–AU08：用户/项目自动化配置、定时/事件触发、历史、暂停/取消；查看用户级磁盘Hooks并标注所属本地Agent；声明不等于加载、更不等于执行；去重与重启错过策略明确，无人值守不免审批。

必须分开三个概念：

1. **Hooks声明/装载**：按宿主格式从磁盘解析事件规则，提供可信范围与所属Agent信息；查看不执行脚本。
2. **触发调度**：Cron、内部事件、获准Webhook等转成有身份、持久去重的触发意图；本身不启动模型或命令。
3. **F13-E自动化执行器**：接收已准入触发，创建隔离的任务/会话，经现有模型工具与执行监督链运行并回写真实状态。本设计定义其接缝，不假设F13-E已有实现或归属交接完成。

## 2. 现状盘点（源码事实）

### 2.1 Hook磁盘解析已经存在，生产装配未接

`core/src/hook_settings.cj:19–27,274–287`：

- 用户路径按当前实现由 `USERPROFILE`、回退`HOME`得到 `~/.sacode/settings.json`；项目路径 `<repoRoot>/.sacode/settings.json`。
- `hookReadObject` 已读文件并区分 unreadable/invalid-json，字段解析有类型检查。
- `loadHookSettings(repoRoot,userFile:...)` 读取两份对象；security整块项目优先、缺时回落用户；先注册用户、后项目Hooks，规则ID形如 `user:事件:组序号:hook序号`。
- 事件、matcher、command/http、env/headers、timeout默认30000、async声明已有解析；未知事件/类型拒绝。
- 本轮在apps生产源码未找到 `loadHookSettings` 调用。core里除定义外的调用落在测试。**正确口径是“解析库已有，Host/CLI/运行实例的磁盘装配与状态投影缺失”，不是“没有settings加载代码”。**
- 目前全量File.readFrom、项目security覆盖、基于位置的ID等是后续装配必须审查的安全/稳定性缺口，不在本次文档任务修改。

这里的 `~/.sacode/settings.json` 与通用设置的数据目录不是可随意等同的接口：`AutomationStore.forScope()` 用 `GlobalAppearanceSettings` 的设置根，显式 `SACODE_USER_SETTINGS_DIR` 对Hooks当前解析路径没有自动作用。集成前需统一由宿主传入解析后的测试/产品路径，不能推断设置环境变量已隔离Hook真实HOME。

### 2.2 Hook注册表/执行器已有，但不等于受控自动化闭环

| 模块 | 已有事实 | 缺口/不能宣称 |
|---|---|---|
| `hook_registry.cj:7–33` | 当前枚举24种事件（含ScheduleFire、工具/会话/工作流事件） | 历史文档写25不作为当前分母；有枚举不等于各入口都触发 |
| `HookRegistry.register/findMatchingRules/dispatch` | ID重名拒绝，matcher空/*/regex匹配，串行调用执行器；Deny/Block优先、Ask次之 | `asyncExecute`只存字段，dispatch没有据此异步监督；日志只有append，不自带持久准入 |
| `HookExecutor.executeCommand` | command经cmd/sh执行，输入JSON，stdout/stderr排空并保留上限，timeout终止，自建临时文件 | 没有统一精确审批/TurnToken取消接口；继承父环境再覆盖env；不能直接做无人值守安全执行入口 |
| Command结果 | exit2→Deny；exit0且完整输出→解析decision；超时/异常/其它非零等可能返回Allow | Allow可能只是“不阻断主操作”，不是Hook成功或副作用已确认 |
| `executeHttp/hookHttp` | URL精确allowlist、env插值双重许可、拒部分敏感头、DNS地址校验与连接固定、禁代理/自动重定向、默认TLS配置、watchdog | 网络/HTTP失败等也可能Allow；已有安全检查不等于整体授权与真实运行验收 |
| `session.cj:420–463` | 生命周期方法创建新HookRegistry并dispatch | 没有装入磁盘规则，记录dispatch不证明任意用户脚本跑过 |
| `schedule/webhook/workflow` | 有事件入口、状态/记录切片及Hook调用接缝 | 不是无人值守循环、认证监听和完整依赖编排器 |

### 2.3 Cron与调度存储：不是从零开始

- `cron.cj` 已有 `CronSpec.parse/matches`：五个字段、数字、`*`、逗号、范围、`*/n`/范围步进、星期0/7、日与星期的组合语义。不是外部cron库。
- 静态可见边界：parse只拒少于5字段；数值/范围边界没有完整校验；某些非支持步进基底可能产生空集合而不报错。`AutomationStore.save` 另外要求正好5段，但不能替代整个cron语义验证。不能将此实现称为完整cron兼容。
- `ScheduleStore` 已有结构化definition-v2、pause/resume/delete、`dueTasks`、`recordFire/updateFireResult/fireHistory`、回放pending屏障。
- 当前 `dueTasks` 用日期字段筛选且跳过pending；不去重“同一逻辑分钟已完成后再次tick”。`recordFire` 的ID基于日志计数，非跨执行者稳定触发键。
- `ScheduleStore.fire(deliveryId,taskId)` 虽接收deliveryId，但当前方法未用它形成持久去重；只分派ScheduleFire，不能拿它代替真实火次准入。
- `AutomationStore.load` 当前仅允许三类schedule事件；新增运行/触发事实需要版本化兼容，不可直接塞新事件使旧加载器整份拒绝。

### 2.4 Host/前端已接配置CRUD，执行器明确不可用

`apps/host/src/automation_rpc.cj:5–30` 及 `main.cj`：

| 通道 | 当前参数 | 事实 |
|---|---|---|
| `automation/list` | `sessionId,scope` | 校验会话、项目归属，读AutomationStore |
| `automation/save` | 上述+`definition,revision` | 模型存在/启用校验；定义9字段，含cron/时区/目录/权限；CAS+WriteLease+flush |
| `automation/control` | 上述+`id,action,revision` | 仅pause/resume/remove；这是配置控制，不是运行取消 |

`core/src/automation_store.cj:31–47` 硬编码 `executorAvailable=false`。pending历史映射unknown。定义允许保存的permission含plan/build/yolo/auto-review，但保存不授予实际执行许可。

`automation-page.ts` 已有用户/项目切换、模型/目录/cron/时区/权限表单、配置编辑与历史；有epoch防迟到覆盖。保存/启用回执明示“不启动任务”“执行器尚未接通”；没有手动启动/运行取消通道，没有Hooks声明表或所属本地Agent信息。不能说整个前端缺失，也不能因为表单保存成功称调度已运行。

## 3. 推荐架构（Proposed ADR）

### ADR-HOOK-01：声明、装载、运行三个真源分开

结构：

`磁盘settings / AutomationStore定义 → 只读声明快照 → 信任/授权与作用域核验 → Hook装载或Trigger评估 → 持久准入去重 → F13-E执行 → 真实历史投影`。

- 磁盘是声明真源；HookRuntimeRegistry记录运行实例实际装载的configDigest；SessionLog/调度运行日志记录触发/审批/执行事实。
- UI分别展示 `declarationStatus`（valid/invalid/missing）、`loadStatus`（not-loaded/loaded/stale/blocked）、最近执行的 `executionOutcome`。文件存在≠loaded，loaded≠ever-executed，执行无输出≠成功。
- settings变更先形成新摘要，实际装载成功后更新实例记录；装载失败不能让UI继续宣称“当前配置已加载”。旧版本是否仍有效须显式说明，撤权/安全配置收紧先阻新准入。
- 用户查看磁盘声明不启动shell/HTTP，不触发收费模型请求，不自动开放Webhook监听。

### ADR-HOOK-02：复用core CronSpec，不引第二套Node/JVM cron调度器

调度判定与时钟接缝都在core共享，Host/CLI/daemon仅提供运行宿主。无需新增原生FFI或npm依赖；IANA时区数据复用现有包内zoneinfo/CJ_TZPATH路径（实际打包与各平台验收另核）。

代价：需补齐现有解析器的字段/值域/非法步进拒绝及测试，不能把宽松parse当兼容完成；命名月份、宏、秒/年、L/W/#等未支持方言明确报unsupported，不静默变成从不触发。

### ADR-HOOK-03：单一调度所有者，F13-E唯一执行接缝

每个用户自动化配置域只有一个带租约/epoch的scheduler owner；同一机器上的多个Host不能各开循环。桌面Host、CLI、daemon均可作为候选运行宿主，但只能经租约成为owner。

桌面关闭后要继续跑必须由用户显式启用并实际部署的daemon承载；当前没有daemon执行器时直接显示“仅应用运行期间可调度/未启用常驻服务”，不用renderer timer冒充后台服务，也不自动安装系统任务。

调度器不调用GUI内部 `task/start` 去借用当前聊天会话。F13-E通过编译期有限 `AutomationRunner` 接收已持久准入记录，创建独立会话和执行上下文，返回runId；模型、shell、审批、取消与结算都复用现有共享核心链。

### ADR-HOOK-04：默认错过跳过；去重不承诺外部副作用恰好一次

沿用已有 `automation-product-wiring-2026-10-15.md` 默认skip口径。持久准入前不调用外部程序；崩溃后不重发unknown火次。严格去重的是“某逻辑触发的准入/派发”，不能证明未知HTTP/脚本副作用只发生一次。

## 4. core调度执行契约

### 4.1 定义、触发与运行分离

拟议数据结构（非现有API）：

- `AutomationDefinition`：scope、projectIdentity、taskId、definitionRevision、trigger、timezone、agentPresetId/presetRevision、modelId、workspace、permissionCeiling、预算/时长/并发策略、misfirePolicy。
- `TriggerIntent`：triggerKey、taskId、definitionRevision、scheduledAtUtc、triggerKind、sourceEventId、causationId。
- `AutomationRun`：runId、triggerKey、ownerEpoch、sessionId、preset快照摘要、状态、预算、审批等待、真实结算。
- `HookBinding`：宿主类型/版本、声明源、sourcePath标签、configDigest、ruleId、agentPresetId、运行实例和loadedDigest。preset身份不从文件名或显示名猜。

triggerKey建议 `hash(scope + projectIdentity + taskId + scheduleRevision + triggerKind + logicalOccurrence)`。Cron occurrence采用UTC计划分钟；事件采用可信事件ID；手动运行采用调用方requestId。调度规则修订与执行内容修订区分：内容编辑不使当前同一分钟又触发一次；排程修订自生效后的下一分钟起算。日后需更换此策略必须迁移去重事实。

### 4.2 触发评估与Cron语义

1. 先核定义有效、scope/项目可信、所绑preset/model可用、执行器可用、权限/预算未撤销。
2. 使用UTC墙钟计算计划分钟，按声明IANA timezone转换后交CronSpec.matches；等待时限/取消用单调钟，不用墙钟变化控制超时。
3. v1仅严格五字段 `分 时 日 月 周`，范围与星期0/7规范化；兼容性声明以实际测试为准。
4. DST默认：不存在的本地分钟跳过并记录；重复本地分钟按UTC实际时刻形成两次不同occurrence，UI展示此策略，不能含糊称“每天一次”。若要求重复小时只跑一次，需另定义并审定dedup策略。
5. 墙钟回退不能重发既有triggerKey；保留持久高水位。墙钟前跳/休眠/重启按misfire策略处理，不遍历无限历史。启动不执行初始化前的历史排程。
6. 事件/工作流/Webhook需获验证的sourceEventId；同事件重传被去重。Webhook认证、时间窗、请求体上限与防重放是独立入口责任，不因内部存在WebhookRuntime就认为公网监听已安全接通。

### 4.3 持久准入、并发与恢复

流程：评估到期→获取定义域owner/写租约→重读revision/权限与触发去重→登记admitted并flush→才交F13-E→记录dispatch/run引用→持续结算。

- 相同key重入返回同一fire/run状态，不启动第二个；实例内串行检查不代替跨进程租约与持久唯一事实。
- 每task默认最多一个在途run，默认overlapPolicy=skip并留原因；不无限排队。全局并发与模型预算也有上限。
- 存储失败在准入前阻断；admitted后崩溃且无法核实是否派发→unknown屏障，不自动重发。可证明尚未派发的项也需按冻结的恢复策略处理，不能单凭PID不在就推断无副作用。
- 现有 `recordFire`/`hasPendingFire` 是可复用起点，尚不足以实现以上触发唯一性、时区与跨进程owner协议。
- 运行日志建议独立版本化存储，配置清单投影合并读取历史；迁移方案审定前不把新事实写入只允许三种旧schedule事件的AutomationStore文件。

### 4.4 错过触发策略

首版有效策略固定 `misfirePolicy=skip`：重启/休眠醒来不补历史，记missed区间/数量上限摘要，推进水位，从下一个有效计划分钟继续。等待审批超时也不自动转为“错过后补跑”。

未来扩展 `coalesce-once`、`replay-bounded` 保留为不支持值，若配置出现必须拒绝，不能悄悄按skip执行。扩展需用户确认补偿窗、最大次数、预算与高影响授权后再开放。

### 4.5 与F04目标调度复用

F13决定**何时创建一次任务运行**；F04 `GoalScheduler`决定**该运行内部是否继续下一模型轮**。不复制F04累计轮数/时长/无进展/停止后disarm规则，不让一次cron火次创建新handle绕过同一运行的额度。

F13-E创建独立会话，若有目标则消费共享GoalService/GoalScheduler；无目标的一次任务不伪造持续目标。一个fire的继续/重启沿用同一预算账，用户显式新fire才是另一运行，仍受自动化总预算约束。F04在途改动由其owner处理，本设计不改goal或Host公共文件。

### 4.6 与F13-E任务边界

| 本设计的Hook/触发侧 | F13-E执行侧 | 共同冻结项 |
|---|---|---|
| 声明解析、来源/Agent标签、加载快照 | 独立会话与模型/preset运行上下文 | definition/preset/configDigest绑定 |
| Cron/事件→TriggerIntent、持久去重 | 已准入fire→真实run，不能自行再调一次 | 幂等dispatch与unknown屏障 |
| misfire/overlap/pause配置 | stop当前run、取消后续工具、释放自有资源 | pause≠cancel，恢复不自动执行 |
| fired/blocked/skipped持久记录 | waiting-approval/running/settled与真实失败 | 审批、预算、持久失败传播 |

未获得F13-E执行方契约与交接前，只能定此接缝，不能宣称Runner存在，不复制第二套执行器。

## 5. Hooks装载与安全

### 5.1 声明检查不等于启用脚本

新增只读 `HookDeclarationService` 先验证文件身份、大小/深度/字段/URL/命令显示的脱敏，然后产生声明快照。明确区分SaCode格式与其他本地Agent格式；不能把任意产品的settings.json按SaCode同一schema解析。

初始只支持当前SaCode用户/项目文件；其他本地Agent通过已登记的只读adapter逐宿主扩展，不动态遍历HOME、不读取凭据库、不执行配置JS或脚本。查看其他Agent声明时 `loadedBySacode=false`，实际对方是否加载/执行默认unknown，不能冒充对方运行回执。

`HookRuntimeBinding` 仅在配置得到信任、动作范围获准、运行宿主确实装入该registry后登记loaded。现有session函数临时new空registry要由后续owner以明确注入接缝修复，不靠日志上已有hook/dispatch给绿灯。

### 5.2 所属本地Agent/preset标注

UI每条Hook展示 `ownerHost`（SaCode/其他Agent）、`agentPresetId/name/revision`、`scope`、`sourceLabel`、`declaredDigest`、`loadedDigest`、实例ID与最近真实执行状态。

当前HookInput仅有agentId/agentType，HookRule无preset绑定，AutomationStore九字段定义也无presetId。后续需版本化增加关联；旧数据标“未绑定本地Agent”，不可自动指向当前聊天Agent。失效preset显示blocked，不静默回退更宽权限preset。

### 5.3 无人值守不扩权

- 保存/启用cron、配置permission=yolo、Hook返回Allow都不是独立敏感动作授权。
- Hook command/http本身有副作用、也可能发送消息/代码/路径；在执行前走共享精确批准或已审定的有限范围许可。无人响应→waiting-approval，期限到→blocked/expired，不自动Allow，不发送新的付费请求绕过等待。
- 提交/推送/安装/部署/数据库写入等仍每次单独授权；定时任务或本地Agent身份不能替代。项目security块不能放宽用户/部署安全上限，最终权限取交集；当前loader“项目security整块优先”不直接用作授权裁决。
- command环境只给已准环境与必需系统变量，不复制宿主全部token；HTTP输入按事件最小化，toolInput/prompt/transcriptPath等敏感数据先脱敏，认证头不进普通日志。
- HTTP URL/私网/重定向/DNS/TLS沿用现有校验并补真实验收；不关证书检查。已有allowlist只授权目标范围，不自动授权发送全部上下文。
- Hook `updatedInput`改变目标或副作用参数后须重新核政策/重建审批；Allow不消费或伪造原工具票。
- 不允许项目脚本替换关键安全策略。安全强制守卫执行失败必须阻断；通知型Hook可按显式策略不阻断主任务，但依然记录 `executionOutcome=failed/timeout`，不得混为Hook成功。

### 5.4 结果、递归与异步

保留Hook业务裁决 `allow/deny/ask/block`，另加执行事实 `not-started/running/succeeded/failed/timed-out/cancelled/unknown` 和真实退出/HTTP结果；不要复用Allow表示成功。

每触发携causationId/parentInvocationId/depth，首版建议最大深度4；同规则同根事件重复进入阻断并留记录。Hook自身产生的记录不能无限触发MessageDisplay/Notification；审批事件Hook也不能自行批准自身。

同步Hook在原动作准入前有界等待；async观察Hook不能迟到追认/撤销已经完成的动作，也不能影响已执行工具的授权。`asyncExecute`字段只有在F13-E提供受监督队列和退出收束后才开放实际异步；否则标unsupported，不假称已支持。

## 6. Host方法：哪些复用，哪些新增

**不把 `automation/control` 扩成任意动作容器。** 保留其pause/resume/remove的配置语义与CAS，当前回执兼容；新增运行/声明方法需能力协商与字段验证。

| 方法（现有/拟议） | 输入要点 | 语义与输出 |
|---|---|---|
| `automation/list`（现有，增强投影） | sessionId,scope | 仍读定义/历史；以后附schedulerState、有效misfire/overlap策略、preset绑定；executorAvailable必须来自实际runner能力而非常量改true |
| `automation/save`（现有，版本化扩展） | definition,revision | 只保存；增加preset与策略时定义version升级，不悄悄破坏当前恰好9字段校验 |
| `automation/control`（现有） | id,action,revision | pause/resume/remove；pause阻新准入，不假报已停止当前run；remove保留运行历史 |
| `automation/trigger`（拟议） | sessionId,scope,taskId,definitionRevision,requestId | 手动一次触发，返回fireId/runId或waiting-approval/blocked；重复requestId不二次派发 |
| `automation/run-describe`（拟议） | scope,taskId,runId | 历史/准入/审批/输出引用/真实结算，不根据句柄存在推断完成 |
| `automation/run-cancel`（拟议） | scope,taskId,runId,expectedRevision | 请求取消指定运行；cancelRequested不等于settled；不取消其他fire或当前聊天任务 |
| `hooks/describe`（拟议） | sessionId,scope,hostId,agentPresetId? | 展示磁盘声明、诊断和loaded/lastOutcome分列；不接受任意文件路径，不执行脚本 |
| `hooks/reload`（拟议，后续装配） | sessionId,bindingId,expectedDigest,requestId | 核信任与权限后装入同实例声明；不自动执行任何Hook；运行许可独立管理 |

以上不是当前已实现接口。本任务不增加RPC/IPC。scheduler owner使用内部编译期start/stop接缝，不先公开任意daemon控制RPC；远程服务身份/会话授权另验。

示例回执形态：

```json
{"declared":{"status":"valid","digest":"<sha256>","scope":"user","sourceLabel":"用户 settings.json"},"owner":{"hostId":"sacode","agentPresetId":null},"loaded":{"status":"not-loaded","instanceId":null,"digest":null},"lastExecution":null}
```

手动fire可能返 `{fireId:"fire-1",status:"waiting-approval",runId:null}`，不是success；没有runner返 `automation-executor-unavailable`。旧未知run只提供核对，不因reload/resume再跑。

## 7. 前端与依赖

- 在现有 `automation-page.ts` 加Hooks只读标签/关联Agent列、调度器能力与策略说明；保留草稿/CAS/迟到响应防护，不让“启用配置”显示成“后台已运行”。实际写入窗口由前端owner安排。
- 手动触发按钮按 `automation/trigger` 能力打开，取消明确针对run；暂停配置和停止当前run是不同按钮/确认文本。
- cron：复用core `CronSpec`，无新外部cron依赖。时区依赖SDK `TimeZone`+IANA数据，须三平台加载验收。Windows时区ID不能直接冒充IANA名字。
- command Hook依赖获准shell/executable与受控进程能力，HTTP依赖现有stdx HTTP/TLS；不存在的运行环境明确blocked，不能要求用户关防护。
- 本地Agent预设依赖F12的权威preset身份/版本与生命周期；当前这条关联尚未建立，不能由模型名称或显示标签替代。
- F04负责运行内轮次，F13-E负责任务执行，触发/Hook模块不接管其文件；公共Host/agent/IPC统一交接，不并发装配。

## 8. 验收与待确认项

本轮仅设计，下列均未运行：

| PRD项 | 核心/协议验收重点 |
|---|---|
| AU01 | 合成用户/项目settings；同名scope、坏JSON、只声明未加载、绑定失效preset，查看零脚本执行 |
| AU02 | cron边界/非法表达式、IANA/DST、重复tick/墙钟回退、休眠重启skip策略与水位 |
| AU03 | Webhook身份/签名/重放/超限/私网/TLS，未启用不监听 |
| AU04 | 两个Host同分钟争owner；持久去重，准入失败零派发，unknown禁止自动重发 |
| AU05 | F13-E工作流失败/取消阻危险后继；真实依赖与结果，不拿WorkflowLedger状态当已执行 |
| AU06 | Hook exit0/2/其他非零、坏/截断输出、超时、递归、async约束；decision与outcome分列 |
| AU07 | 无人审批等待/过期，yolo不免高影响票；pause不伪报停止，撤权阻新动作 |
| AU08 | CLI/Host/daemon归属、崩溃恢复、独立会话、退出收束与新包；缺环境标待验 |

待协调确认：

1. F13-E执行方实际任务书、Runner接口与各自文件范围；本设计只是接缝提案。
2. 第一阶段scheduler运行宿主：仅应用存活期，还是另行授权启用daemon；默认不安装系统服务。
3. preset权威ID/修订获取与旧定义迁移；无绑定时是否允许仅查看、禁止运行（推荐）。
4. 严格cron语法、DST重复小时策略、默认skip/overlap=skip及预算定值，确认后才能启用调度。
5. Hook通知失败策略与安全强制失败策略的分类、command/http执行批准绑定和递归限制。
6. 持久触发唯一性/租约/ownerEpoch与现有AutomationStore三事件白名单的迁移；旧unknown保留。
7. 用户级Hooks路径与 `SACODE_USER_SETTINGS_DIR` 的产品/测试映射，其他Agentadapter支持清单；不扫描真实HOME凑验证。
8. 所有敏感字段脱敏与有界读取/输出、权限上限合并必须在装配前验证，不能直接沿用当前继承全环境的执行器。

建议顺序：现状/契约审定→只读Hook声明和Agent标签→Cron边界与持久触发核心→与F13-E握手→单所有者受控执行/审批→Host具名方法与前端→AU01–AU08及逐平台/候选验收。本文不构成实现授权。

## 9. 取证索引

- PRD F13（199）、自动化安全（458、466）、AU01–AU08（681–694）；`docs/product/PRD-tracking.md` F13/D07。
- `hook_settings.cj:19–51,147–174,195–287`；`hook_registry.cj:7–33,81–169,172–270`；`hook_executor.cj:118–175,248–307`。
- `cron.cj:16–36,50–120`；`schedule.cj:77–101,160–178,314–360`；`automation_store.cj:19–95`；`session.cj:420–463`；`webhook.cj`、`workflow.cj`。
- `apps/host/src/automation_rpc.cj:5–30`、Host main分派；`apps/desktop/renderer/pages/automation-page.ts:44–75,88–117`。
- `docs/plans/automation-product-wiring-2026-10-15.md`：保存不执行、触发持久化、默认skip、daemon边界；`docs/evidence/2026-10-11-prd-p1-gap-recheck.md:129–136`：历史已指出加载库存在但无产品调用，旧调度循环不可当可用实现。
- `core/src/goal_scheduler.cj` 与 `docs/plans/goal-execution-scheduling-design-2026-10-20.md`：F04归属，仅复用限额/取消/恢复契约。本轮未改任一这些文件。
