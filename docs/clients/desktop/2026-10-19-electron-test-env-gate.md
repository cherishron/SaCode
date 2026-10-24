# Electron 测试环境门禁与交互跑道（2026-10-19）

## 目的
让桌面全套测试在受限代理上下文（沙箱注入／受限进程树）里不再因为 Electron 沙箱被阻断而产生“假失败”，并给用户一条一键跑通的交互跑道。**不修产品代码、不加 `--no-sandbox`、不改 ACL、不动候选包、不提交推送。**

## 1. 门禁判据

权威判据＝**默认沙箱下最小 Electron 探针能否启动**，而不是父链/完整性/WorkBuddy 进程单独判死。

- 探针：`apps/desktop/test-support/electron-env-probe.cjs`。`spawnSync(electron, ['--user-data-dir=…', main.cjs])`，**不传任何旁路参数**；`main.cjs` 只做 `app.whenReady()` → 建 `BrowserWindow({show:false})` → `did-finish-load` 后 `app.exit(0)`，带 15s 看门狗。启动前删除 `ELECTRON_RUN_AS_NODE`（harness 只在 Process 级注入，留着会把 Electron 当 Node 跑，得到 “bad option” 而不是沙箱结论）。
- 判死条件：`exit !== 0`。本会话代理环境实测 `exit=2147483651`（`0x80000003`，STATUS_BREAKPOINT），**28–170ms**，stdout/stderr 全空——与 c3 那 16 项 Electron 失败同源。
- 不用的判据及原因：
  - 进程完整性：本会话 `whoami /groups` 报 **Medium**，不是 Low；D10 的 Low 标签是仓库根产物继承，与代理通道不同源，不能据此判死。
  - “系统里有 `sandbox-cli-gc.exe`”：普通用户装过 WorkBuddy 也会有，会误伤。
  - `ELECTRON_RUN_AS_NODE`：本会话为空（harness 未注入到 Node 子进程），不可靠。
  - 父链含 `opencode`/`workbuddy`：只能说明“在代理里跑”，不能区分 Electron 能否启动。
- 旁证（不参与判死，只写进 `details`）：父进程链、`SESSIONNAME`、`WT_SESSION`、当前 `SessionId`、是否检测到 agent 痕迹。CLI：`apps/desktop/test-support/electron-env-check.cjs`，输出 `{blocked, reason, details}`。

## 2. 10 个文件与分类结果

测试侧门禁：`apps/desktop/test-support/electron-env-gate.mjs`，导出 `electronTestOptions(base)`，命中受限即返回 `{...base, skip: 'env-blocked-electron: …'}`。判据与探针同一来源，不复制逻辑。

10 个文件按 c3 读数登记（行号为编辑时点）：

| 文件 | 受限时跳过的用例 | 备注 |
|---|---|---|
| `test/approval-mode-electron-host.test.mjs` | 1 | 选项改 `electronTestOptions({timeout:40000})` |
| `test/inline-editor-render.test.mjs` | 1 | 同上 |
| `test/knowledge-electron.test.mjs` | 1 | 保留原 `!SACODE_HOST` 跳过；环境受限优先 |
| `test/model-credential-electron-host.test.mjs` | 2（builtin 内/外） | `for…test` 循环 |
| `test/model-pages-render.test.mjs` | 4（light/dark × 1000/600） | 双循环 |
| `test/models/model-pull-electron.test.mjs` | 1 | 保留原 host 跳过 |
| `test/pack-next-sdk.test.mjs` | 1（真实 Electron 严格 CSP） | **其余 4 条构建守卫照跑** |
| `test/plugin-inventory-lifecycle.test.mjs` | 1 | |
| `test/provider-credential-retry-render.test.mjs` | 1 | |
| `test/window-visibility.test.mjs` | 3 | 三条 test 都改 |

合计 16 条用例在受限时跳过，与 c3 的 16 项 Electron 失败一一对应。原因写进 skip 字符串：`env-blocked-electron: 默认沙箱下最小 Electron 未能启动（exit 0x80000003，…ms）；须在已登录交互会话中由用户直接运行 scripts/run-electron-tests-interactive.cmd`。

## 3. 自测

### 3.1 代理环境·10 文件定向（2026-10-19）
`node --test <10 文件>`，本会话 Node v22.22.2。结果 **21 tests / 5 pass / 16 skip / 0 fail**。跳过正好是原先 16 项；`pack-next-sdk` 的 4 条构建守卫（`Next SDK 真实生产构建…`、负向守卫 `eval`/`new Function`、`活跃 Ajv…`、`真实构建反证…`）照常通过。

### 3.2 代理环境·全套（2026-10-19/20，二轮修复后）
显式只跑 `apps/desktop/test/**/*.test.mjs`（208 个，不把 `test/support` 与 `fixtures` 当测试），`SACODE_HOST` 指向 c4 候选包内 Host（只读使用，`82845184…`），`TEMP`/`TMP` 指到仓库内 `target/tmp/`（解决 `%TEMP%` ACL 拒写）。

首轮读数 **1065 / 1036 pass / 6 fail / 23 skip**，6 项非 Electron 失败均为环境前提缺口（见下）。按“能改前提就改、缺工具就标 `env-blocked-*`”修复后，二轮读数 **1066 / 1038 pass / 0 fail / 28 skipped**（`target/tmp/electron-gate-full-20261019/full-c4.tap`，exit 0）。**6 fail → 0 fail。**

28 跳过分类：**16 env-blocked-electron**（第 2 节那 16 条）＋ **2 env-blocked-missing-cli** ＋ **3 env-blocked-missing-openssl** ＋ 6 真实模型凭据 ＋ 1 空原因。门禁把原先 16 项 Electron 假失败与 5 项缺工具/缺入口转为跳过、0 失败；windows-artifact-export 改中性目录后真过，不靠跳过。

### 3.3 六项非 Electron 前提修复

| 文件 | 原失败 | 修复 |
|---|---|---|
| `approval-mode-cli-host.test.mjs` | `assert.ok(process.env.SACODE_CLI)` | 引入 `cli-env-gate.mjs`，缺 `SACODE_CLI` 时 `# SKIP env-blocked-missing-cli` |
| `execution-history-host.test.mjs` | `assert.ok(process.env.SACODE_CLI)` | 同上 |
| `remote-transport-tls-pin.test.mjs`（3 条） | `openssl-fixture-generation-failed:ENOENT` | 加 `spawnSync(openssl,['version'])` 探针，不可用时 3 条 `# SKIP env-blocked-missing-openssl`；第 4 条单元锚点不依赖 openssl，照跑 |
| `windows-artifact-export.test.mjs` | `delivery must be outside the build workspace`（`tmpdir()` 被 runner 指到仓内 → 导出目标落仓内 → `isInside` 守卫拒） | 改测试前提：`outsideRepoTemp()` 取仓外中性目录（`tmpdir()` 在仓内时回退仓库父目录），不动断言；第二测（负向守卫）保留原 `target/tmp` 目标不变 |

修复原则：不降断言、不加 `--no-sandbox`、不改 ACL、不伪造 CLI/openssl；缺入口/缺工具的如实标 `env-blocked-*` 跳过，原因写进 skip 字符串；能改前提（windows-export 换中性目录）就改，不跳过。

### 3.4 交互跑道·拒绝路径（2026-10-19）
`node scripts/run-electron-tests-interactive.cjs --no-pause`，代理环境：探针命中 → 打印拒绝原因 → **exit 2**，**未生成任何 `target/tmp/electron-interactive-*` 目录**，不假装跑过。

## 4. 交互跑道用法

- 双击入口：`scripts/run-electron-tests-interactive.cmd`（UTF-8 代码页、末尾 pause）。或命令行：`node scripts/run-electron-tests-interactive.cjs`。`--no-pause` 跳过末尾暂停。
- 流程：先用同一探针确认环境；命中受限即 exit 2 + 中文提示，不启动任何 Electron 测试、不写结果目录。通过后**串行**跑 10 个文件，每文件一个子进程、180s 超时即杀；结果落 `target/tmp/electron-interactive-<时间戳>/`，含每文件 `<file>.tap`、`summary.json`、`report.txt`。
- 跑道设 `SACODE_ELECTRON_ENV=ok` 给子测试，避免每个文件再启一次探针（跑道已用同一探针确认）。
- `SACODE_HOST` 缺省且 `apps/desktop/dist/host/bin/sacode-host.exe` 存在时自动补默认路径；否则打印提示，需要真实 Host 的用例按自身门禁跳过。**不伪造 Host。**

## 5. 未验证边界

- **正向交互路径未在本会话验过**：本会话是代理环境，探针必然失败；探针 `exit=0` 后 10 个文件是否真的全过，须由用户在已登录交互桌面双击 `run-electron-tests-interactive.cmd` 复验。门禁只证明“代理里跑不了”，不证明“交互里一定能过”。
- 真实模型凭据用例（6 条）仍按自身门禁跳过，不在本跑道范围。
- 不覆盖 GUI、安装态、跨重启恢复；`--no-sandbox` 仅历史诊断用，不作默认、本跑道也不传。
- 探针产物 `target/tmp/electron-env-gate/probe-<pid>.json` 与跑道结果目录都在 `**/target/`（全局忽略），不入库。
- 未提交、未推送、未改产品代码、未改候选包。

## 6. 文件清单

新增：
- `apps/desktop/test-support/electron-env-probe.cjs`（探针，单一来源）
- `apps/desktop/test-support/electron-env-check.cjs`（CLI 预检）
- `apps/desktop/test-support/electron-env-gate.mjs`（测试侧 `electronTestOptions`）
- `apps/desktop/test-support/cli-env-gate.mjs`（CLI 入口门禁，`cliEnvSkip`）
- `scripts/run-electron-tests-interactive.cjs`（跑道主体）
- `scripts/run-electron-tests-interactive.cmd`（双击入口，CRLF）

改动（仅 test 选项/前提，不动断言与产品代码）：
- 10 个 Electron `.test.mjs`（§2）。
- `approval-mode-cli-host.test.mjs`、`execution-history-host.test.mjs`：加 `cliEnvSkip()`。
- `remote-transport-tls-pin.test.mjs`：加 openssl 探针，3 条用例按可用性跳过。
- `windows-artifact-export.test.mjs`：第一测改用 `outsideRepoTemp()` 仓外中性目录。

原始读数：`target/tmp/electron-env-gate/probe-<pid>.json`、`target/tmp/electron-gate-full-20261019/full-c4.tap`（二轮 0 fail）。
