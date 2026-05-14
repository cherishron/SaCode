---
name: "Add Telegram"
---

# Add Telegram Skill

帮助用户配置和连接 Telegram 机器人。

## 触发条件

- 用户想要连接 Telegram
- 用户询问如何添加 Telegram 机器人
- 用户需要配置 Telegram 通知

## 使用指南

### 1. 创建 Telegram Bot

1. 在 Telegram 中搜索 `@BotFather`
2. 发送 `/newbot` 命令
3. 按提示设置 Bot 名称
4. 保存返回的 Bot Token

### 2. 配置 SACODE

在 `.env` 文件中添加：

```env
TELEGRAM_BOT_TOKEN=your_bot_token_here
```

### 3. 启动 Bot

```bash
# 使用 CLI 连接
sacode im connect telegram

# 或通过 API
POST /api/im/connect
{
  "platform": "telegram",
  "config": {
    "botToken": "your_bot_token"
  }
}
```

### 4. 测试连接

向你的 Bot 发送消息，检查是否正常响应。

### 5. 获取 Chat ID

如果需要向特定群组或频道发送消息：

1. 将 Bot 添加到群组
2. 发送一条消息
3. 访问 `https://api.telegram.org/bot<TOKEN>/getUpdates`
4. 从返回的 JSON 中找到 `chat.id`

## 可用工具

- `im.connect` - 连接 IM 平台
- `im.send` - 发送消息
- `im.list` - 列出连接

## 注意事项

- Bot Token 非常重要，不要泄露
- Bot 需要管理员权限才能在群组中正常工作
- 频道需要将 Bot 添加为管理员
