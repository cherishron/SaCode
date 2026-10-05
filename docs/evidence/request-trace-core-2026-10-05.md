# 模型请求真实取证：共享核心切片（2026-10-05）

## 实现与边界

`RequestTraceProvider` 包装真实 Provider，首次消费前不创建连接、不写请求事件；发起前取消不产生虚假请求。工厂接收与观察器一致的不可变正文，凭据只在调用方闭包中存在。

日志中的 `request/header` 白名单快照记录提供方身份、模型、请求选项及工具 Schema；系统提示词不混进 header。`request/prompt` 记录本次真正发送的 system/developer 纯文本，它是 SaCode 的 log-only 扩展，不能声称与上游 SurfaceOp 重建格式兼容。用户历史及图片 data URL 不复制进请求取证事件。

每帧增加可选 requestSeq/elapsedMs；未观察的旧帧 JSON 输出保持原结构。请求结束记录单调钟耗时、首次模型输出时延、终态和提供方用量；执行中没有伪造的持续增长时长。初始化失败、取消、断流和正常完成分别结算一次，Resource 关闭幂等；外部异常正文不会被抄进此观察器的事件和模型循环。

`requestTraceProjection` 从同一 SessionLog 回放，按稳定事件序号分页，尾页最多 50 请求。没有记录的旧提示、请求配置和时序不推测补齐。观察事件不会改变模型可见消息，flush 后新实例能逐字还原投影。

## 验证

- 本批 8 条核心行为用例：未消费/先取消、实际正文与提示/路由/时序、异常脱敏、取消/断流、分页/旧历史、执行中未知字段、落盘重启、带工具的两次请求各自快照。
- 隔离核心首次完整运行：526 总数 / 524 通过 / 2 凭据门控跳过 / 0 ERROR / 0 FAILED / rc=0。
- 注入用户授权 StepFun 凭据后：**526 总数 / 526 通过 / 0 跳过 / 0 ERROR / 0 FAILED / rc=0**；真实 `realModelExecutesRegisteredTodo` 与 `realModelSse` 逐条 PASSED。
- 实际 StepFun 模型工具请求及续跑都经过观察器，断言两个真实请求、当次 `step-5-preview`、实际 system 文本和完成终态。凭据不打印、不写取证日志或产物。
- 日志：`D:/Temp/sacode-request-trace-core-final.log`、`D:/Temp/sacode-request-trace-core-real.log`。
- 第一次编译因 Resource 缺少 `isClosed` 返回 rc=1；补齐接口后编译和上述测试转绿，红灯日志保留为 `sacode-request-trace-initial.log`。

## 未完成

此切片**尚未用于 Host 产品 task/start 或用户 CLI 起轮**，未增加桌面有限 IPC 和轨迹消费视图。工具执行时序/结果关联、重试、多模态检查器、压缩与 SurfaceOp、轮次导航、虚拟化/历史翻页、真实完整时序 Overview 都仍需按上游契约完成。请求记录本身不代表轨迹前端或系统提示词插件装配已经复刻完成。

首次请求与续跑接入 Host 前必须适配当前在途 SaCode 命名收口，保留有限 IPC、凭据隔离和现有会话模型固定行为。CLI 与桌面必须共用此观察器及回放判据，不能各建一份账。
