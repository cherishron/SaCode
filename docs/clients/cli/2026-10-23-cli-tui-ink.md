# 2026-10-23 CLI 终端交互界面（Node/Ink TUI）

- 取证环境：Windows，Node `v22.23.2`，npm `11.15.0`；`ink@5.2.1`、`react@18.3.1`、`rollup@4`。
- 范围：新增 `apps/cli/tui/`（独立 Node 子工程），由 `npm/sacode-cli/bin/cli.js` 在「无参数且 stdin/stdout 都是 TTY」或显式 `sacode tui` 时进入；其余参数原样透传仓颉 CLI。
- 业务边界：TUI 只做渲染与按键。消息追加、起轮、流式帧、审批、取消与结算全部走 Host NDJSON JSON-RPC；界面没有自己的「同意」状态，也没有本地伪造的结算结果。
- 取证时工作区未提交；未构建新桌面候选、未提交/推送/全局安装/发布，未发起收费模型请求。仅在 `target/tmp/` 做过本地 tarball 测试安装（§3.5）。2026-10-24 增量见 §5；§3 保留 10-23 的产物与测试读数，不冒充修复后的新产物。

## 1. 本次动作

1. 新建 `apps/cli/tui/`：`src/index.mjs`（TTY 校验、宿主启动、Ink 挂载）、`src/app.mjs`（状态机）、`src/host-client.mjs`（NDJSON JSON-RPC）、`src/host-path.mjs`（宿主定位与运行环境）、`src/components.mjs`（展示组件）、`scripts/build.mjs`（Rollup 单文件打包）、`test/`（10-23 最终 7 条用例）。
2. 新增 `scripts/pack-tui.mjs`：构建并把单文件产物收集到 `npm/sacode-cli/tui/index.mjs`，同时校验产物只含 Node 内置模块、无动态 `import()`、无 `eval`/`new Function`。
3. 修改 `npm/sacode-cli/bin/cli.js`：TTY 且无参/`tui` 进 TUI；显式 `tui` 非 TTY 返回 64；其余命令仍透传平台包 CLI。TUI 只需要宿主，平台包缺失时由 TUI 按 `SACODE_HOST` 或开发布局定位宿主。
4. 修改 `npm/sacode-cli/package.json` 的 `files`，把 `tui/index.mjs` 纳入主包；`scripts/package-platform.mjs` 在主包 `npm pack` 前调用 `pack-tui.mjs`。
5. `.gitignore` 增加 `npm/sacode-cli/tui/`（生成产物，不入库）。

## 2. 协议口径修正（验收中发现）

首版 TUI 发送 `session/submit` + `eventType:"user"` 并用诊断 `turn/start` 起轮。核对 Host 源码与桌面入口后修正为：

- 用户消息：`session/append` + `eventType:"user/message"`。`user` 不在 `isSurfaceEvent` 集合里，虽能落日志但不会进入消息投影，模型也看不到；桌面 `main.cjs` 的 `userSend` 同样使用 `user/message`。
- 起轮：产品路径 `task/start`。`turn/start` 是诊断路径，不补 `system/message`、不准备知识库上下文，且缺配置时会退回示例 provider；`task/start` 只认真实配置，缺模型/凭据时显式报错，符合终端用户预期。

`useInput` 是 Ink 5 的按键链：Ink 从 stdin 的 `readable` 事件 `read()` 取数据后，经 `internal_eventEmitter` 发 `input`。因此伪 TTY 冒烟不能直接 `stdin.emit('data', ...)`，也不能把 `/help\r` 作为一整个 chunk 写入（会被当成一次多字符粘贴）；改为内存 `PassThrough` 冒充 stdin、字符与回车分两次写入后，按键链真实通过。

## 3. 读数

### 3.1 单元/集成测试

命令：

```powershell
cd apps/cli/tui
$env:SACODE_HOST="D:\Project\sa\saai\sa-code\apps\desktop\dist\host\bin\sacode-host.exe"
npm test
```

结果：**7 tests / 7 pass / 0 fail / 0 skip**，总耗时约 1.48 s。

- `host-client.test.mjs` 2/2：起轮、流式 `text:` 帧、`approval/asked` 通知、`approval/answer`、结算；取消后由 `turn/poll` 交出 `cancelled` 终态。
- `app.test.mjs` 4/4：首屏会话/目录/历史投影；输入消息后断言 `session/append` 的 `eventType` 为 `user/message` 且起轮走 `task/start`；审批只发 `allowed-once`/`denied`；审批待答时 Ctrl+C 先发 `denied` 再发 `turn/cancel`，不会让审批框吞掉取消。
- `real-host.test.mjs` 1/1：真实宿主 `initialize` → `session/catalog` → `workspace/get` → `usage/status` → `session/projection` 引导；追加唯一探针文本后，真实投影出现同一条 `user/message`。**只验证追加与投影，不调用 `task/start`，避免在用户机器上触发真实模型请求。**

### 3.2 打包产物

```powershell
node scripts/pack-tui.mjs
```

- `apps/cli/tui/dist/index.mjs`：450,980 B，SHA256 `6a23b1d2f89c8504975d036769afb4f0073628042ca3622b7a8d30c5bd20fdc6`。
- `npm/sacode-cli/tui/index.mjs` 与上者同哈希（收集是逐字节复制）。
- 自足校验通过：除 `node:` 内置模块外无外部模块导入，无动态 `import()`、无 `eval`/`new Function`。

### 3.3 npm 主包内容

```powershell
cd npm/sacode-cli
npm pack --dry-run
```

结果：5 个文件，含 `tui/index.mjs` 451.0 kB；tarball 145.0 kB，解包 456.4 kB。

随后在 `target/tmp/tui-install-20261023-a1/` 真正执行 `npm pack --pack-destination`（即上面的 dry-run 同一份文件清单），产物 `stand-alone-sacode-0.2.0.tgz` 145,047 B，准备用于 §3.5 的安装态验证。**未发布到 registry。**

### 3.4 伪 TTY 烟测（真实宿主）

用内存 `PassThrough` 冒充 `process.stdin`（`isTTY=true`、`setRawMode/ref/unref` 空实现），调用打包后的 `npm/sacode-cli/tui/index.mjs` 的 `main()`，设 `SACODE_HOST` 指向开发态宿主，工作目录为 `target/tmp/` 下的临时目录。

- 首屏：`SaCode  v0.2.0  ·  当前会话`、真实 cwd、输入框、状态栏均出现。
- 输入 `/help` 后回车：帮助正文出现（`/help 显示这份帮助`、`/quit 退出`、`Ctrl+D 退出`）。
- 随后 `Ctrl+D`：进程退出，`[harness] exit=0`，整体 rc=0。
- 宿主未配置模型，未执行 `task/start`，因此本烟测不覆盖真实模型、审批与落盘。

### 3.5 安装态（tarball → npm install → 启动）

目的：验证主包在用户机器上（而非仓库工作区）能否找到单文件产物与宿主，不依赖 `apps/cli/tui/node_modules`、不依赖平台包。

```powershell
# target/tmp/tui-install-20261023-a1/app 为一次性安装目录
npm install D:\Project\sa\saai\sa-code\target\tmp\tui-install-20261023-a1\stand-alone-sacode-0.2.0.tgz --omit=optional
```

- 安装结果：`added 1 package in 3s`，rc=0；`node_modules/@stand-alone/sacode/` 下正好是 `package.json`、`bin/{cli.js,daemon.js,platform.js}`、`tui/index.mjs`。
- 刻意 `--omit=optional`：本机未安装平台包 `@stand-alone/sacode-win32-x64`，用来验证「TUI 不因薄启动器缺平台包而整体不可用」。
- 非 TTY 显式 `tui`：`node node_modules/@stand-alone/sacode/bin/cli.js tui` → rc=64；经 `node_modules/.bin/sacode.cmd tui` → 同样 rc=64。说明安装态的 TTY 判定与提示生效。
- 安装态透传命令（未装平台包）：`.../bin/cli.js --help` → rc=79，stderr 为 `Cannot find module '@stand-alone/sacode-win32-x64/package.json'`，与「缺平台包就明确报错」的既有口径一致，没有静默假装成功。
- 伪 TTY 启动：用同一套 `PassThrough` 冒充 stdin，直接 `require` 安装态 `bin/cli.js`（`process.argv` 无参数，走「无参自动进 TUI」分支），`SACODE_HOST` 指向开发态宿主，cwd 为 `target/tmp/tui-install-workspace`。
  - 首屏出现 `SaCode  v0.2.0  ·  当前会话` 与真实 cwd；`/help` 出现 `显示这份帮助`；`Ctrl+D` 退出，`[harness] exit=0`，整体 rc=0。
  - 该路径同时证明：`cli.js` 里 `resolvePlatform` 失败被吞掉后，TUI 仍按 `SACODE_HOST` 找到宿主。
- 缺宿主失败态：同一安装态不设 `SACODE_HOST`、cwd 为仓内临时目录 `target/tmp/tui-install-workspace` → rc=69，stderr 列出两条尝试过的绝对路径并提示「请先构建宿主（apps/host）并放到 apps/desktop/dist/host/bin，或设置 SACODE_HOST」。这证明当前安装布局找不到宿主时明确失败，不是仓库外/另一台机器的运行证据。

### 3.6 非 TTY

- `node npm/sacode-cli/bin/cli.js tui`（管道）→ rc=64，提示「TUI 需要交互终端」。
- 直接调用打包产物的 `main()`（非 TTY）→ 同样 rc=64。
- 安装态（§3.5）同样 rc=64。

### 3.7 干净打包机路径（npm ci → build → 收集）

`pack-tui.mjs` 在打包机首次运行时没有 `apps/cli/tui/node_modules`，会先 `npm ci`。为验证该分支，把 `package.json`/`package-lock.json`/`src`/`scripts` 与 `pack-tui.mjs` 复制成 `target/tmp/tui-ci-check/{apps/cli/tui, npm/sacode-cli, scripts}` 的最小布局（保持 `pack-tui.mjs` 的相对路径），删掉 `node_modules` 与 `dist` 后执行：

```powershell
node scripts/pack-tui.mjs
```

- `npm ci` 从锁文件装好 68 个包（17 s，0 vulnerabilities），随后构建、自足校验、收集一次通过，rc=0。
- 产物 `npm/sacode-cli/tui/index.mjs` 450,980 B，SHA256 `6a23b1d2f89c8504975d036769afb4f0073628042ca3622b7a8d30c5bd20fdc6`，与仓库内产物逐字节相同——锁文件完整、构建可复现（同机同版本 Node）。
- 另单独跑过一次 `npm ci` + `node scripts/build.mjs`，同为上述哈希。

## 4. 未验证 / 边界

- **未在真实交互终端由用户亲手走查**：首屏、输入、`/help`、审批 y/n、Ctrl+C 取消、Ctrl+D 退出中的后三项只在伪宿主/夹具上覆盖了协议与界面分支，未用真实模型跑「读取→提出修改→审批→落盘→差异」。
- **安装态已在本机 tarball 上验证**（§3.5），但未从已发布 registry 安装，也未验证 `optionalDependencies` 平台包真实落地后的组合；干净打包机只验证到 `npm ci` + 构建 + 收集（§3.7），未在另一台机器/CI 上跑。
- 未验证其他平台终端（Linux/macOS/Windows Terminal 之外的 conhost、tmux、SSH）；未验证窗口 resize、粘贴多行文本、宽字符/CJK 折行。
- 未构建新桌面候选，未提交、推送、全局安装或发布；仅执行 §3.5 的隔离测试安装，当前交付候选身份与主阻塞不变。

## 5. 2026-10-24 续验：跨块 UTF-8 解码

- **缺陷与影响**：`HostClient` 原先对每个 stdout/stderr 数据块各自 `Buffer.toString("utf8")`；中文或 emoji 的多字节编码跨块时会被替换为 `�`。这会破坏正文、路径和审批参数的展示，不改变 Host 的审批与执行规则。
- **先红后绿**：新增 `host-client.test.mjs` 回归，用 Node 子进程将中文 JSON 回执与诊断逐字节输出。旧代码断言得到替换字符、rc=1；修复为对 stdout/stderr 使用 `setEncoding("utf8")`，让流保留跨块字节，再用既有 NDJSON 读循环解析，回归通过。
- **受影响测试**：指定真实 `SACODE_HOST` 后 `npm test` 为 **8 tests / 8 pass / 0 fail / 0 skip**，约 1.55 s。入口为 `apps/desktop/dist/host/bin/sacode-host.exe`，SHA256 `052917f95f2d6f966aa94a941b988d07f1081d50c1c0b8d44dc008297f4fb4ea`；这是开发态 Host，不是当前桌面交付候选的同源验收。未调用真实模型；沿用真实 Host 引导/投影追加用例，不将它当真实任务证据。
- **新产物**：`node scripts/pack-tui.mjs` rc=0；dist 与 npm 主包目录的 `tui/index.mjs` 均为 **451,213 B**，SHA256 `77a811ee6e0f9a665c6db9b6857efc08d7784705399805228cbb8570e31ae7c9`，自足校验通过。
- **新产物烟测**：内存流伪 TTY＋真实 Host 的 `/help`→Ctrl+D 退出为 rc=0，日志 `target/tmp/tui-utf8-20261024-0fd82b50/smoke.log`；这是伪终端，不是真实 Windows Terminal 验收。
- **静态检查**：TUI 源码/测试/构建脚本 10 个 `.mjs` 的 `node --check` 与定点 `git diff --check` 通过。当前子工程没有 lint/typecheck 脚本且是纯 JS，未将语法检查冒充 ESLint 或 TypeScript 检查，也未安装额外工具。
- **分发核对**：`scripts/pack-cli.mjs` 已收集 `sacode-host`，主包 `bin/platform.js` 已将存在的包内 Host 写入 `SACODE_HOST`；这里只核源码接线，未重新构建平台包或验证主包＋真实平台包安装组合。§3.5/§3.7 的 tarball 与干净重建证据仅对应旧哈希 `6a23b1d2…`，未把它们移用于本次新哈希。
- **状态**：TUI 仍待真实终端及真实模型审批/落盘/差异/重启验收。未动桌面候选、用户模型配置或密钥；未提交、推送、安装或发布。
