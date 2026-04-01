---
name: deep-work
description: 自主执行端到端的代码工作，给目标不给食谱
version: 1.0.0
author: STAND-ALONE
category: development
tags:
  - deep
  - autonomous
  - implementation
---

# deep-work - 深度工作 Skill

启动深度工作模式：自主执行端到端的代码工作。

## 调用的 Agent

| Agent | 角色 | 任务类别 |
|-------|------|----------|
| Hephaestus | 深度工作者 | deep |

## Hephaestus Agent 特点

- **自主执行**：不需要手把手指导
- **端到端**：从探索到实现的完整流程
- **目标导向**：给目标，不是给步骤
- **自主学习**：自动搜索和学习需要的知识

## 使用场景

### 1. 实现新功能

```
@deep-work 实现一个可复用的表单验证组件，支持异步验证
```

### 2. 重构代码

```
@deep-work 重构用户认证模块，使其更易于测试
```

### 3. 修复复杂 Bug

```
@deep-work 找出并修复内存泄漏问题
```

### 4. 创建模块

```
@deep-work 创建一个日志系统，支持多级别输出和文件轮转
```

## 执行流程

```
1. 接收目标 → 分析需要做什么
2. 自主探索：
   - 搜索相关代码
   - 理解现有架构
   - 学习最佳实践
3. 自主规划：
   - 确定实现方案
   - 列出需要修改的文件
4. 自主实现：
   - 编写代码
   - 运行测试
   - 修复问题
5. 交付结果
```

## 与其他模式的对比

| 模式 | Agent | 自主性 | 适合场景 |
|------|-------|--------|----------|
| @deep-work | Hephaestus | 高 | 端到端实现 |
| @quick-task | Explore | 低 | 快速查询 |
| /ultrawork | Sisyphus | 中 | 任务编排 |
| /pciv-mode | 人工 | 低 | 精细控制 |

## 配置选项

```yaml
deep-work:
  agent: hephaestus
  modelPreference:
    - claude-3-opus
    - gpt-4o
    - deepseek-coder
  maxIterations: 50
  timeout: 300000  # 5 分钟
  allowedTools:
    - read_file
    - write_file
    - search_files
    - list_directory
    - execute_command
```

## 示例用法

### 作为 Skill 调用

```
@deep-work 实现用户权限系统，支持角色和权限继承
```

### 复杂任务

```
@deep-work 重构整个 API 层：
1. 使用统一的错误处理
2. 添加请求验证
3. 实现响应缓存
4. 添加日志记录
```

## 注意事项

1. **描述目标，不要描述步骤**：Agent 会自己决定如何实现
2. **信任 Agent**：让它自主探索和学习
3. **提供上下文**：说明相关的文件或模块
4. **设置合理超时**：复杂任务可能需要较长时间

## 相关 Skills

- `quick-task` - 快速查询
- `code-review` - 代码审查
- `ultrawork` - 自动迭代执行
