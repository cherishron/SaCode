# SaCode 全功能集成可行性分析

> Agent Teams + Sub-agents + Daemon + 定时任务/Channels/HTTP API 的综合评估

---

## 一、功能矩阵与依赖关系

### 1.1 功能依赖图

```
┌─────────────────────────────────────────────────────────┐
│                     SaCode Core                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │Model Router │  │TaskAnalyzer │  │ Sandbox Policy  │ │
│  │(动态路由)   │  │(任务分析)    │  │ (Plan/Build/Yolo)│ │
│  └──────┬──────┘  └──────┬──────┘  └────────┬────────┘ │
│         └─────────────────┴──────────────────┘           │
│                         │                              │
│         ┌───────────────┼───────────────┐              │
│         ▼               ▼               ▼              │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐     │
│  │Sub-agents  │  │Agent Teams │  │  Memory    │     │
│  │(预配置专家) │  │(运行时协作) │  │ (记忆系统)  │     │
│  └──────┬─────┘  └──────┬─────┘  └──────┬─────┘     │
│         │               │               │             │
│         └───────────────┴───────────────┘             │
│                         │                              │
│         ┌───────────────┼───────────────┐              │
│         ▼               ▼               ▼              │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐     │
│  │   Daemon   │  │  HTTP API  │  │ Scheduled  │     │
│  │ (后台常驻)  │  │ (REST/ACP) │  │  Tasks     │     │
│  └──────┬─────┘  └──────┬─────┘  └──────┬─────┘     │
│         │               │               │             │
│         └───────────────┴───────────────┘             │
│                         │                              │
│                  ┌────────────┐                       │
│                  │  Channels  │                       │
│                  │(微信/Telegram)│                     │
│                  └────────────┘                       │
└─────────────────────────────────────────────────────────┘
```

### 1.2 依赖关系表

| 功能 | 依赖基础 | 被依赖方 | 是否可以独立运行 |
|------|---------|---------|--------------|
| **Sub-agents** | Model Router, TaskAnalyzer | Agent Teams, Daemon | 是（CLI 模式） |
| **Agent Teams** | Model Router, TaskAnalyzer, Sub-agents | Daemon | 是（CLI 模式） |
| **Daemon** | Model Router, TaskAnalyzer | HTTP API, 定时任务, Channels | 否（需要其他功能配合） |
| **HTTP API** | Daemon | Channels | 否 |
| **定时任务** | Daemon, TaskAnalyzer | — | 否 |
| **Channels** | Daemon, HTTP API | — | 否 |

---

## 二、"完美呈现"的可行性评估

### 2.1 技术可行性：可以，但非无成本

| 维度 | 评估 | 说明 |
|------|------|------|
| **架构兼容性** | 高 | SaCode 的模块化设计（kernel/runtime/interfaces）天然支持功能扩展 |
| **Rust 生态** | 高 | Tokio（异步）、Axum（HTTP）、Cron（定时任务）等库成熟 |
| **模型路由** | 高 | 现有 `models.yaml` + `TaskAnalyzer` 可复用 |
| **沙箱策略** | 高 | `SandboxPolicy` 可扩展为按 Agent 粒度控制 |
| **Memory 系统** | 中 | 需要扩展以支持多 Agent 隔离和共享 |
| **TUI 适配** | 低 | 当前 TUI 为单会话设计，Daemon 多会话需要大规模重构 |

### 2.2 资源可行性：需要权衡

| 资源消耗 | 单 Agent | Agent Teams (4人) | Daemon + API |
|---------|---------|------------------|-------------|
| **Token 消耗** | 1x | **4-6x**（并行运行） | **2-3x**（后台常驻） |
| **内存占用** | ~50MB | **~200MB** | **~100MB** |
| **API 调用** | 1x | **4-6x** | **1x**（但并发） |
| **存储** | 可忽略 | 中等（多 Agent 日志） | 高（日志/会话持久化） |

**关键风险**：Agent Teams 模式下 Token 消耗可能剧增（4-6 倍），用户成本敏感。

### 2.3 时间可行性：需要分阶段

| 功能 | 估计工作量 | 优先级 | 依赖 |
|------|---------|--------|------|
| **Sub-agents** | 3-5 周 | P1 | 无（可独立） |
| **Agent Teams** | 6-9 周 | P1 | Sub-agents（可选） |
| **Daemon** | 7-8 周 | P1 | Agent Teams（可选） |
| **HTTP API** | 7 周 | P1 | Daemon |
| **定时任务** | 3 周 | P2 | Daemon |
| **Channels** | 6 周 | P2 | Daemon + HTTP API |
| **总计（串行）** | **33-38 周** | — | — |
| **总计（并行）** | **16-20 周** | — | — |

**现实评估**：即使并行开发，也需要 **16-20 周**（4-5 个月）。

---

## 三、架构冲突与解决方案

### 3.1 冲突 1：Sub-agents vs Agent Teams

**冲突描述**：
- Sub-agents 是"预配置的专项专家"（如 code-reviewer）
- Agent Teams 是"运行时协作团队"（Planner→Coder→Reviewer）
- 两者都是"多 Agent"概念，容易混淆

**解决方案**：
```
┌─────────────────────────────────────────┐
│           SaCode Agent 层级             │
├─────────────────────────────────────────┤
│  Level 1: Single Agent                  │
│  └── 单 Agent 处理简单任务              │
├─────────────────────────────────────────┤
│  Level 2: Sub-agents                    │
│  └── 预配置专家处理专项任务             │
│  └── 如：code-reviewer, test-generator │
├─────────────────────────────────────────┤
│  Level 3: Agent Teams                   │
│  └── 运行时协作团队处理复杂任务         │
│  └── 如：Planner + Coder + Reviewer    │
│  └── Sub-agents 可在 Team 中被调用     │
└─────────────────────────────────────────┘
```

**关键区分**：
- **Sub-agents**：静态配置，专项能力
- **Agent Teams**：动态创建，协作能力
- **关系**：Sub-agents 可以被 Agent Teams 的成员调用

### 3.2 冲突 2：TUI 单会话 vs Daemon 多会话

**冲突描述**：
- 当前 TUI 为单会话交互设计
- Daemon 需要支持多会话管理
- TUI 需要能附加到 Daemon 的某个会话

**解决方案**：
```
┌─────────────────────────────────────────┐
│              SaCode TUI                 │
├─────────────────────────────────────────┤
│  Mode 1: Standalone (默认)              │
│  └── 直接运行 Agent，无 Daemon         │
├─────────────────────────────────────────┤
│  Mode 2: Daemon Attached                │
│  └── sacode attach <session-id>         │
│  └── 附加到 Daemon 的某个会话          │
│  └── TUI 显示该会话的交互内容           │
├─────────────────────────────────────────┤
│  Mode 3: Daemon Monitor                 │
│  └── sacode daemon monitor              │
│  └── TUI 显示所有会话列表和状态         │
└─────────────────────────────────────────┘
```

### 3.3 冲突 3：Memory 系统的隔离 vs 共享

**冲突描述**：
- Sub-agents 需要独立的上下文窗口（隔离）
- Agent Teams 需要共享任务上下文（共享）
- Memory 系统需要支持两种模式

**解决方案**：
```rust
pub enum MemoryScope {
    /// 单 Agent 私有
    Private(String),    // agent-id
    
    /// Sub-agent 私有
    SubAgent(String),   // sub-agent-name
    
    /// Agent Team 共享
    Team(String),       // team-id
    
    /// 全局共享
    Global,
}

pub struct MemoryEntry {
    pub scope: MemoryScope,
    pub content: String,
    pub timestamp: u64,
}
```

### 3.4 冲突 4：Windows 兼容性

**冲突描述**：
- 当前 `shell.exec` 使用 `Command::new("sh")`
- 当前 `fs.search` 使用 `Command::new("grep")`
- Daemon 进程管理依赖 POSIX 信号

**解决方案**：
```rust
#[cfg(unix)]
use std::os::unix::process::CommandExt;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub fn create_shell_command() -> Command {
    if cfg!(target_os = "windows") {
        let mut cmd = Command::new("cmd");
        cmd.arg("/C");
        cmd
    } else {
        let mut cmd = Command::new("sh");
        cmd.arg("-c");
        cmd
    }
}
```

**影响**：所有功能实现前必须解决 Windows 兼容性问题。

---

## 四、实现路线图（分阶段）

### 阶段 1：基础强化（2-3 周）

**目标**：解决 P0 阻塞问题，为后续功能铺路

- [ ] **Windows 兼容性**（P0）
  - `shell.exec` 跨平台实现
  - `fs.search` 跨平台实现
  - 进程管理跨平台实现
- [ ] **Memory 系统扩展**
  - 支持多 Scope（Private/SubAgent/Team/Global）
  - 支持持久化到 SQLite
- [ ] **Model Router 增强**
  - 支持运行时动态切换
  - 支持 Failover Context 注入

### 阶段 2：Sub-agents + Agent Teams（6-8 周）

**目标**：实现核心差异化功能

- [ ] **Sub-agents**
  - YAML front matter 解析
  - `sacode agent` CLI 命令
  - TUI 集成
- [ ] **Agent Teams**
  - TeamMember 实例化
  - 角色间通信机制
  - Orchestrator 集成
- [ ] **动态路由 × Agent**
  - 每个 Agent 独立路由
  - 节点评分
  - 失败接管

### 阶段 3：Daemon + HTTP API（6-8 周）

**目标**：实现后台常驻服务

- [ ] **Daemon 核心**
  - PID 文件注册表
  - 进程管理
  - HTTP 服务器
- [ ] **HTTP API**
  - RESTful API
  - ACP 协议
  - Swagger 文档
- [ ] **TUI 适配**
  - 附加模式
  - 监控模式

### 阶段 4：定时任务 + Channels（4-6 周）

**目标**：实现自动化和外部集成

- [ ] **定时任务**
  - Cron 表达式解析
  - 任务队列管理
  - TUI 集成
- [ ] **Channels**
  - 微信 Channel
  - Webhook Channel
  - MCP 集成

### 阶段 5：优化与稳定（2-4 周）

**目标**：性能优化和稳定性提升

- [ ] **性能优化**
  - Token 消耗优化
  - 内存占用优化
  - 并发控制
- [ ] **稳定性**
  - 错误恢复
  - 日志完善
  - 监控告警

**总工作量**：20-29 周（5-7 个月）

---

## 五、"完美呈现"的定义与妥协

### 5.1 什么是"完美"？

| 维度 | 完美标准 | 现实评估 |
|------|---------|---------|
| **功能完整** | 所有功能都实现 | 可实现，但需 5-7 个月 |
| **性能优异** | Token 消耗可控 | Agent Teams 模式消耗较高，需优化 |
| **用户体验** | 无缝切换各模式 | TUI 需要大规模重构 |
| **跨平台** | Windows/Linux/macOS 完美运行 | 需要额外工作解决 Windows 兼容 |
| **稳定性** | 7x24 小时无故障 | Daemon 模式下需要持续监控 |

### 5.2 必须做出的妥协

| 妥协项 | 说明 | 影响 |
|--------|------|------|
| **Agent Teams 默认关闭** | 用户手动开启，避免 Token 消耗过高 | 用户需要了解成本 |
| **Daemon 单实例** | 不支持多 Daemon 实例 | 简化进程管理 |
| **Channels 先支持 Webhook** | 微信/Telegram 延后 | 降低初期复杂度 |
| **定时任务上限 10 个** | 避免资源耗尽 | 满足大多数场景 |

---

## 六、与 CodeBuddy 的全量对比

### 6.1 SaCode vs CodeBuddy 功能矩阵

| 功能 | CodeBuddy | SaCode（当前） | SaCode（未来） |
|------|-----------|---------------|---------------|
| **动态模型路由** | 无 | **有** | **有（增强）** |
| **模式化沙箱** | default/delegate | **Plan/Build/Yolo** | **Plan/Build/Yolo（增强）** |
| **失败接管** | 手动重试 | **自动切换模型** | **自动切换模型（增强）** |
| **节点评分** | 无 | **有** | **有（增强）** |
| **Agent Teams** | 有 | 无 | **有（差异化）** |
| **Sub-agents** | 有 | 无 | **有（差异化）** |
| **Daemon** | 有 | 无 | **有（差异化）** |
| **HTTP API** | 有 | 无 | **有（差异化）** |
| **定时任务** | 有 | 无 | **有（差异化）** |
| **Channels** | 有 | 无 | **有（差异化）** |
| **Skills** | 有 | 无 | 计划中 |
| **Hooks** | 有 | 无 | 计划中 |
| **插件系统** | 有 | 无 | 计划中 |
| **检查点** | 有 | 无 | 计划中 |
| **Git Worktree** | 有 | 无 | 计划中 |
| **远程控制** | 有 | 无 | 计划中 |
| **Web UI** | 有 | 无 | 计划中 |
| **SDK** | Python/TS | 无 | 计划中 |

### 6.2 SaCode 的差异化优势（实施后）

| 维度 | CodeBuddy | SaCode（未来） |
|------|-----------|--------------|
| **Agent 调度** | 静态配置 | **动态路由 + 角色编排** |
| **失败处理** | 手动重试 | **自动接管 + 节点评分** |
| **安全策略** | default/delegate | **Plan/Build/Yolo（模式化）** |
| **Token 效率** | 中 | **高（动态路由优化）** |
| **协作模式** | Sub-agents | **Agent Teams + Sub-agents** |
| **自动化** | 定时任务 | **定时任务 + 动态路由** |

---

## 七、结论

### 7.1 能否"完美呈现"？

**可以，但需要分阶段、有取舍**

| 阶段 | 功能 | 可行性 | 时间 |
|------|------|--------|------|
| **Phase 1** | Sub-agents + Agent Teams | 高 | 6-8 周 |
| **Phase 2** | Daemon + HTTP API | 高 | 6-8 周 |
| **Phase 3** | 定时任务 + Channels | 中 | 4-6 周 |
| **Phase 4** | 优化与稳定 | 高 | 2-4 周 |

### 7.2 关键成功因素

1. **先解决 Windows 兼容性**（P0 阻塞）
2. **先实现 Sub-agents 和 Agent Teams**（核心竞争力）
3. **Daemon 作为基础设施**（支撑其他功能）
4. **保持 Token 消耗可控**（用户成本敏感）
5. **TUI 渐进式重构**（避免一次性大改）

### 7.3 建议的实现顺序

```
第 1-2 月：基础强化 + Sub-agents + Agent Teams
    │
    ▼
第 3-4 月：Daemon + HTTP API
    │
    ▼
第 5 月：定时任务 + Channels
    │
    ▼
第 6 月：优化与稳定
```

### 7.4 最终判断

**SaCode 可以在 6 个月内实现与 CodeBuddy 同等甚至超越的功能**，关键在于：

1. **差异化**：动态模型路由、模式化沙箱、失败接管、节点评分
2. **模块化**：每个功能独立可运行，降低风险
3. **渐进式**：避免大爆炸式重构，降低回归风险

**但"完美"需要定义**：如果完美意味着"所有功能都实现且性能优异"，需要 6 个月；如果完美意味着"核心差异化功能实现且稳定运行"，4 个月即可。
