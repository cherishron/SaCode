---
name: "Customize"
---

# Customize Skill

帮助用户自定义 SaClaw 的行为和功能。

## 触发条件

- 用户想要自定义 AI 行为
- 用户需要修改系统提示
- 用户想要添加新功能

## 使用指南

### 1. 自定义系统提示

#### 方式一：AGENTS.md

在项目根目录创建或修改 `AGENTS.md` 文件：

```markdown
# SaClaw 项目上下文

你是一个专业的 AI 助手，帮助用户管理项目和日常任务。

## 核心能力
- 代码审查和建议
- 项目管理
- 文档生成

## 行为准则
- 保持专业和友好
- 提供具体可行的建议
- 在不确定时主动询问
```

#### 方式二：SOUL.md

创建 `SOUL.md` 定义 AI 的个性和风格：

```markdown
# 个性设定

你是一位经验丰富的技术顾问，风格：
- 简洁明了，不喜欢废话
- 代码优先，示例驱动
- 幽默但不失专业
```

### 2. 添加新 Skill

在 `.iflow/skills/` 目录下创建新的 Skill：

```bash
mkdir -p .iflow/skills/my-skill
```

创建 `SKILL.md` 文件：

```markdown
# My Custom Skill

描述这个 Skill 的用途。

## 触发条件

- 条件 1
- 条件 2

## 使用指南

详细的使用步骤...

## 可用工具

- tool1
- tool2
```

### 3. 配置会话记忆

在 `sessions/{sessionId}/CLAUDE.md` 中记录重要信息：

```markdown
# 会话记忆

## 用户偏好
- 使用 TypeScript
- 偏好函数式编程
- 喜欢详细的注释

## 重要信息
- 项目截止日期：2026-04-01
- 团队成员：Alice, Bob
```

### 4. 自定义任务调度

使用任务调度功能设置自动化任务：

```bash
# 每天 9:00 发送提醒
saclaw task create --cron "0 9 * * *" --message "开始工作！"
```

### 5. 调整并发设置

在配置中调整群组队列的并发数：

```typescript
const queue = new GroupQueue({
  concurrency: 3,  // 每个群组最多 3 个并发任务
  timeout: 30000,  // 30 秒超时
  maxRetries: 2    // 最多重试 2 次
});
```

## 可用工具

所有配置和管理工具。

## 高级定制

### 自定义工具

在 `packages/capabilities/src/tools/` 中添加新工具：

```typescript
export const myCustomTool = {
  name: "my_custom_tool",
  description: "我的自定义工具",
  inputSchema: z.object({
    input: z.string(),
  }),
  execute: async ({ input }) => {
    // 工具逻辑
    return { result: "done" };
  },
};
```

### 自定义 IM 适配器

在 `packages/adapters/src/` 中添加新平台支持。
