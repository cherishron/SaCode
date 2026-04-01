# Notifications API

> 系统通知管理端点文档

---

## Base URL

```
http://localhost:3000/api
```

---

## Endpoints Overview

| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/notifications` | GET | List notifications | Yes |
| `/notifications/unread-count` | GET | Get unread count | Yes |
| `/notifications` | POST | Create notification | Yes |
| `/notifications/:id/read` | POST | Mark as read | Yes |
| `/notifications/read-all` | POST | Mark all as read | Yes |
| `/notifications/:id` | DELETE | Delete notification | Yes |
| `/notifications/clear` | DELETE | Clear notifications | Yes |

---

## GET /notifications

获取通知列表。

### Request

```http
GET /api/notifications?unreadOnly=false&type=system&limit=20&offset=0
Authorization: Bearer <token>
```

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| unreadOnly | boolean | false | 仅返回未读通知 |
| type | string | - | 按类型过滤 |
| limit | number | 20 | 每页数量 |
| offset | number | 0 | 偏移量 |

### Response

**200 OK**

```json
{
  "notifications": [
    {
      "id": "notif_123",
      "type": "task_complete",
      "priority": "normal",
      "title": "任务完成",
      "message": "数据分析任务已完成",
      "data": {
        "taskId": "task_456",
        "resultUrl": "/tasks/task_456"
      },
      "read": false,
      "createdAt": "2026-03-22T10:00:00Z"
    },
    {
      "id": "notif_124",
      "type": "system",
      "priority": "high",
      "title": "系统更新",
      "message": "系统将于今晚 22:00 进行维护",
      "data": null,
      "read": true,
      "createdAt": "2026-03-22T09:00:00Z"
    }
  ],
  "total": 45,
  "unreadCount": 12
}
```

---

## GET /notifications/unread-count

获取未读通知数量。

### Request

```http
GET /api/notifications/unread-count
Authorization: Bearer <token>
```

### Response

**200 OK**

```json
{
  "unreadCount": 12
}
```

---

## POST /notifications

创建新通知（内部使用）。

### Request

```http
POST /api/notifications
Authorization: Bearer <token>
Content-Type: application/json

{
  "type": "task_complete",
  "priority": "normal",
  "title": "任务完成",
  "message": "数据分析任务已完成",
  "data": {
    "taskId": "task_456"
  }
}
```

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| type | string | Yes | 通知类型 |
| priority | string | No | 优先级 (low/normal/high/urgent) |
| title | string | Yes | 通知标题 |
| message | string | Yes | 通知内容 |
| data | object | No | 附加数据 |
| expiresAt | string | No | 过期时间 |

### Notification Types

| Type | Description |
|------|-------------|
| `system` | 系统通知 |
| `task_complete` | 任务完成通知 |
| `task_failed` | 任务失败通知 |
| `message` | 消息通知 |
| `im_status` | IM 状态变更 |
| `warning` | 警告通知 |
| `info` | 信息通知 |

### Response

**201 Created**

```json
{
  "id": "notif_125",
  "type": "task_complete",
  "priority": "normal",
  "title": "任务完成",
  "message": "数据分析任务已完成",
  "data": {
    "taskId": "task_456"
  },
  "read": false,
  "createdAt": "2026-03-22T10:30:00Z"
}
```

---

## POST /notifications/:id/read

标记单条通知为已读。

### Request

```http
POST /api/notifications/notif_123/read
Authorization: Bearer <token>
```

### Response

**200 OK**

```json
{
  "success": true,
  "notification": {
    "id": "notif_123",
    "read": true
  }
}
```

---

## POST /notifications/read-all

标记所有通知为已读。

### Request

```http
POST /api/notifications/read-all
Authorization: Bearer <token>
Content-Type: application/json

{
  "type": "task_complete"
}
```

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| type | string | No | 仅标记指定类型 |

### Response

**200 OK**

```json
{
  "success": true,
  "updatedCount": 8
}
```

---

## DELETE /notifications/:id

删除单条通知。

### Request

```http
DELETE /api/notifications/notif_123
Authorization: Bearer <token>
```

### Response

**200 OK**

```json
{
  "success": true
}
```

---

## DELETE /notifications/clear

批量清除通知。

### Request

```http
DELETE /api/notifications/clear?type=system&readOnly=true
Authorization: Bearer <token>
```

### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| type | string | 仅清除指定类型 |
| readOnly | boolean | 仅清除已读通知 |

### Response

**200 OK**

```json
{
  "success": true,
  "deletedCount": 15
}
```

---

## WebSocket Events

通知通过 WebSocket 实时推送。

### Event Types

| Event | Description |
|-------|-------------|
| `notification:created` | 新通知创建 |

### Notification Created Event

```json
{
  "type": "notification:created",
  "data": {
    "id": "notif_125",
    "type": "task_complete",
    "priority": "normal",
    "title": "任务完成",
    "message": "数据分析任务已完成",
    "read": false,
    "createdAt": "2026-03-22T10:30:00Z"
  }
}
```

### Client Example

```javascript
const ws = new WebSocket('ws://localhost:3000/ws', {
  headers: {
    Authorization: 'Bearer <token>'
  }
});

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);

  if (message.type === 'notification:created') {
    console.log('New notification:', message.data);
    // 显示通知提示
    showNotificationToast(message.data);
  }
};
```

---

## Browser Notifications

前端支持浏览器原生通知。

### Request Permission

```javascript
// 请求浏览器通知权限
const permission = await Notification.requestPermission();
// 'granted' | 'denied' | 'default'
```

### Show Notification

当收到 WebSocket 通知事件时，自动显示浏览器通知：

```javascript
if (Notification.permission === 'granted') {
  new Notification(notification.title, {
    body: notification.message,
    icon: '/favicon.ico',
    tag: notification.id
  });
}
```

---

## Rate Limiting

| Endpoint | Limit | Window |
|----------|-------|--------|
| `POST /notifications` | 100 requests | 1 minute |

---

## Storage

通知存储在内存中，每个用户最多保留 100 条通知。

未来版本将支持：
- 数据库持久化存储
- 自定义保留策略
- 通知分组和归档

---

*Document Version: 1.0.0*
*Last Updated: 2026-03-22*
