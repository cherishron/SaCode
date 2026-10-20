# F06 上下文压缩设计：D03 从 marker 到实际请求投影

日期：2026-10-20  
状态：实现设计，未施工、未构建、未运行验收。  
归属：**F06 上下文与用量 / D03**。D02 请求预算已闭合，本设计不重开、不改变其拒绝逻辑。  
一期：**本地确定性摘录、截断与标记**，不调用外部 LLM，不承诺语义摘要质量。

## 1. 范围与交付定义

本设计只定义：压缩何时准入、历史如何选择、本地摘要如何生成和校验、如何持久发布、后续真实请求如何使用，以及失败/取消/恢复口径。

D03 的最小闭环必须同时满足：

1. 产生可回放的本地压缩产物，而不是只记录前后计数。
2. 请求投影实际以摘录替换指定旧历史，保留来源、完整原历史及关键约束。
3. 保持工具调用配对、取消、队列、目标与审批真源不变。
4. 用真实请求捕获夹具证明请求变短且用了对应产物；marker 不能充当完成证据。

一期的摘录不是理解历史后生成的语义总结。展示与事件必须标注 `strategy=local-extractive-v1`、`lossy=true`，明确有信息省略。若关键内容无法安全保留，拒绝本次压缩，不用截断掩盖缺失。

### 1.1 不做的事

- 不引入外部 LLM、embedding、向量库或 extjs 摘要进程；不增加上游请求、费用或自动重试。
- 不修改 TokenMeter、输出上限选择、费用预留、用量结算、已有预算错误码与图片估算拒绝。
- 不删除/重写 SessionLog 原历史，不裁剪转录页，不把摘要存为长期记忆。
- 不修改计划、知识索引、权限、Goal 调度器等其它能力实现；仅列出压缩必须遵守的接口边界。
- 不重放工具、执行命令或消费队列以完成压缩；不恢复已取消的模型请求。
- 本轮只写本文，不修改 core/Host/CLI/桌面源码，不触碰构建，不涉及其他执行方工作。

## 2. 现状盘点（本轮只读核对）

### 2.1 marker 的真实能力

| 文件位置 | 已有行为 | 缺口 |
| --- | --- | --- |
| `core/src/compact.cj:9–34` | `CompactionLedger.record(reason,before,after)` 校验三个字段非空，追加 `compaction/record`；`entries()` 回放所有记录正文 | 没有数值解析、`after <= before` 校验、摘要、源区间、阈值、执行器、请求切换 |
| `core/src/compact_test.cj:13–62` | 核记录、空原因拒绝、flush/load 后 marker 可回放；回放不增加表面消息 | 不是实际压缩测试；测试注释所述数值/字面大小约束并未在 `record` 中实现 |
| 全仓 `CompactionLedger` / `compaction/record` 搜索 | 命中上述类和测试 | 本轮未找到生产调用点，故不存在已接通的自动或手动压缩执行链 |

现有编码为 `<reason>::<before>::<after>`，三个字段均是字符串；不把它当新格式结构化产物，也不把旧 marker 自动迁移成已生效摘要。

### 2.2 请求投影现状

- `core/src/model_request.cj:83–187`：`modelRequestJson` 遍历完整事件数组。标准消息、关联工具结果、附件与 Goal 准入提示在此物化；**没有读取 compaction 事件或裁剪历史**。
- `model_request.cj:48–79,168–185`：活跃知识上下文绑定 `targetUserSeq`，并入对应用户消息；目标缺失即拒绝。压缩不得删掉该目标。
- `model_request.cj:104–107`：Goal 准入提示物化为 developer 消息；压缩不能误当普通废弃日志。
- `model_request.cj:115–160,187`：维护 pending tool IDs，拒未结算调用和孤儿结果；截图在同批工具全部结算后物化。压缩不得绕开这些校验。
- `core/src/session.cj:90–93,329–350`：`deriveMessages` 是完整转录投影，不是压缩视图；缓存按 surface 计数与 generation 构建。**不能直接把 deriveMessages 改成裁剪历史**。

### 2.3 调度与安全点现状

- `core/src/model_agent.cj:24–45`：模型流式收帧期间不可切换上下文。
- `model_agent.cj:58–88`：同批工具逐条结算，取消后剩余调用也补关联取消结果，避免孤儿。
- `model_agent.cj:89–104`：确认未取消/未到 step-limit 后才消费 next-step 补充、构造后续请求。这是未来接入请求准备服务的候选安全点，不是已有压缩调用点。
- `core/src/goal_runner.cj:80–98`：Goal 准入、next-turn 送达、准入提示与 checkpoint 在真实开轮前完成。压缩不能额外开轮或改变这些额度/消费规则。
- `core/src/tips.cj:159–179` 的 50/80/95 百分比只决定回复后提示，**不是压缩触发器**，也不能用累计用量替代当前上下文占用。

### 2.4 D02 的既有边界（保持）

`core/src/model_request.cj:196–212` 当前逻辑：

- 解析 `contextWindow`、模型输出上限与任务输出上限，选较小有效输出上限。
- 无 tokenizer 时使用保守 UTF-8 字节界：`messagesBytes + definitionsBytes + 256`，不伪报精确 token。
- 窗口配置时，图片请求继续报 `request-context-image-unestimated`。
- 输入占满窗口或输出预留不够继续报 `request-context-limit`。
- `max_tokens` 的推导和输出字段继续按原逻辑生成。

`core/src/model_request_budget_test.cj` 已覆盖这组行为；`model_router.cj:317–346,412–416` 的 AttemptPlan 已携带容量与输出限制。D03 只增加**显式验证后的历史投影输入**，不删除、放宽或捕获吞掉上述守卫。

`core/src/meter.cj` 的累计用量/只能收紧预算也保持不变。压缩不清零已用、不退费、不扩大窗口、不调整输出预留。

## 3. 架构决策

```text
同一会话完整事件日志（原始真源，始终保留）
           |
           v
RequestPreparation（拟议，共用请求准备边界）
  1. 冻结事件快照、模型容量和当前任务身份
  2. 检查安全点，计算未压缩/已激活视图的字节界
  3. CompactionPlanner：选已终态旧轮次中的可替换完整块
  4. LocalExtractiveCompactor：本地原文摘录 + 省略标记
  5. Validator：来源、约束、配对、字节节省、快照版本
  6. 既有租约 + checkpoint 发布结构化产物
           |
           v
RequestHistoryProjection（拟议，纯读取）
  验证 committed 产物 -> 替换指定历史块 -> 保留受保护消息
           |
           v
modelRequestJson 的原有协议校验与 D02 预算守卫
           |
           v
既有 Provider / 请求审计 / 真实模型传输
```

分工（均为拟议接口，不表示已有类）：

| 对象 | 职责 | 不得做 |
| --- | --- | --- |
| `CompactionPlanner` | 判断自动/手动请求，冻结候选、范围和受保护来源 | 不写日志、不 claim inbox |
| `LocalExtractiveCompactor` | 同输入同输出的截断摘录；检查取消 | 不调用 provider、不猜事实 |
| `CompactionValidator` | 源摘要、事件块边界、不可删内容、实际编码后字节节省 | 不把摘要当授权 |
| `CompactionService` | 去重、排队、发布、持久屏障及相位 | 不在请求投影内隐式启动 |
| `RequestHistoryProjection` | 根据可回放产物物化请求视图 | 不变更日志和转录、不中途 flush |

低层 `modelRequestJson` 仍是纯构造/校验入口。没有有效产物时与原来相同；不偷偷加自动截断作为预算拒绝的替代路径。自动压缩由上层准备服务显式执行，不是捕获 `request-context-limit` 后无限重试。

## 4. 触发与安全点

### 4.1 自动触发

仅当已知当前实际模型的窗口、当前请求可按现有口径估算，且存在可压缩旧历史时，在请求派发前判断：

- `inputBound` 使用与 D02 同源的**编码后** messages/tools 字节界，不能用消息数或累计 usage。
- 已配置输出上限时使用现有较小上限作为预留参考；没有配置时不自行指定新 `max_tokens`。
- 建议软阈值：`inputBound + configuredOutputReserve >= 80% * window`。80% 是一期可调策略参数，不是新的硬预算。
- 建议目标：压缩视图落在窗口的 60% 附近；若不达目标但仍低于原有硬上限，可接受真实净节省；若仍触发 D02，则继续原样拒绝，显示容量不足。
- 未知容量、无法估算图片：自动触发不启用，状态说明 `capacity-unknown` / `image-unestimated`；不绕过 D02 图片拒绝。
- 每个 `(sourceRevision, policyVersion, modelCapacityFingerprint)` 至多尝试一次；无节省不自旋。

容量切换必须重算阈值与最终预算。旧压缩产物的真实性可以仍有效，但不能将较大窗口的请求准入结论复用于较小模型。

### 4.2 手动触发

拟议 `context/compact` 创建本会话压缩请求；`context/describe` 返回策略、来源、相位、摘要区间与计量单位。具体 RPC 名称在实施时冻结，不改现有 `usage/*` 契约。

- 空闲且安全：立即本地处理，无网络。
- 流式中、工具未结算、审批等待中：仅记 queued，返回 queued；**不打断当前请求**。
- 重复操作复用同一个 requestId/相同来源计划，不能叠加省略。
- 手动压缩不是发送按钮，不派发模型、不恢复 Goal、不消费队列。

### 4.3 一期保守安全范围

同时满足：没有活跃 provider 正在出帧；同批工具全部结算；无待答审批/计划审阅/用户提问会被切断；事件快照稳定；取消尚未生效。

**一期只压缩较早的已终态完整轮次；当前 turn 全部保留。** 因而可在工具步边界使用此前旧轮次的压缩视图，但不折叠当前 turn 内刚发生的工具结果。单个超长当前 turn 仍可能容量不足；明确列为一期限制，不以破坏配对换取继续请求。

对于历史不完整、无法证明终态或异常退出的轮次，整轮保留。只从安全完整块中选择；若无候选返回 `no-eligible-history`。

## 5. 历史截取和本地摘要执行器

### 5.1 先分块，不按原始事件序号粗暴截断

从完整日志恢复模型可见块及来源元数据：

1. 普通文本消息块。
2. 一个 assistant tool_calls + 对应全部 tool/result + 附件关联作为**原子工具块**。
3. attachment/record 与其目标 user/message 是原子附件块。
4. log-only Goal 提示、知识引用等按现有请求语义单独识别。

先验证完整原始协议关联，再形成候选。不能通过「删掉坏消息」把原本 orphan/unsettled 的日志变成合法请求；底层原错误必须仍暴露。

### 5.2 一期不可裁剪集合（保守优先）

以下内容保持原文、原角色、原关联，且不受摘要大小预算强制截断：

- **全部 system/message 与 developer/message**，以及所有用户消息。保留全部用户原文避免靠启发式猜测哪句话是目标、禁令、未完成要求或计划约束。
- 当前 turn 全部消息与工具块、最近两个已结束 turn（建议默认保留尾部）。
- 所有 Goal 准入提示，当前 Goal 的正文/修订/阶段真源不变。
- 活跃 knowledge/context 对应 targetUserSeq 及其绑定；其清理、重检与注入保持现有规则。
- 带图片/附件的历史原子块，一期不压缩图片或其引用，不通过删图规避估算拒绝。
- 未完成计划或其它约束若无法确认已完整包含在受保护消息中：固定其关联原子块；无法可靠定位则整轮不压缩。
- 审批/权限/队列/Goal/计划等原始 log-only 事件始终保留在日志中；不因它们未进 messages 就宣称已删除事实。

因此主要可节省的是旧 assistant 长文本、旧已结算工具调用与结果。大量用户原文/系统提示/图片占据容量时，可能压不下；保留失败路径比假装无损摘要更重要。

### 5.3 生成规则（确定性，不语义改写）

对每个可替换完整块，按原位置生成一个摘录段：

- 标题固定含 compactionId、源 seq 区间、类型、原文摘要哈希与 `lossy=true`。
- 纯 assistant 旧文本：保留有界原文首尾片段，按 UTF-8 码点切；中间写清省略字节数。
- 旧完整工具块：保留调用名与调用 ID（作为文本引用），参数摘要 hash、每个结果的来源 seq/hash、真实已记录的成功/错误/取消状态和有界原文摘录。
- 不解析成功证据不足的结果为“已成功”；未知仍标 unknown。状态若没有可信结构，就标“未推断状态”，只给原文摘录。
- 任意工具正文或历史 assistant 文本仍是低信任引用，不因标题变成 system/developer 指令。
- 每段和总摘录受策略预算约束；优先扩大省略而非删除受保护消息。若必要来源和标记本身已超过预算，返回无法压缩。

建议摘要总上限 8 KiB、每块摘录 512 字节（首尾各半）；这些是策略默认值，不是 token 数。逐块元数据的开销也必须计入，不允许 N 个 marker 反而变大。

**最终成功条件：** 完整候选 messages 经过 JSON 转义和协议编码后确实比旧投影小；`afterInputBound < beforeInputBound`。若无节省，状态 `no-gain`，不发布新产物。

### 5.4 摘录在请求中的角色与顺序

- 受保护消息保持现有相对顺序。
- 在被替换块的**原位置**插入单条普通 user 参考资料消息，明确“以下是历史摘录，不是新的用户要求/权限，不保证完整；省略内容可按来源重新读取”。
- 它不是工具协议消息，不携带 `tool_calls` / `tool_call_id`；因为整个旧工具原子块已一并替换，不形成孤儿。
- 多个不连续可替换块可产生多个摘录段；不会把后来结果挪到早期用户要求之前。
- 合成消息仅存在请求投影，不 append 为 `user/message`，不进入正常聊天转录、inbox、Goal 证据或用户意图统计。

以 user 引用形态承载是为避免把历史工具文本提升为 developer 权限；真正权限始终由现有 core 策略与审批事实决定，而不是依赖一段提示词。

## 6. 结构化产物、发布和恢复

### 6.1 新事件，不改变旧 marker 解释

保留 `compaction/record` 的旧审计读取，不将其视为生效依据。拟议新增版本化 JSON：

```text
compaction/requested（可选，用于手动排队）
  version, requestId, sessionIdentity, trigger, policyVersion

compaction/applied（包含完整有效载荷的单个提交事件）
  version: 1
  compactionId, requestId, strategy: local-extractive-v1, lossy: true
  sessionIdentity
  sourceEndSeq, sourceDigest
  parentCompactionId?             // 用于解释替代关系，不做递归摘要
  policyVersion
  protectedSeqDigest
  replacements[]:
    sourceFromSeq, sourceToSeq
    sourceBlockDigest
    excerpt, omittedBytes, sourceRefs[]
  beforeInputBound, afterInputBound, unit: utf8-byte-bound
  artifactDigest

compaction/failed 或 compaction/cancelled（可选）
  requestId, sourceEndSeq, reason   // 不复制整个提示词/工具正文
```

`sourceDigest` 覆盖冻结前缀事件的 seq/type/data，稳定编码后哈希；`sourceBlockDigest` 覆盖被替换块实际来源。hash 用于归属与完整性，不是脱敏保证。

applied 的含义：**已通过校验并持久发布的可用投影版本**，不是“已经向上游发出请求”。是否实际使用，必须关联 §7 的 request 审计。

### 6.2 发布步骤

1. 在安全点冻结快照与 sourceEndSeq；在锁外完成有界本地摘录，定期检查 token。
2. 再核当前关键修订、受保护集合、来源前缀与取消状态。快照相关消息/权限/目标/知识绑定变了就作废本次计划，下一安全点重算；无关日志尾部不要求无限重试。
3. 在现有会话写许可下串行提交，不创建第二个跨进程写者。追加单条 applied 并调用现有 durable checkpoint。
4. **持久确认后才允许请求读取它。** 激活条件为 applied.seq 已落在 durableCount 之前，不能仅凭内存 append。
5. checkpoint 失败：不派发使用未持久产物的请求；保留上个可用视图，按现有耐久失败口径冻结/拒绝继续；不得让未来普通 flush 意外把“失败状态”变成未说明的已采用摘要。

具体锁/取消发布临界区在实施时复用会话串行化机制，不把长摘要构建放进 TurnToken 的启动锁里，也不持锁等网络。

### 6.3 重复压缩与重启

- 始终从原始日志重建可替换块，不把上次摘录文本再摘录，避免层层遗失。
- 新产物替代旧压缩视图；以 sourceEndSeq 前进及策略身份去重。相同来源/策略不重复发布。
- 后续消息只追加尾部，不自动使已冻结的历史块失效；投影保持新的约束消息、知识和当前 turn。
- 回放只接受 schema/哈希/来源/块边界都合法、且持久可见的 applied。旧 marker 对请求无影响。
- 发现损坏或无法验证的产物：不使用该产物；若无法安全选择上一有效产物，则退回完整历史并继续原预算拒绝，不能为恢复成功静默放行。
- queued 请求可显示待处理，但重启不自动派发模型、不重放工具；只在显式恢复任务的下一个安全点处理。
- 已持久 applied 可在恢复时重建视图，即使上次尚未来得及向模型使用；审计应显示“可用但尚未用于请求”。

## 7. 请求投影接线

### 7.1 共享纯投影入口

建议为 `modelRequestJson` 引入内部共享历史视图构造步骤，不另造 Host/CLI 两套 messages：

1. 全量事件验证原始工具/附件关联。
2. 选最新可验证且持久提交的压缩产物，或完整视图。
3. 根据 replacements 映射替换块；保留原 event seq 关联，不重编号来源。
4. 对活跃知识上下文、Goal 提示、工具定义、附件执行现有装配规则。
5. 编码 messages，运行**原 D02 守卫**，再输出最终请求。

不要只把过滤后的 events 数组传入旧代码却丢失来源关系：附件 pendingRefs、knowledge targetUserSeq、工具 IDs 都必须在内部视图中仍可验证。

### 7.2 每条请求入口都要覆盖

未来实现需登记三类接入点：

- 普通任务首请求（含延迟 provider 物化）：在最终事件快照后准备压缩，不能提前冻结第二份陈旧 messages。
- `ModelAgentLoop` 工具结算后续请求：只在未取消、确实准备下一请求时使用服务；不为压缩新增一次 step 或消费 inbox。
- Goal 新轮首请求：依照原准入/额度/队列与 checkpoint 次序，准备当前快照；不能以压缩为理由绕开 blocked/disarmed。

Host/CLI 只是装配同一 core 能力。模型路由重试可复用不可变请求视图，但不得重做工具；换模型后重跑原预算检查。ACP 自有上下文由外部 Agent 控制，不把本设计当成对外部 Agent 的压缩实现。

### 7.3 实际请求取证

在现有 `RequestTraceProvider` 元数据审计边界追加关联元数据（拟议字段或单独事件，实施时冻结）：

```text
request/context
  requestSeq
  compactionId?                // 无压缩时为 null
  sourceEndSeq, artifactDigest?
  retainedSourceRanges, replacedSourceRanges
  projectedMessagesDigest
  inputBound, unit: utf8-byte-bound
```

普通审计**不复制完整请求正文**。本地测试 fixture 可捕获实际 HTTP 请求核对摘录和被省略文本；不能只看 request/context 自报使用。只有 provider 真正开始对应请求后才关联 requestSeq；准备后取消不能记成已请求。

完整历史仍由会话原转录/来源 seq 查看。摘要 marker 与省略提示保留在真实请求里，不是只显示在 UI。

## 8. 取消、队列、权限和容量不足

| 时刻/情况 | 必须行为 |
| --- | --- |
| 构建摘录前/中取消 | 丢弃未提交产物，不发 provider，不推进 Goal、不 claim inbox |
| applied 已持久后、provider 前取消 | 保留合法历史投影版本，但当前请求仍取消；不记录已发送，不回滚已持久事实 |
| 模型流式途中手动 compact | 返回 queued，直到原工具/请求结算安全点；不改已发送正文 |
| 工具未结算 | 整组保留/延后，不删调用或结果补造配对 |
| compact queued 时有 inbox | 不读取并消费队列；只展示 pending 数等元数据，不把未送达正文当模型已收到 |
| 权限/计划/目标在构建时变更 | 丢弃候选或重核保护集合；以最新真源为准。摘录绝不成为批准票 |
| 摘录失败但旧视图仍够容量 | 保留旧视图，可按现有任务规则继续；明确压缩失败，不能显示“压缩成功” |
| 摘录无收益或压后仍超限 | 停止该次请求，沿用 request-context-limit；显示需要缩小输入/显式恢复，不自动重试循环 |
| 容量未知 | 不伪报占用百分比；手动可做安全摘录但不承诺装得下，最终准入仍按已有配置 |
| 程序重启 | 回放产物，不重放请求、不自动恢复被取消任务；原历史/队列/预算仍在 |

“容量不足暂停”是 F06 的运行说明，不擅自新增 Goal blockedReason 或另一套预算状态机。恢复应通过已有用户明确动作/任务启动路径；如需更细暂停相位，作为后续独立接口决定，不在 D03 顺手修改 F04。

## 9. F06 展示与计量口径（非视觉改版）

可提供状态数据，但本轮不设计界面样式或改 UI：

- 容量与来源、占用字节估算、输出预留、累计用量分别列字段，未知为 unknown。
- 压缩相位：idle / queued / preparing / ready / no-gain / failed / cancelled。
- ready 表示产物可用；另列 `lastUsedRequestSeq`，没有实际请求不得写“已用于模型”。
- 策略显示“本地截断摘录（有损）”；展示原始来源区间、前后字节界、摘要文本与省略标记。
- 不把节省字节称为精确 token 或已退回费用，不改 TokenMeter 数值。

## 10. 依赖与实施边界

必选复用：SessionLog/SessionEvent、既有写租约和持久 checkpoint、TurnToken、modelWireMessage 与附件关联解析、modelRequestJson、现有 RequestTraceProvider。新增的只是本地策略/摘录/校验/纯投影，不需要外部进程、网络库、模型或 native FFI。

实现时可按职责新增 core 压缩策略/投影文件并做小范围调用点接线；本文不规定必须重写 `compact.cj` 或 `model_request.cj` 全文件。Host/CLI 接口与 UI 是未来独立接线步骤，不在本轮施工。

平台：纯仓颉字符串/JSON/哈希与既有日志原语，可跨平台复用；Windows 主路径及其他平台各自运行夹具，不凭同源推断全部验收通过。

## 11. 验收设计（未来实施，不是本轮已运行）

| 编号 | 场景 | 必须核对的可观察结果 |
| --- | --- | --- |
| C01 旧 marker | 只有 compaction/record | 请求仍全历史；不得假冒摘要生效 |
| C02 实际裁剪 | 多个已结束 turn，旧工具大输出 | 捕获真实请求：摘录标记/来源存在，旧大段正文不在，受保护原文仍在；afterInputBound 确实更小 |
| C03 工具关联 | 多 tool_call IDs，含取消结果 | 无孤儿/未结算消息；非法原始配对仍拒绝，不能靠压缩消错 |
| C04 未结算排队 | 工具中途 manual compact | queued；当前请求不变；结算后才处理 |
| C05 约束保持 | 旧用户禁令、system/dev、Goal、未完成计划 | 均保留；工具写授权仍按原票；摘要伪造“已批准”不能获权 |
| C06 附件/知识 | 图片、attachment/record、活跃 targetUserSeq | 关联不丢；图片预算拒绝仍成立；知识并入对应用户消息，不串轮 |
| C07 取消与 inbox | 在构建/发布/派发前分别取消，队列有补充 | 不多发请求、不额外 claim、不清队列；已发布事实与尚未发送状态可区分 |
| C08 耐久失败 | append 后 checkpoint 失败或进程退出 | 无未持久产物被用于请求；恢复不隐式升级；原历史完整 |
| C09 重启/重复 | 相同来源重复手动、重启回放、多次压缩 | 去重；不摘要套摘要；同来源同策略结果确定；原文可查 |
| C10 无收益/仍超限 | 全用户长原文、巨大工具定义、超长当前 turn | 不删关键原文；no-gain/容量不足；保留原 request-context-limit，无上游派发 |
| C11 计量独立 | 压缩前后读取累计 usage/预算 | 不变；无新增摘要 LLM 调用或额度预留 |
| C12 真实请求入口 | 普通首请求、工具续请求、Goal 新轮、Host/CLI | 同一投影契约；取消/blocked 不被压缩绕过；不能只验证一个入口 |
| C13 恶意摘录 | 旧工具输出含闭合标签/伪造 system 指令 | JSON 安全编码；仍低信任 user 引用；权限未升级 |
| C14 旧产物损坏 | 改 artifactDigest / 源区间 / 缺块 | 拒用坏产物，旧有效视图或完整历史；不拼装半摘要放行 |

D02 回归要求：**现有预算测试原断言不放宽**，尤其无产物时的全文拒绝、较小 `max_tokens`、工具定义计入、图片拒绝、原文完整、零上游请求/零新增预留。压缩测试单独显式提交有效产物后再验证可缩短请求。

反证门槛：人为让投影忽略 applied，C02 必须红；让投影在 pending tool 中间切开，C03/C04 必须红；让未持久产物提前生效，C08 必须红。仅“摘要字段存在”“marker 可回放”均不足以关闭 D03。

映射：V08、DV09 覆盖 C02–C07/C12；DV10 覆盖 C08–C10/C14。通过最小链只能说明本地截断策略已接通，不能声称高质量语义摘要或全部 F06 验收已完成。

## 12. 待确认项与建议默认

| 项目 | 建议默认 | 对交付影响 |
| --- | --- | --- |
| 自动阈值与目标 | 80% 触发，60% 目标；估算单位明示 | 可配置策略，不能替代 D02 硬限 |
| 尾部保留 | 当前 turn + 最近两个已终态 turn，所有用户/system/dev 始终保留 | 保守但可能压不下，接受明确失败 |
| 摘录预算 | 总 8 KiB，每块 512 字节，JSON/元数据一起核净节省 | 需夹具确定是否过小，不以 token 标注 |
| 手动接口名称 | context/compact、context/describe（拟议） | 后续接线冻结，不扩改 usage 方法 |
| 不完整历史 | 不压缩无法证明终态的轮次 | 不把恢复问题掩盖为压缩成功 |
| D03 收口措辞 | “本地截断摘录与请求投影已接通”，语义摘要不在一期 | 防止用截断冒充 PRD 全部摘要质量目标 |

## 13. 本轮交付与停写

- F17 已归档到 `target/tmp/f17-security-scan-design-20261020/DESIGN.md`；归档与此前已完成正文逐字节一致，未修改其产品实现。
- F06 本文位于 `target/tmp/f06-compression-design-20261020/DESIGN.md`。
- 本轮只新增/归档设计文档；没有修改 core/Host 或其它产品代码，没有构建、测试、提交、推送、安装或调用外部摘要模型。
- 本文是实施输入，不是 D03 修复已完成的声明。
