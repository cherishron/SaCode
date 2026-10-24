# 多 agent 在飞看板（自动生成，勿手改）

> 由 `scripts/agent-board.mjs` 生成。真源：`docs/agents/<agent-id>.md`。生成于 2026-10-24T18:48:04.386Z

## 当前在飞

| agent | 角色 | 工作包 | F域 | 状态 | 涉及路径 | 证据 | 下一步 | 更新于 |
|---|---|---|---|---|---|---|---|---|
| codearts | 前端与 GUI / 文档治理 | 文档去参考缩写 / 自研叙事统一 | 治理 | partial | docs/product/PRD.md, docs/product/PRD-tracking.md | docs/evidence/2026-10-24-project-review-security-code.md | 已改（含 D28 基线），因文件夹带他会话改动暂未提交 | 2026-10-24 |
| codearts | 前端与 GUI / 文档治理 | 项目评审（安全/代码/架构/治理） | 治理 | done-unsubmitted | docs/evidence/2026-10-24-project-review-security-code.md | 同左 | D27/D28 已修（D28 部分待提交） | 2026-10-24 |
| codearts | 前端与 GUI / 文档治理 | 多 agent 进度看板机制 | 治理 | in-progress | docs/agents, scripts/agent-board.mjs, docs/product/agent-board.md | docs/agents/README.md | 接入收尾自检 | 2026-10-24 |
| codearts | 前端与 GUI / 文档治理 | repo-conventions skill 扩版 1.1.0 | 治理 | committed | .agents/skills/repo-conventions, scripts/test/skills/repo-conventions.test.mjs | docs/evidence/2026-10-24-repo-conventions-skill-publish.md | 已提交 `559024f`；SkillHub 1.1.0 待审核 | 2026-10-24 |
| codearts | 前端与 GUI / 文档治理 | ui-design skill 发布 1.0.0 | 治理 | committed | .agents/skills/ui-design, scripts/test/skills/ui-design.test.mjs | docs/evidence/2026-10-24-ui-design-skill-publish.md | 已提交 `64e12fd` | 2026-10-24 |
| codearts | 前端与 GUI / 文档治理 | repo-conventions 项目体检（G·只读） | 治理 | committed | docs/evidence/2026-10-24-repo-conventions-project-audit.md | 同左 | 已提交 `be50cb5`；P1 处置见备注 | 2026-10-24 |
| codearts | 前端与 GUI / 文档治理 | core 去重同名 @Test（D27） | 治理 | committed | core/src/tool_subagent_test.cj | docs/evidence/2026-10-24-repo-conventions-project-audit.md | 已提交 `2777275`；编译验证受仓内环境阻塞 | 2026-10-24 |
| codearts | 前端与 GUI / 文档治理 | 新增项目错题本 + 迭代登记 | 治理 | committed | docs/errors.md, CHANGELOG.md, docs/agents/codearts.md | 同左 | 已提交 `9dfb2ca`/`be50cb5`/`e5d25bc` | 2026-10-24 |

## worktree

- D:/Project/sa/saai/sa-code                                              b039e66 [dev]
- C:/Users/jingg/.codex/worktrees/225e/sa-code                            f7cef5f (detached HEAD)
- C:/Users/jingg/.codex/worktrees/e5f9/sa-code                            4b42b52 (detached HEAD)
- D:/Project/sa/saai/sa-code/.sacode/worktrees/agent-5b8bce0              0cd79ea [worktree-agent-5b8bce0]
- D:/Project/sa/saai/sa-code/.sacode/worktrees/agent-70a15c0              0cd79ea [worktree-agent-70a15c0]
- D:/Project/sa/saai/sa-code/.sacode/worktrees/alpha                      0cd79ea [worktree-alpha]
- D:/Project/sa/saai/sa-code/.sacode/worktrees/fix-1                      26e2ccc [worktree-fix-1]
- D:/Project/sa/saai/sa-code/target/sacode-verify-build-copy-kmYYcV/head  2c56c76 (detached HEAD) prunable
- D:/Temp/sa-code-knowledge-commit-probe-20261016-01                      56fa07b (detached HEAD) prunable

## 未登记告警（有产出但没登记）

**共 516 个在飞文件未被任何 agent 登记**，按模块聚合：

| 模块 | 未登记文件数 |
|---|---|
| docs/clients | 102 |
| apps/desktop | 100 |
| docs/evidence | 89 |
| apps/cli | 69 |
| apps/mobile | 37 |
| docs/plans | 36 |
| core/src | 23 |
| docs/superpowers | 15 |
| apps/host | 10 |
| apps/daemon | 9 |
| docs/product | 3 |
| core/native | 2 |
| docs/interfaces | 2 |
| docs/qa | 2 |
| AGENTS.md | 1 |
| README.md | 1 |
| docs/README.md | 1 |
| docs/integration | 1 |
| docs/testing.md | 1 |
| scripts/build-platform.mjs | 1 |
| scripts/check_host_method_surface.cjs | 1 |
| scripts/check_p0_ownership.cjs | 1 |
| scripts/check_verb_checklist_cover.cjs | 1 |
| scripts/gate-verdict.mjs | 1 |
| scripts/pack-cli-windows.mjs | 1 |
| scripts/package-platform.mjs | 1 |
| scripts/sdk-paths.mjs | 1 |
| scripts/sdk-paths.test.mjs | 1 |
| .github/workflows | 1 |
| scripts/build-post-hook.test.mjs | 1 |
| scripts/pack-tui.mjs | 1 |

> 处理：对应 agent 在自己的 `docs/agents/<agent-id>.md` 里登记这些路径；或从工作区撤出。
