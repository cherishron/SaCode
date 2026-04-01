# Chat API

> Chat endpoints documentation

---

## Base URL

```
http://localhost:3000/api
```

---

## Endpoints Overview

| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/chat` | POST | Send message (streaming) | Yes |
| `/chat/sessions` | GET | List chat sessions | Yes |
| `/chat/sessions` | POST | Create new session | Yes |
| `/chat/sessions/:id` | GET | Get session with messages | Yes |
| `/chat/sessions/:id` | PATCH | Update session | Yes |
| `/chat/sessions/:id` | DELETE | Delete session | Yes |

---

## POST /chat

Send a message and receive streaming response.

### Request

```http
POST /api/chat
Authorization: Bearer <token>
Content-Type: application/json

{
  "sessionId": "sess_123",
  "message": "Hello, how can you help me?",
  "options": {
    "temperature": 0.7,
    "maxTokens": 2000
  }
}
```

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| sessionId | string | No | Session ID (creates new if omitted) |
| message | string | Yes | User message |
| options | object | No | Generation options |
| options.temperature | number | No | Temperature (0-2) |
| options.maxTokens | number | No | Max output tokens |
| options.model | string | No | Override model |

### Response

**200 OK (Streaming)**

Returns a stream of text chunks.

```
data: {"type":"text","text":"Hello"}
data: {"type":"text","text":"!"}
data: {"type":"text","text":" How"}
data: {"type":"text","text":" can"}
data: {"type":"text","text":" I"}
data: {"type":"text","text":" help"}
data: {"type":"text","text":" you"}
data: {"type":"text","text":" today"}
data: {"type":"text","text":"?"}
data: {"type":"usage","usage":{"promptTokens":10,"completionTokens":20}}
data: {"type":"done","sessionId":"sess_123"}
```

### Stream Event Types

| Type | Description |
|------|-------------|
| `text` | Text chunk |
| `tool_call` | Tool/function call |
| `usage` | Token usage info |
| `error` | Error occurred |
| `done` | Stream completed |

### Error Response

```json
{
  "type": "error",
  "error": {
    "code": "RATE_LIMITED",
    "message": "Rate limit exceeded. Please try again later."
  }
}
```

---

## GET /chat/sessions

List all chat sessions for current user.

### Request

```http
GET /api/chat/sessions?page=1&limit=20
Authorization: Bearer <token>
```

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| page | number | 1 | Page number |
| limit | number | 20 | Items per page |

### Response

**200 OK**

```json
{
  "sessions": [
    {
      "id": "sess_123",
      "title": "Help with TypeScript",
      "createdAt": "2026-03-19T10:00:00Z",
      "updatedAt": "2026-03-19T10:30:00Z",
      "messageCount": 15
    },
    {
      "id": "sess_456",
      "title": "API Design Discussion",
      "createdAt": "2026-03-18T14:00:00Z",
      "updatedAt": "2026-03-18T15:00:00Z",
      "messageCount": 8
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "totalPages": 3
  }
}
```

---

## POST /chat/sessions

Create a new chat session.

### Request

```http
POST /api/chat/sessions
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "New Conversation",
  "metadata": {
    "source": "web"
  }
}
```

### Response

**201 Created**

```json
{
  "id": "sess_789",
  "title": "New Conversation",
  "createdAt": "2026-03-19T11:00:00Z",
  "updatedAt": "2026-03-19T11:00:00Z",
  "messageCount": 0
}
```

---

## GET /chat/sessions/:id

Get session details with messages.

### Request

```http
GET /api/chat/sessions/sess_123
Authorization: Bearer <token>
```

### Response

**200 OK**

```json
{
  "id": "sess_123",
  "title": "Help with TypeScript",
  "createdAt": "2026-03-19T10:00:00Z",
  "updatedAt": "2026-03-19T10:30:00Z",
  "messages": [
    {
      "id": "msg_1",
      "role": "user",
      "content": "How do I use generics in TypeScript?",
      "timestamp": "2026-03-19T10:00:00Z"
    },
    {
      "id": "msg_2",
      "role": "assistant",
      "content": "Generics in TypeScript allow you to write flexible, reusable code...",
      "timestamp": "2026-03-19T10:00:05Z"
    }
  ]
}
```

**404 Not Found**

```json
{
  "error": "SESSION_NOT_FOUND",
  "message": "Session not found"
}
```

---

## PATCH /chat/sessions/:id

Update session properties.

### Request

```http
PATCH /api/chat/sessions/sess_123
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "TypeScript Generics Help"
}
```

### Response

**200 OK**

```json
{
  "id": "sess_123",
  "title": "TypeScript Generics Help",
  "updatedAt": "2026-03-19T11:30:00Z"
}
```

---

## DELETE /chat/sessions/:id

Delete a chat session.

### Request

```http
DELETE /api/chat/sessions/sess_123
Authorization: Bearer <token>
```

### Response

**204 No Content**

---

## WebSocket Connection

For real-time chat, connect via WebSocket.

### Connection

```javascript
const ws = new WebSocket('ws://localhost:3000/ws', {
  headers: {
    Authorization: 'Bearer <token>'
  }
});
```

### Message Format

**Send Message**

```json
{
  "type": "message",
  "sessionId": "sess_123",
  "content": "Hello!"
}
```

**Receive Events**

```json
// Text chunk
{"type": "stream", "text": "Hello"}

// Tool call
{"type": "tool_call", "toolCall": {"id": "call_1", "function": {...}}}

// Completed
{"type": "done", "sessionId": "sess_123"}

// Error
{"type": "error", "error": {"code": "...", "message": "..."}}
```

---

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `SESSION_NOT_FOUND` | 404 | Session does not exist |
| `UNAUTHORIZED` | 401 | Not authenticated |
| `RATE_LIMITED` | 429 | Too many requests |
| `PROVIDER_ERROR` | 502 | AI provider error |
| `CONTEXT_TOO_LONG` | 400 | Message history too long |

---

*Document Version: 1.0.0*
*Last Updated: 2026-03-19*
