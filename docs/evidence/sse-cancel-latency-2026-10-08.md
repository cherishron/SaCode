# SSE 在途取消延迟修复（2026-10-08）

HEAD ccf3bff7609d6761d14f7b712676791342e15137，refactor/dsh-learning，未提交增量。仅新增连接取消生命周期与验收，不修改解析、计费或公共执行门禁。

## 原因与改动

RealSseProvider 原先只在 body.read 返回后检查 TurnToken，默认读取超时 30 秒，真实 CLI Ctrl+C 到退出 32084ms。低层 HTTP 对照 `target/sse-close-probe-fc4f43765a664be88685df5d597e772d`：不关连接 5000ms 后超时；并发关闭 HttpResponse/Client 后分别 317/316ms 返回 Socket is already closed。仅证明本机 stdx 行为，不推断全部外部协议。

core/src/sse.cj 新增 SseTransportCancellation，每请求持有自己的 Client，20ms 观察令牌并关闭连接；连接关闭、正常完成和错误共用一次关闭。观察线程不修改 SSE 缓冲、usage 或业务日志；取消解开阻塞读后由原读取线程结算取消。作用域在 c.send 前建立，覆盖响应头前等待；parent/child 链沿用 TurnToken，detached 不受父取消影响。正常 30 秒超时与 TLS/重定向策略不变。

修改前源码保存在 `target/sse-cancel-fix-574890a535ae429289de0fb1dbbd70d0/sse.before.cj`，sse-increment.diff 为本批差异。shared-usage-preserved.txt 比较 D 的 parseReportedUsage 函数逐字一致，并确认 reportedUsage 字段和赋值保留；不认领或暂存其他会话的计费 hunk。

## 已取证

本轮 core 库 SHA256 b77ab8e6f73340bb333d947f697f1356ffebbefbdffe5067f71af615074a59ec；库来自私有 Host 构建中的已完成核心阶段。通过 `SACODE_CORE_LIBRARY=<该库目录> node apps/desktop/test-support/sse-cancel-verify.mjs` 验证，实际编译及五场景退出均为 0：

| 场景 | 结果 |
|---|---|
| 默认 30 秒配置、阻塞 body 后取消 | 142ms，取消终态、资源关闭、无迟到帧 |
| 父令牌取消 linked child | 142ms，取消终态 |
| 父令牌取消不干扰 detached | 530ms 正常完成，late 文本及 usage=7 保留 |
| 响应头尚未返回时取消 | 140ms，open 失败并保留取消令牌事实 |
| 普通请求无取消 | 521ms 按显式 500ms 超时，错误不是成功或取消 |

原件 `apps/desktop/.tmp-test/sse-cancel-cDpWos` 的 manifest.json/results.json/分场景 log/exit。每场景恰好一次 HTTP 请求，不重发；fixture 明确保留连接直到被关或完成。这是本机真实 HTTP，不是远端模型、完整核心单测或桌面验收。

CLI 从同一新 core 库独立链接，私有 `target/cli-fast-cancel-5737d91b852d4537957ae7e0ab102fea/sacode.exe`，SHA256 afed7c1798220ff94283c3aff9152c11e824f3dc16fce283176324de2b701f54；build-exit=0。目标七场景再次全通过，原件 goal-cli-proof-PL5lb0/results.json。取消新增 elapsedMs<5000 的断言；旧实测 32084ms 被该判据判红（latency-baseline-red.log），新真实系统信号 589ms、exit=130、signalDelivered=true、forcedCleanup=false、describe 不再次请求，原件 goal-cli-cancel-SNRNpn/result.json；不是通过降低请求超时或杀进程得到。

## Host 与剩余门槛

私有 Host 外层 cjpm build 等待到 480 秒记录 ETIMEDOUT/status=null，不能记 rc=0；原 cjc PID 29420、LLVM PID 5976 当时仍在执行，cjc-live-after-timeout.json 记录命令与开始时间，现接管句柄等待原进程退出，不重复启动、不杀其他进程。Host 重建及真实 Host 取消仍待最终结果，不能用 CLI 通过替代。

未运行全量核心单测；尚未补全部关闭/错误/并发变异反证。Windows OS 隔离和 Electron GUI 初始化阻塞未解决，执行门禁保持关闭，安装包与安装/升级/保留数据未验，整体目标仍未完成。

## Host 最终结果与固定载荷

外层超时后等待原 cjc 句柄，cjc-observed-exit.json 明确 ExitCode=0、ObservedAt=2026-10-08T14:58:02.1483729+08:00，main.exe 已生成；没有启动第二次编译。该实际编译成功不能篡改外层 cjpm ETIMEDOUT 日志为 0。

将新 Host 与 DLL 固定到证据目录 host-bin，SHA256 11c62f75954f326a3e4b9ed2230fa9e99a038928ffcc2df69621b562f1d8a637；同轮 core.cjo/libcore.a 固定到 core-lib，已验收 SSE 源码固定为 sse.accepted.cj，accepted-manifest.json 合并原基线与监督/SSE 增量、双入口产物及未提交哈希；150 个验收源码与当前工作区差集为空。旧快照目录是增量构建缓存，已经重建，不可再用其当前 main.exe 路径冒充上一轮旧哈希；本轮固定载荷以 host-bin/core-lib 为准。

`node target/sse-cancel-fix-574890a535ae429289de0fb1dbbd70d0/verify-host.cjs`：Host 目标五场景 rc=0，goal-host-proof-hJy3gi/results.json 中取消到终态 1958ms，新增 <5000ms 断言通过，恢复读取无新请求；Host 执行有限接口 rc=0，execution-host-2rumdm。新 CLI 执行有限接口也再次 10 场景通过，原件 target/cli-fast-cancel-5737d91b852d4537957ae7e0ab102fea/sacode-execution-cli-1AVlHE。这里六动作/十场景均维持启动门禁关闭，没有真实 Shell 执行。

上述取消修复可记本批通过；全量核心测试、远端真模型、OS 隔离、Electron 页面和安装交付仍未通过。本次没有暂存、提交、推送、安装或发布。
