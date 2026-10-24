# 2026-10-24 repo-conventions 项目体检（G 领域·只读）

## 范围与身份

按 `repo-conventions` skill 的 **G 已有项目体检**流程对 SaCode 仓做**只读扫描**（结构 / 文档 / 测试 / 提交安全 / 协作 + H–M 新领域）。执行平台 Windows/PowerShell，工具为 git 只读命令与内容检索。**未跑构建/测试、未改任何文件、未提交**。扫描时点：HEAD `41c7790`（分支 `dev`）。

## 结论

**整体：部分合规。** 安全与产物治理**良好（无 P0）**；主要缺口集中在**一致性**（过期基线、去参考缩写不彻底、超大规模未提交工作区）与**治理落地**（协作登记未覆盖、错题本未建立）。

## 分级发现

| 级别 | 位置 | 问题 | 建议 | 证据 |
|---|---|---|---|---|
| — | 全仓源码/配置 | **密钥零命中**：`sk-*`/`skh_*`/私钥/内联 api_key 在 1455 个源码/配置文件无命中 | 保持 | grep 结果；并见既有 D29（凭据明文属本地存储，未入库） |
| — | 全仓 | **产物零入库**：跟踪的 `target/`、`dist/`、平台包 `bin/` 为 0，`.gitignore` 覆盖 `/target/`、`**/target/`、`dist/`、`apps/desktop/dist/`、`npm/sacode-cli-*/bin/`、`.env*` | 保持 | `git ls-files` 计数 0；`.gitignore` |
| P1 | `docs/product/PRD-tracking.md:42` | **读数基线过期**：仍写分支 `refactor/<旧参考缩写>-learning`、HEAD `7a249a1c`（2026-10-16），与当前 `dev@41c7790` 相差 8 天、数十提交 | 更新为当前基线（= 既有缺陷 **D28**） | 台账自述行 vs `git log` |
| P1 | `core/src/*_test.cj` | **全量 core 单测无法编译**：HEAD 同名 `@Test delegateToolRegistrationApprovalResultAndCancellation` 存在于两个文件，core 套件编译失败（19 errors） | 重命名去重后恢复可编译（= 既有缺陷 **D27**） | 台账多处记载；证据 `2026-10-24-p0-cross-end-gates.md` |
| P1 | 工作区 | **超大规模未提交改动**：`git status -uall` **547 项**；看板聚合 371 个在飞文件未被登记 | 用 M 领域流程按功能整理提交（须授权） | `git status`；`agent-board` |
| P1 | 协作 | **登记未全覆盖**：`docs/agents` 机制已存在（codearts.md/README/_template），但 371 个在飞文件未被任何 agent 登记 | 各 agent 补登记（机制刚建立，属过渡态） | `agent-board.mjs` 告警 |
| P2 | `docs/` | **去参考缩写不彻底**：活文档 `PRD-tracking.md` 基线行仍含旧分支名（含历史参考项目缩写）；冻结区 `evidence/README.md` 主题行亦含同类词（历史，可保留） | 清理活文档残留（冻结区不动） | 台账 `:42` |
| P2 | `docs/errors.md` | **错题本缺失**：新领域 H 尚无落地文件 | 建立 `docs/errors.md` 并按范式沉淀踩坑 | 文件不存在 |
| P2 | 仓根 | **3 个空临时目录残留**：`tmpDirJwws1Y`/`tmpDirlUtkSd`/`tmpDirRHDzl3`（空、未被 git 跟踪，故 git 不列） | 删除或移入 `target/tmp/` | `Get-ChildItem` 计数 0 |

## 正面项（合规）

- **结构清晰**：`core`（共享业务）+ `apps/{cli,daemon,desktop,host,mobile,web}` + `npm/*` + `scripts` + `extjs`，与 `AGENTS.md` 模块边界描述一致。
- **文档治理成熟**：`docs/` 十类分类 + `README.md` 权威顺序 + `clients/` 四端体系；`build-linux.md` 已并入 `build-platforms.md`（保留历史指针，引用有效，非断链）。
- **测试布局规范**：`*_test.cj` 随包、`*.test.mjs` 按 `test/<功能>/` 分类（desktop 有 acp/browser/models/session/support 等子目录）；一次性产物根 `target/tmp/` 存在。
- **提交规范良好**：近期提交 message 形如 `feat(web):`、`fix(security):`、`docs:`，scope 规范。
- **协作机制已建**：`docs/agents/` + 看板脚本 + `AGENTS.md` 强制规则已落地。

## 修复清单（按优先级；均须授权后执行）

1. **P1**：更新 `PRD-tracking.md` 基线到当前 HEAD（D28）。
2. **P1**：修复 `core` 同名 `@Test` 使单测可编译（D27）。
3. **P1**：用 M 流程整理 547 项未提交改动（rebase 同步 → 按功能分组提交 → 推送前确认）。
4. **P1**：各 agent 补登记在飞文件（过渡态收敛）。
5. **P2**：清理活文档残留缩写；建 `docs/errors.md`；删除 3 个空 `tmpDir*`。

## 未覆盖与限制

- **只读**：未执行构建/测试/打包，未验证运行态；未做安全渗透。
- **抽样**：文档按索引与关键文件核对，未逐篇通读；`evidence/` 冻结区未改。
- **密钥扫描局限**：基于正则模式（非熵扫描），未覆盖 `node_modules`/`target` 等忽略目录与二进制。
- **口径**：本报告为**体检发现**，不改变任何 F 域完成状态、候选身份与主阻塞；结论以 PRD/PRD-tracking 为准。