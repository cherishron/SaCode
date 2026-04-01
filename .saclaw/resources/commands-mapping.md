# 命令映射表

## 概述

本文档提供了 PIV 工作流中各个概念到 iFlow CLI 原生命令的完整映射表。

## PIV 模式命令映射

### Prime 阶段

| Javisk 概念 | iFlow 命令 | 示例 |
|-----------|-----------|------|
| 加载项目上下文 | @文件引用 | `@IFLOW.md` |
| 加载架构文档 | @文件引用 | `@docs/core/architecture.md` |
| 加载 API 文档 | @文件引用 | `@docs/technical/api.md` |
| 明确需求 | 自然语言 | `"我需要实现搜索功能"` |
| 制定计划 | 自然语言 | `"请帮我制定实现计划"` |
| 评估风险 | 自然语言 | `"请评估可能遇到的风险"` |
| 选择技术方案 | 自然语言 | `"请帮我选择技术方案"` |

### Implement 阶段

| Javisk 概念 | iFlow 命令 | 示例 |
|-----------|-----------|------|
| 查看任务状态 | 自然语言 | `"请查看当前的实施计划"` |
| 选择任务 | 自然语言 | `"开始实现数据库模型调整"` |
| 读取文件 | @文件引用 | `@prisma/schema.prisma` |
| 修改文件 | 自然语言 | `"请在 Post 模型中添加索引"` |
| 创建文件 | 自然语言 | `"请创建搜索 API 路由文件"` |
| 验证修改 | !命令执行 | `!npm run prisma:generate` |
| 更新任务状态 | 自然语言 | `"数据库模型调整已完成"` |
| 更新文档 | 自然语言 | `"请更新 API 文档"` |

### Validate 阶段

| Javisk 概念 | iFlow 命令 | 示例 |
|-----------|-----------|------|
| 类型检查 | !命令执行 | `!npx tsc --noEmit` |
| 代码风格检查 | !命令执行 | `!npx eslint .` |
| 代码格式化 | !命令执行 | `!npx prettier --write .` |
| 功能测试 | 自然语言 | `"请测试搜索 API 路由"` |
| 构建验证 | !命令执行 | `!npm run build` |
| 部署验证 | !命令执行 | `!npm run deploy` |
| 更新文档 | 自然语言 | `"请更新 API 文档"` |

## 常用命令组合

### 开发相关

```bash
# 启动开发服务器
!npm run dev

# 查看开发服务器日志
"请查看开发服务器的日志"

# 重启开发服务器
"请重启开发服务器"
```

### 测试相关

```bash
# 运行所有测试
!npm test

# 运行测试并生成覆盖率报告
!npm run test:coverage

# 运行特定测试文件
!npm test -- src/app/api/search/route.test.ts

# 监听模式运行测试
!npm test -- --watch
```

### 构建相关

```bash
# 构建生产版本
!npm run build

# 清除构建缓存
!rm -rf .next

# 分析构建产物
!npm run build -- --analyze
```

### 数据库相关

```bash
# 生成 Prisma Client
!npm run prisma:generate

# 创建数据库迁移
!npm run prisma:migrate

# 应用数据库迁移
!npm run prisma:migrate deploy

# 打开 Prisma Studio
!npm run prisma:studio

# 重置数据库
!npm run prisma:migrate reset
```

### 代码质量相关

```bash
# TypeScript 类型检查
!npx tsc --noEmit

# ESLint 检查
!npx eslint .

# ESLint 修复
!npx eslint . --fix

# Prettier 格式化
!npx prettier --write .

# Prettier 检查
!npx prettier --check .
```

## 常用工作流

### 工作流 1：开始新功能开发

```bash
# 1. 加载项目上下文
@IFLOW.md
@docs/core/architecture.md
@docs/technical/api.md

# 2. 明确需求
"我需要实现文章搜索功能，要求：
1. 支持全文搜索
2. 支持按标签过滤
3. 支持按分类过滤
4. 返回结果按相关性排序"

# 3. 制定计划
"请帮我制定详细的实现计划，包括：
1. 数据库模型调整
2. API 路由创建
3. 前端组件开发
4. 测试验证
5. 文档更新"

# 4. 评估风险
"请评估实现搜索功能可能遇到的风险"

# 5. 选择技术方案
"请帮我选择合适的技术方案"
```

### 工作流 2：实施功能

```bash
# 1. 查看当前任务
"请查看当前的实施计划，告诉我下一步应该做什么"

# 2. 执行任务
"开始实现数据库模型调整"
@prisma/schema.prisma
"请在 Post 模型中添加全文搜索索引"

# 3. 验证修改
!npm run prisma:generate
!npm run prisma:migrate

# 4. 更新任务状态
"数据库模型调整已完成"

# 5. 继续下一个任务
"继续实施搜索功能的 API 路由创建"
```

### 工作流 3：验证功能

```bash
# 1. 类型检查
!npx tsc --noEmit

# 2. 代码风格检查
!npx eslint .
!npx prettier --write .

# 3. 功能测试
"请测试搜索 API 路由是否正常工作"

# 4. 构建验证
!npm run build

# 5. 更新文档
"请更新 docs/technical/api.md，添加搜索 API 的文档"
```

## 参考资料

- [Javisk 方法论概述](../SKILL.md)
- [PIV 模式详细说明](../templates/prime-phase.md)
- [最佳实践](./best-practices.md)