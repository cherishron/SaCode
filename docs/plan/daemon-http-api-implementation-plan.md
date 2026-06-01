# SaCode Daemon 与 HTTP API 实施方案

> 来源：`docs/plan/final-roadmap.md`
> 优先级：P1
> 前置依赖：runtime 统一化至少完成 TaskRunner、TaskRun、SessionRun 的最小真源

---

## 一、目标

把现有 daemon 雏形升级成 SaCode 的后台运行宿主，并为 Scheduled Tasks、Channels、外部系统集成提供统一入口。

---

## 二、现状

当前已有：

- `runtime/src/daemon/mod.rs`
- `/health`
- `/events`
- `/events/:id`
- `/queue/status`

当前仍缺：

- daemon 生命周期管理命令
- worker / task / session registry
- 请求级任务提交 API
- attach / logs / kill / ps 对应能力
- 多会话持久化和日志管理

---

## 三、设计原则

### 3.1 daemon 是运行时宿主，不是另一套执行逻辑

daemon 自己不定义新的任务模型，直接调用统一 runtime。

### 3.2 HTTP API 是所有外部集成真入口

Channels、Web UI、Webhook、外部 IDE 集成都应优先基于 HTTP API。

### 3.3 先最小可用，再补管理能力

先完成：

- start / stop / status
- submit / query / cancel / events

再完成：

- logs / attach / session monitor / metrics

---

## 四、CLI 设计

### 4.1 daemon 管理

建议新增或完善：

- `sacode daemon start`
- `sacode daemon status`
- `sacode daemon stop`
- `sacode daemon restart`

建议参数：

- `--port`
- `--host`
- `--mode`

### 4.2 后台任务管理

建议新增：

- `sacode ps`
- `sacode logs <task-or-session-id>`
- `sacode attach <session-id>`
- `sacode kill <task-or-session-id>`

第一版可以先只支持：

- `ps`
- `kill`

---

## 五、HTTP API 设计

### 5.1 第一阶段 API

#### 基础健康检查

- `GET /health`
- `GET /queue/status`

#### 任务 API

- `POST /tasks`
- `GET /tasks/:id`
- `POST /tasks/:id/cancel`
- `GET /tasks/:id/events`

#### 会话 API

- `GET /sessions`
- `GET /sessions/:id`

### 5.2 第二阶段 API

- `GET /workers`
- `GET /logs/:id`
- `POST /sessions/:id/attach`
- `GET /metrics`

---

## 六、请求模型建议

### POST /tasks

建议字段：

- `prompt`
- `mode`
- `approval_policy`
- `max_iterations`
- `execution_kind`
- `background`

### GET /tasks/:id

建议返回：

- `task_id`
- `session_id`
- `status`
- `summary`
- `report`

---

## 七、持久化设计

建议目录：

- `./.sacode/sessions/`
- `./.sacode/tasks/`
- `./.sacode/logs/`
- `./.sacode/pids/`

### 第一版日志建议

先支持两类：

- `process.log`
- `transcript.log`

后续再扩展更细分级。

---

## 八、daemon 内部模块建议

### runtime

建议拆出：

- `runtime/src/daemon/server.rs`
- `runtime/src/daemon/registry.rs`
- `runtime/src/daemon/task_api.rs`
- `runtime/src/daemon/session_api.rs`
- `runtime/src/daemon/log_store.rs`

### 核心职责

#### server

- 启动 axum server
- 路由注册

#### registry

- session / task / worker 索引
- daemon 生命周期状态

#### task_api

- 任务提交、查询、取消

#### session_api

- 会话列表、会话详情、attach 支撑

#### log_store

- 日志持久化与检索

---

## 九、实施阶段

### Phase 1：最小 daemon 生命周期

工作内容：

- `daemon start/status/stop`
- 基础端口与 host 配置
- daemon registry 文件

验收标准：

- daemon 可稳定启动、停止、汇报状态

### Phase 2：任务 API

工作内容：

- `POST /tasks`
- `GET /tasks/:id`
- `POST /tasks/:id/cancel`
- `GET /tasks/:id/events`

验收标准：

- 外部请求可触发任务并消费事件流

### Phase 3：CLI 管理命令

工作内容：

- `ps`
- `kill`
- 最小 `logs`

验收标准：

- CLI 可管理 daemon 任务

### Phase 4：会话与日志增强

工作内容：

- `sessions` API
- session attach 基础协议
- 日志持久化

验收标准：

- TUI 和后续 Channels 可消费 session/task 数据

---

## 十、与后续功能的关系

### Scheduled Tasks

daemon 是定时任务执行宿主。

### Channels

HTTP API 是所有外部通道的统一入口。

### Agent Teams

daemon 提供多任务、多会话、多 worker 的长期运行环境。

---

## 十一、测试策略

### 单元测试

- API request/response schema
- registry 持久化
- log store 行为

### 集成测试

- daemon start / stop
- 提交任务后查询状态
- cancel 后状态流转
- events 流连续性

### 回归测试

- 现有 `/health`、`/events`、`/queue/status` 不回退

---

## 十二、完成定义

1. daemon 可独立启动和停止
2. 外部可通过 HTTP API 提交任务
3. 任务状态、事件、结果可查询
4. CLI 可管理 daemon 任务
5. 统一 runtime 成为后台任务真源

---

## 十三、完成后的直接收益

- Scheduled Tasks 可直接挂接
- Channels 可直接通过 API 投递任务
- TUI 可继续演进为 attach / monitor 视图
- SaCode 从单次 CLI 升级为平台化执行宿主
