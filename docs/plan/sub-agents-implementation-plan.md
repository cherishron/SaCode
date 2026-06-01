# SaCode Sub-agents 实施方案

> 来源：`docs/plan/final-roadmap.md`
> 优先级：P1
> 前置依赖：runtime 统一化基础完成或至少建立统一 TaskRunner 真源

---

## 一、目标

把当前基于内置角色和 skills 的运行时能力升级成可配置、可持久化、可显式调用、可自动调用的 Sub-agents 系统。

Sub-agents 在 SaCode 中的定位：

- 它是静态配置的专项专家
- 它不是 Agent Team
- 它可以被单任务路径和 Agent Team 路径共同调用

---

## 二、设计目标

Sub-agents 需要具备：

- 独立上下文窗口
- 配置化工具白名单
- 可选独立沙箱策略
- 动态模型路由支持
- skills 自动加载
- 用户级和项目级持久化

---

## 三、配置设计

### 3.1 文件位置

- `~/.sacode/agents/*.agent.md`
- `./.sacode/agents/*.agent.md`

项目级优先级高于用户级。

### 3.2 文件格式

建议沿用 markdown front matter：

```md
---
name: code-reviewer
description: 代码审查专家
role: reviewer
tools: fs.read, fs.search, git.diff, shell.exec
model: auto
permissionMode: build
skills: rust-review, security-check
---

你是一位高级代码审查员。
```

### 3.3 配置字段

必须支持：

- `name`
- `description`
- `role`
- `tools`
- `model`
- `permissionMode`
- `skills`

后续可扩展：

- `sandbox`
- `routeHints`
- `memoryScope`

---

## 四、运行时模型

建议新增：

- `SubAgentConfig`
- `SubAgentSpec`
- `SubAgentRegistry`
- `SubAgentInvocation`
- `SubAgentResult`

### 4.1 运行时职责

#### SubAgentRegistry

- 负责扫描用户级与项目级 agent 文件
- 负责合并、去重和优先级覆盖

#### SubAgentInvocation

- 记录一次实际调用
- 挂接统一 runtime 的 `TaskRun` / `WorkerRun`

#### SubAgentResult

- 产出结构化执行结果
- 包含 route、summary、retry_count、node_score

---

## 五、核心能力设计

### 5.1 动态模型路由

规则：

- `model: auto` 时走 SaCode 现有动态路由
- 显式模型配置作为强覆盖
- route 结果写入结构化记录

### 5.2 工具白名单

agent 只能访问配置里声明的工具。

建议实现：

- 在 `ToolRegistry` 前增加 agent scoped filter
- 或为 invocation 生成 scoped registry

### 5.3 沙箱策略

支持两种方式：

- 继承主任务 mode
- 使用 agent 自己的 `permissionMode`

建议第一版先支持：

- `plan`
- `build`
- `yolo`

### 5.4 memory scope

建议第一版新增：

- `Agent(name)`

这样每个 sub-agent 都可以拥有独立记忆域。

### 5.5 skills 自动加载

在 agent invocation 创建时自动解析 `skills` 字段，并将 skill prompt 展开到 agent 上下文中。

---

## 六、CLI 设计

建议新增：

- `sacode agent ls`
- `sacode agent show <name>`
- `sacode agent run <name> "task"`
- `sacode agent path`

后续可扩展：

- `sacode agent create`
- `sacode agent edit`
- `sacode agent rm`

---

## 七、自动调用设计

第一版建议只做两种触发：

1. 显式调用
2. orchestrator / runtime 根据任务类型自动选择单个 sub-agent

后续再做：

- 多 sub-agent 协作
- sub-agent 被 Agent Team 成员调用

---

## 八、模块落点建议

### runtime

建议新增：

- `runtime/src/agents/sub_agent.rs`
- `runtime/src/agents/sub_agent_registry.rs`

或：

- `runtime/src/sub_agents/`

### config / storage

建议复用现有 `.sacode` 配置加载模型，不新增完全独立体系。

### interfaces/cli

建议新增：

- `interfaces/cli/src/cmd/agent.rs`

---

## 九、实施阶段

### Phase 1：配置解析与 registry

工作内容：

- front matter 解析
- 用户级 / 项目级扫描
- 合并优先级处理

验收标准：

- `agent ls/show` 可用

### Phase 2：单次 invocation 执行

工作内容：

- agent scoped tool filtering
- agent scoped route 选择
- agent scoped sandbox policy

验收标准：

- `agent run <name>` 可执行并输出结构化结果

### Phase 3：与主任务路径集成

工作内容：

- runtime 自动识别合适 sub-agent
- orchestrator 可调用 sub-agent

验收标准：

- 至少支持 code review / test / docs 三类 agent 自动触发

---

## 十、测试策略

### 单元测试

- front matter 解析
- registry 合并优先级
- tool filtering
- permissionMode 映射

### 集成测试

- `agent ls`
- `agent show`
- `agent run`
- 主任务路径自动调用

---

## 十一、完成定义

1. 支持用户级和项目级 Sub-agent 文件
2. 支持显式运行 Sub-agent
3. 支持动态模型路由或显式模型覆盖
4. 支持工具白名单
5. 支持独立或继承式权限模式
6. 支持 agent scoped memory scope

---

## 十二、完成后的收益

- 让 SaCode 拥有可配置专家层
- 为 Agent Teams 提供稳定的静态能力层
- 让用户和项目可以显式沉淀专项 AI 工作流
