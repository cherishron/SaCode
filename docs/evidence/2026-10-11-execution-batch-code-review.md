# 执行批次代码评审（未入库新文件）

- 日期：2026-10-11
- 性质：**纯只读静态代码评审**。本轮未编译、未运行任何测试，因此下文所有结论只证明「源码形状与推理」，不证明任何行为已实测。行号仅用于定位。
- 评审对象：`execution_*` / `durable_checkpoint` / `git_workbench` / `goal_runtime` / `terminal_view` / `mode_rpc` 及配套测试，全部为 `git status` 中的未跟踪文件。
- 方法：逐符号读源码 + 反证式提问（把被测行为改坏，指定断言会不会转红）。只读，未修改任何文件、未运行 `cjpm build` / `cjpm test`。
- 并发声明：评审期间另一 Agent 在跑测试并写入 `apps/desktop/.tmp-test/`、`apps/desktop/dist/`，且 11:03 修改过 `core/src/worktree_tools_test.cj`。本评审对象中的文件未被并发改动，但结论应在收口后复验。

---

## 总体判断

**不能进主干。**

设计骨架是对的——审批绑定工单号、状态机、恢复降级、缺字段宁可抛错，这几条纪律都守住了。但有 **7 处行为级缺陷**，其中 3 处会静默造假或把会话打死，**1 处证明这批测试从未在干净检出上跑过**，另有 1 处让整条执行接线成为不可达死代码。

---

## 阻断级缺陷（必须修才能提交）

### B1. 输出落库失败会把执行永久卡死，并把宿主打成拒绝服务

**位置**：`core/src/execution_supervisor.cj` → `supervise`（L72–74）

`supervise` 先 `saveOutput` 再结算退出事实。`saveOutput` 里任何一次 `captureOutput` 抛异常（`execution-output-limit` / `persistence-failed` / `execution-output-corrupt`），异常直接冒出，**`finish` / `startFailed` / `supervisionLost` 一条都不会执行**。后果链：

1. 日志停在 `running`（或 `stopping`），`tokens[id]` 仍留在内存；
2. `ExecutionRun.wait()` 抛异常 → `apps/host/src/main.cj:2791` 置 `executionSettled = false`；
3. `main.cj:2796-2802` 之后所有非白名单方法一律 `execution-in-flight-or-unsettled`，**宿主长期拒绝服务直到重启**；
4. 即便用户还能走白名单里的 `execution/stop`，也只能推到 `stopping`——唯一能到 `exited` 的 `finish` 要求两路输出都已收束，而 `saveOutput` 已半途死掉，永远收不齐。

**测试覆盖：零。** 没有任何用例让 `saveOutput` 失败。

### B2. 一次 execution 落库能把整个会话永久冻结

**位置**：`core/src/durable_checkpoint.cj:9` + `core/src/session.cj:217`

`SessionLog.durableCheckpoint` 把「上次落盘之后的**全部**待写字节」一次性交给 `appendDurablePrefix`，而后者开头是 `if (pending.size > 4096 ...) { return false }`。返回 false → `session.cj:222` 置 `durableFrozen = true` → **整个 SessionLog 从此不能 flush，不只是 execution**。

`ExecutionService` 的默认 checkpoint 就是 `log.durableCheckpoint(lease)`（`execution_service.cj:36`）。也就是说：只要在任何一次 execution 状态落库之前，别的子系统（stream chunk、tool result、扩展帧）累积了 >4 KiB 未 checkpoint 的事件，**整个宿主会话就永久 `session-durable-frozen`**（`main.cj:2812`）。

这是 execution 与共享会话日志之间一条**未声明、未测试**的耦合。`GoalCheckpoint` 用的 `durableCheckpointBatched` 有 4096 分块循环，`durableCheckpoint` 没有——**两条路径对同一个 4096 上限的行为完全不同**。

**测试覆盖：零。** `pending.size > 4096` 这条分支从未被触及。

### B3. 每 512 字节输出块全量重扫日志 + 全文件哈希 + 拉起 PowerShell，全程持全局 `log.mtx`

**位置**：`core/src/execution_service.cj` → `captureOutput`（L264, L273）+ `core/src/execution_output.cj` → `records`（L18）

一次 `captureOutput` 的实际成本：

1. `ExecutionOutput.records(id)` → `log.snapshotEvents()` 解析**整份会话日志**（含每条 output 行的 JSON 解析 + base64 解码）；
2. `checkpoint()` → `durableCheckpoint` → `File.readFrom(path)` 读**整个日志文件** + `sha256Hex(prefix)` 全文件哈希；
3. `ShellExecutor.runShellCommand` 拉起一个 **`powershell.exe` 进程**（`timeoutMs: 10000`）。

`propose` 允许 `outputLimit` 到 65536 ⇒ 单次执行最多 128 块/通道 × 2 通道 = 256 块 ⇒ 全局会话锁被连续持有数百次，**单次最坏 10 秒**。

这直接违反「取消/背压」硬要求：任何走 `log.mtx` 的路径（turn 落帧、`session/append`、`service.stop()`）都会被拖住。

**现有测试证伪不了它**——`execution_supervisor_test.cj:8` 的 `supervisorProposal` 把 `outputLimit` 写死成 **64**，即每通道只有 1 块数据 + 1 块 `endOfCapture`，**恰好绕开这个量级**。

### B4. `finish()` 把 `exitObserved` 硬编码成 `true`

**位置**：`core/src/execution_service.cj:322`

`ShellResult` 有真实的 `exitObserved` 字段，`execution_supervisor.cj:75` 也确实检查了它，但 `finish()` **不接受这个事实**，落库时无条件 `facts.put("exitObserved", JsonBool(true))`。

任何非 supervisor 调用方（或将来 supervisor 的检查被改动）都能让唯一真源断言「观察到进程退出」而实际没有。**这正是红线里「不得把估算标为实测」。**

**测试证伪力：零。** 四条 supervisor 用例断言的都是 `ShellResult.exitObserved`，**没有一条断言落库 `result` 里的 `exitObserved`**。把这个字段改成 `false` 或删掉，全部用例照样绿。

### B5. `finish()` 在「零条输出记录」时整段跳过输出结算

**位置**：`core/src/execution_service.cj:303`

`if (output.size > 0) { ... }` 意味着：`outputComplete: true` + 一条 output 记录都没有 ⇒ 直接跳到 `facts.put("exitObserved", ...)`，按 `exitCode == 0 && !timedOut && !cancelObserved && outputComplete && phase != "stopping"` 得出成功形状，且 result 里**连 `stdoutBytes` / `stderrBytes` / `stdoutTruncated` / `stderrTruncated` 字段都不存在**（是缺失，不是 0）。

这是「不得把缺失数据填零」的另一种形态：**把「没有证据」当成「证据表明没问题」。**

**测试证伪力：零。** `execution_service_test.cj:131` 与 `:34` 恰好都先 `stop`（phase = `stopping`），所以 `processSucceeded` 侥幸为 false。**把 `processSucceeded` 公式里的 `state.phase != "stopping"` 删掉，这两条用例仍然全绿。**

### B6. 四个新测试文件里 12/19 条用例在干净检出上必然失败

所有路径硬编码为 `D:/Project/sa/saai/sa-code/apps/desktop/.tmp-test/host-restore-20261009/...`，而该目录在 `.gitignore:130`（`apps/desktop/.tmp-test/`）之下。

涉及：`execution_api_test.cj:8`（1 条）、`execution_supervisor_test.cj:13/25/44/58/86`（5 条）、`execution_output_test.cj:11/50/74/92`（4 条）、`execution_service_test.cj:18/41`（2 条）。

它们只做 `removeIfExists(path)`，**没有 `Directory.create`**。`WriteLease.acquire()` → `File.createTemp(Path(dir))`（`lease.cj:118`）在目录不存在时抛异常 → 返回 `false` → `@Expect(lease.acquire(), true)` 直接红。

仓内其它 core 测试的既有做法是 `Directory.createTemp(".../core/target/...")`（见 `team_runner_test.cj:36`、`team_workspace_test.cj:10`）。另外，把 core 的测试产物落在 `apps/desktop/` 下本身就是跨模块边界违规。

**这条的含义超出测试本身**：它证明**这批测试从未在干净检出上跑通过**，只在本机目录残留的脏状态下绿过。与 [三份方案实施前源码审计](../plans/sacode-2026-10-11-preflight-source-audit.md) §5 记录的 `after-pack.cjs` 是同一类问题——工作区悬空掩盖了交付缺陷。

### B7. `providerAvailable` 是硬编码常量，导致整条执行接线成为不可达死代码

**位置**：`core/src/execution_api.cj:23`

`result.put("providerAvailable", JsonBool(false))` 写死。它是以下两处的**唯一开关**：

- `apps/cli/src/main.cj:284` 的重新审批分支；
- `apps/host/src/main.cj:1051-1052` 的异步执行路径（`onStarted` → `executionRuns.add`）。

而 `execution_api.cj:78` 构造 `ExecutionSupervisor(service)` 时**从不传 `providerReady`**，默认恒 false。于是：

- `execution/start` 永远抛 `execution-provider-unverified`；
- `main.cj:803` 的 `executionRuns` 永远为空；
- `main.cj:2787-2802` 的 in-flight 闸门、`2901-2905` 的退出结算、`2955-2962` 的 `executionSettled` 分支，**全部不可达**；
- `apps/cli/src/main.cj:284-297` 整段不可达。

「门禁关闭」这个决定本身是合理的（注释也说明了原因）；不合理的是**把这个决定编码成一个对外投影的事实字段，并留下一整套永不可达的接线**。应当二选一：要么该字段由真实能力探针导出，要么把死接线删掉，只保留 `handles()` 里的 `execution/start` 与明确的 `provider-unverified` 错误。

**修 B7 时会立刻暴露一个契约冲突**：`apps/cli/src/main.cj:260` 对每个非只读子命令都调 `service.recover()`，会把 `admitted` 降回 `awaiting-approval`（修订 +1），于是 CLI 跨进程的 propose→authorize→start 流程在 `main.cj:299` 的 dispatch 处必然 `revision-conflict`。CLI 里那段重新审批代码正是为绕开这一点写的，但它被 `providerAvailable` 挡住了。**这是 `recover()` 语义与 CLI 两段式流程之间的真实冲突**，应与 B7 一并设计。

---

## 应修问题

| 编号 | 位置 | 问题 |
| --- | --- | --- |
| S1 | `execution_service.cj:322-326` | `finish()` 的 `timedOut` / `cancelObserved` / `outputComplete` 三布尔全由调用方自报，无交叉校验。签名与注释须写死「只接受自己监督的进程的结算」，否则下一个调用方就会拿到 `processSucceeded: true` |
| S2 | `execution_service.cj:162-176` | 审批票在任何后续校验**之前**就被消费。修订过期、工作区切换、非法迁移都会烧掉人已给出的一次批准。`execution_api_test.cj:27` 的 `@ExpectThrows` 命中的是「票已 used」，不是它想测的修订冲突 |
| S3 | `execution_supervisor.cj:77-82` | 修订冲突重试分支零覆盖。改成「直接吞掉冲突再调一次 `describe`」或「吞掉冲突当成功」都不会红 |
| S4 | `execution_supervisor.cj:75 / :87` | 两个 `supervisionLost` 分支零覆盖。`ExecutionService.supervisionLost`（`execution_service.cj:245`）无任何直接测试 |
| S5 | `execution_output.cj:44` | 六条损坏判据中五条零覆盖（未测：`count != data.size`、`retained + count > limit`、`end && count != 0`、`!end && (count == 0 \|\| eof \|\| truncated)`、`sessionId` 不匹配、`version != 1`）。**反证**：把 `retained + count > limit` 整条删掉，`executionOutputReplayRejectsNonContiguousSequence` 仍绿 |
| S6 | `execution_service.cj:318` | `(outputComplete && (!stdoutEof \|\| !stderrEof))` 无法被证伪。`execution_output_test.cj:106` 造出了「stderr 已 `endOfCapture` 但 `eof=false`」的记录，却用 `outputComplete: false` 结算（`:117`）。**删掉这个子句，全部用例仍绿** |
| S7 | `execution_service.cj:21` / `execution_api.cj:73` | `digest` 不是独立凭据，是 `sha256Hex(proposal)` 的纯函数重算，日志里不存摘要。真正的绑定在 `approvalArguments` 内联了 proposal 原文。**更严重的测试盲区**：若有人把 `approvalArguments` 改成只返回 `${sessionId}:${state.id}`，`execution_api_test.cj:19` 依然绿——它用返回的字符串建票，`authorize` 又用同一函数重算，两边一起退化。**「审批是否仍绑定到提案内容」这条红线目前没有任何测试守着** |
| S8 | `terminal_view.cj:24-25` | `String.fromUtf8` 抛异常无兜底。循环只回退「续接字节」；若截断点落在多字节序列的**首字节**上，`fromUtf8` 抛异常 → `main.cj:1281` 的 `catch (_: Exception)` 把它翻译成 **`bad-terminal-arguments`**——数据损坏被报成参数错误。同仓 `git_workbench.cj:26-27` 对同一件事有兜底 |
| S9 | `git_workbench.cj:55` | 超时后 `p.wait()` 无超时参数，可无限阻塞。同仓 `ShellExecutor.run`（`shlex.cj:182`）用的是 `p.wait(timeout: 3000ms)` + catch。一旦 `terminate(force: true)` 没能让进程退出，调用线程永久挂住——而 `workspace/git-status` / `git-diff` 是在宿主 RPC 线程里同步调的 |
| S10 | `git_workbench.cj:26-27` | UTF-8 解码失败返回 `("", limited=true)`，`exitCode` 仍 0、`failure` 仍空串。`main.cj:2166` 只能靠 `truncated` 区分「没有输出」和「输出是乱码」。应给 `failure` 一个明确的 `git-output-undecodable` |
| S11 | `durable_checkpoint.cj:13-15` | 持久屏障的 helper 路径来自 `getVariable("SystemRoot")`。文件注释声称「固定程序只处理核心给出的路径和字节」，但**路径本身不是固定的**——改写环境变量就能让「持久屏障」去执行另一个可执行文件。应改用系统 API 取路径或硬编码后校验 |
| S12 | `durable_checkpoint.cj:31-33` | 非 Windows 平台无条件 `return false`。配合 `session.cj:201/222` 的 `durableFrozen = true`，**任何非 Windows 构建上一调用就把会话永久冻结，且没有任何日志或诊断说明原因**。至少要抛明确的「平台不支持持久屏障」，或在 `cjpm.toml` 层面把包限定到 Windows target |
| S13 | `mode_rpc.cj:6-12` | 模式变更写的是一条永远不会落盘的记录。`handleRpc28`（`main.cj:1466-1473`）**不获取写租约**（对比同文件 15 处都做了 `leaseHeld = true`），而 `main.cj:2961` 的退出落盘是 `if (leaseHeld)`。若本次宿主运行全程没拿到租约（例如用户只切了审批模式），`mode/mode` 事件只停在内存里，**审批模式静默回退**。这正是把 `append` 当成持久。另：不校验 params 形状（无 `obj.size()` 检查），与同批 `execution_api.cj` 的严格口径不一致 |
| S14 | `execution_service.cj:87` | `writer()` 只验证 token 非空且等于 `currentOwner()`，**没验证这把租约保护的是本会话的日志路径**。`WriteLease.protects`（`lease.cj:35`）有 `leasePath == "${sessionPath}.lease"` 这一项，这里漏掉了 |
| S15 | `execution_service.cj:117-124` | 重复实现了 `SessionWorkspace.revision()`（`workspace.cj:19-25` 已有逐字同款）。两份必须同步改的口径 |
| S16 | `execution_service.cj:193 / 206-207` vs `beginStart` | token 取消行为不一致：`started()` 在 `tokens.contains(id)` 时 `token.cancel()` 再抛；`beginStart` 在 `expected()` 抛时**不取消**传入的 token。目前无害（token 是调用方局部变量），但 `ExecutionSupervisor.start:43` 已经把它交出去了 |

---

## 建议问题 / 风格

- `execution_service.cj:133-144` — 6 个校验条件挤在一个 `if` 里，失败统一报 `bad-arguments`，与 `execution_api.cj` 的 `shape` / `revision` / `approval` 分层口径不一致，调用方无法区分「提案字段非法」和「参数非法」。
- `execution_service.cj:154` + `listLocked:60` — 执行 id 派生绑在「全日志事件总数」上（`execution-${snapshotEvents().size + 1}`），回放侧又用 `execution-${event.seq + 1}` 复算同一公式。两处必须字面同步；**任何在 propose 与 replay 之间的日志增长都会让 id 对不上**。建议改成独立的执行序号事件。
- `execution_api.cj:30` — `JsonValue.fromStr(params)` 在 `try` 之外，畸形 params 会漏出 stdx 的原始异常文本，而不是稳定的 `bad-execution-arguments`。
- `execution_api.cj:67` — `catch (_: Exception)` 丢掉全部原因只留一个码。`stateJson` 对 `phase == "unknown"` 与 `"exited"` 的 result 语义也没有区分。
- `execution_supervisor.cj:34` — `if (offset + 512 < bytes.size)`：剩余正好 512 时走 else 取 `bytes.size`，结果正确但读起来像 off-by-one。建议写成 `min(offset + 512, bytes.size)`。
- `execution_output.cj:51` — `page()` 是 public 且自身不持 `log.mtx`（靠 `ExecutionService.output` 外面包一层），可被直接调用绕过调用方的锁约定。
- `execution_output_test.cj:194` — `SessionLog("unused-execution-version.log")` 路径落在测试 cwd（**仓库根**），违反 AGENTS.md 的产物落位规则，也容易被后来人一个 `flush` 变成真文件。
- `mode_rpc.cj:11/16` — JSON 全靠字符串插值，与同批其它文件的 `JsonObject` 口径不同。当前安全（`ModeController` 返回值域封闭），但 `current()` 回放脏数据时会拼出非法 JSON。
- `goal_runtime.cj:8-12` — `checkpoint()` 在失败时再调一次 `log.freezeAfterDurableFailure()`，而 `durableCheckpointBatched` 内部（`session.cj:201`）已做同一件事。冗余不是 bug，但会让人误以为 batched 版本不冻结。
- `goal_runtime.cj:19` — `GoalUsageMeter` 的 `budget` 无下界校验，传 0 或负数会让 `over()` 立刻为真。目前两个调用点都写死 200000，但 API 是 public。
- `execution_supervisor.cj:22-23` — 注释说「默认门禁关闭；探针不能升级产品能力」，但 `SandboxRuntime.backendAvailable` 默认 `true`、`confine()` 原样返回 argv。**`providerReady: { => true }` 一旦打开，执行的就是完全无隔离的用户命令。** 门禁是代码布尔而非能力探针，与 PRD「修改隔离」一条不符。

---

## 测试证伪力评估

### `execution_api_test.cj`（1 条）— **部分能证伪**

| 断言 | 改坏什么会红 |
| --- | --- |
| L18 幂等 propose | 幂等失效 |
| L27 二次 authorize 抛 | `consumeExactForCall` 不烧票 |
| L30-31 start 抛且 phase 仍 `admitted` | 门禁打开 / 失败仍吞许可（**强**） |
| L32 stop → `cancelled-before-start` | 停止前置状态错 |
| L34 session 不匹配抛 | 会话绑定失效 |
| L36 多余字段抛 | 严格形状校验失效 |

**证伪不了**：proposalDigest 不匹配（`approval-mismatch`）、`approvalId < 1`、`revision < 1`、`execution/output` 的形状与游标、`authorize` 里的 `checkWorkspace`。**最关键**：如 S7 所述，「审批仍绑定提案内容」无任何守卫。

### `execution_service_test.cj`（9 条）— **整体能证伪，质量最高的一组**

- `executionSupervisedStartStopKeepsCancellationAndRejectsRecovery` — 停止优先于退出事实、`recovery-while-live`、`stopping` 幂等、`processSucceeded=false`。**强**。
- `executionSupervisedStartFailureNeverInventsExit` — L52 `@Expect(!failed.result.contains("exitCode"), true)` 是**直接反证「启动失败不造退出码」**。**强**。（但 L54 `beginStart` 抛是因为 `permits` 已空，不是 `starts` 已清。）
- `executionDurableCheckpointPreservesPrefixAndRejectsWrongLease` — **唯一真正跑 `appendDurablePrefix` 全链（PowerShell + FlushFileBuffers）的用例**，覆盖前缀保持、重新加载、错误租约。**强**。（含刻意构造的引号/中文路径，覆盖了脚本里的单引号转义。）
- `executionAdmissionIsIdempotentAndNotReplayedAfterRestart` — **全批最有价值的一条**：真实默认 checkpoint + 重启 + 恢复降级 + 二次 recover 为 0 + 跨 session 拒绝。**强**。
- `executionStopUsesRevisionAndDoesNotCancelOtherTask` — 修订 CAS + **不误伤别的执行**。**强**。但如 B5 所述，恰好绕开了零输出的成功形状。
- `executionCheckpointFailureAndBadTailNeverAdmit` — 持久失败冻结读面、`flushedCount` 不推进、坏尾帧被拒。**强**。
- `executionRejectsLegacyApprovalAndConcurrentDuplicateStart` — 旧式无绑定工单被拒 + **真并发**双 `beginStart` 只有一个成功。**强**。**全批唯一一条真并发竞态用例**。
- `executionReplayRejectsChangedProposalAndUnknownVersion` — **中**：`obj.put("proposal", "{}")` 同时也改不了 `taskId`，真正命中的是 `proposal != previous.proposal`；只覆盖一条判据。
- `executionWorkspaceSwitchAfterApprovalRejectsStart` — 审批后切工作区 → 启动被拒。**强**。

**证伪不了**：`recover()` 里 `permits[state.id] = false` 的清理效果、`authorize` 里的 `checkWorkspace`、`writer()` 的租约绑定。

### `execution_supervisor_test.cj`（5 条）— **强，但量级被写死绕开**

五条都用了真实进程/真实超时/真实取消，设计得很好。**但 `outputLimit: 64` 让它只跑 1 块数据，恰好绕开 B3 的性能与背压问题。**

**证伪不了**：修订冲突重试（S3）、两个 `supervisionLost` 分支（S4）、`saveOutput` 失败（B1）、B4 的落库 `exitObserved`、B3 的多块输出放大。

### `execution_output_test.cj`（4 条）— **中，两条只是跑通**

- `executionOutputRealProcessPersistsAndPagesAfterReload` — 真实进程 →落盘 → 重启 → 逐条分页 → 字节级拼回。**分页游标语义是真被验的**。**中强**。
- `executionOutputRejectsCorruptionAndFreezesOnPersistenceFailure` — 未收束时 finish 被拒、关闭后迟到写入被拒、非法通道被拒、持久失败冻结并取消 token。**中强**。
- `executionOutputReplayRejectsNonContiguousSequence` — **只覆盖 `records()` 七条判据里的一条**。改坏其余六条全部照绿。
- `executionOutputBytePagesPreserveUnicodeAndIncompleteCapture` — 300 个汉字跨 512 字节边界的字节完整性（**L115 是真反证**）、512 上限被拒、`eof=false` 的通道、`outputComplete=false` 时不报成功。**强**。但 S6 所述的子句仍无法证伪。

### 零覆盖的生产可达入口

`terminal_view.cj`、`git_workbench.cj`、`goal_runtime.cj`、`mode_rpc.cj` — **完全无测试**。而这四个都是生产可达入口：`session/terminal-output`、`workspace/git-status`、`workspace/git-diff`、`approval/set-mode`。

`durable_checkpoint.cj` 靠 `execution_service_test.cj:65-77` 和 `:151` 间接覆盖了 Windows 路径（前缀保持、错误租约、坏尾帧），但 `pending.size > 4096` 这条分支（B2 的根因）**从未被触及**。

---

## 孤儿与集成

### `core/cjpm.toml` / `apps/host/cjpm.toml`：**不需要改**

两个文件都**没有 `src-dir` / 显式 source 列表**，cjpm 默认编译 `<pkg>/src/**/*.cj`。本次 diff 只改了 stdx 的 `path-option`（从硬编码 `C:/Users/jingg/stdx-work/...` 改成 `../../.deps/stdx/...`）。**8 个 core 新文件会自动进入编译。**

### 引用关系（逐条核实，无孤儿文件）

| 新文件 | 被引用处 |
| --- | --- |
| `execution_api.cj` → `ExecutionApi` | `apps/host/src/main.cj:1024,1038,1051`；`apps/cli/src/main.cj:236,245,260,279,283,295,299` |
| `execution_supervisor.cj` | 仅 `execution_api.cj:78,84` |
| `execution_service.cj` → `ExecutionService` | `apps/host/src/main.cj:1036,1047`；`apps/cli/src/main.cj:250` |
| `execution_output.cj` | 仅 `execution_service.cj:257,273,302` |
| `durable_checkpoint.cj` → `appendDurablePrefix` | `core/src/session.cj:190,195,217` |
| `goal_runtime.cj` | `apps/host/src/goal_runtime.cj:13-14`；`apps/cli/src/goal_runtime.cj:48,89`；`apps/host/src/main.cj:2014,2962` |
| `git_workbench.cj` → `queryWorkspaceGit` | `apps/host/src/main.cj:2164` |
| `terminal_view.cj` → `terminalOutputJson` | `apps/host/src/main.cj:1279` |
| `mode_rpc.cj` | `apps/host/src/main.cj:1468,1477` |

也确认了 `handleApprovalSetMode` / `handleApprovalGetMode` 与 `main.cj` 中不存在同名重复定义，不会编译冲突。

### 不可达（比孤儿更隐蔽）

- `ExecutionSupervisor` 的生产接线：`main.cj:1052` 的 `onStarted`、`:803` 的 `executionRuns`、`:2787-2802` 的 in-flight 闸门、`:2901-2905` 的退出结算、`:2955-2962` 的 `executionSettled` 分支 — 因 B7 全部不可达。
- `apps/cli/src/main.cj:284-297` 的重新审批分支 — 同样不可达。

---

## 本轮未能确认

1. **`@When` 标注在自由函数上**（`durable_checkpoint.cj:7,30`）能否被 cjc 1.1.3 接受。仓内现有先例只有 `@When` 标在顶层 `let` 上（`shlex.cj:8-11`）。未编译，无法验证。
2. **`Mutex` 重入性**。仓内 `goal.cj:94` 已有同线程嵌套 `synchronized(log.mtx)`，且 `goal_control_test.cj:12` 是已入库用例。据 Cangjie Std 文档 `Mutex` 为「可重入互斥锁」、`ReentrantMutex` 已废弃，故本批代码大量嵌套 `synchronized(log.mtx)` 不会自锁。**但这是间接证据，未实机验证。**
3. `apps/desktop/execution-ipc.cjs`、`apps/host/test/dispatch-size.test.mjs`、`apps/cli/test/dispatch-size.test.mjs` 是同批新增的未跟踪文件，不在本次评审范围，**未审**。

---

## 建议的收口顺序（不删范围，只定先后）

按「修了会让别的修复失去意义」排序：

1. **B6**（测试路径）— 一切验证的前提。不修它，任何修复都无法在干净检出上证明。
2. **B7 + CLI 契约冲突** — 决定这批代码到底是不是要接线；不先定这个，后面 B1/B4 的修法都可能白做。
3. **B4 / B5**（落库事实）— 直接违反红线，且修复面很小（`finish()` 签名 + 一条断言）。
4. **B1**（异常路径）— 需要设计「落库失败如何结算」，建议 `saveOutput` 包 try/finally 保证三路结算之一必达。
5. **B2**（4096 耦合）— 需要决定 `durableCheckpoint` 是否补分块循环，与 `durableCheckpointBatched` 对齐。
6. **B3**（背压）— 最重的一条，涉及增量读取替换全量重扫。
7. **S1–S16** — 可批量处理。
