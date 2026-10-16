# 新目标：主页面、工作台资源与真实开发任务闭环

## 目标与完成定义

按现行 PRD，完整接通知识库、自动化、连接管理三个主页面，以及构建测试、安全扫描、部署、记忆、技能与 MCP、来源、产物七类工作台资源。实施主轴为：文件编辑 → 受控执行/构建测试 → 差异审查 → 分别授权的 Git 操作。

源码、核心测试、接口可调用、页面可操作、真实服务、当前产物分别取证。全部链路及对应失败/取消/恢复门槛通过才完成；不按页面或模块数量计算完成率，不删除保留需求。ACP 已移交，保持其归属；LSP 作为文件与代码理解依赖单列，不因本目标擅自接管 ACP。

## 当前快照与证据限制

- 2026-10-15 只读核对 HEAD：`4b42b52`，分支 `refactor/dsh-learning`。存在大量未提交公共改动；本批不提交、推送、回滚或清理。
- 最新提交 `d03a9f1` 新增导入与扫描适配器；`4b42b52` 更新测试分类/密钥规则。扫描适配器明确只处理数据，不执行扫描、不提供 UI/IPC。
- 前一轮知识库日志/产物路径 `apps/desktop/.tmp-test/knowledge-focused`、`knowledge-check` 当前不存在。历史文档保留原结论，但当前快照须重新取证。
- 默认桌面 `dist/host/bin/sacode-host.exe` 文件时间仍为 2026-10-11 18:27:06，大小 11183104 字节；无当前源码载荷一致性证据。
- 本轮六份前端/链路测试合计 39，35 通过、4 失败、0 跳过，rc=1。失败涉及默认 Host 的编辑、执行、Git 路径，其中三例 `host-gone: exit code 3221225477`，一例无任务投影；根因待核，不能断言为新源码回归或单一环境原因。
- 追加执行 `apps/desktop` 下 `node --test test/file-editor-recovery.test.mjs test/git-workbench.test.mjs`：16 项中 14 通过、2 失败，失败均为真实 Host 测试收到 `host-gone: exit code 3221225477`；纯编辑器恢复、Git 状态解析/迟到保护和有限 IPC 通过。被调用的默认 Host `dist/host/bin/sacode-host.exe` 时间 2026-10-11 18:27:06，11,183,104 字节，SHA-256 `73131303DEF182F3F5728E09DE9D15265AA95137DD97CD0A25BEBF7A4B0519CC`。普通进程查询未列出 cjpm/cjc/Host；未杀进程。
- BASE-01 首次隔离复验（2026-10-15）：仓颉 1.1.3 的 cjc -v 正常；此前一次独立 cjpm --version 与私有目标 core 构建均以 3221225477（0xC0000005）退出、无输出。用户提出 SDK 可能被占用后再次复验：在未见 cjpm/cjc 进程时，唯一临时目录中的 cjpm --version 无输出并挂起约 35 秒；由本会话中断，未取得自然退出码。其间出现不可读取命令行/启动时间的 PID 23216，进程查询被拒绝；未触碰该进程。结束后未见 cjpm/cjc。重试尚不能区分 SDK 占用、cjpm 启动故障或其他环境因素；本次没有运行 core 构建。未改 SDK 或用户配置。当前源码 Host/CLI 构建仍待验证。
- 2026-10-15 修复 SDK 后的最新基线：官方安装路径 `D:/Program Files/HuaWei/Cangjie` 下 `cjc -v`、`cjpm --version` 均正常。当前工作区源码 `core`、`apps/host`、`apps/cli` 分别使用独立 `.tmp-test` target 执行 `cjpm build`，退出码均为 0；`core` 构建有 25 条警告。未构建桌面安装包、未覆盖 `dist`，没有安装或发布。
- 新编 Host 真实回归：私有 Host 配合 Cangjie runtime 与仓库 stdx 动态库路径，文件编辑恢复 + 真实 Git/Host 只读用例 16/16 通过，自动化 Host RPC 只读用例 1/1 通过。另重放真实 Host 工作区修订→提案→逐字审批→授权→监督门禁拒绝启动→停止→重载恢复，退出码 0；未执行命令，日志没有 `owned-subprocess`，Host 正常退出。
- 执行页面测试 `execution-task.test.mjs` 为 8/9；唯一失败在其真实 Host 用例，夹具将子进程 PATH 限为 Windows `System32`，遗漏 Cangjie runtime/stdx 动态库；并发修改中的测试文件本轮未改。全量核心测试编译超过半小时仍未生成 `core.exe` 或摘要，由本会话终端中断，退出码 1，不计通过且没有遗留测试进程。
- 自动化页面/IPC/Host RPC 与产品管理测试本轮 18/18 通过。初次快照的真实写入结论由下方 2026-10-15 复验更新：UTC 配置可以经真实 Host 持久化；命名时区仍受 Windows 时区数据缺失阻塞；调度器仍是 `executorAvailable=false`。
- 2026-10-15 复验（修复后的 Cangjie 1.1.3，HEAD `4b42b52` 的脏工作区）：`core`、Host、CLI 使用独立 target 的 `cjpm build` 均退出 0；Host 自包含候选 `apps/desktop/.tmp-test/host-pack-self-contained-ddd244a134ca454fbd6900998aa99793/bin/sacode-host.exe` SHA-256=`ABD787454AB2C465B85765D37B25399FC1C6A9E0F026943302112F079D13B55B`。知识库 Host/IPC/页面/Electron 夹具用该 Host 和刚构建 CLI 执行 `node --test --test-concurrency=1 test/knowledge-host.test.mjs test/knowledge-ipc.test.mjs test/knowledge-page.test.mjs test/knowledge-electron.test.mjs`，9/9 通过、无跳过；覆盖用户/项目隔离、CAS、来源失效、越界拒绝、重启恢复、CLI 读取、本地 loopback 假模型请求及 Electron 页面保存/搜索/引用。Electron 使用独立 `--no-sandbox` 验收夹具，不代表默认安装态；该用例没有验证损坏日志回放或完整桌面外壳。临时根为 `apps/desktop/.tmp-test/knowledge-ui/run-0UrmXE`，隔离 TEMP/TMP 为 `apps/desktop/.tmp-test/knowledge-host-suite-a1e0f5e71ed540c0a9f1b5ef8a5810ca`。
- 同一自包含 Host 的自动化写入探针只使用私有设置、私有工作区和本地假模型，无模型请求：`UTC` 保存成功，回执 `revision=1`、`executorAvailable=false`，Host 退出 0（`automation-timezone-verification-pXy3Dm`）；完整 CRUD/CAS/重启流程另见 `automation-write-host-riiAUw` 的私有日志。无 `CJ_TZPATH` 时，`Asia/Shanghai` 保存返回 `automation-request-rejected` 且未产生定义（`automation-timezone-verification-lavYrY`）。因果已用同一 Host 验证：从 [PyPI tzdata 2026.5](https://pypi.org/project/tzdata/2026.5/) 临时提取 625 个已编译 IANA TZif 文件，设置 `CJ_TZPATH` 后保存成功、`revision=1`、Host 退出 0（`automation-timezone-data-probe-FDH124`）；数据探针目录 `apps/desktop/.tmp-test/tzdata-verify-b8235aa2550b499da3f7e8c6777bcc25`，wheel SHA-256=`B683BD1B6659DDCD810FF02AD09BA821D4BF1065072805063EB35C49617905AC`，`Asia/Shanghai` TZif SHA-256=`BF8B7ED82FE6E63E6D98F8CEA934EEAC901CD16ABA85EB5755CE3F8B4289EA8A`。数据只在隔离临时目录下载/解压，未安装、未进入产品载荷；[IANA 说明](https://data.iana.org/time-zones/tz-link.html)确认其数据库通过 `zic` 编译为各地区的 TZif 文件。结论是自动化保存逻辑可用，当前 Windows 载荷缺 zoneinfo 数据发现/打包/Host 环境接线，且缺数据时错误被压成通用拒绝。执行器仍未实现，也没有触发自动化任务。 该项是 2026-10-15 的结论，已由下方 2026-10-16 当前源码 Host 复验更新。
- 最新报告页接线与 SDK 复验记录：docs/evidence/2026-10-15-build-test-page-and-cjpm-retry.md；前一轮审计日志：apps/desktop/.tmp-test/product-closure-audit-current.txt。仓颉编译器现场为 1.1.3，target x86_64-w64-mingw32。

- 2026-10-16 复验（修复后的 Cangjie 1.1.3；源码基线 HEAD `4b42b5268635a1b30a910214c98dcb139d6a0ec9`、`refactor/dsh-learning`，工作区仍有未提交改动）：`node scripts/build-platform.mjs` 在私有 `apps/desktop/.tmp-test/platform-build/win32-x64` 构建 core、CLI、Host、daemon，4/4 `cjpm build` rc=0；`build.json` 的设备运行字段仍为 false。core 25、CLI 4、Host 4、daemon 6 条编译警告。新 Host 候选经 `scripts/pack-host.mjs` 打到 `private-host-payload/bin`，输出包含 628 个 zoneinfo 文件（含许可证和元数据）；Host SHA-256=`01bb85649081c77dab7b6eb6cb76e11f4258a5016c37c4f8df23d4042461687a`，`Asia/Shanghai` SHA-256=`bf8b7ed82fe6e63e6d98f8cea934eeac901cd16aba85eb5755ce3f8b4289ea8a`，固定 tzdata 2026.5 源包 SHA-256=`8cc73c0a0bfca7dbfa59235d60b2eff82231dee33f53d206db1acd9173cfc0a7`。Windows `TimeZone.load` 活动契约由 `cangjie-coding` 检索确认：`CJ_TZPATH` 可用分号多路径并按顺序查找；桌面 HostBridge 保留已有路径顺序并追加随包目录。父环境未设 `CJ_TZPATH` 时用该 Host 跑自动化时区、文件编辑、模型写入审批和工作区用例共 14/14，rc=0，日志 `apps/desktop/.tmp-test/platform-build/win32-x64/host-timezone-file-edit-regression.log`。同类 paths/pack-host/automation-page/manifest 测试 27/27，rc=0，`node scripts/verify-platform.mjs` PASS 70，日志 `zoneinfo-packaging-tests.log`。另一次将 Host 写测试默认 `%TEMP%` 用作根目录时，13 项中 8 通过、5 项因 `already-owned` 失败；同一测试改用本轮私有 repo-local TEMP 后 13/13 通过。只确认失败与临时目录路径相关，未确认根因，暂不改生产租约逻辑。隔离 CLI 包装探针因 SDK/PATH 找不到 `libgcc_s_seh-1.dll`（且未找到 `libstdc++-6.dll`）退出 1；没有借旧 npm 包 DLL，用户已有 `npm/sacode-cli-win32-x64` 和其中日志均未触碰，也未安装或发布。观察到两个由默认 `apps/desktop/dist/host/bin/sacode-host.exe` 启动的进程 PID 18332、8072；不是本轮启动，未停止或改写其载荷。
- 2026-10-16 KB-02 增量验收（修复后的 Cangjie 1.1.3）：`core` 生产构建 rc=0（`target/tmp/knowledge-context-build-20261016-b8c706d0`）；Host 构建 rc=0（`cjpm build --target-dir D:\Project\sa\saai\sa-code\target\release`，日志 `target/tmp/knowledge-context-host-build-20261016-45677abb/host-build.log`），并打入隔离载荷 `target/tmp/knowledge-context-host-build-20261016-45677abb/fresh-host-payload/bin/sacode-host.exe`。设置不继承用户模型凭据、仅指向 loopback 假模型后，`node --test apps/host/test/knowledge/knowledge-context-host.test.mjs` 为 1/1、无跳过、rc=0；日志 `target/tmp/knowledge-context-host-e2e-20261016/a6af36ee/host-e2e.log`。该真实 Host 请求验证了 user/project 范围、过期文件排除、上下文仅作为低信任 user 内容、审计不含正文、伪造内部事件被拒。核心 `knowledgeContext*` 单测尚未取得结果：前一轮测试编译超过 30 分钟且没有 Summary，已记为 `ABORTED_NO_SUMMARY`，不能计为通过。
- 2026-10-16 KB-02 最新增量：将来源审计按白名单随 `session/subscribe` 返回（仅 `knowledge/retrieval` 有 `data`，其他事件不泄露正文），最新 Host 构建 rc=0，隔离自包含宿主 SHA-256=`6B9DDEC8FEC126B9908E91A37DA85429528628567E87DC30A8880682BC2A9805`；真实 Host E2E 1/1、rc=0，日志 `target/tmp/knowledge-context-latest-host-20261016-2d1f6c8a/knowledge-host-e2e.log`。`来源`侧栏已激活并只呈现状态、工作区、范围、来源 ID、修订和路径；空态、失败态、刷新、分页和切换会话清旧结果均覆盖，`node --check apps/desktop/renderer/side-panels.js` rc=0，`node --test --test-concurrency=1 apps/desktop/test/side-panels.test.mjs apps/desktop/test/workbench-navigation.test.mjs` 12/12、无跳过、rc=0，日志 `target/tmp/knowledge-context-latest-host-20261016-2d1f6c8a/sources-ui-tests.log`。CLI 同轮检索接线仍在实施。核心 `knowledgeContext*` 单测无 Summary，不能计为通过；源码/符号/LSP 检索和冻结任务集评测仍未做。
- 本批测试后运行 `node scripts/check_artifact_placement.cjs` 得到 `GATE: FAIL (13 checks, fail=1)`：本轮 `target/tmp` 产物全部合规，但仓内已有 `apps/desktop/target/tmp/execution-task-realhost-20261016-8df11c/` 空目录未纳入允许集；该目录创建于 2026-10-16 07:21 UTC，早于本批约 15:52 UTC 的检查。未删除或移动该不明归属目录；日志 `target/tmp/knowledge-context-latest-host-20261016-2d1f6c8a/artifact-placement.log`。
- 2026-10-16 同源码桌面候选复验：已运行 `npm run vendor`，并在私有目录生成完整 `win-unpacked` 候选 `apps/desktop/.tmp-test/desktop-current-candidate/7d18278c21/output-final/win-unpacked`；没有写入 `apps/desktop/dist`，没有安装。候选 `SaCode.exe` SHA-256=`1d1c3f4540d6f37ad4f5a117fc71613e5284ab6a152f43944d787e262537950c`，内含 Host SHA-256 与上项一致；完整 Host 载荷核对为 719/719 文件一致，含 628 个 TZif 文件。相同环境下默认安全启动的 `--smoke` 退出 `2147483651`（`0x80000003`，STATUS_BREAKPOINT），无 stdout/stderr；加 `--disable-gpu` 仍相同。仅额外传入诊断参数 `--no-sandbox` 时主进程/真实 Host 协议 smoke 退出 0 并报告 `SMOKE PASS`，包含 initialize、会话投影/订阅、未知方法拒绝和持久化屏障；该 smoke 不创建窗口、不覆盖 UI，不能作为安全默认启动或完整桌面验收。未发现对应 WER 事件或转储，根因未定；`--no-sandbox` 仅用于定位，不能作为发布默认值。产物构建日志 `apps/desktop/.tmp-test/desktop-current-candidate-final-build.log`；默认与诊断 smoke 日志在候选目录 `smoke-captured-default/run.log`、`smoke-captured-no-sandbox/run.log`、`smoke-same-env-default/run.log`、`smoke-same-env-no-sandbox/run.log`。CLI 包装仍因 SDK/PATH 缺 MinGW `libgcc_s_seh-1.dll`、`libstdc++-6.dll` 未验。
- 2026-10-16 追加 Electron 启动诊断：同一候选、唯一私有 `--session-dir` 下，默认协议 smoke 以 `0x80000003` 退出。stderr 为空不能排除子进程诊断：Electron 官方说明 Windows 子进程日志不保证写入 stderr，故再按其建议传 `--enable-logging=file --log-file=<私有路径>`，仍未生成 Chromium 日志文件；两轮日志目录分别为 `apps/desktop/.tmp-test/startup-diag-bddfaf6814364183a4ccfbbab4000fbc`、`apps/desktop/.tmp-test/startup-filelog-019c114e15474544b59acb6a209f31e0`。同一候选加 `--no-sandbox` 后真实 Host 协议 smoke `SMOKE PASS`、退出 0，日志目录 `apps/desktop/.tmp-test/startup-diag-nosandbox-632840cb54e240f9a2a0bd05cab0ebdd`。官方文档说明该开关会关闭所有 Chromium 进程（含 utility processes）的沙箱，仅适合测试；本仓 `--smoke` 在 `app.whenReady()` 中直接运行协议 smoke 并返回、不创建 `BrowserWindow`，因此不应归因到单个 renderer 的 `webPreferences.sandbox`。最近 15 分钟 Code Integrity 与 AppLocker 日志没有匹配事件；本机没有可用的 cdb/WinDbg/ProcDump 命令，WER LocalDumps 未配置。推断故障位于 Chromium 默认进程沙箱启动路径，但具体进程、策略或原因仍未知；未改注册表、系统防护、SDK、用户配置或产品源码，已核实本轮候选进程均退出。[Electron sandbox 文档](https://www.electronjs.org/docs/latest/tutorial/sandbox/)；[Electron 命令行开关文档](https://www.electronjs.org/docs/latest/api/command-line-switches)。
- 2026-10-16 ACL/平台对照：本机 Windows 11 Home x64 build `10.0.26300`，候选 Electron `33.4.11`。候选目录继承未知 `S-1-4-322009398-287923377` 写/删 ACE，但未发现 `S-1-15-2-2`（ALL RESTRICTED APPLICATION PACKAGES）读取 ACE。参考 Electron 上游报告后，只在 `.tmp-test/desktop-current-candidate/.../win-unpacked` 对照：临时添加 `S-1-15-2-2:(OI)(CI)(RX)`，确认该 ACE 已继承到 `SaCode.exe`，默认 smoke 仍为 `0x80000003`；随后移除 ACE，候选根目录和 EXE 的 SDDL 均与变更前逐字相同，验证无残留。由此排除“仅缺 S-1-15-2-2 RX ACE”这一简单解释，不能排除其他 DACL/SID 问题。Electron upstream 还存在 build 26300 上的 44.4.1/V8 崩溃报告，与本机版本不同，只能作为升级核对线索；ACL 与 V8 报告均未证明本机根因。[Electron #51761](https://github.com/electron/electron/issues/51761)、[Electron #52098](https://github.com/electron/electron/issues/52098)、[Electron #54614](https://github.com/electron/electron/issues/54614)。本探针仅改动私有候选 ACL，已恢复；未触碰产品/系统/用户目录 ACL。

## 2026-10-17 知识消费验收增量

- 修复后的 Cangjie 1.1.3 在 `apps/cli` 执行 `cjpm build --target-dir D:\Project\sa\saai\sa-code\target\tmp\cli-kb-final-0eae09052c734130861932eb7e019b06`，rc=0；产物为 `...\release\bin\main.exe`。CLI loopback SSE 集成测试 `node --test apps/cli/test/knowledge/knowledge-context-cli.test.mjs` 为 1/1、无跳过、rc=0，日志 `target/tmp/knowledge-cli-validation-20261017-8e34b6b4/cli-test.log`。独立用户设置与临时工作区验证了个人和项目知识进入首轮 user 内容；来源文件改变后后续轮次不再注入旧项目资料；检索审计绑定同一目标消息和轮次且不含知识正文；无机械证据时目标不误报完成。测试先前在缺 stdx DLL 搜索路径下以 `0xC0000135` 退出；加载 `D:\Program Files\HuaWei\Cangjie\envsetup.ps1` 并将 `.deps/stdx/windows_x86_64_cjnative/dynamic/stdx` 加入 `PATH` 后通过。测试文件语法检查与本批 `git diff --check` 通过。核心 `knowledgeContext*` 单测仍无有效 Summary；源码/符号/LSP 检索和冻结任务集评估仍待做。

## 模型中心 / F07 当前口径

产品模型中心只指 **设置 → 模型中心** 的四个正式页签：模型、供应商、费用统计、迁移。当前活装配以 `apps/desktop/renderer/pages/client-slots.ts` 为准；旧 `models-page.ts` 不属于产品入口。`models-page-smoke.cjs` 明确断言四页签及旧入口不存在，`ui-smoke.cjs` 从设置进入这套模型中心并检查供应商页；这些断言确认活动入口，不等于缺项能力已实现。2026-10-16 复核了活装配和页面适配器，并用当前私有候选 Host 跑 `node --test test/client-slots.test.mjs test/model-center.test.mjs test/model-pull-host.test.mjs`，25/25 通过；拉取用例只请求本机假 HTTP 提供方，没有真实供应商或模型调用。日志：`apps/desktop/.tmp-test/model-center-review-2026-10-16/model-center-tests.log`。下面的缺项是能力边界，不代表已按完整 F07 收口。

| 能力 | 当前状态 | 当前实现边界 / 后续验收 |
|---|---|---|
| 单供应商连通 | 有，表现为“拉取模型” | `model/pull` 对通用 OpenAI 兼容端点用已存凭据请求 `GET {baseUrl}/models` 并合并入注册表；宿主把“测试连接”和“拉取模型清单”作为同一动作，没有独立测试按钮。坏响应不得显示成零模型。各家专有发现协议仍逐家核验 |
| 全供应商连通 | 未实现 | 没有批量探测入口或动词；需要定义并发限制、逐家结果、取消及失败归因后再接 UI |
| 真实延迟 | 未实现 | `model/list` / `model/pull` 全链路没有时延结果字段或页面展示；不能用渲染层估时冒充宿主请求延迟 |
| 一键拉取 | 已实现 | 供应商页逐行拉取，经适配器调用 `model/pull`，成功结果合并到当前目录；“添加实例”和手动上游模型另有入口 |
| 搜索 | 未实现 | 正式四页没有搜索框；旧 `models-page.ts` 的模型候选搜索不计入当前产品 |
| 批量删除 | 未实现 | 只有单条删除与确认；没有多选和批量删除事务 |
| 排序 | 已有上下移，没有拖拽 | 供应商与模型绑定列表用上移/下移按钮；适配器只提交真实变位条目，不整表覆盖 |
| 模型能力声明 | 已实现为显式声明 | 可维护图片输入、图像输出、工具调用、流式、结构化输出、可用状态和来源；字段声明不等于提供方实测，名称拉取不证明能力 |
| 保存后生效 | 已实现，从下一轮生效 | `turn/start` 每轮读取注册表，凭据按请求读取；桌面写后刷新输入区模型目录。在途轮次拒绝写配置以保全当前流式请求 |
| 费用与迁移 | 已有独立页签 | 费用统计保留限额与流水边界，不跨币种假合计；迁移提供导出/导入，不把摘要冒充可恢复备份。多实例与凭据独立重试也属于当前能力面 |

F07 的既有判决仍是“配置 CRUD 主窗口链已验证；费用/路由/各供应商真实协议和真实模型调用待验”。这份表不把缺少的连通全测、时延、搜索、批量删除或拖拽误报为已实现，也不以单元/页面夹具通过替代真实提供方调用。

## 三个主页面

| 工作项 / PRD | 当前核心与接口 | 当前页面与消费 | 缺口、依赖与验收 | 主责 / 状态 |
|---|---|---|---|---|
| KB-01 / F11 知识管理 | `KnowledgeStore`；Host 五方法；CLI knowledge；有限 IPC 与页面已接 | 2026-10-17 当前 Host 管理/显式引用 2/2、Electron→preload→IPC→Host 页面 1/1；覆盖作用域、CAS、重启、来源失效、越界、CLI 同数据读取、页面保存/搜索/引用，亮暗/窄窗无溢出；修正模型发送说明 | 仍需完整桌面/默认安全启动与安装态；损坏回放未覆盖。当前为独立 Electron 夹具，不能替代产品外壳 | 本会话 / 当前管理链已复验，完整载荷待验 |
| KB-02 / F11 知识消费 | bounded lexical retriever 已读取用户与当前项目知识库；任务开始前核对 scope/workspace 与项目文件来源修订，检索上下文和不含正文的来源审计绑定到本轮 | 2026-10-16 最新源码 Host 自包含私有载荷真实 E2E 1/1 通过；模型请求收到低信任 user 上下文，来源审计经 `session/subscribe` 返回且不含正文，外部不能伪造内部检索事件，源文件变化后不注入旧正文；来源侧栏实现及 12/12 renderer 测试通过 | 核心过滤测试没有生成 Summary，不能计通过；CLI 同轮检索接线仍在实施；尚无源码/符号/LSP 检索与冻结任务集效果评测；检索保持低信任 user 内容，不作为 system/developer 指令 | 本会话 / Host 与来源 UI 已验，CLI 实施中 |
| KB-02 / F11 知识消费（2026-10-17 当前复验，覆盖上一行历史快照） | Host/CLI 请求接入共享 bounded lexical retriever；补齐不遵循知识正文命令的提示，审计和注入按目标用户消息/轮次绑定 | 当前 Host/CLI 1.1.3 构建 rc=0；核心 TOTAL 5 / PASSED 5；CLI 跨轮集成 1/1、Host 自动检索 1/1，来源失效后停止注入旧正文；页面说明已与实际发送行为对齐 | 本轮日志及哈希见知识管理证据 10-17 节和 CLI 环境证据 §11；源码/符号/LSP 检索、完整桌面与冻结任务集质量评测仍待完成，不升级为完整 F11 通过 | 本会话 / 核心及双入口当前复验通过，完整外壳与效果待验 |
| AU-01 / F13 自动化管理 | ScheduleStore/CronSpec；AutomationStore、JSON 定义、Host list/save/control、IPC；页面/IPC 测试通过 | Windows 当前源码 Host 载荷已带固定版本 IANA TZif；HostBridge 仅给子进程追加包内路径且保留用户路径优先，真实 Host 的 Asia/Shanghai 保存与无效时区错误由 14/14 集成组覆盖；`executorAvailable=false` 仍明确呈现，未触发自动任务 | CLI 随包 zoneinfo 的代码与路径 helper 有测试，完整 CLI 包验收因当前环境缺 MinGW `libgcc`/`libstdc++` 阻塞；CLI initialize 能力声明待核。调度触发/审批/取消/恢复仍等待 EX-01，保存不等于调度执行 | 本会话 / Host 路径已验，CLI 包待解锁，执行未开始 |
| AU-02 / F13 调度执行 | `ScheduleStore` 有 Cron 命中、火次记录/结果回写/历史；`AutomationStore.describe()` 将 pending 映射为 unknown；页面与 Host 明确 `executorAvailable=false` | 无真实触发/审批/取消/运行记录页面；无 tick/runner/Host 调用点；`recordFire` 以事件数生成 ID，没有 `(taskId, scheduledMinute)` 持久幂等准入，终态后同一分钟再次扫描可能重复派发 | 先在核心新增持租约、持久屏障、并发去重且重核任务启用/未删除的火次准入；恢复时 pending/unknown 不重放。Cron 命中不授予执行许可；Shell `ExecutionService` 不可伪装自然语言 Agent 任务。真实派发需独立任务日志、会话取消、权限映射、用量结算及监督验收；依赖 EX-01，计划时区、错过触发及应用退出常驻边界也待定 | 本会话 / 未开始；Host/CLI/新核心路径须先登记 W00 责任 |
| CN-01 / F15/F16/F12 连接 | core 有 SSH 注册/执行和 MCP 客户端，不能据此认定产品统一授权已完成；本次未发现数据库产品入口 | SSH/数据库/MCP 表单均不能保存、测试或启停 | 三种连接分别定义：安全凭据引用、SSH 指纹/连接验证、数据库测试及读写分权、MCP 命令/传输/工具清单/启停/在途收束；不回显秘密、不把注册状态当已连接 | 本会话 / 未开始 |

## 代码理解依赖：LSP

| 工作项 | 当前接线与证据 | 缺口与验收 | 状态 |
|---|---|---|---|
| LSP-01 / F21 契约与双入口 | 核心定义七个 verb、`LspServer`、扩展名路由与 UTF-16 坐标；Host 声明能力并路由至共享 router；CLI 注册七个工具；桌面 preload/IPC 是七个固定通道。2026-10-16 使用当前私有候选 Host 执行 `node --test --test-name-pattern='真实宿主 7 个 LSP 请求' test/bridge.test.mjs`，1/1 通过：无插件时七个 verb 均返回 `lsp-no-server`、`nonSemantic=true`，文本线索不混入语义结果。日志为 Node TAP 输出；测试夹具在 `apps/desktop/.tmp-test/bridge` 下创建私有工作目录。 | 后续变更仍需校验参数闭集、取消/迟到结果、插件注销竞态、rename 预览不落盘、诊断不推进 GoalEvidence；历史/聚焦测试不能代替插件端验收 | 契约与入口已接；本轮真实 Host 复验通过 |
| LSP-02 / 语言服务插件 | 当前生产源码未发现 `LspServer` 实现或注册；仓库内出现的实现仅是核心测试 double。 | 首个 TypeScript 插件：由插件管理自身 server 生命周期、按扩展名注册/注销、超时/崩溃恢复、并发文档版本；核心不得 spawn 具体语言服务器。以真实 TS 工程验证定义、引用、诊断和 rename TextEdit | 未开始 |
| LSP-03 / 工作台消费 | 当前 preload API 和 Host IPC 存在，但 renderer 搜索没有找到七个 LSP API 调用 | 编辑器跳转/悬浮/引用/实现/调用层次、诊断呈现与模型上下文、rename 差异审查需要实际接线；按文档修订绑定响应，迟到回执不得覆盖当前文件，rename 不直接写盘 | 未开始 |

## 七类禁用资源

权威开关为 apps/desktop/renderer/pages/workbench-tabs.ts；构建测试标签已开放并完成页面/报告逻辑接线，真实 Host 链仍待验；安全扫描、部署、记忆、技能与 MCP、来源、产物六项仍为 available:false。开放标签不计作功能闭环。

| 工作项 / PRD | 现有基础 | 真正缺口与开放门槛 | 依赖 / 状态 |
|---|---|---|---|
| WB-TEST / F09 构建测试 | 持久执行提案、授权、监督、输出、历史接口与终端内 ExecutionTask | 独立页面与真实任务报告已接；2026-10-17 当前 Host 页面集成 1/1，验证测试提案、一次性审批、启动前取消及沙箱未验证时拒绝执行且不报通过 | 真实成功执行→双流完整输出→非空测试报告仍未验收，依赖 BASE-01/EX-01；命令名分类不验证可执行文件路径/签名/哈希 | 本会话 / 真实 Host 拒绝链已验，执行成功待验 |
| WB-SCAN / F17 安全扫描 | 已提交纯数据 report/handoff 适配器，包含摘要与增量/失效前置条件 | 真实扫描器选择/执行、限域、报告绑定、失败/取消、页面消费；修复走写审批与当前版本复核；不把 deep 标签当深度分析证据 | EX-01、文件观察 / 未开始 |
| WB-DEPLOY / F15 部署 | SSH 执行基础片段 | 明确目标与发布提案、独立批准、真实远端步骤/退出/日志、失败恢复；不盲重试未知结果；安装/重启另行确认 | CN-01、EX-01 / 未开始 |
| WB-MEM / F11 记忆 | 知识笔记不能替代长期记忆 | 项目/个人记忆候选与确认、来源/修订/失效、检索实际消费、编辑删除；旧记忆不压过源码 | KB-02 / 未开始 |
| WB-SERVICE / F12 技能与 MCP | 插件管理适配器、skill/mcp 核心与真实 stdio 客户端；＋菜单清单仍未接 | 共享真实 inventory、搜索/选择、授权与工具贡献撤销；安装≠启用≠进程启动；停用/卸载在途调用明确收束 | CN-01、插件生命周期 / 未开始 |
| WB-SOURCE / F11/F14/F19 来源 | 会话轨迹、文件/知识来源、扫描 handoff 可复用 | 统一按任务/请求关联来源、修订、范围、引用位置及失效；支持跳转；不造第二份与真源脱节的文本清单 | 文件观察、KB-02、报告绑定 / 未开始 |
| WB-ARTIFACT / F09/F19 产物 | 附件仓、执行记录及文件系统事实可复用 | 真实文件/报告/生成物清单，绑定任务、路径、摘要、类型和生命周期；缺失/变更明确；预览/导出限域授权 | EX-01、WB-SOURCE / 未开始 |

## 主链审计与实施顺序

| 工作项 | 当前接线与缺口 | 下一步与验收 |
|---|---|---|
| BASE-01 当前产物基线 | 修复后的仓颉 1.1.3 下，core/CLI/Host/daemon 4/4 构建成功；本轮同源码完整 `win-unpacked` 候选已生成，Host 载荷 SHA-256 与已验私有 Host 一致，719/719 文件对账。 | 默认安全启动 smoke 以 `0x80000003` 失败，安装态未验；隔离 CLI 包因缺 MinGW DLL 未完成。`deviceRunVerified=false`；不写默认 `dist`，不使用 `--no-sandbox` 作为产品默认配置 | 先定位并修复默认 Electron 安全启动失败，再用同一候选复验默认启动与真实窗口/Host；安装/升级仍需单独授权。CLI 包待可核验的 MinGW 运行库来源 |
| EDIT-01 文件编辑 | 页面→read→一次性审批→核心 write→回读已接；外部冲突、未保存、迟到回执保护已有源码 | 本轮统一构建出的真实 Host 在 private payload 下验证：审批后写入中文/空白、审批期间第三方改动拒绝、空正文、模型写入 allowed-once/denied、工作区绑定/切换/重启及写者竞争，共 14 项集成组通过；受限 `%TEMP%` 的失败与 repo-local TEMP 的通过分别留证 | 仍需默认 Electron/完整桌面载荷的用户路径验收及冷恢复；不要把假模型写入验收说成真实模型任务，也不要混淆 AI 与手工修改归属 |
| EX-01 执行 | execution/propose/authorize/start/list/describe/output/stop 接入终端；当前 Host 提案/审批/拒绝链通过。2026-10-17 修正空子环境后，AppContainer 实际身份专项 5/5，创建/token/SID/终止/profile 清理通过 | Windows `platformSandbox` 仍无实际后端，`platformExecutionReady=false`；下一步私有工作区 ACL、文件/网络/后代反向隔离及原生创建绑定到同一任务进程/Job。保持 fail-closed；还需验启动竞态、双流、限额后排空、未知与中断恢复。身份证据见 2026-10-17-appcontainer-minimal-environment |
| REVIEW-01 差异 | 新增右侧“差异审查”页，组合现有编辑器未保存草稿差异与当前会话/目录绑定的 Git 索引、工作区只读差异；明确提示尚无 Agent 任务归属 | 下一步建立任务归属与文件修订关联，再绑定执行/测试报告；旧 Host 下页面真实数据验收未做。陈旧提案拒绝，不能展示错任务 patch |
| GIT-01 Git 授权操作 | 工作台已有暂存/提交/推送提案，实际写入统一经过 ExecutionService；2026-10-17 当前 Host 集成 1/1，三种操作各自独立审批，门禁拒绝时 index/HEAD/远端不变 | 尚未证明真实 Git 写操作成功；需执行前核对审批后的索引/文件变化、保护部分暂存与 index.lock，补文件/hunk 选择、取消暂存、提交/历史/推送验收；hooks/签名/凭据/网络保持明确授权。依赖 EX-01，不能把拒绝链通过当 Git 写闭环 |

实施顺序：

1. BASE-01：统一 Windows 源码构建、完整私有桌面候选和 Host 载荷对账已通过；默认安全启动失败（`0x80000003`），CLI 包装受 MinGW 运行库来源阻塞。先定位默认启动故障，随后复验默认模式真实窗口/Host；不以 `--no-sandbox` 通过替代验收，不碰默认 `dist` 和正在运行的 Host。
2. EDIT-01 → EX-01 → WB-TEST → REVIEW-01 → GIT-01：交付真实开发任务主链。
3. KB-01 当前源码 Host/CLI/Electron 夹具复验仍待默认启动的完整桌面路径；AU-01 的 Windows Host TZif 打包与环境接线已真实验收，CLI 完整包受 MinGW 缺件阻塞，调度执行仍等 EX-01。KB-02 的 Host/CLI 请求注入与来源侧栏已有定向证据；核心过滤单测和冻结任务集评测仍待完成。LSP L1 当前真实 Host 回退已复验；LSP-02 真实语言插件和 LSP-03 工作台消费仍未开始，不能记录为 F21 完成。
4. CN-01 → WB-SERVICE/WB-SCAN → WB-DEPLOY/WB-MEM，逐项验证后才开放标签。

知识库管理已实现部分保留，不为了阶段顺序回退；自动化已写部分保留并核实，暂不继续孤立扩写后台执行器。

## 统一验收与授权

- 每项至少正常、失败/越权、恢复/并发；跨会话、迟到结果、停用/取消、版本冲突为共用门槛。
- 实际运行服务或命令给出真实终态、退出码、日志、源码及产物摘要；没有执行则标待验，缺环境给出解锁条件。
- Git/部署/数据库写入/安装与收费请求按实际动作授权。实现功能不授权对产品仓库提交、推送、部署或连接用户真实数据库。
- 自有临时仓库、假服务和真实服务分开登记；不以模拟页面或单元测试替代产品使用链。
- 默认 Electron、测试夹具、开发态和安装态分别验收；不能把 --no-sandbox 页面夹具通过扩大成安全默认启动通过。
- 当前目标尚未完成。目标工具因旧未完成目标存在拒绝创建新目标；未将旧目标虚标完成。本文件是本批新范围与收口依据，后续继续按此实施。
