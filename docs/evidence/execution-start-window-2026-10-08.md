# 执行启动窗口取消专项

基线：35a69ca9e0f8b7b6ac51271ec76eff3515eaa820，refactor/dsh-learning，2026-10-08 未提交工作区。修改责任为既有 E/W40 的 execution_service.cj 与 execution_service_test.cj；未改 Host、CLI 或其他会话文件。

## 实现

beginStart 可在同一日志锁内绑定监督令牌；绑定后 starting 阶段可停止并保持 stopping。startedSupervised 使用已有令牌登记启动观察，停止先到时不改回 running；旧 started 不得替换已绑定令牌。停止持久失败仍取消自身令牌。尚未登记进程观察时 finish 拒绝生成退出事实。startFailed 记录 unknown，不伪造退出码，不自动重跑。无令牌的旧路径保持 stop-unconfirmed。

## 验证

在 apps/desktop/.tmp-test/execution-admission-source 的既有完整生产源码、选定测试隔离副本中同步两份改动文件，执行 cjpm test --no-run -i（退出码 0），再在 target/release/unittest_bin 执行 core.exe --no-color --parallel=1 --no-progress（退出码 0）。编译前首次复制路径错误，已纠正并重新编译；首次命令结果不纳入证据。

汇总 TOTAL 73 / PASSED 72 / SKIPPED 1 / ERROR 0 / FAILED 0。新增两条为 executionSupervisedStartStopKeepsCancellationAndRejectsRecovery、executionSupervisedStartFailureNeverInventsExit。前者含停止先到、拒绝活动恢复、未观察启动不得结算、停止状态幂等以及取消后退出码 0 不成功；后者含启动失败、取消令牌、无假退出码、恢复不重跑。现有真实模型测试缺凭据而跳过，不代表真实模型通过。

二进制 SHA256：B2F76EE9F736DC5E02AE211F1609EE8D2CE9F44B4E9F3D96EC8233D6F4C9E697。构建及测试日志和退出码在 apps/desktop/.tmp-test/execution-supervision-{build,test}.{log,exit.txt}。指定改动路径 git diff --check 通过。

## 边界

专项只证明共享状态接口及其回归，不是全核心测试、真实进程监督、沙箱、子进程树、Host/CLI、桌面或安装态验收。本批没有启动用户命令的产品提供方；下一步需完成真实监督适配和启动中取消的真实进程探针。未提交、推送、安装或发布。
