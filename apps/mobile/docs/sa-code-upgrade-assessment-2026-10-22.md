# SaCode 更新后移动接入评估（2026-10-22）

> 2026-10-23 同仓迁入注：仅修正 SaCode 相对路径；下文为 10 月 22 日历史只读评估，不是本轮运行结论，旧行号需结合当前源码核对。

## 范围与结论

本轮只读检查 Git、当前源码、接口索引及已有交付证据；未构建、测试、启动或修改 SaCode，未连接真实服务。SaApp 业务代码未改。

- 旧审计基线：`e9e6298d9e1c4e1162c5973e6aafb962585983ae`。
- 当前 SaCode：`1eb66e91b087021c17df3b1ad7c05406cf02699a`；基线后 85 次提交，727 个文件变化。当前有未提交的产品台账改动，不能将工作区统称干净。
- SaApp HEAD：`384a914d3da3b09b222146177ce9060f17c31dbd`，原有大量未提交改动保留。
- **结论：保留三 RPC 只读方案；可以准备同源候选的受控只读联调，但不能据这次更新开放远程执行或审批。**

## 兼容性

| 项目 | 当前核查 | SaApp 影响 |
|---|---|---|
| 登记/令牌 | enrollmentSecret/deviceName/kind；instanceId/deviceId/credential；expiresInMs/Bearer 保持 | 未发现需要迁移的报文字段 |
| initialize/catalog/events | daemon、分页与 SSE 核心文件相对旧基线未变化 | 现有解析预计兼容；不是实机联调通过 |
| 设备 scope | 已增加记录、快照保存/恢复、authenticate 回传，DeviceAuthzView 读取上下文 scope | 旧“视图恒空”结论需要修订，但不代表已有完整授予操作面 |
| Host 新能力 | MCP、skill、web、terminal、compact、import、计划/提问等大量扩展 | Host 能调用不等于 daemon 已代理并授权；不能复制桌面菜单直接开放 |
| 思考内容 | 当前索引记录独立 reasoning_content 增量、保存/历史回传 | 后续事件投影应单独建模，不把思考混成正文；不影响当前原始历史只读模型 |
| 新候选 | 已有同源四入口构建、打包及协议 smoke 清单 | 不再应仅依据 10 月 14 日 debug 产物选择联调版本 |

## 仍阻止 P2 的证据

1. **scope 链路仅部分完成**：`grantScope` 已存在，但对 apps 的搜索只命中测试调用；daemon 本机管理分支仍仅有 list-devices/enroll-ticket/revoke-device。不能让手机自行改快照来授予 execute/approval。
2. **会话路由尚不能认定安全**：daemon 对客户端 sessionId 做门禁校验后转发；Host task/start 仍以 activeId 创建路由，turn/poll 处理器不接收请求体，读取同一 turnSink。未发现完整的“请求 sessionId 与实际执行/轮次/审批实例绑定”保证，不能用客户端先 session/select 消除多客户端竞争。
3. **SSE 不是服务端会话隔离通道**：EventBus.publish 向全部订阅 offer；device 字段用于撤销关闭，不用于逐事件过滤。/sse 的恢复按 Last-Event-ID 在根目录读页，未见与认证主体关联的资源授权检查。客户端丢弃非本会话事件不构成服务端保密边界；多主体部署前必须核验。
4. **远程沙箱门禁并未随桌面执行组件升级**：remote_sandbox 仍用 confine 是否重写 argv 作为探针，并固定声明无文件系统/网络隔离。产品台账明确 D14 未解除；SANDBOX_INIT_FAILED 是错误分类改进，不是执行能力修复。
5. **团队审批参数冲突仍在**：Host team/approval/answer 要求 params.size()==4，而远程 gate 还需要 workspaceId/sessionId/operationId。没有核到转发层拆除元数据的修复，不应开放。
6. **能力清单仍需按入口求交集**：Host 当前新增能力很多；daemon hostMethods、策略契约与 Host 宣告分别维护。新增 approval/get-mode、approval/set-mode 是名单修补，不构成通用转发授权。

## 核查入口（当前行号）

以下链接指向 SaCode 只读源码及已有文档：

- [登记与 token 响应](<../../../apps/daemon/src/remote_access.cj#L303-L340>)。
- [scope 授予原语](<../../../core/src/remote_identity.cj#L291-L305>)、[授权视图](<../../../core/src/remote_authorization.cj#L68-L89>)、[本机管理命令](<../../../apps/daemon/src/daemon.cj#L483-L529>)。
- [gate 使用上下文与绑定工作区](<../../../apps/daemon/src/remote_gate.cj#L104-L139>)。
- [Host 起轮使用 activeId](<../../../apps/host/src/main.cj#L2579-L2590>)、[poll 使用共享 turnSink](<../../../apps/host/src/main.cj#L2898-L2913>)。
- [SSE 无资源过滤的扇出](<../../../apps/daemon/src/eventbus.cj#L96-L114>)、[SSE 认证与回放](<../../../apps/daemon/src/daemon.cj#L683-L730>)。
- [远程沙箱探针](<../../../apps/daemon/src/remote_sandbox.cj#L27-L69>)。
- [团队审批四字段限制](<../../../apps/host/src/main.cj#L1461-L1468>)。
- [daemon 固定转发名单](<../../../apps/daemon/src/host_proxy.cj#L32-L68>)。
- [当前产品交付卡](<../../../docs/product/PRD-tracking.md#L13-L23>)、[同源候选交付清单](<../../../target/tmp/sacode-final-20261021/DELIVERY.md>)（后者是可被清理的生成证据，本轮仅阅读，未独立复验其中哈希/运行结果）。
- [SaApp 三 RPC 只读门禁](<../shared/src/commonMain/kotlin/com/sa/demo/agent/rpc/RemoteDaemonClient.kt#L31-L70>)。

## 建议的下一阶段

1. 固定当前候选的 daemon、Host、依赖与运行库来源，沿已有清单核哈希，不混用旧 debug exe 与新 DLL。用户已批准过原地构建；本轮并未使用该授权再次构建。
2. 先采用独立数据/工作目录、单可信主体、测试会话的最小环境，只跑登记、初始化、目录和历史；跨主体场景在 SSE 隔离确认前不接真实敏感会话。模拟器回环与真机 HTTPS 分开验收。
3. 为 SaApp 增加“按当前源码固定的契约回归样例”，明确新增 Host 能力不自动变成移动能力；完善权限/隔离限制的显式展示。
4. 向后端维护方提出上面的 scope 管理、会话绑定、SSE 过滤、团队审批适配与沙箱五项核验；仅在源码与运行反例都通过后排 P2。

本报告不宣称 2026-10-14 的 148 项客户端测试已在本轮重跑，也不将桌面协议 smoke 等同于手机只读联调或真实任务验收。
