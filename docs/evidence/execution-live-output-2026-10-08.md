# 执行中双流输出增量

原生 broker 已实时发送输出，但核心此前在最终结果后才落日志。本次 WindowsJobExecutor 增加 onOutput 回调：先验证身份、顺序、字节限额、EOF 与截断一致性，再交付原始字节和闭合标记；ExecutionSupervisor 即时 captureOutput，不在结果后重复写入。回调持久失败沿 reader 失败路径取消自持 broker；不产生成功结算。

## 实测

当前适配器与探针直接编译，无历史核心库：build exit=0；普通临时目录、自建 AppContainer、真实 Node 常驻进程。stream-stop：收到 stdout 和 stderr 后发取消，确认双 EOF 与 cancelled，exit=0，PID 3308 已消失；stream-failure：输出回调抛 probe-output-checkpoint-failure，适配器拒绝结果并停止树，exit=0，PID 12168 已消失。实际 2 条，均 PASS。

证据：C:/Users/jingg/AppData/Local/Temp/sacode-live-output-w269_k6k/manifest.json、build.log 与两子目录 run.log。原生 broker 使用上一轮已验证的内容，哈希在 manifest；本批无 native 变更。

选定当前监督器／适配器／API／策略源码集成编译 exit=0；仍链接旧固定 ExecutionService，不能证明最新持久服务的逐帧写屏障。记录在 sacode-execution-contracts-qwb47_uq/live-output-compile-manifest.json 和 live-output-compile.log。

排队中的统一构建仍对应 1dbb246b 冻结快照，不含本次输出增量；其结果只算之前异步 Host／共享冻结基线。后续必须更新冻结输入并补增量构建与真实 Host 执行中 output 请求；不能凭此文宣称产品闭环。

## 未提交输入 SHA256

- `core/src/windows_job_executor.cj`：`f31e2ef4a6ce8c12e9c8c3c9ff52cc7de32289dbf79862b5d2b55b16b7d8c71f`
- `core/src/execution_supervisor.cj`：`acba7f7ae05865245d8ef9ef59a310dc29e2c25a736a8ead808c29116456a3a9`
- `core/test-support/windows-job-adapter-probe.cj`：`25e7327d13c51fa96236cce779dc84983eb23fb9985a8a34cf694b21b31b23f6`

## 最新持久层与真实监督探针待验收项

executionOutputRejectsCorruptionAndFreezesOnPersistenceFailure 增加 running 时 output 页非空、记录未闭合，以及输出失败后共享 SessionLog 冻结和拒绝其他追加的断言。windows-supervisor-probe 增加 live-output：真实进程保持常驻，停止前观察两通道已进入日志，并用新 SessionLog 从磁盘读回；旧结束后保存实现应因停止前记录为空失败。windows-supervisor-verify 增加第六个真实场景与对应双流常驻夹具，node --check exit=0。上述最新核心断言与第六场景尚未运行。

新增输入：
- `core/src/execution_output_test.cj`：`703ca4e24e1ef44a85141bc19f131c829b679d074ddeffe92751a8c1943b76bd`
- `core/test-support/windows-supervisor-probe.cj`：`aa2edb385504ad151465ef2885041b770b966db8ccb4554299e366e6a74200b9`
- `apps/desktop/test-support/windows-supervisor-verify.mjs`：`39d0a02b0c3c3a3cb8f98ed58a0b4d79fb2f6355d6795e5b4c56aa8fa32bc1c7`

## 当前监督器真实六场景及变异反证

从当前 execution_supervisor.cj／windows_job_executor.cj／execution_sandbox.cj 与当前 windows-supervisor-probe.cj 直接编译，build exit=0；namespace 隔离以链接旧固定持久服务。真实进程 output、gate、missing、startup-fail、stop、live-output 六项均 exit=0，6/6 PASS。live-output 明确确认真实进程仍 running 时两通道已持久化，并由独立 SessionLog 从磁盘读回；停止后双 EOF、退出事实、取消非成功、重复许可拒绝和恢复读取均成立。

边界：普通 Windows Job 私有提供方验证，未作为公开 AppContainer 放行；持久服务／SessionLog／lease 库 SHA256 为 8b70e363987631d84cb1a52e803153b22740aada3ff9660db961ab2cdc7e4f90，未覆盖最新共享冻结修订或真实 Host 接线。不可升级为完整最新版核心验收。

私有变异将实时 onOutput 回调替换成进程结束后才 saveBytes；变异 build exit=0，live-output exit=1，命中独占断言“进程结束前已持久化双流”。随后逐字恢复私有源码，restored=true；产品源码未施加变异。证据 C:/Users/jingg/AppData/Local/Temp/sacode-current-supervision-3p0uru4s/manifest.json、各场景 run.log、mutation-build.log／mutation-run.log／mutation-result.json。
