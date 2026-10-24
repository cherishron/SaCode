# 测试源码、夹具与运行产物存放规范

本规范区分应入库的测试资产和不得入库的运行产物。目录整理不改变产品需求，不将测试通过等同真实任务或安装验收。

## 1. 归属与目录

测试按被测职责归属模块，再按功能分类，不按编写会话、日期或所用语言分类。

```text
apps/desktop/test/<功能>/*.test.mjs  # 页面、组件、桌面IPC与桌面集成
apps/host/test/<功能>/*.test.mjs     # Host协议、进程生命周期与跨入口恢复
apps/cli/test/<功能>/*.test.mjs      # CLI命令黑盒行为
apps/daemon/test/<功能>/            # 服务协议与远程会话
extjs/test/<功能>/                  # JS扩展宿主
scripts/test/<功能>/                # 构建、打包与分发脚本
<模块>/test/support/                # 可复用测试驱动和工具
<模块>/test/fixtures/<功能>/        # 合成、脱敏、可公开的静态夹具
```

- 功能名如acp、execution、session、models、knowledge、worktree；避免按每个测试再套一层空目录。
- 跨入口测试以主驱动职责归属；共享核心业务断言归core，Host/CLI一致性可归Host集成测试。不能因使用桌面HostBridge就全部放桌面目录。
- 支持工具不命名为`*.test.mjs`，避免误发现。共享工具引用不等于复制生产实现。
- 仓颉`*_test.cj`目前保留所属源码包。迁往独立test目录前必须验证cjpm发现、包名和内部可见性；不能改名/搬目录导致漏跑。该例外是当前工具链约束待验证，不是仓颉测试永久散放的理由。
- 现有Electron `test-support`及顶层冒烟入口仍被主进程和打包清单引用，尚未整体迁移。迁移时同时修改调用路径、打包清单与契约测试，不创建失效入口。

## 2. 哪些可以提交

可以入库：测试源码、断言、可复现的假提供方、合成脱敏夹具、测试驱动、必要配置与运行说明。代码审查要求与生产代码相同；不得含真实用户资料、凭据、绝对个人路径或未获许可第三方内容。新增可复用测试不应长期藏在忽略目录。

不得入库：任何真实密钥或凭据（API Key、访问/刷新Token、密码、私钥、会话Cookie、认证头、数据库连接凭据、云服务凭据）、含上述内容的配置与.env文件，以及target构建结果、可执行文件与运行库、运行日志、会话数据、截图输出、覆盖率报告、临时源码副本、外部参考仓库及探针运行报告。主包npm启动源码不因位于bin而当作生成物。

测试、夹具、文档、截图和提交说明也不得夹带真实凭据；仅允许明确无效的占位值和无真实数据的配置模板。测试凭据从运行环境或专用本地凭据存储注入，不写死到源码，不输出到断言失败信息或日志。忽略规则不是保密证明，提交前必须检查实际暂存差异；发现真实凭据先停止提交，不在报告中复述其值，通知用户撤销或轮换，不擅自改写Git历史。

## 3. 临时空间与清理

- 当前统一临时根为`target/tmp/<用途>-<日期>-<短id>/`（`**/target/` 已全局忽略）；一次性运行输出、私有副本、日志、探针报告与批次打包输出一律落此，不表示里面的测试都归desktop业务。
- 单次运行使用唯一子目录；测试结束清理自有资源。需留取证时记录来源、提交、平台和结果，中文结论放文档，原始输出留忽略目录。
- 不在仓库根或源码目录中生成夹具/日志，不依赖遗留target或私有二进制；现有使用系统临时目录的测试逐步统一，不宣称已迁完。
- 产物落点由守卫`scripts/check_artifact_placement.cjs`在每轮验收拦截：仓根/模块一级/`target`一级按允许集核对，旧临时根名（字符串与目录存在性）零容忍（本批上线并自证，接线状态见`scripts/gate-verdict.mjs`登记）。`dist/`只保留当前正式分发产物（安装包、win-unpacked、正式宿主），批次/验收构建禁止写入；清理前对照保留清单，安装包不得当临时产物清除。
- 删除前核绝对路径、链接、受Git管理文件及进程占用；不使用`git clean -fdx`或全仓清理代替精确范围，不误删依赖、用户数据和正式分发目录。
- 2026-10-16已把统一临时根迁至`target/tmp/`，清空旧`apps/desktop/.tmp-test/`、`dualtest/`与仓根近形残留，全部写入方完成机械迁移；更早证据中的旧路径仅为历史记录，不能当当前可用资产；需要时重新构建或按固定提交获取。

## 4. 运行与迁移验收

从仓库根定向执行文件模式，例如：

```powershell
node --test apps/desktop/test/import/*.test.mjs apps/desktop/test/scan/*.test.mjs
node --test apps/host/test/acp/*.test.mjs apps/cli/test/acp/*.test.mjs
```

第二条需要提供新构建的SACODE_HOST、SACODE_CLI；真实提供方测试另有显式门禁，不默认发模型任务。不要把目录本身作为Node测试模块参数。desktop的npm test仍仅覆盖该入口发现范围，不再涵盖已迁往Host/CLI的测试。

每批迁移必须：核文件数量和归属、修相对路径、检查脚本/CI/打包引用、执行相关测试，并分别记录通过、跳过、失败。最终需要验证统一运行入口覆盖各模块，不以定向通过声称已完成全仓测试。迁移不删断言，不靠减少发现数量制造通过。

目前已完成的批次与未完成项见[整理台账](plans/test-layout-2026-10-15.md)。测试可提交不等于授权自动提交；精确暂存路径，禁止git add .或git add -A。

## 5. Electron 测试环境门禁与交互跑道（2026-10-19）

c3 全套出现过 16 项 `0x80000003`（STATUS_BREAKPOINT）假失败，根因是**代理代跑环境**（沙箱注入／受限进程树）里 Chromium 默认沙箱初始化被阻断，与 SaCode 代码无关，用户手动双击不受限。门禁把这 16 项在受限时标成 `env-blocked-electron` 跳过，不计失败、不计通过、单独列出；并给用户一条一键交互跑道。详见 [2026-10-19 证据](clients/desktop/2026-10-19-electron-test-env-gate.md)。

**判据**：以「默认沙箱下最小 Electron 探针能否启动」为准（`apps/desktop/test-support/electron-env-probe.cjs`，不传 `--no-sandbox`、不关 GPU、不改系统）。本会话代理环境实测 `exit=0x80000003`、28–170ms、无输出。进程完整性（Medium）、WorkBuddy 进程存在、`ELECTRON_RUN_AS_NODE` 都**不单独判死**——会误伤装过 WorkBuddy 的普通用户。父链/会话只作旁证写进 `details`。

**在仓库内受限时不要直接认命（2026-10-24 实测）**：`0x80000003` 与 D10 同源——仓库工作区里的文件继承低完整性标签，默认沙箱 Electron 在此启动即崩。把 `apps/desktop`（可排除 `node_modules`、`dist/electron`、`dist/releases`）与 `node_modules/electron/dist` 复制到 `D:/tmp/<用途>-<日期>/`（仓外临时产物，不入库），再用 `ELECTRON_OVERRIDE_DIST_PATH` 指向该中立二进制即可真实执行门控用例，**不关沙箱、不改 ACL**：

```bash
cd apps/desktop
env -u ELECTRON_RUN_AS_NODE ELECTRON_OVERRIDE_DIST_PATH='D:\tmp\<用途>-<日期>\electron' \
  TMP='D:\Project\sa\saai\sa-code\target\tmp\<用途>' TEMP='D:\Project\sa\saai\sa-code\target\tmp\<用途>' \
  node --test test/model-pages-render.test.mjs
```

`TMP`/`TEMP` 是必需的：需要起宿主的用例用 `os.tmpdir()` 建目录，本机 `%TEMP%` 对宿主写入返回 `Permission denied`（rc=-13），不设会得到与被测代码无关的红。

这属于本地验证通道，不是产品默认配置，也不改变交付仍需中性导出的事实。

**10 个文件**（16 条用例）：`approval-mode-electron-host`、`inline-editor-render`、`knowledge-electron`、`model-credential-electron-host`、`model-pages-render`、`models/model-pull-electron`、`pack-next-sdk`（仅“真实 Electron 严格 CSP”那条，其余 4 条构建守卫照跑）、`plugin-inventory-lifecycle`、`provider-credential-retry-render`、`window-visibility`。各文件 `import {electronTestOptions} from '../test-support/electron-env-gate.mjs'` 后把 Electron 用例选项包一层；命中受限即 `# SKIP env-blocked-electron: …`。

**交互跑道**：双击 `scripts/run-electron-tests-interactive.cmd`（或 `node scripts/run-electron-tests-interactive.cjs`）。先用同一探针确认环境；命中即 exit 2 + 中文提示、不启动任何 Electron 测试、不写结果目录；通过后串行跑 10 个文件，结果落 `target/tmp/electron-interactive-<时间戳>/`（每文件 TAP、`summary.json`、`report.txt`）。`SACODE_HOST` 缺省且 `apps/desktop/dist/host/bin/sacode-host.exe` 存在时自动补默认路径，不伪造 Host。

**未验证边界**：正向交互路径（探针 `exit=0` 且 10 文件真过）须由用户在已登录交互桌面复验；门禁只证明“代理里跑不了”，不证明“交互里一定能过”。真实模型凭据用例仍按自身门禁跳过。不覆盖 GUI、安装态、跨重启恢复；`--no-sandbox` 不作默认、跑道也不传。

**非 Electron 前提门禁（2026-10-19 二轮，同构）**：把首轮剩余 6 项非 Electron 失败也按“能改前提就改、缺工具就标 `env-blocked-*`”处理，全套由 6 fail 降到 0 fail。
- 缺 `SACODE_CLI`（c4 候选包未含 CLI）：`approval-mode-cli-host`、`execution-history-host` 引入 `apps/desktop/test-support/cli-env-gate.mjs`，缺入口时 `# SKIP env-blocked-missing-cli`。
- 缺 openssl（`SACODE_OPENSSL` 未设且 PATH 无 openssl）：`remote-transport-tls-pin` 加 `spawnSync(openssl,['version'])` 探针，3 条依赖 openssl 的用例 `# SKIP env-blocked-missing-openssl`；第 4 条单元锚点不依赖 openssl，照跑。
- `windows-artifact-export`：导出脚本的 `isInside` 守卫要求目标在仓外，当 `tmpdir()` 被 runner 指到仓内时会误拒；改用 `outsideRepoTemp()`（`tmpdir()` 在仓内时回退仓库父目录），不动断言，第一测真过。

二轮全套自测（208 个 `*.test.mjs`，c4 Host，TEMP 指到 `target/tmp`）：**1066 / 1038 pass / 0 fail / 28 skip**＝16 env-blocked-electron ＋ 2 env-blocked-missing-cli ＋ 3 env-blocked-missing-openssl ＋ 6 真实模型凭据 ＋ 1 空。不降断言、不加 `--no-sandbox`、不改 ACL、不伪造 CLI/openssl。
