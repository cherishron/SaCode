# 2026-10-10 计划未勾项推进性审计

审计对象：`docs/superpowers/plans/2026-10-10-unified-remote-mobile.md`。
计数与时间戳取自本批提交前一刻的工作区读数，不复用旧批次口径。

## 0. 分母

```
$ grep -c '^- \[ \]' docs/superpowers/plans/2026-10-10-unified-remote-mobile.md   → 70
$ grep -c '^- \[x\]' docs/superpowers/plans/2026-10-10-unified-remote-mobile.md   → 7
```

7 项已勾（任务 1/6/6/4 各若干小条与 4 项「授权后提交」），70 项未勾。审计按未勾行做四档分类。

## 1. 分类判据

四档，互斥，每条未勾项只入一档：

- **A. 独立可推进**：改法完全落在本目标自有文件（`apps/daemon/src/daemon.cj` 未改文件 + `docs/plans/*` + `docs/evidence/*` + 新增 `apps/daemon/test/remote-*.test.mjs`），改完有明确测试命令能自证。**当前会话能做**。
- **B. 等并发会话**：改法需要的文件正被另一会话持有且是硬依赖（不是「顺手一起改一下」，是「不改它这一步走不通」）。本会话能做的只是把解锁动作写清楚。
- **C. 环境阻塞**：无论谁改源码，本机都跑不出证据——缺 Linux 发行版、缺 Android SDK、缺真机/模拟器、缺 npm publish 授权。取证动作本身也拿不到。
- **D. 用户/授权阻塞**：需要用户提供信息或明确授权才能推进（AgentLink 工程路径、Android SDK 安装、发布权限、公网证书）。

A/B 是「等谁的时机」的问题，C/D 是「时机到了也未必解锁」的问题。

## 2. A 档（独立可推进）

### A1. 计划第 71 行的另一半：`protocolVersion` 从 0.1 升到 0.2

- **计划原文**：「冻结 0.2 请求归属、幂等、身份、事件 schema；定义旧 0.1 拒绝方式……」
- **当前状态**：批次 Y 已把四组 schema 逐字段与规格对齐并指出失败项，但**「定义旧 0.1 拒绝方式」这一半整条不成立**——`apps/daemon/src/daemon.cj:410-411` 硬编码 `"protocolVersion":"0.1"`，全仓 grep 不到任何版本协商或拒绝分支。
- **改法**：`daemon.cj` 里改两处——
  - `initialize` 结果字面量把 `"0.1"` 改成 `"0.2"`（单行）；
  - 在 `dispatchRpc` 或 `handleRpc` 入口读 params 顶层的 `protocolVersion`，非 `0.2` 或缺失即回 `-32004 protocol-version-mismatch`。
- **测试**：新增 `apps/daemon/test/remote-protocol-version.test.mjs`（三档：0.2 通过、0.1 拒绝、缺失拒绝）。
- **风险**：客户端（Kotlin/桌面/CLI）目前不传 `protocolVersion`，门禁一开全线挂。所以**必须**同步把 `apps/mobile/kotlin/sacode/RpcClient.kt` 与 `apps/desktop/target-bridge.cjs` 与 `npm/sacode-cli/bin/daemon.js` 的 `/rpc` 请求体各加一行 `"protocolVersion":"0.2"`。
- **A/B 分档说明**：这一步**看起来是纯 A**，但严格算 B——因为门禁落地后要验证，得跑 `apps/daemon/test/remote-*.test.mjs`，而那要真 daemon 二进制；`apps/daemon` 依赖 core（`cjpm.toml` 里 `core = { path = "../../core" }`），core 里有 20+ 个并发会话持有的源文件（`core/src/*.cj` 见下节文件列表），构建就会把对面的半成品编进产物。所以是**「编辑可做、验证不可做」**，本批不落地。

**解锁条件**：并发会话提交 core/src 与 apps/host/src/main.cj 的改动到 HEAD，本会话重新构建后跑全套。

### A2. 计划第 73 行：本任务证据、方法表与检查脚本的精确提交

- 计划要求「仅提交本任务证据、方法表与检查脚本，不带入他人源码」。
- 前 32 批的 `git status` 逐 hunk 分诊已经在做，但**这份审计本身也是 A 档**：改的是 `docs/evidence/*` 与 `docs/plans/2026-10-10-unified-remote-mobile.md`，都是本计划自有文件。
- 每批提交时都在按此执行；无需额外工作，本行**待本批之后一次性复核**（见第 5 节）。

### A3. 计划第 147 行「遍历日志断言」这一半

- 计划原文：「审计保存 who/when/what/result；**遍历日志断言无登记秘密/token/模型key**；禁跨主机认证重定向与trust-all」
- 批次 N 落了「值级脱敏替代整条丢弃」、批次 Q/R 落了「禁跨主机重定向与 trust-all」，只有「遍历日志断言」这一半**字面未完成**——`apps/daemon/test/remote-audit-integrity.test.mjs` 里那 6 条用例用的是假 token（`Bearer nope` / `Bearer probe-only` / `tok.accessToken`），**没有一条把真 token 写进会话再遍历审计**证明它没出现。
- **改法**：新增一条用例——正常路径完成一次 `/auth/enroll` + `/auth/token` 拿到真 accessToken 与凭据，随后遍历 `instance.id.audit.log` 逐行断言不含 `accessToken`、`credential`、`enrollmentSecret` 三个真值。用 `String.includes` 就够了，不需要脱敏规则匹配。
- **风险**：需要真 daemon 二进制跑测试。同 A1，编辑可做、验证不可做。

**解锁条件**：同 A1。

### A4. 计划第 145 行后半「设备怎么拿到 management scope」

- 批次 O 建了 `auth/devices`/`auth/revoke` 的分派，但 scope 来源**故意不自建**——`RemoteIdentityStore` 里没有 `scopes` 字段，`DeviceAuthzView` 的 `allowedSessions` 恒为 `None`。
- 批次 O 已把代价量化过（O-M4 摘掉整条分派支后 5 条 wire 用例仍全绿，因为门禁在 `scope-required` 就拒了），今天这条面的真实可达性是「存在且只能被拒」。
- **A/B 分档**：B——`core/src/remote_identity.cj` 是并发会话硬持有（工作区 +62/−5 未提交，是 `rotateCredential` 那条线，与本批的 scope 语义在同一处存储上加两条互不兼容的字段），本会话不动它。
- **解锁动作**：等 `rotateCredential` 那条线落库后，在同一存储里加 `scopes: List<String>` 字段与 `auth/scopes/claim` 一个受限的自助面（不能自授管理 scope，管理 scope 只能经管理入口授予）。这条要另开一批。

### A5. 计划第 157 行「两设备并发选择不同会话提交、团队/普通共享归属」

- 批次 U/V 只落了「跨工作区」这一维的门禁（`workspace-not-bound`），**没落**「两设备并发」与「团队/普通共享归属」两条测试。
- **改法**：新增 `apps/daemon/test/remote-concurrent-selection.test.mjs`：起一台 daemon，两设备各自 `initialize`、各提一次 `session/submit`、断言两个 sessionId 都独立落盘、互不覆盖。
- **A/B 分档**：B——并发选择依赖宿主的显式归属路径，即 `apps/host/src/main.cj`（并发会话硬持有，见第 3 节）。今天 `session/select` 还是全局态（`apps/daemon/src/host_proxy.cj:63` 白名单里仍包含），两设备并发选会互相覆盖。本批不动。

### A6. 计划第 158 行「移除远程先 session/select 后 execute 的契约」

- 规格 §5 明令「客户端选择会话不发送全局 session/select 修改其他客户端上下文；仅其视图改变」。
- 现状：`apps/daemon/src/host_proxy.cj:63` 转发白名单仍包含 `session/select`；宿主侧也还是全局态。
- **A/B 分档**：B——需要同时改 `host_proxy.cj`（从白名单剔除）与 `apps/host/src/main.cj`（把 select 改成 per-context）。两个文件都在并发会话硬持有集。
- **解锁动作**：并发会话落库后，按同一 mutation 节奏跑：M-1 让 daemon 仍转发 `session/select` → 「两设备并发选不互覆盖」用例红；M-2 让宿主 select 变成全局 → 「同会话同工作区两设备读同一份」用例红。

### A7. 计划第 161 行「审批应答核主体/资源/有效期/修订/单次消费」

- 现状：`approval/answer` 走 gate 的 `scope-required` 分支（批次 U 有独占受害用例），但**没有**「同一 approvalId 第二次答被拒」「revoked 后 answer 被拒」这类幂等/时效用例。
- **改法**：在 `apps/daemon/test/remote-approval-ownership.test.mjs` 补三条：重复 approvalId 二次答被拒（-32010 already-answered）、revoked 之后答被拒（-32001 authz-denied:revoked）、approvalId 指向不存在工单被拒（-32602 approval-not-found）。
- **A/B 分档**：B——重复/时效/存在性的真源在宿主 `approval/*` 分派，宿主并发会话持有。今天 daemon 侧能测的只是「转发过去之后宿主怎么答」，没有独立可测面。

## 3. B 档（等并发会话）汇总

上表 A4–A7 都是 B 档，另补几处 plan 未勾项也在这档：

| 计划行 | 卡点文件 | 卡的形态 |
| --- | --- | --- |
| 第 90 行任务 3 Linux 进程 | `core/src/procwin.cj`、`core/src/sigwin.cj`、`core/src/lease.cj`、`core/src/session.cj`、拟新增 `platform_linux.cj` | 拟新增文件与既有文件在同一 cjpm 编译面，任一改都要过 cjpm test，而链接段 40min+ 未落 |
| 第 106 行 SIGINT/SIGTERM 真跑 | 同上 | 需 Linux 主机，见 C 档 |
| 第 116 行子进程越权 | `core/src/sandbox.cj`、`sandbox_linux.cj`、`ptc_exec.cj` | 强制后端缺失，见 C 档 |
| 第 131 行同包 daemon 管理入口 | `apps/cli/src/main.cj`（并发会话 +211 行未提交） | CLI 侧入口参数表要动，`apps/cli/src/main.cj` 属并发持有 |
| 第 158 行 session/select 剔除 | `apps/daemon/src/host_proxy.cj`、`apps/host/src/main.cj` | 两者都在并发持有集 |
| 第 159 行 98 条方法真实语义 | `apps/daemon/src/host_proxy.cj` | 转发白名单要收，宿主按显式归属执行 |
| 第 160 行缺后端实现时补完整契约 | `core/src/execution_*.cj` 4 个源文件 + 4 个 `*_test.cj`（全部并发持有） | 属任务 7 的核心扩展，本会话不动 |
| 第 163 行三设备权限矩阵 | `core/src/remote_identity.cj`（并发持有 +62/−5） | scope 来源未落，见 A4 |
| 第 176 行补读订阅竞态 | `apps/host/src/main.cj`（宿主应答里附 `sessionId\|seq` 才行） | 见批次 T 的 M3 反证 |
| 第 182 行逐帧资源过滤 | `apps/host/src/main.cj` 通知帧带归属键 | 同上 |
| 第 196 行目标切换用例 | `apps/desktop/main.cjs`（并发持有）、`apps/desktop/renderer/*`（并发持有） | 见第 4 节 |
| 第 201 行 preload 闭集与 bridge 测试 | `apps/desktop/preload.cjs`（工作区改动）、`apps/desktop/main.cjs`（并发持有） | 同上 |
| 第 209 行 Kuikly 完整移动客户端 | 全 `apps/mobile/**` 拟新增 + `apps/desktop/**` | 见 C 档 |
| 第 224 行双平台交付验收 | `apps/daemon/src/host_proxy.cj`（转发面与沙箱联动）+ Linux | 见 C 档 |
| 第 239 行任务 11 多客户端验收 | 依赖 B 档其余项 | 上游未通则下游不测 |

**结论**：B 档至少 13 条，本会话能做的是「解锁动作写得足够具体，对方落库后本会话能立刻接上」。

## 4. C 档（环境阻塞）

- **计划第 81 行、82 行、83 行、97 行**（Linux 工具链读取、编译探针、cjpm 与三入口 build、独立进程 SIGTERM）：Windows→Linux 交叉编译探针 2026-10-03 实测 rc=1（`docs/evidence/2026-10-10-remote-platform-baseline.md` §1），SDK 目录无 `modules/linux_x86_64_cjnative`。本机无 WSL2 Linux 发行版，安装系统依赖不在授权范围。**BLOCKED**。
- **计划第 117 行**（Linux namespace/mount/seccomp/资源/进程树）：同 Linux 阻塞。Windows 侧 `confineRewritesArgv()` 已实测为 `false`，无强制后端，远程 execute 族整族拒绝。批次 J 已把「拒」这一半落死。**BLOCKED**。
- **计划第 131、132、133 行**（Linux 收 `.so`、ELF ABI、readelf/ldd）：无 Linux，无交叉编译。BLOCKED。
- **计划第 144 行**（CSPRNG/摘要/常数时间校验与安全存储）：Windows 已有 `stdx.crypto` 支撑，实测 256/128/15 分钟数字量与算法要求全部对得上源码，此条其实是**代码级通过**，未勾的原因是**产品化的 secret storage API**（Windows Credential Manager、macOS Keychain、Linux libsecret）尚未对接——这需要三平台开发环境。**BLOCKED**。
- **计划第 184 行**（真实网络 UTF-8 分片 / TCP 半帧 / 睡眠恢复）：批次 S 落了「UTF-8 分片」的解码面（3/3 通过），「TCP 半帧」归 stdx http 层不在本仓代码语义面，「睡眠恢复」要真机。**BLOCKED**（睡眠恢复半）。
- **计划第 200、205、206 行**（Kuikly 三平台真机验收）：gradle 已在位（Gradle 8.7 / JVM 17.0.2），但 Android SDK、adb、真机/模拟器全缺，iOS 与鸿蒙工具链也没有。BLOCKED，见批次 K 归因收窄。
- **计划第 224 行**（固定提交双平台交付验收）：Linux 半 + 移动三平台。**BLOCKED**。

## 5. D 档（用户/授权阻塞）

- **计划第 54 行**：AgentLink 工程路径。**用户未提供**。批次 I 走的是 `apps/mobile/`（无 Kuikly 工程本体），未假装通过。
- **计划第 82 行、83 行、97 行**（Linux 主机或授权环境）：**用户未授权安装** WSL2 或提供 Linux 主机。
- **计划第 206、209 行**（Kuikly 工程 + 三平台运行）：需要用户安装 Android SDK 或提供已配好的 Kuikly 工程路径。
- **计划第 134 行**（授权后提交源码、清单与平台包配置，不提交二进制、不发布）：授权已给（本次任务文本明确「提交已获本次授权；不推送、不发布」），本项是**已授权**，不是阻塞。
- **计划第 134、149、167、188、220 行的「授权后」提交**：授权已给，只需按各批次精确提交。

## 6. 本轮实际动作

**本批不改任何源码、不删任何文件**。理由：
- daemon 二进制为空目录，无法运行任何 `remote-*.test.mjs` 集成测试；
- 编辑 `apps/daemon/src/daemon.cj` 的 A1/A3 项，改动后无法自证——「写了但没验」的绿灯是本计划明文禁止的；
- 其余 4 档分类下没有「改一行就能验一行」的项。

**本批只提交两份文档**：
- 本文件（新增）：`docs/evidence/2026-10-10-remaining-plan-audit.md`。
- `docs/evidence/2026-10-10-remote-batch-progress.md` 末尾追加一段「批次 AA」索引本文件的引用与解锁顺序。

## 6b. AA 归档后的实际推进（本轮补记，2026-10-10 14:45 UTC）

AA 归档完之后的两个 turn（`b1dd816` + `4875df8`）在 daemon 二进制解锁后（`cjpm build` 现编现取 11 MB）实际推进了 AA.1 与 AA.2 的**取证半**：

- **AA.2 完整交付**（`b1dd816`）：`apps/daemon/test/remote-audit-integrity.test.mjs` 加 2 条——真 access token 走完 `/rpc` 全流程后遍历审计不含原文（反向锁=判定记录至少一条在盘）；modelApiKey 字段当前不在 `AUDIT_BANNED_KEYS` 白名单的原样落盘事实（棘轮：日后扩白名单本用例自动变红）。计划第 147 行整行仍不勾——「遍历模型 key 类秘密」这个原句因脱敏白名单不覆盖 `modelApiKey` 而仍未通过。
- **AA.1 只交付取证半**（`4875df8`，批次 AB）：新增 `apps/daemon/test/remote-protocol-version.test.mjs` 4 条——锁「今天 initialize 仍宣告 0.1」+「请求侧 envelope 顶层带 0.1/0.2 都不被拒」+「缺顶层字段仍通过」。门禁与客户端升级**仍不做**，理由在批次 AB 节写清：规格 §5 的门禁前置条件是宿主显式归属分派到 HEAD，今天 `host_proxy.cj` 与 `main.cj` 都是并发会话硬持有；加门禁要动 15 份测试 65 处 envelope + 3 处客户端，属 B 档解锁链。计划第 71 行整行仍不勾。

**推进后未勾项计数**：仍是 70（AA.1 与 AA.2 各只落一半或一字面下限，都不足以把计划整行勾掉）。

**本轮未动**：A4-A7（B 档）、B 档 13 项、C 档 6 项、D 档 4 项。所有卡点与前一节解锁顺序一致，本轮只把 AA.1 与 AA.2 从「等解锁」推进到「一半已落 + 另一半明确等解锁」的更清晰状态。

## 6c. AC 归档后的实际推进（本轮补记，2026-10-10 15:05 UTC）

批次 AC（提交待落）在 AA.1/AA.2 之外独立推进了**计划第 142 行「并发登记兑换」这一小格**：新增 `apps/daemon/test/remote-concurrent-enroll.test.mjs`，2 条并发不变量用例——「两台设备同时投同一张登记秘密，只有一台成功」+「同一设备凭据并发换两次令牌，两个令牌各自独立」。2/2 单跑 rc=0；全套 `remote-*.test.mjs` **114/115 rc=1**（唯一红仍是批次 K 保留的撤销事故半径，与本批无交集）。

同批还探测出一个**并发下的实现缺口**（登记在本文件，不改代码）：`apps/daemon/src/remote_access.cj:287-298` 的 `ticketFailures(digest) >= 5` 是**读**、`recordTicketFailure(digest)` 是**写**，两次调用各自加锁但不组合——6 个并发请求会先全部读到 0 再各自 +1，第 6 次读到时还是 0 因此**通过**锁检查。单线程顺序下永远只到 5 次即锁，但并发下会漏锁到 6 次以上。修法是让 check-and-increment 在一个原子段内做，属 `remote_access.cj` 的锁粒度调整。本会话不改并发改动的文件——`core/src/remote_identity.cj` 已被并发会话加到 +62 行（`rotateCredential` + scope 线），改 `remote_access.cj` 的锁边界需要同一轮考虑 store.enroll 的锁序，属另一批。

**推进后未勾项计数**：仍是 70。批次 AC 交付的 2 条测试是 plan 第 142 行的**其中一个小格**的字面验收，不是整行——同行还有「过期凭据」「跨证书」「拒绝发生在 Host.forward 前」等小格，前几项分别由批次 D/P/M 分散覆盖，未在「一行」口径下合并判过。per-ticket 并发漏锁这条新发现的实现缺口是**新的 B 档**——等 `remote_identity.cj` 与 `remote_access.cj` 在同一批一起动锁粒度时再一并落。

## 6d. AD 归档后的实际推进（本轮补记，2026-10-10 15:25 UTC）

批次 AD（本轮提交）把 §6c 归为 B 档的 **per-ticket 并发漏锁** 从「等解锁」推进到「已交付」——推翻了「必须等 `remote_identity.cj` 落库再动」这个前提：

- `apps/daemon/src/remote_access.cj` 与 `core/src/remote_identity.cj` 是**两个进程内独立对象**：`RemoteAuthRateLimiter` 用自己的锁管 per-ticket 计数，`RemoteIdentityStore.enroll` 用自己的锁管 consumed/set/record 序列；两段之间没有嵌套，一个的锁粒度调整不会撞另一个的锁序。
- 因此本轮直接把 `ticketFailures()` 与 `recordTicketFailure()` 两个分离的 public 方法合并成 `checkAndRecordTicketFailure(secretDigest, threshold): Bool`——读、判定、写三步在一个锁段内；enroll() 里原来的「先读阈值 → 尝试 store.enroll → catch 里再写计数」的三段改成「先原子段判定 → 尝试 store.enroll → 成功才 clearTicket」的三段，语义与顺序路径逐位等价（顺序 n=0..4 时每次返回 false 并 +1、n=5 时返回 true 拒，与旧 `ticketFailures>=5` + `recordTicketFailure` 两调用完全一致）。
- 保留顺序路径的 wire 覆盖由既有 `ticketFailuresLockAfterFiveAttempts` 单测承接（HEAD 里已通过，本批未动）；本批新增的 `并发投同一张假票` 用例在修复前是红（6 个 401、0 个 429），修复后绿，是本轮的**变异反证**：把 `checkAndRecordTicketFailure` 展开回读-写分离形态，本条立即变回全 401。

**推进后未勾项计数**：仍是 70——本批修的是 §6c 里那条 B 档实现缺口，不是计划第 142 行的字面验收（第 142 行本身仍等 AA.1 门禁半 + 「过期凭据/跨证书」两个 B 档项）；§7 解锁顺序里的 B 档 13 项少了一项（per-ticket 并发漏锁已从 B 档移走），其余不动。

## 6e. AD 归档后的 A 档穷尽扫描 + 全套回归基线（本轮补记，2026-10-10 15:36 UTC）

AD 提交后本会话把**能被本会话独立推进的所有 A 档候选**再扫一遍，结论是：A 档已穷尽，回归基线稳态，剩余项分档不再变化。

**A 档候选再扫描（本轮读到的四个 daemon 模块）**

- `apps/daemon/src/idempotency.cj`（297 行）：`consult()` 与 `store()` 分两次拿锁是幂等的**正确**语义——副作用必须发生在 check 与 record 之间；`lock`/`evictToMakeRoomLocked`/`persistLocked`/`loadFromStore`/`compactLocked` 全部持锁正确。**无漏锁**。
- `apps/daemon/src/remote_limits.cj`（127 行）：`acquireRpc`/`acquireSse`/`releaseRpc`/`releaseSse` 的判-写都在**同一个 `lock` 段内**——`held >= LIMIT → reason` 或 `add(held+1)` 都是原子。**无 AD 那种读-判-写拆两次的窗口**。
- `apps/daemon/src/event_replay.cj`（175 行）：只读 `SessionLog`，无共享可变状态。**不适用并发扫描**。
- `apps/daemon/src/eventbus.cj`（145 行）：`EventSubscription.offer/close/closeWith/closeReason` 与 `EventBus.publish/subscribe/unsubscribe/closeFor/subscriberCount` 全部在 `synchronized(mtx)` 内完成判-写组合；`offer` 的「查关闭原因 → 查字节 → tryAdd → 累计字节」在一个同步段。**无漏锁**。
- `apps/daemon/src/remote_management.cj`（88 行）：`requireManagement → revokeDevice → saveSnapshot` 三步都是纯读/纯写，锁都在 `RemoteIdentityStore` 内部；本层不持锁。**不是漏锁位置**。

**结论**：本会话能改的 daemon 模块里已无「读-判-写跨锁」的并发破口。剩下 70 项未勾都属 B/C/D 三档，无新 A 档入口。

**回归基线读数（daemon 二进制 2026-10-10 23:21，真宿主 10999808 B）**

19 个 `remote-*.test.mjs` 逐套件跑：

```
remote-audit-integrity  8/8    remote-management-rpc     5/5
remote-auth            19/19    remote-method-surface     6/6
remote-capability-contract 15/15  remote-mobile-client     2/2
remote-concurrent-enroll   3/3  remote-ownership           5/5
remote-enroll-gate        3/3   remote-product             4/5 (fail 1)
remote-events             7/7   remote-protocol-version    4/4
remote-execution-gate     5/5   remote-request-limits      6/6
remote-host-guard         9/9   remote-sse-recovery        4/4
remote-idempotency        5/5   remote-tls                 2/2
                                    remote-utf8-boundary     3/3
```

汇总：**pass=116 fail=1 cancelled=0**（115 个独立测试通过 + 1 条保留红）。分套件 rc：18 条 rc=0、1 条 rc=1（`remote-product`）。

唯一红是**批次 K 明写保留的撤销事故半径红**：`test/remote-product.test.mjs:238` 「带外撤销一台：只砍被撤那台的在途流与新请求，另一台不受影响」。该条注释里已钉住根因——`core/src/remote_identity.cj:274` 撤销时抬**全局** `revocationVersion += 1`，`:301` 用「token 版本 < 全局版本」判过期，因此撤销任意一台作废了全部在途令牌；规格 §5 要求的是 per-device。该文件正被并发会话持有（工作区 `core/src/remote_identity.cj` 未落库），本批不改它、只保留红。

**推进后未勾项计数**：仍是 70。A 档候选在本轮扫描中已穷尽——没有新的独立可推进项。B 档 12 项、C 档 6 项、D 档 4 项与 §7 解锁顺序不变。

**回归稳态说明**：本节读数与批次 AD 提交（a555b07）时的读数一致——AD 引入的 3 条 `remote-concurrent-enroll` 用例在套件级 rc=0，全套唯一红仍是 K 保留的同一根因（`revocationVersion` 全局 bump）。没有新红、没有静默变绿、也没有把「另一台被误伤」伪装成「只影响被撤那台」。

## 6f. AF 归档后的实际推进（本轮补记，2026-10-11 00:10 UTC）

上一轮把 §6e 下结论「A 档已穷尽」时漏算了 plan 第 142 行的**「过期凭据」小格**：把它判为 B 档的前提是「HTTP 端到端要过期 token 就必须靠时钟注入或 `--manage expire-token` 之类的管理入口」，但那条路径其实不需要。

- `snapshotText()` 只落 `devices` + `enrollments`，**不落 tokens**——令牌只存内存（`core/src/remote_identity.cj:388-424`）。所以「重启 daemon → 旧令牌找不到」是天然发生的过期形态，走的是与 `authenticate()` 里 `expiresAt <= nowMs()` **完全相同的 fall-through 分支**：`remote_gate.cj:142-145` 归因 `invalid-token`、`recordDenied` 落 `unauthenticated-invalid`。
- core 单测 `core/src/remote_identity_test.cj:71 expiredTokenRejected` 覆盖存储层用 clock 注入直接过期；新加的 daemon 集成用例覆盖外部观感一致的等价路径——**同一响应码、同一审计归因，但测试路径不同**（不依赖时钟注入，走令牌已从内存丢失这一自然到期形态）。两条测试合起来才算把「过期凭据」这一小格完整钉住。

**批次 AF 交付**：`apps/daemon/test/remote-auth.test.mjs` 新增一条用例「重启后旧令牌找不到，与过期归因同为 invalid-token，且不透露是哪种」。断言四段：

1. 重启前该令牌真的可用（前置证明，避免「一开始就红」被误读成通过）；
2. 重启后 `-32001 authz-denied:invalid-token`；
3. **反枚举**：响应体不含 `expired` / `token-gone` / `token-not-found` / `missing` / `device` / `principal`——把「令牌丢了」和「令牌过期了」以及「哪台设备」三种信息面全部封住。将来若有人把 `remote_gate.cj:142-145` 的三合一拆开，本用例立即变红；
4. 同一凭据能换出新令牌（凭据摘要仍在 snapshot 里），说明被拒的不是「设备」而是「这张令牌」——这条防止客户端被误导去做重新登记。

**读数**：`remote-auth.test.mjs` 单跑 **20/20 rc=0**（原 19 条 + 新 1 条）。全套 `remote-*.test.mjs` 未跑完（本节只登记本批影响面），下一轮跑一次回归把 K 保留红以外的稳态再复核一遍。

**推进后未勾项计数**：仍是 70——本批修的是 plan 第 142 行里「过期凭据」这一**字面小格**，同一行还剩「跨证书」一个 B 档项（依赖客户端 TLS pin 层的证书轮换面）。**plan 第 142 行整行仍不勾**——它的 8 个小格里「无凭据 initialize / 撤销凭据 / 并发登记兑换 / 拒绝发生在 Host.forward 前 / 匿名 SSE」已由前批分散覆盖、「过期凭据」本批落地，但「跨证书」是独立的第二档。

**§6e A 档穷尽结论修正**：本条是 §6e 里被错判成 B 档的一处，其他 A 档穷尽结论保持。

## 7. 解锁顺序（等并发会话落库后按此推进）

1. **前置**：`core/src/remote_identity.cj`、`apps/host/src/main.cj`、`apps/daemon/src/host_proxy.cj`、`apps/cli/src/main.cj` 均提交到 HEAD 且工作区干净；`apps/daemon/target/release/bin/main.exe` 由 `cjpm build` 现编现取。
2. **批次 AA.1**：`daemon.cj` 加 `protocolVersion` 门禁 + 同步客户端请求体 + 3 条 test（A1）。
3. **批次 AA.2**：`remote-audit-integrity.test.mjs` 加「遍历日志不含真 token」用例（A3）。
4. **批次 AA.3**：等 `rotateCredential` 与 scope 存储字段落地后，`remote-ownership.test.mjs` 加「三设备权限矩阵」+「设备管理 scope 申领」两条（A4）。
5. **批次 AA.4**：`host_proxy.cj` 剔除 `session/select`，`remote-concurrent-selection.test.mjs` 落地（A5/A6）。
6. **批次 AA.5**：审批时效 / 幂等 / 存在性三条用例（A7）。
7. **环境解堵后**：Linux 半、Kuikly 三平台半按批次顺序独立推进。

以上每批仍是 TDD 红先 / 变异反证 / 精确提交 三步节奏，本审计不承诺任何一批可以在同一轮完成。

## 8. 自证边界

- **本批的产出是一份分类判定**，不是「把 70 项变成 60 项」。70 项未勾仍为 70 项，本批只把它们排进 A/B/C/D 四档并写出解锁顺序。
- **未做**：任何源码编辑（含 A1/A3 那两个「单文件单行改动」）；任何测试命令的复跑（daemon 二进制缺失）；任何 Linux / Kuikly 环境动作。
- **未改**：任何并发会话持有的文件、任何未落库的 fixture、任何计划与证据文档以外的一行。
- **计数**：`docs/superpowers/plans/2026-10-10-unified-remote-mobile.md` 未勾项在本批前后均 **70**，本批不勾任何一项。
