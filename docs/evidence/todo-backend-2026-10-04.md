# Todo 仓颉投影接入验收（2026-10-04）

## 本轮完成

- TodoStore 写入前 trim 内容，拒绝空内容、重复内容、非法状态；默认禁止多个进行中任务，部署可显式允许。所有校验完成后才追加事件。
- todo/write 改为结构化 JSON，正文里的竖线、换行、引号、反斜线和控制字符可无损存储。兼容旧分隔格式日志。
- todos 投影初始为 null；turn/start 清空；turn/end 保留；显式清空为 []。
- Host session/projection 返回共享核心 todos；损坏快照返回 todo-replay-rejected，主进程继续响应。
- 桌面输入区 TodoPanel 读取真实 proj.todos，经既有有限 IPC 与会话切换刷新，没有新增任意 RPC 通道。

## 当前证据

隔离构建根：D:\Temp\SaCode-todo-backend-20261004。包含当前工作树的模型设置原型，不能宣称验证了纯提交版本或最终安装包。

- 核心 Todo 定向：8 通过，383 跳过，无失败；todo-test.log。
- 核心全量：390 通过，1 跳过，无失败/错误；core-test-final.log。首跑缺 extjs/scripts 夹具，补齐后还缺 OpenSSL 命令；最终通过 SSE_OPENSSL=D:\Program Files\Git\usr\bin\openssl.exe 运行，未跳过失败项。
- cjpm build Host：退出码 0；host-build.log。自包含组装 91 个文件。
- node --test apps/desktop/test/host-todo.test.mjs：1 通过，无失败，退出码 0。涵盖持久化、宿主重启、无模型消息污染、轮次清空、显式空清单及损坏快照后的协议存活。
- 真实 Electron 定向产品链路：todo-host-focused/reports.json，2 组共 4 条检查通过；实际进程退出码 0。直接写真实宿主事件，经产品会话切换刷新，检查真实输入区显示、统计与新轮次清空。
- 旧隔离 Host 的整页回归退出码 0；换成本轮 Host 后整页在既有 checkConversationScroll 的滚动高度/尾部位置等待处超时，实际退出码 1。未取得该组合整页全绿证据，不能用定向通过替代整页通过。
- renderer/app.js 语法检查及 git diff --check 通过。

## 待核及未完成

- 模型侧 todo_write 工具注册、严格参数 schema、agent 所属会话绑定尚未接入。可信 Host session/append 测试注入不能证明模型工具已完成。
- 执行期间实时投影刷新、并行策略配置 UI、CLI 工具入口和真实 StepFun 调用尚待接入验收。
- 整页滚动回归失败需继续定位；本轮尚未重新生成安装包，现有安装包不代表这些源码修改。
- 完整 DSH 前端复刻、全部仓颉后端接入、npm CLI 和安装即用交付仍未完成。

## 2026-10-04 后续工具契约切片

- 新增 core/src/todo_tool.cj：提供 todo_write 参数 JSON Schema（顶层及子项 additionalProperties=false），运行时验证字段数量、必填字段和类型；未知字段、空/重复内容、非法状态均拒绝。
- 返回 canonical todos 与 pending/inProgress/completed 计数，调用者必须具有由核心执行上下文传入的 agentOwned 身份；非 agent 调用不落 todo/write。
- ToolRuntime 共用注册表、guard 和 tool/call/tool/result 管线，todo 并行策略由构造参数显式绑定。尚未装配进生产 agent 的 SSE 请求，不能称为模型端到端完成。
- 工具定向 3 通过；核心全量 todo-tool-core-final.log：393 通过、1 跳过、0 错误/失败，实际退出码 0。隔离构建仍包含先前未提交模型设置原型。
- 本輪使用上轮 Host 的整页复验 todo-scroll-diagnostic/reports.json：238 组、664 条检查、无失败，实际进程退出码 0，包含产品真实 Todo 链路。之前的滚动等待超时本次没有重现，尚未确定根因，不能称为已修复。
- 下一段缺口仍是模型工具增量按调用 ID/索引装配、真实工具执行、tool_call_id 关联结果和继续请求，以及执行中投影刷新。现有 TurnLoop 只组装流帧，不执行模型请求的工具；modelRequestJson 尚未包含工具定义和关联结果。
- JSON 对象字段数接口参考仓颉官方 [JsonObject API](https://docs.cangjie-lang.cn/docs/0.53.18/libs/encoding/json/json_package_api/encoding_json_package_classes.html)，具体版本行为由本机 1.1.3 实编与测试确认。
