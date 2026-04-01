# SaCode 产品需求文档 (PRD)

> 版本: 1.2.0
> 日期: 2026-04-01
> 状态: 已实现
> 许可证: MulanPSL-2.0

---

## 目录

- [项目概述](#一项目概述)
- [项目背景与目标](#二项目背景与目标)
- [竞品分析](#三竞品分析)
- [功能需求规范](#四功能需求规范)
- [技术架构](#五技术架构)
- [Monorepo 目录结构](#六monorepo-目录结构)
- [核心模块设计](#七核心模块设计)
- [技术栈汇总](#八技术栈汇总)
- [配置设计](#九配置设计)
- [实施计划](#十实施计划)
- [里程碑](#十一里程碑)
- [风险与对策](#十二风险与对策)
- [完成度统计](#十三完成度统计)

---

## 一、项目概述

### 1.1 产品定位

**SaCode** - 基于 Provider 抽象层的多端 AI 助手框架

### 1.2 核心价值

- 利用 Provider 抽象层支持多个 AI 后端（OpenAI、Anthropic、DeepSeek、Moonshot、智谱）
- 提供多渠道 IM 接入能力（10 个平台）
- 本地自动化执行引擎（文件、浏览器、Shell）
- 统一的 CLI + Web + IM 多端体验
- MCP 协议支持，实现模型上下文标准化
- 智能路由、长任务管理、缓存系统

### 1.3 目标用户

- **个人开发者**：本地 AI 助手，支持代码编写、问题解答
- **企业用户**：多渠道客服机器人，统一管理客户对话
- **团队协作**：IM 集成的 AI 工具，提升工作效率

---

## 二、项目背景与目标

### 2.1 市场背景

AI 助手市场正在快速发展，需求不断增长：
- 多渠道集成需求（IM 平台、Web、CLI）
- 灵活的 AI 后端支持（OpenAI、Anthropic、国内模型）
- 企业级功能需求（认证、缓存、任务管理）

### 2.2 问题陈述

现有解决方案存在局限性：
- **OpenClaw**：Web UI 功能有限，配置复杂
- **商业解决方案**：闭源，厂商锁定
- **单平台工具**：缺乏统一的多渠道支持

### 2.3 解决方案

SaCode 提供：
- **Provider 抽象层**：支持多个 AI 后端（OpenAI、Anthropic、DeepSeek、Moonshot、智谱）
- **多渠道集成**：10 个 IM 平台 + Web + CLI
- **企业级功能**：认证、缓存、长任务管理

### 2.4 主要目标

| 目标 | 描述 |
|------|------|
| **多后端 AI** | 支持 OpenAI、Anthropic、DeepSeek、Moonshot、智谱 |
| **多渠道 IM** | 支持 10 个消息平台 |
| **统一接口**：跨所有后端和渠道的一致 API |
| **可扩展性**：插件系统用于自定义功能 |

### 2.5 成功标准

- 所有 10 个 IM 适配器正常运行
- Provider 抽象层支持所有后端
- Web UI 支持流式聊天
- 150+ 单元测试通过
- 生产就绪的认证系统

### 2.6 利益相关者

| 利益相关者 | 角色 | 关注点 |
|------------|------|--------|
| 开发者 | 终端用户 | 易于集成、文档清晰 |
| 企业用户 | 商业用户 | 稳定性、安全性、可扩展性 |
| 贡献者 | 开源社区 | 代码质量、可扩展性 |

### 2.7 项目范围

**在范围内**：
- Provider 抽象层（OpenAI、Anthropic、国产模型）
- IM 适配器（微信、QQ、Telegram、Discord、钉钉、飞书、小艺、WhatsApp、Slack、Email）
- Web UI（Vue 3 + TinyVue）
- REST API + WebSocket
- 认证（本地 + OAuth）
- 长任务管理
- MCP 协议支持
- 插件系统

**不在范围内**：
- 移动端原生应用（iOS/Android）
- 实时语音/视频通话
- AI 模型训练/微调
- 云托管服务

### 2.8 约束条件

| 约束 | 描述 |
|------|------|
| **技术** | TypeScript、Node.js 22+ |
| **许可证** | MulanPSL-2.0（开源） |
| **部署** | 自托管、Docker 支持 |
| **浏览器支持** | 现代浏览器（Chrome、Firefox、Safari、Edge） |

### 2.9 假设

- 用户已安装 Node.js 22+
- 用户拥有 AI 提供商的有效 API 密钥
- IM 平台允许机器人/API 访问
- 用户可以配置 OAuth 提供商（如需要）

### 2.10 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| AI API 变更 | 中 | 高 | 抽象层、版本锁定 |
| IM 平台政策变更 | 中 | 高 | 隔离适配器、社区更新 |
| OAuth 提供商变更 | 低 | 中 | 标准 OAuth 2.0 实现 |
| 安全漏洞 | 低 | 高 | 定期审计、依赖更新 |

---

## 三、竞品分析

### 3.1 OpenClaw

| 维度 | 说明 |
|------|------|
| **类型** | 开源个人 AI 助手框架 |
| **技术栈** | Node.js / TypeScript |
| **核心架构** | Gateway (WebSocket 控制平面) + Pi Agent (RPC) |
| **渠道支持** | 20+ 平台 (WhatsApp, Telegram, Slack, Discord, Signal, iMessage 等) |
| **特点** | 本地优先、多 Agent 路由、Voice Wake、Live Canvas、Skills 平台 |

### 3.2 CoClaw

| 维度 | 说明 |
|------|------|
| **类型** | OpenClaw 的 IM 客户端应用 |
| **技术栈** | Vue 3 + Nuxt UI 4 + Tailwind (前端), Express + Prisma + MySQL (后端) |
| **特点** | 跨网络隔离通信、数据本地化、移动优先设计 |

### 3.3 Qclaw

| 维度 | 说明 |
|------|------|
| **类型** | 腾讯商业化微信 AI 助手 |
| **特点** | 微信直连、5000+ Skills 生态、内置国产大模型、本地部署 |

### 3.4 WorkBuddy

| 维度 | 说明 |
|------|------|
| **类型** | 腾讯企业级桌面智能体工作台 |
| **特点** | 多 Agents 并行、MCP/Skills 扩展、办公自动化 |

### 3.5 对比总结

| 维度 | OpenClaw | CoClaw | Qclaw | WorkBuddy | **SaCode** |
|------|----------|--------|-------|-----------|------------|
| **开源** | ✅ | ✅ | ❌ | ❌ | ✅ |
| **技术栈** | Node.js/TS | Vue3/Express | 闭源 | 闭源 | **TypeScript** |
| **AI 核心** | 自研 | OpenClaw | 自研 | 自研 | **Provider 抽象层** |
| **主要渠道** | 20+ 平台 | 独立 IM | 微信 | 桌面 | **10 平台** |
| **Web UI** | 基础 | 完整 | 无 | 完整 | **完整 (Vue3)** |
| **认证系统** | 配对验证 | 无 | 微信 | 企业 | **混合认证** |
| **MCP 协议** | ✅ | ❌ | ❌ | ✅ | **✅** |
| **缓存系统** | ❌ | ❌ | ❌ | ❌ | **✅** |
| **长任务** | ❌ | ❌ | ❌ | ✅ | **✅** |
| **多模型支持** | ❌ | ❌ | ✅ | ❌ | **✅** |
| **智能路由** | ❌ | ❌ | ❌ | ❌ | **✅** |

---

## 四、功能需求规范

### 4.1 核心功能

#### 4.1.1 Provider 抽象层

**优先级：P0（关键）**

| 功能 | 描述 | 验收标准 |
|------|------|----------|
| 多后端支持 | 支持 OpenAI、Anthropic、DeepSeek、Moonshot、智谱 | 所有后端正常运行 |
| 流式输出 | 通过 AsyncGenerator 实现实时文本流式传输 | 无缓冲延迟 |
| 工具调用 | Function calling / tool use 支持 | 正确的参数累积 |
| 错误恢复 | 指数退避的自动重试 | 处理网络错误 |
| Edge Runtime 兼容 | 适用于 Cloudflare Workers、Vercel Edge | 无 process.env 依赖 |

#### 4.1.2 会话管理

**优先级：P0（关键）**

| 功能 | 描述 | 验收标准 |
|------|------|----------|
| 会话创建 | 创建和管理聊天会话 | 唯一会话 ID |
| 跨渠道映射 | 跨 IM 平台映射会话 | 统一的对话上下文 |
| 历史持久化 | 存储和检索对话历史 | 数据库支持的存储 |
| 会话清理 | 自动清理过期会话 | 可配置 TTL |

#### 4.1.3 认证系统

**优先级：P0（关键）**

| 功能 | 描述 | 验收标准 |
|------|------|----------|
| 本地认证 | 用户名/密码登录 | bcrypt 哈希、JWT 令牌 |
| OAuth 2.0 | GitHub、Google、微信、QQ、企业微信 | 标准 OAuth 流程 |
| 会话管理 | 令牌刷新、登出 | 安全的会话处理 |
| 密码管理 | 修改密码、密码重置 | 安全的密码策略 |

### 4.2 IM 平台功能

#### 4.2.1 适配器接口

**优先级：P0（关键）**

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

#### 4.2.2 平台特定功能

| 平台 | 优先级 | 特殊功能 |
|------|--------|----------|
| Telegram | P0 | Bot API、内联键盘 |
| Discord | P0 | Gateway、斜杠命令 |
| 微信 | P1 | 企业机器人、联系人同步 |
| QQ | P1 | OneBot 协议、群管理 |
| 钉钉 | P1 | AI Card 流式输出、部门同步 |
| 飞书 | P2 | 多维表格 |
| 小艺 | P2 | 语音集成、AK/SK 认证 |
| WhatsApp | P2 | baileys 桥接 |
| Slack | P2 | Socket Mode、应用首页 |
| Email | P2 | IMAP/SMTP、文件夹同步 |

### 4.3 API 功能

#### 4.3.1 REST API

**优先级：P0（关键）**

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/auth/login` | POST | 用户登录 |
| `/api/auth/register` | POST | 用户注册 |
| `/api/auth/me` | GET | 当前用户信息 |
| `/api/chat` | POST | 发送消息 |
| `/api/chat/sessions` | GET | 会话列表 |
| `/api/im` | GET | IM 连接列表 |
| `/api/tasks` | GET/POST | 任务管理 |
| `/api/plugins` | GET | 插件列表 |

#### 4.3.2 WebSocket API

**优先级：P1（高）**

| 事件 | 方向 | 描述 |
|------|------|------|
| `message` | 客户端 → 服务器 | 发送聊天消息 |
| `stream` | 服务器 → 客户端 | 流式响应 |
| `task:progress` | 服务器 → 客户端 | 任务进度更新 |
| `im:message` | 服务器 → 客户端 | 传入 IM 消息 |

### 4.4 Web UI 功能

#### 4.4.1 页面

| 页面 | 优先级 | 功能 |
|------|--------|------|
| 登录 | P0 | 本地登录、OAuth 按钮 |
| 仪表盘 | P1 | 统计、快速操作 |
| 聊天 | P0 | 流式聊天、markdown 渲染 |
| IM 管理 | P1 | 连接状态、配置 |
| 设置 | P2 | 用户偏好、API 密钥 |

#### 4.4.2 组件

| 组件 | 描述 |
|------|------|
| MessageRenderer | 支持语法高亮的 Markdown |
| ChatInput | 多行输入、文件附件 |
| IMStatusCard | 连接状态指示器 |

### 4.5 高级功能

#### 4.5.1 长任务运行

**优先级：P1（高）**

- 后台任务执行
- 进度跟踪和报告
- 暂停/恢复/取消支持
- 任务结果存储

#### 4.5.2 智能路由

**优先级：P1（高）**

- 基于规则的消息路由
- 条件匹配（用户层级、渠道等）
- 基于优先级的规则评估
- 动态规则管理

#### 4.5.3 MCP 协议

**优先级：P2（中）**

- Model Context Protocol 服务器/客户端
- 工具注册和执行
- 资源管理
- 标准协议合规

#### 4.5.4 插件系统

**优先级：P2（中）**

- 动态插件加载
- 生命周期钩子
- 配置管理
- 热重载支持

### 4.6 非功能性需求

#### 4.6.1 性能

| 指标 | 要求 |
|------|------|
| API 响应时间 | < 200ms (P95) |
| 流式首 Token | < 1s |
| 并发连接 | 1000+ |
| 内存使用 | < 512MB（空闲） |

#### 4.6.2 安全性

| 要求 | 实现 |
|------|------|
| 密码哈希 | bcrypt（成本因子 10） |
| 令牌安全 | JWT 使用 HS256 |
| 输入验证 | Zod schemas |
| SQL 注入 | Prisma 参数化查询 |
| XSS 预防 | 内容清理 |

#### 4.6.3 可靠性

| 指标 | 要求 |
|------|------|
| 正常运行时间 | 99.9% |
| 错误恢复 | 自动重试（3 次尝试） |
| 数据持久化 | SQLite/MySQL/PostgreSQL |
| 日志记录 | 结构化 JSON 日志 |

### 4.7 用户故事

#### 4.7.1 开发者故事

```
作为一名开发者，
我希望将 AI 聊天集成到我的应用程序中，
以便为我的用户提供 AI 驱动的功能。

验收标准：
- 简单的 SDK 导入
- 流式支持
- 多个后端选项
```

#### 4.7.2 企业用户故事

```
作为一名企业用户，
我希望在多个 IM 渠道部署 AI 助手，
以便我的客户可以通过他们喜欢的平台进行交互。

验收标准：
- 支持 10 个 IM 平台
- 统一的对话历史
- 用户认证
- 管理仪表盘
```

#### 4.7.3 个人用户故事

```
作为一名个人用户，
我希望从命令行和 Web 使用 AI 助手，
以便高效工作而无需切换上下文。

验收标准：
- CLI 聊天模式
- Web UI 访问
- 会话持久化
- 多个 AI 模型选项
```

---

## 五、技术架构

### 5.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                      交互层 (Interface Layer)                    │
├──────────────┬──────────────┬──────────────┬───────────────────┤
│   CLI 工具   │    Web UI    │   IM 集成    │    API Server     │
│  (Commander) │   (Vue 3)    │ (Adapters)   │    (Express)      │
└──────┬───────┴──────┬───────┴──────┬───────┴─────────┬─────────┘
       │              │              │                 │
       └──────────────┴──────────────┴─────────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────┐
│                      核心层 (Core Layer)                         │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │  Session    │  │ SmartRouter │  │     Message Broker      │ │
│  │  Manager    │  │  智能路由    │  │     (Event-Driven)      │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │LongTaskMgr │  │   Provider  │  │      CacheManager       │ │
│  │  长任务管理  │  │   Manager   │  │    (Memory/Redis)       │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              MCP Protocol                                   ││
│  │  - MCPServer       - MCPClient        - BuiltInTools        ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────┐
│                      能力层 (Capability Layer)                   │
├─────────────┬─────────────┬─────────────┬─────────────────────┤
│  文件系统   │  浏览器控制  │  命令执行   │     扩展系统        │
│  (Files)    │  (Browser)  │  (Shell)    │    (Plugins)        │
└─────────────┴─────────────┴─────────────┴─────────────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────┐
│                      存储层 (Storage Layer)                      │
├─────────────┬─────────────┬─────────────┬─────────────────────┤
│   Config    │   History   │   Memory    │      Cache          │
│   (JSON)    │  (SQLite)   │  (Vector)   │  (Memory/Redis)     │
└─────────────┴─────────────┴─────────────┴─────────────────────┘
```

### 5.2 Gateway 架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Gateway 架构                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │  WebSocket  │    │    Auth     │    │   Session   │     │
│  │   Server    │    │  验证中间件   │    │   Manager   │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
│         │                  │                  │            │
│         └──────────────────┼──────────────────┘            │
│                            │                               │
│                   ┌────────┴────────┐                      │
│                   │   Protocol      │                      │
│                   │   Handler       │                      │
│                   └────────┬────────┘                      │
│                            │                               │
│  ┌─────────────────────────┴─────────────────────────────┐│
│  │              Core Services                            ││
│  │  Router | Task | MCP | Cache | Provider | Plugin      ││
│  └───────────────────────────────────────────────────────┘│
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 5.3 认证系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                    认证系统架构                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │  本地账号   │    │  OAuth 2.0  │    │   Session   │     │
│  │  登录/注册  │    │  第三方登录  │    │   管理      │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
│         │                  │                  │            │
│         └──────────────────┼──────────────────┘            │
│                            │                               │
│                   ┌────────┴────────┐                      │
│                   │  Passport.js    │                      │
│                   │  统一认证中间件   │                      │
│                   └────────┬────────┘                      │
│                            │                               │
│  ┌─────────────────────────┴─────────────────────────────┐│
│  │              OAuth Providers                          ││
│  │  ┌──────┐ ┌──────┐ ┌────────┐ ┌──────┐ ┌──────┐     ││
│  │  │GitHub│ │Google│ │企业微信│ │ QQ  │ │ 微信 │      ││
│  │  └──────┘ └──────┘ └────────┘ └──────┘ └──────┘     ││
│  └───────────────────────────────────────────────────────┘│
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 5.4 数据存储架构

```
┌─────────────────────────────────────────────────────────────┐
│                    数据存储架构                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                 Repository Layer                     │   │
│  │  UserRepository | SessionRepo | ConfigRepo | LogRepo │   │
│  └───────────────────────┬─────────────────────────────┘   │
│                          │                                 │
│  ┌───────────────────────┴─────────────────────────────┐   │
│  │                 Database Adapter                    │   │
│  │        (统一接口，支持多数据库切换)                    │   │
│  └───────────────────────┬─────────────────────────────┘   │
│                          │                                 │
│          ┌───────────────┼───────────────┐                │
│          │               │               │                │
│    ┌─────┴─────┐   ┌─────┴─────┐   ┌─────┴─────┐         │
│    │  SQLite   │   │  MySQL    │   │ PostgreSQL│         │
│    │ (默认)    │   │ (可选)    │   │  (可选)   │         │
│    └───────────┘   └───────────┘   └───────────┘         │
│                                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                 Cache Layer                         │   │
│  │         Memory Cache (默认) / Redis (可选)           │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                            │
└─────────────────────────────────────────────────────────────┘
```

---

## 六、Monorepo 目录结构

```
sacode/
├── package.json                 # 根配置
├── pnpm-workspace.yaml          # pnpm 工作区
├── tsconfig.base.json           # 共享 TS 配置
│
├── packages/
│   ├── core/                    # 核心引擎
│   │   ├── src/
│   │   │   ├── client/          # Provider SDK 封装
│   │   │   ├── session/         # 会话管理 + 跨渠道映射
│   │   │   ├── router/          # 消息路由 + SmartRouter
│   │   │   ├── provider/        # Provider 管理器
│   │   │   ├── cache/           # 缓存层 (Memory + Redis)
│   │   │   ├── scheduler/       # 定时任务调度器
│   │   │   ├── task/            # 长任务管理器
│   │   │   ├── mcp/             # MCP 协议实现
│   │   │   ├── streaming/       # 流式输出管理
│   │   │   ├── plugin/          # 插件系统
│   │   │   ├── skills/          # Skills 加载器
│   │   │   ├── memory/          # 内存管理 + 向量嵌入
│   │   │   ├── security/        # 安全管理
│   │   │   ├── workspace/       # 工作区管理
│   │   │   ├── queue/           # 消息队列
│   │   │   └── types/           # 类型定义
│   │   └── package.json
│   │
│   ├── gateway/                 # 统一控制平面
│   │   ├── protocol/            # Gateway 协议
│   │   ├── handlers/            # 消息处理器
│   │   └── session/             # Gateway 会话
│   │
│   ├── container/               # 容器隔离
│   │   └── Docker 容器运行 Agent
│   │
│   ├── auth/                    # 认证模块
│   │   ├── src/
│   │   │   ├── local/           # 本地账号认证
│   │   │   ├── oauth/           # OAuth 集成
│   │   │   │   ├── github.ts
│   │   │   │   ├── google.ts
│   │   │   │   ├── wechat.ts
│   │   │   │   ├── wework.ts
│   │   │   │   └── qq.ts
│   │   │   ├── session/         # Session 管理
│   │   │   └── middleware/      # 认证中间件
│   │   └── package.json
│   │
│   ├── database/                # 数据库模块
│   │   ├── src/
│   │   │   ├── adapter/         # 数据库适配器
│   │   │   ├── repository/      # 数据仓库
│   │   │   ├── models/          # 数据模型
│   │   │   └── migrations/      # 迁移脚本
│   │   └── prisma/
│   │       └── schema.prisma    # Prisma Schema
│   │
│   ├── capabilities/            # 能力模块
│   │   ├── src/
│   │   │   ├── files/           # 文件系统
│   │   │   ├── browser/         # 浏览器控制 (Puppeteer)
│   │   │   ├── shell/           # 命令执行
│   │   │   ├── environment/     # 环境信息
│   │   │   └── tools/           # 工具集
│   │   └── package.json
│   │
│   ├── adapters/                # IM 适配器 (10 个平台)
│   │   ├── src/
│   │   │   ├── types/           # 类型定义
│   │   │   ├── base.ts          # 基础适配器接口
│   │   │   ├── wechat.ts        # 微信
│   │   │   ├── qq.ts            # QQ (OneBot 协议)
│   │   │   ├── telegram.ts      # Telegram Bot API
│   │   │   ├── discord.ts       # Discord Gateway
│   │   │   ├── dingtalk.ts      # 钉钉
│   │   │   ├── feishu.ts        # 飞书
│   │   │   ├── xiaoyi.ts        # 华为小艺
│   │   │   ├── whatsapp.ts      # WhatsApp
│   │   │   ├── slack.ts         # Slack
│   │   │   └── email.ts         # Email (IMAP + SMTP)
│   │   └── package.json
│   │
│   ├── cli/                     # CLI 工具
│   │   ├── src/
│   │   │   ├── commands/        # 命令定义
│   │   │   ├── interactive/     # 交互模式
│   │   │   └── index.ts         # 入口
│   │   └── package.json
│   │
│   ├── api/                     # API Server
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── auth.ts      # 认证 API
│   │   │   │   ├── chat.ts      # 聊天 API
│   │   │   │   ├── im-chat.ts   # IM 聊天 API
│   │   │   │   ├── im.ts        # IM 管理 API
│   │   │   │   ├── tasks.ts     # 长任务 API
│   │   │   │   ├── routing.ts   # 智能路由 API
│   │   │   │   ├── memory.ts    # 内存管理 API
│   │   │   │   ├── models.ts    # 模型管理 API
│   │   │   │   ├── media.ts     # 媒体处理 API
│   │   │   │   ├── capabilities.ts  # 能力 API
│   │   │   │   └── plugins.ts   # 插件 API
│   │   │   ├── middleware/
│   │   │   └── websocket/
│   │   └── package.json
│   │
│   └── web/                     # Web UI (Vue 3 + TinyVue)
│       ├── src/
│       │   ├── views/           # 页面
│       │   │   ├── Login.vue        # 登录页面
│       │   │   ├── AuthCallback.vue # OAuth 回调
│       │   │   ├── Dashboard.vue    # 仪表盘
│       │   │   ├── Chat.vue         # 聊天界面
│       │   │   ├── IM.vue           # IM 管理
│       │   │   └── Settings.vue     # 设置页面
│       │   ├── components/      # 组件
│       │   ├── lib/             # 工具库
│       │   └── stores/          # Pinia 状态管理
│       ├── tailwind.config.js
│       └── package.json
│
├── .sacode/                     # SaCode 配置
│   ├── commands/                # Slash 命令
│   ├── plugins/                 # 插件目录
│   └── skills/                  # Skills 目录
│
├── docs/                        # 文档
│   ├── PRD.md                   # 产品需求文档
│   ├── architecture/            # 架构文档
│   └── guides/                  # 指南文档
│
├── javisk/                      # PCIV 工作流模板
└── tests/                       # 测试文件
```

---

## 七、核心模块设计

### 7.1 @sacode/core - 核心引擎

**职责**: 封装 Provider SDK，提供统一的 AI 交互接口

**核心组件**:

| 组件 | 说明 |
|------|------|
| `SaCodeClient` | Provider SDK 客户端封装 |
| `SessionManager` | 会话管理器 |
| `SessionMapper` | 跨渠道会话映射 |
| `MessageRouter` | 消息路由器 |
| `SmartRouter` | 智能路由引擎 (规则匹配) |
| `LongTaskManager` | 长任务管理器 |
| `TaskScheduler` | 定时任务调度器 |
| `PluginManager` | 插件管理器 |
| `StreamingManager` | 流式输出管理器 |
| `MCPServer/Client` | MCP 协议实现 |
| `ProviderManager` | Provider 管理器 |
| `CacheManager` | 缓存管理器 |
| `MemoryManager` | 内存管理器 |
| `SecurityManager` | 安全管理器 |
| `WorkspaceManager` | 工作区管理器 |
| `GroupQueue` | 群组消息队列 |

```typescript
// 核心类设计
export class SaCodeClient {
  private provider: ProviderClient;
  private sessionManager: SessionManager;
  
  constructor(options: SaCodeOptions) {
    this.provider = createProvider({
      type: options.providerType,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
    });
  }
  
  async chat(message: string, channelId?: string): AsyncGenerator<Message>;
  async stop(): Promise<void>;
}
```

### 7.2 @sacode/gateway - 统一网关

**职责**: 提供 WebSocket 控制平面

```typescript
import { GatewayServer } from "@sacode/gateway";

const gateway = new GatewayServer({
  port: 8080,
  auth: { enabled: true, validateToken: async (token) => ({ userId: "user-1" }) },
});
gateway.start();
```

### 7.3 @sacode/container - 容器隔离

**职责**: Docker 容器运行 Agent，支持沙箱模式

```typescript
import { ContainerManager } from "@sacode/container";

const container = new ContainerManager({
  image: "sacode-agent:latest",
  sandbox: true,
  resourceLimits: { cpu: "1.0", memory: "512m" },
});
await container.start();
```

### 7.4 @sacode/auth - 认证模块

**职责**: 提供混合认证能力

| 认证方式 | 实现方案 |
|----------|----------|
| 本地账号 | 用户名/密码 + bcrypt 加密 |
| GitHub | Passport.js GitHub Strategy |
| Google | Passport.js Google OAuth2 Strategy |
| 微信 | 微信开放平台 OAuth2 |
| 企业微信 | 企业微信 OAuth2 |
| QQ | QQ 互联 OAuth2 |

### 7.5 @sacode/database - 数据库模块

**职责**: 提供可切换的数据存储方案

**数据模型**:

| 模型 | 说明 |
|------|------|
| `User` | 用户表 (支持本地 + OAuth) |
| `Session` | 登录会话 |
| `ChatSession` | 聊天会话 |
| `ChatMessage` | 聊天消息 |
| `IMConnection` | IM 连接配置 |
| `Plugin` | 插件 |
| `SystemConfig` | 系统配置 |
| `CronTask` | 定时任务 |
| `SessionMapping` | 跨渠道会话映射 |

### 7.6 @sacode/capabilities - 能力模块

**职责**: 提供本地自动化能力

| 能力 | 实现方案 | 功能 |
|------|----------|------|
| 文件系统 | Node.js fs | 读写、搜索、监控 |
| 浏览器控制 | Puppeteer | 导航、截图、点击、提取 |
| 命令执行 | child_process | Shell 命令执行 |
| 环境信息 | Node.js os | 系统信息获取 |
| 工具集 | 自定义 | 扩展工具接口 |

### 7.7 @sacode/adapters - IM 适配器

**职责**: 提供多平台 IM 接入

| 平台 | 技术方案 | 备注 |
|------|----------|------|
| 微信 | WebSocket | 企业微信机器人 |
| QQ | OneBot 协议 | 开源 QQ 机器人框架 |
| Telegram | Bot API | 官方 API |
| Discord | Gateway + REST | 成熟的 Node.js 库 |
| 钉钉 | REST API | AI Card 流式输出 |
| 飞书 | Open API | 支持多维表格 |
| 小艺 | AK/SK + WebSocket | 华为语音助手 |
| WhatsApp | baileys 桥接 | 需要桥接服务 |
| Slack | Web API | Socket Mode |
| Email | IMAP + SMTP | 邮件收发 |

**适配器接口**:

```typescript
export interface IMAdapter {
  name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onMessage(handler: MessageHandler): void;
  send(message: IMMessage): Promise<string | undefined>;
  getChannels?(): Promise<Channel[]>;
}
```

### 7.8 @sacode/cli - 命令行工具

**职责**: 提供命令行交互能力

**命令设计**:

```bash
# 交互式聊天
sacode chat

# 发送单条消息
sacode chat -m "你好"

# 启动服务
sacode start [--port 3000]

# IM 管理
sacode im connect telegram
sacode im status

# 配置管理
sacode config set provider.timeout 120000
sacode config list

# 插件管理
sacode plugin install ./my-plugin
sacode plugin list

# 工具管理
sacode tool run read_file --path ./README.md
sacode tool list

# 技能管理
sacode skill search telegram
sacode skill install add-telegram
```

### 7.9 @sacode/api - API 服务

**职责**: 提供 REST API 和 WebSocket 服务

**API 设计**:

| 路由 | 方法 | 功能 |
|------|------|------|
| `/api/auth/login` | POST | 登录 |
| `/api/auth/logout` | POST | 登出 |
| `/api/auth/oauth/:provider` | GET | OAuth 跳转 |
| `/api/auth/oauth/:provider/callback` | GET | OAuth 回调 |
| `/api/chat` | POST | 发送消息 |
| `/api/chat/sessions` | GET | 会话列表 |
| `/api/chat/stream` | WebSocket | 流式响应 |
| `/api/tasks` | GET/POST | 任务列表/创建 |
| `/api/tasks/:id/start` | POST | 启动任务 |
| `/api/tasks/:id/pause` | POST | 暂停任务 |
| `/api/tasks/:id/cancel` | POST | 取消任务 |
| `/api/routing/rules` | GET/POST | 路由规则管理 |
| `/api/routing/evaluate` | POST | 评估路由 |
| `/api/models` | GET | 模型列表 |
| `/api/memory` | GET/POST | 内存管理 |
| `/api/media` | POST | 媒体处理 |
| `/api/im` | GET | IM 连接列表 |
| `/api/im/:id` | PATCH | 更新连接状态 |
| `/api/capabilities` | GET | 能力列表 |
| `/api/sessions` | GET | 会话历史 |
| `/api/plugins` | GET/POST | 插件管理 |

### 7.10 @sacode/web - Web UI

**职责**: 提供响应式 Web 管理界面

**技术栈**: Vue 3 + TinyVue + Tailwind CSS + Pinia

**页面设计**:

| 页面 | 功能 | 移动端适配 |
|------|------|-----------|
| **登录** | 本地登录 + OAuth 按钮 | 居中表单 |
| **OAuth 回调** | 处理 OAuth 授权回调 | 全屏 |
| **仪表盘** | 系统状态、快速操作、最近会话 | 卡片堆叠 |
| **聊天** | AI 对话界面 (流式支持) | 全屏聊天 |
| **IM 管理** | 平台连接状态、配置、消息监控 | 列表 + 详情页 |
| **设置** | 系统配置、认证配置 | 分组表单 |

---

## 八、技术栈汇总

| 层级 | 技术 | 版本 | 说明 |
|------|------|------|------|
| **运行时** | Node.js | 22+ | 满足要求 |
| **语言** | TypeScript | 5.7+ | 严格模式 |
| **AI 核心** | Provider 抽象层 | - | OpenAI/Anthropic/DeepSeek/Moonshot/智谱 |
| **Web 框架** | Vue 3 | 3.5+ | Composition API |
| **UI 组件** | TinyVue | 3.20+ | 企业级设计 |
| **样式** | Tailwind CSS | 3.4+ | 原子化 CSS |
| **状态管理** | Pinia | 2.x | Vue 3 官方推荐 |
| **认证** | Passport.js | 0.7.x | 统一认证 |
| **ORM** | Prisma | 6.x | 类型安全 |
| **数据库** | SQLite / MySQL / PostgreSQL | - | 可切换 |
| **缓存** | Memory / Redis (ioredis) | - | 可选 |
| **浏览器控制** | Puppeteer | latest | 自动化 |
| **包管理** | pnpm | 9.x | Monorepo |
| **构建** | tsup | 8.x | 库构建 |
| **测试** | Vitest | 2.x | 单元测试 |

---

## 九、配置设计

### 9.1 主配置文件

```yaml
# config/default.yaml
server:
  port: 3000
  host: localhost

provider:
  type: openai  # openai | anthropic | deepseek | moonshot | zhipu
  apiKey: ${OPENAI_API_KEY}
  baseUrl: ${OPENAI_BASE_URL}
  timeout: 60000

cache:
  backend: memory  # memory | redis
  defaultTTL: 60000
  keyPrefix: "sacode:"
  redis:
    url: redis://localhost:6379

auth:
  local:
    enabled: true
  oauth:
    github:
      enabled: true
      clientId: ${GITHUB_CLIENT_ID}
      clientSecret: ${GITHUB_CLIENT_SECRET}
    google:
      enabled: true
      clientId: ${GOOGLE_CLIENT_ID}
      clientSecret: ${GOOGLE_CLIENT_SECRET}
    wechat:
      enabled: false
      appId: ${WECHAT_APP_ID}
      appSecret: ${WECHAT_APP_SECRET}
    wework:
      enabled: false
      corpId: ${WEWORK_CORP_ID}
      agentId: ${WEWORK_AGENT_ID}
      secret: ${WEWORK_SECRET}
    qq:
      enabled: false
      appId: ${QQ_APP_ID}
      appKey: ${QQ_APP_KEY}

database:
  type: sqlite  # sqlite | mysql | postgres
  sqlite:
    path: ./data/sacode.db
  mysql:
    host: localhost
    port: 3306
    database: sacode
    username: root
    password: ${MYSQL_PASSWORD}
  postgres:
    host: localhost
    port: 5432
    database: sacode
    username: postgres
    password: ${POSTGRES_PASSWORD}

channels:
  - type: wechat
    enabled: false
  - type: qq
    enabled: false
  - type: telegram
    enabled: false
    token: ${TELEGRAM_BOT_TOKEN}
  - type: discord
    enabled: false
    token: ${DISCORD_BOT_TOKEN}
  - type: dingtalk
    enabled: false
  - type: feishu
    enabled: false
  - type: xiaoyi
    enabled: false
    ak: ${XIAOYI_AK}
    sk: ${XIAOYI_SK}
  - type: whatsapp
    enabled: false
  - type: slack
    enabled: false
  - type: email
    enabled: false

capabilities:
  files:
    enabled: true
    allowedDirs: ['.']
    maxSize: 10485760  # 10MB
    readOnly: false
  browser:
    enabled: true
    headless: true
    timeout: 30000
  shell:
    enabled: true
    allowedCommands: ['git', 'npm', 'pnpm', 'node']
    timeout: 60000

plugins:
  dir: ./plugins
  autoLoad: true
```

---

## 十、实施计划

### Phase 1: 项目初始化 ✅ 完成

- [x] 初始化 pnpm monorepo
- [x] 配置 TypeScript 基础设置
- [x] 创建 packages 目录结构
- [x] 配置 ESLint + Prettier

### Phase 2: 核心模块 ✅ 完成

- [x] 实现 `@sacode/core` - Provider SDK 封装
- [x] 实现 `@sacode/database` - 数据库层
- [x] 实现 `@sacode/auth` - 认证系统
- [x] 实现 `@sacode/gateway` - 统一网关
- [x] 实现 `@sacode/container` - 容器隔离

### Phase 3: CLI 与能力 ✅ 完成

- [x] 实现 `@sacode/cli` - 基础命令
- [x] 实现 `@sacode/capabilities` - 文件系统
- [x] 集成 Puppeteer 浏览器控制

### Phase 4: API 服务 ✅ 完成

- [x] 实现 `@sacode/api` - REST API
- [x] 实现 WebSocket 服务
- [x] 集成认证中间件
- [x] 实现长任务 API
- [x] 实现智能路由 API
- [x] 实现模型管理 API

### Phase 5: Web UI ✅ 完成

- [x] 创建 `@sacode/web` 项目 (Vue 3 + TinyVue)
- [x] 实现登录页面
- [x] 实现聊天界面 (流式支持)
- [x] 实现管理页面
- [x] 响应式适配

### Phase 6: IM 适配器 ✅ 完成

- [x] 实现基础适配器接口
- [x] 实现 Telegram 适配器
- [x] 实现 Discord 适配器
- [x] 实现 QQ 适配器
- [x] 实现微信适配器
- [x] 实现钉钉适配器 (AI Card 流式)
- [x] 实现飞书适配器
- [x] 实现华为小艺适配器
- [x] 实现 WhatsApp 适配器
- [x] 实现 Slack 适配器
- [x] 实现 Email 适配器

### Phase 7: 扩展功能 ✅ 完成

- [x] 插件系统实现
- [x] 缓存层实现 (Memory + Redis)
- [x] Provider 管理器实现
- [x] MCP 协议实现
- [x] 长任务管理器实现
- [x] 智能路由器实现
- [x] Skills 系统

### Phase 8: 测试与文档 ✅ 完成

- [x] 单元测试框架 (Vitest)
- [x] 358 个测试用例
- [x] 文档完善 (AGENTS.md, README.md)
- [x] Docker 支持

---

## 十一、里程碑

| 版本 | 目标 | 内容 | 状态 |
|------|------|------|------|
| **v0.1.0** | 核心可用 | core + database + auth + cli 基础功能 | ✅ |
| **v0.2.0** | 能力扩展 | capabilities + api 服务 | ✅ |
| **v0.3.0** | Web UI | 登录 + 聊天 + 基础管理 | ✅ |
| **v0.4.0** | IM 集成 | Telegram + Discord 适配器 | ✅ |
| **v0.5.0** | 国内 IM | 微信 + QQ + 钉钉 + 飞书适配器 | ✅ |
| **v0.6.0** | 扩展平台 | 小艺 + WhatsApp + Slack + Email | ✅ |
| **v0.7.0** | 高级功能 | 缓存 + Provider 管理 + MCP 协议 | ✅ |
| **v1.0.0** | 正式发布 | 完整功能 + 测试 + 文档 | ✅ |

---

## 十二、风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| Provider API 版本更新 | 高 | 锁定版本，定期同步更新 |
| OAuth 平台政策变化 | 中 | 抽象认证层，支持多策略 |
| IM 平台协议变更 | 高 | 隔离适配器，独立维护 |
| 浏览器自动化兼容性 | 中 | 使用稳定的 Puppeteer API |
| Redis 依赖可选 | 低 | 默认 Memory 缓存，Redis 按需安装 |

---

## 十三、完成度统计

| 模块 | PRD 要求 | 实际实现 | 完成度 |
|------|----------|----------|--------|
| 核心模块 | 4 个 | 6 个 | 150% |
| IM 适配器 | 6 个 | 10 个 | 167% |
| Web UI | 7 页面 | 10 页面 | 143% |
| 数据模型 | 9 个 | 16 个 | 178% |
| API 端点 | 11 个 | 20+ 个 | 180%+ |
| 测试用例 | - | 358 个 | ✅ |
| 文档 | 基础 | 完整 | ✅ |

---

*文档最后更新: 2026-04-01*