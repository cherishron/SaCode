# SaCode

SaCode 是面向开发者的**可信、可控的 AI 编程工作台**。仓颉（Cangjie）共享核心驱动 CLI、Host 与 daemon，桌面和终端入口复用同一套授权、取消、恢复与结算语义。

> 目标是完成真实开发任务并交付可信、可控的产品能力，不以编译警告清零或历史参考范围作为完成标准。

产品需求见 [PRD](docs/product/PRD.md) 与 [全程跟进台账](docs/product/PRD-tracking.md)，平台、npm 分发与 GitHub 构建要求见 [平台支持与分发](docs/product/platform-and-distribution.md)，接口与对接见 [接口总览](docs/interfaces/README.md) 与 [对接方案](docs/integration/README.md)，历史证据与阅读顺序见 [文档导航](docs/README.md)，产品迭代记录见 [CHANGELOG](CHANGELOG.md)。

## 平台目标与当前状态

| 平台 | CLI / 服务目标 | 前端目标 | 当前已登记证据 |
| --- | --- | --- | --- |
| Windows | 必须支持 | Electron 桌面 | 有历史构建与运行证据；当前版本真实任务和统一交付仍须独立验收 |
| Linux | 必须支持 | Electron 桌面 | 用户实测 `2c56c76` 的 core/CLI/daemon 构建通过，CLI 约 14 MB；Host 与桌面未验收 |
| macOS | 必须支持 | Electron 桌面 | 本项目构建/运行未验证；缺设备不移出目标范围 |
| 鸿蒙 / OHOS | CLI 必须支持；共享服务与部署条件分别核 | 后续独立 ArkTS/ArkUI 前端 | stdx 有 OHOS 资产；匹配仓颉工具链、项目交叉构建与设备运行均待验证 |

**支持目标不等于已经可用。** Linux 下一步是桌面真实任务可用，并为 macOS 保留适配；OHOS CLI 在 Linux 上独立验证交叉工具链，不将 GNU/Linux 二进制当鸿蒙产物。非 Windows 持久文件、进程判活与系统取消仍有缺口，不能以安装包生成或 `--help` 成功冒充任务验收。

CLI 分发采用 npm 薄启动包 + 原生平台包及压缩包/校验和路线。2026-10-14 本批新增多平台打包和 GitHub Actions workflow，但尚无真实 Actions 或各平台安装任务通过记录，也未正式发布 npm。Linux 桌面与 OHOS CLI 的具体复验步骤见 [多平台构建指南](docs/build-platforms.md)，不能宣称鸿蒙应用沙箱已支持任意进程执行。

## 版本与目录结构

SaCode 采用仓颉共享核心、CLI 与桌面入口，并提供独立 daemon 源码。仓颉配置要求 **cjc 1.1.3**，匹配 **stdx 1.1.3.1**；具体包版本以各清单为准，组件版本对齐仍需交付验收，不把版本号当完成声明。现行产品范围按 PRD 的 **F01–F21 共 21 个能力域**组织；历史能力矩阵仅用于追溯，不作为当前产品完成率。

| 路径 | 说明 |
| --- | --- |
| `core/src/` | 仓颉框架源码与 `*_test.cj` 单测；`core` 编译为静态库，是共享业务实现 |
| `apps/cli/` | 独立仓颉 CLI 项目，通过路径依赖引用 `core` |
| `apps/host/` | 桌面使用的仓颉 NDJSON / JSON-RPC 宿主，通过路径依赖引用 `core` |
| `apps/daemon/` | 独立仓颉 daemon 项目；远程转发与会话归属须独立验收 |
| `apps/desktop/` | Electron 桌面项目，含主进程、有限 IPC、页面源码与 Node 测试 |
| `apps/mobile/` | 从 sa-app 导入的 KMP / KuiklyUI 手机工程（Android 应用与鸿蒙壳）；同一 Git 仓库管理，构建与真机接入另验；`kotlin/`、`kotlin-test/` 是保留的独立 JVM 协议测试 |
| `extjs/` | 独立 Node.js 扩展宿主与测试 |
| `npm/sacode-cli/` | npm CLI / daemon 启动包装源码；无需依赖桌面进程 |
| `npm/sacode-cli-win32-x64/` | 现有 Windows x64 平台包配置；二进制与 DLL 为生成产物，其他平台待接入 |
| `cjpm.toml` / `cjpm.lock` | 仓颉工作区配置与依赖锁定；成员为 core、CLI、Host、daemon |
| `scripts/` | vendor 折叠、宿主与 CLI 打包、交付检查脚本 |
| `docs/` | 产品需求、设计方案、接口/对接总览、历史能力矩阵与实测证据 |
| `.deps/stdx/` | 本机构建所需 stdx 依赖目录，不入库，首次构建前需准备 |

本仓库没有采用示例中的 `v1/v2` 归档目录，也没有三大案例项目。CLI、Host 和 daemon 是引用共享核心的独立可执行项目，不能将它们描述成已验收的应用案例。

## 当前源码入口与目录约定

本分支采用仓颉工作区，根 `cjpm.toml` 的成员为 `core`、`apps/cli`、`apps/host`、`apps/daemon`。桌面源码唯一入口是 **`apps/desktop/`**：其 `package.json` 定义 Electron 启动及安装包构建，`main.cjs` 是主进程入口，`renderer/` 是页面源码。根目录 `desktop/` 曾留下空 `dist/`，没有源码或构建配置，不属于第二套桌面实现，现已清理。

| 内容 | 唯一位置 |
| --- | --- |
| 桌面主进程、预加载和页面 | `apps/desktop/` |
| 构建期 TypeScript 页面源码 | `apps/desktop/renderer/pages/`（编译为 vendor 经典脚本） |
| 桌面协议及交互冒烟支持 | `apps/desktop/test-support/`（仅显式冒烟模式加载） |
| 桌面调用的仓颉宿主源码 | `apps/host/src/` |
| CLI、Host 与 daemon 共享仓颉业务核心 | `core/src/` |
| 开发态自包含宿主（生成文件） | `apps/desktop/dist/host/bin/` |
| Electron 安装包及解包目录（生成文件） | `apps/desktop/dist/electron/` |
| 页面第三方库折叠产物（生成文件） | `apps/desktop/renderer/vendor/` |

不要编辑 `dist/`、`win-unpacked/resources/app.asar` 或已安装目录中的文件来替代源码改动。旧分支的 Rust/Tauri 路径不属于本分支构建入口；历史证据中的旧产品名及产物名仅用于追溯。输出目录中多个同版本文件可能来自不同时间的构建，最终交付须核对当前源码、Host 和产物，而不是只看版本号或文件存在。

## 这是什么

SaCode 使用自有 Agent 组织改码、验证、差异审查与恢复，并经 ACP 委派外部 Agent、经 LSP 获取真实语义结果。全部业务能力为自主设计与独立实现，保持自身架构、数据格式与扩展契约的一致。以下为已有源码能力索引，不是全部平台、入口或安装态通过声明：

- 会话日志（append/flush 持久化屏障、损坏尾帧截断、崩溃恢复合成、写租约与残留接管）
- 投影（派生消息，纯函数、引用门控：无关事件不重建，命中缓存返回同一引用）
- 审批工单（`ask → answer → 一次性消费`，`asked/decided/expired` 落进同一份日志；协议面上不认调用方自报的审批字符串）
- 取消与背压（`TurnToken` 协作式取消、有界投递队列）
- JS 扩展宿主子进程驱动（NDJSON JSON-RPC，按 `callId` 配对与取消）
- CLI、Host、daemon 与 Electron 桌面适配入口，npm 薄启动包与现有 Windows 平台包
- 桌面渲染层（Vue 3 runtime + IPC 有限面，流式/审批/取消有真机断言；TinyVue 组件经构建期折叠接入）

TinyRobot 消息组件与 HTTPS/SSE provider 已有源码接入。近期工作重点是页面工具进入共享执行授权链、真实模型任务闭环、ACP 委派/LSP 结果进入工作台，以及同源码 Host/CLI/桌面重建和安装后任务。Windows 中断实现不能推导 POSIX 信号已支持；各平台真实取消、持久化、进程监督与系统依赖须独立验收。旧 P0 和桌面历史记录仅说明其注明日期的状态。

## 架构

```
                 +---------------------+
   CLI 入口 ----> |                     |
  npm 平台包      |   core (仓颉静态库)  | <---- apps/host (JSON-RPC 宿主) <---- Electron 桌面
                 |  会话日志唯一真源    |
                 +----------+----------+
                            | 子进程驱动
                            v
                    extjs/ (Node JS 扩展宿主, NDJSON JSON-RPC)
```

| 目录 | 职责 |
| --- | --- |
| `core/` | 仓颉静态库，共享授权、执行、会话与恢复实现；会话记录和文件/Git等各自权威源分开 |
| `apps/cli/` | 仓颉可执行入口，同时是可断言自测的 CLI，也是 npm CLI 的二进制来源 |
| `apps/host/` | 仓颉 NDJSON / JSON-RPC 宿主，由桌面端 spawn；stdout 只走协议帧 |
| `apps/daemon/` | 仓颉服务入口；远程身份、会话与运行验收独立，不复制 core 业务 |
| `apps/desktop/` | Electron 壳 + Vue 3 runtime、TinyVue/TinyRobot 页面；第三方库构建期折叠为经典脚本 |
| `extjs/` | 独立 Node JS 扩展宿主（NDJSON JSON-RPC），被 core 以子进程驱动 |
| `npm/sacode-cli`、`npm/sacode-cli-win32-x64` | npm 启动主包与现有平台包；主包 JS 入库，平台二进制生成、不入库 |
| `scripts/pack-*.mjs` | 打包脚本（CLI / 宿主 / Vue vendor） |
| `docs/` | `plans/`（方案与能力矩阵）、`interfaces/`・`integration/`（接口与对接总览）、`evidence/`（实测证据与阻塞项） |

## 核心能力与模块

下表是当前源码的阅读索引，按能力分组，不代表每组已经完成双入口或真实环境验收。对应的 `*_test.cj` 文件是测试源码，不把文件数、断言数或历史通过数混称为当前通过的测试数。

| 能力组 | 主要源码（位于 `core/src/`） | 职责与边界 |
| --- | --- | --- |
| 会话、持久化与投影 | `session.cj`、`lease.cj`、`message_projection.cj`、`storage.cj` | 事件记录、写租约、消息投影与存储；append 与 flush 的可见性不同 |
| Agent 与模型调用 | `agent.cj`、`model_agent.cj`、`model_request.cj`、`sse.cj` | 任务循环、模型请求与流式响应；真实供应商调用另需凭据与运行验收 |
| 模型管理与凭据 | `model_catalog.cj`、`model_router.cj`、`provider_registry.cj`、`credential.cj` | 模型目录、路由、供应商与凭据管理；不将密钥当普通配置公开 |
| 工具、文件与执行 | `fs_tools.cj`、`model_tool_runtime.cj`、`jobs.cj`、`term.cj` | 文件操作、模型工具调用、后台任务与终端能力；受观察与授权边界约束 |
| 审批、权限与取消 | `approval.cj`、`permission_policy.cj`、`sandbox.cj`、`cancel.cj` | 审批工单、权限策略、沙箱与协作式取消；不允许调用方自报审批结果 |
| 计划、目标与自动化 | `plan.cj`、`todo.cj`、`goal_runner.cj`、`goal_scheduler.cj`、`schedule.cj` | 计划、待办、持续目标与调度；登记状态不等于无人值守执行闭环 |
| 插件、技能与 MCP | `plugin_manifest.cj`、`plugin_assembly.cj`、`plugin_lifecycle.cj`、`skill.cj`、`mcp_client.cj` | 插件声明、装配、生命周期、技能注册与 MCP 客户端；技能注册不等于市场下载安装 |
| 委派、团队与 ACP | `subagent.cj`、`team.cj`、`team_runner.cj`、`acp_contract.cj`、`acp_process.cj` | 委派协议、团队协作与外部 Agent 进程；入口覆盖与端到端效果单独验收 |
| 浏览器、电脑与网络 | `browser_executor.cj`、`computer_executor.cj`、`web_fetch.cj`、`web_search.cj`、`ssh.cj` | 外部能力执行与网络访问；依赖提供者、目标环境及独立授权 |
| 工作区、附件与交付 | `workspace.cj`、`worktree.cj`、`attach.cj`、`deliverables.cj` | 工作区、Git worktree、附件引用与交付记录；不能把界面展示当实际副作用 |
| 配置、上下文与审计 | `settings.cj`、`sysprompt.cj`、`compact.cj`、`request_trace.cj`、`remote_audit.cj` | 设置、系统提示、压缩状态、请求轨迹与远程审计；完整摘要与回放按专项验证 |

### 共享核心引用方式

`core/cjpm.toml` 的 `output-type = "static"`，入口项目以路径依赖引用同一份核心，不各自实现业务规则。例如 CLI 的依赖配置为：

```toml
[dependencies]
core = { path = "../../core" }
```

仓颉入口源码通过 `import core.*` 使用共享能力。桌面页面不直接引用仓颉库，而是经有限 IPC、Host JSON-RPC 调用核心；`extjs` 是被核心驱动的独立扩展进程。

### 实现与验收口径

- **源码存在**：只能证明当前工作区有实现或接口，不证明已构建、接通或可用。
- **入口接通**：需要核对 CLI / Host / IPC / 页面调用链，不能只看核心单测。
- **产品验收**：需要真实任务、失败与恢复、授权边界及新构建产物的运行证据。
- **测试计数**：以本次实际执行的结果和退出码为准；跳过、取消、环境阻塞分别说明，不写死一个会随源码变化的总数。

详细范围见 [产品需求](docs/product/PRD.md)，历史能力索引见 [能力矩阵](docs/plans/capability-matrix.md)，历史实测与限制见 [证据记录](docs/evidence/p0-status-2026-10-02.md)。这些文档均需结合记录日期和当前源码阅读，旧 PASS 不代替本轮验证。

## 环境要求

- **仓颉工具链**：`cjc` / `cjpm` **1.1.3**、匹配 **stdx 1.1.3.1**，编译器/运行库/扩展库均需匹配目标平台；OHOS 工具链组合待核
- **Node.js** ≥ 18；实际版本须满足当前桌面依赖的要求，本次命令实际使用 v22.23.2
- 本机开发环境为 **Windows x64**；用户已有 Linux 构建环境。Windows DLL 加载规则只是该平台的部署前提，不是全项目仅支持 Win32 的定位
- GitHub Actions workflow 已新增，当前远端为 Gitee，GitHub 实际运行待同步仓库后验证；无根 `package.json`，npm 相关命令在 `apps/desktop` 或 `npm/*` 下执行

> `2c56c76` 的 Windows 配置仍含开发者绝对路径；本批清单已改为根 `.deps/stdx/...` 相对路径，新增 `scripts/setup-stdx.mjs` 准备依赖。Linux/macOS/OHOS 需各自匹配的 `SACODE_STDX_LIB_DIR`，不能复用另一平台目录。`.deps/` 不入库，runner 从官方资产准备；步骤见 [构建指南](docs/build-platforms.md)。

## 快速开始

以下桌面与 `.exe` 示例为**当前 Windows 开发路线**；不是 Linux/macOS/OHOS 的可执行部署说明。完整生产构建须覆盖固定提交的 core、CLI、Host 与 daemon（根 workspace 的 `cjpm build` 或逐成员串行记录），并遵守编译争用限制。Linux 已验证的依赖设置见 [多平台构建指南](docs/build-platforms.md) §2（原 `build-linux.md` 已并入），鸿蒙交叉步骤待工具链核实。

### 1. 核心（仓颉）

```bash
cd core
cjpm build         # 构建共享静态库
cjpm test          # 运行全部 *_test.cj 单测
```

### 2. CLI（仓颉）

```bash
cd apps/cli
cjpm build
./target/release/bin/main.exe --help  # 查看当前版本的用户命令
```

历史 `seed | projection | all | stream | tool | ext | cancel | extjs | sig` 是断言式自测入口，不能替代用户任务、授权和安装态验收。本次文档整理不运行这些旧自测。

### 3. 打包自包含宿主（桌面运行的前置）

宿主 exe 必须与全部依赖 DLL 同目录（依赖 Windows 默认搜索序，不拼 PATH）：

```bash
node scripts/pack-host.mjs \
  apps/host/target/release/bin/main.exe \
  apps/desktop/dist/host \
  <stdx-dll-dir> <runtime-dll-dir>
```

打包前先在 `apps/host/` 执行 `cjpm build`；上述 `<stdx-dll-dir>` 与 `<runtime-dll-dir>` 是需要替换的本机目录，不是可原样执行的参数。HTTPS 调用还需按部署环境准备信任锚，打包脚本支持 `--ca-bundle=<PEM 文件>`。

dev 态宿主路径固定为 `apps/desktop/dist/host/bin/sacode-host.exe`。输出目录存在活跃宿主时不要直接覆盖，避免锁住 DLL 或影响其他会话。

### 4. 桌面（Electron）

```bash
cd apps/desktop
npm install
npm start            # prestart 会自动执行 npm run vendor
```

冒烟测试：

```bash
npm run smoke        # 期望输出 SMOKE PASS
npm run ui-smoke     # 渲染层真窗口断言
```

### 5. JS 扩展宿主

```bash
cd extjs
node --test
```

## 测试

| 范围 | 命令 |
| --- | --- |
| 仓颉核心 | `cd core && cjpm test` |
| 桌面通信层与路径 | `cd apps/desktop && npm test`（即 `node --test` 自动发现） |
| 单个桌面用例 | `node --test --test-name-pattern="<name>"` |
| JS 扩展宿主 | `cd extjs && node --test` |

> 桌面单测**不要**写成 `node --test test/`——本机 Node 会把目录当模块解析，导致整串失败。
> 桌面真宿主用例的一次性目录统一落 `target/tmp/`（如 `target/tmp/dualtest/`）；旧 `dualtest/` 已随临时根迁移退役，异常残留按各用例自建目录清理。

## 打包

```bash
# npm CLI 平台包：读取 CANGJIE_HOME（默认 D:\Program Files\HuaWei\Cangjie）
node scripts/pack-cli.mjs
node npm/sacode-cli/bin/cli.js --help  # 本地按现有平台包启动；不表示已发布 registry

# Electron 安装包（产物在 apps/desktop/dist/electron/）
cd apps/desktop && npx electron-builder
```

## 产品架构与安全约束（改代码前必读）

- **会话日志是会话与执行事实真源**：消息与执行 UI 是投影。`append` 只在实例内可见，`flush` 才跨进程持久；文件/Git/数据库/配置保留各自权威源。
- 桌面渲染层受 CSP `script-src 'self'` 约束（禁 `unsafe-eval`）：只能用 Vue **runtime** 构建 + `h()` 写视图，运行时不能引入模板编译器、模块加载器或 ES module（`file://` 下会被 CORS 拦）。只有 ESM 形态的第三方组件库（如 TinyVue）必须在**构建期**由 `scripts/pack-tinyvue.mjs` 折叠成单个经典脚本，并把 `vue` 别名到已 vendor 的那份 runtime——出现第二份 Vue 时组件的响应式跟的就不是同一套。
- Electron IPC 面是按动作命名、逐字段校验的**有限集合**，不提供「发任意方法」通道；增删通道要同步改 `preload.cjs` 与 `test/bridge.test.mjs`。
- 打包态宿主路径只能从 `process.resourcesPath` 解析，缺失时必须 fail-loud，绝不回退 asar 内路径。
- 注释、文档、commit 一律使用中文；commit 形如 `feat(core,host): 描述`。

构建产物不入库：`target/`、`apps/desktop/dist/`、平台 npm 包生成的二进制与日志按 `.gitignore` 忽略；主包 `npm/sacode-cli/bin/cli.js` 与 `bin/daemon.js` 是源码，必须入库。

## 许可

本项目采用**木兰宽松许可证，第2版（MulanPSL-2.0）**，SPDX 标识符 `MulanPSL-2.0`，详见 `LICENSE`。
