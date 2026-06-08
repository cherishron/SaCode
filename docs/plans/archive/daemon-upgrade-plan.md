# SaCode Daemon 升级方案

> 结合 SaCode 差异化优势的后台常驻服务模式

---

## 一、CodeBuddy Daemon 核心特性

### 1.1 设计哲学

CodeBuddy 的 Daemon 模式让 CLI 从"用完即走"变成"随时待命"：

- **后台常驻服务**：不依赖终端窗口，通过 HTTP API 接受请求
- **Worker 进程管理**：每个 CLI 进程在 `~/.codebuddy/sessions/` 注册 PID 文件
- **后台会话（bg）**：非交互式任务，自动输出日志到文件
- **Web UI**：提供 Workers/Logs/Metrics 三个管理页面
- **HTTP API**：RESTful API 暴露所有 Worker 和 Daemon 管理能力
- **日志体系**：telemetry / process / debug / transcript 四级日志

### 1.2 核心命令

```bash
# Daemon 管理
codebuddy daemon start          # 启动 daemon（后台运行，自动分配端口）
codebuddy daemon start --port 8080
codebuddy daemon status         # 查看状态
codebuddy daemon stop           # 停止
codebuddy daemon restart        # 重启

# 后台任务
codebuddy --bg "实现登录页面"                # 后台执行任务
codebuddy --bg --name feature-login "实现登录页面"  # 指定名称

# Worker 管理
codebuddy ps                    # 列出所有活跃 Worker
codebuddy logs feature-login    # 查看后台会话日志
codebuddy logs feature-login -f   # 持续跟踪日志
codebuddy attach feature-login  # 附加到后台会话
codebuddy kill feature-login    # 终止后台会话
```

### 1.3 架构

```
┌─────────────────────────────────────────┐
│           CodeBuddy Daemon              │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐ │
│  │ Workers │  │  Logs   │  │ Metrics │ │
│  │  Page   │  │  Page   │  │  Page   │ │
│  └────┬────┘  └────┬────┘  └────┬────┘ │
│       └─────────────┴─────────────┘      │
│              HTTP API (RESTful)         │
│  ┌─────────────────────────────────┐   │
│  │      Worker Process Manager     │   │
│  │  ┌─────────┐    ┌─────────┐    │   │
│  │  │ Worker 1│    │ Worker 2│    │   │
│  │  │ (PID)   │    │ (PID)   │    │   │
│  │  └─────────┘    └─────────┘    │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

---

## 二、SaCode 当前 vs CodeBuddy Daemon

| 维度 | SaCode（当前） | CodeBuddy Daemon |
|------|--------------|------------------|
| **运行模式** | 交互式 CLI（用完即走） | 后台常驻 + 交互式 |
| **HTTP API** | 无 | **完整 RESTful API** |
| **Web UI** | 无 | **Workers/Logs/Metrics 页面** |
| **Worker 管理** | 无 | **PID 文件注册表 + 进程管理** |
| **后台任务** | 无 | **`--bg` 模式** |
| **日志体系** | TUI 日志（`~/.sacode/logs/tui.log`） | **四级日志（telemetry/process/debug/transcript）** |
| **进程检测** | 无 | **`kill -0` 检测存活** |
| **远程访问** | 无 | **`--host 0.0.0.0` + 密码认证** |

---

## 三、SaCode 的优势结合点

### 3.1 动态模型路由 × Daemon

**CodeBuddy**：Daemon 使用启动时指定的模型
**SaCode**：Daemon 模式下**每个请求动态路由最优模型**

```
用户请求 → Daemon HTTP API
    │
    ▼
TaskAnalyzer 分析任务类型
    │
    ▼
动态路由最优模型
    ├── 代码生成 → 编码模型（如 claude-sonnet）
    ├── 代码审查 → 审查模型（如 gpt-5）
    ├── 架构设计 → 推理模型（如 o3）
    └── 文本处理 → 经济模型（如 gemini-flash）
```

### 3.2 模式化沙箱 × Daemon

**CodeBuddy**：Daemon 默认委托模式，可通过 `--permission-mode` 切换
**SaCode**：Daemon 模式下**保持 Plan/Build/Yolo 模式隔离**

```
Daemon 启动时指定模式：
- sacode daemon start --mode plan    → 所有请求只读
- sacode daemon start --mode build  → 所有请求需审批
- sacode daemon start --mode yolo   → 所有请求自动执行

每个 Worker 继承 Daemon 的模式：
- Worker 1 (plan)  → 只读
- Worker 2 (build) → 审批
- Worker 3 (yolo)  → 自动
```

### 3.3 失败接管 × Daemon

**CodeBuddy**：后台任务失败需手动重试
**SaCode**：后台任务失败**自动切换模型重试**

```
Worker (bg) 执行任务失败
    │
    ▼
评分: 0.3 (低分)
    │
    ▼
自动切换模型 → Worker' (新模型)
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

### 3.4 Agent Teams × Daemon

**CodeBuddy**：Daemon 协调 subagent 完成工作
**SaCode**：Daemon 模式下**自动创建 Agent Team**

```
用户请求 → Daemon HTTP API
    │
    ▼
Orchestrator 分析任务复杂度
    │
    ▼
简单任务 → 单 Agent 执行
复杂任务 → Agent Team 协作
    ├── Planner（动态路由到推理模型）
    ├── Coder × 3（并行，动态路由到编码模型）
    ├── Reviewer × 2（并行，动态路由到审查模型）
    └── Supervisor（动态路由到综合模型）
```

---

## 四、SaCode Daemon 设计方案

### 4.1 核心命令

```bash
# Daemon 管理
sacode daemon start          # 启动 daemon（后台运行，自动分配端口）
sacode daemon start --port 8080
sacode daemon start --host 0.0.0.0
sacode daemon start --mode build  # 指定模式（plan/build/yolo）
sacode daemon status         # 查看状态
sacode daemon stop           # 停止
sacode daemon restart        # 重启

# 后台任务
sacode --bg "实现登录页面"                # 后台执行任务
sacode --bg --name feature-login "实现登录页面"  # 指定名称

# Worker 管理
sacode ps                    # 列出所有活跃 Worker
sacode logs feature-login    # 查看后台会话日志
sacode logs feature-login -f   # 持续跟踪日志
sacode attach feature-login  # 附加到后台会话
sacode kill feature-login    # 终止后台会话
```

### 4.2 架构

```
┌─────────────────────────────────────────┐
│           SaCode Daemon                 │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐ │
│  │ Workers │  │  Logs   │  │ Metrics │ │
│  │  Page   │  │  Page   │  │  Page   │ │
│  └────┬────┘  └────┬────┘  └────┬────┘ │
│       └─────────────┴─────────────┘      │
│              HTTP API (RESTful)         │
│  ┌─────────────────────────────────┐   │
│  │      Worker Process Manager     │   │
│  │  ┌─────────┐    ┌─────────┐    │   │
│  │  │ Worker 1│    │ Worker 2│    │   │
│  │  │ (Plan)  │    │ (Build) │    │   │
│  │  └─────────┘    └─────────┘    │   │
│  └─────────────────────────────────┘   │
│  ┌─────────────────────────────────┐   │
│  │      Dynamic Model Router       │   │  <- SaCode 优势
│  │  ┌─────────┐    ┌─────────┐    │   │
│  │  │Router   │    │Failover │    │   │
│  │  │Engine   │    │Handler  │    │   │
│  │  └─────────┘    └─────────┘    │   │
│  └─────────────────────────────────┘   │
│  ┌─────────────────────────────────┐   │
│  │      Agent Teams Orchestrator   │   │  <- SaCode 优势
│  │  ┌─────────┐    ┌─────────┐    │   │
│  │  │Planner  │    │Coder    │    │   │
│  │  │Reviewer │    │Supervisor│    │   │
│  │  └─────────┘    └─────────┘    │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

### 4.3 PID 文件注册表

```
~/.sacode/sessions/
├── 12345.json          # 本地进程（PID 作为文件名）
├── 67890.json          # 另一个本地进程
└── manual-abc123.json  # 手动添加的远程 Worker
```

```json
{
  "pid": 12345,
  "sessionId": "interactive-12345",
  "cwd": "/home/user/project",
  "startedAt": 1775498920401,
  "kind": "interactive",
  "url": "http://127.0.0.1:8080",
  "mode": "build",
  "version": "0.1.16",
  "hostname": "my-machine",
  "resolvedRoute": "claude-sonnet-4"  // SaCode 优势：动态路由结果
}
```

### 4.4 日志体系

| 类型 | 路径 | 内容 | 触发条件 |
|------|------|------|----------|
| `telemetry` | `~/.sacode/logs/{date}/{workspace}.log` | 所有模块的 Info/Warn/Error | 始终（默认优先） |
| `process` | `~/.sacode/logs/{name}.log` | 进程 stdout/stderr | 仅 bg/daemon |
| `debug` | `~/.sacode/debug/{sessionId}.txt` | 详细调试信息 | 需 `--debug` |
| `transcript` | `~/.sacode/projects/{id}/{sessionId}.jsonl` | 对话历史 | 始终 |
| `routing` | `~/.sacode/logs/{date}/routing.log` | **动态路由决策日志** | SaCode 特有 |
| `failover` | `~/.sacode/logs/{date}/failover.log` | **失败接管日志** | SaCode 特有 |

### 4.5 HTTP API

```bash
# Worker 管理
curl http://127.0.0.1:8080/api/v1/workers                              # 列出所有 Worker
curl -X DELETE http://127.0.0.1:8080/api/v1/workers/12345             # 终止 Worker

# Daemon 管理
curl -X POST http://127.0.0.1:8080/api/v1/daemon/start                # 启动 Daemon
curl http://127.0.0.1:8080/api/v1/daemon/status                       # 查看 Daemon 状态

# 日志查看
curl "http://127.0.0.1:8080/api/v1/workers/12345/logs?type=telemetry&tail=100"

# SaCode 特有：动态路由
curl http://127.0.0.1:8080/api/v1/routing/models                      # 查看可用模型
curl -X POST http://127.0.0.1:8080/api/v1/routing/resolve            # 解析任务路由

# SaCode 特有：Agent Teams
curl -X POST http://127.0.0.1:8080/api/v1/teams                       # 创建 Agent Team
curl http://127.0.0.1:8080/api/v1/teams/{teamId}/status               # 查看 Team 状态
```

### 4.6 Web UI

```
┌─────────────────────────────────────────┐
│ SaCode Web UI                           │
├─────────────────────────────────────────┤
│ [Workers] [Logs] [Metrics] [Routing]    │  <- Routing 为 SaCode 特有
├─────────────────────────────────────────┤
│                                         │
│  Workers                                │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐ │
│  │Worker 1 │  │Worker 2 │  │Worker 3 │ │
│  │Plan     │  │Build    │  │Yolo     │ │
│  │claude   │  │gpt-5    │  │gemini   │ │  <- 显示动态路由结果
│  └─────────┘  └─────────┘  └─────────┘ │
│                                         │
│  [Attach] [Kill] [Logs] [Routing]       │
│                                         │
├─────────────────────────────────────────┤
│ Status: Running | Mode: Build | Uptime   │
└─────────────────────────────────────────┘
```

---

## 五、与 SaCode 现有功能的结合

### 5.1 Daemon × 动态模型路由

```rust
// runtime/src/daemon/worker.rs
pub struct DaemonWorker {
    pub pid: u32,
    pub session_id: String,
    pub mode: ExecutionMode,
    pub resolved_route: Option<ResolvedRoleRoute>, // 动态路由结果
    pub task_queue: Vec<Task>,
}

impl DaemonWorker {
    pub async fn process_task(&mut self, task: Task) -> Result<TaskResult> {
        // SaCode 优势：动态模型路由
        let route = resolve_role_route(
            &self.mode,
            &TaskProfile::from_prompt(&task.prompt),
        )?;
        
        self.resolved_route = Some(route.clone());
        
        // 执行任务
        let result = execute_with_route(task, &route).await?;
        
        // 评分后决定是否切换模型
        if let Some(score) = result.node_score {
            if score.value < 0.5 {
                let new_route = self.maybe_switch_model().await?;
                // 重试...
            }
        }
        
        Ok(result)
    }
}
```

### 5.2 Daemon × 模式化沙箱

```rust
// runtime/src/daemon/sandbox.rs
pub struct DaemonSandbox {
    pub mode: ExecutionMode,
    pub policy: SandboxPolicy,
}

impl DaemonSandbox {
    pub fn for_mode(mode: ExecutionMode) -> Self {
        Self {
            mode,
            policy: SandboxPolicy::for_mode(mode),
        }
    }
    
    pub fn apply_to_worker(&self, worker: &mut DaemonWorker) {
        // 每个 Worker 继承 Daemon 的沙箱策略
        worker.sandbox_policy = self.policy.clone();
    }
}
```

### 5.3 Daemon × 失败接管

```rust
// runtime/src/daemon/failover.rs
pub struct DaemonFailover {
    pub max_retries: usize,
    pub retry_count: usize,
    pub failovers: Vec<FailoverContext>,
}

impl DaemonFailover {
    pub async fn handle_failure(&mut self, worker: &mut DaemonWorker) -> Result<ResolvedRoleRoute> {
        if self.retry_count >= self.max_retries {
            return Err(anyhow::anyhow!("Max retries exceeded"));
        }
        
        // SaCode 优势：自动切换模型
        let new_route = worker.maybe_switch_model().await?;
        
        // 注入 Failover Context
        let context = FailoverContext {
            previous_route: worker.resolved_route.clone(),
            new_route: new_route.clone(),
            retry_count: self.retry_count,
        };
        self.failovers.push(context);
        
        self.retry_count += 1;
        Ok(new_route)
    }
}
```

### 5.4 Daemon × Agent Teams

```rust
// runtime/src/daemon/team.rs
pub struct DaemonTeam {
    pub team_id: String,
    pub members: Vec<TeamMember>,
    pub orchestrator: Orchestrator,
}

impl DaemonTeam {
    pub async fn execute(&self, task: Task) -> Result<TeamResult> {
        // SaCode 优势：动态模型路由
        let plan_route = resolve_role_route(&AgentRole::Planner, &task.profile)?;
        let code_route = resolve_role_route(&AgentRole::Coder, &task.profile)?;
        let review_route = resolve_role_route(&AgentRole::Reviewer, &task.profile)?;
        
        // 创建 Agent Team
        let team = self.orchestrator.create_team(vec![
            TeamMember::new(AgentRole::Planner, plan_route),
            TeamMember::new(AgentRole::Coder, code_route),
            TeamMember::new(AgentRole::Reviewer, review_route),
        ])?;
        
        // 执行
        team.execute(task).await
    }
}
```

---

## 六、与 CodeBuddy 的关键差异

| 维度 | CodeBuddy Daemon | SaCode Daemon |
|------|-----------------|---------------|
| **模型选择** | 启动时静态指定 | **动态路由**（每个请求自动选择最优模型） |
| **失败处理** | 手动重试 | **自动接管**（后台任务失败自动切换模型） |
| **权限模式** | default/delegate | **Plan/Build/Yolo**（模式化沙箱） |
| **Agent 协作** | Sub-agents | **Agent Teams**（动态创建协作团队） |
| **日志** | 四级日志 | **六级日志**（+routing +failover） |
| **评分机制** | 无 | **节点评分**（低分自动切换模型） |
| **Web UI** | Workers/Logs/Metrics | **Workers/Logs/Metrics/Routing** |

---

## 七、实现路径

### Phase 1: Daemon 核心（2周）

- [ ] `runtime/src/daemon/` 模块创建
- [ ] PID 文件注册表（`~/.sacode/sessions/`）
- [ ] 进程管理（`sacode daemon start/stop/status`）
- [ ] HTTP API 服务器（`axum` 或 `actix-web`）

### Phase 2: Worker 管理（1周）

- [ ] Worker 进程创建/销毁
- [ ] `sacode ps` / `sacode kill`
- [ ] 进程存活检测（`kill -0`）

### Phase 3: 后台任务（1周）

- [ ] `sacode --bg` 模式
- [ ] 日志重定向（`~/.sacode/logs/{name}.log`）
- [ ] `sacode logs` / `sacode attach`

### Phase 4: Web UI（1-2周）

- [ ] Workers 页面
- [ ] Logs 页面
- [ ] Metrics 页面
- [ ] **Routing 页面**（SaCode 特有）

### Phase 5: 动态路由集成（1周）

- [ ] Daemon 模式下动态模型路由
- [ ] 失败接管集成
- [ ] 节点评分集成

### Phase 6: Agent Teams 集成（1周）

- [ ] Daemon 模式下自动创建 Agent Team
- [ ] Team 状态监控
- [ ] Team 结果汇总

**总工作量**：7-8 周

---

## 八、总结

SaCode Daemon 不是简单复制 CodeBuddy 的"后台常驻服务"模式，而是将 SaCode 的**动态模型路由、模式化沙箱、失败接管、节点评分、Agent Teams**等核心优势与 Daemon 深度结合。

**核心价值**：
- 每个请求**自动使用最优模型**（动态路由）
- 后台任务失败时**自动切换模型**而非人工重试
- Daemon 模式下保持**Plan/Build/Yolo 模式隔离**
- 复杂任务**自动创建 Agent Team**协作
- **节点评分**驱动模型切换

**实现工作量**：7-8 周
- Phase 1: Daemon 核心（2周）
- Phase 2: Worker 管理（1周）
- Phase 3: 后台任务（1周）
- Phase 4: Web UI（1-2周）
- Phase 5: 动态路由集成（1周）
- Phase 6: Agent Teams 集成（1周）

**与现有功能的关系**：
- Daemon 是**运行模式**，不是替代 TUI/CLI
- Daemon 模式下**复用**动态路由、沙箱、Agent Teams 等核心能力
- Daemon 模式下**新增**后台任务、Web UI、HTTP API 等能力
