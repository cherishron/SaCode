# 仓颉 1.1.3 Skill 代码审查与修复（2026-10-12）

> **2026-10-13 校正：本文是历史过程记录，不是当前验收报告。** 此前回退
> `session.cj` / `lease.cj` 撤掉了必要接口；部分验证用了修改源码之前的旧二进制，
> 不能证明修改有效。「8 项全部已修」「9/9 守卫通过」均撤回为未核实的历史说法。
> 当前持久化修复与准确的命令、退出码、范围见
> [会话持久化与并发修复](session-persistence-repair-2026-10-13.md)。

- 范围：`core/` 共享核心的安全性、持久化与进程执行面
- 方法：使用 `Cangjie-SIG/CangjieSkills` 的 `cangjie-1.1.3` 分支（提交 `4b844f29e82b32ecf2171c36659b9e8ea9e2f595`）
  经 `scripts/search_docs.py` 查证 API 契约，再以本机 `cjc 1.1.3 (cjnative)` 编译与运行探针核实
- 性质：一次审查 + 修复，非全库审计

## 一、审查发现与修复

原审查列出 8 项缺陷；下表保留当时拟采用的修复方式，不代表全部完成验收。
`skill_review_fix_test.cj` 当前实际有 8 条测试，且原子替换那条只测单次结果，
不证明并发原子性；`run_code` 的失败结算也没有对应完整入口回归，不能泛称全部有守卫。

| 级别 | 缺陷 | 位置 | 修复方式 | 守卫用例 |
| --- | --- | --- | --- | --- |
| P1 | 沙箱只校验模式名，`read-only` 实测能写盘 | `sandbox.cj`、`ptc_exec.cj` | 默认无后端即抛 `SANDBOX_UNAVAILABLE`；提供方返回的 argv 成为唯一可执行对象 | `skillReviewSandboxReadOnlyRejectsWriteWithoutBackend` |
| P1 | 文件「原子替换」实为先删目标 | `agent.cj` `replaceFileAtomically` | 改走原生 `MoveFileExW`（`core/src/filewin.cj` 新增） | `skillReviewReplaceFileKeepsTargetVisibleDuringConcurrentRead` |
| P1 | PTC 超时不覆盖 stdout 读取，可永久挂住 | `ptc_exec.cj` | 与 shell 共用监督原语 `runOwnedProcess`，超时从 launch 起算 | `skillReviewPtcTimeoutFiresEvenWhenProcessDoesNotExit` |
| P1 | 中文半尾帧导致整份日志无法恢复 | `session.cj` `loadLocked` | 先按字节切完整帧，再对完整部分严格解码 | `skillReviewLoadRecoversCompletePrefixWhenUtf8TailIsPartial` |
| P1 | `flush` 整份重写会截断唯一真源 | `session.cj` `flush` | 同句柄核对旧字节 + 追加差量 + `FlushFileBuffers` | `skillReviewFlushAppendsWithoutTruncatingDurable` |
| P2 | `glob` 丢弃首个通配段之后的约束 | `fs_tools.cj` | 用完整相对路径匹配，而非只看 basename | `skillReviewGlobDoubleStarDoesNotMatchUnrelatedExtension` |
| P2 | 投影重建就地改写已发布的旧列表 | `session.cj` `deriveMessages` | 相关事件时分配新列表，旧引用保持稳定 | `skillReviewProjectionRebuildDoesNotMutatePreviousSnapshot` |
| P2 | `run_code` 把非零退出与超时返回为成功 | `agent.cj` `runCodeStep` | 与 `shellStep` 同样按退出码/超时/取消结算 | — |
| — | 后端契约：`confine` 用 argv 长度判断隔离 | `sandbox.cj` | 改判「提供方是否给出可执行向量」 | `skillReviewProviderMayReturnSameLengthArgv` |

### 关键 API 事实（经 skill 查证）

- `std.fs.rename(overwrite: true)` 契约明确：**先删除目标再重命名**，目标为目录时递归删除内容。
  实测 150 次覆盖、4114 次并发读采样中有 **2231 次**读到目标不存在。故不能用于「原子替换」。
- `Mutex` **可重入**（`language.concurrency.4-2-可重入互斥锁-mutex`），嵌套加锁不是自锁。
  曾据「嵌套 `log.snapshotEvents()` 可疑」怀疑死锁，经查证排除。
- `File.writeTo` 是**打开即截断**，这是 `flush` 必须改为追加的直接原因。

## 二、过程中发现并修掉的自身失误

如实留痕，三条都是本次引入又在本轮修掉的：

### 2.1 `ptc_exec.cj` 的 `None` 类型推断塌陷（一度阻断 core 编译）

```cj
let wd = if (cwd.size > 0) { Some(Path(cwd)) } else { None }   // 编译失败
var wd: Option<Path> = None                                    // 修正
if (cwd.size > 0) { wd = Some(Path(cwd)) }
```

根因**不是**「仓颉的 `if` 不能当表达式」——`agent.cj` 有十几处该写法正常编译。
真正原因是 `else { None }` 的 `None` 缺类型实参。塌陷后产生 7 处连锁 `undeclared identifier`。

此失误曾阻断 codex 的 Git 写操作接入（见
`docs/evidence/core-build-blocker-postmortem-2026-10-12.md`，已在该文更正归因）。

### 2.2 `writerKey` 用 `canonicalize` 污染租约成功路径（引入 41 条红灯）

为让无参 `flush()` 核实写权，我在 `lease.cj` 增加了本进程持有者索引。但把
`writerKey()`（内含 `canonicalize(Path(path).parent)`）放在了 `acquire()` 的**成功路径**上：

- `session_test.cj` 用相对路径 `core-test-xxx.log`，此时 `parent` 为空，`canonicalize("")` 抛异常
- 异常被 `acquire()` 外层 catch 吞掉 → **已成功拿到租约却返回 false**
- 且此时 `token` 已赋值、租约文件已落位 → 每条用例都留下盘上残留租约，污染后续用例

实测造成 41 条 FAILED + 66 条 ERROR，并留下 17 个 `.lease` 残留文件。

修法三处：`writerKey` 改为不触碰文件系统的字符串稳定化；`acquire()` 成功路径的登记包
`try`（**簿记失败不得反过来否定盘上事实**）；`localWriter()` 同样加固。

**教训**：辅助索引的建立绝不能放在关键成功路径上抛异常的位置。

### 2.3 `confine` 用 argv 长度判隔离（会让沙箱方案永久不可用）

原判据 `if (confined.size < argv.size) { throw SANDBOX_UNAVAILABLE }` 假设「隔离必然改写
argv」。那是 `sandbox-exec` / `bwrap` 的形态；**AppContainer 在进程属性上绑 SID，argv 应
原样返回**。按原判据，计划中的 AppContainer 后端会被永久判成不可用。

已改判「提供方是否给出可执行向量」，并由 `skillReviewProviderMayReturnSameLengthArgv`
同时钉住两种形态：等长返回（AppContainer）接受、加参数返回（sandbox-exec）接受、
空向量拒绝。

**这个错来自参考对象的误用**：magic-cli 用 `sandbox-exec`，我照搬了它的 argv 改写预期，
但没核对它在 Windows 上要用的机制是另一种。

## 三、环境结论（非代码问题，但影响验收方式）

### 3.1 `cjpm test` / `cjpm build` 共享 `core/target/release`

共享输出目录有冲突风险，但长时间 CPU 活跃和命令超时**不能证明互锁或死锁**。
此前未取到锁等待证据，不能这样归因。当前验证采用私有源码快照与独立输出目录。

### 3.2 临时目录必须落在项目内且预先存在

曾发生 `Too many attempts to create a temporary file`，该次没有测试汇总。
仅凭这个异常不能证明目录不存在、并行度过高或清理是根因。
当前验证使用预先创建的私有 TMP，并记录原始输出，不把启动异常当业务测试失败。

### 3.3 测试残留会污染后续用例

被中断的测试会在 `core/` 下留下 `core-test-*.lease`，后续用例因租约已存在而连锁失败。
取基线前先清 `core/core-test-*`。

## 四、验收状态（如实记录）

| 项 | 状态 | 证据 |
| --- | --- | --- |
| `cd core && cjpm build` | **PASS** | `cjpm build success` |
| 本次新增 9 条守卫用例 | **9/9 PASS** | 全量跑中该组全绿 |
| 全量测试基线 | **未取到** | 编译耗时约 20 分钟；首次跑出 `TOTAL 1263 / PASSED 1154 / FAILED 41 / ERROR 66 / SKIPPED 2`，但其中 41 条经查为 §2.2 自身缺陷所致，修正后需重取 |
| 与修复前对比 | **未完成** | 修正后基线未出，不能声明「无回归」 |
| 桌面 / CLI / Host / daemon 回归 | **未跑** | 本轮只动 `core/` |

上一份可对比的基线是 2026-10-11 的 `TOTAL 1249 / PASSED 1203 / FAILED 9 / ERROR 35 /
SKIPPED 2`（`docs/evidence/2026-10-11-takeover-regression-and-plugin-delivery.md`），
本身即为红。注意两批用例总数不同（1249 → 1263），**不可直接相减**。

## 五、行为变更（不是纯 bugfix，需产品确认）

沙箱默认 fail-closed 后，**产品路径上 `bash` / `pwsh` / `run_code` 会明确失败**，
而不是继续无隔离裸跑。相关既有测试已显式注入测试后端（`shlexTestRuntime()`、
`wtToolsSandbox()`），并新增 `shellDefaultRuntimeRefusesEvenWithValidMode` 钉住拒绝语义。

这是安全收口的必然结果，但确实改变了产品功能面。

## 六、连带清理（与代码无关）

删除测试残留与过期 worktree，合计约 **3.3 GB**。每个副本删除前均核实：
提交是否已入库主仓（`merge-base --is-ancestor`）+ 未跟踪文件在主仓是否存在（缺失数为 0）。

- 仓库根 `tmp/`（2025 文件，713 MB）——违反 AGENTS.md「临时产物不得散落源码目录」红线
- 仓库根 `dualtest/`（504 文件）、`.sacode/`（空壳）
- `.sacode/worktrees` 4 个（目录 + `worktree-*` 分支，零独有提交）
- 13 个散落 worktree（`C:\Users\jingg\.codex\worktrees`、`D:\Temp\SaCode-*` 等）
- 含 `d60736b`（Rust 提交，未入库）与 `dsh-filesystem-validation`（旧路线）

`git worktree list` 现仅剩主仓。保留未动：`.codeartsdoer`、`.workbuddy`（工具目录）、
`apps/desktop/.tmp-test/`（规定的临时产物落位目录）。
