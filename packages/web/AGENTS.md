# @sacode/web

> Web UI — Vue 3 + TinyVue + Tailwind CSS

---

## 目录结构

| 目录/文件 | 职责 |
|-----------|------|
| `views/` | 页面级组件（10 个） |
| `components/` | 共享组件（3 个） |
| `router/` | Vue Router 路由配置 |
| `stores/` | Pinia 状态管理 |
| `lib/` | 工具库（API 客户端、WebSocket 客户端） |
| `test/` | 组件测试 |
| `main.ts` | 应用入口 |
| `App.vue` | 根组件 |
| `style.css` | 全局样式（Tailwind 指令） |

## 页面

| 页面 | 路由 | 职责 |
|------|------|------|
| `Login.vue` | `/login` | 登录 + OAuth 按钮 |
| `AuthCallback.vue` | `/auth/callback` | OAuth 回调处理 |
| `Dashboard.vue` | `/dashboard` | 仪表盘 |
| `DashboardLayout.vue` | — | 仪表盘布局容器 |
| `Chat.vue` | `/dashboard/chat` | 聊天界面（流式支持） |
| `IM.vue` | `/dashboard/im` | IM 平台管理 |
| `Agents.vue` | `/dashboard/agents` | Agent 管理 |
| `Plugins.vue` | `/dashboard/plugins` | 插件管理 |
| `Containers.vue` | `/dashboard/containers` | 容器管理 |
| `Settings.vue` | `/dashboard/settings` | 设置页面 |

## 组件

| 组件 | 职责 |
|------|------|
| `MessageRenderer.vue` | Markdown 渲染，代码高亮 |
| `NotificationCenter.vue` | 通知中心 |
| `ShortcutHelp.vue` | 快捷键帮助 |

## 工具库

| 模块 | 职责 |
|------|------|
| `lib/api.ts` | REST API 客户端封装（fetch + auth header） |
| `lib/websocket.ts` | WebSocket 客户端，流式聊天 + 重连 + 心跳 |

## 技术栈

- **Vue 3** — Composition API
- **TinyVue 3.20+** — UI 组件库
- **Tailwind CSS 3.4+** — 原子化样式
- **Pinia** — 状态管理
- **Vue Router** — 路由
- **Vite 6.x** — 构建工具

## 注意事项

- `Settings.vue` 包含 `console.log` 调试语句（生产环境应移除）
- 无独立测试文件 — 测试在 `test/` 目录
