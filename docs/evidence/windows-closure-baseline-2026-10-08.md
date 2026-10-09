# Windows 持久任务与双入口收口基线

本轮目标保留前三阶段复验、目标轮次、执行监督/沙箱、真实桌面及统一产物五项出口，不以专项通过替代完整交付。

## 冻结记录

- 产品仓库：D:/Project/sa/saai/sa-code；分支 refactor/dsh-learning。
- 当前提交：ccf3bff7609d6761d14f7b712676791342e15137。35a69ca 是旧计划起点，不能继续标作当前提交。
- 私有快照：target/closure-b1a9811e86224a90a7fdc1ae2904db71。core/Host/CLI 148 个生产源码文件由 source-manifest.json 记录哈希；worktree-status.txt 与 dirty-tracked-paths.txt 保留在途清单，baseline.json 保留构建边界。
- 并发文件责任沿用 W00 登记，未确认写者不代认领。此次未暂存、提交或推送。
- 当前 SessionLog 的 durableFrozen 已使用 AtomicBool，isDurableFrozen 不再等待日志写锁；需要本轮新 Host 真实协议验收，不能复用修复前产物。
- 私有 Host 构建使用 compile-option=-O1，原因是此前默认 O0 原生生成未成功；产品 manifest 未修改，默认构建问题不算解决。构建退出与实际产物将在结束后登记，编译 warnings 不是结束证据。
- HostBridge、fixture-env、goal-host-verify 单独复制到快照，verifier-manifest.json 记录验收脚本哈希，避免运行时消费后续并发修改。

## 已取读数及尚缺证据

- 当前会话历史派生/滚动层 node 专项：26 tests / 26 pass / 0 fail / 0 skipped，rc=0；history-tests.log 与 history-tests.exit.txt 在快照目录。此测试从当前工作区执行，未冻结其页面源码，不作为完整 UI 快照验收。
- 当前 CLI main 中 goal 模式仍跑生命周期与 Driver 断言，未发现 GoalRunner 产品调用；真实目标轮次必须补用户动作入口，不能用 goal 自测替代。
- 本轮 Host 构建已启动并核到私有 cjc -O1 活进程。尚未取得新产物目标五场景结果，不能记通过。

## CLI 产品入口增量（待验证）

新增 apps/cli/src/goal_runtime.cj 与 main 的独立分派行：goal run 显式创建目标，goal describe 仅恢复只读投影；run 可指定 --budget 正整数且不放宽既有预算。共用 GoalRunner、GoalCheckpoint、GoalUsageMeter、ModelToolRuntime 精确工单、ConsoleSignals 取消。Shell/代码执行 guard 保持关闭，不以新入口绕过监督准入。活动目标创建冲突仍由 GoalService 判定。

源码已复制到本私有快照，cli-increment-manifest.json 单独记录 main、新文件与协议验证脚本哈希，不冒充原冻结 148 文件全部未变化。新增 goal-cli-verify.mjs 的 Node 语法检查通过，计划实际执行完成、预算、仅 claim、缺配置及只读恢复场景；尚未编译或跑新 CLI，不能记业务通过。网络等待与 stdin 审批期间的取消时效仍待实测。Host 构建结算后串行构建 CLI。

## 新产物双入口实测结算

2026-10-08，本私有快照 Host -O1 构建 rc=0（host-build.log/exit.txt）；打包 172 个文件，运行可执行 SHA256 `322C0D55000D7D62F0EB59BF7AB5E6C490DC1CD570DA9E35038A4AAD40A9A206`。生产源码对当前主树核到仅 CLI main 发生本批增量，Host/core 冻结文件无漂移；新文件与验证器另用 cli-increment-manifest.json 登记。

冻结 goal-host-verify：五场景 complete/budget/claim-only/freeze/cancel 均通过、rc=0，每场景恢复不执行。结果在快照 apps/desktop/.tmp-test/goal-host-proof-ALTNsE/results.json；取消 RPC 原件得 cancellation-to-settled=32114ms、max poll=547ms、protocol errors=0。冻结场景退出 lease retained 是预期保护，不能当成已修复或无条件释放。默认 O0 构建没有重新验收。

CLI 首次编译 rc=1（缺 std.convert 导入与 lowerBudget 参数调用错误），修正后 cli-build-v2.log/exit.txt 为 rc=0；运行可执行 SHA256 `9233B947ED966A72F7A491E91EE3C0FC569E2FB8FA0A47966F6312C5FFFCC717`。私有包仍由 pack-host 通用 DLL 组装器生成，因此文件名 sacode-host.exe 在该目录中实际是 CLI，仅用于验收，不是正式 npm 包。

冻结 goal-cli-verify rc=0，六场景 complete/budget/claim-only/denied-write/missing-provider/invalid-budget 均通过；读取 describe 无额外请求，受阻目标不能被新 run 覆盖，未审批写工具未落盘。原件 apps/desktop/.tmp-test/goal-cli-proof-CnakXr/results.json、各场景 run.json/describe.json 及 goal-cli-verify.log/exit.txt；验证器 SHA256 `EDC7270377E3CFDB223BDD6887B2276149EE69D625FC9D9C509A15D66209F5FA`。

两入口均为真实 Cangjie 进程、System32-only PATH、私有 cwd/TMP/用户设置，模型端为显式本地 HTTP/SSE 协议夹具。尚不覆盖远端真模型、CLI 信号取消/持久失败、模型中心统一路由、真实桌面及安装升级验收；本目标仍未完成。

### 接下来的验收顺序

1. 保留上述已结算原件；新的代码修改需重建，不沿用旧读数。
2. 补 CLI 信号取消/持久失败与同源模型路由，随后取远端真模型及桌面目标消费证据。
3. 继续核执行监督和沙箱准入，验证自然退出/取消/子进程/输出与 Host 中断恢复。
4. 沙箱/监督门禁保持关闭，按同场景推进执行双入口、桌面与产物。只有全部出口有当前源码真实证据，才完成本目标。

## CLI 冻结、系统中断及执行准入复验

使用上述同一 CLI 可执行文件，没有重编或替换二进制。扩展 goal-cli-verify 为七场景，本轮 goal-cli-freeze-verify.exit.txt=0；原件 goal-cli-proof-6OEiuo/results.json。新增 freeze 证明持久失败返回错误、租约保留、未落盘完成不暴露，describe 仍恢复 active 且不发新模型请求。

真实系统中断：新增 goal-cli-signal.ps1 与 goal-cli-cancel-verify.mjs。驱动单独分配并隐藏控制台，枚举确认其中只有驱动与其自建 CLI，再发送 Ctrl+C；不对其他控制台或未核身份进程发信号。首轮夹具 PowerShell 5 不认 uint[]，信号未发，夹具清理自己的进程，rc=1；改 uint32[] 后 v2 rc=0。原件 goal-cli-cancel-5y2MCS/result.json 与 signal-result.json：signalDelivered=true、exitCode=130、forcedCleanup=false、取消耗时 30853ms；租约释放，恢复投影 active，模型请求仍为 1。此读数不能宣称即时取消，也不覆盖 stdin 审批等待时的中断。

独立执行器源码冻结探针：shell-current-verify.exit.txt=0；shell-execution-1791437956999 下 build/run/result/tree 原件。12 个直接执行器判据通过，树观察 rootAlive=false、childAlive=false；只证明该直接子进程夹具，不能扩展为所有脱离子树或隔离能力。

同一新 Host/CLI 运行 execution-host-verify、execution-cli-verify 均 rc=0，原件 execution-host-7sygSl 与 sacode-execution-cli-DmKetX/results.json。六动作与 CLI 10 场景核到精确审批、去重、恢复与旧修订拒绝，无 SDK PATH；命令未执行，启动门禁继续关闭。脚本哈希见 extended-verifier-manifest.json；运行源与二进制不变，新增验证器另登记。

当前核心 SandboxRuntime.confine 只校验模式并返回 argv，ShellExecutor 随后正常 launch，没有操作系统隔离。Windows 真沙箱及稳定进程树归属/中断恢复仍是下一实现出口；不能因为上述准入和直接进程探针通过，把 providerReady 改 true。

## Windows 原生监督提供方增量

新增 core/native/windows_job.cs，创建时绑定 Job、挂起后显式 Resume、记录句柄查询的 PID/创建 FILETIME、整 Job 停止和 kill-on-close。当前机器三场景 stop-before-start/stop/broker-crash 实测 rc=0，源码与产物哈希、原件和接线条件见 windows-native-job-supervision-2026-10-08.md。该提供方未接 ExecutionSupervisor，管道输出与真实沙箱仍待实现，不能据此开放产品执行门禁或升级原有 Host/CLI 产物。
# Windows 执行监督双流增量（2026-10-08）

原生 Job 提供方加入 stdout/stderr 原始字节管道与 HANDLE_LIST，保留原子 Job 绑定及恢复前挂起。`node apps/desktop/test-support/windows-job-verify.mjs` 五场景通过，rc=0；证据 `apps/desktop/.tmp-test/windows-job-ddtJjU/`，日志 `target/windows-job-dual-output.log` 与退出文件。新增大输出双流截断后排空，以及根退出但后代持有管道直到 Job 停止的实测。详见 `docs/evidence/windows-native-job-supervision-2026-10-08.md`。

这是执行监督提供方增量，未升级产品完成状态：仓颉消费端、实际隔离、真实桌面和安装包仍待验收。执行准入门禁保持关闭。

