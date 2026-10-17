# 产物统一与保留策略（2026-10-16）

**状态**：**已执行**。方案 A（统一可丢根 `target/tmp/`）当日落地：机械迁移完成、旧根清障完成、守卫 `scripts/check_artifact_placement.cjs` 上线并自证。遗留两个小步：安装包重打（待拍板）与守卫接线 `verify-all`（登记于 UNWIRED_GATES）——见 §9。收尾增量（全量测试首跑事故与 4 处漏网写入方修复）及 codex 交接见 §10。
**范围**：一次性运行产物、验收输出、批次打包输出、日志与私有副本的落点、命名与保留策略；分发产物（安装包 / npm 包）只定义"放哪、留几代"，不改生成链路。
**互补文档**：[`test-layout-2026-10-15.md`](test-layout-2026-10-15.md) 管"测试**源码**放哪"；本文管"**产物**放哪"。

---

## 0. 结论摘要（执行后修订）

1. 方案 A 已落地：仓根 `target/tmp/` 成为唯一"可丢根"（`**/target/` 已全局忽略），`dist/` 只保留当前正式分发产物。迁移与清障在 codex 停止后的单批窗口内完成。
2. **旧根名核零**：`.tmp-test` 在源码 / 脚本 / CI / 测试范围内已零引用（唯一豁免是守卫脚本自身，因为针缝在那里）；`dualtest` 不作字符串门——它作为 `target/tmp/` 下的子区名继续合法使用，退役性改由"目录存在性"检查覆盖（§6.4 决策记录）。
3. 三件"防复发"设施到位：保留策略（§5，`target/tmp/README.md` 规则卡已建）、守卫（§6.4 上线并自证）、命名规则（§4）。
4. 两个执行前风险已消解：仓根 `desktop/` 已删（误提交路径消失）；安装包仍为"全仓无包"状态，等待重打（§9.1）。
5. **实测修正**：规划期"51 个源文件 + 1 CI"的迁移面，执行中核为：脚本替换 32 文件（复跑幂等）+ 人工精修 36 文件 + 新增守卫 1 + 门禁登记 1；另有执行中新发现的 core / 仓根残渣 9 项一并处置（§6.3）。

---

## 1. 执行前现状快照（2026-10-16 10:20–10:45，只读检查；保留作证据）

| 位置 | 角色（当时） | 实测 | 问题 |
|---|---|---|---|
| `apps/desktop/dist/` | 分发位 **与** 批次构建混放 | 10:22 为 5.6 GB（`electron/` 下 15 个批次构建目录 + 2 个安装包 + preview/layout/ts 等）；10:36 被并发清理后剩 425 MB（`project-picker-final-20261012` 335 MB + `host/` 63 MB + `team-recheck/` 28 MB） | 批次构建从不清理地从这里长出来；清理不可预期——**要留的安装包也被清掉了** |
| `apps/desktop/.tmp-test/` | 文档指定的"统一临时根" | 375 项 / 4.1 GB；全部条目晚于 10-14 | 轮转尚健康，但根名带 desktop 前缀，文档需专门解释"不表示里面的测试都归 desktop 业务" |
| 仓根 `target/` | cjpm 构建目录 **兼** 会话散名暂存 | 799 MB；cjpm 自有（`release/`、`.cjpm-history`、`.dep-cache`）+ 20 余个散名暂存（`acp-rebuild-*` 235 MB、`host-lease-current-20261016` 96 MB、`core-gate-current` 60 MB……） | 两类内容混放，无法一眼判断"哪些可删"；散名暂存均无脚本引用，属随手命令 |
| `dualtest/` | 4 个桌面测试的日志根 | 96 文件 / 164 KB；当天仍有新文件 | 10-15 清过又被**重建**——清理治标不治本，代码里的路径指针没改 |
| 仓根 `desktop/` | **误建目录** | 12 MB；创建于 10-15 23:46 | **未被 gitignore**（`?? desktop/`），误提交风险；"路径手拼出错"的活样本 |
| `D:\Releases\SaCode\` | 仓库外交付副本 | 10:36 被删，父目录现为空 | 仓库外副本无保留规则，同样"不可预期被清" |
| `npm/sacode-cli-*/bin/` | npm 平台包载荷 | 57 MB，已被忽略 | 正常，保留 |

**成因（为什么"哪里都是"）**
1. **四个"根"并存**：dist / `.tmp-test` / `target` / `dualtest`，各自的规则边界从未写全；
2. **路径靠各脚本手拼**，没有单一解析源——拼错就产出仓根 `desktop/`、`apps/desktop/apps/desktop/.tmp-test` 这类游离目录（后者实测残留过）；
3. **无守卫**：新目录出现在哪里，没有任何检查会失败；
4. **无保留策略**：谁都可以清、谁也不知道该留什么——安装包被清就是代价；
5. **并发会话无协调**：多会话同时读写同一批目录。
- 注：项目里已有「临时产物只落一处」的红线概念，但当时只存在于 1 个测试的注释里，未成文、未设防。

---

## 2. 目标与约束

**目标**
- G1 单根：一次性可丢产物只有一个物理根；
- G2 可辨识：看目录名能判断归属、用途、是否可删；
- G3 可回收：有保留策略与清理节奏，不靠"谁想起来了谁清"；
- G4 不依赖：原始输出永远可丢，结论进 `docs/evidence/` 或 `docs/qa/`；
- G5 并发安全：唯一命名，多会话互不覆盖；
- G6 可守卫：违规落点会被自动检查拦住。

**约束**
- C1 cjpm 语义：`target/` 是构建目录，任何 clean/重建都可能连带清空 → target 下只能放"可随时丢"的东西；
- C2 忽略规则：`**/target/` 已覆盖目标根，无需新增规则；
- C3 分发产物（`dist/` 安装包、`npm/*/bin`）语义独立，不进"可丢根"；
- C4 删除纪律：沿用 `docs/testing.md` §3——核绝对路径 / 链接 / 受管文件 / 进程占用，禁 `git clean -fdx`，不误删依赖与正式分发目录；
- C5 并发协调：迁移触及共享桌面 / 打包文件，选并发空档单批作业、不与他人未提交改动混提；
- C6 Windows 句柄：删除失败可接受，记录后待重启重试。

---

## 3. 方案与弃案（已按方案 A 采纳）

| 维度 | 方案 A：仓根 `target/tmp/`（**已采纳**） | 方案 B：维持 `apps/desktop/.tmp-test/`（未采纳） |
|---|---|---|
| 物理位置 | 仓根 `target/tmp/`（已被忽略，零新规则） | 现状不变 |
| 根级观感 | 仓根只有 `target`（构建+暂存）与 `dist`（分发） | 仍有三处派生目录 |
| 迁移成本 | 一次性字符串级迁移 + 全量回归 | 最小，但包袱与散名问题保留 |
| 命名包袱 | 消除"desktop 前缀装非 desktop 内容"的历史 | 保留 |
| 与意图 | 一致（"限制在 target 下"） | 不一致 |

**弃案**（记录理由，防止反复讨论）：
- **junction 桥接**：不可见、Windows 下递归删除有跟随链接的风险、两套路径名继续存在，与"可辨识"相悖；
- **新顶级根 `.artifacts/`**：引入第三套规则、迁移面最大，无额外收益。

---

## 4. 目标布局（方案 A 定稿版，已落地）

```
<repo>/
├── target/                     # cjpm 构建目录（派生品总仓）
│   ├── release/  .cjpm-history  .dep-cache   # cjpm 自有，勿动
│   └── tmp/                    # 唯一"可丢根"：可随时整体清空
│       ├── README.md           # 规则卡：命名、归属、TTL、KEEP 清单（已建）
│       └── <用途>-<日期>-<短id>/   # 例：cleanup-round2-20261016.mjs 所在的批次
├── apps/desktop/dist/          # 仅分发产物：当前正式一代安装包 + win-unpacked + 正式宿主
├── npm/sacode-cli-*/bin/       # 平台包载荷（发布用，保留）
└── core/target、apps/*/target  # cjpm 成员构建输出（维持现状）
```

**命名规则**：`target/tmp/<用途>-<YYYYMMDD>-<短id>/`
- 用途小写（`verify` 验收 / `build` 构建 / `pack` 打包 / `probe` 探针 / `run` 其他一次运行）；
- 短 id 用时间戳或 8 位随机后缀；**禁止**无日期的裸用途名、禁止直接写 `target/tmp/` 根下散文件；
- 退役：旧桌面临时根、仓根 `dualtest/`、仓根近形目录（`desktop/`、`apps/desktop/apps/`）。
- 落地注记：本批有部分条目沿用旧名迁入（如 `cjpm-run-probe`、`desktop-current-candidate` 候选），属挽救搬运、不再新建；新条目自本批起按上述规则。

---

## 5. 保留与清理策略（执行后版）

| 区域 | 保留什么 | TTL / 节奏 | 清理前置检查 |
|---|---|---|---|
| `target/tmp/` | 无（全部可丢） | 7 天；每批结束顺手清、每周全清 | 跳过 24h 内新目录；核进程占用 |
| `dist/electron/` | **仅当前正式一代**：`win-unpacked` + Setup + portable（如需回退，最多保留上一代）。当前实际保留：`project-picker-final-20261012/`（正式预览） | 新代产出后清旧代 | 对照 `target/tmp/README.md` 的 **KEEP 清单**；安装包不得作为"临时产物"清理 |
| `dist/` 其他 | `host/` 随正式宿主更新；一次性目录（如 `team-recheck`）不保留 | 即产即清 | 同上 |
| 旧桌面临时根 | 已整体清空删除（迁移完成） | — | 台账见 `target/tmp/artifact-disposal-20261016/manifest.txt` |
| 仓根 `dualtest/` | 已删；写入方已迁 `target/tmp/dualtest/` | — | 同上 |
| 仓根日志 `*.log` | 已删历史遗留（`build-daemon.log`、`tool-session.log`）；今后不落仓根 | 随手 | R1 守卫拦截 |
| `npm/*/bin`、`D:\Releases` | 发布载荷保留 / **不再**在仓库外留副本（以 dist 为唯一来源） | — | — |

**KEEP 清单机制**：`target/tmp/README.md` 已写死"分发保留清单"。任何清理动作先对照该清单，与 `docs/testing.md` §3 删除纪律并用。

---

## 6. 执行记录（2026-10-16）

### 6.1 机械迁移

- 迁移脚本 `target/tmp/migrate-retired-roots-20261016.mjs`：替换 32 个文件中的旧根字面量（P1 字面量 / P2 分段 / P1b ps1 反斜杠），复跑**幂等零变更**；另有人工精修 36 个文件（17 个相对路径/URL 形态文件 + 语义特殊文件 + CI + 文档 + 工具）。
- 字符串门核零：`.tmp-test` 在 `scripts`、`apps`、`core`、`extjs`、`npm`、`.github` 与 docs/qa 两工具范围内零命中（守卫自身豁免）。
- 语义特殊点（人工精修）：
  - `scripts/pack-next-sdk.mjs` 增加仓库根解析（`REPO`），临时目录改 `REPO/target/tmp`；`pack-next-sdk.test.mjs` 断言同步改为**夹具内** `target/tmp`，聚合断言改语义；
  - `apps/desktop/test/execution-task.test.mjs` 的"嵌套游离产物"自检改为正向锚点断言（`base` 必须落在仓根 `target/tmp`）；
  - `scripts/verify-tmp.mjs` 的 base 由 `<root>/target` 改为 `<root>/target/tmp`；
  - `scripts/pack-cli.mjs` 拷贝过滤规则由旧根名改为 `target`；
  - `docs/qa/check-inflight-ownership.cjs` 三处（正则 / 提示语 / 夹具）同步；
  - `core/src/agent_browser_test.cj`、`core/src/browser_executor_test.cj` 的 fixture 由 CWD 相对裸名改为 `coreTestDir(...)` 私有 TMP——这是执行中新发现的"跑一次撒一次"的活写入方（详见 §6.3）。

### 6.2 双写方与 CI

- `dualtest` 4 个写入方（`usage`、`turn-settle`、`prompt-enhance`、`host-provider`）统一迁至 `target/tmp/dualtest/…`；
- `.github/workflows/build.yml` 上传路径同步改 `target/tmp/platform-build/...`；旧忽略规则（2 条 `dualtest/`、1 条旧桌面临时根块）从 `.gitignore` 移除。

### 6.3 清障台账（两轮，全部写入 manifest）

- **一轮**：删 35 项 ≈ **4.7 GB / 42k+ files**——主体为旧桌面临时根 3901.4 MB / 40254 files；含仓根 `desktop/`、`dualtest/`、`apps/desktop/apps`、`apps/host/apps`、core 散件、dist/team-recheck、`target/` 一级 23 个散名（合计 ≈ 806 MB）。
- **挽救搬运 7 项**（`target/tmp/`，未删）：`cjpm-run-probe`、`pack-cli-windows-verify`、`cli-dll-probe`、`desktop-current-candidate`（1.2 GB win-unpacked 候选 + 3 份构建日志）。
- **二轮**（执行中新发现）：删 9 项 / 21.9 MB——`core/apps`（21.8 MB，从 `core/` 以 CWD 相对路径写出的 cjpm 现场残渣）、6 个空 fixture 目录（core 一级）、仓根 2 个历史日志。写入方均已修复（§6.1 末条）或已随迁移改指，删除后不再生。
- 记账：`target/tmp/artifact-disposal-20261016/manifest.txt`（逐项体量/文件数/时间戳；受 git 跟踪的路径一律跳过并登记失败）。

### 6.4 守卫（新增 `scripts/check_artifact_placement.cjs`）

- 检查项 13 条：R1 仓根允许集（文件+目录）；R2 各模块一级（稳定模块文件也按允许集核对，`apps/desktop` 因入口文件持续新增只拦产物后缀 `.log/.lease/.tmp/.bak`；`node_modules` 在 desktop/extjs/npm 登记为允许）；R3 `target` 一级仅 `release/.cjpm-history/.dep-cache/tmp`；R4 旧根字符串门（scope：`.github scripts apps core extjs npm` + docs/qa 两工具，唯一豁免守卫自身）；R5 退役根与近形目录存在性（含深层 `.tmp-test` 复生，空目录也算）。
- **决策记录**：`.tmp-test` 保留为字符串针（无合法新用途）；`dualtest` 不作字符串针——它在 `target/tmp/` 下作为子区名继续合法使用，字符串门无法在无假阳的情况下区分"仓根退役根"与"target/tmp 子区"，故退役性由 R5 存在性 + R1/R2 允许集覆盖。
- **模式**：默认严格（违规即 rc=1）；不设 WARN 模式——上线时基线已绿，宽松模式没有存在理由。判绿硬格式与既有门禁一致（`GATE: PASS (N checks, fail=0)` + `SELFTEST: PASS (probes=N, missed=0, baseline=green)`，rc=0）。
- **自证**：10 条探针（每条规则各 1-2 条注入 + 1 条反向探针证明新合法形态不误伤），`missed=0, baseline=green`。
- **接线状态**：登记于 `scripts/gate-verdict.mjs` 的 `UNWIRED_GATES`（本批不与 verify-all 步骤表同批改动；下一批独立小步接入）。
- **打包完整性守卫（2026-10-17）**：新增 `scripts/check-release-manifest.cjs`——检查 electron-builder unpacked 目录的运行闭包：`ca-bundle.pem`、Windows 启动必需 DLL 五颗（boundscheck/runtime/winpthread/libcrypto/libssl）、`zoneinfo/Asia/Shanghai`、`computer-use/provider.mjs + node.exe`、`app.asar`。自证 6 探针 PASS、基线绿；对 neutral 验证包实测抓到 3 个真实缺件（ca-bundle/computer-use 双件），与 modelPull 诊断一致。**按需守卫**：无候选时 `MANIFEST: SKIP` rc=0（不进 verify-all 默认轮，避免 SKIP 与 FAIL 不可区分）；接线形态＝pack-host/electron-builder 重打后、中性导出前显式跑一次。

- **允许集适配（2026-10-17）**：issue #725 自研绕过落地后，三个仓颉模块（`apps/cli`、`apps/host`、`apps/daemon`）的一级稳定出现 `build.cj`（cjpm stagePostBuild 钩子源码，已跟踪）、`build-script-cache/`（cjpm 编译该钩子的缓存，`.gitignore` 已覆盖）、`target/`（单成员构建产物，`**/target/` 全局忽略）；`apps/desktop` 一级出现 `target/`。守卫 R2 允许集同批登记这三项——它们是构建工具链的固定副产物而非散件。`core/core/`（cjpm workspace 副作用，只含 `target`）未登记，作为违规产物删除。适配后守卫 `GATE: FAIL (1 check)`，唯一剩余红项为 `outputs/`（codex 报告落仓根，处置待拍板）。
  - **`outputs/` 裁决与执行（2026-10-17，用户拍板方案②）**：运行报告不落仓根。既有 10 个 HTML 报告已整体搬到 `target/tmp/codex-outputs-20261017/`（可丢根，随 `target/tmp` 清理策略走），`outputs/` 目录删除、**不登记、不加 gitignore**——若再被写入，守卫 R1 会重新转红作可见标记。`docs/product/PRD-tracking.md` 3 处、`docs/evidence/README.md` 1 处、`docs/evidence/MEMORY.md` 1 处的报告路径引用已同步指向新位置；`docs/evidence/` 里 3 处对"守卫曾红"的历史状态描述保留原文不改。**后续约定（需转告 codex）**：运行期报告一律落 `target/tmp/<用途>-<日期>/`；结论性内容按文档同步规则蒸馏为 `docs/evidence/*.md` 后由台账引用，台账不引用可丢根下的文件作长期证据。

### 6.5 治理文档落位

- `docs/testing.md` §3：统一临时根、dist 政策、守卫、2026-10-16 迁移事实（保留一处历史路径表述作记录）；
- `AGENTS.md`：临时根规则、桌面真宿主用例落点、仓根禁令（3 处更新）；
- `README.md`：双宿主用例临时目录说明更新；
- `docs/build-platforms.md`：构建产物记录路径更新（`:38`；`:130` 历史表述保留）；
- `docs/README.md`：本路线图索引行更新。

---

## 7. 风险与回退

| 风险 | 控制（含执行实况） |
|---|---|
| 迁移触及并发会话正在改的文件 | 执行时 codex 已停、无 cjpm/cjc/host/electron 进程；单批作业 |
| CI（GitHub 侧）改后无法本地验证 | 与仓库迁移同批改、留待远端首跑复核；不声称已验证 |
| 删除误伤（临时根内有"候选"目录） | 逐项清单 + 挽救搬运（7 项）+ 受 git 跟踪路径自动跳过；实测删除零失败 |
| Windows 句柄 / 长路径删除失败 | `rmSync` 失败即回退 `cmd rd`（带 `\\?\` 前缀）；台账记录失败项 |
| 若方案 A 中途放弃 | 迁移未提交，可整体回退（改动在 git 工作区，未 commit） |
| `cjpm clean` 连带清 `target/tmp` | 语义自洽（可丢根）；结论已在 docs，原始输出本就允许丢 |

---

## 8. 决断记录（原"待裁决"全部闭合）

| # | 事项 | 决断 | 状态 |
|---|---|---|---|
| 1 | 方案 A / B | **A**（统一 `target/tmp/`） | ✅ 已执行 |
| 2 | 迁移拆批 | 单批（迁移+清障+守卫一次完成） | ✅ |
| 3 | 清理授权 | 逐项已授权并执行（含仓根 `desktop/` 立即删除） | ✅ |
| 4 | dist 保留代数 / 重打安装包 | 保留当前正式预览与宿主；**重打待拍板** | ⏳ §9.1 |
| 5 | 守卫接入 | 先登记 UNWIRED_GATES，下一批接入 verify-all | ⏳ §9.2 |

---

## 9. 遗留与后续小步

1. **重打安装包**（待拍板）：当前全仓无包。`scripts/pack-cli-windows.mjs` 的修复已完成 A/B 验证但**未提交**，重打时与安装包产出同批处理；产出后更新 KEEP 清单。
2. **守卫接线**：把 `check_artifact_placement.cjs` 加进 `verify-all.mjs` 步骤表并移出 UNWIRED_GATES——跑通一轮全绿读数后生效。
3. **CLI 自测的 CWD 写入**：`apps/cli` 的自测命令 `runToolTests` 会在当前目录写 `tool-session.log` / `probe-*.txt`。从仓根运行会在仓根落文件（R1 守卫会红）。建议 CLI 主责决定：改落 `target/tmp`，或在文档写明"从临时目录运行"。本批未动产品代码。
4. **appcontainer 身份探针**：`scripts/invoke-appcontainer-identity-check.ps1` 默认探针路径已改指 `target/tmp`，但当年探针目录已在旧根清理中不存在——需重冻结才能复跑（不阻塞）。
5. 历史表述保留：`docs/build-platforms.md:130`、`docs/testing.md` 中的旧路径记录不改（历史证据）。

## 附录 A：实际改动面（分类）

- **迁移替换**：脚本 32 文件（幂等复跑 0 变更）+ 人工精修 36 文件（去重口径以 `git diff` / `git status` 为准）。
- **类目**：`scripts/*`（verify-tmp、pack-cli、pack-next-sdk、check_contract_anchor_audit、gate-verdict 登记）；`apps/desktop/test/*`（约 20 个测试文件的临时目录与断言）；`apps/desktop/test-support/product-design-verify.mjs`；`apps/host/test/*`、`apps/cli/test/*`、`apps/daemon/test/*`（脚本替换面）；`core/src/test_fixture_path.cj` + 两个 fixture 测试；`.github/workflows/build.yml`；`.gitignore`；`AGENTS.md` / `README.md` / `docs/testing.md` / `docs/build-platforms.md` / `docs/README.md`；新增 `scripts/check_artifact_placement.cjs`。
- **新增运行时资产**（target/tmp 内、不入库）：迁移脚本、两轮清障脚本、refs 清单、`artifact-disposal-20261016/` 台账、`cjpm-build-scratch-note.txt`、7 项挽救搬运。

## 附录 B：治理文本

§6.5 所列落位即为定稿（不再贴拟稿）。要点：统一临时根 `target/tmp/<用途>-<日期>-<短id>/`；`dist/` 只留正式分发产物；守卫名 `scripts/check_artifact_placement.cjs`；2026-10-16 迁移事实与历史路径保留说明。

## 附录 C：关键读数（执行前 → 执行后）

| 读数 | 执行前（10:20–10:45） | 执行后 |
|---|---|---|
| 旧桌面临时根 | 375 项 / 4.1 GB | **已删除**（3901.4 MB / 40254 files 入台账）；替换 7 项挽救搬运 |
| 仓根 `target` | 799 MB，20+ 散名混放 | `release/ + .cjpm-history + .dep-cache + tmp` 四名，散名清零 |
| 仓根 `dualtest` / `desktop` | 96 文件；12 MB 且未忽略 | 均已删除；写入方迁 `target/tmp` |
| core 一级散件 | `core/apps` 21.8 MB + 6 空目录 + 历史 lease/log | 仅 `native/src/target/test-support + cjpm 锁` |
| 守卫读数 | —（无守卫） | `GATE: PASS (13 checks, fail=0)`；`SELFTEST: PASS (probes=10, missed=0, baseline=green)` |
| 门禁登记表 | — | `gate-verdict.test.mjs` 3/3 通过（登记有效、理由合规） |
| 全仓安装包 | 0 命中 | 0 命中（待 §9.1 重打） |
| `dist` | project-picker 预览 + host + team-recheck | project-picker 预览 + host（team-recheck 已清） |

---

## 10. 收尾与交接（2026-10-16，执行会话收尾）

### 10.1 收尾补记（本批执行后的增量事实）

1. **防复发实战首秀**：清障后全量桌面测试首跑在仓根 `target/` 一级撒出散件 `target/host-verbs-settings/`，被守卫 R3 拦下 → 顺藤核出 4 处未迁移写入方并全部修复（均改落 `target/tmp/`）：`apps/desktop/test/host-verbs.test.mjs`、`apps/desktop/test/team-host.test.mjs`（2 处）、`apps/daemon/test/team-host.test.mjs`、`scripts/verify-service-install.mjs`。散件已删并补记入清障台账；修复后 4 文件语法自检通过、`host-verbs.test.mjs` 单跑 5/6 通过且写入落新址、跑后守卫复绿：`GATE: PASS (13 checks, fail=0)`、`SELFTEST: PASS (probes=10, missed=0, baseline=green)`。
2. **全量桌面测试未跑完（人为终止，证据齐全）**：121 条可见结果中 25 条 not ok；`bridge.test.mjs` 用例出齐但文件进程不退出 + 3 宿主 ≈100% 空转 26 分钟 → 14:30:54 终止全树。现场分析见 `target/tmp/desktop-suite-killed-20261016/analysis.md`（证据 `out.txt`、`host-verbs-rerun.txt`）。**初判与本批迁移无因果**；头号疑因 = dist 宿主（10-16 00:15 打包）与当前源码不同步（硬证据：运行中宿主能力表缺 `workspace/git-push-target`、`automation/list`），次疑因 = %TEMP%/相对路径建目录被 `-13` 拒绝的受限身份簇（AppContainer 实验在途）。
3. dist 宿主空载探针（stdin 重定向 6 秒）CPU 增量 0 ms → 套件中的宿主空转是状态相关（交互/收尾后），非无条件忙等。
4. 未跑项（移交 codex）：core 定向用例（fixture 修复待运行时验证）、宿主 `local-routing` spot（需 `SACODE_HOST`）、daemon 链（缺 exe）。

### 10.2 交接动作清单（codex）

1. `cd apps/host && cjpm build` → 重打 `apps/desktop/dist/host` → `cd apps/desktop && npm test`；**跑完必复跑守卫**（口径：target 一级零散件）。
2. 按 analysis.md §3 分类归因 25 条失败：先验"重打后能力表类（not ok 69 与 host-verbs 第 6 条）是否消失"，再核权限异常簇与 `-32016` 簇。
3. 死锁定位（bridge 出齐不退 + 宿主空转）需带超时护栏；单跑隔离可用 `--test-force-exit`。
4. 守卫接线 `verify-all`（UNWIRED_GATES 已登记）。
5. 安装包重打（待用户拍板；含 packer 修复，未提交）。
6. CLI `runToolTests` 写 CWD 遗留项（CLI owner 决策）。
7. 边界观察（未改，供决策）：`apps/desktop/test/host-routing-real.test.mjs` 默认读 `target/step.key`（真密钥文件；放置将触发 R3 未登记条目）；`apps/daemon/test/team-host.test.mjs` 默认宿主指向已清目录 `dist/team-recheck`（`SACODE_HOST` 可覆盖）；`apps/host/test/worktree.test.mjs` 与 pack-tinyvue/pack-tinyrobot 的自清 mkdtemp 仍落模块内（运行期短存、即清，未收编、无残留）。

### 10.3 提交边界（本会话未提交任何内容）

- 本批新增（可纳管）：`scripts/check_artifact_placement.cjs`、本文档；`target/tmp/README.md` 规则卡随 target 忽略。
- 修改面（复核时点）：160 已修改 / 48 未跟踪——A 类 48 为纯迁移面（清单 `target/tmp/migration-face-20261016.txt`），B 类混合面含 codex 在途改动须逐文件审；本会话收尾另有 4 文件修复（§10.1）。
- **勿动**：未跟踪的 codex 在途实现（`apps/desktop/*-ipc.cjs`、`apps/host/src/mode_rpc.cj`、`core/src/appcontainer_win.cj`、`scripts/invoke-appcontainer-identity-check.ps1` 等）与 14:42 后新增文档（`docs/interfaces/`、`docs/integration/` 等）；计数随 codex 并发编辑实时变动，以复核时点为准。
