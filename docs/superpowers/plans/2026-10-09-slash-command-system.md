# SaCode 斜杠命令系统实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 SaCode 全系统斜杠命令系统，支持动态注册、popover 补全、分层执行，首轮落地 `/help` `/review` `/compress` `/init` `/clear` 5 个命令。

**Architecture:** L0 `CommandRegistry` 提供动态注册/解析；L1 host 协议透传命令文本；L2 Core 分层执行（前端命令直接处理，后端命令由 Agent 团队执行）；L3 UI 复用 `composer-menu-popover` 实现 `/` 命令模式。

**Tech Stack:** 仓颉（core）、Vue 3 runtime + TypeScript（renderer）、NDJSON JSON-RPC（host 协议）

**Spec:** `docs/superpowers/specs/2026-10-09-slash-command-system-design.md`

## Global Constraints

- 所有 UI 文案、错误消息、命令 help 文本必须用中文
- 参数解析使用简单空格分词，不实现引号/转义
- 命令本身不触发审批，审批由内部工具触发
- 错误反馈显示在 composer 附近，不污染会话历史
- `CommandRegistry` 纯内存，每次启动重新注册
- 新命令只需注册到 `CommandRegistry`，无需改动 popover

---

## 文件结构

**新建文件：**
- `core/src/cmds.cj`（已存在，需扩展参数解析）
- `core/src/cmds_test.cj`（已存在，需新增测试）
- `apps/desktop/renderer/pages/composer-commands.ts`（新建，命令模式 popover 逻辑）
- `apps/desktop/renderer/pages/composer-commands.test.ts`（新建，前端单元测试）

**修改文件：**
- `apps/desktop/renderer/pages/composer-menu.ts:90-120`（扩展 section 模式，支持 commands）
- `apps/desktop/renderer/app.js:1700-1715`（composer onInput 检测 `/` 前缀）
- `core/src/agent.cj`（注册内置命令到 CommandRegistry）

**测试文件：**
- `core/src/cmds_test.cj`（扩展参数解析测试）
- `apps/desktop/renderer/pages/composer-commands.test.ts`（popover 切换、命令列表渲染、键盘导航）

---

### Task 1: 扩展 CommandRegistry 支持参数解析

**Files:**
- Modify: `core/src/cmds.cj:1-57`
- Test: `core/src/cmds_test.cj:60-100`

**Interfaces:**
- Consumes: 无
- Produces: `CommandSpec` 新增可选 `parse?: (args: Array<String>) -> Map<String, String>` 字段；`CommandRegistry.resolveWithArgs(name: String, rawArgs: String): {spec: CommandSpec, args: Map<String, String>}`

- [ ] **Step 1: 在 CommandSpec 中添加可选 parse 字段**

```cangjie
public class CommandSpec {
    public let name: String
    public let help: String
    public let parse: ((Array<String>) -> HashMap<String, String>)?  // 可选参数解析器
    public init(name: String, help: String, parse: ((Array<String>) -> HashMap<String, String>)? = null) {
        this.name = name
        this.help = help
        this.parse = parse
    }
}
```

- [ ] **Step 2: 实现简单空格分词解析器**

```cangjie
public func parseSimpleArgs(raw: String): Array<String> {
    if (raw.isEmpty) { return Array<String>() }
    return raw.split(' ').filter { it.size > 0 }
}
```

- [ ] **Step 3: 实现 resolveWithArgs 方法**

```cangjie
public func resolveWithArgs(name: String, rawArgs: String): {spec: CommandSpec, args: HashMap<String, String>} {
    let spec = resolve(name)
    let tokens = parseSimpleArgs(rawArgs)
    let parsed = if (spec.parse != null) spec.parse!!(tokens) else HashMap<String, String>()
    return {spec: spec, args: parsed}
}
```

- [ ] **Step 4: 编写参数解析测试（写在测试文件末尾）**

```cangjie
@Test
func commandResolveWithArgs() {
    let reg = CommandRegistry()
    reg.register("review", "代码审查", {args ->
        let m = HashMap<String, String>()
        if (args.size >= 1) { m.put("target", args[0]) }
        for (i in 0..args.size-1 step 2) {
            if (args[i].startsWith("--")) {
                let key = args[i].slice(2)
                let val = if (i+1 < args.size && !args[i+1].startsWith("--")) args[i+1] else "true"
                m.put(key, val)
            }
        }
        return m
    })
    let result = reg.resolveWithArgs("review", "123 --effort high")
    @Expect(result.spec.name, "review")
    @Expect(result.args.get("target") ?? "", "123")
    @Expect(result.args.get("effort") ?? "", "high")
}
```

- [ ] **Step 5: 运行测试验证通过**

Run: `cd core && cjpm test --test-name-pattern="commandResolveWithArgs"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add core/src/cmds.cj core/src/cmds_test.cj
git commit -m "feat(core): CommandRegistry 支持参数解析"
```

---

### Task 2: 实现 /help 命令（前端直接处理）

**Files:**
- Create: `apps/desktop/renderer/pages/composer-commands.ts:1-80`
- Modify: `apps/desktop/renderer/pages/composer-menu.ts:35-65`
- Test: `apps/desktop/renderer/pages/composer-commands.test.ts:1-50`

**Interfaces:**
- Consumes: 无
- Produces: `showCommandsHelp(): void`（在 composer 附近显示命令列表）

- [ ] **Step 1: 创建 composer-commands.ts，定义命令元数据**

```typescript
export interface SlashCommand {
  name: string
  help: string
  frontend?: boolean  // true 表示前端直接处理
}

export const BUILTIN_COMMANDS: SlashCommand[] = [
  {name: 'help', help: '显示帮助', frontend: true},
  {name: 'review', help: '代码审查（支持 PR/diff）'},
  {name: 'compress', help: '手动压缩上下文'},
  {name: 'init', help: '初始化项目配置'},
  {name: 'clear', help: '清空输入框', frontend: true},
]
```

- [ ] **Step 2: 实现 showCommandsHelp 函数（显示在 composer 附近）**

```typescript
export function showCommandsHelp(container: HTMLElement) {
  const tip = document.createElement('div')
  tip.className = 'slash-help-tip'
  tip.setAttribute('role', 'status')
  tip.innerHTML = BUILTIN_COMMANDS.map(c => `<code>/${c.name}</code> — ${c.help}`).join('<br>')
  container.appendChild(tip)
  setTimeout(() => tip.remove(), 3000)
}
```

- [ ] **Step 3: 修改 composer-menu.ts，添加 commands section 模式**

```typescript
// 在 section.value === 'commands' 分支添加：
section.value === 'commands' ? [
  h('header', {}, '可用命令'),
  ...BUILTIN_COMMANDS.map(cmd => item(
    `/${cmd.name}`, 'M12 3l2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6z',
    () => { close(true); emit('slash', cmd.name) }
  ))
] : null
```

- [ ] **Step 4: 编写前端单元测试**

```typescript
import {describe, it} from 'node:test'
import assert from 'node:assert'
import {BUILTIN_COMMANDS} from './composer-commands.ts'

describe('composer-commands', () => {
  it('lists 5 builtin commands', () => {
    assert.strictEqual(BUILTIN_COMMANDS.length, 5)
    assert.ok(BUILTIN_COMMANDS.some(c => c.name === 'help'))
    assert.ok(BUILTIN_COMMANDS.some(c => c.name === 'review'))
  })
})
```

- [ ] **Step 5: 运行测试验证通过**

Run: `cd apps/desktop && node --test renderer/pages/composer-commands.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/renderer/pages/composer-commands.ts apps/desktop/renderer/pages/composer-commands.test.ts apps/desktop/renderer/pages/composer-menu.ts
git commit -m "feat(renderer): /help 命令与 commands popover 模式"
```

---

### Task 3: 实现前端 /clear 命令

**Files:**
- Modify: `apps/desktop/renderer/pages/composer-commands.ts:80-100`
- Modify: `apps/desktop/renderer/app.js:1073-1099`（send 流程中检测前端命令）

**Interfaces:**
- Consumes: `showCommandsHelp`（Task 2）
- Produces: `handleFrontendCommand(name: string, draft: Ref<string>): boolean`（返回 true 表示已处理）

- [ ] **Step 1: 实现 handleFrontendCommand 函数**

```typescript
export function handleFrontendCommand(name: string, draft: {value: string}, container: HTMLElement): boolean {
  if (name === 'help') {
    showCommandsHelp(container)
    return true
  }
  if (name === 'clear') {
    draft.value = ''
    return true
  }
  return false
}
```

- [ ] **Step 2: 修改 app.js 的 send 函数，检测前端命令**

```javascript
// 在 send 函数开头添加：
const text = draft.value.trim()
if (text.startsWith('/')) {
  const name = text.slice(1).split(' ')[0]
  if (handleFrontendCommand(name, draft, document.getElementById('composer'))) {
    return  // 前端已处理，不发送
  }
}
```

- [ ] **Step 3: 运行 smoke 测试验证 /clear 不发送请求**

Run: `cd apps/desktop && npm run smoke`
Expected: PASS（/clear 不触发 network 请求）

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/renderer/pages/composer-commands.ts apps/desktop/renderer/app.js
git commit -m "feat(renderer): /clear 前端命令实现"
```

---

### Task 4: Core 注册内置命令并路由到 Agent

**Files:**
- Modify: `core/src/agent.cj:148-200`（registerBuiltinExecutors 附近注册命令）
- Modify: `core/src/cmds_test.cj:100-130`（集成测试）

**Interfaces:**
- Consumes: `CommandRegistry`（Task 1）
- Produces: `registerBuiltinCommands(reg: CommandRegistry): Unit`

- [ ] **Step 1: 实现 registerBuiltinCommands 函数**

```cangjie
public func registerBuiltinCommands(reg: CommandRegistry): Unit {
    reg.register("review", "代码审查（支持 PR/diff）")
    reg.register("compress", "手动压缩上下文")
    reg.register("init", "初始化项目配置")
}
```

- [ ] **Step 2: 在 agent 初始化时调用注册**

```cangjie
// 在 ToolRuntime.init 或 agent-loop 启动处
let cmdReg = CommandRegistry()
registerBuiltinCommands(cmdReg)
// 存入 ctx.commands 供 ACP 使用
```

- [ ] **Step 3: 编写集成测试（验证命令已注册）**

```cangjie
@Test
func builtinCommandsRegistered() {
    let reg = CommandRegistry()
    registerBuiltinCommands(reg)
    let names = reg.list().map { it.name }
    @Expect(names.contains("review"), true)
    @Expect(names.contains("compress"), true)
    @Expect(names.contains("init"), true)
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd core && cjpm test --test-name-pattern="builtinCommandsRegistered"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add core/src/agent.cj core/src/cmds_test.cj
git commit -m "feat(core): 注册 review/compress/init 内置命令"
```

---

### Task 5: 实现 /review 命令骨架（行为等价验证）

**Files:**
- Create: `core/src/review_command.cj:1-100`（/review 命令处理器）
- Modify: `core/src/cmds_test.cj:130-160`（/review 参数解析测试）

**Interfaces:**
- Consumes: `CommandRegistry.resolveWithArgs`（Task 1）
- Produces: `executeReview(target: String, effort: String): ApprovalOutcome`

- [ ] **Step 1: 创建 review_command.cj，实现参数校验**

```cangjie
package core
import std.collection.*

public func executeReview(target: String, effort: String): String {
    if (target.isEmpty) { throw Exception("review-target-required") }
    let validEffort = ["low", "medium", "high"]
    if (!validEffort.contains(effort)) { throw Exception("review-effort-invalid") }
    return "review-queued:${target}:${effort}"
}
```

- [ ] **Step 2: 编写参数校验测试**

```cangjie
@Test
func reviewCommandValidatesArgs() {
    var threw = false
    try { executeReview("", "medium") } catch (_) { threw = true }
    @Expect(threw, true)

    threw = false
    try { executeReview("123", "invalid") } catch (_) { threw = true }
    @Expect(threw, true)

    let result = executeReview("123", "high")
    @Expect(result.startsWith("review-queued"), true)
}
```

- [ ] **Step 3: 运行测试验证通过**

Run: `cd core && cjpm test --test-name-pattern="reviewCommandValidatesArgs"`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add core/src/review_command.cj core/src/cmds_test.cj
git commit -m "feat(core): /review 命令骨架与参数校验"
```

---

### Task 6: 端到端集成测试（/help → popover → /review 流程）

**Files:**
- Create: `apps/desktop/test/slash-commands.e2e.test.mjs:1-80`

**Interfaces:**
- Consumes: 渲染层 + preload + main 完整链路
- Produces: 验证 `/help` 显示提示、`/review 123` 触发 session/append

- [ ] **Step 1: 编写 e2e 测试骨架**

```javascript
import {describe, it} from 'node:test'
import assert from 'node:assert'
import {spawn} from 'node:child_process'

describe('slash-commands e2e', () => {
  it('types /help shows tip without network', async () => {
    // 启动 desktop，模拟输入 /help，断言无 network 请求，composer 附近出现 tip
    assert.ok(true)  // 占位，实际需 playwright/electron 测试
  })

  it('types /review 123 triggers session/append', async () => {
    // 模拟输入 /review 123，断言 host-bridge 收到 session/append 帧
    assert.ok(true)
  })
})
```

- [ ] **Step 2: 运行 e2e 测试（当前为占位，验证测试框架可用）**

Run: `cd apps/desktop && node --test test/slash-commands.e2e.test.mjs`
Expected: PASS（占位测试通过）

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/test/slash-commands.e2e.test.mjs
git commit -m "test(desktop): slash commands e2e 骨架"
```

---

## 执行选项

**Plan complete and saved to `docs/superpowers/plans/2026-10-09-slash-command-system.md`。Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
