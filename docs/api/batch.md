# Batch Operations API

> 批量操作端点文档

---

## Base URL

```
http://localhost:3000/api
```

---

## Endpoints Overview

| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/chat/sessions/batch-delete` | POST | Batch delete sessions | Yes |
| `/chat/sessions/batch-update` | POST | Batch update sessions | Yes |
| `/chat/messages/batch-delete` | POST | Batch delete messages | Yes |

---

## POST /chat/sessions/batch-delete

批量删除聊天会话。

### Request

```http
POST /api/chat/sessions/batch-delete
Authorization: Bearer <token>
Content-Type: application/json

{
  "sessionIds": ["sess_1", "sess_2", "sess_3"]
}
```

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| sessionIds | string[] | Yes | 会话 ID 列表（最多 100 个） |

### Response

**200 OK**

```json
{
  "success": true,
  "deletedCount": 3,
  "deletedIds": ["sess_1", "sess_2", "sess_3"]
}
```

**400 Bad Request**

```json
{
  "success": false,
  "error": "VALIDATION_ERROR",
  "message": "最多只能批量删除 100 个会话"
}
```

**207 Multi-Status**

部分删除成功：

```json
{
  "success": false,
  "deletedCount": 2,
  "deletedIds": ["sess_1", "sess_2"],
  "failedIds": ["sess_3"],
  "errors": [
    {
      "id": "sess_3",
      "error": "SESSION_NOT_FOUND"
    }
  ]
}
```

### Notes

- 只能删除自己创建的会话
- 删除会话会级联删除所有消息
- 使用数据库事务确保原子性

---

## POST /chat/sessions/batch-update

批量更新会话属性。

### Request

```http
POST /api/chat/sessions/batch-update
Authorization: Bearer <token>
Content-Type: application/json

{
  "sessionIds": ["sess_1", "sess_2"],
  "updates": {
    "pinned": true,
    "metadata": {
      "category": "work"
    }
  }
}
```

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| sessionIds | string[] | Yes | 会话 ID 列表（最多 100 个） |
| updates | object | Yes | 更新内容 |
| updates.title | string | No | 新标题 |
| updates.pinned | boolean | No | 是否置顶 |
| updates.metadata | object | No | 元数据 |

### Response

**200 OK**

```json
{
  "success": true,
  "updatedCount": 2,
  "updatedIds": ["sess_1", "sess_2"]
}
```

---

## POST /chat/messages/batch-delete

批量删除消息。

### Request

```http
POST /api/chat/messages/batch-delete
Authorization: Bearer <token>
Content-Type: application/json

{
  "messageIds": ["msg_1", "msg_2", "msg_3"]
}
```

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| messageIds | string[] | Yes | 消息 ID 列表（最多 100 个） |

### Response

**200 OK**

```json
{
  "success": true,
  "deletedCount": 3,
  "deletedIds": ["msg_1", "msg_2", "msg_3"]
}
```

### Notes

- 只能删除自己会话中的消息
- 删除消息不会触发 AI 重新响应
- 删除后消息内容无法恢复

---

## WebSocket Events

批量操作完成后会推送 WebSocket 事件。

### Batch Delete Sessions Event

```json
{
  "type": "batch:delete:sessions",
  "data": {
    "deletedIds": ["sess_1", "sess_2", "sess_3"],
    "deletedCount": 3
  }
}
```

### Batch Delete Messages Event

```json
{
  "type": "batch:delete:messages",
  "data": {
    "deletedIds": ["msg_1", "msg_2"],
    "deletedCount": 2
  }
}
```

### Batch Update Sessions Event

```json
{
  "type": "batch:update:sessions",
  "data": {
    "updatedIds": ["sess_1", "sess_2"],
    "updatedCount": 2
  }
}
```

---

## Transaction Safety

所有批量操作使用数据库事务：

1. **开始事务**
2. **验证所有权**
3. **执行批量操作**
4. **提交事务** 或 **回滚**

如果任何一条记录操作失败，整个批次将回滚。

---

## Rate Limiting

| Endpoint | Limit | Window |
|----------|-------|--------|
| `POST /chat/sessions/batch-delete` | 10 requests | 1 minute |
| `POST /chat/sessions/batch-update` | 20 requests | 1 minute |
| `POST /chat/messages/batch-delete` | 10 requests | 1 minute |

---

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | 无效输入 |
| `LIMIT_EXCEEDED` | 400 | 超过批量限制 |
| `UNAUTHORIZED` | 401 | 未认证 |
| `FORBIDDEN` | 403 | 无权操作 |
| `SESSION_NOT_FOUND` | 404 | 会话不存在 |
| `MESSAGE_NOT_FOUND` | 404 | 消息不存在 |

---

## Client Example

### React/Vue Example

```typescript
// 批量删除会话
async function batchDeleteSessions(sessionIds: string[]) {
  const response = await fetch('/api/chat/sessions/batch-delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ sessionIds })
  });

  return response.json();
}

// 使用示例
const result = await batchDeleteSessions(['sess_1', 'sess_2', 'sess_3']);
if (result.success) {
  console.log(`成功删除 ${result.deletedCount} 个会话`);
}
```

### WebSocket 监听

```javascript
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);

  if (message.type === 'batch:delete:sessions') {
    // 更新本地状态
    removeSessionsFromLocal(message.data.deletedIds);
  }
};
```

---

*Document Version: 1.0.0*
*Last Updated: 2026-03-22*
