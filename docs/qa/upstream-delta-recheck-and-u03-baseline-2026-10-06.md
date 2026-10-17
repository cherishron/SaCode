# 上游增量台账独立复核 + U03 插件来源与异常卸载现状定档（I／W80，2026-10-06）

被复核对象：`docs/evidence/dsh-upstream-delta-analysis-2026-10-06.md`（`95f111d`）。
本文件**只核不改**：不改实现、不升级冻结基线、不动别人的账本行。

## 1. 台账数字独立复跑：全部吻合

复跑通道不是「相信报告里的数」，而是把同一件事在**五个互不依赖的产物**上各算一次：仓内两份机器清单、仓外捕获件 `git-name-status.txt` / `commits-complete.json` / `compare-page-{1,2,3}.json`。

| 断言 | 复跑结果 | 判定 |
|---|---|---|
| 区间 266 个唯一提交（含合并提交） | `commits-complete.json` 266、仓内 `dsh-upstream-delta-commits-*.json` 的 `commits` 266、`commit-titles.txt` 非空行 266 | 吻合 |
| 分页补齐 100 + 100 + 66（GitHub compare 250 上限） | 三页分别 100/100/66，合计 266 | 吻合，上限确实被补齐而不是被截断 |
| 4,760 个变化路径，新增 1,163／修改 2,538／删除 1,059 | `git-name-status.txt` 4760 行，`A 1163 / M 2538 / D 1059`；仓内 files 清单 `status` 同分布 | 吻合 |
| 路径分类互斥且合计等于分母 | `inventoryCategory`：notes 2267、documentation 1252、tests 451、manifest 339、implementation 291、build-config-resource 160，合计 **4760** | 吻合，且分类字段就在清单里（表不是手抄） |
| 「261 份 JSON 包清单只改自身 version」 | `disposition=version-only-no-feature-credit:261` | 吻合 |
| 提交与路径两份清单同源 | 路径集合与提交 SHA 集合的**双向差集均为 0**（`ns↔fc↔repo` 四向、`commitset 266/266` 对称差 0） | 吻合 |

**两个 `wc -l` 陷阱当场踩到并纠正**：`file-paths.txt` 与 `commit-titles.txt` 用 `wc -l` 各少 1（4759 / 265，末行无换行符）。按「非空行」重数才对得上分母。**结论**：拿行计数当分母时必须按非空行重数，`wc -l` 在这种捕获件上会造假阴。

**唯一要修的是 §7 的复查通道**：那两条命令写着「针对独立官方 Git 副本」，而 `D:/Temp/SaCode-upstream-full-audit-20261006/` 里**没有 `.git`**（`ls -d .git */.git` 全部 No such file），留下的是两端解包目录 + 捕获文本 + API 页 JSON。所以按原文逐字执行只会得到 `fatal: not a git repository`。⇒ 数字本身可复核（我就是用捕获件复核过的，见上表），但**文档里的命令要真跑通**：§7 应改成「从 `git-name-status.txt` / `commits-complete.json` 重数」或把那份 clone 留在原位。这条不是挑格式刺 —— 下一批如果有人照 §7 跑，会误判成「台账不可复现」。

**冻结基线未被动（复核过，不是听声明）**：在 `b81dae2` 上重跑 `node docs/qa/check-matrix-evidence.cjs` ⇒ `row-denominator: 模块行 63（需 63）、README 行 1（需 1）`、`state-column-values-valid: ✔9 ◐54 ☐0`，与 `scripts/check_p0_ownership.cjs`（17 项全绿）一致。上游那 266 条提交没有把矩阵分母抬走，S0 口径仍是 `639ed01`。

## 2. U03（下一批优先项）仓内现状定档

上游 U03 的处置写的是「承接并补来源脱敏策略（W20/W60），**去 userinfo 不等于查询参数已全脱敏**，需另核 token query；测试别名、本地相对目录、缺包卸载、版本不符、重试和安装失败回滚」。逐条对到本仓代码：

| 上游要点 | 本仓现状（直读 `core/src/plugin_store.cj` 与桌面 adapter） | 定档 |
|---|---|---|
| 保留多来源：npm alias、Git/URL、本地 file/link | `inspectSource(sourcePath)` 与 `install(sourcePath)` 只吃**本地绝对路径**（`looksLikeAbsolutePath` 直接 `refused`，`plugin-source-not-found` 要求 `isDirectory`）。脱敏关键词按面复跑：`grep -rn "userinfo\|maskUrl\|redact\|sanitiz\|脱敏" core/src/*.cj apps/host/src/main.cj apps/desktop/renderer/pages/*.ts extjs/*.cjs` ⇒ 插件面 **0 命中**，只有 HTTP 正文侧的 `redactBody`（`core/src/transport_failure.cj:99`） | **本仓没有多来源这回事**。「来源脱敏」今天是一个**无前提的空检查**：真正要做的顺序是先扩来源类型，脱敏才有对象。桌面 `plugin-manager-adapter.ts` 已经留了 `host`（≤300）字段形状，那正是 URL 会落进去的位置，也是将来 userinfo/query-token 必须收口的位置 |
| 展示 URL 去 userinfo，另核 query 里的 token | 同上：`host` 现在装的是本地目录，不含凭据 | 记 **不适用（前提未成立）**，不得写成「已吸收」。若有人为了凑这项去加一个「脱敏函数」而没有来源类型，那造出来的是没人调的代码 |
| 没有可解析包的残留配置也能移除 | `uninstall()` **先记账再动目录**，删目录用 `removeIfExists(rec.directory, recursive: true)`；目录已消失时不抛异常，记录照常结算；缺 manifest 的记录走 `degraded(rec, "plugin-manifest-missing")` 仍被列出 | **行为已成立**（`:383-402`、`:633`） |
| ↳ 但要有定向测试 | 卸载相关只有一条用例 `pluginStoreUninstallRemovesDirectoryAndKeepsRevisionCas`（`plugin_store_test.cj:245`），它删的是**存在**的目录；「缺包卸载」这条上游明列的验收**无测试** | **可立刻补的红先用例**（成本最低、语义最硬的一条）。注意 `plugin_store_test.cj` 此刻在飞（+3/−1），补之前先看 C/W20 是否已经在动同一处 |
| 记录实际安装版本，解释 minimumReleaseAge 给的旧版本并给精确 spec | 装后从目录 manifest 取版本再落账（`installEventData(manifest.name, manifest.version, slugOf(...))`），adapter 另带 `runtimeVersion` 与 `peers`，安装进度有 `plugin-install-progress-rejected` 校验 | **实际安装版本已记**；`minimumReleaseAge`／精确 spec 是 **npm registry 语义**，本仓无 registry 通道 ⇒ 属自有缺口而不是「上游没做」，也不占 63 行分母 |

**顺带一条台账缺口同源**：能力矩阵 `extensions` 行现记 ◐，且它是证据门禁 WARN 七行之一（「有实现引用但备注未登记测试/用例」）—— 与上表「缺包卸载无测试」是同一处的两面：行为有、用例没登记。补完定向用例时一并把备注写全，`node docs/qa/check-matrix-evidence.cjs` 的 `test-note` 少一项才算真收口。

## 3. 建议的下一批动作顺序（不越权，只排序）

1. 先由 C/W20 把在途的 `plugin_lifecycle.cj`（+114）/`plugin_lifecycle_test.cj`（+128）落库 —— 上游 U04 明确「等在途生命周期改动落库后接入」，U03 的卸载语义也落在这条线上；不落库，任何「已承接」都无法复跑。
2. 补一条**缺包卸载**红先用例（目录先删掉再 `uninstall`，断言仍结算、记录消失、revision 单调），顺带把矩阵 `extensions` 行备注的测试出处补上。
3. 「来源类型」作为**独立设计点**先定契约（别名／本地相对目录／Git／URL 四类里到底做哪几类），再谈脱敏。跳过这一步直接做脱敏，等于给不存在的输入写守卫。
4. `minimumReleaseAge`／精确 spec 类项目登记为**自有增量或不做**，不占上游分母，也不在矩阵里冒充已承接。

## 4. 本批判据

台账数字可复现 **PASS（6 项断言在五个独立产物上交叉吻合，路径与提交双向差集为 0）**；§7 复查命令 **FAIL（指向的独立 Git 副本无 `.git`，按原文执行必红；数字改从捕获件复跑成立）**；`wc -l` 分母陷阱 **已纠正并登记**；冻结基线未升级 **PASS（`b81dae2` 上 63 行 / ✔9 ◐54 ☐0 重测一致）**；U03「残留卸载」行为 **PASS（直读 `removeIfExists` + `degraded` 路径）**；U03「缺包卸载」定向测试 **FAIL（无此用例）**；U03「来源脱敏」 **不适用／前提未成立（本仓只有本地绝对目录来源，不得记为已吸收）**；U03「实际安装版本」 **PASS（装后读 manifest 落账）**；`minimumReleaseAge` 类 **自有缺口，不占上游分母**；在途 `plugin_lifecycle` 未落库 **BLOCKED（下一批复跑前提）**。
