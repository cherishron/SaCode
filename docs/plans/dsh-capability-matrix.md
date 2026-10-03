# DSH 能力矩阵（S0 冻结快照 + 2026-10-03 分母定档与本方状态回填）

快照：`deepseek-ai/deepseek-harness` @ `639ed015397290b3745d163aafe02ffee4aa3f84`（提交时间 2026-09-29T09:21:31Z，默认分支 `master`，SPDX `MIT`），抓取日 2026-10-02。

## 产品裁剪与待核状态（2026-10-03）

产品范围按 [PRD §2.3](../product/PRD.md) 明确裁剪：npm CLI 与 Electron 桌面均本地使用，无需 DSH 官方账号登录，用户自行配置模型及服务凭证。下表是**已定产品边界，尚待上游核验**；不据此断言冻结上游确实存在对应账号或商业功能，不声明代码已移除。

| PRD 编号 | 裁剪范围 | 核验入口（候选，非已确认归属） | 当前状态与保留要求 |
| --- | --- | --- | --- |
| C01 | 若存在，排除官方注册、登录、账号绑定及其本地使用门槛 | boot、settings、credentials、web-client、web-server 及相关配置/插件 | 范围已裁决；存在性、源码位置和依赖待核。保留第三方凭证、IPC/会话身份及远程访问认证 |
| C02 | 若存在，排除官方订阅、支付、商业权益与云端额度校验 | token-meter、settings、模型 provider 及相关配置/插件 | 范围已裁决；商业计费与本地计量边界待核。保留 token 用量和本地预算 |
| C03 | 若存在，排除官方账号绑定的同步、云存储和云会话服务 | storage、session、workspace、web-client、web-server 及相关 provider | 范围已裁决；数据归属与调用链待核。保留本地持久化、恢复及双入口一致性 |
| C04 | 排除官方账号关联遥测与默认官方上报；遥测默认关闭，后续仅提供用户明确启用的可替换服务 | product-telemetry、session-telemetry、otel 及配置/上报 provider | 范围已裁决；数据、目的地和默认行为待核。保留本地诊断需求，启用和关闭均需两入口验收 |

核验需对照冻结快照的文档、源码、配置及测试，登记证据路径、调用链、两入口影响、被排除需求及保留需求。未找到实现时记录核验范围与依据，不能写成“已移除”。裁剪不改变下方 **63 模块 + 1 README** 清单、行序或分母；相关模块仍核验保留需求，不按名字删除 `auth`/`credentials`/`token` 能力。

本节不新增模块行，不修改既有实现计数，也不勾选“上游已核”。既有 `✔` 仅沿用本仓用例口径，不证明裁剪边界已验收。裁剪条目完成核验及 PRD A11 两入口测试后才能登记“排除（已裁决、已核）”，不得算作实现通过或无差异兼容。完成后的产品表述为“裁剪范围内完整复刻，排除官方商业账号及云服务绑定”。

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

2026-10-03 R0 收口：代码 `6e060ff` 已修复计量的租约恢复、正常退出漏记及收紧预算放行问题，控制字符转义、npm 启动源码与 CLI 计量断言也已入库。干净提交核心 119/119、桌面 53/53、扩展 14/14，npm 安装后 stream 17 条与 tool 11 条 ALL PASS；见 [R0 证据](../evidence/r0-review-closeout-2026-10-03.md)。下方旧测试计数保留原批次含义，不扩称当前 Electron 整包已通过。token-meter 的 C02 上游商业边界与 C01–C04 裁剪核验仍待完成。

`zh`=仓库是否含中文文档；`站点参考页`=站点导航是否有同模块页；`建议阶段`=按下方关键词规则的粗分，**需人工复核，不作为承诺**；`上游已核`=我们是否已直读过该模块的 en/zh 原文与生成物——**本列全部为 ☐**：`docs/evidence/dsh-upstream-freeze.md` 明确记「64 模块逐篇的上游已核尚未完成，账本声明的覆盖数 8 是冻结取证面，不是阅读面」，逐模块原文核对是独立一批，不因本方写了实现就反推读过。

`已复刻`＝**本仓实现 + 该模块级验收用例**，取值三档：
- `✔`＝方案 §6.1.2 A 档（指得到具体用例名/计数）；
- `◐`＝切片或 A 档里仍有明确缺口，`备注` 写清缺哪一段；
- `☐`＝C 档未实现（全仓关键词 0 命中，唯一命中是假阳性的那条已在 §6.1.2 记名）。

阶段关键词规则：M0 基座（cordis/core/scope/invariants/boot/typert/gateway）、M1 会话与存储、M2 模型与上下文、M3 loop 与目标、M4 工具与执行世界、M5/M6 客户端与前端装配、M7 委托与编排、M8 外部集成。

编号口径：矩阵没有逐条 M 号，方案 §6.1.2 引用时用**表内行序**（1=`agent-team` … 63=`workspace`，64=README 行）。

计数（2026-10-03 系统提示组装接入后）：`✔` 11 行、`◐` 3 行、`☐` 49 行（63 个模块行）；README 行不参与计数。判据与逐行出处见 `docs/plans/plan-deepseek-harness-replication.md` §6.1.2，本列不另立第二套分类。

| 模块 | zh | 站点 | 阶段 | 上游已核 | 已复刻 | 备注 |
|---|:-:|:-:|---|:-:|:-:|---|
| agent-team | ✔ | ✔ | M3 | ☐ | ☐ | 未实现（§6.1.2 C 档，行 1） |
| approval | ✔ | ✔ | M4 | ☐ | ✔ | `core/src/approval.cj` 工单往返 `ask→answer→一次性 consume`，`asked/decided/expired` 进同一份会话日志；过期由真实单调钟决定（`approval/tick` 通道已撤）。core 9 条 + bridge 6 条；两刀变异反证（去一次性置位、去决定白名单）|
| attachment | ✔ | ✔ | M5/M6 | ☐ | ☐ | 未实现（C 档，行 3） |
| boot | ✔ | ✔ | M0 | ☐ | ☐ | 未实现（C 档，行 4）；本仓入口是 `main(args)` 直起，无上游启动装配序列 |
| browser-use | ✔ | ✔ | M8 | ☐ | ☐ | 未实现（C 档，行 5） |
| client-modules | ✔ | ✔ | M5/M6 | ☐ | ☐ | 未实现（C 档，行 6） |
| client-resources | ✔ | ✔ | M5/M6 | ☐ | ☐ | 未实现（C 档，行 7） |
| commands | ✔ | ✔ | M7 | ☐ | ☐ | 未实现（C 档，行 8） |
| compaction | ✔ | ✔ | M2 | ☐ | ☐ | 未实现（C 档，行 9） |
| computer-use | ✔ | ✔ | M8 | ☐ | ☐ | 未实现（C 档，行 10） |
| conversation | ✔ | ✔ | M5/M6 | ☐ | ✔ | 切片已收口：`renderer/app.js` 经 `BubbleProvider + BubbleList`（`groupStrategy=consecutive`）按角色分组，正文由本仓自定义内容渲染器出（默认链把 `role==="tool"` 交给只渲染注释节点的 ToolRole，不接就隐身），长正文按 `renderer/msgfold.js` 的单一阈值默认折叠并可展开/收起；`--ui-smoke` 钉住组数、角色分布、placement、组标签、合并、折叠三态、tool 可见与 `--tr-*` 色值桥接（各条见 `docs/evidence/p0-status-2026-10-02.md`）。**剩余**：落盘正文出自假 provider（`CancellableStreamProvider`）的装配结果，真模型 provider 未接；干净收束路径上 `tool/call`/`tool/result` 仍不落盘（只有取消路径结算）；`上游已核` 仍需读 63 篇原文 |
| core | ✔ | ✔ | M0 | ☐ | ✔ | 本仓 `core/` 即共享核心（会话日志唯一真源、投影、取消/背压、扩展进程驱动），两个入口同依赖；core `cjpm test` **99/99**。不等同上游 `cordis` 整体，见上方 M0 裁决 |
| credentials | ✔ | ✔ | M5/M6 | ☐ | ☐ | 未实现（C 档，行 13）；真模型凭证在仓外，未做任何存取。**保留**模型/第三方凭证安全存取、脱敏和轮换；C01 官方账号绑定边界待核，不整模块裁剪 |
| deliverables | ✔ | ✔ | M5/M6 | ☐ | ☐ | 未实现（C 档，行 14） |
| extensions | ✔ | ✔ | M8 | ☐ | ✔ | `core/src/ext.cj` 注册表 + `extjs/` 独立 Node 宿主 + `core/src/extproc.cj` 子进程驱动；未登记即拒、卸载残留归 0、退出必须结算。core `ExtProcess` 15 条 + extjs 14 条 + CLI `dsh extjs` 12 项 |
| feedback | ✔ | ✔ | M5/M6 | ☐ | ☐ | 未实现（C 档，行 16） |
| filesystem | ✔ | ✔ | M4 | ☐ | ◐ | `read`/`write` 共用管线，按解析后的路径身份保存原始字节与存在/缺失观察；已有文件未观察拒绝覆盖，等长改动、已观察后删除均拒绝旧版本写入，缺失后外部创建拒绝覆盖；非法 UTF-8 不登记成功，控制字符回执无损，读取正文入日志可重放，新建发布禁止替换。core `fs_test.cj` **11 条**（本轮 core 总计 **116/116、rc=0**）；隔离快照 bridge 文件系统往返 2 条、CLI `tool` 11 条断言沿用现有验收报告，不扩称当前计量版整包验收。**仍缺**：edit/glob/grep、provider/consumer 拆分、有界读取与已有文件的受保护原子替换，故仍记 ◐；见 `docs/evidence/filesystem-review-fixes-2026-10-03.md` |
| goal | ✔ | ✔ | M3 | ☐ | ☐ | 未实现（C 档，行 18） |
| invariants | ✔ | ✔ | M0 | ☐ | ☐ | 未实现（C 档，行 19）。本仓 §4 的 18 条不变量是**我方复刻口径**，不是对该模块的运行实现；且该行只存在于冻结快照，master 已无（见上方漂移） |
| jobs | ✔ | ✔ | M4 | ☐ | ☐ | 未实现（C 档，行 20） |
| llm-streaming | ✔ | ✔ | M2 | ☐ | ◐ | 假 provider 的半帧/UTF-8 分片/终态/`max-tokens`/usage 次序有用例；**缺口**：真模型 HTTPS+SSE 烟测待用户凭证（补证清单第 4 条） |
| lsp | ✔ | ✔ | M4 | ☐ | ☐ | 未实现（C 档，行 22）；`ToolSpec` 含子串 `lSp` 属假阳性，已记名 |
| mcp | ✔ | ✔ | M7 | ☐ | ☐ | 未实现（C 档，行 23） |
| office-to-pdf | ✔ | ✔ | M8 | ☐ | ☐ | 未实现（C 档，行 24） |
| otel | ✔ | ✔ | M8 | ☐ | ☐ | 未实现（C 档，行 25）。C04：默认不外发，上游 exporter、配置与账号依赖待核；仅以明确启用的可替换服务提供，不整模块标为已裁剪 |
| permission-presets | ✔ | ✔ | M4 | ☐ | ☐ | 未实现（C 档，行 26）；审批只有「允许一次/拒绝」，无预设档位与永久授权 |
| persistence | ✔ | ✔ | M1 | ☐ | ✔ | `session.log` 的 append/flush 持久化屏障、崩溃恢复合成、尾帧截断（丢半写帧保留已提交前缀）、中段缺帧整份拒绝；core `session` 22 条 + bridge durability 用例 |
| plan | ✔ | ✔ | M4 | ☐ | ☐ | 未实现（C 档，行 28） |
| product-telemetry | ✔ | ✔ | M1 | ☐ | ☐ | 未实现（C 档，行 29）；无任何上报。C04：排除官方账号关联与默认官方上报，遥测默认关闭；上游数据、目的地和可替换边界待核，当前无上报不等于裁剪已验收 |
| ptc-runtime | ✔ | ✔ | M4 | ☐ | ☐ | 未实现（C 档，行 30） |
| sandbox | ✔ | ✔ | M4 | ☐ | ☐ | 未实现（C 档，行 31）；Electron 自带的 `sandbox` 开关是另一回事，不作命中依据 |
| schedule | ✔ | ✔ | M3 | ☐ | ☐ | 未实现（C 档，行 32） |
| scope | ✔ | ✔ | M0 | ☐ | ☐ | 未实现（C 档，行 33） |
| session | ✔ | ✔ | M1 | ☐ | ✔ | 编号与 seq 连续性、flush/load 往返、写租约互斥与 owner 凭据、**崩溃残留租约按持有者死活分别接管与拒绝**（CFFI 取 pid + 判活）；两入口同函数实测 |
| session-projection | ✔ | ✔ | M1 | ☐ | ✔ | `deriveMessages()` 纯函数 + 以「surface 条数 + 代次」为键的缓存：无关事件不重算并交回同一份缓存对象；两个方向的变异体都被抓（§6.1.2 D 档第 1 条补实后由 D 移入 A） |
| session-query | ✔ | ✔ | M1 | ☐ | ☐ | 未实现（C 档，行 36）；只有投影与分页读取，无查询面 |
| session-reference | ✔ | ✔ | M1 | ☐ | ☐ | 未实现（C 档，行 37） |
| session-telemetry | ✔ | ✔ | M1 | ☐ | ☐ | 未实现（C 档，行 38）。C04：上游本地诊断与外发遥测边界待核；保留本地诊断需求，外发默认关闭，不直接排除整模块 |
| session-title | ✔ | ✔ | M1 | ☐ | ☐ | 完整模块未实现（C 档，行 39）；桌面新建名称已保存为 `session/title` 并用于列表及主标题，尚未核验上游标题生成/编辑契约与 CLI 交互，不据此改变模块计数 |
| settings | ✔ | ✔ | M5/M6 | ☐ | ☐ | 完整配置域未实现（C 档，行 40）；中文设置窗已接当前会话预算与持久外观，模型/凭证/扩展管理仍未开放，不以局部设置窗判定整个模块完成 |
| shell | ✔ | ✔ | M4 | ☐ | ☐ | 未实现（C 档，行 41） |
| sidebar-right | ✔ | ✔ | M5/M6 | ☐ | ☐ | 未实现（C 档，行 42）；§6.1.3 的 Sidebar / Rightbar 两个面未落地 |
| skills | ✔ | ✔ | M4 | ☐ | ☐ | 未实现（C 档，行 43） |
| slots | ✔ | ✔ | M5/M6 | ☐ | ☐ | 未实现（C 档，行 44）；渲染层只到令牌层 + 组件令牌桥接，无上游槽位/呈现体系 |
| spill | ✔ | ✔ | M1 | ☐ | ☐ | 未实现（C 档，行 45） |
| ssh | ✔ | ✔ | M8 | ☐ | ☐ | 未实现（C 档，行 46） |
| storage | ✔ | ✔ | M1 | ☐ | ☐ | 未实现（C 档，行 47）；真源是追加式 `session.log`，无上游的存储后端形态 |
| subagent | ✔ | ✔ | M7 | ☐ | ☐ | 未实现（C 档，行 48） |
| subprocess | ✔ | ✔ | M4 | ☐ | ✔ | `core/src/extproc.cj` 以子进程驱动外部脚本宿主跑 NDJSON JSON-RPC：握手必须来自子进程真实应答、按 `callId` 配对与取消、未知方法回 `-32601`、超时不编终态、强杀后读线程照样收束、命令不存在 fail-closed。core 15 条 + extjs 14 条 |
| system-prompt | ✔ | ✔ | M2 | ☐ | ✔ | `core/src/sysprompt.cj` `SystemPromptBuilder` 从 `ToolRegistry` 读工具名与描述组装提示，角色定义在前、工具清单在后；core `sysprompt_test.cj` 3 条 + CLI headless 3 条断言。CLI `seed` 模式已接入而非硬编 |
| terminal | ✔ | ✔ | M4 | ☐ | ☐ | 未实现（C 档，行 51）；无 PTY。Ctrl+C 走的是 `SetConsoleCtrlHandler`（`core/src/sigwin.cj`），属中断处理面，不等于终端子系统 |
| todo | ✔ | ✔ | M7 | ☐ | ☐ | 未实现（C 档，行 52） |
| token-meter | ✔ | ✔ | M2 | ☐ | ✔ | `core/src/meter.cj` `TokenMeter`：usage 只从会话日志重算（`turn/usage`、`usage/over-budget`、`usage/bad-usage`、`usage/budget`），超档那笔不计入且之后不开新轮（Host `-32014`），预算只可收紧且收紧本身是日志事实；Host 出 `usage/status`+`usage/set-budget` 与 `turn/poll` 读数，CLI `stream` 8 条断言 |
| tools | ✔ | ✔ | M4 | ☐ | ✔ | `core/src/agent.cj` 两个入口共用同一条 `pipeline`（guard → 参数归一化 → snapshot → 执行 → 无损校验），失败归一成互不相同的阶段码并落 `tool/result`；`pipeline_test.cj` 4 条，内容截断变异体能同时咬住两条。缺 `projectContent`/`finalizeContent` 等上游分段，见 §6.1.2 补证第 3 条剩余项。阶段码已含 `not-found`、`fs-stale-version`（读侧与本批新增） |
| typert | ✔ | ✔ | M0 | ☐ | ☐ | 未实现（C 档，行 55） |
| user-questions | ✔ | ✔ | 待定 | ☐ | ☐ | 未实现；**阶段待定**：该模块原文未读（`上游已核` 为 ☐），不据名字猜档位。已有的审批/人在环面属 `approval` 行，不连带勾选 |
| voice-input | ✔ | ✔ | M8 | ☐ | ☐ | 未实现（C 档，行 57） |
| web | ✔ | ✔ | M4 | ☐ | ☐ | 未实现（C 档，行 58）；全仓无 HTTP/SSE 客户端 |
| web-client | ✔ | ✔ | M5/M6 | ☐ | ✔ | Electron 桌面入口 + 渲染层（Vue runtime + `h()`，IPC 有限面 9 个动作）；`--ui-smoke` **32 条真机断言**（流式/审批工单/取消/放行前 `pending>0`/`window.require` 为 undefined），开发态与打包态各验一次 |
| web-server | ✔ | ✔ | 待定 | ☐ | ☐ | 未实现；**阶段待定**理由同 `user-questions`。本仓宿主是 stdio NDJSON JSON-RPC（`apps/host`），与上游 server 形态不同，不据「都是服务端」勾选。C01/C03 官方账号/云服务边界待核；未来 HTTP/WebSocket 访问认证、Origin 和网络访问控制必须保留 |
| webhook | ✔ | ✔ | M8 | ☐ | ☐ | 未实现（C 档，行 61） |
| workflow | ✔ | ✔ | M7 | ☐ | ☐ | 未实现（C 档，行 62） |
| workspace | ✔ | ✔ | M5/M6 | ☐ | ☐ | 工作区模块未实现（C 档，行 63）；本地会话目录已支持列表、新建、切换和恢复所选会话，但项目目录选择、工作区元数据及 CLI 对应交互未接，不把应用会话存储目录称为项目工作区 |
| README | ✔ | — | 待定 | ☐ | ☐ | 子系统目录索引页，**不是一条能力**；此前被算进「64 个模块」的分母，本节已按 63 + 1 更正（§6.1.2 D 档第 2 条） |
