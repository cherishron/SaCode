# 整库审查后的修复批次（2026-10-04 起）

起点：`d5c6f15` 之后的整库只读审查结论——「完整复刻已完成」不成立，持久化/审批/真模型面存在 P0/P1 缺陷。
本文档按批次记录**每一项修复的红先证据、变异反证与双入口复验计数**，不写结论性形容词。

约束沿用：不改 `apps/desktop/**`（另一条线在复刻前端），不吞并他人未落库改动，
`TOTAL: 0` 按 FAIL，新断言要有变异反证，计数只报实测。

---

## 批次 1：P0 —— 一次 flush 能把会话日志（唯一真源）改短

**缺陷**：`core/src/session.cj` 的 `flush()` 直接 `File.writeTo(path, 全量草稿)`。
`File.writeTo` 是打开即截断（官方 std.fs 文档写明 `Write` 模式「存在则截断」），而草稿完全由
内存态 `events` 决定，核心从不对照磁盘。于是任何「内存比盘上短」的 flush 都会删掉已落盘事件，
**并且返回 true**。两条实测可复现的触发形态（无需外部故障注入）：

| 形态 | 盘上 | 内存 | 旧结果 |
|---|---|---|---|
| 未回放的实例直接 flush | 2 条已落盘事件 | 0 条 | `flush()=true`，整份会话日志被清空 |
| 中段缺帧整份拒绝后 flush | 4 行（0,1,3,4） | 只读了一半的 2 条 | `flush()=true`，第 3、4 行消失 |

第二种尤其要命：`loadLocked` 对中段缺帧的口径是「整份拒绝，绝不静默前滚」，但拒绝之后内存里那份
**没读完的解释**仍然是可发布状态——拒绝只在读侧生效，写侧不设防。

**红先证据**（`core/src/session_test.cj`，改前实跑）：

```
[ FAILED ] flushFromNeverLoadedInstanceCannotEmptyDurableLog
    Expect Failed: `(b.flush() == false)`  left: true  right: false
    Expect Failed: ... != before        +0	user/message	one   +1	assistant/message	two
[ FAILED ] flushAfterRejectedReplayKeepsEveryDurableLine
    Expect Failed: `(r.flush() == false)`  left: true  right: false
    Expect Failed: ... != durable       +3	user/message	c     +4	user/message	d
```

**修法**：`flush()` 发布前过一道「只增不减」对照（`mayOverwriteDurable`）：盘上每一条完整事件行
必须原样出现在草稿开头；草稿比盘上短时，只允许少掉「回放本来就授权丢弃」的尾部坏帧（字段不足 3 段），
其余一律拒发并返回 false。`wholeLines` 的行口径与 `loadLocked` 一致（空段丢弃、末字节非 LF 剔除半帧），
所以 `loadDropsMalformedTailLine` 的修复性重写仍然放行。顺带把 `catch (e: IOException)` 放宽到
`Exception` 并把 `mtx.unlock()` 移进 `finally`——原来非 IOException 逃出 `flush()` 会带着锁一起逃，
这把锁此后永远拿不到。

**新增 4 条断言，逐条标注证据等级**（不统称「红先」）：

| 用例 | 证据等级 |
|---|---|
| `flushFromNeverLoadedInstanceCannotEmptyDurableLog` | 真红先：改前实跑为红 |
| `flushAfterRejectedReplayKeepsEveryDurableLine` | 真红先：改前实跑为红 |
| `flushCannotRewriteADurableLineWithDifferentContent` | 后补：写它时前缀分支已在，靠**变异反证**证明它独占钉住那条分支（下表） |
| `flushOntoDirectoryPathIsRefusedAndLeavesTheDirectoryIntact` | 防回归固定项：新旧实现都绿（旧靠 `writeTo` 抛异常侥幸不毁目录，新靠「读不回盘上内容」而拒发）。它的价值是把探针实测到的**新风险**钉住——`rename(temp, to: 目录, overwrite:true)` 会报成功并毁掉目录 |

**变异反证**：把前缀比对改成常量假（`if (false)`）后实跑，红集合**恰好等于**新增的第 4 条：

```
FAILED: 1  → flushCannotRewriteADurableLineWithDifferentContent
  (b.flush() == false) left: true right: false      实际盘上第 0 行被改写成 乙
```
还原后 `TOTAL: 374 / PASSED: 373 / SKIPPED: 1 / FAILED: 0 / ERROR: 0`，rc=0；
`@Test` 注解总数 374 与 TOTAL 逐一对上，无静默丢案（改前基线 370 条 + 本批 4 条）。
「只增不减」那条分支的独占受害用例是第 1、2 条（草稿变短路径），前缀分叉那条分支的独占受害用例是第 4 条，
两条分支各有独占受害者，不存在互为冗余的死代码。

**原方案被实测否掉**：本打算照 `core/src/global_appearance.cj:99-107` 改成「草稿写进同目录临时文件 +
`rename(overwrite:true)` 原子发布」。为此写了一次性探针实测 std.fs 本机形态（跑完已删）：

| 观测 | 实测结果 |
|---|---|
| `File.writeTo` 目标是已存在目录 | 抛 `Access is denied`，目录**存活** |
| 目标已被本进程另一句柄打开时 `writeTo` | **照样成功**（共享模式很宽，截断确实发生） |
| `rename(temp, to: 已存在文件, overwrite:true)` | 成功，临时文件消失 |
| `rename(temp, to: 目录, overwrite:true)` | 报成功而**目录被毁**（`directory-still-exists=false`） |
| 大草稿（406890 字节）经 createTemp+write+close+rename | 读回字节数逐字相等，不截断 |
| **改名期间的并发可见性**（写者 400 次覆盖同一目标，读者 3474 轮） | `missing=3061`（88% 看到**文件不存在**）、`read-throw=301`、`load-false=24`、`zero-events=21`、`torn=0` |

判读：`rename(overwrite:true)` 在本机是「先删目标、再移入」，对读者**不是**原子替换。
把会话日志的发布换成它，等于把「短暂看到半份」换成「八成看到没有」——而空会话在
`loadLocked` 里是**合法回放**（`missingLogFileIsAnEmptySessionNotARejection` 钉的正是这条），
比撕裂更危险。故本批只上「只增不减」守护，发布原语保持原地整写。
**遗留项（未修，另批）**：`core/src/global_appearance.cj` 现有的 createTemp+rename 发布带同一个
瞬态消失窗口——用户设置文件在并发读时同样可能「不存在」；要收口得换追加式发布或读侧重试，不在本批范围。

**双入口复验**（核心改动后两入口都重跑）：

| 步 | 实测 |
|---|---|
| CLI `apps/cli` `cjpm build` | `cjpm build success` |
| 隔离目录逐子命令（同目录连跑两轮，第二轮在脏目录上） | `all` 77 / `stream` 21 / `tool` 11 / `ext` 8 / `cancel` 9 / `headless` 36，**PASS 162 / FAIL 0**，与 `p0-status` 记录的逐模式数字**逐位相同** |
| `dsh seed` 连跑两次 + `projection` | 两次都 `ok seeded 6`，`projection` 读回 3 条——草稿与盘上逐字相等属「同内容重写」，守护按设计放行 |
| `extjs` 子命令 | 0 PASS / 3 FAIL `spawn-failed: WorkingDirectory "extjs" not exist` ——**环境**（隔离目录里没有 extjs 源码树），非本次改动；记录在案的装包态该模式是 12 PASS |
| `sig` 子命令 | 6 PASS / 4 FAIL，4 条全部落在本机 Ctrl+C 投递不通的既有环境阻塞（见 `project-windows-ctrl-c-delivery-blocker`），非本批引入 |
| 宿主 `apps/host` `cjpm build` + `pack-host` | 打包 77 个文件到 `dualtest/p0-host-pack/bin`（`Cangjie/bin` 无 DLL，运行期 DLL 取自 CLI 构建输出目录；OpenSSL 两颗由 PATH 发现，来源 `git/mingw64/bin`） |
| 宿主 NDJSON 直连驱动 `dualtest/p0-host-drive.mjs` | **23 PASS / 0 FAIL**，rc=0 |

宿主那 23 条里与本次修复直接相关的面（脚本 `dualtest/p0-host-drive.mjs` 自证）：
跨进程写者拿租约 + 有未 flush 事件期间，另一入口写入同序号不同内容的一行后——
`session/flush` 判 `-32003`、别人那行**原样在盘上**、磁盘字节数逐字未动；
再 `submit` 仍回 `events` 递增（内存态没被清空）、再 `append` 直接判 `-32003`（不假装写成功）、
再 `flush` 仍被拒且磁盘字节与上次**完全相同**；失真写者退场后新进程按盘上内容回放并接着正常写，
最终日志同时含两方内容且序号连续无缺帧。`turn/start`(limit 5) → `turn/poll` 结算路径也走同一条守护，
实测结算与落盘正常。另有一条**只是源码核对、本批未跑到**：`turn/poll` 结算时若 flush 失败，
宿主保留租约并只写 stderr（`apps/host/src/main.cj:736-742`），本批没构造出「结算 flush 失败」的场景，不记为运行证据。

**未跑的验收**：`apps/desktop` 的 `npm test` / `smoke` / `ui-smoke` 未跑——AGENTS.md 记录该套测试会在仓库根
使用 `dualtest/`，而当前 `dualtest/` 下有另一条线的在飞目录（`adjust-ui.log`、`official-baseline-20261004` 等），
跑它会删别人的东西。桌面入口这一项标 **BLOCKED（并发占用）**，解锁动作是等前端线结束后在干净 `dualtest/` 上重跑。

---

## 批次 2：租约接管竞态 —— 审查结论被实测下调

**审查时的说法**（P1）：`core/src/lease.cj:87-106` 的 `takeoverIfStale()` 是「先 `removeIfExists` 再 `acquire`」，
两个进程同时看到同一个死持有者时会都删成功、都抢成功 → 一份会话日志出现两个并发写者。

**实测**：这个说法站不住，至少在本机证明不了。

| 试过的复现 | 结果 |
|---|---|
| 顺序两个接管者（a 接管成功，b 再接管） | b **返回 false**：它看到的已是 a 的活凭据 |
| 多线程 2×30 轮同时接管同一份死租约 | **从未出现两个赢家**，且把判据改成无条件删除后**照样全绿** |

关键反证是第二条的后半：我写的那条并发用例**杀不掉变异体**——把
`if (!removeIfExists(leasePath, ...)) { return false }` 改成无条件 `removeIfExists(...)`（也就是我审查时
声称的缺陷形态）后，30 轮并发仍 377 条全绿。用例绿是因为它测不到，不是因为实现是对的。
按「空/无效测试即假绿」的既有纪律，**这条并发用例已删除**，不留作防回归依据。
（`lease.cj` 已用 `cp` 还原并 `git diff --numstat` 证明与 HEAD 逐字一致。）

**为什么杀不掉**（源码核对，未运行验证）：现存实现里 `std.fs.removeIfExists` 对已不存在的目标返回 false，
于是「删不到的人不接管」这一条已经在起作用；剩下的窗口是「B 读到的凭据是死的 → A 删并重取到新凭据 →
B 再执行它那次 `removeIfExists`」，需要 B 在判活与删除之间被挂起整个 A 的接管时长。本机的
`spawn` 没能把这个窗口打开（也可能是 30 轮不够），我没有可注入延迟的接缝，所以**既不能证明它发生过，
也不能证明它不会发生**。

**本批真正落下的两条钉**（都是确定性顺序面，各有独立价值）：
- `onlyOneOfTwoTakersMayClaimACrashedHoldersLease`：输家不改写盘上归属、`release` 归还真拿到者、
  接管过程不留中转文件（复用既有的 `stagingArtifact()` 约定）。
- `takeoverLeavesALiveHoldersLeaseUntouched`：凭据 stamp 的是本进程活 pid 时，接管返回 false 且盘上凭据逐字未动。

**计数**：`TOTAL: 377 / PASSED: 376 / SKIPPED: 1 / FAILED: 0 / ERROR: 0`，rc=0；
`@Test` 注解总数 377 与 TOTAL 逐一对上。

**留给后续批次的选项（未实现，因为拿不出能红的用例）**：把接管做成「同一源路径的独占搬移」——
`rename(leasePath, to: "<leasePath>.stale-<pid>-<序号>", overwrite: false)`，只有赢家搬得动，
输家的 rename 因源不在而失败即放弃；搬进独占槽位后再认一次凭据，若那其实是活人的租约就原样放回。
这条能真正封死窗口，但在本机它改的是「测不出差别」的那一段，写进主干等于加无防回归代码，故本批不做。
若要收口，需要先有跨进程（两个真实子进程同时接管）的取证通道，而不是同进程线程。

---

## 批次 3：P1 —— 审批工单不绑工具，一张批过的票可以放行任何别的动作

**缺陷**：`ApprovalTicket` 本来就存了 `tool`（`approval/asked` 事件也写着 `<id>:<tool>`），
但 `consume(id)` 只看 `state == "allowed-once"`，从不比对「现在要执行的是哪个工具」。
于是 `desk.ask("read")` 被人批了以后，这张票可以拿去放行需要审批的 `write`——
人回答的是「读这件事可以做」，实现当成「这个号以后干什么都行」，
而且日志里只会留下一条 `denied/allowed` 都对不上的账。

**红先证据**（`ticketApprovedForAnotherToolCannotAuthorizeWrite`，用**已有 API** 写 behavioral 红，
不需要先改签名拿编译器红）：注册 `read`(不要审批) + `write`(要审批)，批给 read 的票去执行 write：

```
FAILED: 1  → ticketApprovedForAnotherToolCannotAuthorizeWrite   （其余 377 条全绿）
    write 真的执行了：r.allowed == true
```
红集合恰好等于本批新增的那一条，无附带失败。

**修法**：
- `ApprovalDesk.consume(id: Int64, tool: String): String`——只有「批给这个工具」且 `allowed-once` 才放行；
  **挪用不烧票**（错工具的 consume 不改 state），否则一次误用就把人已给出的审批答复作废了。
- 新增 `ApprovalDesk.toolOf(id): String`（与既有 `stateOf` 同一类只读探查），号不存在回空串。
- `core/src/agent.cj` 的 `executeWithApproval` 把工具名交给 consume，并按原因分叉写日志：
  票是批给别的工具时写 `denied:<name>:approval-mismatch:<bound>` 与
  `approval-tool-mismatch:<bound>`；查无此号（`toolOf` 回空串）仍走原来的
  `approval-not-granted:<state>`，不伪装成挪用。
- `core/src/approval.cj` 头部的 fail-closed 规则由三条改为四条，第 4 条就是票绑工具。
- 调用点同步：`approval_test.cj` 8 处、`apps/cli/src/main.cj` 2 处 `consume` 补工具名。
  宿主不需要改：它的 `extension/call` 本来就走 `extRt.executeWithApproval(name, ...)`
  （`apps/host/src/main.cj:529-530`），绑定在 core 侧生效。

**变异反证**：把 `if (t.tool == tool && t.state == "allowed-once")` 退回成
`if (t.state == "allowed-once")`，实跑红集合**恰好等于**本批两条新用例：

```
FAILED: 2 → ticketApprovedForAnotherToolCannotAuthorizeWrite
            consumeIsBoundToToolAndMisuseDoesNotBurnTicket
```
`consumeIsBoundToToolAndMisuseDoesNotBurnTicket` 是**实现之后**补的桌面级用例（不宣称红先），
它独占钉住「挪用不放行 + 对的工具仍放行一次 + 未知号 `toolOf` 回空串」这三点。

**计数**：
| 取证态 | 实测 |
|---|---|
| 工作区（本批 4 个文件） | core `TOTAL: 379 / PASSED: 378 / SKIPPED: 1 / FAILED: 0 / ERROR: 0`，rc=0；`@Test` 注解总数 379 与 TOTAL 对上 |
| CLI 工作区构建 | `cjpm build success`，六模式 **PASS 162 / FAIL 0**（all 77 / stream 21 / tool 11 / ext 8 / cancel 9 / headless 36，与批次 1 逐模式相同） |
| **HEAD + 只放本批 4 个文件**的 detached worktree（`git worktree add --detach`，用完 `--force` 回收） | core `TOTAL: 379 / PASSED: 378 / FAILED: 0`，rc=0；CLI `cjpm build success` + 六模式 **PASS 162 / FAIL 0**；宿主 `cjpm build success` |

**为什么要另开 worktree 取证**：本批收尾时工作区的 core **已经编不过了**，但原因不是我改的文件——
并发线新落的未入库文件 `core/src/model_request_test.cj` 让整包编译失败：

```
error: unable to infer generic argument of this function
  ==> core/src/model_request_test.cj:6.45: expectEqual("messages.size", "Int64(4)", messages.size, Int64(4), isDelta: false,)
```
我没有动它，也不替它改（那是另一条线在飞的活）。因此把「工作区取证」与「提交级取证」切开：
本批的提交级判据来自上面那张表最后一行——`HEAD` 副本里只放我这 4 个文件，独立跑通。

**本批未跑（BLOCKED）**：宿主 NDJSON 协议面那条 23 项驱动脚本连同 `dualtest/` 一起被并发线
`rm -rf` 掉了（AGENTS.md 把「先 `rm -rf dualtest` 再跑」写进 `bridge.test.mjs` 的恢复步骤，
它顺手清掉了整目录）。批次 1 那 23 项 PASS 是当时实测、已记录在本文档；本批新增的
「`approval/ask` 发号给 read → `approval/answer` → `extension/call` 挪用到 write 必须回
`approval-tool-mismatch:read`，且 `approval/status` 仍见 `allowed-once`」这一组**没有跑过**，
标 BLOCKED。解锁动作：等宿主线 `apps/host/src/main.cj` 的在飞改动落库、`dualtest/` 无人占用时
重建驱动脚本再跑。宿主入口这一批只有「编译通过」这一条硬证据。

---

## 批次 4：P2 —— pack-cli 的 SDK 缺省路径与 PATH 切分（本机 MinGW 找不到的真因）

**两条缺陷**（都在 `scripts/pack-cli.mjs`，平台包出的是发布出去的 `dsh.exe`）：

1. `const SDK = process.env.CANGJIE_HOME || "D:\Program Files\HuaWei\Cangjie"` ——
   JS 字符串里 `\P`、`\C` 不是合法转义，反斜杠被吞，缺省值实际是
   `D:Program FilesHuaWeiCangjie`，一台没设 `CANGJIE_HOME` 的机器上运行期库一颗都拷不到。
2. `(process.env.PATH || "").split(/[;:]/)` —— Windows 的 PATH 只用 `;` 分隔，
   而每个条目自带盘符冒号；把 `:` 也当分隔符会把 `C:\tools` 切成 `["C", "\tools"]`。

**这条切分错误就是本会话早前「pack-cli 找不到 MinGW DLL」的真因**，
当时用「先 `cygpath -w` 再把 mingw64 目录拼进 PATH」绕过去了，那是治症状。
本轮在同一台机器、同一种 Git Bash 启动环境下直接对比两种切法（未预处理 PATH）：

| 判据 | 旧切法 | 新切法 |
|---|---|---|
| PATH 条目数 | 140（全是碎块） | 70 |
| `libgcc_s_seh-1.dll` | 找不到 | `C:\Users\jingg\.qoder-cn\bin\git\mingw64\bin` |
| `libstdc++-6.dll` | 找不到 | 同上 |
| `libcrypto-3-x64.dll` | 找不到 | 同上 |
| `libssl-3-x64.dll` | 找不到 | 同上 |
| `libwinpthread-1.dll` | 落到 `\Program Files\HuaWei\Cangjie\tools\bin`（丢了盘符，按当前盘根解析） | 同上 |

缺省 SDK 路径那条同样实测：`existsSync(runtimeLibDir({}))` 新值 `true`、旧值 `false`。
**注**：本机 `CANGJIE_HOME` 是设了的，所以第 1 条在这里一直没咬到人——它是「换机即坏」的潜伏缺陷，
不是本机已发生的故障。

**做法**：把这两条判据抽成 `scripts/sdk-paths.mjs`（`sdkRoot` / `runtimeLibDir` / `pathEntries`），
`pack-cli.mjs` 改为引用它（抽取时保持原语义不动，好让测试先对上旧行为再红）。
缺省值改用正斜杠；`pathEntries` 按平台选分隔符（`win32` 用 `;`，其余用 `:`）。

**红→绿**（`scripts/sdk-paths.test.mjs`，`node --test` 显式点名单个文件）：

```
改前：# pass 4  # fail 2
  not ok 1  默认 SDK 根目录不丢路径分隔符
    expected: 'D:/Program Files/HuaWei/Cangjie'   actual: 'D:Program FilesHuaWeiCangjie'
  not ok 4  Windows 的 PATH 只按分号切，盘符冒号不是分隔符
改后：# pass 6  # fail 0
```
红灯落在断言失败而不是模块加载失败，因为抽取那一步先保住了旧语义。

**端到端**（工作区 core 被并发线的未入库文件挡住编不过，所以照批次 3 的办法开
detached worktree：`HEAD` + 只放本批 3 个脚本文件，跑真打包脚本）：

```
cjpm build success
  + libcrypto-3-x64.dll ← C:\Users\jingg\.qoder-cn\bin\git\mingw64\bin
  + libssl-3-x64.dll   ← C:\Users\jingg\.qoder-cn\bin\git\mingw64\bin
packed 45 个文件到 npm/dsh-cli-win32-x64/bin（其中 stdx 33 + openssl 2 + mingw 3），
扩展宿主 2 + 样例工具 4 个到 npm/dsh-cli-win32-x64/extjs
pack rc=0
```
`mingw 3` 与 `openssl 2` 齐——旧切法下这五颗里四颗根本搜不到，脚本会
`console.error("缺 MinGW 运行时…")` 并退 1。worktree 用完已 `--force` 回收。

**本批未跑**：装出来的 `dsh.exe` 剥 SDK PATH 的 175 条断言（那是完整发布链，本批只到「打包成功」）。

---

## 批次 5：P1 —— 扩展宿主的取消只结算等待者，扩展收不到「可以停了」

**缺陷**：`extjs/host.cjs` 的 `cancel(callId)` 只把等待者 reject 掉，`t.handler(args)` 拿不到
任何取消通知——副作用照旧发生，而调用方收到的应答叫 `cancelled: true`。
调用面 `t.handler(args || {})` 连第二参数都不传，扩展即使想协作也没有入口。

**做法**：
- `call()` 为每笔带 callId 的调用建一个 `AbortController`，以 `t.handler(args, { signal })` 交给扩展；
  不读 `ctx` 的旧扩展零改动（`echo/delayed/slow/broken` 全部照旧，16 条测试里 14 条本来就是它们的）。
- `cancel()` 顺序固定为「取句柄 → abort → 结算等待者」；先取句柄是因为等待者一被 reject，
  `call()` 的 `finally` 就把登记清掉了。
- 新增 `#watchSettle()`：有界观察 handler 到底收束没有，结果写 **stderr 诊断面**
  （`cancel-settle callId=<key> outcome=settled|still-running`），stdout 仍只走协议帧。
  `settled` 与 `cancelled` 是两件事：`cancelled` 的语义就是「这条在途调用被结算了」，
  它不代表副作用停止；这一点写进注释与诊断，不塞进应答帧。

**中途撤回的一个设计**：先把 `cancel` 改成 async 并让应答带 `{cancelled, settled, outcome}`，
实跑立刻红了两条**既有**协议用例：

```
not ok 11 - extension/cancel 按 callId 结算在途调用，只回一帧且迟到结果不再补帧   （3 !== 4）
not ok 12 - 取消不存在或已结算的 callId 明确回 false，二次取消不重复结算           （4 !== 5）
```
原因是应答帧要等收束观察写完，于是排到了那条 call 自己的 -32021 结算帧之后，
帧序契约（按 id 配对的先后）被改动打破。还有一条更深的问题：协作快的 handler 会在
reject 之前就把 race 判给真实结果，「取消」到底回错误还是回结果变成取决于 handler 速度——
这是不该有的不确定性。因此把收束信息从协议面撤走、改记 stderr，应答面逐字回到原样
（`git diff -- extjs/server.cjs` 只剩注释变化）。

**红→绿**（`node --test extjs/test/extjs.test.mjs`，显式点名单个文件）：

```
改前：# pass 14  # fail 2   → 新增的两条
改后：# tests 16 # pass 16  # fail 0
```

**两次独立变异，各杀一条**（证明两条断言各自有独占归属）：
| 变异 | 红集合 |
|---|---|
| `t.handler(args || {}, {signal})` 退回 `t.handler(args || {})` | 只有「取消把 abort 信号交给扩展」 |
| 去掉 `if (work) this.#watchSettle(...)` | 只有「收束情况记到诊断面」 |

两次变异后都已逐字还原，还原复跑回 16/16。

**新增样例扩展**：`extjs/example/watchful.cjs`（handler 等 abort，收到就协作收束，并把
`started/aborted/ranOut` 记在导出对象上——取消后调用方拿不到返回值，没有这个计数就只能靠猜）。
它随 `EXT_EXAMPLE` 整目录分发规则自动进包，无需改打包脚本。

**本批未跑（BLOCKED）**：CLI `dsh extjs` 子命令与宿主的 `extension/host/*` 链路没重跑——
工作区 core 当时被并发线未入库的 `core/src/model_request_test.cj` 挡住编译
（见批次 3 的报错原文）。协议面本轮是逐字不变的（应答帧、错误码、帧序都不动），
风险集中在扩展宿主自身，已由上面 16 条覆盖，其中两条是走 `server.cjs` 真子进程的端到端帧序用例。

> **更正（批次 6 里补跑，此句原为 BLOCKED）**：这条已补跑并全绿，见批次 6 的
> 「`dsh extjs` 从仓库根跑 = 12 PASS / 0 FAIL」。当时的阻塞原因是并发线随后把
> `model_request_test.cj` 修好并落库（`7da09f4`），不是本批的问题；就地保留这段原文并注明更正。

---

## 批次 6：P1 —— sandbox 的 confined 集合是开集，认不出的档位被当「没约束」透传

**缺陷**：`core/src/sandbox.cj` 的 `confine()` 只点名拒 `danger-full-access`，
其余任何字符串——拼错的 `read-onlyy`、空串、自定义档位——都原样带着 argv 返回。
调用方拿到的是「已约束」，实际什么都没拦：典型的 fail-open。
上游 §221 用 `ConfinedSandboxMode` 做**类型级收窄**（只有 `read-only` / `workspace-write`
能进这个参数位），仓颉这边没有那个类型，就必须把「按闭集校验」补在运行期。

**红先证据**（`sandboxConfineRejectsUnrecognizedMode`）：

```
FAILED: 1 → sandboxConfineRejectsUnrecognizedMode
  拼错档位与空串都走到了 passed-through
```
取证在 detached worktree（`HEAD` + 只放本批两个文件）里跑，随后并发线把
`model_request_test.cj` 修好落库（`7da09f4`），工作区也恢复可编，两条态都各跑了一遍。

**做法**：新增包级 `isConfinedMode(mode)` 只认 `read-only` 与 `workspace-write`，
`confine` 改为「无后端 → `SANDBOX_UNAVAILABLE`；档位不在闭集内 → `SANDBOX_MODE_NOT_CONFINED`」，
`danger-full-access` 因为不在集合里而继续被拒（不是靠点名）。
`confine` 目前**没有任何生产调用方**（`apps/cli`、`apps/host` 全文 grep 无 `confine`），
改动只影响核心用例，两入口无行为面变化。

**顺带收紧的两条既有用例**（新增 `sandboxFailureReasonsAreDistinct`）：原先两条只判
「有没有抛」，任何一次抛都算过——把无后端与档位不认钉成两个不同错误码之后，
「抛了但抛错原因」这种假绿才拦得住。

**变异反证**：把 `if (!isConfinedMode(mode))` 退回 `if (mode == "danger-full-access")`，
红集合恰好只有 `sandboxConfineRejectsUnrecognizedMode` 一条；还原用 `cp` 备份并 `diff`
证明与工作区逐字一致，复跑回全绿。

**计数**：
| 取证态 | 实测 |
|---|---|
| detached worktree（HEAD + 本批 2 文件）改前 | `TOTAL: 383 / PASSED: 381 / SKIPPED: 1 / FAILED: 1` |
| 同上，改后 | `TOTAL: 383 / PASSED: 382 / FAILED: 0`，rc=0 |
| 同上，施加变异 | `FAILED: 1`（仅目标用例） |
| 同上，还原复跑 | `TOTAL: 383 / PASSED: 382 / FAILED: 0`，rc=0 |
| 工作区（HEAD 已含并发线 `7da09f4`）+ 本批 | `TOTAL: 385 / PASSED: 384 / SKIPPED: 1 / FAILED: 0 / ERROR: 0`，rc=0 |
| 工作区 CLI `cjpm build` + 隔离目录六模式 | `cjpm build success`；all 77 / stream 21 / tool 11 / ext 8 / cancel 9 / headless 36 = **PASS 162 / FAIL 0** |
| `dsh extjs` 从仓库根跑（真子进程 + core 侧 NDJSON 驱动） | **12 PASS / 0 FAIL**，含「可取消的调用能异步发出」「在途调用按 callId 取消成功」「取消的终态帧由 sink 交出」「子进程收束后不得再有应答」 |

最后那一条同时把**批次 5 标成 BLOCKED 的 `extension/host/*` 链路**补跑了（就地已在原文注明更正）：
abort 信号那处改动经过仓颉核心的真宿主路径仍然是 12/12。

**顺带记一笔旧账对不上**：`p0-status-2026-10-02.md` 写「7 个断言模式 175 PASS」，
但它同一行给的逐模式数字是 all 77 / stream 21 / tool 11 / ext 8 / cancel 9 / extjs 12 / headless 36，
相加是 **174**。本会话实测逐模式数字与那串逐模式数字完全相同，所以差的是旧记录的**汇总写法**，
不是用例缺失。收口文档批次处理（见待办：证据更正）。

---

## 批次 7：P2 —— `|` / `::` 是字段分隔符，含分隔符的内容能写进日志却读不回原样

**缺陷族**（三个模块同一个形状，代码里各自写着「本切片假设不含分隔符」却没人拦）：
- `core/src/todo.cj`：记录编码 `<content>|<status>`，条目之间用 `\n` 分隔。
  `write([TodoItem("甲|乙","pending")])` 当场成功，回放时 `list()` 按第一个 `|` 切，
  status 读成 `乙|pending`；`content` 里带换行则一条变两条。
- `core/src/goal.cj`：`<phase>|<objective>|<blockedReason>`。objective 带 `|` 时
  `create()` 返回的内存快照与 `snapshot()` 回放出来的不是同一件事。
- `core/src/skill.cj`：`<name>::<description>`。名字或描述带 `::` 时字段错切，
  `describe()` 交回的不是注册时那句。

共同点：写侧不设防，坏数据进的是**唯一真源**（会话日志），要等到回放才现形——
而回放读出来的是一份自相但没有报错的账。

**红先证据**（三条用例，工作区与 HEAD 副本各跑了一遍，形态一致）：

```
FAILED: 2, listed below:
  goalObjectiveContainingDelimiterIsRejectedWithoutWriting
  skillRegisterRejectsFieldsCarryingThePairDelimiter
  todoContentContainingRecordDelimiterIsRejected        ← 这条落在 ERROR 桶
```
`todo…` 那条进的是 ERROR 桶而不是 FAILED：goal 用例里第一次「被拒」的 create 当场其实
落了事件，随后的 create 抛 `goal-already-exists` 冒出用例外层——红灯是红，但归因写着「用例自己
踩空」，不是「实现拒了」。这正是修好之后会消失的现象，还原复跑证实（见下）。

**做法**：一律在**写边界**拒，错误码互不相同且可读——`bad-todo-content`、`bad-goal-content`、
`skill-delimiter-in-name` / `skill-delimiter-in-description`；拒绝时一条事件都不落，
与既有的 `bad-todo-status`、`stale-goal-revision`、`skill-empty-name` 同一口径。
goal 的守卫放在 `GoalService.encode` 这个唯一写通道上，create/edit/block 三条路径一起覆盖。
三个模块头部那句「本切片假设不含分隔符」就地改成「在写入处被拒」，不再留假设。

**变异反证**（一次施加三个变异，每个变异有独占受害者）：把三处 `if (...) throw` 全部删掉，
红集合**恰好等于**本批新增的三条用例，其余 382 条不受影响：

| 态 | TOTAL | PASSED | SKIPPED | FAILED | ERROR | rc |
|---|---|---|---|---|---|---|
| HEAD 副本 + 本批 6 文件（改前红态在真实工作区跑：FAILED 2 + ERROR 1） | 386 | 385 | 1 | 0 | 0 | 0 |
| 同一副本，三处守卫全删 | 386 | 382 | 1 | 2 | 1 | 1 |
| `cp` 备份还原，`diff -q` 证明与工作区逐字一致后复跑 | 386 | 385 | 1 | 0 | 0 | 0 |

**双入口**（都在只含 `HEAD` + 本批改动的 detached worktree 里构建与运行，DLL 由工作区已构建目录供 PATH）：
- CLI `cjpm build success`；七模式实跑 **PASS 174 / FAIL 0**：all 77 / stream 21 / tool 11 / ext 8 / cancel 9 / extjs 12 / headless 36。
- 宿主 `cjpm build success`（协议面无改动，本批三个模块没有 `confine`/`todo`/`goal`/`skill` 的宿主调用点）。
- 工作区（含并发线未入库的 `core/src/model_settings*.cj`）另跑一遍：`TOTAL: 388 / PASSED: 387 / FAILED: 0`，
  与副本计数差 2 条，差的就是那两条未入库用例——**提交级判据取 386/385/0 那一行**。

**顺带把旧账对齐**：`p0-status` 里「7 个断言模式 175 PASS」与它同一行给的逐模式数字相加是 **174**；
本批在 HEAD 副本里逐模式实测就是 77/21/11/8/9/12/36 = 174。旧记录的汇总写法多 1，
逐模式数字与本会话实测完全一致，属汇总笔误而非用例缺失。
