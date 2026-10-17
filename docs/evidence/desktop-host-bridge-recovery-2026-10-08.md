# F02/F04 桌面 Host 桥接恢复

本轮在 refactor/dsh-learning、bf68db6 工作区修改 W00 登记的桥接恢复 hunk；不暂存、不提交、不安装，不改变任何 OS 沙箱或执行门禁。保留 host-bridge.cjs 中并发的 JSON-RPC error.data 处理。

## 故障与修复

旧 Host 的 exit、stdout、stdin error 与迟到 write 回调没有核对当前进程身份。显式重启同一桥接对象后，旧回调可能拒绝新连接请求、污染报文缓冲或通知缓存；重复 start 也能替换活动进程引用。

修复将回调绑定创建时的 ChildProcess，只允许当前进程改变桥接状态。显式 start 拒绝尚存活动进程，清除旧连接缓存并拒绝遗留请求；无 PID 的启动失败允许显式重试。当前进程断开仍立即拒绝请求。该层不重放命令、模型请求或授权，也不新增 GUI 自动重连动作。

## 测试与真实恢复

先红：`node --test apps/desktop/test/host-bridge-lifecycle.test.mjs`，4 tests / pass 1 / fail 3 / skip 0，真实退出 1，原件 target/bridge-lifecycle-red.log。旧进程错误、新连接缓存及重复启动分别红；当前断开拒绝场景原已绿。

后补旧请求迟到写错误与未创建进程显式重试两条，共 6 个生命周期用例。冻结副本运行两个实际源代码套件：`node --test target/unified-current-96fd8a63dfce4f298bc610a82e27d90e/apps/desktop/test/host-bridge-lifecycle.test.mjs target/unified-current-96fd8a63dfce4f298bc610a82e27d90e/apps/desktop/test/model-approval.test.mjs`，20 tests / pass 20 / fail 0 / skip 0，真实退出 0。原件 desktop-bridge-unit-v2.log 和 .exit.txt；另校验分母必须为 20，不能以少跑的套件替代通过。

真实 Host：显式 SACODE_HOST 指向任务身份增量 `host-turn-approval-962728c673fc4c53b838947e748275a1/bin-increment/sacode-host.exe`，运行 `node apps/desktop/test-support/host-bridge-recovery-verify.mjs`，HOST_BRIDGE_RECOVERY_PASS，真实退出 0。原件 apps/desktop/.tmp-test/bridge-recovery-bgEu8L；Host SHA256 7c1a025ba3fa24a892f1f1cd11574710c034f9c63625d219a5a51df8545e39d3，桥接 SHA256 b29c06c3e3cd02b201bc845e9fa6fc1a227bfb1bf56a0be58b2978096b8135fe。

仅终止本夹具创建的 Host PID 5640，观察实际 SIGTERM 后请求被拒；同一桥接对象显式重启到 PID 26044。目标恢复原 ID、active、roundsDone=0、activation=disarmed；会话日志逐字一致。新 Host 优雅退出 0、forced=false。此处验证 Node 桥接与真实 Host，不代表 Electron 窗口重连验收。

修改桥接后，再用上述冻结副本的 model-approval-host-verify.mjs 验证允许/拒绝/取消三个真实 Host 场景，MODEL_APPROVAL_HOST_PASS 3，退出 0。原件 apps/desktop/.tmp-test/model-approval-host-s4xFVD 和快照 model-approval-host-v2.log/.exit.txt。绑定起轮身份、只回答原工单、真实文件结果、目标判据及重启不执行均通过；它仍使用局部增量 Host，不冒充当前统一构建。

## 冻结增量与未收口

第一次快照增量校验抓到并发 CLI main.cj 的两条 web 工具注册，准备脚本在复制之前退出 1，没有修改编译输入。该次随后误运行了旧副本测试，仅返回 14 项，不算本轮 20 项通过。原日志 desktop-bridge-unit.log 保留，最终以 v2 原件为准。

经差异核查后，只读复制当前 CLI 注册增量和本批三份桥接文件，source-manifest.v1.json 保留旧 634 项，source-manifest.json 现为 636 项并逐项记录旧/新哈希。当前正在编译的 core/Host 输入没有变化，不重启或并行启动核心构建；CLI 增量不认领、不改写其共享源。

默认统一 Host 构建仍待真实退出与最终产物；真实 Electron GUI、OS 隔离准入、安装升级和数据保留尚未通过。该报告仅推进断连恢复边界，F02/F04/F09 及最终目标保持未收口。
