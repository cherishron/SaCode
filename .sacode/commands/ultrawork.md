# /ultrawork - Ultrawork 模式命令

启动 Ultrawork 模式：自动迭代执行直到任务完成。

## 用法

```
/ultrawork [task description]
```

## 描述

Ultrawork 模式是 OMO (Oh My OpenCode) 设计的核心特性之一。它提供：

- **不完成不停止**：自动迭代执行直到所有任务完成
- **懒惰检测**：检测 Agent 是否在拖延或卡住
- **强制推进**：当检测到懒惰行为时强制推进

## 执行流程

```
1. 解析任务 → 创建 Todo 列表
2. 验证 Todo → 确保清晰明确
3. 循环执行：
   a. 获取下一个 Todo
   b. 意图门控检查
   c. 执行动作
   d. 更新状态
   e. 懒惰检测
4. 完成/失败处理
```

## 参数

- `task description` - 要执行的任务描述（可选，如果未提供则使用当前对话上下文）

## 选项

- `--max-iterations N` - 最大迭代次数（默认：100）
- `--timeout N` - 总超时时间，毫秒（默认：3600000）
- `--no-lazy-detect` - 禁用懒惰检测
- `--no-intent-gate` - 禁用意图门控

## 示例

### 基本用法

```
/ultrawork 实现用户登录功能
```

### 带选项

```
/ultrawork 重构认证模块 --max-iterations 50 --timeout 1800000
```

### 使用当前上下文

```
/ultrawork
```

## 相关命令

- `/pciv-mode` - 切换到 PCIV 模式（人工控制）
- `/pciv-status` - 查看当前状态

## 注意事项

1. Ultrawork 模式会自动执行，建议在执行前确认任务范围
2. 懒惰检测会在每 5 次迭代后自动运行
3. 意图门控会阻止偏离目标的行为
4. 可以随时使用 `/pciv-mode` 切换回人工控制模式
