# AppContainer 身份绑定与启动对照

- 日期：2026-10-13
- 状态：**绑定可编译；身份创建探针 BLOCKED；产品沙箱继续拒绝执行**。
- 语言：仓颉 1.1.3 cjnative，Windows x64。没有 C#、Rust、C/C++ 自建 helper 或 .NET 依赖。
- 边界：只新增 `core/src/appcontainer_win.cj`、`appcontainer_win_test.cj` 与文档。
  未修改 renderer、main/preload、Host/CLI 产品入口；未改真实工作区 ACL、未提权、未放开安全策略。

## 本轮实现

显式调用 `appContainerIdentityProbe()` 时才开始加载系统 API；模块链接本身不创建进程。

1. 从 System32 限定加载 `userenv.dll` 和 `advapi32.dll`，动态解析所需函数。
   不将这两个可选功能变成宿主启动时的静态 DLL 依赖，不从 cwd 或自报环境路径加载。
2. 按 @C struct 映射 `STARTUPINFOW`、`STARTUPINFOEXW`、`SECURITY_CAPABILITIES`、
   `PROCESS_INFORMATION`，调用前检查 Windows x64 大小 104/112/24/24。
3. 仅派生 SID，没有调用 CreateAppContainerProfile，不写 profile 注册表。
4. 创建固定系统 cmd.exe，显式 System32 cwd、空 Unicode 环境、句柄不继承、
   CapabilityCount=0，CREATE_SUSPENDED；**没有 ResumeThread 调用，没有任意 argv 通道**。
5. 若创建成功，核对 TokenIsAppContainer 和 token SID 与本次派生 SID 一致，再终止并等待。
   创建或身份校验失败绝不降级普通进程；只有观察确认终止才报告 terminated=true。

这只是身份绑定骨架。没有 ACL、文件/网络反向探针、Job 树监督、输出捕获、审批/持久准入接线。
即使身份探针通过，也不能直接开放产品执行。

## 本机实测

### 编译与默认拒绝

| 项 | 结果 |
| --- | --- |
| 独立身份探针 `cjc -O0 -p <probe> -o <exe>` | rc=0 |
| 三条单测：ABI、零 capability/标准句柄、默认 SandboxRuntime 拒绝 | 3/3，0 FAIL、0 ERROR，编译/运行 rc=0 |
| 完整 core 私有快照 `cjpm build` | rc=0，`cjpm build success` |
| `cjfmt -f core/src/appcontainer_win.cj` | rc=0 |
| `cjlint` | rc=0，33 SUGGESTIONS、0 MANDATORY；不声称零诊断 |

### 同机启动对照

最终格式化源码编译的探针输出：

```text
caller_integrity_rid=4096
control_created=true control_terminated=true
available=true created=false appContainer=false sidMatches=false terminated=false pid=0 reason=appcontainer-create-failed
```

- 普通挂起控制组：同一 cmd.exe、同一 cwd、空环境、不继承句柄，创建及终止成功。
- AppContainer 组：系统 DLL/函数可解析、SID 派生、属性列表初始化与 SECURITY_CAPABILITIES
  更新成功，但加入扩展安全创建属性后 CreateProcessW 失败，目标没有运行。
- 调用方 token 的完整性 RID=4096，为 Low。它是直接观察，不是从目录权限猜测。
- 初次将同一探针复制到新建普通系统临时目录，文件不继承仓库 Low 标签，但结果仍为
  普通创建成功、AppContainer 创建失败。因此“只把 exe 移出仓库就一定能解决”未成立。

**不能据此将 Low 完整性判成唯一根因**：没有改变调用上下文做 Medium 对照。
也不能断言 Windows 不支持该能力；还可能有 token 限制或安全创建条件差异。
本轮不降低系统策略、不修改父权限、不绕过门禁。

## 诊断诚实边界

曾尝试 CreateProcessW 失败后单独 CFFI 调 GetLastError，读数 0，无法作为可靠原生错误码。
最终只记录 `appcontainer-create-failed` 阶段，不伪造 ERROR_ACCESS_DENIED。
首次 tokenInfo 的 inout buffer 类型不兼容及 UInt32/UIntNative 比较编译错误已修，
最终编译 rc=0；这些早期错误不算成功证据。

## 原件位置

`apps/desktop/.tmp-test/appcontainer-research-20261013/`：

- `identity-final-build.{stdout,stderr}.log`、`.rc`；`identity-final-run.{stdout,stderr}.log`、`.rc`
- `unit-build.{stdout,stderr}.log`、`unit-run.{stdout,stderr}.log`
- `core-final-build.{stdout,stderr}.log`、`.rc`
- `lint-final.json`、`lint.{stdout,stderr}.log`
- `probe/` 为真实生产文件副本和固定控制程序；`skills/` 为用户指定 skill 的只读检索副本。

Skill 来源：`Cangjie-SIG/CangjieSkills` 的 `cangjie-1.1.3`，
`4b844f29e82b32ecf2171c36659b9e8ea9e2f595`。已读取实际 README 与发布 SKILL.md，
通过 search_docs.py 查 CFunc、@C struct、CPointer、sizeOf、数组指针配对生命周期。
本阶段未引入 stdx 依赖，没有重配项目 SDK/stdx。

## 下一步解锁条件

### 手动 Medium 对照入口

已准备 `scripts/invoke-appcontainer-identity-check.ps1`：冻结摘要校验、唯一临时目录、
自带两颗仓颉运行库、清空子进程环境、30 秒看门狗、原始输出与结果 JSON；
通过条件要求真实 Medium RID、控制组成功、AppContainer/SID/终止事实和实际 rc=0。
脚本仅作验证驱动，不是产品隔离提供方，不引入 C#。

PowerShell parser 语法错误数为 0，但本机未签名脚本执行策略拒绝了该脚本，
**未实际执行，不能报驱动验证通过**。没有使用 ExecutionPolicy Bypass、改策略或解除标记。

另准备直接 exe 入口：
`apps/desktop/.tmp-test/appcontainer-research-20261013/manual-packet/`，仅三文件：
`identity-probe.exe`、`libcangjie-runtime.dll`、`libboundscheck.dll`。
exe SHA-256：`5A042992466B073CA49570899529636B93894D8B67D9AEDB7D646F64CF603AD6`。
PE 直接依赖及两运行库传递依赖已读取检查，除了这两颗运行库都是系统 DLL。
本机清空 PATH 至 System32 后该包仍能启动，输出 Low RID=4096、控制成功、AppContainer
创建失败；只证明载荷依赖齐全和 Low 侧对照，不证明 Medium 或安装态。

用户从普通非管理员终端复制三文件至自己唯一的普通 Temp 子目录，再直接运行 exe，
无需执行 `.ps1`。结果必须带调用方 RID 和控制/AppContainer 两组事实；不能用管理员
High 进程成功冒充 Medium 对照。

1. 在明确授权的普通 Medium 交互进程中运行**同一冻结仓颉探针**，保留控制组和
   AppContainer 组真实退出/身份/终止事实。不得自动提权，也不得关闭工具安全限制。
2. 若仍失败，先对比创建结构、属性与调用方 token，补可可靠读取的失败诊断，
   不直接搬出第三方 helper 或尝试普通进程回退。
3. 创建成功后，再设计私有目录授权与继承排除、撤销路径、文件/网络/后代反向验收。
   不把工作区根的可继承 ACE 配合“遍历跳过 .git”当成排除已实现。
4. AppContainer 必须在原生创建提供方中实际应用；返回同 argv 后普通 launch 仍是裸跑。
   argv 是否改变不能证明隔离，`confineRewritesArgv()` 不得单独成为门禁开放条件。

## 官方 API 依据

- [SECURITY_CAPABILITIES](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-security_capabilities)
- [STARTUPINFOW](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/ns-processthreadsapi-startupinfow)
- [UpdateProcThreadAttribute](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute)
- [CreateProcessW](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw)
- [DeriveAppContainerSidFromAppContainerName](https://learn.microsoft.com/en-us/windows/win32/api/userenv/nf-userenv-deriveappcontainersidfromappcontainername)
- [LoadLibraryExW](https://learn.microsoft.com/en-us/windows/win32/api/libloaderapi/nf-libloaderapi-loadlibraryexw)
- [TOKEN_INFORMATION_CLASS](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ne-winnt-token_information_class)

Context7 Win32 索引本轮精确查询无命中，随后直接读取微软官方页面；官方文档不替代本机验收。
