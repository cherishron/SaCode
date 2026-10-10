# Task 6 Brief: 端到端集成测试

**Plan**: `docs/superpowers/plans/2026-10-09-slash-command-system.md`
**Task**: Task 6
**Spec**: `docs/superpowers/specs/2026-10-09-slash-command-system-design.md` §10

---

## 要求（逐字引用）

### Global Constraints（必须遵守）
- 所有 UI 文案、错误消息、命令 help 文本必须用中文
- 参数解析使用简单空格分词，不实现引号/转义
- 命令本身不触发审批，审批由内部工具触发
- 错误反馈显示在 composer 附近，不污染会话历史
- `CommandRegistry` 纯内存，每次启动重新注册
- 新命令只需注册到 `CommandRegistry`，无需改动 popover

### Task 6 具体要求

**Files:**
- Modify: `core/src/cmds_test.cj:160-200`（端到端集成测试）
- Modify: `apps/desktop/test/composer-commands.test.mjs`（前端端到端测试）

**Interfaces:**
- Consumes: 所有前序任务的产物

**步骤（必须逐个执行）：**

- [ ] **Step 1: Core 端集成测试（命令注册 → 解析 → 分发）**

```cangjie
@Test
func slashCommandE2E() {
    let reg = CommandRegistry()
    registerBuiltinCommands(reg)
    
    // 验证 5 个命令全部已注册
    @Expect(reg.list().size, Int64(3))  // review, compress, init
    
    // 验证 review 带参解析
    let reviewResult = reg.resolveWithArgs("review", "src/main.cj --effort high")
    @Expect(reviewResult.spec.name, "review")
    
    // 验证 compress 无参解析
    let compressResult = reg.resolveWithArgs("compress", "")
    @Expect(compressResult.spec.name, "compress")
    @Expect(compressResult.args.size(), Int64(0))
    
    // 验证 init 无参解析
    let initResult = reg.resolveWithArgs("init", "")
    @Expect(initResult.spec.name, "init")
    
    // 验证未注册命令被拒
    var threw = false
    try {
        reg.resolve("ghost")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
}
```

- [ ] **Step 2: 前端端集成测试（命令列表 → popover → 选中 → 执行）**

在 `composer-commands.test.mjs` 中新增：

```javascript
describe('slash command e2e', () => {
  it('should list all 5 builtin commands', () => {
    assert.strictEqual(BUILTIN_COMMANDS.length, 5)
  })
  
  it('should have help text in Chinese for all commands', () => {
    for (const cmd of BUILTIN_COMMANDS) {
      assert.ok(cmd.help.length > 0)
    }
  })
  
  it('clear command is frontend only', () => {
    const clear = BUILTIN_COMMANDS.find(c => c.name === 'clear')
    assert.ok(clear.frontendOnly)
  })
  
  it('help command is frontend only', () => {
    const help = BUILTIN_COMMANDS.find(c => c.name === 'help')
    assert.ok(help.frontendOnly)
  })
})
```

- [ ] **Step 3: 运行所有测试**

Run Core: `cd core && cjpm test`
Run Frontend: `cd apps/desktop && node --test test/composer-commands.test.mjs`
Expected: 全部 PASS

- [ ] **Step 4: Commit**

```bash
git add core/src/cmds_test.cj apps/desktop/test/composer-commands.test.mjs
git commit -m "test: 斜杠命令端到端集成测试"
```

**验收标准**：
- Core 集成测试验证命令注册 → 解析 → 分发链路完整
- 前端测试验证命令列表 → popover → 选中 → 执行链路完整
- 所有 commit 消息为中文
- 代码符合 Global Constraints

**Report file**: `task-6-report.md`（写入完整报告后返回）
