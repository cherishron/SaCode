# 华为小艺插件

华为小艺 AI 助手集成插件，提供完整的消息收发和能力扩展。

## 功能特性

- 🔌 **完整的生命周期管理** - 支持 install/enable/disable/uninstall
- 🛠️ **工具注册** - 提供 `xiaoyi_chat` 和 `xiaoyi_status` 工具
- ⌨️ **命令注册** - 支持 `/xiaoyi` 命令（别名 `/xy`）
- 📨 **消息处理** - 自动处理来自小艺平台的消息
- ⚙️ **配置热更新** - 支持运行时配置变更

## 安装

```bash
# 通过 SaClaw CLI 安装
saclaw plugin install xiaoyi
```

## 配置

在 `plugin.json` 中配置以下参数：

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `ak` | string | ✅ | - | 华为云 Access Key |
| `sk` | string | ✅ | - | 华为云 Secret Key |
| `agentId` | string | ✅ | - | 小艺 Agent ID |
| `region` | string | ❌ | `cn-north-4` | 华为云区域 |
| `timeout` | number | ❌ | `30000` | 请求超时时间（毫秒） |
| `reconnectInterval` | number | ❌ | `5000` | WebSocket 重连间隔 |

## 使用示例

### 通过工具调用

```typescript
import { PluginManager } from "@saclaw/core";

const pluginManager = new PluginManager(/* ... */);
await pluginManager.enable("xiaoyi");

// 使用工具
const result = await pluginManager.getTool("xiaoyi_chat")?.execute({
  message: "你好，小艺！",
});
console.log(result.reply);
```

### 通过命令

```bash
# 在 CLI 中
/xiaoyi 你好，请帮我查询天气

# 或使用别名
/xy 今天天气怎么样
```

### 消息处理

插件会自动处理来自小艺平台的消息：

```typescript
// 注册自定义消息处理器
context.registerMessageHandler({
  platform: "xiaoyi",
  priority: 20,
  handler: async (message, ctx) => {
    // 处理消息
    return {
      reply: "收到您的消息！",
      stopPropagation: false,
    };
  },
});
```

## 生命周期

```
┌─────────────┐
│  install    │  ← 首次安装，验证配置
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   enable    │  ← 启用插件，建立连接
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   running   │  ← 运行中，处理消息
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   disable   │  ← 禁用插件，断开连接
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  uninstall  │  ← 卸载插件，清理资源
└─────────────┘
```

## 依赖

- `@saclaw/core` >= 0.1.0
- `@saclaw/adapters` (xiaoyi adapter)

## 许可证

MIT © STAND-ALONE
