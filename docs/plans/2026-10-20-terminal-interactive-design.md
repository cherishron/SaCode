# F09 实时交互终端实现设计

日期：2026-10-20  
范围：设计文档。不写产品代码，不碰 `core/`、`apps/host/` 源码。  
验收口径：PRD F09、V01 终端支、DV07–DV08；接口计划 `terminal/create|input|resize|interrupt|describe|close` 与 `action/run`。

---

## 0. 目标与非目标

**目标：** 开发者在右侧终端里 **交互执行**：输入、resize、中断、看到真实退出码；多实例；cwd/环境明确；任务 Header 的 Workspace Actions **打进当前任务终端**；输出有界且截断可见。

**非目标 / 反证：**

- 关闭标签 ≠ 进程已结束（DV08）。
- 断连/重连 **不** 重发已键入或未确认的命令（F09 失败路径）。
- 已落盘回放 ≠ 实时终端；`execution/*` 一次性任务 ≠ PTY。
- 手动终端授权 ≠ 逐命令可拦截（用户在 PTY 里敲的每一行不再弹审批）。
- ACP Agent 的 `terminal/*` 是显示/外部能力，**不能** 照搬 F09 控制承诺。
- 不以 Windows pipe 执行验收代替 PTY；macOS/Linux 未具备则 BLOCKED。

---

## 1. 现状盘点

### 1.1 桌面 `terminal-output.ts` 当前能力

`apps/desktop/renderer/pages/terminal-output.ts` + `terminal-output-state.ts`：

| 有 | 无 |
| --- | --- |
| 工作台标签 `terminal` 已 `available:true` | 输入框、xterm、resize、Ctrl+C |
| 调 `sacode.terminalOutput(sessionId, cursor, 16)` | spawn / kill / 多实例 PTY |
| 分页校验：sessionId、seq 单调、每页 ≤16、页面缓存 128 条 | 退出码、PID、cwd、running |
| 单条 8 KiB 截断标记；损坏计数；省略计数 | 实时流、notify |
| 内嵌 `ExecutionTask`（提案→审批→启动→读 stdout/stderr） | 该任务 stdin 仍丢弃，不是终端 |
| 文案已写明「交互 PTY 与实时流尚未接入」 | preload 只有 `terminalOutput` 三参数 |

preload 专项测试冻结：**只开放有界回放，不接受执行命令**。新增交互 API 必须另开通道，不能把 command 塞进 `session/terminal-output`。

### 1.2 `session/terminal-output` 通道返回什么

Host `handleRpc20`：

- 入参闭集：`sessionId`, `cursor`, `limit`（1–16）。多字段即 `bad-terminal-arguments`。
- `sessionId != activeId` → `terminal-session-changed`。
- **重新 `SessionLog.load()` 只读快照**，不碰在途租约。
- 核心 `terminalOutputJson`：扫描 `terminal/chunk` 事件。

载荷形状：

```
{ sessionId, page: { rows: [{ seq, jobId, text, truncated }], nextCursor, more, malformed } }
```

`terminal/chunk` 正文约定：`<jobId>::<text>`（`TerminalBuffer` / `term.cj`）。  
**不包含：** 命令、argv、cwd、env、PID、exitCode、EOF、是否仍在跑。注释写明「不推断 JobStore 内存状态或退出码」。

重启 Host 只重读日志，**不执行 Shell**（桌面真实 Host 夹具已核：文件字节不变）。

### 1.3 已有可复用 vs 不可冒充

| 资产 | 可复用 | 不可当作 PTY |
| --- | --- | --- |
| 会话身份 / `activeId` 核验 | 所有新 RPC | — |
| `TurnToken` 取消、`allowedDuringTurn` 读侧模式 | 中断/描述/输出 | 不把 turn/cancel 当成杀所有终端 |
| 工作区 `directory` + `revision` | create 时冻结 cwd | 不默认用 execution 私有副本 |
| UTF-8 安全截断（`terminal_view` / `readShellBounded`） | 直播与落盘 | — |
| `execution/*` 提案摘要、一次性审批、exit 事实 | **Workspace Action 若走一次性命令** 可参考；PTY 生命周期不走六动作 | stdin Discard、timeout 等退出、无 resize |
| `windows_process.c` Job + wait/stop/exit/active | **kill 整树、exit 观测** 可借鉴 | stdin 父端已关；stdout/stderr 分 pipe；`CREATE_NO_WINDOW`；无 write/resize |
| `WindowsExecutionProcessProvider` / `collectWindowsProcess` | 监督、超时、限额、token 取消 | `used` 一次性；读到 EOF 即结束 |
| `ShellExecutor` + `shlex` argv 编码 | Action 的 argv 编码、cmd/pwsh 包装规则 | `ProcessRedirect.Discard` stdin |
| `JobStore` `bash-N` | 无 | 进程内编号，重启可重复，不是持久身份 |
| `ConsoleSignals` / `sigwin.cj` | 仅 Host 自身 Ctrl+C | 不是子 PTY 的 SIGINT |
| `turnSink` notify + poll | 直播输出建议同构 | — |
| 工作台 `instanceKey` / dirty/running 关标签三选 | 多终端标签 | 关视图默认不 kill |
| ACP `terminal/create` 等 | 显示外部 Agent 终端 | 无输入/resize 承诺 |

**结论：** 回放通道保持只读。交互终端是 **新的 Host 运行态 + 新 RPC 闭集**。构建测试继续用 `execution/*`，不要把 PTY 当测试报告真源。

---

## 2. 三车道（架构硬约束）

```
┌──────────────┐  session/terminal-output   ┌─────────────┐
│ 历史回放     │ ◄──── 只读 chunk 分页 ──── │ SessionLog  │
└──────────────┘                            └─────────────┘

┌──────────────┐  execution/propose…stop    ┌─────────────┐
│ 一次性验证   │  pipe、stdin EOF、超时     │ Supervisor  │
│ 构建/测试    │  AppContainer（Win 强制）  │ Job Object  │
└──────────────┘                            └─────────────┘

┌──────────────┐  terminal/create…kill      ┌─────────────┐
│ 交互终端     │  真 PTY、stdin、winsize    │ PtySession  │
│ Workspace    │  直播环 + 有界留存         │ ConPTY/PTY  │
│ Actions      │  动作打入 *当前* terminalId│             │
└──────────────┘                            └─────────────┘
```

混用禁令（接口计划已写「不能与已接通的 execution/* 混同」）：

- 不把 `execution/output` 当 VT 流。
- 不把 `terminal/chunk` 的 jobId 当 `terminalId`。
- 不在 `session/terminal-output` 上加 command/cols。
- Agent 工具 shell 仍走审批 + execution/沙箱，不因用户开了交互终端而免审。

---

## 3. Host 层：实时终端方法分派

### 3.1 协议闭集（initialize 声明；CLI 同名）

建议 RPC（字段在实现时冻结 JSON shape，此处只定语义）：

| 方法 | 作用 | 在途 turn |
| --- | --- | --- |
| `terminal/create` | 授权后 spawn PTY | 允许（人在环） |
| `terminal/input` | 写入字节（含 Ctrl 字符） | 允许 |
| `terminal/resize` | cols/rows → 内核 winsize | 允许 |
| `terminal/interrupt` | 向 **进程组** 发中断（Win：Ctrl-C 事件进 ConPTY；POSIX：SIGINT） | 允许 |
| `terminal/describe` | cwd、尺寸、相位、pid、exit 事实 | 允许 |
| `terminal/output` | 直播环分页（cursor=字节或序号） | 允许 |
| `terminal/close` | 只拆订阅/渲染；**不** kill | 允许 |
| `terminal/kill` | 停自有进程树；确认后才标 exited | 允许 |
| `action/run` | 在 **指定 terminalId** 注入或同 cwd 受控跑命名动作 | 允许；须另授权 |

全部带 `sessionId`；不匹配 → `terminal-session-changed`。  
`requestId` 对 create/kill/action 幂等；input/resize **不** 靠 requestId 重放（断连禁止重发）。

**不设** `terminal/signal` 一期（SIGTERM/Kill 由 `kill` 覆盖）。  
**不设** 通用 `argv` 转发。

### 3.2 运行时对象（Host 内存，非日志权威）

```
PtySession
  terminalId          // 核心分配，跨重启不复用；不是 bash-1
  sessionId
  workspaceRevision   // create 时冻结；目录变了拒绝继续 input，须新 create
  cwd                 // 规范化绝对路径，展示给用户
  envFingerprint      // 哈希，不回显秘密值
  cols, rows
  pid?                // 仅描述；恢复不按 PID 接管
  phase               // starting | running | exiting | exited | unknown | view-closed
  token               // 本实例 TurnToken
  ring                // 有界字节环（建议 256–512 KiB，待确认 T4）
  seq                 // 单调块号
  truncated           // 环溢出或落盘截断
  exitObserved, exitCode, interruptObserved, treeStopConfirmed
  subscribers         // 桌面/CLI 连接代际；断开只减订阅
```

Host 退出：尽力 `kill` 自有实例并登记 unknown-if-unconfirmed；**不杀** 用户无关窗口/进程（DV08）。

重启 Host：**不接管** 旧 PID（与 `ExecutionSupervisor`「重启不按 PID 接管」一致）。投影为 unknown/exited-unobserved；UI 开新实例。布局恢复只打开空白终端视图，不自动 create。

### 3.3 spawn / 输入 / resize / 中断 / 退出 / 流

**create**

1. 核工作区可用且 `revision` 匹配。
2. 一次性审批：`terminal/create` 绑定 cwd + envFingerprint + cols/rows（**不是** 之后每一行）。
3. 原生层：ConPTY（Win）或 openpty（POSIX，若未实现则 create 返回 `pty-unavailable`）。
4. 默认壳：Win `COMSPEC` 或明确 `powershell.exe`；POSIX `$SHELL`。路径必须绝对；拒绝用户拼进未批准可执行文件（T2）。
5. 成功后 `phase=running`，notify `terminal/started`。

**input**

- 二进制安全：建议 Base64 字段 `data` + `bytes`。
- 写入失败/已退出 → 明确错误，**不排队到下次 create**。
- 单帧上限（建议 4 KiB），防止把文件 dump 进 PTY。

**resize**

- 仅当 `running`。Win：`ResizePseudoConsole`；POSIX：`TIOCSWINSZ`（必要时 SIGWINCH）。
- 非法 cols/rows 拒绝；不静默夹紧后假装成功。

**interrupt**

- 必须让 **前台进程组** 收到，而不是只写 `0x03` 碰运气（DV07：程序真收到）。
- 同时允许用户 input 里的 `0x03`（TTY 规范）；`interrupt` RPC 给按钮/菜单用。
- 回执是 `interrupt-requested`；是否退出看后续 describe。

**kill**

- 借鉴 Job Object `stop` + `active()` 直到 0 或超时 → `treeStopConfirmed` / `unknown`。
- POSIX：先 SIGINT/SIGTERM 进程组，再 SIGKILL；孙进程逃逸如实报告，不宣称整树。

**退出码**

- 只在 `exitObserved=true` 时填 `exitCode`。未观测 **禁止** 用 -1 冒充（执行契约已定）。
- 超时（若 Action 带超时）与自然退出、中断三分开。

**输出流**

```
PTY 读线程 → 环缓冲
            → notify terminal/data { terminalId, seq, data, truncated }
            → 可选：节流 append terminal/chunk 供旧回放页（jobId=terminalId）
桌面 xterm ← poll terminal/output 补洞（与 turn/poll 同构，防 notify 丢）
```

截断：环满丢最旧，`truncated=true` 且 UI 横幅「输出已截断」。单块 UTF-8 不在码点中间切开（复用现逻辑）。

直播 **不要** 每字节 flush 会话日志。留存策略见 T4：关闭/退出时写一份有界快照，或低频 chunk。秘密（密钥、token）不保证从 PTY 输出剥除；导出/普通投影默认不带完整环。

### 3.4 Workspace Actions

PRD：Header 动作使用 **当前任务终端**。

```
用户点「安装依赖 / 跑测试 / …」
  → 解析当前 session 的 currentTerminalId（无则提示先开终端，禁止默默换目录）
  → action/run { sessionId, terminalId, actionId, expectedRevision }
  → 核 terminal 仍 running、cwd 仍是该任务工作区
  → 将冻结命令写入该 PTY（加换行）或在同 cwd 起受控子进程并把输出 mirror 进同一视图
  → 展示该次动作的退出码（若可观测）；PTY 壳本身可能仍 running
```

**推荐一期：** Action 是 **向当前 PTY 注入已批准的命令字符串**（人能看见），而不是另起 AppContainer 副本。若动作需要沙箱/私有快照（构建测试报告），继续走 `execution/*` 与「构建测试」标签，Header 上那种按钮不要假装是交互终端。

无终端、终端已死、cwd 漂移 → 拒绝，**不在别的环境执行**。

### 3.5 桌面 / CLI

- 渲染：需 VT 模拟（见 §5 依赖）。无 xterm 时不得用 `<pre>` 假装交互（无光标、无应用模式）。
- 关标签：`close` 视图；可选对话框「仅关视图 / 停止并关 / 取消」（工作台 running 规范）。
- CLI：`terminal open|send|resize|interrupt|status|close`；无 TTY 的管道模式只支持 describe/kill，不交互。
- 多实例：每标签一个 `terminalId`；同资源默认聚焦，可显式新实例。

---

## 4. 安全边界

| 规则 | 做法 |
| --- | --- |
| cwd/环境明确 | create 回执含规范化 cwd、envFingerprint；describe 可重复读。环境块显式构造（对齐 windows_process「拒绝 NULL env」），不继承未审计的父进程全部秘密到日志。 |
| 授权粒度 | **开终端** 一次批准；击键不再批。Action 另票，绑定 terminalId+命令摘要。 |
| 断连不盲重发 | 连接代际；input 无「未发送队列重放」。重连只 `describe` + `output` 从 cursor。 |
| 输出截断标记 | 环、落盘、UI 三处同一 `truncated`；截断文本不得当完整测试分母。 |
| 关终端 ≠ 结束进程 | `close` vs `kill` 分方法；UI 状态 `view-closed` + 后台 `running` 仍可在描述里看到。 |
| 只清理自有实例 | Job/进程组仅含本次 spawn 树。 |
| 工作区 CAS | 目录/修订变化 → input/action 拒绝 `workspace-changed`。 |
| 与 Agent 隔离 | 用户 PTY 不自动成为模型工具；模型 shell 仍要工具审批。 |
| 手动终端不是沙箱证明 | 若一期无 AppContainer（T1），UI 标明「交互终端未进入执行沙箱」。 |

---

## 5. 依赖：ConPTY / POSIX PTY / FFI / 仓颉 IO

### 5.1 仓颉 `std.process` 能力（现状）

`ShellExecutor` 已用：`launch(..., stdIn: Discard, stdOut/Err: Pipe)`、`SubProcess`、读到 EOF、wait 超时。

**没有：** PTY 主从、winsize、进程组、把 ConPTY 句柄塞进 `CreateProcess`。  
因此 **交互终端不能用现有 `launch()` 实现**。

### 5.2 Windows ConPTY

- API：`CreatePseudoConsole` / `ResizePseudoConsole` / `ClosePseudoConsole`（Win10 1809+）。
- 进程：`STARTUPINFOEX` + `PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE`；**与当前 `windows_process.c` 的 HANDLE_LIST + AppContainer 属性组合是另一条创建路径**。
- 当前 DLL 明确：父 stdin 关闭，「never the host's interactive input」。**不要在该文件上硬接 PTY**，以免破坏执行沙箱契约。
- **新原生模块**（建议 `core/native/windows_pty.c`）：create/write/read/resize/interrupt/wait/stop/close。仓颉 `@When[os=="Windows"] foreign`。
- ConPTY + AppContainer 同时启用：兼容性 **未验证** → T1。

### 5.3 Linux / macOS

- `posix_openpt` / `openpty`、`fork`、`setsid`、`TIOCSCTTY`、`TIOCSWINSZ`、`kill(-pgid, SIGINT)`。
- 仓颉需 POSIX FFI 或独立 `.c`。当前产品主路径是 Windows；**POSIX 未实现则 `pty-unavailable`，验收 BLOCKED**，不借 Win 代验。

### 5.4 是否必须原生 FFI

**是（真 PTY）。** 备选：

| 方案 | 评价 |
| --- | --- |
| A. 仓颉 FFI + 自有 C（推荐） | 与现有 windows_process 同构；桌面不引入 node-pty |
| B. Electron `node-pty` | 进程在 Chromium 侧，Host 失去统一授权/审计；双入口 CLI 用不上 |
| C. 仅 pipe + 假提示符 | **验收不合格**（不是真 PTY，resize/全屏程序失败） |

桌面 VT：`xterm.js`（或等价）为 **渲染依赖**，不拥有进程。打包体积/许可证 T5。

### 5.5 依赖清单

| 依赖 | 用途 | 捆绑 |
| --- | --- | --- |
| 新 Windows PTY C API | ConPTY 生命周期 | 随 Host 原生库 |
| 现有 windows_process Job 思想 | kill 整树（可调用 Job 或 ConPTY 侧 Job） | 已有，勿混 create |
| `TurnToken` / SessionLog | 取消、有界 chunk 留存 | 已有 |
| 工作区 API | cwd | 已有 |
| xterm.js（桌面） | VT 渲染 | 待确认 T5 |
| node-pty | **不采用** | — |
| POSIX PTY C | 非 Win | 未开始则能力位 false |

---

## 6. 与现有执行通路的复用边界

**可借鉴（抄模式，不共用句柄）：**

- 提案冻结 cwd/timeout/limit 的思路 → create 冻结 cwd/env/尺寸。
- `collectWindowsProcess` 的 created/started/observed/truncated/complete 事实桶 → PtySession 退出事实。
- `readShellBounded` 限额后继续排空防堵 → PTY 读线程同样：展示环有界，内核侧必须持续读。
- `execution/stop`：请求停止 ≠ 已死；`kill` 回 `exiting` 直到 describe。
- 关页面不 cancel（ExecutionTask 已有文案）→ `terminal/close`。
- argv 的 `windowsProcessArgument` / cmd `/s /c` 规则 → 仅当 Action 走「另起进程」时。

**不要复用：**

- `ExecutionProcessProvider.execute` 一次性 `used` 标志。
- stdin 关闭的 create。
- 私有 execution 工作区副本当用户终端 cwd（用户要对着真实项目敲命令；写回审查是另一条路）。
- `JobStore` / `TerminalBuffer.append` 作为直播权威。
- 把构建测试报告绑在 PTY 输出解析上（继续 `build-test-report` + execution 双流 EOF）。

**Agent 工具 vs 用户终端：** 模型要跑命令 → 仍 `execution` + 沙箱。用户终端是人的壳。Workspace Action 是「人点的、打进自己的壳」的快捷方式，不是模型通道。

---

## 7. 实施顺序（建议，非本轮施工）

1. 原生 Windows ConPTY FFI + 夹具：echo 往返、resize 后 `tput cols`、Ctrl+C 打断 `pause`/`ping -t`、exitCode。  
2. core `PtyService` + Host RPC 闭集；initialize 能力位。  
3. 桌面：xterm 接 create/input/resize/output/kill；旧回放页保留为「历史」。  
4. `close` vs `kill`、断连不重放、多实例。  
5. Header `action/run` 绑定 currentTerminalId。  
6. 有界留存接入旧 `terminal/chunk` 或新事件（不改旧 chunk 含义）。  
7. POSIX / 沙箱增强按 T1/T3。

---

## 8. 待确认项

| ID | 问题 | 建议默认 | 阻塞 |
| --- | --- | --- | --- |
| **T1** | 用户交互 PTY 是否进 AppContainer？ | **一期不进**，UI 明示未沙箱；Agent/execution 保持强制隔离。ConPTY+AC 另立项。 | 是（create 实现） |
| **T2** | 默认壳：PowerShell vs cmd vs 用户配置 | 用户设置，缺省 `powershell.exe` 绝对路径；拒绝任意可执行除非设置页批准 | 否 |
| **T3** | POSIX 是否与 Win 同期 | **否**，能力位 `pty-unavailable` | 否（Win 主路径） |
| **T4** | 直播环大小与是否写入 session.log | 环 256 KiB；退出/关闭写一条有界快照；不实时逐块落盘 | 否 |
| **T5** | VT 渲染库 | xterm.js 进桌面；CLI 用宿主 TTY | 是（桌面交互） |
| **T6** | Action 注入 PTY vs 另起 execution | Header 快捷注入 PTY；要报告/沙箱的走构建测试标签 | 否 |
| **T7** | `terminal/create` 是否每次弹审批 | 每实例一次；同会话「信任此工作区终端」可绑 workspaceRevision，修订变则重批 | 否 |
| **T8** | Host 崩溃后用户壳是否残留 | 尽力 Job kill-on-host-exit；残留则 unknown，不接管 | 否 |
| **T9** | 环境变量哪些进入 PTY | 显式白名单 + 工作区 PATH；密钥类不进日志；是否继承用户 PATH **待产品** | 否 |

---

## 9. 验收映射（设计覆盖，非已实现）

| 标识 | 对应 |
| --- | --- |
| F09 输入/resize/中断/退出码 | §3.3 |
| 多实例、cwd/环境 | PtySession + describe |
| Workspace Actions 用当前终端 | §3.4 |
| 截断标记 | 环 + UI + 快照 |
| 关标签不冒充结束 | close ≠ kill |
| 断连不盲重发 | 无 input 重放队列 |
| DV07 程序真收到、慢构建不凭静默判死 | interrupt 进进程组；无输出仍 running |
| DV08 关面板/取消/退出分别核 | 相位机；unknown 不重发 |
| ACP 终端能力不混 | §2 |

反证：只接 pipe 的 `execution/start` 标成「交互终端已完成」→ 不合格。
