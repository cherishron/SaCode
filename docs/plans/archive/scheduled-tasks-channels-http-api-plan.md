# SaCode Scheduled Tasks, Channels & HTTP API 升级方案

> 结合 SaCode 差异化优势的定时任务、外部事件通道和 HTTP API 设计

---

## 一、定时任务（Scheduled Tasks）

### 1.1 CodeBuddy 定时任务核心特性

CodeBuddy 支持在会话中创建和管理定时任务：

- **`/loop` 命令**：创建循环任务最便捷的方式
- **自然语言描述时间**：支持"每3分钟"、"下午四点半"、"明天早上9点"
- **Cron 表达式**：精确的 cron 语法支持
- **会话级别**：任务只在 CodeBuddy Code 运行期间有效，退出后自动清除
- **空闲时触发**：任务只会在会话空闲时触发
- **时间偏移（Jitter）**：避免大量任务同时执行
- **自动过期**：循环任务在创建 3 天后自动过期删除
- **上限**：每个会话最多同时存在 50 个定时任务

### 1.2 CodeBuddy 使用示例

```bash
# 循环任务
/loop 3m 检查一下流水线是否跑完，把结果告诉我
/loop 30m 帮我运行一次单元测试，如果有失败的用例告诉我
/loop 1h 看一下有没有新的 PR 需要我审查
/loop 10m /check-build

# 一次性提醒
下午四点半提醒我同步一下今天的进展
一个小时后看看刚才那个构建任务有没有产出
明天早上 9 点帮我生成一份昨天的工作日报

# 管理任务
我现在有哪些定时任务？
取消部署检查的定时任务
```

### 1.3 SaCode 当前 vs CodeBuddy 定时任务

| 维度 | SaCode（当前） | CodeBuddy 定时任务 |
|------|--------------|-------------------|
| **定时任务** | 无 | **`/loop` 循环任务 + 一次性提醒** |
| **时间描述** | 无 | **自然语言（"每3分钟"）+ Cron** |
| **会话级别** | 无 | **会话绑定，退出清除** |
| **触发时机** | 无 | **空闲时触发** |
| **自动过期** | 无 | **3天后自动过期** |
| **任务上限** | 无 | **最多50个** |

### 1.4 SaCode 的优势结合点

#### 动态模型路由 × 定时任务

**CodeBuddy**：定时任务使用会话当前模型
**SaCode**：定时任务触发时**动态路由最优模型**

```
定时任务触发
    │
    ▼
TaskAnalyzer 分析任务类型
    │
    ▼
动态路由最优模型
    ├── 构建检查 → 编码模型
    ├── 代码审查 → 审查模型
    ├── 日报生成 → 综合模型
    └── 性能监控 → 经济模型
```

#### 失败接管 × 定时任务

**CodeBuddy**：任务失败需手动处理
**SaCode**：任务失败**自动切换模型重试**

```
定时任务执行失败
    │
    ▼
评分: 0.3 (低分)
    │
    ▼
自动切换模型 → 新模型执行
    │
    ▼
注入 Failover Context
    │
    ▼
重试执行
    │
    ▼
评分: 0.8 (通过)
```

#### 模式化沙箱 × 定时任务

**CodeBuddy**：无沙箱隔离
**SaCode**：定时任务**继承主模式的沙箱策略**

```
Plan 模式下的定时任务 → 只读（无法修改代码）
Build 模式下的定时任务 → 审批（修改前需确认）
Yolo 模式下的定时任务 → 自动（直接执行）
```

### 1.5 SaCode 定时任务设计方案

#### CLI 命令

```bash
# 创建循环任务
sacode loop "每3分钟检查一次CI状态" --interval 3m
sacode loop "每小时生成一次日报" --interval 1h --cron "0 * * * *"

# 创建一次性提醒
sacode remind "下午四点半同步进展" --at "16:30"
sacode remind "一小时后检查构建" --at "+1h"

# 管理任务
sacode task ls                # 列出所有定时任务
sacode task rm <task-id>     # 删除定时任务
sacode task clear            # 清除所有定时任务
```

#### TUI 集成

```
┌─────────────────────────────────────────┐
│ Scheduled Tasks (3)                     │
├─────────────────────────────────────────┤
│ ID   │ Interval │ Type    │ Status      │
│------│----------│---------│------------│
│ t001 │ 3m       │ loop    │ running    │
│ t002 │ 1h       │ loop    │ running    │
│ t003 │ 16:30    │ once    │ pending    │
├─────────────────────────────────────────┤
│ [Enter] 详情  [d] 删除  [c] 清除全部    │
└─────────────────────────────────────────┘
```

#### 实现路径

**Phase 1: Task Scheduler 核心（1周）**
- [ ] `runtime/src/scheduler/` 模块创建
- [ ] Cron 表达式解析
- [ ] 任务队列管理
- [ ] 空闲检测机制

**Phase 2: CLI & TUI 集成（1周）**
- [ ] `sacode loop` / `sacode remind` 命令
- [ ] `sacode task ls/rm/clear` 命令
- [ ] TUI 定时任务面板

**Phase 3: 动态路由集成（1周）**
- [ ] 定时任务触发时动态路由
- [ ] 失败接管集成
- [ ] 节点评分集成

**总工作量**：3 周

---

## 二、Channels（外部事件通道）

### 2.1 CodeBuddy Channels 核心特性

CodeBuddy Channels 将外部事件（微信、Telegram、Discord）推送到会话中：

- **双向通信**：外部事件到达会话，会话回复通过同一 channel 返回
- **MCP 服务器架构**：Channel 是一种特殊的 MCP 服务器
- **微信内置**：通过 ClawBot 插件实现，无需安装插件
- **插件扩展**：Telegram、Discord 通过插件安装
- **发送者白名单**：通过配对流程添加信任的发送者
- **组织管控**：通过 `channelsEnabled` 设置统一管控
- **聊天桥**：微信提问，CodeBuddy 处理，回复回到微信
- **Webhook 接收**：CI、错误追踪器的事件推送到会话

### 2.2 CodeBuddy Channels 使用示例

```bash
# 微信绑定
/remote-control wechat
# 扫码绑定后，微信消息自动推送到会话

# Telegram
/plugin install telegram@claude-plugins-official
/telegram:configure <token>
codebuddy --channels plugin:telegram@claude-plugins-official

# Discord
/plugin install discord@claude-plugins-official
/discord:configure <token>
codebuddy --channels plugin:discord@claude-plugins-official

# fakechat（演示）
/plugin install fakechat@claude-plugins-official
codebuddy --channels plugin:fakechat@claude-plugins-official
```

### 2.3 SaCode 当前 vs CodeBuddy Channels

| 维度 | SaCode（当前） | CodeBuddy Channels |
|------|--------------|-------------------|
| **外部事件** | 无 | **微信/Telegram/Discord** |
| **双向通信** | 无 | **聊天桥模式** |
| **MCP 集成** | 无 | **Channel 是 MCP 服务器** |
| **安全机制** | 无 | **发送者白名单 + 配对** |
| **组织管控** | 无 | **channelsEnabled 设置** |

### 2.4 SaCode 的优势结合点

#### 动态模型路由 × Channels

**CodeBuddy**：Channel 消息使用会话当前模型
**SaCode**：消息到达时**动态路由最优模型**

```
微信消息到达
    │
    ▼
TaskAnalyzer 分析消息类型
    │
    ▼
动态路由最优模型
    ├── 代码问题 → 编码模型
    ├── 代码审查 → 审查模型
    ├── 架构讨论 → 推理模型
    └── 日常询问 → 经济模型
```

#### 失败接管 × Channels

**CodeBuddy**：消息处理失败需手动重试
**SaCode**：消息处理失败**自动切换模型**

```
微信消息处理失败
    │
    ▼
评分: 0.3 (低分)
    │
    ▼
自动切换模型 → 新模型处理
    │
    ▼
回复发送到微信
```

#### Agent Teams × Channels

**CodeBuddy**：单 Agent 处理消息
**SaCode**：复杂消息**自动创建 Agent Team**

```
微信消息: "帮我重构这个模块"
    │
    ▼
Orchestrator 识别为复杂任务
    │
    ▼
自动创建 Agent Team
    ├── Planner（推理模型）
    ├── Coder（编码模型）
    ├── Reviewer（审查模型）
    └── Supervisor（综合模型）
    │
    ▼
结果汇总后回复到微信
```

### 2.5 SaCode Channels 设计方案

#### 支持的 Channel

| Channel | 类型 | 状态 |
|---------|------|------|
| 微信 | 内置 | 计划中 |
| Telegram | 插件 | 计划中 |
| Discord | 插件 | 计划中 |
| Webhook | 内置 | 计划中 |
| Slack | 插件 | 计划中 |

#### CLI 命令

```bash
# Channel 管理
sacode channel ls                    # 列出所有 channel
sacode channel enable <channel>      # 启用 channel
sacode channel disable <channel>     # 禁用 channel

# 微信绑定
sacode channel wechat bind           # 扫码绑定微信
sacode channel wechat status         # 查看连接状态
sacode channel wechat unbind         # 解绑微信

# Webhook
sacode channel webhook create        # 创建 webhook endpoint
sacode channel webhook ls            # 列出所有 webhook
sacode channel webhook rm <id>       # 删除 webhook
```

#### 安全机制

```rust
pub struct ChannelSecurity {
    pub whitelist: Vec<String>,      // 发送者白名单
    pub pairing_required: bool,      // 是否需要配对
    pub max_message_size: usize,   // 最大消息大小
    pub rate_limit: RateLimit,     // 速率限制
}

impl ChannelSecurity {
    pub fn validate_sender(&self, sender: &str) -> Result<()> {
        if !self.whitelist.contains(&sender.to_string()) {
            return Err(anyhow::anyhow!("Sender not in whitelist"));
        }
        Ok(())
    }
}
```

#### 实现路径

**Phase 1: Channel 核心（2周）**
- [ ] `runtime/src/channels/` 模块创建
- [ ] MCP 服务器集成
- [ ] 消息队列管理
- [ ] 发送者白名单

**Phase 2: 微信 Channel（2周）**
- [ ] ClawBot 协议对接
- [ ] 扫码绑定流程
- [ ] 消息收发

**Phase 3: Webhook Channel（1周）**
- [ ] HTTP endpoint 创建
- [ ] Webhook 签名验证
- [ ] 事件推送

**Phase 4: 动态路由集成（1周）**
- [ ] 消息到达时动态路由
- [ ] 失败接管集成
- [ ] Agent Teams 集成

**总工作量**：6 周

---

## 三、HTTP API

### 3.1 CodeBuddy HTTP API 核心特性

CodeBuddy 提供两套公开接口：

- **REST API** (`/api/v1/*`) — 无状态 HTTP 请求/响应
- **ACP** (`/api/v1/acp`) — 有状态流式协议（JSON-RPC over SSE）

#### 核心端点

| 类别 | 方法 | 端点 | 说明 |
|------|------|------|------|
| 系统 | GET | `/api/v1/health` | 健康检查 |
| 系统 | GET | `/api/v1/info` | 环境信息 |
| 系统 | GET | `/api/v1/metrics` | 系统资源指标 |
| 认证 | GET | `/api/v1/auth/status` | 认证状态 |
| 认证 | POST | `/api/v1/auth/login` | 密码登录 |
| Agent | POST | `/api/v1/runs` | 发起 Agent 执行 |
| Agent | GET | `/api/v1/runs/:runId` | 查询执行状态 |
| Agent | GET | `/api/v1/runs/:runId/stream` | SSE 流式获取结果 |
| 会话 | GET | `/api/v1/sessions` | 列出会话 |
| 会话 | POST | `/api/v1/sessions` | 创建会话 |
| 会话 | GET | `/api/v1/sessions/:id` | 获取会话 |
| 会话 | DELETE | `/api/v1/sessions/:id` | 删除会话 |
| 文件 | GET | `/api/v1/files` | 列出文件 |
| 文件 | GET | `/api/v1/files/:path` | 读取文件 |
| 文件 | PUT | `/api/v1/files/:path` | 写入文件 |
| 文件 | DELETE | `/api/v1/files/:path` | 删除文件 |
| 工具 | GET | `/api/v1/tools` | 列出工具 |
| 工具 | POST | `/api/v1/tools/:name` | 执行工具 |

#### 安全机制

- **自定义请求头**：`X-CodeBuddy-Request: 1`
- **CORS 白名单**：配合自定义请求头拦截非法源
- **密码认证**：远程访问时自动开启
- **Bearer Token / URL 参数**认证

### 3.2 SaCode 当前 vs CodeBuddy HTTP API

| 维度 | SaCode（当前） | CodeBuddy HTTP API |
|------|--------------|-------------------|
| **REST API** | 无 | **完整的 RESTful API** |
| **ACP 协议** | 无 | **JSON-RPC over SSE** |
| **Agent 执行** | 无 | **异步执行 + SSE 流式** |
| **会话管理** | 无 | **CRUD 操作** |
| **文件操作** | 无 | **读写删** |
| **工具执行** | 无 | **远程调用工具** |
| **Swagger 文档** | 无 | **交互式 API 文档** |
| **安全机制** | 无 | **自定义头 + CORS + 密码** |

### 3.3 SaCode 的优势结合点

#### 动态模型路由 × HTTP API

**CodeBuddy**：API 请求使用启动时指定的模型
**SaCode**：每个 API 请求**动态路由最优模型**

```
POST /api/v1/runs
    │
    ▼
TaskAnalyzer 分析任务类型
    │
    ▼
动态路由最优模型
    ├── 代码生成 → 编码模型
    ├── 代码审查 → 审查模型
    ├── 架构设计 → 推理模型
    └── 文本处理 → 经济模型
```

#### 失败接管 × HTTP API

**CodeBuddy**：API 请求失败需客户端重试
**SaCode**：API 请求失败**服务端自动切换模型重试**

```
POST /api/v1/runs
    │
    ▼
Agent 执行失败
    │
    ▼
评分: 0.3 (低分)
    │
    ▼
服务端自动切换模型
    │
    ▼
注入 Failover Context
    │
    ▼
重试执行
    │
    ▼
SSE 流式返回结果
```

#### Agent Teams × HTTP API

**CodeBuddy**：单 Agent 处理 API 请求
**SaCode**：复杂任务**自动创建 Agent Team**

```
POST /api/v1/runs
    │
    ▼
Orchestrator 识别为复杂任务
    │
    ▼
自动创建 Agent Team
    ├── Planner（推理模型）
    ├── Coder × 3（并行，编码模型）
    ├── Reviewer × 2（并行，审查模型）
    └── Supervisor（综合模型）
    │
    ▼
SSE 流式返回 Team 结果
```

#### 模式化沙箱 × HTTP API

**CodeBuddy**：`--permission-mode` 全局控制
**SaCode**：API 请求**保持 Plan/Build/Yolo 模式隔离**

```
POST /api/v1/runs {"mode": "plan"}
    │
    ▼
Plan 模式 → 只读（无法修改代码）

POST /api/v1/runs {"mode": "build"}
    │
    ▼
Build 模式 → 审批（修改前需确认）

POST /api/v1/runs {"mode": "yolo"}
    │
    ▼
Yolo 模式 → 自动（直接执行）
```

### 3.4 SaCode HTTP API 设计方案

#### 端点设计

```yaml
# 系统
GET  /api/v1/health
GET  /api/v1/info
GET  /api/v1/metrics

# 认证
GET  /api/v1/auth/status
POST /api/v1/auth/login

# Agent 执行
POST   /api/v1/runs
GET    /api/v1/runs/:runId
GET    /api/v1/runs/:runId/stream        # SSE
DELETE /api/v1/runs/:runId

# 会话管理
GET    /api/v1/sessions
POST   /api/v1/sessions
GET    /api/v1/sessions/:id
DELETE /api/v1/sessions/:id

# 文件操作
GET    /api/v1/files?path=
GET    /api/v1/files/:path
PUT    /api/v1/files/:path
DELETE /api/v1/files/:path

# 工具执行
GET    /api/v1/tools
POST   /api/v1/tools/:name

# SaCode 特有：动态路由
GET    /api/v1/routing/models            # 查看可用模型
POST   /api/v1/routing/resolve           # 解析任务路由

# SaCode 特有：Agent Teams
GET    /api/v1/teams
POST   /api/v1/teams
GET    /api/v1/teams/:teamId
GET    /api/v1/teams/:teamId/status
DELETE /api/v1/teams/:teamId

# SaCode 特有：节点评分
GET    /api/v1/runs/:runId/score         # 查看任务评分
GET    /api/v1/runs/:runId/failovers     # 查看失败接管记录
```

#### 请求示例

```bash
# 发起 Agent 执行
curl -X POST http://localhost:8080/api/v1/runs \
  -H "Content-Type: application/json" \
  -H "X-SaCode-Request: 1" \
  -H "Authorization: Bearer YOUR_PASSWORD" \
  -d '{
    "prompt": "实现登录页面",
    "mode": "build",
    "model": "auto"  // 动态路由
  }'

# SSE 流式获取结果
curl http://localhost:8080/api/v1/runs/123/stream \
  -H "X-SaCode-Request: 1" \
  -H "Authorization: Bearer YOUR_PASSWORD"

# 查看动态路由结果
curl http://localhost:8080/api/v1/runs/123/routing \
  -H "X-SaCode-Request: 1" \
  -H "Authorization: Bearer YOUR_PASSWORD"
# {"model": "claude-sonnet-4", "role": "Coder", "score": 0.85}
```

#### 安全机制

```rust
pub struct ApiSecurity {
    pub cors_origin: String,              // CORS 白名单
    pub require_auth: bool,               // 是否需要认证
    pub auth_mode: AuthMode,             // 认证模式
    pub request_header: String,          // 自定义请求头
    pub max_request_size: usize,         // 最大请求大小
    pub rate_limit: RateLimit,           // 速率限制
}

impl ApiSecurity {
    pub fn validate_request(&self, req: &Request) -> Result<()> {
        // 验证自定义请求头
        if !req.headers().contains(&self.request_header) {
            return Err(anyhow::anyhow!("Missing required header"));
        }
        
        // 验证 CORS
        if !self.cors_origin.matches(req.origin()) {
            return Err(anyhow::anyhow!("CORS origin not allowed"));
        }
        
        Ok(())
    }
}
```

#### 实现路径

**Phase 1: HTTP 服务器（2周）**
- [ ] `runtime/src/api/` 模块创建
- [ ] HTTP 服务器（`axum` 或 `actix-web`）
- [ ] 路由定义
- [ ] 中间件（CORS、认证、日志）

**Phase 2: REST API 实现（2周）**
- [ ] 系统端点（health、info、metrics）
- [ ] 认证端点（status、login）
- [ ] Agent 执行端点（runs）
- [ ] 会话管理端点（sessions）
- [ ] 文件操作端点（files）
- [ ] 工具执行端点（tools）

**Phase 3: ACP 协议（1周）**
- [ ] JSON-RPC over SSE
- [ ] 流式响应

**Phase 4: SaCode 特有端点（1周）**
- [ ] 动态路由端点（routing）
- [ ] Agent Teams 端点（teams）
- [ ] 节点评分端点（score、failovers）

**Phase 5: 文档（1周）**
- [ ] OpenAPI 规范
- [ ] Swagger UI
- [ ] API 文档

**总工作量**：7 周

---

## 四、与 SaCode 现有功能的结合

### 4.1 定时任务 × Daemon

```
Daemon 模式下
    │
    ▼
定时任务在后台运行
    │
    ▼
任务触发时自动路由最优模型
    │
    ▼
失败时自动切换模型重试
    │
    ▼
结果记录到日志
```

### 4.2 Channels × Daemon

```
Daemon 模式下
    │
    ▼
微信/Telegram/Discord 消息到达
    │
    ▼
自动路由最优模型处理
    │
    ▼
复杂任务自动创建 Agent Team
    │
    ▼
结果回复到原 channel
```

### 4.3 HTTP API × Daemon

```
Daemon 模式下
    │
    ▼
HTTP API 接受请求
    │
    ▼
动态路由最优模型
    │
    ▼
Agent Teams 处理复杂任务
    │
    ▼
SSE 流式返回结果
```

---

## 五、与 CodeBuddy 的关键差异

| 维度 | CodeBuddy | SaCode |
|------|-----------|--------|
| **定时任务** | 会话级别，3天后过期 | **动态路由 + 失败接管 + 模式化沙箱** |
| **Channels** | MCP 服务器，单模型处理 | **动态路由 + Agent Teams + 失败接管** |
| **HTTP API** | 静态模型，单 Agent | **动态路由 + Agent Teams + 节点评分** |
| **安全** | 自定义头 + 密码 | **继承 Plan/Build/Yolo 模式隔离** |
| **失败处理** | 客户端重试 | **服务端自动切换模型** |

---

## 六、实现路径总结

| 功能 | 工作量 | 优先级 |
|------|--------|--------|
| **定时任务** | 3 周 | P1 |
| **Channels** | 6 周 | P2 |
| **HTTP API** | 7 周 | P1 |
| **总计** | **16 周** | — |

---

## 七、总结

SaCode 的定时任务、Channels 和 HTTP API 不是简单复制 CodeBuddy 的功能，而是将 SaCode 的**动态模型路由、模式化沙箱、失败接管、节点评分、Agent Teams**等核心优势与这些功能深度结合。

**核心价值**：
- **定时任务**：触发时自动路由最优模型，失败自动切换
- **Channels**：消息到达时动态路由，复杂任务自动创建 Agent Team
- **HTTP API**：每个请求动态路由，复杂任务自动创建 Agent Team

**实现顺序建议**：
1. **HTTP API**（P1）：为 Daemon 和 Channels 提供基础
2. **定时任务**（P1）：增强自动化能力
3. **Channels**（P2）：扩展外部集成能力
