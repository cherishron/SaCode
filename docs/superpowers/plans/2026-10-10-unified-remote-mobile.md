# SaCode 统一远程接入与移动工作台实施计划

> **执行要求：**使用 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans` 按任务执行；每项经过规格与质量审查。复选框仅在获得实测证据后勾选。

**目标：**同包交付 Linux/Windows CLI、Host 与 daemon，让桌面和 Kuikly 手机通过统一强认证直接连接、切换目标并操作目标端完整能力。

**架构：**远程接入是 daemon 内置扩展，无独立桥部署。业务由共享核心与单一运行协调器执行；客户端按目标和会话隔离状态。OS 沙箱、请求级授权与事件恢复属于发布门槛，不是后续选配。

**技术栈：**仓颉 cjc/cjpm 1.1.3、匹配目标的 stdx、JSON-RPC 2.0、HTTPS/SSE、Electron/Vue runtime、Node ≥18、Kuikly/Kotlin 及平台原生 Module。

**规格：**`docs/superpowers/specs/2026-10-10-unified-remote-mobile-design.md`。

## 全局约束

- 同包部署：CLI、Host、daemon、扩展运行依赖由 SaCode 安装包交付；远程接入是 daemon 内置可启停扩展，不增加独立桥服务、独立部署或必需云中转。
- 切换目标不迁移会话、不停止旧任务、不自动降级到本机，不跨目标重发失败操作。
- Linux 服务器为必需交付项；当前未支持，移植与实机验收是部署硬门槛，不用 Windows PASS 推定 Linux PASS。
- 手机是完整移动工作台，不是只读遥控器；保持功能范围，按屏幕适配交互。
- TLS 公网使用受信任证书；内网允许通过扫码外带证书指纹绑定服务端，需原生 TLS 适配，不允许 trust-all。
- 不修改其他会话的实现或暂存区；临时产物仅放 `apps/desktop/.tmp-test/`，构建产物不提交。
- 只按明确路径提交；本次规划不包含提交/推送授权。下列提交步骤仅在实施时取得授权后执行。
- 每项先写失败测试，记录真实红灯、实现、正常回绿及指定反向测试；不拿空集/退出码单独判 PASS。
- 引用已有代码用符号锚点；新增路径在本计划是拟建文件，不代表已经存在。
- 修改配置中 Linux target 前先从 Linux 1.1.3 工具链读取真实 triple，不猜官方 API/CFFI 签名。

## 0. 文件责任图与执行方式

| 文件/目录 | 责任 | 状态 |
| --- | --- | --- |
| core/src/procwin.cj、sigwin.cj、lease.cj、session.cj | 平台判活、信号、写权与持久化既有接线 | 现存，含并发改动 |
| core/src/platform_process.cj、platform_linux.cj | 跨平台进程状态接口与 Linux 提供者 | 拟新增 |
| core/src/sandbox.cj、sandbox_linux.cj | enforcement 报告及 Linux OS 沙箱 | 前者现存，后者拟新增 |
| apps/daemon/src/remote_access.cj、identity.cj、authorization.cj、audit.cj | 接入生命周期、认证、请求授权、脱敏审计 | 拟新增 |
| apps/daemon/src/idempotency.cj、canonical_json.cj | 幂等账（含落盘与有界淘汰）与其内容规范化摘要；计划原名 operation_store.cj | 已落库 |
| apps/daemon/src/runtime_router.cj、event_replay.cj | 单实例路由、授权补读 | 拟新增 |
| apps/daemon/src/daemon.cj、host_proxy.cj、team_host_bridge.cj、eventbus.cj | 现有 HTTP/转发/事件接线 | 现存 |
| apps/host/src/main.cj、session_rpc.cj | 显式会话归属分派，避免全局选择竞态 | 后者拟新增 |
| apps/desktop/target-bridge.cjs、target-store.cjs | 本机/远程适配及目标元数据 | 拟新增 |
| apps/desktop/renderer/pages/connections-page.ts | 连接管理与本机接入设置 | 拟新增 |
| scripts/pack-service.mjs、scripts/verify-service-package.mjs | 同包 CLI/Host/daemon 与干净环境验证 | 拟新增 |
| apps/mobile/ | 找不到既有工程时才建立的 Kuikly 移动应用 | 本仓不存在，不替代外部未知工程 |
| apps/daemon/test/remote-*.test.mjs | 真 HTTP/宿主边界集成测试 | 拟新增 |

计划包含服务端、桌面、移动三个可审查工作包，但仍是一套完整交付计划，不按首版裁剪范围。任务 1、2 为平台与协议核验，其交付是证据和冻结接口，不生产临时假实现；后续依赖它们，不把未知 SDK 方法编造成可执行代码。

## 1. 定档协议、外部移动工程与实例模型

**文件：**读取 daemon 四个源码、apps/host/src/main.cj、apps/cli/src/remote.cj、docs/product/PRD.md；新增 `docs/evidence/2026-10-10-remote-platform-baseline.md` 与 `docs/plans/remote-capability-contract.json`。

**接口产出：**方法表条目固定为 `{method, implementationAnchor, permission, resourceKeys, durable, idempotent, clientConsumers}`；资源键只能是明确 workspaceId/sessionId，不用隐式 currentSession。移动工程定位记录为真实绝对路径或“未取得”，不伪造 AgentLink 路径。

- [ ] 记录 `git rev-parse HEAD`、`git status --short`、`git worktree list`；逐 hunk 识别本计划涉及文件的在途实现，尤其 durable_checkpoint 与 execution 文件。
- [ ] 获取用户已有 AgentLink 所在工程的准确路径并直读。若不可访问，记录其 /task 等结论为用户提供证据；不声称源码复核通过。无既有工程才使用 apps/mobile。
- [ ] 从 Host 分派及 initialize 实际提取方法，按 PRD F01–F21 和移动功能逐项映射；审批采用现有 approval/answer、取消采用 turn/cancel，不创造已有能力别名。（fc7e5b6 已交前半：`docs/plans/host-capabilities.json` 逐字取自宿主 initialize 的 120 条声明，并与本机打包宿主实跑回包核对同集；转发面 = 契约 ∩ 该清单 − 本地 − 代理自留长连接 − team/*。别名纪律保持：审批仍走 `approval/answer`、取消仍走 `turn/cancel`，`turn/start` 与 `extension/host/*` 这 10 条宿主内部名刻意不进远程面。PRD F01–F21 的逐项映射表仍待补，故本行不整体打勾）
- [x] 新增零依赖契约检查，断言远程方法没有无实现 capability、每写方法有权限和资源归属；第一次在缺映射时应红。（fc7e5b6：三条对账落在 `remote-capability-contract.test.mjs`——转发 ⊆ 契约 ∧ ⊆ 宿主声明能力、远程消费的已实现方法不得漏转发、转发面 == 推导集；写方法权限与资源归属由 4be823d 的「全局无资源动作」白名单棘轮钉住。红先记录 13/15 rc=1，铺开后 15/15 rc=0）

```javascript
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const rows = JSON.parse(readFileSync('docs/plans/remote-capability-contract.json', 'utf8'));
assert.ok(rows.length > 0);
assert.equal(new Set(rows.map(x => x.method)).size, rows.length);
for (const row of rows) {
  assert.ok(row.implementationAnchor && row.permission);
  if (row.permission !== 'read') assert.equal(row.idempotent, true);
  assert.ok(Array.isArray(row.clientConsumers) && row.clientConsumers.length > 0);
}
```

- [ ] 冻结 0.2 请求归属、幂等、身份、事件 schema；定义旧 0.1 拒绝方式；确定普通/团队请求统一协调器及会话根。
- [ ] 审查方法表真实引用，记录能力缺实现时需补哪个核心/Host模块；未完成项不得进 capabilities。
- [ ] 授权后仅提交本任务证据、方法表与检查脚本，不带入他人源码。

## 2. 核验 Linux 平台与 Kuikly 网络安全能力

**文件：**读取四模块 cjpm.toml、scripts/setup-stdx.mjs、sdk-paths.mjs、pack-cli.mjs、core 平台 CFFI；证据追加到任务 1 文件。临时探针仅在 apps/desktop/.tmp-test/。

**接口产出：**冻结真实 Linux target/stdx 路径/CFFI API；移动传输能力矩阵按 Android/iOS/鸿蒙分别记录 RPC JSON、HTTP error、SSE chunks、cancel、TLS fingerprint、secure storage。

- [ ] 在可用 Linux 主机或明确授权的 Linux 环境读取 `uname -a`、`cjc --version`、`cjpm --version`、glibc、架构。没有环境记 BLOCKED，不让用户代跑假装本轮证据。
- [ ] 从官方仓颉插件文档核签名，再跑最小编译探针验证 POSIX 判活、信号、fsync/锁、进程组；取得 errno 的方式也必须验证。
- [ ] 使用匹配工具链的官方 stdx，逐模块测试 Windows CFFI 未隔离时的 Linux 编译/链接红灯，记录原文。
- [ ] Kuikly 真实请求向受控 HTTPS 测试 daemon 发送 JSON-RPC；捕获原始请求体，不把 JSONObject param 自动当 JSON 编码证据。
- [ ] 测试 SSE 分片中文、连续事件、关闭取消、401、证书错误和指纹不符；检查系统安全存储。API缺能力时选择同应用原生 Module，不能改成必需云中转。
- [ ] 输出可执行的模块签名和平台证据；未通过能力作为后续任务的明确实现范围。此任务不保留探针为生产实现。

## 3. Linux 进程、信号、写锁和持久屏障

**文件：**修改 core/src/procwin.cj、sigwin.cj、lease.cj、session.cj，四模块 cjpm.toml；拟新增 platform_process.cj、platform_linux.cj、platform_linux_test.cj。工作区 durable_checkpoint.cj 先确认归属再改。

**接口：**拟定义 `processStatus(pid: Int64): ProcessStatus`，状态 alive/dead/unknown；所有接管仅接受 dead。POSIX 提供者负责 SIGINT/SIGTERM 到 TurnToken 的安全转发、进程组回收及持久 append 屏障。不能直接在异步信号处理器里拿 Mutex、分配或执行日志，采用 async-signal-safe 通知通道交工作线程处理。

- [ ] 写判活权限拒绝为 unknown、双写者互斥、退出接管、PID身份失配、屏障失败不推进 durable、SIGTERM 收束的测试。Linux 构建当前 Windows 符号不解析/屏障恒false是预期红，不当测试环境通过。
- [ ] 使用任务 2 已证实的 @When/平台目录方式隔离 kernel32/user32；Windows 提供者行为同测保全。Linux 实现原子写权，不靠临时文件 rename 推断双写者互斥。
- [ ] 实现追加短写循环、持久屏障、尾部恢复及目录持久化要求；失败明确拒绝。禁止用整写或返回 true 代替 fsync。
- [ ] Linux 串行跑完整 core 测试及三个入口构建；每轮私有 TMP。仓颉测试按最后 Summary 五计数+rc 判读。

```sh
(cd core && cjpm test)
(cd apps/cli && cjpm build)
(cd apps/host && cjpm build)
(cd apps/daemon && cjpm build)
```

- [ ] 在独立进程真实发 SIGINT/SIGTERM，核持久数据与无孤儿；在 Windows 复跑相关及全量核心测试。
- [ ] 把屏障改成成功但不 flush、判活 unknown 改 dead，指定恢复/互斥用例必须红；还原并回绿。
- [ ] 授权后精确提交平台文件与配置，Linux 结果注明固定提交/工作区态。

## 4. OS 沙箱与远程执行门禁

**文件：**修改 core/src/sandbox.cj、shlex.cj、ptc_exec.cj；拟新增 sandbox_linux.cj、sandbox_linux_test.cj，修改已有 Windows 执行提供者；新增 apps/daemon/test/remote-sandbox.test.mjs。

**接口：**SandboxRuntime.confine 不再只返回未经约束 argv；提供者输出 enforcing launch descriptor、enforcement、limitations。启动前再次确认 enforcement 与部署策略；缺所需能力抛 SANDBOX_UNAVAILABLE。

- [ ] 写真实子进程越权测试：读凭据目录、写工作区外、未授权网络、fork/resource超限、取消后逃逸进程。当前 argv 原样传回应产生红灯。
- [ ] Linux 实现 namespace/mount/seccomp/资源/进程树组合；seccomp 单独不判完整，工作区挂载权限按 read-only/workspace-write。
- [ ] Windows 核验 Job Object 之外的文件/网络隔离能力；若当前实现不能保证，拒绝远程执行并登记 BLOCKED，而不是只改 enforcement 字符串。
- [ ] 测试内核禁 user namespace、后端缺失、启动失败都无副作用；允许网络与拒绝网络分别测。
- [ ] 将提供者变为原 argv，指定越权用例必须红；还原重跑。沙箱失败不得通过用户批准绕过。
- [ ] 授权后提交；外部执行的发布门仍依赖本任务 PASS。

## 5. Linux/Windows 同包 CLI、Host、daemon

**文件：**修改 scripts/pack-cli.mjs、sdk-paths.mjs、setup-stdx.mjs、npm/sacode-cli/bin/cli.js 及包配置；拟新增 scripts/pack-service.mjs、verify-service-package.mjs、Linux 平台包目录和测试。

**接口：**包清单明确 cli/host/daemon/extjs、运行库、平台架构及摘要；启动包装只解析包内路径，不找全局 Host、不依赖仓库或开发 SDK。

- [ ] 写清单测试，现包无 daemon/Linux 时红；检查可执行位、相对运行库搜索路径与 ELF ABI。
- [ ] 按任务 2 真实 triple 分平台组装；Linux 收 .so，Windows 收 exe/DLL。保留官方依赖源。
- [ ] CLI 增加同包 daemon 管理入口，参数逐字段校验，不能拼 shell。打包不把服务端秘密和本机路径带入。
- [ ] 执行离线 npm pack/安装或等价安装包验证，在无 SDK/仓库环境运行 CLI、daemon、Host、扩展；Linux 用 readelf/ldd 检依赖，缺库要明确失败。
- [ ] 删除测试包内一颗真依赖应启动失败；还原复跑。包内 CLI/Host/daemon 与本次源码摘要对应。
- [ ] 授权后仅提交源码、清单与平台包配置，不提交二进制、不发布。

## 6. TLS、设备身份和接入生命周期

**文件：**拟新增 apps/daemon/src/remote_access.cj、identity.cj、audit.cj、remote_identity_test.cj；修改 daemon.cj；新增 apps/daemon/test/remote-auth.test.mjs；修改 CLI 管理分派。

**接口：**服务端 AuthenticationContext 由可信入口构造，包含 instanceId/principalId/deviceId/revocationVersion；认证失败不产生 context。登记/兑换 HTTP schema 依规格 §4，业务方法只能消费 context，不能由 params 构造。

- [ ] 写无凭据调用 initialize、过期/撤销凭据、跨证书、并发登记兑换、匿名 SSE 的集成红灯；验证拒绝发生在 Host.forward 前。
- [x] 接入开关默认关闭、回环监听；外部开启缺 TLS/身份/策略均启动失败。实现两条最小 auth 端点及安全本地登记确认。（c619910 + ca3d698 + 92d565b：`--manage enroll-ticket` 建票落盘只存摘要，运行中新建的票可被 `/auth/enroll` 消费；TLS 已真接进 `ServerBuilder.tlsConfig`，解码失败拒启动 78，`remote-tls` 2/2 rc=0、`remote-auth` 19/19 rc=0）
- [ ] 使用经过任务 2 验证的 CSPRNG/摘要/常数时间校验和安全存储；凭据至少256bit、登记至少128bit/5分钟单次、token至多15分钟。禁止自行写密码学算法。
- [ ] 添加设备轮换、撤销、每RPC认证、SSE到期/撤销关闭。无header回包不泄漏证书秘密、目录与用户列表。（92d565b 已落：每 RPC 认证 + `-32001/-32005` 归因、`--manage list-devices`/`revoke-device` 本机入口、`refreshFromDisk` 让带外撤销在下一个请求生效、`listDevices` 输出不含摘要与凭据；仍缺：按 deviceId 轮换凭据、撤销后关闭**已建立**的 SSE 流、契约里的 `auth/devices`/`auth/revoke` 认证 RPC 面）
- [ ] 加入16KiB认证体、1MiB RPC体、方法/深度/并发/连接数/超时/认证限速；保留当前白名单及明确错误。（92d565b 已落：16KiB 认证体与每来源 10/分、每票据 5 次（c619910）、1MiB RPC 体、`readHeaderTimeout`/`readTimeout` 10 秒、每设备 8 RPC / 2 SSE 与实例 64 SSE 且授权后才占槽；仍缺：方法名与 JSON 嵌套深度的上界）
- [ ] 审计保存 who/when/what/result；遍历日志断言无登记秘密/token/模型key。禁跨主机认证重定向与trust-all。
- [ ] 变异删请求级认证时越权测试必须红；撤销只改存储不关连接时专属SSE测试必须红；还原回绿。
- [ ] 授权后提交本任务文件，不开放真实防火墙或公网服务。

## 7. 唯一实例、显式会话与完整授权分派

**文件：**拟新增 apps/daemon/src/runtime_router.cj、authorization.cj；修改 daemon.cj、host_proxy.cj、team_host_bridge.cj、apps/host/src/main.cj；拟新增 apps/host/src/session_rpc.cj；新增 remote-session.test.mjs、remote-authorization.test.mjs。

**接口：**所有会话操作消费 AuthenticationContext 和显式 workspaceId/sessionId。运行协调器为普通与团队提供同一实例/根目录/会话路由；capabilities 来自任务1方法表与当前授权交集。

- [ ] 写两设备并发选择不同会话提交、团队/普通共享归属、跨项目读/写拒绝的测试；当前 global select 与两桥差异不得忽略。
- [ ] 移除远程先 session/select 后 execute 的契约；按会话定位服务并隔离执行上下文。桌面本机远程接入开启时接同协调器，不另启私有写入 Host。
- [ ] 逐项实现方法表的真实核心/Host分派：会话/消息/队列、目标/计划/待办、审批/问题、取消、文件/差异/Git、执行输出、模型/用量、扩展/连接/设置及团队。（fc7e5b6 把「打得到」这一层铺完：98 条可转发 + `initialize` 能力面同步宣告 + 真实宿主端到端抽验 `tips/get`/`model/list`/`credential/set` 三条代表。剩下的真缺口是「打到了按不按显式归属执行」——见下两行，未做）
- [ ] 每项缺后端实现时在对应核心模块补完整契约与测试，不仅添白名单。取消使用独立控制路径，不被长任务占用等待锁堵住。
- [ ] 审批应答核主体/资源/有效期/修订/单次消费，执行前再次核服务端策略；禁止伪造 role 或 allowed-once。
- [ ] 三设备不同权限跑正反矩阵；管理员能力不默认包含在普通设备token中；无权限catalog与SSE都不泄漏资源。
- [ ] 变异取消session归属、改成信任客户端审批字符串，指定独占受害用例必须红；还原全量回绿。
- [ ] 授权后按方法族精确提交，所有PRD需求在表中有真实入口与验收指针。

## 8. 持久幂等、授权 SSE 与恢复

**文件：**幂等账已落 apps/daemon/src/idempotency.cj + canonical_json.cj（计划原名 operation_store.cj）；event_replay.cj 仍拟新增；修改 eventbus.cj、daemon.cj、Host通知发布；新增 remote-idempotency.test.mjs（已落，原名 remote-operation.test.mjs）、remote-events.test.mjs。

**接口：**operationKey 为实例/主体/工作区/会话/方法/operationId。session/events 请求与结果固定为规格 §6；seq 使用十进制字符串，persistent/ephemeral 明确区分。

- [ ] 写重复请求、同键异内容、提交后断连、服务重启、补读订阅竞态、generation gap 和撤销中扇出的红灯测试。
- [x] 持久幂等账与业务提交一致，外部效果无法原子化时标 unknown并可查，绝不自动重做。任务回执不等于完成。
  - 已落：六元组键 + 规范化内容摘要 + 追加式盘（`<identityPath>.ledger.jsonl`，与实例身份同处）+ 有界淘汰；超时/宿主中途退出/分派异常记 unknown 并回 `-32019 idempotency-unknown:<operationId>`，queryId 复用客户端自己的 operationId（核实面认既有标识符）。
  - 明写的窗口：账在副作用**之后**落盘，所以「宿主已做、daemon 崩在写账之前」这一小段仍会在重启后重放一次。§5 正因此不许承诺 exactly-once；这一段的收敛要靠 `execution/*` 与 `task/*` 的状态核实，不靠账本本身。
- [ ] 改EventBus订阅为身份/资源范围绑定，建立授权订阅缓冲再读取高水位，补读去重后交付；每帧重新检查授权。
- [ ] 双限额1024帧/4MiB，支持过期/撤销/溢出关闭原因；补读limit 1..200，快照与generation的变化显式处理。
- [ ] 真实网络测试UTF-8分片、半帧、空闲断连、睡眠恢复；最终持久结果替代丢失瞬时文本，不编造回放。
- [ ] 变异删除幂等、过滤与补读缓冲，指定重复执行/越权/丢帧测试分别红；恢复逐一回绿。
- [ ] 授权后提交，跑全量daemon与相关核心测试。

## 9. 桌面多目标入口与本机接入开关

**文件：**拟新增 apps/desktop/target-bridge.cjs、target-store.cjs、renderer/pages/connections-page.ts；修改 main.cjs、preload.cjs、host-bridge.cjs、renderer/app.js、package.json及bridge测试。

**接口：**TargetDescriptor 保存targetId/instanceId/displayName/baseUrl/credentialRef/trust；ConnectionState 保存connectionEpoch与资源视图。渲染层只访问有限动作IPC，不持有密钥或通用RPC方法透传。

- [ ] 写目标切换时同名session不碰撞、旧响应不覆盖、旧任务不取消、删除目标不撤销远程任务、缺证书拒接的红灯。
- [ ] 实现连接添加/测试/切换/删除、凭据系统安全存储、持续目标标识；远程与本机适配共用视图契约，不复制业务。
- [ ] 接入设置显示开关、地址、证书身份、设备/撤销/审计；启用时与手机共用本地daemon；关闭只关接入，不隐式停止任务。
- [ ] 同步preload闭集、bridge测试、打包文件；运行vendor和桌面完整node测试。

```sh
(cd apps/desktop && npm run vendor)
(cd apps/desktop && npm test)
```

- [ ] 起开发应用并在浏览器/Electron真实操作服务器/本机切换、审批、取消、文件与差异；重打包后复验。不能用组件mock通过替代UI。
- [ ] 变异移除epoch检查，指定迟到响应测试红；还原回绿。授权后精确提交。

## 10. Kuikly 完整移动客户端

**文件：**任务1定位的真实工程；若确无工程，拟新增 apps/mobile 下Kuikly工程。应用内逻辑文件拟命名 TargetStore.kt、RpcClient.kt、SseClient.kt、SessionModel.kt、ConnectionsPage.kt、WorkspacePage.kt、ApprovalPage.kt；原生模块为 SecureTransportModule 与 CredentialStoreModule。源集完整路径由任务2验证的Kuikly模板冻结后使用，不把不存在路径写成已有工程。

**接口：**RpcClient发送JSON-RPC0.2，区分HTTP错误与error对象；SseClient交付授权帧与关闭原因；统一使用instanceId与connectionEpoch隔离。原生模块不执行远程工具，只处理网络/TLS/安全存储。

- [ ] 在任务1真实工程或新工程先写以下行为测试，旧REST请求应红：initialize命中/rpc，session/catalog解析、approval/answer、turn/cancel及授权拒绝。
- [ ] RPC优先使用经验证的NetworkModule JSON字节与header；SSE/取消/证书绑定缺能力通过同应用原生Module补齐，不引入中转部署。
- [ ] 实现目标管理、登记/登录、持续目标标识、分目标草稿与会话视图、断网恢复/重新认证及后台前台恢复。
- [ ] 完整实现消息/队列、目标/计划/待办、审批/问题、Agent/团队、取消、文件/差异/Git、执行输出、模型/用量、扩展/连接/设置；按任务1方法表逐项标UI入口/后端/失败/恢复证据。
- [ ] 必填协议字段缺失拒绝，不能用optString空默认冒充合法session/approval/instance；只对可选显示字段使用默认值。
- [ ] 按Android/iOS/鸿蒙真实构建与设备执行测试；没有设备/SDK记BLOCKED，保留范围，不用共享Kotlin测试冒充全平台支持。
- [ ] 证书不匹配、撤销、过期、切换迟到、草稿保留、重复提交、审批竞态与后台恢复逐项验收；不自动转连另一目标。
- [ ] 授权后提交应用源码与测试，不提交密钥、SDK或产物。

## 11. 固定提交双平台、多客户端交付验收

**文件：**拟新增 scripts/verify-remote-product.mjs、apps/daemon/test/remote-product.test.mjs；证据 `docs/evidence/2026-10-10-remote-product-acceptance.md`，同步PRD需求追踪与README平台声明。

**接口：**验收输出每项PASS/FAIL/BLOCKED、平台、取证SHA、产物摘要、命令、计数、rc及缺失前提；不提供猜测百分比或日期。

- [ ] 固定提交隔离副本，不混未入库源码；完整core、extjs、daemon、CLI与桌面测试，按真实计数判读。
- [ ] Linux服务器干净包、本机Windows干净包分别执行真实任务→工具→落盘→审查→审批→取消→重启回放；验证OS沙箱强制边界。
- [ ] 桌面与手机同时连接服务器，再手机切到Windows电脑；确认两个目标不同状态持续可见、旧任务继续、迟到数据隔离。
- [ ] 双客户端不同会话并发和同一审批竞态；设备撤销/策略变化立即限制RPC与SSE；服务端审计定位who/when/what而不含token。
- [ ] 验收安装包仅一套SaCode部署，无独立PC桥、开发SDK、源码根目录或全局Host依赖；核CLI/daemon/Host版本与摘要。
- [ ] 明确反向结果：认证失守、权限过滤失守、沙箱透传、幂等失守、会话归属失守、epoch失守等变异均有指定用例杀死。
- [ ] 未通过Linux/安全执行/移动真实运行任一门槛，整体验收保持FAIL或BLOCKED，不能按缩范围发布“完整支持”。
- [ ] 授权后提交验收证据与平台声明；推送、发布、服务器部署必须另有明确授权。

## 12. 依赖与规划自审

依赖图：1→2；2→3和移动传输实现；3→4→5；2+5→6；1+3+6→7；6+7→8；5+7+8→9/10；全部→11。桌面与移动可在冻结契约后独立推进，但不得用夹具PASS提前解除Linux/沙箱门禁。

覆盖：规格§1/3由5/7/9落实；§2由1/2取证；§4由6/7落实；§5由1/7/8/10落实；§6由8/9/10落实；§7由3/4/6落实；§8由9/10落实；§9/10由11验收。外部AgentLink路径、官方平台签名及移动源集不编造；1/2是明确取证任务，完成后把结果附到本计划再执行相关代码任务。

本计划是完整工作包与门禁计划；涉及未核验工具链/移动工程的部分以先取证、再冻结代码签名为执行条件，不是无需平台核验即可复制粘贴的代码补丁。当前没有一项被标成已经通过。
