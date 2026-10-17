# 执行差异正文预览接口

需求：F08 / REVIEW-01。状态：核心/Host/CLI/有限IPC/组件真实历史读验收；完整桌面与写回未验。

- method：execution/review-file；分类：只读，不产生执行许可、不写源文件、不推进GoalEvidence。
- 输入恰五字段：sessionId/string，executionId/string，revision/正整数，path/清单内相对路径（1–4096 UTF8字节），side/before或after。
- 输出：version=1、sessionId、executionId、revision、path、side、sha256、exists、totalBytes、returnedBytes、truncated、data（Base64）。返回<=65536字节；完整对象准入<=8388608字节。
- 读取必须通过同一会话已结算execution/review及快照/修订绑定。缺失一侧对象为exists=false/空摘要/0字节；空文件为exists=true/空文件摘要/0字节。
- 错误包括bad-execution-arguments、execution-session-changed、revision-conflict、workspace-review-missing、workspace-review-path-not-recorded、workspace-review-object-corrupt、attachment-missing-object、attachment-corrupt-object、workspace-review-store-unavailable。Host沿执行面映射-32026；CLI错误退出1；IPC本地校验失败不转发。
- Host与CLI装配固定attachments/v1后端；客户端不得指定store根、对象ID或绝对文件路径。只读取冻结对象，不用当前工作区正文代替历史对象。
- IPC：executionReviewFile(sessionId,executionId,revision,path,side)。CLI：sacode job review-file '<五字段JSON>'。
- 不存在自动写回、默认模型请求、重复命令执行；读取动作不隐式刷新任务或恢复授权。

证据：[本轮双入口预览](../evidence/2026-10-17-task-review-body-preview.md)。下一步为独立F08写回合同。
