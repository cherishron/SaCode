# Task 3 Brief: 实现前端 /clear 命令

**Plan**: `docs/superpowers/plans/2026-10-09-slash-command-system.md`
**Task**: Task 3
**Spec**: `docs/superpowers/specs/2026-10-09-slash-command-system-design.md` §4.3, §7.3

---

## 要求（逐字引用）

### Global Constraints（必须遵守）
- 所有 UI 文案、错误消息、命令 help 文本必须用中文
- 参数解析使用简单空格分词，不实现引号/转义
- 命令本身不触发审批，审批由内部工具触发
- 错误反馈显示在 composer 附近，不污染会话历史
- `CommandRegistry` 纯内存，每次启动重新注册
- 新命令只需注册到 `CommandRegistry`，无需改动 popover

### Task 3 具体要求

**Files:**
- Modify: `apps/desktop/renderer/pages/composer-commands.ts`（添加 clear 命令处理逻辑）
- Modify: `apps/desktop/renderer/app.js:1720-1735`（绑定 clear 命令执行，调用 session.clear 或等效 API）

**Interfaces:**
- Consumes: `SlashCommand`（来自 Task 2）；composer 的 `emit('command', name)` 事件
- Produces: `/clear` 命令的执行路径（前端直接处理，清空当前会话历史，不调用 Core）

**步骤（必须逐个执行）：**

- [ ] **Step 1: 在 composer-commands.ts 中添加 clear 命令的特殊处理标记**

```typescript
export const BUILTIN_COMMANDS: SlashCommand[] = [
  // ... 其他命令
  { name: 'clear', label: '清空对话', help: '清空当前会话历史', section: 'commands', frontendOnly: true }
]
```

- [ ] **Step 2: 修改 app.js，监听 'command' 事件并分发到前端处理器**

在 composer 组件附近添加：

```javascript
menu.on('command', (name) => {
  if (name === 'clear') {
    // 直接清空当前 session 的消息列表
    currentSession.messages = []
    // 触发 UI 刷新
    renderMessages()
    // 可选：在 composer 附近显示提示（不写入历史）
    showComposerHint('对话已清空')
  } else if (name === 'help') {
    // 打开 commands popover 或显示帮助列表
    showHelpPopover()
  }
  // 其他命令透传给 Core（后续任务）
})
```

- [ ] **Step 3: 确保 clear 不触发任何 Core 侧命令注册或审批流程**

clear 完全在前端处理，绝不调用 `reg.resolve('clear')` 或发送到 host。

- [ ] **Step 4: 更新前端测试，覆盖 clear 执行路径**

在 `composer-commands.test.mjs` 中新增测试：
- 点击 clear 后 messages 数组长度归零
- 不产生任何 network 请求或 IPC 调用

**验收标准**：
- `npm test -- composer-commands.test.mjs` → 新增 clear 测试 PASS
- 手动在 UI 输入 `/clear` 后会话历史立即清空，无残留消息
- 所有 commit 消息为中文
- 代码符合 Global Constraints
- clear 命令不调用任何 Core 逻辑

**Report file**: `task-3-report.md`（写入完整报告后返回）
