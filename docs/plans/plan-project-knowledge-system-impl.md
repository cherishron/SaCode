# 项目级知识沉淀系统实施清单

## 目标

本清单用于把 `docs/plans/project-knowledge-system-plan.md` 里的方案拆解成可实施的工程任务，直接对应 SaCode 当前代码结构。

目标聚焦三件事：

1. 让项目知识自动沉淀
2. 让知识进入执行链路并提升任务质量
3. 让知识系统具备可维护、可审核、可淘汰能力

## 当前基础

当前已有能力分布如下：

### Runtime

- `runtime/src/memory/mod.rs`
  - 记忆类型、索引结构、append/rebuild/search/promote/archive
- `runtime/src/wiki/mod.rs`
  - wiki 汇总、分层上下文加载、状态检查
- `runtime/src/prompt/mod.rs`
  - 运行时 prompt 注入 wiki 上下文

### CLI

- `interfaces/cli/src/cmd/memory/mod.rs`
  - `/memory show|list|summary|path|search|append|promote|archive`
- `interfaces/cli/src/cmd/wiki.rs`
  - `/wiki`
- `interfaces/cli/src/cmd/mistakes.rs`
  - mistakes 读取入口

### 数据源

- `.sacode/wiki/*.md`
- `.sacode/wiki/index.json`
- `.sacode/mistakes.json`
- `.sacode/sessions/*.json`

## 总体实施顺序

### P0

先打通“候选知识生成与审核”闭环：

1. 扩展记忆状态机
2. 增加候选知识生成器
3. 增加审核命令
4. 增加项目画像生成器

### P1

让知识参与执行：

1. 场景化 prompt 注入
2. 知识命中反馈回写
3. 高频知识排序
4. 自动归档低价值知识

### P2

将知识系统接入长期协作：

1. 工作流模板化
2. 错误模式自动提炼
3. 模块画像自动维护
4. 恢复能力与知识联动

## P0 实施清单

## 任务 1：扩展 MemoryStatus

### 目标

让自动学习生成的条目先进入候选态，避免直接污染生效知识。

### 文件

- `runtime/src/memory/mod.rs`

### 变更

将：

```rust
pub enum MemoryStatus {
    Active,
    Archived,
}
```

扩展为：

```rust
pub enum MemoryStatus {
    Candidate,
    Active,
    Archived,
    Rejected,
}
```

### 同步修改点

- `search_memory_index(...)`
  - 默认只搜索 `Active`
- `list_memory_entries(...)`
  - 支持按状态过滤展示
- `append_memory_entry(...)`
  - 手工追加仍默认 `Active`
- `rebuild_memory_index(...)`
  - 从 markdown 重建时默认 `Active`

### 测试

新增：

- `test_candidate_entries_not_in_default_search`
- `test_manual_append_creates_active_entry`

## 任务 2：扩展 MemoryIndexEntry 元数据

### 目标

为后续命中反馈、排序、淘汰提供数据基础。

### 文件

- `runtime/src/memory/mod.rs`

### 新字段

```rust
pub tags: Vec<String>,
pub hit_count: u64,
pub success_count: u64,
pub failure_count: u64,
pub last_hit_at: Option<String>,
pub last_used_session: Option<String>,
pub related_paths: Vec<String>,
pub related_commands: Vec<String>,
```

### 兼容要求

- 旧版 `index.json` 反序列化不能失败
- 新字段必须有合理默认值

### 建议实现

为 `MemoryIndexEntry` 增加 `#[serde(default)]`

### 测试

- `test_load_legacy_memory_index_without_new_fields`
- `test_new_entry_defaults_feedback_fields`

## 任务 3：新增候选知识写入能力

### 目标

支持系统自动写入 `Candidate` 条目。

### 文件

- `runtime/src/memory/mod.rs`

### 新增 API

建议新增：

```rust
pub fn append_candidate_memory_entry(
    root: &Path,
    entry: &MemoryEntry,
    confidence: f32,
    tags: Vec<String>,
    related_paths: Vec<String>,
    related_commands: Vec<String>,
) -> Result<bool>
```

### 规则

- 自动学习条目默认 `source = AutoLearned`
- 默认 `status = Candidate`
- 同内容重复候选应跳过
- 若已有 `Active` 同内容条目，跳过生成

### 测试

- `test_append_candidate_memory_entry`
- `test_skip_duplicate_candidate_if_active_exists`

## 任务 4：从 mistakes 自动生成候选知识

### 目标

把失败记录提炼成项目可复用知识。

### 文件

- 新增：`runtime/src/memory/learn.rs`
- 可能复用：`interfaces/cli/src/cmd/mistakes.rs`

### 输入来源

- `.sacode/mistakes.json`

### 提炼规则

优先提炼为：

- `pitfalls.md` 对应的 `MemoryKind::General` 或 `Workflow`

候选生成条件：

1. summary 非空
2. details 非空
3. 同类错误达到最小频次阈值，例如 2 或 3 次
4. 可归纳成稳定的错误模式和修复路径

### 生成内容格式建议

`context`
- `自动学习: 从 mistakes.json 提炼`

`content`
- `发布后需验证 npm tarball URL 可访问，避免 npm 元数据存在但 tarball 404。`

### 测试

- `test_generate_candidate_from_repeated_mistakes`
- `test_skip_low_frequency_mistake_patterns`

## 任务 5：从 recent sessions 自动生成候选知识

### 目标

从最近会话中提炼重复稳定工作流。

### 文件

- 新增：`runtime/src/memory/learn.rs`
- 参考：`runtime/src/wiki/mod.rs` 的 `build_session_summary(...)`

### 输入来源

- `.sacode/sessions/*.json`

### 提炼目标

- 发布流程
- 调试流程
- 构建命令
- 验证顺序

### 初版简化策略

P0 不做复杂 NLP，先做规则提炼：

- 提取最近 N 个 session summary
- 对高频命令片段计数
- 识别固定顺序的命令链路

### 输出位置

- 优先写入项目级 `workflows.md` 的候选条目

### 测试

- `test_generate_candidate_workflow_from_sessions`

## 任务 6：新增项目画像生成器

### 目标

自动生成 `project-profile.md`，减少项目初始化解释成本。

### 文件

- 新增：`runtime/src/wiki/profile.rs`
- 新增：`interfaces/cli/src/cmd/memory/profile.rs` 或并入 `memory/mod.rs`

### 命令

建议新增：

```bash
sacode memory profile
```

### 输出文件

- `.sacode/wiki/project-profile.md`

### 生成内容

1. 项目类型
2. 语言和构建系统
3. 顶层目录结构
4. 核心入口
5. 常用命令
6. 发布链路
7. 平台差异
8. 风险区域

### 当前仓库可提炼规则

- Rust workspace
- `interfaces/* -> runtime -> kernel`
- `npm-package/` 是 npm 发布目录
- 根 `Cargo.toml` 是版本源头
- `scripts/check-release.js` 是发版校验入口

### 测试

- `test_generate_project_profile_for_workspace_repo`

## 任务 7：新增候选知识审核命令

### 目标

让用户可以确认或拒绝自动学习结果。

### 文件

- `interfaces/cli/src/cmd/memory/mod.rs`
- 可能新增：
  - `interfaces/cli/src/cmd/memory/approve.rs`
  - `interfaces/cli/src/cmd/memory/candidates.rs`

### 新命令

```bash
sacode memory candidates
sacode memory approve <entry_id>
sacode memory reject <entry_id>
```

### 行为

`candidates`
- 只展示 `Candidate`

`approve`
- `Candidate -> Active`
- 可选提升 confidence

`reject`
- `Candidate -> Rejected`

### 渲染要求

展示：

- id
- kind
- confidence
- context
- content
- tags

### 测试

- `test_memory_candidates_only_show_candidate_entries`
- `test_approve_candidate_entry`
- `test_reject_candidate_entry`

## P1 实施清单

## 任务 8：按场景选择性注入知识

### 目标

缩短 prompt，提升知识相关性。

### 文件

- `runtime/src/prompt/mod.rs`
- `runtime/src/wiki/mod.rs`

### 建议新增结构

在 `WikiContext` 上新增：

```rust
pub struct WikiContext {
    pub user_summary: Option<String>,
    pub project_summary: Option<String>,
    pub session_summary: Option<String>,
    pub release_summary: Option<String>,
    pub pitfalls_summary: Option<String>,
    pub modules_summary: Option<String>,
}
```

### 注入策略

- 发版任务注入 `release + commands + pitfalls`
- 调试任务注入 `pitfalls + mistakes`
- 改代码任务注入 `modules + decisions`
- 初始化任务注入 `project-profile + workflows`

### 测试

- `test_prompt_injects_release_knowledge_for_publish_task`
- `test_prompt_injects_modules_for_code_change_task`

## 任务 9：增加知识命中反馈

### 目标

知道哪些知识真的有帮助。

### 文件

- `runtime/src/memory/mod.rs`
- `interfaces/cli/src/runner.rs`
- `runtime/src/prompt/mod.rs`

### 新增 API

```rust
pub fn record_memory_hit(...)
pub fn record_memory_success(...)
pub fn record_memory_failure(...)
```

### 触发点

- 某条记忆进入 prompt 时记一次 hit
- 任务成功完成且知识命中时记 success
- 任务失败且知识命中时记 failure

### 测试

- `test_record_memory_hit_updates_index`
- `test_record_memory_success_and_failure`

## 任务 10：高频知识排序和低价值归档

### 目标

让好知识靠前，旧知识退场。

### 文件

- `runtime/src/memory/mod.rs`
- `runtime/src/wiki/mod.rs`

### 规则建议

排序优先级：

1. `Active`
2. `hit_count`
3. `success_count`
4. `confidence`
5. `created_at`

自动归档候选条件：

- 长期零命中
- failure_count 远高于 success_count
- 被更新条目 supersede

## P2 实施清单

## 任务 11：工作流模板化

### 目标

把高频流程从“知识”升级成“可复用模板”。

### 文件

- 新增：`runtime/src/wiki/workflows.rs`
- 新增：`interfaces/cli/src/cmd/workflow.rs`

### 能力

- 展示项目工作流模板
- 由工作流模板生成任务建议
- 从历史任务自动更新模板内容

## 任务 12：模块画像自动维护

### 目标

让 `modules.md` 不是一次性生成，而是随代码变化更新。

### 文件

- 新增：`runtime/src/wiki/modules.rs`

### 输入

- workspace 成员
- crate 依赖关系
- 入口文件
- 常见目录命名约定

## 任务 13：恢复能力与知识联动

### 目标

任务中断后，能利用知识和最近上下文继续执行。

### 文件

- `interfaces/cli/src/tui/task_runtime.rs`
- `runtime/src/wiki/mod.rs`
- `runtime/src/prompt/mod.rs`

### 能力

- 中断时记录本次使用过的知识条目
- 恢复时优先注入最近有效知识
- 将恢复成功经验写回 `workflows` 或 `pitfalls`

## 命令设计总表

建议最终形成：

```bash
sacode memory show
sacode memory list
sacode memory search <query>
sacode memory append <content>
sacode memory promote <entry_id>
sacode memory archive <entry_id>

sacode memory candidates
sacode memory approve <entry_id>
sacode memory reject <entry_id>
sacode memory learn
sacode memory profile
sacode memory rebuild
sacode memory stats

sacode wiki
sacode wiki doctor
```

## 测试策略

### Runtime 单元测试

目录：

- `runtime/src/tests/wiki.rs`
- 新增 `runtime/src/tests/memory_learning.rs`

覆盖：

- 候选知识生成
- 状态流转
- legacy index 兼容
- 项目画像生成
- 场景化 prompt 注入

### CLI 测试

目录：

- `interfaces/cli/src/cmd/memory/*`
- 可新增 `interfaces/cli/src/cmd/command_tests/memory_learning.rs`

覆盖：

- candidates 渲染
- approve/reject 命令
- profile 命令输出
- stats 命令输出

## 推荐落地顺序

第一批直接做：

1. `MemoryStatus` 扩展
2. `MemoryIndexEntry` 扩展
3. `memory candidates / approve / reject`
4. `memory profile`
5. `mistakes -> candidate` 自动提炼

第二批再做：

1. session -> candidate workflow
2. prompt 场景化注入
3. hit / success / failure 反馈

第三批再做：

1. 工作流模板化
2. 模块画像自动维护
3. 恢复联动

## 最终效果预期

完成上述实施后，SaCode 应具备以下能力：

1. 在项目内越用越懂当前仓库
2. 在不同项目之间严格隔离知识
3. 自动积累常见坑和稳定工作流
4. 用更短 prompt 命中更有用的项目知识
5. 通过审核和反馈持续提高知识质量

这会让 SaCode 从“能执行任务”继续升级为“真正理解项目上下文的开发助手”。
