# 本地守护进程简报复核与接线门禁

基线 HEAD：`78f79e0727d5d6481e61dfbda438fdc5099442e6`。本文件登记当前源码观察和待实现契约，不升级 F01–F20 完成状态。关联 F01 会话、F02 执行、F04 目标、F20 设置交付。

## 当前源码事实

- `apps/daemon/` 与根 workspace member 已在工作区，尚未提交，责任待确认；不重复建立工程。
- daemon 监听 127.0.0.1，接受 `--port 0`，实现 `/health`、`/rpc`、`/sse`。RPC 当前仅声明 initialize 与 session/catalog，不是 Host 全方法兼容实现。
- `/sse` 使用 HttpResponseWriter、chunked 流与每订阅有界队列；满队列关闭，不阻塞其他订阅。当前没有 SSE id、历史存储或 Last-Event-ID 恢复。
- `apps/cli/src/remote.cj` 已有远程 RPC/SSE 增量，不是尚待新建的文件；当前能力必须按 initialize/capabilities 验收。
- 当前 daemon 未实现 Bearer 校验、凭据文件保护、优雅 shutdown、独占实例发现或共享业务分派器。不可按完整 D1–D5 交付使用。
- EventBus 当轮生产源码隔离测试：node tests=1 / pass=1 / fail=0，rc=0；内部验证溢出关闭、退订幂等、无历史回放三项。日志：`apps/desktop/.tmp-test/daemon-audit-c5e37b43fa134f629e90a5f9e8740f35/eventbus.log`。完整 daemon 构建及 HTTP 实测见下节，鉴权门禁未通过。

## 当前源码隔离构建与 HTTP 实测

证据目录：`apps/desktop/.tmp-test/daemon-contract-20261008/`。冻结 core 与 daemon 共 143 个生产源码文件，`source-manifest.json` 登记逐文件 SHA256；构建后与工作区复核 drift=0。这证明本次冻结源码的一致性，不替代提交级验收，之后的并发改动也不包含在该产物里。

- 在隔离副本 `apps/daemon` 执行 `cjpm build`，真实退出码 0；原件为 `daemon-build.log` 与 `daemon-build.exit.txt`。
- 使用现有 `scripts/pack-host.mjs` 组装 172 文件的私有运行包；此脚本固定产物名 `sacode-host.exe`，本次该文件实际内容是 daemon，可执行 SHA256 为 `C4FA8727DD77ECDFD6D8C9F560EEF17F636F54EA3695E6FE1491ED5732235B71`。仅用于探针，未生成安装包或修改产品默认入口。
- `node http-probe.mjs` 退出码 0；私有 cwd、独占 TMP/TEMP、运行 PATH 仅 Windows System32。验证无 SDK PATH 启动、两个真实 HTTP/SSE 客户端收到相同瞬时事件且无私有请求参数、单侧断线不影响另一侧、重连仅接新瞬时事件、catalog 读取与未知方法 -32601。
- 未带 Bearer 请求 `/health`、`/rpc`、`/sse` 均返回 200，而契约应拒绝；`POST /shutdown` 返回 404；事件缺 id/游标及历史回放。探针 rc=0 表示这些当前行为被成功测量，不能解释成鉴权或恢复验收通过。
- 结果原件为 `http-result.json`、`http-probe.log`、`http-probe.exit.txt` 与 `snapshot-check.json`。探针结束只终止其自行创建的子进程，该清理不能用作优雅关闭证据。没有测试真实模型、任务执行、CLI 当前源码远程入口或桌面连接。

下一实现出口仍是 DAEMON-01/02/03；先核对共享分派与文件责任，再补鉴权及实例发现。当前 D1/D2 均保持实施中，D3–D5 未由这批探针结算。

## 必须补齐的契约

| 工作项 | 实现边界 | 失败与恢复判据 | 主责 |
|---|---|---|---|
| DAEMON-01 共用分派 | 抽出会话服务实例及请求上下文；stdio 与 HTTP 仅替换收发帧，禁止复制 Host 巨型 if 链形成第二套业务 | 相同方法、授权、日志与错误逐项对比；HTTP 并发不共享一个可被另一客户端切换的全局 activeId | A/W90 |
| DAEMON-02 本地鉴权 | 全部四个端点检查凭据；服务端赋予客户端身份与读写能力；CI 只读凭据不能等价于全权凭据 | 无凭据/错误凭据 401、已认证越权 403；不得广播凭据或私有请求参数 | A/W90，安全契约协作 |
| DAEMON-03 凭据与发现 | 仅环回监听；随机凭据不写控制台；Windows 按实际 ACL 保护，不能拿 POSIX 0600 宣称 Windows 已保护 | 实例身份包含 epoch、启动身份与规范会话根；PID 存活不能单独证明属于同一 daemon；身份不符拒接，不能杀无关进程 | A/W90 |
| DAEMON-04 SSE 恢复 | 会话事实仍来自 SessionLog；事件携带 daemon epoch、sessionId、sequence。游标可恢复时补发，否则明确 reset-required 并重取投影 | 新连接、断线补发、游标过旧、慢订阅溢出、两个客户端序列一致；瞬时通知不能被当作可恢复业务日志 | A/W90，F/W50 |
| DAEMON-05 并发授权 | 同会话写操作经共享租约/修订/请求去重；异步结果绑定会话与请求。审批取同一工单且一次性消费 | A/B 同时审批仅一次有效；一个客户端切会话不能改变另一个客户端在途请求；断线不取消或重放任务 | A/W90，F/W50 |
| DAEMON-06 退出与重连 | 显式 shutdown 停止准入、取消并等待可确认终态、持久屏障、终态通知、关闭订阅；无法确认退出或持久失败保留恢复事实 | SIGINT/崩溃分别登记；强制终止不能保证清理文件，启动时识别失效 metadata。保持现有 durable freeze，不能退回整文件 flush 修补失败 | A/W90，持久化协作 |
| DAEMON-07 客户端切换 | 桌面默认 stdio 保留；HTTP 为显式连接模式。远程错误不能偷偷更换执行提供方 | 写请求超时/断线后按 requestId 查询，禁止自动回退 stdio 重发；认证失败不降级；断开订阅不等于停止任务 | G/W60，A/W90 |

简报中“所有 SSE 扇出相同事件”限定为同会话且有权订阅的客户端；不同权限不能获得无权读取的会话与审批数据。简报中的读写限制沿用现有 allowedDuringTurn 与队列契约，不能笼统把所有写操作拒绝而破坏在途补充与审批回答。

## 实施顺序与当前出口

1. 核对既有 stdx 流式服务器探针与当前源码产物；现有 ServerBuilder/HttpResponseWriter 调用已经是实现线索，仍需实际双客户端 HTTP/SSE 验收。
2. 登记既有 daemon/CLI 远程文件写者后再安排修改；先补 DAEMON-01/02/03，再接业务 RPC。
3. DAEMON-04/05 必须在真实任务推送之前完成。无历史 EventBus 的绿色测试不满足断线补发出口，不删用户要求来沿用该绿色。
4. 接 CLI 与桌面时共用持久任务和 GoalRunner 判据，维持已关闭的执行沙箱门禁，守护进程不能绕过准入、审批、取消或完成证据。
5. 按当前源码重新构建、打包并记录哈希，分别跑 Host/daemon/CLI 同场景；最后补桌面真实入口及退出/重连证据。

技术 API 依据：[官方 stdx HTTP 包说明](https://github.com/cangjielanguage/cangjie_stdx/blob/main/doc/libs_stdx_en/net/http/http_package_overview.md)。文档版本不替代本机 1.1.3 编译与运行探针。
