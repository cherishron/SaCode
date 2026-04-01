# /pciv-mode - PCIV 模式切换命令

切换到 PCIV 模式：人工主导的结构化开发流程。

## 用法

```
/pciv-mode [phase]
```

## 描述

PCIV 模式提供四阶段人工控制开发流程：

```
    ┌─────────────┐
    │   Prime     │  ← 准备阶段：理解上下文、定义范围
    │  (准备)     │
    └──────┬──────┘
           │
           ▼
    ┌─────────────┐
    │   Clarify   │  ← 澄清阶段：需求确认、风险识别
    │  (澄清)     │
    └──────┬──────┘
           │
           ▼
    ┌─────────────┐
    │  Implement  │  ← 实现阶段：按计划执行任务
    │  (实施)     │
    └──────┬──────┘
           │
           ▼
    ┌─────────────┐
    │   Validate  │  ← 验证阶段：全面质量检验
    │  (验证)     │
    └──────┬──────┘
           │
           └────► 完成交付
```

## 参数

- `phase` - 要启动的阶段（可选）：
  - `prime` - 准备阶段
  - `clarify` - 澄清阶段
  - `implement` - 实现阶段
  - `validate` - 验证阶段

## 选项

- `--auto-advance` - 自动推进到下一阶段（需确认）
- `--strict` - 严格模式，不跳过任何检查点

## 示例

### 切换到 PCIV 模式

```
/pciv-mode
```

### 直接启动特定阶段

```
/pciv-mode prime
/pciv-mode clarify
/pciv-mode implement
/pciv-mode validate
```

### 带选项

```
/pciv-mode implement --auto-advance
```

## 与 Ultrawork 模式的区别

| 特性 | PCIV 模式 | Ultrawork 模式 |
|------|----------|---------------|
| 控制权 | 人工主导 | AI 自主 |
| 阶段确认 | 每阶段需确认 | 自动推进 |
| 适合场景 | 复杂任务、学习 | 重复任务、快速执行 |
| 错误处理 | 人工干预 | 自动重试 |
| 可追溯性 | 高 | 中 |

## 相关命令

- `/ultrawork` - 切换到 Ultrawork 模式（自动执行）
- `/pciv-prime` - 启动 Prime 阶段
- `/pciv-clarify` - 启动 Clarify 阶段
- `/pciv-implement` - 启动 Implement 阶段
- `/pciv-validate` - 启动 Validate 阶段
- `/pciv-status` - 查看当前状态

## 注意事项

1. PCIV 模式适合需要精细控制的复杂任务
2. 每个阶段结束时会进行检查点验证
3. 可以随时使用 `/ultrawork` 切换到自动执行模式
4. 建议在开始前明确任务范围
