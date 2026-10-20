# 模型 shell `io-error:shell-pwsh` 诊断折叠修复与 Windows 强制隔离接线（2026-10-20）

## 1. 本轮结论（先说不成立的）

- **已闭合**：`ShellExecutor` 把 `confine` 异常折叠成 `None`、上层只剩泛化 `io-error:shell-pwsh` 的**诊断缺陷**已修。真实 Host 回执从 `{"error":"io-error:shell-pwsh"}` 变为 `{"error":"io-error:shell-pwsh:SANDBOX_UNAVAILABLE"}`，失败可归因。
- **已确认**：根因是 Windows 默认 `platformSandbox` 无 provider，`confine` 抛 `SANDBOX_UNAVAILABLE`；不是更深层异常，也不是 pwsh 可执行文件缺失。
- **已接线**：既有 Windows 私有执行通路（AppContainer 原生薄层）已接入模型 shell，仅在显式选择加入（`SACODE_WINDOWS_ENFORCING` + `SACODE_WINDOWS_PROCESS_DLL`）时启用；未启用时维持 fail-closed，不降级裸运行，未改 ACL、未关沙箱。
- **未走通，不冒充**：AppContainer 内 PowerShell 目前以退出码 1、空 stdout/stderr 结束，`node --test` 未能取得通过结算。既有证据 `2026-10-17-windows-owned-process-provider.md` line 50 明确 AppContainer 的「私有 ACL 与撤销、文件/网络反向测试」尚未完成、`platformExecutionReady` 仍拒绝 Windows 产品执行；本轮用户明确禁止 ACL 调整，故不越界。**当前约束下可达成的是「命令真实启动 + 真实退出码 + 失败可归因 + 沙箱不降级」，不是「测试通过」。**

## 2. 缺陷链与真实 Host 取证

现状（修复前）：

1. `core/src/agent.cj` 的 `ToolRuntime` 以 `platformSandbox(workingDirectory)` 构造 `ShellExecutor`（默认参数）。
2. `core/src/platform_sandbox.cj` 非 Linux 分支返回空 `SandboxRuntime()`，`backendAvailable=false`、无 provider。
3. `core/src/sandbox.cj` `SandboxRuntime.confine` 在 `!backendAvailable || provider.isNone()` 时抛 `SANDBOX_UNAVAILABLE`。
4. `core/src/shlex.cj` `ShellExecutor.run` 的 `catch (e: Exception) { return None }` 把真实异常吞掉。
5. `core/src/agent.cj` 对 `None` 只产出 `io-error:shell-<tool>`（无原因）。

真实 Host（Run A，默认不启用强制隔离）的 `dev-test` 工具回执：

```json
{"error":"io-error:shell-pwsh:SANDBOX_UNAVAILABLE"}
```

该回执同时证明两件事：`confine` 抛的确实是 `SANDBOX_UNAVAILABLE`；修复后原因已透传。

## 3. 修复 1：诊断折叠（独立缺陷，不改执行行为）

文件：`core/src/shlex.cj`

- 新增 `sanitizeSandboxError(message)`：只放行固定枚举串 `SANDBOX_UNAVAILABLE` / `SANDBOX_MODE_NOT_CONFINED` / `SANDBOX_UNSAFE_WORKSPACE` / `SANDBOX_UNAVAILABLE:*`，其他一律归为 `sandbox-confine-failed`。**不携带工作区路径、密钥或底层实现细节（metadataOnly）。**
- `ShellExecutor.run` 的 confine `catch` 由 `return None` 改为返回带真实原因的 `ShellResult`（`exitObserved=false`），不再吞异常。
- 上层 `agent.cj` 原有分支（`r.error.size > 0` → `io-error:shell-<tool>:<reason>`）自然承接，**未修改 `core/src/agent.cj`**。
- 行为约束：命令仍未执行，"执行未成功"这一事实不变；只改变可归因性。

## 4. 修复 2：Windows 强制隔离接线（保持沙箱语义）

文件：`core/src/windows_process_adapter.cj`、`core/src/shlex.cj`

- 新增 `resolveWindowsExecutable(command)`：模型 shell 传入的是相对名（`powershell` / `powershell.exe` / `cmd`），原生 `sacode_windows_process_create` 要求绝对程序路径，故解析为 `%SystemRoot%\System32\...` 或 PATH 命中项。
- 新增 `windowsEnforcingExecute(...)`：复用既有 AppContainer 薄层（`WindowsProcessLibrary`、`WindowsOwnedProfile`、`acProbeEnvironment`、`collectWindowsProcess`），按命令装配 library/profile/environment 并启动；进程句柄在 `finally` 中 stop+close，随后显式回收 profile/library。启动失败返回携带固定枚举原因的 `ShellResult`（如 `windows-enforcing-failed:<msg>`），不抛给上层泛化 `io-error`。
- `core/src/shlex.cj` `ShellExecutor.run`：仅当 `shellWindows` 且 `windowsExecutionEnforcingAvailable(dir)` 为真时走 AppContainer；否则维持原 confine 路径（即 Windows 默认 fail-closed）。非 confined 模式仍返回 `SANDBOX_MODE_NOT_CONFINED`。
- 沙箱语义：AppContainer 是**更强**的隔离（受限令牌 + Job 树终止 + 三句柄继承名单 + 双重流限额），不是关闭或降级；未改 ACL、未改完整性标签、未新增裸运行回退。

## 5. 构建与产物

构建入口（遵循 issue #725：前置 DLL PATH，单成员构建）：

```bash
export SACODE_STDX_DLL_DIR="/c/Users/jingg/stdx-work/stdx-1.1.3.1/windows_x86_64_cjnative/dynamic/stdx"
export SACODE_RUNTIME_DLL_DIR="/d/Program Files/HuaWei/Cangjie/runtime/lib/windows_x86_64_cjnative"
export PATH="$SACODE_STDX_DLL_DIR:$SACODE_RUNTIME_DLL_DIR:/d/Program Files/HuaWei/Cangjie/tools/bin:$PATH"
cd apps/host && cjpm build
```

- 编译：**成功**，4 条 unused 警告、0 error。
- post-build：`copyIfDll failed ... libboundscheck.dll`。该文件在 `target/release/bin` 已存在且同尺寸（44032），属重复复制失败，**不影响产物**；bin 内 83 个 DLL 齐全。
- 产物：`apps/host/target/release/bin/main.exe`，13,187,584 bytes，2026-10-20 00:03:44，SHA256 `6909a197cc510fbc174414363bc2ed60d2c714952c8289ea3872a8e4e3dc2935`。
- 干净 PATH 启动（`PATH=/c/Windows:/c/Windows/System32`）：输出 `{"jsonrpc":"2.0","method":"host/settled",...}` 并 0 退出，无 `0xC0000135`。
- 原生薄层：`.deps/native/win32-x64/sacode-windows-process.dll`，151,040 bytes，SHA256 `ab5ac065c9ae2bb7516867a046e77a7e7a36d3db11be234a07b496eca4969c2e`。
- 中性导出：`D:/tmp/sa-code-host-shellfix-20261020/bin/`（85 文件）。原因：仓库根带 Low Mandatory Level 标签，宿主继承 Low 后写 Medium 目录被 MIC no-write-up 拦下，租约文件无法建立而报 `-32001 already-owned`；这是既有环境约束，不是本次代码缺陷。

## 6. 端到端复验

测试入口：`apps/host/test/session/development-task.test.mjs`（SaCode 自有 Host 测试；文件当前未入库）。新增第二条用例"拒绝写入后文件保持不变"。

| 场景 | 结果 | 关键读数 |
| --- | --- | --- |
| Run A 默认（未启用强制隔离） | **2/2 通过，rc=0** | `dev-test={"error":"io-error:shell-pwsh:SANDBOX_UNAVAILABLE"}`；`sum.cjs` 已改为 after；`approvals=['edit','pwsh']`；`requests=4`；`stopped={code:0,forced:false}`；`text=文件已修改；安全执行后端不可用，测试未运行。` |
| Run B 强制隔离（`SACODE_WINDOWS_ENFORCING=1` + 原生 DLL） | **2/2 通过，rc=0** | `dev-test={"error":"\n\n[shell-exit-code:1;timed-out:false;cancelled:false]"}`（真实启动、真实退出码，非折叠 io-error）；`approvals=['edit','pwsh']`；`requests=4`；`stopped={code:0,forced:false}`；`text=文件已修改；测试命令未成功执行，未取得通过结算。` |
| 拒绝用例（A/B 均跑） | **通过** | `approvals=['edit']`；`requests=3`（无重试绕过）；`sum.cjs` 保持 before；`text=文件修改未成功执行，测试未运行。{"error":"approval-not-granted:denied"}`；`stopped={code:0,forced:false}` |
| 最小探针（enforcing，`Write-Output sacode-enforcing-ok`） | 命令启动但未产出 | `{"error":"\n\n[shell-exit-code:1;timed-out:false;cancelled:false]"}`；普通管道下同一脚本 exit 0 正常输出，排除编码问题 |

复验命令：

```bash
# Run A
SACODE_HOST=D:/tmp/sa-code-host-shellfix-20261020/bin/main.exe \
SACODE_TEST_ROOT=D:/tmp/shell-exec-fix-20261020/runs-default \
node --test apps/host/test/session/development-task.test.mjs

# Run B
SACODE_HOST=D:/tmp/sa-code-host-shellfix-20261020/bin/main.exe \
SACODE_TEST_ROOT=D:/tmp/shell-exec-fix-20261020/runs-enforcing \
SACODE_WINDOWS_ENFORCING=1 \
SACODE_WINDOWS_PROCESS_DLL=D:/tmp/sa-code-host-shellfix-20261020/bin/sacode-windows-process.dll \
node --test apps/host/test/session/development-task.test.mjs
```

原始产物：

- `D:/tmp/shell-exec-fix-20261020/run-default.log`、`run-enforcing.log`
- `D:/tmp/shell-exec-fix-20261020/runs-default/*/verification.json`
- `D:/tmp/shell-exec-fix-20261020/runs-enforcing/*/verification.json`
- 构建日志 `D:/Project/sa/saai/sa-code/target/tmp/shell-exec-fix-20261020/build.log`

## 7. 已知限制（未闭合，不冒充）

1. **AppContainer 内 PowerShell 未完成**：退出码 1、stdout/stderr 为空。普通环境下同一 `-EncodedCommand` 脚本正常，说明不是编码缺陷；指向 AppContainer 的运行环境（`acProbeEnvironment` 只注入 `LOCALAPPDATA`/`SystemRoot`）与私有 ACL 尚未支撑 PowerShell 完整启动。
2. **工作区访问**：AppContainer 默认无权读写用户工作区，`node --test sum.test.cjs` 即使 PowerShell 正常也无法读到文件。这需要「私有 ACL 与撤销」，是 `2026-10-17-windows-owned-process-provider.md` 明确记录的未来工作；本轮用户禁止 ACL 调整。
3. **取消路径**：本轮复验了允许与拒绝；进程级取消/超时由既有 `cancel`/`execution_supervisor`/`collectWindowsProcess` 覆盖，但未在本次 `development-task` 用例中单独重跑取消分支。
4. 不声称「读取→审批→修改→运行测试→通过结算」已走通；不声称 Windows 默认（未启用强制隔离）下 pwsh 可执行。

## 8. 改动边界

- 修改：`core/src/shlex.cj`（+34/-5）、`core/src/windows_process_adapter.cj`（+94）。
- 测试：`apps/host/test/session/development-task.test.mjs`（未跟踪文件，新增强制隔离分支与拒绝用例）。
- 未触碰：`renderer`、`core/src/agent.cj`（工作树中该文件 10 行改动属其他会话，未覆盖）、opencode 测试文件。
- 未执行：提交、推送、安装、发布。
- 候选身份：以 `main.exe` SHA256 `6909a197...` 为准；工作树含他人未提交改动，候选不是纯净 HEAD。
