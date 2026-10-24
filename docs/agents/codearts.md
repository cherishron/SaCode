# codearts

- agent: codearts
- role: 前端与 GUI / 文档治理
- updated: 2026-10-24

## 在飞

| 工作包 | F域 | 状态 | 涉及路径 | 证据 | 下一步 |
|---|---|---|---|---|---|
| 文档去参考缩写 / 自研叙事统一 | 治理 | partial | docs/product/PRD.md, docs/product/PRD-tracking.md | docs/evidence/2026-10-24-project-review-security-code.md | 已改（含 D28 基线），因文件夹带他会话改动暂未提交 |
| 项目评审（安全/代码/架构/治理） | 治理 | done-unsubmitted | docs/evidence/2026-10-24-project-review-security-code.md | 同左 | D27/D28 已修（D28 部分待提交） |
| 多 agent 进度看板机制 | 治理 | in-progress | docs/agents, scripts/agent-board.mjs, docs/product/agent-board.md | docs/agents/README.md | 接入收尾自检 |
| repo-conventions skill 扩版 1.1.0 | 治理 | committed | .agents/skills/repo-conventions, scripts/test/skills/repo-conventions.test.mjs | docs/evidence/2026-10-24-repo-conventions-skill-publish.md | 已提交 `559024f`；SkillHub 1.1.0 待审核 |
| ui-design skill 发布 1.0.0 | 治理 | committed | .agents/skills/ui-design, scripts/test/skills/ui-design.test.mjs | docs/evidence/2026-10-24-ui-design-skill-publish.md | 已提交 `64e12fd` |
| repo-conventions 项目体检（G·只读） | 治理 | committed | docs/evidence/2026-10-24-repo-conventions-project-audit.md | 同左 | 已提交 `be50cb5`；P1 处置见备注 |
| core 去重同名 @Test（D27） | 治理 | committed | core/src/tool_subagent_test.cj | docs/evidence/2026-10-24-repo-conventions-project-audit.md | 已提交 `2777275`；编译验证受仓内环境阻塞 |
| 新增项目错题本 + 迭代登记 | 治理 | committed | docs/errors.md, CHANGELOG.md, docs/agents/codearts.md | 同左 | 已提交 `9dfb2ca`/`be50cb5`/`e5d25bc` |

## 备注

- 本文件只由 codearts 维护。
- 2026-10-24 提交批次（本会话 6 笔，本地领先 `origin/dev` **10**、**未推送**）：`9dfb2ca` 错题本 / `be50cb5` 体检证据+CHANGELOG / `559024f` repo-conventions 1.1.0 / `64e12fd` ui-design 1.0.0 / `2777275` D27 去重 / `e5d25bc` 台账。
- **纠错记录**：首次提交误把他人**已暂存**的一批 `docs/evidence|plans|product|superpowers` 迁移删除（59 文件）连带提交，已 `git reset --mixed HEAD~6` 撤销并逐笔重做。他人这 59 项迁移删除现回到**未暂存**状态，**需相关会话重新 `git add` 提交**（工作区内容未受影响）。
- **未提交（文件夹带他会话改动、无法干净拆分）**：`docs/product/PRD.md`、`docs/product/PRD-tracking.md`、`docs/evidence/README.md`。