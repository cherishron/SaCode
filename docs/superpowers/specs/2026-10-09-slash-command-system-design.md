# SaCode 斜杠命令系统设计

**日期**：2026-10-09
**状态**：已评审，待实现
**作者**：brainstorming 流程产出

---

## 1. 概述

SaCode 当前有 `+` 菜单（附件/文件/技能/MCP/目标）和 `@` 文件引用，但没有 `/` 斜杠命令（PRD F05 要求 compress/init）。上游 Qwen Code 有 `/review` 命令（17 项能力：effort 分级、并行 agents、PR 评论、auto-fix、自定义规则、多格式报告等）。

本设计定义 SaCode 的全系统斜杠命令架构：命令注册、路由、执行、UI 交互。

**设计口径**：
- 全系统命令（聊天输入区 + CLI 子命令 + Desktop 菜单命令）
- 动态发现（插件/扩展/Agent 可运行时注册/注销）
- 分层执行（前端命令直接处理，后端命令由 Core 执行）
- 行为等价但实现不同（参考 Qwen Code 的 `/review`，用 SaCode 自己的 Agent 团队 + goal 机制实现）

---

## 2. 架构

### 2.1 分层架构

| 层 | 组件 | 职责 |
|----|------|------|
| L0 | `core/src/cmds.cj` (`CommandRegistry`) | 动态注册/解析/列举命令 |
| L1 | Host 协议 | `session/append` + `queue/enqueue` 透传命令文本 |
| L2 | Core 执行层 | 解析命令 → 路由 → Agent 团队执行 |
| L3 | UI 层 | 复用 `composer-menu-popover`，输入 `/` 切换命令模式 |

### 2.2 数据流

```
用户输入 /review 123 --effort high
  → popover 补全/选择
  → send() 调用 window.sacode.userSend("/review 123 --effort high")
  → session/append → host → core
  → CommandRegistry.resolve("review") → 路由到 review 命令处理器
  → Agent 团队执行（correctness/security 并行）
  → 结果写入 session log → 渲染层投影
```

---

## 3. 命令集（首轮）

| 命令 | 参数 | 说明 | 执行位置 |
|------|------|------|----------|
| `/help` | - | 显示所有命令列表与简要说明 | 前端 |
| `/review` | `<target> [--effort low\|medium\|high] [--comment] [--fix] [--resume]` | 多维度代码审查 | Core（Agent 团队） |
| `/compress` | - | 手动触发上下文压缩 | Core |
| `/init` | - | 初始化项目配置（不覆盖已有） | Core |
| `/clear` | - | 清空当前输入框 | 前端 |

### 3.1 `/review` 行为等价但实现不同

**用户可见行为**（与 Qwen Code 对齐）：
- 输入 PR #/URL 或本地 diff
- effort 分级（low/medium/high）
- 多维度审查（correctness/security/quality）
- 分级报告（Critical/Suggestion/Nice to have）
- 可选 PR 评论、auto-fix、resume

**实现方式**（SaCode 自有）：
- 不复刻 Qwen Code 的 worktree 隔离、16 agents 并行架构
- 用 SaCode 自己的 Agent 团队 + goal 机制 + 审批工单实现
- 参考 `docs/evidence/qwen-code-review-gap-2026-10-09.md` 的 17 项差距清单

---

## 4. 命令发现与注册

### 4.1 动态发现

- Core 的 `CommandRegistry` 支持运行时：
  - `register(name: String, help: String)`
  - `resolve(name: String): CommandSpec`
  - `list(): ArrayList<CommandSpec>`
- 插件/扩展/Agent 在 `apply` 时注册命令
- fiber 卸载时自动注销（effect 语义）
- 启动时无持久化，每次重新注册

### 4.2 可用命令更新

- ACP `session/update` 推送 `availableCommands`（PRD §4.3 已定义，待实现）

---

## 5. UI 交互

### 5.1 Popover 复用

- 复用 `composer-menu.ts` 的 `composer-menu-popover`
- 输入 `/` 时，`composer` 的 `onInput` 检测到 `/` 前缀 → 切换 `section` 到 `commands` 模式
- 复用 `item()` 工厂函数渲染命令列表（icon + label + help）
- 键盘导航（Arrow/Home/End/Escape）直接复用

### 5.2 错误反馈

- 未知命令：composer 附近显示红色提示 "未知命令: /ghost"
- 参数错误：提示 "参数格式错误: --effort 必须是 low/medium/high"

---

## 6. 参数解析

**简单空格分词**：
- 不实现引号/转义
- 示例：`/review 123 --effort high` → `["review", "123", "--effort", "high"]`
- 参数格式：`--key value` 或 `--flag`

---

## 7. 权限与审批

**命令本身不触发审批**：
- 审批由命令内部调用的工具触发
- 示例：`/review --fix` 内部调用 edit → F08 差异审查流程
- 纯查询类命令（`/help`、`/clear`）不涉及审批

---

## 8. 错误处理

**用户可见错误**：
- 未知命令、参数错误 → composer 附近显示提示
- 不污染会话历史

---

## 9. 测试策略

### 9.1 分层测试

| 层 | 测试文件 | 覆盖内容 |
|----|----------|----------|
| 前端单元 | `composer-menu.test.ts` | popover 切换、命令列表渲染、键盘导航 |
| Core 单元 | `cmds_test.cj` | register/resolve/list/duplicate/empty；新增参数解析测试 |
| 集成测试 | 端到端 | 输入 `/help` → 看到命令列表；输入 `/review` → 触发审查流程 |

---

## 10. 语言

**仅中文**：
- 命令 `help` 文本、错误消息、UI 提示均用中文
- 示例：`/help` 显示 "显示帮助"；错误提示 "未知命令: /ghost"

---

## 11. 持久化

**纯内存**：
- `CommandRegistry` 每次启动重新注册
- 关机后丢失
- 由插件/Agent 启动时重新注册

---

## 12. 非功能约束

- **性能**：命令解析 < 10ms（简单空格分词）
- **可扩展**：新命令只需注册到 `CommandRegistry`，无需改动 popover
- **隔离**：命令系统不影响现有 `+` / `@` 流程

---

## 13. 待实现项（不在本 spec 范围内）

- ACP `session/update` 推送 `availableCommands`
- CLI 子命令 `sa review` 的完整实现
- Desktop 菜单命令的完整实现
- `/review` 的 17 项能力完整落地（分批交付）

---

## 14. 证据与参考

- `docs/product/PRD.md`：F05 输入快捷能力
- `docs/evidence/qwen-code-review-gap-2026-10-09.md`：Qwen Code `/review` 17 项差距
- `core/src/cmds.cj`：`CommandRegistry` 实现
- `core/src/cmds_test.cj`：命令注册表测试
- `apps/desktop/renderer/pages/composer-menu.ts`：popover 实现
- `apps/desktop/renderer/pages/user-text.ts`：slash token 解析（仅展示）

---
