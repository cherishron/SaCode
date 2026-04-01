# User Manual

> SACODE user guide and documentation

---

## Getting Started

### First Login

1. Open SACODE in your browser (default: http://localhost:5173)
2. Click "Register" to create an account
3. Enter username, email, and password
4. Click "Register" button
5. You'll be automatically logged in

### OAuth Login

Alternatively, use OAuth providers:
1. Click the OAuth button (GitHub, Google, WeChat, QQ)
2. Authorize the application
3. You'll be redirected back to the dashboard

---

## Dashboard

### Overview

The dashboard provides:
- Quick stats (messages, sessions, connections)
- Recent activity feed
- Navigation menu

### Navigation

| Menu Item | Description |
|-----------|-------------|
| Overview | Dashboard home |
| Chat | AI chat interface |
| IM Platforms | IM connection management |
| Tasks | Long-running tasks |
| Plugins | Plugin management |
| Settings | User preferences |

---

## AI Chat

### Starting a Conversation

1. Click "Chat" in the navigation
2. Type your message in the input field
3. Press Enter or click Send
4. AI responds with streaming text

### Chat Features

| Feature | Description |
|---------|-------------|
| Streaming | Real-time text output |
| Markdown | Formatted responses |
| Code Blocks | Syntax highlighting |
| Session History | Previous conversations |

### Session Management

- **New Chat**: Click "+ New Chat" button
- **Switch Session**: Click session in sidebar
- **Delete Session**: Click trash icon on session
- **Rename Session**: Click session title

### Batch Operations

批量管理会话和消息：

#### 批量删除会话

1. 在会话列表中勾选多个会话
2. 点击顶部"删除"按钮
3. 确认删除操作

#### 批量删除消息

1. 在对话中勾选多条消息
2. 点击"删除选中"按钮
3. 确认删除操作

#### 批量更新会话

1. 勾选多个会话
2. 选择操作（置顶、归档等）
3. 应用更改

**注意**：批量操作不可撤销，请谨慎操作。

### Search Messages

搜索历史消息：

1. 按 `Ctrl + K` 打开搜索
2. 输入搜索关键词
3. 查看搜索结果
4. 点击结果跳转到对应消息

#### 高级搜索

| 过滤器 | 说明 |
|--------|------|
| 时间范围 | 限定搜索日期范围 |
| 类型过滤 | 仅显示用户/助手消息 |
| 会话过滤 | 在特定会话中搜索 |

#### 搜索语法

| 语法 | 示例 |
|------|------|
| 精确匹配 | `"exact phrase"` |
| 排除词 | `TypeScript -JavaScript` |
| 或搜索 | `API | REST` |

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message |
| `Shift + Enter` | New line |
| `Ctrl + N` | New session |

---

## Keyboard Shortcuts

SACODE 提供全局快捷键支持，提高操作效率。

### 显示快捷键帮助

按 `Ctrl + /` 或 `?` 显示快捷键帮助面板。

### 导航快捷键

| Shortcut | Action |
|----------|--------|
| `Ctrl + G` | 前往首页 |
| `Ctrl + Shift + G` | 前往对话 |
| `Ctrl + I` | 前往 IM 管理 |
| `Ctrl + ,` | 前往设置 |

### 操作快捷键

| Shortcut | Action |
|----------|--------|
| `Ctrl + N` | 新建对话 |
| `Ctrl + K` | 打开搜索 |
| `Ctrl + Shift + T` | 切换主题 |

### 聊天快捷键

| Shortcut | Action |
|----------|--------|
| `Ctrl + Enter` | 发送消息 |
| `Ctrl + Shift + Delete` | 清空对话 |

### 系统快捷键

| Shortcut | Action |
|----------|--------|
| `Ctrl + /` | 显示快捷键帮助 |
| `Esc` | 关闭弹窗/取消 |

### 平台差异

快捷键在不同操作系统上略有差异：

| Windows/Linux | macOS |
|---------------|-------|
| `Ctrl` | `⌘` (Cmd) |
| `Alt` | `⌥` (Option) |
| `Shift` | `⇧` (Shift) |

---

## IM Platforms

### Connecting a Platform

1. Go to "IM Platforms" page
2. Click "Connect" for desired platform
3. Enter platform credentials:
   - **Telegram**: Bot token from @BotFather
   - **Discord**: Bot token from Developer Portal
   - **DingTalk**: AppKey, AppSecret, RobotCode
4. Click "Connect"

### Managing Connections

| Action | Description |
|--------|-------------|
| Connect | Establish connection |
| Disconnect | Close connection |
| Refresh | Reload channel list |
| Settings | Edit configuration |

### Sending Messages

1. Select connected platform
2. Choose target channel
3. Type message
4. Click Send

---

## Notification Center

通知中心用于接收和管理系统通知、任务完成通知等。

### 访问通知中心

点击页面右上角的铃铛图标打开通知中心。

### 通知类型

| 类型 | 描述 |
|------|------|
| 系统 | 系统更新、维护通知 |
| 任务完成 | 后台任务完成通知 |
| 任务失败 | 任务执行失败通知 |
| 消息 | 新消息提醒 |
| IM 状态 | IM 平台连接状态变更 |
| 警告 | 重要警告信息 |
| 信息 | 一般信息通知 |

### 通知操作

| 操作 | 说明 |
|------|------|
| 点击通知 | 标记已读并跳转（如有链接） |
| 全部已读 | 标记所有通知为已读 |
| 清除已读 | 删除所有已读通知 |
| 删除 | 删除单条通知 |

### 过滤通知

在通知中心顶部可以：

- **标签过滤**：切换"全部"或"未读"
- **类型过滤**：选择特定通知类型

### 浏览器通知

SACODE 支持浏览器原生通知：

1. 首次访问时会请求通知权限
2. 允许后，新通知会显示为浏览器通知
3. 点击浏览器通知可跳转到应用

### 通知设置

在设置页面可以：

- 开启/关闭浏览器通知
- 配置通知声音
- 设置免打扰时段

---

### Profile Settings

- Change avatar
- Update display name
- Modify email address

### Security Settings

- Change password
- Enable two-factor auth (coming soon)
- Manage OAuth connections

### AI Settings

- Select default AI model
- Set temperature
- Configure max tokens

### Notification Settings

- Enable/disable notifications
- Configure notification channels

---

## CLI Usage

### Installation

```bash
npm install -g @SACODE/cli
```

### Commands

| Command | Description |
|---------|-------------|
| `SACODE chat` | Interactive chat |
| `SACODE chat -m "message"` | Single message |
| `SACODE config list` | Show configuration |
| `SACODE im list` | List IM connections |
| `SACODE start` | Start server |

### Interactive Chat

```bash
$ SACODE chat

> Hello!
AI: Hello! How can I help you today?

> Tell me a joke
AI: Why don't scientists trust atoms?
     Because they make up everything!

> /exit
Goodbye!
```

### CLI Options

| Option | Description |
|--------|-------------|
| `-m, --message` | Send single message |
| `-p, --provider` | Specify AI provider |
| `--model` | Specify AI model |
| `-h, --help` | Show help |

---

## Advanced Features

### Long-Running Tasks

Tasks that take time to complete:
1. Background execution
2. Progress tracking
3. Pause/resume support
4. Result notification

### Smart Routing

Configure message routing rules:
1. Go to Settings > Routing
2. Add new rule
3. Set conditions and actions
4. Enable rule

### MCP Protocol

Use Model Context Protocol:
1. Configure MCP server
2. Register tools
3. Access via chat commands

### Plugins

Extend functionality:
1. Go to Plugins page
2. Browse available plugins
3. Install desired plugin
4. Configure plugin settings

---

## Troubleshooting

### Chat Not Responding

1. Check API key configuration
2. Verify network connectivity
3. Check provider service status

### IM Connection Failed

1. Verify credentials
2. Check platform API status
3. Review firewall settings

### Slow Response

1. Check server resources
2. Review provider latency
3. Consider caching options

### Login Issues

1. Clear browser cache
2. Reset password
3. Try different browser

---

## FAQ

**Q: How do I switch AI models?**

A: Go to Settings > AI, select your preferred model from the dropdown.

**Q: Can I use multiple AI providers?**

A: Yes, configure multiple providers and select per-session.

**Q: Is my data secure?**

A: All passwords are hashed with bcrypt. Sessions use JWT tokens. Data is stored locally.

**Q: How do I backup my data?**

A: For SQLite, copy the database file. For MySQL/PostgreSQL, use standard backup tools.

**Q: Can I self-host?**

A: Yes, SACODE is designed for self-hosting. See installation guide.

---

## Support

- **Documentation**: https://github.com/STAND-ALONE/SACODE/docs
- **Issues**: https://github.com/STAND-ALONE/SACODE/issues
- **Email**: 1635936133@qq.com

---

*Document Version: 1.0.0*
*Last Updated: 2026-03-19*
