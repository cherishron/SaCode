# W10 持久化屏障与恢复契约（设计稿，待用户评审后再实施）

主责：A（起草与接口收口）｜实施：B（W10）｜复核：I（W80）｜上游出处：冻结 `639ed015397290b3745d163aafe02ffee4aa3f84` 的 `docs/subsystems/persistence`

**本文不改任何代码，也不批准改代码。** 计划红线：持久格式变更与恢复属跨域变更，须先交具体契约设计评审。本文给出口径、代价与三个待你裁决的点。

## 1. 判据（每条都可复跑，不靠记忆）

| 现状断言 | 锚点 | 复跑 |
|---|---|---|
| `append` 只进内存，不落盘 | `core/src/session.cj:SessionLog.append` | 读源码 |
| `flush` 是**整文件重写**：先在内存拼完整文本，再 `File.writeTo(path, text.toArray())` | `core/src/session.cj:SessionLog.flush` | `grep -n "File.writeTo" core/src/session.cj` |
| 重写前有「只增不减」前缀守卫 `mayOverwriteDurable` | `core/src/session.cj:mayOverwriteDurable` | 同上文件 |
| **没有任何句柄级持久屏障**（无 fsync / FlushFileBuffers），`File.writeTo` 之后立即返回成功 | `SessionLog.flush` 全文；`core/src/procwin.cj` 的 CFFI 只用于 `OpenProcess` 判活 | `grep -rn "FlushFileBuffers\|fsync" core/src` ⇒ 0 命中 |
| 尾帧（半行 / 最后一帧 seq 不等于下标）→ 截断保留前缀并置 `truncatedTail`；**中段**缺帧 → 整份拒绝 `return false` | `core/src/session.cj:loadLocked` | 读源码 |
| 未知事件类型既不拒也不标：回放原样保留，投影按 `isSurfaceEvent` 过滤 | `core/src/session.cj:isSurfaceEvent`、`loadLocked` | 读源码 |
| 独占写靠租约文件 `rename(overwrite:false)` 原子抢；`-32001 already-owned`、`-32002 replay-rejected`、`-32003 flush-failed`（失败保留租约与内存态供重试） | `core/src/lease.cj:WriteLease`、`apps/host/src/main.cj:leaseHeld` | `grep -n "32001\|32002\|32003" apps/host/src/main.cj` |
| 崩溃恢复**合成 closers 完全不存在** | 全仓 `grep -rn "interruptedTurnClosers" --include=*.cj` ⇒ **0 命中**（只出现在 `docs/plans/plan-deepseek-harness-replication.md` 与本机上游副本里） | 该命令 |
| 上游三类 closer 里连 `step/end` 这个事件类型都不存在 | `grep -rn '"step/end"' --include=*.cj .` ⇒ **0 命中**（只有 `step/start`） | 该命令 |
| 无会话元数据头（格式版本、cwd、fork 血统、delegation 深度都不落盘） | `grep -rn "SessionHeader\|isSeeded\|formatVersion" core/src` ⇒ **0 命中** | 该命令 |
| 迁移只有差异计算，无落盘服务 | `core/src/migration_pack.cj:computeMigrationPlan`；`MigrationApplyResult` 仅在 `migration_pack_test.cj` 里手工构造 | 读源码 |

**矩阵落差（要先纠再写）**：`docs/plans/dsh-capability-matrix.md` 的 `persistence` 行现在记 **✔**，备注把「崩溃恢复合成」算作已复刻——上表两条 grep 证明实现侧一个 closer 都没有合成。按「标记/模拟/未接均不得判完成」，该行应为 ◐。该文件此刻有别的会话未落库改动，**本批不动它**，把纠偏记进 §6 归属。

## 2. 上游口径（要点，不是转抄）

1. **持久层不修日志。** 崩溃在 turn 中间的日志就是「一个开着的 `turn/start`、没有 `turn/end`」；持久层只返回**物理有效的连续前缀**，只丢弃从未 resolve 的那半帧尾巴，不截断也不修复（单个 turn 可能很长，里面的事件是早已落盘的）。
2. **修复是读侧的活，且必须走同一个写句柄。** resume 侧计算 `interruptedTurnClosers` = 缺失的 tool 错误 + 任何未闭合的 `step/end` + 合成的 `turn/end { reason: { kind: 'interrupted' } }`，作为普通批次追加；`interrupted` 是循环自己永不会发的唯一 reason。**只读观察者**用同一套 closers 在内存里平衡，一个字都不写回。
3. **flush 是 checkpoint，不是唯一写入路径。** 事件通知路由进有界 write-behind 窗口（首个 pending 起固定窗口，后来的事件不重置截止时间），到期做一次 **durable append**；显式 `flush` 取消等待并 drain 到静止。被拒的后台写**按序保留事件**、暂停自动路径、经 logger 报出，下一次显式 flush 大声重试。
4. **两种拒绝是两类错。** 读不懂但不是坏了 = `SessionFormatUnsupportedError`（区别于 corruption）；当前格式回放**保留**标了 `ignorable: true` 的未知事件，历史版本迁移**即使 ignorable 也拒**未知类型；迁移准备不得改动任何源路径、字节、inode。
5. **元数据在日志之外。** `SessionHeader` 带格式版本、cwd、`isSeeded` 血统、`delegationDepth`、`agentPreset`，其中 delegation 深度明写「必须持久，否则重启后子会话被当成顶层」。
6. **只读句柄不喂尾巴。** `open(id,'read')` 只服务校验过的连续前缀切片；同一句柄重复读不会读到比上次更旧的状态。

## 3. 落差与决策点

| # | 议题 | 上游 | 我们 | 决策点 |
|---|---|---|---|---|
| D1 | 发布方式 | durable **append** 到写句柄 | 整文件 `File.writeTo` 重写 | 要不要改成追加发布 |
| D2 | 持久屏障 | 后端负责 durability | 无 fsync，写成功即算 durable | 要不要接 `FlushFileBuffers`（CFFI 新签名尚未编译过） |
| D3 | 中断恢复 | 读侧经写句柄合成 closers | 完全没有 | 要不要补，以及归谁写 |
| D4 | 未知事件 | required / ignorable 二分类 + 方向性拒绝 | 一律静默保留 | 词表要不要变成显式真源 |
| D5 | 会话元数据 | `SessionHeader` 独立于日志 | 无 | 要不要在本工作包内做 |
| D6 | 迁移 | 有格式代际与拒绝链 | 只有 `computeMigrationPlan` | apply/import 是否算 W10 交付 |

### D1 推荐：改成「追加发布」，而不是维持整写、也不要改回 rename 替换

现整写有一个按语义可推出的后果：`File.writeTo` **打开即截断**（这句是本仓 `flush` 上方注释自己写明的，不是我的推断），所以另一入口在重写窗口里读同一份 `session.log`，可能读到空文件或半份。**这一条本轮没有实测**，它进 §5 当正例去验，不许现在就写成「已复现」。这不是理论——本仓 `flush` 上方注释里那条实测就是「原地整写 vs 换名字」的对照：`rename(overwrite:true)` 是「先删目标再移入」，400 次覆盖 + 3474 次并发读里读者 **88% 看到文件不存在**、301 次抛异常；当时正是为了「保证目标始终在场」才保留原地整写。**追加发布同时满足两条**：目标文件全程在场、已提交前缀永不被收回。代价：格式从「可整份重放」变成「按帧顺序消费」，需要一次格式代际声明（见 §4），且崩溃尾巴处理逻辑要跟着挪；`mayOverwriteDurable` 的前缀守卫在追加模型下变成「偏移量单调」守卫。

### D2 推荐：接屏障，但把「断电」明确记成不可自动证明

`FlushFileBuffers` 需 `GENERIC_WRITE` 句柄，且仓颉 CFFI 的新签名在本机**尚未编译过一次**（既有证据已记）。所以顺序是：先自证 API 可用（cjpm 包内最小探针），再在 `flush` 里把「写完 → 刷 → 才推进 `flushedCount`」钉成一条；**短写或刷失败一律不推进 durable 计数**，并保留租约与内存态（这条现有 `-32003` 语义已经对）。真实断电无法用软件证明，按红线记 **BLOCKED（需真人断电/拔盘级验收）**，不许把「进程 kill 后重开全绿」写成「崩溃持久化已验证」——kill 只证明进程边界，不证明介质边界，这是两个不同的断言。

### D3 推荐：分两半，持久层只给「能算」和「能追加」，合成归 resume 侧

上游把修复放在读侧是有理由的：只有循环知道哪些 tool 在途。落到本仓：
- B（W10）在 `SessionLog` 侧提供两个纯能力：`unclosedTurnFrame()`（只读，返回未闭合 turn/tool/step 的判定，不写盘）和既有的批量 `append + flush` 通路；
- 合成 closer 的**调用点**归会话恢复入口（现 host `session/select`/CLI 回放链，属 A 的接线面），closer 的**词表**依赖 E（W40）——**注意：三类 closer 里 `step/end` 这个类型今天根本不存在**，补它等于动事件词表与 `agent.cj`，那是 E 的所有权。所以 D3 的实际前置条件是 E 先有 `step/end`（或明确不引入、改用别的闭合判据）。
- 只读观察者（UI 投影、session-query 语义）**一律不写回**，这条必须写进契约，否则桌面打开一次会话就篡改了日志。

### D4 推荐：词表升成真源，但拒绝只对「未来代际」生效

`isSurfaceEvent` 是唯一硬编码集合，其余 80 多个类型是散落字面量（生产侧清单已从 `append("x/y")` 归集，可按需附）。建议：新增单一真源表（类型 → required/ignorable/surface），回放遇到**表内**类型按分类走，遇到**表外**类型按当前代际「保留并记 log-only」处理——即与上游「当前格式保留 ignorable、历史迁移拒未知」方向一致，且**不会让现存任何一份 `session.log` 突然读不出来**。这条是本契约的向后兼容硬约束。

### D5 推荐：本工作包内先只做 `version` + `createdAt` + `cwd` 三项

理由：这三项是 D1 换发布方式后**必须**能自证代际的前提（旧日志要能被识别为旧代际）。`isSeeded`/`parentSession`/`delegationDepth`/`agentPreset` 依赖 fork 与子代理血统语义，本仓还没有 fork 入口，硬落一个没人写的字段就是死字段——留到有消费者时再进词表（并登记为自有增量，不占上游分母）。

### D6 推荐：`migration/apply` 单列一批

`computeMigrationPlan` 的计数与差异语义可复用，但「apply」需要 D1/D5 先定代际，才能定义「从哪一代迁到哪一代」。把它们捆在一起做，评审面会大到无法逐条核。

## 4. 冻结后的契约（批准即生效，未批准本文不算）

| 面 | 口径 |
|---|---|
| 帧格式 | 每帧 `seq \t eventType \t data \n`，TAB 三段、LF 结尾、seq 从 0 且等于序号；转义只覆盖 `\`、LF、CR、TAB。**代际声明**：追加发布需一个可识别的代际标记，落点二选一（首帧 header 事件 vs 独立 header 文件），本文推荐**独立 header 文件**，与 §2.5 一致且不改动已有帧一个字节 |
| 可见性 | `append` 实例内可见；`flush`（或 write-behind 到期）才跨进程可见；`pendingCount() > 0` 就是「内存有、盘上无」，UI 与 CLI 都必须按这个口径显示，不许把 `append` 当持久 |
| durable 计数 | 只有「写完且刷成」才推进；短写、刷失败、前缀守卫拒绝 → 计数不推进、租约不释放、错误原样回调用方 |
| 错误码 | 沿用 `-32001 already-owned` / `-32001 turn-in-flight` / `-32002 replay-rejected` / `-32003 flush-failed`；新增两类须与 §2.4 对齐：格式拒绝 ≠ 损坏拒绝，两者不得共用一个码 |
| 投影 | 只读路径永不写盘；中断 turn 在投影里标 `interrupted`，但不落盘（落盘只发生在恢复入口经写句柄追加 closer 之后） |

## 5. 正反验收清单（红先；每条都要能指名「改坏哪一行实现会让它红」）

正：追加后 kill 进程重开，前缀完整且 seq 连续；flush 返回后第二个进程立即可读到同一前缀；有 closer 合成时恢复出的 turn 以 `interrupted` 收尾且只写一次；带 `ignorable` 未知类型在当代际回放不报错；旧代际日志被识别并拒成「格式不支持」而非「损坏」。

反（缺一即不算交付）：中段缺帧整份拒绝（现有行为回归）；半尾帧丢弃但前缀保留；`mayOverwriteDurable` 拒绝缩短；刷失败不推进 durable 且保留租约；只读观察者不产生任何字节改动（用文件 mtime + sha256 双向断言，不是靠代码审查）；两个 writer 并发时恰有一个拿到租约；`append` 后不 flush 时第二个进程读不到（这条专门用来防止有人把 `append` 当持久化）。

变异反证点：把 durable 推进改成无条件、把只读路径改成顺手写回、把中段拒绝改成静默截断——三处各应杀一条指定用例。

## 6. 分工与写入路径（批准后生效）

- B：`core/src/session.cj`、`core/src/lease.cj`、`core/src/migration_pack.cj` 及对应 `*_test.cj`。
- A：`apps/host/src/main.cj`、`apps/cli/src/main.cj`、`apps/desktop/main.cjs` 的接线与错误码透出；协议面若新增方法名，先过 §2 的封闭字面集门禁（分母 82 会变，需同步 `scripts/check_host_method_surface.cjs` 常量）。
- E：`step/end` 与 tool 在途判定所需的事件类型（若 D3 选定合成 closers）。
- I：§5 全套独立复跑 + 上述变异反证。
- 矩阵纠偏（`persistence` ✔→◐）：由 B 或 A 落笔，但**必须等该文件上在飞的改动落库后**再做，避免行级踩踏。
- 计时敏感与并发用例（租约、双写、tail 截断）一律独占串行跑，并用私有 TMP（`scripts/verify-tmp.mjs` 已接进 `verify-all`）。

## 7. 需要你裁决的三件事

1. **D1**：批准把发布方式从整文件重写改成追加发布吗？（不批就只能维持「目标在场但读者可见半份」的现状，那 §5 的并发正例永远过不了。）
2. **D3**：中断恢复要不要在本轮做？若做，接受「`step/end` 归 E 先补」这条前置依赖吗？还是先只做持久层侧的 `unclosedTurnFrame()`、把合成留到 P2？
3. **D2 的验收口径**：真实断电/拔盘级证明你打算自己手动做一次，还是这一项从交付起就记 BLOCKED、由我在 P4 固定版本时再提请？
