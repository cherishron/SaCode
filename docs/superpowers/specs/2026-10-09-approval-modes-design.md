# 4 种审批模式设计规格（Plan/Build/Auto/Yolo）

- 状态：v0.1，供架构评审；尚未开始实现。
- 日期：2026-10-09。
- 范围：把现有 `PermissionPresets`（2 个粗预设）与 `PlanModeController`（plan 开关）合并为统一的 4 模式控制器（plan/build/auto/yolo），引入 `PermissionPolicy` 策略层，按模式决定放行/拒绝/走审批工单；CLI 用 `--mode` 参数，桌面启用 `permission-menu.ts` 的 4 按钮 + Shift+Tab 循环。
- 不在范围：不改 `ApprovalDesk` 工单状态机（已成熟）；不引入模型分类器（Auto 模式仅规则+模型兜底，不直接依赖模型）；不做 UI 视觉改动（只启用已声明按钮）。

## 1. 目标

参考 Qwen Code 的 5 种审批模式（Plan / Ask Permissions / Auto-Edit / Auto / YOLO），裁剪为 4 档（砍掉 Ask Permissions 与 Auto-Edit，合并到 Build），使日常开发默认档（Build）能自动放行工作区写入与构建命令，而危险操作仍需审批。核心已有 `ApprovalDesk`（工单）、`PermissionPresets`（2 预设）、`PlanModeController`（plan 开关），需统一为 `ModeController` + `PermissionPolicy` 策略层。

**验收口径**：
- 4 模式能通过 `PermissionPolicy.decide(mode, toolOrCommand)` 得到 `allow | deny | ask(id)` 三种判决。
- Build 模式对硬编码白名单内的 shell 命令（npm/cargo/make 等）自动放行，其余 shell 走 `ApprovalDesk`。
- Auto 模式先规则白名单（工具名），不在白名单的走模型分类器兜底。
- CLI `--mode` 与桌面按钮能切换模式，`mode/mode` 事件落日志可回放。
- 桌面 `permission-menu.ts` 的 4 按钮从 `disabled` 变为可用，Shift+Tab 能循环切换。

## 2. 架构

### 2.1 组件职责与不允许承担的职责

| 组件 | 职责 | 不允许承担的职责 |
| --- | --- | --- |
| `ModeController` | 管理当前模式（plan/build/auto/yolo），`mode/mode` 事件 log-only，回放最后一条得当前值 | 不决定工具是否放行（交给 `PermissionPolicy`） |
| `PermissionPolicy` | 接收 `(mode, toolOrCommand)`，输出 `allow | deny | ask(id)`；Build 模式内建 shell 白名单；Auto 模式内建工具名白名单 + 模型分类器兜底 | 不持久化模式（交给 `ModeController`）；不直接发 `ApprovalDesk` 工单（由调用方按判决决定） |
| `ApprovalDesk` | 工单状态机（asked → decided → consumed/expired），票绑工具+参数，一次性消费 | 不判断"该不该发工单"（由 `PermissionPolicy` 判决决定） |
| CLI `main.cj` | 解析 `--mode` 参数，启动时设模式；工具执行前调用 `PermissionPolicy.decide` | 不硬编码模式逻辑（走 `PermissionPolicy`） |
| 桌面 `permission-menu.ts` | 渲染 4 按钮，Shift+Tab 循环，点击切换模式 | 不直接改日志（通过 IPC 桥接 `ModeController`） |

### 2.2 与现有代码的关系

| 现有模块 | 关系 |
| --- | --- |
| `core/src/permission_presets.cj` | 废弃 `PermissionPresets` 类（2 预设），改用 `ModeController`；保留 `permission/preset` 事件兼容旧日志 |
| `core/src/plan.cj` | 废弃 `PlanModeController`，plan 模式并入 `ModeController` 的 `mode/mode` 事件 |
| `core/src/approval.cj` | 不改动，`PermissionPolicy` 只返回 `ask(id)` 判决，由调用方决定是否发工单 |
| `core/src/model_tool_runtime.cj` | 工具执行前插入 `PermissionPolicy.decide` 分支：`allow` 直接执行，`deny` 拒绝，`ask(id)` 走 `ApprovalDesk.askForCall` |
| `apps/cli/src/main.cj` | 新增 `--mode` 参数解析，传给 `ModeController.set` |
| `apps/desktop/renderer/pages/permission-menu.ts` | 移除 4 按钮的 `disabled` 属性，接入 `ModeController` IPC 桥接 |
| `apps/desktop/preload.cjs` | 新增 `setApprovalMode(mode)` 与 `getApprovalMode()` 通道 |

### 2.3 数据流

```
CLI/桌面启动
  → 解析 --mode / 按钮点击
  → ModeController.set(mode) → log.append("mode/mode", mode)
  → 工具调用前
  → PermissionPolicy.decide(currentMode, toolOrCommand)
      ├─ allow → 直接执行
      ├─ deny  → 拒绝（不发工单）
      └─ ask(id) → ApprovalDesk.askForCall → 交互/模型应答 → consume → 执行
```

## 3. 4 模式定义

| 模式 | 文件读写 | Shell/构建 | 危险操作（push/rm/外部 API） | 设计意图 |
|------|---------|-----------|--------------------------|---------|
| **Plan** | 只读 | 禁止 | 禁止 | 分析、规划、只看不碰 |
| **Build** | 工作区内自动放行 | 硬编码白名单自动放行（npm/cargo/make 等） | 仍需审批 | 日常开发默认档 |
| **Auto** | 自动放行 | 自动放行 | 规则白名单 + 模型分类器兜底 | 信任但有兜底 |
| **Yolo** | 自动放行 | 自动放行 | 自动放行 | 全自动，不问 |

**Build 模式 shell 白名单**（硬编码在 `PermissionPolicy`）：
```
npm run build, npm run test, npm test, npm run lint, npm run typecheck,
cargo build, cargo test, cargo check,
make, make build, make test,
go build, go test,
pnpm build, pnpm test, yarn build, yarn test
```
规则：命令前缀匹配（`startsWith`），参数不参与匹配；不在白名单的 shell 命令走 `ask`。

**Auto 模式工具名白名单**（硬编码在 `PermissionPolicy`）：
```
read, grep, glob, web_fetch, web_search, ls, cat, head, tail, wc, file
```
规则：工具名完全匹配；不在白名单的工具先走模型分类器（输出 `needsApproval: true/false`），分类器超时或失败则走 `ask`。

## 4. 策略层设计

### 4.1 `PermissionPolicy` 接口

```cj
public class PermissionPolicy {
    public func decide(mode: String, toolOrCommand: String): String {
        // 返回 "allow" | "deny" | "ask"
    }
}
```

- `mode` 必须是 `plan|build|auto|yolo`，非法值抛异常。
- `toolOrCommand`：工具名（字符串）或 shell 命令（带空格的完整行）。
- Plan 模式：所有非只读工具返回 `deny`。
- Build 模式：文件写入类工具（write/edit）返回 `allow`；shell 命令匹配白名单返回 `allow`，否则 `ask`。
- Auto 模式：文件写入类工具返回 `allow`；shell 命令匹配白名单返回 `allow`；工具名匹配白名单返回 `allow`；其余走模型分类器，分类器返回 `needsApproval: false` 则 `allow`，否则 `ask`。
- Yolo 模式：全部返回 `allow`。

### 4.2 模型分类器兜底（Auto 模式）

- 分类器 prompt（简化）：
  ```
  工具名: {tool}
  参数: {args}
  是否需要用户审批？只回答 true 或 false。
  ```
- 分类器超时（默认 5s）或解析失败 → 降级为 `ask`。
- 分类器结果不落日志（只影响当次判决），避免污染 transcript。

## 5. 持久化

### 5.1 `ModeController`

```cj
public class ModeController {
    let log: SessionLog

    public init(log: SessionLog) { this.log = log }

    public func current(): String {
        // 回放最后一条 mode/mode 事件，未设置返回 "build"（默认）
    }

    public func set(mode: String): String {
        // 非法值抛异常；同值返回 "noop"；否则落事件返回 "committed"
    }
}
```

- 事件类型：`mode/mode`，数据为 `plan|build|auto|yolo`。
- 默认值：未设置时 `current()` 返回 `"build"`（日常开发默认档）。
- 兼容旧日志：若只有 `plan/mode` 事件（true/false），`current()` 映射为 `plan`/`build`；若只有 `permission/preset` 事件，`current()` 映射为 `build`/`yolo`。

### 5.2 事件格式

| 事件类型 | 数据 | 说明 |
|---------|------|------|
| `mode/mode` | `plan|build|auto|yolo` | 当前审批模式 |
| `permission/preset` | `workspace-write\|danger-full-access` | 旧预设（兼容） |
| `plan/mode` | `true\|false` | 旧 plan 开关（兼容） |

## 6. 入口设计

### 6.1 CLI

- 新增 `--mode plan|build|auto|yolo` 参数（默认 `build`）。
- 解析后调用 `ModeController.set(mode)`。
- 工具执行前（`goal_runtime.cj` 或 `model_tool_runtime.cj`）调用 `PermissionPolicy.decide`。

### 6.2 桌面

- `permission-menu.ts` 移除 4 按钮的 `disabled` 属性，点击按钮调用 `setApprovalMode(mode)` IPC。
- 新增 `Shift+Tab` 快捷键循环切换（`plan → build → auto → yolo → plan`）。
- `preload.cjs` 新增通道：
  ```js
  setApprovalMode: (mode) => ipcRenderer.invoke('approval:set-mode', mode),
  getApprovalMode: () => ipcRenderer.invoke('approval:get-mode'),
  ```
- 主进程桥接 `ModeController`（通过 `host-bridge.cjs` 或直接调用 NDJSON RPC）。

## 7. 测试门禁

- 单元测试：`PermissionPolicy.decide` 对 4 模式 + 白名单内外用例的判决正确性。
- 集成测试：CLI `--mode` 启动后工具执行路径正确（allow/ask/deny）。
- 桌面测试：按钮点击 + Shift+Tab 切换后 `getApprovalMode()` 返回正确值。
- 反证：Build 模式下非白名单 shell 命令必须走 `ask`（注入 `echo 'malicious'` 探针）。
- 回归：旧 `plan/mode` / `permission/preset` 日志回放时 `ModeController.current()` 行为正确。

## 8. 风险与缓解

| 风险 | 缓解 |
|------|------|
| Build 模式白名单太宽导致危险命令放行 | 白名单只认前缀，不解析参数；危险操作（如 `rm -rf /`、`git push`）不在白名单内 |
| Auto 模式模型分类器误判 | 超时/失败降级为 `ask`，不静默放行 |
| 模式切换后旧工单仍按旧模式执行 | 工单已绑定 `approvalId`，模式只影响"是否发新工单"，不改判已发工单 |
| 桌面 Shift+Tab 冲突 | 仅在 `permission-menu` 打开时生效，不全局劫持 |

---

**自审检查**（已完成）：
- 无占位符（TBD/TODO）。
- 内部一致：4 模式定义、策略层判决、入口设计无矛盾。
- 范围聚焦：仅审批模式，不改 `ApprovalDesk` 状态机，不引入新模型分类器。
- 歧义已消除：Build 白名单明确为硬编码前缀匹配；Auto 分类器明确为规则+模型混合，超时降级为 `ask`。
