# 真实进程监督适配专项

2026-10-08，基线 35a69ca9e0f8b7b6ac51271ec76eff3515eaa820，refactor/dsh-learning，未提交工作区。新增 execution_supervisor.cj 与测试的主责登记为 E/W40；同步修改既有 execution_service.cj、shlex.cj 与执行契约。

## 本轮实际实现

ExecutionSupervisor 消费一次性准入，以同一任务令牌监督真实 ShellExecutor 子进程。启动回调记录本实例持有的 SubProcess 身份和 PID；不使用 PID 查找或接管旧进程。启动失败和退出不可确认分别进入 unknown，不生成虚构退出码。停止与自然退出修订竞态以最新停止状态结算。

ShellResult 增加 exitObserved；ShellExecutor 支持启动回调和每路 1–65536 字节的输出限额，限额后继续排空。启动观察回调失败时尝试终止本实例子进程；超时从 launch 返回后开始计时，包含启动事实登记耗时。监督适配记录真实退出码、取消、超时和输出完整性。

## 当前源码验证

- 隔离目录：apps/desktop/.tmp-test/execution-admission-source，完整生产源码加选定测试。131 份对应源码哈希逐份一致，差集 0；清单位于 .tmp-test/execution-provider-source-manifest.json，SHA256 为 871ACA87C4C83C2795346B7985B14C1DB56F4E663BC33877B5E06EEF5100F87F。
- 构建：该目录 cjpm test --no-run -i，退出码 0。首次编译发现回调捕获可变变量不合法，已改为 AtomicBool；修正后的编译与复跑才计入证据。
- 运行：配置 stdx DLL 路径，在 target/release/unittest_bin 执行 core.exe --no-color --parallel=1 --no-progress，退出码 0。
- 汇总：TOTAL 77 / PASSED 76 / SKIPPED 1 / ERROR 0 / FAILED 0。新增监督测试 4/4：默认门禁不消费授权；真实 cmd 非零退出和双流输出、重复启动拒绝、缺可执行文件；真实 PowerShell 超时；真实运行取消及双路各 64 字节截断后完整排空。
- 二进制 SHA256：10D0D0379A8D35CB5077FF42F6340B582A11783BB985DC2AFB106417CA455709。
- 日志：apps/desktop/.tmp-test/execution-provider-build.log、execution-provider-test.log 及各自 .exit.txt。1 条缺模型凭据跳过保持原边界；不是全核心测试通过。
- 指定改动路径 git diff --check 通过；原行尾提示未做迁移。

## 产品门禁与尚未完成

providerReady 默认 false，测试明确注入 true 仅用来运行监督探针。当前 SandboxRuntime 只验证模式名，不提供真实隔离；产品入口不得照搬测试门禁值。身份不含操作系统创建时间，不能跨重启认领 PID；当前普通 SubProcess 终止不宣称完整进程树监督。stdout/stderr 仍由返回值提供，尚未接持久分页输出或真实报告。

Host/CLI、有限桌面 IPC、真实隔离、完整树监督、Host 中断恢复探针和统一产物重建仍待完成。下一步补持久有界输出及平台隔离/监督能力探针，再开放双入口；不以本专项放行页面执行按钮。本轮未提交、推送、安装或发布。

PID 属性与子进程对象接口参考[仓颉 std.process 官方文档](https://docs.cangjie-lang.cn/docs/1.1.0/libs/std/process/process_package_api/process_package_classes.html)；本机 1.1.3 的编译及真实执行是此次适配证据。
