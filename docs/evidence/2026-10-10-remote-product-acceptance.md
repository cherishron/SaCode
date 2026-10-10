# 统一远程接入与移动工作台 交付验收（任务 11）

取证时间：2026-10-10 06:18Z（本机 14:18，Windows 10.0.26300 / x86_64）
执行器：`scripts/verify-remote-product.mjs`（本文件的每一条读数都由它或它点名的命令实跑得出，不誊抄计划、不写百分比、不写日期承诺）
两次运行：
 * `dff2c8487286b6118c5493d4392c747c2e64c276`——第一次跑，副本里抓出一条 IPC 桥面假红，随后定位为门禁自己的缺陷（见 §1）
 * `f67d27ca846a3fcb4c3cd7dc35ffe051ce911d1e`——修完门禁后重跑，**本文件以下所有计数取自这一次**
工作区与该 SHA 之差：**95 个已跟踪文件未提交**（并发会话在飞），所以凡涉及 daemon/宿主二进制的读数都标 **工作区态**。

## 0. 整体验收结论

**FAIL**。

按计划的门槛口径：Linux 真实运行、OS 沙箱强制边界、移动真实运行三关任一没过，整体验收就不能是 PASS，也不能按缩范围发布「完整支持」。这三关本文件里全是 **BLOCKED**，另有一条 **FAIL** 是当轮新抓出的真缺陷（撤销事故半径，见 §3），所以总体判 FAIL 是如实结果，不是进度问题。

## 1. 固定提交隔离副本（计划 §11 第 1 条）

命令（执行器内）：

```
git worktree add --detach <tmp> dff2c848
(cd <tmp>/extjs && node --test)
node --test scripts/sacode-naming.test.mjs
node --test apps/daemon/test/remote-capability-contract.test.mjs
```

| 项 | 读数 |
| --- | --- |
| 副本内 `git status --porcelain --untracked-files=no` | 空（副本确实只含已提交源码，没混未入库文件） |
| `extjs` 扩展宿主套件 | tests **73** / pass **73** / fail 0 / rc **0** |
| 能力契约静态对账 | tests **15** / pass **15** / fail 0 / rc **0** |
| 品牌与 IPC 桥面契约 | tests **4** / pass **4** / fail 0 / rc **0**（`dff2c84` 那次是 tests 3 / pass 2 / **fail 1**，原因见下） |

提交态那条红**不是副本环境造成的**，副本里读到的失败原文：

```
缺少主进程通道：sacode:executionPropose
```

归因结果与最初的猜测相反，所以整条写清楚：这是**本目标自己的门禁脚本假阳性**，不是产品缺陷。
`apps/desktop/main.cjs:221` 用一张路由表加模板注册：

```js
const executionActions = { executionPropose: ['execution/propose', […]], … };
for (const [action,[method,fields]] of Object.entries(executionActions)) {
  ipcMain.handle(`sacode:${action}`, …);
}
```

而 `scripts/sacode-naming.test.mjs` 只扫 `ipcMain.handle('…')` / `("…")` 两种**字面量**形态，
模板注册它天生看不见。修法不是把断言改松，而是让扫描器认得真实的注册机制，并顺手补上
第二处注册源（`apps/desktop/worktree-ipc.cjs` 里的 `registerWorktreeIpc`，否则下一条
`sacode:worktreeDescribe` 会以同一个理由再假红一次）。修完当场两侧都复验：

| 跑的源码 | 结果 |
| --- | --- |
| HEAD `dff2c84` 源码 + 修好的扫描器 | tests **4** / pass **4** / fail **0** → 原红确系假阳性 |
| 工作区源码 + 修好的扫描器 | tests **4** / pass 3 / **fail 1**，仍红在 `sacode:executionPropose` |

工作区那条才是**真的悬空**，但成因是并发会话此刻正把 `executionActions` 那段从 `main.cjs`
里删着改（工作区 `main.cjs` 已无该注册，`preload.cjs` 仍在 invoke 它）。`apps/desktop/main.cjs`
与 `preload.cjs` 都在对面手里，本目标不改，只把这条记进 §7 与在飞表。
门禁自身也不再是「信一次就完」：新增一条合成源码反证用例，喂三份小源码——表驱动 + 新前缀
（须识别）、模板用旧 `dsh:` 前缀（须原样报出来）、表里没有该键（须仍然判悬空），
证明放宽识别没有把断言变成永真。

补充读数（不能进提交态副本，只能在带构建产物的工作区取）：`node --test scripts/pack-service.test.mjs` → tests **11** / pass **11** / fail 0 / rc **0**。`target/`、`apps/desktop/dist/`、`renderer/vendor/` 全在 `.gitignore` 里，副本天生没有这些产物，把它们塞进副本套件只会把「缺产物」误报成「源码失败」——执行器因此把它们拆成独立一行，并显式标取证态。

## 2. 一台实例 × 两台设备的产品面（计划 §11 第 3、4 条）

命令：`node --test --test-concurrency=1 apps/daemon/test/remote-product.test.mjs`
计数：tests **5** / pass **4** / **fail 1** / rc **1**（daemon 摘要 `86551f134b32…`，工作区态）

绿的四条是真实 TLS 读数，不是夹具：

| 用例 | 钉住的产品不变量 |
| --- | --- |
| 一台实例两台设备同时订阅 | `initialize` 触发的那条总线事件**同时**到达桌面与手机两条独立 `/sse`——扇出没退化成「谁触发谁看见」 |
| 两台设备混跑后审计仍能定位 | 审计按 deviceId 分别留下两侧的行；被拒那条带得出 who（deviceId）、when（`"ts":`）、what（方法名 + `outcome:denied`）；整份日志不含 params 值、登记凭据、access token、`Bearer` 字样，也没有 64 位 hex 摘要 |
| 交付面只有一个监听端口，且明文面不存在 | `netstat -ano -p TCP` 里该 PID 的 LISTENING 行**只有一颗端口号**（IPv4/IPv6 同行算一颗），且就是 stdout 宣布的那颗；同端口用明文 `http://` 打 `/health` 拿不到 200——没有第二颗「PC 桥」在别处听 |
| 两台设备各自建会话后目录互不串 | 两台用**同名 operationId** `op-both` 各建各的会话，回执 id 不同（幂等账按 principalId 分键），同一 workspace 目录下两条标题都可见 |

TLS 是带真 `ca` 建的（自签证书 SAN `IP:127.0.0.1`），**没有**关证书校验——本批要证的正是「明文与不受信链都进不来」，关掉校验等于自己拆掉被测面。

## 3. 当轮新抓出的真缺陷：撤销一台 = 作废整台实例的令牌

红的用例：`带外撤销一台：只砍被撤那台的在途流与新请求，另一台不受影响`

失败原文（另一台的 RPC 应答）：

```json
{"jsonrpc":"2.0","id":"rev-2","error":{"code":-32001,"message":"authz-denied:invalid-token"}}
```

复跑确定性：单跑该用例两次（`--test-name-pattern="带外撤销一台"`）rc 均为 **1**，不是偶发。

根因定位到行，且**存在于 HEAD，不是并发会话写坏的**：

- `core/src/remote_identity.cj:274`（`git show HEAD` 同样有这行）：`revokeDevice` 命中后 `if (hit) { revocationVersion += 1 }` —— 抬的是**全局**版本；
- `core/src/remote_identity.cj:301`：`if (token.revocationVersion < revocationVersion) return None` —— 令牌带的是各自**签发时**的版本。

于是撤销任意一台设备，会把该实例上**所有设备**的在途访问令牌同时判为过期。规格 §5 要的是「设备撤销立即限制**该设备**的 RPC 与 SSE」；而 `authenticate` 里本来就有 per-device 的 `device.revoked` 分支（同函数内），所以那次全局 +1 既多余、又把事故半径从一台扩大到整台实例——在「桌面 + 手机同时挂着一台服务器」这个产品形态下，这等于一次撤销把另一位用户也踢下线，顺带还是个可被登录用户触发的自我 DoS 面。

修法（两行范围内）：撤销只推进**该设备**的版本，或让令牌比对改为「令牌签发版本 < 该设备的版本」，不动全局计数器。**本目标没改这条**：`core/src/remote_identity.cj` 正被并发会话持有（工作区 +62/−5 未提交，内容就是 `rotateCredential` 那条线），改它等于吞别人的在飞改动。用例保留红，并在文件头写明「不许为了变绿弱化断言」。

既有套件为什么没抓到：`remote-auth.test.mjs` 的撤销用例只断言**被撤那台**被拒（`assert.match(after.body, /-32001/)`），从没问「另一台还在不在」。这是单客户端用例的结构性盲区，也正是任务 11 存在的理由。

## 4. 反向结果登记（计划 §11 第 6 条）

执行器内 `REGISTRY` 逐条与测试源比对，**登记 9 类失守，缺失 0 类**（状态：PASS）：

| 失守类别 | 具名受害用例 | 变异读数出处 |
| --- | --- | --- |
| 认证失守（撤销后仍可用） | 带外撤销一台…另一台不受影响 | 本轮即缺陷本身 |
| 缺 Bearer / 错凭据 | 未认证的 execute 请求只拿到认证拒因 | 批次 J 变异 N7（`docs/evidence/2026-10-10-remote-batch-progress.md` 批次 J 表） |
| 权限过滤失守 | 铺开转发不等于放开授权 | 批次 C |
| 沙箱透传 | 契约里 execute 一族在没有 OS 强制后端时被整族拒绝 | 批次 J 变异 N1/N2 |
| 幂等失守 | 同 operationId 换内容按冲突拒 | 批次 D |
| 会话归属失守 | 补读按 sessionId 归属 | 批次 E |
| epoch 失守 | 代次不符与游标越界都回显式 gap | 批次 F |
| 断连恢复丢事件 | 带 Last-Event-ID 重连 | 批次 F |
| 凭据泄漏到审计 | 两台设备混跑后审计仍能按 deviceId 定位 | 本批 |

这一行是**静态对账**（用例存在且名字对得上），不等于本轮把 9 个变异全重跑了一遍。真正在当轮重跑过的只有沙箱那一类（批次 J 三轮，读数在那份证据里）。分级要留住：不要把这行读成「九类失守今日已被变异杀死」。

## 5. 三门 BLOCKED 门槛

| 门槛 | 状态 | 实测前提与解锁动作 |
| --- | --- | --- |
| Linux 干净包真实运行 | BLOCKED | 本机无 Linux；Windows SDK 不能交叉编译 Linux 目标（`docs/evidence/2026-10-10-remote-platform-baseline.md` §1 退出码 **1**，报错点名 SDK 缺 `modules/linux_x86_64_cjnative`；§2 官方矩阵不含 Windows→Linux）。解锁：Linux 主机或 WSL2 发行版（装系统依赖不在本次授权范围） |
| OS 沙箱强制边界 | BLOCKED | 当前构建无任何 OS 强制后端，故 execute 族整族拒绝（批次 J）。计划 §4 第 1 条那五类真实子进程越权用例（读凭据目录 / 写工作区外 / 未授权网络 / fork-resource 超限 / 取消后逃逸）要等接了后端才有可区分的红 |
| Kuikly 移动工程与三平台真实运行 | BLOCKED | 执行器实测读数见下节「更正」：**gradle 在位**（Gradle 8.7 + JVM 17.0.2），缺的是 Android SDK（`ANDROID_HOME`/`ANDROID_SDK_ROOT` 均未设、无 `adb`、默认 SDK 目录不存在、已连设备 **0** 台）与 iOS/鸿蒙工具链；`apps/mobile/` 目前只有 Kotlin 源码与 JVM 夹具，没有 gradle 工程本体 |

## 6. 更正：批次 I 把「gradle 缺失」写错了

批次 I 的证据与在飞表里写的是「本机有 JDK 17 与 Kotlin 2.3.20，但缺 gradle、`ANDROID_HOME`/`ANDROID_SDK_ROOT`、`adb` 与真机/模拟器」。**其中 gradle 那半是错的**，2026-10-10 14:07 复探原文：

```
$ gradle --version
Gradle 8.7
JVM: 17.0.2 (Oracle Corporation 17.0.2+8-86)
$ echo "$ANDROID_HOME|$ANDROID_SDK_ROOT"
|                （两者均未设）
$ adb
command not found
```

gradle 由 version-fox 提供（`C:\Users\jingg\.version-fox\sdks\gradle\bin`）。这条写错的实际代价是**把可选路径误判成不可选**：只要有 Android SDK，`apps/mobile` 的 gradle 工程本来可以直接脚手架化，不需要「等用户提供外部工程路径」这一个前提。其余缺失（SDK、adb、设备）当时与现在都成立，所以移动真实运行的 BLOCKED 结论不变，但**归因从「工具链整体缺失」收窄为「缺 Android SDK 与设备」**。

执行器自己也踩过同一个坑的第一版：`execFileSync('gradle', ['--version'])` 报 ENOENT，因为 version-fox 给的是 shell 包装（无 `.exe`），不经 shell 直接 spawn 就探不到——现在探针固定走 `ComSpec /c`，并把 gradle 的具体版本号打进读数而不是只回 true/false。

## 7. 这一版验收没覆盖的（不缩范围，逐条列）

1. 「真实任务 → 工具 → 落盘 → 审查 → 审批 → 取消 → 重启回放」这条**纵向闭环**未在验收里跑完一整趟：审批与工具执行面落在 `apps/host/src/main.cj`（并发会话持有），且 execute 族在无强制后端时被本目标自己的门禁拒着。
2. 「桌面与手机连服务器后手机切到 Windows 电脑」这条**跨目标切换**只落了客户端侧的存储与草稿隔离（批次 I 的 `TargetStore`），没落真实双目标切换读数——需要第二台真实目标机。
3. 双客户端**同一审批竞态**未测：`approval/*` 四个方法的锚点全在宿主侧。
4. 策略变化（非撤销）对 RPC 与 SSE 的即时影响未测。
5. 真·安装包态（`npm pack` 装进干净目录后跑 CLI/daemon/宿主）未跑：发布与网络安装需另行授权。本批只到「进程级单实例 + 单监听端口」。
6. 桌面本机接入开关 UI 与 preload 通道（任务 9）仍未落，卡在 `main.cjs`。
