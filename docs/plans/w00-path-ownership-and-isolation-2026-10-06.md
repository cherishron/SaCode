# W00 步骤 5：路径所有权表与隔离工作安排（2026-10-06，A）

判据：`node scripts/check_path_ownership.cjs` → `GATE: PASS (n checks, fail=0)`；反证 `--selftest` → `SELFTEST: PASS`。本表是**唯一真源**，门禁直接解析本文件的表体，不另抄一份。

## 1. 路径所有权表（单写入者）

一行一条路径。`类型=file` 精确到文件；`类型=dir` 表示该目录整体归该成员，其他人不得在其中新建或修改。共享目录（`core/src/`、`apps/desktop/renderer/pages/`）一律用 `file` 行 + 一条 `default` 兜底行表达，避免「目录前缀套住别人的文件」这种双主。

| 成员 | 工作包 | 类型 | 路径 |
|---|---|---|---|
| A | W00 | dir | scripts/ |
| A | W00 | file | docs/plans/dsh-capability-matrix.md |
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
| E | W40 | file | core/src/model_tool_runtime.cj |
| E | W40 | file | core/src/fs_tools.cj |
| E | W40 | file | core/src/fs_tools_test.cj |
| E | W40 | file | core/src/ptc_exec.cj |
| E | W40 | file | core/src/shlex.cj |
| E | W40 | file | core/src/shlex_test.cj |
| F | W50 | file | core/src/goal_runner.cj |
| F | W50 | file | core/src/goal_scheduler.cj |
| F | W50 | file | core/src/goal_control.cj |
| G | W60 | file | apps/desktop/renderer/pages/slot-core.ts |
| G | W60 | file | apps/desktop/renderer/pages/client-slots.ts |
| G | W60 | file | apps/desktop/renderer/pages/plugin-manager-adapter.ts |
| G | W60 | file | apps/desktop/renderer/pages/migration.ts |
| G | W60 | dir | apps/desktop/renderer/assets/ |
| H | W70 | file | core/src/mcp.cj |
| H | W70 | file | core/src/ssh.cj |
| I | W80 | dir | docs/qa/ |

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
| `apps/cli/src/main.cj` | **A** | ` M` 未提交，非本批写入 | A 未认领该改动 → 记「未经确认」，不进基线；由写它的会话补接口变更单或撤回 |
| `apps/desktop/renderer/app.js` | **A** | ` M` 未提交，非本批写入 | 同上 |
| `docs/plans/dsh-capability-matrix.md` | **A** | ` M` 未提交，非本批写入 | 矩阵是 63 行账本；A 需在合入前重跑 `node scripts/check_p0_ownership.cjs` 确认表体分母未坏 |
| `core/src/agent.cj` | E | ` M` 未提交 | 引用了 `fs_tools.cj`/`ptc_exec.cj`/`shlex.cj` 三个**未跟踪**文件 → 整文件提交会破坏构建（悬空引用），必须与那三个文件同批落库 |
| `core/src/model_tool_runtime.cj` | E | ` M` 未提交 | 与上一行同属 E 的 W40 批次 |
| `core/src/{fs_tools,fs_tools_test,ptc_exec,shlex,shlex_test}.cj` | E | `??` 未跟踪 | 待 E 自己成批提交 |
| `apps/desktop/renderer/pages/migration.ts` | G（迁移页面）／B（迁移契约） | ` M` 未提交 | 边界待裁定：页面归 G、`migration_pack.cj` 归 B；本行保留 G，若 B 需改该文件则拆成两条更细的 file 行 |
| `apps/desktop/renderer/pages/budget-stats.ts` | D（费用统计页，本批刚登记进 §1 表） | 已由 A 代修并提交 | 并发线 `6cc063a` 写坏 3 行括号，提交态 `npm run vendor` rc=1。A 只删那 3 个多余 `)`（零行为改动），并新增 `apps/desktop/test/page-sources-parse.test.mjs` 让这类破口在单测面就红。**代修不等于认领**：该文件的语义改动仍须由 D 提接口变更单 |
| `core/src/web_exec.cj`、`core/src/web_exec_test.cj` | 未登记（H 的 W70 web 线或 E 的 W40 执行世界，待裁定） | `??` 未跟踪（本轮新观测） | A 未触碰；先登记，避免下一轮把它当本批遗漏或误提交 |

**三条 A 自有文件被别的会话改而未被 A 认领**，就是「主责不重叠」目前唯一的实际破口。按规则 3 的正确做法不是 A 替他们改，而是让改动方提交接口变更单。

## 5. 隔离工作安排

1. **每个成员一份独立 worktree**，命名沿用仓内既有约定：`.qoder/worktrees/<用途>-<短SHA>-<YYYYMMDD>`（`.qoder/` 已在 `.gitignore:101`）。2026-10-06 实测在飞的有：`p0-baseline-5544b4f-20261006`、`p0-baseline-b655bf9-20261006`、`w00-responsibility-20261006`、`w20-assembly-compile-20261006`、`w90-packaging-20261006`，A 本批新增 `p0-head-b9dc4e3-20261006`。**别人的 worktree 不共用、不删除**（`git worktree list` 判活，`git worktree remove` 只对自己那份）。
2. **分支策略**沿用仓库现状：功能线在 `refactor/dsh-learning`，worktree 用 `--detach <短SHA>` 做提交级取证，需要落库时再由归属成员建/切自己的分支。
3. **两份取证必须分开标注**：工作区态（含未落库改动）与提交态（detached worktree 单跑）。任何计数都要写明是哪一种，工作区绿不等于 HEAD 绿。
4. **未确认 dirty 不进基线**：§4 表里没有「已确认」标记的路径，后续批次的基线以它所在 worktree 的提交为准，不以主工作区文件内容为准。
