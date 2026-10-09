# 执行提案隔离范围与公开门禁

## 当前实现

ExecutionService 接受既有六字段提案，或新增 sandbox 的七字段提案。旧提案保持可读取与恢复，不推定具有隔离授权。sandbox 闭集为 version=1、mode=read-only/workspace-write、network=none、toolDirectory、executableSha256。工具目录及可执行路径要求规范路径，程序必须是目录的直接文件；拒绝未知字段、未知版本、网络扩权及程序内容失配。

原始提案仍是审批绑定字节，摘要、session/execution 身份和 workspaceRevision 判据不变。propose、authorize、beginStart 都通过同一 checkWorkspace/策略校验复核程序内容；日志回放不要求旧程序仍存在，避免把历史读面错误地绑定当前环境。

ExecutionApi 只接收宿主构造时注入的 ExecutionSupervisor，不新增 RPC providerReady 放行字段。providerAvailable 要求可信 ready、真实隔离配置与完整策略一致，并确认审批程序摘要；普通 Shell/Job 即便私有测试 ready=true，公开 API 仍不能宣称隔离可用。默认 Host/CLI 没有注入提供方，门禁继续关闭。

原生 broker 的可选第五隔离参数承载已绑定程序摘要。创建前以 FileShare.Read 持有程序文件，重新计算 SHA-256，直到映像创建和本次监督结束；失配在创建/恢复之前返回 broker-executable-identity-changed，不降级执行。

## 实测与边界

独立策略原始源码单测：`C:/Users/jingg/AppData/Local/Temp/sacode-sandbox-contract-tyjpz_85/`，build=0，最后 Summary TOTAL=3/PASSED=3/SKIPPED=0/ERROR=0/FAILED=0，test-exit=0。使用当前 policy/sha256 源码，没有历史 core 依赖。

当前 API、监督层、适配器与策略的专项：`C:/Users/jingg/AppData/Local/Temp/sacode-execution-contracts-qwb47_uq/` 的 api-build-final、api-test-final 和 api-manifest.json；build=0，最后 Summary 5/5，test-exit=0。明确使用较早固定 core 库提供 SessionLog/WriteLease/ExecutionService，未验证新 ExecutionService 的三处校验，也不代表完整核心或新 Host 已构建。此前尝试将新 ExecutionService 放入另一包被 package-private mtx 访问拒绝，build-v2=1；没有改可见性或绕过互斥锁凑绿，须由统一核心构建验收。

最新同进程 broker：`node apps/desktop/test-support/windows-job-broker-verify.mjs --sandbox` 实际退出 0，11 场景原件 `C:/Users/jingg/AppData/Local/Temp/SaCode-broker-verification/windows-broker-Bihn63/`。正常场景使用真实 Node 程序摘要；bad-image 用错误摘要，确认程序未启动、无 suspended 帧、无 ran 文件，准确命中 identity-changed。其余同进程隔离/监督场景保留。

## 两个入口仍待验证的接线问题

CLI authorize 与 start 分属两个进程，旧许可不允许继承。runJob 已增加 start 的原修订/提案校验，并在提供方可用时于本进程展示完整提案、重新允许一次、立即 authorize/start，使用新准入修订；提供方关闭时不索取无用审批。目前构造仍未注入提供方，因此该新分支尚未实跑，新 CLI 尚未编译，不记为完成。

Host execution/start 仍同步 dispatch，真实提供方开放后会占用 NDJSON 读取循环，阻止 stop 请求及时进入。必须先拆分共享监督的同步准入/后台监督，再在 Host 返回 starting 回执，保留自持任务/令牌/写租约，并阻止执行中切换会话或改变工作区。不能先把门禁改 true，再用普通 Job 冒充双入口完成。

最终仍需统一源码核心/Host/CLI 构建、真实桌面和安装升级验收，以上专项不升级总目标状态。
