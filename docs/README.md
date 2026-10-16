# SaCode 文档体系总览（2026-10-16 归类版）

> 本文件是 `docs/` 的**唯一入口索引**。先读分类体系与治理规则，再进各分类索引页。
> 全库约 250 篇：产品 3｜设计规格与计划 55（接口与对接另设专项总览，见 ⑨⑩）｜测试与验收 10+｜工程治理 4｜历史证据 177＋8 数据文件｜历史验收 4。
> **维护规则：新增任何文档，必须同批登记到所属分类索引页；索引页与文档同批更新，不允许"只加文件不改索引"。**

---

## 0. 分类体系（十类）

| # | 类别 | 定位 | 物理位置 | 生命周期 | 索引页 |
|---|---|---|---|---|---|
| ① | **产品文档** | 需求、范围、授权与验收要求；**F01–F21 全程进度跟进** | `product/` | 活跃，随产品迭代 | [product/README.md](product/README.md) |
| ② | **设计文档**（体系/概要） | 总体方案、功能设计规格、UI/交互规范 | `plans/`、`superpowers/specs/` | 定稿后标注状态保留 | [plans/README.md](plans/README.md)、[superpowers/README.md](superpowers/README.md) |
| ③ | **详细设计文档**（接口/契约） | 接口、状态机、持久化、隔离等模块级设计 | `plans/`（契约类）、`plans/*.json` | 与实现对账，变更走增补 | 同上 |
| ④ | **实施计划与台账** | 分批计划、接入清单、SDD 台账 | `plans/`、`superpowers/plans/`、`superpowers/sdd/` | 执行期活跃，完结后归档 | [superpowers/README.md](superpowers/README.md) |
| ⑤ | **测试文档** | 测试规范、目录整理、验收观察、校验工具 | `testing.md`、`plans/test-layout*`、`qa/` | 规则活跃；观察快照冻结 | [qa/README.md](qa/README.md) |
| ⑥ | **构建与工程治理** | 平台构建/分发入口、产物治理、路径所有权 | `build-platforms.md`（并入原 `build-linux.md`）、`plans/` 治理类 | 活跃 | [plans/README.md](plans/README.md) |
| ⑦ | **历史证据** | 带日期与基线的取证读数 | `evidence/` | **冻结，不修改** | [evidence/README.md](evidence/README.md) |
| ⑧ | **历史验收** | 阶段验收观察（4 篇） | `qa/*.md` | **冻结，不修改** | [qa/README.md](qa/README.md) |
| ⑨ | **接口文档**（详细设计） | 各入口面（CLI / Host / 桌面 IPC / daemon / ACP / LSP / JS 扩展）的接口真源、契约与机器可读清单 | `plans/` 契约类＋`plans/*.json`；总览在 `interfaces/` | 与源码同批更新 | [interfaces/README.md](interfaces/README.md) |
| ⑩ | **对接方案** | 外部 Agent、远程/移动、页面业务与 Git/知识库/自动化的接线方案与状态边界 | `plans/` 对接类、`superpowers/plans/`；总览在 `integration/` | 执行期活跃 | [integration/README.md](integration/README.md) |

**说明**：分类是逻辑归类，物理位置不做搬迁——证据区存在大量交叉引用、并发会话按现路径引用文档，搬迁会制造断链。这与 2026-10-16 产物治理确立的"约定＋索引＋守卫"是同一思路；分类靠索引表达，不靠移动目录。

## 1. 治理原则（不可绕过）

1. **需求权威**：[`product/PRD.md`](product/PRD.md) 定义 F01–F21 与授权/任务验收；[`product/platform-and-distribution.md`](product/platform-and-distribution.md) 细化平台、安装渠道与 GitHub 构建。旧 DSH 复刻范围、模块数量不覆盖现行定位，**不计算整体完成率**。
2. **证据保全**：[`evidence/`](evidence/) 与 [`qa/`](qa/) 是带日期与基线的取证。新结果用新记录或明确的后续补记，不覆盖旧失败、不把旧通过升级成当前通过。PRD 内带日期的进度表同样是历史快照，不是实时真源。
3. **设计区核对**：[`plans/`](plans/) 与 [`superpowers/`](superpowers/) 的草案与"未实现"标签描述当时设计，**需核当前源码**，不能直接当作今天的实现证明。
4. **状态粒度**：分别登记源码/入口接线、固定提交构建、默认启动、真实任务、安装态与发布，按平台/架构记录；无法确认的写待核，工作区新增或删除不自动属于提交基线。

### 最新已登记的平台读数与当前主线

- 用户提供 Linux `2c56c76`：core、CLI、daemon 构建通过，CLI 约 14 MB；Host 未编，桌面/服务真实任务与安装尚未验收。依赖设置见 [`build-platforms.md`](build-platforms.md) §2（原 `build-linux.md` 已并入）。
- Windows 当前版入口、ACP/LSP 与安装后任务由 codex 交付线收口；历史 P0 或测试数不代替其验收。
- Windows/Linux/macOS 的 CLI/服务/Electron 桌面为目标；鸿蒙 CLI 保留，后续独立 ArkTS/ArkUI 前端。macOS/鸿蒙无设备不撤销目标，运行状态仍待验。跨平台入口见 [`build-platforms.md`](build-platforms.md)。
- 一次性产物已统一至仓根 `target/tmp/`（`**/target/` 全局忽略），守卫 `scripts/check_artifact_placement.cjs` 已上线；`dist/` 只保留当前正式分发产物。详见 [`plans/artifact-layout-and-retention-2026-10-16.md`](plans/artifact-layout-and-retention-2026-10-16.md)。

## 2. 阅读路径

| 场景 | 顺序 |
|---|---|
| 新人入门 | 本文件 → [`product/PRD.md`](product/PRD.md) → [`product/platform-and-distribution.md`](product/platform-and-distribution.md) → [`plans/README.md`](plans/README.md)（设计全貌）→ [`testing.md`](testing.md) |
| 改代码前 | PRD 对应 Fxx → 分类索引页检索相关设计/契约 → [`testing.md`](testing.md) → [`qa/README.md`](qa/README.md)（工具） |
| 验收/发布前 | [`testing.md`](testing.md) → [`qa/README.md`](qa/README.md) → `evidence/` 近期读数 → [`product/platform-and-distribution.md`](product/platform-and-distribution.md) |
| 查历史结论 | [`evidence/README.md`](evidence/README.md)（冻结区检索规则）→ 按日期/主题定位原文件 |

## 3. 新文档落点与命名

| 要写什么 | 放哪 | 命名 / 要求 |
|---|---|---|
| 产品需求、范围、授权变更 | `product/` | 改 PRD 或写专项；必须标状态与基线 |
| 功能设计规格 | `superpowers/specs/` | `<日期>-<主题>-design.md`，配 `plans/` 同名实施计划 |
| 项目级实施计划 | `plans/` | `<日期>-<主题>.md` 或 `<主题>-<日期>.md` |
| 接口/契约/详细设计 | `plans/` | `<主题>-contract-<日期>.md`；机器可读契约用 `.json` 同目录 |
| 取证读数 | `evidence/` | `<主题>-<日期>.md`（新式）；冻结，只增不改 |
| 验收观察 | `qa/` | `<主题>-<日期>.md`；配套工具用 `.cjs`/`.mjs` |
| 文档模板 | `templates/` | 见 [`templates/README.md`](templates/README.md) |

## 4. 维护记录

- **2026-10-17（Windows 原生进程组件）**：新增 [AppContainer/管道/Job 所有权薄层实测](evidence/2026-10-17-windows-owned-process-provider.md)，35 项检查通过；组件未接仓颉执行器与产品打包，不能开放执行门禁。

- **2026-10-17（AppContainer 身份探针）**：新增 [最小环境与身份实测](evidence/2026-10-17-appcontainer-minimal-environment.md)。原生对照定位空子环境的 error 203，仓颉加入 LOCALAPPDATA/SystemRoot 后身份测试 5/5；仍未开放实际执行后端，工作区/网络/后代隔离继续待验。

- **2026-10-17（本轮·cjpm build.cj stagePostBuild hook 全流程打通）**：新增 [`evidence/2026-10-17-cjpm-build-cj-stage-post-build-hook.md`](evidence/2026-10-17-cjpm-build-cj-stage-post-build-hook.md) —— 解决 issue #725（上游 cjpm build 不复制 bin-dependencies 的运行期 DLL），用户不能等上游修。cjpm 1.1.3 原生支持 `build.cj` 钩子（`stagePostBuild(): Int64` 在 build 后自动执行）；复制 DLL 用 `File.readFrom` + `File.writeTo`（字节读写，`std.fs.copy` String 重载不可靠 native error -1）；干净目录 `D:\tmp\build-cj-clean-20261017` 验证 90+ 个 DLL 全部复制成功；**仓内 apps/cli/build.cj 落地受阻根因＝仓库根 ACL 被 Codex 沙箱化**（`Everyone:(I)(CI)(DENY)(DC)` + `CodexSandboxUsers` SID，File.readFrom "Failed to open" 包括项目内文件），同 0x80000003（D10）问题族；修复方向：① `icacls /remove` 移除沙箱 SID + 解除 DENY；② 中性导出到 D:\tmp 再构建；[`evidence/README.md`](evidence/README.md) 主题表同批登记。

- **2026-10-17（本轮·CLI 启动 0xC0000135 根因与夹具对齐）**：新增 [`evidence/2026-10-17-cli-launch-0xc0000135-stdx-dll-missing.md`](evidence/2026-10-17-cli-launch-0xc0000135-stdx-dll-missing.md) —— CLI 入口 0xC0000135 = STATUS_DLL_NOT_FOUND，根因是 `knowledge-context-cli.test.mjs` env 白名单孤儿化丢失 stdx 目录；修复＝对齐 worktree/remote/team-command/tips-surface 四夹具既有约定（拷 process.env + 前置 `SACODE_STDX_DLL_DIR`/`SACODE_RUNTIME_DLL_DIR` 到 PATH）；上游关联 atomgit #725；环境侧闭合，逻辑侧缺口另列 D13 延伸；[`AGENTS.md`](../AGENTS.md) 「环境」节新增「运行期 DLL 路径约定（防 0xC0000135；codex 必读）」段落固化约定；[`evidence/README.md`](evidence/README.md) 主题表同批登记；[`product/PRD-tracking.md`](product/PRD-tracking.md) D13 同批更新环境侧闭合 + 逻辑侧另列。

- **2026-10-16（本轮·三问题排查）**：新增 [`evidence/2026-10-16-windows-startup-three-issues-diagnosis.md`](evidence/2026-10-16-windows-startup-three-issues-diagnosis.md) —— ①双击 `0x80000003`（根因定位＝仓库根 Low Mandatory Level 继承链，中性导出对照 SMOKE PASS）②仓颉运行时 DLL（全位置哈希盘点＋重打路径）③NSIS 临时文件错误（最小探针三格对照实证）三问题排查与修复可行性；[`product/PRD-tracking.md`](product/PRD-tracking.md) D10 更新为"根因已定位"、新增 **D18**（NSIS）/ **D19**（旧 DLL 载荷）与 §3 平台快照同步；[`plans/windows-dependency-and-compatibility-2026-10-16.md`](plans/windows-dependency-and-compatibility-2026-10-16.md) §1/§3/§4/§5/§6 同批更新；[`evidence/README.md`](evidence/README.md) 主题表同批登记。
- **2026-10-16（本轮·Windows 依赖评估）**：新增 [`plans/windows-dependency-and-compatibility-2026-10-16.md`](plans/windows-dependency-and-compatibility-2026-10-16.md) —— 构建/桌面/CLI 三层依赖清单、11 项 Windows 特有问题（含分发载荷需重打包换修正运行库的关键发现）、普通用户可行性与降级策略；[`product/platform-and-distribution.md`](product/platform-and-distribution.md) 与 [plans 索引](plans/README.md) 同批互链登记。
- **2026-10-16（本轮·PRD 跟进台账）**：新增 [`product/PRD-tracking.md`](product/PRD-tracking.md) —— F01–F21 全程跟进台账（逐域状态、缺陷登记含证据与闭合历史、平台快照、关键分母读数）；[`AGENTS.md`](../AGENTS.md) 新增「文档同步规则」：**完成功能或闭合缺陷必须同批更新 PRD-tracking 与 PRD**；[`product/README.md`](product/README.md) 清单与使用规则同批登记。同批订正 [`interfaces/README.md`](interfaces/README.md) 的 Host 读数：原按 `host-capabilities.json` 记 120 条，现按门禁实测订正为工作区 **169**（164 字面 + 5 目标）/ HEAD 冻结 **158**，json 文件标注已过期（D11）。
- **2026-10-16（本轮·合并与专项总览）**：`plans/sacode-workbench-visual-direction-2026-10-07.md` 并入 [`product/desktop-design-standard.md`](product/desktop-design-standard.md)（附录「交互原型修订记录」）；`build-linux.md` 并入 [`build-platforms.md`](build-platforms.md) §2（stdx 配置与 Linux 读数）；两份原文件降为历史指针，保住冻结证据与脚本的原有引用路径。新增 [`interfaces/README.md`](interfaces/README.md)（接口面速查＋契约与机器可读清单；Host 读数后经门禁实测订正为 169/158，见上行）与 [`integration/README.md`](integration/README.md)（对接方案状态总览）；分类表由八类扩为十类。
- **2026-10-16（本次）**：归类版重构——本文件重写为八类总览；新增五个分类索引页（[product](product/README.md)、[plans](plans/README.md)、[superpowers](superpowers/README.md)、[qa](qa/README.md)、[evidence](evidence/README.md)）与 [`templates/`](templates/README.md)；`plans/` 补齐 10-11～10-16 新增 15 篇的登记。
- 2026-10-15/16：测试临时根迁移至 `target/tmp/`，守卫上线（[`testing.md`](testing.md)、[`plans/artifact-layout-and-retention-2026-10-16.md`](plans/artifact-layout-and-retention-2026-10-16.md)）。
- 2026-10-13：README 口径更新（平台读数、历史化标注）。
- 2026-10-09：初版索引与进度对账节。
