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
