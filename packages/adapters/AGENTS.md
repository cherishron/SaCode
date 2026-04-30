# @sacode/adapters

> IM 适配器 — 10 个平台，统一接口

---

## 适配器列表

| 适配器 | 平台 | 文件 | 技术方案 | getChannels |
|--------|------|------|----------|-------------|
| `WechatAdapter` | 微信 | `wechat.ts` | WebSocket | ✓ 联系人列表 |
| `QQAdapter` | QQ | `qq.ts` | OneBot 协议 | ✓ 群列表 |
| `TelegramAdapter` | Telegram | `telegram.ts` | Bot API | ✓ 聊天列表 |
| `DiscordAdapter` | Discord | `discord.ts` | Gateway + REST | ✓ Guilds + Channels |
| `DingTalkAdapter` | 钉钉 | `dingtalk.ts` | REST API + AI Card 流式 | ✓ 群列表 + 部门 |
| `FeishuAdapter` | 飞书 | `feishu.ts` | Open API | ✓ |
| `XiaoyiAdapter` | 华为小艺 | `xiaoyi.ts` | AK/SK + WebSocket | ✓ |
| `WhatsAppAdapter` | WhatsApp | `whatsapp.ts` | baileys 桥接 | ✓ |
| `SlackAdapter` | Slack | `slack.ts` | Web API + Socket Mode | ✓ |
| `EmailAdapter` | Email | `email.ts` | IMAP + SMTP | ✓ 邮箱文件夹 |

## 核心接口

```typescript
interface IMAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(chatId: string, message: string): Promise<string>;
  getChannels?(): Promise<Channel[]>;
  onMessage(handler: MessageHandler): void;
}
```

## 工厂函数

```typescript
// 通过平台名创建适配器
const adapter = createAdapter({ platform: "telegram", config: { botToken: "..." } });

// 或使用管理器
const manager = new IMAdapterManager();
await manager.connect("telegram", { botToken: "..." });
```

## 钉钉 AI Card 流式输出

```typescript
const dingtalk = new DingTalkAdapter({
  streamingEnabled: true,
  cardTemplateId: "YOUR_TEMPLATE_ID",
});
const msgId = await dingtalk.sendInitial(chatId, "思考中...");
await dingtalk.editMessage(chatId, msgId, "更新内容...");
```

## 目录结构

```
adapters/src/
├── types/     # 共享类型定义 (Platform, IMAdapter, IMConfig, Channel)
├── base.ts    # BaseAdapter 抽象类 + StreamSender 类型
├── wechat.ts  # 微信适配器
├── qq.ts      # QQ 适配器
├── ...        # 各平台适配器
├── index.ts   # 统一导出 + createAdapter + IMAdapterManager
└── __tests__/ # 适配器测试
```

## 注意事项

- 所有适配器继承 `BaseAdapter`，实现 `IMAdapter` 接口
- `createAdapter()` 使用 `as unknown as` 类型转换 — 因各平台 config 类型不同
- WhatsApp 使用 baileys 库桥接，非官方 API
- 钉钉支持 AI Card 流式输出（`sendInitial` + `editMessage`）
