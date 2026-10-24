# AGENTS.md

## 项目定位
SaCode 是面向开发者的**可信、可控的 AI 编程工作台**，采用仓颉共享业务核心，CLI、Host、daemon 与桌面前端复用同一业务语义。产品能力为自主设计与独立实现，不以历史参考范围、模块覆盖率或警告清零作为当前产品完成标准。
改动前先读当前文档，不要靠记忆或历史 PASS 推断进度。**多 agent 并行时，动手前先按「多 agent 进度登记（强制）」在自己的 `docs/agents/<agent-id>.md` 登记在飞项，收尾同批更新；收尾前跑 `node scripts/agent-board.mjs` 自检。**
- `docs/product/PRD.md` — 现行 F01–F21 需求、授权与真实任务验收要求；其中带日期的进度表仅是当时快照。
- `docs/product/PRD-tracking.md` — F01–F21 全程跟进台账：逐域状态（完成/未完成）、缺陷登记（含证据与闭合历史）、平台快照与关键分母读数；**完成功能或闭合缺陷必须同批更新（见下「文档同步规则」）**。
- `docs/product/platform-and-distribution.md` — Windows/Linux/macOS 桌面与 CLI、鸿蒙 CLI/后续 ArkTS/ArkUI 前端、npm 与 GitHub 构建分发目标及实际验证边界。
- `docs/README.md` — 文档权威顺序、最新已登记平台读数与历史资料导航；`docs/build-platforms.md` 给出多平台与 Linux 依赖配置（原 `build-linux.md` 已并入其 §2）。
- `docs/interfaces/README.md`、`docs/integration/README.md` — 各入口面接口速查（CLI/Host/桌面 IPC/daemon/ACP/LSP）与对接方案状态总览。
需要核历史来源时再读 `docs/plans/plan-architecture-overview.md`、`docs/plans/capability-matrix.md` 与 `docs/evidence/p0-status-2026-10-02.md`，不能将其旧范围和结果当当前授权或完成状态。

## 当前最高推进优先级：先交付一个走通版本（2026-10-18 用户确认）

- **所有 IDE / AI 会话接手先读本节与 `docs/plans/product-closure-goal-2026-10-15.md` §0**；进度统一写 `docs/product/PRD-tracking.md` 顶部的当前交付卡。不要把各会话局部目标当成新的交付主线。
- 当前只推进一个最小真实闭环：**正常双击 → 配置供应商与选择模型 → 打开小项目 → AI 读取并提出文件修改 → 用户审批 → 实际修改并看见真实差异 → 关闭重开后记录和修改正确**。承诺构建/测试执行时必须真实执行成功；只聊天、假模型夹具或外部驱动代跑不能冒充编程任务走通。
- 固定顺序：**确认闭环和验收 → 固定候选源码/依赖/运行库来源 → 同源构建完整候选包 → 普通用户条件下默认安全启动与真实任务 → 用户亲手复验 → 该候选验收后再扩下一项能力**。提交、安装、收费模型请求、发布仍须各自授权；冻结源码可记录快照与哈希，不自动提交。
- 交付前**停止无关功能扩展和顺手重构**，只修阻断此闭环的必要问题；必要的安全、取消、结算与恢复不能删减，也不为假设中的未来场景无限补机制。新需求先入待办，不自动插入当前候选。
- **一个候选快照、一个对外测试入口、一个明确交付主责**。并发工作不混入正在验证的快照，不覆盖别人的差异；候选变更须更新标识并重验受影响链路，不拼旧 Host、新页面和不明 DLL。内部诊断副本不是让用户自行选择的多个版本。
- 每轮只汇报：**当前阶段/候选身份、主阻塞（其他问题另列）、本轮动作、下一步验收**。单测/接口/隔离页面通过只是局部证据；用户未走通前称“未交付”或“候选待验”，不再用“本批闭环/收官”暗示版本已可用。
- F01–F21 与全部平台目标保留，改变的是近期推进顺序，不是删除需求或放宽安全。最终用户不承担 SDK、stdx、OpenSSL 等构建环境；功能特定外部工具须提前检测说明，不以补环境、关沙箱或降低防护凑通过。

## 文档同步规则（完成功能必须同批更新）
- **完成一个功能或闭合一个缺陷时，必须同批更新产品文档**，不允许"代码先行、文档滞后"跨批次累积：
  1. `docs/product/PRD-tracking.md` — 更新对应 Fxx 行的状态、已完成事实与剩余缺口；缺陷闭合时改状态、保留历史行，附证据路径与日期；
  2. `docs/product/PRD.md` — 需求口径、验收前提或进度描述受影响时，更新对应条目；
  3. 新证据写入 `docs/evidence/`（带日期）并由台账引用；接口/契约变化同步 `docs/interfaces/README.md`，对接状态同步 `docs/integration/README.md`；
  4. 根 `CHANGELOG.md` — 同批追加本轮迭代条目（分类 / 日期 / 证据链接），保持产品迭代记录连续。
- 未取得「提交 / 入口 / 平台 / 实际运行证据」四要素前，不得在 PRD 或台账中把功能标为已完成、已验证；测试通过、页面接线、RPC 宣告各自不足以升级状态。
- 新增任何文档必须同批登记所属分类索引页（`docs/README.md` 与对应目录 README）。
- 提交、推送、安装与发布仍按各次独立授权执行；文档同步不构成对上述动作的授权。

## 多 agent 进度登记（强制，2026-10-24 新增）

多 agent 并行时，进度统一登记在 `docs/agents/<agent-id>.md`（**每个 agent 只改自己的文件**，零写冲突）；汇总看板由 `scripts/agent-board.mjs` 生成到 `docs/product/agent-board.md`。这是解决"各自开发、做完不更新进度"的机制，与本文档同步规则同为强制。

- **开工登记**：动手前先在自己的 `docs/agents/<agent-id>.md` 的"在飞"表加一行（工作包 / F 域 / 状态 / 涉及路径 / 证据 / 下一步），并更新 `- updated:`。
- **收尾更新**：完成、闭合或暂停时，同批更新该行状态与证据，并按"文档同步规则"更新台账 / evidence / `CHANGELOG.md`。
- **收尾自检**：收尾前跑 `node scripts/agent-board.mjs --write`；若 `docs/product/agent-board.md` 的"未登记告警"里出现**你改动范围内**的文件，必须先补登记（否则视为未登记违规）。
- 模板见 `docs/agents/_template.md`；格式与用法见 `docs/agents/README.md`。

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
- `apps/mobile/` — 2026-10-23 从 `sa-app` 复制导入的 KMP / KuiklyUI 手机工程，与 SaCode 同一 Git 仓库管理；原项目保留、不复制其 `.git`。Android Gradle 入口为 `:androidApp:assembleDebug`，非 `:app:assembleDebug`；鸿蒙壳独立验证。`kotlin/`、`kotlin-test/` 是原 JVM 协议客户端与 daemon 测试夹具，不能当 Android 工程或覆盖删除。手机本机 SDK 配置、凭据、签名库、缓存及产物不入库；源码导入不等于构建或真机任务通过。
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
- 一次性运行输出、私有副本、日志、二进制与参考仓库留统一临时根 `target/tmp/<用途>-<日期>-<短id>/`（可整体清空）；与可维护测试源码严格区分。迁移需同步修导入、脚本、CI和打包引用，核用例数及跳过原因。

## 环境
- **Codex / 其他 AI 首次处理仓颉构建必读（2026-10-17）**：本机仓颉编程技能入口是 `C:/Users/jingg/.workbuddy/skills/cangjie-coding/SKILL.md`；`cangjie-skill` 是拆书技能，不能用于仓颉语言语法/API。跨机器先发现实际安装位置，不假定该绝对路径存在。按该技能要求批量检索 `scripts/search_docs.py`，不得凭名称猜 API；既有 stdx 配置不得未经核对就重装或清理。
- **issue #725 自研绕过已落地并三入口实测通过（2026-10-17，Codex/AI 构建仓颉必读）**：`apps/cli/build.cj`、`apps/host/build.cj`、`apps/daemon/build.cj`（与各自 `cjpm.toml` 同级，三处字节一致），`stagePostBuild` 用 `File.readFrom`+`File.writeTo` 字节读写，按 `pack-cli-windows.mjs` 权威口径复制**完整**运行期 DLL 集：① runtime（boundscheck + libcangjie-runtime* + libcangjie-std-*，剔 ast/unittest/testmacro/prop_test 四颗测试态）② stdx（libstdx.* 剔 unittest/macro；含 opensslFFI 加载器）③ libwinpthread-1.dll（**启动必需**，SDK tools/bin 优先、PATH 兜底）④ OpenSSL 3（libcrypto/libssl-3-x64，OPENSSL_HOME→PATH）。**目标 bin 定位 `resolveBins()` 同时覆盖两个布局并去重**：成员本地 `cwd/target/release/bin`（单成员构建 exe 落点）＋ workspace 根 `<root>/target/release/bin`（workspace 构建 exe 落点）；`findRoot()` 向上找含 `[workspace]` 的 `cjpm.toml`，`ensureDirFrom()` 逐级 `Directory.create`（非递归）。**旧版 `resolveTarget` 两个候选都错**（第二候选 `../../target/release/release/bin` 多一层 release；且只认 workspace bin、漏成员本地 bin），已废。
  **正式构建入口（实测通过，Codex 用这条，勿用根 workspace 构建）**：单成员构建——`cd apps/cli && cjpm build`（host/daemon 同理）；产物 exe（`main.exe`，约 12MB）与 **80 个 DLL** 同落 `apps/<m>/target/release/bin`。跑 `cjpm build` 前**必须**前置 DLL 目录到 PATH（`build-script.exe` 自身要 runtime，cjpm 不替它上 PATH，否则钩子静默不跑、bin 里 0 个 DLL 且无报错）：
  ```
  export SACODE_STDX_DLL_DIR="/c/Users/jingg/stdx-work/stdx-1.1.3.1/windows_x86_64_cjnative/dynamic/stdx"
  export SACODE_RUNTIME_DLL_DIR="/d/Program Files/HuaWei/Cangjie/runtime/lib/windows_x86_64_cjnative"
  export PATH="$SACODE_STDX_DLL_DIR:$SACODE_RUNTIME_DLL_DIR:/d/Program Files/HuaWei/Cangjie/tools/bin:$PATH"
  export CJ_HOME="/d/Program Files/HuaWei/Cangjie"   # 可选 export OPENSSL_HOME=<含 libcrypto-3-x64/libssl-3-x64 的目录>（TLS/SSE 需要）
  cd apps/cli && cjpm build
  ```
  **运行（剥掉 SDK/stdx PATH，DLL 本地自足）**：`env PATH="/c/Windows:/c/Windows/System32" apps/cli/target/release/bin/main.exe --help`。**三真实入口已实测**（中性导出 `D:\tmp\sa-code-nv2`，干净 PATH 无 0xC0000135）：cli 打印 `usage: sacode ...`；host 输出 JSON-RPC `host/settled` 后干净退出；daemon 起 HTTP 服务 `127.0.0.1:18937` 持续运行。**仓内受限根因＝仓库根 Low Mandatory Level 标签继承**（与 D10 同源）：cjpm 子进程继承 Low 写 Medium 目标被 MIC no-write-up 拦下，中性导出（Medium）正常。**仓颉 `let` 不可变，可变局部量用 `var`**。**已知 cjpm 坑（非本修复缺陷）**：根 `cjpm build`（workspace 全量）在 core 编译后常 `exit 127`、单成员偶发 `127/139`（段错误，但产物+钩子多已生成，**重试即好**，cli/daemon 重试均 `success`）——故用单成员构建。详见 `docs/evidence/2026-10-17-cjpm-build-cj-stage-post-build-hook.md`。
- **权限排查安全边界**：仓内失败、中性目录成功仅是环境差异证据，不能直接归因某条 DACL 或完整性标签。`DENY(DC)` 表示拒绝删除子项，不等于拒绝读取；不得据此批量移除 SID、Everyone DENY、递归重置 ACL 或削弱沙箱。`std.fs.copy` 与字节读写在不同环境下的失败也不足以证明重载缺陷，须同环境对照。保留安全规则，优先复用已有中性导出流程并验证；需要权限调整时另行说明最小范围和依据并取得授权。
- **仓颉技能使用要求**：编写、修改或排查 `.cj` 代码前，优先使用 [Cangjie-SIG/CangjieSkills](https://gitcode.com/Cangjie-SIG/CangjieSkills) 中与任务相关的技能。先读取实际取得的仓库 README，再按技能目录读取对应 `SKILL.md` 及其引用资料；不要仅凭技能名称猜测语法或 API。
- 使用本地已安装副本时核对来源与版本；尚未取得技能或网络不可用时，明确记录限制，并以本机仓颉 1.1.3 SDK 文档、源码和编译探针核实，不宣称已使用未读取的技能。技能建议须与本项目的共享核心、授权、持久化及平台约束一致；示例通过不替代本项目测试。
- **同语言参考项目**：涉及执行隔离、平台适配、权限模型这类问题时，先看 [cangjielanguage-sig/magic-cli](https://gitcode.com/Cangjie-SIG/magic-cli)（仓颉，136 个 `.cj`）。可借鉴三点：权限 profile 用 `HashMap` 配置化而非硬编码分支（`src/sandbox/seatbelt_profiles.cj`）、机制冲突启动前 fail-fast（`sandbox_macos.cj` 查 `BUILD_SANDBOX` 即抛错）、平台不支持时明确拒绝而非静默降级（`start_sandbox.cj`）；其 FFI 也是 `ffi/raw_input_win.c` / `raw_input_linux.c` 按平台拆 C 文件 + CFFI，不是 C#。**注意 [cangjielanguage-sig/ACEHarness](https://gitcode.com/Cangjie-SIG/ACEHarness) 不是仓颉项目**（1569 文件里 `.cj` 0 个、`.cs` 0 个，实为 TypeScript + Next.js），只能参考其 Spec Driven + 状态机的工程组织方式，不能当同语言实现参考。
- **仓颉中心仓**：`https://pkg.cangjie-lang.cn` 的检索端点是 `/v1/artifact/searchPackages?keyword=<kw>`（直接 GET，返回 JSON；网页本身需 JS 渲染，抓不到）。截至 2026-10-12 扫 sandbox/win32/windows/ffi/security/acl/job/process/token/container/isolate 共 11 个关键词，命中包全是 OpenTelemetry 与 gRPC 生态，**无 Windows 安全 API 绑定**——平台能力需自己写 CFFI，仓内范本见 `core/src/procwin.cj`（kernel32）与 `core/src/filewin.cj`（CreateFileW/WriteFile/MoveFileExW）。
- 仓颉 `cjc`/`cjpm` **1.1.3**，匹配 stdx **1.1.3.1**；本机 Windows target 为 `x86_64-w64-mingw32`，不能当所有平台目标。Node ≥18（本地 v22），各依赖实际最低版本另核。
- stdx 路径核对**固定提交与工作区**：旧 `2c56c76` 的 Windows 配置仍含本机绝对路径，本批清单已改为根 `.deps/stdx/...`，`scripts/setup-stdx.mjs` 负责准备。Linux/macOS/OHOS 使用各自 `${SACODE_STDX_LIB_DIR}`；目标配置存在不等于编译已通过，工具链和 runtime 必须匹配。runner 不凭本机目录存在判通过。
- **运行期 DLL 路径约定（防 0xC0000135；codex 必读）**：`.deps/stdx/` 是**编译期** `bin-dependencies` 来源，**不作运行期 DLL 路径**。运行期靠两个环境变量（项目作用域、不动系统 PATH、不改 SDK `envsetup.ps1`）：
  - `SACODE_STDX_DLL_DIR`（兜底 `C:/Users/jingg/stdx-work/stdx-1.1.3.1/windows_x86_64_cjnative/dynamic/stdx`，本机已装的独立 stdx 包；**SDK 不自带 stdx**）
  - `SACODE_RUNTIME_DLL_DIR`（兜底 `D:/Program Files/HuaWei/Cangjie/runtime/lib/windows_x86_64_cjnative`，SDK envsetup.ps1 注入的目录之一）
  - spawn sa-code CLI/Host/daemon 子进程时，PATH 必须前置这两段，否则剥掉 SDK 后入口处 0xC0000135（11 个 `libstdx.*.dll` 静态缺失 + `libcangjie-runtime.dll`/`libboundscheck.dll`/`libwinpthread-1.dll` 闭包）。本仓 5 个 CLI 测试夹具（`worktree/remote/team-command/tips-surface/knowledge`）统一约定：拷 `process.env` 后前置 stdx+runtime 到 PATH；**不要写硬白名单只留 path/systemroot/windir/temp/tmp**（会丢 stdx → 0xC0000135，2026-10-17 实测踩坑）。上游 `atomgit.com/Cangjie/cangjie_tools/issues/725`（cjpm build 不复制 bin-dependencies 的 dll），修法不可预期，本仓内化此约定作长期绕过。0xC0000135 第一次遇到先做 PE 导入闭包排查（`target/tmp/cli-dll-probe/pe-imports.mjs`），不要先怀疑功能逻辑。

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
- Electron IPC 面是按动作命名、逐字段校验的**有限**集合，**唯一权威是 `apps/desktop/preload.cjs` 里 `contextBridge.exposeInMainWorld` 的顶层 key**（2026-10-16 门禁实测工作区 **138** 条，`check_ipc_surface_parity.cjs` 138/138 通过；2026-10-05 的 33/42 旧读数已废止，别再当分母。重测：`grep -cE '^  [A-Za-z0-9_]+:' apps/desktop/preload.cjs`），不提供“发任意方法”通道。审批凭据只能是工单号：`toolCall` 只收 `approvalId`，渲染层传自报审批字符串没有通路。增删通道要同步改 `preload.cjs` 与 `test/bridge.test.mjs`。
- 打包态宿主路径只能从 `process.resourcesPath` 解析；缺它要 fail-loud，**绝不回退 asar 内路径**（见 `apps/desktop/paths.cjs`）。
- Windows 宿主 exe 必须与全部依赖 DLL 同目录（靠 Windows 默认搜索序，不拼 PATH）；其他平台按各自加载器与部署布局设计，不能搬用 DLL 规则或写死 `.exe`。
- 桌面真宿主用例的一次性目录统一落 `target/tmp/`（如 `target/tmp/dualtest/…`）；旧 `dualtest/` 已退役，仓库根不再新建临时目录；残留成片时按各用例自建的 `mkdtemp` 目录名清理。
- 注释、文档、commit 一律中文；commit 形如 `feat(core,host): 描述`，scope 用 `core/host/cli/desktop/extjs/scripts/docs`。
- 不要提交构建产物：`target/`、`apps/desktop/dist/`、平台 npm 包生成的 `bin/` 与日志按 `.gitignore` 忽略。主包 `npm/sacode-cli/bin/cli.js`、`bin/daemon.js` 是源码，必须入库，不能将整个 `npm/*/bin/` 一概视为产物。
- **仓库根目录只允许已入库的源码、文档与配置**：任何临时运行产物（动态夹具、私有源码副本、日志、快照、探针输出）**严禁**散落在仓库根或任意源码目录，**一律**放进 `target/tmp/`（随 `**/target/` 全局忽略）或做完即删。此限制不适用于按 `docs/testing.md` 组织、可提交的测试源码与静态合成夹具，不能以“测试产物”为由将它们全部忽略或删除。提交前 `git status` 只要出现**未跟踪、未忽略**的顶层目录或文件，即视为违规，必须先清理干净。**禁止 `git add -A` / `git add .`**——只按文件路径精确 `git add`，杜绝把游离产物误带进提交。
