# SACODE Hooks

SACODE 钩子系统 - 支持在关键操作前后执行自定义逻辑。

## 目录结构

```
packages/hooks/
├── pre-edit/      # 文件编辑前钩子
├── post-edit/     # 文件编辑后钩子
├── pre-command/   # 命令执行前钩子
├── post-command/  # 命令执行后钩子
├── pre-tool/      # 工具调用前钩子
├── post-tool/     # 工具调用后钩子
└── session/       # 会话生命周期钩子
```

## 钩子类型

| 事件 | 触发时机 | 可用数据 |
|------|----------|----------|
| `pre-edit` | 文件编辑前 | `filePath`, `content`, `newContent` |
| `post-edit` | 文件编辑后 | `filePath`, `content`, `previousContent` |
| `pre-command` | 命令执行前 | `command`, `args` |
| `post-command` | 命令执行后 | `command`, `args`, `exitCode`, `stdout`, `stderr` |
| `pre-tool` | 工具调用前 | `toolName`, `args` |
| `post-tool` | 工具调用后 | `toolName`, `args`, `result` |
| `session-start` | 会话开始 | `sessionId`, `userId`, `platform` |
| `session-end` | 会话结束 | `sessionId`, `reason`, `duration` |

## 钩子格式

钩子可以是 `.ts`、`.js` 或 `.mjs` 文件，导出一个处理函数：

```typescript
// 简单函数导出
import type { HookContext, HookResult } from "@sacode/core";

export default async function myHook(
  context: HookContext
): Promise<HookResult> {
  console.log("Hook executed:", context.event);
  
  // 返回 proceed: true 继续执行
  // 返回 proceed: false 中断操作
  return { proceed: true };
}
```

或者导出完整的钩子定义：

```typescript
import type { HookDefinition } from "@sacode/core";

const hook: HookDefinition = {
  name: "my-hook",
  event: "post_edit",
  priority: 100,  // 数字越小越先执行
  enabled: true,
  timeout: 30000, // 超时时间（毫秒）
  handler: async (context) => {
    // 处理逻辑
    return { proceed: true };
  },
};

export default hook;
```

## 返回值

| 字段 | 类型 | 说明 |
|------|------|------|
| `proceed` | boolean | 是否继续执行后续操作 |
| `modifiedData` | object | 修改后的数据（传递给下一个钩子） |
| `message` | string | 提示消息 |
| `error` | Error | 错误信息 |

## 示例

### 文件编辑日志

```typescript
// packages/hooks/post-edit/log-edit.ts
export default async function logEdit(context) {
  const { filePath, content } = context.data;
  console.log(`File edited: ${filePath} (${content.length} chars)`);
  return { proceed: true };
}
```

### 危险命令拦截

```typescript
// packages/hooks/pre-command/block-dangerous.ts
const DANGEROUS = ["rm", "format", "fdisk"];

export default async function blockDangerous(context) {
  const { command } = context.data;
  const base = command.split(" ")[0];

  if (DANGEROUS.includes(base)) {
    return {
      proceed: false,
      message: `Blocked dangerous command: ${base}`
    };
  }

  return { proceed: true };
}
```

### 工具调用审计

```typescript
// packages/hooks/post-tool/audit.ts
export default async function auditTool(context) {
  const { toolName, args, result } = context.data;

  // 写入审计日志
  await writeAuditLog({
    timestamp: new Date(),
    sessionId: context.sessionId,
    tool: toolName,
    success: !result.error,
  });

  return { proceed: true };
}
```

## 执行顺序

同一事件的多个钩子按 `priority` 升序执行：
- `priority: 1` 最先执行
- `priority: 100` 默认值
- 如果某个钩子返回 `proceed: false`，后续钩子不会执行

## 内置钩子

SACODE 内置以下系统钩子（优先级从低到高）：
- `rate-limiter` (priority: 10) - 速率限制
- `file-backup` (priority: 50) - 文件备份
- `audit-log` (priority: 100) - 审计日志
- `confirm-dangerous` (priority: 1) - 危险操作确认
- `session-stats` (priority: 100) - 会话统计
