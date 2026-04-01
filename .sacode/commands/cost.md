# /cost

查看 AI API 调用的 Token 使用量和成本统计。

## 描述

显示当前会话或全局的 Token 使用量、成本统计和模型使用情况。

## 用法

```
/cost [options]
```

### 选项

| 选项 | 说明 |
|------|------|
| `--session` | 显示当前会话统计（默认） |
| `--all` | 显示全局统计 |
| `--model` | 按模型分组统计 |
| `--export` | 导出为 CSV 格式 |
| `--report` | 生成 Markdown 报告 |
| `--reset` | 重置统计 |

## 示例

### 查看当前会话成本

```
/cost
```

输出示例：
```
## 当前会话成本统计

| 指标 | 值 |
|------|-----|
| 总请求数 | 12 |
| 输入 Token | 45,230 |
| 输出 Token | 8,450 |
| 总 Token | 53,680 |
| 缓存命中 | 12,500 |
| **总成本** | **$0.1278** |

### 使用模型
- gpt-4o: 8 次请求, $0.0923
- claude-3-5-sonnet: 4 次请求, $0.0355
```

### 查看全局统计

```
/cost --all
```

输出示例：
```
## 全局成本统计

| 指标 | 值 |
|------|-----|
| 总请求数 | 1,234 |
| 总输入 Token | 4,523,000 |
| 总输出 Token | 845,000 |
| 总 Token | 5,368,000 |
| 总缓存读取 | 1,250,000 |
| **总成本** | **$12.78** |

### 按模型统计
| 模型 | Provider | 请求数 | 成本 |
|------|----------|--------|------|
| gpt-4o | openai | 856 | $8.45 |
| claude-3-5-sonnet | anthropic | 378 | $4.33 |

### 时间范围
- 首次请求: 2026-03-15 09:23
- 最近请求: 2026-03-20 16:45
```

### 按模型分组

```
/cost --model
```

输出示例：
```
## 按模型成本统计

| 模型 | Provider | 请求数 | 输入 | 输出 | 成本 | 平均/请求 |
|------|----------|--------|------|------|------|-----------|
| gpt-4o | openai | 856 | 3.2M | 580K | $8.45 | $0.0099 |
| claude-3-5-sonnet | anthropic | 378 | 1.1M | 265K | $4.33 | $0.0115 |
| deepseek-chat | deepseek | 45 | 180K | 45K | $0.05 | $0.0011 |
```

### 导出报告

```
/cost --report
```

生成完整的 Markdown 成本报告，包含：
- 总览统计
- 按模型统计
- 按会话统计（Top 10）
- 时间分布

### 重置统计

```
/cost --reset
```

清空所有成本记录（需确认）。

## API 集成

成本追踪器自动集成到 Provider 层，每次 API 调用会自动记录：

```typescript
import { getCostTracker } from "@sacode/core";

// 获取默认追踪器
const tracker = getCostTracker();

// 获取统计
const stats = tracker.getStats();
console.log(`Total cost: $${stats.totalCost.toFixed(4)}`);

// 获取会话统计
const sessionStats = tracker.getSessionStats("session-123");

// 导出报告
const report = tracker.exportReport();
```

## 定价数据

模块内置了主流模型的定价数据：

- **OpenAI**: GPT-4.1, GPT-4o, GPT-4 Turbo, o1, o3
- **Anthropic**: Claude 4, Claude 3.7, Claude 3.5, Claude 3
- **DeepSeek**: DeepSeek Chat, DeepSeek Reasoner
- **Moonshot**: Moonshot V1 8K/32K/128K
- **智谱**: GLM-4, GLM-4-Air, GLM-4-Flash

定价数据定期更新，也支持自定义定价：

```typescript
tracker.setCustomPricing("my-custom-model", {
  modelId: "my-custom-model",
  displayName: "My Custom Model",
  provider: "openai",
  inputPricePerMillion: 1.0,
  outputPricePerMillion: 3.0,
  contextWindow: 128000,
});
```

## 相关命令

- `/compact` - 压缩上下文以减少 Token 使用
- `/context` - 查看当前上下文
