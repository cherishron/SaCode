# 桌面功能后端接线核对（2026-10-04）

用户已将当前工作目标调整为“所有功能接入对应后端”。账号裁剪不变：不引入 DSH 官方登录、注册、订阅和云账号绑定。模型凭证、审批和必要认证仍须保留。

## 当前实际调用链

| 功能 | 现有调用链 | 当前结论 |
| --- | --- | --- |
| 输入区发送 | `send → userSend → session/append → user/message` | 消息真实持久化，但没有启动模型任务；不能等同任务发送完成 |
| 诊断运行/停止 | `turnStart/turnPoll/turnCancel → turn/start,poll,cancel` | Host 有真实 SSE 路径；无 provider 环境配置时仍使用示例 provider，诊断按钮不等同产品任务入口 |
| 模型设置 | `settings-page-models` | 当前仅提示“尚未开放”，缺读取、保存、凭证安全存取、选择和连接验证接口 |
| 工具与审批 | `toolsList/toolCall/approvalAsk/approvalAnswer → extension/*,approval/*` | 已有真实核心调用；需逐工具核实参数输入、结果、取消、审批拒绝和实际副作用，不能从登记表推断完整工具能力 |
| 扩展管理 | 当前核心工具清单 | 安装、启用、卸载入口尚未开放；不能将清单展示算作管理接通 |
| 会话创建/选择 | `sessionCatalog/sessionCreate/sessionSelect → session/*` | 已接核心目录、投影和持久化；仍需覆盖完整产品动作及失败恢复 |
| 项目目录 | `workspaceChoose/workspaceGet → workspace/set-directory,get` | 本地目录选择和核心绑定已接通；工作区完整管理待补 |
| 外观设置 | `globalAppearance* → global/appearance/*` | 已有持久化接口；本次全量布局验收曾遇到字号保存 Host 超时，待定位，不能抹去失败 |
| 用量预算 | `usageStatus/usageSetBudget → usage/status,set-budget` | 已接核心计量与预算；真实请求需要 provider usage 回传，仍需真实执行与预算边界验收 |
| 文档预览/指南 | 核心读取结果的派生视图、本地说明 | 预览不是独立模型/文件编辑后端；指南当前仍明示示例输出限制，需随真实接线结果更新 |

## 首个已定位的执行缺陷

Host 真实请求原本查找 `eventType == "user"`，与桌面实际写入的 `user/message` 不符，造成请求正文为空；同时只取最后一条，遗漏上下文。改由共享核心 `modelRequestJson` 按事件顺序装配标准 system/developer/user/assistant 消息，转义由既有核心 JSON 函数处理，申请流式 usage。内部控制事件、stream/chunk 和无 tool_call_id 的 tool/result 不直接作为聊天消息发送。完整工具调用装配仍需单独实现，不能由这个修复宣称 Agent 闭环已接通。

待接通的优先闭环是：模型配置与安全凭证 → 输入区提交 → 真实执行 → 流式正文 → 工具/审批 → 停止与结算 → 持久化与重启恢复。验收须穿过真实 Electron IPC 和 Host，不能只验证 DOM 或注册表。

本批证据：独立 `D:/Temp/SaCode-backend-20261004` 源码快照中，核心过滤执行两条 modelRequest 测试通过（其余 379 条跳过，不能记为全核心通过）；新 Host 构建退出码 0。Node HTTP/SSE 协议夹具经真实 HostBridge 与新 Host 验证两条中文多行消息及上下文顺序进入请求、真实 provider 收束、助手回复落盘且可投影，一条集成测试通过。夹具使用本地服务器与固定测试密钥，不代表外部模型服务或生产凭证验收完成。

## 安装产物差异

当前 `apps/desktop/dist/electron` 同时留有昨日 DSH 包、今日 10:31 的 `sacode-portable.exe` 和 18:30 的 `SaCode Setup 0.1.0.exe`。用户确认运行 Setup。18:29 的 `win-unpacked/resources/app.asar` 与已安装 SaCode 中的 app.js、frame.css、index.html 均与当前源码字节一致，因此该用户反馈不能归因于旧 portable。官方参考界面与未完成整页复刻的 SaCode 仍须明确区分。后端改动未重新构建并安装前，也不能声称现有安装包已包含修复。
