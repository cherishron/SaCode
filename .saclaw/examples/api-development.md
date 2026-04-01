# API 开发示例

## 场景描述

创建一个 RESTful API 端点，用于管理用户评论功能。

## Prime 阶段

### 1. 加载项目上下文

```bash
@IFLOW.md
@docs/core/architecture.md
@docs/technical/api.md
```

### 2. 明确需求

```bash
"我需要实现评论管理 API，要求：
1. 创建评论（POST /api/comments）
2. 获取评论列表（GET /api/comments）
3. 获取单条评论（GET /api/comments/[id]）
4. 更新评论（PUT /api/comments/[id]）
5. 删除评论（DELETE /api/comments/[id]）

验收标准：
- 所有端点正常工作
- 输入验证完整
- 错误处理完善
- 响应格式一致"
```

### 3. 制定计划

```bash
"请帮我制定详细的实现计划，包括：
1. 数据库模型创建
2. API 路由实现
3. 输入验证和错误处理
4. 单元测试
5. 文档更新"
```

### 4. 评估风险

```bash
"请评估实现评论 API 可能遇到的风险：
- 数据验证
- 权限控制
- SQL 注入
- XSS 攻击"
```

### 5. 确定技术方案

```bash
"请帮我选择合适的技术方案：
- 数据库：Prisma ORM
- 验证：Zod
- 认证：JWT Token"
```

## Implement 阶段

### 1. 创建数据库模型

```bash
# 读取现有文件
@prisma/schema.prisma

# 添加 Comment 模型
"请在 prisma/schema.prisma 中添加 Comment 模型：
model Comment {
  id        String   @id @default(cuid())
  content   String
  postId    String
  userId    String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  post      Post     @relation(fields: [postId], references: [id])
  user      User     @relation(fields: [userId], references: [id])
}"

# 生成 Prisma Client
!npm run prisma:generate
!npm run prisma:migrate
```

### 2. 创建 API 路由

```bash
# 创建评论列表路由
"请创建 src/app/api/comments/route.ts

功能：
- GET /api/comments - 获取评论列表
- POST /api/comments - 创建评论"

# 创建单条评论路由
"请创建 src/app/api/comments/[id]/route.ts

功能：
- GET /api/comments/[id] - 获取单条评论
- PUT /api/comments/[id] - 更新评论
- DELETE /api/comments/[id] - 删除评论"
```

### 3. 实现输入验证

```bash
"请使用 Zod 实现输入验证：
- content: 必填，1-1000 字符
- postId: 必填，有效的 Post ID
- userId: 必填，有效的 User ID"
```

### 4. 实现错误处理

```bash
"请实现完善的错误处理：
- 400 Bad Request - 输入验证失败
- 401 Unauthorized - 未授权
- 403 Forbidden - 权限不足
- 404 Not Found - 资源不存在
- 500 Internal Server Error - 服务器错误"
```

### 5. 更新任务状态

```bash
"数据库模型创建已完成"
"API 路由实现已完成"
"输入验证已完成"
"错误处理已完成"
```

## Validate 阶段

### 1. TypeScript 类型检查

```bash
!npx tsc --noEmit
```

### 2. 代码风格验证

```bash
!npx eslint .
!npx prettier --write .
```

### 3. 功能测试

```bash
"请测试所有 API 端点：
- 测试创建评论
- 测试获取评论列表
- 测试获取单条评论
- 测试更新评论
- 测试删除评论
- 测试错误处理"
```

### 4. 构建验证

```bash
!npm run build
```

### 5. 更新文档

```bash
"请更新 docs/technical/api.md，添加评论 API 的文档"
```

## 完成检查清单

### Prime 阶段
- [x] 已加载项目上下文
- [x] 需求和验收标准已明确
- [x] 详细计划已制定
- [x] 风险和依赖已评估
- [x] 技术方案已确定

### Implement 阶段
- [x] 数据库模型创建已完成
- [x] API 路由实现已完成
- [x] 输入验证已完成
- [x] 错误处理已完成

### Validate 阶段
- [x] TypeScript 类型检查通过
- [x] 代码风格验证通过
- [x] 功能测试通过
- [x] 构建验证通过
- [x] 文档已更新

## 总结

通过 PIV 工作流，我们成功实现了评论管理 API：

1. **Prime 阶段** - 明确需求，制定计划，评估风险
2. **Implement 阶段** - 创建数据库模型，实现 API 路由，添加验证和错误处理
3. **Validate 阶段** - 全面测试，确保功能正确

## 参考资料

- [Javisk 方法论概述](../SKILL.md)
- [Prime 阶段指南](../templates/prime-phase.md)
- [Implement 阶段指南](../templates/implement-phase.md)
- [Validate 阶段指南](../templates/validate-phase.md)