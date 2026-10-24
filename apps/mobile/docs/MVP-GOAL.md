# SaCode 移动端目标（迁入历史附后）

> 2026-10-23 纠偏：SaCode 正式入口为设备配对，不以短信/密码或 saai 账号为前提。当前主链路为启动 → RemoteDevicesPage → 手动登记电脑 → 受认证的目录/事件只读访问；完整任务执行与审批仍按根 PRD M04 另验。旧 Login/Chat/Account 不进入 Android 正式路由，旧数据保留。以下 saai MVP 仅作迁入历史，不能再据其要求测试账号。见[整改证据](../../../docs/evidence/2026-10-23-mobile-sacode-entry-correction.md)。

> 2026-10-23 迁入注：本文保留 10 月 10 日手机 MVP 目标与历史勾选，不再作为独立的当前交付主线。当前目标、安全与完成判定遵循 [SaCode 根规则](../../../AGENTS.md) 和 [PRD 交付卡](../../../docs/product/PRD-tracking.md)；远程执行/审批的旧条目不能覆盖[现行三 RPC 只读边界](sa-code-integration-progress.md)，下文 HomePage 设计已由 HomeTabs 路由方案替代。本轮未重跑测试或真机验收。
> 创建：2026-10-10 · 目标：一个**能装、能登录、能对话、能管账号**的可用版本。

## 判定标准（Done 的定义）

一个版本算「可用」，当且仅当真机上能无异常走完这条主链路：

```
启动 → 登录（短信/密码）→ 首页 → 对话（发消息、看流式、停止、复制、重试）
                              → 设备（查看已绑定、切换目标）
                              → 我的（看资料、看设备、退出登录、全端下线）
```

不满足即为未完成。**Demo 页不计入验收**——它是组件自测工具，不是产品流程。

## 页面设计

```
LoginPage（现有）          启动入口，未登录时唯一页面
   ↓ 登录成功
HomePage（新增）           TabBar 容器，三页签
   ├─ Tab 1 ChatPage（现有，需收敛为 Tab 子页）
   ├─ Tab 2 DevicesPage（改造 AgentPage）
   └─ Tab 3 AccountPage（新增）
```

### 页面清单与状态

| 页面 | 路由名 | 状态 | 说明 |
|---|---|---|---|
| 登录 | `LoginPage` | ✅ 已有 | 短信/密码/注册三条路径 |
| 首页容器 | `HomePage` | ⬜ 待建 | TabBar 承载三个 Tab |
| 对话 | `ChatPage` | ⚠️ 已有待收敛 | 现在是独立全屏页，需嵌入 Tab |
| 设备 | `DevicesPage` | ⚠️ 待改造 | 现 `AgentPage`；协议改 JSON-RPC |
| 我的 | `AccountPage` | ⬜ 待建 | 资料/绑定/设备/安全 |
| 组件目录 Demo | — | 已删除 | 不再打包或注册；共享组件与测试保留 |

### 各页职责边界

**HomePage** — 只做导航容器，不含业务逻辑。持有当前 Tab 索引（`observable`）。

**ChatPage** — 对话主界面。会话列表、历史、发送、流式、停止、复制、重试。
从独立页改为 Tab 子页：隐藏自己的「返回登录」，改由 TabBar 承担导航。

**DevicesPage** — 设备与目标管理。绑定新目标、探测连通、看能力清单、切换当前目标。
不承载会话内容（会话归属对话页）。

**AccountPage** — 账号与安全。资料、第三方绑定、设备列表、单端下线、全端下线、退出登录。
「全端下线」后必须清本地会话并回登录页——这是安全动作，不能只是提示。

## 任务清单

### P0 — 达成可用版本（必须）

- [x] **T1 底部 TabBar** `HomeTabs`，对话/设备/我的三页签，路由切换
- [x] **T2 AccountApi** 调 sa-idp 身份接口（字段逐条对齐 `profile.rs` / `devices.rs`）
- [x] **T3 AccountPage** 资料 / 绑定 / 设备 / 安全四个区块，已注册进 MainActivity
- [x] **T4 登出语义** `logout`（当前会话）vs `logout-all`（全局，逐出本机）；服务端失败也允许本地登出并如实提示
- [x] **T5 ChatPage / AgentPage** 接入底部导航
- [ ] **T6 登录后跳转** LoginPage → ChatPage（已是现状，待真机确认）
- [ ] **T7 真机主链路验收** 走完判定标准的全流程

### P1 — 设备链路可用

- [x] **T8 AgentRpc** JSON-RPC 2.0 帧编解码 + SSE 事件解析，18 个单测
- [x] **T9 DaemonTransport** `POST /rpc` + `GET /sse`，按 capabilities 门控，33 个单测
- [x] **T10 DevicesPage 接真实能力** `initialize` / `session/catalog` / `task/start` / `turn/poll` / `turn/cancel`
- [x] **T11 审批** `team/approval/answer` 接入 UI；取消走 `turn/cancel`
- [ ] **T12 SSE 断线自动重连**（`AgentResume` 游标已就位，重连逻辑未写）
- [ ] **T13 `/auth/enroll` + `/auth/token` 客户端** —— **阻塞：报文格式未确认**。
      这两个端点属"远程接入"扩展，未启用时根本不注册（`daemon.cj:69-72`）。
      需要 SaCode 侧给出确切请求/响应结构后才能写，不能照 OAuth 猜。
- [ ] **T14 待审批列表** —— 阻塞：审批从哪来（是否走 `/sse` 事件）未确认。
      当前 UI 手动填 `approvalId`。

### P2 — 打磨

- [ ] **T15** 会话与设备在多目标间的切换语义
- [ ] **T16** 审批与取消接入 ChatPage（现在只在设备页）

### P2 — 打磨

- [ ] **T12** 事件流断线重连
- [ ] **T13** 会话与设备在多目标间的切换语义
- [ ] **T14** 错误文案统一（复用 `AgentRpc.describeError`）

## 明确不做（非目标）

- 微信登录（M4+，需开放平台凭据）
- 生物识别解锁
- 云端会话同步（产品线无此接口）
- 组件目录页的产品化

## 进度

| 日期 | 完成 | 备注 |
|---|---|---|
| 2026-10-10 | 目标建立 | 此前已交付：包名统一 SaUI、Chat 组件、流式取消、剪贴板 |
| 2026-10-10 | T8 AgentRpc | JSON-RPC 帧 + SSE 解析，18 测试；核实到 daemon 只收 string/int 的 id |
| 2026-10-10 | T1–T5 页面骨架 | 底部导航、AccountApi、AccountPage、两个页面接入，测试 38 → 62 |
| 2026-10-10 | T8–T11 协议链路 | 重写传输层为 JSON-RPC；删掉编造的 REST；测试 62 → 97 |

## 踩过的坑（供后续参考）

### 协议与数据

- **`/rpc` 永远回 HTTP 200**。`daemon.cj:392-398` 的处理器只写 Content-Type 与响应体，
  从不设状态码；业务失败在 JSON-RPC 的 `error` 帧里。旧传输层用 `resp.isSuccess`
  判定，把 `{"error":{"code":-32010}}` 当成功——这是本轮修掉的最要命的一处。
- **daemon 默认端口是 18937，不是 8080**（`daemon.cj:285`）。8080 是 sa-idp 开发环境的端口，
  照抄会把两件事搞混。
- **`/health` 不能用来判断能力**。它只返回 `{"status":"ok"}`，且 `daemon.cj:367-368`
  明确禁止它携带能力/目录/设备列表。探测必须用 `initialize`。
- **能力是运行时事实，不是版本常量**。daemon 基础能力只有 `initialize` 与
  `session/catalog`；宿主起没起直接决定 `task/start` 在不在清单里。
  按版本猜能力会撞 -32601/-32010 这类没法执行的错误码。

### Kuikly

- **Kuikly 没有可内嵌子 Pager 的容器**。曾写 `HomePage` 把三个 Pager 内嵌，
  靠 `child.body().invoke(parentThis)`——这会绕过子页自身的
  `created`/`willAppear` 生命周期，observable 也绑错上下文。已改为
  「各页自带 TabBar + `PageRouterBridge.open` 路由切换」。
  切页会重建实例；ChatPage 因会话已落 `LocalHistoryRepository` 而可恢复，
  草稿等瞬时态不保留，这是本方案的已知取舍。
- **Column 的第一个子节点在顶部**。TabBar 一度插在根 Column 开头，导致导航跑到屏幕上方。
  另外**放进 `Scroller` 里也会跟着内容一起滚**——导航必须是根 Column 的最后一个子节点。
- **`FlexAlign` 在 `com.tencent.kuikly.core.layout`，不是 `...core.base`**。
- **`Input` 的 `color()` / `placeholderColor()` 要 `Color(...)` 对象**，
  其他 attr（`backgroundColor` 等）收的是 `Long`。同一个文件里两种写法混用很容易写错。
- **ViewBuilder lambda 的接收者是 `ViewContainer`，不是 Pager**。把视图片段抽成
  成员函数返回 `ViewBuilder` 后，lambda 里的 `status` / `mode` 会解析失败
  （"cannot be called in this context with an implicit receiver"）。
  必须在 lambda 开头 `val page = this@AgentPage`，或全部改用显式接收者。

### Kotlin

- **Kotlin 块注释是嵌套的**。KDoc 里写 `` `turn/*` ``，其中的 `/*` 会开启一个嵌套注释，
  把结尾的 `*/` 吃掉，报 `Unclosed comment` 而**不指出真正原因**。
  同理 `*/api/identity/*` 里的 `*/` 会提前闭合注释。文档注释里避开连续的 `*` `/` 组合。
- **PowerShell 里两次 `[regex]::Replace` 写同一个变量会得到两份拼接结果**——
  右侧都基于赋值前的原文。想就地替换必须串起来赋值，不能用 `+`。


## 已核实的外部契约（勿凭记忆改）

**sa-idp 身份接口**（Bearer access_token 可用）
- `GET /api/identity/me` → user_id, username, name, phone_masked, phone_verified,
  email_masked, email_verified, role, status, session_epoch, has_password, need_phone,
  bindings[], sso_available[], login_paths[]
- `GET /api/identity/devices` → { user_id, count, devices[{id, device_id_masked,
  client_type, platform, device_name, last_active_at, status}] }
- `DELETE /api/identity/devices/:id` → 撤销用**数字 id**，非 masked 的 device_id
- `POST /api/identity/logout` → {status:"ok", scope:"session"}
- `POST /api/identity/logout-all` → session_epoch++，**本机 token 立即失效**

**SaCode daemon**（JSON-RPC 2.0）
- 统一 `POST /rpc`；事件 `GET /sse`；不再用 `/task`、`/queue/status`
- `/auth/enroll`、`/auth/token` 仅用于身份登记与令牌兑换
- 帧：`{"jsonrpc":"2.0","id":<string|int>,"method":...,"params":{...}}`
- `id` 只接受字符串或整数；`jsonrpc` 必填；`params` 须为对象
- 方法清单见 `agent/rpc/AgentMethods.kt`
- 能力经 `initialize` 协商，宿主不可用时**不宣称**其能力
