# 模型发现：总预算、取消与操作关联结果（2026-10-17）

- 状态：工作区契约，Windows x64 私有 Host 定向验证；未提交、未安装、未发布。
- 适用入口：Host NDJSON JSON-RPC；2026-10-18桌面工作区已新增有限preload查询/取消与供应商页，见[桌面证据](../evidence/2026-10-18-model-pull-desktop-lifecycle.md)。daemon未开放新增方法，正式安装包未更新。
- 源码：`apps/host/src/model_pull_job.cj`、`core/src/model_catalog_request.cj`、`core/src/model_catalog.cj`。
- 证据：[Host 生命周期验证](../evidence/2026-10-17-model-pull-host-lifecycle.md)；问题沿革：[D22 复核](../evidence/2026-10-17-model-pull-timeout-followup.md)。

## 1. 方法与参数

| 方法 | params | 语义 |
|---|---|---|
| `model/pull` | `providerId: string`、`expectedRevision: integer >= 0`；可选 `operationId: string`、`timeoutMs: integer` | 受理后在独立线程发一次 `GET /models`，主循环继续读取消与查询；原 JSON-RPC 请求在成功、失败、取消或到期时回复一次 |
| `model/pull/describe` | `operationId: string` | 查询该 Host 已受理的精确操作，不触发网络、不消费结果、不重试 |
| `model/pull/cancel` | `operationId: string` | 请求取消该操作；回执中的 `cancelRequested` 不等同线程已经收束 |

- ID 限制：ASCII 字母、数字、`-`、`_`，长度1–96；providerId长度1–64，仍须匹配实际配置。
- `timeoutMs` 默认 **20000**，允许 **100–25000**；总预算从创建操作控制对象开始，以单调钟计时。既有桌面30秒等待通常覆盖网络预算，但不涵盖无限磁盘提交延迟。
- 不给 operationId 时 Host 生成 `host-pull-<128bit随机epoch>-<递增序号>`，成功与错误数据都会带回；Host重启会更换epoch。
- 需要在桥丢失回执后找回操作的调用方，必须**在发送前生成并保存 operationId**。2026-10-18桌面适配器发送前生成UUID并在内存保留/展示，页签重挂仍在；跨renderer重启持久保存尚未实现。
- 显式 operationId 是当前 Host 内的关联键，不是跨重启的幂等令牌。查询未知旧 ID 返回未知，不能自动重新发起同 ID 的操作。

## 2. 返回与结果状态

成功保持供应商视图形状（providers/revision/writable/defaultProviderId/defaultModel），仅新增 `operationId`。模型清单不变的幂等拉取也可成功，revision不一定增加。

查询/取消返回：

```json
{
  "operationId": "example-pull-1",
  "providerId": "example",
  "expectedRevision": 1,
  "status": "running",
  "error": "",
  "settled": false,
  "running": true,
  "timeoutMs": 20000,
  "elapsedMs": 100,
  "scope": "host-lifetime",
  "view": null,
  "cancelRequested": false
}
```

| status | 含义 |
|---|---|
| `running` | 网络/解析/提交准入前处理中 |
| `committing` | 已赢得提交准入；此后取消不能伪报为已取消，不承诺回滚 |
| `succeeded` | 配置写入或幂等合并实际返回，且成功视图已取得；view为该操作成功时的视图，不保证比后续全局配置更新 |
| `failed` | 已知失败，如HTTP401、解析错误、修订冲突；不据配置revision变化推断成功 |
| `timed-out` | 总预算到期且禁止进入提交，error为 `model-pull-deadline` |
| `cancelled` | 取消先于提交准入，禁止进入提交，error为 `model-pull-cancelled` |
| `outcome-unknown` | 已进入提交后的落盘/回读异常，不能证明未发生修改，不自动重试 |

`running` 字段表示工作尚未结算（`!settled`），不等同 status 必为 running。`timed-out/cancelled` 可以暂时伴随 `settled=false`：已禁止写库，但系统调用/连接关闭仍在收尾。调用方须分别展示操作结果与资源收束事实。

拉取错误使用 JSON-RPC code `-32020`，message 为稳定脱敏分类，data为该操作的状态。初始非法参数/受理前拒绝不制造一条已受理操作。未知ID返回 `model-pull-operation-unknown`，data中 `scope=host-lifetime`、`outcome=unknown`。

## 3. 总预算与取消边界

1. 预算覆盖受理后的配置/凭据读取、信任锚准备、DNS/连接、TLS握手、响应头/体和解析到提交准入之前；持续滴流不刷新总预算。
2. 独立监视关闭本请求原始TCP socket及独占HTTP Client；不会关闭其他模型请求的连接。仍校验证书、保留SNI、禁止自动重定向携带凭据。
3. 预算到期与取消共用提交准入锁；取消/到期先赢时，任何迟到HTTP结果都不得调用配置写入。
4. 提交先赢时，取消返回 `cancelRequested=false`，等待实际提交事实；磁盘提交不冒充可安全中断，不以网络预算到期推翻已提交结果。
5. DNS/底层系统调用不一定可由Client.close立即打断。到期回执与禁止提交仍有界，但资源退出可能未确认；此时保留操作、阻止新拉取，不假报 settled，不声称完整端到端线程强制超时。
6. EOF时取消在途拉取并等待最多3秒收束（另等待监视器1秒）；未确认时stderr报告并返回非零，不修改安全策略或杀其他Host。

## 4. 并发、留存与授权

- 一个Host同时最多一笔未结算拉取；在途时拒绝该Host的供应商/凭据/自定义模型写入口，读侧照常可用。其他Host的配置更新仍由提交时revision CAS检查；合并持有ProviderRegistry写租约。
- 结果仅保留在**当前Host生命周期**，最多128条；满时 `model-pull-result-capacity` 拒绝，不静默淘汰后允许旧ID重放。结果释放/长期持久化不是本阶段实现。
- 同Host重复operationId返回 `model-pull-operation-exists`，不再发网络。未知、重启、断连和磁盘未知结果不能据此安全重试。
- 查询与取消限定在已受理的模型发现操作上，不提供任意HTTP方法或凭据读取；返回视图沿用既有供应商脱敏契约。
- 新方法当前是本地Host/桌面有限控制面，不自动进入daemon代理或远程权限表。远程授权、跨客户端身份归属另批验收；桌面可见取消已取得隔离页面/真实Electron证据，不等于完整外壳安装态通过。

## 4.1 桌面有限IPC（2026-10-18）

| preload动作 | IPC | 参数与结果 |
|---|---|---|
| `modelPull(providerId, expectedRevision, operationId?)` | `sacode:modelPull` | 第三参省略保持旧供应商视图返回；带ID则返回 `{pullOperation: 状态}`，成功、Host错误data或一次精确查询结果均为纯数据 |
| `modelPullDescribe(operationId)` | `sacode:modelPullDescribe` | 只查原操作；未知ID返回status=unknown、settled=false，不推断无修改 |
| `modelPullCancel(operationId)` | `sacode:modelPullCancel` | 取消原操作；取消请求与结果/资源收束分开，不重发网络 |

ID经主进程验证长度/字符；不开放timeoutMs、任意method、URL或凭据读写附加槽位。带ID拉取桥30秒超时时只自动查询原ID一次，随后未知由用户点击查询；不自动重试拉取。renderer收到succeeded且已收束的精确回执才显示成功；outcome-unknown/unknown或未收束仍禁重复。关闭页签只注销订阅，不默认取消已受理操作。

2026-10-18页面核对补记：一次查询/取消的传输失败另列 `verificationError`（renderer投影字段，不新增Host/IPC字段），不能覆盖原操作已确认的取消、到期、提交未知或已收束事实。普通目录刷新、修订增长和Host查不到旧ID均不能解除未知保护；未知按钮显示“结果待核对”，未收束显示“等待后台收束”。错误身份和unknown+settled=true回执拒绝；见[页面未知态证据](../evidence/2026-10-18-model-pull-unknown-verification.md)。跨renderer重启持久恢复未实现。

## 5. 本阶段不宣称完成

没有覆盖DNS阻塞的强制线程回收、磁盘写入故障注入、结果容量释放、跨Host重启持久恢复、系统代理专项、全部供应商协议、其他操作系统、默认Electron/安装态。D22保持部分修复。
