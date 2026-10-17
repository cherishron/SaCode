# Task 5 Brief: 实现 /review 命令骨架

**Plan**: `docs/superpowers/plans/2026-10-09-slash-command-system.md`
**Task**: Task 5
**Spec**: `docs/superpowers/specs/2026-10-09-slash-command-system-design.md` §4.5, §9

---

## 要求（逐字引用）

### Global Constraints（必须遵守）
- 所有 UI 文案、错误消息、命令 help 文本必须用中文
- 参数解析使用简单空格分词，不实现引号/转义
- 命令本身不触发审批，审批由内部工具触发
- 错误反馈显示在 composer 附近，不污染会话历史
- `CommandRegistry` 纯内存，每次启动重新注册
- 新命令只需注册到 `CommandRegistry`，无需改动 popover

### Task 5 具体要求

**Files:**
- Modify: `core/src/agent.cj:200-250`（添加 review 命令执行器）
- Modify: `core/src/cmds_test.cj:130-160`（review 命令测试）

**Interfaces:**
- Consumes: `CommandRegistry`（已注册 review）
- Produces: `executeReview(target: String, args: Map<String, String>): Unit` 骨架（仅打印/记录，不真正执行审查）

**步骤（必须逐个执行）：**

- [ ] **Step 1: 在 agent.cj 中添加 review 命令执行器骨架**

```cangjie
public func executeReview(target: String, args: HashMap<String, String>): Unit {
    // TODO: 实际审查逻辑（读取文件、调用 LLM、生成报告）
    // 当前仅记录命令调用，供后续扩展
    println("review command invoked: target=${target}, args=${args}")
}
```

- [ ] **Step 2: 在命令分发处挂接 review 执行器**

在 agent 命令处理循环中添加：

```cangjie
if (cmd.name == "review") {
    let target = args.get("target") ?? ""
    executeReview(target, args)
}
```

- [ ] **Step 3: 编写测试验证 review 命令可解析并分发**

```cangjie
@Test
func reviewCommandDispatched() {
    let reg = CommandRegistry()
    registerBuiltinCommands(reg)
    let result = reg.resolveWithArgs("review", "src/main.cj --effort high")
    @Expect(result.spec.name, "review")
    @Expect(result.args.get("target") ?? "", "src/main.cj")
    @Expect(result.args.get("effort") ?? "", "high")
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd core && cjpm test --test-name-pattern="reviewCommandDispatched"`
Expected: PASS（若 BASE 编译通过）

- [ ] **Step 5: Commit**

```bash
git add core/src/agent.cj core/src/cmds_test.cj
git commit -m "feat(core): /review 命令骨架实现"
```

**验收标准**：
- review 命令已注册并可通过 resolveWithArgs 解析带参调用
- executeReview 骨架存在（可后续替换为真实审查逻辑）
- 所有 commit 消息为中文
- 代码符合 Global Constraints

**Report file**: `task-5-report.md`（写入完整报告后返回）
