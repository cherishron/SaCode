# 2026-10-24 P0 跨端打通前闸门（未提交工作区、Windows）

> 范围：闭合 Web 工作台方案（`docs/clients/web/2026-10-23-web-workbench-architecture.md`）开工前必须先修的 P0-1/P0-2/P0-3 三项阻断。本文件只登记代码与测试证据，不升级任何 F 域状态，不构成提交/安装/发布授权。HEAD `a0b16c38`，全部改动未提交。

## 1. P0-1 scope 闭集授予

**问题**：远程设备 scope 只有 `revoke-device`（整台设备及全部 scope 立即失效），没有按 scope 授予的入口；`list-devices` 不展示已授 scope。Web/移动端要按能力分面授权，缺这一步无法收口。

**改动**：
- `core/src/remote_identity.cj`：`grantScope` 只接受 `execute`/`approval`/`management`（`read`/`write` 由授权层默认放行）；core 二次校验同一闭集。
- `apps/daemon/src/daemon.cj`：新增 `--manage grant-scope <snapshot> <deviceId> <scope>`；非法 scope 返回 64（EX_USAGE），未知设备返回 78，已撤销设备拒绝授予（78）；`list-devices` 第五列输出已授 scope（固定顺序 `management,execute,approval`，空为 `-`）。新增 `grantableScope`、`scopesCell`。
- `apps/daemon/src/remote_identity_scope_test.cj`：新增 `root`、`read` 非法 scope 负例。

**验收（daemon 级，31/31 全绿）**：
- `test/remote-auth.test.mjs`：五列断言、非法 scope(64)、未知设备(78)、授予成功、scopes 稳定顺序、已撤销设备拒绝授予(78)。
- `test/remote-management-rpc.test.mjs`：`runManage` 通用调用 +「运行中 daemon 吸收 management 授予」正例。修一处测试缺陷：`auth/revoke` 是 durable 方法，调用须带 `operationId`（幂等账键），原测试未带 → 补 `operationId: 'mg-revoke-B'`。
- `test/remote-idempotency.test.mjs`：3 条用例补 `session/select`（P0-3 要求远程提交前显式选中目标会话），事件计数基数从 1 改为 2（create 写 `session/title` 1 条 + submit 1 条）。

运行命令：
```
$env:SACODE_DAEMON=.../main.exe; $env:SACODE_HOST_EXE=.../sacode-host.exe
node --test test/remote-auth.test.mjs test/remote-management-rpc.test.mjs test/remote-idempotency.test.mjs
# tests 31 / pass 31 / fail 0 / cancelled 0
```

## 2. P0-2 turn/poll 游标重放

**问题**：旧 `turn/poll` 是「一次取空全部」的消费语义，多客户端同轮读会互相偷帧；Web/移动端多端订阅同一轮时帧丢失。

**改动**：
- `core/src/cancel.cj`：新增 `TurnFramePage`（`frames`、`nextCursor`、`gap`）与 `TurnFrameJournal`（按游标重放、`page` 不消费、`take` 兼容旧消费、`settle` 只认第一次、`beginTurn` 留上一轮终态一代、cap 4096 满时淘汰最旧计 `gap`/`dropped`、`previousSettlement`/`previousSettlementEnd`/`endCursor`）。
- `core/src/cancel_test.cj`：新增 `turnFrameJournalKeepsFramesForMultipleCursors`、`turnFrameJournalReportsGapAndKeepsPreviousSettlement`。
- `apps/host/src/main.cj`：`turnSink` 改为 `TurnFrameJournal(4096)`；三处起轮 `beginTurn`；`turn/poll` 双路径（带 `cursor`/`turnId` 走 `page`，不带走旧 `take`）；应答新增 `nextCursor`/`turnId`/可选 `gap`/可选 `reset`；自动续轮时交付已读旧轮帧 + 旧轮终态并 `reset`；`session/select` 重建 journal。
- `apps/desktop/main.cjs`：新增 `turnPollCursor`/`turnPollTurnId`；`turnStart`/`taskStart`/`sessionSelect` 重置；`turnPoll` 传游标并吸收 `nextCursor`/`turnId`/`gap`/`reset`。渲染层接口不变。
- `apps/desktop/test-support/model-approval-host-verify.mjs`：VM context 补 `turnPollCursor:0,turnPollTurnId:null`。

**验收**：
- Host 单成员 `cjpm build` rc=0（apps/host，33 warning 0 error）。
- 桌面 `test/bridge.test.mjs` 新增「turn/poll 游标支持多客户端同轮重复读，取消后两端拿到同一终态」用例 **1/1 通过**：两客户端从同一游标出发看到逐字相同的帧；重复读不消费；取消后两端拿到同一取消终态（`settled/cancelled/text/dropped=0` 一致）。
- `node --check` 通过 `apps/desktop/main.cjs` 与全部改动测试文件。

**`turn/poll` 响应字段**（带游标路径）：`frames:[string]`、`turn`、`running`、`settled`、`questionId`、`turnId`、`nextCursor`、可选 `gap`/`reset`；结算时附 `cancelled/delivered/text/finishReason/usage` 等。桌面 `turn-poll-state.js` 依赖 `frames` 字符串前缀（`text:`、`projection:*`、`tool-call-delta:`），未改格式。

## 3. P0-3 精确会话投影与错配拒绝

**问题**：`session/projection` 不带 `sessionId` 时返回活动会话投影，远程客户端无法确认拿到的是不是自己请求的那一份；活动会话类方法带指向别会的 `sessionId` 仍会静默落到当前会话（审计 S11 根因）。Host 仍是单活动会话模型，不做每设备会话白名单。

**改动（`apps/host/src/main.cj`）**：
- 新增 `bindsActiveSession(method)`：覆盖 `session/submit`/`session/append`/`turn/start`/`task/start`/`turn/poll`/`turn/cancel`/`approval/ask`/`approval/answer`。
- 主循环在所有处理器之前：`explicitSession = jsonStr(body,"sessionId")`；非空且 ≠ `activeId` 且 `bindsActiveSession(method)` → `emit(errFrame(idText,-32001,"session-mismatch"))`，不产生副作用。不带 `sessionId` 保留本机旧语义。
- `session/projection`：按 `sessionId` 精确读目标会话日志（`catalog.pathFor` 失败或 `SessionLog.load` 失败 → `-32602 unknown-session`/`-32002 replay-rejected`，不再拿活动会话顶替）；应答新增 `sessionId` 字段标明实际读取的那一份；`questionId`/`planId` 仅对活动会话投影（非活动会话返回空串）。
- `handleRpc16` 签名补 `body` 参数以读取 `sessionId`。

**验收（桌面级，3/3 全绿）**：
- 新增 `apps/desktop/test/session-identity.test.mjs`：
  1. `session/projection` 按 sessionId 精确读取：不串会话、未知会话 `-32602`、应答带 `sessionId`、非活动会话不得带出活动会话正文。
  2. 活动会话类方法带错配 sessionId 一律 `-32001 session-mismatch` 拒绝，且不产生副作用（事件计数不变、不起轮）；sessionId 与当前一致时正常执行。
  3. 切会话后写入口跟随新会话，旧会话投影保持独立（切换只追加 `workspace/session-selected` 标记，正文不串）。
- `node --test test/session-identity.test.mjs` → tests 3 / pass 3 / fail 0。

## 4. 构建与二进制核验

- Host 单成员构建：`cd apps/host && cjpm build` → `cjpm build success`（33 warning 0 error）。产物 `apps/host/target/release/bin/main.exe` 16,058,880 B / 2026-10-23 20:00:56。
- daemon 单成员构建：`cd apps/daemon && cjpm build` → `cjpm build success`（8 warning 0 error）。
- `scripts/pack-host.mjs` 重打 92 文件到 `apps/desktop/dist/host/bin`（含 runtime/stdx/libwinpthread/OpenSSL/zoneinfo）。
- 二进制标记核验：`sacode-host.exe` 含 `session-mismatch`/`nextCursor`/`turnId`/`TurnFrameJournal`/`previousSettlement` 五个字符串 → P0-2/P0-3 改动确已编入。
- `node --check` 通过 `apps/desktop/main.cjs` 及全部改动 `.mjs` 测试文件（0 失败）。

## 5. 未验证与阻断项（如实登记）

### 5.1 core `cjpm test` 编译阶段失败（预先存在的 HEAD 缺陷，非 P0 所致）

`cd core && cjpm test` 在测试包编译阶段失败，8 个 `error`：
- 5 个来自 `tool_subagent_test.cj:19` 与 `subagent_delegate_test.cj:29` 同名 `@Test delegateToolRegistrationApprovalResultAndCancellation`（redefinition / overload conflicts / ambiguous match）。
- 1 个来自 `ssh_exec_test.cj:79` 数组字面量类型推断失败。

两份冲突文件均为 **HEAD 已提交、工作区未改**（`git cat-file -e HEAD:...` 返回 0，`git status` 干净），属预先存在的 HEAD 缺陷，PRD-tracking line 12（2026-10-22 Qoder 沙箱修复条目）已登记「HEAD（83837c1）core 套件被 9c85fed 同时入库的两个同名 `@Test` 挡住无法编译（19 errors）」。

**P0 文件零 error**：`cancel.cj`/`cancel_test.cj`/`remote_identity.cj` 不在错误清单中。core 库本身编译成功（Host 构建链接 core 成功即证明）。`TurnFrameJournal` 已编入宿主二进制并被 `turn/poll` 实际执行（桌面游标用例通过即运行时证据）。`cancel_test.cj` 的两条单测因整个测试包无法编译而未执行，不宣称已运行。

日志：`target/tmp/core-test-20261024.log`。

### 5.2 extension/host/spawn 失败（预先存在，非 P0 或并发会话所致）

`apps/desktop/test/bridge.test.mjs` 全量 82 条用例中，10 条 `extension/host/*` 失败（`js-host-handshake-timeout: received=0`）+ 文件级 120s timeout。

**归属判定（关键证据）**：旧宿主二进制 `C:\Users\jingg\AppData\Local\Temp\3L0sWM5lcGaoRsTxoW7MvxoeAdM\resources\host\bin\sacode-host.exe`（构建于 2026-10-22 01:05:48，早于今天全部 P0 与并发会话改动）在同样条件下**同样失败**：`extension/host/spawn` → `js-host-handshake-timeout: received=0`。

**进一步探针**：用最小 `server.cjs`（只回 initialize）经宿主 spawn，同样超时；进程树快照（300ms/800ms/1500ms/2000ms）显示**宿主 PID 下从未出现任何子进程**。直接 `node spawn(node, ['server.cjs'], {cwd})` 正常返回 initialize 应答。结论：Cangjie `launch`（std.process）以正斜杠全路径 node + `["server.cjs"]` + workingDirectory 在当前机器上未能真正拉起子进程（或子进程秒退且 WMI 未捕获），属预先存在的工具链/环境问题。深度根因留作后续单独排查（blocked on toolchain），不在 P0 范围内。

桌面 P0 相关用例（`session-identity` 3/3、游标用例 1/1）均通过，不依赖 extension/host。

### 5.3 remote-product 5 条 SSE 用例（环境阻断）

`test/remote-product.test.mjs` 第 33–37 条因 `spawn openssl ENOENT` 失败：本机 PATH 无 `openssl` 二进制（`where.exe openssl` → could not find files）。这些用例用 openssl 生成自签名证书测 SSE。属环境阻断，与 P0 改动无关，记为「未验证」。

### 5.4 其他未覆盖

- 完整桌面 `bridge.test.mjs` 因 10 条 extension 失败 + 文件级 timeout，不能作为全绿证据；P0 相关用例单独跑通。
- GUI/Linux/macOS/OHOS 设备级动态验收未覆盖。
- P0-1 的 `execute` scope 端到端仍会被沙箱门禁拒绝（`remote-execution-gate.test.mjs` 钉住），不宣称远程执行已打通。

## 6. 文档同步

- `docs/interfaces/README.md` §1 已插入 2026-10-24 P0 条目（`turn/poll` 游标字段、`session/projection` 的 sessionId、`--manage grant-scope`、`session-mismatch` 守卫）。
- `docs/product/PRD-tracking.md` 补 2026-10-24 P0 条目。
- `docs/clients/web/2026-10-23-web-technical-selection.md` §13.4 更新 P0 闸门状态。
- 本证据同批登记 `docs/evidence/README.md` 与 `docs/README.md`。

## 7. 结论

P0-1/P0-2/P0-3 的产品代码、Host/daemon 构建、Host 级与 daemon 级验收均已完成；core 单测因预先存在的 HEAD 同名 `@Test` 缺陷无法运行（P0 文件零 error，库编译成功），extension/host spawn 失败经旧二进制对照确认为预先存在的工具链问题。未提交、未推送、未安装、未发布；未调用真实付费服务或外部模型。
