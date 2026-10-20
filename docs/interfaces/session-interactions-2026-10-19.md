# 会话元信息、工具投影与用户选择卡片契约

2026-10-19，`dev` / `f7cef5f` 上的未提交增量。状态：已接线、局部实测，第一批尚未验收。证据见 [第一批增量记录](../evidence/2026-10-19-first-batch-interactions.md)。

## 会话元信息

| Host 方法 | 桌面有限 IPC | 参数 | 成功回执 |
|---|---|---|---|
| `session/rename` | `sessionRename` | `sessionId, title, expectedRevision` | `saved:true, sessionId, revision` |
| `session/archive` | `sessionArchive` | `sessionId, archived:boolean, expectedRevision` | 同上 |

`expectedRevision` 是目录条目的 `durable` 事件数；内存事件数和耐久事件数必须同时匹配。方法只接受目录中的不透明会话 ID，按对应日志租约串行写入。新标题使用最后一条 `session/title`；归档/恢复追加 `session/archived` 的 `true/false`，不删除、搬移或截断日志。目录保留归档条目，桌面正常侧栏隐藏它们，归档视图提供恢复动作。

运行中的任务、未结算审批、扩展及执行门禁继续生效。冲突返回 `session-revision-conflict`，输入失败如 `bad-session-title`，租约失败沿用既有错误；刷新失败不能伪报保存成功。落盘结果未知时保留失败事实，活动日志进入既有耐久失败保护，不自动重试追加。

`session/catalog` 每项新增 `archived:boolean`、`updatedAt:string`；更新时间来自日志文件最后修改时间，未取得有效时间时 UI 不编造相对时长。

## 工具关联

`session/projection.toolCalls` 为日志派生的最近 64 次标准模型调用，字段为 `id,eventSeq,callId,name,arguments,resultMessageId,status`。结果正文和附件继续由对应 `messageRows` 提供，不在关联字段重复携带大文件。结果只按标准 `tool_call_id` 与同轮未结算调用配对，不按正文或工具名前缀猜测。

状态为 `running/completed/denied/cancelled/failed/unknown`。没有活跃执行器或已有轮次终态时，缺少结果的调用是 `unknown`；旧版无身份工具结果也明确显示缺少关联。模型执行器的结构化 `error` 字段用于失败状态，普通正文开头为 `denied:` 不会把成功结果改判为拒绝。

## 结构化用户选择

只有入口实际注入 `StructuredUserQuestions` 时，模型工具目录才注册 `ask_user_question`。CLI 未注入时不宣称支持此交互。参数 `questions` 为 1–3 项，每项包含 `id,question,type`；`type` 为 `single/multi/confirm/input`。单选/多选使用 2–10 个带 `id,label,description?` 的选项，可声明 `allowCustom`；确认项使用 `yes/no`，输入项使用文本。正文、选项和总载荷均有大小限制。

复用 `UserQuestionStore` 的 `user-questions/request` 与 `user-questions/answer`，取消追加 `user-questions/cancel`。结构化请求有格式标记，旧纯文本请求不会被冒认为卡片。`session/projection.questionCards` 返回最近 32 张卡片；`turn/poll.questionId` 持续给出待答身份，通知背压时仍能发现卡片。新建会话或换会话不会复用原会话的待答运行态。

`user-question/answer` 对应桌面 `userQuestionAnswer`，参数严格为 `sessionId,questionId,answers,cancelled`。每条答案严格为 `id,selectedIds,text`；Host 及核心校验会话、待答身份、选项归属、单选数量、自定义许可与非空回答。已结算请求拒绝第二次提交。成功回执仅为 `accepted:true`，不是工具授权或整轮完成。

回答作为当前模型工具结果交给同一轮的后续请求，不新建任务；正常文件与命令审批保持独立。取消按钮明确为“取消本次任务”，收束等待并取消当前轮；等待上限为 5 分钟，超时取消，不无限重试。历史待答项没有匹配活跃运行态时显示未知，禁止重启后自动重放问题或副作用。
