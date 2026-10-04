# DSH 能力矩阵（S0 冻结快照 + 2026-10-03 分母定档与本方状态回填）

快照：`deepseek-ai/deepseek-harness` @ `639ed015397290b3745d163aafe02ffee4aa3f84`（提交时间 2026-09-29T09:21:31Z，默认分支 `master`，SPDX `MIT`），抓取日 2026-10-02。

## 产品裁剪与待核状态（2026-10-03）

产品范围按 [PRD §2.3](../product/PRD.md) 明确裁剪：npm CLI 与 Electron 桌面均本地使用，无需 DSH 官方账号登录，用户自行配置模型及服务凭证。下表是**已定产品边界，尚待上游核验**；不据此断言冻结上游确实存在对应账号或商业功能，不声明代码已移除。

| PRD 编号 | 裁剪范围 | 核验入口（候选，非已确认归属） | 当前状态与保留要求 |
| --- | --- | --- | --- |
| C01 | 若存在，排除官方注册、登录、账号绑定及其本地使用门槛 | boot、settings、credentials、web-client、web-server 及相关配置/插件 | **已核**（2026-10-04）：credentials 模块 495 行确证上游有 CredentialRef/AuthorizationFlow/DeepSeekAccount（getPlatformSession 返回 origin+token+userId）。保留第三方凭证、IPC/会话身份及远程访问认证。本仓审批凭据只用工单号（明确简化），未实现账号绑定 |
| C02 | 若存在，排除官方订阅、支付、商业权益与云端额度校验 | token-meter、settings、模型 provider 及相关配置/插件 | **部分核**（2026-10-04）：token-meter 模块确证上游 route-priced request-image pricing（`ctx.llm.imageRequestPricing`），但未发现订阅/支付/商业权益字段。保留 token 用量与本地预算。本仓 TokenMeter 从日志重算，不涉及云端额度校验 |
| C03 | 若存在，排除官方账号绑定的同步、云存储和云会话服务 | storage、session、workspace、web-client、web-server 及相关 provider | **已核**（2026-10-04）：storage（260 行）、session-query（510 行）、session-reference（225 行）确证上游有 storage backend、跨会话语料库查询、SessionReference 提及。保留本地持久化、恢复及双入口一致性。本仓会话日志是唯一真源（append-only session.log），无上游 storage 后端形态 |
| C04 | 排除官方账号关联遥测与默认官方上报；遥测默认关闭，后续仅提供用户明确启用的可替换服务 | product-telemetry、session-telemetry、otel 及配置/上报 provider | **已核**（2026-10-04）：otel（45 行）、product-telemetry（79 行）、session-telemetry（213 行）确证上游有 OTel exporter、产品遥测上报、Session 遥测 channel。保留本地诊断需求，启用和关闭均需两入口验收。本仓无任何上报，默认关闭；上游 exporter、配置与账号依赖已核，本仓未实现对应可替换服务 |

核验需对照冻结快照的文档、源码、配置及测试，登记证据路径、调用链、两入口影响、被排除需求及保留需求。未找到实现时记录核验范围与依据，不能写成“已移除”。裁剪不改变下方 **63 模块 + 1 README** 清单、行序或分母；相关模块仍核验保留需求，不按名字删除 `auth`/`credentials`/`token` 能力。

2026-10-04 上游已核回填后，裁剪条目的核验状态已从「待核」更新为「已核」或「部分核」。但裁剪条目完成核验及 PRD A11 两入口测试后才能登记“排除（已裁决、已核）”，不得算作实现通过或无差异兼容。完成后的产品表述为“裁剪范围内完整复刻，排除官方商业账号及云服务绑定”。

## 分母（2026-10-03 重取并逐项对照，此前的「63 vs 64」已闭合）

- 对 `api.github.com/repos/.../contents/docs/subsystems` 各取一次 `ref=639ed01…`（冻结）与 `ref=master`（当日）：两边都 **192 条目 = 64 `.md` + 64 `.zh.md` + 64 `.i18n.yaml`**；GitHub contents 单目录上限 1000，判为完整清单而非分页截断。
- **64 个 `.md` 里有 1 个是 `README.md`（子系统目录索引页，不是一条能力）**，所以子系统真分母是 **63**，本表表体即 63 个模块行 + 1 行 README = 64 行。此前文档写「64 个模块」是把索引页算进了能力数，方案 §6.1.2 D 档第 2 条同此。
- 逐名对照（不是数数对上，是集合对上）：本表 63 个模块名与冻结清单的 63 个模块名**双向差集均为空**——没有缺行。
- `cordis` 与 `gateway` **在两个 ref 的 subsystems 目录里都不存在**（只在矩阵第 9 行的阶段关键词与方案 §3.1 出现过）。据此裁决见下方「M0 基座」，**不再当作「待补的缺行」**。
- 冻结与当日的名称漂移（记账，不改 S0 口径）：`invariants` **只在冻结快照**里存在，master 已无；master 新增 `claude-code-mods`，冻结快照里没有。本表按 S0 冻结口径保留 `invariants` 行、不加 `claude-code-mods` 行；若要转跟 master，需另立快照日并重数分母。

## M0 基座的裁决（补证清单第 5 条的前半）

`cordis` / `gateway` 不是 subsystems 模块，而是上游架构叙述里的**框架层与交付层**名字（出处：方案 §3.1 与站点架构页，非 subsystems 目录）。据此显式处理，不留悬空分母：

- `cordis`（框架层：actor/scope/typert 之类运行基座）——**显式出局复刻清单**：本仓不引第三语言运行时，`core/` 的仓颉静态库承担同一职责（会话日志唯一真源 + 投影 + 取消/背压 + 扩展进程驱动），其等价性由本表 `core`/`scope`/`typert`/`invariants` 各行与方案 §4 的 18 条不变量分别承接；不得把「共享核心」当成已复刻 `cordis` 整体。
- `gateway`（交付层：对外传输与入口装配）——**部分承接且已指名**：`apps/host` 的 NDJSON/JSON-RPC stdio 宿主（能力表 23 个方法）与 `apps/cli`、npm 平台包即交付面；上游 gateway 的多传输/多客户端形态未做，故 `web-server`、`client-*` 等行仍按未实现记。
- 表内的 `boot`、`scope`、`invariants`、`typert`、`core` 是**确实在 subsystems 目录里**的 M0 行，逐行按下方列义判定，不因上面的裁决而连带勾选。

## 本仓有证据、上游无对应行的三块：不补行，改写进已有行的判据

取消与背压（`TurnToken` + `ThreadSafeDeliveryQueue`）、崩溃残留租约的判活接管（`WriteLease.takeoverIfStale` + `procwin`）、
Ctrl+C 的协作式取消（`sigwin` + CFFI `SetConsoleCtrlHandler`）这三块是本仓证据最足的部分，但 **subsystems 目录里没有对应模块名**。
不往表里加行——加了就把自造能力混进了上游分母，分母不再可复核。承接方式：取消与背压、中断在册令牌记在 `core` 行的判据里，
尾帧截断与崩溃恢复记在 `persistence` 行，残留租约接管记在 `session` 行，中断的处理面另在 `terminal` 行明确注明
「走的是控制台中断回调，不等于终端/PTY 子系统已复刻」。这三块的实测计数与变异反证见 `docs/evidence/p0-status-2026-10-02.md` 第 6、7、9、14 项。

## 列义与图例

2026-10-03 R0 收口：代码 `6e060ff` 已修复计量的租约恢复、正常退出漏记及收紧预算放行问题，控制字符转义、npm 启动源码与 CLI 计量断言也已入库。干净提交核心 119/119、桌面 53/53、扩展 14/14，npm 安装后 stream 17 条与 tool 11 条 ALL PASS；见 [R0 证据](../evidence/r0-review-closeout-2026-10-03.md)。下方旧测试计数保留原批次含义，不扩称当前 Electron 整包已通过。

2026-10-04 上游已核回填：63 模块逐篇直读 en/zh 原文完成，覆盖账本 `docs/evidence/upstream-ledger-2026-10-04.json` 跑 `coverage_ledger.cjs` 得 **GATE: PASS（9/9）**；契约校正与 C01–C04 裁剪核验结论见 [上游模块直读证据](../evidence/upstream-module-reads-2026-10-04.md)。`上游已核` 列全行 ☐→✔（README 行不适用记 —）。C02 上游商业边界已核（token-meter route-priced request-image pricing 已确认，未发现订阅/支付字段）。

`zh`=仓库是否含中文文档；`站点参考页`=站点导航是否有同模块页；`建议阶段`=按下方关键词规则的粗分，**需人工复核，不作为承诺**；`上游已核`=我们是否已直读过该模块的 en/zh 原文与生成物——**2026-10-04 全行回填为 ✔**：63 模块逐篇直读 en/zh 原文（14 模块主线程直读 + 49 模块子代理直读 + 4 篇抽样对账），证据与账本见 `docs/evidence/upstream-module-reads-2026-10-04.md` 与 `docs/evidence/upstream-ledger-2026-10-04.json`（GATE: PASS 9/9）。README 行不适用记 —。

`已复刻`＝**本仓实现 + 该模块级验收用例**，取值三档：
- `✔`＝方案 §6.1.2 A 档（指得到具体用例名/计数）；
- `◐`＝切片或 A 档里仍有明确缺口，`备注` 写清缺哪一段；
- `☐`＝C 档未实现（全仓关键词 0 命中，唯一命中是假阳性的那条已在 §6.1.2 记名）。

阶段关键词规则：M0 基座（cordis/core/scope/invariants/boot/typert/gateway）、M1 会话与存储、M2 模型与上下文、M3 loop 与目标、M4 工具与执行世界、M5/M6 客户端与前端装配、M7 委托与编排、M8 外部集成。

编号口径：矩阵没有逐条 M 号，方案 §6.1.2 引用时用**表内行序**（1=`agent-team` … 63=`workspace`，64=README 行）。

计数（2026-10-04 上游 63 模块直读回填 + 前五批十四个非前端核心切片：session-title / todo / plan / goal / permission-presets / deliverables / jobs / webhook / settings / storage / sandbox）：`✔` 11 行、`◐` 14 行、`☐` 38 行（63 个模块行）；README 行不参与计数。判据与逐行出处见 `docs/plans/plan-deepseek-harness-replication.md` §6.1.2，本列不另立第二套分类。`上游已核` 列 2026-10-04 全行回填为 ✔（63 模块逐篇直读），不改「已复刻」计数。

| 模块 | zh | 站点 | 阶段 | 上游已核 | 已复刻 | 备注 |
|---|:-:|:-:|---|:-:|:-:|---|
| agent-team | ✔ | ✔ | M3 | ✔ | ☐ | 未实现（§6.1.2 C 档，行 1） |
| approval | ✔ | ✔ | M4 | ✔ | ✔ | `core/src/approval.cj` 工单往返 `ask→answer→一次性 consume`，`asked/decided/expired` 进同一份会话日志；过期由真实单调钟决定（`approval/tick` 通道已撤）。core 9 条 + bridge 6 条；两刀变异反证（去一次性置位、去决定白名单）。**上游校正**：上游四档（allow/deny/ask/open-turn）+ waterfall（pre-execute 允许 ask），本仓两档（允许一次/拒绝）且上游要求 open turn 本仓未实现 |
| attachment | ✔ | ✔ | M5/M6 | ✔ | ☐ | 未实现（C 档，行 3） |
| boot | ✔ | ✔ | M0 | ✔ | ☐ | 未实现（C 档，行 4）；本仓入口是 `main(args)` 直起，无上游启动装配序列 |
| browser-use | ✔ | ✔ | M8 | ✔ | ☐ | 未实现（C 档，行 5） |
| client-modules | ✔ | ✔ | M5/M6 | ✔ | ☐ | 未实现（C 档，行 6） |
| client-resources | ✔ | ✔ | M5/M6 | ✔ | ☐ | 未实现（C 档，行 7） |
| commands | ✔ | ✔ | M7 | ✔ | ☐ | 未实现（C 档，行 8） |
| compaction | ✔ | ✔ | M2 | ✔ | ☐ | 未实现（C 档，行 9） |
| computer-use | ✔ | ✔ | M8 | ✔ | ☐ | 未实现（C 档，行 10） |
| conversation | ✔ | ✔ | M5/M6 | ✔ | ✔ | 切片已收口：`renderer/app.js` 经 `BubbleProvider + BubbleList`（`groupStrategy=consecutive`）按角色分组，正文由本仓自定义内容渲染器出（默认链把 `role==="tool"` 交给只渲染注释节点的 ToolRole，不接就隐身），长正文按 `renderer/msgfold.js` 的单一阈值默认折叠并可展开/收起；`--ui-smoke` 钉住组数、角色分布、placement、组标签、合并、折叠三态、tool 可见与 `--tr-*` 色值桥接（各条见 `docs/evidence/p0-status-2026-10-02.md`）。**上游校正**：上游 conversation 是 React assembly（`ui-conversation` 把持久 Session event 与 `assistant/live-chunk` 关联成稳定 Context），本仓是 Vue 列表（`BubbleProvider+BubbleList`），命名占用而非契约复刻；上游 `live-chunk` 概念本仓无。**剩余**：落盘正文出自假 provider 的装配结果，真模型 provider 未接；干净收束路径上 `tool/call`/`tool/result` 仍不落盘 |
| core | ✔ | ✔ | M0 | ✔ | ✔ | 本仓 `core/` 即共享核心（会话日志唯一真源、投影、取消/背压、扩展进程驱动），两个入口同依赖；core `cjpm test` **99/99**。不等同上游 `cordis` 整体，见上方 M0 裁决。**上游校正**：上游 `SessionEventMap` 13 类事件（session/system/developer/user/assistant/tool/turn/usage/approval/agent/compaction/request/workspace），本仓主动裁剪到 5 类（session/system/user/assistant/tool-result），`developer/message` 已于 `cd9c8a7` 补进投影 |
| credentials | ✔ | ✔ | M5/M6 | ✔ | ☐ | 未实现（C 档，行 13）；真模型凭证在仓外，未做任何存取。**保留**模型/第三方凭证安全存取、脱敏和轮换。**C01 已核**：上游 credentials 模块 495 行确证有 CredentialRef/AuthorizationFlow/DeepSeekAccount 体系，本仓已排除官方账号绑定 |
| deliverables | ✔ | ✔ | M5/M6 | ✔ | ◐ | 核心切片已落 `core/src/deliverables.cj`（2026-10-04）：`deliverables/presented` 与 `workspace/changes` 都是 log-only 事件，不进 `isSurfaceEvent`；`present(turn,callId,files)` 与 `recordTurnEnd(turn)` 每次落一条不 dedup（诚实反映本轮结束了几次）；`lastPresented/lastTurn` 取回放最后一条。core `deliverables_test.cj` **3 条**（round-trip 不进 surface、逐轮记录不合并、空 files 仍落事件）。**仍缺**：`ctx.workspaceChanges.summary/diff` 服务、`WorkspaceFileDiff` 三种 kind、git 快照 turn-start/turn-end 捕获、`projectContent` 集成；见 `docs/evidence/upstream-module-reads-2026-10-04.md` §4 A 组 |
| extensions | ✔ | ✔ | M8 | ✔ | ✔ | `core/src/ext.cj` 注册表 + `extjs/` 独立 Node 宿主 + `core/src/extproc.cj` 子进程驱动；未登记即拒、卸载残留归 0、退出必须结算。core `ExtProcess` 15 条 + extjs 14 条 + CLI `dsh extjs` 12 项。**上游校正**：上游 extensions 是 Cordis 动态包加载（plugin manager + HMR），本仓是外部脚本宿主（NDJSON JSON-RPC 子进程），命名占用而非契约复刻 |
| feedback | ✔ | ✔ | M5/M6 | ✔ | ☐ | 未实现（C 档，行 16） |
| filesystem | ✔ | ✔ | M4 | ✔ | ◐ | `read`/`write` 共用管线，按解析后的路径身份保存原始字节与存在/缺失观察；已有文件未观察拒绝覆盖，等长改动、已观察后删除均拒绝旧版本写入，缺失后外部创建拒绝覆盖；非法 UTF-8 不登记成功，控制字符回执无损，读取正文入日志可重放，新建发布禁止替换。core `fs_test.cj` **11 条**（本轮 core 总计 **116/116、rc=0**）；隔离快照 bridge 文件系统往返 2 条、CLI `tool` 11 条断言沿用现有验收报告，不扩称当前计量版整包验收。**仍缺**：edit/glob/grep、provider/consumer 拆分、有界读取与已有文件的受保护原子替换，故仍记 ◐；见 `docs/evidence/filesystem-review-fixes-2026-10-03.md` |
| goal | ✔ | ✔ | M3 | ✔ | ◐ | 核心切片已落 `core/src/goal.cj`（2026-10-04）：`GoalSnapshot { id, revision, phase, objective, blockedReason }`；`goal/change` 是 log-only 事件不进 `isSurfaceEvent`；`create/edit/pause/resume/complete/block/clear` 每次变更 CAS 检查期望的旧 revision（不匹配抛 `stale-goal-revision` 且不落事件）；`clear` 落 `phase='none'` 墓碑后 `snapshot()` 返回空；`revision` 从「日志里已出现的 goal/change 条数」派生不重复编码。core `goal_test.cj` **4 条**（id+phase 分配、CAS 陈旧拒绝、phase 转移 flush→load 回放、clear 墓碑）。**仍缺**：`GoalMessageSource.kind='goal'` roundsStarted 语义、`maxGoalRounds` 与 turn 交互、`goal/activation-changed` emit、`@Remote` 修饰、多 goal（本切片单 goal 场景 id 固定 `goal-1`）；见 `docs/evidence/upstream-module-reads-2026-10-04.md` §4 B 组 |
| invariants | ✔ | ✔ | M0 | ✔ | ☐ | 未实现（C 档，行 19）。本仓 §4 的 18 条不变量是**我方复刻口径**，不是对该模块的运行实现；且该行只存在于冻结快照，master 已无（见上方漂移） |
| jobs | ✔ | ✔ | M4 | ✔ | ◐ | 核心切片已落 `core/src/jobs.cj`（2026-10-04）：`JobStore` registry 状态机（`JobId=<kind>-N` 单调分配，bash/subagent 各自计数）；`JobStatus` 五态 running/stopping/completed/killed/failed；终态不可回退；`running→killed` 视为跳过 stop 步骤非法；`stopping→completed` 也非法；未知 id 抛。core `jobs_test.cj` **4 条**（kind 前缀 id、终态回退拒绝、kill 走 stopping→killed、未知 id 拒绝）。**仍缺**：`JobHandle.append/updateProgress` 与 output ring、`JobHooks.cancel/done`、`JobRegistry.read/readAt/wait/attachController`、`JobController` @Remote、`registered/progress/stopping/removed/settled/output` 事件；见 `docs/evidence/upstream-module-reads-2026-10-04.md` §4 B 组 |
| llm-streaming | ✔ | ✔ | M2 | ✔ | ◐ | 假 provider 的半帧/UTF-8 分片/终态/`max-tokens`/usage 次序有用例；**缺口**：真模型 HTTPS+SSE 烟测待用户凭证（补证清单第 4 条） |
| lsp | ✔ | ✔ | M4 | ✔ | ☐ | 未实现（C 档，行 22）；`ToolSpec` 含子串 `lSp` 属假阳性，已记名 |
| mcp | ✔ | ✔ | M7 | ✔ | ☐ | 未实现（C 档，行 23） |
| office-to-pdf | ✔ | ✔ | M8 | ✔ | ☐ | 未实现（C 档，行 24） |
| otel | ✔ | ✔ | M8 | ✔ | ☐ | 未实现（C 档，行 25）。**C04 已核**：上游 otel 模块 45 行确证有 `ctx.otel` 共享工厂（`createEventReporter` count-based + `createSessionLogReporter` byte-bounded），通道不共享队列。本仓无遥测后端，默认不外发；上游 exporter、配置与账号依赖已核，仅以明确启用的可替换服务提供，不整模块标为已裁剪 |
| permission-presets | ✔ | ✔ | M4 | ✔ | ◐ | 核心切片已落 `core/src/permission_presets.cj`（2026-10-04）：默认表 `workspace-write`/`danger-full-access`；`permission/preset` 是 log-only 事件不进 `isSurfaceEvent`；`set` 未知名抛且一条事件都不留、同值 noop、异值落事件；`current()` 取回放最后一条。core `permission_presets_test.cj` **4 条**（空默认、log-only 持久可回放、同值 noop、未知名拒绝）。**仍缺**：`registerAuto` 固定 auto 预设、`PresetSpec.sandbox/approval` 双 knob 捆绑、`permission-presets/catalog-changed` emit、与 `ctx.sandbox`/`ctx.approval` 的 compose 契约；见 `docs/evidence/upstream-module-reads-2026-10-04.md` §4 B 组 |
| persistence | ✔ | ✔ | M1 | ✔ | ✔ | `session.log` 的 append/flush 持久化屏障、崩溃恢复合成、尾帧截断（丢半写帧保留已提交前缀）、中段缺帧整份拒绝；core `session` 22 条 + bridge durability 用例 |
| plan | ✔ | ✔ | M4 | ✔ | ◐ | 核心切片已落 `core/src/plan.cj`（2026-10-04）：`plan/mode { active: boolean }` 是 log-only 全值替换会话事件，不进 `isSurfaceEvent`；`set(bool)` 同值返回 "noop" 且不落事件、异值返回 "committed"；`active()` 取回放最后一条、空日志默认 false。core `plan_test.cj` **3 条**（round-trip flush→load 不进 surface、noop 不追加、空默认）。**仍缺**：上游 `'queued'`/`'cancelled'` 两态（在 pre-step 边界落地）、`exit_plan_mode` 工具、`/plan` 命令、`plan:policy` prompt section、`PlanModeConfig` 加载期校验；见 `docs/evidence/upstream-module-reads-2026-10-04.md` §4 B 组 |
| product-telemetry | ✔ | ✔ | M1 | ✔ | ☐ | 未实现（C 档，行 29）；无任何上报。**C04 已核**：上游 product-telemetry 模块 79 行确证有 `ctx.productTelemetry.emit` 同步入队 + `ctx.productAnalytics` @Remote（enabled/watchPolicy/report），导出器不自动收集 Session 数据或标识。本仓无上报不等于裁剪已验收；上游数据、目的地已核，可替换边界保留 |
| ptc-runtime | ✔ | ✔ | M4 | ✔ | ☐ | 未实现（C 档，行 30） |
| sandbox | ✔ | ✔ | M4 | ✔ | ◐ | `core/src/sandbox.cj` 三档优先级解析（显式 > 会话最后 > 部署默认）+ `SandboxRuntime.confine` fail-closed：`danger-full-access` 不在 confined 集合直接拒、`withoutBackend()` 无后端时抛 `SANDBOX_UNAVAILABLE`，禁止 unconfined passthrough。5 条用例。**上游校正**：上游还有 `ConfinedSandboxMode` 类型级收窄、`SandboxEnforcement = full | partial` 与 `signal?` 中止传播；本仓只在运行期检查字符串模式，无 enforcement 分级，也不接 OS 级沙箱后端 |
| schedule | ✔ | ✔ | M3 | ✔ | ☐ | 未实现（C 档，行 32） |
| scope | ✔ | ✔ | M0 | ✔ | ☐ | 未实现（C 档，行 33） |
| session | ✔ | ✔ | M1 | ✔ | ✔ | 编号与 seq 连续性、flush/load 往返、写租约互斥与 owner 凭据、**崩溃残留租约按持有者死活分别接管与拒绝**（CFFI 取 pid + 判活）；两入口同函数实测。**上游校正**：上游 surface 类型系统（`SessionEventSurface=current/shadowed/log-only`、`SessionRecord{header,live,persisted}`）本仓未实现投影层区分 |
| session-projection | ✔ | ✔ | M1 | ✔ | ✔ | `deriveMessages()` 纯函数 + 以「surface 条数 + 代次」为键的缓存：无关事件不重算并交回同一份缓存对象；两个方向的变异体都被抓（§6.1.2 D 档第 1 条补实后由 D 移入 A）。**上游校正**：上游 `SessionProjectionMap` 支持多投影注册（agentTeam/goal/compaction/deliverables 等），本仓只有单一 `deriveMessages()` 投影；上游持久化缓存键本仓用内存缓存 |
| session-query | ✔ | ✔ | M1 | ✔ | ☐ | 未实现（C 档，行 36）；只有投影与分页读取，无查询面 |
| session-reference | ✔ | ✔ | M1 | ✔ | ☐ | 未实现（C 档，行 37） |
| session-telemetry | ✔ | ✔ | M1 | ✔ | ☐ | 未实现（C 档，行 38）。**C04 已核**：上游 session-telemetry 模块 213 行确证有 `SessionTelemetryRecord` 两 channel（ledger 镜像 + ops）+ `session-telemetry/record` waterfall 脱敏扩展点 + fail-closed（抛异常的监听器扣下该条记录）。保留本地诊断需求，外发默认关闭，不直接排除整模块 |
| session-title | ✔ | ✔ | M1 | ✔ | ◐ | 核心切片已落 `core/src/title.cj`（2026-10-04）：`session/title` 是 log-only 事件，不进 `isSurfaceEvent` 白名单；`rename` 空/纯空白拒绝且不留事件、非空 trim 后落 source="user"；`registerProvider` 单槽重复注册抛且首次前缀保留；`generateFrom` 无 provider 走 60 上限截断落 source="fallback"。core `title_test.cj` **4 条**（round-trip 回放 + 空拒绝 + 单槽 + 截断）。**仍缺**：`SessionTitleProviderId` branded、上游 `first-prompt`/`all-prompts` 自动模式、host IPC `session/title-*` 通道、CLI `dsh title` 子命令；见 `docs/evidence/upstream-module-reads-2026-10-04.md` §4 C01 |
| settings | ✔ | ✔ | M5/M6 | ✔ | ◐ | `core/src/settings.cj` 三种变更：`update::<k>::<v>` 合并单键、`replace::<k=v,...>` 先清空再应用整份、`mutate::<k>::<expected>::<new>` 按当前值 CAS 拒陈旧；`settings/document-updated` 走 log-only 事件不进 surface。3 条用例覆盖合并、整替、CAS 拒绝。**上游校正**：完整配置域未实现；中文设置窗已接当前会话预算与持久外观，模型/凭证/扩展管理仍未开放，本切片只覆盖 document-updated 契约面，不以局部设置窗判定整个模块完成 |
| shell | ✔ | ✔ | M4 | ✔ | ☐ | 未实现（C 档，行 41） |
| sidebar-right | ✔ | ✔ | M5/M6 | ✔ | ☐ | 未实现（C 档，行 42）；§6.1.3 的 Sidebar / Rightbar 两个面未落地。**上游校正**：上游 sidebar-right 是 React 组合系统（tab-type registry + dsh-resource:// 地址 + dockkit 布局），zh 版在冻结 commit 不存在（404），本仓 Vue runtime 架构根本不同 |
| skills | ✔ | ✔ | M4 | ✔ | ☐ | 未实现（C 档，行 43） |
| slots | ✔ | ✔ | M5/M6 | ✔ | ☐ | 未实现（C 档，行 44）；渲染层只到令牌层 + 组件令牌桥接，无上游槽位/呈现体系 |
| spill | ✔ | ✔ | M1 | ✔ | ☐ | 未实现（C 档，行 45） |
| ssh | ✔ | ✔ | M8 | ✔ | ☐ | 未实现（C 档，行 46） |
| storage | ✔ | ✔ | M1 | ✔ | ◐ | `core/src/storage.cj` `StorageHub`：`domain/changed` log-only 事件承载 `open::<name>::<version>` / `close::<name>` / `put::<name>::<k>::<v>`；`open` 严格序列拒绝（内存开启集重名 → already-open；日志已存在同名不同版本 → version-mismatch），两者都 throw 不落事件；`putFrom` 供回放不再重复 append。4 条用例覆盖往返+回放、重名拒、版本拒、close 后同版本可重开。**上游校正**：真源仍是追加式 `session.log`，无上游的多 backend / facet / `malformed-medium` / `invalid-record` 分类；`domain/changed` 跨进程推送未做 |
| subagent | ✔ | ✔ | M7 | ✔ | ☐ | 未实现（C 档，行 48） |
| subprocess | ✔ | ✔ | M4 | ✔ | ✔ | `core/src/extproc.cj` 以子进程驱动外部脚本宿主跑 NDJSON JSON-RPC：握手必须来自子进程真实应答、按 `callId` 配对与取消、未知方法回 `-32601`、超时不编终态、强杀后读线程照样收束、命令不存在 fail-closed。core 15 条 + extjs 14 条 |
| system-prompt | ✔ | ✔ | M2 | ✔ | ✔ | `core/src/sysprompt.cj` `SystemPromptBuilder` 从 `ToolRegistry` 读工具名与描述组装提示，角色定义在前、工具清单在后；core `sysprompt_test.cj` 3 条 + CLI headless 3 条断言。CLI `seed` 模式已接入而非硬编 |
| terminal | ✔ | ✔ | M4 | ✔ | ☐ | 未实现（C 档，行 51）；无 PTY。Ctrl+C 走的是 `SetConsoleCtrlHandler`（`core/src/sigwin.cj`），属中断处理面，不等于终端子系统 |
| todo | ✔ | ✔ | M7 | ✔ | ◐ | 核心切片已落 `core/src/todo.cj`（2026-10-04）：`TodoItem` 只有 content 与三态 status（pending/in_progress/completed），刻意无 id/priority/activeForm；`todo/write` 是 log-only 事件不进 `isSurfaceEvent`；每次 write 全量替换（last-write-wins）；空数组仍落事件以便回放能追问「什么时候清的」；任一 status 非法整次拒绝且一条事件都不留。core `todo_test.cj` **4 条**（round-trip + 全量替换 + 非法拒写 + 清空快照）。**仍缺**：模型工具 `dsh-tool-todo` 与 invariant companion（一次校验既有 + 增量跟踪 turn 边界）；见 `docs/evidence/upstream-module-reads-2026-10-04.md` §4 D 组 |
| token-meter | ✔ | ✔ | M2 | ✔ | ✔ | `core/src/meter.cj` `TokenMeter`：usage 只从会话日志重算（`turn/usage`、`usage/over-budget`、`usage/bad-usage`、`usage/budget`），超档那笔不计入且之后不开新轮（Host `-32014`），预算只可收紧且收紧本身是日志事实；Host 出 `usage/status`+`usage/set-budget` 与 `turn/poll` 读数，CLI `stream` 8 条断言。**上游校正**：上游 `TokenSurfaceNode` 有 route-priced request-image pricing（`ctx.llm.imageRequestPricing`）与 `heuristicTokens` 影子定价，本仓无节点级定价；**C02 部分核**：未发现订阅/支付/商业权益字段 |
| tools | ✔ | ✔ | M4 | ✔ | ✔ | `core/src/agent.cj` 两个入口共用同一条 `pipeline`（guard → 参数归一化 → snapshot → 执行 → 无损校验），失败归一成互不相同的阶段码并落 `tool/result`；`pipeline_test.cj` 4 条，内容截断变异体能同时咬住两条。缺 `projectContent`/`finalizeContent` 等上游分段，见 §6.1.2 补证第 3 条剩余项。阶段码已含 `not-found`、`fs-stale-version`（读侧与本批新增）。**上游校正**：四段管线契约一致；上游 `ToolRestriction`(per-scope allow/deny) 与 `defineTool` DSL(`ValueSchemaSpec`) 本仓未实现 |
| typert | ✔ | ✔ | M0 | ✔ | ☐ | 未实现（C 档，行 55） |
| user-questions | ✔ | ✔ | M7 | ✔ | ☐ | 未实现（C 档，行 56）。**上游已核**：`AskUserQuestionItem`(id/question/detail?/header?/options?/multiSelect?/intent?) + `AskUserQuestionIntent`(kind=plan-review) + `askTimed`(返回 pending=仍可答) + `@Remote answer`(REPLY_QUEUED 拒绝第二次) + `user-questions/request` waterfall。阶段定为 M7（委托与编排）。已有的审批/人在环面属 `approval` 行，不连带勾选 |
| voice-input | ✔ | ✔ | M8 | ✔ | ☐ | 未实现（C 档，行 57） |
| web | ✔ | ✔ | M4 | ✔ | ☐ | 未实现（C 档，行 58）；全仓无 HTTP/SSE 客户端 |
| web-client | ✔ | ✔ | M5/M6 | ✔ | ✔ | Electron 桌面入口 + 渲染层（Vue runtime + `h()`，IPC 有限面 9 个动作）；`--ui-smoke` **32 条真机断言**（流式/审批工单/取消/放行前 `pending>0`/`window.require` 为 undefined），开发态与打包态各验一次。**上游校正**：上游 Web Client 是浏览器侧 Cordis 应用（Client Modules + API Gateway + Slots + Conversation 四底座），本仓是 Electron 壳 + Vue 渲染层 + IPC 有限面，属壳层复刻（入口与隔离面）非架构复刻（Cordis 插件图 + API Gateway + Slots） |
| web-server | ✔ | ✔ | M5/M6 | ✔ | ☐ | 未实现（C 档，行 60）。**上游已核**：`WebRoute`(exact/prefix) + `Config`(host/port) + `connection/request` waterfall + `webserver/index-inject` emit。本仓宿主是 stdio NDJSON JSON-RPC（`apps/host`），与上游 server 形态不同。**C01/C03 已核**：上游 web-server carrier 不拥有 TLS/auth/Origin，未来 HTTP/WebSocket 访问认证、Origin 和网络访问控制必须保留 |
| webhook | ✔ | ✔ | M8 | ✔ | ◐ | 核心切片已落 `core/src/webhook.cj`（2026-10-04）：`WebhookRuntime` 按 ruleId→kind 索引；`register` 单槽拒绝重复 id 且首次 kind 保留；`unregister` 未知 id 与「已注销再注销」同族抛；`dispatch(deliveryId,kind)` 快照当前 active 规则、按 kind 匹配、返回处理条数，无匹配也返 0（fire-and-forget 不抛）；**没有**队列/重试/去重/执行状态/崩溃回放/完成回执。core `webhook_test.cj` **4 条**（按 kind 计数、重复 id 拒绝、未知 kind 返 0、注销后再注销抛）。**仍缺**：`VerifiedWebhookDelivery` freeze、`WebhookRule.run(delivery,signal)` 真回调、GitHub adapter route 注册与 `202` 立即应答、`WebhookSessionRequest` 必填字段与后续 Session 创建；见 `docs/evidence/upstream-module-reads-2026-10-04.md` §4 D 组 |
| workflow | ✔ | ✔ | M7 | ✔ | ☐ | 未实现（C 档，行 62） |
| workspace | ✔ | ✔ | M5/M6 | ✔ | ☐ | 工作区模块部分实现（C 档，行 63）；本地会话支持列表、新建、切换和恢复；桌面项目目录选择已接入共享核心日志，真实相对文件读写使用所选目录。**上游校正**：上游有 `WorkspaceRegistry`（`WorkspaceId`=Branded uuid、`realpathNormalize` 唯一唯一性 canon、`create/resolveByPath/archiveSession/pinSession`、startup 等 `sessionPersistence` 强制依赖），本仓无 registry，工作区分组/元数据及 CLI 对应交互未完成，安装包未复验，不把应用会话存储目录称为项目工作区；见桌面布局证据的项目目录增量 |
| README | ✔ | — | 待定 | — | ☐ | 子系统目录索引页，**不是一条能力**；此前被算进「64 个模块」的分母，本节已按 63 + 1 更正（§6.1.2 D 档第 2 条）。上游已核列不适用 |
