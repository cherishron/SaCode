# 2026-10-10 远程接入批次进度

对齐 `docs/superpowers/plans/2026-10-10-unified-remote-mobile.md`。逐提交列出取证计数、rc 与阻塞项，
不合并跨批次证据，不用「文件存在」代替测试通过。

## 已交付提交

| SHA | 范围 | 测试计数与 rc | 变异反证 | 状态 |
| --- | --- | --- | --- | --- |
| 95a30ae | 设计规格 + 实施计划 + 能力契约表 119 条 | Node 契约 1/1 rc=0 | — | 已入库 |
| c2feecc | desktop target-store.cjs（凭据指针分离、https 强制、回环白名单） | 15/15 rc=0 | 3 组互不重叠受害用例（IPv6/fingerprint/credentialRef），restore diff 空 | 已入库 |
| 29c8d77 | desktop remote-transport.mjs（Bearer/id 严格回显/1MiB 上限/8+2 并发） | 14/14 rc=0 | id 顺序冒充配对不加锁的注入 → 指定用例红 | 已入库 |
| 09fab08 | desktop target-bridge.mjs（多目标路由 + connectionEpoch 隔离） | 12/12 rc=0 | 3 个变异（fallback-to-default / 去 request epoch 检查 / 去 subscribe epoch 检查）分别杀 5/7/9 | 已入库 |
| d66aae8 | remote-transport 加 Idempotency-Key + SSE Last-Event-ID | 22/22 rc=0 | 3 个变异（Idempotency-Key 头不注入 / Last-Event-ID 头不注入 / 不更新游标）分别杀 15/17/18、19/21、22 | 已入库 |
| 34b5cfe | target-bridge.subscribe 自动透传 transport.getLastEventId() | 15/15 rc=0 | `if (false)` 让 guard 短路 → 13 号红、其他 14 条仍绿 | 已入库 |
| 2463376 | target-store 边界覆盖（spec 非对象/IPv6 回环/remove 非 active/displayName 空/credentialRef 非字符串/baseUrl null） | 21/21 rc=0 | — | 已入库 |
| e42dbb6 | remote-transport 走真实 Node HTTP/SSE 服务器集成测试 | 6/6 rc=0 | — | 已入库 |
| e68ba6d | 能力契约表 requiredScope / anchor / 客户端方法面 5 组独立检查（裸脚本迁 node:test） | 9/9 rc=0 | — | 已入库 |
| 26c363b | TargetStore+TargetBridge+RemoteTransport 多目标集成（真 HTTP） | 3/3 rc=0 | — | 已入库 |
| 4be823d | 契约加「全局无资源动作」白名单棘轮（防止新增管理方法忘声明 resourceKeys） | 10/10 rc=0 | 首次跑即抓出 auth/revoke 缺口，纳入白名单并写明依据 | 已入库 |
| 93b1f1f | target-store TOFU 钉扎 + rotate 显式换钉 | 28/28 rc=0 | 静默覆盖 mismatch / 取消 confirm 检查 两个变异各杀指定受害 24/27 | 已入库 |
| 3968691 | tls-pin.cjs 证书指纹钉扎校验（`tls.checkServerIdentity` + SHA-256 常数时间比较） | 9/9 rc=0 | 3 变异（去 mismatch / 去 host / 去 format）各杀受害 3 / 5+9 / 4 | 已入库 |
| e73c521 | 批次进度表补 4be823d 与分栏 | 文档 | — | 已入库 |
| 738b829 | core/remote_{identity,audit,authorization}.cj + 3 份测试入库（989 行） | cjpm build 库层 rc=0；运行验证由 e572a78 的 daemon 副本达成 | 见 e572a78 | 已入库；运行验证通过（daemon 侧） |
| 0e90f6e | 批次进度表补 738b829/93b1f1f/3968691 与 cjpm 分栏 | 文档 | — | 已入库 |
| 26f8411 | 契约加 resourceKeys 值域严格 ⊂ {workspaceId,sessionId} 棘轮 | 11/11 rc=0 | 计划 §1 直接对应；未变异，因它自己就是从「设计口径漂移」反推出来的最小硬约束 | 已入库 |
| 9602cb6 | 契约加 device-admin 面 desktop-only 棘轮 + requiredScope 映射落盘（48 有值 / 71 null） | 12/12 rc=0 | 变异 `auth/devices` 或 `auth/revoke` 加 mobile 消费 → 新棘轮红（fail 1）；还原回绿 | 已入库 |
| b3f4200 | remote-transport 加 token 轮换与 SSE 现取 tokenProvider 防回归 | 24/24 rc=0 | 把 tokenProvider 改成首次调用后缓存 → 23/24 双红（fail 2）；还原回绿 | 已入库 |
| 71f8725 | remote-transport 认证请求强制 `redirect:"manual"`，任何 3xx 归 `redirect-not-allowed` | 26/26 rc=0 | 只在 /rpc 撤 redirect:manual（保留 3xx 分支与 SSE 面）→ 仅 25 号红、26 号仍绿 | 已入库 |
| b7b1747 | target-bridge.request 加可选 opts 参数原样透给 transport（Idempotency-Key 落到桥面） | 17/17 rc=0 | 从 sendRequest 参数列去掉 opts → 16 号红、17 号（不传 opts 兼容）仍绿 | 已入库 |
| 46a27e9 | 真 HTTP 302 跨主机重定向集成测试（redirect:manual 端到端） | 7/7 rc=0 | 源端口 302 → 目标端口 handler 断言 targetHit==0；测试直接依赖 71f8725 加的 redirect:manual | 已入库 |
| 4d28627 | RemoteRequestGate 落 daemon/src；AuditEntry/CapabilitySpec 改命名参（`!`） | cjpm build daemon rc=0；162 core warn（0 指本文件）+ 2 daemon warn | 见下条 e572a78 的 34 条运行验证 | 已入库 |
| 6faccf9 | RemoteRequestGate 5 条行为用例真跑绿 | cjpm test daemon：TOTAL 5 / PASSED 5 / FAILED 0 rc=0 | 删掉 recordDenied 的 missing-bearer 分支 → 三条依赖该路径的用例同时变红（FAILED 3 / PASSED 2），invalid-token 与 authz-denied 独立受害者仍绿；还原回绿 | 已入库 |
| e572a78 | 三模块 34 条 Cangjie 单测真跑绿（daemon 侧运行，绕开 core 链接 40 分钟卡）；补 jsonEscape 后 escaped 禁词检测 | cjpm test --target-dir daemon-fix：**TOTAL 34 / PASSED 34 / SKIPPED 0 / ERROR 0 / FAILED 0 rc=0** | auditRejectsValueContainingBannedKey 首跑红（漏检 `\"credential\"`）→ 加 bannedEscaped 分支后绿；authz 未知方法变异（默认拒改默认允）→ 只 authzUnknownMethodRejected 一条红，其余 33 条绿；还原回绿 | 已入库 |
| c619910 | 任务 6 第二批：远程接入 HTTP 面接线。dispatchRpc→dispatchRpcWithAuth 贯通 Authorization 头与 params 顶层归属；/sse 建立即认证；/health 本机匿名最小存活 + 非本机认证；新增 remote_access.cj（/auth/enroll + /auth/token 两面、16KiB 认证体、每来源 10/分、每票据 5 次锁定、实例身份文件跨重启稳定、生产 FileAuditSink、按契约表逐行装策略且坏行整体拒启动）；启动校验缺项即拒 | `cjpm test`（daemon，私有 target-dir）：**TOTAL 58 / PASSED 58 / SKIPPED 0 / ERROR 0 / FAILED 0 rc=0**；新增 `test/remote-auth.test.mjs` 真 HTTP socket：**15/15 rc=0**；`remote-capability-contract` **12/12 rc=0** | 三组变异各杀指定受害后还原回绿：① 撤 dispatch 层 gate 检查 → 仅 `dispatchWithGateRejectsMissingBearer`(FAILED) + `dispatchWithGateExtractsWorkspaceSessionOperationId`(ERROR) 两条红，`dispatchWithoutGateKeepsLegacyPath` 仍绿；② denied 归属写回空串 → `gateDeniedAuditsAttemptedWorkspaceAndSession` / `gatePoisonedIdentifierCannotBlankAudit` / dispatch 归属用例三条红；③ sanitizeId 改透传 → `gatePoisonedIdentifierCannotBlankAudit` / `gateSanitizeIdAcceptsIdentifierShapesAndCapsLength` 两条红。还原用 cp 备份 + `diff` 空输出证逐字一致 | 已入库 |
| ca3d698 | 任务 6 第三批：登记票据跨进程可见 + 本地管理入口。快照升 `snapshotVersion:2` 带票据摘要与**绝对 unix 毫秒**到期；`reloadTicketsFrom` 在受理登记前合入磁盘新票；daemon 二进制加 `--manage enroll-ticket <storePath> <principalId>` 子命令（网络面仍只两面）；`/auth/token` 的 `expiresInMs` 改由 store 钟算并夹 0 | `cjpm test`（daemon，私有 target-dir）：**TOTAL 67 / PASSED 67 / SKIPPED 0 / ERROR 0 / FAILED 0 rc=0**（63→67）；`remote-auth` **17/17 rc=0**（含新建票→HTTP 登记→兑换→Bearer 过授权面端到端 + 管理入口参数形状两条）；`remote-capability-contract` **12/12 rc=0** | 两个语义变异同一轮施加、受害者互不重叠：① 撤 `enroll()` 里的 `reloadTicketsFrom` → 端到端用例红（401 `invalid-enrollment`）；② `toStoreRelative` 改成原样返回（把绝对 unix 毫秒当相对刻度）→ 仅 `crossProcessTicketUsesAbsoluteExpiryNotStoreRelativeClock` 红，其余 66 条绿。还原 cp + `diff` 空输出，两侧各自复跑回绿（67/67、17/17、12/12）。**首轮 ① 是存活的**，见下节 | 已入库 |
| 92d565b | 任务 6 第四批：TLS 真装配 + 带外撤销吸收 + §7 并发限额 + 管理入口补齐。`ServerBuilder` 接 `.tlsConfig(TlsServerConfig(...))`，证书/密钥解码失败即拒启动 78，`readHeaderTimeout`/`readTimeout` 配 10 秒；`RemoteIdentityStore.refreshFromDisk`（磁盘文本未变短路）+ gate 在 `check`/`checkStreamAuth` 认证前吸收，`listDevices`/`revokeDevice` 公开且不外泄摘要；新增 `remote_limits.cj`（每设备 8 RPC / 2 SSE、实例 64 SSE，授权后才占槽、`finally` 归还、被拒不占槽）；`--manage` 增 `list-devices`/`revoke-device` 并把 arity 与未知子命令统一拒 | `cjpm test`（daemon，私有 target-dir）：**TOTAL 80 / PASSED 80 / SKIPPED 0 / ERROR 0 / FAILED 0 rc=0**（67→80）；`remote-tls` **2/2 rc=0**（新建套件）；`remote-auth` **19/19 rc=0**；`remote-capability-contract` **12/12 rc=0** | 两轮施加、受害者互不重叠。轮 1（Cangjie）：① 撤 `/rpc` 的 `finally` 归还 → `dispatchReleasesRpcSlotAfterEachRequest` 红；② `acquireRpc` 上限改恒真 → `dispatchRejectsWhenDeviceRpcSlotsAreExhausted`/`rpcSlotsAllowEightPerDeviceThenDenyNinth`/`rpcSlotReleaseFreesCapacityAgain` 红；该轮 **TOTAL 80 / PASSED 76 / FAILED 4 rc=1**，红集合不越出 RPC 槽位族。轮 2（Node，重打二进制）：③ 撤 gate 的 `refreshFromDisk` → 仅「管理入口列设备与撤销对在跑的 daemon 生效」红；④ 注释 `.tlsConfig(...)`（启动行仍打 `https://`）→ 仅 TLS 第 1 条红、坏证书拒启动那条仍绿；⑤ `acquireSse` 设备上限改恒假 → 仅「每设备第 3 条 SSE 被限额拒回」红；该轮 auth **17/19**、tls **1/2**。两轮各自 cp 备份 + `diff -q` 空输出证逐字还原（还原后 `MUTANT-` 标记计数 0），再全链复跑回绿（80/80、19/19、2/2、12/12） | 已入库 |
| fc7e5b6 | 任务 7 第一批：远程方法面铺开。`hostMethods` 由 16 条推到 98 条，推导式 = 契约表 ∩ 宿主 initialize 声明能力（新增 `docs/plans/host-capabilities.json`，120 条，取自已提交宿主源码并与本机打包宿主实跑回包核对）− daemon 自有 − 代理自留长连接 `session/subscribe` − `team/*`；契约检查加三条对账（转发 ⊆ 契约 ∧ ⊆ 宿主声明 / 远程消费的已实现方法不得漏 / 等于推导集）；新增 `remote-method-surface.test.mjs` 用**真实宿主 exe** 端到端反证 | 红先记录：三条契约对账先落在**仍是 16 条**的白名单上 → `remote-capability-contract` **13/15 rc=1**（红的正是新增的两条要求与推导集）；`remote-method-surface` 首跑 0/6 全红是我把 `mkdtemp` 从 `node:fs`（回调 API）而非 `node:fs/promises` 引来的夹具错，**不构成有效红灯**。铺开前的有效行为红来自一次性探针：`tips/get`/`model/list`/`queue/describe` 在 16 条白名单下全部 `-32601 method not found`。铺开后该套 5/6（仅余 SIGKILL 未等退出导致的 EBUSY 清理红）→ 修好后 **contract 15/15 rc=0**、**surface 6/6 rc=0**、`remote-auth` **19/19 rc=0**、`remote-tls` **2/2 rc=0**、`cjpm build` rc=0；`cjpm test` **TOTAL 80 / PASSED 80 / SKIPPED 0 / ERROR 0 / FAILED 0 rc=0**（工作区态：= 本批提交内容 + 他人一行未落库的 `host_proxy.cj` H-14 转义改动，提交态未单独复跑）。`host-proxy` + `team-host` 仍是 **17/21（同 4 条既有红，用例名与 92d565b 轮记录一致）** | 三个语义变异同一轮施加、独占受害互不重叠：① 从白名单删 `tips/get` → 契约规则 B 与 surface 第 3 条红；② 加一条宿主不认的 `not-a-real-host-method` → 契约规则 A 与 surface 第 1 条红；③ `INIT_CAPS` 里塞 `session/events` → surface 第 6 条红。共享用例「推导集相等」(#15) 与 「initialize 能力面」(surface #2) 显式排除出归因集。变异轮读数 contract **12/15**、surface **2/6**；cp 备份 + `diff` 空输出还原，`MUTANT-` 标记计数 0，复跑 15/15 与 6/6 回绿 | 已入库 |

### fc7e5b6 的分母与两处又一次自己造的假红

- **两个分母各司其职，不能混**：契约表 119 行是「远程面应当能打到什么」的产品分母；
  `docs/plans/host-capabilities.json` 120 条是「宿主本人承认什么」的实现分母。转发面取二者交集
  再减 daemon 自有 / 代理自留长连接 / `team/*`，得 98 条。宿主声明但契约没有的 10 条
  （`turn/start`、`extension/host/*` 七条、`appearance/set-theme`）是宿主内部管道或历史别名，
  刻意不进远程面；契约有而宿主未声明的 9 条（`session/events`、`approval/set-mode`、
  `approval/get-mode`、`team/approval/answer`、`daemon/shutdown`、`auth/*` 四条）走本地/团队/未发布，
  同样不转发。对账写成**子集极性**，所以别人以后给宿主加能力不会把我这条门禁弄红。
- **打包宿主与提交态核对**：`apps/desktop/dist/host/bin/sacode-host.exe` 实跑 initialize 回 120 条，
  与 HEAD 的宿主源码字面量同集，含 `global/settings/get`、`model/list`，不含 `session/events`——
  所以端到端断言打的是这份产物，而不是我以为的产物。
- **两处假红都在夹具**：`mkdtemp` 我按 `node:fs` 引（回调 API），用例第一步就
  `The "cb" argument must be of type function`；改成 `node:fs/promises` 后一次过 5 条。
  剩下 1 条是 `EBUSY: rmdir`——SIGKILL 之后没等 `close` 就删夹具目录，加了有界重试与等待退出。
  两条都是 0 秒级失败，长得像被测面炸，实际与被测面无关；这已经是本轮第二次犯同一类错。
### 92d565b 的两处夹具红与一处被关掉的真实缺口

- **两条红都是我自己写的夹具，不是被测面**。① `remote-tls.test.mjs` 用
  `-subj CN=127.0.0.1` 出自签证书，openssl 直接报
  `req: subject name is expected to be in the format /type0=value0/...`，用例在生成夹具阶段就炸；
  改成 `/CN=127.0.0.1` 后同一份断言一次过。② `remote-auth.test.mjs` 的 SSE 用例借用了
  `boot()` 里那个带 `AbortSignal.timeout(10000)` 的 `get()`——那是给短响应设计的。长连接被自己的
  定时器掐掉后 DOMException 记到用例头上、错误信息是空串，看起来像被测面挂了。独立探针给的是相反结论：
  两条流各收到 `: connected` 首帧、第 3 条 `429 concurrency-denied / sse-per-device`
  且 `content-type` 是 `application/json`、关掉一条后 **1179ms** 内新流建起来。
  用例改成流自带 reader、断言首帧、并在定时器到点前主动 `cancel()`，不再用带超时的 `get()` 开长连接。
- **被关掉的真实缺口**：证书只做启动校验、从未接进 `ServerBuilder`，即「配了 TLS 却明文服务」。
  这条现在由变异 ④ 反向钉住——把装配注释掉、启动行照样打 `https://`，只有真发 https 请求的用例会红。
- **本轮踩到的 stdx 形状**（编译器原文）：官方 `stdx/net/tls` 文档写的
  `import stdx.crypto.x509.{X509Certificate, PrivateKey}` 在 1.1.3 上报
  `undeclared identifier 'PrivateKey'`；真实包是 `stdx.crypto.common`，而且 `PrivateKey` 是接口，
  直接 `PrivateKey.decodeFromPem` 报 `static invocation contains unimplemented static function`，
  必须走 `stdx.crypto.keys.RSAPrivateKey.decodeFromPem`——因此启动拒因拆成
  `tls-cert-undecodable` 与 `tls-key-undecodable` 两条，而不是混成一条。
### ca3d698 抓到的两处问题

1. **`expiresInMs` 报得比名义 TTL 还长（实测 900001 > 900000）**。引导层 `RemoteAccessEndpoints`
   有自己的 `MonoTime` 基准，`t.expiresAt - nowMs()` 混用了两个基准，差 1ms 就把「还剩多久」
   报多；客户端按它安排续期点会晚于令牌真实失效点。改 `RemoteIdentityStore.tokenRemainingMs(token)`
   （store 自己的钟 + 夹 0），Cangjie 侧 `reportedTokenWindowComesFromStoreClockAndNeverExceedsTtl` 钉住。
2. **我自己写的端到端用例是假绿**——这条比第 1 条更值得记。首版把 `--manage` 建票放在
   `boot()` **之前**，daemon 启动时的 `loadSnapshot` 顺带把票据捞进来了，于是
   「受理登记前重新读一次磁盘票据」这条活路径整段没被执行：撤掉它的变异体照样 17/17 全绿。
   真实用法恰恰是 daemon 长期运行、管理员之后才建票。改成 `boot()` 后再建票，同一变体立刻红
   （401 `invalid-enrollment`）。**结论：变异反证不只用来验实现，也用来验用例本身；
   顺序型夹具的先后关系就是断言的一部分。**

### 8278245 身份摘要键 + 设备跨重启保持

| SHA | 范围 | 测试计数与 rc | 变异反证 | 状态 |
| --- | --- | --- | --- | --- |
| 8278245 | `enrollments`/`tokens` 由**原文键**改 **sha256Hex 摘要键**（修「文件头自述只存摘要」与实现不一致）；新增设备快照面：`snapshotText` / `saveSnapshot`（临时文件 + rename 原子落位）/ `loadSnapshot`（缺文件或坏 JSON 返 false，不假装恢复、不洗掉已有设备），令牌与 5 分钟一次性票据明确不落盘；daemon 启动加载 `<identity>.devices.json`、`/auth/enroll` 成功后落盘 | `cjpm test`（daemon）：**TOTAL 63 / PASSED 63 / SKIPPED 0 / ERROR 0 / FAILED 0 rc=0**（+5 条持久面用例）；Node 侧 `remote-auth` 15/15 + `remote-capability-contract` 12/12 rc=0；`host-proxy` + `team-host` 仍 17/21（4 条既有红，用例名与条数与本批前一致） | 变异 `saveSnapshot` 改成 `return true` 但不写盘 → 恰好 `devicesSurviveSnapshotRoundTrip` / `enrollmentTicketsAndTokensAreNotPersisted` / `revokedDeviceAndWatermarkSurviveReload` 三条红、其余 60 条绿；cp 备份还原后 `diff` 空输出证逐字一致，回跑 63/63 绿 | 已入库 |

两处诚实标注：

- **登记秘密的本地创建/确认入口仍未定。** 设计 §4.2 把网络身份引导面限定为
  `/auth/enroll` + `/auth/token` 两端点，而票据须由「目标端本地管理入口」创建；
  当前 store 只在 daemon 进程内存里，没有任何从 daemon 之外触达的入口。
  因此**正向登记链路（建票→登记→换令牌→Bearer 过关）只在 Cangjie 侧证过**
  （`tokenExchangeThenBearerPassesGate`），HTTP 端到端仍缺，不记 PASS。
  待定的是显示通道：把秘密打到 daemon stdout 会被桌面壳日志捕获，
  与设计「秘密不得长期保存在日志里」冲突，属产品口径裁决，不自作主张。
- **core 侧测试副本未同步。** 新 5 条持久面用例只落进 `apps/daemon/src/remote_identity_test.cj`
  这份可运行副本；`core/src/remote_identity_test.cj` 暂不同步——core 的 `cjpm test`
  链接段仍 BLOCKED，镜像过去等于提交一份本机编译不到、验证不到的代码。

### c619910 首跑抓到的两处真实缺陷

1. **denied 审计丢归属**：`recordDenied` 把 `workspaceId`/`sessionId` 写死空串，
   拒绝条目只剩「某设备某方法被拒」，无法还原「试图访问哪个会话」（设计 §7 who/when/what）。
2. **审计可被投毒成漏记**：归属字段是客户端可控串，原样进审计经 jsonEscape 后会拼出
   被禁键串 `\"token\"`，触发 `RemoteAuditLog.record()` 整条拒落——攻击者构造
   `workspaceId = a","token":"b` 即可让越权尝试「不进审计」。改为标识符字符集净化
   （越界整串换成 `sanitized-invalid`）+ 64 长度截断，不漏记也不被投毒。

顺带修 `remote-capability-contract.test.mjs` 以 cwd 相对路径读契约表：从 `apps/daemon`
下跑 `node --test` 时路径指到 `apps/daemon/docs/plans/`，整份文件在 import 阶段 ENOENT。

### 既有失败的归因证据（不归本批）

`test/host-proxy.test.mjs` 与 `test/team-host.test.mjs` 有 4 条红：
`initialize 能力登记六个 worktree 方法`、`未配置 SACODE_HOST 时白名单方法 fail-closed`、
`有界等待：宿主不回应时按时限回错`、`会话与团队共享同一宿主的当前会话与写租约`。
本批二进制由共享工作区构建（含他人未提交的 `host_proxy.cj`），故做 A/B：
用 `git show HEAD:apps/daemon/src/daemon.cj` 覆盖后另编一份私有 target-dir 二进制，
`node --test --test-concurrency=1` 跑同两个文件 → **tests 21 / pass 17 / fail 4，红的正是同 4 条**。
即这 4 条与本批改动无关，属在飞改动的既有失败；不改动他人文件、不弱化断言凑绿。

### 环境读数与解锁动作（本轮新增）

- `cjpm test` 报 `Too many attempts to create a temporary file`（std.unittest worker 起不来、
  整份日志无 Summary）的**真因不是名字冲突**：本机 `C:` 仅剩 **44 MB** 可用，
  而只设 `TMP`+`TMPDIR` 时 worker 仍落 Windows 系统 Temp。
  可复现解法：`TMP`、`TEMP`、`TMPDIR` 三者一起指到 D: 盘每轮唯一目录，随后
  `cjpm test --target-dir <私有>` 即出 Summary（本轮 58 条 20 秒级完成）。
- `apps/daemon/target/release/bin/main.exe` 被在飞进程占用时 `ld.lld` 报
  `failed to write the output file: Permission denied`；不改别人进程，
  改 `cjpm build --target-dir <私有>` 并以 `SACODE_DAEMON` 指给 Node 测试。
- 本会话清理了自己留下的 2 个孤儿 daemon（PID 5864 / 6672，启动时刻落在本会话测试窗口内）；
  并发会话的 `sacode-host.exe` 未动。

**桌面侧总计（本轮）**：`target-store` 28、`remote-transport` 26、`remote-transport-integration` 7、
`target-bridge` 17、`multi-target-integration` 3、`tls-pin` 9，共 **90** 条断言全绿。
**daemon Node 侧**：`remote-capability-contract` **15/15** + `remote-method-surface` **6/6** + `remote-auth` **19/19** + `remote-tls` **2/2** rc=0（fc7e5b6 轮）。
**daemon Cangjie 侧**：`cjpm test` **TOTAL 80 / PASSED 80 / SKIPPED 0 / ERROR 0 / FAILED 0 rc=0**（92d565b 轮）
（身份 11 + 审计 6 + 授权 12 + gate 8 + 归属净化 3 + 分派接线 3 + 引导面/限速/配置 15 + 设备持久面 4
 + 票据跨进程与管理入口 5；上一轮 63 条里的 `enrollmentTicketsAndTokensAreNotPersisted` 与「票据不落盘」
 的新契约互斥，已替换为 `ticketFromAnotherProcessIsConsumableButTokensAreNotPersisted`）。

### 批次 D：服务端幂等账（50633ef）

| 面 | 位置 | 落点 |
| --- | --- | --- |
| 键与判定 | `apps/daemon/src/idempotency.cj` | 六元组键按长度前缀分帧；同键同内容重放、同键异内容拒、超时/宿主中途退出/分派异常记 unknown、确证没到宿主的错误不建账 |
| 规范化内容 | `apps/daemon/src/canonical_json.cj` | 递归按键排序 + 类型标签 + 字节长度前缀；整值浮点与整数归一（`1` 与 `1.0` 同一份内容）；排序只用 `add` 与下标读，不依赖未证实的 `ArrayList.insert` |
| 策略通道 | `core/src/remote_authorization.cj`、`apps/daemon/src/remote_access.cj` | `CapabilitySpec.durable` + `specOf()`；装载逐行强制显式 `durable`，漏配整表拒启动。daemon 不持有第二份写操作名单，契约 59 条 durable 全靠这一条通道生效 |
| 分派接线 | `apps/daemon/src/daemon.cj` | 业务链整段搬进 `dispatchBusiness`（一条分支未改），账本在执行前 consult、执行后按去向记账；重放回执换成本次请求的 id |
| 落盘 | `<identityPath>.ledger.jsonl` | `File.appendTo` 一写一条，行数超 `cap*2` 整写压实；坏行/残行只跳过，载入后仍按 cap 收口；写失败计数可读出不冒充「已提交」 |

拒绝码取 **-32017 operation-id-required / -32018 idempotency-conflict / -32019 idempotency-unknown**：宿主本人已占用 `-32001..-32004`（`session/create` 的 `bad-session-title` 实测就是 -32004）与 `-32010..-32016`，所以账本另起一段，客户端才分得清「账本没放行」和「宿主答了业务错」。

**运行计数**：`cjpm test` **TOTAL 105 / PASSED 105 / SKIPPED 0 / ERROR 0 / FAILED 0 rc=0**（上一轮 80 → 本轮 +7 账本语义 +5 规范化摘要 +5 分派接线 +2 策略装载 +1 有界额度 +5 落盘重开）。
Node 侧 **47/47**：`remote-idempotency` **5/5**、`remote-auth` 19/19、`remote-tls` 2/2、`remote-capability-contract` 15/15、`remote-method-surface` 6/6，全部 rc=0。
`remote-idempotency` 用**真宿主**做观测量，每条重放用例都配「换个 operationId 就 +1」的阳性对照：`session/submit` 的 `result.events` 停在 1、`session/catalog` 条目数不变，且第 5 条停掉第一个 daemon 再起第二个（同 identityPath 读到盘上账）后仍拿原回执，并用 `session/projection` 核会话日志真源也是 1 条。

**变异反证**（每个变异各有一条只有它能杀的独占受害用例；`sameOperationIdReplaysWithoutSecondExecution` 是 B 与「跳过 consult」类变异的共享受害，显式排除出归因集）：

| 变异 | 独占受害用例 | 结果 |
| --- | --- | --- |
| A 把 `-32011` 从 uncertain 名单摘掉 | `ledgerDispositionRoutesTimeoutToUnknownAndNeverReachedToUnrecorded` | 红 ✓ |
| B 对象改按插入序出帧 | `topLevelKeyOrderDoesNotChangeTheDigest`、`nestedKeyOrderDoesNotChangeTheDigest` | 红 ✓ |
| C 策略装载吞掉 `durable` | `policyLoadCarriesDurableOntoTheRegisteredSpec` | 红 ✓ |
| D `persistLocked` 直接返回 | `recordedReceiptSurvivesReopeningTheStore`、`unknownReceiptSurvivesReopeningTheStore`（ERROR 桶）、`reopenedStoreDoesNotResurrectEvictedEntries`、`unwritableStoreKeepsMemorySemanticsButCountsTheFailure` | 红 ✓（一轮 4 个变异合并：FAILED 8 / ERROR 1） |
| E 拆掉「durable 写必须有 operationId」这道闸 | `durableRejectsWithoutOperationIdAndDoesNotExecute` | 单独一轮：TOTAL 105 / FAILED **1**，红集合恰好等于这一条 ✓ |

**本轮踩到的两个新坑**：
- `shutil.copy2` 还原变异体时**连同 mtime 一起还原**，`cjpm` 增量构建看时间戳认为源文件没变，直接复用变异体的 `.cjo`，于是「已还原」的那轮仍红 1 条而用例名却对不上任何已改语义——`touch` 四个源文件后立刻 105/105。还原后必须刷 mtime，diff 空输出只证内容逐字一致，不证构建真的重编。
- 仓颉 `stdx` 的 `JsonValue.asString()/asInt()/asBool()` 返回的是 `JsonString/JsonInt/JsonBool`，`.getValue()` 直接出值，**没有** `getOrThrow()` 也没有 `??`（官方文档那节写的 `Option` 形态在 1.1.3 编不过：`'getOrThrow' is not a member of class 'JsonString'`）；`HashMap.get`/`JsonObject.get` 才回 `Option`。`a ?? b >= c` 也要显式加括号（`??` 会把后面的比较吞进去，报 `expected 'Bool', found 'Int64'`）。

**明写的窗口**：账在副作用**之后**落盘，所以「宿主已做、daemon 崩在写账之前」这一段仍会在重启后重放一次——§5 正因此不许承诺 exactly-once，这一段的收敛靠 `execution/*`、`task/*` 的状态核实，不靠账本。

**不属于本批的红**：`host-proxy.test.mjs` 11/12 红 + `team-host.test.mjs` 1/9 红。归因证据：同一批失败用 **05:37 那枚根本不含本批代码的 daemon 产物**照样复现（红名与错误行一致），主要签名是夹具宿主一起来就被判 `-32002 宿主已退出`，而 `team-host` 自己的夹具宿主能正常应答，故指向并发会话在飞的 `host_proxy.cj` 未提交 hunk 与 `core/`（session/lease/ledger/agent/cmds）改动被编进任何当轮产物。本批未改动这两个文件，也不改他人文件、不弱化断言。

### 批次 E：session/events 持久补读面

| 落地面 | 位置 | 说明 |
| --- | --- | --- |
| 补读实现 | `apps/daemon/src/event_replay.cj`（新增） | 只读盘不产生副作用，所以 `durable=false`、不进幂等账；页形状固定为 `generation/nextSeq/hasMore/gap/events`，`seq` 出线是十进制字符串 |
| 分派支与能力宣告 | `apps/daemon/src/daemon.cj` 的 `session/events` 支 + `INIT_CAPS` | 由 daemon 本人作答，不进宿主转发白名单；契约锚点从「拟新增」改成实名两处同批落 |
| 反向断言改写 | `remote-method-surface.test.mjs` | 原来那条「session/events 既不转发也不宣告」按锚点兑现改成「不转发、但由补读面作答并对外宣告」，`-32601` 断言换成 `-32602 unknown-session` |
| 远程端到端 | `apps/daemon/test/remote-events.test.mjs`（新增 7 条） | flush 边界、缺省游标含 seq 0、静默轮询不跳条、分页与 catalog 持久条数对账、gap/非法参数、按 sessionId 隔离、缺 sessionId 先拒 |

**两条游标口径（本批定的，附为什么）**：

- `afterSeq` **不传 = 从头，含 seq 0**；传 `"0"` = 已看过 seq 0。旧实现把缺省填成 `"0"`，于是新客户端第一次补读天然丢掉第一条，而 cj 侧用例全部显式传 `"0"`，本地测试全绿也看不出来。显式 `"-1"` 仍按 `cursor-malformed` 拒——不接受我们自己发明的反值哨兵。
- `nextSeq` 的口径是**「你确实看到的那一条」**，不是「我本来打算给你的那一条」。旧实现在无新事件时回 `cursor+1`，客户端把它当已看过再轮询，就会把之后才落盘的那条永久跳掉。空持久日志的 `nextSeq` 回空串（= 仍从头），不再回 `"0"` 冒充看过第一条。

**远程消费方必须走的序列（2026-10-10 探针实测，修正了上一版夹具的假前提）**：宿主的写目标是它**当前选中**的那条会话，`session/submit` 的参数名是 `eventType`/`data`（不是 `text`）。所以远程要让正文进入某条会话的日志必须 `session/create → session/select → session/submit → session/flush`；少了 `select`，正文落进工作区根的 `session.log`，而补读面按 `sessionId` 解析到 `sessions/<id>/session.log`，于是「提交了但补读永远读不到」。探针读数：`SUBMIT {events:2,durable:1}` → 从头页只有 `seq 0 session/title`；`FLUSH {events:2,durable:2}` → 从头页出现 `seq 1 user/message 补读正文-probe`；`CATALOG` 该会话 `durable:3` 与三条事件页对账一致。**被转发方法是否真按 params 顶层的显式归属定位会话，仍属任务 7**，本批只把补读面这一侧的归属钉住。

**计数**：仓颉侧 `cjpm test` **TOTAL 117 / PASSED 117 / FAILED 0 / ERROR 0 / SKIPPED 0，rc=0**（批次 D 基线 115 + 本批新增 2 条补读钉子，另有 8 条 `event_replay_test.cj` 与 2 条 gate 接线用例已在同批计入）；Node 侧远程全套 **tests 54 / pass 54 / fail 0 / cancelled 0，rc=0**（批次 D 后 47 + 本批 7），产物 `apps/daemon/target/release/bin/main.exe` 11095040 B（10:56 那次干净构建；变异产物只写进 `.tmp-test/mutant-td`，没覆盖默认路径，所以还原后源码与该产物仍逐字对应，Node 全套在还原态复跑 54/54 rc=0）。

**变异反证（F+G 同轮，独占受害各一条）**：

| 变异 | 施加 | 独占受害（必须红） | 共享受害（不计入归因） |
| --- | --- | --- | --- |
| F | `event_replay.cj` 缺省 `want` 由 `0` 改 `1`（从头也丢掉第一条） | cj `absentCursorReadsFromSeqZeroWhileExplicitZeroSkipsIt` **FAILED**；Node「缺省游标从 seq 0 起」 | Node flush 边界页与分页对账两条（页里少一条，计数对不上） |
| G | `lastSeen` 初值由游标改 `want`（nextSeq 回「本来打算给的那一条」） | cj `quietPollReturnsSameCursorInsteadOfJumpingAhead` **ERROR**（`@Expect` 不终止，随后按下标取正文落 ERROR 桶）；Node「静默轮询原样带回游标」 | 无 |

变异轮读数：cj **TOTAL 117 / PASSED 115 / FAILED 1 / ERROR 1**，红集合正好等于这 2 条新增钉子，无第三条外溢；Node **fail 4 / pass 3**，4 条红的 `error:` 原文分别是「从头读必须含 seq 0」「补读页条数与 catalog 持久条数不一致」「静默轮询必须原样带回游标（实测 `nextSeq":"2"`）」「单页取回的就是全部持久事件」——都指向前两行声称的语义，不是夹具抖动。还原用 `cp` 备份 + `diff` 空输出（rc=0、`MUTANT` 标记计数 0）证明逐字一致，还原后 `touch` 源文件破掉 mtime 增量缓存再跑回绿。

**本批自己踩的两颗假绿/假红**：

1. 探针把 daemon 产物路径写死成 `apps/daemon/target/release/bin/main.exe` 的历史副本，`--manage enroll-ticket` 返回 **rc=64**，一度被读成「新桥接坏了」。真因是 05:37 那枚产物早于 `ca3d698` 的管理入口参数形状改动；同一份当前源码构建的产物 rc=0。**教训：Node 与探针必须显式指向当轮构建产物，旧产物的读数不是被测面的读数。**
2. heredoc 写 JS 再次吃掉正则里的 `\\/`（`/\\/g` → `/\/g`，SyntaxError）。凡含反斜杠正则的脚本改用文件写入，不走 shell heredoc。

### 批次 F：SSE 双限额、按设备关在途流与首订阅补读

| 落地面 | 位置 | 说明 |
| --- | --- | --- |
| 每连接双限额 | `apps/daemon/src/eventbus.cj` + `remote_limits.cj` 的 `SSE_FRAME_LIMIT`/`SSE_BYTE_LIMIT` | 1024 帧与 4 MiB 各给各的关闭原因（`overflow` / `byte-overflow`）；字节只数**还在队列里的**，取走即归还 |
| 按设备关流 | `EventBus.closeFor(device!:reason!)` | 撤销一台设备只断它自己的两条 SSE；空 deviceId（本机开发态）不参与匹配，撤销不会顺带打断本机桌面 |
| 在途流重认 | `RemoteRequestGate.revalidateStreamEndReason(authHeader, deviceId!)` + `daemon.cj` 的 `/sse` 空闲 tick | 成功返回空串且不落审计（这是每秒级心跳）；失败返回关流原因并落一条 `sse/stream-revalidate` + `stream-<原因>` 的 denied，带上当初认证到的设备。**到期与撤销分开**（`SSE_CLOSE_EXPIRED` / `SSE_CLOSE_REVOKED`）：客户端对这两者的恢复动作相反 |
| 首订阅补读 | `apps/daemon/src/sse_frames.cj`（新增）+ `/sse` 建流路径 | 顺序按 §6：先建立缓冲订阅，再读持久高水位，补 `游标之后` 的 durable 帧并记下已交付游标，之后才消费直播；缓冲里同游标的帧丢弃 |
| 帧形状 | 同上 | 持久帧 `id: <sessionId>` + 竖线 + `<seq>`、`event: durable`、带归属的 data；瞬时帧 `event: ephemeral` 且**不带 id**；关闭帧 `event: close` + `data:{"reason":...}` |
| 运行验收 | `apps/daemon/test/remote-sse-recovery.test.mjs`（新增 4 条） | 带游标重连马上拿到 seq 1/2 且不重交 seq 0；不带游标只给直播；撤销后在途流自己结束且流里带 `"reason":"revoked"`，同一 token 再建流拿 401 |

**游标形状为什么这么定**：`<sessionId>|<seq>` 由服务端写进 `id:`、客户端原样回带 `Last-Event-ID`（`apps/desktop/remote-transport.mjs:149` 早就在透传，只是此前服务端从不写 `id:`，所以这条恢复链在两端都是断的）。坏游标一律按「没有游标」处理，**绝不**升成启动失败——否则任何远程客户端发一个坏 `Last-Event-ID` 就能拒掉自己这条连接，把恢复面变成 DoS 面。

**计数**：仓颉侧 `cjpm test` **TOTAL 133 / PASSED 133 / FAILED 0 / ERROR 0 / SKIPPED 0，rc=0**（批次 E 基线 117 + `eventbus_test.cj` 6 + `sse_frames_test.cj` 8 + `remote_gate_test.cj` 2）；daemon Node 远程全套 **tests 58 / pass 58 / fail 0 / cancelled 0，rc=0**；因帧形状改动另跑客户端回归 **apps/desktop** `remote-transport` + `target-bridge` **tests 43 / pass 43 / fail 0，rc=0**（客户端按行过滤 `data:`，多出的 `event:` 行不影响解析，这条是实测而非推断）。还原后最终读数：`cjpm test` **133 / 133 / FAILED 0 / ERROR 0，rc=0**；daemon Node 远程全套 **58 / 58，rc=0**；产物 `main.exe` 11129856 B（11:36 干净构建）。

**变异反证（四个变异，两轮归因）**：

| 变异 | 施加 | 独占受害 | 备注 |
| --- | --- | --- | --- |
| H | 整段撤掉 `offer` 里的字节上界判断 | cj `byteLimitClosesWithItsOwnReasonNotTheFrameOne` FAILED | 第一轮与 J、K 同批 |
| J | `closeFor` 不看 deviceId，整实例关 | cj `closeForDeviceOnlyClosesThatDeviceAndReportsHowMany` + `untaggedSubscriptionIsNotClosedByDeviceRevocation` FAILED | 两条都是它独占 |
| K | `/sse` 首订阅不写补读帧 | Node「带 Last-Event-ID 重连」红，同一 build 下另外 3 条（含不带游标的正向对照）保持绿 | Node 侧 **tests 4 / pass 3 / fail 1，rc=1** |
| I | `poll` 不归还已取字节 | cj `consumedBytesAreGivenBackSoASlowDrainingClientIsNotKilled` FAILED（**单独一轮**：TOTAL 133 / FAILED 1） | 见下面的遮蔽教训 |
| L | `revalidateStreamEndReason` 把到期与撤销合并成一个原因 | cj `streamEndReasonSeparatesExpiredFromRevoked` FAILED（与 M 同轮，TOTAL 133 / PASSED 132 / FAILED 1） | 独占 |
| M | 重认失败后不调 `closeFor`（§4 退化成只挡下一个请求） | Node「撤销设备会关掉它在途的 SSE」红，同一 build 下另外 3 条绿（**tests 4 / pass 3 / fail 1，rc=1**） | 独占，且那 3 条正是它的正向对照 |

**H 遮蔽 I —— 这对变异不能同轮**：第一轮同时施加 H+I+J+K 时，红集合只有 3 条，`consumedBytesAreGivenBack...` 居然绿。原因不是用例假绿，而是 H 把字节上界整段撤掉之后，I 的「记账不归还」在这条用例的观察点（第 7 次 offer 该不该被拒）上根本不可观测——两个变异在同一条判断上串味。按「独占受害 + 显式排除共享」的规则，H 与 I 必须分轮；补跑 I 单独一轮才拿到它自己那条红。**同文件相邻两行的变异，先问「后一个变异会不会让前一个的观察点消失」。**
还原：`cp` 备份 + `diff` 空输出（两文件 diff-rc 均为 0、`MUTANT` 标记计数 0），还原后 `touch` 破 mtime 再跑回 133/133 绿。

**本批明确没做到的两条（不缩范围，记下归属）**：
1. 「每帧重新检查授权」只做到**空闲 tick 重认身份**这一层；逐帧的资源级过滤（按 workspace/session 判这条帧能不能发给这台设备）还没做——它要求通知帧自带归属键，而宿主通知的形状属并发会话在飞的 `host_proxy.cj` / `apps/host/src/main.cj`（任务 7）。
2. 补读去重的**生产通路**目前是空转：真实宿主的通知帧不带持久 `seq`，`SseFrame.idOf` 取回空串，所以「丢弃缓冲里同游标的帧」这条分支在真机上不会命中。分支本身有 cj 单测钉着（`deliveredLookupOnlyDropsExactlyTheSameCursor` + `liveFrameIdMatchesBackfillIdSoDuplicatesCanBeDropped`），兑现要等宿主给通知打上 seq。
3. `overflow` / `byte-overflow` 的**关闭帧送达**只由 `revoked`/`expired` 这条真实路径在 Node 侧验过同一 writer 分支；从真实宿主打出 1024 帧/4 MiB 需要量级太大的夹具，本批改用 cj 层验语义，并在此如实标注为「传输证据只到 revoked/expired」。`expired` 的**关流**同理只有 cj 层证据：真实 token TTL 是 15 分钟，Node 侧无法在合理时长内等到它自然到期，而带外改写 `expiresAt` 需要动 core 的存储格式。

### 批次 G：请求结构门禁（§7 深度 32、方法名上界、批量与通知归因、Origin）

| 落地面 | 位置 | 说明 |
| --- | --- | --- |
| 深度上界 32 | `apps/daemon/src/remote_schema.cj`（新增）的 `depthExceeded` | **解析之前**按字节扫描：stdx 的 JSON 解析器按递归下降建树，50 万层的 `[[[[` 会先在解析器里把栈炸掉，轮不到 daemon 给拒绝原因。字符串态与转义态都跟进——字符串里的花括号不是容器，`\"` 不算串结束；一旦越界立刻早退，工作量与正文长度同阶 |
| 批量与通知归因 | 同上 `startsWithArray` + `daemon.cj` 的 `dispatchRpcWithAuth` | §7 明写「拒绝 JSON-RPC batch 与无 id 的业务通知」。这两条**原本就会**被拒（`asObject()` 抛 -32700、缺 id 走 `get("id").getOrThrow()` 落含糊的 -32600 invalid request），但那套归因把「这个面不支持的用法」说成「你的 JSON 写坏了」。本批拆成 `batch-not-allowed` 与 `notification-not-allowed` |
| 方法名上界与字符集 | `methodViolation` | 1..64 字节且只允许 `[A-Za-z0-9._/-]`。64 的取法：契约 119 条里最长是 `global/settings/set-transcript-view`（35 字节），留一倍余量。字符集那一半不是装饰——未登记的方法名照样要落进审计行，允许引号与换行等于让调用方在日志里插字段。长度按字节算，所以非 ASCII 一律拒（同一个数不能既当字符数又当字节数） |
| Origin 出现即拒 | `originViolation` + `jsonBodyOf` + `/sse` 首位 | §7「外部 CORS 默认不开放」。本产品没有浏览器客户端，所以不配 allowlist、不看值：有 Origin 就拒——`/rpc` 回 JSON-RPC error、`/auth/*` 回 400、`/sse` 回 403 且挡在订阅与抢槽之前。**没有 Origin 不是放行理由**：非浏览器客户端本来就不发它，那条仍由认证与授权挡 |
| 排序 | `dispatchRpcWithAuth` 第一处判定 | 结构门禁在 `gate.check` 之前：200 字节的方法名进不了授权表也进不了审计；匿名请求也只能拿到结构结论，拿不到「哪台设备被拒」 |

**三个客户端面核对过不被新门禁误伤**（静态直读，不是推断）：`apps/cli/src/remote.cj` 的信封恒带 `id`（`envelope.put("id", JsonInt(sent))`）、逐条发对象、只设 `Content-Type`；`apps/desktop/remote-transport.mjs` 同形状；两者都在 Node 侧发请求，不带 `Origin`。另实测 undici 会把手工设置的 `origin` 头原样发出，所以 Node 侧那条门禁是真命中，不是被客户端库吃掉。契约 119 条方法名全部落在允许字符集内，最长 35 字节。

**计数**：
- 红先：`cjpm test`（daemon，私有 target-dir）**rc=1，53 errors generated / 8 printed**，打印出的 8 条全是 `undeclared identifier 'RemoteRequestSchema'`、`'REQUEST_DEPTH_LIMIT'`、`'SCHEMA_DENY_DEPTH'`，位置逐条指 `remote_schema_test.cj`——本批新命名符号未声明，正是这条流水线的红灯形状。
- 取证态说明：以上读数都是**工作区态**，编译里含并发会话未落库的 `core/src` 改动（按当轮 `git status`：18 个已跟踪文件被改、13 份新文件未入库）与 `apps/daemon/src/host_proxy.cj`，以及那份未入 HEAD 的 `remote_identity_scope_test.cj`。提交态未单独复跑；判读不受影响的原因是三轮变异的红集合都恰好等于「本批新增断言 ∪ 该线的 2 条红」，没有第三条线被本批代码带走。
- 绿：`cjpm test` **TOTAL 149 / PASSED 147 / FAILED 2 / SKIPPED 0 / ERROR 0**；`cjpm build` **rc=0**（`main.exe` 11146240 B，12:07，md5 `31793519fb187702ee6472aaec5bed7b`）；新增 `test/remote-request-limits.test.mjs` **6/6 rc=0**；daemon 远程 Node 全套 8 个文件 **tests 64 / pass 64 / fail 0 / cancelled 0 / skipped 0，rc=0**（批次 F 基线 58 加本批 6）。
- **不属于本批的 2 条红**：`scopeGrantSurvivesSnapshotRoundTrip` 与 `gatePassesDeviceScopeIntoAuthorizationSoManagementMethodIsReachable`。归因证据：两条都落在**未入 HEAD** 的 `apps/daemon/src/remote_identity_scope_test.cj`（并发会话 11:43 写，本会话未碰），失败原文是 `Expect Failed: (ctx.getOrThrow().scopes.contains(AUTHZ_SCOPE_MANAGEMENT) == true) left: false`——设备授权范围跨快照保持，属任务 6 的凭据轮换与管理范围面（同线的 `core/src/remote_identity.cj` 那份 +62 未提交 hunk 也在给这条能力补实现）。本批既不改那两个文件，也不弱化这两条断言。

**变异反证（9 个变异，三轮归因）**：

| 变异 | 施加 | 独占受害 | 备注 |
| --- | --- | --- | --- |
| A | 扫描器不进字符串态，容器一律计数 | cj `bracesInsideStringsDoNotCountAsDepth` | 顺带杀 B 那条（见 B 行） |
| C | `originViolation` 恒放行 | cj `originHeaderPresenceIsDeniedWithoutParsingItsValue` | 独占 |
| D | 撤方法名长度上界，只留非空 | cj `methodNameAcceptsHostShapeAndRejectsOverlong` | 与 E 同轮不串：E 撤的是字符集，而 D 的用例名很短，长度判定仍在位杀不到它 |
| E | 撤方法名字符集判定 | cj `methodNameRejectsCharactersThatCouldForgeAuditLine` | 与 D 同轮，同理：65 字节纯字母名仍被长度拒 |
| F | 撤批量归因 | cj `topLevelArrayIsAttributedToBatchNotParseError` | 第二受害者是本批自己加在 `depthLimitCutsAtThirtyThreeNotWider` 里那条「32 层裸数组落到批量归因」的断言，写明不遮蔽 |
| B | 不跟转义态，`\"` 当字符串结束 | cj `escapedQuoteKeepsTheScannerInsideTheString` | **单独一轮**：A 已经把这条用例杀掉，同轮施加 B 拿不到它自己的红。单独轮读数 **TOTAL 149 / PASSED 146 / FAILED 3**（含 2 条非本批红），且该轮 `bracesInsideStrings` 保持绿——两道守卫各自独立才算清楚 |
| G | 结构结论照算但不在原位回，整段挪到 `gate.check` 之后 | Node「超长方法名进不了审计」+ Node「结构门禁在认证之前」 | 附带杀 Node 批量那条：挪位后 `asObject()` 先抛，批量重新退化成 -32700——这恰好是「批量归因必须在解析之前」的直接证据 |
| H | 撤通知判定，缺 id 退回含糊的 invalid request | Node「无 id 的业务通知」 | 与 G 同轮，两者受害者不重叠 |

M1 轮（A+C+D+E+F）读数 cj **TOTAL 149 / PASSED 140 / FAILED 9**（7 条本批 + 2 条非本批），Node **tests 6 / pass 2 / fail 4**；M2 轮（仅 B）cj **PASSED 146 / FAILED 3**；M3 轮（G+H，重打二进制）Node **tests 6 / pass 2 / fail 4，rc=1**，绿的两条（深度界内对照、Origin）正是 M3 没碰的守卫——G 只改顺序不改判定，所以「深度仍能拒」必须仍绿。还原：`cp` 备份 + `diff` 空输出（两文件 diff-rc 均为 0、`MUTANT` 标记计数 0），还原后 `touch` 破 mtime 再跑最终回归（149 / PASSED 147 / FAILED 2、Node 64/64 rc=0）。

**本批明确没做到的三条（不缩范围，记下归属）**：
1. §7 那句里的 **Host 头校验（防 DNS rebinding）** 没做。它需要「本实例允许被哪些主机名访问」的配置面：`--bind` 只给地址不给主机名，硬编码回环名会在合法的内网 IP 访问上误拒。留在任务 6，与管理 RPC 面同批。
2. `/health` 没挂 Origin 门禁。该面在 gate 在位且非本机时要求认证，而浏览器发不出 `Authorization`，匿名跨源读只会拿 401；本批把改动收在 `/rpc`、`/auth/*`、`/sse` 三面，没有顺手扩第四个面。
3. 结构门禁只判骨架：`params` 的字段数、除方法名以外的字符串字段值长度仍无上界。§7 给的分母是 1 MiB 总体加深度 32，本批按它落，没有自行加码。

### 批次 H：Windows 同包 CLI+Host+daemon 交付链与干净包验收（任务 5 的 Windows 半）

| 落地面 | 位置 | 说明 |
| --- | --- | --- |
| 同包组装 | `scripts/pack-service.mjs`（新增 133 行） | 一份目录里同时放 `bin/sacode.exe` + `bin/sacode-host.exe` + `bin/sacode-daemon.exe` + 运行期库 + `extjs/`，并产 `bin/service-manifest.json`（schemaVersion 1、platform/arch/gitSha、roles 四角色、files 逐条 path/bytes/sha256/kind）。运行期库**不在这里定规则**：哪几颗 DLL 进包、哪几颗只是编译期专用，已由 `scripts/pack-cli.mjs` 用「删掉能跑 / 删掉真依赖就当场炸」反证定过档，本脚本只消费它的产物——两份规则迟早会漂。缺输入即 rc=2 并指名缺哪个路径；运行期库为 0 也拒；未知 kind 拒；`--out == --base` 有同路径守卫，重复跑幂等 |
| 独立验收 | `scripts/verify-service-package.mjs`（新增 119 行） | 11 项检查，退出码由**失败条数**决定，不是第一条红就早退——早退会把后面几项的检查静默掉。方向是双向的：清单说的每件事盘上要成立（存在/大小/摘要），盘上每个可执行文件也必须在清单里（`no-unlisted-payload` 挡的是旧产物混包这条唯一静默通道）。清单内路径常量必须写 `/`：Windows 上 `join` 给反斜杠，会把清单自己判成「盘上有但没登记」 |
| 包内 daemon 入口 | `npm/sacode-cli/bin/daemon.js`（新增 46 行） | 只 `require.resolve('<平台包>/package.json')` 再拼包内 `bin/sacode-daemon.exe`：不找全局 Host、不依赖仓库目录、argv 原样透传、不拼 shell。失败码按成因分立可诊断：78 平台不支持 / 79 解析不到平台包 / **82 平台包装了但包内 exe 缺失（提示该重跑 pack-service）** / 80 spawn 失败 / 81 无退出码。`SACODE_EXTJS_DIR`、`SACODE_HOST` 只在包内确实带着时才设 |
| 主包声明 | `npm/sacode-cli/package.json` | `bin` 增 `sacode-daemon`，`files` 与 bin 值集合一致。钉它的是 `scripts/sacode-naming.test.mjs` 里改成**穷尽比对**的那条断言（`deepEqual` 整张 bin 表 + 逐个入口名在品牌集内 + `files`↔bin 值集合相等）——写成「至少有一个」就钉不住品牌漂移与漏登记的入口脚本 |
| 不进包的东西 | 两份脚本的禁词表 | 身份/审计/幂等账/私钥按 **basename 后缀**判（`.pem .key .id .audit.log .ledger.jsonl .devices.json`），不按子串判：子串判会误杀 `sacode-daemon.exe`、`libstdx.crypto.keys.dll` 这类合法名字（本批 green1 就是一颗合法 DLL 被误杀红的） |

**真包直跑读数**（命令行手跑，不是测试夹具）：`node scripts/pack-service.mjs --out target/sacode-evidence-svc` **rc=0**，输出 `packed 93 个文件（可执行 3 + 运行期库 82 + 扩展宿主 7），清单 bin/service-manifest.json 对 gitSha 7f794c4`；`node scripts/verify-service-package.mjs target/sacode-evidence-svc` **rc=0**，11 项全 PASS，末行 `checks=11 failed=0 files=92` 与 `note platform=win32 arch=x64 gitSha=7f794c4…`。93 与 92 的差是口径不是漏登记：人话计数含清单自身，而清单按规则不登记自己。产物摘要（sha256 前 16 位）：daemon `d1ac60f2389419f0` / 11146240 B、host `d8375e67fc19b40c` / 11135488 B、cli `c9fbd9c8bc4235e9` / 10960384 B、`extjs/server.cjs` `d1bdd5660a2e1c85`；包内登记总量 58952903 B。

**计数与轨迹**（每一步红都留着——它们各自揭示一个缺陷，一次到位的绿反而是掩盖）：
- 红先：**tests 8 / pass 0 / fail 8，rc=1**。两种红形状：7 条 `Cannot find module 'D:\...\scripts\pack-service.mjs'`（被测脚本还不存在），第 8 条不需要被测脚本、红在声明面 `主包必须提供 daemon 入口，否则同包交付到此为止：{"sacode":"bin/cli.js"}`。
- green1（8 条）：#4 红 → 秘密禁用表原本按子串判，误杀合法运行期库；改成 basename 后缀判。
- green2（10 条）：#9 红、包装脚本 rc=79 → 夹具里没放平台包 `package.json`，`require.resolve` 走的是「平台包不存在」那一支；补夹具，并把 79 与 82 拆成两个码，让两种失败各有各的诊断。
- green3：**10 / 10 / rc=0**。加第 11 条（79 与 82 分立都要断言）后 green4：**11 / 11 / rc=0**。
- 最终回归（变异全部还原后）：**tests 11 / pass 11 / fail 0 / cancelled 0，rc=0**。

**变异反证（2 轮；P1 因测试自身假绿重跑过一次）**：

| 变异 | 施加 | 独占受害 | 读数与教训 |
| --- | --- | --- | --- |
| P1 | `verify` 里把 `secret-and-state-denied`、`file-digests`、`no-unlisted-payload` 三项改成无条件打 `PASS … MUTANT-P1-stub`；同轮 `daemon.js` 撤掉「平台包在但包内 exe 缺失」的 `existsSync` 守卫 | 期望 #3 / #5 / #6 / #11 | 首跑只红 **#5 + #11（pass 9 / fail 2）**——红得比预期少不是变异弱，是**测试自己假绿**：#3/#6 断言写成「输出里出现那个检查名」，而桩打的 PASS 行也含那个名，变异体反而满足了断言。改成只认 `^FAIL <检查名>`（多行锚定）后重跑 P1b：**pass 7 / fail 4** = {#3 篡改, #5 未登记二进制, #6 伪装密钥, #11 包装码}，与预期逐条对上。#11 的原文顺带给出撤掉 82 守卫后的真实退路：`装了包但缺 daemon 应回 82，实际 80：… sacode-daemon.exe ENOENT` |
| P1 的施加方式修正（不是第三条变异） | 篡改从「改文件长度」改成**等长字节翻转**（`0x63`→`0x43`） | #3 由 `file-digests` 独占 | 原方案下红的是 `file-sizes`，摘要检查等于没有受害用例。这也如实记下一条结构性事实：**`file-sizes` 本批没有独占受害者**——它是 `file-digests` 的更快子集，任何改长度的破坏都先被它接住，所以它的绿灯只能算冗余防线 |
| P2 | `pack-service` 只给 cli 条目写假摘要（`sha256("MUTANT-P2-not-the-real-payload")`），盘上字节与真实产物逐字一致 | #2「清单逐条摘要对得上，且摘要就是本轮构建产物」 | **pass 8 / fail 3** = {#2, #9, #10}。后两条属「验收必须通过」家族：包本身没坏，坏的是清单，凡是拿 verify 当放行门禁的用例一起红——这是期望内的连带而非遮蔽，因为 #2 是唯一由摘要检查自己点名的那条；而 #3 保持绿正是 P2 与 P1 的区别（P2 没动字节，P1 撤了字节检查） |

还原：`cp target/pack-service.mjs.bak scripts/pack-service.mjs` 后 `diff` 空输出（`pack-diff-rc=0`），三个被变异文件 `MUTANT` 标记计数 **0 / 0 / 0**（`pack-service.mjs`、`verify-service-package.mjs`、`npm/sacode-cli/bin/daemon.js`），还原后复跑最终回归即上面的 11/11 rc=0。

**本批明确没做到的（不缩范围，逐条记归属）**：
1. Linux 半全缺：`.so` 收集、ELF ABI 与可执行位、`readelf`/`ldd` 依赖核对、「缺库要响亮失败」都没做。本机无 Linux 环境且安装系统依赖不在本次授权范围 → **BLOCKED**（与下文任务 3-5 那条同源）。
2. 离线 `npm pack` / 干净安装态未走：#10 是在**合成的 node_modules 布局**里跑包装脚本，没有真出 tarball、没在无 SDK 无仓库的环境里装。`npm/sacode-cli-win32-x64/bin` 里是上一轮 pack-cli 的产物，本批只读它，没重验「装出来的包与本次源码摘要对应」。
3. 包内 Host 与扩展宿主只到「在包里且摘要对」：`sacode-daemon` 在包态经宿主跑一条真实方法没测（宿主侧那几个被并发会话持有的文件仍未落库）。
4. 顺带查到一条**提交态就存在**的 IPC 悬挂：`apps/desktop/preload.cjs`（HEAD 里）invoke `sacode:executionPropose`，而 HEAD 的 `main.cjs` 那 88 条 `ipcMain.handle` 没有它（HEAD 计数 0、工作区计数 0）。工作区里并发会话正以未入库的 `apps/desktop/execution-ipc.cjs` + `main.cjs`（+16/−273）用表驱动方式补这个 handler，注册形态是 `ipcMain.handle` 配模板串通道名，而那条命名测试只扫字面 `ipcMain.handle('…')`，所以工作区态与提交态**都红**。`scripts/sacode-naming.test.mjs` 全套 **tests 3 / pass 2 / fail 1**，唯一红即此条，且与本批新增的 bin/files 那条无关（本批那条为绿）。这条线的实现与测试扫描口径都不归本会话改，本批未碰、也未弱化那条断言。

### 批次 I：移动客户端接入逻辑层（Kotlin 编译 + 真 daemon TLS 互通）

先说清这一批**不是** Kuikly 工程：本机有 JDK 17（`openjdk 17.0.2`）与 Kotlin 2.3.20，但 `gradle`、`adb`、`ANDROID_HOME`/`ANDROID_SDK_ROOT` 全部缺失（当轮实测：`command -v gradle` 空、`adb` 不在 PATH、两个 SDK 变量 unset）。没有 gradle 就没有依赖解析通道，也没有 Kuikly 模板源集可冻结（任务 2 那条前提未兑现）。所以本批落的是**计划里命名的那批文件名的接入逻辑层**，用 kotlinc 直接编译成 class 后对着真 daemon 跑；三平台构建与真机验收按计划第 6 条记 BLOCKED，且这条告诫（「不用共享 Kotlin 测试冒充全平台支持」）在本批读数里逐字成立——**18 条全部是 JVM 单平台**。

| 落地面 | 位置 | 说明 |
| --- | --- | --- |
| 传输与证书绑定 | `apps/mobile/kotlin/sacode/SecureTransport.kt`（81 行） | `validatedBase` 只放 https，缺 scheme、带 userinfo 都拒（后者是凭据泄漏面）；`PinnedTrustManager` 按**服务端实际出示的叶子证书**算 SHA-256 与目标指纹比对，不看 CA 链——换一张受信 CA 签的证书也一样被挡。`fingerprintOfPem` 从 PEM 直接算，夹具与客户端用同一条算法，避免「夹具自己算错了却判客户端红」 |
| RPC 面 | `RpcClient.kt`（82 行）+ `Json.kt`（168 行） | 信封是 `{"jsonrpc":"2.0","id":N,"method":…,"params":…}`，归属字段（workspaceId/sessionId/operationId）并进 params 顶层。结果分三档：`Ok` / `Protocol(code,message)` / `Http(status,body)`。JSON 是自己写的递归下降解析器——没有 gradle 就没有库可引，而这一层将来进 Kuikly 也只依赖 stdlib+JDK，两边依赖面一致 |
| SSE 面 | `SseClient.kt`（107 行） | 先看状态码与 `content-type`，不是 200/不是 `text/event-stream` 就抛，**不把「连上了但一帧没有」当成功流**；`Last-Event-ID` 走请求头（与 daemon `requestHeader(ctx.request, "Last-Event-ID")` 同口径）；读循环在守护线程里投有界队列，`next(timeoutMs)` 给等待上界，EOF 出一帧 `close{reason}` |
| 凭据面 | `CredentialStore.kt`（63 行） | 票据→登记→兑换→只在内存持有 Bearer，过期后 `bearer()` 抛。异常里只带 HTTP 状态，**不带响应正文**：登记响应正文就是那 32 字节凭据明文，拼进错误消息等于把凭据写进日志 |
| 目标与迟到数据 | `TargetStore.kt`（73 行） | `failoverCandidateFor` 恒回 null 是产品裁决而非空缺：允许用户显式切换，禁止故障后自动换目标（会话不迁移）。`EpochGate` 按连接代次丢旧帧 + 同代次重复游标也丢 |
| 必填字段 | `SessionModel.kt`（77 行） | 照 daemon 的**线格式**读：条目是 `id`/`durable`/`status`（必填，缺失或类型不符即抛）、`title`/`workspaceDirectory`（可选才默认空串）。审批面只认工单号：`approvalId` 缺失拒、决策值不在 approve/deny 闭集拒、带自报审批串直接抛 |
| 交付验证夹具 | `apps/daemon/test/remote-mobile-client.test.mjs`（213 行）+ `apps/mobile/kotlin-test/sacode/TlsProbeServer.kt`（67 行） | Node 侧出证书、算指纹、起 TLS daemon、`--manage enroll-ticket` 建票、调 kotlinc 编译、跑 JVM，再按 `^PASS/^FAIL` 计数；**用例名集合逐条比对**（只比条数的话删掉一条 check 也能过）。`TlsProbeServer` 是本机 HTTPS 服务，用来直读客户端真发出去的 `Last-Event-ID`/`Authorization` 头 |

**三条实测到的契约事实**（都是从真 daemon 拿的，不是文档推断）：
1. `/rpc` 上的认证拒绝是 **HTTP 200 + JSON-RPC error `-32001`**（`authz-denied:missing-bearer`），不是 401；未登记方法同样落在 `-32001`（`method-not-registered`），**不是 -32601**。我最初按 401/-32601 写的三条断言当场红，改成照真实契约归因——客户端如果把这条读成「HTTP 层不通」就会去重连，而缺的是认证。
2. `initialize` 回的仍是 `"protocolVersion":"0.1"`（capabilities 三条：initialize/session/catalog/session/events）。计划与批次 G 的措辞按 0.2 显式归属走，**宣告位还没跟上**，本批没改 daemon 侧（该面正被并发会话持有），只在此记录。
3. `session/catalog` 请求不带 `workspaceId` 时吃到 `authz-denied:workspace-required`，而**回的条目里没有 `workspaceId`**（是 `root` + `entries[{id,title,durable,status,workspaceDirectory,current}]`）。请求侧归属键与响应侧条目字段不对称，客户端必须按各自名字读；这条不对称正是「Host 侧接受 0.2 显式归属字段」那条在飞项的具体形状。

**计数**：
- 红先：只编测试主文件（实现未进编译单元）→ `unresolved reference` 分布为 `SecureTransport` 12 / `SessionModel` 8 / `RpcResult` 7 / `RpcClient` 6 / `Json` 6 / `validatedBase` 4 / `ApprovalDraft` 4 / `TurnOps` 3 / `SseClient` 3（另有 `status`/`result`/`greeting` 各 2 条，是被这些类型的智能链拖累的次生错误）。这条流水线唯一可行的红灯就是「新命名的符号未声明」，形状与批次 G 一致。
- 中间读数（三轮，每轮都留着）：第一次真 daemon 联跑 **3 红**（上面事实 1、3 造成的期望错）；改成线格式后 **1 红**（`响应缺字段 sessions` → 事实 3 的 `entries`）；修完 **18/18 全绿**。**这三条红全是客户端的期望错，不是 daemon 拒服务**——所以每次红都先去看服务端实际回了什么再改断言，没有一条是靠放宽断言消掉的。
- 绿：`node --test apps/daemon/test/remote-mobile-client.test.mjs` **tests 2 / pass 2 / fail 0，rc=0**，且连跑两次复现（第二次是修收尾缺陷后）；Kotlin 侧 **18 条 PASS、0 FAIL**，用例名集合与夹具内 `EXPECTED` 逐条相等。
- 全量远程 Node 回归（9 个文件）：**tests 66 / pass 66 / fail 0 / cancelled 0 / skipped 0，rc=0**（批次 G 基线 64 + 本批 2）。
- 被测 daemon 二进制**本批未重编**：`apps/daemon/target/release/bin/main.exe` 11146240 B，mtime 12:07，md5 `31793519fb187702ee6472aaec5bed7b`——就是批次 G 那次 `cjpm build` 的产物。取证态为工作区态（编译里含并发会话未落库的 core 与 host_proxy 改动），但本批 Kotlin 侧不依赖那些改动：它只走 HTTP/TLS 面。
- 工具链读数：`java -version` = openjdk 17.0.2；`kotlin -version` = 2.3.20-release-208；编译走 `java -cp <kotlinHome>/lib/kotlin-compiler.jar org.jetbrains.kotlin.cli.jvm.K2JVMCompiler`（不经 `.bat`，Node 侧可无 shell 调用）。Kotlin home 与 daemon、openssl、SDK DLL 目录一样是**可被环境变量覆盖的本机默认值**（`SACODE_KOTLIN_HOME`/`SACODE_JAVA`/`SACODE_DAEMON`/`SACODE_OPENSSL`）。

**变异反证（2 轮 × 4 变异，各一条独占受害）**：

| 变异 | 施加 | 独占受害 | 读数 |
| --- | --- | --- | --- |
| M1 | `validatedBase` 的 https 判定改成只拒 `ftp`（即明文照放） | `plaintextBearerIsRefusedBeforeAnyRequest` | R1 该条红：`应当拒绝，却放行通过：http:// 也必须过 validatedBase` |
| M3 | `SseClient.open` 里 `Last-Event-ID` 头改 `if (false)` 不发 | `sseResumeSendsLastEventIdOverTheWire` | R1 该条红：`Last-Event-ID 要真在请求头上，实得 null`——这条红的来源是探针直读，不是自证 |
| M7 | `failoverCandidateFor` 改成返回另一台目标 | `noAutoFailoverToAnotherTarget` | R1 该条红：`故障时不许自动换到另一台目标` |
| M8 | `StoredCredential.toString` 把 `<redacted>` 换成真令牌 | `credentialStoreNeverSerializesTheToken` | R1 该条红，且失败原文里真的把 64 位令牌打印了出来（这条日志在 gitignore 的 `target/` 里，**证据文档不粘贴其内容**）——正因为打印了，这条断言才有牙 |
| R1 合计 | — | — | `tests 2 / pass 1 / fail 1`，Kotlin 侧 **恰好 4 条 FAIL**，与四个变异一对一，无越界红 |
| M2 | `PinnedTrustManager` 的指纹比对改 `if (false)`（信任任何证书） | `pinMismatchAbortsTheHandshakeInsteadOfFallingBack` | R2 该条红。其余 TLS 用例保持绿是**期望内**的：它们本来就用正确指纹，撤比对不会让它们变红 |
| M4 | `requiredString` 缺字段时返回空串 | `requiredFieldsAreRejectedNotDefaulted` + `sessionCatalogEntriesParseWithExplicitOwnership` | 两条红属同一变异（后者是我为「目录真是空的」准备的夹具对照），写明不遮蔽 |
| M6 | `EpochGate.accepts` 的代次判定撤掉 | `lateFramesFromOlderEpochAreDropped` | R2 该条红：`旧 epoch 的迟到帧要丢` |
| M9 | `ApprovalDraft` 的自报审批串守卫改 `if (false)` | `approvalAnswerUsesTicketIdOnly` | R2 该条红：`自报审批字符串没有通路` |
| R2 合计 | — | — | Kotlin 侧 **5 条 FAIL = 4 个变异**（M4 两条），其余 13 条保持绿 |

施加方式：变异由 `target/apply-mutants.mjs` 做**唯一命中**的字符串替换（任一条命中数不是 1 就整体退出），每条都带 `MUTANT-R<n>-M<x>` 注释；只用于破坏实现，不用于写实现。还原：`cp` 六份 `.bak` 回去后逐文件 `diff` 空输出、`grep -rc MUTANT apps/mobile/kotlin/sacode/` 无带标记文件，还原后复跑即上面的 2/2 rc=0。

**本批明确没做到的（不缩范围，逐条记归属）**：
1. Kuikly 工程本体（`ConnectionsPage.kt`/`WorkspacePage.kt`/`ApprovalPage.kt`、`SecureTransportModule`/`CredentialStoreModule` 的 Kuikly 侧接线）与 Android/iOS/鸿蒙真实构建、真机执行：**BLOCKED**。缺 gradle、Android SDK、iOS/鸿蒙工具链与设备；安装系统依赖不在本次授权范围。本批的 JVM 读数不代替这条。
2. Kuikly `NetworkModule` 的 JSON 字节与 header 能力未验证（同上前缺失），所以计划里「RPC 优先使用 NetworkModule」那条仍空。
3. 移动侧完整方法面：119 条契约里 Kotlin 只铺了 `initialize`/`session/catalog` 与审批/取消的**参数面**，其余家族未接；页面层没有，UI 入口证据也无从标。
4. 幂等与恢复在移动侧未接：客户端待发 id 那套此前只有 Node 桌面实现，Kotlin 侧没落；设备撤销后的移动侧重连行为、审批竞态、后台/前台恢复三条未验。
5. 会话视图、断网恢复/重新认证、后台前台恢复（计划第 3 条的 UI 半）未做。
6. 收尾缺陷是我自己的夹具：第一次真联跑 18 条全过、整条用例却因为 `rm` 撞 `EBUSY` 而红（daemon 的 cwd 就是那份临时目录，`kill` 是异步的）。已改成 kill→有界等 close→带 EBUSY 重试的删除，并连跑两次确认可复现，而不是把清理步骤删掉了事。

### 批次 J：远程执行门禁与执行宣告（任务 4 的 Windows 半，走计划第 3 条的「拒绝」分支）

**口径**：计划 §4 第 3 条给的是二分叉——「核验得出文件/网络隔离能力，就把 enforcement 报成真的」或「核验不出，就**拒绝远程执行并登记 BLOCKED，而不是只改 enforcement 字符串**」。本批走第二分支。

**核验结论（先于实现）**：全仓 `core/src` 与 `apps/*/src` 对 `CreateJobObject`/`JOB_OBJECT` grep **零命中**；`core/src/sandbox.cj` 的 `SandboxRuntime.confine` 只做档位字符串闭集校验（`read-only`/`workspace-write`），然后 `return argv` —— 原样退回，没有任何 OS 级约束包裹。所以 Windows 侧当前的执行面 = 无隔离，`enforcing` 必须是 false。

**落的实现（`apps/daemon/src/remote_sandbox.cj` 新增）**：

- `confineRewritesArgv()`：**行为探针**，真的拿 `["sacode-probe","--flag"]` 去问 `SandboxRuntime().confine(...)`，逐项比对输出与输入是否逐字相同；`confine` 抛异常（`withoutBackend()` 那一档）也如实回 false。`enforcing` 的值只从这里来，不写死——将来接了 `sandbox-exec`/`bwrap`/Job Object + 受限令牌，探针自己翻 true，宣告位和门禁同时跟着变。
- `refusalReason(permission, enforcing)`：只按**权限类别**判定，类别由 `core/src/remote_authorization.cj:151` 的 `specOf(method).permission` 给出（那张表就是从 `docs/plans/remote-capability-contract.json` 装进来的）。daemon 里**没有第二份 execute 方法名单**可以漂移。
- `RemoteSandboxEnforcement.current()/toJson()`：`mode`、`enforcing`、`limitations` 三项；限制清单在两种结局里都保留 `no-file-system-isolation`、`no-network-isolation`、`no-namespace-or-seccomp-backend`——规格 §7 明写 seccomp/Job Object 单独都不构成路径与网络隔离，所以将来接了进程/资源治理也不能抹掉前两条。
- `remote_gate.cj`：认证通过、拿到 context 之后，**在 scope/归属判定与建幂等账之前**插入拒因判定，命中即 `recordDenied(...)` 落审计并回 `GateOutcome(false, refuse, ctx)`；未认证的请求仍只拿 `missing-bearer`，门禁不提前泄露策略差异。
- `daemon.cj` 的 `initialize`：宣告体新增 `instanceId`（取当前 gate 的）与 `sandboxEnforcement`（取同一个探针），客户端不用「试了才知道这台目标能不能远程跑代码」。

**红先**：先写 `apps/daemon/src/remote_sandbox_test.cj`（6 个 `@Test`），实现未落时 cjpm 报 `undeclared identifier 'RemoteSandboxEnforcement'`，**17 errors generated, 8 errors printed**——这条流水线唯一可行的红灯。

**绿读数（还原后，工作区态）**：

| 入口 | 命令 | 结果 |
| --- | --- | --- |
| 仓颉 daemon 副本单测 | `apps/daemon` 下 `cjpm test --target-dir target/j-m2-td`（TMP 每轮唯一且**先建目录**） | TOTAL **155** / PASSED **153** / FAILED **2** / ERROR 0，rc=1；2 条红是 `scopeGrantSurvivesSnapshotRoundTrip` 与 `gatePassesDeviceScopeIntoAuthorizationSoManagementMethodIsReachable`，属并发会话那条线（本批未改那两个文件），三轮变异里它们恒为红且与本批受害用例不相交 |
| 真 HTTP 门禁面 | `node --test apps/daemon/test/remote-execution-gate.test.mjs` | tests **5** / pass **5** / fail 0，rc=**0** |
| 完整远程套件（串行） | `node --test --test-concurrency=1 --test-timeout=120000 apps/daemon/test/remote-*.test.mjs`（10 个文件） | tests **71** / pass **71** / fail 0 / cancelled 0 / skipped 0，rc=**0**（66 条批次 I 基线 + 5 条本批新增，分母对上） |

**变异反证（三轮，逐条指定受害）**：施加器 `target/apply-j-mutants.mjs`（gitignore 的 scratch，每条锚点要求唯一命中，命中数≠1 就整体退出）。N1 与 N2 会互相遮蔽（N1 把判定表改成恒放行后，N2 改探针就不可观察），所以**必须分轮**。

| 轮 | 变异 | 指定的受害用例 | 实测 |
| --- | --- | --- | --- |
| J1 | N3 限制清单删掉 `no-network-isolation` | cj `limitationsNameFileAndNetworkExplicitly` + Node 第 4 条（宣告要点名网络隔离） | cj FAILED 4（2 受害 + 2 外来红）、Node fail 3 |
| J1 | N4 `toJson()` 不输出 `limitations` | cj `enforcementJsonAnnouncesModeEnforcingAndLimitations` + Node 第 4 条 | 同上（同轮合并施加，Node 第 4 条为共享受害） |
| J1 | N6 拒绝时审计拒因写成空串 | Node 第 5 条（审计要记拒因） | Node fail 3 里含第 5 条 |
| J1 | N7 门禁挪到认证之前 | Node 第 3 条（未认证只拿 `missing-bearer`） | Node `not ok 3`， cj 无对应受害（该不变量只在 HTTP 面可观察） |
| J2 | N1 `refusalReason` 恒回空串 | cj `executePermissionWithoutEnforcementIsRefused` + Node 第 1/4/5 条 | cj FAILED 3（1 受害 + 2 外来）、Node fail 3；第 3 条按预期**保持绿**（放行路径不影响认证归因），说明受害集不重叠 |
| J3 | N2 `confineRewritesArgv()` 第一行写死 `return true` | cj `enforcementValueComesFromBehaviorNotAConstant` + `enforcementJsonAnnouncesModeEnforcingAndLimitations` + Node 第 1/4/5 条 | cj FAILED 4（2 受害 + 2 外来）、Node fail 3；第 2/3 条绿 |
| 还原 | `cp target/remote_sandbox.cj.bak`、`cp target/remote_gate.cj.bak` | — | 两次 `diff` 均 rc=**0**，`grep -c MUTANT` 两个文件都 **0**，随后回绿（上表） |

**本批我自己造成的三次无效读数（不写成变异结果）**：三次把 `TMP/TEMP/TMPDIR` 指到 `target/j-tmp3`、`target/j-tmp5`、`target/j-tmp9` 却**没有先 `mkdir -p`**，cjpm 直接 `error: Temporary directory path set by environment variable (TMP) does not exist.` 退出——日志无 Summary、rc 非零。其中最后一次（还原后的绿轮）最危险：build 失败后 Node 那条打的还是上一轮带 N2 变异的旧 exe，读数与 J3 完全一样，若我拿它当「还原回绿」就是假绿。改法是 launch 前 `mkdir -p` + `test -d` 断言，并在链路里把 build/test 的 rc 逐个打印，缺目录就停而不是继续跑。

**并发会话干扰（一次作废重跑）**：J1 首轮重编时构建失败于 `core/src/lease.cj:122` 报 `'substring' is not a member of struct 'String'`——并发会话写进 core 的一行编不过，非本批文件。当轮 Node 用的是旧 exe，我按「红集合越出目标模块即不归因」把它作废，等对面推进后重编（13:19 构建成功）再重跑 J1，才是上表读数。

**收尾缺陷（本批发现的测试侧真问题，已改）**：并行跑 10 个远程文件时整套**冻住 13 分钟不动**，进程树取证显示卡的是本批 `remote-execution-gate.test.mjs` 的 child，它名下的 daemon（PID 4284，父 PID 正是该用例进程）仍活着。根因是我这个文件的两处无界 await：teardown 的 `await new Promise(resolve => proc.on('close', resolve))`（Windows 上 `'close'` 还要等 stdio 句柄全关，可能永远不来）与 `createTicket` 同款；另外 `boot()` 写在 `try` 之外，它自己失败时留下的孤儿 daemon 与临时目录不会被收。批次 I 我给 `stopDaemon` 加过有界等待，批次 J 反而退回旧写法。改法：`waitForExit` + 4s 有界轮询、超时升级 `SIGKILL`、`removeDir` 补 `ENOTEMPTY`、`boot` 纳入 `try/finally`，并对批次 I 那份 `createTicket` 做同样收口。**同形状隐患仍在本目录其余 8 个文件里**（`remote-auth`/`remote-events`/`remote-idempotency`/`remote-method-surface`/`remote-request-limits`/`remote-sse-recovery`/`remote-tls`/`team-host` 各有 `on('close')` 无界 await），本批不越界去改别批的文件，改用 `--test-concurrency=1 --test-timeout=120000` 取整套读数，并把这条记进下面的在飞表。

**本批明确没做到的（不缩范围）**：
1. 计划 §4 第 1 条那五类**真实子进程越权用例**（读凭据目录、写工作区外、未授权网络、fork/resource 超限、取消后逃逸进程）没写。在没有强制后端的现在，五条只会红在同一个原因上，区分不出 provider 行为；等接了后端才有可归因的红。本批只钉住了这条的**前提**——`confine` 原样传回 argv 这一事实被探针读出并驱动门禁。
2. Linux 半（namespace/mount/seccomp/资源/进程树组合、`sandbox_linux.cj`）：**BLOCKED**，理由与探针证据见 `docs/evidence/2026-10-10-remote-platform-baseline.md` §1（退出码 1，SDK 里没有 `modules/linux_x86_64_cjnative`）与 §2（官方矩阵不含 Windows→Linux）。
3. **传递性执行缺口**：`session/submit` 在契约里标的是 `write`，不在执行门禁的拒止面内；但它落到宿主后会驱动一轮 Agent，进而可能触发工具执行。也就是说「远程提交的会话 turn」这条路径目前绕过了 execute 门禁。关掉它需要在工具执行边界（`host_proxy.cj`/宿主侧）按 `enforcing` 二次判定，而 `host_proxy.cj` 正被并发会话持有未提交改动，本批不动。这一条是本批留下的最大真实风险，写成在飞行而非「已完成」。
4. 审批绕过那半只有**结构性**保证（拒发生在 gate 里、建账与转宿主之前，`approval/*` 属 approval 类别且位于门禁下游，没有放行 execute 的通路），没有反证用例——因为要反证就得先有能跑的执行面。

## 在飞未完成

| 范围 | 位置 | 阻塞项 |
| --- | --- | --- |
| 身份/审计/授权 3 模块 core 侧 cjpm test 链接 | core/src 单测副本仍在（738b829 + e572a78 修好），本会话无法在 40 分钟内出 unittest_bin/core.exe | **绕过**：e572a78 把同一批测试以 `package daemon + import core.*` 副本落到 apps/daemon/src/，`cjpm test --target-dir daemon-fix` 5 分钟出 **TOTAL 34 / PASSED 34 / FAILED 0 rc=0**，运行验证已到手。core 侧原路径未删，若未来链接段解锁可再直接跑；本轮记 BLOCKED（非 FAIL）。 |
| 设备凭据轮换，以及认证 RPC 管理面 | `--manage list-devices`/`revoke-device` 与 `RemoteIdentityStore.listDevices`/`revokeDevice`/`refreshFromDisk` 已入库（92d565b），撤销关闭在途 SSE 已在批次 F 落地（`EventBus.closeFor` + 空闲 tick 重认） | 仍缺：**HEAD 里**`remote_identity.cj` 无按 deviceId 轮换凭据的公开方法；契约里的 `auth/devices`/`auth/revoke` RPC 面未接。属任务 7 授权分派。2026-10-10 04:00 复核：工作区已出现 `rotateCredential` 与 `remote_identity_scope_test.cj`（前者 +62 行未提交、后者未入 HEAD，同属并发会话那条线，且该文件两条用例当轮为红），本会话未改这两个文件，故这条**不判已交付**。 |
| §7 请求结构上界里的 Host 头校验 | `apps/daemon/src/remote_schema.cj` 只判深度、方法名形状、批量与 Origin | 深度 32、方法名 1..64 字节加字符集、batch 与通知显式归因、Origin 出现即拒已在批次 G 落地；**Host/DNS rebinding 校验未做**，缺一个「本实例允许被哪些主机名访问」的配置面（`--bind` 只有地址没有主机名）。与 `auth/devices` 管理面同批补。 |
| §6 逐帧授权过滤与补读去重的生产通路 | `apps/daemon/src/sse_frames.cj` 的 `idOf`/`delivered` 分支 + `daemon.cj` 的 `/sse` | **未兑现**：真实宿主的通知帧不带持久 `seq`，去重分支在真机上不命中；逐帧资源过滤要求通知自带归属键。两条都卡在被并发会话持有的 `host_proxy.cj`/`apps/host/src/main.cj`（任务 7）。分支语义已由 cj 单测钉住，宿主打上 seq 后即可兑现。 |
| 远程方法面已铺到 98 条，但**每条的真实语义闭环**未逐面验 | `host_proxy.cj` 的白名单 + `remote-method-surface.test.mjs` 只端到端抽了 `tips/get`/`model/list`/`credential/set` 三条代表 | 其余家族（`lsp/*`、`worktree/*`、`execution/*`、`plugin/*`、`custom/*` 等）目前只有静态对账与 宿主侧既有测试；且转发过去的方法仍按 0.1 的 `session/select` 全局态执行——daemon 已把 params 顶层的 workspaceId/sessionId/operationId 交给 gate，但宿主是否按这份显式归属定位会话属任务 7 剩余（下一批）。 |
| `session/events` 持久补读面 | 已落地：`apps/daemon/src/event_replay.cj` + `daemon.cj` 分派支 + 契约锚点实名 + `remote-events.test.mjs`（批次 E） | 不再是「锚点不存在的转发候选」；能力宣告与补读作答都由 daemon 本人负责，宿主侧不出现该方法。 |
| Host 侧接受 0.2 显式归属字段 | `apps/host/src/main.cj` 由并发会话持有未提交改动 | daemon 已按 params 顶层取 workspaceId/sessionId 并交给 gate，但被转发方法是否真按该归属执行，属任务 7（唯一实例与显式会话路由）。 |
| 任务 5 的 Linux 半与「发布态」验证 | `scripts/pack-service.mjs` + `scripts/verify-service-package.mjs` + `npm/sacode-cli/bin/daemon.js`（Windows 半见批次 H） | 未做且非缩水：① Linux 收 `.so`、ELF ABI 与可执行位、`readelf`/`ldd` 依赖核对——本机无 Linux 且装系统依赖不在本次授权范围，**BLOCKED**；② 真出 tarball 并在剥 SDK、无仓库的环境里 `npm install` 后逐子命令跑——本批的合成 node_modules 布局只验了包装脚本的解析与失败码；③ 包内 Host/扩展宿主的端到端一条方法调用。**FAIL/BLOCKED 分档：① BLOCKED，②③ 未做。** |
| 任务 10 的 Kuikly 工程与三平台真实运行 | `apps/mobile/kotlin/`＋`apps/mobile/kotlin-test/`＋`apps/daemon/test/remote-mobile-client.test.mjs`（批次 I 落的接入逻辑层） | **BLOCKED**：本机有 JDK 17 与 Kotlin 2.3.20，但缺 gradle、`ANDROID_HOME`/`ANDROID_SDK_ROOT`、`adb` 与真机/模拟器，iOS 与鸿蒙工具链也没有。缺 gradle 就没有依赖解析通道，Kuikly 模板源集路径无从冻结（任务 2 前提未兑现），所以计划命名的 `ConnectionsPage.kt`/`WorkspacePage.kt`/`ApprovalPage.kt` 与 `SecureTransportModule`/`CredentialStoreModule` 的 Kuikly 侧接线仍未落。批次 I 的 18 条**全是 JVM 单平台读数**，按计划第 6 条的告诫不冒充三平台。解锁动作：装 gradle + Android SDK（需另行授权）或提供已配好的 Kuikly 工程路径。 |
| daemon 宣告的 protocolVersion 仍是 0.1 | `apps/daemon/src/daemon.cj` 的 `initialize` 结果位（实测回 `"protocolVersion":"0.1"`） | 批次 I 真机读数记录的不对称：请求侧已按 0.2 的显式归属（params 顶层 workspaceId/sessionId/operationId）被 gate 检查，但**宣告位没跟上**，capabilities 仍只列三条。改这一处会同时影响 `remote-capability-contract.test.mjs` 与桌面/CLI 两个客户端的版本协商，且该文件正被并发会话持有，本批未动。属任务 7 编号对齐（与 `docs/plans/sacode-product-interfaces` §8 编号待对齐同源）。 |
| 执行门禁的传递性缺口：`session/submit` 能绕开它 | 契约 `docs/plans/remote-capability-contract.json` 里 `session/submit` 的 permission 是 `write`（批次 J 实测：`execute` 一族恰 8 条，不含它）；拒判只发生在 `apps/daemon/src/remote_gate.cj` 的请求入口 | **未闭合**。远程提交的一轮会话在宿主侧仍可能驱动工具执行，而那条路径不经过 execute 类别判定。要关它得在工具执行边界（`host_proxy.cj` 与宿主侧）按 `RemoteSandboxEnforcement.current().enforcing` 二次判定——这两个文件正被并发会话持有未提交改动，批次 J 不动。解锁动作：等其落库后按同一探针取值加边界判定，并补一条「无强制后端时远程 turn 里的工具执行被拒」的真 HTTP 用例。 |
| 远程套件并行跑会冻住（无界 `on('close')` await） | `apps/daemon/test/` 下 `remote-auth`/`remote-events`/`remote-idempotency`/`remote-method-surface`/`remote-request-limits`/`remote-sse-recovery`/`remote-tls`/`team-host` 各有至少一处 | 批次 J 只收口了自己新增的 `remote-execution-gate.test.mjs` 与批次 I 的 `remote-mobile-client.test.mjs` 两个文件（改成有界轮询 + `SIGKILL` 升级 + `boot` 纳入 finally），其余 8 个文件同形状隐患**未动**，因为它们是别批的文件。当前取整套读数的可行口径是 `--test-concurrency=1 --test-timeout=120000`（批次 J 用这个拿到 71/71 rc=0），并行默认跑法则不确定能否收尾。 |


三份未提交源码已通过**编译阶段**（同一次 cjpm test 里 cjc 已打印 158 warnings，其中包含 remote_*.cj 的 unused-variable 提示）；未通过的仅是**链接和运行**。→ 由 e572a78 走 daemon 副本达成运行验证；core 侧链接段仍记 BLOCKED（40 分钟未落 unittest_bin/core.exe），解锁条件是 cjpm 侧根因排查或换机器。

## 后续批次依赖

- 任务 6 daemon 认证与接入生命周期：需 remote_identity/authorization/audit 三模块跑绿再动工，避免签名返工。
- 任务 8 服务端幂等 + 授权 SSE + 恢复：客户端面已交付（d66aae8/34b5cfe），服务端面依赖任务 6。
- 任务 9 桌面本机接入开关 UI：目标存储/传输/桥三层已交付，preload IPC 通道 5 条待与 main.cjs handler 同步加。
- 任务 10 Kuikly 移动客户端：本仓 `AgentLink.kt` 与 `validatedBase()` 均未直读；路径、协议错位与 approve/cancel 缺口属用户提供的外部证据。
- Linux 移植（任务 3-5）：Windows SDK 不支持交叉编译 Linux，需要 WSL2/Linux 主机/Docker；本机无 Linux 发行版注册（REGDB_E_CLASSNOTREG），且系统依赖安装不在本次授权范围。**BLOCKED**。

## 已知阻塞与解锁动作

| 阻塞 | 解锁动作 |
| --- | --- |
| cjpm test 链接段无 Summary 且时长 >30 分钟 | 观察至 60 分钟；届时按死锁处理：kill 后改分模块 `cjpm build` 拿库层通过，再走 `cjpm test --target-dir` 私有目录单跑一次 |
| 本机 WSL2 未装 Linux 发行版 | 用户执行 `wsl --install -d Ubuntu`；本会话不安装系统依赖 |
| OS 沙箱强制后端缺失（远程 execute 族整族拒绝中） | 批次 J 的拒绝是**当前构建的终态**而非临时脚手架：`SandboxRuntime.confine` 原样退回 argv、全仓无 Job Object 用法。解锁动作按平台分两条——Windows：把 provider 换成 Job Object + 受限令牌 + 显式 ACL 的工作区挂载，且 `confineRewritesArgv()` 探针要能翻成 true 才算（只改 `enforcing` 字符串等于没做，本批的 N2 变异就是钉这一点的）；Linux：`sandbox_linux.cj` 的 namespace/mount/seccomp/资源/进程树组合，前提是先有一台 Linux 或 WSL2 发行版。两侧都要补计划 §4 第 1 条的五类真实子进程越权用例。 |
| Kuikly 移动工程定位与三平台构建 | 用户提供外部 Kuikly 工程绝对路径；或授权本仓在 `apps/mobile/` 建 Kuikly 工程**并**安装 gradle + Android SDK（2026-10-10 批次 I 实测：JDK 17 与 Kotlin 2.3.20 已在位，`gradle`/`adb`/`ANDROID_HOME`/`ANDROID_SDK_ROOT` 全缺）。接入逻辑层已按批次 I 落并跑绿，缺的是工程本体与真机 |
