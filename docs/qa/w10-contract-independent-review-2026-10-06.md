# W10 契约独立复核（I／W80，2026-10-06）

被复核对象：`docs/plans/w10-persistence-barrier-recovery-contract-2026-10-06.md`（设计稿，主责 A 起草、B 实施、I 复核）。
取证据形态：**提交级**，隔离副本 detached `5674a5c`（`D:/Temp/SaCode-w00-evidence-5674a5c-20261006`），不含任何在飞未落库文件。本文件不改代码、不批准代码变更，只核 §1 判据是否可复跑、有无读反。

## 1. §1 判据逐条复跑结果

| §1 断言 | 复跑命令（绝对路径下执行） | 提交级实测 | 判定 |
|---|---|---|---|
| `flush` 是整文件重写 | `grep -c "File.writeTo" core/src/session.cj` | 2 | 成立 |
| 重写前有只增不减前缀守卫 | `grep -c "mayOverwriteDurable" core/src/session.cj` | 3 | 成立 |
| 无句柄级持久屏障 | `grep -rn "FlushFileBuffers\|fsync" core/src` | **0 命中** | 成立 |
| 未知事件按 `isSurfaceEvent` 过滤 | `grep -c "isSurfaceEvent" core/src/session.cj` | 4 | 成立 |
| 独占写与三个错误码在位 | `grep -c "32001\|32002\|32003" apps/host/src/main.cj` | 54 | 成立 |
| 崩溃恢复合成 closers 不存在 | `grep -rl "interruptedTurnClosers" core/src apps/host/src apps/cli/src` | **0 个文件** | 成立 |
| `step/end` 事件类型不存在 | `grep -rho '"step/[a-z]*"' core/src apps/host/src \| sort \| uniq -c` | 只有 `"step/start"` ×1 | 成立 |
| 无会话元数据头 | `grep -rn "SessionHeader\|isSeeded\|formatVersion" core/src` | **0 命中** | 成立 |
| 迁移只有差异计算 | 见下节 | 类型在生产文件声明、构造点全在测试 | **措辞要纠**（见 §2） |

**矩阵落差同批改核**：`persistence` 行现记 ✔，而上面两条 grep 证明 closer 与 `step/end` 在实现侧一个字都没有 —— 按「标记/模拟/未接均不得判完成」应为 ◐。契约 §23/§6 已把这笔记为「等该文件在飞改动落库后再纠」，本复核不代写该行（该文件主责 A）。

## 2. 一处措辞要纠（不影响结论，影响的是「谁拥有这个类型」）

§1.11 原文：「`MigrationApplyResult` 仅在 `migration_pack_test.cj` 里手工构造」。提交级直读：

- 声明在**生产文件**：`core/src/migration_pack.cj:680` `public class MigrationApplyResult`
- 构造点只有测试：`migration_pack_test.cj:295 / :305 / :441`
- 全仓（含 `apps/host`、`apps/cli`）**没有任何函数产出它**

所以准确说法是「一个公开类型有声明、无生产者」，不是「类型只存在于测试」。这对 D6 是**加强**而不是削弱：`migration/apply` 的返回形状已经对外可见却零产出，正说明它现在只是夹具形状，把 apply 单列一批是对的；反过来，若按原措辞理解成「类型也在测试里」，下一批可能误以为删测试就能删掉这个对外 API。

## 3. 三个裁决点，从可验证性角度的补充（决定权在你，不是我不是 A）

- **D1 追加发布**：契约自己把「另一入口在重写窗口里读到空文件/半份」标为**本轮未实测**，这条口径是对的，别提前升格成已复现。可复跑的验法在 §5 反例里已具备（两 writer + `append` 不 flush 时第二进程读不到）。若批 D1，`mayOverwriteDurable` 的「前缀守卫」变「偏移量单调」，**现有三条钉住整写语义的用例会红**，那三条红是预期红、不是回归；建议批准后先让 I 把它们改名并改断言，再进 B 的实现，否则 B 会为了让旧用例绿而保留整写。
- **D2 接 fsync**：`FlushFileBuffers` 的 CFFI 签名在本机**从未编译过一次**（既有记录已声明）。因此 D2 的第一步只能是「最小探针编过 + 拿到非零句柄」，在那之前任何「已接屏障」的写法都是无证据。真实断电/拔盘按红线只能记 BLOCKED 并写明解锁动作；进程 kill 后重开全绿**只证明进程边界，不证明介质边界**，这两句应当原样进最终判据文本。
- **D3 分两半**：`step/end` 归 E 这条前置是硬的 —— 现在事件词表里没有这个类型，closer 词表依赖它。若你不接受「等 E」，那 D3 本轮只能落 `unclosedTurnFrame()`（纯只读判定）并把合成推到 P2；**不要**为了做出成品而临时用 `turn/end` 的某个 reason 代替 `step/end` 闭合判据，那会让「interrupted 是循环自己永不会发的唯一 reason」这条上游不变量在本仓失真。
- 另有 §4 的代际落点二选一（首帧 header 事件 vs 独立 header 文件）。契约推荐独立文件、理由是不改动已有帧一个字节；从复跑角度这一条更稳：**首帧 header 事件会让现存全部 `session.log` 的 seq=0 语义变味**，而 §5 的「旧代际日志被识别并拒成格式不支持」正需要「旧文件字节不变」才好断言。

## 4. 本批判据

§1 判据可复跑性 **PASS（9 条在提交级 `5674a5c` 全部复现，含 3 条 0 命中反证）**；§1.11 措辞 **FAIL（有声明、无生产者，非「仅在测试」）**；`persistence` 行 ✔ 与实现落差 **FAIL（账实不符，纠偏动作归 A/B，本批不代写）**；D1 后果（重写窗口读者可见半份）**BLOCKED（契约与本批都未实测）**；`FlushFileBuffers` 可用性 **BLOCKED（CFFI 新签名未编译过）**；三个裁决点 **待你裁决**。
