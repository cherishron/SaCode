# 真实模型工具闭环验收（2026-10-05）

## 路径与范围

新增 `apps/desktop/test/real-provider-tools.test.mjs`，直接调用自包含仓颉 Host，使用真实 StepFun HTTPS 端点 `https://api.stepfun.com/step_plan/v1` 与模型 `step-5-preview`。本测试不启动本地模型服务器、不伪造 SSE、不手动提交工具结果。模型凭据从既有 STEPFUN_API_KEY 或忽略的 target/step.key 入口读取，不进入源码或报告。

配置登记沿用现有有限 Host 方法，不修改模型中心语义。测试环境显式移除 SACODE_PROVIDER_* 夹具覆盖，使用隔离用户配置与会话目录。

## 已执行验证

命令（工作目录 apps/desktop）：

```text
node --test test/real-provider-tools.test.mjs
```

结果：测试 1、通过 1、失败 0、跳过 0，退出码 0。测试用例约 13.65 秒，测试进程约 16.71 秒。

断言链：
1. 从配置登记 step-5-preview，并通过 credential/set 保存隔离凭据。
2. 提交用户任务，要求实际调用 todo_write，而非只描述操作。
3. task/start 确认 provider=real，轮询直到干净 stop 结算，真实 usage 大于零且有续答正文。
4. 轮询帧中存在 projection:todos，证明仓颉实际执行待办工具。
5. 核心投影恰好为一项：content=真实工具验收、status=in_progress。
6. 持久日志包含 todo_write 与 tool/result，不包含密钥；投影包含助手消息。
7. 正常关闭 Host（退出码 0、非强杀），重新启动冷进程，不再请求模型；相同待办与助手答复从持久日志恢复。

## 未证明

此项仅覆盖 todo_write 的真实工具往返。文件工具的模型授权与审批闭环、多工具并行、错误重试、持续目标自动跨轮、Electron 真实模型交互、安装器环境和完整插件装配仍需独立验收。不能从一个工具通过升级为所有工具或全部子系统完成。

模型输出具有非确定性：未来模型不遵守调用要求时测试应失败，不能用固定工具结果替代或将其伪装成通过。
