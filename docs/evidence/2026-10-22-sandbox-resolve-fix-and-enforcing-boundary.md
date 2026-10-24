# 2026-10-22 沙箱解析缺陷修复与强制隔离真实入口边界

## 结论

修了两个阻塞 shell/run_code 真实执行的生产缺陷：

1. **PATH 解析对不存在路径抛异常**（`resolveWindowsExecutable`）：`FileInfo(candidate).isRegular()` 在路径不存在时抛 `FSException`，导致 PATH 首个不含目标命令的目录就中断整轮解析，run_code 的 node 解析塌成 `appcontainer-init-failed:resolve:unknown`。修复为先 `exists()` 再 `isRegular()`。
2. **缺 AAP 组即拒绝 AppContainer 身份**（原生层，前序已改）：`token_has_group()` 要求 `S-1-15-2-1`（ALL APPLICATION PACKAGES）否则返回 `ERROR_NOT_SUPPORTED`；但无包身份 profile 与系统 AppContainer 进程均不含该组，属误拒。已删除该守卫，身份只校验 `TokenIsAppContainer` + `TokenAppContainerSid`。

修复后，在 `SACODE_WINDOWS_ENFORCING=1` + 原生 DLL 齐备时，shell 与 run_code 经 AppContainer 真实启动并给出**真实分类结算**，不再折叠为 `SANDBOX_UNAVAILABLE` / `io-error`。剩余边界是工作区 ACL：AppContainer SID 无法读写用户拥有的项目文件，需 ACL 授权或私有副本胶囊机制，不在本次最小修复范围。

## 红先测试（TDD）

新增 Windows-only 用例 `resolveWindowsExecutableSkipsMissingEntriesAndFailsClassified`（`core/src/appcontainer_win_test.cj`）：
- PATH 首项为不存在目录，第二项为 System32 → 必须跳过首项解析到 `hostname.exe`；
- 全部不存在时抛固定分类 `windows-enforcing-resolve-not-found`，而不是 `FileInfo` 的原始异常文本。

**红灯**（修复前，同源私有模块 `target/tmp/sandbox-fix-20261022/coreprobe/`）：
```
[ ERROR  ] CASE: resolveWindowsExecutableSkipsMissingEntriesAndFailsClassified
REASON: FException: The input path `C:\__sacode_resolve_missing_dir__\hostname.exe` does not exist.
  at std.fs.FileInfo.init(...) at core.resolveWindowsExecutable(...windows_process_adapter.cj:854)
Summary: TOTAL: 6  PASSED: 0, SKIPPED: 5, ERROR: 1  FAILED: 0
RC=1
```

**绿灯**（修复后，同模块同源）：
```
[ PASSED ] CASE: resolveWindowsExecutableSkipsMissingEntriesAndFailsClassified
Summary: TOTAL: 6  PASSED: 1, SKIPPED: 5, ERROR: 0  FAILED: 0
cjpm test success
RC=0
```

### 为什么用私有同源模块而非共享 core 套件

HEAD（83837c1）的 `core` 测试套件**无法编译**：`subagent_delegate_test.cj` 与 `tool_subagent_test.cj`（均在 9c85fed 入库、工作区干净）定义了同名 `@Test func delegateToolRegistrationApprovalResultAndCancellation`，cjc 报 `redefinition of declaration`（19 errors）。这是既有提交级阻塞，非本任务引入，也未在本轮改动他人测试文件。

为不修改他人测试、又能对生产源码做红先验证，在 `target/tmp/sandbox-fix-20261022/coreprobe/` 复制了 core 全部非 `*_test.cj` 源（233 文件 + launch_context 子包）+ 仅含本用例的 `appcontainer_win_test.cj`，cjpm.toml 指向同源 `.deps/stdx`。私有模块与共享源逐字节一致（`cmp -s` 确认 windows_process_adapter.cj SAME）。这是对生产源码的红/绿证据，不是隔离夹具。

### 生产修复

`core/src/windows_process_adapter.cj:853-857`（`resolveWindowsExecutable` 内 PATH 循环）：
```cangjie
let candidate = trimmed + "\\" + command + (if (lower.endsWith(".exe")) { "" } else { ".exe" })
// FileInfo(path) 在路径不存在时抛 FException，必须先 exists 再探测，
// 否则 PATH 首个不含该命令的目录就会中断整轮解析。
if (exists(candidate) && FileInfo(candidate).isRegular()) {
    return candidate
}
```
`exists()` 在 core 生产代码已大量使用（`acp_codebuddy_provider.cj`、`acp_opencode_provider.cj`、`agent.cj` 等），API 可用性已确认。

## 真实 Host 入口验证

宿主：`apps/host/target/release/bin/main.exe`（sha256 `e9b8d150...ea7c0`），重打后复制到中性目录 `D:\tmp\sacode-sandbox-fix-20261022\host\bin\sacode-host.exe`（同 sha256，pack-host 92 文件）。原生 DLL：`sacode-windows-process.dll`（sha256 `2bd050d4...c6156`，前序冻结构建）。

环境：`SACODE_WINDOWS_ENFORCING=1`、`SACODE_WINDOWS_PROCESS_DLL=<dll>`、`SACODE_STDX_DLL_DIR`/`SACODE_RUNTIME_DLL_DIR` 前置 PATH、`TMP`/`TEMP` 指向仓内可写目录（本机 `%TEMP%` 拒写宿主）。

### run_code（强制隔离开启）

合成 SSE provider 让模型调 `run_code` 执行 `console.log('RUN_CODE_STDOUT'); require('fs').readFileSync('sum.cjs')`。工具结果（真实分类，非 io-error）：
- `RUN_CODE_STDOUT` 打印成功 → node 解析通过、AppContainer 内真实执行；
- `readFileSync('sum.cjs')` 报 `EPERM: operation not permitted, open '...\project\sum.cjs'`（errno -4048）→ AC SID 无权读工作区文件；
- `[ptc-exit-code:1;timed-out:false;cancelled:false;error:]` → 真实退出码，无 io-error、无 init-failed。

### shell（强制隔离开启）

合成 provider 让模型调 `bash` 执行 `echo SHELL_OK`。agent 走 `runShellCommand("cmd",["/c"],"echo SHELL_OK")` → PowerShell 包装层 → `windowsEnforcingExecute`。工具结果（真实分类，非 SANDBOX_UNAVAILABLE）：
- PowerShell 在 AC 内启动，`$p.StartInfo.WorkingDirectory=[Environment]::CurrentDirectory` → `Exception calling "Start": "The directory name is invalid"`（AC 进程 CurrentDirectory 指向不可访问的工作区）；
- `[shell-exit-code:1;timed-out:false;cancelled:false]` → 真实退出码。

### 默认（强制隔离关闭）仍 fail-closed

不设 `SACODE_WINDOWS_ENFORCING` 时：run_code → `io-error:run_code`（ptc_exec fall-through 到 platformSandbox 抛 SANDBOX_UNAVAILABLE → None）；shell → `SANDBOX_UNAVAILABLE`。未降级裸跑，无回归。

## 未解除边界与后续选项

AppContainer SID 受限，按受限 SID 求交做访问检查：即使工作区 DACL 给 `BUILTIN\Users:(F)`，AC SID 仍被拒；只有 AC SID / ALL APPLICATION PACKAGES / ALL RESTRICTED APPLICATION PACKAGES 的 ACE 有效。仓库根为 Low Mandatory Level（仓内创建 AppContainer profile 失败，中性目录成功）。

要让 shell/run_code 真正读写工作区，两条路（均超出本次最小修复，未授权）：
1. 给每个执行用 AppContainer SID 授予工作区读/执行权限（ACL 变更）；
2. 接入既有 `WindowsPrivateWorkspace` + snapshot 写回胶囊（`execution/*` RPC 已接，模型 shell/run_code 未使用）。

桌面 GUI 默认未设 enforcing 环境变量，仍 fail-closed；要使 GUI 受益需在桌面启动时设 `SACODE_WINDOWS_ENFORCING=1` 并随包提供原生 DLL（打包/配置任务，非代码修复）。

## 证据文件

- 红灯日志：`target/tmp/sandbox-fix-20261022/probe-test-red.log`
- 绿灯日志：`target/tmp/sandbox-fix-20261022/probe-test-green.log`
- Host 构建：`target/tmp/sandbox-fix-20261022/host-build-fix.log`（cjpm build success, RC=0）
- run_code 验证：`target/tmp/sandbox-fix-20261022/run-code-*/verification.json`
- shell 验证：`target/tmp/sandbox-fix-20261022/shell-*/verification.json`
- 既有套件阻塞：`target/tmp/sandbox-fix-20261022/core-test-red.log`（19 errors, redefinition）
