# Task 4 Brief: Core 注册内置命令并路由到 Agent

**Plan**: `docs/superpowers/plans/2026-10-09-slash-command-system.md`
**Task**: Task 4
**Spec**: `docs/superpowers/specs/2026-10-09-slash-command-system-design.md` §4.4, §8

---

## 要求（逐字引用）

### Global Constraints（必须遵守）
- 所有 UI 文案、错误消息、命令 help 文本必须用中文
- 参数解析使用简单空格分词，不实现引号/转义
- 命令本身不触发审批，审批由内部工具触发
- 错误反馈显示在 composer 附近，不污染会话历史
- `CommandRegistry` 纯内存，每次启动重新注册
- 新命令只需注册到 `CommandRegistry`，无需改动 popover

### Task 4 具体要求

**Files:**
- Modify: `core/src/agent.cj:148-200`（registerBuiltinExecutors 附近注册命令）
- Modify: `core/src/cmds_test.cj:100-130`（集成测试）

**Interfaces:**
- Consumes: `CommandRegistry`（Task 1）
- Produces: `registerBuiltinCommands(reg: CommandRegistry): Unit`

**步骤（必须逐个执行）：**

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

**验收标准**：
- `cjpm test --test-name-pattern="builtinCommandsRegistered"` → PASS
- 所有 commit 消息为中文
- 代码符合 Global Constraints
- 命令已注册到 CommandRegistry，help 文本为中文

**Report file**: `task-4-report.md`（写入完整报告后返回）
