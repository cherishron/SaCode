# SaCode Agent Teams 升级方案

> 版本: 0.1.17（草案）
> 核心原则: 以 SaCode 差异化优势为中心，不做简单复制

---

## 一、SaCode vs CodeBuddy Agent Teams 的核心差异

| 维度 | CodeBuddy | SaCode（升级后） |
|------|-----------|----------------|
| **Agent 形态** | 独立实例 | 角色 + 动态路由 + 独立实例 |
| **模型选择** | 统一模型 | **节点级动态路由**（Planner→Coder→Reviewer 各用不同模型） |
| **任务分解** | 领导分配 | **Planner 自动分解 + 评分** |
| **失败处理** | 手动重试 | **自动接管**（3次重试→切换模型→最终兜底） |
| **安全策略** | 统一模式 | **Plan/Build/Yolo 独立策略** |
| **上下文传递** | 共享初始 Prompt | **Failover Context 独立注入** |
| **通信方式** | @提及消息 | **角色间消息 + Orchestrator 汇总** |
| **Token 消耗** | 高（独立实例） | **中**（动态模型路由 + 评分优化） |

---

## 二、架构设计

### 2.1 核心创新：动态模型路由 × 角色驱动编排 × 多实例协作

```
用户输入
    │
    ▼
┌─────────────────────────────────────────┐
│           TaskAnalyzer                  │
│  分析任务 → 估算复杂度 → 评分风险         │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│           Orchestrator                  │
│  根据分析结果选择编排模式                  │
│  Single / Role-Driven / Agent-Team      │
└─────────────────────────────────────────┘
    │
    ▼ (Agent Team 模式)
┌─────────────────────────────────────────┐
│           Planner (Node A)              │
│  任务分解 → 子任务列表                    │
│  模型: 推理型（如 DeepSeek-R1）           │
│  路由评分 → 低分则切换                   │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│     Coder (Node B) × N 并行            │
│  编码任务执行                            │
│  模型: 编码型（如 DeepSeek-Coder）       │
│  沙箱策略: Build 模式                    │
│  失败 → 自动切换模型重试                 │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│     Reviewer (Node C) × N 并行          │
│  代码审查                               │
│  模型: 审查型（如 GPT-4o）              │
│  冲突检测 → ConflictRecord               │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│     SummaryCompactor                     │
│  多 Worker 结果折叠                      │
│  冲突解决 → 共识输出                     │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│     Supervisor (Node D)                │
│  最终审查                               │
│  模型: 综合型（如 GPT-5）               │
│  生成 ExecutionReport                   │
└─────────────────────────────────────────┘
```

### 2.2 与 CodeBuddy 的关键差异

**CodeBuddy Agent Teams**：
- 领导（Team Lead）创建团队
- 成员（Teammates）独立工作
- 通过 `@提及` 直接通信
- 统一任务列表（Task List）
- 每个成员使用**相同模型**（或用户指定）

**SaCode Agent Teams**：
- **无"领导"概念**，Orchestrator 是调度器不是 Agent
- 成员是**角色绑定**的（Coder/Reviewer 自动分配）
- 通信通过 **Failover Context** 和 **ConflictRecord**
- **动态模型路由**为每个角色自动选择最优模型
- **节点评分**决定是否需要切换模型
- **沙箱策略**按模式隔离（Plan 只读 / Build 审批 / Yolo 自动）

---

## 三、核心设计

### 3.1 TeamMember 结构

```rust
// runtime/src/agents/team.rs
pub struct TeamMember {
    /// 角色（Planner / Coder / Reviewer / Supervisor）
    pub role: AgentRole,
    
    /// 独立上下文（非共享）
    pub context: ExecutionContext,
    
    /// 动态路由结果
    pub resolved_route: Option<ResolvedRoleRoute>,
    
    /// 节点评分
    pub node_score: Option<NodeScore>,
    
    /// 沙箱策略（按模式独立）
    pub sandbox_policy: SandboxPolicy,
    
    /// 消息收件箱
    pub mailbox: Mailbox,
    
    /// 任务列表（共享引用）
    pub task_list: Arc<Mutex<TaskList>>,
    
    /// 执行结果
    pub result: Option<WorkerRunResult>,
}

impl TeamMember {
    /// 根据角色自动选择模型
    pub fn auto_route(&mut self, workdir: &Path) {
        self.resolved_route = resolve_role_route(
            workdir,
            &self.role,
            &self.context.profile,
        );
    }
    
    /// 评分后决定是否切换模型
    pub fn maybe_switch_model(&mut self, score: NodeScore) -> bool {
        if score.value < 0.5 {
            // 切换模型重试
            self.auto_route(&self.context.workdir);
            true
        } else {
            false
        }
    }
}
```

### 3.2 通信机制

**CodeBuddy**：@提及消息（Mailbox）
**SaCode**：角色间消息 + Orchestrator 汇总

```rust
// runtime/src/agents/communication.rs
pub enum TeamMessage {
    /// 角色间通信（Planner → Coder）
    RoleMessage {
        from: AgentRole,
        to: AgentRole,
        content: String,
    },
    
    /// 失败上下文注入
    FailoverContext {
        failed_node: String,
        error: String,
        retry_count: usize,
    },
    
    /// 冲突记录
    ConflictRecord {
        role_a: AgentRole,
        role_b: AgentRole,
        conflict: String,
        polarity: OutputPolarity,
    },
    
    /// Orchestrator 汇总
    OrchestratorSummary {
        consensus: String,
        risk_level: RiskLevel,
    },
}
```

### 3.3 动态模型路由在 Agent Teams 中的应用

```rust
// runtime/src/agents/orchestrator.rs
pub async fn execute_agent_team(
    context: &ExecutionContext,
    checkpoints: &CheckpointStorage,
) -> Result<ExecutionReport> {
    // 1. 分析任务
    let analysis = analyze_task(&context.task.prompt, &workdir, &profile);
    
    // 2. 创建团队成员
    let members = create_team_members(&analysis);
    
    // 3. 为每个角色动态路由模型
    for member in &mut members {
        member.auto_route(&workdir);
    }
    
    // 4. 并行执行
    let results = execute_parallel(&members, &profile, &workdir).await;
    
    // 5. 节点评分
    let scores = score_nodes(&results);
    
    // 6. 低分节点自动切换模型重试
    let retry_results = handle_failover(&members, &scores).await;
    
    // 7. 冲突检测与解决
    let conflicts = detect_conflicts(&retry_results);
    let consensus = resolve_conflicts(conflicts);
    
    // 8. Supervisor 最终审查
    let report = supervisor_review(consensus).await;
    
    Ok(report)
}
```

### 3.4 沙箱策略在 Agent Teams 中的应用

```rust
// 不同角色使用不同沙箱策略
let planner = TeamMember::new(AgentRole::Planner)
    .sandbox_policy(SandboxPolicy::readonly());

let coders = create_parallel(3, AgentRole::Coder)
    .sandbox_policy(SandboxPolicy::build());

let reviewers = create_parallel(2, AgentRole::Reviewer)
    .sandbox_policy(SandboxPolicy::readonly());

let supervisor = TeamMember::new(AgentRole::Supervisor)
    .sandbox_policy(SandboxPolicy::yolo());
```

---

## 四、与 SaCode 现有功能的结合

### 4.1 动态模型路由 + Agent Teams

| 场景 | 传统方案 | SaCode 方案 |
|------|----------|-------------|
| Planner 推理失败 | 手动重试 | **自动切换到推理型模型** |
| Coder 编码质量低 | 统一模型 | **切换到编码型模型** |
| Reviewer 审查不通过 | 忽略 | **切换审查模型 + 冲突注入** |
| Supervisor 汇总失败 | 报错 | **切换综合型模型兜底** |

### 4.2 模式化沙箱 + Agent Teams

| 模式 | Planner | Coder | Reviewer | Supervisor |
|------|---------|-------|----------|------------|
| **Plan** | 只读，无网络 | 无（Plan 不执行） | 无 | 只读 |
| **Build** | 只读 | 审批 + 网络 | 只读 | 审批 |
| **Yolo** | 只读 | 自动 + 网络 | 只读 | 自动 |

### 4.3 失败接管 + Agent Teams

```
Coder-A (DeepSeek-Coder) 执行失败
    │
    ▼
评分: 0.3 (低分)
    │
    ▼
自动切换模型 → Coder-A' (GPT-5)
    │
    ▼
注入 Failover Context
    │
    ▼
Coder-A' 继续执行
    │
    ▼
评分: 0.8 (通过)
```

---

## 五、TUI 交互设计

### 5.1 与 CodeBuddy 的差异

| 功能 | CodeBuddy | SaCode |
|------|-----------|--------|
| `@提及` | 直接通信 | **保留**，但通信内容经过 Orchestrator 汇总 |
| 成员状态 | `●` `✓` `✗` `—` | **增加模型路由状态**：`DeepSeek-Coder ●` `GPT-5 ✓` |
| 任务列表 | 共享 Task List | **共享 Task List + 角色分配** |
| 焦点导航 | `↓` 切换成员 | **`↓` 切换角色**（Planner/Coder/Reviewer/Supervisor） |
| Token 消耗 | 显示总消耗 | **按角色显示**，高亮模型切换次数 |

### 5.2 新增 TUI 元素

```
┌──────────────────────────────────────────┐
│ Team: auth-refactor                       │
│ Planner ● DeepSeek-R1  │  Coder ● GPT-5   │
│ Reviewer ✓ GPT-4o    │  Supervisor ● GPT-5│
├──────────────────────────────────────────┤
│ [Coder-A] 执行中...                      │
│ 模型: DeepSeek-Coder → GPT-5 (已切换)     │
│ 评分: 0.3 → 0.8                          │
├──────────────────────────────────────────┤
│ [Reviewer-A] 审查通过                     │
│ 冲突: 无                                 │
├──────────────────────────────────────────┤
│ [Supervisor] 汇总中...                   │
│ 共识: 通过                               │
└──────────────────────────────────────────┘
```

---

## 六、实现路径

### Phase 1: TeamMember 实例化（2周）

将 `run_sub_agent` 从函数调用升级为**独立实例**：

```rust
// runtime/src/agents/team.rs
pub async fn spawn_team_member(
    role: AgentRole,
    task: SubAgentTask,
    profile: &TaskProfile,
) -> TeamMember {
    let member = TeamMember::new(role, task);
    member.auto_route(&workdir); // 动态路由
    member
}
```

### Phase 2: 通信机制（1-2周）

实现 `TeamMessage` 和 `Mailbox`：

```rust
// 复用现有 Event 模型
pub enum TeamMessage {
    RoleMessage { from, to, content },
    FailoverContext { failed_node, error, retry_count },
    ConflictRecord { role_a, role_b, conflict, polarity },
    OrchestratorSummary { consensus, risk_level },
}
```

### Phase 3: TUI 升级（2-3周）

- 增加角色状态栏（显示模型名称 + 路由状态）
- `@提及` 补全
- 焦点导航（按角色切换）

### Phase 4: 集成测试（1-2周）

- 动态模型路由在多实例场景下的稳定性
- 沙箱策略在角色隔离下的正确性
- 失败接管机制的有效性

---

## 七、与 SaCode 现有功能的对比

| SaCode 现有功能 | Agent Teams 升级后 |
|-----------------|-------------------|
| 角色驱动编排 | **扩展为多角色并行** |
| 动态模型路由 | **按角色独立路由** |
| 模式化沙箱 | **按角色独立策略** |
| 节点评分 | **按角色评分 + 自动切换** |
| 失败接管 | **Failover Context 在角色间传递** |
| 冲突解决 | **SummaryCompactor 升级为多角色共识** |
| 多任务队列 | **扩展为角色间任务协调** |
| Memory 系统 | **角色间 Memory 隔离 + 共享** |

---

## 八、不走偏的边界

- 不做 Web UI 或 IDE 集成
- 不做云端服务（Daemon 暂缓）
- 聚焦 CLI 终端内的团队协作
- 以动态模型路由 + 角色驱动编排为核心差异化

---

## 九、总结

SaCode Agent Teams 的升级不是简单复制 CodeBuddy 的"独立实例 + @提及"模式，而是将 SaCode 的**动态模型路由、角色驱动编排、模式化沙箱、失败接管**等核心优势与多实例协作深度结合。

**核心价值**：
- 每个角色自动使用**最优模型**
- 失败时**自动切换模型**而非人工重试
- 安全策略**按角色隔离**
- Token 消耗**低于独立实例**（动态路由优化）

这是 SaCode 在 AI 编程工具领域的**独特差异化**。
