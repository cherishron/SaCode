# 2026-10-22 Linux 构建钩子与 daemon 单宿主修复（TDD：先红后绿）

## 结论

两个阻断 Linux 完整交付的阻塞已修复，均走「先写红测 → 看红 → 最小实现 → 复跑绿」：

1. **构建阻塞**：三入口 `build.cj` 的 `stagePostBuild()` 无条件使用 Windows SDK/stdx 绝对路径，非 Windows 上链接完成后钩子退出 1，`cjpm build` 整体失败。改为按平台分流后，Linux 完整构建 4/4 成功。
2. **daemon 阻塞**：daemon 同时启动两个持久 Host，每个宿主一条阻塞 `readln()` 抽干线程，在 2 vCPU 上饿死 HTTP 处理器，`session/create` 已写出应答也不返回。改为**单宿主共享**（代理与团队面复用同一进程）后，同一用例由 25 s 超时变 150 ms 通过，真实 Host 上会话与团队链路在同一进程内通过。

本批只改 daemon 源码与三份构建钩子，未改 Host/core 业务实现。Windows 本地 e2e 受既有 `%TEMP%`/完整性标签环境限制，不作为证据；下列读数全部来自远端 Linux 实跑。

## 环境与源码身份

| 项 | 值 |
|---|---|
| 远端 | Ubuntu，`Linux VM-0-10-ubuntu 6.8.0-138-generic #138-Ubuntu SMP PREEMPT_DYNAMIC`，x86_64 |
| 工具链 | cjc/cjpm 1.1.3（`~/cangjie-1.1.3`），stdx 1.1.3.1（`linux_x86_64_cjnative/dynamic/stdx`） |
| 工作副本 | `~/sa-code-linux`（无 `.git`，源码与本机工作区逐文件 md5 一致） |
| 构建入口 | `node scripts/build-platform.mjs`（core + cli/host/daemon，各用独立 target 目录） |
| 载荷 | `target/tmp/linux-run-20261022-r2/runtime-payload/bin`：3 个可执行文件 + 91 个 `.so`，共 94 文件 |

本批 8 个文件在远端与本地 md5 全等；产物时间晚于源码（源码 13:49，二进制 13:51–13:53，载荷 13:54），载荷确为本批最终代码构建：

```
e722bafe6dbdb58b2312015746521610 scripts/build-post-hook.test.mjs
dba7b4937863c3b3cee9fd5bc66710b413770a620640581af9df660d1617e3fd apps/{cli,host,daemon}/build.cj（三份字节一致）
a82c756e67966733b7a81b92fced11a22b702630a0ef7c7ba9ca60ff9ec2b60d apps/daemon/src/host_proxy.cj
afe8dae2b10e9a090fa59b8ca40698f46a8aa3670d8f6f1b9bfbdc9a93a0e946 apps/daemon/src/team_host_bridge.cj
375e319625b8e04f89ea6f6c41a0fc2f69aae29765304868f7fac8ee3d2cba49 apps/daemon/src/daemon.cj
7fb30df40256c5baec4d3f902a7775c2ca06b3273065975a69879c585ccba41a apps/daemon/test/host-proxy.test.mjs
```

## 阻塞一：非 Windows 平台 post-build 失败

### 红

旧钩子先 `File.readFrom("C:/Users/jingg/…")` 再复制 DLL；Linux 上路径不存在，`post-build` rc=1，cjpm 整体失败，stderr 形如：

```
copyIfDll failed for D:/Program Files/HuaWei/Cangjie/runtime/lib/windows_x86_64_cjnative: The input path ... does not exist
```

### 修复

三份 `build.cj` 同批加入平台分流（文件保持字节一致）：

```cangjie
@When[os == "Windows"]
func needsDllStaging(): Bool { return true }

@When[os != "Windows"]
func needsDllStaging(): Bool { return false }

func stagePostBuild(): Int64 {
  if (!needsDllStaging()) {
    println("[build.cj] skip: runtime DLL staging is Windows-only")
    return 0
  }
  ...
}
```

### 绿

新测 `scripts/build-post-hook.test.mjs`：三条 `build.cj` 必须字节一致；用 `cjc` 编译钩子后在子目录实跑 `post-build`，要求 rc=0 且不含 `copyIfDll failed`。远端实跑：

```
ok 1 - 三个入口的 build.cj 保持字节一致
ok 2 - post-build 在不适用的平台上不因硬编码 SDK 路径失败
# tests 2  pass 2  fail 0  duration_ms 951.0
```

完整构建日志 `target/tmp/platform-build-r2.log`：`cjpm build success` ×4，三个产物与载荷均生成。

## 阻塞二：daemon 双宿主饿死 HTTP 分发

### 根因

旧实现中 `HostProxyBridge` 与 `TeamHostBridge` 各起一个持久 Host，读线程都阻塞在 `readln()`。仓颉轻量线程 M:N 调度到原生线程，阻塞外部调用占住原生线程；2 vCPU 下两条宿主读线程把调度槽吃满，HTTP 分发线程拿不到执行机会。现象：Host 已写出应答、daemon 读线程已读到，但 `/rpc` 不返回，同连接后续请求全部挂住。

### 修复（只在 daemon 层）

- `host_proxy.cj`：新增 `HostProxy.abort()`（异常启动的回滚收束）与 `HostProxyBridge.ensureInitialized()`（一次性启动 + `initialize` 握手并缓存能力；缺 `capabilities` 视为空表）、`requestTeam()`（团队方法复用同一进程/写锁/应答表）。
- `team_host_bridge.cj`：退化为适配器，只做团队能力过滤、在途上限 16 与团队错误措辞，不再持有进程。
- `daemon.cj`：构造顺序改为先代理后团队桥；`initialize` 只容忍 `team-host-capability-unavailable`（宿主能握手但未声明团队能力），其他握手失败仍传播；shutdown 只走代理。

### 红 → 绿

新增用例 `initialize 与转发共用同一个宿主进程`（`apps/daemon/test/host-proxy.test.mjs`）：夹具把自身 PID 追加到 `宿主进程.txt`，先 `initialize` 再 `worktree/describe`，断言文件里只有一个 PID。

修复前（旧双宿主）实跑一行：

```
not ok 1 - initialize 与转发共用同一个宿主进程
  duration_ms: 25010.229995
  error: 'daemon 超时：'
```

修复后单跑同一用例：

```
ok 1 - initialize 与转发共用同一个宿主进程
  duration_ms: 150.358615
# tests 1  pass 1  fail 0
```

## Linux 回归读数

| 面 | 命令要点 | 读数 | 说明 |
|---|---|---|---|
| 构建钩子 | `node --test scripts/build-post-hook.test.mjs` | 2/2 通过 | 含三份 build.cj 字节一致断言 |
| 完整构建 | `node scripts/build-platform.mjs` | `cjpm build success` ×4 | core/cli/host/daemon 全部成功 |
| 代理面 | `SACODE_DAEMON=<载荷>/sacode-daemon node --test apps/daemon/test/host-proxy.test.mjs` | **11/13** | 余 2 条为 HEAD 既有陈旧用例，见下表 |
| 团队面 | `SACODE_HOST=<载荷>/sacode-host SACODE_CLI=<载荷>/sacode node --test apps/daemon/test/team-host.test.mjs` | **3/9** | 6 条失败均为既有/环境/宿主独立缺陷，见下表 |
| 三入口 | `target/tmp/entry-smoke.mjs`（PATH 仅系统目录 + 载荷 `LD_LIBRARY_PATH`） | **3/3** | CLI `--help` rc=0；Host `initialize` caps=222 且空行退出 rc=0；daemon HTTP `initialize` caps=214、`daemon/shutdown` 后 rc=0 |

### 未通过项逐条归因（均非本批引入）

| 用例 | 失败 | 归因与证据 |
|---|---|---|
| host-proxy #4 白名单外一律 -32601 | 期望 -32601，实际 -32600 `method-name-invalid` | `apps/daemon/src/remote_schema.cj:22` 的请求结构门禁来自 HEAD 提交 `f8487f7`（2026-10-13）；测试用的 `任意/执行` 含非法字符，用例早于该校验 |
| host-proxy #8 未配置宿主 fail-closed | 断言 cwd 为空，实际含 `协议夹具.cjs` | 夹具由 `runningDaemon()` 自己写入同一 cwd，断言自相矛盾；HEAD 测试文件同样如此 |
| team #1 会话/团队共享写租约 | `session/flush` 返回 -32004 `no-pending-writes` | HEAD `apps/host/src/main.cj:2050` 要求先持写租约；Host 既有语义，与共享宿主无关 |
| team #2/#3/#4 握手/退出/回压 | 夹具 `target/team-handshake-probe/target/release/bin/main.exe` 不存在（Linux `ls` 报 No such file） | 夹具路径写死 Windows `.exe`，Linux 无此构建产物 |
| team #7 未配置宿主能力表 | 期望 `['initialize','session/catalog']`，实际多 `session/events` | HEAD `apps/daemon/src/daemon.cj:48` 的 `INIT_CAPS` 早已含 `session/events`，用例未同步 |
| team #8 SSE 成员审批 | 成员 workspace 报 `team-workspace-query-failed:git-process-failed:-1:` | 用载荷 Host **直连**（不经 daemon）在真实 git 仓库上复现：`workspace/git-status` 同样返回 `git-process-failed`，见下节 |

### team #8 的独立归因探针

`target/tmp/git-probe.mjs`（远端）直接 spawn 载荷 Host，在 `/tmp` 新建 git 仓库并提交，随后依次 `initialize → session/create → session/select → workspace/set-directory → workspace/git-status`：

```
initialize: {"caps":222}
session/create: {"id":"sessions/session-tmpFile8S71iI-0","saved":true}
session/select: {"id":"sessions/session-tmpFile8S71iI-0","selected":true,"saved":true,"theme":"system"}
workspace/set-directory: {"directory":"/tmp/sacode-git-probe-md1kjt","configured":true,"available":true,"saved":true,"changed":true}
workspace/get: {"sessionId":"sessions/session-tmpFile8S71iI-0","revision":1,"directory":"/tmp/sacode-git-probe-md1kjt","configured":true,"available":true,"scope":"session"}
git-status: {"failure":"git-process-failed","exitCode":-1,"diagnostic":"","outputHead":""}
```

对照：同一台机器上最小仓颉程序 `launch("git", ["--version"])` 与绝对路径版均成功（`bare:0:git version 2.43.0` / `abs:0:git version 2.43.0`）。因此 `git-process-failed` 是**宿主进程内**的独立缺陷（异常消息为空），发生在 `core/src/git_workbench.cj:62` 的 catch 分支，与本批 daemon 改动无调用关系；本批不改 core/Host，登记为待办。

## Windows 本地边界

本机 Windows 跑同一 host-proxy 面时 12/13 红，错误集中在夹具子进程写文件被拒（仓内 TMP 报 `EPERM lstat 'D:\'`，系统 `%TEMP%` 报 `EPERM open ...宿主进程.txt`），而测试进程直接 spawn 同一夹具正常。该现象与项目已登记的「`%TEMP%` 拒写宿主与 Electron / 仓库根完整性标签」环境限制一致，不是本批代码缺陷；本批未以其作为通过或失败证据。daemon 源码中亦未见对子进程施加受限令牌/AppContainer 的逻辑（仅远程能力探针与 token 认证相关代码）。Windows 上用新代码构建/实跑 daemon 未验证。

## 未覆盖与边界

- 未提交、未推送、未安装、未发布。
- 未改 Host/core 生产源码；未改 `.deps`、dist、旧候选、SDK/ACL/安全策略。
- team #2/#3/#4 的握手/退出/回压用例只在 Windows 夹具存在时有意义，本批未在 Windows 复跑。
- team #8 所属的宿主 git workspace 缺陷单独登记，不在本批修复范围。
- 载荷与日志均在远端 `target/tmp/`，未入库。

## 复现命令

```bash
# 远端（~/.bashrc 或 envsetup.sh 提供 cjc/cjpm）
cd ~/sa-code-linux
source ~/cangjie-1.1.3/cangjie/envsetup.sh
node scripts/build-platform.mjs

export LD_LIBRARY_PATH="$PWD/target/tmp/linux-run-20261022-r2/runtime-payload/bin:${LD_LIBRARY_PATH:-}"
node --test scripts/build-post-hook.test.mjs
SACODE_DAEMON="$PWD/target/tmp/linux-run-20261022-r2/runtime-payload/bin/sacode-daemon" \
  node --test apps/daemon/test/host-proxy.test.mjs
SACODE_DAEMON="$PWD/target/tmp/linux-run-20261022-r2/runtime-payload/bin/sacode-daemon" \
SACODE_HOST="$PWD/target/tmp/linux-run-20261022-r2/runtime-payload/bin/sacode-host" \
SACODE_CLI="$PWD/target/tmp/linux-run-20261022-r2/runtime-payload/bin/sacode" \
  node --test apps/daemon/test/team-host.test.mjs
node target/tmp/entry-smoke.mjs "$PWD/target/tmp/linux-run-20261022-r2/runtime-payload"
```
