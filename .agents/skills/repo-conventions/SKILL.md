---
name: repo-conventions
slug: repo-conventions
displayName: 仓库约定与项目治理
version: 1.1.0
summary: 为仓库建立或体检项目结构、文档及文档维护、测试、提交安全、多 agent 协作、错题本、PRD/需求管理、项目评审、安全审查与提交编排推送等规范；只给规范、分级发现与可复现落地物，不替用户做业务或架构决策。
description: >-
  用于新项目初始化立规范，或对已有项目做"结构 / 文档 / 测试 / 提交安全 / 多 agent 协作 / 错题本 / PRD / 项目评审 / 安全审查 / 提交编排"体检：
  先识别现状与既有约定，再给分级发现与最小修复建议，并按证据如实汇报。
  当用户要求整理项目结构、规范 docs、规整测试、提交前安全检查、建立多 agent 进度看板、维护错题本、管理 PRD/需求、维护文档、做项目评审或安全审查、或把堆积的未提交改动按功能整理提交并推送时使用。
  触发词：项目规范、仓库约定、目录结构、模块边界、docs 规范、文档存放、文档维护、测试规范、提交安全、.gitignore、多 agent、进度看板、错题本、踩坑记录、PRD、需求管理、项目评审、代码评审、安全审查、未提交改动整理、分功能提交、rebase、解决冲突、提交推送。
license: MulanPSL-2.0
---

# 仓库约定与项目治理

把"项目该怎么组织"从经验与口头约定，固化成**可检查、可复现**的规范：新项目一键立规矩，老项目一键体检。不替用户做业务或架构取舍，不擅自删改，只给规范、分级发现与最小修复建议。

## 1. 先判别任务类型

- **新项目初始化（F）**：按 `references/init-and-audit.md` 的清单，一次性立起结构 / 文档 / 测试 / 提交 / 协作五类约定。
- **已有项目体检（G）**：**只读扫描** → 分级发现 → 修复建议；不默认动手改。
- **单项规范（A–E、H–M）**：只处理用户点名的领域（结构 / docs / 测试 / 提交安全 / 协作 / 错题本 / PRD / 文档维护 / 项目评审 / 安全审查 / 提交编排）。
- **多 agent 协作（E）**：建立进度登记与汇总看板。
- 混合任务：**先体检、再按用户确认的范围落地**，不一次全改。

## 2. 通用原则

1. **先读现状**：读仓库规则文件（如 `AGENTS.md` / `CLAUDE.md` / `README`）、目录树、构建与测试入口，再判断是否合规；不凭印象、不靠记忆。
2. **最小改动**：只动达成规范所需的最小集；搬目录、重命名顶层目录属**高风险动作**，须单独确认。
3. **不替用户决策**：业务范围、架构选型、是否删除，交用户拍板；本 skill 只给规范与建议。
4. **分级汇报**：发现分 **P0（阻断/安全）/ P1（结构/一致性）/ P2（体验/债）**，每条附证据路径与建议。
5. **可复现落地物**：约定写成文本、模板给可粘贴文本、校验给脚本文本；**不引入运行时依赖**。
6. **不虚报**：没跑、没改、有环境限制的，如实写明。

## 3. 十三个领域（详见 references）

| 领域 | 文件 | 关注 |
|---|---|---|
| A 项目结构 | [references/structure.md](references/structure.md) | 顶层目录职责、模块边界、命名、是否该整理 |
| B docs 规范 | [references/docs.md](references/docs.md) | 存放位置、分类索引、权威顺序、单一真源 |
| C 测试规范 | [references/tests.md](references/tests.md) | 测试位置 / 命名、可入库 vs 一次性产物、fixture |
| D 提交与安全 | [references/commit-security.md](references/commit-security.md) | 密钥 / 产物不入库、`.gitignore`、暂存检查、message |
| E 多 agent 协作 | [references/agent-collaboration.md](references/agent-collaboration.md) | 登记约定 + 看板脚本 + 未登记告警 |
| F 初始化 / G 体检 | [references/init-and-audit.md](references/init-and-audit.md) | 清单、只读扫描、分级报告模板 |
| H 错题本 | [references/error-book.md](references/error-book.md) | 踩坑沉淀、按需检索、去重 / 失效 |
| I PRD / 需求管理 | [references/prd-management.md](references/prd-management.md) | 唯一权威、追踪、变更、验收口径 |
| J 文档维护 | [references/docs-maintenance.md](references/docs-maintenance.md) | 新增登记、变更同步、过期、一致性校验 |
| K 项目评审 | [references/code-review.md](references/code-review.md) | 架构 / 质量 / 测试 / 治理，分级发现 |
| L 安全审查 | [references/security-review.md](references/security-review.md) | 凭据 / 授权 / 沙箱 / 注入 / 出口 / 供应链 |
| M 提交编排与推送 | [references/commit-orchestration.md](references/commit-orchestration.md) | 未提交聚类、先同步解冲突、分功能提交、推送前确认 |

## 4. 汇报格式

- **结论**：合规 / 部分合规 / 不合规。
- **分级发现表**：级别 / 位置 / 问题 / 建议 / 证据。
- **修复清单**：最小改动、按优先级排序。
- **未覆盖与限制**：明确写出（没跑测试、只读、环境受限等）。

## 5. 边界

- 不替代 git、项目管理或 CI；**不强制阻断，只把问题暴露出来**。
- 不绑定任何具体项目路径、品牌或凭据。
- 涉及删除、重命名顶层目录、提交 / 推送 / 发布，须用户明确授权；本 skill 默认**只给建议**。