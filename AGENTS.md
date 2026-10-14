# AGENTS.md

## 项目定位
SaCode 是面向开发者的**可信、可控的 AI 编程工作台**，采用仓颉共享业务核心，CLI、Host、daemon 与桌面前端复用同一业务语义。DSH 是历史研究与架构参考，不以完整复刻、63 模块覆盖率或警告清零作为当前产品完成标准。
改动前先读当前文档，不要靠记忆或历史 PASS 推断进度：
- `docs/product/PRD.md` — 现行 F01–F21 需求、授权与真实任务验收要求；其中带日期的进度表仅是当时快照。
- `docs/product/platform-and-distribution.md` — Windows/Linux/macOS 桌面与 CLI、鸿蒙 CLI/后续 ArkTS/ArkUI 前端、npm 与 GitHub 构建分发目标及实际验证边界。
- `docs/README.md` — 文档权威顺序、最新已登记平台读数与历史资料导航；`docs/build-linux.md` 给出 Linux 依赖配置。
需要核历史来源时再读 `docs/plans/plan-deepseek-harness-replication.md`、`docs/plans/dsh-capability-matrix.md` 与 `docs/evidence/p0-status-2026-10-02.md`，不能将其旧范围和结果当当前授权或完成状态。

## 推进与并发边界
- 当前优先完成真实开发任务、页面工具的核心授权/取消/结算、ACP 委派与 LSP 结果进入工作台，以及验收源码统一构建与安装后任务。平台支持是正式范围，不为此另造业务核心。
- codex 负责上述入口与交付线。平台线改共享执行、ACP/LSP、Host、桌面及打包公共文件前先协调归属，不提交其他会话的实现或删除。
- Windows/Linux/macOS 的 CLI、服务与 Electron 桌面均为支持目标；鸿蒙 CLI 保留，前端后续独立 ArkTS/ArkUI 项目。macOS/鸿蒙缺设备只影响验收状态，不删除目标。源码存在、可构建、可启动、真实任务、安装态与发布分开登记。

## 模块边界（别凭目录名猜）
- `core/` — 仓颉静态库，**共享业务实现**（会话日志、投影、授权、取消/背压、执行与 JS 扩展进程驱动）。会话日志是会话/执行事实真源，文件/Git/数据库/配置仍各有权威源。
- `apps/cli/` — 独立仓颉可执行入口，也是 npm CLI 的二进制来源；用户任务命令与历史断言式自测分开，不能拿 `all` 自测代替真实任务验收。
- `apps/host/` — 仓颉 NDJSON/JSON-RPC 宿主，由桌面端 spawn；**stdout 只走协议帧，诊断走 stderr**。
- `apps/daemon/` — 仓颉服务入口，属于根 workspace；远程身份、会话归属、真实请求与部署须独立验收。旧未接线的 `DaemonScheduler` 已删除，不能据 core 调度存储存在宣称无人值守执行完成。
- `apps/desktop/` — Electron 壳（`main.cjs`/`preload.cjs`/`host-bridge.cjs`/`paths.cjs` + `renderer/`）。渲染层是**纯 JS + Vue runtime，运行时无模块加载器、无模板编译器、无 TypeScript**；第三方组件由 `scripts/pack-tinyvue.mjs` 与 `scripts/pack-tinyrobot.mjs` 在**构建期**各折叠成一个经典脚本进 `renderer/vendor/`，esbuild 与组件库都只是 `apps/desktop` 的 devDependency，**产物运行时零 npm 依赖**。消息面经 `BubbleProvider + BubbleList`（`groupStrategy: "consecutive"`）渲染，正文由本仓自定义内容渲染器出（默认链会把 `role==="tool"` 交给只渲染注释节点的 ToolRole，正文会隐身），折叠阈值只在 `renderer/msgfold.js` 一处。
- `extjs/` — 独立 Node JS 扩展宿主（NDJSON JSON-RPC），被 core 以子进程驱动。
- `npm/sacode-cli` — npm 主包（`@stand-alone/sacode`），`bin/cli.js`、`bin/daemon.js` 是入库源码；现有 `npm/sacode-cli-win32-x64` 平台包的二进制与 DLL 为生成产物，**不入库**。其他平台包及发布状态分别验证，不默认已实现。
- `scripts/pack-*.mjs` — 打包脚本（CLI / 宿主 / Vue vendor）。

## 密钥与敏感信息
- 真实API Key、Token、密码、私钥、Cookie、认证头、数据库连接凭据及包含它们的配置/.env一律不可提交；测试、夹具、文档、截图和提交说明同样适用。
- 仅提交明确无效的占位值与无秘密的配置模板；测试所需凭据从环境或专用本地存储注入，禁止写入日志和失败断言输出。
- 提交前检查实际暂存差异，不能仅依赖.gitignore。发现真实凭据立即停止提交、不回显其值，提示用户撤销/轮换；不擅自改写历史。未经明确授权不提交或推送。

## 测试目录与资产
- 规则以 `docs/testing.md` 为准：测试源码按所属模块的 `test/<功能>/` 分类；Host/CLI协议测试不因使用桌面客户端而堆在desktop。
- 测试源码、可复用驱动、假提供方和合成脱敏夹具可以入库，分别放模块 `test/`、`test/support/`、`test/fixtures/<功能>/`，不得整体塞进忽略目录。
- 仓颉 `*_test.cj` 当前保留所属源码包；迁到独立测试目录前先验证cjpm发现与包级可见性，不机械搬迁造成漏跑。
- 一次性运行输出、私有副本、日志、二进制与参考仓库留统一临时根 `apps/desktop/.tmp-test/<用途>/`；与可维护测试源码严格区分。迁移需同步修导入、脚本、CI和打包引用，核用例数及跳过原因。

## 环境
- **仓颉技能使用要求**：编写、修改或排查 `.cj` 代码前，优先使用 [Cangjie-SIG/CangjieSkills](https://gitcode.com/Cangjie-SIG/CangjieSkills) 中与任务相关的技能。先读取实际取得的仓库 README，再按技能目录读取对应 `SKILL.md` 及其引用资料；不要仅凭技能名称猜测语法或 API。
- 使用本地已安装副本时核对来源与版本；尚未取得技能或网络不可用时，明确记录限制，并以本机仓颉 1.1.3 SDK 文档、源码和编译探针核实，不宣称已使用未读取的技能。技能建议须与本项目的共享核心、授权、持久化及平台约束一致；示例通过不替代本项目测试。
- **同语言参考项目**：涉及执行隔离、平台适配、权限模型这类问题时，先看 [cangjielanguage-sig/magic-cli](https://gitcode.com/Cangjie-SIG/magic-cli)（仓颉，136 个 `.cj`）。可借鉴三点：权限 profile 用 `HashMap` 配置化而非硬编码分支（`src/sandbox/seatbelt_profiles.cj`）、机制冲突启动前 fail-fast（`sandbox_macos.cj` 查 `BUILD_SANDBOX` 即抛错）、平台不支持时明确拒绝而非静默降级（`start_sandbox.cj`）；其 FFI 也是 `ffi/raw_input_win.c` / `raw_input_linux.c` 按平台拆 C 文件 + CFFI，不是 C#。**注意 [cangjielanguage-sig/ACEHarness](https://gitcode.com/Cangjie-SIG/ACEHarness) 不是仓颉项目**（1569 文件里 `.cj` 0 个、`.cs` 0 个，实为 TypeScript + Next.js），只能参考其 Spec Driven + 状态机的工程组织方式，不能当同语言实现参考。
- **仓颉中心仓**：`https://pkg.cangjie-lang.cn` 的检索端点是 `/v1/artifact/searchPackages?keyword=<kw>`（直接 GET，返回 JSON；网页本身需 JS 渲染，抓不到）。截至 2026-10-12 扫 sandbox/win32/windows/ffi/security/acl/job/process/token/container/isolate 共 11 个关键词，命中包全是 OpenTelemetry 与 gRPC 生态，**无 Windows 安全 API 绑定**——平台能力需自己写 CFFI，仓内范本见 `core/src/procwin.cj`（kernel32）与 `core/src/filewin.cj`（CreateFileW/WriteFile/MoveFileExW）。
- 仓颉 `cjc`/`cjpm` **1.1.3**，匹配 stdx **1.1.3.1**；本机 Windows target 为 `x86_64-w64-mingw32`，不能当所有平台目标。Node ≥18（本地 v22），各依赖实际最低版本另核。
- stdx 路径核对**固定提交与工作区**：旧 `2c56c76` 的 Windows 配置仍含本机绝对路径，本批清单已改为根 `.deps/stdx/...`，`scripts/setup-stdx.mjs` 负责准备。Linux/macOS/OHOS 使用各自 `${SACODE_STDX_LIB_DIR}`；目标配置存在不等于编译已通过，工具链和 runtime 必须匹配。runner 不凭本机目录存在判通过。
- GitHub Actions 多平台构建/打包 workflow 已新增（2026-10-14），实际运行未验证，当前远端仍是 Gitee；OHOS 手动任务需配套 SDK 的 self-hosted runner。具体步骤见 `docs/build-platforms.md`，不把 YAML 存在当 PASS。无根 `package.json`，npm 命令在 `apps/desktop` 或 `npm/*` 下执行。

## 常用命令
仓颉（根 `cjpm.toml` 是 workspace，members = `core`、`apps/cli`、`apps/host`、`apps/daemon`）：
- 完整 workspace 生产构建：在仓库根执行 `cjpm build`；固定提交态覆盖全部必需成员（包括 daemon），不能由单个成员通过推导整套通过。按平台记录 Host 的适用性；Linux Host 未编是待验，不能永久因当前桌面仅有 Windows 包而排除。
- 核心单测：`cd core && cjpm test`（测试文件为 `*_test.cj`）
- **并发争用**：`cjpm test` 与 `cjpm build` 共享 `core/target/release`。并发会话各跑一条会互锁，`cjc` 挂着不退、整轮超时（2026-10-12 实测两次卡死）。**先用 `Get-CimInstance Win32_Process -Filter "Name='cjpm.exe' OR Name='cjc.exe'"` 看清命令行**，只停自己起的那些；别把别人的 `cjpm test` 当残留清掉。取基线计数要挑没有别的会话在跑的时候，否则数字不可信。
- 构建 CLI：`cd apps/cli && cjpm build`
- 构建 daemon：`cd apps/daemon && cjpm build`；构建 Host：`cd apps/host && cjpm build`。没有运行服务或真实任务的读数，只登记可构建。
- 跨平台新入口：`node scripts/setup-stdx.mjs` → `node scripts/build-platform.mjs` → `node scripts/package-platform.mjs`；非 Windows 必先构建 `.deps/native/<target>/libsacode_platform.a`（build-platform 自动调用）。新路径/清单核对 `node scripts/verify-platform.mjs`，原生后端 `node scripts/build-native.mjs --verify`，本地 npm 安装入口 `node scripts/verify-npm-install.mjs`。OHOS 只构建 core/CLI，不能在 Linux 冒充设备运行验证。

桌面（先 `cd apps/desktop && npm install`）：
- 单测：`npm test`（即 `node --test` 自动发现）。**不要写成 `node --test test/`**——本机 Node 会把目录当模块解析，整串失败。
- 跑单个用例：`node --test --test-name-pattern="<name>"`
- 冒烟：先生成宿主 `node scripts/pack-host.mjs apps/host/target/release/bin/main.exe apps/desktop/dist/host <stdx-dll-dir> <runtime-dll-dir>`，再 `npm run smoke`（期望 `SMOKE PASS`）/ `npm run ui-smoke`。dev 态宿主路径固定为 `apps/desktop/dist/host/bin/sacode-host.exe`（品牌改名后不是 `dsh-host.exe`；`host-verbs` 与 `real-provider-*` 都读它，后者可用 `SACODE_HOST` 指到别处）。重打这个目录前先看有没有活的 `sacode-host.exe`：并发会话的宿主进程会锁住 `bin/*.dll`，`pack-host` 报 `EPERM: unlink` 且重试同点同错——这时改打私有输出目录自证脚本没坏，不要清理别人的进程。
- `npm run vendor` 依次跑 `scripts/pack-vendor.mjs`（拷 Vue runtime）、`scripts/pack-tinyvue.mjs`（TinyVue 组件 → `renderer/vendor/tinyvue.iife.js` + esbuild 伴生的 `.css`）与 `scripts/pack-tinyrobot.mjs`（TinyRobot bubble 一族 → `tinyrobot.iife.js`，`dist/style.css` 原样拷成 `tinyrobot.css`）；`prestart`/`presmoke`/`preui-smoke` 自动触发。`renderer/vendor/` 已被 gitignore，属构建产物——判「产物是否可复现」要重跑 vendor 看文件是否回来，不能只 grep 脚本里有没有那个文件名。

JS 扩展宿主：`cd extjs && node --test`

打包（以下为当前 Windows 路线，不代表 Linux/macOS/OHOS 打包已实现）：
- `node scripts/pack-cli.mjs`（读 `CANGJIE_HOME`，默认 `D:\Program Files\HuaWei\Cangjie`）
- `node scripts/pack-host.mjs <exe> <outDir> <dllDirs...>`
- Electron：`cd apps/desktop && npx electron-builder`（产物在 `dist/electron/`）。若 electron 平台二进制缺失，用 `npm install electron@<ver> --foreground-scripts` 走官方源补齐，勿设镜像。
- **`github.com` 超时时的可复现构建法**（2026-10-03 实测）：`packaging` 步骤会去 github.com 取 Electron zip，超时后 electron-builder 直接 rc=1 且**产物时间戳不变**——判定「是否真拿到了新产物」要看 exe 的 mtime/体积，别把旧产物的断言当新证据。合规解法是指向本地已装的官方 dist：`npx electron-builder --config.electronDist=node_modules/electron/dist`（rc=0）；这**不是**镜像，红线仍是不设 `ELECTRON_MIRROR`。

## 必须知道的约束
- **会话日志是唯一真源**，消息/UI 都是投影。`append` 只在实例内可见，`flush` 才跨进程持久——不要把 `append` 当持久化。
- 桌面渲染层受 CSP `script-src 'self'` 约束（禁 `unsafe-eval`）：必须用 Vue **runtime** 构建 + `h()` 写视图，运行时不能引模板编译器、模块加载器或 ES module（`file://` 下会被 CORS 拦）。第三方组件库若只有 ESM 形态（TinyVue 与 TinyRobot 都是），**只能在构建期折叠**成经典脚本，且必须把 `vue` 别名到已 vendor 的那一份 runtime——装进第二份 Vue 会让组件的响应式系统与应用的不是同一套。折叠产物还必须过反证式自检：无 `new Function`/`eval`、**无残留 `import(`**（TinyRobot 的 Markdown 路径本来对外部 `markdown-it`/`dompurify` 做动态 import，实测只引 Bubble/BubbleList/BubbleProvider 时那条路径被 tree-shaking 掉，才没有留下运行时模块加载）、无裸 `"vue"` 说明符、且接上 `globalThis.Vue`。改渲染层前读 `scripts/pack-vendor.mjs`、`scripts/pack-tinyvue.mjs` 与 `scripts/pack-tinyrobot.mjs` 顶部注释。
- Electron IPC 面是按动作命名、逐字段校验的**有限**集合，**唯一权威是 `apps/desktop/preload.cjs` 里 `contextBridge.exposeInMainWorld` 的顶层 key**（2026-10-05 实测：提交态 **33** 条、工作区态 **42** 条；本文件此前那句只列了 9 条名字，是过期的历史清单，别拿它当分母，重测法见 `docs/superpowers/specs/2026-10-05-model-center-design.md` §9.2），不提供“发任意方法”通道。审批凭据只能是工单号：`toolCall` 只收 `approvalId`，渲染层传自报审批字符串没有通路。增删通道要同步改 `preload.cjs` 与 `test/bridge.test.mjs`。
- 打包态宿主路径只能从 `process.resourcesPath` 解析；缺它要 fail-loud，**绝不回退 asar 内路径**（见 `apps/desktop/paths.cjs`）。
- Windows 宿主 exe 必须与全部依赖 DLL 同目录（靠 Windows 默认搜索序，不拼 PATH）；其他平台按各自加载器与部署布局设计，不能搬用 DLL 规则或写死 `.exe`。
- `apps/desktop/test/bridge.test.mjs` 在仓库根使用 `dualtest/`（已 gitignore）；异常残留时先 `rm -rf dualtest` 再跑。
- 注释、文档、commit 一律中文；commit 形如 `feat(core,host): 描述`，scope 用 `core/host/cli/desktop/extjs/scripts/docs`。
- 不要提交构建产物：`target/`、`apps/desktop/dist/`、平台 npm 包生成的 `bin/` 与日志按 `.gitignore` 忽略。主包 `npm/sacode-cli/bin/cli.js`、`bin/daemon.js` 是源码，必须入库，不能将整个 `npm/*/bin/` 一概视为产物。
- **仓库根目录只允许已入库的源码、文档与配置**：任何临时运行产物（动态夹具、私有源码副本、日志、快照、探针输出）**严禁**散落在仓库根或任意源码目录，**一律**放进 `apps/desktop/.tmp-test/`（已在 `.gitignore` 忽略）或做完即删。此限制不适用于按 `docs/testing.md` 组织、可提交的测试源码与静态合成夹具，不能以“测试产物”为由将它们全部忽略或删除。提交前 `git status` 只要出现**未跟踪、未忽略**的顶层目录或文件，即视为违规，必须先清理干净。**禁止 `git add -A` / `git add .`**——只按文件路径精确 `git add`，杜绝把游离产物误带进提交。
