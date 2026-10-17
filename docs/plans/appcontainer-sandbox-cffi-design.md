# 仓颉 CFFI 版 AppContainer 隔离接入方案

- 日期：2026-10-12
- 状态：**2026-10-17：身份探针实现存在；本机仓颉 1.1.3 core 构建通过，当前源码对应的单测尚未运行；产品执行继续 fail-closed。**
- 当前实测：本轮源码和测试仍在验证中；2026-10-13 的 [AppContainer 身份绑定与启动对照](../evidence/appcontainer-identity-probe-2026-10-13.md) 仅对应当时旧实现，不作为当前 profile 创建探针的验收证据。
- 本轮 1.1.3 构建证据：`target/tmp/appcontainer-recheck-20261017-56357645800d453c8518e02f3f6e9896/core-build.log`（rc=0，24 条既有 warning）。
- 主责范围：`core/` 共享核心的沙箱执行面
- 前置证据：`docs/evidence/windows-appcontainer-admission-2026-10-08.md`（隔离探针实测通过，rc=0）、
  `docs/evidence/2026-10-10-remote-batch-progress.md:995`（既有解锁条件）
- 同批修订：`docs/evidence/cangjie-core-safety-review-2026-10-12.md`（同日修复了 `confine` 判据，
  见第五节末「`confine` 的判据不能是 argv 长度变化」）

## 结论先行

**不复活 C# broker，改用仓颉 CFFI 直连 Win32。** 产物是仓颉静态库，不需要任何外部编译器或
.NET Framework，直接消除当年「沙箱导致无法打包启动」的根因。

分三步，每步有可验证停止点。**第 1 步不通过不进入第 2 步**；第 2 步 4 条探针不全绿不开产品门禁。

## 一、为什么废弃 C# broker

不是安全否决，是工程落地失败。两个原因都有仓库证据：

| 原因 | 证据 |
| --- | --- |
| 依赖外部编译链 | `windows-native-job-supervision-2026-10-08.md:9`「构建用 Windows .NET Framework C# 编译器……正式产物的 .NET 可用性及打包仍待验收」；同文件 :51 点名 `/r:System.Web.Extensions.dll` |
| 打包脚本已成死引用 | `scripts/pack-windows-execution.mjs:14` 硬编码要读 `windows_job.cs`、`windows_appcontainer.cs`、`windows_job_broker.cs`，第 20 行从 `core/native/` 取；**这三个文件从未入库**——`git log --all --diff-filter=A` 查它们的历史为零结果，`core/native/` 目录当前不存在。脚本第 9 行还强制校验 40 位源码 SHA，没有真实源码就无从满足 |

即：**只要有人跑 `pack-windows-execution.mjs` 就必然失败**，因为它要编译的源码根本不在仓库里。
这不是「打包配置漏项」，是产物与脚本只入库了一半。

CFFI 路线在仓内已有两处现成范本，不是引入新技术：

- `core/src/procwin.cj` — 绑 kernel32 的 `OpenProcess` / `GetExitCodeProcess` / `CloseHandle`
- `core/src/filewin.cj` — 绑 `CreateFileW` / `WriteFile` / `MoveFileExW`（2026-10-12 新增）

## 二、中心仓核查：无可用包

`pkg.cangjie-lang.cn` 的 `/v1/artifact/searchPackages` 端点，对
`sandbox` / `win32` / `windows` / `ffi` / `security` / `acl` / `job` / `process` / `token` /
`container` / `isolate` 共 11 个关键词逐一检索，**命中 10 个包，全部是 OpenTelemetry 与 gRPC
生态**（`opentelemetry4cj_sdk`、`opentelemetry4cj_exporters`、`opentelemetry4cj_extensions`、
`grpc4cj`、`grpc4cj_build`、`grpc4cj_codegen`、`grpc4cj_otel`、`protoc_gen_cj`、
`elasticsearch4cj`、`prometheus4cj`），与安全隔离无关。

**2026-10-13 校正：之前关键词查询全部返回相同第一页，未验证 keyword 是否真正生效或分页是否完整，因此不能据此证明中心仓无可用包。**
当前只确认当时取到的第一页没有相关包。后续需按网站真实请求参数核查，不能把“不在这一页”写成“全仓不存在”。

## 三、参考对象核查

### magic-cli（同语言，可作范本）

`cangjielanguage-sig/magic-cli`，仓颉项目，136 个 `.cj` 文件。有 `src/sandbox/` 5 个文件，
按平台拆分。**本方案采纳它的三个做法**：

1. **权限 profile 配置化，不用硬编码 if**。`seatbelt_profiles.cj` 用
   `HashMap<String, String>` 存 profile，内容是纯文本权限描述。我们的
   `read-only` / `workspace-write` 照此形态做成可扩展档位表。
2. **机制冲突 fail-fast**。`sandbox_macos.cj` 启动前先查
   `getVariable("BUILD_SANDBOX").isSome()` 就抛错——禁止两个沙箱机制同时开。
   对我们：AppContainer 开启时若发现门禁仍是硬编码值，必须拒绝启动。
3. **平台不支持就明说，不静默降级**。`start_sandbox.cj` 里 macOS 与 Linux 两条完全不同的路，
   没有「Windows 当没沙箱」这个分支。

它的 FFI 结构也印证方向：`ffi/raw_input_win.c` + `ffi/raw_input_linux.c` ——
**按平台拆 C 文件 + CFFI 绑定**，不是 C#。

### ACEHarness（**不是**同语言，参考价值有限）

**更正一个前提**：ACEHarness 不是仓颉项目。扫其仓库树 1569 个文件，
`.cj` 文件 **0 个**、`.cs` 文件 **0 个**；README 徽章为 Next.js-16 / TypeScript-5.x，
README 全文无 sandbox / isolation 表述。

它不能作为「同语言产品」参照，避免后续误用。可参考的只有一点：**Spec Driven Development +
状态机工作流**这类工程组织方式，与执行隔离无关。

## 四、前置调研：三条路线的边界（2026-10-12 核实）

仓库里 `apps/desktop/.tmp-test/takeover-20261011/` 存有前一轮的第三方源码调研产物。经核实，
那三个文件**都是别人的实现，不是本仓技术栈**：

| 文件 | 实际来源 |
| --- | --- |
| `sandbox.h`、`target_services.cc` | Chromium Google User-Land Application Sandbox（C++，BSD） |
| `mxc-secenv.rs`、`mxc-base_container_runner.rs`、`mxc-ffi.rs` | Microsoft 官方代码（MIT，`Copyright (c) Microsoft Corporation`） |
| `read-official-sandbox-source.cjs` | 从 GitHub 拉 Chromium `sandbox/win/src/` 的调研脚本 |

那份 Rust 注释记录了 Windows 隔离的三条路线与各自边界（`mxc-secenv.rs:9-14`）：

1. **classic AppContainer** —— `CreateProcess` + `SECURITY_CAPABILITIES`
2. **BaseContainer** —— 一次性 RPC-broker 的 `Experimental_CreateProcessInSandbox`
3. **PSEC 两阶段** —— `processmodel.dll` 的 `CreateProcessSecurityEnvironment`

并指出 MXC 现有两条路径**都不产出 security-environment 句柄**，只有 PSEC 能拿到，
而它需要 broker 在服务端把 SID 解析成 target AppContainer。

**本方案选第 1 条**，理由三条：

- classic AppContainer 允许可信父进程通过创建属性配置；父进程也可承担 broker 职责。
  broker 是监督/特权边界的一种架构角色，不等同 C#。现有研究不足以认定此前 C#
  broker 仅为了审计，或 PSEC/BaseContainer 仅服务可观测性。最终实现只采用仓颉。
- **已有本机实测通过证据**。`windows-appcontainer-admission-2026-10-08.md:46-62` 那轮走的就是
  classic AppContainer；该历史探针自身是 C# 可信创建方，不能写成“完全无 broker”。
  历史日志不能替代本轮仓颉实现的隔离与安装验收。
- **API 是公开稳定的 Win32**。`DeriveAppContainerSidFromAppContainerName` 与
  `CreateAppContainerProfile` 均属 `userenv.h` 公开文档（2026-10-12 访问 HTTP 200），
  不依赖任何内部接口。

代价要写明：不提供**拒绝事件的捕获与审计**。本仓只能看到「操作失败」，拿不到
「谁在什么时候因哪条 capability 被拒」。若后续要审计能力，那是另一项，
不与本方案混为一谈。

## 五、技术路线

用 **AppContainer**，不用 Job Object。

`windows-native-job-supervision-2026-10-08.md:26` 明确警告：Job 只能证明进程与资源管理，
**不能单独证明文件与网络隔离**。Job 那条线（进程树监督、取消、逃逸回收）保留不动，
两套共存但不互相顶替。

Win32 CFFI 接口按用途列出如下（当前实现还包含 DLL 延迟加载与进程收束调用）：

| DLL | 函数 | 用途 |
| --- | --- | --- |
| `userenv.dll` | `CreateAppContainerProfile` / `DeleteAppContainerProfile` | 创建本次唯一临时 profile；只删除本次成功创建的 profile |
| `kernel32.dll` | `CreateProcessW` + `PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES`、`InitializeProcThreadAttributeList`、`UpdateProcThreadAttribute`、`TerminateProcess`、`WaitForSingleObject` | 创建挂起的身份探针进程、验证后终止并等待 |
| `advapi32.dll` | `OpenProcessToken` / `GetTokenInformation` / `EqualSid` / `FreeSid` | 核验 token 类型及 SID，并释放本次创建返回的 SID |

探针在进程创建失败时只报告 `appcontainer-create-failed`；当前没有可靠的 Win32 错误码字段，不把 `GetLastError` 的线程局部读取冒充为已验证诊断值。

**`confine` 的判据不能是 argv 长度变化**（2026-10-12 修正）。AppContainer 在**进程属性**上绑
SID，argv 可以原样；但**返回原 argv 后再用普通 std.process.launch 启动，不会携带这些安全属性，仍是裸跑**。
非空 argv 只验证向量格式，不能证明 enforcement。早期实现用 `confined.size < argv.size`
当隔离证据，会把 AppContainer 后端**永久误判成不可用**——本轮已在 `sandbox.cj` 修正，
并由 `skillReviewProviderMayReturnSameLengthArgv` 钉住。

`confineRewritesArgv()` 也不是隔离证据：加一个无效参数同样可使其返回 true。
真正的提供方必须完成原生创建、token/SID 校验、隔离反向测试、进程树与输出收束；
产品能力宣告需由这些结果驱动。本阶段不修改该探针，也不开放门禁。

零网络 capability —— 不申请任何网络 capability 即默认无网络。

### 已实测的隔离效果（`windows-appcontainer-admission-2026-10-08.md:46-62`，rc=0）

| 验证项 | read-only | workspace-write |
| --- | --- | --- |
| 工作区内读 | 通过 | 通过 |
| 工作区内写 | EPERM 拒绝 | 通过 |
| 区外读写 | EPERM 拒绝 | EPERM 拒绝 |
| 区外 canary | 未变 | 未变 |
| 子进程逃逸 | `DESCENDANT_DENIED:EPERM` | 同 |
| TCP 连接 | ETIMEDOUT 且服务端连接数 0 | 同 |

网络那条做法严谨：先由普通进程真实连上确认可达，再要求隔离进程超时**且服务端新连接数为 0**，
没有拿「无监听服务导致的超时」冒充隔离成功。

变异反证：把 read-only 私有目录授权故意改为 Modify，独占受害断言 `insideWrite.allowed` 转红。
证明断言不是恒真。

## 六、三步实施与停止点

### 第 1 步：CFFI 绑定与编译

**2026-10-17 最新结果**：空子环境缺少 LOCALAPPDATA 触发本机 Win32 error 203；只补充 LOCALAPPDATA/SystemRoot 后，当前仓颉实际身份测试 **5/5、退出码 0**，含 AppContainer 标志、SID 匹配、确认终止及 profile 清理。原生空环境/仅 SystemRoot 失败与两字段成功对照保留。见 [当前实测及源码哈希](../evidence/2026-10-17-appcontainer-minimal-environment.md)。第 1 步的身份前置已通过，打包验收、工作区/网络/后代隔离和实际执行提供方未通过，默认执行仍关闭。下面本日较早的失败记录保留为历史。

`core/src/appcontainer_win.cj` 与 `core/src/appcontainer_win_test.cj` 已实现显式身份探针，默认不装配到 SandboxRuntime。
可选系统 DLL 使用 System32 限定的延迟加载，不因 DLL 或 API 缺失阻断宿主启动。
探针尝试创建本次唯一 profile，再挂起创建固定系统程序并验证 token 和 SID；不恢复、不改 ACL。

2026-10-17 使用修复后的本机仓颉 1.1.3（`D:\Program Files\HuaWei\Cangjie`）在私有 `target/tmp` 目录构建通过，24 条警告、退出码 0。将当前 `appcontainer_win_test.cj` 单独编译并链接到这份 core 产物后，4 条定向用例为 3 通过、1 失败：ABI、零能力和默认 fail-closed 通过；身份用例中 profile 创建、SID 返回及 profile 删除通过，但 `CreateProcessW` 返回失败，所以没有子进程 token、SID 匹配或终止证据。中间诊断构建读取到 Win32 last-error 值 0，无法作为可信错误码，最终源码仍只返回 `appcontainer-create-failed`。全量 `cjpm test` 未运行；本步骤未达到身份核验通过。产品执行仍 fail-closed。

本轮证据：构建日志 `target/tmp/appcontainer-final-build-20261017-dcd8e311/build.log` 与退出码文件 `build.exit`；定向测试编译日志 `target/tmp/appcontainer-final-test-20261017-904e812d/compile.log`；运行输出、错误和退出码分别为该目录下 `run.out`、`run.err`、`run.exit`。测试运行仅对该目录内生成的测试 EXE 临时设置 Medium 完整性标签，结束后恢复 Low；SDK 用户配置、系统权限和全局环境未改。

**2026-10-17 后续修正（当前源码）**：CangjieSkills 的 `inout` 叶子规定指针仅在一次调用期间有效；Microsoft `UpdateProcThreadAttribute` 契约要求 `lpValue` 一直有效到属性列表销毁。现将 `SECURITY_CAPABILITIES` 存入持有的裸数组句柄，先销毁属性列表再释放该句柄，消除原 `inout capabilities` 的生命周期违规。修正后 core 构建 rc=0；定向 4 条仍为 3 PASS / 1 FAIL。仓内 Low 标签二进制在 profile 创建时返回 `0x80070005`；使用现有 `export-windows-artifact.mjs` 只导出字节至普通 Medium 目录后，profile 创建/删除通过，但进程创建仍失败。因此这项修正不是已证明的唯一根因，产品门禁仍关闭。本轮没有更改 ACL 或完整性标签。

最新日志：`target/tmp/appcontainer-pinned-20261017-64ab/build.log`；`target/tmp/appcontainer-pinned-test-20261017-651a/compile.log`、`run.out`（Low）、`medium.out`、`medium.exit` 与 `export.log`。中性导出 `D:/Temp/SaCode-AppContainer-20261017-651a/test.exe.manifest.json` 记录源 Low、目标 implicit-medium 及同字节 SHA256。契约依据：[Microsoft lpValue 生命周期](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute)。

产物放置守卫本轮为 `GATE: FAIL (13 checks, fail=3)`：本任务先前一次路径拼接错误在 `core/core/target/tmp/appcontainer-recheck-20261017-56357645800d453c8518e02f3f6e9896` 留下私有构建目录；另有 `apps/host/target/`、`apps/desktop/target/` 两项模块白名单失败，归属未核，不触碰。私有旧构建产物保留，尚未迁移；因此不得把本轮产物守卫记为通过。

**通过条件**：`cd core && cjpm build` 为 `cjpm build success`。

**必须额外验证打包**（这是当年翻车的地方，不能只看源码机绿灯）：
`node scripts/pack-host.mjs` 出自包含目录 → `npx electron-builder` 出包 → 干净环境启动宿主。
第 1 步的打包验收不通过，则整个方案回到 BLOCKED，不进第 2 步。

### 第 2 步：4 条隔离探针

**2026-10-17 原生进程增量**：`core/native/windows_process.h/.c` 已提供受限 C ABI v1，实际验证挂起创建、令牌核验、Job 在恢复前绑定、三句柄继承名单、双流 EOF、恢复前停止和后代收束，35 项通过。详见 [本轮组件证据](../evidence/2026-10-17-windows-owned-process-provider.md)。后续包内仓颉适配与 TurnToken 已完成真实 DLL 验证，并新增共享 ShellResult 转换（[记录](../evidence/2026-10-17-windows-process-collector.md)）；已通过可注入进程接口进入同一 `ExecutionSupervisor`/`ExecutionService` 持久链，显式装配实测 [13/13](../evidence/2026-10-17-windows-execution-supervisor-integration.md)；默认 `ShellExecutor` 路径及 Host/CLI 装配未开放；未修改公共门禁。以下文件/网络隔离条件仍须逐项实测，不以 Job 收束替代文件/网络隔离。

后续在 `core/src/appcontainer_win_test.cj` 中逐条验证，逐条红→绿：

1. 工作区内读取成功
2. 工作区内写入：`read-only` 拒 / `workspace-write` 放行
3. 区外读写一律 EPERM，且区外 canary 字节未变、未生成新文件
4. 子进程逃逸拒绝（`DESCENDENT_DENIED:EPERM`）

反向探针（沿用 magic-cli 做法）：网络隔离必须由「普通进程可达 + 隔离进程不可达 + 服务端
0 新连接」三条同时成立才算通过，不接受纯超时。

**通过条件**：4 条全绿 + 变异体（故意放宽 read-only 授权）转红。

### 第 3 步：接产品门禁

只有真正的原生创建提供方、token 身份和文件/网络/后代反向测试通过，且产品任务
同时满足审批、持久化与取消契约后，才设计能力宣告并解除 execute 拒绝。
不能仅凭 `confineRewritesArgv()` 返回 true 开门禁。

这是 `2026-10-10-remote-batch-progress.md:995` 既定的解锁条件，不是本方案自创。
**只改 `enforcing` 字符串不算完成** —— 该批次的 N2 变异反证就是钉这一点的。

**通过条件**：`node apps/desktop/test/...remote-execution-gate...` 整族不再被拒，
且 AppContainer 创建/授权失败时**拒绝启动**，不得回退到普通 Job。

## 七、必须防的事故

### ACL 会碰真实文件系统权限

AppContainer 要给工作区目录加 ACE。加错会锁死用户的文件。

**已知踩坑**：`windows-appcontainer-admission-2026-10-08.md:33` 记录，撤销 ACL 时
`GetSecurityInfo` 抛 `UnauthorizedAccessException`，同进程撤销失败，最后靠**外部进程**
才清理成功（`cleanup-exit=0`）。

对策：

- ACL 改动**只允许落在明确的私有目录**，拒绝区外路径与重解析点（沿用该文档既有做法）。
- 配**独立进程**清理路径，不能假设同进程能撤销自己加的 ACE。
- 探针的 `finally` 清理失败**不算用例通过**，必须落独立清理并留 `cleanup-exit` 证据。
- 绝不修改真实工作区或父目录权限。

### fail-closed 不得被绕过

AppContainer 创建失败、SID 派生失败、ACL 授权失败、机制冲突——任何一项都必须拒绝启动，
禁止降级到普通 Job 或裸跑。沿用 magic-cli 的 `FatalSandboxError` 思路：异常分类独立，
不与一般执行失败混为一谈。

### 网络隔离的诚实声明

即使 AppContainer 接入，`RemoteSandboxEnforcement` 的 `limitations` 里
`no-file-system-isolation` / `no-network-isolation` / `no-namespace-or-seccomp-backend`
在本阶段**仍须保留**。将来实际证明文件、网络隔离后应按已验能力更新对应限制，
而非永远宣称“没有文件/网络隔离”；进程治理单独不能移除这两项限制。

## 八、本轮不做

- 不接 Linux（namespace/seccomp/mount）——需 Linux 或 WSL2 环境，另立项
- 不动 `ExecutionSupervisor` 的 Job 进程树监督线
- 不开放 Host/CLI 公共执行门禁（第 3 步之前一律保持 fail-closed）
- 不改 `danger-full-access` 档位的语义
- 不把方案状态写成「完整通过」，直到第九节 9.3 的干净环境安装验收完成

## 九、三个待定项的裁决

评审于 2026-10-12 定稿。以下三条取代原「待评审问题」。

### 9.1 ACL 授权范围：工作区根 + 显式只读工具目录，不递归 `.git`

**裁决**：递归授权工作区根（含子目录）；`.git` 与 `target`、`node_modules` 等构建产物目录
**单独排除**；额外只读目录采用显式清单，不做「工作区外一律可读」。

**2026-10-13 实施约束校正**：根目录可继承 ACE 会自动传播到所谓跳过的子树，
仅“遍历时跳过 .git”不能实现排除。未经私有副本/逐项不继承授权等方案验证，
不允许修改真实项目根 ACL。工具链目录的只读准入需显式测试，不能用此排除表代替隔离。

理由：

- `.git` 里含凭据（`.git/config` 可能带 remote URL 内嵌 token）。递归授写等于把凭据
  写权限交给模型控制的进程。
- `target` / `node_modules` 递归授权在大型仓库上是万级 ACE，直接决定 ACL 操作耗时。
- magic-cli 的 Seatbelt profile 用的正是 `(subpath (param "WORK_DIR"))` + 显式
  `(subpath TMP_DIR)` 白名单形态，不做「默认全放开」。照此形态。

实现约束：

- 排除清单为常量表，放在沙箱模块内，**不接受模型或协议面传入**。
- 递归深度设上限（默认 32），超限记失败并拒绝启动，不静默截断——静默截断会让
  深层目录行为与预期不一致，比直接拒绝更难排查。
- 排除命中时**不是拒绝整个目录**，而是跳过该子树的授权并记一条日志。

### 9.2 `read-only` 下的工作区外只读访问：显式清单，默认不放开

**裁决**：`read-only` 默认仍拒绝工作区外全部访问（含只读）。另提供一份**显式只读清单**，
清单内的目录可读不可写。清单随产品能力演进，第一版可只含两项：用户配置目录下的
只读设置的经审核导出副本；**凭据目录与完整会话日志不默认授权**。
目录里“有些文件只是引用”不保证没有明文密钥或敏感历史。SDK 与依赖缓存不默认放行。

理由：

- 全放等于没有隔离；`read-only` 的价值就在于拦住写。
- 全拒会打到可用性：仓颉工具链要读 SDK 目录，模型要读项目外的配置。
  但这是**可用性问题，不是安全豁免的理由**——放开必须逐条显式，不靠推断。
- 同上：magic-cli 的 profile 把 `/dev/stdout`、`/dev/null` 等逐条列出，
  没有「大概这些是要用的」这种推断式放开。

实现约束：

- 清单只授**读**（`GENERIC_READ` + `FILE_READ_DATA`），不授写、不授 delete。
- 清单项必须落在明确的私有/用户目录，拒绝重解析点，防止越界放大。
- 清单为空时 `read-only` 就是严格全拒，这是**合法且预期的**配置，不是降级。

### 9.3 打包验收环境：本机只能验结构，干净 Windows 验收列为交付门槛

**裁决**：第 1 步在本机做**结构验收**（`pack-host` 出自包含目录、`electron-builder` 出包、
宿主可执行、`asar` 内无缺失依赖），**不断言干净机器可启动**；「全新 Windows 环境安装后启动」
作为**交付门槛**单列，未完成前方案状态保持 `PARTIAL`，不得写成完整通过。

理由：

- 当年翻车点正是把源码机绿灯当打包通过。这条不能松。
- 但也要如实：本机已有 Node/Electron 环境，`electron-builder` 出的包我无法证明
  「换一台没装过任何东西的机器也能起」。硬说能就是重犯 2026-10-08 的错。

第 1 步的结构验收清单：

1. `node scripts/pack-host.mjs` rc=0，宿主 exe 与全部依赖 DLL 同目录
2. `npx electron-builder` rc=0，产出 portable 与 nsis
3. `process.resourcesPath/host/bin/sacode-host.exe` 存在且摘要等于本轮新构建产物
4. `asar` 内 `core/native/**` **无引用**——CFFI 化后不应再有 C#/broker 依赖；
   若仍有残留，说明迁移不彻底
5. 打包产物在**本机**跑 `--smoke` 通过（不等于干净环境通过）
6. `scripts/pack-windows-execution.mjs` **已被删除或改写为不依赖 `core/native/*.cs`**。
   该脚本当前是死引用（硬编码读三个从未入库的 `.cs`，且强制校验 40 位源码 SHA），
   留着它就是留一个必然失败的构建入口。CFFI 化完成后它应整体移除；
   若确实要保留给 Job 进程树那条线，则必须连同 `core/native/*.cs` 一起入库，
   不能只留脚本。

第 4 条与第 6 条是这次新增的针对性检查，直接对应当年「找不到文件导致起不来」。

## 十、历史阻塞（截至 2026-10-12 收笔；2026-10-13 曾更新）

> **2026-10-17 当前状态**：本机 error 203 的最小环境修正后，当前身份测试 5/5，AppContainer 标志/SID/终止/profile 清理通过。原生提供方装配、ACL 与网络/后代反向隔离、打包仍待完成，产品执行继续拒绝；较早的 3/4 与 SID-only/Low 记录均为历史，不能替代当前或完整沙箱验收。

> **2026-10-13 更新**：core 私有快照构建 rc=0，持久化专项 13/13，集成 58 条为
> 57 PASS / 1 ERROR（真实执行因无隔离后端拒绝）。见持久化修复证据。
> AppContainer 身份探针已编译，普通进程创建成功，AppContainer 属性创建失败；
> 调用方 Low 完整性 RID=4096。当前创建失败根因仍待诊断，未修改机器权限、未提权。
> 下列 10-12 内容仅保留历史，不再作为“第 1 步尚未开始”的当前判断。

以下内容记录 2026-10-12 时的历史阻塞，不代表当前步骤状态：

当时第 1 步（CFFI 绑定）尚未开始，卡在两件事上：

**其一，取不到可信的 core 测试基线。** `core` 编译已通过（`cjpm build success`），
但全量测试每轮需重编 344 个文件（约 20 分钟），而本环境 `cjpm test` 与 `cjpm build` 共享
`core/target/release`，并发会互锁。2026-10-12 三次尝试：两次互锁超时，一次跑出
`TOTAL 1263 / PASSED 1154 / FAILED 41 / ERROR 66`，但那 41 条经查为同日引入的
`lease.cj` 缺陷所致（已修，见 `cangjie-core-safety-review-2026-10-12.md` §2.2），
修正后的基线尚未重取。**因此本文第 1 步的前置条件（可信基线）目前不满足。**

**其二，干净 Windows 打包验收无本机替代。** 第 1 步验收第 5 条明确要求
「全新 Windows 环境安装后启动」，这一步本机做不了，只能列为交付门槛。

已具备的条件：CFFI 范本（`procwin.cj`、`filewin.cj`）、隔离效果的既有实测证据、
方案裁决（第九节）、`SandboxRuntime` 的 fail-closed 收口与 `sandboxRuntime!` 注入口。


### 2026-10-17 私有目录实现增量

[原生组件 47 项实测](../evidence/2026-10-17-windows-private-workspace-scope.md)采用创建时的受保护初始 DACL，避免修改真实项目根和父目录权限。拒绝宽泛应用 SID、重解析父路径、未知档位和既有目录覆盖授权。撤销不递归 SetSecurityInfo：进程整树结束、产物导出并独立清理内容后，对持有句柄的空目录标记删除；非空拒绝，close 最终删除目录。当前只证明特定文件 canary、两档访问和清理，不证明网络或所有区外路径隔离。

下一步必须实现私有副本范围、.git/target/node_modules 等排除、修订绑定、字节复制与变更导出，再与共享执行监督层和 F08 合入语义衔接。不得把原提案 cwd 静默映射到未披露的副本，也不允许以这批组件测试解除公共门禁。


2026-10-17 后续装配：[仓颉私有 cwd 真实任务](../evidence/2026-10-17-cangjie-private-workspace-task.md)新增 WindowsPrivateWorkspace 生命周期与同一共享审批/执行链的私有文件读写，当前定向 16/16。生产树快照、排除清单、源修订与差异导出/合入仍未完成；D14 和默认执行门禁保持未解除。
