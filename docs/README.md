# SaCode 文档体系总览（2026-10-16 归类版）

- 2026-10-24：发布通用 skill **`repo-conventions`**（仓库约定与项目治理）到 SkillHub（1.0.0 / 8 文件 / `skillId 293070`，待审核）；源码在 `.agents/skills/repo-conventions/`。证据：[发布记录](evidence/2026-10-24-repo-conventions-skill-publish.md)。

- 2026-10-24：新增**多 agent 进度登记机制**——[`agents/`](agents/README.md)（各 agent 自报在飞，只改自己的文件，零写冲突）+ [`scripts/agent-board.mjs`](../scripts/agent-board.mjs) 汇总看板 [`product/agent-board.md`](product/agent-board.md)；根 `AGENTS.md` 新增「多 agent 进度登记（强制）」节（开工登记 / 收尾更新 / 收尾自检）。

- 2026-10-24：新增 **端文档分类 ⑪** 与 [`clients/`](clients/README.md)——按端组织的**产品四端文档**（桌面 / CLI / 移动 / Web）。总览含共享契约、跨端差异对比矩阵与共同红线；逐端文档统一补齐**用途 / 需求 / 设计 / 边界 / 分步细节 / 与其它端差异**六要素；另把各端**专属文档物理归入 `clients/<端>/`**（目录内 `README.md`=端规格、`documents.md`=归类索引、其余为该端专属文档），并**同批重写全库引用**、通过断链校验；通用/后端文档仍留在原目录。共归入约 94 篇端专属文档 + 8 篇规格/索引。纯文档，只整理既有源码与已登记证据，不升级任何端的产品状态、不改源码、不提交。

- 2026-10-24：新增根 [`CHANGELOG.md`](../CHANGELOG.md) **产品迭代记录**（以日期为锚点、含维护规则与近期批次回填）；由根 `AGENTS.md`「文档同步规则」第 4 条约束同批更新。

- 2026-10-24：[Web 工作台技术负债台账](clients/web/web-tech-debt-2026-10-24.md)：用户提问「web 端还有技术负债吗」触发实核（不沿用 PRD 旧快照）：`apps/web` **61 文件 / 4918 行从未纳入版本控制**（`git ls-files` 为 0，非 gitignore 所致）、无 ESLint/Prettier、CI 与仓级门禁零覆盖。已修四项：忽略 `screenshots/` 与 Playwright 产物、`git add`（**仅暂存，未 commit 未 push**）、ESLint 10.13 + Prettier、新增 `web.yml` 工作流；另修 `playwright*.config.ts` 两处机器绑定浏览器路径，并据此暴露**本机缓存 chromium 1243 与所需 1248 长期不匹配**（旧硬编码一直在绕开该问题）。P0 修复后 typecheck 0、`lint` 与 `format:check` 均 rc=0、123 通过 + 1 门控跳过、构建 rc=0。P1/P2 六项未闭合：上游 SSE 断线不可观测、真实业务直播未验、候选非同源、任务审批未开放、真实链路测试默认跳过、浏览器侧撤销未端到端验证。[plans 索引](plans/README.md) 同批登记。

- 2026-10-24：[extension/host 5 红环境根因](evidence/2026-10-24-extension-host-env-root-cause.md)：`bridge.test.mjs` 的 extension/host spawn 族（#33/35/36/37/38）定性为**环境问题**——仓库根 Low Mandatory Level 标签被宿主 EXE 继承为 Low IL，其拉起的 node 子进程 `lstat('D:\')` 被拒（`EPERM -4048`）→ 主模块解析失败、秒退、0 帧→`js-host-handshake-timeout`；P0「从未出现子进程」为采样漏采（子进程确已起、毫秒级退出）。A/B（同源码/二进制/node/脚本，仅宿主位置不同）：仓库内宿主 39 用例 33 pass/5 fail/1 cancelled，中性导出宿主（`SACODE_HOST`）extension 子集 **7/7**、全量 **83/83**。非代码缺陷；临时诊断已回退、`core` 与 HEAD 无差异；未改 ACL/完整性标签。

- 2026-10-24：[F13 自动化调度「持久触发准入」核心切片（AU-02 第一阶段）](evidence/2026-10-24-automation-trigger-admission-core.md)：确认自动化「未接通」是**已立项未开始的功能 AU-02**（非桌面降级，硬接 `tick` 只会造空假入口）；按设计稿先落核心准入 `core/src/automation_trigger.cj`（独立版本化日志/单写者租约/幂等键不含 `definitionRevision`/准入 `flush` 屏障/`overlap=skip`/恢复 `unknown` 屏障/`misfire=skip` 水位）、`cjpm build` rc=0；core `cjpm test` 本机编译停滞未执行（不宣称通过）。未动 daemon/Host/桌面；下一步 F13-E 交接。

- 2026-10-24：[桌面端降级审计](clients/desktop/2026-10-24-desktop-degradation-audit.md)：核查 `apps/desktop` 的「降级」——多数「未接通/未实现」是**后端本就未实现**的如实标注（A1 自动化执行器=`install()` 全仓无装配调用方→`tick` 恒空，=F13/D07；A2 费用统计探测/加速列=`PROBE_MINIMAL_MODE` 无产品调用方；A3 插件安装取消=Host 无 `plugin/install/cancel` 且 `install/start` 假异步），**不硬修以免伪造**；实修真降级 3 处（插件安装源读取失败不再静默退默认源、迁移复制给失败反馈、模型中心账本失败提示去「等 §6」）。读数：定向 **37/37** ＋ 渲染层门禁 **13/13** ＋ IPC **212↔212 GATE PASS**，合计 **50/50、0 失败/跳过**；纯渲染层、未改 core/Host、未打包/提交。未改 `side-panels.js` 产品状态声明与在飞/共享注释。

- 2026-10-24：[TUI @文本文件引用](clients/cli/2026-10-24-cli-tui-text-references.md)：发送前默认取消确认，Host read/结算→资料快照随消息进模型；114/114含本地HTTP实收正文/冷重开，12宽窄帧与默认入口通过。新包561,133 B / `db9ad1b4…`，不是图片/通用附件，真终端/外部模型/安装未验。

- 2026-10-24：[TUI会话管理](clients/cli/2026-10-24-cli-tui-session-management.md)：搜索/改名/归档/恢复归档、默认取消/修订回读/未知冻结；99/99含真实Host冷重开，14宽窄帧与无覆盖默认入口通过。新包547,489 B / `b02920b1…`；真终端/真模型/安装未验，桌面候选不变。

- 2026-10-24：[内置浏览器 WebContentsView 接线（F14 人工浏览入口）](evidence/2026-10-24-browser-webcontents-view-wiring.md)：主进程 `WebContentsView` 控制器 + 8 条 `browserView*` IPC，隔离会话、跨站/下载/权限/新窗口默认拒绝、弹层与切页隐藏、切项目销毁+清旧 cookie；渲染层 `BrowserPanel` 接入工作台「内置浏览器」资源。单元+真实 Electron 10/10（含 20 项实跑）、`--ui-smoke` BROWSER_MAIN PASS 5 项、IPC 212/212、相邻 18/18。未改 core/Host、未接 Agent provider/截图/多标签/电脑操控、未重打候选；不升级 F14 完成。

- 2026-10-24：[TUI配置与模型状态细化](clients/cli/2026-10-24-cli-tui-configuration-refinement.md)：/auth逐项校验/返回编辑/隐藏Key/保存前后核对及未知停止重发，/model区分配置与连通；82/82含真实Host表单保存/冷重开，本地端点0请求，未真实模型/终端/安装验收。

- 2026-10-24：[默认TUI开发Host刷新](evidence/2026-10-24-host-skill-workspace-cache-fix.md#同日续批默认开发载荷刷新用户继续授权)：默认载荷完整替换为修复Host `71389261…`，709/709哈希一致、旧目录保留；默认目录Host7/7、TUI73/73，无SACODE_HOST的无参/显式tui与干净PATH伪TTY技能正文均通过。桌面交付候选未改、真终端/安装/真实模型未验。

- 2026-10-24：[Host技能工作区缓存修复](evidence/2026-10-24-host-skill-workspace-cache-fix.md)：定位initialize过早缓存空目录/旧日志；skill查询按当前租约/持久快照装配。同快照旧逻辑3败→修复Host5/5，真实TUI73/73（含技能列表正文，无额外skip）。私有Host `71389261…`，默认旧Host/桌面包未覆盖，不宣称整包生效。

- 2026-10-24：[TUI 能力浏览与技能发现阻塞](clients/cli/2026-10-24-cli-tui-capability-views.md)：/skills目录正文、/mcp注册连接状态、权限/计划只读入口，默认回归72过/1显式验收跳过；**独立真实技能发现1失败**，未凑通过。新包529,688 B / `bfb74c6b…`，12帧/烟测/打包通过；不连接服务、不放宽权限，桌面候选不变。

- 2026-10-24：[TUI 路径引用与真实差异](clients/cli/2026-10-24-cli-tui-workspace-views.md)：补Home/End与DEL适配、`@`Host目录浏览/路径补全、`/diff`只读真实Git状态及patch；63/63含新增真实Host只读对照，新包523,224 B / `74a9c6e7…`。@不读取上传正文，不冒充完整附件；真终端/真模型/安装未验，桌面候选不变。

- 2026-10-24：[TUI 四方向细节打磨](clients/cli/2026-10-24-cli-tui-polish.md)：轻量代码着色/Markdown与表格、词编辑/撤销/历史搜索、工具详情展开与明确标注的审批请求预览、窄屏留白；52/52与伪TTY通过，新包511,622 B / `2b258424…`。补随包Apache和37包许可；非真实diff/真终端/真实模型验收，桌面候选不变。

- 2026-10-24：[P0 跨端打通前闸门](evidence/2026-10-24-p0-cross-end-gates.md)：闭合 Web 工作台开工前阻断——P0-1 `--manage grant-scope` scope 闭集授予、P0-2 `turn/poll` 游标重放（`TurnFrameJournal`：page 不消费、多客户端同游标同帧、take 兼容旧消费）、P0-3 `session/projection` 精确读取 + 活动会话方法错配 `-32001 session-mismatch` 早期拒绝。daemon 级 31/31、桌面 `session-identity` 3/3、游标双客户端用例 1/1；Host/daemon 构建 rc=0、二进制含全部 P0 标记。core `cjpm test` 因 HEAD 同名 `@Test` 无法编译（P0 文件零 error）；extension/host spawn 经旧二进制对照确认为预先存在工具链问题；remote-product 5 条 openssl ENOENT 阻断。未提交/安装/发布，不升级 F 域。

- 2026-10-24：[供应商页新增/编辑表单改为弹窗（试点）](clients/desktop/2026-10-24-provider-editor-dialog.md)：表单改由共享 `SaCodeDialog` 承载（760px 宽变体、操作条 sticky、错误在弹窗内、保存中关闭被守卫），列表不再被顶出视野；真 Vue 结构回归 2/2（含 HEAD 反证）、受影响非 Electron 34/34、渲染层门禁 22/22。真实 Electron 在仓外中立目录实跑（仓库内受完整性标签 `0x80000003`，中立目录不受限）：门控 7 项 **7/7 通过、0 跳过**（首轮 4 败为驱动侧两处失效断言：价格字段按旧标签取节点、内置供应商说明文案，已按结构/现文案修正，未改并发改动）；`--ui-smoke` RC=0 `MODEL_MAIN_SMOKE PASS`，观感待用户确认；删除确认与其他页面内联表单未动，未重打候选。
- 2026-10-24：[桌面渲染层视觉一致性修复](clients/desktop/2026-10-24-desktop-renderer-ui-token-unification.md)：三层重复色板合并为 `renderer/styles.css` 单一真源（下游重定义 0），LSP 面板暗色适配、`--settings-*` 根级化、对比度 18/18 PASS、圆角/字号/间距回到冻结档位、焦点环补 `select`；postcss 21 文件 0 错、渲染层门禁 6/6、受影响组件 26 过/5 环境跳过。**未做 GUI 亮暗/宽窄验收，未重打候选**；设计口径同步 [`renderer/DESIGN.md`](../apps/desktop/renderer/DESIGN.md) 与 [`product/desktop-design-standard.md`](clients/desktop/desktop-design-standard.md)。

- 2026-10-24：[TUI 骨架重写](clients/cli/2026-10-24-cli-tui-skeleton.md)：用户确认后整体替换为历史流＋Markdown＋内联工具卡＋配置表单；适配 Gemini CLI Apache-2.0 展示代码，36/36 测试通过，新包 `a2ee51eb…` / 496,951 B。真实终端/模型/安装待验。

- 2026-10-24：[上下文容量/用量读数接线（F06 局部）](evidence/2026-10-24-context-meter-capacity-wiring.md)：发现接口的 `context_window` 解析入注册表（只补空槽、重复拉取不涨 revision），渲染层容量与用量独立呈现、两侧齐全才出百分比；真实 LongCat 报 `1048576`。渲染层+设置 23/23、链路 1/1、Host 回归 20/20；core 新增单测因 HEAD 同名 `@Test` 未执行，未重打 dist/安装包，GUI 未复验，不升级 F06 全域。

- 2026-10-24：[语音输入接线（F18 最小闭环）](clients/desktop/2026-10-24-voice-input-wiring.md)：`composer-voice` 由禁用占位改为可点击并状态化；Host `voice/record`（导入登记）+ `voice/transcribe|describe` 分派与**服务端发号**审批（capabilities +3），桌面 4 条 IPC（preload 202↔main 202 GATE PASS）；新增 `renderer/voice.js`（录音→16k 单声道 WAV→转写→仅写入草稿、可撤销、不自动发送）。`voice.test.mjs` 5/5、渲染层相关 20/20。ASR 未配置时 fail-closed；真实麦克风/ASR/GUI/打包/安装未验，不改当前候选与主阻塞。

- 2026-10-24：[Gemini CLI 源码与渲染帧比较](clients/cli/2026-10-24-cli-tui-source-comparison.md)：用户再次指出差距后停止补丁式推进，取得19份固定版上游文件和8份本地合成帧，核实根布局/历史流/Markdown/工具/审批/配置差异及Apache-2.0复用条件。仅审查与整体改造方案，未改产品代码、未重打包；待批准骨架替换。

- 2026-10-24：[TUI Gemini CLI 对齐与缺口](clients/cli/2026-10-24-cli-tui-gemini-alignment.md)：纠正把原目标缩成聊天框的偏差；固定上游源码参考，接命令菜单、多行输入、模型选择、会话/目录与工具结果，36/36（含真实 Host 冷重开）；新包 `78690d46…` / 476,975 B。认证配置、@文件、Markdown/diff、MCP/技能等明确未齐，不宣称完整交付。

- 2026-10-24：用户授权创建并发布通用 [ui-design Skill](../.agents/skills/ui-design/SKILL.md)，附[设计原则](../.agents/skills/ui-design/references/design-principles.md)与[验证流程](../.agents/skills/ui-design/references/verification.md)。使用项目既有规范和令牌，区分方案、实现、只读审查与证据等级；结构测试5/5，SkillHub已接收1.0.0、待内容与安全审核（[发布证据](evidence/2026-10-24-ui-design-skill-publish.md)），不改变桌面候选或产品验收状态。

- 2026-10-24：[新建空会话隐藏统计占位](clients/desktop/2026-10-24-composer-empty-stats.txt)：仅隐藏空会话输入区上方的活动/用量行，已有对话保持真实读数；新增2条先红后绿，组件7/7、相关回归16/16、隔离桌面完整页面与真实Host行为5/5。源码修正，正式候选未重打，不代表安装态已更新。

- 2026-10-24：[CLI TUI 交互完善](clients/cli/2026-10-24-cli-tui-interaction.md)：字素光标编辑/草稿恢复、对话 PageUp/PageDown、审批 d 查看完整参数；23/23 测试、新包 `82152ba4…` / 460,413 B、伪 TTY 烟测通过。真实终端/模型/新包安装待验，桌面候选不变。

- 2026-10-24：[桌面渲染层设计规范](clients/desktop/2026-10-24-desktop-renderer-design.md)：用户同意的 awesome-design-md Linear＋Vercel 原则提取，新增 `apps/desktop/renderer/DESIGN.md`（10 条原则→本仓 `--*` 令牌映射、组件基线、Do/Don't、边界），与 `product/desktop-design-standard.md` 分层授权，只采纳原则不复制品牌。纯文档，无代码/令牌/IPC 改动；上游未锁定 commit，GUI 观感待用户实机验收。

- 2026-10-24：[CLI TUI 视觉调整](clients/cli/2026-10-24-cli-tui-design.md)：用户同意的 awesome-design-md Warp＋Ollama 终端适配，新增本地 DESIGN.md；中性消息、细线分区、工具活动/审批/输入层级与紧凑窗口，14/14 测试、新包 454,635 B（`3b0e801a…`）、伪 TTY 烟测通过。真实终端观感和真实模型任务待验，桌面候选不变。

- 2026-10-24：[CLI TUI 中文分块解码续验](clients/cli/2026-10-23-cli-tui-ink.md#5-2026-10-24-续验跨块-utf-8-解码)：修复 stdout/stderr 跨块 UTF-8 乱码，逐字节回归先红后绿，8/8 测试；新产物 451,213 B（`77a811ee…`）、伪 TTY `/help`/Ctrl+D rc=0。10-23 安装/干净重建仍是旧哈希证据；真实终端和真实模型任务待验，桌面候选不变。

- 2026-10-23：[CLI 终端交互界面（Node/Ink TUI）](clients/cli/2026-10-23-cli-tui-ink.md)：`apps/cli/tui/` 以 Ink 渲染，npm 无参 TTY/显式 `tui` 进入，其余透传仓颉 CLI；消息 `user/message` + `task/start`、审批/取消/结算全走 Host。Rollup 单文件 450,980 B，7/7 测试（真宿主引导+投影追加、审批待答 Ctrl+C）、伪 TTY `/help`/Ctrl+D rc=0；本机 tarball 安装态启动 rc=0、缺宿主 rc=69、缺平台包透传 rc=79；干净目录 `npm ci` 重建同哈希。真实终端亲手走查、真实模型审批与 registry 安装未验；候选不变。

- 2026-10-23：[SaCode 手机配对入口整改](clients/mobile/2026-10-23-mobile-sacode-entry-correction.md)：正式启动不再走旧账号登录/网关聊天，采用独立本机设备档案与 daemon 配对；171 项共享测试、3 项路由回归、APK 构建通过，Honor 保留数据安装成功。检查时锁屏，首屏 GUI 待解锁；真实 daemon/任务/鸿蒙未验。

- 2026-10-23：[手机端组件 Demo 清理](clients/mobile/2026-10-23-mobile-demo-removal.md)：删除组件目录源码、登录入口和 Android 注册，鸿蒙启动路由纠正；3 项路由回归、165 项单测及 APK 构建通过，DEX 无旧目录类；保留数据安装到 Honor 并启动登录页。登录后设备/任务尚未验收，未做鸿蒙构建。

- 2026-10-23：[CLI 审查缺陷修复与三入口构建钩子重写](clients/cli/2026-10-23-cli-review-and-fixes.md)：修六项——`build.cj` 硬编码本机路径/不认 `--target-dir`（env 优先 + `SACODE_BUILD_TARGET_DIR`）、裸 `goal` 落自测、租约失败分类与 5/8 退出码、worktree `flush-failed` 保留租约、PowerShell 5.1 管道 BOM、usage/help 与 `knowledge`/`call edit` 展示不一致。CLI 重建 rc=0、`main.exe all` ALL PASS、CLI Node 153/150 pass/3 skip、钩子测试 2/2。未跑完整四成员 `build-platform.mjs`，候选 `0f08a6ce…` 未重打；[台账](product/PRD-tracking.md) 新增 D25、[证据索引](evidence/README.md) 同批登记。

- 2026-10-23：[移动端 M04-A 三处根因修复](clients/mobile/2026-10-23-mobile-m04a-routing-task-init.md)：HomeTabs/聊天按钮改走安全只读页、任务不支持不标 done、initialize 传 workspaceId；续修任务提示与任务列表响应式，离线 165 单测（含实际 Kuikly 面板回归）与 Debug APK 通过；后续获授权保留数据覆盖安装成功，已解锁并确认登录页启动，登录后设备/任务面板仍待验，未 daemon 实连，不升级 M04。[台账](product/PRD-tracking.md) 同批登记。

- 2026-10-23：补齐 [PRD 移动端与 Web 产品路线](product/PRD.md#移动端与-web-产品路线2026-10-23-补录)、[阶段台账](product/PRD-tracking.md#移动端与-web-路线台账2026-10-23-补录)及[平台路线](product/platform-and-distribution.md#32-移动端与-web-路线2026-10-23)。移动端涵盖 demo 收敛、Markdown/ChatUI、真实 daemon 闭环及扩展通道；Web 涵盖契约安全、桥接 PoC、工作台与部署。此前专项方案/源码归并不等于完整产品路线；本次不升级运行/交付状态，不改桌面候选、不提交推送。

- 2026-10-23：[Web 技术选型](clients/web/2026-10-23-web-technical-selection.md)：在 [Web 工作台架构](clients/web/2026-10-23-web-workbench-architecture.md) 基础上冻结首版技术栈——Vue 3.5 + Vite 8 + Fastify 5 + TypeBox + 不透明服务端会话 + SSE，复用桌面 `RemoteTransport` 的 TLS pin/并发/幂等能力；明确 TypeScript 5.9 而非 7、vue-router 4/Pinia 3 而非新 major、Caddy 反代与 Playwright E2E，并列出 T1–T6 待确认项。§13 增补跨端契约与验收矩阵，按源码核对桌面/CLI/移动/Web 现状，登记硬阻塞：远程 scope 无生产授予入口（task/approval 恒拒 `scope-required`）、Host `turn/poll` 排他消费阻止多端同会话、S11 资源身份未修、CLI 无认证/TLS、契约 consumer 不参与运行时授权；S08/S09 在当前 HEAD 已有修复代码但未复测，仍按未闭合处理。因此 W01/W02-A 仅开放只读面。版本为只读查询候选值，未安装、未建工程、未部署；[plans 索引](plans/README.md) 同批登记。

- 2026-10-23：[GUI 界面填写 API 密钥与真实闭环补验](clients/desktop/2026-10-23-longcat-gui-key-entry.md)：补上正常双击路径此前未验的一环——无环境密钥时在供应商页填写并保存 Key（隔离 `credentials.env` 57 B、与输入逐字节一致）→ 真实拉取 `LongCat-2.5-Preview/LongCat-2.0` → 设默认 → read→write 任务审批 #1 `allowed-once` → 落盘与真实 diff → 关闭重开 `keyConfigured:true` 且回放正确；会话日志 107 条事件（tool/call 2、审批 1/1），密钥扫描 451/453 文件两次零命中。探针两处自身缺陷已留存并离线更正，仍待用户亲手复验，不宣称已交付。


- 2026-10-23：[LongCat 真实模型主闭环（宿主级与 GUI 级）](evidence/2026-10-23-longcat-real-task-loop.md)：用用户提供的真实 LongCat 模型在交付候选 `D:/tmp/sacode-final-20261023` 上走通宿主协议与真实 GUI 两条闭环——读取→模型提出写入→审批 #1 `allowed-once`→落盘→真实 diff→关闭重开回放；GUI 会话日志 142 条事件、tool/call 3、approval 1/1，密钥零落盘、无残留进程。仍待用户亲手复验，不宣称已交付；shell/run_code 与 D14 未覆盖。

- 2026-10-23：[UI 冒烟 283/16 分诊与测试支持修复](clients/desktop/2026-10-23-ui-smoke-triage.md)：16 项失败逐条归因为 `test-support/ui-smoke.cjs` 滞后（非产品 UI 缺陷）；仅改测试支持后同源诊断副本 301 OK/0 FAIL/`UI_SMOKE PASS`，计数对账 283+16+2=301；候选 `app.asar` 未重打，交付包仍报 283/16。

- 2026-10-23：[Linux Electron 桌面打包与打包态验收](clients/desktop/2026-10-23-linux-desktop-package.md)：远端 Ubuntu 用与工作区同源的源码打出 AppImage（133,944,198 字节，sha256 `0c5d5d0b…6813`）与 deb（102,549,392 字节，sha256 `835152ba…9e05`）；三种形态（AppImage/unpacked/deb 载荷）协议冒烟均 `SMOKE PASS` rc=0、无孤儿宿主，UI 冒烟 dev/打包三份 282 OK / 17 FAIL 失败集逐字节相同（打包零回归，17 项为 HEAD 现状）；打包元数据补 `linux.executableName=sacode`、`maintainer`、`homepage`。AppImage 原生 FUSE 启动因宿主缺 `libfuse.so.2` 记 BLOCKED，deb 未安装。证据索引与台账同批登记；未提交/发布。

- 2026-10-23：[Kuikly AI 参考资料采纳](clients/mobile/2026-10-23-kuikly-ai-reference-adoption.txt)：移动端按官方 AIChat 文档接入 KuiklyMarkdown（1.0.6-2.0.21，与 Kotlin 2.0.21 对齐），AI 气泡改走真实 Markdown 渲染；实测文档给的 2.1.21 版本不兼容、镜像路径 404（构件在已配置的 maven-tencent），javap 确认 API 是 ViewContainer 扩展。Debug APK 组装通过（9,182,509 B，增量 +359,511 B）。未接流式入口、KuiklyChatUI 与真机渲染验收，不改桌面候选。

- 2026-10-23：[手机工程源码归并](clients/mobile/2026-10-23-mobile-source-import.txt)：用户批准将外部 sa-app 的 KMP/Kuikly 工程复制整合到 apps/mobile 根，原项目不动、不复制 .git，由 SaCode 同仓管理。保留 kotlin/kotlin-test（仅 JVM 协议代码及测试，不是 Android 应用），适配目录门禁、构建任务名与移动端文档。构建及真机任务另验，不改变桌面候选身份；[证据索引](evidence/README.md) 同批登记。

- 2026-10-22：[沙箱解析缺陷修复与强制隔离真实入口边界](evidence/2026-10-22-sandbox-resolve-fix-and-enforcing-boundary.md)。修 `resolveWindowsExecutable` 对不存在路径抛 FException（红先 PASSED 1/SKIPPED 5）；enforcing 开启时 run_code 真实打印 `RUN_CODE_STDOUT`、shell 真实执行 PowerShell 包装层，退出码真实，不再折叠为 io-error/SANDBOX_UNAVAILABLE；剩余边界是工作区 ACL（AC SID 受限），未授权不改。HEAD core 套件因两个同名 `@Test`（9c85fed）无法编译，红/绿在同源私有模块取证。

- 2026-10-22：[Web 部署方案设计](clients/web/2026-10-22-web-deployment-design.md)。用户问“现在是不是有了 cli、desktop，web 部署有了吗”——核查确认只有 CLI（`apps/cli`+npm 薄启动包）与 Electron 桌面（`apps/desktop`），**无 Web 部署**（无 `apps/web`、renderer 是 file://+CSP+构建期折叠三件套专为 Electron 设计）。方案对比：A 改桌面 renderer 跑浏览器（推翻三件套+重构 IPC 面，风险高）vs B WS 桥+独立前端（推荐，Host 不动、桌面零回归、复用 HostBridge 逻辑与 pack-service 底座）。推荐方案 B 含拓朴、改造点（WS 桥/无头服务扩展/鉴权会话隔离/Vite SPA/方法面映射/流式审批取消）、Host JSON-RPC 方法面映射表、分阶段工作量估算（17-28 人天，S1-S2 约 2-4 人天即证“Web 部署有了”）、验收出口与风险边界。纯设计，未改产品代码/Host/core/桌面，未构建/提交/发布。同批登记 [plans 索引](plans/README.md) §B 与速览表、[对接总览](integration/README.md) §1。

- 2026-10-21：[D23 reasoning_content链路局部修复证据](evidence/2026-10-21-d23-reasoning-content.md)：独立思考增量、保存与历史回传；隔离构建成功，25/25合成回归，真实供应商及候选待验，SSE网络夹具9项环境错误保留。

- 2026-10-21：[调度者 Agent 与团队方案](plans/sacode-orchestrator-agent-2026-10-21.md)。取代原 [本地 Agent 预设](plans/sacode-local-agent-presets-2026-10-11.md) 的"标准/PTC/极简/创造"四模式方向（原方案存储/作用域/修订/导入导出与生命周期约束仍可复用）。核心定位：本地主 Agent 是调度者，委派原语唯一＝subagent；ACP 不是顶层委派通道，而是 subagent 可持有的**能力**（动机＝用户用外部 Agent 额度省自己 token）；外部 Agent 继承委派它的 subagent 权限边界（"什么人干什么事情"）；预设团队（explorer/planner/implementer/reviewer）+用户可编辑员工，员工编辑器用 checkbox 快捷勾选 SaCode 既有能力；多外部 Agent 默认顺序按优先级降级、轮询可选；主 Agent 直调 ACP 默认关、subagent 默认开；额度来源单独记账。F10 拓扑调整：ACP 从主 Agent 直连下沉为 subagent 能力。[plans 索引](plans/README.md) B 节同批登记，原预设条目标注方向废弃。纯设计，未改产品代码。

- 2026-10-21：[记忆与每日自动进化方案](plans/sacode-memory-daily-evolution-2026-10-21.md)。补 F11"记忆/速记/批注未收口"缺口。与知识库分工：记忆=agent 自动提取的跨会话事实（草稿低信任），知识库=用户显式手写文档（用户权威）。三态生命周期（draft→confirmed→archived）+ draft 不注入模型铁律；轮末自动提取 + 启动时合并 pass（>24h 触发去重/解冲突/衰减/晋升，避开 F13 executor 未实现 D07）；密钥擦除（KEY/PASSWORD/SECRET/TOKEN/SACODE_* 命中 fail-closed）；记忆分类与配额；设置四开关（总开关/自动学习/自动晋升/每日进化，自动学习与自动晋升默认关）；`memory/*` RPC + 记忆页。复用 KnowledgeStore 存储/CAS/作用域框架。[plans 索引](plans/README.md) B 节同批登记。纯设计，未改产品代码。

- 2026-10-21：[自学习闭环总方案](plans/sacode-self-learning-loop-2026-10-21.md)。串联调度者/记忆/skill 三子方案的蓝图。核心闭环：test/build/syntax 失败自动捕获 → 错题本（ErrorBook，按技术语言 java/cangjie/rust/ts 分类，不直接注入模型）→ skill 草稿生成（用户审阅才启用，版本化可回滚，C 决策不让步）→ 启用后注入模型避免再犯。新增会话内 `knowledge_save` 模型工具（走审批，plan deny/build ask）；skill 启用开关 D2（用户决定、跨会话持久、启用的目录摘要进 context）；skill 本地/线上来源标记 + 一键发布（密钥擦除+用户确认，平台接口待研究）；内置 create-skill 元技能；自动化生成文章列为后续阶段（F13 executor 未实现）。三个子方案按 §6 调整接口（记忆 rejected→错题本补充通道、skill 增 source/enabled/revision+草稿版本化、调度者员工增 enabledSkills）。[plans 索引](plans/README.md) B 节同批登记。纯设计，未改产品代码。

- 2026-10-20：[AppContainer exit 1 根因诊断](evidence/2026-10-20-appcontainer-exit1-root-cause.md)。`cmd`/`powershell`/`hostname`/最小静态 exe 在 AppContainer 内全部 exit 1 空输出，普通进程同条件 exit 0；token 为 `caps=0`、无 `ALL APPLICATION PACKAGES` 的 LPAC 形态，原始 `verify-windows-process.c` 本机重编译后 `FAIL real-exit-code`。判为 OS/AppContainer 层回归，非 PowerShell 参数、非 ACL；未改产品代码。

- 2026-10-20：[目标持续执行调度接入方案](plans/goal-execution-scheduling-design-2026-10-20.md)（F04，设计待评审）。对照 DSH `goal-round-driver`：SaCode 核心 GoalRunner 已能内循环，缺 Host 空闲边；不写产品代码。

- 2026-10-20：[模型 shell io-error 诊断折叠与 Windows 强制隔离接线](evidence/2026-10-20-model-shell-io-error-diagnosis-and-windows-wiring.md)。诊断折叠已闭合并经真实 Host 复验（回执带 `SANDBOX_UNAVAILABLE`）；AppContainer 私有通路已接入模型 shell，默认仍 fail-closed；enforcing 下命令真实启动，但 PowerShell/工作区 ACL 未完成，未取得通过结算，不升级交付。

- 2026-10-19：[c4 验收 bug 修复批次](evidence/2026-10-19-c4-acceptance-bugfix.md)：6 项（权限切换 turn-in-flight 友好提示、流式折叠跳位、工具卡复制按钮、重命名 CAS 冲突自动重读再试、provider 错误携带分类原因、shell 执行通路诊断折叠）。桌面 58/58 通过；仓颉端断言已更新待构建验证。

- 2026-10-19：[c4候选交接与手动验收](evidence/2026-10-19-c4-delivery.md)，含用户配置共享5/5、候选哈希与五项未验边界；候选待验。

- 2026-10-19：[Electron 测试环境门禁与交互跑道](clients/desktop/2026-10-19-electron-test-env-gate.md)。代理环境里把 16 项 `0x80000003` 假失败标为 `env-blocked-electron` 跳过；二轮修复 6 项非 Electron 前提（2 条缺 `SACODE_CLI`→`env-blocked-missing-cli`、3 条缺 openssl→`env-blocked-missing-openssl`、windows-artifact-export 改仓外中性目录后真过）。全套自测 **1066/1038 pass/0 fail/28 skip**；交互跑道 `scripts/run-electron-tests-interactive.cmd` 命中受限即 exit 2。判据＝默认沙箱最小 Electron 探针，不传 `--no-sandbox`。正向交互路径须用户复验。

- 2026-10-20：[「创建计划」接入方案（DSH Plan/Todo 调研）](plans/plan-todo-integration-design-2026-10-20.md)。更正前提：DSH 的 Plan 是 **plan mode**（`dsh-plan-mode`+`dsh-client-ui-plan`），`dsh-tool-workflow` 是多 agent 编排工具、与计划无关；Plan（AI 生成 markdown、用户审阅、`exit_plan_mode` 批准后退出并执行）与 Todo（`todo_write` 整表替换、`todos` 投影）正交，**计划审阅走 `user-questions` 通道而非工具审批**；Goal（`{id,revision}` CAS + round-driver）驱动轮次。SaCode 现状：**Todo 与 Goal 已完整**（`todo.cj`/`todo_tool.cj`/`todos` 投影/`TodoPanel`；`goal*.cj`+`goal/*`），**唯独计划无产品闭环**（`plan.cj:PlanModeController` 已废弃，`composer-menu.ts` "创建计划"按钮禁用），PRD 第 804 行同口径。推荐：复用 Todo/Goal/审批工单/权限模式，新增计划模式+`exit_plan_mode`+计划审阅通道，`execution/*` 与 Plan 不同层不可复用。纯调研设计，未实施。

- 2026-10-20：[MCP 接入方案设计](plans/mcp-integration-design-2026-10-20.md)。DSH 调研（静态配置发现、复用官方 SDK 握手、`mcp__<server>__<rawName>` 命名、原子世代交换、指数退避重连、本包不接审批）+ SaCode 现状对照（core 已有 `McpClient`/`McpRegistry`/`mcpPublicToolName`/`McpReconnectPolicy`，缺配置加载/`mcp/*` RPC/工具桥/UI/重连 supervisor）。推荐路径：stdio 优先、MCP 工具走 `approval/ask` 工单（比 DSH 更严）、`mcp/*` RPC 6 条、status 结构化暴露。纯调研设计，未实施。

- 2026-10-20：[技能清单接入方案设计](plans/skill-integration-design-2026-10-20.md)。DSH 调研（技能＝可复用任务专项指令文本，**非**"工具+提示词+约束"打包；provider 注册表+分层目录扫描 `.dsh/skills`/`.agents/skills`；`/name` 斜杠手势引用即注入；只注入 `<skill_content>` 文本，不注册工具、不进 system-prompt section、与 MCP 完全分离）+ SaCode 现状对照（`SkillRegistry` 是 log-only 存根无正文/provider；`composer-menu.ts` "技能"卡片误接 `extension/list` 普通工具——即用户反馈点；`user-text.ts` 已有 `/name` slash 钩子但无后端）。推荐路径：扩 `SkillRegistry` 持 content+provider、`FilesystemSkillProvider` 扫 `.sa-code/skills`+`.agents/skills` SKILL.md、`skill` 加载工具 + agent pre-step 注入、`skill/list`+`skill/get` RPC、UI 切数据源到 `skill/list`。纯调研设计，未实施。

- 2026-10-19 第一批仍未验收：[交互增量与验证边界](evidence/2026-10-19-first-batch-interactions.md)，新增接口见[会话交互契约](interfaces/session-interactions-2026-10-19.md)。不把诊断窗口或Host局部通过升级为同源版本交付。

- 2026-10-18 第一批进行中：[R4运行时与流式修复](evidence/2026-10-18-r4-runtime-and-stream-repair.md)。dev 源码定向65/65、诊断页面15项通过；不升级为同源候选或真实任务交付。

> **2026-10-18 当前主线：先交付一个走通版本。** 所有 IDE / AI 会话先读根 `AGENTS.md` 的最高推进优先级、[交付主线 §0](plans/product-closure-goal-2026-10-15.md#0-当前执行顺序先交付一个走通版本2026-10-18-用户确认) 与 [当前交付卡](product/PRD-tracking.md#当前交付卡2026-10-18-用户确认)。固定候选→同源完整包→普通用户条件真实任务→用户复验；阻塞期只修挡路问题，暂缓无关扩展，局部PASS不叫版本交付。F01–F21、安全与平台目标不删。

- 2026-10-17 A3 GPU 最小对照复验：[脱敏 HTML 报告](../target/tmp/codex-outputs-20261017/A3-GPU复验-20261017-1352.html)（临时运行报告，按用户裁决迁移），阻塞未解决，真实日志页面未验；任务34保持进行中。

> 本文件是 `docs/` 的**唯一入口索引**。先读分类体系与治理规则，再进各分类索引页。
> 全库约 260 篇：产品 3｜设计规格与计划 56（接口与对接另设专项总览，见 ⑨⑩）｜端文档 9｜测试与验收 10+｜工程治理 5｜历史证据 177＋8 数据文件｜历史验收 4。
> **维护规则：新增任何文档，必须同批登记到所属分类索引页；索引页与文档同批更新，不允许"只加文件不改索引"。**

---

## 0. 分类体系（十类）

| # | 类别 | 定位 | 物理位置 | 生命周期 | 索引页 |
|---|---|---|---|---|---|
| ① | **产品文档** | 需求、范围、授权与验收要求；**F01–F21 全程进度跟进** | `product/` | 活跃，随产品迭代 | [product/README.md](product/README.md) |
| ② | **设计文档**（体系/概要） | 总体方案、功能设计规格、UI/交互规范 | `plans/`、`superpowers/specs/` | 定稿后标注状态保留 | [plans/README.md](plans/README.md)、[superpowers/README.md](superpowers/README.md) |
| ③ | **详细设计文档**（接口/契约） | 接口、状态机、持久化、隔离等模块级设计 | `plans/`（契约类）、`plans/*.json` | 与实现对账，变更走增补 | 同上 |
| ④ | **实施计划与台账** | 分批计划、接入清单、SDD 台账 | `plans/`、`superpowers/plans/`、`superpowers/sdd/` | 执行期活跃，完结后归档 | [superpowers/README.md](superpowers/README.md) |
| ⑤ | **测试文档** | 测试规范、目录整理、验收观察、校验工具 | `testing.md`、`plans/test-layout*`、`qa/` | 规则活跃；观察快照冻结 | [qa/README.md](qa/README.md) |
| ⑥ | **构建与工程治理** | 平台构建/分发入口、产物治理、路径所有权 | `build-platforms.md`（并入原 `build-linux.md`）、`plans/` 治理类 | 活跃 | [plans/README.md](plans/README.md) |
| ⑦ | **历史证据** | 带日期与基线的取证读数 | `evidence/` | **冻结，不修改** | [evidence/README.md](evidence/README.md) |
| ⑧ | **历史验收** | 阶段验收观察（4 篇） | `qa/*.md` | **冻结，不修改** | [qa/README.md](qa/README.md) |
| ⑨ | **接口文档**（详细设计） | 各入口面（CLI / Host / 桌面 IPC / daemon / ACP / LSP / JS 扩展）的接口真源、契约与机器可读清单 | `plans/` 契约类＋`plans/*.json`；总览在 `interfaces/` | 与源码同批更新 | [interfaces/README.md](interfaces/README.md) |
| ⑩ | **对接方案** | 外部 Agent、远程/移动、页面业务与 Git/知识库/自动化的接线方案与状态边界 | `plans/` 对接类、`superpowers/plans/`；总览在 `integration/` | 执行期活跃 | [integration/README.md](integration/README.md) |
| ⑪ | **端文档** | 四个用户可交互前端（桌面 / CLI / 移动 / Web）的总览、逐端用途·需求·设计·边界·分步细节与跨端差异 | `clients/` | 随端迭代，与源码同批更新 | [clients/README.md](clients/README.md) |

**说明**：分类以逻辑归类为主，物理位置一般不做搬迁——证据区存在大量交叉引用、并发会话按现路径引用文档，搬迁易制造断链，这与 2026-10-16 产物治理确立的"约定＋索引＋守卫"是同一思路。**例外（2026-10-24）**：四端**专属**文档已按端归入 [`clients/<端>/`](clients/README.md)，并同批重写全库引用；通用/后端文档仍留在原目录，不迁移。

## 1. 治理原则（不可绕过）

1. **需求权威**：[`product/PRD.md`](product/PRD.md) 定义 F01–F21 与授权/任务验收；[`product/platform-and-distribution.md`](product/platform-and-distribution.md) 细化平台、安装渠道与 GitHub 构建。历史参考范围与模块数量不覆盖现行定位，**不计算整体完成率**。
2. **证据保全**：[`evidence/`](evidence/) 与 [`qa/`](qa/) 是带日期与基线的取证。新结果用新记录或明确的后续补记，不覆盖旧失败、不把旧通过升级成当前通过。PRD 内带日期的进度表同样是历史快照，不是实时真源。
3. **设计区核对**：[`plans/`](plans/) 与 [`superpowers/`](superpowers/) 的草案与"未实现"标签描述当时设计，**需核当前源码**，不能直接当作今天的实现证明。
4. **状态粒度**：分别登记源码/入口接线、固定提交构建、默认启动、真实任务、安装态与发布，按平台/架构记录；无法确认的写待核，工作区新增或删除不自动属于提交基线。

### 最新已登记的平台读数与当前主线

- 2026-10-18：[R2关闭重开持久性](evidence/2026-10-18-r2-cold-restart-persistence.md)取得实际双Host进程证据：获批edit→正常退出→同目录新进程只读RPC回放，40事件/8消息、plan与工作区/追踪一致，日志字节不变、未重放任务；1/1。只验证协议Host，本地合成模型/外部Node单测，完整GUI及真实LongCat仍待验。

- 2026-10-18：[用户指定R2中性包三路径协议验收](evidence/2026-10-18-r2-three-path-protocol.md)：mock 3/3，allowed真改且外部测试过，denied/cancelled文件不变，三个Host自然退出0。真实LongCat因进程未注入凭据尚未开始；不另出候选，不把协议mock或外部代跑测试称产品完整交付。

- 2026-10-18：[模型拉取结果未知核对](evidence/2026-10-18-model-pull-unknown-verification.md)补强持续提示、禁重复及查询失败分列；即使目录已更新也不据此报本次成功。状态/页面18/18、定向63/63、默认沙箱Electron真实核对1/1；无安装包替换，D22仍部分修复。

- 2026-10-18：[桌面模型拉取查询与取消](clients/desktop/2026-10-18-model-pull-desktop-lifecycle.md)接入供应商页：先持有操作ID再发起，未知不重发，取消与收束分开。定向58/58、桥接2/2、中性默认沙箱Electron/Host集成2/2；IPC149/149。未提交/未正式打包/未验安装态，跨renderer重启恢复未实现，D22保持部分修复。

- 2026-10-17：[Host模型发现生命周期](evidence/2026-10-17-model-pull-host-lifecycle.md)及[接口契约](interfaces/model-pull-lifecycle-2026-10-17.md)：网络总预算默认20秒，精确操作查询/取消，超时禁止迟到写库。核心16/16、真实Host/兼容集成16/16；Host178条门禁与13条自证通过。DNS等系统调用的资源退出、桌面接线及安装态仍待验，D22部分修复。

- 2026-10-17：[模型拉取超时复核](evidence/2026-10-17-model-pull-timeout-followup.md)：撤回全局 revision 推断迟到成功；工作区模型拉取单独等待30秒，超时标未知、不自动重发。定向28/28、模型中心16/16、真实中性Host1/1；D22部分修复，页面4组失败、Host操作级结算与安装态仍待验证；[初轮记录](evidence/2026-10-17-model-pull-timeout-fix.md)保留历史。

- 2026-10-17：[Windows 进程完整提案绑定](evidence/2026-10-17-windows-process-proposal-binding.md)为生产装配前的必要安全切片；非空私有工作区安全回收仍缺原语，默认 Windows Host/CLI 执行门禁不开放。

- 用户提供 Linux `2c56c76`：core、CLI、daemon 构建通过，CLI 约 14 MB；Host 未编，桌面/服务真实任务与安装尚未验收。依赖设置见 [`build-platforms.md`](build-platforms.md) §2（原 `build-linux.md` 已并入）。
- Windows 当前版入口、ACP/LSP 与安装后任务由 codex 交付线收口；历史 P0 或测试数不代替其验收。
- Windows/Linux/macOS 的 CLI/服务/Electron 桌面为目标；鸿蒙 CLI 保留，后续独立 ArkTS/ArkUI 前端。macOS/鸿蒙无设备不撤销目标，运行状态仍待验。跨平台入口见 [`build-platforms.md`](build-platforms.md)。
- 一次性产物已统一至仓根 `target/tmp/`（`**/target/` 全局忽略），守卫 `scripts/check_artifact_placement.cjs` 已上线；`dist/` 只保留当前正式分发产物。详见 [`plans/artifact-layout-and-retention-2026-10-16.md`](plans/artifact-layout-and-retention-2026-10-16.md)。

## 2. 阅读路径

| 场景 | 顺序 |
|---|---|
| 新人入门 | 本文件 → [`product/PRD.md`](product/PRD.md) → [`product/platform-and-distribution.md`](product/platform-and-distribution.md) → [`plans/README.md`](plans/README.md)（设计全貌）→ [`testing.md`](testing.md) |
| 改代码前 | PRD 对应 Fxx → 分类索引页检索相关设计/契约 → [`testing.md`](testing.md) → [`qa/README.md`](qa/README.md)（工具） |
| 验收/发布前 | [`testing.md`](testing.md) → [`qa/README.md`](qa/README.md) → `evidence/` 近期读数 → [`product/platform-and-distribution.md`](product/platform-and-distribution.md) |
| 查历史结论 | [`evidence/README.md`](evidence/README.md)（冻结区检索规则）→ 按日期/主题定位原文件 |

## 3. 新文档落点与命名

| 要写什么 | 放哪 | 命名 / 要求 |
|---|---|---|
| 产品需求、范围、授权变更 | `product/` | 改 PRD 或写专项；必须标状态与基线 |
| 功能设计规格 | `superpowers/specs/` | `<日期>-<主题>-design.md`，配 `plans/` 同名实施计划 |
| 项目级实施计划 | `plans/` | `<日期>-<主题>.md` 或 `<主题>-<日期>.md` |
| 接口/契约/详细设计 | `plans/` | `<主题>-contract-<日期>.md`；机器可读契约用 `.json` 同目录 |
| 取证读数 | `evidence/` | `<主题>-<日期>.md`（新式）；冻结，只增不改 |
| 验收观察 | `qa/` | `<主题>-<日期>.md`；配套工具用 `.cjs`/`.mjs` |
| 文档模板 | `templates/` | 见 [`templates/README.md`](templates/README.md) |
| 端规格（某端的用途 / 需求 / 设计 / 边界 / 分步细节） | `clients/<端>/` | `README.md`（规格）+ `documents.md`（归类索引）；其余本端专属文档同目录；五要素齐全，与 [`clients/README.md`](clients/README.md) 的跨端差异矩阵同批更新 |

## 4. 维护记录

- 2026-10-24（端文档体系）：新增 `clients/` 并按端**物理归入端专属文档**——[总览](clients/README.md)（共享契约 + 跨端差异矩阵 + 红线）、四端目录 [`desktop/`](clients/desktop/README.md)/[`cli/`](clients/cli/README.md)/[`mobile/`](clients/mobile/README.md)/[`web/`](clients/web/README.md)（各含端规格 `README.md` + 归类索引 `documents.md` + 该端专属文档）。按名称规则把 `evidence/`、`plans/`、`product/`、`superpowers/` 中 94 篇端专属文档移入对应端目录（`git mv`，保留历史），通用/后端 286 篇留原位；同批重写全库相对链接与正文路径引用并做断链校验（仅余既有断链）。纯文档整理，不改源码、不改 PRD/台账状态、不提交。

- 2026-10-20（功能域设计批量归档）：十四份功能域设计文档从 `target/tmp/` 归档到 `docs/plans/`：F06 上下文压缩、F08 Git 工作台后端、F09 实时交互终端（后端+前端两份）、F11 知识库索引服务（CodeArts + MonkeyCode 两份互补）、F13 自动化与 Hooks、F14 浏览器与电脑操控、F15 SSH 后端、F16 数据库面板、F17 三层安全扫描、F18 语音与提示词增强、F19 数据导入（OpenCode + Qoder 两份，调度方判定以 Qoder 版为实施基线）。[plans 索引](plans/README.md) B 节与详细设计覆盖速览同批登记。全部为纯调研设计，未改产品代码。

- 2026-10-20（统一构建 T8 轮）：CodeBuddy 统一构建 T8 轮：core 构建 PASS，core 测试 FAIL（`plan_permission_test.cj:217` 类型不匹配 `ArrayList` → `Array`，归属 Trae 新增文件，0 用例执行，超 30min 上限），Host 构建未启动。Trae 已修复（`.toArray()`），等待重开 core 测试 → Host 构建。构建期间六方并行推进功能域设计任务，不阻断构建。

- 2026-10-20（六方修复收齐停写）：OpenCode 技能编译（`skill_filesystem.cj` Byte/trim/Path）、Trae 计划持久化（`plan_review.cj` 批准→持久化→放行，`main.cj` 1 行计划装配）、MonkeyCode 目标三项（cancel 不续跑/满额 blocked/输入不重不丢，`main.cj` 目标区域 3 处）、CodeBuddy shell 收口（`windows_process_adapter.cj` 事实桶+泄漏计数）、CodeArts 前端目标可见性（`goal-bar.ts` pendingTurnCount + `send-queue-state.js` 在途区分）全部停写。LSP 结果渲染组件（`lsp-results.ts` 7 verb 全覆盖 13/13 测试）与 Git 工作台前端在 CodeArts 并行推进。

- 2026-10-20（03:48六方阶段调度）：[产品台账](product/PRD-tracking.md)与[提示词交付页](../target/tmp/coordination-20261020-r3/outputs/六方阶段调度与可转发提示词-20261020.html)同步OpenCode/Trae/Monkey/CodeArts/CodeBuddy/Qoder六份自包含任务。阶段修复收齐后统一构建、独立验收、失败回派；main.cj按Trae→Monkey交接，其他独立范围并行。协调者按回报推进，不重复源码核查或构建；任务已形成，未确认转发接收，不新增实现或发布授权。

- 2026-10-20（OpenCode技能样例审核）：[实时台账](product/PRD-tracking.md)当前卡/F12登记25合成场景、27技能输入、60058B/70058B已核；矩阵仅预期，未运行解析器。当前标志未接生产调用策略，不把/name或模型限制当既成行为；读取预算/异常、祖先提前break及测试默认真实用户层须定点收口，四份技能文件仍匹配T7，统一编译阻塞未变。审核与自包含回派见 `target/tmp/coordination-20261020-r3/outputs/OpenCode-技能样例审核与定点回派-20261020.txt`；只形成任务，不冒称已下发/执行，不开放技能第3段或共享构建。

- 2026-10-20（Qoder原生准备审核）：[实时台账](product/PRD-tracking.md)登记准备回报已核及分阶段裁定：固定Clang22.1.0、冻结输入、独立输出，不改.deps/共享脚本；任务书仅独立构建+35项进程探针诊断，47/54/正式Host另排、core仍唯一构建方。原`--verify`与workspace驱动仍会先覆盖.deps，不能原样执行；同调用生成manifest不保证同源。未实际编译/跑探针，未解除产品门禁。

- 2026-10-20（协调复核）：更新 [PRD-tracking当前交付卡](product/PRD-tracking.md#当前交付卡2026-10-18-用户确认) 与F03/F04：前端r2八份TAP核对94/94、五项GUI未验；统一core第二轮rc=1，测试/Host未执行，阻塞回派技能归属方。旧临时协议结果已撤回为3 PASS/2 BLOCKED；goal-bar旧脏差异未证明完整恢复，shell监督事实/回收所有权与原生同源风险仍开放。下方/顶部历史AppContainer“LPAC、OS回归、初始化或ACL唯一根因”属于当时推断，当前未证实；不据此改token/ACL或降低沙箱。未构建、提交、推送或发布。

- 2026-10-20：新增 [`plans/goal-execution-scheduling-design-2026-10-20.md`](plans/goal-execution-scheduling-design-2026-10-20.md) —— F04 自动跨轮执行接入方案（DSH round-driver / epoch / projection 权威清边对照；推荐 Host 持有 `GoalActivation` + `requestGoalDrive`，不新增 RPC）；[plans 索引](plans/README.md) 同批登记。纯设计，未改产品代码。

- 2026-10-17：[仓颉私有 cwd 任务](evidence/2026-10-17-cangjie-private-workspace-task.md)定向真实 DLL 16/16；尚无生产快照、受保护子树排除与 F08 合入，不开放公共门禁。

- 2026-10-17：[私有任务目录](evidence/2026-10-17-windows-private-workspace-scope.md)原生范围 47 项通过，原生进程 35 与共享监督 13/13 复验；不代表真实工作区、网络或产品门禁开放。

- 2026-10-17：[Windows 共享监督装配](evidence/2026-10-17-windows-execution-supervisor-integration.md)真实任务链定向 13/13；Host/CLI 默认装配与工作区隔离仍待完成。

- 2026-10-17：[Windows 共享结果转换](evidence/2026-10-17-windows-process-collector.md)真实进程定向 9/9，D14 与公共执行装配仍未完成。

- **2026-10-17（仓颉 Windows 进程适配）**：新增 [真实 DLL 与取消/双流/清理集成 5/5](evidence/2026-10-17-windows-cangjie-process-adapter.md)，提供可复用定向验证入口；公共执行器、ACL、打包及真实任务仍待接通。

- **2026-10-17（Windows 原生进程组件）**：新增 [AppContainer/管道/Job 所有权薄层实测](evidence/2026-10-17-windows-owned-process-provider.md)，35 项检查通过；组件未接仓颉执行器与产品打包，不能开放执行门禁。

- **2026-10-17（AppContainer 身份探针）**：新增 [最小环境与身份实测](evidence/2026-10-17-appcontainer-minimal-environment.md)。原生对照定位空子环境的 error 203，仓颉加入 LOCALAPPDATA/SystemRoot 后身份测试 5/5；仍未开放实际执行后端，工作区/网络/后代隔离继续待验。

- **2026-10-17（本轮·cjpm build.cj stagePostBuild hook 全流程打通）**：新增 [`evidence/2026-10-17-cjpm-build-cj-stage-post-build-hook.md`](evidence/2026-10-17-cjpm-build-cj-stage-post-build-hook.md) —— 解决 issue #725（上游 cjpm build 不复制 bin-dependencies 的运行期 DLL），用户不能等上游修。cjpm 1.1.3 原生支持 `build.cj` 钩子（`stagePostBuild(): Int64` 在 build 后自动执行）；复制 DLL 用 `File.readFrom` + `File.writeTo`（字节读写，`std.fs.copy` String 重载不可靠 native error -1）；干净目录 `D:\tmp\build-cj-clean-20261017` 验证 90+ 个 DLL 全部复制成功；**仓内 apps/cli/build.cj 落地受阻根因＝仓库根 ACL 被 Codex 沙箱化**（`Everyone:(I)(CI)(DENY)(DC)` + `CodexSandboxUsers` SID，File.readFrom "Failed to open" 包括项目内文件），同 0x80000003（D10）问题族；修复方向：① `icacls /remove` 移除沙箱 SID + 解除 DENY；② 中性导出到 D:\tmp 再构建；[`evidence/README.md`](evidence/README.md) 主题表同批登记。

- **2026-10-17（本轮·CLI 启动 0xC0000135 根因与夹具对齐）**：新增 [`evidence/2026-10-17-cli-launch-0xc0000135-stdx-dll-missing.md`](clients/cli/2026-10-17-cli-launch-0xc0000135-stdx-dll-missing.md) —— CLI 入口 0xC0000135 = STATUS_DLL_NOT_FOUND，根因是 `knowledge-context-cli.test.mjs` env 白名单孤儿化丢失 stdx 目录；修复＝对齐 worktree/remote/team-command/tips-surface 四夹具既有约定（拷 process.env + 前置 `SACODE_STDX_DLL_DIR`/`SACODE_RUNTIME_DLL_DIR` 到 PATH）；上游关联 atomgit #725；环境侧闭合，逻辑侧缺口另列 D13 延伸；[`AGENTS.md`](../AGENTS.md) 「环境」节新增「运行期 DLL 路径约定（防 0xC0000135；codex 必读）」段落固化约定；[`evidence/README.md`](evidence/README.md) 主题表同批登记；[`product/PRD-tracking.md`](product/PRD-tracking.md) D13 同批更新环境侧闭合 + 逻辑侧另列。

- **2026-10-16（本轮·三问题排查）**：新增 [`evidence/2026-10-16-windows-startup-three-issues-diagnosis.md`](evidence/2026-10-16-windows-startup-three-issues-diagnosis.md) —— ①双击 `0x80000003`（根因定位＝仓库根 Low Mandatory Level 继承链，中性导出对照 SMOKE PASS）②仓颉运行时 DLL（全位置哈希盘点＋重打路径）③NSIS 临时文件错误（最小探针三格对照实证）三问题排查与修复可行性；[`product/PRD-tracking.md`](product/PRD-tracking.md) D10 更新为"根因已定位"、新增 **D18**（NSIS）/ **D19**（旧 DLL 载荷）与 §3 平台快照同步；[`plans/windows-dependency-and-compatibility-2026-10-16.md`](plans/windows-dependency-and-compatibility-2026-10-16.md) §1/§3/§4/§5/§6 同批更新；[`evidence/README.md`](evidence/README.md) 主题表同批登记。
- **2026-10-16（本轮·Windows 依赖评估）**：新增 [`plans/windows-dependency-and-compatibility-2026-10-16.md`](plans/windows-dependency-and-compatibility-2026-10-16.md) —— 构建/桌面/CLI 三层依赖清单、11 项 Windows 特有问题（含分发载荷需重打包换修正运行库的关键发现）、普通用户可行性与降级策略；[`product/platform-and-distribution.md`](product/platform-and-distribution.md) 与 [plans 索引](plans/README.md) 同批互链登记。
- **2026-10-16（本轮·PRD 跟进台账）**：新增 [`product/PRD-tracking.md`](product/PRD-tracking.md) —— F01–F21 全程跟进台账（逐域状态、缺陷登记含证据与闭合历史、平台快照、关键分母读数）；[`AGENTS.md`](../AGENTS.md) 新增「文档同步规则」：**完成功能或闭合缺陷必须同批更新 PRD-tracking 与 PRD**；[`product/README.md`](product/README.md) 清单与使用规则同批登记。同批订正 [`interfaces/README.md`](interfaces/README.md) 的 Host 读数：原按 `host-capabilities.json` 记 120 条，现按门禁实测订正为工作区 **169**（164 字面 + 5 目标）/ HEAD 冻结 **158**，json 文件标注已过期（D11）。
- **2026-10-16（本轮·合并与专项总览）**：`plans/sacode-workbench-visual-direction-2026-10-07.md` 并入 [`product/desktop-design-standard.md`](clients/desktop/desktop-design-standard.md)（附录「交互原型修订记录」）；`build-linux.md` 并入 [`build-platforms.md`](build-platforms.md) §2（stdx 配置与 Linux 读数）；两份原文件降为历史指针，保住冻结证据与脚本的原有引用路径。新增 [`interfaces/README.md`](interfaces/README.md)（接口面速查＋契约与机器可读清单；Host 读数后经门禁实测订正为 169/158，见上行）与 [`integration/README.md`](integration/README.md)（对接方案状态总览）；分类表由八类扩为十类。
- **2026-10-16（本次）**：归类版重构——本文件重写为八类总览；新增五个分类索引页（[product](product/README.md)、[plans](plans/README.md)、[superpowers](superpowers/README.md)、[qa](qa/README.md)、[evidence](evidence/README.md)）与 [`templates/`](templates/README.md)；`plans/` 补齐 10-11～10-16 新增 15 篇的登记。
- 2026-10-15/16：测试临时根迁移至 `target/tmp/`，守卫上线（[`testing.md`](testing.md)、[`plans/artifact-layout-and-retention-2026-10-16.md`](plans/artifact-layout-and-retention-2026-10-16.md)）。
- 2026-10-13：README 口径更新（平台读数、历史化标注）。
- 2026-10-09：初版索引与进度对账节。

2026-10-17 提交整理：[独立候选复验](evidence/2026-10-17-windows-execution-commit-candidate.md)，只纳入已验证的 Windows 执行内部组件与私有目录，保留未完成和其他会话改动。

2026-10-17 EX-01/D14 后续：[工作区快照与变更导出](evidence/2026-10-17-windows-workspace-snapshot.md)当前定向 23/23，通过实际私有任务增删改、来源变更拒绝、硬链接/junction/越界拒绝及同日志审批前绑定。摘要的产品审批展示、整树终态约束、F08 合入和默认 Host/CLI 装配仍待完成，D14 不解除；一次 5 秒超时原因未定位。

2026-10-17 EX-01/REVIEW-01：[快照终态导出](evidence/2026-10-17-workspace-snapshot-settlement.md)已消费共享日志的 exited/退出观察/输出完整及快照绑定事实；真实任务与磁盘重放断言在 23/23 中通过。审批展示、启动复核及 F08/CAS 接线待实施，默认门禁不开放。

2026-10-17 EX-01/REVIEW-01：[快照审批与启动复核](evidence/2026-10-17-workspace-snapshot-approval.md)新增精确票绑定回执摘要、任务投影及页面范围展示；实际来源更新后拒绝恢复线程。核心集成 24/24，页面状态/渲染 13/13；完整桌面/Host 快照生命周期和 F08/CAS 仍待接线，门禁保持关闭。

2026-10-17 REVIEW-01/产物：[任务差异登记与真实 Host 消费](evidence/2026-10-17-task-review-persistence-host.md)复用 AttachmentStore 保存前后文件对象，同日志 execution/review 登记身份；核心 24/24、页面 16/16、当前 Host 真实历史投影及页面渲染通过。正文预览、F08/CAS 写回、Host 快照执行生命周期和完整桌面仍待完成，默认门禁关闭。

2026-10-17 F08/REVIEW-01：[任务正文预览](evidence/2026-10-17-task-review-body-preview.md)新增有限 execution/review-file，Host/CLI/IPC/页面读取登记的前后内容对象；核心24/24、页面19/19、桥接3/3及真实Host/CLI通过。写回审批/CAS与默认Host快照执行未开放。

2026-10-17 F08写回前置：[单文件条件写](evidence/2026-10-17-review-file-compare-exchange.md)新增独占句柄核对旧字节的内部创建/替换/删除原语，真实DLL定向28/28。尚非多文件或断电原子合入；审批/持久意图/部分成功与未知结算及产品写回未接，门禁关闭。

2026-10-17 F08：[写回审批与持久意图](evidence/2026-10-17-review-apply-journal.md)核心复用同一日志/lease/精确一次票/取消令牌，写前屏障与逐文件结算、部分成功及未知不重放，真实DLL定向36/36。公共写回动作、hunk及完整桌面仍未接，不升级产品完成状态。

2026-10-17 F08：[目录身份与固定原生库装配](evidence/2026-10-17-review-directory-identity.md)完成核心保护，真实DLL定向39/39、零跳过。拒绝同路径目录实体替换；旧记录保留只读。公共异步写回、双入口与桌面操作仍待接通，不升级产品完成状态。

[异步写回接入约定](interfaces/execution-review-apply-2026-10-17.md)：产品接线约束，非已发布能力清单。

2026-10-17 F08：[异步写回与停止边界](evidence/2026-10-17-review-apply-async.md)核心40/40通过；提交中查询/停止及时返回，后续文件不再写入，重复启动拒绝。公共双入口和页面仍待接通，默认门禁关闭。

2026-10-17 F08：[双入口及页面实际写回](evidence/2026-10-17-review-apply-product-entries.md)有限prepare/apply/describe/stop及页面独立确认已接；核心41/41、页面24/24、桥接4/4、真实组件→IPC→Host及CLI17项通过，合成项目实际增删改。Host176/IPC147；完整Electron/安装态、默认快照执行及在途Host停止仍待验，不解除D14与整体目标。

2026-10-17 EX-01/F08：[原工作区与私有执行目录映射](evidence/2026-10-17-snapshot-logical-workspace.md)真实定向42/42、页面27/27。会话目录/修订与原文件不变，仅私有副本改变并登记差异；默认Host/CLI生命周期尚未装配，D14及整体目标保持未完成。并发源码边界见证据。

2026-10-17 EX-01：[私有副本有界清理](evidence/2026-10-17-private-workspace-disposal.md)新增仅消费自有根句柄的内容清理，真实定向45/45。嵌套清理、占用后重试及链接拒绝/外部哨兵保护通过；默认Host/CLI资源生命周期尚未装配，D14与整体目标保持未完成。格式后复编边界见证据。

2026-10-17 EX-01/F08：[自动审查与资源收束](evidence/2026-10-17-execution-snapshot-settlement.md)共享监督器可信结束阶段47/47，差异持久化后才删除副本/释放profile和库；失败保留真实退出事实，晚期释放可在同进程重试。默认Host/CLI准备所有权尚未接通，D14与整体目标未解除。

2026-10-18 F08/EX-01：[私有执行生命周期与真实双入口](evidence/2026-10-18-execution-capsule-entries.md)：核心定向50/50、真实状态层→IPC→Host及CLI 13项、桌面定向14/14；同进程准备/独立审批/执行/审查/写回及EOF取消收束已实测。未提交增量；项目与会话数据重合、完整Electron/安装态及隔离专项仍待验，整体功能不升级完成。

2026-10-18 F08/EX-01：[项目与会话数据同目录](evidence/2026-10-18-colocated-execution-metadata.md)：按真实日志/租约/附件路径排除元数据，保留用户同名文件；新产物同目录与分离布局真实Host/CLI各13项通过。核心52项首轮51通过1清理错误，修正夹具后完整52/52通过、零跳过/错误/失败；不升级整体完成状态。
