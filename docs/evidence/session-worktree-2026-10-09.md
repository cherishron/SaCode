# 会话级 Worktree 取证记录（2026-10-09）

批次：`docs/superpowers/plans/2026-10-08-session-worktree.md` T1–T7。
本文件只记**当轮实测**，每条都标取证态（工作区 / 提交态 / 仓外副本），不写历史通过数。

## 1. 已入库

| 提交 | 内容 | 取证 |
|---|---|---|
| `90f3e23`（10:45） | 本批 17 个路径 7507 行被**另一条会话**按它自己的主题提交（消息是「docs: Hooks spec 更新为统一方案」），另含它自己那份 hooks 文档 | `git show --stat 90f3e23` 实测 18 files changed, 7507 insertions |
| `d3997f4`（11:0x） | `fix(core)`：`wtFail/wsFail` 调用点补 `detail:` 标签 73 处（`worktree.cj` 55、`worktree_setup.cj` 18） | 取提交态：`git show HEAD:core/src/worktree.cj \| grep -c detail:` = 55 |

`ahead 7`，**未推送**（`git log origin/refactor/dsh-learning..HEAD --oneline \| wc -l` = 7）。

## 2. 提交态的编译断裂（四处，逐条带证据）

1. 73 处缺 `detail:` 标签 —— 已修（`d3997f4`）。判据：`cjc` 实测「带默认值的参数必须声明 `name!` 且调用点必须带标签」。
2. `worktree.cj` 两处 `Int64.parse` 需要 `import std.convert.*`。判据是编译器原文：`note: to use the following extension, you must import at least one of its inherited interfaces`，出处 `==> (package std.convert)parsable.cj:793`。这一行此前由并发线写进工作区，本批按归属规则没带走，结果是提交态编不过——归属规则让编译器输了一局。
3. **本批自己的错**：`core/src/worktree_setup_test.cj:218` 用 `let with = ...`，`with` 是仓颉关键字，编译器报 `expected identifier or pattern after 'let', found keyword 'with'`，整包编译断在这一条。已改名 `withHusky`。
4. 不属本批：HEAD 的 `core/src/agent.cj` 调 `lspBuildRequest(..., lspToken)`，而唯一定义在未入库的 `core/src/lsp_contract.cj:41`（`git status` 为 `??`），入库的 `core/src/lsp.cj` 不含该符号 —— 悬空引用，由该线自己补。

## 3. 接线被并发 git 操作抹掉并已回补

11:0x 一次别路的 `git checkout`/清扫把本批 T3 与 daemon 分派全部撤走，实测判据（回补前）：

- `grep -c "cwd" core/src/ptc_exec.cj` = 0；`git status --short core/src/ptc_exec.cj` 空（即等于 HEAD）。
- `core/src/model_tool_runtime.cj`、`core/src/agent.cj` 里 `worktree`/`exactApproval` 命中 0。
- `apps/daemon/src/daemon.cj` 里 `hostProxy` 命中 0。
- `core/src/worktree_setup_test.cj` 整度从工作区消失（因 10:45 已被提交成跟踪文件，才能按提交态原样补回，补回后与 HEAD 零差异）。

回补来源：`.qoder/wtverify/src/agent.cj`（09:54 的接线前副本，含 15 行 worktree 接线），按 hunk 打回当前文件，不整份覆盖（当前文件另有别路 `computer.*` 在飞改动）。回补清单：`agent.cj` 构造形参 `worktree!`、两条执行器登记、`worktreeStep`、`execute()` 里 exit 的精确工单守卫、`executeWithApproval()` 的 `exactApproval`、`runCodeStep` 传 `cwd: workingPath("")`；`model_tool_runtime.cj` 形参 + 声明面登记 + 透传；`ptc_exec.cj` 的 `cwd!` 形参与 `resolvedCwd` 取序；`apps/daemon/src/daemon.cj` 的 `hostProxy` 字段、能力登记、分派拆支、shutdown。

回补过程中自己引入并已改掉的一处类型错配：`HostProxyBridge.forward(method, params, clientId: JsonValue)`（`host_proxy.cj:421`）与分派层只持有的 `idText: String` 不匹配（同文件里别路的 `TeamHostBridge.forward` 收的是 `String`，`team_host_bridge.cj:164`），已改为 `JsonValue.fromStr(idText)` 显式还原。**这条尚未过编译器**（`apps/daemon` 要等核心编译通过才能构建），先记为待证。

## 4. 编译级取证（仓外副本）

通道：`git worktree add --detach D:/Temp/wtfp-20261009 HEAD`（主仓外），再把主树 `core/src/*.cj` 整份拷入，只把别路在飞且当前编不过的三份文件钉回提交态：`web_search_service.cj`、`web_http.cj`、`web_network.cj`。**主树一行未动**。私有 `TMP=D:/Temp/wtfp-tmp`，独立 `--target-dir D:/Temp/wtfp-tg`。

结果（`round 4`，`rc` 非零）：`7 errors generated, 7 errors printed`，七条全部落在 `web_network.cj`；**本批文件与三个被回补的接线文件命中 0 条**（`grep -A2 "^error:" | grep -c "worktree|agent.cj|ptc_exec|model_tool_runtime"` = 0）。打印数未触顶，故「本批无错」是正向证据而不是配额缺席。

## 5. 双入口与桌面

- 桌面 JS（工作区取证态）：`cd apps/desktop && node --test test/worktree.test.mjs test/worktree-render.test.mjs` → `# tests 22 / # pass 22 / # fail 0`。
- **变异反证（桌面形状守卫）**：`worktree-ipc.cjs` 的 `if (action === 'keep' && discardChanges) throw bad()` 原先**没有任何用例钉着**——把这条检查删掉后 `test/worktree.test.mjs` 仍 `# pass 15 / # fail 0`（假绿实测）。已在 `test/worktree.test.mjs` 的 bad 形参表里补 `{ name: 'feature-x', action: 'keep', discardChanges: true }`，三步闭环实测：①实现在线 15/15 绿；②施加变异体 → 恰好 `not ok 2 - worktree 四个通道按动作命名，参数与负载逐字段校验`（本批那条）变红，`# pass 14 / # fail 1`；③`cp` 还原后 `diff` 空输出证逐字一致、复跑回 15/15，`git status --short worktree-ipc.cjs` 为空（变异实验没留痕迹）。合跑两份仍是 `22/22`。
- `apps/daemon/test/host-proxy.test.mjs`（12 条）与 `apps/cli/test/worktree.test.mjs`（54 条）当前红，失败原文是宿主/守护进程二进制未产出（`Cannot read properties of undefined (reading 'method')`）→ **BLOCKED-on-build**，不计入本批缺陷。解锁动作：核心编译通过后重编 `apps/host`/`apps/daemon`/`apps/cli`，再用 `scripts/pack-host.mjs` 重打桌面宿主（现 `apps/desktop/dist/host/bin/sacode-host.exe` 是上一轮坏产物，首行 `PASS overflow` 且无 `run_code`）。
- 核心全量 `cjpm test` 的 Summary 计数见 §7（补数中）。

## 6. 不能原子提交的部分（纠缠证据）

本批 hunk 与另外两条线的未提交改动在同一区域，且依赖 HEAD 不存在的 API：

- `ApprovalDesk.consumeExactForCall` / `argumentsMatch` / `stateOf` 只存在于别路**未提交**的 `core/src/approval.cj`：把该文件钉回 HEAD 后编译器直接报 `'consumeExactForCall' is not a member of class 'ApprovalDesk'`（实测于仓外副本）。因此 `exit_worktree` 的精确工单审批**无法**单独落在 HEAD 之上。被这条依赖卡住的已入库用例是 `worktree_tools_test.cj` 的 17（免审批档必须拒：期望 `approval-not-granted:unknown` 且 `stage="approval-denied"`）与 18（批给 keep 的票不能放行 remove：期望 `approval-arguments-mismatch`，且挪用不烧票）——它们要的正是「精确工单」语义，而该语义的 API 还没进版本库。
- `core/src/agent.cj` 的 `worktree!` 形参与别路未提交的 `computer!: ?ComputerToolExecutor` 同一行（HEAD 该文件 `computer` 命中 0）。
- `apps/daemon/src/daemon.cj` 的 hostProxy 分派接在别路未提交的 `teamHost`/`acceptsTeamMethod` 结构上（HEAD `teamHost` 命中 0）。
- 共享 dirty 文件按行数分诊（`git diff -U0 HEAD` 的改动行 / 其中非 worktree 字面行）：`apps/desktop/main.cjs` 261/231、`renderer/app.js` 438/428、`apps/host/src/main.cj` 383/364、`apps/cli/src/remote.cj` 332/305、`preload.cjs` 43/38、`host-bridge.cjs` 50/49。整文件 `git add` 会把别路几百行按本批名义带走，故不做。

纯本批、可干净入库的：`core/src/ptc_exec.cj`（7 行全为本批 `cwd!`）、`core/src/worktree_setup.cj`（守卫形态 4 行）、`core/src/worktree_setup_test.cj`（改名 2 行）、`core/src/worktree.cj`（编译必需的 1 行 import）、`docs/`（本批 23 行）。

## 7. 核心全量计数

（待 `cjpm test` 出 Summary 后按剥码五计数补写，并注明取证态。）
