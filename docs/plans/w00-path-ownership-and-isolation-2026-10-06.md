# W00 步骤 5：路径所有权表与隔离工作安排（2026-10-06，A）

> **进度对账（2026-10-09 整理）**：本文档为历史路径所有权登记/契约，引用基线或能力口径可能已过期。产品真实进度以 [`docs/product/PRD.md`](../product/PRD.md) 的「进度对账（2026-10-09 静态审计）」三档口径为准；若本文与 PRD 冲突，以 PRD 为准。

判据：`node scripts/check_path_ownership.cjs` → `GATE: PASS (n checks, fail=0)`；反证 `--selftest` → `SELFTEST: PASS`。本表是**唯一真源**，门禁直接解析本文件的表体，不另抄一份。

## 1. 路径所有权表（单写入者）

一行一条路径。`类型=file` 精确到文件；`类型=dir` 表示该目录整体归该成员，其他人不得在其中新建或修改。共享目录（`core/src/`、`apps/desktop/renderer/pages/`）一律用 `file` 行 + 一条 `default` 兜底行表达，避免「目录前缀套住别人的文件」这种双主。

| 成员 | 工作包 | 类型 | 路径 |
|---|---|---|---|
| A | W00 | dir | scripts/ |
| A | W00 | file | docs/plans/capability-matrix.md |
| A | W00 | dir | docs/plans/ |
| A | W00 | dir | docs/evidence/ |
| A | W90 | file | apps/host/src/main.cj |
| A | W90 | file | apps/cli/src/main.cj |
| A | W90 | file | apps/desktop/main.cjs |
| A | W90 | file | apps/desktop/preload.cjs |
| A | W90 | file | apps/desktop/renderer/app.js |
| A | W90 | file | apps/desktop/package.json |
| A | W90 | file | apps/desktop/package-lock.json |
| A | W90 | file | scripts/pack-pages.mjs |
| B | W10 | file | core/src/session.cj |
| B | W10 | file | core/src/session_test.cj |
| B | W10 | file | core/src/lease.cj |
| B | W10 | file | core/src/lease_test.cj |
| B | W10 | file | core/src/migration_pack.cj |
| B | W10 | file | core/src/attachment.cj |
| C | W20 | file | core/src/plugin_manifest.cj |
| C | W20 | file | core/src/plugin_store.cj |
| C | W20 | file | core/src/plugin_assembly.cj |
| C | W20 | file | core/src/ext.cj |
| C | W20 | file | core/src/extproc.cj |
| C | W20 | dir | extjs/ |
| D | W30 | file | core/src/model_router.cj |
| D | W30 | file | core/src/route_health.cj |
| D | W30 | file | core/src/ledger.cj |
| D | W30 | file | apps/desktop/renderer/pages/model-center-adapter.ts |
| D | W30 | file | apps/desktop/renderer/pages/budget-stats.ts |
| E | W40 | file | core/src/agent.cj |
| E | W40 | file | core/src/execution_service.cj |
| E | W40 | file | core/src/execution_service_test.cj |
| E | W40 | file | core/src/execution_supervisor.cj |
| E | W40 | file | core/src/execution_supervisor_test.cj |
| E | W40 | file | core/src/execution_output.cj |
| E | W40 | file | core/src/execution_output_test.cj |
| E | W40 | file | core/src/execution_api.cj |
| E | W40 | file | core/src/execution_api_test.cj |
| B | W10 | file | core/src/durable_checkpoint.cj |
| E | W40 | file | core/src/model_tool_runtime.cj |
| E | W40 | file | core/src/model_tool_runtime_test.cj |
| F | W50 | file | core/src/model_agent.cj |
| E | W40 | file | core/src/fs_tools.cj |
| E | W40 | file | core/src/fs_tools_test.cj |
| A | W40 | file | core/src/lsp_contract.cj |
| A | W90 | file | apps/host/src/goal_runtime.cj |
| A | W90 | file | apps/desktop/test-support/goal-host-verify.mjs |
| A | W40 | file | core/src/lsp_contract_test.cj |
| A | W40 | file | core/src/lsp.cj |
| A | W40 | file | core/src/lsp_test.cj |
| A | W40 | file | docs/plans/lsp-l1-entry-wiring-2026-10-07.md |
| A | W90 | file | apps/desktop/host-bridge.cjs |
| E | W40 | file | core/src/ptc_exec.cj |
| A | W40 | file | core/src/appcontainer_win.cj |
| A | W40 | file | core/src/appcontainer_win_test.cj |
| A | KB-02 | file | core/src/knowledge_context.cj |
| A | KB-02 | file | core/src/knowledge_context_test.cj |
| A | KB-02 | file | core/src/model_request.cj |
| A | KB-02 | file | core/src/model_request_test.cj |
| A | KB-02 | file | apps/host/test/knowledge/knowledge-context-host.test.mjs |
| A | KB-02 | file | apps/desktop/renderer/side-panels.js |
| A | KB-02 | file | apps/desktop/renderer/workspace-state.js |
| A | KB-02 | file | apps/desktop/renderer/session-state.js |
| A | KB-02 | file | apps/desktop/test/side-panels.test.mjs |
| E | W40 | file | core/src/shlex.cj |
| E | W40 | file | core/src/shlex_test.cj |
| F | W50 | file | core/src/goal_runner.cj |
| F | W50 | file | core/src/goal_scheduler.cj |
| F | W50 | file | core/src/goal_control.cj |
| F | W50 | file | core/src/goal_activation.cj |
| F | W50 | file | core/src/goal_activation_test.cj |
| F | W50 | file | core/src/goal_claim.cj |
| F | W50 | file | core/src/goal_claim_test.cj |
| F | W50 | file | core/src/goal_evidence.cj |
| F | W50 | file | core/src/goal_evidence_test.cj |
| G | W60 | file | apps/desktop/renderer/pages/slot-core.ts |
| G | W60 | file | apps/desktop/renderer/pages/client-slots.ts |
| G | W60 | file | apps/desktop/renderer/pages/plugin-manager-adapter.ts |
| G | W60 | file | apps/desktop/renderer/pages/migration.ts |
| G | W60 | dir | apps/desktop/renderer/assets/ |
| H | W70 | file | core/src/mcp.cj |
| H | W70 | file | core/src/ssh.cj |
| I | W80 | dir | docs/qa/ |
| G | W60 | file | apps/desktop/renderer/product-design.css |
| G | W60 | file | apps/desktop/renderer/index.html |
| G | W60 | file | apps/desktop/renderer/dialog.js |
| G | W60 | file | apps/desktop/renderer/pages/goal-bar.ts |
| G | W60 | file | apps/desktop/test/goal-bar.test.mjs |
| G | W60 | file | apps/desktop/test-support/product-design-smoke.cjs |
| G | W60 | file | apps/desktop/test-support/product-design-verify.mjs |
| G | W60 | file | apps/desktop/renderer/pages/composer-menu.ts |
| G | W60 | file | apps/desktop/renderer/pages/composer-attachments.ts |
| G | W60 | file | apps/desktop/renderer/pages/queue-dock.ts |
| G | W60 | file | apps/desktop/test/composer-menu.test.mjs |
| G | W60 | file | apps/desktop/renderer/pages/workbench-tabs.ts |
| G | W60 | file | apps/desktop/renderer/pages/file-preview.ts |
| G | W60 | file | apps/desktop/test/file-preview.test.mjs |
| G | W60 | file | apps/desktop/renderer/pages/account-menu.ts |
| G | W60 | file | apps/desktop/renderer/pages/general-settings.ts |
| G | W60 | file | apps/desktop/test/general-settings.test.mjs |
| G | W60 | file | apps/desktop/renderer/pages/permission-menu.ts |
| G | W60 | file | apps/desktop/renderer/pages/context-meter.ts |
| G | W60 | file | apps/desktop/test/context-meter-view.test.mjs |
| G | W60 | file | apps/desktop/renderer/pages/workspace-search.ts |
| G | W60 | file | apps/desktop/renderer/pages/workspace-search-state.ts |
| G | W60 | file | apps/desktop/test/workspace-search.test.mjs |
| G | W60 | file | apps/desktop/renderer/pages/file-editor-state.ts |
| G | W60 | file | apps/desktop/renderer/pages/file-editor.ts |
| G | W60 | file | apps/desktop/test/file-editor.test.mjs |
| E | W40 | file | core/src/git_workbench.cj |
| E | W40 | file | core/src/terminal_view.cj |
| E | W40 | file | core/test-support/shell-execution-probe.cj |
| E | W40 | file | core/test-support/shell-pipeline-probe.cj |
| E | W40 | file | core/src/approval.cj |
| E | W40 | file | core/test-support/exact-approval-probe.cj |
| E | W40 | file | apps/desktop/test-support/exact-approval-verify.mjs |
| E | W40 | file | apps/desktop/test-support/shell-execution-verify.mjs |
| E | W40 | file | apps/desktop/test-support/shell-quoting-verify.mjs |
| E | W40 | file | apps/desktop/test-support/shell-pipeline-verify.mjs |
| A | W40 | file | docs/plans/sacode-execution-contract-2026-10-07.md |
| G | W60 | file | apps/desktop/renderer/pages/terminal-output.ts |
| G | W60 | file | apps/desktop/renderer/pages/terminal-output-state.ts |
| G | W60 | file | apps/desktop/test/terminal-output.test.mjs |
| G | W60 | file | apps/desktop/renderer/pages/git-workbench.ts |
| G | W60 | file | apps/desktop/renderer/pages/git-workbench-state.ts |
| G | W60 | file | apps/desktop/test/git-workbench.test.mjs |
| A | W60 | file | apps/desktop/test/bridge.test.mjs |
| A | W90 | file | apps/desktop/test/frame-escape.test.mjs |
| A | W90 | file | apps/desktop/test-support/protocol-smoke.cjs |

## 2. 归属规则（表没写完的那部分，按规则裁定而不是临时协商）

1. **表内没有的新路径**：新文件由「它实现哪个工作包的能力」定主责，先在本表加一行、再写码；`scripts/` 与 `docs/` 下的门禁与证据文件一律归 A。
2. **测试文件跟随被测文件的主责**：`xxx_test.cj` 与 `xxx.cj` 同主。唯一例外是 I 的独立验收用例，落在 `docs/qa/` 与本表明确标注为 I 的路径。
3. **公共入口只有 A 能改**：`apps/host/src/main.cj`、`apps/cli/src/main.cj`、桌面 `main.cjs`/`preload.cjs`/`renderer/app.js`，以及 `package.json`、锁文件、`scripts/pack-pages.mjs`。其他成员需要接线时提交**接口变更单**（要哪个方法/通道、入参出参、取消与错误语义、消费者），由 A 改。
4. **同一时刻不得并行**：公共文件重构 与 向公共文件追加接线，两者不得同时进行；`verify-all.mjs` 正在被某成员改时，其他人不开新的全量验收。

## 3. 串行资源（并行只允许在无共享文件依赖的工作上）

| 资源 | 为什么必须串行 | 实测形态 |
|---|---|---|
| 仓颉构建通道（`cjc`/`cjpm`/`ld.lld`） | 两个 cjpm 同时重链同一产物会互锁 | `ld.lld: error: failed to write the output file … Permission denied`（`verify-all.mjs` 的 core 步骤为此内置最多 3 次退避重试） |
| 计时敏感用例 | 并发构建/大文件校验会压穿有界轮询窗口，造出与代码无关的红 | 桌面 `node --test`、`--ui-smoke`、宿主 5000ms 超时相关用例 |
| `apps/desktop/dist/host` 与 `renderer/vendor/` | 是构建产物，重新打包会换掉别人正在断言的对象 | 宿主重打后旧产物断言失效 |
| 一次性工作目录 `dualtest/` | `bridge.test.mjs` 在仓库根复用同名目录 | 并发跑会互相清目录 |
| `scripts/verify-all.mjs`、`package.json`、锁文件 | 规则 3 的公共文件 | 见 §2 |

## 4. 当前冲突队列（2026-10-06 工作区实测，未经确认不进后续基线）

复跑：`git status --short --untracked-files=all`（本次 13 条，其中本批 3 条已提交为 `b9dc4e3`）。

| 路径 | 表内主责 | 实测状态 | 处置 |
|---|---|---|---|
| `apps/cli/src/main.cj` | **A** | ` M` 未提交，非本批写入（实测恰 `7 insertions(+)`，无删除） | 本行原处置成立至今：**并发那 7 行仍记「未经确认」，不进基线**。新增一条已发生的事实——`6cc063a` 已把两条按 `PluginUnit` 形状写的装配断言写进这个 A 拥有的入口文件（`units[i].name`，而 `PluginAssemblyPlan.units` 是 `Array<String>`），提交态 `cjpm build` rc=1、6 个 `'name' is not a member of struct 'String'`，两条断言从落库起从未运行。A 只取那两行的 `.name`（零语义改动）并提交 `56f3ffe`，**代修不等于认领**：装配语义仍归 C（W20）。纪律补一条：非 A 成员要往公共入口加断言或调用，必须先交接口变更单，否则红只会在提交级产物检查里才暴露 |
| `apps/desktop/renderer/app.js` | **A** | ` M` 未提交，非本批写入 | 同上 |
| `docs/plans/capability-matrix.md` | **A** | ` M` 未提交，非本批写入 | 矩阵是 63 行账本；A 需在合入前重跑 `node scripts/check_p0_ownership.cjs` 确认表体分母未坏 |
| `docs/plans/capability-matrix.md` 的 `persistence` 行 | **A**（记账纠偏）／B（W10 实施） | 该行现记 **✔**，备注把「崩溃恢复合成」算作已实现 | **实测落差，本批不动该文件**（上一行同文件有在飞改动，避免行级踩踏）：`grep -rn "interruptedTurnClosers" --include=*.cj` 与 `grep -rn '"step/end"' --include=*.cj` 均 **0 命中**，恢复合成在实现侧一个字都没有。按「标记/模拟/未接不得判完成」该行应为 ◐。纠偏随 W10 契约（`docs/plans/w10-persistence-barrier-recovery-contract-2026-10-06.md`）获批后与在飞改动分开落库 |
| `core/src/agent.cj` | E | ` M` 未提交 | 引用了 `fs_tools.cj`/`ptc_exec.cj`/`shlex.cj` 三个**未跟踪**文件 → 整文件提交会破坏构建（悬空引用），必须与那三个文件同批落库 |
| `core/src/model_tool_runtime.cj` | E | ` M` 未提交 | 与上一行同属 E 的 W40 批次 |
| `core/src/{fs_tools,fs_tools_test,ptc_exec,shlex,shlex_test}.cj` | E | `??` 未跟踪 | 待 E 自己成批提交 |
| `apps/desktop/renderer/pages/migration.ts` | G（迁移页面）／B（迁移契约） | ` M` 未提交 | 边界待裁定：页面归 G、`migration_pack.cj` 归 B；本行保留 G，若 B 需改该文件则拆成两条更细的 file 行 |
| `apps/desktop/renderer/pages/budget-stats.ts` | D（费用统计页，本批刚登记进 §1 表） | 已由 A 代修并提交 | 并发线 `6cc063a` 写坏 3 行括号，提交态 `npm run vendor` rc=1。A 只删那 3 个多余 `)`（零行为改动），并新增 `apps/desktop/test/page-sources-parse.test.mjs` 让这类破口在单测面就红。**代修不等于认领**：该文件的语义改动仍须由 D 提接口变更单 |
| `core/src/web_exec.cj`、`core/src/web_exec_test.cj` | 未登记（H 的 W70 web 线或 E 的 W40 执行世界，待裁定） | `??` 未跟踪（本轮新观测） | A 未触碰；先登记，避免下一轮把它当本批遗漏或误提交 |

| `core/src/model_router.cj`、`core/src/model_router_test.cj` | D | ` M` 未提交（05:07 本轮新观测） | 与 §1 表里 D 的 W30 所有权一致，属正常在飞；A 未触碰、不代改，等 D 自己成批落库 |

**三条 A 自有文件被别的会话改而未被 A 认领**，就是「主责不重叠」目前唯一的实际破口。按规则 3 的正确做法不是 A 替他们改，而是让改动方提交接口变更单。

## 5. 隔离工作安排

1. **每个成员一份独立 worktree**，命名沿用仓内既有约定：`.qoder/worktrees/<用途>-<短SHA>-<YYYYMMDD>`（`.qoder/` 已在 `.gitignore:101`）。2026-10-06 实测在飞的有：`p0-baseline-5544b4f-20261006`、`p0-baseline-b655bf9-20261006`、`w00-responsibility-20261006`、`w20-assembly-compile-20261006`、`w90-packaging-20261006`，A 本批新增 `p0-head-b9dc4e3-20261006`。**别人的 worktree 不共用、不删除**（`git worktree list` 判活，`git worktree remove` 只对自己那份）。
2. **分支策略**沿用仓库现状：功能线在 `refactor/dsh-learning`，worktree 用 `--detach <短SHA>` 做提交级取证，需要落库时再由归属成员建/切自己的分支。
3. **两份取证必须分开标注**：工作区态（含未落库改动）与提交态（detached worktree 单跑）。任何计数都要写明是哪一种，工作区绿不等于 HEAD 绿。
4. **未确认 dirty 不进基线**：§4 表里没有「已确认」标记的路径，后续批次的基线以它所在 worktree 的提交为准，不以主工作区文件内容为准。

## 持久任务桌面消费登记（2026-10-08）

| 主责 | 工作包 | 类型 | 路径 |
|---|---|---|---|
| G | W60 | file | apps/desktop/renderer/pages/execution-task-state.ts |
| G | W60 | file | apps/desktop/renderer/pages/execution-task.ts |
| G | W60 | file | apps/desktop/test/execution-task.test.mjs |
| A | W90 | file | apps/desktop/test-support/execution-host-verify.mjs |
| G | W60 | file | apps/desktop/test-support/execution-page-smoke.cjs |

复用终端页面挂载点，关闭与切换只取消客户端消费，绝不调用 stop；执行动作使用会话、执行身份和预期修订。workspace/get 补充同源 revision 与 sessionId，普通启动仍以监督探针为门禁。

## 目标产品异步入口登记（2026-10-08）

F/W50 负责 `core/src/goal_runner.cj` 与 `core/src/goal_runner_test.cj`：保留旧同步 claim 测试接缝，产品 start 强制同修订同轮次日志 claim，并要求调用方持久屏障。本批先验证共享入口；Host/CLI 运行接线在核心测试通过后实施，不自动启动恢复任务，不代改其他线程在途入口。

B/W10 与 F/W50 的目标检查点增量：新增 `core/src/goal_checkpoint.cj`、`core/src/goal_checkpoint_test.cj`，在 `session.cj` 增加完整行分批检查点与失败实例冻结；旧 durableCheckpoint 单批契约不改变。公共入口接线仍由 A/W90 负责。

F/W50 同批更新 `goal_scheduler.cj`：产品完成 CAS 与持久检查点在同一日志锁内，不对并发读侧暴露未提交完成；兼容 Driver 的旧调用默认检查点不变。

## Windows 收口 CLI 目标入口增量（2026-10-08）

A/W90 负责新增 `apps/cli/src/goal_runtime.cj` 与 main.cj 顶部 goal 子动作分派的独立一行。保留 goal 无参数自测，新增显式 run 与只读 describe，共用 GoalRunner/GoalCheckpoint；旧 Shell 执行保持门禁关闭。只修改该分派行，不接管 batch/remote/job 等并发实现。实现尚待私有编译与真实协议验收，不记通过。

A/W90 本批验收夹具：`apps/desktop/test-support/goal-cli-verify.mjs`、`goal-cli-cancel-verify.mjs`、`goal-cli-signal.ps1`。CLI 已从私有源码构建并验证基本轮次、持久失败、系统取消及恢复；完整产品目标仍未收口。信号夹具只操作自建隔离控制台和自建子进程，不复用或覆盖旧 sigwin-e2e.ps1。

Windows 原生监督增量由本批 E/W40 负责新增 `core/native/windows_job.cs`、`core/test-support/windows-job-probe.cs` 与 `apps/desktop/test-support/windows-job-verify.mjs`：机械句柄提供方，不新增业务权威源，不修改并发 shlex/sandbox 实现。创建时 JOB_LIST 绑定、挂起后登记再恢复、FILETIME 身份和 kill-on-close；沙箱与双入口接线仍待独立实现，产品门禁不变。

Windows 仓颉消费端的有限传输由本批 E/W40 新增 `core/native/windows_job_broker.cs` 与 `apps/desktop/test-support/windows-job-broker-verify.mjs`。仅传递挂起身份、显式恢复/停止与机械输出，不承接审批、业务状态或恢复授权；验证后再接共享监督，当前公共入口与 providerReady 不改。

同一增量登记 `core/src/windows_job_executor.cj`、`core/test-support/windows-job-adapter-probe.cj`，提供有限协议的仓颉消费端及独立编译验证；不覆盖现有 execution_supervisor.cj 或 shlex.cj 的并发改动。

共享监督本轮仅扩展 E 自有 `core/src/execution_supervisor.cj` 的可选 WindowsJobExecutor 注入与原始字节结算，不修改 Host/CLI 默认构造及门禁。新增 `core/test-support/windows-supervisor-probe.cj`，以真实核心库验证一次准入、身份持久化、字节回放、失败与停止。

对应可复跑验收驱动 `apps/desktop/test-support/windows-supervisor-verify.mjs` 归同一 E/W40 增量；接收明确私有 core 库和 broker 路径，不读取共享旧产物替代当前编译。

Windows 隔离本批 E/W40 新增 `core/native/windows_appcontainer.cs`、`core/test-support/windows-sandbox-probe.cs` 与 `apps/desktop/test-support/windows-sandbox-verify.mjs`；只在私有夹具目录授予临时 SID ACL 并撤销，不修改真实项目目录、官方安装目录或机器网络例外。windows_job.cs 增加可选 SECURITY_CAPABILITIES 和实际 AppContainer 令牌核验，默认无此属性不变；公共执行门禁仍关闭。

E/W40 诊断增量 `core/test-support/windows-appcontainer-create-probe.cs`：仅比较系统程序挂起创建的安全属性，不 Resume、不改目录 ACL、不改机器策略，所有自建进程由自持句柄清理。

A/W90 本轮复验证据：docs/evidence/windows-unified-core-dual-entry-2026-10-08.md，绑定同核心 Host/CLI 与源码哈希。仅更新新版需求表 F04 和接口文档当前口径，不覆盖其他能力行或公共入口。

A/W90 取消收口增量：core/src/sse.cj 仅追加每请求 transport cancellation 生命周期与连接关闭；D 的 reportedUsage/parseReportedUsage 在途计费 hunk 原样保留，不认领或暂存。以修改前私有备份、行级 diff 与增量哈希隔离，真实 HTTP 和双入口取消回归后再记通过。

A/W90 取消验收夹具新增 core/test-support/sse-cancel-probe.cj 与 apps/desktop/test-support/sse-cancel-verify.mjs：真实本机 HTTP，覆盖默认超时阻塞读取、父令牌联动、detached 独立、响应头前取消和正常超时；不调用真实外部模型。

A/W90 本轮精确文件审批增量：goal-cli-verify.mjs 增加允许一次真实写入、实际文件及同修订同轮 claim/evidence 断言；goal-host-verify.mjs 对应同一文件场景。apps/host/src/main.cj 仅模型审批通知 hunk 添加不可变起轮 sessionId 与完整 argumentsJson，保留并发路由/执行/模板注册等全部 hunk，不暂存。新 Host 增量先使用已验收私有核心库证明接线；当前并发 SSE 计费及 Batch 增量仍需最终统一核心重建，不能据此宣布最新全部源码已验收。

A/W90 桌面模型审批消费增量：新增 renderer/model-approval.js、test/model-approval.test.mjs 与 test-support/model-approval-host-verify.mjs，限定收取模型通知、校验完整提案并回答原工单；main.cjs 仅 taskStart/turnPoll 分派及起轮信封身份绑定，Host main.cj 仅原模型审批通知增加 turnRequestId，renderer/app.js 仅模型审批读面/回答与轮询竞态保护，index.html 仅新增经典脚本引用，styles.css 仅完整参数的可滚动换行样式。其余并发工作台/模板/会话搜索 hunk 原样保留，不触碰包清单或构建入口；控制器通过仍不代表 Electron 页面验收。

A/W90 桥接恢复增量：host-bridge.cjs 仅 start 的进程身份与通知缓存、旧回调/迟到 write 错误隔离、活动连接重复启动拒绝；保留并发 JSON-RPC error.data hunk。新增 test/host-bridge-lifecycle.test.mjs 和 test-support/host-bridge-recovery-verify.mjs。重启是显式动作，恢复仅读取，不自动续跑；本轮不增改 Electron GUI 重连入口，不据 Node 桥接通过升级页面验收。

A/W90 Windows 交付标签修复：新增 scripts/export-windows-artifact.mjs、scripts/windows-file-integrity.cs 与 docs/evidence/windows-low-integrity-delivery-fix-2026-10-08.md。仅只读查询文件完整性并将同字节产物导出到普通 Medium 目录；不改仓库或系统 ACL、不提权、不关闭 sandbox、不安装。保留并发构建/页面文件，不认领旧目录低完整性标签的写者。
A/W90 用户界面纠偏（2026-10-08）：renderer/app.js 仅删除侧栏日志状态筛选及会话用量预算入口和面板，并删除隐藏筛选状态；保留搜索、日志拒绝保护、上下文圆环、核心预算判据及模型中心。用户明确要求覆盖此前筛选设计，不覆盖其他共享 hunk，不暂存。Node 语法检查通过；18746 实际 DOM：filters=0、budgetEntry=0、budgetPanel=0、search=true、composer=true。静态预览缺桌面桥接，projection 报错，不能作为真实 Host 会话验收；截图 target/product-ui-cleanup-20261008.png。
A/W90 Windows 隔离夹具纠偏：core/test-support/windows-sandbox-probe.cs 与 apps/desktop/test-support/windows-sandbox-verify.mjs 只改测试装载、独占普通 Temp、子进程输出继承、可达网络对照及失败排空；实际只读/区内写入两策略通过，并完成私有可写变异反证。产品门禁不改，native broker/Host/CLI 装配仍待实现；证据 windows-appcontainer-admission-2026-10-08.md 最新段。共享文件原有其他 hunk 保留，不暂存。
A/W90 Windows 同进程隔离监督接缝：core/native/windows_job_broker.cs 仅可信 --sandbox 配置、token 确认及清理后结算；core/src/windows_job_executor.cj 仅隔离配置与确认校验、失败先 stop 再限时清理；core/test-support/windows-job-adapter-probe.cj 与 apps/desktop/test-support/windows-job-broker-verify.mjs 配套真实探针。其余作者 hunk 保留。新增 windows-isolated-broker-adapter-2026-10-08.md；公共 ExecutionApi/Host/CLI 未开放，不改审批/提案契约或包清单，不暂存。
A/W90 公开执行策略增量：新增 core/src/execution_sandbox.cj 和 execution_sandbox_test.cj；execution_service.cj 只提案字段计数/共享路径校验 hunk；execution_api.cj、execution_supervisor.cj、windows_job_executor.cj 只可信提供方注入和作用域/摘要校验；native/windows_job_broker.cs 与其 verifier 只创建前映像摘要锁定及反证。CLI main.cj 只 runJob 同进程再审批分支，保留其他命令作者修改。新增 execution-sandbox-proposal-2026-10-08.md；当前新 Service/CLI 待统一编译、Host 异步尚未改，不暂存，不升级产品通过状态。


### A：执行共享冻结与异步活动句柄增量（2026-10-08）

本批认领 execution_service.cj 的两处持久失败分支、execution_service_test.cj 的共享冻结断言，以及 execution_supervisor.cj／execution_api.cj 的 ExecutionRun 与异步启动增量；不整文件暂存公共入口。逐文件哈希与验证边界见 docs/evidence/execution-shared-freeze-2026-10-08.md。Host 活动句柄接线尚待实施与实测。

A 本轮补认领 apps/host/src/main.cj 的 ExecutionRun 局部变量、活动任务只读闸、dispatch 异步回调、EOF 等待和 executionSettled 通知／租约闸；不认领或暂存其他并发 hunk。接线未编译，证据在 execution-shared-freeze-2026-10-08.md。

A 本批继续认领 execution_api_test.cj 的异步拒绝／未触发回调断言和 execution_supervisor_test.cj 的默认异步门禁断言；仅所述局部增量，其他修改保持原归属。

A 本批认领 windows_job_executor.cj 的校验后逐帧 onOutput 回调、execution_supervisor.cj 的实时 captureOutput 替换及 windows-job-adapter-probe.cj 的两条真实输出探针；不覆盖其他增量。证据 execution-live-output-2026-10-08.md。

A 本批补认领 execution_output_test.cj 的 running 读面／共享冻结断言，以及 windows-supervisor-probe.cj／windows-supervisor-verify.mjs 的 live-output 真实常驻双流场景；实测待最新核心构建。

A/W90 新增自有 scripts/pack-windows-execution.mjs、docs/evidence/windows-execution-native-payload-2026-10-08.md：仅原生执行载荷编译与哈希清单，不改公共 pack-host/package.json；可信提供方尚未装配，不能据构建成功放行。

2026-10-08 Codex 本轮登记：独占新增 core/test-support/windows-async-execution-probe.cj，只验证新核心与真实 AppContainer 的异步 API、输出、停止、回执登记失败和恢复；不修改公共提供方装配，不暂存其他文件。

2026-10-08 Codex 新增准入内存缺口责任：core/src/sha256.cj（提取原有压缩轮函数，原向量语义保持）、新增 sha256_file.cj / sha256_file_test.cj；execution_sandbox.cj 仅替换文件摘要读取。修改前 sha256.cj 无工作区差异。

2026-10-09 Codex 准入安全补项：WindowsJobExecutor.matchesPolicy、windows_job_broker.cs 只新增可写工作区与只读工具目录不得嵌套的判断；新增 execution_sandbox_test.cj 单用例。原生代码本轮修改前核对现有清单哈希，不改其他会话源文件。

2026-10-17 Codex/W40 本轮独占新增 `core/native/windows_process.h`、`core/native/windows_process.c`、`scripts/verify-windows-process.c`、`scripts/build-windows-process.mjs`：Windows AppContainer 原生创建/管道/Job 事实薄层及独立实测。尚不修改 `shlex.cj`、`execution_supervisor.cj` 或公共产品门禁；后续装配另登记精确增量。不覆盖其他会话修改、不提交他方文件。

2026-10-17 Codex/W40 后续独占新增 `core/src/windows_process_adapter.cj`、`core/test-support/windows_process_adapter_test.cj`，负责内部 DLL ABI/句柄、profile 生命周期、管道和启动取消屏障适配；实际集成测试需显式 DLL 与 Medium 测试环境，用定向 CJC 编译，不混入无需该组件的默认单测发现；只读现有 shlex/cancel 契约，不改公共执行器或门禁。

同批独占新增 `scripts/verify-windows-process-adapter.ps1`：显式当前 core 产物 + DLL + 中性导出根的定向测试入口；记录最后 Summary、退出码和指纹，不安装、不调 ACL、不删除运行证据。

2026-10-17 Codex/W40 继续仅修改 windows_process_adapter.cj、其 test-support 测试与 verify-windows-process-adapter.ps1：增加挂起进程到共享 ShellResult 的回执、取消、超时与双流收束转换；不修改公共执行器或门禁。

2026-10-17 Codex/W40 认领 execution_supervisor.cj 的可注入受监督进程接口与异常结算增量，新增 execution_process_provider.cj，并在自有 windows_process_adapter.cj/test-support 接实际任务日志验证；保留 ShellExecutor 默认路径，不改平台就绪门禁。修改前 execution_supervisor.cj 无工作区差异。

2026-10-17 Codex/W40 认领新增 core/native/windows_workspace.h/.c、scripts/verify-windows-workspace.c 与 scripts/verify-windows-workspace.mjs：仅新建私有任务目录的初始 DACL、固定句柄与撤销/独立清理测试，不修改真实工作区或父目录权限。build-windows-process.mjs 仅追加本批源文件编译；其余进程 ABI 保留。

2026-10-17 Codex/W40 新增自有 core/src/windows_workspace_adapter.cj，复用 WindowsProcessLibrary/profile 所有权，接原生私有目录有限调用；原 windows_process_adapter.cj 仅补库 retain 引用。test-support 与 verify 脚本增加仓颉真实私有 cwd 的共享任务验证；不改原工作区 ACL 或自动合入。

同批新增 scripts/cleanup-windows-workspace-fixture.mjs，仅独立删除显式夹具私有根下 input.txt/result.txt 两个普通单链接文件；拒绝重解析、不递归、不接受模型输入。

2026-10-17 Codex/W40 认领新增 core/native/windows_tree.h/.c 与 core/src/windows_workspace_snapshot.cj：按真实句柄固定源/目标父链、拒绝重解析和多硬链接读取，核心限定排除清单/深度/大小，生成源摘要与只读变更清单。build-windows-process.mjs 追加编译源；不向 Host/模型开放、不得自动合入原项目。

同批独占新增 scripts/create-windows-snapshot-link-fixture.mjs，仅本轮 TEMP 的已命名源夹具创建固定 hardlink/junction；清理夹具扩展为固定文件/目录名单及固定深度空目录，不扫描、无通用递归删除。
2026-10-17 Codex/W40 继续认领 execution_service.cj、execution_api.cj 的快照审批摘要绑定与只读投影，及 renderer/pages/execution-task{,-state}.ts 与 test/execution-task.test.mjs 的审批展示/响应守卫；修改前这些文件无工作区差异。只新增快照存在时的契约，不开放默认执行后端，不覆盖其他会话文件。

同批新增 apps/desktop/test/snapshot-approval-ui.test.mjs，仅验证执行页面消费真实投影形状的展示及无自动启动副作用。
2026-10-17 Codex/W40 继续在自有 windows_workspace_snapshot.cj 接入 AttachmentStore 内容寻址对象和 execution/review 同日志清单；不新增文件存储系统。认领 renderer/pages/task-review.ts、review-page.ts、renderer/app.js 的单一 ReviewPage 参数接线，以及 test/task-review.test.mjs、review-page.test.mjs 的只读消费验证。修改前 app.js/review-page.ts/review-page.test.mjs 无他方工作区差异；只改任务审查接线，既有 Git/编辑器行为保留。

同批新增自有 apps/desktop/test-support/verify-task-review-host.mjs：只消费本轮真实执行日志与对象，以当前 Host 和页面组件做历史只读联验，不伪造任务状态、不开模型/网络请求、不改用户配置。
2026-10-17 Codex/W40 认领新增 core/src/execution_review.cj、renderer/pages/task-review-preview.ts，以及 execution/review-file 的 Host/CLI/有限 IPC/preload/bridge/ui-smoke 同步。main.cj、CLI main、preload、execution-ipc、bridge、ui-smoke 修改前无他方工作区差异；host-capabilities.json 保留他方已同步的 171 项，仅插入新读动词。check_host_method_surface.cjs 的冻结 HEAD 分母从旧169更新为实测171，不拿工作区172替代HEAD；仍检查全量能力集合。

同批新增自有 test/task-review-preview.test.mjs 与 test-support/verify-task-review-cli.mjs，前者覆盖正文身份/字节/IPC拒绝，后者只执行真实CLI只读用户命令；新增接口合同 execution-review-preview-2026-10-17.md。
2026-10-17 Codex/W40 继续认领自有 windows_tree.h/.c 与 windows_workspace_snapshot.cj，新增有限单文件 compare_exchange 原语及仓颉适配：独占句柄核对旧字节，区分未改变与可能改变后的未知；不将其宣称为断电原子替换或多文件事务，尚无公共写回入口。测试只改自有合成夹具，不写产品真实项目。
2026-10-17 Codex/W40 认领新增 core/src/execution_review_apply.cj，以及 execution_service.cj 的同进程取消令牌表、cancel.cj 的单文件提交边界注释（修改前 cancel.cj 无他方差异）。写回意图/结果继续落同一 SessionLog，复用 WriteLease/ApprovalDesk/TurnToken；暂不新增公共写回入口。

2026-10-17 Codex/W40 认领新增 core/src/review_platform.cj 与自有 windows_tree/windows_workspace_snapshot/execution_review_apply 的目录身份增量；测试新增目录替换及固定模块定位两例。保留并发会话在 windows_process_adapter.cj 和同一测试文件中的提案字段校验增量，不代其认领或回退。

2026-10-17 Codex/W40 继续自有 execution_review_apply.cj 异步start/stop装配，cancel.cj 增包内非阻塞写回停止请求，不更改cancel既有等待契约；同一测试文件新增异步提交中查询/停止/重复启动拒绝用例，目标分母40。公共RPC尚未开放。

2026-10-17 Codex/W40 认领新增 core/src/execution_review_api.cj；接ExecutionApi四个有限写回动作及Host/CLI当前自有执行分支，保持他方model_routing/request_trace与build.cj改动。Host认领活动写回句柄收束和同一执行写侧AttachmentStore装配。

2026-10-17 Codex/W40 认领新增 renderer/pages/review-writeback-state.ts、review-writeback.ts，沿用自有task-review/review-page/app.js单一props接线；新增test/review-writeback.test.mjs、review-apply-ipc.test.mjs和test-support/verify-review-apply-entries.mjs。真实写回仅针对本会话定向测试生成且字节匹配的target/tmp合成项目，不改真实用户项目。

同批verify-windows-process-adapter新增共享ExecutionApi写回合同用例，目标分母41；验证脚本登记新增execution_review_api源码指纹。公共契约仅四动作，不增加任意文件写通道。

2026-10-17 Codex/W40 认领新增 core/src/windows_snapshot_provider.cj，修正自有workspace快照接线的逻辑cwd与物理cwd映射：保留会话原工作区，只在可信提供方依据持久快照切换物理目录。execution_service/windows_workspace_snapshot仅扩展绑定判据，保留旧物理cwd快照回放；默认入口仍待完整生命周期装配。

15:03并发会话在windows_process_adapter/execution_api新增显式enforcing分支。本线不认领或回退该实现；仅将其中有后续赋值的processProvider局部let改var修复当前共享编译。该分支的环境库路径、资源所有权及快照集成尚未由本线验收，不能混入本批逻辑cwd映射完成结论。

本轮新增desktop/test/snapshot-mapping.test.mjs并修正自有execution-task-state.ts快照消费口径：源cwd与执行目录可分离，但逻辑映射必须有源目录身份，审查也须同实体。新增真实私有进程映射用例，目标分母42，禁止暂时改SessionWorkspace来迁就测试。

2026-10-17 Codex/W40 继续认领自有core/native/windows_workspace.c/.h与windows_workspace_adapter.cj，新增仅消费本对象私有根句柄的有界内容清理，供真实执行生命周期收束；不接受调用方路径、不改ACL、不删除原工作区。失败可部分清理但不得假报完成。

本批新增scripts/create-windows-workspace-disposal-fixture.mjs，仅在本轮私有目录及其唯一哨兵中构造junction/硬链接与固定清理；不提供通用删除。仓颉测试新增正常嵌套清理、文件占用拒绝后重试、链接拒绝与外部哨兵保护三例，分母45。

2026-10-17 Codex/W40 认领新增core/src/windows_snapshot_settlement.cj及execution_supervisor.cj的可信onSettled钩子：真实退出/输出完整并持久结束后保存审查，再清理私有资源；失败保留退出事实并另记settlement-failed。不提供RPC回调或另建任务队列。

2026-10-17 Codex/W40 认领新增execution_workspace.cj、windows_execution_capsule.cj；接ExecutionService胶囊所有权与ExecutionApi准备/开始，固定库路径及本地探针、同一快照审批，不允许RPC传入根或提供方。默认入口/CLI退出接线和运行验证尚在实施。

2026-10-18 Codex/W40补登记自有apps/desktop/test-support/verify-execution-capsule-entries.mjs、CLI job run退出码与Host EOF胶囊/写回收束接线；新证据execution-capsule-entries及各索引同步。公共文件中模型中心/拉取/构建钩子等他方改动不认领、不覆盖。

2026-10-18 Codex/W40继续自有windows_workspace_snapshot/windows_execution_capsule、原生定向测试及专用清理夹具，修正源目录与会话数据重合的真实元数据排除边界；驱动增加--colocated。只扩展自有夹具固定名单，不清理或纳入他方实现。

2026-10-18 Codex/W40认领core/src/windows_execution_tool.cj及自有capsule/snapshot/provider/执行页：为构建测试预设做启动前程序路径解析与文件摘要绑定，审批显示实际程序；不继承模型环境，不用文件名放宽报告判断。新增verify-build-test-host真实驱动。
