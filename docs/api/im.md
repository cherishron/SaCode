# IM Management API

> IM platform management endpoints documentation

---

## Base URL

```
http://localhost:3000/api
```

---

## Endpoints Overview

| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/im` | GET | List IM connections | Yes |
| `/im/:platform/connect` | POST | Connect to platform | Yes |
| `/im/:platform/disconnect` | POST | Disconnect from platform | Yes |
| `/im/:platform/channels` | GET | Get platform channels | Yes |
| `/im/:platform/send` | POST | Send message to platform | Yes |
| `/im/:platform/status` | GET | Get connection status | Yes |

---

## GET /im

List all IM connection configurations.

### Request

```http
GET /api/im
Authorization: Bearer <token>
```

### Response

**200 OK**

```json
{
  "connections": [
    {
      "platform": "telegram",
      "status": "connected",
      "connectedAt": "2026-03-19T10:00:00Z",
      "channels": 15
    },
    {
      "platform": "discord",
      "status": "connected",
      "connectedAt": "2026-03-19T10:05:00Z",
      "channels": 8
    },
    {
      "platform": "wechat",
      "status": "disconnected",
      "connectedAt": null,
      "channels": 0
    }
  ]
}
```

---

## POST /im/:platform/connect

Connect to an IM platform.

### Request

```http
POST /api/im/telegram/connect
Authorization: Bearer <token>
Content-Type: application/json

{
  "botToken": "YOUR_BOT_TOKEN"
}
```

### Platform-Specific Config

| Platform | Required Fields |
|----------|-----------------|
| telegram | `botToken` |
| discord | `botToken` |
| wechat | `appId`, `appSecret` |
| qq | `botId`, `accessToken` |
| dingtalk | `appKey`, `appSecret`, `robotCode` |
| feishu | `appId`, `appSecret` |
| xiaoyi | `ak`, `sk`, `agentId` |
| slack | `botToken`, `appToken` |
| email | `imapHost`, `smtpHost`, `user`, `password` |

### Response

**200 OK**

```json
{
  "success": true,
  "platform": "telegram",
  "status": "connected",
  "connectedAt": "2026-03-19T11:00:00Z"
}
```

**400 Bad Request**

```json
{
  "success": false,
  "error": "INVALID_CONFIG",
  "message": "Missing required field: botToken"
}
```

---

## POST /im/:platform/disconnect

Disconnect from an IM platform.

### Request

```http
POST /api/im/telegram/disconnect
Authorization: Bearer <token>
```

### Response

**200 OK**

```json
{
  "success": true,
  "platform": "telegram",
  "status": "disconnected"
}
```

---

## GET /im/:platform/channels

Get available channels for a platform.

### Request

```http
GET /api/im/telegram/channels
Authorization: Bearer <token>
```

### Response

**200 OK**

```json
{
  "platform": "telegram",
  "channels": [
    {
      "id": "-1001234567890",
      "name": "Development Team",
      "type": "group"
    },
    {
      "id": "123456789",
      "name": "john_doe",
      "type": "private"
    }
  ]
}
```

**503 Service Unavailable**

```json
{
  "error": "NOT_CONNECTED",
  "message": "Platform is not connected"
}
```

---

## POST /im/:platform/send

Send a message to an IM platform.

### Request

```http
POST /api/im/telegram/send
Authorization: Bearer <token>
Content-Type: application/json

{
  "chatId": "-1001234567890",
  "content": "Hello from SaClaw!"
}
```

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| chatId | string | Yes | Target chat/channel ID |
| content | string | Yes | Message content |
| replyTo | string | No | Message ID to reply to |

### Response

**200 OK**

```json
{
  "success": true,
  "messageId": "42",
  "chatId": "-1001234567890"
}
```

---

## GET /im/:platform/status

Get detailed connection status.

### Request

```http
GET /api/im/telegram/status
Authorization: Bearer <token>
```

### Response

**200 OK**

```json
{
  "platform": "telegram",
  "status": "connected",
  "connectedAt": "2026-03-19T10:00:00Z",
  "botInfo": {
    "id": "123456789",
    "username": "MyBot",
    "firstName": "My Bot"
  },
  "stats": {
    "messagesReceived": 150,
    "messagesSent": 89,
    "errors": 2
  }
}
```

---

## WebSocket Events

Receive real-time IM messages via WebSocket.

### Event Types

| Event | Description |
|-------|-------------|
| `im:message` | Incoming IM message |
| `im:status` | Connection status change |
| `im:error` | Platform error |

### Message Event

```json
{
  "type": "im:message",
  "platform": "telegram",
  "message": {
    "id": "42",
    "chatId": "-1001234567890",
    "userId": "123456789",
    "content": "Hello bot!",
    "timestamp": "2026-03-19T12:00:00Z"
  }
}
```

### Status Event

```json
{
  "type": "im:status",
  "platform": "discord",
  "status": "connected"
}
```

---

## Supported Platforms

| Platform | Status | Features |
|----------|--------|----------|
| Telegram | ✅ Stable | Messages, Channels, Inline Keyboards |
| Discord | ✅ Stable | Messages, Guilds, Slash Commands |
| DingTalk | ✅ Stable | Messages, AI Card Streaming |
| Feishu | ✅ Stable | Messages, Multi-tables |
| WeChat | ⚠️ Beta | Messages, Contacts |
| QQ | ⚠️ Beta | Messages, Groups |
| Xiaoyi | ⚠️ Beta | Messages, Voice |
| Slack | ✅ Stable | Messages, Channels |
| WhatsApp | ⚠️ Beta | Messages |
| Email | ✅ Stable | Send/Receive |

---

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `NOT_CONNECTED` | 503 | Platform not connected |
| `INVALID_CONFIG` | 400 | Invalid configuration |
| `CONNECTION_FAILED` | 502 | Failed to connect |
| `SEND_FAILED` | 502 | Failed to send message |
| `RATE_LIMITED` | 429 | Platform rate limited |
| `UNAUTHORIZED` | 401 | Not authenticated |

---

*Document Version: 1.0.0*
*Last Updated: 2026-03-19*
