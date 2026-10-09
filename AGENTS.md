# AGENTS.md

## 项目定位
DeepSeek Harness (DSH) 全系统复刻实验：一份**仓颉（Cangjie）共享核心 + 两个入口**（CLI 与 Electron 桌面），二者驱动同一 `core`、同一 `session.log`。
改动前先读这三份文档，不要靠记忆推断进度：
- `docs/plans/plan-deepseek-harness-replication.md` — 复刻口径、18 条架构不变量、接口设计。
- `docs/plans/dsh-capability-matrix.md` — 上游子系统能力矩阵（S0 冻结快照；分母 **63 个模块 + 1 行 README**，旧「64 个模块」把索引页算成了能力，2026-10-03 已更正）。
- `docs/evidence/p0-status-2026-10-02.md` — 哪些已实测、哪些 BLOCKED、解锁条件。

## 模块边界（别凭目录名猜）
- `core/` — 仓颉静态库，**唯一业务真源**（会话日志、投影、取消/背压、JS 扩展进程驱动）。两个入口都依赖它。
- `apps/cli/` — 仓颉可执行入口；`main` 按子命令（`seed|projection|all|stream|tool|ext|cancel|extjs|sig`）跑断言式自测，也是 npm CLI 的二进制来源。
- `apps/host/` — 仓颉 NDJSON/JSON-RPC 宿主，由桌面端 spawn；**stdout 只走协议帧，诊断走 stderr**。
- `apps/desktop/` — Electron 壳（`main.cjs`/`preload.cjs`/`host-bridge.cjs`/`paths.cjs` + `renderer/`）。渲染层是**纯 JS + Vue runtime，运行时无模块加载器、无模板编译器、无 TypeScript**；第三方组件由 `scripts/pack-tinyvue.mjs` 与 `scripts/pack-tinyrobot.mjs` 在**构建期**各折叠成一个经典脚本进 `renderer/vendor/`，esbuild 与组件库都只是 `apps/desktop` 的 devDependency，**产物运行时零 npm 依赖**。消息面经 `BubbleProvider + BubbleList`（`groupStrategy: "consecutive"`）渲染，正文由本仓自定义内容渲染器出（默认链会把 `role==="tool"` 交给只渲染注释节点的 ToolRole，正文会隐身），折叠阈值只在 `renderer/msgfold.js` 一处。
- `extjs/` — 独立 Node JS 扩展宿主（NDJSON JSON-RPC），被 core 以子进程驱动。
- `npm/dsh-cli` — npm 主包，`bin/cli.js` 是必须入库的源码入口；`npm/dsh-cli-win32-x64` 的 `bin/` 二进制与 DLL 由脚本生成，**不入库**。
- `scripts/pack-*.mjs` — 打包脚本（CLI / 宿主 / Vue vendor）。

## 环境
- 仓颉 `cjc`/`cjpm` **1.1.3**（target `x86_64-w64-mingw32`）；Node ≥18（本地 v22）。
- `apps/host/cjpm.toml` 中 stdx 路径**硬编码为本机** `C:/Users/jingg/stdx-work/...`，换机器必须改。
- 无 CI、无根 `package.json`；npm 命令都在 `apps/desktop` 或 `npm/*` 下执行。

## 常用命令
仓颉（根 `cjpm.toml` 是 workspace，members = `core`、`apps/cli`、`apps/host`）：
- 核心单测：`cd core && cjpm test`（测试文件为 `*_test.cj`）
- 构建 CLI：`cd apps/cli && cjpm build`

桌面（先 `cd apps/desktop && npm install`）：
- 单测：`npm test`（即 `node --test` 自动发现）。**不要写成 `node --test test/`**——本机 Node 会把目录当模块解析，整串失败。
- 跑单个用例：`node --test --test-name-pattern="<name>"`
- 冒烟：先生成宿主 `node scripts/pack-host.mjs apps/host/target/release/bin/main.exe apps/desktop/dist/host <stdx-dll-dir> <runtime-dll-dir>`，再 `npm run smoke`（期望 `SMOKE PASS`）/ `npm run ui-smoke`。dev 态宿主路径固定为 `apps/desktop/dist/host/bin/sacode-host.exe`（品牌改名后不是 `dsh-host.exe`；`host-verbs` 与 `real-provider-*` 都读它，后者可用 `SACODE_HOST` 指到别处）。重打这个目录前先看有没有活的 `sacode-host.exe`：并发会话的宿主进程会锁住 `bin/*.dll`，`pack-host` 报 `EPERM: unlink` 且重试同点同错——这时改打私有输出目录自证脚本没坏，不要清理别人的进程。
- `npm run vendor` 依次跑 `scripts/pack-vendor.mjs`（拷 Vue runtime）、`scripts/pack-tinyvue.mjs`（TinyVue 组件 → `renderer/vendor/tinyvue.iife.js` + esbuild 伴生的 `.css`）与 `scripts/pack-tinyrobot.mjs`（TinyRobot bubble 一族 → `tinyrobot.iife.js`，`dist/style.css` 原样拷成 `tinyrobot.css`）；`prestart`/`presmoke`/`preui-smoke` 自动触发。`renderer/vendor/` 已被 gitignore，属构建产物——判「产物是否可复现」要重跑 vendor 看文件是否回来，不能只 grep 脚本里有没有那个文件名。

JS 扩展宿主：`cd extjs && node --test`

打包：
- `node scripts/pack-cli.mjs`（读 `CANGJIE_HOME`，默认 `D:\Program Files\HuaWei\Cangjie`）
- `node scripts/pack-host.mjs <exe> <outDir> <dllDirs...>`
- Electron：`cd apps/desktop && npx electron-builder`（产物在 `dist/electron/`）。若 electron 平台二进制缺失，用 `npm install electron@<ver> --foreground-scripts` 走官方源补齐，勿设镜像。
- **`github.com` 超时时的可复现构建法**（2026-10-03 实测）：`packaging` 步骤会去 github.com 取 Electron zip，超时后 electron-builder 直接 rc=1 且**产物时间戳不变**——判定「是否真拿到了新产物」要看 exe 的 mtime/体积，别把旧产物的断言当新证据。合规解法是指向本地已装的官方 dist：`npx electron-builder --config.electronDist=node_modules/electron/dist`（rc=0）；这**不是**镜像，红线仍是不设 `ELECTRON_MIRROR`。

## 必须知道的约束
- **会话日志是唯一真源**，消息/UI 都是投影。`append` 只在实例内可见，`flush` 才跨进程持久——不要把 `append` 当持久化。
- 桌面渲染层受 CSP `script-src 'self'` 约束（禁 `unsafe-eval`）：必须用 Vue **runtime** 构建 + `h()` 写视图，运行时不能引模板编译器、模块加载器或 ES module（`file://` 下会被 CORS 拦）。第三方组件库若只有 ESM 形态（TinyVue 与 TinyRobot 都是），**只能在构建期折叠**成经典脚本，且必须把 `vue` 别名到已 vendor 的那一份 runtime——装进第二份 Vue 会让组件的响应式系统与应用的不是同一套。折叠产物还必须过反证式自检：无 `new Function`/`eval`、**无残留 `import(`**（TinyRobot 的 Markdown 路径本来对外部 `markdown-it`/`dompurify` 做动态 import，实测只引 Bubble/BubbleList/BubbleProvider 时那条路径被 tree-shaking 掉，才没有留下运行时模块加载）、无裸 `"vue"` 说明符、且接上 `globalThis.Vue`。改渲染层前读 `scripts/pack-vendor.mjs`、`scripts/pack-tinyvue.mjs` 与 `scripts/pack-tinyrobot.mjs` 顶部注释。
- Electron IPC 面是按动作命名、逐字段校验的**有限**集合，**唯一权威是 `apps/desktop/preload.cjs` 里 `contextBridge.exposeInMainWorld` 的顶层 key**（2026-10-05 实测：提交态 **33** 条、工作区态 **42** 条；本文件此前那句只列了 9 条名字，是过期的历史清单，别拿它当分母，重测法见 `docs/superpowers/specs/2026-10-05-model-center-design.md` §9.2），不提供“发任意方法”通道。审批凭据只能是工单号：`toolCall` 只收 `approvalId`，渲染层传自报审批字符串没有通路。增删通道要同步改 `preload.cjs` 与 `test/bridge.test.mjs`。
- 打包态宿主路径只能从 `process.resourcesPath` 解析；缺它要 fail-loud，**绝不回退 asar 内路径**（见 `apps/desktop/paths.cjs`）。
- 宿主 exe 必须与全部依赖 DLL 同目录（靠 Windows 默认搜索序，不拼 PATH）。
- `apps/desktop/test/bridge.test.mjs` 在仓库根使用 `dualtest/`（已 gitignore）；异常残留时先 `rm -rf dualtest` 再跑。
- 注释、文档、commit 一律中文；commit 形如 `feat(core,host): 描述`，scope 用 `core/host/cli/desktop/extjs/scripts/docs`。
- 不要提交构建产物：`target/`、`apps/desktop/dist/`、`npm/dsh-cli-*/bin/`、`*.log` 均已在 `.gitignore`。主包的 `npm/dsh-cli/bin/cli.js` 是源码，必须入库。
- **仓库根目录只允许已入库的源码、文档与配置**：任何临时/验证/测试产物（夹具、私有源码副本、日志、快照、探针输出）**严禁**散落在仓库根或任意源码目录，**一律**放进 `apps/desktop/.tmp-test/`（已在 `.gitignore` 忽略）或做完即删。提交前 `git status` 只要出现**未跟踪、未忽略**的顶层目录或文件，即视为违规，必须先清理干净。**禁止 `git add -A` / `git add .`**——只按文件路径精确 `git add`，杜绝把游离产物误带进提交。
