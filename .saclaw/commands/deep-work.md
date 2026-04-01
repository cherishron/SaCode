# /deep-work - 深度工作模式命令

启动深度工作模式：自主执行端到端的代码工作。

## 用法

```
/deep-work [goal]
```

## 描述

深度工作模式调用 Hephaestus Agent，特点是：

- **给目标，不给食谱**：Agent 自主决定如何实现
- **端到端执行**：从探索到实现的完整流程
- **自主研究**：自动搜索和学习需要的知识

## Agent 配置

| 属性 | 值 |
|------|-----|
| Agent | Hephaestus |
| 执行模式 | 自主（autonomous） |
| 任务类别 | deep |
| 推荐模型 | Claude-3-Opus, GPT-4o, DeepSeek-Coder |
| 最大迭代 | 50 |
| 超时 | 5 分钟 |

## 参数

- `goal` - 要实现的目标（不是步骤）

## 选项

- `--model MODEL` - 指定使用的模型
- `--files FILE...` - 指定相关文件
- `--timeout N` - 超时时间，毫秒

## 示例

### 实现新功能

```
/deep-work 实现一个可复用的表单验证组件
```

### 重构代码

```
/deep-work 重构用户认证模块，提高可测试性
```

### 带选项

```
/deep-work 实现文件上传功能 --timeout 600000
```

## 与其他模式的关系

```
/deep-work     → Hephaestus (深度实现)
/quick-task    → Explore/Librarian (快速查询)
/ultrawork     → Sisyphus (编排执行)
```

## 注意事项

1. 描述目标，不要描述步骤
2. Agent 会自主探索和学习
3. 复杂任务可能需要较长时间
4. 可以通过 `/pciv-mode` 切换到交互模式
