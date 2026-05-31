# SaCode 节点级动态模型路由方案

## 方案定位

本方案用于在 **同一个执行器** 内实现 **节点级动态换模型**。

它解决的问题是：

1. 不同任务节点对模型能力的要求不同
2. 单模型执行可能因技术栈不匹配、长推理不足、稳定性问题而失败
3. 当前执行链需要在失败后保留上下文并切换到下一候选模型继续执行

本方案的调度对象是 **任务执行节点**，不是多 Agent 并行系统。

---

## 设计原则

1. **同一执行器内换模型**
   - 不创建平行 Agent 系统
   - 不引入独立 `Scheduler + AgentFactory + DynamicAgent` 架构

2. **自动分析优先，显式配置覆盖**
   - 默认由系统根据任务与项目上下文自动选择模型
   - 用户或项目配置可覆盖候选顺序

3. **节点评分后再决定是否切换**
   - 评分只发生在任务节点结束后
   - 低分直接切模型

4. **失败接管上下文单独注入**
   - 切换模型时使用独立的 `[Failover Context]` section
   - 避免把接管信息混入普通 user prompt

5. **复用现有 SaCode 结构**
   - `runner` 继续作为主执行链
   - `provider_runtime` 演进为路由候选解析层
   - `runtime` 承载画像、路由、评分、接管上下文生成

---

## 当前架构落点

### 现有可复用模块

| 模块 | 当前职责 | 新方案中的角色 |
|------|----------|----------------|
| `interfaces/cli/src/runner.rs` | 主执行链、tool chat、状态输出 | 节点执行与切模型主入口 |
| `interfaces/cli/src/provider_runtime.rs` | 解析单个 `ModelProvider` | 升级为模型候选与路由计划入口 |
| `runtime/src/prompt/mod.rs` | 统一 prompt、wiki 注入 | 任务画像输入源、Failover Prompt 组装 |
| `runtime/src/provider/client.rs` | 模型调用、tool chat、多轮工具交互 | 保持底层调用层，供路由执行复用 |
| `runtime/src/wiki/mod.rs` | user/project/session knowledge 汇总 | 任务画像与失败接管上下文输入 |
| `runtime/src/memory/mod.rs` | typed memory、索引、搜索 | 任务画像与任务恢复事实输入 |

### 当前不建议引入的新层

1. 独立常驻 `Scheduler`
2. 平行 `AgentFactory`
3. 外置独立 `models.yaml`
4. 多 Agent 并行执行框架

---

## 核心对象

### TaskProfile

用于描述当前任务的技术与执行画像。

```rust
pub struct TaskProfile {
    pub languages: Vec<String>,
    pub frameworks: Vec<String>,
    pub surfaces: Vec<String>,
    pub task_kinds: Vec<String>,
    pub needs_reasoning: bool,
    pub risk_level: TaskRiskLevel,
    pub evidence: Vec<String>,
}
```

### 画像来源

1. 用户任务文本
2. 工作区结构
3. 配置文件特征
4. `AGENTS.md`
5. `.sacode/prompt.md`
6. `wiki` / `memory` 摘要
7. 最近失败历史

### 第一版识别目标

1. 语言
   - Rust: `Cargo.toml`
   - Go: `go.mod`
   - Python: `pyproject.toml`, `requirements.txt`
   - Node: `package.json`

2. 框架
   - Vite / Next / Nuxt / Django / FastAPI / Spring 等

3. Surface
   - `cli`
   - `tui`
   - `lsp`
   - `runtime`
   - `kernel`
   - `docs`

4. 任务类型
   - implementation
   - refactor
   - bugfix
   - test
   - docs

5. reasoning 需求
   - 复杂跨模块修改、架构决策、长工具链任务时置为 `true`

---

### RoutedModel

```rust
pub struct RoutedModel {
    pub provider_name: String,
    pub model_name: String,
    pub route_score: i32,
    pub health_score: i32,
    pub needs_thinking: bool,
    pub reasons: Vec<String>,
}
```

### ModelRoutePlan

用于描述当前任务节点的模型候选顺序。

```rust
pub struct ModelRoutePlan {
    pub primary: RoutedModel,
    pub fallbacks: Vec<RoutedModel>,
    pub route_reason: String,
}
```

### 选模优先级

1. 技术栈匹配
2. 长推理适配度
3. 可用性与稳定性兜底

### 配置策略

1. 自动分析优先
2. 显式配置覆盖自动结果

建议在现有 `.sacode` 配置体系上增加路由偏好层，而不是引入新的独立配置文件。

当前最小实现已经支持：

1. `match.languages`
2. `match.surfaces`
3. `prefer`

匹配成功后，`prefer` 中越靠前的模型优先级越高，格式固定为 `provider/model`。

示意：

```json
{
  "model_routing": {
    "overrides": [
      {
        "match": {
          "languages": ["rust"],
          "surfaces": ["cli"]
        },
        "prefer": [
          "provider_a/model_x",
          "provider_b/model_y"
        ]
      }
    ]
  }
}
```

项目级配置示例：

文件：`.sacode/config.json`

```json
{
  "model": "deepseek/deepseek-v4-pro",
  "provider": {
    "deepseek": {
      "name": "DeepSeek",
      "base_url": "https://api.deepseek.com",
      "api_key": "${DEEPSEEK_API_KEY}",
      "models": {
        "deepseek-v4-pro": {
          "thinking": true
        }
      }
    },
    "openai": {
      "name": "OpenAI",
      "base_url": "https://api.openai.com/v1",
      "api_key": "${OPENAI_API_KEY}",
      "models": {
        "gpt-4.1": {},
        "gpt-4o-mini": {}
      }
    }
  },
  "model_routing": {
    "overrides": [
      {
        "match": {
          "languages": ["rust"],
          "surfaces": ["cli"]
        },
        "prefer": [
          "deepseek/deepseek-v4-pro",
          "openai/gpt-4.1"
        ]
      },
      {
        "match": {
          "surfaces": ["docs"]
        },
        "prefer": [
          "openai/gpt-4.1",
          "openai/gpt-4o-mini"
        ]
      }
    ]
  }
}
```

生效规则：

1. 先按任务画像和健康缓存生成默认排序。
2. 再应用 `model_routing.overrides` 提升匹配模型。
3. 未命中 override 时保持自动路由结果。

---

### ExecutionNode

用于表示一个完整的任务执行节点。

```rust
pub struct ExecutionNode {
    pub provider_name: String,
    pub model_name: String,
    pub prompt_digest: String,
    pub tool_calls: Vec<NodeToolCall>,
    pub final_text: String,
    pub pending_question: Option<serde_json::Value>,
    pub usage: Option<ChatUsage>,
    pub duration_ms: u64,
}
```

### 节点边界

一个节点等于：

1. 一次模型响应
2. 一次工具调用闭环
3. 一个自然停顿点
4. 然后统一评分并决定下一步

---

### NodeScore

```rust
pub enum NodeDecision {
    Accept,
    SwitchModel,
    WaitForUser,
    WaitForApproval,
    Fail,
}

pub struct NodeScore {
    pub score: u8,
    pub decision: NodeDecision,
    pub reasons: Vec<String>,
}
```

### 评分时机

只在 **任务节点结束后** 评分。

### 第一版评分依据

#### 硬失败信号

1. provider error
2. timeout
3. 空响应
4. 非法工具结构
5. 工具调用链明显失效

#### 质量失败信号

1. 输出与任务技术栈不匹配
2. 没有推进任务，只做空泛描述
3. 工具调用明显跑偏
4. 与项目上下文冲突
5. 重复已经失败过的动作

### 决策规则

1. `WaitForUser` 和 `WaitForApproval` 优先返回，不切模型
2. 低分直接切模型
3. 候选耗尽后进入 `Fail`

---

### FailoverContext

用于切换模型时注入任务接管上下文。

```rust
pub struct FailoverContext {
    pub original_task: String,
    pub completed_steps: Vec<String>,
    pub tool_summary: Vec<String>,
    pub last_error: Option<String>,
    pub low_score_reasons: Vec<String>,
    pub workspace_summary: Vec<String>,
    pub retained_facts: Vec<String>,
}
```

### Prompt 注入形式

切换模型时新增独立 section：

```text
[Failover Context]
Original Task:
<原始任务>

Completed Steps:
- <已完成步骤>

Tool Summary:
- <工具调用摘要>

Last Error:
<最近错误>

Low Score Reasons:
- <低分原因>

Workspace Summary:
- <当前工作区状态摘要>

Retained Facts:
- <可继续信任的中间结论>
```

---

## 执行流程

### 阶段 1：构建任务画像

1. 收集用户任务文本
2. 扫描工作区结构与配置文件
3. 读取 `AGENTS.md` / `.sacode/prompt.md`
4. 读取 wiki / memory 摘要
5. 汇总最近失败历史
6. 生成 `TaskProfile`

### 阶段 2：生成模型路由计划

1. 从现有 provider 配置解析所有可用模型
2. 根据 `TaskProfile` 打分排序
3. 应用显式 override 规则
4. 生成 `ModelRoutePlan`

### 阶段 3：执行当前节点

1. 选择 `primary`
2. 使用当前执行链完成一个 `ExecutionNode`
3. 收集输出、工具调用、耗时、pending 状态

### 阶段 4：节点评分

1. 如果等待用户或审批，直接返回等待态
2. 如果节点通过评分，继续当前执行链
3. 如果节点低分，进入切模型流程

### 阶段 5：切模型接管

1. 生成 `FailoverContext`
2. 从 `fallbacks` 中取下一个模型
3. 把 `[Failover Context]` 作为独立 section 注入
4. 在同一个执行器内继续执行

### 阶段 6：兜底结束

1. 候选模型耗尽后返回失败
2. 失败原因写入最近失败历史，供后续画像与路由使用

---

## 模块落点

### runtime

建议新增：`runtime/src/model_routing/mod.rs`

职责：

1. `TaskProfile` 定义与构建
2. `ModelRoutePlan` 生成
3. `NodeScore` 规则评分
4. `FailoverContext` 生成
5. 显式 override 匹配逻辑

### provider_runtime

`interfaces/cli/src/provider_runtime.rs` 从：

```rust
resolve_provider(workdir) -> ModelProvider
```

演进为：

```rust
resolve_model_candidates(workdir) -> Vec<ModelProvider>
build_model_route_plan(workdir, task_profile) -> ModelRoutePlan
```

职责：

1. 把现有 provider/model 配置映射成候选模型集合
2. 连接 CLI 配置与 runtime 路由规则

### runner

`interfaces/cli/src/runner.rs` 作为主接入点。

新增职责：

1. 构建 `TaskProfile`
2. 获取 `ModelRoutePlan`
3. 执行 `primary`
4. 构造 `ExecutionNode`
5. 触发 `NodeScore`
6. 必要时切换模型并继续执行

### prompt

`runtime/src/prompt/mod.rs` 建议后续增加：

```rust
build_failover_prompt(...)
```

职责：

1. 统一生成 `[Failover Context]`
2. 保持普通 prompt 与接管 prompt 的拼装规范一致

---

## 第一版实现边界

第一版只做最小闭环：

1. `TaskProfile`
   - 识别语言、框架、surface、任务类型、reasoning 需求

2. `ModelRoutePlan`
   - 从现有 provider 配置里构造候选列表
   - 按技术栈匹配、thinking 需求、可用性排序

3. `NodeScore`
   - 只做规则评分
   - 输出 `Accept / SwitchModel / WaitForUser / WaitForApproval / Fail`

4. `FailoverContext`
   - 生成独立 section
   - 切换模型时注入

第一版暂不做：

1. judge model 评分
2. 独立常驻 scheduler
3. 多 Agent 并行
4. 外置平行配置文件
5. 全量主动健康探针系统

---

## 后续阶段

### Phase 1：节点级切模闭环

1. 任务画像
2. 候选模型排序
3. 节点评分
4. 低分切模型
5. failover context 注入

### Phase 2：健康缓存

1. 增加短 TTL 健康缓存
2. 请求失败后反向更新状态
3. TUI / daemon 使用更积极缓存策略

### Phase 3：显式路由偏好持久化

1. 把路由偏好写入 `.sacode` 配置
2. 支持项目级覆盖自动路由结果

### Phase 4：增强评分

1. 在规则评分之外增加可选 judge 机制
2. 仅在规则判定模糊时触发

---

## 风险与注意事项

1. **上下文膨胀**
   - `[Failover Context]` 必须控制长度
   - 只保留任务接管所需摘要，不复制全量历史

2. **错误切模**
   - 第一版评分规则要保守
   - `WaitForUser` / `WaitForApproval` 不能误判为低分

3. **CLI 启动成本**
   - 不适合每次启动都全量健康探测
   - 第一版优先使用懒更新与失败回写

4. **配置分叉**
   - 路由偏好应叠加到现有 `.sacode` 配置体系
   - 不新增平行配置入口

5. **调试可观测性**
   - 路由理由、评分理由、切模原因要保留在输出或日志中

---

## 实施顺序

1. 编写本技术方案文档
2. 在 `runtime` 增加 `model_routing` 模块
3. 改造 `provider_runtime`，从单模型解析升级为候选路由计划
4. 改造 `runner`，接入节点执行、评分、切模型闭环
5. 补充定向测试与失败接管测试

---

## 一句话结论

SaCode 后续的动态执行演进方向，应当是 **节点级动态模型路由**，而不是多 Agent 调度系统。
