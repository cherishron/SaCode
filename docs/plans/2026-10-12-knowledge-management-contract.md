# F11 知识库管理增量契约

状态：设计中；2026-10-12。基线 1bf46d80e81df166bec492e283074397e4fc44e4；工作区改动另列，不宣称已实现。

## 已核基线及实施边界

inv.cj 是 InvariantRegistry，xref.cj 是会话引用；二者不是知识库服务。StorageHub 是会话内 domain/changed 切片，当前分隔编码限制及 append 不等于持久屏障，不直接拿它存任意文档。Host/桌面没有已核知识管理入口。新增文件先登记：core/src/knowledge_contract.cj、knowledge_store.cj 及对应测试；先实现核心再接 Host/CLI 和页面，不在渲染层另造存储。

需求 ID 统一 F11，对照 PRD KN01–KN08、V04。主责按责任模块登记：核心知识契约/存储、双入口分派、桌面全宽知识页面；实际会话写者尚待登记，不虚填人员。

## 身份及状态

每个请求包含 requestId、sessionId、scope；scope 是 user 或 project。project 绑定核心解析的 workspaceId、workspaceRevision，不接受渲染层任意目录。user 仅指当前本机用户库，不暗示账号系统。异步结果携带原身份，切换项目后不得覆盖新页面。

文档记录 documentId、title、sourceKind、sourceRef、sourceRevision（内容哈希）、revision、createdAt、updatedAt；正文与索引分开保存。索引状态 unindexed/indexing/ready/stale/failed；ready 必须匹配当前 sourceRevision。源码改变、来源删除或作用域撤销即失效，不能把旧索引当实时源码。

记忆另设 candidate/confirmed/rejected，不与知识文档混为一项。未确认候选不进入长期请求消费。文档内容、检索片段、Markdown 均为不可信数据，不执行嵌入指令。

## 有限动作表（拟议，尚未开放）

| Host RPC / 桌面 IPC / CLI | 输入 | 输出与边界 |
|---|---|---|
| knowledge/list / knowledgeList / knowledge list | 身份、cursor、limit 1–100 | revision、documents、nextCursor；空库与拒绝/故障不同 |
| knowledge/read / knowledgeRead / knowledge read | 身份、documentId、expectedRevision | 元数据、正文有界片段、truncated；不存在明确错误 |
| knowledge/propose / knowledgePropose / knowledge propose | 身份、title、sourceKind、sourceRef 或正文、expectedRevision | 不可变提案 id、内容摘要/hash、目标 scope；不写知识库 |
| knowledge/apply / knowledgeApply / knowledge apply | 身份、proposalId、approvalId、expectedRevision | 消费准确提案一次性批准，持久成功后返回文档和新修订；不接受自报已授权 |
| knowledge/remove / knowledgeRemove / knowledge remove | 身份、documentId、approvalId、expectedRevision | 持久删除事实并失效派生索引，后续检索不得命中；迟到索引不得复活 |
| knowledge/search / knowledgeSearch / knowledge search | 身份、query、limit 1–20 | matches 含文档/来源修订、范围、片段、分数语义、索引状态和截断；不跨未授权项目 |
| knowledge/index/propose / knowledgeIndexPropose / knowledge index propose | 身份、documentIds、providerId | 索引提案，说明发送范围/目的地；远程发送另授权 |
| knowledge/index/start / knowledgeIndexStart / knowledge index start | 身份、proposalId、approvalId、expectedRevision | taskId、snapshotRevision；经过持久任务准入，不另开执行系统 |

索引任务状态/输出/停止复用 execution 监督契约，恢复不自动重发数据或重做请求。取消和完成竞态以源修订及任务身份核对；旧结果可留证，不更新当前索引。

输入限额：标题 200 Unicode 字符、单正文初始最多 1 MiB UTF-8、query 2048 字符；超限明确拒绝，不能静默剪掉后存成功。二进制、Office、网页导入留给 F19 provider，不假装纯文本支持全部格式。

## 错误与持久化

统一语义 reason：knowledge-bad-args、scope-denied、workspace-revision-conflict、document-not-found、revision-conflict、proposal-expired、approval-mismatch、persist-failed、index-stale、provider-unavailable、cancelled。数值 RPC 错误码接线前按现有分配表核定，不在设计里占用冲突码。

核心掌握路径、读写租约和修订 CAS。变更先核批准及修订，落受保护事务/日志并通过持久屏障，再投影成功；失败不得先改页面修订。崩溃恢复只重建事实，不继承批准、不启动索引。不能用整文件覆盖去绕过并发写者。

## 页面与模型消费

全宽知识页面隐藏右侧工作台；顶部用户库/项目库切换、搜索、新建/导入；左文档列表、右正文/来源/修订/索引状态。无选定项目明确引导选项目。空、加载、故障、冲突、未授权、未保存、索引失效分别展示；关闭页面只取消订阅。

检索先限制授权范围再排序。命中的有界片段通过模型请求上下文装配，保留来源及修订；不自动解释为工具指令，不推进 GoalEvidence。请求日志记录选中引用，不记录凭据；源码/文档修订已变则重新核查或回退实时读取。没有 embedding provider 可以有明确标注的文本检索，不能冒称语义检索。

## 验收与解锁顺序

1. 核心：用户/两个项目互不泄露；创建、编辑、删除与重启读回；审批挪用/过期、CAS 冲突、持久失败无假成功；删除后迟到索引不得复活。
2. provider：真实文本索引/检索；无 provider、取消、来源变化；远程传输必须逐项授权，不模拟成功。
3. 双入口：同场景真实 Host RPC 和 CLI 对账状态、日志、修订；逐字段 IPC 守卫与缺字段拒绝。
4. 页面：切换项目迟到响应、未保存关闭、失败重试、亮暗/窄窗/键盘；真实 Host 读写。
5. 模型：冻结任务集并核实际请求引用、来源失效和注入拒绝；按 KN01–KN08 取启闭配对证据，不用命中数替代理解效果。

当前解锁条件：登记新增核心路径并读取仓颉技能；选定现有持久原语的事务边界并用故障探针确认。知识管理动作未接线前不在产品提供假按钮或模拟成功结果。F11 保持设计中。
