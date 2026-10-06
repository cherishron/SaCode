# 步骤 1 集成验收观察（I／W80，2026-10-06）

口径来源：用户给的本轮第一优先是「当前改动集成验收」，收口标准四项 —— **文件有明确作者、排除临时输出、无冲突、无半成品混入**。本文件是独立侧观测，不是裁决：**不合入别人的暂存态、不回退、不清理别人的文件**，只把能机械复跑的事实落下来。

取证据形态：**工作区态**（`git status --porcelain -uall`）+ 提交态对照（隔离副本 detached `5674a5c`）。观测时刻 19:00–19:10，机器负载非独占（`node.exe` 33、`cjc.exe` 4、`cjpm.exe` 4、`electron.exe` 7，另有 17 个在册 worktree 在飞）。

**index 态在这段时间里是动的**：19:00 读到 `core/src/goal_activation.cj`、`goal_activation_test.cj`、`goal_evidence.cj`、`goal_evidence_test.cj` 四条为 `A `（已暂存），19:10 复核时同一批已撤回为 `??`（未跟踪）。下表按 19:00 那次读数写，复跑以当次为准，别把它当静止事实。

## 1. 有明确作者 —— 部分未满足（18 条在飞路径无主）

归属按 `docs/plans/w00-path-ownership-and-isolation-2026-10-06.md` §1 表做最长前缀匹配（`dir` 行按前缀、`file` 行按全等；无 `dir | core/src/` 行，所以 core 下新文件必须有 file 行才算有主）。

| 状态 | 主责 | 路径 |
|---|---|---|
| `A ` 已暂存 | A/W00 | `scripts/run-core-tests.ps1` |
| `M ` 已暂存 | C/W20 | `core/src/plugin_manifest.cj`、`core/src/plugin_store.cj` |
| `M ` 已暂存 | F/W50 | `core/src/goal_control.cj`、`goal_runner.cj`、`goal_scheduler.cj` |
| `M ` 已暂存 | G/W60 | `apps/desktop/renderer/pages/migration.ts` |
| `A ` 已暂存 | **无主** | `core/src/goal_activation.cj`、`goal_activation_test.cj`、`goal_evidence.cj`、`goal_evidence_test.cj`、`mcp_client.cj`、`mcp_client_test.cj`、`plugin_lifecycle.cj`、`plugin_lifecycle_test.cj`、`ssh_exec.cj`、`ssh_exec_test.cj`（10 条） |
| `AM ` 暂存后又改 | **无主** | `core/src/opdf_exec.cj`、`opdf_exec_test.cj` ＋ `[临时] core/ct3.txt` |
| `M ` 已暂存 | **无主** | `core/src/goal_runner_test.cj`、`goal_scheduler_test.cj`、`model_request.cj`、`model_tool_runtime_test.cj`、`plugin_store_test.cj`、`web_exec_test.cj`（6 条） |

**读法**：`goal_runner.cj` 有主而 `goal_runner_test.cj` 无主，说明 §1 表登记了实现却没登记配套用例 —— 这类「实现有主、用例无主」是表本身的系统性缺口，不是某个成员的疏忽。F/W50 与 C/W20 各中一条，D 线（`model_request.cj`、`model_tool_runtime_test.cj`）与 W70/W40 交叉的 `ssh_exec/opdf_exec/mcp_client` 六条成对出现，恰好也是用户步骤 1 点名的「MCP/SSH/Office」域。**这 18 条不进后续基线，直到表里有对应行**（计划红线：未经确认的 dirty 不进入基线）。

`scripts/run-core-tests.ps1` 落在 A 名下 `dir | scripts/` 且状态是 `A `（尚未提交），属正常待 A 自己落库，本批不动。

## 2. 临时输出 —— 一处已封堵、一处仍在别人的 index 里

- **已封堵（本批唯一写入动作，`172c499`）**：`apps/desktop/.tmp-test/` 是桌面 `model-pages` 用例的一次性运行目录，里面是真实 Electron user-data（`GPUCache`、`DawnGraphiteCache`、`Local Storage/leveldb`、`Network/`、`Shared Dictionary/db` 等），实测 **44 个未跟踪且未被忽略**的文件。与既有 `protocol-bridge-dbg/`、`dualtest/` 同类，补一条 `.gitignore` 规则；补完 `git status --porcelain -uall | grep -c tmp-test` = **0**，即这 44 个文件不再进任何 `git add -A`。没有删别人的目录，也没有碰里面的文件。**注意别把这条读成「仓内 `^??` 归零」**：同一时刻 `^??` 共 6 条，其中 4 条是别人正在撤回重做的用例源文件、2 条是本批这两份文档 —— 未跟踪源文件本来就该由主责自己提交，不在本条射程内。
- **仍在别人 index 里**：根目录五份历史转储（`o.txt`、`test-output.txt`、`.qoder-el-main.txt`、`.qoder-el-wt.txt`、`.test-out2.txt`）状态是 `D ` —— 已有人把它们的**删除**暂存但还没提交，这一步是对的，本批不重复也不合并。反向的例外是 `core/ct3.txt`（`AM `）：一份 cjpm 编译输出被**暂存成新增**且暂存后又被改过，它真进基线只会多一个 173KB 的日志。忽略规则对在 index 里的文件无效，所以这条只能等其主责自己撤下，或 A 在合入前剔除 —— 不由我代删。
- 另有 5 个已提交的仓根 scratch 文件（见上一段被 `D ` 的那些）说明「临时输出」历史上确实进过基线，这就是为什么 `.gitignore` 那条值得单独提交。

## 3. 无冲突 —— 本批自身零冲突，并留一条可复用的算术

本批三笔提交（`b405123` 矩阵 1 行、`ac5f0d8`→`5674a5c` 门禁落库与移位、`172c499` 忽略规则）全部走 pathspec 提交，每笔之后复核 `git diff --cached --name-only` 计数：别人暂存的 **29 项在三笔之间始终不变**，没有任何一项被我的消息带走。矩阵行那笔另附一条 CRLF 事实：工作区该行 260 字节（含尾 `\r`）、HEAD blob 259 字节（纯 LF），剥 `\r` 后逐字相等，`stage` 守卫第一次报的「HEAD 与工作区该行不一致」是行尾符差异而不是并发编辑 —— 共享工作区里做整行替换前必须先剥 `\r` 比对，否则会把行尾符误读成别人在改。

## 4. 无半成品混入 —— 提交态文本面干净，账本面有一处不符

在隔离副本 detached `5674a5c`（只含提交态）统计占位词命中：`TODO` 0、`FIXME` 0、`not implemented` 0、`placeholder` 0、`simulated` 0、`stub` 0、`no-op` 0、`未实现` **1**，且那 1 处是注释在讲「拿不到就如实标未实现，绝不把认不出的形态当成 0 秒」（`core/src/transport_failure.cj:79`），不是空壳。**所以「代码里挂着未实现的桩」这一类，提交态没有。**

账本面有的一处不是文本问题而是真落差：矩阵 `persistence` 行记 ✔，而 `interruptedTurnClosers` 与 `"step/end"` 在 `core/src`、`apps/host/src`、`apps/cli/src` 提交态**均 0 命中**（复跑见 `docs/qa/w10-contract-independent-review-2026-10-06.md` §1）。按「标记/模拟/未接均不得判完成」应为 ◐。纠偏需要写 A 名下的矩阵文件，且该文件此前有在飞改动 —— **本批不代写**，与 W10 契约 §6 同一口径：等该文件在飞改动落库后由 B 或 A 落笔。

## 5. 复跑命令

```bash
# 归属映射（一次性壳在 gitignore 的 scratch 里，不入库；逻辑 30 行，可按 §1 表重写）
git status --porcelain -uall
# 临时输出封堵是否生效
git status --porcelain -uall | grep -c 'tmp-test'     # 期望 0（那 44 个文件不再出现在未跟踪清单）
git check-ignore -v apps/desktop/.tmp-test/           # 期望命中 .gitignore:125
# 提交态占位词（先建 detached 副本，避免读到别人的在飞文件）
grep -rn -E 'TODO|FIXME|placeholder|stub|no-op|simulated' core/src apps/cli/src apps/host/src | wc -l
# persistence 账实核对
grep -rl "interruptedTurnClosers" core/src apps/host/src apps/cli/src | wc -l   # 期望 0
grep -rho '"step/[a-z]*"' core/src apps/host/src | sort | uniq -c               # 期望只有 step/start
```

## 6. 本批判据

文件有明确作者 **FAIL（18 条在飞路径在 §1 表无行，含「实现有主/用例无主」这一系统性缺口）**；排除临时输出 **PASS（那 44 个未忽略文件已收进 `.gitignore`，复跑 `grep -c tmp-test` = 0）＋ 一条残留 `core/ct3.txt` 在别人的 index 里，非我可代删**；无冲突 **PASS（三笔 pathspec 提交，别人 29 项暂存态全程未被带走）**；无半成品混入 **提交态文本面 PASS（占位词 0）、账本面 FAIL（`persistence` ✔ 与实现不符，纠偏归 A/B）**；这 18 条无主路径的登记与 `core/ct3.txt` 的撤下 **BLOCKED（需各成员/A 写入，我不代写别人的归属行）**。
