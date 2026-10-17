# 模型工具共享执行管线与 StepFun 空 ID 续片修复

日期：2026-10-05。隔离基点：`79a1f72`；验证目录：`D:/Temp/SaCode-model-tools-20261005`。本批不包含未完成目标卡、模型中心并发改动或完整插件装配。

## 实现与界限

- `ModelToolRuntime` 将模型工具接入既有 ToolRegistry、ApprovalDesk、ToolRuntime 文件观察与写后校验。默认只注册 Todo；文件工具必须由调用方显式启用，提供工作目录、审批和 guard。Host 本轮仍不开放模型文件工具。
- `ModelAgentLoop` 使用可注入执行器；`ModelAgentRunner` 和 `GoalRunner` 转交同一执行器，续请求的工具 Schema 来自同一注册表。首请求仍由调用方按同一 specs 构造，不能因为续请求已接就宣称首请求装配自动完成。
- 模型循环统一写带关联 ID 的调用／结果；执行管线审计记录使用 log-only `tool/runtime/*`，避免重复结果污染模型历史。手工管线保留原来的事件类型。
- 文件工具接收严格 JSON 对象参数，保留带空格路径、空正文和正文空白；原手工字符串参数兼容路径保留。已有文件仍要求实际读取、审批一次性消费及写后核验。
- `TurnResult.successfulToolCalls` 与 `settledToolCalls` 分开。目标 no-progress 使用成功次数，拒绝／失败／取消结算不算成功；成功读取等是否属于某个业务目标的实质进展，仍需目标层按后续契约细化，不能据计数证明完成目标。
- 真实 StepFun 流首片提供非空 ID，续片显式提供空 ID。组装器现保留首片身份；非空冲突及始终无身份仍拒绝，不放宽重复 ID 检查。

上述是共享管线切片，不是完整工具插件生命周期或完整轨迹视图。当前执行器仍借用固定工具实现，尚未接通任意插件工具分派；模型文件审批的桌面等待／取消、工作区策略、插件归属与卸载仍是缺口。

## 红灯与取证

1. 新测试最初在旧异步入口／目标入口报 `unknown named argument prefix 'toolRuntime:'`，修正测试字段后独立复现，rc=1：`D:/Temp/sacode-model-tools-red-clean.log`。
2. 首次核心测试因未设置 SSE_OPENSSL 有 9 项网络夹具 ERROR；补运行环境后 516 总数／515 通过／1 凭据门控跳过，rc=0：`D:/Temp/sacode-model-tools-green.log`。不将环境错误登记为通过。
3. 真实工具用例得到 `error:conflicting-tool-id`、成功和结算均为 0；真实文本 SSE 同轮通过：`D:/Temp/sacode-model-tools-real-diagnostic-all.log`。早先筛选命令全部 517 跳过，不能用作绿色证据。
4. 独立远端分片诊断只输出字段长度：HTTP 200、3 个工具片段、2 个空 ID、0 个非空 ID 冲突；不输出凭据或请求头。
5. 加入空 ID 续片的 Host HTTP/SSE 夹具，用旧增强安装包的 Host 实跑 0/1、rc=1：`D:/Temp/sacode-model-tools-host-red.log`。旧 Host 路径为 `apps/desktop/dist/electron-enhance-closeout-20261005/win-unpacked/resources/host/bin/dsh-host.exe`，不是新源码编译结果。

## 已验证

使用仓颉 1.1.3 与受控环境凭据，执行 `cd core; cjpm test --no-progress`。指定 StepFun `step-5-preview`；既有真实 SSE 用例也改用该型号，未写入密钥。

最终 Summary：**TOTAL 518 / PASSED 518 / SKIPPED 0 / ERROR 0 / FAILED 0，rc=0**。日志：`D:/Temp/sacode-model-tools-real-fixed.log`。

其中包括一次性审批拒绝与消费、JSON 空白保真、异步注册表转交、单一关联结果、拒绝工具不算目标进展、真实 SSE 空 ID 组装与冲突拒绝，以及真实模型工具调用／续请求／Todo 结果／终态／正用量断言。真实远端与夹具分别验证，不混称。

本批未重打安装包、未实际安装卸载，不升级整体能力矩阵的已完成计数。完整工具闭环、全量页面及插件架构继续待完成。

## 双入口回归

- 同一隔离源码 `apps/host`、`apps/cli` 均 `cjpm build` 成功，rc=0；日志为 `D:/Temp/sacode-model-tools-host-build.log`、`D:/Temp/sacode-model-tools-cli-build.log`。
- 将新 Host 与依赖 DLL 组装到隔离副本 `apps/desktop/dist/host`，以该路径作为 DSH_HOST 执行 `model-todo.test.mjs`、`host-todo.test.mjs`、`goal-control.test.mjs`：**3/3 PASS、0 跳过，rc=0**，见 `D:/Temp/sacode-model-tools-host-green.log`。覆盖 HTTP/SSE → Host → 工具 → 关联结果 → 下一请求，待办重启恢复和目标控制边界。第一项是本地 HTTP/SSE 夹具，不能归为真实远端。
- 新 CLI 二进制 `all`：**ALL PASS、rc=0**，见 `D:/Temp/sacode-model-tools-cli-all.log`。这是 CLI 自检，不是 npm 离线安装或真实用户持续目标入口验收。
