# LSP L1 收口复验（2026-10-08，第二轮，按当前工作区源码）

本轮只为解决一件事：上一轮记录（`docs/evidence/lsp-l1-codex-review-2026-10-08.md`）取的是
01:31–01:36 的源码态，而 `apps/host/src/main.cj` 在 01:40:21 又被并发线写过一次。
所以本轮全部计数都从**当前源码**重取，并把每一项标清取证态。

## 基线

| 项 | 值 |
|---|---|
| 分支 | `refactor/dsh-learning` |
| 固定提交 | `35a69ca9e0f8b7b6ac51271ec76eff3515eaa820`（本轮未变，本批仍是其上的未提交增量） |
| 本轮起点 | 2026-10-08 01:44 起，逐文件对过 mtime |
| 工作区源码哈希 | `docs/evidence/lsp-l1-workspace-hashes.txt`（14 个文件） |
| 环境 | cjc/cjpm 1.1.3，Node v22.23.2，stdx 1.1.3.1 dynamic |

## 宿主 7 个真实请求断言的具体口径（`bridge.test.mjs:1118-1162`）

这一条是唯一穿过真 stdio 打到宿主进程的 LSP 证据，它逐 verb（define/lookup/references/
implementation/call-hierarchy/diagnostics/rename）断言的是：

- `initialize.capabilities` 含 7 条 `lsp/*`，缺一条即红；
- 每个请求都必须**失败**（`assert.ok(err, …本该失败却返回了成功)`）——失败态不被伪装成空结果；
- `err.data.reason == "lsp-no-server"`、`err.data.nonSemantic == true`、`err.data.ok == false`、
  `err.data.serverId == ""`（无插件时不凭空带出服务器身份）；
- `err.data.clues` 里真的扫到 `function:alpha`（来自 `lspSymbols`），同时
  `locations.length == 0`、`diagnostics.length == 0`、`editFiles.length == 0`、
  `diagnosticSnapshot == "none"` —— 文本线索不得混进语义字段，未收到快照不得报「文件是干净的」；
- 参数错误不走扫描：`direction: "sideways"` → `data.reason == "lsp-bad-args"` 且 `clues.length == 0`；
- 未知 method 不被 LSP 分派兜住：`lsp/formatting` → `-32601 method not found`。

桌面侧另两条：`1033` 断言 preload 只交 7 个动作、省略的可选键根本不存在（不是被填成
`undefined`/`0`），并逐个 `forbidden in api` 反证 `request/call/invoke/send/hostRequest/lsp/lspCall`
都不存在（没有万能转发通道）；`1061` 断言主进程逐字段守卫，且**被拒的负载不会转发到宿主**
（转发计数在拒绝前后不变）。

## CLI 入口实测发现一处真实接线缺口（已修）

复验时用私有重建的 CLI 直接打了手工面，结果与两个入口的对称性不符：

- 修复前 `sacode call lsp_define --json '{"path":"sample.ts","line":0,"character":9}'`
  回的是 `reason:"lsp-bad-args"` 且 `sessionId:""`；同一份负载给旧 `lsp` 却 `ok:true` 拿到
  `["function:alpha:sample.ts:1"]`。
- 根因：`apps/cli/src/main.cj` 手工面是 `ToolRuntime(log, reg)`，既不传 `workingDirectory`
  也不传 `lspSession`，于是 `lspVerbStep` 算出的 root 为空，`lspCheckRequest` 第一句
  `req.sessionId.size == 0 → lspFailBadArgs`（core/src/lsp_contract.cj:478）——
  这 7 条工具在 CLI 入口只有声明面、执行面永远走不到路由。
- 修法（两处 + 一条回归）：`lsp_contract.cj` 新增 `lspProcessWorkspace()`（`canonicalize(".")`，
  取不到给空串，不造假身份）；`agent.cj` 的 `lspVerbStep` 在 root 为空时退回它；
  新增用例 `lspManualEntryWithoutSessionFallsBackToProcessWorkspace` 钉住
  「空会话空工作目录也必须落 `lsp-no-server`、`sessionId` 非空，且坏参数仍落 `lsp-bad-args`」。
- 修复后同一条命令实测（CLI 产物 SHA 见下表）：`reason:"lsp-no-server"`、
  `nonSemantic:true`、`label:"非语义结果"`、`sessionId` 为真实目录、
  `clues:["function:alpha:…/sample.ts:1"]`、`locations/diagnostics/editFiles` 全空、
  `diagnosticSnapshot:"none"` —— 正是 objective §2 约定的无插件回退形状，且这是在
  CLI 入口的运行证据，不再只有单测。

## 修复后重跑的核心计数

| 验证 | 命令 | 结果 | 日志 |
|---|---|---|---|
| 私有 L1 副本按修复后源码增量重建 | `cjpm build -i` | rc=0 | `lsp-l1v4-build.log` |
| 修复后核心套件 | `cjpm test --parallel 1 --no-progress --no-color` | **TOTAL 73 / PASSED 72 / SKIPPED 1 / ERROR 0 / FAILED 0**，rc=0，`cjpm test success` | `lsp-l1v4-testlink.log` |
| 直接跑 unittest 二进制复核同一计数 | `core.exe --no-color --parallel=1 --no-progress` | 同上，rc=0 | `lsp-l1v4-tests.log` |
| 新增用例点名 | 按 PASSED 行匹配 | `[ PASSED ] CASE: lspManualEntryWithoutSessionFallsBackToProcessWorkspace` | 同上 |
| CLI 重建 | 私有迷你工作区 `cjpm build` | rc=0 | `lsp-l1v4-cli-build.log` |

本批 L1 用例数由 36 变 **37**，总数由 72 变 73（新增就是上面那条）。

## 全量核心套件（252 文件）：原「链接段卡住 / 环境容量阻塞」归因是错的，此处更正

`apps/desktop/.tmp-test/lsp-l1-hostws/core` 编全 252 个 `core/src` 文件（含并发线未落库的
`execution_*`、`git_workbench`、`terminal_view`、`durable_checkpoint`、`goal_claim` 及其测试）。

**本节先前两句话要撤回**，实测真因是本会话自己造成的文件锁，不是本机容量：

- **编译段确实通过**：`lsp-l1v3-full-testlink.log`（576 KB）里 `error:` 为 0，只有 234 条告警，
  并产出 `core$test.cjo` 与 `std.testrunner.exe`。这条仍然成立。
- **第一次（03:25 那轮）根本不是卡在链接段**：cjpm 当时已经链完并在跑测试 worker，
  我把 worker 阶段（stdout 只在结尾才出 Summary，中间不增长）误读成链接停滞，随后手动终止。
  那次终止还留下了孤儿进程，见下条。
- **第二次（`lsp-l1v5-full-test.log`）rc=1 的原文**（1460 行、10444 行两处）：
  `ld.lld: error: failed to write the output file: Permission denied`，
  输出目标分别是 `lsp-l1-hostws/core/target/release/unittest_bin/std.testrunner.exe` 与同目录 `core.exe`。
  占用者正是第一次误判时我手动终止后残留的 4 个孤儿测试进程（03:25:35、03:44:41 启动的
  `core.exe` / `std.testrunner.exe`，命令行路径都在 `lsp-l1-hostws` 下）。
- **处置**：只按 `Path -like '*lsp-l1-hostws*'` 杀掉这 4 个本会话自己的进程；
  其他会话在 `core/target/release/unittest_bin` 与 `.qoder/lsp1/tg-red` 下的 `core.exe`、
  `std.testrunner.exe` 以及两个 `cjpm.exe` **一个都没动**。
- **教训落回技能口径**：cjpm 的 stdout 平静不等于挂死（`reference-cjpm-test-progress-signals`），
  判停滞要看 `.test-logs/<pkg>.errlog` 是否增长与 cjc 子进程 CPU；误终止会留孤儿进程锁住
  `unittest_bin/*`，下一轮就变成 `Permission denied`——这条红是本批自己造成的，不能写成环境阻塞。

更正后按干净重跑记录，结果见下表「全量核心套件重跑」。

### 全量核心套件重跑（清掉自己的孤儿锁之后，04:12 起）—— 登记为 BLOCKED

命令：`cd apps/desktop/.tmp-test/lsp-l1-hostws/core && TMP/TEMP/TMPDIR=<私有> cjpm test --parallel 1 --no-progress --no-color`
日志 `lsp-l1v6-full-test.log`，退出码文件 `lsp-l1v6-full-test.exit.txt`。

| 段 | 实测 |
|---|---|
| 编译 | **通过**：0 error，`234 warnings generated`（并发线的 `execution_service_test.cj`、`sse_test.cj` 宏展开告警为主） |
| 链接 | **通过**：`unittest_bin/core.exe` 04:26:26 新写入、26712576 字节——上一轮的 `Permission denied` 没有复现，证明那次确实是自己留下的孤儿锁 |
| 执行 | **未出 Summary**：worker PID 26544 自 04:26:28 起持续跑，04:54:14 时 CPU 累计 1795.97s；8 秒墙钟采样 CPU 增 8.875s（≈100% 占核，在算不是在等），12 线程，TCP 只有本机回环，**没有外连**，排除真模型/网络阻塞 |
| 结论 | **BLOCKED（无 Summary）**。不写成通过，也不写成「编译通过」冒充全量。 |

归因证据（这条是本节最要紧的一句）：**同一台机器上另外两条会话跑的同一份全量套件也没有跑完**——
`core/target/release/unittest_bin/core.exe`（PID 21344，00:41:05 启动，CPU 16434s）与
`.qoder/lsp1/tg-red/release/unittest_bin/core.exe`（PID 23912，02:01:14 启动，CPU 11330s）
到 04:54 仍存活且都未产出 Summary。三份进程用的是同一批并发线未落库的测试文件集。
所以「全量套件在当前工作区态不终止」是**这套工作区状态的性质**，不是本批 L1 的性质，也不是某一次运行的运气。
三条进程都不是我发起的，**一个都没杀**，我自己的 26544 也留在位上继续跑。

本批因此改用可归因的专项计数作为 §4 依据（见「修复后重跑的核心计数」：TOTAL 73 / PASSED 72 / SKIPPED 1 / FAILED 0 / ERROR 0，rc=0），
并在下一批把「全量套件里哪一条用例不返回」单独定位出来——定位手段是按 `--no-progress` 关掉后逐用例跑，或先把并发线的
`execution_service_test` 等新进套件的测试逐个移出。这件事不属于 L1，也不该由 L1 顺手改掉别人的测试来凑绿。

### 执行段不终止的真因已定位（05:20 实测，不是并发线的测试，也不是机器容量）

把 `--parallel=1`（主进程 + worker）换成 **`--parallel=false`（单进程内联）并加 `--timeout-each=30s`** 后，
同一份 L1 专项副本立刻跑完并打出 Summary：`TOTAL: 82 / PASSED: 79 / SKIPPED: 1 / ERROR: 0 / FAILED: 2`，rc=1
（日志 `lsp-l1v10-inline.log` / `.exit.txt`）。所以「跑不完」不是 worker 环境问题之外的第二个原因，而是**有用例永不返回**：

- 两条 FAILED 是 `globMatchPatternWildcard` 与 `globMatchPatternDoubleStar`，
  各自的 `time elapsed` 是 **30010357000 ns**——正好撞上 30s 上限，即它们本来会一直跑下去。
- 复现输入：`globMatchPattern("test.txt", "*.md")`（期望 `false`）**永不返回**。
  逐行推 `core/src/fs_tools.cj` 的回溯分支：`*` 记下 `starI/starJ` 后，失败时执行
  `starI += 1; i = starI; j = starJ`，而 `starI` 从不与 `n.size` 比较；
  一旦 `starI > n.size`，`i < n.size` 恒假、`p[j]` 又不是 `?`，于是 `j` 永远回不到 `p.size`，
  外层 `while (j < p.size)` 变成死循环——这也解释了为什么它只烧 CPU 而不做任何 I/O。
- 顺带修正一处语义：`globMatchPattern("a.txt", "**")` 与 `("a/b/c.txt", "**")` 现在返回 `false`，
  而 `globMatchPatternDoubleStar` 断言 `true`（`**` 合并分支把 `j` 直接推到 `p.size`，从不消费 `name`）。
- **出处不是本批**：`core/src/fs_tools.cj` 与开工基线哈希 SAME（也等于 HEAD `35a69ca` 的实现），
  本批一个字没改它；`git log -- core/src/fs_tools.cj` 上已有
  `0fac0a5`「glob 回溯修正」与 `3e16664`「glob 回溯」两条提交，说明这条线此前就在改同一个函数。
- **本批不修**：`fs_tools.cj` 按 `docs/plans/w00-path-ownership-and-isolation` 属 W40/E，
  登记单里本批对它的要求是「只保留 `lspSymbols`，不动签名与既有断言」。
  一行候选修法（等授权后由主责面提）：回溯分支里先判 `if (starI >= n.size) { return false }`，
  并为 `**` 单独走可跨 `/` 的匹配而不是并进单 `*` 的合并逻辑。

### 全量核心套件的 Summary 已经拿到（05:22 实测，`--parallel=false` + 每条 30s 上限）

命令：在私有迷你工作区 `apps/desktop/.tmp-test/lsp-l1-hostws/core`（全 252 个 `core/src` 文件）里
直接跑已链好的 `target/release/unittest_bin/core.exe --no-color --no-progress --parallel=false --timeout-each=30s`，
私有 TMP 用**当轮唯一**的新目录（先前两次失败之一就是两个运行共用同一份 TMP，`std.unittest` 抛
`Too many attempts to create a temporary file` 且零 Summary）。

| 计数 | 实测 |
|---|---|
| Summary | `TOTAL: 900 / PASSED: 881 / SKIPPED: 2 / ERROR: 10 / FAILED: 7`，rc=**1** |
| 算术自证 | 881 + 2 + 10 + 7 = 900 |
| 失败名单 | 报告把 FAILED 与 ERROR 合并在同一个 `listed below` 块里共 **17** 个名字：`browserNavigatesRealUrl`、`globMatchPatternWildcard`、`globMatchPatternDoubleStar`、`wrongPassphraseIsRejectedWithoutPlaintextOrEcho`、`shellExecutesSimpleCommand`、`sseNetworkHttpErrorsSafe`、`sseNetworkRedirectNeverForwardsCredentials`、`sseNetworkDefaultTlsRejectsSelfSigned`、`sseNetworkBlockedReadTimesOut`、`sseNetworkBlockedReadCancellationDropsLateFrame`、`sseNetworkDisconnectNeverCompletes`、`sseNetworkNormalTextUsageFinishDone`、`sseNetworkLongStreamOverflowReplaysEveryPersistedField`、`sseNetworkLongCancelledPrefixReplaysWithoutAssistant`、`sshExecRunsRealSshAgainstUnreachablePort`、`sshExecRunsRealSshAgainstLiveSshd`、`quotaFailureCarriesRetryAfterFromTheRealHeader` |
| 与 L1 的交集 | **0 条**——按 `^lsp`／`^legacyLsp` 前缀筛这 17 个名字，命中 0；36 条 L1 用例（该副本当时是修复前的测试文件）全部在 PASSED 行 |
| 这份数的源码态 | 与工作区逐文件比过：`lsp_contract.cj`、`agent.cj`、`model_agent.cj`、`model_tool_runtime(_test).cj`、`fs_tools.cj`、`lsp.cj`、`lsp_test.cj` 全 **SAME**；**只有 `lsp_contract_test.cj` 是 02:58 那份（36 条，没有第 37 条 `lspManualEntryWithoutSessionFallsBackToProcessWorkspace`）** |

所以这一节把先前的 BLOCKED 换成一条能复跑的读数，同时保留 BLOCKED 记录本身。
**并且要把因果讲准，不能留成「worker 跑法坏了」这种错的一般化**：

- 全量 `cjpm test`（默认会跑）不返回的**唯一原因是套件里有永不返回的用例**（`globMatchPattern*` 两条，见上节），
  不是 worker 机制本身坏了。三条在飞的同类进程都卡在这里。
- 内联跑法（`--parallel=false`）+ `--timeout-each=30s` 只是**把不返回变成可归因的 FAILED**，
  才让 Summary 打得出来；它没有把那条缺陷修掉，红照旧在。
- `cjpm test` 还有另一条独立失败模式：**两个运行共用同一份私有 TMP** 时，`std.unittest` 直接抛
  `Too many attempts to create a temporary file` 且零 Summary（本轮 v7 就是这么红的）。
  TMP 必须**每轮唯一**，这条与 `scripts/verify-tmp.mjs` 的落库口径一致。
- `cjpm test --no-run -i` 这次 rc=0、打印 `cjpm test success`（日志 `lsp-l1v12-full-build.log`）——
  那是**构建**成功，不是运行成功，两者不能混着写。

补齐第 37 条后的全量重跑在 `lsp-l1v12-*`（预期 `TOTAL: 901 / PASSED: 882`，其余计数不变）。

### 当前源码态的全量 Summary 已实测（05:44，预期与观测逐项对上）

同步唯一有差异的 `lsp_contract_test.cj`（与工作区 sha 逐字一致）后 `cjpm test --no-run -i` 重新链出
`unittest_bin/core.exe`（05:37:40，26727424 字节），再按同一条内联命令跑：

| 项 | 预期 | 实测 |
|---|---|---|
| TOTAL | 900 + 1 | **901** |
| PASSED | 881 + 1 | **882** |
| SKIPPED / ERROR / FAILED | 不变 | **2 / 10 / 7** |
| rc | 非零（仍有红） | **1**（不写成全绿） |
| 37 条 L1 用例 | 全在 PASSED | 按源文件 `@Test` 名单逐条比对，**missing: NONE**，含第 37 条 `lspManualEntryWithoutSessionFallsBackToProcessWorkspace` |
| 失败名单里的 LSP 面 | 0 | 按 `^lsp`／`^legacyLsp` 筛 **命中 0** |

日志 `lsp-l1v13-full-inline.log`（剥码 `.clean.txt`）/ `lsp-l1v13-full-inline.exit.txt`，
私有 TMP 用当轮唯一新目录。这一份是本批 §4 的**全量依据**；
先前那份 `TOTAL 900` 的读数保留在上面，标注的是修复前测试文件态（36 条），两份不是同一件事，都留着。

## 保留面自证（objective §1、§4）

开工基线 11 个文件逐字节比对当前工作区：

- `core/src/lsp.cj`、`core/src/lsp_test.cj`、`core/src/fs_tools.cj` → **SAME**（与 `docs/evidence/lsp-l1-baseline-hashes.txt` 一致）。
  即 `lspSymbols` 与 `LspSymbolRegistry` 及其测试原样保留，签名与既有断言未动。
- 其余 8 个 MOVED 都是本批要改的入口文件，符合登记单。

## 契约面自证（objective §2）

`core/src/lsp_contract.cj` 实测在位的面：

| 要求 | 落点 |
|---|---|
| 7 verb 词表唯一真源 | `lspVerbNames` / `lspIsVerb` / `lspToolName` / `lspMethodName` / `lspToolDescription` / `lspToolParamNames` |
| 14 个失败原因常量 | 119–132 行 `lspFail*`，含 `lsp-no-server` `lsp-unsupported` `lsp-server-gone` `lsp-cancelled` `lsp-stale-result` `lsp-no-diagnostic-snapshot` `lsp-extension-conflict` |
| 诊断快照三态 | `lspSnapshotNone` / `lspSnapshotEmpty` / `lspSnapshotPresent` + `lspIsSnapshotState` |
| 0 起始行、UTF-16 列 | `LspPosition` 注释与 `lspUtf16Length` |
| 路径规范化 + 工作区边界 | `lspNormalizePath` / `lspPathInsideWorkspace` / `lspCheckLocationPayload` |
| 在途结果失效 | `hasRegistration` → `lspFailure(req, lspFailServerGone)` |
| 回退不伪装语义 | `nonSemantic = true` 只挂文本线索；成功路径显式 `nonSemantic = false` |
| 分 verb 响应形状 | `LspResponse` 的 `locations`（define/lookup/references/implementation）、`hoverMarkdown`（lookup）、`callItems`（call-hierarchy）、`diagnostics` + `diagnosticSnapshot`（diagnostics）、`editFiles`（rename 跨文件 TextEdit） |
| references 默认含声明、rename 只出预览 | `LspRequest.includeDeclaration` 默认 `true`；`lspResponseJson` 里 `"previewOnly"` 仅当 `verb == "rename"` 为真 |

核心与两个公共入口内 grep `tsserver|typescript-language-server|pyright|gopls|rust-analyzer` = **0 命中**，
即「公共入口不出现具体 language server 名称」成立。

## 接线面自证（objective §3，按符号锚点复核当前工作区源码）

| 要求 | 实测落点（符号锚点，命中唯一） |
|---|---|
| 7 个模型工具名与免审批 | `model_tool_runtime.cj` 内 `for (verb in lspVerbNames()) { registry.register(ToolSpec(lspToolName(verb), …, lspToolSchema(verb), false)) }`——第 5 个实参 `false` 即 `needsApproval`，7 条同一路径生成 |
| 声明面与运行面同一张表 | `lspToolParamNames(verb)` 同时供 `lspToolSchema`（`additionalProperties:false` + `required`）与 `lspParseParams` 的按键白名单；契约文件里那句「出现的键数必须等于本 verb 认识的键数」就是运行期二次校验 |
| Schema 禁额外字段 | `lspToolSchema` 返回串固定含 `"additionalProperties":false` |
| Agent 7 个步骤方法共用一条校验+路由 | `agent.cj` 的 `lspDefineStep … lspRenameStep` 7 个一行方法，全部转发到私有 `lspVerbStep(verb, args)` |
| 旧 `lsp` 执行器保留 | `executors.add("lsp", { _, a => lspStep(a) })` 与 7 条 `executors.add("lsp_*", …)` 并存，手工入口仍可用 |
| 成功诊断/rename 不计入目标进展 | `model_agent.cj` 的 `if (outcome.allowed && call.name != "update_goal" && call.name != "lsp_diagnostics" && call.name != "lsp_rename") { succeeded += 1 }` |
| 结构化失败不被二次转义 | `model_agent.cj` 结果取值 `else if (outcome.structured) { outcome.why }`，`ApprovalOutcome.structured` 由 `lspVerbStep` 在失败分支置真 |
| Host 7 个固定分派 + 能力表 | `isLspMethod` 只列 7 个 `lsp/*` 字面量；`lspVerbOfMethod` 做方法→verb；`initialize` 能力表尾部 7 条 `lsp/*`；分派体走 `LspRouters.sharedRouter().route(req)`，失败发 `errFrameData(…, resp.reason, lspResponseJson(resp))` |
| L1 宿主默认无服务器 | 宿主只引用 `LspRouters.sharedRouter()`，全文件无任何注册调用，故 7 个请求都落 `lsp-no-server` |
| rename 不写盘 | `core/src/lsp_contract.cj` 内对 `writeFile`／`writeText`／`File.write`／`saveFile` 四个名字 grep = **0 命中**（整个契约文件没有任何写文件调用） |
| 桌面 7 通道且集合一致 | `preload.cjs` 的 7 个 `sacode:lsp*` 引用与 `main.cjs` 的 7 个 `ipcMain.handle("sacode:lsp*")` 名称集合逐字相同（脚本比对：`set equal: true`，名单 `lspCallHierarchy,lspDefine,lspDiagnostics,lspImplementation,lspLookup,lspReferences,lspRename`） |
| 不开放通用转发 | 渲染层拿不到 `request/call/invoke/send/hostRequest/lsp/lspCall` 任一万能通道（`bridge.test.mjs` 断言其在 `api` 上不存在），主进程侧只按字面量 method 转发 |

## 本轮实测计数

| 验证 | 命令 | 结果 | 日志（`apps/desktop/.tmp-test/`） |
|---|---|---|---|
| 私有核心副本按当前源码重建 | `cjpm build -i` | rc=0，`cjpm build success` | `lsp-l1v2-build.log` |
| 同上重链 unittest 二进制 | `cjpm test --parallel 1 --no-progress --no-color` | rc=0 | `lsp-l1v2-testlink.log` |
| 直接跑二进制（L1 专项集，132 文件） | `core.exe --no-color --parallel=1 --no-progress` | **TOTAL 72 / PASSED 71 / SKIPPED 1 / ERROR 0 / FAILED 0**，rc=0 | `lsp-l1v2-tests.log` |
| 本批 36 条用例逐条点名 | 按 PASSED 行匹配用例名 | **36/36 全部出现在 PASSED 行**，无缺失 | 同上 |
| 模型声明面总数 | `model_tool_runtime_test.cj:67` | `@Expect(tools.size(), Int64(17))` 通过（11 − 1 + 7） | 同上 |
| Host 面门禁 | `node scripts/check_host_method_surface.cjs` | 见下「门禁归因」 | 本轮输出 |
| 桌面 IPC 面门禁 | `node scripts/check_ipc_surface_parity.cjs` | 见下「门禁归因」 | 本轮输出 |
| 宿主重建（第一次尝试，真实工作区） | `cd apps/host && cjpm build -i --target-dir <私有>` | **BLOCKED→已作废**：核心段编完后停在 `cjc` 无子进程、20 秒只用 0.016s CPU；手动终止，该 attempt 的 exit 文件里的 `127` 是被终止的退出码，**不是构建失败**。「本机 commit 余量仅约 2 GB」当时被当成原因，但同一误读模式已在下节「全量核心套件」被证实是我的归因错误，**这条的停滞原因按未复核登记**，只保留「已作废、不作为本批证据」这一结论 | `lsp-l1v2-host-build.log`（143 warnings 后停） |
| 宿主重建（第二次，私有迷你工作区） | `lsp-l1-hostws/apps/host`：当前 core/src 全 252 文件 + 当前 apps/host/src 2 文件，`cjpm build` | **rc=0**，`cjpm build success` | `lsp-l1v2-host-build.log` / `lsp-l1v2-host-timeline.txt`（02:58:53→03:08:04） |
| 宿主打包 | `node scripts/pack-host.mjs <main.exe> <私有 out> <stdx dynamic> <runtime/lib/windows_x86_64_cjnative>` | rc=0，bin 内 **91** 个文件（第一次误传 `Cangjie/runtime/bin` 该路径不存在 → pack rc=1 只落 41 个，宿主靠 PATH 兜底才起得来；换对目录后 DLL 齐） | `lsp-l1v2-host-pack.log` |
| 桌面 7 个真实 LSP 请求（新宿主） | `SACODE_HOST=<新宿主> node --test --test-name-pattern='LSP\|lsp' test/bridge.test.mjs` | **4/4 pass，fail 0，rc=0** | `lsp-l1v2c-ipc.log` |
| 同上，PATH 仅 Windows System32 | 同上但 `PATH=C:/Windows/System32;C:/Windows` | **4/4 pass，fail 0，rc=0**（这条同时反证了上一行不是靠 PATH 蒙过的） | `lsp-l1v2c-ipc-no-sdk.log` |
| CLI 入口重建 + tool 断言 | 私有迷你工作区 `cjpm build`，再跑 `main.exe tool` / `tools` | 见下表（修复后二进制） | `lsp-l1v4-cli-*` |
| 全量核心套件（252 文件）干净重跑 | 私有迷你工作区 `cjpm test --parallel 1 --no-progress --no-color`（TMP/TEMP/TMPDIR 私有） | **BLOCKED**：编译 0 error、234 warning；`core.exe` 04:26:26 链接成功；执行 50 分钟无 Summary（worker CPU 3281s 持续增长），无外连 | `lsp-l1v6-full-test.log`（`.exit.txt` 最终 `rc=127`＝被我终止） |
| 同上，改内联跑法（`--parallel=false --timeout-each=30s`） | 直接跑已链好的 `core.exe`，当轮唯一私有 TMP | **拿到 Summary：TOTAL 900 / PASSED 881 / SKIPPED 2 / ERROR 10 / FAILED 7，rc=1**；17 个失败名里 `^lsp`／`^legacyLsp` 命中 **0** | `lsp-l1v11-full-inline.log` / `.exit.txt` |
| L1 专项副本 + 补进 `fs_tools_test.cj` 后内联跑 | `core.exe --parallel=false --timeout-each=30s` | **TOTAL 82 / PASSED 79 / SKIPPED 1 / ERROR 0 / FAILED 2，rc=1**；82 = 73 + 9 与基线算术对上；两条 `lspSymbols*` 与四条注册表用例都在 PASSED 里，FAILED 只有 `globMatchPatternWildcard`/`DoubleStar`（各 30.01s 撞上限＝不返回） | `lsp-l1v10-inline.log` / `.exit.txt` |
| **全量 252 文件、当前源码态内联跑（本批 §4 全量依据）** | 同步 `lsp_contract_test.cj` 后 `cjpm test --no-run -i` 重链，再 `core.exe --parallel=false --timeout-each=30s` | **TOTAL 901 / PASSED 882 / SKIPPED 2 / ERROR 10 / FAILED 7，rc=1**；37 条 L1 用例逐条比对全在 PASSED；失败名单里 `^lsp`／`^legacyLsp` 命中 0 | `lsp-l1v13-full-inline.log`（剥码 `.clean.txt`）/ `.exit.txt` |

| CLI（修复后二进制 `3f5e8269e541ab8bd4b0a04cf5408267a2513109d0b7a5a4081c2b4d273de943`） | 结果 |
|---|---|
| `cjpm build` | rc=0 |
| `main.exe tool` | **16 PASS / 0 FAIL / ALL PASS**，rc=0 |
| `main.exe tools` | 声明面 **16** 条，其中 `lsp_` 前缀 **7** 条，且旧 `lsp` 一条仍在（`tool lsp free 从文件中提取符号`），全部标 `free`（免审批） |
| `main.exe call lsp_define --json …` | 修复后落 `lsp-no-server` + `nonSemantic:true` + 真实 `clues`（见「CLI 入口实测发现一处真实接线缺口」） |

### 修复后宿主与桌面的最终计数（`lsp-l1v5-*`，源码含 §CLI 缺口修复）

| 验证 | 命令 | 结果 |
|---|---|---|
| 宿主重建（当前源码，含修复） | 私有迷你工作区 `cjpm build` | **rc=0**（03:47:09→03:56:00，编链共约 9 分钟；这一轮的耗时属冷编规模，不是停滞——停滞归因见上节更正） |
| 打包 | `pack-host.mjs <main.exe> <私有 v3> <stdx> <runtime/lib/windows_x86_64_cjnative>` | rc=0，bin **91** 个文件 |
| 桌面 7 个真实 LSP 请求 | `SACODE_HOST=<v3 宿主> node --test --test-name-pattern='LSP\|lsp' test/bridge.test.mjs` | **4/4 pass，fail 0，rc=0** |
| 同上，PATH 仅 System32 | 同上换 `PATH=C:/Windows/System32;C:/Windows` | **4/4 pass，fail 0，rc=0** |

最终宿主二进制 SHA256（`main.exe` 与打包后的 `sacode-host.exe` 逐字节相同）：
`1fe7bc288671d9d56c1a97d89245cc6e7120525ab2992c566cf7f6ab0dff66ea`
（`lsp-l1v5-host-main-exe.sha.txt` / `lsp-l1v5-host-exe.sha.txt`）。
它编的是修复后的 core（`lsp_contract.cj` 加 `lspProcessWorkspace()`、`agent.cj` 的 root 兜底）
+ 当前 `apps/host/src/main.cj`（含并发线 01:40 的写入）。
早先 02:58 那份 `f68b791d…` 是修复前状态，仍留在 `lsp-l1v2-*` 里，不充作最终证据。

新宿主二进制 SHA256：`f68b791deeac4a3777e66001a022a127ab6378ab1cac3400c72b084bb5d482a0`
（`apps/desktop/.tmp-test/lsp-l1-packed-v2/bin/sacode-host.exe`；`lsp-l1v2-host-exe.sha.txt`）。
它编的是**合并后的当前工作区源码**，包含并发线 01:40 那次对 `apps/host/src/main.cj` 的写入，
所以上一轮那份「7 个真实请求」的证据空洞已按当前源码补上，不再依赖 01:34 那份产物。


上一轮记录里 01:31–01:36 那份计数仍然有效于 **L1 自己的文件**：本轮把私有副本与工作区逐文件比过哈希，
自那以后只有 `core/src/workspace.cj`、`core/src/execution_service.cj`（并发线，01:39–01:40）与
`apps/host/src/main.cj`（01:40:21）三个文件动过，L1 的 9 个文件一个字节都没变。
本轮上表的核心计数已把前两个文件的新版本一起编进去重跑，所以两份数一致不是巧合而是复跑结果
（修复前 72/71/1，修复后 73/72/1，差的那 1 条就是 `lspManualEntryWithoutSessionFallsBackToProcessWorkspace`）。

## 测试面覆盖映射（objective §4 五条 → 37 条用例名，逐条唯一归位）

`core/src/lsp_contract_test.cj` 里除 5 个夹具函数（`pathFor` / `lspWorkspace` / `lspJsonIsObject` /
`lspReq` / `lspBind`）外共 **37** 条 `@Test`，按 §4 的五条要求各归一处、不重复：

| §4 要求 | 用例名 |
|---|---|
| 7 verb 参数校验、无插件失败及带标记回退、坏参数/越界/取消不扫描 | `lspRejectsUnknownVerbWithoutScanningFile` `lspRejectsEmptyIdentityAndBadPositionsWithoutScanning` `lspRejectsPathOutsideSessionWorkspaceWithoutScanning` `lspNoServerKeepsFailureAndAddsMarkedTextClues` `lspParamParsingRejectsExtraKeysAndBadTypesPerVerb` `lspCallHierarchyDirectionIsClosedSet` `lspRenameRequiresNewNameAndReferencesDefaultsToIncludeDeclaration` |
| 多扩展名路由、注册冲突、撤销、能力缺失、取消、迟到结果 | `lspRoutesByNormalizedExtensionAndAllowsDistinctOwners` `lspMultiExtensionRegistrationServesAllRegisteredExtensions` `lspSameExtensionRegistrationIsRejectedAndKeepsFirstOwner` `lspUnregisterRevokesRoutingByRegistrationIdentity` `lspUnsupportedDoesNotFallBackToTextScan` `lspCancelledRequestIsNotDisguisedAsEmptyResult` `lspLateResultCannotBeTheValidResultForANewerDocument` `lspResultInFlightAfterUnregisterBecomesServerGone` `lspServerFailureAndDisconnectAreNotEmptyResults` `lspSharedRouterDefaultsToNoServerAndIsOneInstancePerProcess` |
| 有效空诊断 vs 未收到快照；诊断进上下文且不生成目标推进证据 | `lspEmptyDiagnosticSnapshotDiffersFromMissingSnapshot` `lspNoServerDiagnosticsDoesNotClaimTheFileIsClean` `lspDiagnosticsEnterModelContextWithoutGoalProgress` `lspRenamePreviewDoesNotAdvanceGoalEvidence` |
| rename 跨文件编辑、版本与范围校验、执行前后文件哈希不变 | `lspRenamePreviewSpansFilesAndLeavesEveryByteOnDiskUntouched` `lspRenameEditOutsideDocumentRangeIsRejected` `lspRangeMustBeHalfOpenAndWithinDocument` `lspResponseCarriesServerIdentityAndDocumentVersion` `lspResponseWithoutMatchingServerIdentityIsRejected` `lspLocationOutsideWorkspaceIsNotAdopted` |
| 旧文本符号与注册表测试仍通过；模型工具数量与请求 Schema 断言更新 | `legacyLspExecutorStillServesManualCalls` `lspManualEntryWithoutSessionFallsBackToProcessWorkspace` `lspModelToolsAreSevenNoApprovalAndClosedSchemas` `lspModelToolExecutesThroughSharedRouterAndKeepsObjectShape` `lspStructuredFailureReachesTheModelAsAnObjectNotAnEscapedString` `lspVerbVocabularyIsExactlySeven` `lspToolAndMethodNamesDeriveFromVerb` `lspColumnsCountUtf16UnitsNotBytesOrRunes` `lspPathNormalizationResolvesDotsAndBackslashes` `lspBuildRequestCarriesSessionRequestIdentityAndCancelToken` |

模型声明面总数另有独立断言 `model_tool_runtime_test.cj` 的 `@Expect(tools.size(), Int64(17))`；
旧 LSP 文本面与注册表回归是 `core/src/lsp_test.cj` / `fs_tools.cj` 里的既有用例，本轮哈希 SAME，未动。

这两面后来都**真跑过**（先前只靠哈希相同，那不算通过证据）：把与工作区逐字节同一份
（sha256 `3a924831…`）的 `core/src/fs_tools_test.cj` 补进 L1 专项副本后内联跑，
`lspSymbolsExtractsFunctionNames`、`lspSymbolsEmptyFile` 与 `lsp_test.cj` 的
`lspDefineAndLookup`、`lspRejectsEmptyFields`、`lspDuplicateDefineIsNoop`、`lspRenameUpdatesLocation`
全部落在 PASSED 行；该文件里另两条 `globMatchPattern*` 是不返回的那条既有缺陷（见上一节），不是 LSP 面。
全量 900 条那轮里这六条同样在 PASSED 行。

这张映射表本身是机械核对的，不是手数字数：从表格行抽出的用例名 37 个、去重后 37 个、
与源文件里 `@Test` 后紧跟的函数名集合**双向差集为空**，每行分别 7/10/4/6/10 条，合计 37。

## 门禁归因（两项 FAIL 都不是本批）

`check_host_method_surface.cjs`：

- `dispatch-vs-capability-parity` FAIL = 声明未分派 5 条，全部是 `execution/*`；**「分派未声明 0 条」**，
  说明 `lsp/*` 7 条既声明又分派。
- `frozen-denominator` FAIL = 声明面 101 对冻结 82。本批只贡献 7 条，撤掉本批仍是 94 ≠ 82，
  即该 FAIL 早于本批存在，属并发累计，改分母要同时改常量与 p0-interface-freeze §2。
- 其余 7 项全 OK，含 `literal-shape-coverage`（176 == 176）与 `no-dynamic-method-name`。

`check_ipc_surface_parity.cjs`：

- `handler-count-matches-names` FAIL（82 处 `handle(` 对按名取到 81）与
  `surface-set-parity` FAIL（只在 preload 的 6 条 = `executionPropose/Authorize/Start/Describe/Output/Stop`）
  同因：并发线的 execution 通道用 `ipcMain.handle(\`sacode:${action}\`)` 模板字面量注册
  （`apps/desktop/main.cjs:106`），本门禁的按名取数不认这种书写形态。
- 本批 7 条是逐条字面 `ipcMain.handle("sacode:lspXxx")`，两侧集合对称，未进入任一 FAIL 集。

## 红先证据（本批两条面各自有红，不是只报绿）

| 面 | 红形态 | 实测 | 日志 |
|---|---|---|---|
| 核心契约 | 先只写测试、实现一个字节未写，拿编译器红 | `cjpm test --no-run` → `150 errors generated, 8 errors printed`，打印的 8 条全是 `undeclared type name 'Lsp…'`，位置全在 `core/src/lsp_contract_test.cj`，无上一批符号名越出 | `.qoder/lsp1/red.log`（剥码 `red.clean.log`），详见登记单 §6 |
| 桌面/宿主 IPC | 文档版本参数与不安全整数未守 | `not ok 3 - LSP 位置动作携带文档版本并拒绝不安全整数`，随后修复转绿 | `apps/desktop/.tmp-test/lsp-l1-ipc-prepack.log` → `lsp-l1-ipc.log`（4/4） |
| CLI 手工面（真实缺口） | **行为红，不是先写的 @Test 红**：实测 `main.exe call lsp_define --json …` 在未绑会话工作区的入口上返回 `lsp-bad-args` 且 `"sessionId":""`（该帧还带着 `"label":"语义结果"`、`nonSemantic:false`，即根本没走到回退标注），7 条工具在该入口永远到不了路由 | 红由运行探针取得；第 37 条用例 `lspManualEntryWithoutSessionFallsBackToProcessWorkspace` 与修复同批写入，**没有单独取过它的运行红**，其防回归能力计入上节变异反证待做项 | 红 `lsp-l1v3-cli-call.log` → 绿 `lsp-l1v4-cli-call.log`：同一命令改落 `lsp-no-server` + `nonSemantic:true` + `clues:["function:alpha:…sample.ts:1"]`；两次 CLI 退出码都是 **8**（工具被拒的既有约定，`call` 模式不因契约失败返回 0，别把它读成回归） |

取数教训保留：cjpm 的 `--no-color` 挡不住把转义码插在 token 中间的形态（`error\e[0m:`），
原始日志上 `grep "error:"` 匹配 0 行看着像「没报错」——必须先 sed 剥码再数。

## 跳过项如实标注

SKIPPED 1 = 缺 `STEPFUN_API_KEY` 的真实模型用例，与上一轮同一条件，没有用跳过冒充模型通过。

## 变异反证状态

本批未做变异反证。原因：37 条用例的直接证据是「实现已写好且逐条点名 PASSED」，
而把 `lspSymbols` 回退改成 no-op、把版本比较改成不比较这类相邻错误语义各跑一轮要求指定用例变红，
需要两轮全量编译；本机当前有并发线在飞（实测 3 个 cjpm 进程），两轮会被压穿计时窗口。
因此「测试全绿」在本文件里只作为**覆盖证据**，不作为**不变量防回归证据**。
下一批（L2 前）应按 `vacuous-test-mutation-probe` 补：
`nonSemantic` 置 false 必须有失败、`lspSnapshotEmpty` 与 `lspSnapshotNone` 互换必须让两条诊断用例各红一条、
`hasRegistration` 撤掉必须让在途用例红、
`lspVerbStep` 里去掉进程工作区兜底必须让 `lspManualEntryWithoutSessionFallsBackToProcessWorkspace` 红回 `lsp-bad-args`。


## globMatchPattern 死循环已修（08:10–08:20 实测，用户裁决「1.修复 2.提交」）

**出处与授权**：`core/src/fs_tools.cj` 按 W00 属 W40/E。上一节「本批不修」是有权裁决之前的登记，
不是结论；本轮用户明文授权后由本会话实施。**只改实现，`fs_tools_test.cj` 一个字没动**。

**改法**（`globMatchPattern` 拆成四个函数）：

| 函数 | 职责 |
|---|---|
| `globMatchPattern` | 按 `/` 把 name 与 pattern 各切成段，交给分段匹配 |
| `globIsCrossSegmentSeg` | 整段全由 `*` 组成且长度 ≥ 2 才算跨段通配（`**`、`***`）；单个 `*` 仍是段内通配 |
| `globMatchSegment` | 段内匹配，外层循环按 **name** 推进，name 耗尽后剩余模式必须全是 `*` |
| `globMatchSegments` | 分段递归，跨段通配依次试探吃掉 0 到剩余全部段 |

**终止性论证**（这条才是修复的本体）：段内匹配里 `i ≥ starI` 是不变式——记 `*` 的分支令 `starI = i`，
匹配分支令 `i += 1`，回溯分支令两者同步，所以 `starI` 单调不减；回溯分支每次把它 `+1`，
而循环守卫 `i < s.size` 配上 `i = starI` 把 `starI` 钉在 `< s.size`，故回溯至多执行 `s.size` 次；
两次回溯之间只有记 `*` 与匹配两个分支，二者都让 `j` 严格 `+1`，至多 `p.size` 次。
总迭代 ≤ `(s.size + 1) × (p.size + 2)`，与输入内容无关。分段递归每层把模式段号严格 `+1`，跨段试探次数 ≤ `ns.size + 1`。
旧实现缺的正是这个上界：`starI` 从不与 `n.size` 比，越界后 `j` 永远回不到 `p.size`。

**前后对照**（一份探针包 `target/globprobe/`，两个实现编在同一个可执行文件里，`target/` 已 gitignore，产物不落库）：

| 项 | 实测 |
|---|---|
| 旧实现（参数 `old`，输入 `("test.txt", "*.md")`） | `timeout 12` → **rc=124** 且一个字都没输出——上一节记的死循环原样复现 |
| 新实现 | **rc=0**，末尾 `PROBE-DONE` 打出；9 条断言 7 条 OK、2 条 MISMATCH（逐条原因见下） |
| 探针踩到的编译器坑（实测原文） | `'main' declaration doesn't need 'func' keyword`；`undeclared identifier 'getArgs'`（`import std.env.*` 里也没有，命令行参数走 `main(args: Array<String>)` 形参） |

**全量核心套件这一轮跑完了**——这是本次修复唯一要证明的事：
命令 `cd core && cjpm test --no-color --no-progress --target-dir D:\Project\sa\saai\sa-code\target\globfix-build --timeout-each=30s`，
私有 TMP 当轮唯一。改用私有 `--target-dir` 是因为共享的 `core/target/release/unittest_bin/core.exe`（mtime 0:41）被 **PID 21344** 占着，
链接段报 `ld.lld: error: failed to write the output file: Permission denied`；
逐级归因是 PID 21344 ← 18080（`std.testrunner.exe`）← 25424（10-08 00:34:52 起的 `cjpm`），**不是本会话发起的三条进程，一条都没杀**。

| 计数 | 08:12 起那轮（日志 `globfix-v2-full-test.log`／剥码 `globfix-v2-clean.txt`／`globfix-v2.exit.txt`） |
|---|---|
| Summary | `TOTAL: 902 / PASSED: 894 / SKIPPED: 2 / ERROR: 0 / FAILED: 6`，rc=**1**，整轮 105.0 s **正常结束** |
| 算术自证 | 894 + 2 + 0 + 6 = 902 |
| 基线算术 | 上轮 901 → 902：多的那 1 条按名字集合差查出来是 `workspaceRevisionSurvivesReplayAndIgnoresNoOpDirectorySelection`（`workspace_test.cj` 有并发线未提交改动），**不是本批加的**；PASSED 882 → 894 = +10（上轮 10 条 ERROR 全清）+1（`wrongPassphraseIsRejectedWithoutPlaintextOrEcho`）+1（上面那条新用例） |
| 两条 glob 用例 | 仍在 FAILED，但 `time elapsed` 从 **30010357000 ns** 变成 **68600 ns / 13200 ns**——现在返回了，红是断言红，不是不返回 |
| 上轮那 10 条 ERROR | 9 条 `sseNetwork*` 加 `quotaFailureCarriesRetryAfterFromTheRealHeader`，在私有 TMP + 私有 target 下**全部转 PASSED**，坐实它们是取临时目录失败的环境红，不是本仓缺陷 |
| 本批 37 条 L1 用例 | 从 `lsp_contract_test.cj` 抽 `@Test` 名单与本轮 PASSED 唯一名做集合差：**未出现 0 条**；PASSED 唯一名 894 条，与 Summary 的 PASSED 计数一致 |
| 剩余 6 条红 | `globMatchPatternWildcard`、`globMatchPatternDoubleStar`（原因见下）、`browserNavigatesRealUrl`（`r.ok == true`，要出网）、`shellExecutesSimpleCommand`（`r.exitCode == 0`）、`sshExecRunsRealSshAgainstUnreachablePort`（`r.exitCode == 255`）、`sshExecRunsRealSshAgainstLiveSshd`（`r.stderr.contains("Permission denied")`）——**非 L1、非本批** |

所以「上一节说 `cjpm test` 默认 worker 跑法仍不返回」这条**在本节之后失效**：不返回的原因是套件里有永不返回的用例，
用例修好之后默认 worker 跑法（本轮就是默认跑法，没加 `--parallel=false`）能在 105 s 内自己跑完并打出 Summary。

**两条 glob 用例为什么仍然红，以及为什么没把它们改绿**（报告原文，逐条）：

- `globMatchPatternWildcard` → `Expect Failed: (globMatchPattern("test.txt", "t?.txt") == true)`。
  模式 6 个字符、名字 8 个字符；`?` 按 `fs_tools.cj` 文件头契约「匹配单个非 / 字符」只吃 1 个字符，
  无变长的固定 6 字符模式在数学上匹配不了 8 字符的名字。要让这条成立，`?` 必须变成「任意长度」——那 `?` 与 `*` 就无从区分。
- `globMatchPatternDoubleStar` → `Expect Failed: (globMatchPattern("a/b/c.txt", "*/c.txt") == true)`。
  模式 2 段、名字 3 段；`*` 按同一契约「匹配不含 / 的任意字符」不吃 `/`，段数对不上。
  标准 glob（minimatch 口径）同样判 false，跨段的写法是 `**/c.txt`，探针实测 `true`。
- 结论：这两条是**测试期望与该文件自己的文件头契约互斥**，归主责面（W40/E）裁决。
  本会话既没有为了凑绿把 `?`／`*` 的语义改弯，也没有改主责面的测试文件。
  其余 7 条断言（含 `**` 跨段的两条）全部 OK。

**生产影响面**：`globFiles` 与 `globRecursive` 传给它的第一个参数只有 `Path(baseDir).fileName` 与 `info.path.fileName`，
都不含 `/`，所以「分段」与「摊平」两种读法在现有调用点上**不可观测**；本次改动只影响 `*`／`**` 对外语义，
`lspSymbols`（签名与既有断言都不动）、`grepFiles`、`editFile` 一行未改。
哈希对照：`fs_tools.cj` 由开工基线 `38d64da8f6636c1a…` 变为 `ced605cebcfd…`，其余 L1 文件（`lsp_contract.cj`、`lsp_contract_test.cj`、
`agent.cj`、`model_agent.cj`、`model_tool_runtime.cj`、`apps/host/src/main.cj`、`apps/cli/src/main.cj`、`lsp.cj`、`lsp_test.cj`）复测全 **SAME**。

**本批未做的变异反证**：把回溯分支退化成 `else { return false }` 应让 `anything.txt` 对 `*.txt` 那条红、
把跨段门槛从长度 2 降到 1 应让单 `*` 段也能跨段——本轮都没施加，登记为待做。
已做的等价反证只有「旧实现 rc=124 ／ 新实现 rc=0」这一对，它证明的是终止性，不是全部语义。

## 跨线耦合（提交阶段必须逐 hunk 核对）

本批行 / 该文件总未提交行（`git diff -U0` 实测）：

| 文件 | 本批相关行 | 总变更行 | 并发线内容 |
|---|---|---|---|
| `core/src/agent.cj` | 42 | 132 | `update_goal` 执行器与 +60/-6 段落 |
| `core/src/model_tool_runtime.cj` | 6 | 15 | `goalUpdateToolSpec()` 注册 |
| `core/src/model_agent.cj` | 2 | 7 | `update_goal` 排除 clause |
| `core/src/model_tool_runtime_test.cj` | 1 | 3 | 工具数 10→11 |
| `apps/host/src/main.cj` | 20 | 161 | `execution/*` 声明与装配 |
| `apps/desktop/main.cjs` | 28 | 104 | execution 模板字面量注册环 |
| `apps/desktop/preload.cjs` | 7 | 20 | execution 6 通道 |
| `apps/desktop/test/bridge.test.mjs` | 42 | 247 | execution IPC 用例 |
| `apps/cli/src/main.cj` | 4 | 63 | 插件装配断言 +54 |

`core/src/workspace.cj`、`session.cj`、`approval.cj`、`lease.cj`、`goal_evidence.cj`、
`goal_runner.cj`、`shlex.cj` 的未提交行里 lsp 相关行数 = 0，**不属本批，不提交也不 revert**。

本批路径集（提交时的分母，共 15 条）：上表 9 个已跟踪文件 +
`core/src/lsp_contract.cj`、`core/src/lsp_contract_test.cj`（新增）+
`docs/plans/lsp-l1-entry-wiring-2026-10-07.md`、`docs/evidence/lsp-l1-baseline-hashes.txt`、
`docs/evidence/lsp-l1-codex-review-2026-10-08.md`、本文件。

收口时点的工作区复测（04:20，登记单 §3 那份 216 条是 10-07 23:39 的历史登记值，不替换）：

| 项 | 实测 |
|---|---|
| `git rev-parse HEAD` | `35a69ca9e0f8b7b6ac51271ec76eff3515eaa820`——与开工登记同一固定提交，期间无人提交 |
| `git diff --name-only` | 34 个已跟踪修改文件（登记时 31，增量来自并发线） |
| `git status --short --untracked-files=all` | 241 条（登记时 216） |
| `git diff --cached --name-only` | **0 条**——本批未暂存任何东西，提交通知与授权前不会落库 |
| `git status -sb` | `refactor/dsh-learning...origin/… [ahead 2]`（本地领先远端 2 个提交，与本批无关，本批一条提交都没做） |

## 验收边界

L1 仍是契约与入口接线：内存 ContractServer 夹具不代表真实 LSP 通信；不 spawn 进程、不做协议转换、
不做文档同步与 `publishDiagnostics` 缓存（归 L2）；rename 只出 `previewOnly` 预览，落盘归 F08。
没有安装包、Linux/鸿蒙或完整产品验收结论。

## 逐条结论（objective §1–§4，只认 PASS / FAIL / BLOCKED）

| objective 条目 | 判定 | 依据（本文件内） |
|---|---|---|
| §1 登记公共入口责任与未提交改动 | PASS | 登记单 `docs/plans/lsp-l1-entry-wiring-2026-10-07.md` §2/§3 + 本文件「跨线耦合」 |
| §1 保留 `lspSymbols` / `LspSymbolRegistry` 及其测试 | PASS | 三文件与开工基线哈希 SAME |
| §2 契约面 12 项（verb 词表、位置、边界、身份、版本、路由、失败、回退、快照三态、预览） | PASS | 「契约面自证」+ 37 条用例映射表 |
| §3 工具/Host/桌面/CLI 接线 12 项 | PASS | 「接线面自证」+ 宿主与桌面最终计数 + CLI 表 |
| §4 核心用例逐条点名通过 | PASS | 修复后 TOTAL 73 / PASSED 72 / SKIPPED 1 / FAILED 0 / ERROR 0，rc=0 |
| §4 Host 7 个真实请求无服务器错误 | PASS | 新宿主 4/4，全 PATH 与仅 System32 两种条件各一次 |
| §4 桌面通道、负载校验、禁止通用转发 | PASS | `bridge.test.mjs` 四条 LSP 用例 + 两侧通道名集合机械比对 |
| §4 `cjpm test` 全量（252 文件）Summary | **PASS（拿到 Summary，但不是全绿）**：当前源码态 `TOTAL 901 / PASSED 882 / SKIPPED 2 / ERROR 10 / FAILED 7`，rc=1；37 条 L1 用例全在 PASSED，与 L1 交集 0 条红 | 「当前源码态的全量 Summary 已实测」；`cjpm test` 默认 worker 跑法仍不返回，须内联 + 每条 30s 上限 |
| 全量里的 7 FAILED + 10 ERROR | 非本批 | 17 个名字里 `^lsp`／`^legacyLsp` 命中 0；其中 2 条是 `globMatchPattern` 死循环撞 30s 上限（见上节，属 W40/E，本批未修） |
| 两项门禁 FAIL | 非本批 | 「门禁归因」：分派未声明 0 条，本批 7 条两侧对称且未进任一 FAIL 集 |
| 变异反证 | 未做（已登记 4 条待做探针） | 「变异反证状态」 |

## 提交切分（08:30 实测，用户「2.提交」的执行结果与未完项）

已落库：

| 提交 | 内容 | 对账 |
|---|---|---|
| `1e75211 fix(core): globMatchPattern 回溯不设上界导致死循环` | 只有 `core/src/fs_tools.cj`，+61/-19 | `git show --name-status` 恰为 1 行 `M core/src/fs_tools.cj`；提交前 `git diff --cached --name-only` 恰等于该 1 条，且该文件 index 与工作区逐字一致（`git diff -- core/src/fs_tools.cj` 空输出） |

**钉好的 15 条路径提交集没能整批落库，依据是两条实测，不是犹豫**：

1. **两个新核心文件不能单独提交**：`lsp_contract_test.cj` 的 `lspModelToolsAreSevenNoApprovalAndClosedSchemas`
   与 `lspModelToolExecutesThroughSharedRouterAndKeepsObjectShape` 直接用
   `ModelToolRuntime(log, false, files: true, workingDirectory: root, lspRouter: router, lspSession: "s1")`
   这个**具名参数**、并依赖 `runtime.specs()` 里出现 7 条 `lsp_` 前缀工具——两者都由 `model_tool_runtime.cj`
   的本批 hunk 提供。所以「2 个新文件 + 4 份文档」这种自成一体的子集会造出一个**编不过的提交**，已排除。
2. **9 个共享文件整文件提交会吞并发线**：这 9 个文件的未提交新增行（`git diff -U0` 的 `+` 行数）合计 **756**，
   本批可归属 **152**——`agent.cj` 42、`model_tool_runtime.cj` 6、`model_agent.cj` 2、`model_tool_runtime_test.cj` 1、
   `apps/host/src/main.cj` 20、`apps/cli/src/main.cj` 4、`main.cjs` 28、`preload.cjs` 7、`bridge.test.mjs` 42。
   差出来的**约 604 行**是别的线在飞的 `update_goal` 执行器、`execution_*` 声明与装配、桌面模板字面量注册环，
   把它们一并写进 `feat(core,host): L1…` 等于替别人的提交定作者与说明。按既有口径（不吞并、也不 revert，报告裁决）停在这里。

**hunk 可分性实测**（决定「行级隔离提交」这条路的代价）：按 `git diff -U3` 数 hunk，
`agent.cj` 10 个里 4 个含本批行、`model_tool_runtime.cj` 2/2、`model_agent.cj` 1/1、`model_tool_runtime_test.cj` 1/1、
`apps/cli/src/main.cj` 3/1、`apps/desktop/main.cjs` 6/1、`apps/desktop/preload.cjs` 4/1、`bridge.test.mjs` 3/1、
`apps/host/src/main.cj` 14 个里 5 个含本批行。host 那 5 个与 `bridge.test.mjs` 那 1 个是**本批行与别家行落在同一个 hunk 内**
（关键词只能提示混排，不能定作者），要拆就得逐 hunk 人工判定，再用 `git apply --cached` 造
「HEAD + 只本批 hunk」的暂存内容，最后还得在 `git worktree add --detach` 的提交级副本里冷编一次核心套件
（本轮核心冷编 6 min + 运行 105 s）才能证明这个提交自己是绿的。
**这条路没走**：共享 index 下别的线随时可能 `git add`，中途窗口会互相打脏；等它们先落库，本批就能整批提交。

**三条待裁决路径**：A. 等并发线落库后本批整批提交（最省，上面的 152/756 就是这条的出处）；
B. 现在就做 hunk 级隔离 + 提交级冷编自证（代价约 20 min，且共享 index 有竞态窗口）；
C. 明知会吞约 604 行仍按整文件提交（不推荐：把别人的在飞改动记成 L1 的作者）。

**本节更正的历史登记**（原句保留，不改写前面的记录）：

- 「`cjpm test` 默认 worker 跑法仍不返回，须内联 + 每条 30s 上限」→ 自 `1e75211` 起，默认 worker 跑法 105 s 自己出 Summary。
- 「全量里的 7 FAILED + 10 ERROR……其中 2 条是 `globMatchPattern` 死循环撞 30s 上限（属 W40/E，本批未修）」→ 已修，现为 **6 FAILED + 0 ERROR**，两条 glob 用例改为断言红并各自给出原因（见「globMatchPattern 死循环已修」节）。
- 「本批未提交任何东西（暂存区 0 条，HEAD 仍是 `35a69ca`）」→ 本批已落 1 条提交 `1e75211`，其余 11 条路径按上面待裁决。
