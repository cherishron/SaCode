# Desktop 接口契约（四组共享）

> 状态：**已生效 v0.2**（v0.1 用户确认 + v0.2 实现映射补充，均为非破坏性新增）。Agent4 维护本文件；其余 agent 只读接入。
> 范围：SaCode Desktop（Vue 3 + TDesign + Tauri 2 + Rust runtime）与 daemon / client-core 的字段约定。
> 排除：厂家云端、遥测、浏览器扩展桥、WSL、临时会话、待办分组。
> 日期：2026-10-12；实现映射更新：2026-10-12

---

## 0. 变更纪律

1. **先改本文件，再改代码**。字段名、可选性、语义以本文件为准。
2. 破坏性变更（改名 / 删字段 / 改类型）必须 bump `protocol_version` 并列迁移说明。
3. 新增可选字段不 bump 版本；客户端必须容忍未知字段。
4. 各 agent 在「已实现 / 已通过测试 / 已通过原生桌面验收」三列分别打勾，禁止用构建成功代替操作验收。

---

## 1. 任务发送（Agent2 主接，Agent4 定型）

### 1.1 现状缺口

| 字段 | 现状 | 目标 |
| --- | --- | --- |
| 思考深度 | UI 有按钮，**发送不传** | `reasoning_effort` 进请求体 |
| 技能 | `skill?: string` 单选 | `skills: string[]` 多选 |
| 上下文百分比 | 前端固定 **200k** 估算 | 读模型真实窗口，按会话隔离 |
| 模型/技能/用量 | 全局共享 | 按 `conversation_id` 隔离 |

### 1.2 目标请求体（`POST /api/desktop/conversations[/:id]`）

```ts
interface DesktopSendRequest {
  prompt: string;
  mode: 'build' | 'plan' | 'yolo';           // 现状已有
  backend_id?: string;                        // 现状已有
  model_provider?: string;                    // 现状已有
  model_name?: string;                        // 现状已有
  context_paths?: string[];                   // 现状已有

  // —— 新增 ——
  reasoning_effort?: 'low' | 'medium' | 'high' | null;  // 思考深度；null=跟随 provider 默认
  skills?: string[];                                      // 多选；空数组=不注入技能
  client_msg_id?: string;                                 // 幂等去重（草稿重发）
}
```

### 1.3 目标响应补充

```ts
interface DesktopSendResponse {
  conversation_id: string;
  task_id: string;
  // —— 新增 ——
  context_window?: number;     // 该模型真实 token 窗口；缺省时前端才允许 200k 兜底
}
```

### 1.4 会话级设置持久化（daemon 侧）

```ts
interface ConversationSettings {
  conversation_id: string;
  model_provider?: string;
  model_name?: string;
  reasoning_effort?: 'low' | 'medium' | 'high' | null;
  skills?: string[];
  draft?: string;              // 输入草稿，按会话保存（Agent2 写，Agent4 落盘）
}
// GET/PUT /api/desktop/conversations/:id/settings
```

---

## 2. 会话轮次与卡片（Agent2 主接，Agent4 定型）

### 2.1 现状缺口

`DesktopConversationTurn` 只有 `prompt / output / error / frames[]`，
工具、思考、审批、提问、子代理结果被压成普通文字帧，无法做可折叠卡片。

### 2.2 目标轮次结构

```ts
interface DesktopConversationTurn {
  task_id: string;
  prompt: string;
  created_at: string;
  status: string;
  output?: string | null;
  error?: string | null;
  frames?: Array<{ seq: number; kind: string; text: string; detail?: string | null }>; // 保留兼容

  // —— 新增：结构化事件，驱动卡片颗粒度 ——
  events?: TurnEvent[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    context_window?: number;
  };
  settings_snapshot?: {
    model_provider?: string;
    model_name?: string;
    reasoning_effort?: string | null;
    skills?: string[];
  };
}

type TurnEvent =
  | { type: 'text'; seq: number; text: string }
  | { type: 'thinking'; seq: number; text: string; collapsed?: boolean }
  | {
      type: 'tool';
      seq: number;
      tool: string;            // fs.read / shell.exec / ...
      input?: unknown;
      output?: string;
      status: 'running' | 'ok' | 'err';
      started_at?: string;
      duration_ms?: number;
    }
  | {
      type: 'approval';
      seq: number;
      approval_id: string;
      tool: string;
      summary: string;
      diff?: string;
      status: 'pending' | 'approved' | 'rejected';
    }
  | {
      type: 'ask';
      seq: number;
      question_id: string;
      question: string;
      options?: string[];
      allow_multiple?: boolean;
      status: 'pending' | 'answered' | 'cancelled';
      answer?: string | string[];
    }
  | {
      type: 'subagent';
      seq: number;
      agent_id: string;
      title: string;
      status: 'running' | 'done' | 'failed';
      summary?: string;
      result?: string;
    }
  /* —— 灵枢特色事件（§2.4）—— */
  | {
      type: 'role_assignment';
      seq: number;
      roles: Array<{
        role_id: string;
        role_name?: string;
        score?: number;
        reason?: string;
        model_provider?: string;
        model_name?: string;
      }>;
    }
  | {
      type: 'conflict';
      seq: number;
      conflict_id?: string;
      kind: string;              // validation_conflict / ...
      summary: string;
      details?: string[];
      status: 'detected' | 'intervening' | 'resolved' | 'ignored';
      intervention?: {
        target_role?: string;
        action?: string;         // dispatch_fix_loop / ...
      };
    }
  | {
      type: 'model_route';
      seq: number;
      role_id?: string;
      primary: { provider: string; model: string; score?: number; needs_thinking?: boolean };
      fallbacks?: Array<{ provider: string; model: string; score?: number }>;
      reason?: string;
      failed_over?: boolean;     // 发生过故障切换
    }
  | {
      type: 'summary';
      seq: number;
      task: string;
      roles?: string[];
      conclusion?: string;
      key_risks?: string[];
      next_action?: string;
      conflicts?: string[];
    };
```

### 2.3 卡片映射（Agent2 UI）

| TurnEvent | 卡片形态 | 默认折叠 |
| --- | --- | --- |
| `text` | 普通消息气泡 | 否 |
| `thinking` | 可折叠「思考」卡 | 是 |
| `tool` | 可折叠工具卡（工具名 + 状态 + 展开 in/out） | 是 |
| `approval` | 审批卡（复用 ApprovalCard） | 否 |
| `ask` | 提问卡（复用 AskCard） | 否 |
| `subagent` | 子代理结果卡 | 是（done 后） |
| `role_assignment` | 灵枢「角色编排」卡：谁接活 + 打分/原因 | 是 |
| `conflict` | 灵枢「冲突/干预」警示卡（detected 红、resolved 绿） | 否（未决时） |
| `model_route` | 灵枢「模型路由」细条：主 → 备，failed_over 时点色 | 是 |
| `summary` | 灵枢「任务摘要」收尾卡：结论/风险/下一步 | 否 |

长历史：按 turn 窗口化渲染（虚拟列表），保留「跳到最新 / 回到顶部」。

### 2.4 灵枢特色事件（差异化外显）

运行时数据已在 `kernel/src/execution/report.rs` 的 `ExecutionReport` 就位，daemon 侧只需投影成 `TurnEvent`：

| TurnEvent | 内核数据源 | 所属灵枢子系统 |
| --- | --- | --- |
| `role_assignment` | `RoleScore` / `plan.roles` | 自组织 — 角色驱动编排 |
| `conflict` | `ConflictRecord` + `InterventionRequest` | 自防护 — 五维冲突检测 + 实时干预 |
| `model_route` | `RouteRecord` / `RoutedModelRecord` | 自愈合 — 故障转移路由 |
| `summary` | `SummaryRecord` | 结构化摘要（编排收尾） |

投影约定：同一 `task_id` 的事件按发生顺序编号 `seq`；`conflict` 在检测与解决时各出一条（或同条更新 `status`），UI 以最终态为准。记忆/学习型（mistakes / preferences）不进消息流，走管理页。

---

## 3. 会话管理（Agent3 主接，Agent4 定型）

### 3.1 现状缺口

缺搜索、归档/恢复、删除确认、右键菜单、未读标记；重命名只写 localStorage。

### 3.2 目标 API

```ts
// 列表扩展
interface DesktopConversation {
  id: string;
  title: string;
  created_at: string;
  latest_task_id: string;
  status: string;
  // —— 新增 ——
  archived?: boolean;
  unread?: boolean;
  updated_at?: string;
  preview?: string;            // 末条消息摘要，列表用
}

// 搜索
// GET /api/desktop/conversations?q=<urlencoded>
// 语义：对 title + prompt + output 做子串匹配（首版不做向量）

// 归档 / 恢复
// POST /api/desktop/conversations/:id/archive
// POST /api/desktop/conversations/:id/restore

// 重命名（落盘，不再只写 localStorage）
// PUT /api/desktop/conversations/:id  { title: string }

// 删除已有 DELETE；UI 侧须二次确认
```

### 3.3 未读规则

- 会话不在任何分格且有新 `TurnEvent` 落盘 → `unread = true`
- 会话在分格中可见 → 立即清未读
- 列表行首 2px warning 竖条（契约已有）

---

## 4. 右侧工具栏（Agent1 主接）

### 4.1 现状

`WorkspaceTools.vue` 已有「文件 / 变更 / 终端 / 预览」标签栏与 Diff 入口，
侧板组件已支持 `embedded`，**未接入 App.vue，CSS 未写，未验证**。

### 4.2 目标形态（对齐 MonkeyCode）

- 格内 absolute scrim + 单一右侧面板；顶部标签：**文件 / 变更 / 终端 / 预览**
- 每个分格独立：开关状态、当前标签、宽度互不影响
- 面板整体可拖宽；文件树 ↔ 预览 内部分隔也可拖
- 变更标签 = 当前会话最新 task 的 `getTaskChanges` 列表 + Diff 预览
- 会话与工具栏**同时可操作**（工具栏不是模态，不挡 chat 交互）

### 4.3 依赖接口

| 接口 | 状态 | 归属 |
| --- | --- | --- |
| `getDesktopConversation(id)` → turns[].task_id | 已有 | — |
| `getTaskChanges(taskId)` → changes[] | 已有 | — |
| `listWorkspaceDir` / 文件预览 | 已有 | — |
| PTY start/write/resize/events | 部分 | Agent4 |

---

## 5. 终端（Agent4 主接）

### 5.1 现状缺口

剥离 ANSI 的文字转录；单实例；固定 24×80；尺寸不自适应。

### 5.2 目标

```ts
// Tauri commands（tauri-bridge.ts 同步签名）
startTerminal(cols: number, rows: number, cwd?: string): Promise<{ terminal_id: string; shell: string }>;
writeTerminal(terminal_id: string, data: string): Promise<void>;
resizeTerminal(terminal_id: string, cols: number, rows: number): Promise<void>;
closeTerminal(terminal_id: string): Promise<void>;
// events: terminal-output { terminal_id, data /* 原始字节/UTF-8，含 ANSI */ }
//         terminal-exit   { terminal_id, code, reason }
```

- 前端用 **xterm.js**（或同等）做真仿真，保留 ANSI / 光标 / 颜色
- 多实例：`terminal_id` 贯穿；每个分格工具栏可开多个终端 tab（首版至少 1 个，结构预留）
- 面板 resize 时 `resizeTerminal` 同步 cols/rows
- 退出重启后：终端不恢复（会话进程无法跨启动），但**面板开关状态与标签**要恢复

---

## 6. 布局 / 草稿恢复（Agent1 主接，Agent2 提供草稿）

### 6.1 目标

退出重启后恢复：

| 项 | 存储 | 归属 |
| --- | --- | --- |
| 分格树（轴向 + 比例 + 每格会话 id） | localStorage `sacode.layout.<workspace>` | Agent1 |
| 右侧工具栏：每格 open / tab / width | 同上 | Agent1 |
| 任务列宽度 | 同上 | Agent1 |
| 输入草稿 | daemon `ConversationSettings.draft`（跨设备）或 localStorage 兜底 | Agent2 |
| 会话打开状态 | 由布局树携带 | Agent1 |

分屏：支持**独立嵌套**（上下 + 左右可组合），不再是全局单一 `splitAxis`。
实现上建议从「一维 panes[]」升级为「二叉分屏树」，`split-tree.ts` 已有语义基础。

---

## 7. MCP / 技能管理（Agent3 主接，Agent4 定型）

### 7.1 MCP

已有：添加、删除、启停、探活。缺：**编辑**、`headers` / `env` 表单。

```ts
interface McpServerConfig {
  name: string;
  transport: 'stdio' | 'http' | 'sse';
  command?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled: boolean;
}
// PUT /api/mcp/:name  整对象替换
```

### 7.2 技能

已有：增删改。缺：**目录/ZIP 导入**、**默认启用**、**会话多选**。

```ts
interface WorkspaceSkill {
  name: string;
  description?: string;
  enabled?: boolean;          // 默认启用标记
  source?: 'builtin' | 'user' | 'imported';
}
// POST /api/skills/import  (multipart: zip 或 目录扫描入口)
// 发送侧见 §1.2 skills: string[]
```

---

## 8. 预览（Agent1 主接）

- 保留手填 URL + reload（现状）
- 后续：开发服务发现（探测 3000/5173/8080 等常见端口），列为**后续**，不阻塞本轮
- 预览宽度随工具栏拖宽联动

---

## 9. 明确排除（本轮不做）

- 厂家云端 / 云 tab / 装机遥测
- 浏览器扩展桥
- WSL
- 临时会话、待办分组
- 向量语义搜索（会话搜索首版子串）

---

## 10. 验收口令（四组共用）

1. 运行任务能触发工具、审批、提问，且各自成卡可折叠。
2. 右侧标签可切换，Diff 能看，终端能输入并保持尺寸。
3. 多分屏独立开工具栏、独立换会话，互不干扰。
4. 退出重启后：会话、布局、草稿、历史可见且正确。
5. 同窗口尺寸对照 MonkeyCode，形态一致（不抄视觉资产）。
6. 「已实现 / 已通过测试 / 已通过原生桌面验收」三列分别记录。

---

## 11. 分工与文件归属

| Agent | 主文件 | 共享文件（先协调） |
| --- | --- | --- |
| 1 工作台与工具栏 | `App.vue` `PaneFrame.vue` `WorkspaceTools.vue` `*SidePanel.vue` `split-*.ts` `shell.css` | `layout-contract.css` `useDesktopApp.ts` |
| 2 会话与输入 | `ChatPane.vue` `ComposerDock.vue` `ChatCard.vue` `AskCard.vue` `ApprovalCard.vue` `conversation-queue.ts` | `useDesktopApp.ts` `daemon-client.ts` |
| 3 侧栏与管理 | `TaskColumn.vue` `SettingsView.vue` `KnowledgeView.vue` `AutomationView.vue` | `daemon-client.ts` `services.ts` |
| 4 原生与接口 | `src-tauri/**` `tauri-bridge.ts` `daemon-client.ts` `runtime/**`（daemon 端点） | **契约文档本文件** |

共享文件修改前先在任务卡留言协调；接口字段以本文件为准。

---

## 12. 实现映射与发布面（Agent4 落地，其余 agent 按此 import）

> v0.2 补充。wire 层（HTTP body / 响应 JSON / Tauri payload）一律 **snake_case**；
> `DaemonClient` 方法的**选项对象**用 **camelCase**（与既有 `modelProvider` / `contextPaths` 一致），
> 方法返回的 **DTO 接口**用 **snake_case**（与 wire 一致，直接透传）。
> 所有新增字段均可选，客户端必须容忍未知字段。**protocol_version 不变**（无破坏性变更）。

### 12.1 已发布 TS 类型（`interfaces/client-core/src/daemon-client.ts` 可直接 import）

```ts
export type ReasoningEffort = 'low' | 'medium' | 'high' | null;

/** §2.2 TurnEvent 联合类型（6 基础臂 + 4 灵枢臂） */
export type TurnEvent =
  | { type: 'text'; seq: number; text: string }
  | { type: 'thinking'; seq: number; text: string; collapsed?: boolean }
  | { type: 'tool'; seq: number; tool: string; input?: unknown; output?: string;
      status: 'running' | 'ok' | 'err'; started_at?: string; duration_ms?: number }
  | { type: 'approval'; seq: number; approval_id: string; tool: string; summary: string;
      diff?: string; status: 'pending' | 'approved' | 'rejected' }
  | { type: 'ask'; seq: number; question_id: string; question: string; options?: string[];
      allow_multiple?: boolean; status: 'pending' | 'answered' | 'cancelled';
      answer?: string | string[] }
  | { type: 'subagent'; seq: number; agent_id: string; title: string;
      status: 'running' | 'done' | 'failed'; summary?: string; result?: string }
  | { type: 'agent_backend'; seq: number; backend_id: string; title: string;
      status: 'running' | 'done' | 'failed' | 'quota_exhausted';
      summary?: string; result?: string; quota?: AgentBackendQuota }
  /* 灵枢特色事件（§2.4） */
  | { type: 'role_assignment'; seq: number;
      roles: Array<{ role_id: string; role_name?: string; score?: number; reason?: string;
                     model_provider?: string; model_name?: string }> }
  | { type: 'conflict'; seq: number; conflict_id?: string; kind: string; summary: string;
      details?: string[]; status: 'detected' | 'intervening' | 'resolved' | 'ignored';
      intervention?: { target_role?: string; action?: string } }
  | { type: 'model_route'; seq: number; role_id?: string;
      primary: { provider: string; model: string; score?: number; needs_thinking?: boolean };
      fallbacks?: Array<{ provider: string; model: string; score?: number }>;
      reason?: string; failed_over?: boolean }
  | { type: 'summary'; seq: number; task: string; roles?: string[]; conclusion?: string;
      key_risks?: string[]; next_action?: string; conflicts?: string[] };

export interface TurnUsage {
  input_tokens?: number;      // 映射自 ChatUsage.prompt_tokens
  output_tokens?: number;     // 映射自 ChatUsage.completion_tokens
  context_window?: number;
}

export interface TurnSettingsSnapshot {
  model_provider?: string;
  model_name?: string;
  reasoning_effort?: string | null;
  skills?: string[];
}

export interface ConversationSettings {
  conversation_id: string;
  model_provider?: string;
  model_name?: string;
  reasoning_effort?: ReasoningEffort;
  skills?: string[];
  draft?: string;
}

export interface DesktopConversation {
  id: string;
  title: string;
  created_at: string;
  latest_task_id: string;
  status: string;
  archived?: boolean;
  unread?: boolean;
  updated_at?: string;
  preview?: string;
}

export interface DesktopConversationTurn {
  task_id: string;
  prompt: string;
  created_at: string;
  status: string;
  output?: string | null;
  error?: string | null;
  frames?: Array<{ seq: number; kind: string; text: string; detail?: string | null }>;
  events?: TurnEvent[];
  usage?: TurnUsage;
  settings_snapshot?: TurnSettingsSnapshot;
}

export interface McpServerConfig {
  name: string;
  transport: 'stdio' | 'http' | 'sse';
  command?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled: boolean;
}

export interface WorkspaceSkillOption {
  name: string;
  description: string;
  source: 'user' | 'project' | 'workspace' | 'builtin' | 'imported' | string;
  enabled?: boolean;          // 缺省 = true（默认启用）
  path?: string;
  version?: string;
  author?: string;
  tags?: string[];
}
```

### 12.2 已发布 DaemonClient 方法

| 方法 | 选项（camelCase） | 返回 / wire | 端点 |
| --- | --- | --- | --- |
| `createTask` | + `reasoningEffort?: ReasoningEffort` `skills?: string[]` `clientMsgId?: string` | `CreateTaskResponse`（+ `context_window?`） | `POST /task` |
| `sendDesktopMessage` | + 同上三项 | `CreateTaskResponse & { conversation_id, context_window? }` | `POST /api/desktop/conversations[/:id]` |
| `listDesktopConversations` | `{ q?: string }`（子串搜索 title+prompt+output） | `DesktopConversation[]` | `GET /api/desktop/conversations?q=` |
| `getDesktopConversation` | `id` | `DesktopConversationDetail`（turns 含 events/usage/settings_snapshot） | `GET /api/desktop/conversations/:id` |
| `getDesktopConversationSettings` | `id` | `ConversationSettings` | `GET /api/desktop/conversations/:id/settings` |
| `updateDesktopConversationSettings` | `id`, `Partial<ConversationSettings>`（含 `draft`） | `ConversationSettings` | `PUT /api/desktop/conversations/:id/settings` |
| `renameDesktopConversation` | `id`, `title` | `{ status }` | `PUT /api/desktop/conversations/:id` `{title}` |
| `archiveDesktopConversation` | `id` | `{ status }` | `POST /api/desktop/conversations/:id/archive` |
| `restoreDesktopConversation` | `id` | `{ status }` | `POST /api/desktop/conversations/:id/restore` |
| `replaceMcpServer` | `name`, `McpServerConfig`（**整对象替换**） | `{ status }` | `PUT /api/mcp/:name` |
| `importSkill` | `{ zipBase64? , directory?, source? }` | `{ status, skills[] }` | `POST /api/skills/import` |

既有方法 `upsertMcpServer`（`PUT /api/mcp/servers/:name`）保留兼容；
`headers` / `env` 在 list 返回中完整给出（不再只给 env_keys）。

### 12.3 发送请求 / 响应 wire 形态

```jsonc
// POST /api/desktop/conversations[/:id]  新增字段（全部可选）
{
  "prompt": "...", "mode": "build",
  "reasoning_effort": "high",       // 'low'|'medium'|'high'|null；缺省跟随 provider
  "skills": ["code-review", "test"],// 多选；[] = 不注入技能；缺省回落 legacy `skill`
  "client_msg_id": "uuid-..."       // 幂等去重：同 conversation 内重发直接回既有 task
}
// 响应新增
{ "conversation_id": "...", "task_id": "...", "context_window": 200000 }
```

### 12.4 TurnEvent 映射（历史 frames → events，daemon GET 时合成）

| frame.kind | TurnEvent |
| --- | --- |
| `assistant` | `text` |
| `thinking` | `thinking`（`collapsed: true`） |
| `tool` | `tool`（`tool`=text 去掉 ✓/✗ 后缀；status 由后缀推断） |
| `approval` | `approval`（detail JSON → `approval_id`/`status`） |
| `ask` | `ask`（detail JSON → `question_id`/`options`/`answer`） |
| `subagent` | `subagent` |
| `role_assignment` | `role_assignment`（detail JSON = roles[]，来自 `RoleScore` / plan.roles） |
| `conflict` | `conflict`（detail JSON = ConflictRecord + InterventionRequest） |
| `model_route` | `model_route`（detail JSON = RouteRecord，含 `failed_over`） |
| `summary` | `summary`（detail JSON = SummaryRecord） |
| 其他 | `text` |

`usage` 取自任务 `ChatUsage`（prompt→input、completion→output）；
`settings_snapshot` 在发送时随 turn 落盘。

灵枢四类事件数据源：`kernel/src/execution/report.rs` 的 `ExecutionReport`
（`RoleScore` / `plan.roles`、`ConflictRecord` + `InterventionRequest`、
`RouteRecord` / `RoutedModelRecord`、`SummaryRecord`）。
投影约定：同 `task_id` 按发生顺序编号 `seq`；`conflict` 检测与解决各出一条
（或同条更新 `status`），UI 以最终态为准；记忆/学习型（mistakes / preferences）
不进消息流。

### 12.5 终端（§5.2 落地签名，**cols 在前**）

```ts
startTerminal(cols: number, rows: number, cwd?: string): Promise<TerminalStartDto | null>;
writeTerminal(terminal_id: string, data: string): Promise<boolean>;
resizeTerminal(terminal_id: string, cols: number, rows: number): Promise<boolean>;
closeTerminal(terminal_id: string): Promise<boolean>;
// events: terminal-output { terminal_id, data }   // UTF-8 文本，ANSI 原样保留，不剥色
//         terminal-exit   { terminal_id, code, signal, reason }
```

- `cwd` 可选；必须位于 daemon 工作区内（越界拒绝），缺省 = 工作区根
- Tauri command：`terminal_start { cols, rows, cwd? }` / `terminal_write` / `terminal_resize` / `terminal_close`
- 多实例：`terminal_id` 贯穿全链路；输出含 ANSI，前端用 xterm.js 渲染（Agent1/2）

### 12.6 重启恢复（P2）

| 项 | 持久化 | 重启后行为 |
| --- | --- | --- |
| 历史帧 `frames` | `desktop_frames` 表 | 完整回放（已测） |
| 审批卡状态 | `desktop_frames` kind=approval（请求+结果） | 历史卡可回放；**进行中**审批落 `desktop_pending_approvals`，重启后可继续 resolve 或标 stale |
| 提问卡 | `desktop_pending_questions`（含 pending_question JSON） | 重启后 `pending_question` 恢复，可继续 `answer` |
| 会话设置/草稿 | `desktop_conversation_settings` | 跨重启保留 |
| 会话标题/归档/未读 | `desktop_conversation_meta` | 跨重启保留 |
| usage | 随 turn meta 落盘 | 重启后 turns 仍带 usage |

### 12.7 验收状态（Agent4）

| 项 | 已实现 | 已通过测试 | 已通过原生桌面验收 |
| --- | --- | --- | --- |
| P0 契约字段（类型+方法+端点） | ☑ | ☑（cargo test + client-core test） | 待原生验收 |
| P1 终端通道（多实例/resize/ANSI） | ☑ | ☑（terminal.rs unit） | 待原生验收 |
| P2 重启恢复（帧/审批/提问） | ☑ | ☑（daemon 集成测试） | 待原生验收 |

---

## 13. 多 ACP 后端与额度调度（R2.5，Agent4b）

> 状态：**已生效 v0.3**（非破坏性新增）。先改本节再改码。
> 对应迭代计划 R2.5 O1–O7。

### 13.1 Agent Backend 描述与探测（O1/O2）

```ts
/** 后端额度状态机（O5）；按日（UTC+8）重置 */
export interface AgentBackendQuota {
  date: string;              // 'YYYY-MM-DD'（UTC+8 当日）
  used: number;              // 当日已用次数
  limit?: number;            // 可选上限；缺省 = 未知/不限
  exhausted: boolean;        // true = 当日停调
  reason?: string;           // 耗尽原因（限流文案摘要，脱敏）
}

export type AgentBackendHealth = 'unknown' | 'ready' | 'degraded' | 'unavailable';

export interface AgentBackendDescriptor {
  id: string;                        // 'sacode' | 'opencode' | ...
  display_name: string;
  kind: 'native' | 'acp';
  health: AgentBackendHealth;
  enabled: boolean;                  // O3 开关；native 恒 true
  capabilities?: {
    streaming?: boolean; tool_calls?: boolean; approvals?: boolean;
    cancel?: boolean; sessions?: boolean; modes?: string[]; notes?: string;
  };
  executable?: string;
  args?: string[];
  version?: string;
  diagnostic?: string;               // 不可用时的人读原因
  install_hint?: string;             // O2：安装指引字符串（不静默下载）
  quota?: AgentBackendQuota;         // O5；仅 ACP 后端有
}
```

探测语义（O2）：
- 可执行文件存在 + ACP `initialize` 握手成功 → `health: 'ready'`
- 文件缺失 / 握手失败 → `health: 'unavailable'`，`diagnostic` + `install_hint` 填充
- **禁止静默下载**；`install_hint` 只给安装指引文案（如 `npm i -g opencode-ai`）

### 13.2 管理端点（O3）

| 方法 | 路径 | 请求 | 响应 |
| --- | --- | --- | --- |
| `GET` | `/api/agent-backends` | — | `{ backends: AgentBackendDescriptor[], default_backend_id }` |
| `PUT` | `/api/agent-backends/:id` | `{ enabled?: boolean, executable?: string, args?: string[] }` | `{ status, backend: AgentBackendDescriptor }` |
| `POST` | `/api/agent-backends/:id/probe` | — | `{ status, backend: AgentBackendDescriptor }`（触发探测） |

- `enabled: false` 时该后端不接新任务（派发到它的任务立刻失败并回 `backend/disabled`）；native `sacode` 不可禁用。
- `executable` / `args` 仅用户级可信配置；`command` 与 `args` 分开存储，禁止 shell 字符串拼接。
- 变更即时生效（registry + executor acp_backends 同步）。

### 13.3 TurnEvent 新增臂（O4）

```ts
/** ACP 后端执行轨迹（统一 TurnEvent，与 subagent 并列） */
| {
    type: 'agent_backend';
    seq: number;
    backend_id: string;              // 'opencode' / ...
    title: string;                   // 任务摘要/标题
    status: 'running' | 'done' | 'failed' | 'quota_exhausted';
    summary?: string;
    result?: string;
    quota?: AgentBackendQuota;        // 耗尽时带上（status=quota_exhausted）
  }
```

映射（§12.4 扩展）：

| frame.kind | TurnEvent |
| --- | --- |
| `agent_backend` | `agent_backend`（detail JSON = `{ backend_id, title, status, summary, result, quota? }`） |

### 13.4 额度状态机（O5）

- 每个 ACP 后端独立一份 `quota`，持久化于 `.sacode/agent_backends.json`。
- 识别限流：错误文案含 `quota` / `rate limit` / `429` / `额度` / `too many requests` / `exceeded` → 当日 `exhausted=true`，记录 `reason`。
- `exhausted=true` 时**当日不再调用**该后端。

### 13.5 队列挂起与日切（O6）

- `exhausted` 时新任务**入队挂起**（不丢、不立即失败），`status` 回 `queued`，附 `quota` 快照。
- 日切（UTC+8 日期变更）自动 `used=0, exhausted=false`，并放行挂起任务。
- 日切可由「下一任务派发时懒检测」+「后台 60s tick」双触发，避免长空闲漏切。

### 13.6 请求侧（O4）

`POST /task` / `POST /api/desktop/conversations[/:id]` 的 `backend_id` 可指向任意已注册 ACP 后端。

### 13.7 验收状态（Agent4b / R2.5）

| 项 | 已实现 | 已通过测试 | 已通过原生桌面验收 |
| --- | --- | --- | --- |
| O1 后端注册表泛化 | ☑ | ☑ | 待原生验收 |
| O2 探测/安装引导 | ☑ | ☑ | 待原生验收 |
| O3 管理端点 | ☑ | ☑ | 待原生验收 |
| O4 任务路由 + TurnEvent | ☑ | ☑ | 待原生验收 |
| O5 额度状态机 | ☑ | ☑ | 待原生验收 |
| O6 队列挂起与日切 | ☑ | ☑ | 待原生验收 |
| O7 CodeBuddy 及其它 | ☐（待其开放 ACP） | — | — |
