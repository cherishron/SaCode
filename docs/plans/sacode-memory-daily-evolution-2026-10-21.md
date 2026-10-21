# SaCode 记忆与每日自动进化方案

- 日期：2026-10-21
- 状态：设计提案，未实现、未验收。
- 定位：补 F11"记忆/速记/批注未收口"缺口；与已有知识库（KnowledgeStore）分工——**记忆是 agent 自动累积、需审阅的跨会话事实；知识库是用户显式手写/导入的文档**。两者存储/作用域/CAS 框架可复用，信任级别不同。
- 本轮授权：保存方案，不修改业务代码、不提交或发布。
- 关联：F11 知识库（[wiring](../evidence/2026-10-15-knowledge-management-wiring.md)）、F04 持续目标（idle 驱动参照）、F13 自动化与 Hooks（D07 executor 未实现）、`knowledge_store.cj`、`session_log`、`tips_surface.cj`。

## 0. 记忆 vs 知识库 vs AGENTS.md 的边界

| 概念 | 作者 | 信任级别 | 注入模型 | 触发 |
|---|---|---|---|---|
| 知识库（KnowledgeStore，已有） | 用户显式手写/文件导入 | 用户权威 | 自动检索注入（已接通） | 用户建/导入；任务请求时自动检索 |
| **记忆（Memory，本方案）** | **agent 自动提取（草稿）→ 用户确认/自动晋升** | 草稿低信任、确认后可用 | 仅 `confirmed` 注入；`draft` 不注入 | 轮末提取；启动时合并 |
| AGENTS.md（若引入） | 用户工作区长期指令 | 用户权威 | pre-step 注入 | 工作区加载 |

三者正交：记忆**不替代**知识库，也**不替代** AGENTS.md。记忆解决的是"agent 跨会话学到的东西"——用户没手写、但 agent 观察到的偏好/约定/纠正/事实。

## 1. 三态生命周期

```
agent 轮末提取          用户审阅 / 自动晋升
───────► draft ──────────────────► confirmed ─────► archived
            │                          │
            └──► rejected              └──► 用户可回滚到 draft
```

- **draft**：agent 提议，低信任，**不注入模型 context**，只在"待确认"面板可见
- **confirmed**：用户批准或满足自动晋升阈值，注入模型（按相关性检索）
- **archived**：失效/陈旧，保留历史但不注入
- **rejected**：用户拒绝，不注入，记拒绝理由供学习

**铁律**：只有 `confirmed` 进入 model context。`draft` 永不自动注入——否则等于让 agent 自己改自己的 prompt，是 prompt injection 风险面。

## 2. 记忆分类与配额

| 类别 | 内容 | 单类上限 |
|---|---|---|
| 用户偏好 | "我喜欢中文回复""不要用 any""提交前跑 lint" | 50 |
| 项目约定 | "本仓用 pnpm""仓颉 1.1.3""改 .cj 前读技能" | 100 |
| 代码库事实 | "core 是共享业务实现""桌面是 Vue runtime" | 200 |
| 纠正 | 用户纠正过的错误推断 | 50 |
| 工具使用模式 | 常用工具组合/调用顺序 | 50 |

总量上限 450 条。超出按 LRU + 置信度衰减。配额防无界增长，也防 agent 把记忆当草稿本堆。

## 3. 自动学习开关（设置）

- 设置页"记忆与学习"区：
  - **总开关**：启用记忆（默认开——记忆功能本身要能用）
  - **自动学习开关**：agent 自动提取候选记忆（**默认关**，SaCode 安全文化：自动写 = 自动改 prompt）
  - **自动晋升开关**：草稿满足阈值自动转 confirmed（**默认关**，更保守）
  - **每日进化开关**：启动时跑合并 pass（默认开，只读+合并，不新增记忆）
- 开关持久化进 `general-settings.txt`（沿用 F20 既有通道）
- 关闭自动学习时：记忆页仍可手动新建/编辑/确认，只是不自动提取

## 4. 触发机制（避开 F13 executor 未实现）

F13 自动化 executor 未实现（D07），不能依赖定时任务。"每天"用以下两机制实现：

### 4.1 轮末自动提取（agent pre-step / turn-end 钩子）

- 在 `agent.cj` 的 turn-end 钩子（或 `tips_surface.cj` 的 after-reply 通道同形）注入提取步：
  - agent 收到本轮用户消息 + 自身回复 + 工具调用 + 结果
  - 输出候选记忆 JSON（类别 + 内容 + 置信度 + 来源 callId）
  - 写入 `MemoryStore` 为 `draft`，落 `memory/draft` 事件
- **密钥擦除**：写入前 scrub 内容中匹配 `KEY|PASSWORD|SECRET|TOKEN|SACODE_*` 的字面（对齐 MCP env scrub 思路），命中则 fail-closed 不写该条
- 关闭自动学习时此步跳过

### 4.2 启动时每日进化 pass（无需 F13）

- app/Host 启动时读 `memory/last-evolution` 时间戳
- 距上次 >24h → 跑合并 pass：
  1. **去重**：同义条目合并（按归一化内容哈希）
  2. **解冲突**：新 confirmed 覆盖旧 confirmed，旧转 archived，落 `memory/conflict` 事件
  3. **衰减陈旧**：长期未被检索命中且未更新的 confirmed → 降为 archived
  4. **自动晋升**（仅在自动晋升开关开时）：草稿满足阈值（被提取 ≥2 次，或存在未拒绝 ≥N 轮）→ confirmed
  5. **配额裁剪**：超上限按 LRU+置信度淘汰
- 落 `memory/evolution` 事件（含本次合并/晋升/淘汰计数），更新 `last-evolution` 时间戳
- F13 executor 实现后可替换为真正的定时任务，但本机制不阻塞首版

## 5. 记忆存储与作用域（复用 KnowledgeStore 框架）

- `core/src/memory_store.cj` `MemoryStore`：复用 KnowledgeStore 的存储/作用域/CAS/持久屏障/原子发布机制，但事件类型独立
- 作用域：`user`（跨所有项目）+ `project`（项目级，工作区 SHA-256 隔离，同 KnowledgeStore）
- 事件类型：`memory/draft`、`memory/confirm`、`memory/reject`、`memory/archive`、`memory/conflict`、`memory/evolution`、`memory/context`（注入审计）、`memory/retrieval`
- 会话日志为唯一真源（沿用 KnowledgeStore 口径）
- 单条正文 ≤4 KiB；单作用域快照 ≤2 MiB

## 6. 注入契约（与知识库自动检索同形）

- 任务请求组装时，`MemoryStore.relevant(query)` 按字面匹配检索 `confirmed` 记忆（不冒充向量索引，与知识库一致）
- 命中片段作为 `user` 角色消息注入当步（与知识库 `knowledge/context` 同通道），落 `memory/context` + `memory/retrieval` 审计事件
- **低信任 user 请求注入审计**：复用知识库的 `readableKnowledgeStore` + 修订/来源审计 + 来源失效拒绝模式（main.cj:120-260 同形实现）
- 草稿**不注入**，只在记忆页"待确认"列表显示

## 7. Host RPC 面

新增 `memory/*` 命名空间（写入 `host-capabilities.json` 与 `main.cj` 分派）：

| RPC | 作用 |
|---|---|
| `memory/list` | 列记忆（按 scope/status/category 筛选），含 draft/confirmed/archived |
| `memory/get` | 取单条正文 |
| `memory/save` | 用户新建/编辑（用户写的直接 confirmed） |
| `memory/confirm` | 草稿→confirmed（用户批准） |
| `memory/reject` | 草稿→rejected（用户拒绝，带理由） |
| `memory/archive` | confirmed→archived |
| `memory/remove` | 删除（带 CAS 修订） |
| `memory/retrieve` | 任务请求时自动检索（内部调用，不暴露给前端直接调） |

约束：所有写操作带 `expectedRevision` CAS（沿用 KnowledgeStore）；`memory/retrieve` 不暴露给前端，只 Host 内部组装请求时调。

## 8. 前端组件（桌面渲染层，Vue runtime）

- **记忆页**（`renderer/pages/memory-page.ts`）：管理页，三段——待确认草稿 / 已确认记忆 / 已归档
  - 草稿段：每条显示类别+内容+提取来源 callId+置信度，按钮"确认/拒绝/编辑"
  - 已确认段：列表+搜索+编辑/归档/删除
  - 已归档段：只读+恢复
  - 作用域切换 user/project（同知识库页）
- **设置页"记忆与学习"区**：四个开关 + 进化时间戳显示 + "立即执行进化"按钮
- **注入审计**：消息渲染器增 `memory` 来源标记（与知识库 `knowledge-snapshot` 同形）
- IPC 面（`preload.cjs`）新增 `memoryList`/`memoryGet`/`memorySave`/`memoryConfirm`/`memoryReject`/`memoryArchive`/`memoryRemove`/`memoryEvolveNow`（门禁扩充，同步 `bridge.test.mjs` 与 `check_ipc_surface_parity.cjs`）

## 9. 安全与失败处理

- **密钥擦除**：agent 写记忆前 scrub `KEY|PASSWORD|SECRET|TOKEN|SACODE_*`；命中 fail-closed 不写
- **draft 不注入**：铁律，未确认草稿永不进 model context
- **用户可删/改任何记忆**；自动晋升可回滚到 draft
- **冲突解算**：新 confirmed 覆盖旧，旧转 archived，落 `memory/conflict` 事件可审计
- **容量上限**：每类 + 总量配额，超限 LRU+置信度淘汰
- **衰减**：长期未命中且未更新的 confirmed → archived（避免陈旧记忆长期污染 context）
- **不伪造进化**：进化 pass 失败不谎报晋升计数；启动时合并失败则跳过，下次启动重试
- **记忆导出**：导出不含密钥、不含运行中工单、不含会话内容（沿用知识库导出约束）
- **跨会话隔离**：项目级记忆用工作区 SHA-256 隔离，不串用（沿用 KnowledgeStore）

## 10. 与现有需求域的关系

| 域 | 关系 |
|---|---|
| F11 知识库 | 分工：知识库=用户显式文档，记忆=agent 自动事实；存储框架复用，事件类型独立；F11 tracking"记忆/速记/批注未收口"由本方案闭合 |
| F04 持续目标 | 参照 idle 驱动模式；本方案轮末提取是 turn-end 钩子，不抢 goal 的 idle 边 |
| F13 自动化 | "每天"靠启动时合并 pass 兜底；F13 executor 实现后可升级为真正定时任务，但本方案不阻塞 |
| F20 设置 | 四个开关持久化进 `general-settings.txt`（沿用 F20 通道） |
| F02 Agent 主循环 | turn-end 钩子注入提取步；pre-step 注入 confirmed 记忆（与知识库同通道） |

## 11. 实施顺序与验收

依赖顺序：冻结记忆定义/事件/CAS 语义 → `MemoryStore`（复用 KnowledgeStore 框架）→ turn-end 提取钩子 + 密钥 scrub → Host `memory/*` RPC → 注入契约（relevant + context 事件）→ 记忆页 + 设置开关 → 启动时进化 pass → 打包态验收。依赖顺序不是范围裁剪，全部能力完整保留。

| 验收面 | 必须结果 |
|---|---|
| 定义与持久化 | 手写、agent 提取、晋升的记忆均校验；重启后保留；非法定义不污染旧版本 |
| 并发编辑 | 旧 expectedRevision 被拒绝，桌面/CLI 不互相静默覆盖 |
| 轮末提取 | agent 真实产生 draft；密钥模式命中 fail-closed 不写 |
| 草稿不注入 | draft 状态记忆**不**进入 model context（反证：故意把关键事实留 draft，模型请求不含它） |
| 确认注入 | confirmed 记忆按字面匹配注入；来源审计 + 失效拒绝 |
| 自动晋升 | 开启时阈值满足自动转 confirmed；关闭时永远等手动；自动晋升可回滚 |
| 每日进化 | 启动时 >24h 触发合并；去重/解冲突/衰减/晋升计数可审计；失败不谎报 |
| 配额 | 超限按 LRU+置信度淘汰；不无界增长 |
| 作用域 | user/project 同名不串用；项目级用工作区 SHA-256 隔离 |
| 设置开关 | 四开关持久化；关闭自动学习时不提取；关闭自动晋升时草稿不自动转 |
| 双入口与恢复 | 桌面、CLI 对同一记忆修订一致；任务恢复可重建实际选择 |
| 交付 | 新构建的桌面与 CLI 真实验证，不用单测或静态 UI 代替 |

关键反证：故意让 draft 注入 model context、让密钥模式命中仍写入、让自动晋升在开关关闭时触发、让合并失败谎报晋升计数、让项目级记忆串用到其他项目，指定测试必须转红。

## 12. 本轮结论

记忆与每日自动进化方向可行，补 F11"记忆/速记/批注未收口"缺口。三态生命周期 + draft 不注入铁律 + 启动时合并 pass（避开 F13）是相对 DSH/市面更稳的设计。本轮仅保存设计，不修改业务代码、不提交或发布；实施前需核 turn-end 钩子接入点、`MemoryStore` 与 KnowledgeStore 的存储共享边界、以及自动晋升阈值的具体值（默认 ≥2 次提取或 ≥3 轮未拒绝，实施期按真实数据调）。
