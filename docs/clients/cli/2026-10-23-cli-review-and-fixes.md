# 2026-10-23 CLI 审查缺陷修复与三入口构建钩子重写

- 取证日：2026-10-23
- 平台：Windows x64 本机（工作区未提交）
- 范围：`apps/cli` 内部缺陷 6 项 + 三入口 `build.cj` 构建钩子路径解析
- 结论：源码修复与局部验证通过；**未跑完整四成员 `build-platform.mjs`，未重打候选**。当前交付候选 `0f08a6ce…` 早于本批改动，不含这些修复。

## 1. 修复清单

| # | 级别 | 现象 | 修复 |
|---|---|---|---|
| 1 | 高 | 三份 `build.cj` 的 `stagePostBuild()` 把本机 Windows SDK/stdx 绝对路径写死；`build-platform.mjs` 用 `cjpm build --target-dir` 时钩子找不到本轮产物 bin，DLL 抄到旧布局 | 路径改为「环境变量优先 → 仓库 `.deps` → 旧本机路径兜底」；源目录缺失只 WARN 继续，真实 IO 失败才返回非 0；新增 `SACODE_BUILD_TARGET_DIR`，递归定位本轮 `main.exe` 所在 bin |
| 2 | 中 | 裸 `sacode goal` 不匹配 `args.size > 1` 路由，落进自测 `runGoalTests()`，打印一串 PASS 而非 usage | `main()` 对裸 `goal` 显式路由到 `runGoalCommand`，无子命令按 usage 返回 64 |
| 3 | 中低 | 租约获取失败一律报 `already-owned`、退出码固定；`core` 已区分 `busy` / `owner-unknown` / `io-failed`，但 CLI 丢弃分类 | 新增 `leaseFailureReason/Label/ExitCode`：`busy`、`owner-unknown` → 5，`io-failed` → 8；接入 `seed`/`call`/`goal`/`mode`/`acp` |
| 4 | 中低 | worktree 在 `flush-failed` 时仍释放写租约，下一个写者会接管未结算日志 | 两处 catch 改为 `flush-failed` 时保留租约；`mode set` 在 `isDurableFrozen()` 时同样保留 |
| 5 | 低 | Windows PowerShell 5.1 管道写入原生进程会带 UTF-8 BOM，`"y" \| sacode call write` 被当乱码拒绝 | 新增 `stripUtf8Bom`，只剥开头 `EF BB BF`，正文不动；补两条自测断言 |
| 6 | 低 | `--help` 与错误 usage 两份清单各写一半、`knowledge` 用法走 stdout 且退出码 2、`call edit` 展示三个位置参数（实际收 JSON） | 统一 `printCliUsage(toError)`；`knowledge` 用法改 stderr + 64；`edit` 描述与参数面改为 JSON 契约并注明改既有文件前先 `read` |

## 2. 改动文件

- `apps/cli/src/main.cj`：工具描述、`stripUtf8Bom`、租约 helper、裸 `goal` 路由、`printCliUsage`、`dispatchMode` 仅 `all` 跑 goal 自测、BOM 自测断言。
- `apps/cli/src/goal_runtime.cj`、`apps/cli/src/approval_mode_command.cj`、`apps/cli/src/acp_command.cj`：租约分类与退出码。
- `apps/cli/src/worktree_command.cj`：两处 `flush-failed` 保留租约。
- `apps/cli/src/knowledge_command.cj`：usage → stderr + 64。
- `apps/cli/build.cj`、`apps/host/build.cj`、`apps/daemon/build.cj`：同一份新钩子，三份字节一致。
- `scripts/build-platform.mjs`：向 `cjpm` 子进程传 `SACODE_BUILD_TARGET_DIR`。
- `scripts/build-post-hook.test.mjs`：新增 Windows target-dir 场景（假 runtime/stdx + 假 `main.exe`）。
- `apps/cli/test/acp/acp-cli-settings.test.mjs`：断言从 `/already-owned/` 改为 `/lease-busy/`。

三份钩子 SHA256：

```
4F7547EDCAE4E1ADBAB09F05AA9405067D4B8C20295FB9F40B70CF00327F22CB
```

`node --test scripts/build-post-hook.test.mjs` → 2/2 通过（字节一致 + target-dir 布局）。

## 3. 构建与测试读数

### 3.1 CLI 重建（单成员）

```
cd apps/cli && cjpm build     # cjpm build success, rc=0
```

- `apps/cli/target/release/bin/main.exe`：14,531,072 B，SHA256 `928a33dbe5e04788aee9ce16002059b2aa06ee19ede4ad3dbad41dbadd0cc1cf`，mtime 2026-10-23 19:31:28
- 同目录 DLL：80 个
- 运行前剥离 SDK/stdx PATH（`PATH=C:\Windows;C:\Windows\System32`），入口自足

### 3.2 内置自测

```
main.exe all   → ALL PASS, rc=0
```

含新增两条 BOM 断言：

```
PASS BOM 开头的 y 仍判为放行
PASS BOM 不改变拒绝判定
```

### 3.3 CLI Node 全量

```
node --test apps/cli/test/**/*.test.mjs
# tests 153 / pass 150 / fail 0 / skipped 3
```

跳过 3 条为既有的环境/凭据条件项，非本批新增。

### 3.4 行为实测

| 场景 | 命令/构造 | 实测 |
|---|---|---|
| 裸 goal | `main.exe goal` | stderr usage，rc=64 |
| 裸 knowledge | `main.exe knowledge` | stderr usage，rc=64 |
| `--help` | `main.exe --help` | 列全 goal/team/job/mode/acp/worktree/batch/tips/knowledge/tools/call/--remote，rc=0 |
| 未知入口 | `main.exe nosuch` | 同一份 usage 到 stderr，rc=64 |
| 租约 io-failed | 把 `session.log.lease` 建成目录 | `call`/`mode`/`goal` 均 `lease-io-failed`，rc=8 |
| 租约 owner-unknown | lease 文件写 `garbage-without-writer-pid` | `lease-owner-unknown`，rc=5 |
| 租约 busy | lease 写活进程 token `writer=<pid>-probe.tmp` | `lease-busy`，rc=5 |
| ACP 租约 | 同上 busy 构造 + `acp probe` / `acp enable 0` | `ACP：lease-busy`，rc=1，租约文件保留 |
| PowerShell 5.1 管道 | `"y" \| main.exe call write bom.txt hello` | `approval state used`、`call write ok ran`，rc=0，文件内容 `hello` |

### 3.5 构建钩子单独实测

用 `cjc` 单独编译 `apps/cli/build.cj`（rc=0，仅 2 个既有警告），再以假 runtime/stdx 目录跑 `post-build`：

- 旧布局（不传 `SACODE_BUILD_TARGET_DIR`）：cwd `target/release/bin` 得到 78 个 DLL；
- 显式 target-dir：DLL 抄到 `<target-dir>/release/bin`（`main.exe` 同级），且不再创建旧布局目录。

`node --check scripts/build-platform.mjs` rc=0。

## 4. 未覆盖边界

1. **未跑完整 `node scripts/build-platform.mjs`**：core/CLI/Host/daemon 四成员串行构建与 CI 路径尚无本轮实跑读数；只验证了单成员 CLI 构建与钩子单元测试。
2. **`worktree flush-failed` 保留租约仅代码口径修改**：未构造真实落盘失败复现（需让 `flush` 在写盘阶段失败），无运行读数。
3. **候选未重打**：`0f08a6ce…` CLI 早于本批改动；要让交付包带上这些修复必须重打，本批未获授权，未执行。
4. **Windows CI 流水线**：`.github/workflows/build.yml` 仍无实际运行读数。
5. `acp probe` 在本机输出 `probe-failed-unknown`（未安装 opencode 可执行），属既有环境事实，与本批租约改动无关。

## 5. 环境说明（避免把环境问题当产品失败）

本机在 `C:\Users\jingg\AppData\Local\Temp\opencode` 下运行 CLI 自测会出现 5 条写入被拒的假红（完整性标签限制）。本批所有运行都把 `TEMP`/`TMP` 指向 `D:\Project\sa\saai\sa-code\target\tmp\...`，不使用该目录的读数。

## 6. 复现命令

```powershell
# 构建（前置 SDK/stdx DLL 目录到 PATH）
$env:SACODE_STDX_DLL_DIR="C:\Users\jingg\stdx-work\stdx-1.1.3.1\windows_x86_64_cjnative\dynamic\stdx"
$env:SACODE_RUNTIME_DLL_DIR="D:\Program Files\HuaWei\Cangjie\runtime\lib\windows_x86_64_cjnative"
$env:CANGJIE_HOME="D:\Program Files\HuaWei\Cangjie"
$env:PATH="$env:SACODE_STDX_DLL_DIR;$env:SACODE_RUNTIME_DLL_DIR;$env:CANGJIE_HOME\tools\bin;$env:PATH"
cd apps/cli; cjpm build

# 自测
$env:PATH="C:\Windows;C:\Windows\System32"
main.exe all

# 钩子测试
$env:PATH="$env:CANGJIE_HOME\bin;$env:CANGJIE_HOME\tools\bin;$env:CANGJIE_HOME\runtime\lib\windows_x86_64_cjnative;$env:PATH"
node --test scripts/build-post-hook.test.mjs
```

未提交、未推送、未安装、未发布。
