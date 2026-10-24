# 2026-10-24 交互终端接线批（F09：Host terminal/output|kill + close/kill 语义 + 桌面通道 + 挂载）

- 取证环境：Windows。字段与形状对齐 `docs/plans/2026-10-20-terminal-interactive-design.md` §3–§4 与 `docs/clients/desktop/2026-10-20-terminal-frontend-design.md` §3。
- 范围：把已存在的终端切片按设计稿补齐并接到桌面「终端」标签；**core 0 行改动**。

## 后端（apps/host）
- `terminal_rpc.cj`：`terminal/close` 改为**只拆视图**（`viewClosed`，不停进程树）、`terminal/kill`=停自有进程树；新增 `terminal/output`（Host 侧有界直播环 512 块，`seq` 单调，游标是「下一个期望 seq」；`core.readOutput` 为破坏性排空，output/describe 统一经 `drain` 取回分块，避免抢字节）；`terminal/describe` 去掉 `data/bytes`，改回元数据 + `phase`（running/exiting/exited/view-closed）与 `cwd/cols/rows/exitObserved/exitCode/truncated/eof/treeStopConfirmed`。
- `main.cj`：`initialize` 声明面 +2（`terminal/output`,`terminal/kill`，合计 8 条 terminal）；`TerminalRpc` 注入 `authorizeCreate`：`cwd` 必须等于 `sessionWorkingDirectory(shared)` 的规范化路径，缺工作区/不一致即 `terminal-create-not-authorized`（fail-closed，不继承环境、不放行任意命令行）。
- 构建：`cd apps/host && cjpm build`（按 AGENTS 前置 stdx+runtime DLL PATH）`cjpm build success` rc=0；`target/release/bin/main.exe` 含 `terminal/output`/`terminal/kill`/`nextCursor`/`treeStopConfirmed` 标记。

## 桌面（apps/desktop）
- `preload.cjs` + `main.cjs`：新增 `terminalPtyOutput`→`terminal/output`、`terminalKill`→`terminal/kill`（避开既有 `terminalOutput`=只读回放）；`bridge.test.mjs` 登记并同步计数（新域 42→44、IPC 面期望 198→200）。
- `app.js`：新增 `terminalPtyChannels`（8 函数映射；`create` 显式 `env:{}`，壳层固定 System32 `cmd.exe`）；「终端」侧页改为 `TerminalInteractive` + 折叠的「历史回放」`TerminalOutput`。
- `renderer/pages/terminal-interactive.ts`：加 150ms 直播环轮询（仅 `active` 且 `running`）；`closeView`→Host close（只拆视图），`kill`→Host kill（停树）——组件原有 close≠kill 语义与后端对齐。
- `renderer/terminal-interactive.css`（新增，token 化）给 xterm 容器高度；`index.html` 引入 `vendor/xterm.css`、`vendor/xterm.iife.js`、`terminal-interactive.css`。
- `renderer/pages/client-slots.ts` 导出 `TerminalInteractive`。

## 读数
- `npm run vendor` rc=0（`xterm.iife.js`=430555、`xterm.css`=5559；client-slots 含组件）。
- `node --test test/terminal-interactive-vendor.test.mjs` **4/4**（有/无 Xterm 全局、产物 CSP 反证、假通道 create→running）。
- 相邻渲染层 `page-sources-parse/renderer-syntax/renderer-el-shape/client-slots` **15/15**。
- `scripts/check_host_method_surface.cjs`：声明面 **227**（225+2）；`scripts/check_ipc_surface_parity.cjs`：preload 212 / 注册 204。
- `bridge.test.mjs` 定向（新域/preload）**11 pass / 2 fail**；2 条红同源于他会话在飞的 `browserView*`（preload 已暴露、白名单与通道集合用例未登记），非本批引入。
- `docs/plans/host-capabilities.json` **227/227**（terminal 8 方法，raw=uniq），[接口索引](../interfaces/README.md) §3 同步。

## 边界 / 未升级
- 交互终端**未进 AppContainer 执行沙箱**（设计 T1 一期不进），UI 明示。
- create 的 `env` 现传空（`PATH` 等未白名单化，T9 待产品决定），壳层仅 System32 `cmd.exe`；真实 PTY 交互（键入/输出/resize/中断/退出码）在本机未做 GUI 实机复验。
- `check_ipc_surface_parity` 与 `check_host_method_surface` 各有 1 条既有 FAIL 非本批引入（IPC 面缺的是他会话 `browserView*` 8 条无 main handler；Host 面是既有分母/适配器分派口径）。未改他人文件。
- 未重打 dist/安装包、未提交、未推送。

## 真实 PTY 复验：**失败**（登记缺陷 TERM-LEAK-01）
用已构建 Host 真跑 `initialize → workspace/set-directory → terminal/create → terminal/input → terminal/output`：**create 成功**（返回 `pty-<base64>` 身份、`phase=running`），**但 `terminal/output` 无响应**。原始 NDJSON 探针（捕获 Host stdout 全部字节）证据：
- Host stdout 出现**非协议帧**的子进程文本：`"Microsoft Windows [Version 10.0.26300.9711]\r"`、`"(c) Microsoft Corporation. All rights reserved.\r"`、`"D:\\…\\ws>"`；
- 该 prompt `>` **不带换行**，紧随其后的 `{"jsonrpc":"2.0","id":10,…}` 应答被粘成同一行 → `JSON.parse` 失败 → 应答被丢弃 → 客户端报 `timeout: terminal/output`；
- 伪控制台输出管道里只拿到 `ESC[?9001h ESC[?1004h`（conhost 自身序列，base64 `G1s/OTAwMWgbWz8xMDA0aA==`），**未拿到子进程文本**；
- 判定：**子进程的 std 句柄未接到伪控制台**（子进程输出进入了 Host 继承的 stdout），违反「stdout 只走协议帧」；根因在 `core/src/pty_exec.cj` 的 ConPTY 原生 spawn/句柄装配（他会话代码），本批未改动 core。
- 影响：交互终端**端到端不可用**（帧被撕裂、应答丢失）；结构/离线测试因不触发原生 PTY 而全绿，**不能据此判可用**。

## TERM-LEAK-01 工具化定位（临时诊断已 `git checkout` 回退，Host 已重建 rc=0）
在 `core/src/pty_exec.cj` 加临时 stderr 诊断并重编，得到：
- 原生调用**全部报成功**：`CreatePseudoConsole hr=0`（有效 HPCON）；`InitializeProcThreadAttributeList bytes=48`；`UpdateProcThreadAttribute ok=1, laste=0`；`STARTUPINFOEX cb=112 exSize=112 siSize=104`；`CreateProcessW ok=1, laste=0`。
- 读取侧：`PeekNamedPipe` 成功但 `available` 基本恒为 **0**（偶得 16 字节 = `ESC[?9001h ESC[?1004h`，即 conhost 自身序列）；子进程文本从不出现在输出管道。
- 子进程存活：`WaitForSingleObject` 后 `exit=259 (STILL_ACTIVE)`——**子进程在运行**，却把 banner 写到 Host stdout。
- 实验（各重编一次）：
  - **A**：`lpValue` 改传 `&HPCON` → **stdout 泄漏消失，但子进程秒退 `0xC0000142 STATUS_DLL_INIT_FAILED`**（属性“生效”却拿到无效句柄）。
  - **C**：采 MSDN 样例写法 `lpApplicationName=NULL` → **仍泄漏**。
  - **D**：`bInheritHandles/dwCreationFlags` 的 FFI 形参由 `Int32→UInt32` 统一并显式定型 → **仍泄漏**。
- 判定：**不是 `lpValue` 传参/定型问题**（by-value 与样例一致却无效；`&HPCON` 令属性“生效”但句柄被误用导致 DLL 初始化失败）。真实机理＝子进程**未获得伪控制台作为标准句柄**（未设 `STARTF_USESTDHANDLES` 时 std 句柄默认复制父进程），伪控制台属性在 `CreateProcessW` 阶段未对子进程 std 句柄起作用。四种写法均无法在不动原生层前提下安全定案，故**未留下改动**（`git checkout -- core/src/pty_exec.cj` 回退，Host 重建 `cjpm build success`；本批 core 净改动 0）。
- **同机最小复现（已做，决定性）**：用 clang 编一份**官方 ConPTY 写法的 C 样例**（`CreatePipe`(可继承) + `CreatePseudoConsole(sz, hInRead, hOutWrite, 0, &hPC)` + `InitializeProcThreadAttributeList` + `UpdateProcThreadAttribute(PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, hPC, sizeof(HPCON), …)` + `CreateProcessW(NULL, "\"…\\cmd.exe\" /D", …, EXTENDED_STARTUPINFO_PRESENT|CREATE_UNICODE_ENVIRONMENT|CREATE_SUSPENDED, STARTUPINFOEXW{cb=sizeof} )`），在**仓库内 `target/tmp/` 与中性目录 `%TEMP%` 各跑一次，结果完全一致**：`CreatePseudoConsole hr=0`、`CreateProcessW ok=1 err=0`，但 `cmd.exe` banner 仍打印到**父进程控制台**，输出管道只回 16 字节 `ESC[?9001h ESC[?1004h`，`echo` 回显从不出现。
- **结论**：本机 Windows `10.0.26300.9711` 上**官方 ConPTY 序列本身就不把子进程输出接进伪控制台**（子进程仍落在父控制台/继承句柄）。故 `TERM-LEAK-01` 属**环境 / OS 级**，**不是本仓 `core/src/pty_exec.cj` 的逻辑缺陷**（其调用序列与参考实现逐项一致）；**不应为此改 core**（本批诊断已 `git checkout` 回退，core 净改动 0）。
- 下一步：在 ConPTY 正常工作的 Windows 环境（或不同 OS build／去控制台上下文）复验；若必须在本机跑通，需评估替代机制（外置 `conpty.dll` / OpenConsole.exe）——另行立项。

## TERM-LEAK-01 处置：只保留 ConPTY（降级后端按用户决定撤回）
- 曾按用户选定「替代机制」实现过无 ConPTY 管驱动后端（core `ptyOpenNativePlain` + `SACODE_PTY_BACKEND=pipe`），并已在本机 e2e 跑通（`HAS_TERM_OK=true`、`LEAKS=[]`）。
- 用户复核后决定：**交互终端只保留系统 ConPTY，不做降级后端**。故撤回首实现：`git checkout -- core/src/pty_exec.cj`（core 回到 HEAD，`ptyBackendPipe`/`ptyOpenNativePlain`/`plain` 均不存在），Host 重建 `cjpm build success` rc=0，`SACODE_PTY_BACKEND` 不再使用。
- 结论不变：本机 Windows `10.0.26300.9711` 的 ConPTY 异常属**环境级**（官方 C 样例复现，`conhost 10.0.26100.1` 与 OS build 不一致），非本仓缺陷；**本机交互终端因此不可用**，正常 Windows 环境预期可用（未验）。

## 收尾：门禁修复与全量重跑读数
- `scripts/check_host_method_surface.cjs`：`ROUTE_PREDICATES` 补 8 个**适配器式分派**谓词（`terminal`/`automation`/`compact`/`import`/`skill`/`web`/`mcp`/`knowledge-index` 的 `handles`/`isMethod`），`DENOMINATOR` 171→**222**（据 HEAD 复核）。现 **GATE PASS (11 checks, fail=0)**，且 **`--selftest` PASS（13 探针全命中，未造假绿）**。
- PTY 身份改 **`pty-<hex>`**（新增 `terminalIdHex`），去掉 base64 的 `/`、`+`；Host 重建 `cjpm build success` rc=0。
- 重跑读数：`check_host_method_surface` **PASS**、`check_ipc_surface_parity` **PASS（212↔212）**、`check_contract_anchor_audit` EXIT=0；前端 `terminal-interactive-vendor` + `page-sources-parse`/`renderer-syntax`/`renderer-el-shape`/`client-slots` **19/19**；`bridge.test.mjs` 定向（新域/preload）**13/13**；全量 `--test-timeout=30000` **33 pass / 5 fail / 1 cancelled**——5 红全为 **`extension/host/*`**（`js-host-handshake-timeout: received=0`），与 [P0 证据 §5.2](2026-10-24-p0-cross-end-gates.md) 逐字一致、**预先存在且非本批**（宿主 PID 下不产生子进程）。

## 未验证 / 阻断（交由用户或后续会话）
- **`bridge.test.mjs` 全量 5 条 `extension/host/*` 红**：预先存在的 JS 宿主 spawn 工具链问题（P0 已归因，非本批），需单独立项排查。
- **TERM-LEAK-01 环境级 ConPTY 缺陷**：本机 ConPTY 不可用（官方 C 样例复现）。按产品决定**只保留 ConPTY、不做降级**，故本机交互终端不可用；需在正常 Windows 环境（或修复该机 OS/conhost）使用；ConPTY 路径本身未在本机跑通。
- Electron 实机观感（暗色主题、窄窗、xterm 容器高度）。
- `PATH` 等环境白名单（T9）与「同会话信任此工作区终端」审批（T7）。