# AppContainer 内 PowerShell exit 1 / 空输出根因诊断（2026-10-20）

## 1. 结论（先给答案）

**根因不在 PowerShell，也不在 ACL。** 在本机（Windows 11 26H2，build 26300.0）当前状态下，**AppContainer 子进程在初始化阶段就失败**：`cmd.exe`、`powershell.exe`、`hostname.exe`、`whoami.exe`，乃至一个静态 CRT、直接 `return 0` 的最小 exe，放进 AppContainer 自己的 `AC` 目录运行，全部 **exit 1、stdout/stderr 为空**。普通进程（不绑 AppContainer）用同一套管道/环境可正常 `exit 0` 并输出。

因此用户列出的 5 个方向（`-NoProfile`、stdout/stderr 句柄、`[Console]::OutputEncoding`、`PSModulePath`、exit 1 阶段）**都不是本次根因**；失败发生在任何 PowerShell 脚本执行之前。

另一条决定性证据：项目原有的 `scripts/verify-windows-process.c`（2026-10-17 记录为 35 项全过）在本机重编译后 **`FAIL real-exit-code`**（进程创建、token 校验、resume 都过，只有真实退出码不是 0）。说明这是 **OS/AppContainer 层回归或机器状态变化**，不是本轮模型 shell 代码或 PowerShell 参数问题。

## 2. 探针矩阵（全部真实运行）

探针源码/产物：`D:/tmp/shell-exec-fix-20261020/`（`shell-appcontainer-probe.c`、`direct-appcontainer-probe.c`、`minimal.c` 及对应 exe）。AppContainer 侧统一使用原生薄层同款 `CreateAppContainerProfile` + `SECURITY_CAPABILITIES` + 三管道 + `STARTF_USESTDHANDLES` + `CREATE_SUSPENDED/ResumeThread`。

| 探针 | 运行位置 | 结果 |
| --- | --- | --- |
| `cmd.exe /d /s /c "echo APP_CMD_OK& echo APP_CMD_ERR 1>&2"` | AppContainer，min env，cwd=System32 | exit 1，stdout/stderr 空 |
| `cmd.exe /d /c "echo APP_CMD_OK..."`（无 `/s`） | AppContainer | exit 1，空 |
| `cmd.exe /d /s /c "exit 0"` | AppContainer | exit 1，空 |
| `powershell.exe -NoLogo -NoProfile -NonInteractive -Command "exit 0"` | AppContainer | exit 1，空 |
| `powershell.exe ... -Command "Write-Output APP_PS_OK"` | AppContainer | exit 1，空 |
| `hostname.exe`、`whoami.exe` | AppContainer | exit 1，空 |
| `minimal.exe`（静态 CRT，`int main(void){return 0;}`） | AppContainer 自己的 `AC` 目录 | exit 1，空 |
| 同一 `cmd /d /c "echo DIRECT_OK"` | 普通进程（无 AppContainer 属性），同管道/环境 | **exit 0，stdout=`DIRECT_OK`** |
| `scripts/verify-windows-process.c` 原程序 | 本机重编译运行 | **`FAIL real-exit-code`**（create/token/resume 均 PASS） |

## 3. Token 取证

对 AppContainer 子进程 `OpenProcessToken` 读取：

- `TokenIsAppContainer = 1`
- `TokenIntegrityLevel = 4096`（Low）
- `TokenIsRestricted = 0`
- `TokenCapabilities = 0`（`caps=0`）
- `TokenAppContainerSid = S-1-15-2-<随机>`
- `TokenGroups` 含 `BUILTIN\Users`、`Everyone`、`Authenticated Users` 等，但**不含 `S-1-15-2-1`（ALL APPLICATION PACKAGES）**，也不含 `S-1-15-2-2`。

这是 **LPAC（Less Privileged AppContainer）形态的 token**：没有包权威组，也没有任何 capability。`C:\Windows\System32` 的 ACL 只给 `ALL APPLICATION PACKAGES` / `ALL RESTRICTED APPLICATION PACKAGES` 授予读+执行，因此该 token 读不到 System32 依赖，子进程在加载器初始化阶段失败（exit 1、无输出）。

profile 本身创建/删除正常（`Microsoft-Windows-AppModel-Runtime/Admin` 事件 39/41，无错误）；`AC` 子目录已正确授予 profile SID 全控，所以不是 profile 装配或目录 ACL 问题。

## 4. 环境时间线

- OS：`Microsoft Windows NT 10.0.26300.0`，DisplayVersion `26H2`。
- 最近更新：KB5127648 / KB5121794（2026-10-15）、KB5127647（2026-10-13）。
- `2026-10-17` 证据记录同一原生验证程序 35 项全过；本轮（2026-10-20）同程序在 `real-exit-code` 失败。
- 因此更可能是 **26H2 构建/机器状态变化导致 AppContainer 进程无法完成初始化**，而非 10-17 之后的产品代码变化（本轮之前模型 shell 从未真正执行，无法据此判断更早是否可用）。

## 5. 五个方向的裁决

| 方向 | 裁决 | 依据 |
| --- | --- | --- |
| #1 `-NoProfile` 是否加了 | **不是根因** | `runShellCommand` 已固定传 `-NoLogo -NoProfile -NonInteractive -EncodedCommand`；且 `cmd.exe`/`hostname.exe`/最小 exe 同样失败，与 profile 无关 |
| #2 stdout/stderr 句柄继承 | **不是根因** | 原生薄层给子进程的是 `child_stdout`/`child_stderr`（写端），方向正确；普通进程同管道可正常输出；AppContainer 去掉 `STARTF_USESTDHANDLES` 仍失败 |
| #3 `[Console]::OutputEncoding` | **不是根因** | 失败发生在 PowerShell 启动之前；`cmd`/`hostname` 不执行该行也失败 |
| #4 `PSModulePath` 不可达 | **不是根因** | 同上，尚未进入 PowerShell 脚本阶段 |
| #5 exit 1 的具体阶段 | **定位到 AppContainer 进程初始化** | `cmd /c exit 0`、`hostname.exe`、最小静态 exe 全部 exit 1；普通进程同条件 exit 0 |

## 6. 无 ACL 修复候选（已试，未成功，未改产品代码）

目标是让 AppContainer token 变成**普通 AppContainer**（带 `ALL APPLICATION PACKAGES` 包权威），而不是 LPAC。已在探针中实测：

- `SECURITY_CAPABILITIES` 加 `internetClient`（`S-1-15-3-1`）：token `caps=1`，但仍无 `S-1-15-2-1`，子进程仍 exit 1。
- profile 创建时授予 `internetClient`：同样 `caps=1`、仍 exit 1。
- `S-1-15-2-1` 直接作为 capability：`CreateProcessW` / `CreateAppContainerToken` 均返回 `ERROR_INVALID_PARAMETER (87)`，不能这样注入。
- `CreateAppContainerToken` + `CreateProcessAsUser`：`caps=0`，仍 exit 1。

结论：**这是一条需要改原生层 token 构造的产品修复**（例如使用带包身份的 profile、或找到 26H2 下构造普通 AppContainer 的正确 capability 组合），不是"加 `-NoProfile`"这类 shell 参数修复，也不是 ACL 修复。按本轮边界（只碰诊断探针、不改产品源码、不碰 ACL），**未实施产品修复**。

## 7. 边界与未做

- 未改 ACL、未关沙箱、未改 `core/src/agent.cj`、未碰 renderer、未碰其他方测试、未提交/推送。
- 未修改 `core/native/windows_process.c` 或任何产品源码；只新增 `D:/tmp/...` 下的诊断探针与本文档。
- 临时 AppContainer profile 已用 `DeleteAppContainerProfile` 清理（仅 `sacode.directprobe.*`；产品历史 `sacode.owned.*` 未动）。
- 未验证：普通 AppContainer token 在 26H2 下的正确构造方式；这需要单独授权后改原生层并重跑 `verify-windows-process.c` 与模型 shell 端到端。

## 8. 复现命令（节选）

```bash
# 原始验证程序（本机重编译）
clang -std=c11 -O2 -Wall -Wextra -Werror -fms-runtime-lib=static \
  scripts/verify-windows-process.c .deps/native/win32-x64/sacode-windows-process.lib \
  -o D:/tmp/shell-exec-fix-20261020/probe/verify.exe -luserenv -ladvapi32
D:/tmp/shell-exec-fix-20261020/probe/verify.exe   # -> FAIL real-exit-code

# 直接 CreateProcessW 矩阵（普通进程 vs AppContainer）
D:/tmp/shell-exec-fix-20261020/probe/direct-appcontainer-probe.exe no-attributes  # exit 0 + DIRECT_OK
D:/tmp/shell-exec-fix-20261020/probe/direct-appcontainer-probe.exe pipes          # exit 1 + 空
```

## 9. 下一步建议

1. 在原生层验证"普通 AppContainer token"的构造（`CreateAppContainerToken` 或带包身份/正确 capability 的 profile），先用 `verify-windows-process.c` 恢复 `real-exit-code`。
2. 原生层恢复后再跑模型 shell 端到端；当前不应把 `shell-pwsh` 的失败归因到 PowerShell 参数或工作区 ACL。
3. 若短期无法修复原生层，应在产品侧显式区分"AppContainer 不可用/初始化失败"与"命令执行失败"，避免继续以 `shell-exit-code:1` 的形式吞掉环境级故障。
