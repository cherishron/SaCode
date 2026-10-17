# 批次 C+D 验收：渲染入口解耦与全量回归（2026-10-11）

取证时间 04:12–04:24（本机 UTC+8）。所有读数均为当轮实跑，命令与 rc 逐条附后。

## 批次 C · 渲染入口解耦到 1000 行以下

| 项 | 读数 |
| --- | --- |
| `renderer/app.js` 行数（HEAD `8ec258b`） | **1893** |
| `renderer/app.js` 行数（本批工作区） | **953**（< 1000 达标） |
| `git diff --stat -- app.js` | +139 / −1079 |
| 迁出模块（新增，经典脚本挂 `window.SaCode*`） | 12 个：`session-catalog` `session-state` `enhance` `attachment-state` `model-directory-state` `turn-poll-state` `send-queue-state` `tool-approval-state` `workspace-state` `team-state` `settings-state` `side-panels` |
| `renderer/index.html` | 新增 12 条 `<script src>`，与上表一一对应，顺序在 `app.js` 之前 |
| 新增行为用例 | `test/{session-state,send-queue-state,tool-approval-state,workspace-state,team-state,settings-state,side-panels,attachment-state,model-directory-state,turn-poll-state,state-wiring}.test.mjs` |

闭合性核对：`app.js` 引用的 `window.SaCode*` 全局全部由**本批文件或已入库文件**定义；`grep` 确认上述 11 个测试文件均不引用未随本批提交的 `composer-commands` / `pack-next-sdk` / `after-pack` / `*-ipc.cjs`（那是并发会话的在途线，本批未碰、也未提交）。

## 批次 D · 全量回归

### 默认环境（TMP 指向系统 `C:\Users\jingg\AppData\Local\Temp`）

- `npm test`：**tests 669 / pass 587 / fail 74 / cancelled 0 / skipped 8，rc=1**。74 条红全部落在「真实宿主」用例上，70 个文件，纯 JS 渲染层用例（含本批 11 个）无一红。
- `npx electron . --ui-smoke`：**rc=3，stdout/stderr 各 0 行**——进程在 `app.whenReady` 之前崩溃。

### 74 条红的根因（不是代码缺陷，是本机策略）

按固定顺序取证，每一步都留了原文：

1. **错误串聚合**（剥码后按 `error:` 计数）：`-32001 already-owned` 19 条、`model/registry/update: -32001 provider-flush-failed` 17 条、其余 ≈30 条为 `Failed to recursive create directory \`C:\Users\...\Temp\sacode-*\settings\` return -1: "Permission denied"`。三类都指向**宿主在系统 Temp 下建目录/建临时文件被拒**——`already-owned` 是 `WriteLease.acquire()` 里 `File.createTemp(dir)` 失败的下游形状（`core/src/lease.cj`），不是真的有别的写者。
2. **单跑也红**：`node --test test/appearance.test.mjs` → tests 2 / pass 0 / fail 2，两条都是 `already-owned`。排除「同批并发文件互相抢租约」。
3. **双基准目录探针**（同一份 `host-bridge.cjs`、同一个宿主 exe、同一次调用，只换基准目录）：
   - `C:\Users\jingg\AppData\Local\Temp` → `initialize` 成功（131 条能力），`appearance/set-theme` 报 `-32001 already-owned`；
   - `apps/desktop/.tmp-test` → `{"theme":"dark","scope":"session","saved":true,"changed":true}`，租约正常释放。
4. **谁被拒**：node 自身与 node 的 `cmd.exe /c mkdir` 子进程在系统 Temp 下**都能建目录**（`node subdir OK`、`child cmd mkdir rc=0`）；被拒的是 `sacode-host.exe` 与 `electron.exe`。`icacls` 给出形状：系统 `%TEMP%` 只授 `SYSTEM/Administrators/jingg`，而 `apps/desktop/.tmp-test` 额外带 `Mandatory Label\Low Mandatory Level:(I)(OI)(CI)(NW)` 与一条 `(W,D,DC)` 应用容器 ACE——**是路径级策略按可执行文件生效，不是 ACL 缺用户**。
5. **正对照**：`TMP/TEMP` 指到已授权目录后单跑 `appearance.test.mjs` → **tests 2 / pass 2 / fail 0，rc=0**。

因此本批不把这 74 条记为产品缺陷，也不改测试基准目录去凑绿（`test-support/fixture-env.mjs` 与各用例一字未动），而是把「系统 Temp 对宿主/Electron 不可写」记为**本机环境前提**，读数按该前提显式标注。

### 环境前提下的绿态读数

- `npm test`（`TMP=TEMP=apps/desktop/.tmp-test/t2`）：**tests 669 / pass 661 / fail 0 / cancelled 0 / skipped 8 / duration 43.6s，rc=0**。
- `npx electron . --ui-smoke --no-sandbox`（同上 TMP）：**296 条 `OK`、0 条 FAIL，rc=0**。
- `npx electron . --layout-smoke --no-sandbox`（同上 TMP）：**192 组 `LAYOUT PASS`，rc=0**（末三行 `workspace/floating/split dark 1440x900`）。
- 收尾残留：`tasklist //FI "IMAGENAME eq sacode-host.exe"` 与 `electron.exe` 均回 `INFO: No tasks are running`，**自有宿主零残留**。

### 两条必须如实保留的保留意见

1. **`--no-sandbox` 是取证妥协，不是产品结论。** 不带它时 Electron 连 `--version` 都 rc=3、零输出；`ELECTRON_ENABLE_STACK_DUMPING=1` 打出的栈顶帧含 `IsSandboxedProcess`，即 Chromium 沙箱初始化崩溃，发生在我们的应用代码之前。本机为何崩未在本轮定位——**「默认沙箱态下的 ui-smoke」在本机为 BLOCKED**，解锁动作：换一台未施加该路径策略的机器，或定位本机拦截 `%TEMP%` 写入与沙箱 broker 的拦截方。
2. 上面三条绿读数建立在**测试进程临时改 TMP 落点**之上；产品运行时会话目录由壳传入，不走系统 Temp，故不影响打包态结论，但**不能**拿来当「系统 Temp 下也能跑」的证据。

## 与红线相关的游离产物披露

并发会话此前把 `apps/desktop/apps/desktop/.tmp-test/`（路径写深了一层）当成了落盘点，内含约 2.7 MB 的 `execution-view-*` 夹具目录，未跟踪也未被忽略。本会话曾把两份日志误写进同一处，已 `mv` 归位到 `apps/desktop/.tmp-test/`；**其余目录不是本会话创建的，未删除**，交由持有方处置。
