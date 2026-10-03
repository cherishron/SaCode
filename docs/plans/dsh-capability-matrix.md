# DSH 能力矩阵（S0 冻结快照 + 2026-10-03 分母定档与本方状态回填）

快照：`deepseek-ai/deepseek-harness` @ `639ed015397290b3745d163aafe02ffee4aa3f84`（提交时间 2026-09-29T09:21:31Z，默认分支 `master`，SPDX `MIT`），抓取日 2026-10-02。

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

`zh`=仓库是否含中文文档；`站点参考页`=站点导航是否有同模块页；`建议阶段`=按下方关键词规则的粗分，**需人工复核，不作为承诺**；`上游已核`=我们是否已直读过该模块的 en/zh 原文与生成物——**本列全部为 ☐**：`docs/evidence/dsh-upstream-freeze.md` 明确记「64 模块逐篇的上游已核尚未完成，账本声明的覆盖数 8 是冻结取证面，不是阅读面」，逐模块原文核对是独立一批，不因本方写了实现就反推读过。

`已复刻`＝**本仓实现 + 该模块级验收用例**，取值三档：
- `✔`＝方案 §6.1.2 A 档（指得到具体用例名/计数）；
- `◐`＝切片或 A 档里仍有明确缺口，`备注` 写清缺哪一段；
- `☐`＝C 档未实现（全仓关键词 0 命中，唯一命中是假阳性的那条已在 §6.1.2 记名）。

阶段关键词规则：M0 基座（cordis/core/scope/invariants/boot/typert/gateway）、M1 会话与存储、M2 模型与上下文、M3 loop 与目标、M4 工具与执行世界、M5/M6 客户端与前端装配、M7 委托与编排、M8 外部集成。

编号口径：矩阵没有逐条 M 号，方案 §6.1.2 引用时用**表内行序**（1=`agent-team` … 63=`workspace`，64=README 行）。

计数（2026-10-03 token 计量与预算回填后）：`✔` 10 行、`◐` 4 行、`☐` 49 行（63 个模块行）；README 行不参与计数。判据与逐行出处见 `docs/plans/plan-deepseek-harness-replication.md` §6.1.2，本列不另立第二套分类。

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
| conversation | ✔ | ✔ | M5/M6 | ☐ | ◐ | 切片（§6.1.2 B 档，行 11）：`renderer/app.js` 只按角色拆文本，无节点/分组/折叠，也无对应用例 |
| core | ✔ | ✔ | M0 | ☐ | ✔ | 本仓 `core/` 即共享核心（会话日志唯一真源、投影、取消/背压、扩展进程驱动），两个入口同依赖；core `cjpm test` **99/99**。不等同上游 `cordis` 整体，见上方 M0 裁决 |
| credentials | ✔ | ✔ | M5/M6 | ☐ | ☐ | 未实现（C 档，行 13）；真模型凭证在仓外，未做任何存取 |
| deliverables | ✔ | ✔ | M5/M6 | ☐ | ☐ | 未实现（C 档，行 14） |
| extensions | ✔ | ✔ | M8 | ☐ | ✔ | `core/src/ext.cj` 注册表 + `extjs/` 独立 Node 宿主 + `core/src/extproc.cj` 子进程驱动；未登记即拒、卸载残留归 0、退出必须结算。core `ExtProcess` 15 条 + extjs 14 条 + CLI `dsh extjs` 12 项 |
| feedback | ✔ | ✔ | M5/M6 | ☐ | ☐ | 未实现（C 档，行 16） |
| filesystem | ✔ | ✔ | M4 | ☐ | ◐ | 本批补上读侧：`read` 与 `write` 共用同一条管线，读交回盘上真实字节并留下版本标记，同路径的写在发现第三方改动（**等长也算**）时于写入前被 `fs-stale-version` 拒掉且不改盘（core `fs_test.cj` 4 条 + bridge 1 条入口往返 + CLI 4 条断言）。**仍缺**：edit/glob/grep 与多文件观察面，故只记 ◐ |
| goal | ✔ | ✔ | M3 | ☐ | ☐ | 未实现（C 档，行 18） |
| invariants | ✔ | ✔ | M0 | ☐ | ☐ | 未实现（C 档，行 19）。本仓 §4 的 18 条不变量是**我方复刻口径**，不是对该模块的运行实现；且该行只存在于冻结快照，master 已无（见上方漂移） |
| jobs | ✔ | ✔ | M4 | ☐ | ☐ | 未实现（C 档，行 20） |
| llm-streaming | ✔ | ✔ | M2 | ☐ | ◐ | 假 provider 的半帧/UTF-8 分片/终态/`max-tokens`/usage 次序有用例；**缺口**：真模型 HTTPS+SSE 烟测待用户凭证（补证清单第 4 条） |
| lsp | ✔ | ✔ | M4 | ☐ | ☐ | 未实现（C 档，行 22）；`ToolSpec` 含子串 `lSp` 属假阳性，已记名 |
| mcp | ✔ | ✔ | M7 | ☐ | ☐ | 未实现（C 档，行 23） |
| office-to-pdf | ✔ | ✔ | M8 | ☐ | ☐ | 未实现（C 档，行 24） |
| otel | ✔ | ✔ | M8 | ☐ | ☐ | 未实现（C 档，行 25） |
| permission-presets | ✔ | ✔ | M4 | ☐ | ☐ | 未实现（C 档，行 26）；审批只有「允许一次/拒绝」，无预设档位与永久授权 |
| persistence | ✔ | ✔ | M1 | ☐ | ✔ | `session.log` 的 append/flush 持久化屏障、崩溃恢复合成、尾帧截断（丢半写帧保留已提交前缀）、中段缺帧整份拒绝；core `session` 22 条 + bridge durability 用例 |
| plan | ✔ | ✔ | M4 | ☐ | ☐ | 未实现（C 档，行 28） |
| product-telemetry | ✔ | ✔ | M1 | ☐ | ☐ | 未实现（C 档，行 29）；无任何上报 |
| ptc-runtime | ✔ | ✔ | M4 | ☐ | ☐ | 未实现（C 档，行 30） |
| sandbox | ✔ | ✔ | M4 | ☐ | ☐ | 未实现（C 档，行 31）；Electron 自带的 `sandbox` 开关是另一回事，不作命中依据 |
| schedule | ✔ | ✔ | M3 | ☐ | ☐ | 未实现（C 档，行 32） |
| scope | ✔ | ✔ | M0 | ☐ | ☐ | 未实现（C 档，行 33） |
| session | ✔ | ✔ | M1 | ☐ | ✔ | 编号与 seq 连续性、flush/load 往返、写租约互斥与 owner 凭据、**崩溃残留租约按持有者死活分别接管与拒绝**（CFFI 取 pid + 判活）；两入口同函数实测 |
| session-projection | ✔ | ✔ | M1 | ☐ | ✔ | `deriveMessages()` 纯函数 + 以「surface 条数 + 代次」为键的缓存：无关事件不重算并交回同一份缓存对象；两个方向的变异体都被抓（§6.1.2 D 档第 1 条补实后由 D 移入 A） |
| session-query | ✔ | ✔ | M1 | ☐ | ☐ | 未实现（C 档，行 36）；只有投影与分页读取，无查询面 |
| session-reference | ✔ | ✔ | M1 | ☐ | ☐ | 未实现（C 档，行 37） |
| session-telemetry | ✔ | ✔ | M1 | ☐ | ☐ | 未实现（C 档，行 38） |
| session-title | ✔ | ✔ | M1 | ☐ | ☐ | 未实现（C 档，行 39） |
| settings | ✔ | ✔ | M5/M6 | ☐ | ☐ | 未实现（C 档，行 40）；§6.1.3 里 Settings 窗仍是未接面 |
| shell | ✔ | ✔ | M4 | ☐ | ☐ | 未实现（C 档，行 41） |
| sidebar-right | ✔ | ✔ | M5/M6 | ☐ | ☐ | 未实现（C 档，行 42）；§6.1.3 的 Sidebar / Rightbar 两个面未落地 |
| skills | ✔ | ✔ | M4 | ☐ | ☐ | 未实现（C 档，行 43） |
| slots | ✔ | ✔ | M5/M6 | ☐ | ☐ | 未实现（C 档，行 44）；渲染层只到令牌层 + 组件令牌桥接，无上游槽位/呈现体系 |
| spill | ✔ | ✔ | M1 | ☐ | ☐ | 未实现（C 档，行 45） |
| ssh | ✔ | ✔ | M8 | ☐ | ☐ | 未实现（C 档，行 46） |
| storage | ✔ | ✔ | M1 | ☐ | ☐ | 未实现（C 档，行 47）；真源是追加式 `session.log`，无上游的存储后端形态 |
| subagent | ✔ | ✔ | M7 | ☐ | ☐ | 未实现（C 档，行 48） |
| subprocess | ✔ | ✔ | M4 | ☐ | ✔ | `core/src/extproc.cj` 以子进程驱动外部脚本宿主跑 NDJSON JSON-RPC：握手必须来自子进程真实应答、按 `callId` 配对与取消、未知方法回 `-32601`、超时不编终态、强杀后读线程照样收束、命令不存在 fail-closed。core 15 条 + extjs 14 条 |
| system-prompt | ✔ | ✔ | M2 | ☐ | ◐ | 切片（B 档，行 50）：`apps/cli/src/main.cj` 把系统提示硬编成一条事件，无组装/分层/用例 |
| terminal | ✔ | ✔ | M4 | ☐ | ☐ | 未实现（C 档，行 51）；无 PTY。Ctrl+C 走的是 `SetConsoleCtrlHandler`（`core/src/sigwin.cj`），属中断处理面，不等于终端子系统 |
| todo | ✔ | ✔ | M7 | ☐ | ☐ | 未实现（C 档，行 52） |
| token-meter | ✔ | ✔ | M2 | ☐ | ✔ | `core/src/meter.cj` `TokenMeter`：usage 只从会话日志重算（`turn/usage`、`usage/over-budget`、`usage/bad-usage`、`usage/budget`），超档那笔不计入且之后不开新轮（Host `-32014`），预算只可收紧且收紧本身是日志事实；Host 出 `usage/status`+`usage/set-budget` 与 `turn/poll` 读数，CLI `stream` 8 条断言 |
| tools | ✔ | ✔ | M4 | ☐ | ✔ | `core/src/agent.cj` 两个入口共用同一条 `pipeline`（guard → 参数归一化 → snapshot → 执行 → 无损校验），失败归一成互不相同的阶段码并落 `tool/result`；`pipeline_test.cj` 4 条，内容截断变异体能同时咬住两条。缺 `projectContent`/`finalizeContent` 等上游分段，见 §6.1.2 补证第 3 条剩余项。阶段码已含 `not-found`、`fs-stale-version`（读侧与本批新增） |
| typert | ✔ | ✔ | M0 | ☐ | ☐ | 未实现（C 档，行 55） |
| user-questions | ✔ | ✔ | 待定 | ☐ | ☐ | 未实现；**阶段待定**：该模块原文未读（`上游已核` 为 ☐），不据名字猜档位。已有的审批/人在环面属 `approval` 行，不连带勾选 |
| voice-input | ✔ | ✔ | M8 | ☐ | ☐ | 未实现（C 档，行 57） |
| web | ✔ | ✔ | M4 | ☐ | ☐ | 未实现（C 档，行 58）；全仓无 HTTP/SSE 客户端 |
| web-client | ✔ | ✔ | M5/M6 | ☐ | ✔ | Electron 桌面入口 + 渲染层（Vue runtime + `h()`，IPC 有限面 9 个动作）；`--ui-smoke` **32 条真机断言**（流式/审批工单/取消/放行前 `pending>0`/`window.require` 为 undefined），开发态与打包态各验一次 |
| web-server | ✔ | ✔ | 待定 | ☐ | ☐ | 未实现；**阶段待定**理由同 `user-questions`。本仓宿主是 stdio NDJSON JSON-RPC（`apps/host`），与上游 server 形态不同，不据「都是服务端」勾选 |
| webhook | ✔ | ✔ | M8 | ☐ | ☐ | 未实现（C 档，行 61） |
| workflow | ✔ | ✔ | M7 | ☐ | ☐ | 未实现（C 档，行 62） |
| workspace | ✔ | ✔ | M5/M6 | ☐ | ☐ | 未实现（C 档，行 63） |
| README | ✔ | — | 待定 | ☐ | ☐ | 子系统目录索引页，**不是一条能力**；此前被算进「64 个模块」的分母，本节已按 63 + 1 更正（§6.1.2 D 档第 2 条） |
