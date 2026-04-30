# @sacode/api

> REST API + WebSocket — Express 服务端

---

## 路由文件

| 文件 | 端点前缀 | 职责 |
|------|----------|------|
| `auth.ts` | `/api/auth` | 注册、登录、登出、OAuth 跳转/回调 |
| `chat.ts` | `/api/chat` | 消息发送、Agentic 聊天、会话 CRUD |
| `im.ts` | `/api/im` | IM 连接列表、连接/断开 |
| `im-chat.ts` | `/api/im/chat` | IM 聊天端点 |
| `tasks.ts` | `/api/tasks` | 长任务创建/启动/暂停/取消 |
| `routing.ts` | `/api/routing` | 智能路由规则管理、评估 |
| `memory.ts` | `/api/memory` | 内存管理 API |
| `models.ts` | `/api/models` | 模型列表、切换 |
| `media.ts` | `/api/media` | 媒体处理 |
| `capabilities.ts` | `/api/capabilities` | 能力列表 |
| `plugins.ts` | `/api/plugins` | 插件列表、管理 |
| `containers.ts` | `/api/containers` | 容器管理 |
| `notifications.ts` | `/api/notifications` | 通知管理 |
| `settings.ts` | `/api/settings` | 系统设置 |

## WebSocket

- `SACODEWebSocketServer` — 提供 `/ws` 实时通信端点
- 支持流式聊天、重连、心跳

## 入口点

- **服务入口**: `src/server.ts` → Express app 初始化 + 中间件挂载
- **导出**: `app`, `routes`, `SACODEWebSocketServer`, `wsEvents`

## 测试

- `routes/__tests__/` — 路由集成测试
- `routes/__tests__/search.test.ts` — 搜索引擎完整 mock 实现

## 依赖

```
api ← adapters, auth, core, database, capabilities
```
