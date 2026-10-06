# P0 责任映射门禁与旧编译红灯复现（2026-10-06）

取证基线：分支 `refactor/dsh-learning`，取证时提交 `6fc3fbe`。本批不新增业务实现，只做 P0 步骤 2 的可复核判据与步骤 1/3 的红灯归因。

## 1. 新增门禁 `scripts/check_p0_ownership.cjs`

零依赖 Node，复核两本账的机械事实，不改任何状态列：

| 检查 | 判据 |
|---|---|
| 表头与列定位 | 按**表头名**取列，不按列下标（此前按下标取状态列实测造出「64 行全达标」假绿） |
| 分母 | 矩阵 63 个模块行 + 1 个 README 行；前端 54 个冻结包行 |
| 行形 | 每行列数与表头相等（拦合并行/吞行）；名字去重 |
| 集合差 | 与责任列加入前（`6cc063a^`）的表体模块名/包名做双向差集，须两边都空 |
| 主责 | 63 行每行恰有一个 ∈ 九成员的主责；成员↔工作包逐行配对（B=W10…H=W70）；A/I 不占业务行；README 行两列均为 `—` |
| 状态列 | 取值只认 `✔ ◐ ☐`；表体计数与文档现值锚点行相等 |
| 前端两列 | `界面主责` ∈ 成员；`后端协作` 只能是成员或 `—` |

读数（工作区，含本批新增的锚点行）：

```
GATE: PASS (17 checks, fail=0)   rc=0
SELFTEST: PASS (probes=17, missed=0, baseline=green)   rc=0
```

反证按 `lint-gate-negative-test` 做足 17 项：每项各注入一处只有它能杀的违规，要求该项**自己的检查名**新出现在 FAIL 集里。两处值得记下的探针细节：

- `current-tally-matches-table` 的探针**只改数字、锚点行留在原位**。上一版探针顺手改动了锚点文字，于是「锚点消失」把这条顺带带红，等于没证明按数对账在跑。
- 第一版门禁自己有两处假红，都是被实测打脸后修的：分隔行按 `^:?-{3,}:?$` 认不出 `:-:`（于是把分隔行当模块行，分母报 64）；备注列里 `\`a | b\`` 形态的代码片段被朴素 `split("|")` 拆成十几列，主责列读到备注正文。改成反引号与 `\|` 感知的切分后才是真读数。

## 2. 矩阵现值计数锚点

`docs/plans/dsh-capability-matrix.md` 表体前新增一行现值口径：

```
表体计数（门禁 check_p0_ownership 机械复算，唯一现值口径）：✔ 9 / ◐ 54 / ☐ 0
```

此前文档里同一件事有三处各说当年的计数（`✔12/◐51`、`✔10/◐53`、`✔9/◐54`），拿任意一处对账都会把某批的历史快照当成现值。本批**没有改动任何模块的状态列**，只是把「谁是现值」这件事钉死。结构复核：`md_structure_diff.cjs` 对 HEAD 与工作区做标题与表格行首多重集比对，`9 标题 / 71 表行`，`RESULT: PASS lost=0`。

## 3. 旧编译红灯：复现与失效解释（P0 门槛第 3 项）

实测复现，非推断：

- `cb472e3`（10:37）新增 `core/src/plugin_assembly.cj`，其 `asJson()` 在第 78、85 行调用 `optJson(...)`。
- 该提交及其后一直到 `b655bf9`，整个 `core/` 与 `apps/` 里**没有任何** `func optJson` 定义（`git show b655bf9:core/src/plugin_store.cj` 计数为 0；`git log -S "func optJson"` 只命中 `6cc063a` 一次，说明此前从未存在）。
- `b655bf9` 工作区留下的宿主构建日志原文：`error: undeclared identifier 'optJson'`，位置正是 `core/src/plugin_assembly.cj:78:89` 与 `:85:17`，并伴随两行 `type incompatible in this compound assignment expression`。
- `func optJson(field: String, value: String): String` 由 `6cc063a` 补进 `core/src/plugin_store.cj:44` — 那个提交的名义主题是「通用设置持久化」，**没有任何一处说明它顺带修了编译**。
- 仓颉包机制文档（`cangjie-lang-features/package` §5.2）：顶层声明默认 `internal`，当前包及子包可见。`optJson` 与调用方同属 `package core`，按文档该定义应能被看见。

因此这条红灯的结论分两档，不许混写：

- **S0 实测**：`cb472e3..b655bf9` 这段提交上，core 编译不过，报错原文与位置已复现。`cb472e3` 的提交信息「plugin_assembly 编译修复」与实际落库内容不符。
- **S1 文档级、尚未实测**：`6cc063a` 起定义存在且同包可见，按文档推断 HEAD 应能编过。这条要在 `cjpm test`/`cjpm build` 真跑之后才能升为 S0。

## 4. 本批未做与阻塞

| 项 | 判定 | 前提与下一步 |
|---|---|---|
| 固定提交（`6fc3fbe`）上的 core/桌面/extjs/产物基线回归 | **BLOCKED** | 取证时刻本机有并发会话的 `cjc.exe`/`cjpm.exe` 在飞（实测进程表可见）。公共构建与计时敏感测试必须串行——`verify-all.mjs` 自己就写着并发构建会撞 `ld.lld: Permission denied`。等并发构建结束后在隔离的 HEAD worktree 里按 `node scripts/verify-all.mjs` 逐条记 PASS/FAIL/BLOCKED |
| `docs/evidence/verification-run-2026-10-06.md`（`66afa74`）里的既有红灯逐条复现或归因 | **未完成** | 那份读数是更早提交上的：core `TOTAL 702 / ERROR 6 / FAILED 2`、desktop `fail 3`、ui-smoke `FAIL 2`、pack-cli 缺 MinGW 运行时 DLL。这些都要在当前基线上重跑后分类为「已失效 / 仍存在 / 环境阻塞」，不能沿用其结论 |
| 把门禁接进 `scripts/verify-all.mjs` 作为一步 | **未做** | `verify-all.mjs` 是公共构建入口，另一条会话线正在动同一片文件；按「同一时刻重构公共文件与追加接线不得并行」留作下一批由 A 单独接线。当前以 `node scripts/check_p0_ownership.cjs` 单独跑 |
| 一切皆插件的实际装配闭环、两入口交付 | **未触碰** | 本批只登记责任槽位，不改变任何能力状态；W10–W70 的实现与验收仍按各工作包推进 |

责任映射是**任务槽位登记**，不是能力完成声明：它不证明入口接通、不证明插件实际归属、不升级任何历史 PASS，也不构成「P0 已完成」的判据。P0 的四个门槛里，本批只把「范围无漏项、主责不重叠」变成机械可复核的读数；「旧红灯有复现或失效解释」只完成了上面第 3 节那一条；「接口消费者明确」与固定提交回归仍开放。
