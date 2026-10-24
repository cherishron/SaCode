# agents/ — 多 agent 进度登记（唯一在飞真源）

> 目的：解决"多个 agent 各自开发、做完不及时更新进度"的痛点。每个 agent **只维护自己的一个文件**，互不覆盖；汇总视图由 `scripts/agent-board.mjs` 生成。

## 约定

1. 每个 agent 一个文件：`docs/agents/<agent-id>.md`。`<agent-id>` 用小写字母/数字/连字符（如 `codearts`、`qoder`、`trae`、`codebuddy`）。
2. **只改自己的文件**；不要改别人的 agent 文件（避免写冲突）。
3. 模板见 [`_template.md`](_template.md)。

## 强制规则（与根 `AGENTS.md` 配套）

- **开工登记**：接到一项工作、开始动手前，先在自己的文件里加一行"在飞"。
- **收尾更新**：完成/闭合/暂停时，同批更新该行（状态 + 证据 + 下一步），并更新 `- updated:` 时间；同时按 `AGENTS.md` 文档同步规则更新 `CHANGELOG.md` / 台账 / evidence。
- **收尾前自检**：跑 `node scripts/agent-board.mjs`，若出现指向你改动范围的"未登记告警"，必须先补登记再收尾。

## 字段

头部（文件顶部，便于脚本解析）：

```
- agent: <agent-id>
- role: <角色，如 前端与 GUI>
- updated: <YYYY-MM-DD HH:MM>
```

"## 在飞"表（每行一项）：

```
| 工作包 | F域 | 状态 | 涉及路径 | 证据 | 下一步 |
```

- 状态取值：`in-progress`（进行中）/ `partial`（部分完成）/ `done-unsubmitted`（做完未提交）/ `blocked`（阻塞）/ `paused`（暂缓）。
- 涉及路径：用逗号或空格分隔的**仓库相对路径**（可写目录前缀，脚本按前缀匹配 `git status` 的在飞文件）。

## 汇总与告警

```
node scripts/agent-board.mjs           # 打印看板 + 未登记告警
node scripts/agent-board.mjs --write   # 同时写入 docs/product/agent-board.md
```

脚本会：汇总各 agent 在飞项 → 列出 worktree → 比对 `git status` 在飞文件，**未被任何 agent 登记的文件 = 告警**（有产出没登记）。有告警时退出码 1。