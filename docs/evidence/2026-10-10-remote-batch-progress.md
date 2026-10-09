# 2026-10-10 远程接入批次进度

对齐 `docs/superpowers/plans/2026-10-10-unified-remote-mobile.md`。逐提交列出取证计数、rc 与阻塞项，
不合并跨批次证据，不用「文件存在」代替测试通过。

## 已交付提交

| SHA | 范围 | 测试计数与 rc | 变异反证 | 状态 |
| --- | --- | --- | --- | --- |
| 95a30ae | 设计规格 + 实施计划 + 能力契约表 119 条 | Node 契约 1/1 rc=0 | — | 已入库 |
| c2feecc | desktop target-store.cjs（凭据指针分离、https 强制、回环白名单） | 15/15 rc=0 | 3 组互不重叠受害用例（IPv6/fingerprint/credentialRef），restore diff 空 | 已入库 |
| 29c8d77 | desktop remote-transport.mjs（Bearer/id 严格回显/1MiB 上限/8+2 并发） | 14/14 rc=0 | id 顺序冒充配对不加锁的注入 → 指定用例红 | 已入库 |
| 09fab08 | desktop target-bridge.mjs（多目标路由 + connectionEpoch 隔离） | 12/12 rc=0 | 3 个变异（fallback-to-default / 去 request epoch 检查 / 去 subscribe epoch 检查）分别杀 5/7/9 | 已入库 |
| d66aae8 | remote-transport 加 Idempotency-Key + SSE Last-Event-ID | 22/22 rc=0 | 3 个变异（Idempotency-Key 头不注入 / Last-Event-ID 头不注入 / 不更新游标）分别杀 15/17/18、19/21、22 | 已入库 |
| 34b5cfe | target-bridge.subscribe 自动透传 transport.getLastEventId() | 15/15 rc=0 | `if (false)` 让 guard 短路 → 13 号红、其他 14 条仍绿 | 已入库 |
| 2463376 | target-store 边界覆盖（spec 非对象/IPv6 回环/remove 非 active/displayName 空/credentialRef 非字符串/baseUrl null） | 21/21 rc=0 | — | 已入库 |
| e42dbb6 | remote-transport 走真实 Node HTTP/SSE 服务器集成测试 | 6/6 rc=0 | — | 已入库 |
| e68ba6d | 能力契约表 requiredScope / anchor / 客户端方法面 5 组独立检查（裸脚本迁 node:test） | 9/9 rc=0 | — | 已入库 |
| 26c363b | TargetStore+TargetBridge+RemoteTransport 多目标集成（真 HTTP） | 3/3 rc=0 | — | 已入库 |
| 4be823d | 契约加「全局无资源动作」白名单棘轮（防止新增管理方法忘声明 resourceKeys） | 10/10 rc=0 | 首次跑即抓出 auth/revoke 缺口，纳入白名单并写明依据 | 已入库 |

**桌面侧总计（本轮）**：`target-store` 21、`remote-transport` 22、`remote-transport-integration` 6、
`target-bridge` 15、`multi-target-integration` 3，共 67 条断言全绿。
**daemon 侧**：`remote-capability-contract` 10/10 rc=0。

## 在飞未完成

| 范围 | 位置 | 阻塞项 |
| --- | --- | --- |
| 身份模块 core/remote_identity.cj + 11 条测试 | 工作区未提交 | cjpm test --target-dir core-remote-id 累计 30 分钟仍在链 `unittest_bin/core.exe`；cjc.exe 内存 1.35GB 缓慢增长；stdout 停在「158 warnings」后无 Summary |
| 审计模块 core/remote_audit.cj + 6 条测试 | 同上 | 同上 |
| 请求级授权 core/remote_authorization.cj + 12 条测试 | 同上 | 同上 |

三份未提交源码已通过**编译阶段**（同一次 cjpm test 里 cjc 已打印 158 warnings，其中包含 remote_*.cj 的 unused-variable 提示）；未通过的仅是**链接和运行**。

## 后续批次依赖

- 任务 6 daemon 认证与接入生命周期：需 remote_identity/authorization/audit 三模块跑绿再动工，避免签名返工。
- 任务 8 服务端幂等 + 授权 SSE + 恢复：客户端面已交付（d66aae8/34b5cfe），服务端面依赖任务 6。
- 任务 9 桌面本机接入开关 UI：目标存储/传输/桥三层已交付，preload IPC 通道 5 条待与 main.cjs handler 同步加。
- 任务 10 Kuikly 移动客户端：本仓 `AgentLink.kt` 与 `validatedBase()` 均未直读；路径、协议错位与 approve/cancel 缺口属用户提供的外部证据。
- Linux 移植（任务 3-5）：Windows SDK 不支持交叉编译 Linux，需要 WSL2/Linux 主机/Docker；本机无 Linux 发行版注册（REGDB_E_CLASSNOTREG），且系统依赖安装不在本次授权范围。**BLOCKED**。

## 已知阻塞与解锁动作

| 阻塞 | 解锁动作 |
| --- | --- |
| cjpm test 链接段无 Summary 且时长 >30 分钟 | 观察至 60 分钟；届时按死锁处理：kill 后改分模块 `cjpm build` 拿库层通过，再走 `cjpm test --target-dir` 私有目录单跑一次 |
| 本机 WSL2 未装 Linux 发行版 | 用户执行 `wsl --install -d Ubuntu`；本会话不安装系统依赖 |
| Kuikly 移动工程定位 | 用户提供绝对路径，或明确同意本仓新建 `apps/mobile/` |
