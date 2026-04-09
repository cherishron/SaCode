# IM platform integration

Connect SaCode to your favorite messaging platforms.

## Overview

SaCode supports 10 IM platforms through its adapter system. Each adapter implements a common interface while handling platform-specific protocols and features.

## Supported platforms

| Platform     | Adapter           | Protocol           | Status    |
| ------------ | ----------------- | ------------------ | --------- |
| **Telegram** | `TelegramAdapter` | Bot API            | ✅ Stable |
| **Discord**  | `DiscordAdapter`  | Gateway + REST     | ✅ Stable |
| **微信**     | `WechatAdapter`   | WebSocket          | ✅ Stable |
| **QQ**       | `QQAdapter`       | OneBot Protocol    | ✅ Stable |
| **钉钉**     | `DingTalkAdapter` | REST API + AI Card | ✅ Stable |
| **飞书**     | `FeishuAdapter`   | Open API           | ✅ Stable |
| **小艺**     | `XiaoyiAdapter`   | AK/SK + WebSocket  | ✅ Stable |
| **WhatsApp** | `WhatsAppAdapter` | Baileys Bridge     | ✅ Stable |
| **Slack**    | `SlackAdapter`    | Web API            | ✅ Stable |
| **Email**    | `EmailAdapter`    | IMAP + SMTP        | ✅ Stable |

## Adapter interface

All adapters implement the common `IMAdapter` interface:

```typescript
interface IMAdapter {
  name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onMessage(handler: MessageHandler): void;
  send(message: IMMessage): Promise<string | undefined>;
  getChannels?(): Promise<Channel[]>;
}
```

## Connecting via CLI

Terminal window

```bash
# List all connections
sacode im list

# Connect to a platform
sacode im connect telegram -c '{"botToken": "your-token"}'

# Disconnect
sacode im disconnect telegram
```

## Connecting via API

Terminal window

```bash
# List connections
curl http://localhost:3000/api/im

# Connect
curl -X POST http://localhost:3000/api/im/:id/connect \
  -H "Authorization: Bearer your-token"

# Disconnect
curl -X POST http://localhost:3000/api/im/:id/disconnect \
  -H "Authorization: Bearer your-token"
```

## Platform-specific guides

| Platform | Guide                                            |
| -------- | ------------------------------------------------ |
| Telegram | [Telegram setup](/docs/guides/telegram-setup.md) |
| QQ       | [QQ setup guide](/docs/guides/qq-setup.md)       |
| 微信     | [WeChat setup](/docs/guides/wechat-setup.md)     |
| Discord  | [Discord setup](/docs/guides/discord-setup.md)   |
| 钉钉     | [DingTalk setup](/docs/guides/dingtalk-setup.md) |
| 飞书     | [Feishu setup](/docs/guides/feishu-setup.md)     |
| 小艺     | [Xiaoyi setup](/docs/guides/xiaoyi-setup.md)     |
| WhatsApp | [WhatsApp setup](/docs/guides/whatsapp-setup.md) |
| Slack    | [Slack setup](/docs/guides/slack-setup.md)       |
| Email    | [Email setup](/docs/guides/email-setup.md)       |

## Cross-platform session mapping

SaCode's `SessionMapper` unifies conversations across platforms:

```
Telegram:chat_123 ──┐
WeChat:user_456   ──┼──▶ Unified Session ABC
Discord:guild_789 ──┘
```

This means a user can start a conversation on Telegram and continue it on WeChat with full context.

## Next steps

- **[QQ setup guide](/docs/guides/qq-setup.md)** — Connect QQ to SaCode
- **[Session management](/docs/cli/tutorials/session-management/)** — Manage cross-platform sessions
- **[SmartRouter](/docs/features/model-routing/)** — Route messages intelligently
