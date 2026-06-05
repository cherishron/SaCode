# SaCode Sub-agents 升级方案

> 结合 SaCode 差异化优势的子代理设计

---

## 一、CodeBuddy Sub-agents 核心特性

### 1.1 设计哲学

CodeBuddy 的 Sub-agents 是**预配置的持久化 AI 人格**：

- **特定目的和专业领域**（如代码审查、测试生成）
- **独立上下文窗口**（与主对话隔离）
- **自定义系统提示**（指导行为）
- **工具访问控制**（限制子代理可用工具）
- **模型选择**（可为每个子代理指定不同模型）
- **权限模式**（default/acceptEdits/bypassPermissions/plan/ignore）
- **Skills 自动加载**

### 1.2 配置示例

```markdown
---
name: code-reviewer
description: 代码审查专家。在代码更改后主动使用。
tools: Read, Grep, Glob, Bash
model: gemini-3.0-flash
permissionMode: default
skills: skill1, skill2
---

你是一位高级代码审查员。专注于代码质量、安全性和最佳实践。
```

### 1.3 调用方式

- **自动调用**：CodeBuddy 识别任务类型后自动分发给匹配的子代理
- **显式调用**：`使用 code-reviewer 子代理检查我最近的更改`
- **`/agents` 命令**：交互式管理界面

---

## 二、SaCode 当前 vs CodeBuddy Sub-agents

| 维度 | SaCode（当前） | CodeBuddy Sub-agents |
|------|--------------|---------------------|
| **Agent 形态** | 运行时角色（Planner/Coder/Reviewer） | 预配置持久化人格 |
| **上下文** | 共享 ExecutionContext | 独立上下文窗口 |
| **系统提示** | 角色内置（硬编码） | YAML front matter 自定义 |
| **工具控制** | 无（所有工具可用） | 逗号分隔工具列表 |
| **模型选择** | **动态路由**（运行时选择） | 静态指定（YAML配置） |
| **权限模式** | **Plan/Build/Yolo** | default/acceptEdits/bypassPermissions... |
| **持久化** | 无（运行时创建） | **项目级 + 用户级存储** |
| **调用方式** | Orchestrator 自动调度 | 自动 + 显式 + /agents |
| **Skills** | 运行时加载 | 子代理启动时自动加载 |

---

## 三、SaCode 的优势结合点

### 3.1 动态模型路由 × Sub-agents

**CodeBuddy**：子代理使用静态指定的模型
**SaCode**：子代理启动时**动态路由最优模型**

```rust
// runtime/src/agents/sub_agent.rs
pub struct SubAgent {
    pub name: String,
    pub description: String,
    pub role: AgentRole,
    pub resolved_route: Option<ResolvedRoleRoute>, // 动态路由结果
    pub tools: Vec<String>,
    pub sandbox_policy: SandboxPolicy,
    pub skills: Vec<String>,
}

impl SubAgent {
    pub fn new(config: SubAgentConfig, workdir: &Path) -> Self {
        let mut agent = Self::from_config(config);
        // SaCode 优势：动态模型路由
        agent.resolved_route = resolve_role_route(workdir, &agent.role, &TaskProfile::default());
        agent
    }
    
    pub async fn execute(&self, task: &Task) -> SubAgentResult {
        // 使用动态路由结果执行
        let route = self.resolved_route.as_ref()
            .expect("model route not resolved");
        // ...
    }
}
```

### 3.2 模式化沙箱 × Sub-agents

**CodeBuddy**：子代理有独立的 `permissionMode`
**SaCode**：子代理继承主模式的沙箱策略，或**独立配置**

```rust
// 子代理的沙箱策略
pub enum SubAgentSandboxPolicy {
    /// 继承主模式策略
    Inherit,
    /// 独立配置
    Custom(SandboxPolicy),
}

// Plan 模式创建的子代理：只读
// Build 模式创建的子代理：审批
// Yolo 模式创建的子代理：自动
```

### 3.3 失败接管 × Sub-agents

**CodeBuddy**：子代理失败需手动重试
**SaCode**：子代理失败**自动切换模型重试**

```
SubAgent-A (code-reviewer) 执行失败
    │
    ▼
评分: 0.3 (低分)
    │
    ▼
自动切换模型 → SubAgent-A' (gpt-5)
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

### 3.4 节点评分 × Sub-agents

**CodeBuddy**：无评分机制
**SaCode**：子代理执行后**自动评分**，低分触发模型切换

```rust
pub struct SubAgentResult {
    pub success: bool,
    pub output: String,
    pub node_score: Option<NodeScore>, // SaCode 优势
    pub used_route: Option<ResolvedRoleRoute>,
    pub retry_count: usize,
}
```

---

## 四、SaCode Sub-agents 设计方案

### 4.1 文件格式

```markdown
---
name: code-reviewer
description: 代码审查专家。在代码更改后主动使用。
role: Reviewer
tools: fs.read, fs.search, git.diff, shell.exec
model: auto  # SaCode 优势：动态路由
permissionMode: build  # Plan/Build/Yolo
skills: rust-review, security-check
---

你是一位高级代码审查员。专注于代码质量、安全性和最佳实践。

## 审查清单

- [ ] 安全性：是否存在 SQL 注入、XSS 等漏洞
- [ ] 性能：是否存在明显的性能问题
- [ ] 可维护性：代码是否清晰、可测试
- [ ] 规范性：是否符合项目代码规范
```

### 4.2 存储位置

```
~/.sacode/agents/              # 用户级子代理
├── code-reviewer.agent.md
├── test-generator.agent.md
└── doc-writer.agent.md

./.sacode/agents/              # 项目级子代理
├── rust-expert.agent.md
└── api-designer.agent.md
```

### 4.3 CLI 管理

```bash
# 列出所有子代理
sacode agent ls

# 创建子代理
sacode agent create code-reviewer

# 编辑子代理
sacode agent edit code-reviewer

# 删除子代理
sacode agent rm code-reviewer

# 显式调用子代理
sacode "使用 code-reviewer 审查 src/main.rs"

# 自动调用（Orchestrator 识别任务类型后自动分发）
sacode "审查最近的代码更改"
```

### 4.4 TUI 集成

```
┌──────────────────────────────────────────┐
│ SubAgents (3)                            │
├──────────────────────────────────────────┤
│ code-reviewer ● auto                     │
│ test-generator ● auto                    │
│ doc-writer ● manual                      │
├──────────────────────────────────────────┤
│ [Enter] 调用  [e] 编辑  [d] 删除  [n] 新建│
└──────────────────────────────────────────┘
```

---

## 五、与 SaCode 现有功能的结合

### 5.1 Sub-agents × Agent Teams

| 功能 | Sub-agents | Agent Teams |
|------|-----------|-------------|
| **Agent 形态** | 预配置持久化人格 | 运行时动态创建 |
| **上下文** | 独立上下文 | 独立上下文 + 共享任务列表 |
| **通信** | 向主代理汇报 | 角色间直接通信 |
| **模型** | 动态路由 | 动态路由 |
| **适用场景** | 专项任务（审查、测试） | 复杂协作（并行开发） |

**结合使用**：

```
用户: "重构认证模块"
    │
    ▼
Orchestrator 分析任务
    │
    ▼
创建 Agent Team
    ├── Planner（动态路由到推理模型）
    ├── Coder-A × 3（并行，动态路由到编码模型）
    │       └── SubAgent: rust-expert（自动调用）
    ├── Reviewer × 2（并行，动态路由到审查模型）
    │       └── SubAgent: code-reviewer（自动调用）
    └── Supervisor（动态路由到综合模型）
```

### 5.2 Sub-agents × 动态模型路由

```rust
// 子代理启动时自动路由最优模型
pub fn spawn_sub_agent(config: SubAgentConfig) -> SubAgent {
    let mut agent = SubAgent::from_config(config);
    
    // SaCode 优势：动态模型路由
    agent.resolved_route = resolve_role_route(
        &agent.role,
        &TaskProfile::from_prompt(&agent.description),
    );
    
    // 评分后决定是否切换
    if agent.node_score.map(|s| s.value < 0.5).unwrap_or(false) {
        agent.maybe_switch_model();
    }
    
    agent
}
```

### 5.3 Sub-agents × 模式化沙箱

```rust
// 子代理的沙箱策略
pub fn get_sub_agent_sandbox_policy(
    parent_mode: ExecutionMode,
    sub_agent_config: &SubAgentConfig,
) -> SandboxPolicy {
    match sub_agent_config.permission_mode {
        PermissionMode::Inherit => SandboxPolicy::for_mode(parent_mode),
        PermissionMode::Custom(policy) => policy,
    }
}
```

---

## 六、实现路径

### Phase 1: SubAgent 配置解析（1周）

```rust
// runtime/src/agents/sub_agent.rs
pub struct SubAgentConfig {
    pub name: String,
    pub description: String,
    pub role: AgentRole,
    pub tools: Vec<String>,
    pub model: String, // "auto" 表示动态路由
    pub permission_mode: PermissionMode,
    pub skills: Vec<String>,
    pub system_prompt: String,
}

impl SubAgentConfig {
    pub fn from_file(path: &Path) -> Result<Self> {
        // 解析 YAML front matter + Markdown body
    }
}
```

### Phase 2: SubAgent 管理 CLI（1周）

```bash
sacode agent ls
sacode agent create <name>
sacode agent edit <name>
sacode agent rm <name>
```

### Phase 3: Orchestrator 集成（1-2周）

- Orchestrator 识别任务类型后自动分发给匹配的 SubAgent
- SubAgent 执行后返回结果
- Orchestrator 汇总结果

### Phase 4: TUI 集成（1周）

- `/agents` 命令打开子代理管理界面
- 子代理状态显示
- 显式调用子代理

---

## 七、与 CodeBuddy 的关键差异

| 维度 | CodeBuddy Sub-agents | SaCode Sub-agents |
|------|---------------------|-------------------|
| **模型选择** | 静态指定（YAML配置） | **动态路由**（运行时选择最优模型） |
| **失败处理** | 手动重试 | **自动接管**（3次重试→切换模型→兜底） |
| **权限模式** | default/acceptEdits/bypassPermissions... | **Plan/Build/Yolo**（模式化沙箱） |
| **安全策略** | 独立配置 | **继承主模式 + 独立配置** |
| **评分机制** | 无 | **节点评分**（低分自动切换模型） |
| **持久化** | 项目级 + 用户级 | 项目级 + 用户级（复用 Memory 系统） |
| **调用方式** | 自动 + 显式 + /agents | 自动 + 显式 + /agents |

---

## 八、总结

SaCode Sub-agents 不是简单复制 CodeBuddy 的"预配置人格"模式，而是将 SaCode 的**动态模型路由、模式化沙箱、失败接管、节点评分**等核心优势与 Sub-agents 深度结合。

**核心价值**：
- 每个 SubAgent **自动使用最优模型**（动态路由）
- SubAgent 失败时**自动切换模型**而非人工重试
- SubAgent 沙箱策略**继承主模式**（Plan/Build/Yolo）
- SubAgent 执行后**自动评分**，低分触发模型切换

**实现工作量**：3-5 周
- Phase 1: SubAgent 配置解析（1周）
- Phase 2: SubAgent 管理 CLI（1周）
- Phase 3: Orchestrator 集成（1-2周）
- Phase 4: TUI 集成（1周）

**与 Agent Teams 的关系**：
- Sub-agents 是**预配置的专项专家**（如代码审查、测试生成）
- Agent Teams 是**运行时协作团队**（Planner→Coder→Reviewer）
- Sub-agents 可以在 Agent Teams 中被**自动调用**（如 Reviewer 角色自动调用 code-reviewer SubAgent）
