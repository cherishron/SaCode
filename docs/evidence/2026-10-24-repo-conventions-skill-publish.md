# 2026-10-24 repo-conventions Skill 创建与 SkillHub 发布

## 范围与身份

用户要求把"多 agent 进度机制"扩展为覆盖**项目治理**的通用 skill，命名为 `repo-conventions`，**通用、不绑定 SaCode**。源码目录 `.agents/skills/repo-conventions/`，版本 1.0.0，许可证 MulanPSL-2.0（复用仓库许可）。执行平台 Windows/PowerShell；本轮未提交、未推送。

覆盖七个领域：A 项目结构 / B docs 规范 / C 测试规范 / D 提交与安全 / E 多 agent 协作 / F 新项目初始化 / G 项目体检。

## 发布文件（8）

- `SKILL.md`、`LICENSE.txt`
- `references/structure.md`、`docs.md`、`tests.md`、`commit-security.md`、`agent-collaboration.md`、`init-and-audit.md`

核心流程：先**判别任务类型**（初始化 / 体检 / 单项规范 / 协作），再**先读现状**、最小改动、分级汇报（P0/P1/P2）、默认只读。**所有资产以 `.md` 承载**（脚本 / 模板以代码块内嵌），避免"不支持的文件类型"被拒。**无**运行脚本文件、凭据、项目源码、截图、日志。

## 验证及边界

- 结构测试 `scripts/test/skills/repo-conventions.test.mjs`：**6/6 通过**，0 失败 / 跳过。仅验证元数据、引用资源、关键约束文字与文件白名单，**不证明模型实际遵循**。
- `skillhub publish --dry-run --json`：通过（`{"dryRun": true, "slug": "repo-conventions", "version": "1.0.0"}`）。
- 静态校验 `validate_skill.py`：本机**未找到**（`ui-design` 发布时用过，本轮该工具路径不可用），**如实记录未跑**。
- 未执行真实模型行为测评、GUI；不宣称审核通过或公开上架。

## 官方发布过程

`skillhub.ps1` 仅**输出命令行文本**，故直调其指向的 `skills_store_cli.py`（Python），未改启动器 / 登录配置，未接触凭据。

命令语义：`publish .agents/skills/repo-conventions --host https://api.skillhub.cn --changelog "首次发布：仓库约定与项目治理（结构/文档/测试/提交安全/多 agent 协作/新项目初始化/项目体检）" --json`

平台回执（不含凭据）：

- ok：true
- slug：`repo-conventions`
- version：`1.0.0`
- skillId：**293070**
- versionId：**459384**
- fileCount：8
- reviewStatus：pending
- contentAuditStatus：pending
- securityScanStatus：pending
- fingerprint：`9ad733b897d6be97ab368136717e0b117f4c3a41d152aa0777fbe96d024c9db8`

**结论：提交成功、待平台审核；不是审核通过或已公开上架。**

详情入口：https://skillhub.cn/skills/repo-conventions （抓取可能仅返回通用页面壳）；用户可到 https://skillhub.cn/dashboard 查看"我的 Skill"中的审核结果。审核失败或路由变化以平台后台为准，不盲目重复发布。

## 与仓内机制的关系

本 skill 的 **E 领域**即仓内 `docs/agents/` + `scripts/agent-board.mjs` 机制的**通用化提炼**；仓内版本保留项目特有资产（PRD 台账等），skill 版本不绑定任何具体项目。

---

## 1.1.0 扩版（2026-10-24 同批）

在 1.0.0 五类规范之上，按用户要求新增 6 个领域（复用同一 skill，非新建）：

- H 项目错题本 `references/error-book.md`
- I PRD / 需求管理 `references/prd-management.md`
- J 文档维护 `references/docs-maintenance.md`
- K 项目评审 `references/code-review.md`
- L 安全审查 `references/security-review.md`
- M 提交编排与推送 `references/commit-orchestration.md`

`SKILL.md` 领域表扩至 A–M、summary 与触发词更新、版本 1.1.0；结构测试扩为 **10/10 通过**（新增错题本 / PRD+文档维护 / 评审+安全 / 提交编排 4 组断言，文件白名单扩至 14）。

`skillhub publish --dry-run --json`：通过（`{"dryRun": true, "slug": "repo-conventions", "version": "1.1.0"}`）。

正式发布平台回执（不含凭据）：ok:true；slug `repo-conventions`；version `1.1.0`；skillId **293070**；versionId **459409**；fileCount **14**；reviewStatus / contentAuditStatus / securityScanStatus 均 pending；fingerprint `047354aa3a0d8327b8cfdc6766d59555a4cb1ff2c574189c7edce607adf11505`。

**结论：1.1.0 提交成功、待平台审核；非审核通过或已上架。**

关键设计决定（用户确认）：**H 错题本**跨会话 / 跨 agent 沉淀踩坑、按需检索省 token、**不自动注入**（防污染上下文）；**M 提交编排**由 **AI 自主**盘点 / 聚类 / 判定完成边界，同步冲突走 **rebase**（stash → rebase → 解冲突 → 恢复），唯一人工卡点是**推送前二次确认**。不新增外部凭据、脚本或非 `.md` 资产。