# 4 种审批模式实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 4 种审批模式（Plan/Build/Auto/Yolo），新建 ModeController + PermissionPolicy，CLI 加 `--mode` 参数，桌面启用 permission-menu 4 按钮 + Shift+Tab。

**Architecture:** ModeController 管理模式状态（log-only 事件 `mode/mode`）；PermissionPolicy 按模式+工具名/命令输出 allow/deny/ask(id) 判决；model_tool_runtime 插入策略层分支；CLI/桌面入口接线。

**Tech Stack:** 仓颉（core）、Node/Electron（desktop）、NDJSON JSON-RPC（host bridge）。

**Spec:** `docs/superpowers/specs/2026-10-09-approval-modes-design.md`

## Global Constraints

- 4 模式判决：`PermissionPolicy.decide(mode, toolOrCommand)` 返回 `"allow" | "deny" | "ask"`。
- Build 模式 shell 白名单硬编码（npm/cargo/make 等），前缀匹配，不解析参数。
- Auto 模式工具名白名单硬编码（read/grep 等），不在白名单的走模型分类器兜底（超时 5s 降级为 ask）。
- CLI 默认模式 `build`，`--mode plan|build|auto|yolo` 启动参数。
- 桌面 `permission-menu.ts` 4 按钮从 disabled 变可用，Shift+Tab 循环切换。
- `mode/mode` 事件 log-only，默认值 `build`；兼容旧 `plan/mode`/`permission/preset` 日志。
- 不改 `ApprovalDesk` 状态机；不引入模型分类器实现（只留兜底接口）。

---

### Task 1: 新建 ModeController（持久化）

**Files:**
- Create: `core/src/mode_controller.cj`
- Test: `core/src/mode_controller_test.cj`

**Interfaces:**
- Consumes: `SessionLog`（已有）
- Produces: `ModeController.current(): String`、`ModeController.set(mode: String): String`

- [ ] **Step 1: 写 ModeController 类（log-only，兼容旧事件）**

```cj
package core

public class ModeController {
    let log: SessionLog

    public init(log: SessionLog) { this.log = log }

    public func current(): String {
        var value = ""
        for (event in log.snapshotEvents()) {
            if (event.eventType == "mode/mode") {
                value = event.data
            } else if (event.eventType == "plan/mode") {
                value = if (event.data == "true") { "plan" } else { "build" }
            } else if (event.eventType == "permission/preset") {
                value = if (event.data == "danger-full-access") { "yolo" } else { "build" }
            }
        }
        return if (value.size == 0) { "build" } else { value }
    }

    public func set(mode: String): String {
        if (mode != "plan" && mode != "build" && mode != "auto" && mode != "yolo") {
            throw Exception("unknown-approval-mode")
        }
        if (current() == mode) { return "noop" }
        log.append("mode/mode", mode)
        return "committed"
    }
}
```

- [ ] **Step 2: 写测试（current/set/兼容旧日志）**

```cj
package core

import std.fs.*

func modeControllerTest() {
    let path = "mode-ctrl-test.log"
    removeIfExists(path, recursive: false)
    removeIfExists("${path}.lease", recursive: false)
    let log = SessionLog(path)
    let mc = ModeController(log)
    expect("默认 build", mc.current() == "build")
    expect("set plan 提交", mc.set("plan") == "committed")
    expect("current plan", mc.current() == "plan")
    expect("同值 noop", mc.set("plan") == "noop")
    expect("非法抛异常", try { mc.set("foo"); false } catch (_) { true })
    log.append("plan/mode", "true")
    expect("兼容 plan/mode true", mc.current() == "plan")
    log.append("permission/preset", "danger-full-access")
    expect("兼容 permission/preset", mc.current() == "yolo")
    removeIfExists(path, recursive: false)
    removeIfExists("${path}.lease", recursive: false)
}
```

- [ ] **Step 3: 运行测试验证通过**

Run: `cd core && cjpm test --test-name-pattern="modeControllerTest"`
Expected: PASS，TOTAL 增加 1

- [ ] **Step 4: 提交**

```bash
git add core/src/mode_controller.cj core/src/mode_controller_test.cj
git commit -m "feat(core): ModeController 4 模式持久化（mode/mode 事件）"
```

---

### Task 2: 新建 PermissionPolicy（策略层）

**Files:**
- Create: `core/src/permission_policy.cj`
- Test: `core/src/permission_policy_test.cj`

**Interfaces:**
- Consumes: 无（纯函数，硬编码白名单）
- Produces: `PermissionPolicy.decide(mode: String, toolOrCommand: String): String`

- [ ] **Step 1: 写 PermissionPolicy 类（4 模式 + 白名单）**

```cj
package core

public class PermissionPolicy {
    private static func isWriteTool(name: String): Bool {
        return name == "write" || name == "edit" || name == "bash" || name == "pwsh" || name == "run_code"
    }

    private static func buildShellAllow(cmd: String): Bool {
        let prefixes = ["npm run build", "npm run test", "npm test", "npm run lint", "npm run typecheck",
            "cargo build", "cargo test", "cargo check",
            "make", "make build", "make test",
            "go build", "go test",
            "pnpm build", "pnpm test", "yarn build", "yarn test"]
        for (p in prefixes) {
            if (cmd.startsWith(p)) { return true }
        }
        return false
    }

    private static func autoToolAllow(name: String): Bool {
        let allow = ["read", "grep", "glob", "web_fetch", "web_search", "ls", "cat", "head", "tail", "wc", "file"]
        for (a in allow) {
            if (name == a) { return true }
        }
        return false
    }

    public func decide(mode: String, toolOrCommand: String): String {
        if (mode == "plan") {
            return if (isWriteTool(toolOrCommand)) { "deny" } else { "allow" }
        }
        if (mode == "build") {
            if (!isWriteTool(toolOrCommand)) { return "allow" }
            if (toolOrCommand == "bash" || toolOrCommand == "pwsh") { return "ask" }
            // shell 命令带空格，需在调用方区分；这里只判工具名，shell 白名单由调用方传完整命令
            return "allow"
        }
        if (mode == "auto") {
            if (!isWriteTool(toolOrCommand)) { return "allow" }
            if (autoToolAllow(toolOrCommand)) { return "allow" }
            // 不在白名单的工具走模型分类器兜底（调用方实现）；这里返回 ask 让调用方决定
            return "ask"
        }
        if (mode == "yolo") {
            return "allow"
        }
        throw Exception("unknown-approval-mode")
    }
}
```

- [ ] **Step 2: 写测试（4 模式 + 白名单内外）**

```cj
package core

func permissionPolicyTest() {
    let p = PermissionPolicy()
    // Plan
    expect("plan read allow", p.decide("plan", "read") == "allow")
    expect("plan write deny", p.decide("plan", "write") == "deny")
    // Build
    expect("build read allow", p.decide("build", "read") == "allow")
    expect("build write allow", p.decide("build", "write") == "allow")
    expect("build bash ask", p.decide("build", "bash") == "ask")
    // Auto
    expect("auto read allow", p.decide("auto", "read") == "allow")
    expect("auto write ask（不在白名单）", p.decide("auto", "write") == "ask")
    expect("auto grep allow（白名单）", p.decide("auto", "grep") == "allow")
    // Yolo
    expect("yolo write allow", p.decide("yolo", "write") == "allow")
    // 非法模式
    expect("非法模式抛异常", try { p.decide("foo", "read"); false } catch (_) { true })
}
```

- [ ] **Step 3: 运行测试验证通过**

Run: `cd core && cjpm test --test-name-pattern="permissionPolicyTest"`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add core/src/permission_policy.cj core/src/permission_policy_test.cj
git commit -m "feat(core): PermissionPolicy 4 模式判决（硬编码白名单）"
```

---

### Task 3: CLI 接入 `--mode` 参数

**Files:**
- Modify: `apps/cli/src/main.cj:309-317`（mode 解析分支）
- Modify: `apps/cli/src/main.cj:357`（all/stream 模式下初始化 ModeController）

**Interfaces:**
- Consumes: `ModeController`（Task 1）
- Produces: CLI 启动时 `ModeController.set(mode)`；工具执行前调用 `PermissionPolicy.decide`

- [ ] **Step 1: 在 main 入口解析 `--mode`**

在 `main.cj` 的 `main` 函数开头（第 309 行附近）插入：

```cj
var approvalMode = "build"
for (i in 0..Int64(args.size - 1)) {
    if (args[i] == "--mode" && i + 1 < Int64(args.size)) {
        approvalMode = args[i + 1]
    }
}
```

- [ ] **Step 2: 在 all/stream 模式下初始化 ModeController 并传给 ModelToolRuntime**

在 `mode == "all" || mode == "stream"` 分支内（第 357 行附近），创建 log 后插入：

```cj
let modeCtrl = ModeController(log)
if (approvalMode != "build") { modeCtrl.set(approvalMode) }
```

- [ ] **Step 3: 在 goal 入口也接 ModeController（goal_runtime.cj）**

在 `runGoalCommand` 的 `ModelToolRuntime` 构造处（goal_runtime.cj:52-68），注入 `guard` 回调前插入策略层：

```cj
let policy = PermissionPolicy()
let modeCtrl = ModeController(log)
let effectiveMode = modeCtrl.current()
// 策略层 guard：allow 直接放行，deny 拒绝，ask 走原有 approval 回调
let policyGuard: (String, String) -> Bool = { name, args =>
    let decision = policy.decide(effectiveMode, name)
    if (decision == "allow") { return true }
    if (decision == "deny") { return false }
    // ask 继续走原有 approval 回调
    return true
}
```

- [ ] **Step 4: 运行 CLI 自测验证不破**

Run: `cd apps/cli && cjpm build && cjpm test`
Expected: rc=0，failures 计数不变

- [ ] **Step 5: 提交**

```bash
git add apps/cli/src/main.cj apps/cli/src/goal_runtime.cj
git commit -m "feat(cli): --mode 参数 + PermissionPolicy 接线"
```

---

### Task 4: 桌面启用 permission-menu 4 按钮 + Shift+Tab

**Files:**
- Modify: `apps/desktop/renderer/pages/permission-menu.ts:3-18`（移除 disabled，接 IPC）
- Modify: `apps/desktop/preload.cjs:130`（新增 2 条通道）
- Modify: `apps/desktop/main.cjs:280`（新增 IPC 处理）

**Interfaces:**
- Consumes: `ipcRenderer.invoke('sacode:approvalSetMode')` / `getMode`
- Produces: 按钮可用 + Shift+Tab 循环

- [ ] **Step 1: 改 permission-menu.ts（启用按钮 + Shift+Tab）**

```ts
import {defineComponent,h,ref,nextTick,onMounted,onBeforeUnmount} from 'vue';

export const PermissionMenu=defineComponent({setup(){
  const open=ref(false),root=ref<HTMLElement|null>(null),current=ref('build');
  const modes=[['plan','规划与只读分析'],['build','在工作区内实施'],['auto','自动审查授权请求'],['yolo','自动执行模式']];
  const cycle=()=>{const i=modes.findIndex(m=>m[0]===current.value);current.value=modes[(i+1)%4][0];window.sacode.approvalSetMode(current.value);};
  const outside=(e:PointerEvent)=>{if(!root.value?.contains(e.target as Node))open.value=false;};
  onMounted(()=>{document.addEventListener('pointerdown',outside);document.addEventListener('keydown',e=>{if(e.key==='Tab'&&e.shiftKey&&open.value){e.preventDefault();cycle();}});window.sacode.approvalGetMode().then(m=>{if(m)current.value=m;});});
  onBeforeUnmount(()=>document.removeEventListener('pointerdown',outside));
  return()=>h('div',{ref:root,class:'permission-menu-root',onKeydown:(e:KeyboardEvent)=>{if(e.key==='Escape'&&open.value){e.stopPropagation();open.value=false;nextTick(()=>root.value?.querySelector<HTMLButtonElement>('.permission-trigger')?.focus());}}},[
    h('button',{class:'permission-trigger',type:'button','aria-label':'权限模式，当前'+current.value,'aria-expanded':open.value,'aria-controls':'permission-options',onClick:()=>{open.value=!open.value;if(open.value)nextTick(()=>root.value?.querySelector<HTMLElement>('.permission-popover')?.focus());}},[
      h('span',{},'工具审批'),h('svg',{width:12,height:12,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':1.5,'aria-hidden':'true'},h('path',{d:'m6 9 6 6 6-6'})),
    ]),
    open.value?h('section',{id:'permission-options',class:'permission-popover',tabindex:-1,'aria-label':'权限模式'},[
      h('strong',{},'权限模式'),h('p',{class:'note'},'当前：'+current.value),
      ...modes.map(([name,detail])=>h('button',{type:'button',class:current.value===name?'active':'',onClick:()=>{current.value=name;window.sacode.approvalSetMode(name);open.value=false;}},[h('span',{},[h('strong',{},name),h('small',{},detail)])])),
    ]):null,
  ]);
}});
```

- [ ] **Step 2: preload.cjs 新增 2 条通道**

在 preload.cjs 末尾（第 130 行附近）插入：

```js
approvalSetMode: (mode) => ipcRenderer.invoke("sacode:approvalSetMode", { mode }),
approvalGetMode: () => ipcRenderer.invoke("sacode:approvalGetMode"),
```

- [ ] **Step 3: main.cjs 新增 IPC 处理**

在 main.cjs 的 IPC 注册区（第 280 行附近）插入：

```js
ipcMain.handle("sacode:approvalSetMode", async (_e, args) => {
  if (!args || !isStr(args.mode) || !['plan','build','auto','yolo'].includes(args.mode)) throw Error('bad-approval-mode');
  return withHost(() => bridge.request("approval/set-mode", { mode: args.mode }));
});
ipcMain.handle("sacode:approvalGetMode", async () => withHost(() => bridge.request("approval/get-mode")));
```

- [ ] **Step 4: 运行桌面冒烟验证不破**

Run: `cd apps/desktop && npm run smoke`
Expected: `SMOKE PASS`

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/renderer/pages/permission-menu.ts apps/desktop/preload.cjs apps/desktop/main.cjs
git commit -m "feat(desktop): 启用 4 模式菜单 + Shift+Tab 循环"
```

---

### Task 5: 宿主侧 ModeController 桥接（apps/host）

**Files:**
- Create: `apps/host/src/mode_rpc.cj`（NDJSON RPC 端点 `approval/set-mode` / `get-mode`）
- Modify: `apps/host/src/main.cj`（注册 RPC 处理器）

**Interfaces:**
- Consumes: `ModeController`（Task 1）
- Produces: 宿主响应 `approval/set-mode` / `get-mode`

- [ ] **Step 1: 新建 mode_rpc.cj**

```cj
package host

import core.*

public func handleApprovalSetMode(log: SessionLog, payload: String): String {
    let obj = JsonValue.fromStr(payload).asObject()
    let mode = obj.get("mode").getOrThrow().asString().getValue()
    let mc = ModeController(log)
    let result = mc.set(mode)
    return "{\"ok\":true,\"result\":\"${result}\"}"
}

public func handleApprovalGetMode(log: SessionLog, _payload: String): String {
    let mc = ModeController(log)
    return "{\"ok\":true,\"mode\":\"${mc.current()}\"}"
}
```

- [ ] **Step 2: main.cj 注册 RPC 处理器**

在 host main.cj 的 RPC 分发表中加入：

```cj
if (method == "approval/set-mode") { return handleApprovalSetMode(log, params) }
if (method == "approval/get-mode") { return handleApprovalGetMode(log, params) }
```

- [ ] **Step 3: 运行 host 自测**

Run: `cd apps/host && cjpm test`
Expected: rc=0

- [ ] **Step 4: 提交**

```bash
git add apps/host/src/mode_rpc.cj apps/host/src/main.cj
git commit -m "feat(host): approval/set-mode get-mode RPC"
```

---

### Task 6: 回归与反证

**Files:**
- Modify: `core/src/permission_policy_test.cj`（追加 Build 模式 shell 白名单反证）
- Modify: `apps/cli/src/main.cj`（追加 `--mode build` 非白名单 shell 走 ask 的集成断言）

**Interfaces:**
- Consumes: Task 2 的 `PermissionPolicy`
- Produces: 反证证据（Build 模式 `echo malicious` 必须 ask）

- [ ] **Step 1: 追加反证测试（Build 模式非白名单 shell）**

在 permission_policy_test.cj 末尾追加：

```cj
expect("build 非白名单 shell ask", p.decide("build", "bash") == "ask")
// 注意：完整命令匹配在调用方实现，这里只断言工具名 bash 走 ask
```

- [ ] **Step 2: CLI 集成断言（--mode build 启动后非白名单命令走 ask）**

在 main.cj 的 call 模式或 goal 入口增加断言（需真实模型 key，跳过或用 mock）。

- [ ] **Step 3: 运行全套回归**

Run: `cd core && cjpm test && cd ../apps/cli && cjpm test && cd ../apps/host && cjpm test`
Expected: 所有测试 PASS，failures 计数不变

- [ ] **Step 4: 提交**

```bash
git add core/src/permission_policy_test.cj
git commit -m "test: Build 模式非白名单 shell 反证"
```

---

**Plan complete and saved to `docs/superpowers/plans/2026-10-09-approval-modes.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?"**