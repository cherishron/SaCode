# 事件溯源第二步：ExecutionReport 投影化实施切片设计

> 状态：**设计文档（欠账补录，v1.1.0 收口）**
> 关联：`docs/report-plan.md` §T7 事件投影 / Event Sourcing
> 关联代码：`runtime/src/session/event_log.rs`、`runtime/src/tools/interceptor.rs`、`runtime/src/tools/interceptors/default.rs`

## 1. 现状（v1.1.0 事件流地基）

v1.1 已完成事件流投影的第一步（事件记录与基础投影），构成后续切片的地基：

- `SessionEventLog`（`.sacode/events.log`）：工具执行全生命周期事件（`tool_call_started` /
  `tool_call_finished` / `tool_call_denied`）JSON Lines 落盘 + 进程内 4096 条限时缓冲。
- `seq` 全局单调递增序号，**落盘**（`#[serde(default)]` 兼容旧日志，旧日志按行序重建）。
- `replay_after(seq)` 内存回放 / `replay_disk_after(seq)` 磁盘回放（旧日志行序兼容）。
- `project_session_state(session_id)` 内存投影：`total_calls` / `completed` / `failed` / `denied` /
  `last_tool` / `last_seq`，缓冲环状淘汰时 `truncated=true` 显式暴露。
- `project_session_state_complete(session_id)` 磁盘全量 + 内存增量合并投影（不受淘汰影响）。
- 拦截器 `AuditInterceptor` 在每个工具调用点发布 Started/Finished/Denied 事件（§3.2 链）。

**当前未覆盖**：会话结束时各 Agent 的 `ExecutionReport`（含 `events: Vec<...>` 执行摘要）仍由
各执行路径独立聚合维护，与 events.log 事件流**双写不一致**（同一工具调用在 report 与 events.log
中可能计数不同），尚未利用事件流做单一事实来源。

## 2. 目标

把 `ExecutionReport` 从"路径内聚合"迁移到"事件流投影"，使：

1. **单一事实来源**：所有统计（calls / completed / failed / denied / 时间线）从 events.log +
   内存增量投影得出，路径内不再维护平行计数。
2. **跨进程一致**：daemon 重启 / 多 worker 场景下 report 可从磁盘事件完整重建。
3. **审计可追踪**：report 的每条统计可追溯回具体事件 seq（`last_seq` 提供游标）。

## 3. 实施切片

### 切片 1：report 构建时投影（增量，落地 v1.1 之后首个小步）

- 在会话结束/压缩时，将 `ExecutionReport` 的统计字段改为从
  `SessionEventLog::global().project_session_state(session_id)`（内存）或
  `project_session_state_complete(session_id)`（需要全量时）填充。
- 路径内仍保留事件**原始列表**（`events: Vec<SessionEvent>`）用于前端时间线渲染，
  但不再承载统计计数（计数来自投影）。
- **兼容**：report 结构体字段名不变，仅赋值来源变化；旧 report 数据不迁移（投影为只读视图）。

### 切片 2：checkpoint 快照化

- 新增 `SessionCheckpoint`（会话级投影快照）：`{ session_id, stats, last_seq, ts }`，
  序列化为 `.sacode/checkpoints/<session_id>.json`。
- 会话结束/压缩时写入快照；重启后 `project_session_state_complete` 以快照为基底，
  只重放 `last_seq` 之后的事件增量（O(增量) 而非 O(全量)）。
- 快照与 events.log 双写；快照损坏/缺失时退化为全量重放（事件日志为最终真相）。

### 切片 3：audit.log 合并 events.log

- `AuditInterceptor` 的 `preflight_*` / `execution` 两阶段审计保留在 `.sacode/audit.log`
  （审批/拦截视角），工具调用生命周期事件统一收敛到 `.sacode/events.log`（行为视角）。
- 两个日志以 `seq`（events.log）与 `ts + tool`（audit.log）关联；SIEM 侧可 join。
- 本切片**不删除** audit.log 任何字段（保持 SIEM 兼容），仅明确职责边界并在文档标注。

## 4. 风险与兼容

| 风险 | 缓解 |
|------|------|
| events.log 4096 条缓冲淘汰导致投影计数偏低 | `project_session_state_complete`（磁盘合并）消除淘汰影响；`truncated` 标志显式暴露；checkpoint（切片 2）进一步固化 |
| 旧 events.log 无 `seq` | `#[serde(default)]` + 行序重建，回放兼容已验证（测试 `replay_disk_handles_legacy_log_without_seq`） |
| report 与 events.log 双写不一致 | 切片 1 收敛：report 统计改由投影填充，消除平行计数 |
| 快照与日志漂移 | 事件日志为最终真相，快照仅作性能优化，损坏即退化重放 |
| 拦截器默认链行为变更 | 本设计不改变拦截器注册/顺序；仅新增 report 构建路径的取值来源 |

## 5. 验收口径（切片完成后）

- [ ] 会话结束 report 统计与 `project_session_state_complete` 输出一致（幂等测试覆盖）
- [ ] 重启后 report 可从磁盘事件重建，与内存路径计数一致
- [ ] checkpoint 快照写入后可增量重放，结果与全量重放一致
- [ ] 旧 events.log 项目可正常启动与回放（无 `seq` 崩溃）
- [ ] audit.log / events.log 职责边界文档化
