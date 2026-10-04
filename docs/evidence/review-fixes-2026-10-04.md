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
