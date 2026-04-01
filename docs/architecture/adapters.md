# IM Adapters - Detail Design

> Detailed design for IM platform adapters

---

## 1. Adapter Interface

### 1.1 Core Interface

```typescript
interface IMAdapter {
  // Properties
  readonly name: string;
  readonly status: ConnectionStatus;

  // Connection
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  // Messaging
  onMessage(handler: MessageHandler): void;
  send(message: IMMessage): Promise<string | undefined>;

  // Optional: Channel Management
  getChannels?(): Promise<Channel[]>;

  // Optional: Message Edit (for streaming)
  editMessage?(chatId: string, messageId: string, content: string): Promise<void>;
}

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

interface MessageHandler {
  (message: NormalizedMessage): Promise<void>;
}

interface NormalizedMessage {
  id: string;
  platform: string;
  chatId: string;
  userId: string;
  content: string | ContentPart[];
  timestamp: Date;
  replyTo?: string;
}

interface IMMessage {
  chatId: string;
  content: string | ContentPart[];
  replyTo?: string;
}

interface Channel {
  id: string;
  name: string;
  type: "private" | "group" | "channel";
}
```

---

## 2. Base Adapter

```typescript
abstract class BaseAdapter implements IMAdapter {
  protected connectionStatus: ConnectionStatus = "disconnected";
  protected messageHandlers: MessageHandler[] = [];

  abstract get name(): string;

  get status(): ConnectionStatus {
    return this.connectionStatus;
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract send(message: IMMessage): Promise<string | undefined>;

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  protected async emitMessage(message: NormalizedMessage): Promise<void> {
    for (const handler of this.messageHandlers) {
      await handler(message);
    }
  }

  protected setStatus(status: ConnectionStatus): void {
    this.connectionStatus = status;
  }
}
```

---

## 3. Telegram Adapter

### 3.1 Implementation

```typescript
import TelegramBot from "node-telegram-bot-api";

class TelegramAdapter extends BaseAdapter {
  private bot: TelegramBot;
  private botToken: string;

  get name(): string { return "telegram"; }

  constructor(config: { botToken: string }) {
    super();
    this.botToken = config.botToken;
  }

  async connect(): Promise<void> {
    this.setStatus("connecting");

    this.bot = new TelegramBot(this.botToken, { polling: true });

    this.bot.on("message", async (msg) => {
      await this.emitMessage({
        id: msg.message_id.toString(),
        platform: "telegram",
        chatId: msg.chat.id.toString(),
        userId: msg.from?.id.toString() ?? "",
        content: msg.text ?? "",
        timestamp: new Date(msg.date * 1000),
        replyTo: msg.reply_to_message?.message_id.toString(),
      });
    });

    this.setStatus("connected");
  }

  async disconnect(): Promise<void> {
    if (this.bot) {
      await this.bot.stopPolling();
    }
    this.setStatus("disconnected");
  }

  async send(message: IMMessage): Promise<string | undefined> {
    const result = await this.bot.sendMessage(
      parseInt(message.chatId),
      typeof message.content === "string" ? message.content : message.content[0].text!
    );
    return result.message_id.toString();
  }

  async getChannels(): Promise<Channel[]> {
    const updates = await this.bot.getUpdates();
    const chats = new Map<string, Channel>();

    for (const update of updates) {
      if (update.message?.chat) {
        const chat = update.message.chat;
        chats.set(chat.id.toString(), {
          id: chat.id.toString(),
          name: chat.title ?? chat.username ?? "Unknown",
          type: chat.type === "private" ? "private" : chat.type === "group" ? "group" : "channel",
        });
      }
    }

    return Array.from(chats.values());
  }
}
```

---

## 4. Discord Adapter

### 4.1 Implementation

```typescript
import { Client, GatewayIntentBits, TextChannel } from "discord.js";

class DiscordAdapter extends BaseAdapter {
  private client: Client;
  private botToken: string;

  get name(): string { return "discord"; }

  constructor(config: { botToken: string }) {
    super();
    this.botToken = config.botToken;
  }

  async connect(): Promise<void> {
    this.setStatus("connecting");

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    this.client.on("messageCreate", async (msg) => {
      if (msg.author.bot) return;

      await this.emitMessage({
        id: msg.id,
        platform: "discord",
        chatId: msg.channelId,
        userId: msg.author.id,
        content: msg.content,
        timestamp: msg.createdAt,
        replyTo: msg.reference?.messageId,
      });
    });

    await this.client.login(this.botToken);
    this.setStatus("connected");
  }

  async disconnect(): Promise<void> {
    await this.client?.destroy();
    this.setStatus("disconnected");
  }

  async send(message: IMMessage): Promise<string | undefined> {
    const channel = await this.client.channels.fetch(message.chatId);
    if (channel?.isTextBased()) {
      const msg = await (channel as TextChannel).send(
        typeof message.content === "string" ? message.content : message.content[0].text!
      );
      return msg.id;
    }
    return undefined;
  }

  async getChannels(): Promise<Channel[]> {
    const channels: Channel[] = [];

    for (const guild of this.client.guilds.cache.values()) {
      for (const channel of guild.channels.cache.values()) {
        if (channel.isTextBased()) {
          channels.push({
            id: channel.id,
            name: channel.name,
            type: channel.isDMBased() ? "private" : "group",
          });
        }
      }
    }

    return channels;
  }
}
```

---

## 5. DingTalk Adapter

### 5.1 Implementation with Streaming

```typescript
import crypto from "crypto";

class DingTalkAdapter extends BaseAdapter {
  private appKey: string;
  private appSecret: string;
  private robotCode: string;
  private cardTemplateId: string;
  private accessToken: string | null = null;
  private messages: Map<string, string> = new Map();

  get name(): string { return "dingtalk"; }

  constructor(config: DingTalkConfig) {
    super();
    this.appKey = config.appKey;
    this.appSecret = config.appSecret;
    this.robotCode = config.robotCode;
    this.cardTemplateId = config.cardTemplateId;
  }

  async connect(): Promise<void> {
    this.setStatus("connecting");
    await this.refreshAccessToken();
    this.setStatus("connected");
  }

  async disconnect(): Promise<void> {
    this.accessToken = null;
    this.setStatus("disconnected");
  }

  private async refreshAccessToken(): Promise<void> {
    const response = await fetch(
      `https://api.dingtalk.com/v1.0/oauth2/accessToken`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appKey: this.appKey,
          appSecret: this.appSecret,
        }),
      }
    );

    const data = await response.json();
    this.accessToken = data.accessToken;

    // Refresh token before expiry
    setTimeout(() => this.refreshAccessToken(), (data.expireIn - 300) * 1000);
  }

  async send(message: IMMessage): Promise<string | undefined> {
    const response = await fetch(
      `https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-acs-dingtalk-access-token": this.accessToken!,
        },
        body: JSON.stringify({
          robotCode: this.robotCode,
          userIds: [message.chatId],
          msgKey: "sampleText",
          msgParam: JSON.stringify({
            content: typeof message.content === "string" ? message.content : message.content[0].text,
          }),
        }),
      }
    );

    const data = await response.json();
    return data.processQueryKey;
  }

  // AI Card Streaming Support
  async sendInitial(chatId: string, content: string): Promise<string> {
    const response = await fetch(
      `https://api.dingtalk.com/v1.0/card/instances`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-acs-dingtalk-access-token": this.accessToken!,
        },
        body: JSON.stringify({
          cardTemplateId: this.cardTemplateId,
          openConversationId: chatId,
          callbackRouteKey: this.robotCode,
          cardData: JSON.stringify({ content }),
        }),
      }
    );

    const data = await response.json();
    this.messages.set(chatId, data.cardInstanceId);
    return data.cardInstanceId;
  }

  async editMessage(chatId: string, messageId: string, content: string): Promise<void> {
    await fetch(
      `https://api.dingtalk.com/v1.0/card/instances`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-acs-dingtalk-access-token": this.accessToken!,
        },
        body: JSON.stringify({
          cardInstanceId: messageId,
          cardData: JSON.stringify({ content }),
        }),
      }
    );
  }

  async getChannels(): Promise<Channel[]> {
    const response = await fetch(
      `https://api.dingtalk.com/v1.0/contact/departments/subDepartmentIds?deptId=1`,
      {
        headers: {
          "x-acs-dingtalk-access-token": this.accessToken!,
        },
      }
    );

    const data = await response.json();
    // Map departments and groups to channels
    return data.result?.map((dept: any) => ({
      id: dept.chatId || dept.deptId,
      name: dept.name,
      type: "group" as const,
    })) ?? [];
  }
}
```

---

## 6. Adapter Factory

```typescript
type AdapterConfig =
  | { platform: "telegram"; config: { botToken: string } }
  | { platform: "discord"; config: { botToken: string } }
  | { platform: "dingtalk"; config: DingTalkConfig }
  | { platform: "wechat"; config: WeChatConfig }
  | { platform: "qq"; config: QQConfig }
  | { platform: "feishu"; config: FeishuConfig }
  | { platform: "xiaoyi"; config: XiaoyiConfig }
  | { platform: "whatsapp"; config: WhatsAppConfig }
  | { platform: "slack"; config: SlackConfig }
  | { platform: "email"; config: EmailConfig };

function createAdapter(config: AdapterConfig): IMAdapter {
  switch (config.platform) {
    case "telegram":
      return new TelegramAdapter(config.config);
    case "discord":
      return new DiscordAdapter(config.config);
    case "dingtalk":
      return new DingTalkAdapter(config.config);
    // ... other platforms
    default:
      throw new Error(`Unknown platform: ${(config as any).platform}`);
  }
}
```

---

## 7. Adapter Manager

```typescript
class IMAdapterManager {
  private adapters: Map<string, IMAdapter> = new Map();

  async connect(platform: string, config: AdapterConfig["config"]): Promise<void> {
    const adapter = createAdapter({ platform, config } as AdapterConfig);
    await adapter.connect();
    this.adapters.set(platform, adapter);
  }

  async disconnect(platform: string): Promise<void> {
    const adapter = this.adapters.get(platform);
    if (adapter) {
      await adapter.disconnect();
      this.adapters.delete(platform);
    }
  }

  getAdapter(platform: string): IMAdapter | undefined {
    return this.adapters.get(platform);
  }

  getStatus(): Record<string, ConnectionStatus> {
    const status: Record<string, ConnectionStatus> = {};
    for (const [platform, adapter] of this.adapters) {
      status[platform] = adapter.status;
    }
    return status;
  }

  broadcast(message: IMMessage, platforms?: string[]): Promise<void[]> {
    const targets = platforms ?? Array.from(this.adapters.keys());
    return Promise.all(
      targets.map(platform => {
        const adapter = this.adapters.get(platform);
        return adapter?.send(message);
      }).filter(Boolean)
    );
  }
}
```

---

## 8. Platform Comparison

| Platform | Protocol | Streaming | Channels | Special Features |
|----------|----------|-----------|----------|------------------|
| Telegram | Bot API | No | ✓ | Inline keyboards |
| Discord | Gateway | No | ✓ | Slash commands |
| DingTalk | REST API | ✓ (AI Card) | ✓ | Department sync |
| WeChat | WebSocket | No | ✓ | Contact sync |
| QQ | OneBot | No | ✓ | Group management |
| Feishu | Open API | No | ✓ | Multi-table |
| Xiaoyi | WebSocket | No | ✓ | Voice, AK/SK |
| WhatsApp | baileys | No | ✓ | No official API |
| Slack | Web API | No | ✓ | App home |
| Email | IMAP/SMTP | No | ✓ | Folder sync |

---

*Document Version: 1.0.0*
*Last Updated: 2026-03-19*
