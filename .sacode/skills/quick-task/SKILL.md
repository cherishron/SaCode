---
name: quick-task
description: 快速执行简单任务，如代码搜索、文件查找、快速查询
version: 1.0.0
author: STAND-ALONE
category: productivity
tags:
  - quick
  - search
  - explore
---

# quick-task - 快速任务 Skill

快速执行简单任务：代码搜索、文件查找、快速查询。

## 调用的 Agent

| Agent | 角色 | 任务类别 |
|-------|------|----------|
| Explore | 探索者 | quick |
| Librarian | 资料管理员 | quick |

## 使用场景

### 1. 代码搜索

```
搜索项目中所有使用 useState 的组件
```

```
找到处理用户认证的文件
```

### 2. 文件查找

```
找到所有的 API 路由定义
```

```
查看项目的配置文件在哪里
```

### 3. 快速查询

```
这个函数的作用是什么？
```

```
这个模块的依赖有哪些？
```

## 执行流程

```
1. 分析请求 → 确定任务类型
2. 选择 Agent：
   - 搜索/探索 → Explore
   - 文档/资料 → Librarian
3. 执行查询
4. 返回结果（快速、简洁）
```

## 与 /deep-work 的区别

| 特性 | /quick-task | /deep-work |
|------|-------------|------------|
| Agent | Explore/Librarian | Hephaestus |
| 耗时 | < 30 秒 | 可能数分钟 |
| 输出 | 简洁摘要 | 完整实现 |
| 适合 | 查询、搜索 | 实现、重构 |

## 示例用法

### 作为 Skill 调用

```
@quick-task 搜索所有 API 端点
```

### 作为命令调用

```
/quick-task 找到 auth 模块的入口文件
```

## 配置选项

```yaml
quick-task:
  defaultAgent: explore
  timeout: 30000
  maxResults: 20
  summaryLength: short
```

## 相关 Skills

- `deep-work` - 深度工作模式
- `ultrawork` - 自动迭代执行
- `code-review` - 代码审查
