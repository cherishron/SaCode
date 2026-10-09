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
**daemon Node 侧**：`remote-capability-contract` **12/12** + `remote-auth` **15/15** rc=0。
**daemon Cangjie 侧**：`cjpm test` **TOTAL 58 / PASSED 58 / FAILED 0 rc=0**
（身份 11 + 审计 6 + 授权 12 + gate 8 + 归属净化 3 + 分派接线 3 + 引导面/限速/配置 15）。

## 在飞未完成

| 范围 | 位置 | 阻塞项 |
| --- | --- | --- |
| 身份/审计/授权 3 模块 core 侧 cjpm test 链接 | core/src 单测副本仍在（738b829 + e572a78 修好），本会话无法在 40 分钟内出 unittest_bin/core.exe | **绕过**：e572a78 把同一批测试以 `package daemon + import core.*` 副本落到 apps/daemon/src/，`cjpm test --target-dir daemon-fix` 5 分钟出 **TOTAL 34 / PASSED 34 / FAILED 0 rc=0**，运行验证已到手。core 侧原路径未删，若未来链接段解锁可再直接跑；本轮记 BLOCKED（非 FAIL）。 |
| 登记秘密的**创建与确认**入口（任务 6 剩余） | 设计 §4.2 要求「目标端本地管理入口创建一次性登记秘密」，且网络面限定只有 `/auth/enroll` + `/auth/token` | `RemoteIdentityStore` 目前只在 daemon 进程内存里，`createEnrollmentSecret` 没有可从 daemon 之外触达的本地入口。因此 HTTP 面只能验「未知票据 401 / 413 / 429」，**端到端登记→兑换→Bearer 通过的正面链路只在 Cangjie 侧 `tokenExchangeThenBearerPassesGate` 证过**，HTTP 端到端仍缺。解锁需要先定身份存储的持久化与跨进程可见性方案（不能塞第三个网络端点，也不能靠环境变量传秘密）。 |
| 每设备 8 并发 RPC / 2 条 SSE、实例 64 条 SSE、请求头与体 10 秒超时 | 设计 §7 限额，`remote_access.cj` 已落 16KiB 认证体与来源限速 | 并发与超时计数尚未接入 daemon 路由；`ServerBuilder` 侧超时项需核实 stdx 能力后决定是配置项还是自计。 |
| Host 侧接受 0.2 显式归属字段 | `apps/host/src/main.cj` 由并发会话持有未提交改动 | daemon 已按 params 顶层取 workspaceId/sessionId 并交给 gate，但被转发方法是否真按该归属执行，属任务 7（唯一实例与显式会话路由）。 |


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
| Kuikly 移动工程定位 | 用户提供绝对路径，或明确同意本仓新建 `apps/mobile/` |
