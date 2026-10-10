# 0.2 协议 schema 冻结与 0.1 拒绝路径

日期：2026-10-10。批次 Y 的取证与冻结文档，对应计划 `docs/superpowers/plans/2026-10-10-unified-remote-mobile.md` 第 1 节第 3 条（line 71）：「冻结 0.2 请求归属、幂等、身份、事件 schema；定义旧 0.1 拒绝方式；确定普通/团队请求统一协调器及会话根。」

状态：本批只做**文档冻结**——把当前工作区源码里的形状按字段/类型/顺序机械点出来，并把「今天没有实现的拒绝路径」逐条如实标注为 FAIL。没有源码改动、没有测试改动、没有构建。判据与解锁动作写在文末。

## 0. 工作区基线

```
git rev-parse HEAD              → 3cd0bc9（本批开工时）
git status --short -- ...       → 本批 5 个只读文件全部为 ` M` 或空
```

本批读到的 4 个冻结锚点文件都在 HEAD 上干净：
`apps/daemon/src/daemon.cj`、`core/src/remote_identity.cj`、`apps/daemon/src/idempotency.cj`、`apps/daemon/src/canonical_json.cj`。工作区里那 688 行改动属于其他会话的线（`apps/host/src/main.cj`、`core/src/approval.cj`、`core/src/remote_identity.cj` 有 +126 行的并发未提交改动，本批不动），本批的结论对 HEAD 成立、对工作区态是否成立取决于对方落库后要不要动这些字段——已在 §4 逐条点出。

---

## 0b. 计划第 1 节第 1 条（line 53）：git/worktree 快照与本计划文件的在途实现识别

计划 line 53 要求「记录 `git rev-parse HEAD`、`git status --short`、`git worktree list`；逐 hunk 识别本计划涉及文件的在途实现，尤其 durable_checkpoint 与 execution 文件」。批次 Y 一并把这一半落死：

**三条快照命令的当轮读数**（2026-10-10 13:00 UTC，本批提交后 HEAD 变为 `f52dd57`）：

```
git rev-parse HEAD              → f52dd5790fc1b3a4e5a610390fd284ad2f1d13f6
git status --short --untracked-files=all  → 689 行
                                              已跟踪 M/D         100
                                              未跟踪 ??           589
                                                  apps/**   575（其中 apps/desktop/** 571）
                                                  core/src  12
                                                  docs      1
                                                  tmpFile*  1
git worktree list               → 主树 D:/Project/sa/saai/sa-code (refactor/dsh-learning)
                                    + 10 个 detached 副本（3 个 C:/Users/jingg/.codex/worktrees/…
                                    + 7 个 D:/Temp/SaCode-…）
                                    （并发会话在本批取证过程中又建了 2 个副本，非本批动作）
```

`apps/desktop/**` 的 571 行绝大多数是 `.tmp-test/package-recheck-*/node-compile-cache/**` 的编译缓存（本仓 `.gitignore` 已把 `.tmp-test/` 忽略，但仍计入 `--untracked-files=all` 的裸计数）；`core/src` 的 12 行全部是本计划 line 90/160 点名的 durable_checkpoint 与 execution 系列在飞文件（下表）。这些不是本会话的产物，本会话不改、不 `git add`、不 `git commit` 触碰。

**本计划明确点名要识别的两组文件**（计划 line 90、160 分别点名 `durable_checkpoint.cj` 与 `execution` 文件属并发会话线）：

| 路径 | 工作区状态 | 归属 | 与计划的关系 |
| --- | --- | --- | --- |
| `core/src/durable_checkpoint.cj` | `??` 未入库 | 并发会话（Windows `@When[os == "Windows"]` 半，本文件里 `appendDurablePrefix` 硬编码 PowerShell 调用） | 计划任务 3 的 Linux 半——本文件今天只覆盖 Windows，Linux 屏障实现仍在计划里未落 |
| `core/src/execution_api.cj` | `??` 未入库 | 并发会话（execution API 定义） | 计划任务 4 的工具执行面，与本计划的 §4 OS 沙箱门禁正交 |
| `core/src/execution_service.cj` | `??` 未入库 | 并发会话（`ExecutionSnapshot` + 状态机） | 同上 |
| `core/src/execution_output.cj` | `??` 未入库 | 并发会话 | 同上 |
| `core/src/execution_supervisor.cj` | `??` 未入库 | 并发会话（`ExecutionRun` + `TurnToken` + `Future<ShellResult>`） | 同上 |
| 各 `execution_*_test.cj` 4 份 | `??` 未入库 | 并发会话 | 同上 |

9 个文件加其余 3 个 `core/src` 未入库文件（`git_workbench.cj`、`goal_runtime.cj`、`terminal_view.cj`——分别属另外在飞的 Git 工作台 / goal runtime / 终端视图模块）合计 12 个。

**归属判定依据**（不是靠文件名猜）：
1. `core/src/durable_checkpoint.cj:1-40` 的 `@When[os == "Windows"]` 与硬编码 `powershell.exe` 调用——不是通用 Linux 屏障，是 Windows 半的临时实现，属计划任务 3 的 Linux 半尚未接上；
2. `execution_*.cj` 系列的文件头注释与 API 形态（`ExecutionSnapshot` 状态机 + `ExecutionRun` 异步句柄）是「工具执行」这条产品线的核心层，与本计划任务 4（沙箱）不同源，是本仓库另一条在飞主线；
3. `git status` 显示这 9 个文件全部 `??`（未入库），说明对方还在飞，本会话不改、不 `git add`、不 `git commit` 触碰。

**其余与本计划正交但在飞的文件**（本会话同样不动，仅登记）：`core/src/approval.cj`（+70，`approvalDesk` 那条线）、`apps/host/src/main.cj`（+908，宿主新 RPC 分派）、`apps/desktop/main.cjs`（−289，Electron 端多目标 IPC）、`core/src/remote_identity.cj`（+126，`rotateCredential` 与 scope 线）、`apps/daemon/src/host_proxy.cj`（+未计，转发面扩展）。这些改动与本计划的**当前批次不冲突**（各自改不同的字段/函数），但会在下次全量回归时把测试套件里若干条翻红——已在批次 X 与 Y 的取证里逐条点出，见 §4.4「与其他批次的关系」。

**本会话对这三条快照命令的态度**：只读、只登记、只在本文件里留一次数，不落库进任何测试或断言脚本——`git status --short` 的计数在并发会话下每几分钟都在漂，把它做成测试断言会立刻变成噪声。

---

## 1. 冻结的 4 组 schema

以下每一项都写「代码里的**真实形状**」与「规格 §5 里的**目标形状**」并排；两者不一致的地方直接点出来，不粉饰。

### 1.1 请求归属（0.2）

**代码里的真实形状**（`apps/daemon/src/remote_gate.cj` 的 `check()` 入口 + `apps/daemon/src/daemon.cj` 的 `/rpc` 参数抽取）：

| 字段 | 位置 | 类型 | 缺省行为 |
| --- | --- | --- | --- |
| `params.workspaceId` | `daemon.cj:rpc` | String | 缺省 = 空串，`gate.check` 拿空串继续走 |
| `params.sessionId` | `daemon.cj:rpc` | String | 缺省 = 空串 |
| `params.operationId` | `daemon.cj:rpc` | String | 缺省 = 空串；写方法为空 → 幂等账 `acceptsKey` 直接 false，走通但无幂等保护 |

**门禁侧的额外字段**（批次 V，`remote_gate.cj` 的 `boundWorkspace`）：客户端把 `workspaceId` 写成本工作区以外的任何串都会被 `workspace-not-bound` 拒（`-32001`），除非实例启动时没设 `SACODE_WORKSPACE_ID`。这条是 **opt-in**：env 未设时门禁空转。

**规格 §5 的目标形状**：请求体顶层 `workspaceId` / `sessionId` / `operationId` 三字段；不建全局 `session/select` 的隐式 currentSession。

**冻结点**：
- **PASS**：三个字段名与规格字面一致；`gate.check` 已经全部按显式归属判定，不依赖宿主全局 currentSession。
- **FAIL**：`sessionId` 是否真的属于请求的 `workspaceId` 无检查（`DeviceAuthzView.allowedSessions` 恒 `None`），这是任务 7 的宿主契约变更。
- **FAIL**：`SACODE_WORKSPACE_ID` 未设时 `workspace-not-bound` 门禁空转——生产部署必须显式配置才能生效。

### 1.2 幂等（0.2）

**代码里的真实形状**（`apps/daemon/src/idempotency.cj:131-135`）：

```cangjie
static func keyOf(instanceId!: String, principalId!: String, workspaceId!: String,
                  sessionId!: String, method!: String, operationId!: String): String {
    return "${field(instanceId)}|${field(principalId)}|" +
        "${field(workspaceId)}|${field(sessionId)}|" +
        "${field(method)}|${field(operationId)}"
}
```

规范化：`IdempotencyLedger.field()` 逐字段跑 `sanitizeId`，把非 `[A-Za-z0-9._/-]` 的字符压成 `_`；空 `operationId` 由 `acceptsKey` 直接拒绝建账。

冲突判定：`consult()` 里同键同 canonical 内容 → 返原回执；同键不同 canonical 内容 → 拒 `-32003 idempotent-conflict`。canonical 由 `apps/daemon/src/canonical_json.cj` 生成（keys 排序、数组保序、无空白），非 `canonical_json` 的字符串比较。

**规格 §5 的目标形状**：`operationKey` 由 `instanceId/principalId/workspaceId/sessionId/method/operationId` 组成，同键同规范化内容返回原回执，同键不同内容拒绝。

**冻结点**：**PASS**，字段集与规格字面一致，字段顺序、冲突判定、canonical 来源全部对得上规格。这一条是唯一从规格到实现完全闭合的一组。

### 1.3 身份（0.2）

**代码里的真实形状**（`core/src/remote_identity.cj:102-115`）：

```cangjie
public class AuthenticationContext {
    public let deviceId: String
    public let principalId: String
    public let revocationVersion: Int64
    public let scopes: HashSet<String>     // 认证时从设备记录复制的能力面
    public init(deviceId, principalId, revocationVersion, scopes = HashSet<String>())
}
```

构造来源：`RemoteIdentityStore.verifyToken()` 兑换后返回 `AccessToken(value, deviceId, revocationVersion, expiresAt)`，`remote_gate.cj` 用 `device.revoked == false` 与 `token.revocationVersion < store.revocationVersion == false` 两条通过后再组装 `AuthenticationContext`。**客户端 params 里出现的任何身份字段一律不消费**——`gate.check` 只吃 HTTP header 里的 bearer，业务方法拿不到 params 里自报的 `principalId`/`role`。

**规格 §4.1 的目标形状**：`instanceId` / `principalId` / `deviceId` / `credentialRef`（客户端侧）+ 服务端 `AuthenticationContext` 由可信入口构造，业务方法只能消费不能构造。

**冻结点**：
- **PASS**：`AuthenticationContext` 的四字段集与规格一致；客户端 params 里自报身份字段确实没通路（`remote_gate.cj` 的 check 只吃 header）。
- **PASS**：规格 §4.2 的三条数字量（凭据 ≥ 256 bit / 登记 ≥ 128 bit / 令牌 ≤ 15 分钟）与算法要求逐条对得上源码——`generateCredential()` 走 `randomHex(32)`（`remote_identity.cj:176`，256 bit）、`createEnrollmentSecret()` 走 `randomHex(16)`（`:184`，128 bit）、`TOKEN_TTL_MS = 15*60*1000`（`:120`）、`ENROLLMENT_TTL_MS = 5*60*1000`（`:119`）、摘要用 `sha256Hex` 加 `secretBundleConstTimeEquals`（`:177`/`:234`）。`remote_identity_test.cj` 有对应位数与过期用例。
- **FAIL**：撤销事故半径缺陷（批次 K 已定位）——`revokeDevice` 里 `revocationVersion += 1` 是**全局**推进，撤任意一台设备会让其它设备的所有 bearer 立刻失效；`core/src/remote_identity.cj` 正被并发会话持有未提交改动，本批不动。

### 1.4 事件（0.2）

**代码里的真实形状**（`apps/daemon/src/event_replay.cj` 的 `session/events` 结果位 + `apps/daemon/src/sse_frames.cj` 的补读/去重帧）：

请求：`{ sessionId, afterSeq?, limit? }` — `afterSeq` 与 `limit` 允许字符串或数字两种写法（`parseDecimal` 收口）；`limit` 上界 200，超出直接 `-32602`。

响应：`{ events: [...], generation, nextSeq, hasMore }` — `seq` 是十进制**字符串**（不是数字），与规格 §6 一致；持久事件带 `seq`，瞬时事件带 `ephemeral: true` 且无 `seq`。

SSE 补读顺序（`daemon.cj` 的 `/sse` 建流处）：先建授权订阅并缓冲 → 读持久高水位 → 补读至高水位 → 丢弃缓冲重复 → 消费后续。`EventBus` 队列 1024 帧上限 + 4 MiB 字节上限（批次 F 已落），超限 `res.end()` 并回可恢复原因。

**规格 §6 的目标形状**：`session/events` 接 `sessionId`/`afterSeq`/`limit`（1..200）；返回 `events`/`generation`/`nextSeq`/`hasMore`；seq 十进制字符串；持久/瞬时明确区分。

**冻结点**：
- **PASS**：字段名、类型、seq 字符串编码、上下界、补读顺序全部对得上。
- **FAIL**：`generation` 目前只是每次持久追加后 `+=1` 的进程内计数，**不跨进程持久化**——daemon 重启后 generation 归 0，客户端拿到老 `nextSeq` 补读会撞上「新 generation + 老 nextSeq」的组合。规格 §6 说「generation 不匹配或游标超出范围返回显式 gap」，本条今天没有跨重启的持久化支撑。
- **FAIL**：SSE 扇出仍无按 device 过滤——批次 P 已确认 `EventBus.publish()` 对每个订阅者无差别扇出。建流认证一旦失效，收到的不是自己那条流而是整条总线的匿名旁听口。隔离只有一道门。

---

## 2. 0.1 拒绝路径的定义与今天的实况

### 2.1 规格里的定义（§5）

> 核心/Host 方法登记完成前，协议 0.1 与新显式归属协议 0.2 不混用；版本不匹配明确拒绝，不猜字段。

### 2.2 代码里的实况

`apps/daemon/src/daemon.cj:410-411` 的 `initialize` 应答与 bus.publish **硬编码 `"protocolVersion":"0.1"`**：

```cangjie
let result = "{\"protocolVersion\":\"0.1\",\"capabilities\":${capabilities},...,\"instanceId\":\"${jsonEscapeText(announceId)}\",\"sandboxEnforcement\":${enforcementJson}}"
bus.publish("daemon/client-initialized", "{\"protocolVersion\":\"0.1\",\"transport\":\"http-sse\"}")
```

按 grep 全仓扫 `protocolVersion` 与 `"0.2"`：命中就这两个字面 + `apps/cli/src/main.cj` 与三份远程测试的断言，**没有任何一处分派或门禁按版本协商**。也就是说：

- **请求侧**：客户端无论宣告 0.1 还是 0.2 还是完全不宣告，`gate.check` 与 `/rpc` 分派都不看版本，直接走显式归属参数抽取。
- **宣告侧**：`initialize` 恒回 `"0.1"`，客户端拿不到「服务端支持 0.2」的信号。
- **能力面**：`initialize` 的 capabilities 只是从 `hostProxy.capabilities()` 拿方法名列表，没有 0.2 专属条目。

**规格里的拒绝路径今天不成立**——因为根本不存在判定路径。今天的行为是「0.1 与 0.2 事实上混用：门禁按 0.2 的显式归属判定，但 initialize 宣告 0.1」。这正是规格 §5 明令禁止的混用。

### 2.3 本批不修，但把解锁动作写死

改这一处会同时影响：
1. `apps/daemon/test/remote-capability-contract.test.mjs`（现有断言看 `protocolVersion: "0.1"`）；
2. 桌面/CLI 两个客户端的版本协商（本仓的桌面端读 `initialize` 结果存到 `runtimeVersion`，改数字就变成新握手）；
3. 三份远程测试文件里对 `"protocolVersion":"0.1"` 的字面断言；
4. 宿主 `apps/host/src/main.cj` 的握手帧（该文件正被并发会话持有未提交改动，本批不动）。

按本次授权（不吞并他人改动），本批**不改**任何一处。要落 0.1 拒绝路径至少需要三步：

1. `initialize` 应答支持声明 0.2（客户端 `params.protocolVersion` 或 `initialize` 结果字段升级），并给 0.2 声明一份明确的 capabilities 子集；
2. `/rpc` 入口在 `gate.check` **之前**加一条版本协商：客户端未宣告 0.2 或宣告了服务端不支持的版本 → 拒 `-32004 protocol-version-mismatch`；
3. 补一条真 HTTP 用例：0.1 客户端拿到的 initialize 结果里 capabilities 是 0.1 的子集，任何 0.2 专属方法（今天实际不存在）都拿不到 capabilities 里的条目，尝试调用返回 `-32601`。

**这条是本计划 line 71 的完整兑现前提**，本批只做冻结与标注，不改任何一字节。

---

## 3. 普通/团队请求统一协调器与会话根

规格 §4.3 与计划任务 7 要求：普通与团队走同一实例/根目录/会话路由，`runtime_router.cj` 收敛。

### 3.1 今天的实况

- **实例**：一个 daemon 进程 = 一个 `teamHost` + 一个 `hostProxy`。团队桥（`team_host_bridge.cj`）与远程桥（`host_proxy.cj`）是**两个独立的桥对象**，各自 spawn 自己的宿主子进程，各自有独立的 session catalog。
- **会话根**：两桥都读 `SessionCatalog(".")`，也就是进程 CWD；桌面与手机通过远程桥拿到的是同一份 catalog，但**会话本身的归属状态在两个桥里没有交叉引用**——桌面本地会话列表和远程会话列表是同一个 `SessionCatalog` 的两次独立列举。
- **协调器**：不存在。计划任务 7 列的 `apps/daemon/src/runtime_router.cj` 尚未创建（`ls` 无此文件）。

### 3.2 本批不修，但把会话根的候选收敛成一个

按规格 §1 不变量第 7 条「会话日志是业务事实真源」与会话根的候选收敛成一个：

- **推荐唯一会话根**：daemon 的 CWD，也就是 `SessionCatalog(".")` 现在读的那个目录；由 CLI/服务管理器在启动 daemon 时按 `SACODE_WORKSPACE_ID`（批次 V 已引入的 opt-in env）指定。
- **两桥共享根目录**：`team_host_bridge.cj` 与 `host_proxy.cj` spawn 宿主时都传同一 workspace 根；今天两者各自 spawn 但都读同一 CWD，属于**巧合一致**而非显式声明，一旦 CWD 变了两者会各自漂移。
- **会话归属**：`sessionId` 到 `workspaceId` 的反查在核心里已有（`session.catalog` 结果里 workspaceDirectory 字段），但**远程桥没有把这条链路显式绑起来**——`gate.check` 只验 workspaceId 是不是本实例的 boundWorkspace，不查 sessionId 是不是真属于那个 workspace（这是 §1.1 里记的 FAIL，也是任务 7 的宿主契约变更）。

### 3.3 解锁动作

创建 `runtime_router.cj`（计划任务 7 明写的路径）前，先要：

1. 在宿主 `apps/host/src/main.cj` 里给每个 spawn 出的宿主传显式 workspace 根（今天走 CWD，是隐式）；
2. 让 `team_host_bridge.cj` 与 `host_proxy.cj` 从同一个 router 拿宿主句柄，而不是各自 spawn；
3. 在 `gate.check` 之后（`recordAllowed` 之前）加一条 sessionId→workspaceId 的反查，用 `SessionCatalog` 结果核对 `ws` 是不是 `sessionId` 的真实归属工作区。

步骤 1 与 2 都改宿主，属任务 7 范围且该文件正被并发会话持有；步骤 3 只需动 `remote_gate.cj`，但**必须先让规格 §5 的 0.2 sessionId 语义先落地**——今天客户端把 `sessionId` 传成任意字符串都不会被抓出错，反查会立刻翻红。顺序不能反。

---

## 4. 结论与冻结边界

### 4.1 本批冻结了什么

- **1.2 幂等**：字段集、canonical 来源、冲突判定**全部对得上规格**。四组里唯一无 FAIL 项（另一个「无 FAIL」的是下面 1.3 的凭据/登记/时限数字面，见下条）。
- **1.1 请求归属**：三个字段名与规格字面一致，`gate.check` 已按显式归属判定；两个 FAIL 项（sessionId 反查、SACODE_WORKSPACE_ID 未 opt-in 时门禁空转）明确记录。
- **1.3 身份**：`AuthenticationContext` 四字段集与规格一致，客户端 params 里自报身份字段确实无通路，凭据/登记/时限三条数字量与算法要求全部对得上源码；一个 FAIL 项（撤销事故半径全局推进）明确记录。
- **1.4 事件**：字段、seq 编码、补读顺序与规格一致；两个 FAIL 项（generation 不跨进程持久化、SSE 扇出无按 device 过滤）明确记录。
- **0.1 拒绝路径**：**代码里不存在**任何版本协商或拒绝路径。今天的事实是 0.1 与 0.2 混用（gate 按 0.2 判定、initialize 宣告 0.1），规格明令禁止。
- **统一协调器**：**不存在**（`runtime_router.cj` 尚未创建）。今天的「一致」是巧合（两桥都读同一 CWD），不是契约。

### 4.2 本批不判通过的理由

计划 line 71 的字面要求是「冻结 0.2 … schema；**定义**旧 0.1 拒绝方式；**确定** … 统一协调器及会话根」——三条里「定义」和「确定」都要求代码能兑现。今天的实况是：

- 0.2 schema 冻结可以（本文件已把四组逐字段点出并机械对上规格）；
- **0.1 拒绝方式定义不了**——因为代码里没有判定路径，规格里的拒绝语义无处落；
- **统一协调器确定不了**——因为文件不存在，只有巧合一致的现状可冻结，冻结巧合等于没有协调器。

**整行不勾**，理由写在这里，不写进计划文件的复选框。

### 4.3 依赖与解锁顺序

按最便宜到最贵排：

1. **§1.1 的 `SACODE_WORKSPACE_ID` opt-in → 生产默认**：只在测试里 opt-in 意味着生产部署如果忘了设 env 就有整族 `workspace-not-bound` 空转。要落就得让 `daemon.cj` 启动时缺 `SACODE_WORKSPACE_ID` 也报启动失败（fail-loud），本批不动。
2. **§1.3 的撤销事故半径**：`revokeDevice` 里的 `revocationVersion += 1` 是全局推进，需改成 per-device 版本推进；改一行（`:283` 附近），但 `core/src/remote_identity.cj` 正被并发会话持有，本批不动。
3. **§1.4 的 generation 跨进程持久化**：需要引入 `durable_checkpoint.cj` 或独立计数持久化文件，前者属并发会话未落库的新文件（工作区 `??` 状态），本批不动。
4. **§2 的 0.1 拒绝路径**：三步（initialize 升级、`/rpc` 加协商、补一条用例），改 4 个文件（含宿主，宿主被并发会话持有）。**先决条件是 §1.1 的 sessionId 反查先落地**——不然 0.2 客户端传一个不存在的 sessionId，反查立刻红。
5. **§3 的 runtime_router.cj**：新建文件、改两桥、加 gate 反查，全部改动都指向宿主 `apps/host/src/main.cj`（并发会话持有）。等对方落库后再动。

### 4.4 与其他批次的关系

- 批次 V 的 `workspace-not-bound` 门禁已入库（`c5706a8`），本文件 §1.1 的 FAIL 项建立在 V 的基础上。
- 批次 K 定位的撤销事故半径缺陷，是本文件 §1.3 的两个 FAIL 之一，已入库用例保持红态（`apps/daemon/test/remote-product.test.mjs` 第二条）。
- 批次 P 确认的 SSE 扇出无过滤，是本文件 §1.4 的 FAIL 项之一。
- 批次 X 的 F01-F21 映射（`docs/evidence/2026-10-10-remote-method-prd-crosswalk.md`）与本文件是**正交的两个面**：X 是「契约表能不能落到实现」，Y 是「请求/身份/事件这几个字段本身冻结没冻结」；两条线各自独立推进。

---

## 5. 本批的自证边界

- **没有**改任何源码、测试或构建产物。
- **没有**跑 `cjpm test` 或 `cjpm build`（本批无源码改动，跑也拿不到新证据）。
- **没有**跑 Node 测试（本批无测试改动）。
- 所有引用的字段名、字段集、构造来源都对到 HEAD 上的具体行号；工作区里 `core/src/remote_identity.cj` 的 +126 行未提交改动**不改变本批结论**——那些改动加的是 `rotateCredential` 与 `remote_identity_scope_test.cj`（同属并发会话那条 rotate 线），没有动 §1.3 的四字段集。
