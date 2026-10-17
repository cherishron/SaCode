# 批次 N：审计完整性——值级脱敏替代「整条丢弃」，并补上 deviceId 这个没有第一道的洞

规格出处：`docs/superpowers/specs/2026-10-10-unified-remote-mobile-design.md` §7 第 125 行

> 审计保存时间、主体、设备、实例、资源、方法、operationId、结果类别与审批引用；不保存 token、登记秘密、任意请求正文或模型密钥。读面同样受权限限制。

这半句是**两条同时成立**的要求，不是二选一：既要「保存 who/when/what/result」，又要「不含登记秘密」。本批之前的实现只满足了后一半，方式是把前一半送给对手。

## 1. 改之前的行为为什么是个洞

`core/src/remote_audit.cj` 的 `RemoteAuditLog.record()` 原本在序列化产物里发现禁用键串（`"token"` / `"credential"` / `"authorization"` / `"params"` / `"body"` 及其转义形态）就**抛异常、整条不落盘**。序列化层是白名单，所以触发这种检查的唯一途径是**某个白名单字段的值本身**拼出了那种形态——而这些字段里有一批是客户端可控字符串。

于是任何调用方只要把字段写成含 `"credential"` 的内容，这次授权判定在审计里就**不存在**。fail-closed 听起来安全，实际是把「谁在试什么」这条最需要的记录变成了可由对方一键删除的东西。

## 2. 本批改了什么

`core/src/remote_audit.cj`：

- 新增 `auditRedact(name, value)`：值里嵌了禁用键串时，**只把那一个字段**换成 `audit-redacted:<字段名>`，事件照记。标记里带字段名，事后能判断是哪一层塞进来的。
- `serialize()` 里六个字段先过脱敏：`deviceId` / `workspaceId` / `sessionId` / `operationId` / `approvalRef` / `denyReason`。
- `record()` 的整串检查**保留**，但从「主防线」降级为「兜底断言」：正常情况下脱敏已把禁词消掉，触发它说明出现了脱敏没覆盖到的新字段，那时宁可拒落也不能写未知形态。计数 `rejectedCount()` 与异常都留着，就是为了这种情况能被发现。
- `principalId` / `instanceId` / `method` 不脱敏，注释里写明了各自的来源为什么不是远程输入面（见下节的实测依据）。

## 3. 分层事实：哪些字段有「第一道」，哪些没有

写这批用例起初我假定「所有自由文本字段都在 wire 上裸奔」，实测把这条推翻了，而且推翻的方向很值得记：`/rpc` 面早就有第一道，真正没第一道的是我原本划进「服务端产生、不用脱敏」那一栏的 `deviceId`。

| 审计字段 | 取值来源 | wire 上的第一道 | 位置 | 本批是否脱敏 |
| --- | --- | --- | --- | --- |
| `workspaceId` / `sessionId` / `operationId` | `/rpc` 请求体 `params` 顶层 | 有：字符集净化，越界整串换成 `sanitized-invalid` | `apps/daemon/src/remote_gate.cj:65`（在 `AuditEntry` 构造之前） | 是（第二道，兜不走门禁的直接调用方） |
| `method` | `/rpc` 信封 | 有：方法名字符集与长度门禁，且在 `gate.check` **之前** | `apps/daemon/src/daemon.cj:299` | 否（有第一道，且有固定词表要读） |
| `instanceId` | 服务端随机 16 字节 hex，落盘文件读回 | 不适用（非输入） | `apps/daemon/src/remote_access.cj:166` | 否 |
| `principalId` | 本地管理入口 `--manage enroll-ticket` 的参数，之后只从令牌上下文取 | 不适用（不是远程输入面） | `core/src/remote_identity.cj` 登记票据 + `remote_gate.cj:102` | 否 |
| `deviceId` | **`deviceName` 拼出来的**：`${deviceName}-${nextDeviceId}`，`deviceName` 是 `/auth/enroll` 请求体字段；`/auth/token` 的失败条目还把请求体的 `deviceId` **原文**直接写进审计 | **没有** | `core/src/remote_identity.cj:215`、`apps/daemon/src/remote_access.cj:291` | **是（本批补的洞）** |

`deviceId` 那条有两个实测后果，都是修复前在同一台 daemon 上拿到的：

1. 注入的认证失败审计**整条消失**，而且 `record()` 抛出的异常名被路由层 `catch` 成应答体——攻击者拿到 `{"error":"audit-serialization-leak"}`，等于一台「我这发注入奏效了吗」的探针机。
2. 用一个含 `"credential"` 的 `deviceName` 去登记时，登记应答被同一条异常拖成 400，客户端**永远拿不到凭据**；但设备记录此刻已经进了内存表，而 `persistAfterEnroll()` 在审计那一行之后——于是留下一台「服务端有、盘上没有、客户端不知道」的孤儿设备。这条本批没修（要动 `remote_access.cj` 的落盘顺序），记在下面第 6 节。

## 4. 读数

### cj 侧（`apps/daemon` 副本包，`cjpm test`，TMP 每轮唯一 `target/n-tmp9`）

| 轮 | TOTAL | PASSED | SKIPPED | ERROR | FAILED | rc | 红的是哪两条 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 本批前半（改语义、未加 deviceId） | 165 | 163 | 0 | 0 | 2 | 1 | 并发会话的 scope 用例 |
| 本批末（deviceId 纳入 + 2 条新用例） | 167 | 165 | 0 | 0 | 2 | 1 | 同上，名字逐字未变：`scopeGrantSurvivesSnapshotRoundTrip`、`gatePassesDeviceScopeIntoAuthorizationSoManagementMethodIsReachable` |
| 变异还原后重跑 | 167 | 165 | 0 | 0 | 2 | 1 | 同上（`target/N-restored-green.txt`） |

计数 +2 与本批新增用例数吻合：`apps/daemon/src/remote_audit_guard_test.cj` 的 `auditRedactsInjectedDeviceIdBecauseItComesFromClientDeviceName`，与镜像文件 `apps/daemon/src/remote_audit_test.cj` 的 `auditRedactsInjectedDeviceIdButKeepsServerSideFields`。13 条 audit 用例全部在 PASSED 名单里出现（`TestCase_audit*`），`ERROR` 为 0，所以不是「用例没跑」换来的绿。原始日志 `target/N-green4.txt`。

`core/src/remote_audit_test.cj` 里同步加了同义用例，但 core 侧链接段本机仍出不来 `unittest_bin/core.exe`（既有记录），所以可运行读数只认 daemon 副本包那一份。

### wire 侧（`apps/daemon/test/remote-audit-integrity.test.mjs`，6 条，真 daemon + 真审计文件）

| 轮 | tests | pass | fail | rc |
| --- | --- | --- | --- | --- |
| 修复前（只有 deviceId 两条红） | 6 | 4 | 2 | 1 |
| 修复后 | 6 | 6 | 0 | 0 |

修复前那两条的失败原文（`target/audit-integrity-red.txt`），这两行就是第 3 节那两个后果的直接证据：

```
not ok 4 - /auth/token 用注入 deviceId 被拒时，失败留痕必须还在且不含秘密
  error: '审计侧的失败不许变成可观测回显：{"error":"audit-serialization-leak"}'
not ok 5 - deviceName 注入不改变审计里设备身份的可读性，也不留秘密
    来自设备名的注入要标成脱敏，而不是原样落盘：
```

用例 5 的失败点比预想的更前面的原因值得记：它先炸在 `enrollAs()` 拿不到 `deviceId`（后果 2），于是那次 `/rpc` 变成未认证请求、反而留下了一条 `deviceId` 为空的记录——「注入设备名」的攻击面在旧实现里表现为**这台设备登记不上**，而不是表现为审计被抹。两种表现都算缺陷，但只有补了登记应答的断言才看得见前者。

### 全量 daemon Node 回归（工作区态，`target/N-node-regress.txt`）

15 套 112 用例：`# pass 97 / # fail 15 / # cancelled 0 / # skipped 0`。15 条红的归因逐条核过，**没有一条与本批改动相关**：

| 红条数 | 所在文件 | 失败形态 | 归因 |
| --- | --- | --- | --- |
| 11 | `apps/daemon/test/host-proxy.test.mjs` | `Cannot read properties of undefined (reading 'method')`（`runningDaemon` 里拿不到 initialize 帧），不是断言不匹配 | 并发会话在飞的 `apps/daemon/src/host_proxy.cj`（工作区 +2/−1 未落库），且本轮 exe 就是带着它构建的 |
| 3 | `apps/daemon/test/team-host.test.mjs` | 成员审批帧 `team_task_claim` 为空（快照里任务仍 `pending`） | 同一根：团队面依赖宿主转发 |
| 1 | `apps/daemon/test/remote-product.test.mjs:238` | `撤销一台把整台实例的令牌都作废了`（`authz-denied:invalid-token`） | 批次 K 刻意保留红的撤销事故半径，该文件被并发会话持有 |

这两套宿主用例都不开远程接入（`setRemoteGate` 不挂），审计模块根本不进执行路径，所以不可能由本批触发。本批自己那条 `remote-audit-integrity.test.mjs` 在合并回归里 6/6 通过，与单跑一致。

## 5. 变异反证

两条语义变异，改的都是 `core/src/remote_audit.cj`，只改语义不改签名：

| 变异 | 改法 | 独占受害用例 | 结果 |
| --- | --- | --- | --- |
| M1 | `let dev = jsonEscape(auditRedact("deviceId", deviceId))` → `jsonEscape(deviceId)`（把 deviceId 退回脱敏集合之外） | `auditServerSideFieldsAreNeverRedacted`（M2 单独施加时它是绿的：principalId/instanceId/method/ts 本来就不走 `auditRedact`，而 deviceId 被无条件脱成它期望的那个标记） | **被抓**：M1 单独轮 3 条 ERROR + wire 2 条 fail |
| M2 | `auditRedact` 体改成无条件 `return "audit-redacted:${name}"` | `auditKeepsCleanValuesUntouched`（M1 单独轮里它是绿的——M1 只碰 deviceId） | **被抓**：合并轮比 M1 单独轮多红 10 条，全在 audit/gate 用例族内 |

M1 单独轮读数（`target/n-mut/m1-cj.txt`，rc=1）：

```
Summary: TOTAL: 167
    PASSED: 162, SKIPPED: 0, ERROR: 3
    FAILED: 2
```

`ERROR` 三条逐字是 `auditRedactsInjectedDeviceIdBecauseItComesFromClientDeviceName`、`auditServerSideFieldsAreNeverRedacted`、`auditRedactsInjectedDeviceIdButKeepsServerSideFields`；`FAILED` 两条就是基线那两条并发会话 scope 用例，没动。落 `ERROR` 而不是 `FAILED` 的原因正是本批要修的行为：M1 下 `record()` 的兜底断言重新抛出，用例被未捕获异常整条带走。**旧实现「整条丢弃」在测试里的形状就是 ERROR 桶**，这条对应关系值得留着。

同一轮的 wire 侧（重建 exe 后跑 `remote-audit-integrity.test.mjs`）：`# tests 6 / pass 4 / fail 2`，红的正是两条 deviceId 用例，且第 4 条的失败文本与修复前逐字相同（`{"error":"audit-serialization-leak"}`）——说明这两条 wire 用例钉的是 M1，不是被别的改动顺带打红。

M1+M2 合并轮读数（`target/n-mut/m12-cj.txt`，rc=1）：

```
Summary: TOTAL: 167
    PASSED: 152, SKIPPED: 0, ERROR: 3
    FAILED: 12
```

红集合 15 条完整落在 audit/gate 用例族内、没有越出本模块，这是合并轮能用来归因的前提。**但合并轮本身不足以定案**，理由有两条实测：

1. `auditRedactsInjectedDeviceId*` 两条同时含 `denyReason` 明文断言，M2 单独也能打红它们，所以「只有 M1 能杀」必须由 M1 单独轮的差集来确立。
2. 更意外的一条：`auditRedactsBannedValueButStillRecordsTheDecision` 在**合并轮里是绿的**。M2 会把它那条 `"deviceId":"dev-1"` 打成占位符而变红，但同轮的 M1 恰好让 `deviceId` 退回裸序列化，两个变异改的是同一处调用的相反方向，在那一条断言上互相抵消。教训写死在这里：**两个变异同时作用于同一字段时，合并轮的红集合既非充分也非必要证据**，必须至少有一轮单独施加来建立差集。

还原自证（`target/N-mut2-out.txt`）：`还原后变体 => {"m1":false,"m2":false}`、`还原后与备份逐字一致 => true`、`还原后 build rc => 0`。回绿读数见 `target/N-restored-green.txt`（还原后同内容重跑 `cjpm test`）。

### 变异脚本自己翻的一次车（如实记）

第一版脚本（`target/n-mut/run.mjs`）在 `cjpm test` 刚结束、编译器还持有 core 源文件句柄时直接 `writeFileSync`，抛 `UNKNOWN (errno -4094)`；try 与 `finally` 各抛一次，Node 只报了 `finally` 那次，**于是 M1+M2 两个变异体留在工作区**。发现方式不是看测试，是看第 3 轮日志文件根本没出现（`ls target/n-mut/` 只有 `m12-cj.txt`），再 `grep` 源文件当前形态才确认。

处置：先用重试循环把源文件写回备份，并当场断言 `还原后与备份逐字一致 = true`；第二版脚本（`run2.mjs`）把每次写都改成 40 次 0.5 秒重试、每次落盘后用 `whichVariant()` 自证盘面到底是哪一变体、`finally` 里再自证一次。**这条改法本身比读数更有复用价值**：合并变异轮结束时，必须验「盘上是干净态」，不能只信 `finally` 会跑到。

同一批还犯过一次相反方向的错，记在这里因为它的读法陷阱很典型：还原后第一轮 `cjpm test` 我 `mkdir` 建到了 `apps/target/n-tmp11`，而 `TMP` 指根 `target/n-tmp11`，于是整轮只出一句 `error: Temporary directory path set by environment variable (TMP) does not exist.` 加 rc=1，**一个 Summary 都没有**。这既不是绿也不是「测试变红」，是根本没跑——按既有规矩（零 Summary 不成读数）改成先建对目录再重跑，才拿到上表那一行。

## 6. 本批没做的事

- `deviceName` 没有字符集与长度门禁：注入形态现在在审计里变成占位符，但设备记录仍然带原文进身份存储与快照文件。真正的修法是在 `/auth/enroll` 侧净化 `deviceName`（要动 `core/src/remote_identity.cj`，该文件被并发会话持有，本批未碰）。
- `persistAfterEnroll()` 排在审计那一行之后：登记成功但落盘失败时，内存表与快照会分叉。旧实现里注入还能把这条放大成孤儿设备；现在异常不再发生，但顺序问题原样存在。
- `record()` 的兜底断言仍会把异常抛给调用方。`/auth/*` 那两条路由实测是 `catch` 成 400 并回显异常名（第 4 节的红态原文就是它）；`/rpc` 面如果抛会走成什么，本批**没测到**——M1 单独轮里那条 wire 用例在登记一步就失败了，`/rpc` 分支只产生了一条 `deviceId` 为空的未认证记录，压根没触发改动路径。要补的是「审计写入失败时请求该不该放行」这一整条决策（`remote_gate.cj` 头注释写着「写失败不能把请求放行」，目前只覆盖 sink 返回 false，不覆盖抛异常）。
- Linux 侧分层未测：`sanitizeId`、`methodViolation`、脱敏都是纯字符串逻辑，跨平台无差异，但 wire 层（stdx HTTP 头解析）在 Linux 上的分层与 Windows 不同这一条，仍挂在批次 M 的未做项里。

## 7. 与计划的映射

`docs/superpowers/plans/2026-10-10-unified-remote-mobile.md` 第 147 行「审计保存 who/when/what/result；遍历日志断言无登记秘密/token/模型key」——本批把这条从「靠整条丢弃保证」改成「靠字段级脱敏同时保证」，两侧都有具名用例与 wire 读数，但同一行还挂着「禁跨主机认证重定向与 trust-all」那一半（TLS 面，批次 I 只验了客户端信任链），所以该行仍保持未勾，附本批注记。
