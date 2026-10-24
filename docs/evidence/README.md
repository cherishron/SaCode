# evidence/ — 历史证据（冻结区 · 索引）

> **冻结说明**：本区为带日期与基线的历史取证，正文按当时记录**保持原文、不修改**。其中出现的早期外部参考项目名称仅作追溯，不代表当前产品定位或能力来源；现行产品范围与自研口径以 [PRD](../product/PRD.md) 与根 [README](../../README.md) 为准。

- 2026-10-24：[repo-conventions Skill 发布](2026-10-24-repo-conventions-skill-publish.md)：通用 skill（仓库约定与项目治理：结构/文档/测试/提交安全/多 agent 协作/初始化/体检）发布到 SkillHub，1.0.0 / 8 文件 / `skillId 293070`，提交成功待审核；结构测试 6/6、dry-run 通过。**同日扩版 1.1.0 / 14 文件 / `versionId 459409`**：新增 6 领域（H 错题本、I PRD/需求管理、J 文档维护、K 项目评审、L 安全审查、M 提交编排与推送），结构测试 10/10、dry-run 通过；提交成功待审核。

- 2026-10-24：[repo-conventions 项目体检（G·只读）](2026-10-24-repo-conventions-project-audit.md)：按 skill G 流程只读扫描——**安全/产物无 P0**（密钥 1455 文件零命中、跟踪产物 0）；P1：读数基线过期（D28）、core 单测不可编译（D27）、`git status` 547 项未提交、协作登记未全覆盖；P2：活文档残留参考缩写、`docs/errors.md` 缺失、3 个空 `tmpDir*`。未跑构建/测试、未改文件、未提交。

- 2026-10-24：[项目评审：安全/代码/架构/治理](2026-10-24-project-review-security-code.md)：抽样评审；安全抽查未发现可直用 P0 漏洞（沙箱 fail-closed、审批一次性票据、凭据引用缝、IPC 有限面为强项）；新增登记 D27（全量单测无法编译）、D28（无固定基线）、D29（凭据明文）、D30（浏览器 `--no-sandbox`）、D31（无持续安全扫描）。

- 2026-10-24：[F13 自动化调度「持久触发准入」核心切片（AU-02 第一阶段）](2026-10-24-automation-trigger-admission-core.md)：确认自动化「未接通」=已立项未开始的 AU-02（非桌面降级）；按设计稿先落 `core/src/automation_trigger.cj`（独立版本化日志、单写者租约、幂等键不含 `definitionRevision`、准入先 flush 屏障后改内存、`overlap=skip`、重开未结算降 `unknown` 禁重发、`misfire=skip` 水位、Cron 边界复用严格校验+IANA 时区）。`cjpm build` rc=0（36 warnings）；core `cjpm test` 本机编译/链接停滞 >15min 未执行，**不宣称通过**；未动 daemon/Host/桌面。下一步 F13-E 交接（Runner/调度 owner/Host 运行方法/桌面运行记录）。

- 2026-10-24：[桌面端降级审计](../clients/desktop/2026-10-24-desktop-degradation-audit.md)：核查 `apps/desktop` 的「降级」——多数「未接通/未实现」是**后端本就未实现**的如实标注（A1 自动化执行器 `install()` 全仓无装配调用方、`automation/tick` 恒空=F13/D07；A2 费用统计探测/加速列 `PROBE_MINIMAL_MODE` 无产品调用方；A3 插件安装取消=Host 无 `plugin/install/cancel` 且 `install/start` 假异步），**不硬修以免伪造**；实修真降级 3 处（插件安装源读取失败不再静默退默认源、迁移复制给失败反馈、模型中心账本失败提示去「等 §6」）。读数：定向 **37/37**、渲染层门禁 **13/13**、IPC **212↔212 GATE PASS**，合计 **50/50、0 失败/跳过**；纯渲染层、未改 core/Host、未打包/提交。

- 2026-10-24：[TUI @文本文件引用](../clients/cli/2026-10-24-cli-tui-text-references.md)：Host read→flush→资料快照append→task/start，默认取消/部分失败不发/未知禁重发；114/114、12宽窄帧、本地HTTP实际收到正文、冷重开保留。包561,133 B / `db9ad1b4…`，非通用附件或真实供应商验收。

- 2026-10-24：[TUI会话管理](../clients/cli/2026-10-24-cli-tui-session-management.md)：搜索/改名/归档恢复，原修订确认/默认取消/未知禁重发，首次空会话精确投影；99/99、14宽窄帧及显式/无参默认入口rc0。包547,489 B / `b02920b1…`，真终端/模型/安装仍待验，不升级F01。

- 2026-10-24：[内置浏览器 WebContentsView 接线（F14 人工浏览入口）](2026-10-24-browser-webcontents-view-wiring.md)：主进程 `WebContentsView` 控制器 + 8 条 `browserView*` IPC（Open/Describe/Navigate/Back/Forward/Reload/Close/Layout），隔离会话（非 persist）、跨站/下载/权限/新窗口默认拒绝、弹层与切页隐藏、切项目销毁+清旧 cookie；渲染层 `BrowserPanel` 重写并接入工作台「内置浏览器」资源。单元+真实 Electron 套件 **10/10**（含 20 项实跑检查）、`--ui-smoke` BROWSER_MAIN PASS 5 项、IPC 212/212 GATE PASS、相邻 18/18。未改 core/Host、未接 Agent provider/截图/多标签/电脑操控、未重打候选；不升级 F14 完成。

- 2026-10-24：[TUI配置与模型状态细化](../clients/cli/2026-10-24-cli-tui-configuration-refinement.md)：新建表单可返回校验、凭据隐藏/不入会话、前后回读/未知禁重发；82/82，真实Host隔离保存冷重开/HTTP0请求、10合成帧。非供应商可用性或F07全域验收。

- 2026-10-24：[交互终端接线批（F09）](2026-10-24-terminal-interactive-wiring.md)：Host 补齐 `terminal/output`（Host 侧有界直播环）/`terminal/kill`，`terminal/close` 改为**只拆视图**（close≠kill，对齐设计稿 §3.1/§4）；`describe` 去掉 `data` 补 `phase`；`authorizeCreate` 绑定当前会话工作区。桌面 preload/main +2 通道、`app.js` 挂载 `TerminalInteractive`+150ms 轮询、新增 `terminal-interactive.css`。`cd apps/host && cjpm build` rc=0（含新标记）；离线回归 4/4、相邻渲染层 15/15、声明面 227（+2）。core 0 行改动；真实 PTY 往返与 GUI 未验，未重打/提交。

- 2026-10-24：[默认开发Host刷新补验](2026-10-24-host-skill-workspace-cache-fix.md#同日续批默认开发载荷刷新用户继续授权)：同次构建80DLL重组载荷709文件、逐哈希一致；默认Host7/7+TUI73/73，主包无覆盖无参/显式入口和剥SDK PATH伪TTY读技能正文rc0。保留旧目录，不改正式桌面候选。

- 2026-10-24：[Host技能工作区缓存修复](2026-10-24-host-skill-workspace-cache-fix.md)：同环境provider正常、Host重选会话才恢复，根因为缓存空工作区/未回放日志；同快照旧逻辑3败→修复运行3过+surface/dispatch2过，TUI73过0跳过。私有Host71389261…，旧开发/桌面载荷未替换。

- 2026-10-24：[TUI 能力浏览与技能发现阻塞](../clients/cli/2026-10-24-cli-tui-capability-views.md)：只读技能/MCP/模式入口及会话草稿隔离，72过/1门禁跳过，独立技能验收0过/1败（合法合成技能未发现），失败保留。包`bfb74c6b…` / 529,688 B，12合成帧通过；非完整技能/MCP交付。

- 2026-10-24：[TUI 路径引用与真实差异](../clients/cli/2026-10-24-cli-tui-workspace-views.md)：Home/End、@目录/路径补全（非正文附件）、/diff精确身份只读Git、失败/截断/未跟踪提示；63/63，包`74a9c6e7…` / 523,224 B。真实Host读取patch与同目录Git一致，不写索引/日志；真任务/安装未验。

- 2026-10-24：[TUI 四方向细节打磨](../clients/cli/2026-10-24-cli-tui-polish.md)：代码原文保真/轻量着色、Markdown/表格、草稿撤销边界/搜索、工具展开、审批请求预览与默认拒绝；52/52，10帧合成取样，包 `2b258424…` / 511,622 B，46文件打包清单含随包许可。真实终端/模型/安装未验。

- 2026-10-24：[供应商页新增/编辑表单改为弹窗（试点）](../clients/desktop/2026-10-24-provider-editor-dialog.md)：表单从列表后的内联 `fieldset` 改由共享 `SaCodeDialog` 承载（760px 宽变体、操作条 sticky、错误在弹窗内、保存中关闭被守卫），列表不再位移；真 Vue 结构回归 2/2 + HEAD 反证 `RED-AS-EXPECTED`、受影响非 Electron 34/34、渲染层门禁 22/22。真实 Electron 在仓外中立目录实跑（仓库内受完整性标签 `0x80000003`）：门控 7 项 **7/7 通过、0 跳过**（首轮 4 败为驱动侧两处失效断言：价格字段按旧标签取节点、内置供应商说明文案，已按结构/现文案修正，未改并发改动）；`--ui-smoke` RC=0 `MODEL_MAIN_SMOKE PASS`，观感待用户确认；其余页面内联表单未动，未重打候选。
- 2026-10-24：[P0 跨端打通前闸门](2026-10-24-p0-cross-end-gates.md)：P0-1 `--manage grant-scope` scope 闭集授予、P0-2 `turn/poll` 游标重放（`TurnFrameJournal`，page 不消费、take 兼容旧消费）、P0-3 `session/projection` 精确读取 + 活动会话方法错配 `-32001 session-mismatch` 早期拒绝。daemon 级 **31/31**、桌面 `session-identity` **3/3**、游标双客户端用例 1/1；Host/daemon 构建 rc=0，二进制含全部 P0 标记。core `cjpm test` 因 HEAD 同名 `@Test` 编译失败（P0 文件零 error、库编译成功）；extension/host spawn 经旧二进制（10-22 01:05）对照确认预先存在工具链问题；remote-product 5 条 openssl ENOENT 环境阻断。未提交/安装/发布，不升级 F 域。

- 2026-10-24：[extension/host 5 红环境根因](2026-10-24-extension-host-env-root-cause.md)：`bridge.test.mjs` 的 extension/host spawn 族（#33/35/36/37/38）定性为**环境问题**——仓库根 Low Mandatory Level 标签被宿主 EXE 继承为 Low IL，其拉起的 node 子进程 `lstat('D:\')` 被拒（`EPERM -4048`）→ 主模块解析失败、秒退、0 帧→`js-host-handshake-timeout`；P0「从未出现子进程」为采样漏采（子进程确已起、毫秒级退出）。A/B（同源码/二进制/node/脚本，仅宿主位置不同）：仓库内宿主 39 用例 33 pass/5 fail/1 cancelled，中性导出宿主（`SACODE_HOST`）extension 子集 **7/7**、全量 **83/83**。非代码缺陷；临时诊断已回退、`core` 与 HEAD 无差异；未改 ACL/完整性标签。

- 2026-10-24：[桌面渲染层视觉一致性修复](../clients/desktop/2026-10-24-desktop-renderer-ui-token-unification.md)：`styles.css` 成为唯一令牌真源（下游重定义 0），LSP 面板暗色适配，`--settings-*` 根级化，对比度 18/18 PASS，圆角/字号/间距回到冻结档位，焦点环补 `select`；postcss 21 文件 0 错、渲染层门禁 6/6、受影响组件 26 过/5 环境跳过。未做 GUI 验收，未重打候选，未提交。

- 2026-10-24：[TUI 骨架重写](../clients/cli/2026-10-24-cli-tui-skeleton.md)：历史流 Static/全屏切换、Markdown 块级渲染（适配 Gemini CLI Apache-2.0）、工具卡内联、`/auth` 安全配置表单、审批选项互斥；36/36，新包 `a2ee51eb…` / 496,951 B。代码高亮/@文件/完整按键/MCP 等仍缺。

- 2026-10-24：[上下文容量/用量读数接线（F06 局部）](2026-10-24-context-meter-capacity-wiring.md)：`/models` 的 `context_window` 解析入注册表（只补空槽、重复拉取不涨 revision），渲染层容量与用量各自独立呈现、两侧齐全才换算百分比；真实 LongCat 报 `1048576`。渲染层+设置 **23/23**、链路 **1/1**、Host 回归 **20/20**、私有 Host 构建 rc=0。core 新增单测因 HEAD 同名 `@Test` 未能执行；未重打 dist/安装包，既有条目需再拉取一次，GUI 未复验，不升级 F06 全域。

- 2026-10-24：[语音输入接线（F18 最小闭环）](../clients/desktop/2026-10-24-voice-input-wiring.md)：`composer-voice` 由禁用占位改为可点击；Host 增 `voice/record` 导入登记 + `voice/transcribe|describe` 分派与服务端发号审批，桌面 4 条 IPC；渲染层新增 `voice.js`（MediaRecorder→16k 单声道 WAV→转写→只写草稿、不自动发送）。`voice.test.mjs` 5/5、渲染层相关 20/20、IPC 面 202↔202 PASS。ASR 未配置 fail-closed；真实麦克风/ASR/GUI/打包未验，不改候选。

- 2026-10-24：[Gemini CLI 逐文件与界面帧比较](../clients/cli/2026-10-24-cli-tui-source-comparison.md)：19份固定源码/快照/许可证＋80×24/48×18共8帧，定位结构性差距；上游React19/Ink分支6.6.9与本仓React18/Ink5不直接兼容。仅诊断与待批准方案，无产品代码变更或新产物。

- 2026-10-24：[TUI Gemini CLI 对齐与缺口](../clients/cli/2026-10-24-cli-tui-gemini-alignment.md)：用户纠偏后按实际上游命令/组件对齐主骨架，36/36，Host 会话/目录冷重开与伪TTY通过；新包 `78690d46…` / 476,975 B。完整功能差距保留台账，非全量复刻/真任务交付。

- 2026-10-24：[ui-design Skill 创建与 SkillHub 发布](2026-10-24-ui-design-skill-publish.md)：通用 UI 设计/实现/只读审查流程，四文件包；结构测试5/5、静态校验与dry-run通过，平台 skillId 291748/versionId 456941，内容审核与安全扫描 pending。提交成功不等于公开上架；无GUI或真实模型行为测评，不改桌面候选。

- 2026-10-24：[新建空会话隐藏统计占位](../clients/desktop/2026-10-24-composer-empty-stats.txt)：空会话隐藏活动/用量整行，已有对话和真实零用量仍展示；红先5过/2败→7/7，相关回归16/16，隔离桌面页面＋真实Host点击/切回/浮层关闭/窄窗5/5，rc=0。无正式包重打、安装或模型调用，不升级F06完整统计链。

- 2026-10-24：[CLI TUI 交互完善](../clients/cli/2026-10-24-cli-tui-interaction.md)：输入字素编辑、历史草稿恢复、生成中防丢草稿、对话翻页、完整审批参数只读翻阅与控制字符转义；23/23，新包 `82152ba4…` / 460,413 B。未改 Host 契约，真实任务与真终端待验。

- 2026-10-24：[CLI TUI 视觉调整](../clients/cli/2026-10-24-cli-tui-design.md)：完整读取固定版 Warp/Ollama DESIGN.md 后终端适配；展示/协议合计 14/14，48×18 长历史/审批/resize 回归通过；新包 `3b0e801a…` / 454,635 B，伪 TTY `/help`/Ctrl+D rc=0。未真实终端/模型/新包安装验收，不改变桌面候选。

- 2026-10-24：[CLI TUI 中文分块解码续验](../clients/cli/2026-10-23-cli-tui-ink.md#5-2026-10-24-续验跨块-utf-8-解码)：逐字节输出复现跨块乱码，改流增量 UTF-8 解码，8/8 测试；新包 451,213 B / `77a811ee…`，伪 TTY 烟测 rc=0。新哈希安装态、真实终端及真实模型任务未验；保留旧包取证，不升级交付状态。

- 2026-10-23：[CLI 终端交互界面（Node/Ink TUI）](../clients/cli/2026-10-23-cli-tui-ink.md)：新增 `apps/cli/tui/`，npm 入口在无参且 TTY 或显式 `tui` 时进入；消息走 `session/append`（`user/message`）+ 产品 `task/start`，审批/取消/结算全走 Host。Rollup 单文件 450,980 B（SHA256 `6a23b1d2…`），7/7 测试（含真实宿主引导与投影追加、审批待答 Ctrl+C 先拒票再取消）、伪 TTY 烟测 `/help` + Ctrl+D rc=0；本机 tarball `npm install --omit=optional` 后安装态启动 rc=0、缺宿主 rc=69、缺平台包透传 rc=79；干净目录 `npm ci` 重建同哈希。未在真实终端亲手走查、真实模型审批与 registry 安装未验；候选不变。

- 2026-10-23：[SaCode 手机配对入口整改](../clients/mobile/2026-10-23-mobile-sacode-entry-correction.md)：解除 IdP/gateway 强制前提；本机安装档案隔离 registry/vault，旧数据不搬移。正式入口只进受保护设备页，旧路由/OAuth 深链退出。171 项共享测试 + 3 项路由回归、APK 构建和保留数据安装通过；检查时锁屏，新首屏 GUI、真实 daemon/任务、鸿蒙待验。

- 2026-10-23：[手机端组件 Demo 清理](../clients/mobile/2026-10-23-mobile-demo-removal.md)：删除样例目录、登录入口及 Android 注册，鸿蒙启动改 LoginPage；3/3 路由回归、165 项单测、APK 构建通过，DEX 旧类命中 0。Honor 保留数据安装启动成功，当前未登录，登录后导航/任务仍待验；鸿蒙未构建。

- 2026-10-23：[CLI 审查缺陷修复与三入口构建钩子重写](../clients/cli/2026-10-23-cli-review-and-fixes.md)：修六项——`build.cj` 硬编码本机路径/不认 `--target-dir`（改 env 优先 + `SACODE_BUILD_TARGET_DIR`，三份 SHA256 一致）、裸 `goal` 落自测、租约失败一律 `already-owned`（拆 `busy`/`owner-unknown`/`io-failed` 与 5/8 退出码）、worktree `flush-failed` 仍释放租约、PowerShell 5.1 管道 BOM、usage/help 与 `knowledge`/`call edit` 展示不一致。CLI 重建 rc=0（`main.exe` 14,531,072 B / 80 DLL），`main.exe all` ALL PASS，CLI Node 153/150 pass/3 skip，钩子测试 2/2。未跑完整四成员 `build-platform.mjs`；候选 `0f08a6ce…` 未重打。

- 2026-10-23：[移动端 M04-A 三处根因修复](../clients/mobile/2026-10-23-mobile-m04a-routing-task-init.md)：DEVICES 改走 `RemoteDevicesPage`、任务不支持标 `unsupported` 且不回退 chat、`initialize(workspaceId)` 带工作区；TDD 红先后绿；续修任务提示与任务列表响应式，实际 Kuikly 面板回归通过；离线 165 项单测 0 失败，本批 Debug APK 9,257,723 B。后续获用户授权，同签名保留数据覆盖安装成功；用户解锁后确认登录页启动，登录后设备/任务 GUI 尚未验收，不升级 M04 真实远程任务。

- 2026-10-23：[GUI 界面填写 API 密钥与真实闭环补验](../clients/desktop/2026-10-23-longcat-gui-key-entry.md)：补上正常双击路径此前未验的一环——**无环境密钥**状态下在供应商页填写并保存 Key（隔离 `credentials.env` 57 B、与输入逐字节一致）→ 真实拉取 `LongCat-2.5-Preview/LongCat-2.0` → 设默认 → read→write 任务审批 #1 `allowed-once` → 落盘与真实 diff → 关闭重开 `keyConfigured:true` 且回放正确；会话日志 107 条事件（tool/call 2、审批 1/1），密钥扫描 451/453 文件两次零命中。探针两处自身缺陷（`fieldset.ps-editor` 选择器、事件分页只读 64 条）已留存并离线补读更正。仍待用户亲手复验，不宣称已交付。

- 2026-10-23：[LongCat 真实模型主闭环（宿主级与 GUI 级）](2026-10-23-longcat-real-task-loop.md)：用用户提供的真实 LongCat 端点/模型，在交付候选 `D:/tmp/sacode-final-20261023` 上走通宿主协议与真实 GUI 两条闭环——读取项目 → 模型提出写入 → 审批 #1 `allowed-once` → 落盘 `状态：已完成` → 真实 diff → 关闭重开回放；GUI 会话日志 142 条事件（tool/call 3、approval 1/1），密钥零落盘、无进程残留。仍待用户亲手复验，不宣称已交付；shell/run_code 与 D14 未覆盖。

- 2026-10-23：[UI 冒烟 283/16 分诊与测试支持修复](../clients/desktop/2026-10-23-ui-smoke-triage.md)：16 项失败逐条归因为 `test-support/ui-smoke.cjs` 滞后（气泡角色决策、preload 清单、队列事件计数、live 气泡、侧栏标签、焦点时序等），非产品 UI 缺陷；仅改测试支持后同源诊断副本 **301 OK / 0 FAIL / UI_SMOKE PASS**，计数对账 283+16+2=301；候选 `app.asar` 未重打，交付包仍报 283/16。

- 2026-10-23：[Linux Electron 桌面打包与打包态验收](../clients/desktop/2026-10-23-linux-desktop-package.md)：远端 Ubuntu 同源打出 AppImage（133,944,198 字节）与 deb（102,549,392 字节）；AppImage、unpacked、deb 载荷三种形态协议冒烟均 `SMOKE PASS` rc=0、无孤儿宿主；UI 冒烟 dev/unpacked/AppImage 三份均为 282 OK / 17 FAIL 且失败行逐字节相同，打包零 UI 回归（17 项为 HEAD 现状）；AppImage 原生 FUSE 启动因宿主缺 `libfuse.so.2` 记 BLOCKED，deb 未安装。

- 2026-10-23：[Kuikly AI 参考资料采纳](../clients/mobile/2026-10-23-kuikly-ai-reference-adoption.txt)：按官方 AIChat 文档接入 KuiklyMarkdown 1.0.6-2.0.21（与 Kotlin 2.0.21 对齐）；实测文档版本 2.1.21 不兼容、文档仓库路径 404（构件在已配置的 maven-tencent）；javap 确认真实 API 是 ViewContainer 扩展而非 Compose。`:androidApp:assembleDebug` 通过，APK 9,182,509 B（增量 +359,511 B）。未接流式入口、KuiklyChatUI 与真机渲染验收。

- 2026-10-23：[移动端 M03 Markdown 流式渲染与主题/安全边界验证](../clients/mobile/2026-10-23-mobile-markdown-streaming-verification.md)：流式状态入口、深浅色主题、非可信图片/链接安全边界代码实现完成（6 文件）；离线 `:shared:testDebugUnitTest` + `:androidApp:assembleDebug` BUILD SUCCESSFUL，**160 项测试 0 失败/0 错误/0 跳过**，APK 9,381,611 B。明确未提交、未上真机 GUI 复验；真机深色/流式视觉、鸿蒙、KuiklyChatUI 待验；库为全量解析（非真正增量 AST）。

- 2026-10-23：[手机工程源码归并](../clients/mobile/2026-10-23-mobile-source-import.txt)：sa-app 工作树白名单导入 apps/mobile 根；旧位置、现有 JVM 协议代码保留，不带 Git/秘密/缓存/产物，与 SaCode 同仓管理。源码完整性、路径适配、门禁及构建前置读数见记录；不代表真机或远程任务验收。

- 2026-10-22：[沙箱解析缺陷修复与强制隔离真实入口边界](2026-10-22-sandbox-resolve-fix-and-enforcing-boundary.md)：修 `resolveWindowsExecutable` 对不存在路径抛 FException（红先 PASSED 1/SKIPPED 5）；enforcing 开启时 run_code 真实打印 `RUN_CODE_STDOUT`、shell 真实执行 PowerShell 包装层，退出码真实，不再折叠为 io-error/SANDBOX_UNAVAILABLE；剩余边界是工作区 ACL（AC SID 受限），未授权不改。HEAD core 套件因两个同名 `@Test` 无法编译（9c85fed 既有阻塞）。

- 2026-10-21：[D23 reasoning_content核心链路局部验证](2026-10-21-d23-reasoning-content.md)：隔离core构建成功，合成链路及回归25/25；SSE全文件23通过/1跳过/9网络夹具环境错误，真实DeepSeek与候选待验。

- 2026-10-19：[c4 验收 bug 修复批次](2026-10-19-c4-acceptance-bugfix.md)：6 项（权限切换 turn-in-flight 友好提示、流式折叠跳位、工具卡复制按钮、重命名 CAS 冲突自动重读再试、provider 错误携带分类原因、shell 执行通路诊断折叠）。桌面 58/58 通过；仓颉端断言已更新待构建验证。

- 2026-10-19：[c4候选交接与手动验收](2026-10-19-c4-delivery.md)，含用户配置共享5/5、候选哈希与五项未验边界；候选待验。

- 2026-10-19：[Electron 测试环境门禁与交互跑道](../clients/desktop/2026-10-19-electron-test-env-gate.md)。判据＝默认沙箱最小 Electron 探针（不传 `--no-sandbox`）；代理环境 `exit=0x80000003`。10 个文件 16 条用例在受限时标为 `env-blocked-electron` 跳过。二轮修复 6 项非 Electron 前提：2 条缺 `SACODE_CLI` 标 `env-blocked-missing-cli`、3 条缺 openssl 标 `env-blocked-missing-openssl`、windows-artifact-export 改仓外中性目录后真过。全套自测 **1066/1038 pass/0 fail/28 skip**（16 env-blocked-electron ＋ 2 missing-cli ＋ 3 missing-openssl ＋ 6 模型凭据 ＋ 1 空）。交互跑道 `scripts/run-electron-tests-interactive.cmd` 命中受限即 exit 2、不写结果。正向交互路径须用户复验。

- 2026-10-17 13:52 新复验：[A3 GPU 阻塞脱敏报告](../../target/tmp/codex-outputs-20261017/A3-GPU复验-20261017-1352.html)。三种后端均失败，真实调用日志可见性未验，不升级历史结论。

> 类别：⑦历史证据。**本目录是冻结区：只增不改**——新结果用新记录，不覆盖旧失败、不把旧通过升级成当前通过。
> 上级索引：[docs/README.md](../README.md)｜验收观察在 [`../qa/`](../qa/)

## 0. 规则

1. **命名**：旧式 `<主题>-<日期>.md`；新式 `2026-10-XX-<主题>.md`。日期 = 取证日，不是文件创建日；
2. **更新**：发现结论过期时，**新建**补记文件或在同主题新文件里引用旧文件；原文不动（本目录被大量文档交叉引用，改写会伪造历史）；
3. **结论去向**：需要长期引用的结论写进 `../product/`、`../plans/` 或 `../qa/`；本目录保留原始读数与过程；
4. 当前状态**永远不看本目录单独判定**——核 PRD 与该主题最新文件，必要时看 `docs/README.md` 登记的当前口径。

## 1. 按主题检索（检索关键词 → 代表文件）

- [2026-10-19 第一批交互增量](2026-10-19-first-batch-interactions.md)：工具身份关联、重命名/归档及AI选择卡片；Host12/12、仓颉定向7/7，元信息完整页面两轮22项；卡片GUI与整批真实任务仍待验。

- [2026-10-18 R4运行时与流式修复](2026-10-18-r4-runtime-and-stream-repair.md)：dev 接管；65/65 定向测试、完整页面15项检查及原生菜单/输入证据；截图链差异、同源候选/真实任务仍待验，第一批未完成。

- [2026-10-18 R2真实冷启动持久性](2026-10-18-r2-cold-restart-persistence.md)：真实获批edit后Host退出0，再以不同PID同目录只读RPC回放；40事件/8消息、plan模式、工作区及请求追踪一致，文件/单测保持，日志哈希不变、无模型重发。协议层1/1，不冒充GUI或真实LongCat验收。

- [2026-10-18 R2三路径协议验收](2026-10-18-r2-three-path-protocol.md)：用户指定包内Host的mock allowed/denied/cancelled 3/3通过，实际文件修改/不变及自然退出已核；外部Node单测不冒充产品受控测试。当前进程无LongCat密钥，真实阶段未运行，GUI/安装态未验。

- [2026-10-18 结果未知持续展示与核对](2026-10-18-model-pull-unknown-verification.md)：核对失败不抹掉已知收束事实，目录刷新不能替代精确回执；状态/页面18/18、扩大63/63、默认沙箱真实Electron未知路径1/1，未重发；跨重启/安装态仍待验。

- [2026-10-18 桌面模型拉取生命周期](../clients/desktop/2026-10-18-model-pull-desktop-lifecycle.md)：发送前持有ID、查询/可见取消、页签状态保留；58/58、桥接2/2、默认沙箱Electron/Host集成2/2，IPC149/149。保留仓内Electron启动失败与安装态/跨重启恢复缺口，D22不闭合。

- [2026-10-17 Windows 进程完整提案绑定](2026-10-17-windows-process-proposal-binding.md)：进程字段精确绑定必要切片；默认生命周期因非空私有目录安全回收仍阻断。
- [2026-10-17 模型拉取超时初轮记录](2026-10-17-model-pull-timeout-fix.md)及[复核补记](2026-10-17-model-pull-timeout-followup.md)：**撤回 revision 前进即成功与 D22 闭合结论**；保留 30s 等待，超时如实标未知、不自动重发。定向 28/28、模型中心16/16、真实中性Host集成1/1；页面4组失败与安装态缺口保留，D22部分修复。
- [2026-10-17 Host模型拉取生命周期](2026-10-17-model-pull-host-lifecycle.md)：总预算、取消、操作ID结果查询接入Host，核心16/16、真实Host与兼容集成16/16，Host178条门禁/自证通过；DNS资源退出、桌面查询/取消接线与安装态仍待完成，D22不闭合。

| 主题 | 检索关键词 / 前缀 | 代表性文件（完整清单按目录） | 时间跨度 |
|---|---|---|---|
| 仓颉私有 cwd 真实任务 | `cangjie-private-workspace-task` | [本轮记录](2026-10-17-cangjie-private-workspace-task.md)：共享审批/执行链、两档文件访问、失败引用释放及独立清理，16/16；生产快照/合入未完成 | 10-17 |
| Windows 私有任务目录 | `windows-private-workspace-scope` | [本轮记录](2026-10-17-windows-private-workspace-scope.md)：47 项真实权限/重解析拒绝/独立清理；父 DACL 不变，快照与产品装配未完成 | 10-17 |
| Windows 共享监督装配 | `windows-execution-supervisor-integration` | [本轮记录](2026-10-17-windows-execution-supervisor-integration.md)：真实任务/审批/停止/持久回放，定向 13/13；默认产品门禁未开放 | 10-17 |
| Windows 共享执行结果 | `windows-process-collector` | [当前记录](2026-10-17-windows-process-collector.md)：真实适配与结果转换 9/9；公共执行服务装配未完成 | 10-17 |
| 仓颉 Windows 进程适配 | `windows-cangjie-process-adapter` | [2026-10-17-windows-cangjie-process-adapter](2026-10-17-windows-cangjie-process-adapter.md)：真实 DLL/TurnToken/双流排空/清理五组 5/5；公共执行装配仍待完成 | 10-17 |
| Windows 原生所有权进程 | `windows-owned-process-provider` | [2026-10-17-windows-owned-process-provider](2026-10-17-windows-owned-process-provider.md)：AppContainer/管道/Job 原生薄层 35 项实测；仓颉适配与产品装配未完成 | 10-17 |
| AppContainer 当前身份验证 | `appcontainer-minimal-environment` | [2026-10-17-appcontainer-minimal-environment](2026-10-17-appcontainer-minimal-environment.md)：原生 error 203 环境对照，仓颉真实身份 5/5；产品执行后端仍未开放 | 10-17 |
| 桌面壳 · Electron · 打包分发 | `desktop-*`、`sacode-desktop-*`、`npm-publish*`、`package-*`、`renderer-decoupling*`、`latest-desktop-package*` | desktop-electron-blocker、official-desktop-baseline、2026-10-11-package-and-packed-verification-batchE | 10-03～10-15 |
| 界面 · 交互 · 布局 | `composer-*`、`queue-*`、`todo-*`、`*-layout*`、`*appearance*`、`model-select`、`models-page`、`client-slots*`、`role-label*`、`about-version*`、`default-permission*`、`autolaunch*` | sacode-desktop-layout、code-toolbar-layout、context-meter、2026-10-12-*（goal-bar/permission-menu/settings-workbench）、2026-10-17-role-label-removal（组标签移除＋中性壳冒烟配方）、2026-10-17-about-version-panel（关于页版本读数）、2026-10-17-default-permission-and-autolaunch（新会话默认权限＋开机自启） | 10-03～10-17 |
| 执行引擎 · Windows 隔离 · 安全 | `execution-*`、`windows-*`、`appcontainer-*`、`real-fs-ops*`、`h70-*` | execution-supervisor-real-process、windows-native-job-supervision、2026-10-16-gate-triad-repair、2026-10-16-windows-startup-three-issues-diagnosis（三问题排查：0x80000003/DLL/NSIS）、2026-10-17-cli-launch-0xc0000135-stdx-dll-missing（CLI 启动 0xC0000135 = stdx DLL 路径缺失；夹具孤儿化根因 + AGENTS.md 运行期 DLL 路径约定固化）、2026-10-17-cjpm-build-cj-stage-post-build-hook（cjpm build.cj stagePostBuild hook 全流程打通；解决 issue #725；干净目录验证 90+ 个 DLL 全复制成功；仓内落地受阻根因＝仓库根 ACL 被 Codex 沙箱化） | 10-06～10-17 |
| 目标系统（F04） | `goal-*`、`2026-10-15-p1-cancel-budget-fix` | goal-checkpoint-freeze、goal-claim-tool、goal-product-async-entry | 10-05～10-15 |
| 模型中心 · 提供方 | `model-*`、`handoff-model-provider*`、`*-submit-boundary*`、`*-acp-provider*` | model-center-b0/b3/b4/b5、model-tool-runtime、2026-10-13-model-edit-submit-boundary、[2026-10-17-model-center-call-log](../clients/desktop/2026-10-17-model-center-call-log.md)（模型调用日志：全局聚合回放各会话 requestTraceProjection，tab 落在供应商之后） | 10-04～10-17 |
| 插件与扩展 | `plugin-*`、`local-plugins-scope*`、`2026-10-1?-plugin-*` | plugin-manager-contract、plugin-lifetime-architecture、2026-10-11-plugin-gap-disposition-batchF | 10-04～10-12 |
| ACP · LSP · 委派 | `acp-*`、`lsp-l1-*`、`codebuddy-acp*` | acp-frame-probe-all-products、lsp-l1-reclose、2026-10-15-codebuddy-acp-stage2 | 10-07～10-15 |
| 远程 · daemon · 平台构建 | `2026-10-10-*`、`*-linux-*`、`*-core-*`、`session-persistence-*` | 2026-10-10-remote-product-acceptance、2026-10-10-protocol-schema-freeze、2026-10-13-linux-executable-build-followup | 10-10～10-16 |
| 上游对比 · 冻结基线 | `dsh-upstream-*`、`upstream-*`、`frontend-*-comparison*`、`p0-*` | dsh-upstream-freeze、upstream-ledger-2026-10-04.json、p0-interface-freeze | 10-02～10-07 |
| 审查 · 验收 · 复盘 | `*review*`、`*recheck*`、`verification-*`、`r0-*`、`qwen-*` | r0-review-closeout、sacode-phase123-stable-snapshot、2026-10-13-full-wiring-audit、2026-10-11-prd-p1-gap-recheck | 10-03～10-16 |
| 会话 · 工作区 · 引用 · 其他 | `session-*`、`attachment-*`、`request-trace*`、`w30-*`、`https-sse-*` | session-worktree、attachment-durable-seam、request-trace-core | 10-03～10-13 |
| 数据文件（8 个 · 非 md） | `.json` / `.txt` | 2026-10-13-full-wiring-audit-hashes.json、client-slots-artifacts-2026-10-05.json、dsh-upstream-delta-commits/-files.json、upstream-ledger-2026-10-04.json、ledger.json、lsp-l1-baseline-hashes.txt、lsp-l1-workspace-hashes.txt | 10-04～10-13 |

> 建议检索顺序：先按上表定位主题与时段，再看该时段内最新文件；目录本身按文件名排序即近似时间线。

## 2. 遗留说明

- [`MEMORY.md`](MEMORY.md) 为早期遗留的单行索引文件（仅 1 条记录），**保留不删**；完整导航以本 README 为准。
- 本目录文件数量会持续增长（约 177 篇 md + 8 个数据文件，截至 2026-10-16）；增量文档按 §0 命名规则直接落此，并在上方主题表补充新关键词（若属于全新主题）。

2026-10-17 提交前独立候选复验：[Windows 执行内部组件](2026-10-17-windows-execution-commit-candidate.md)，冷编译与 35/47/16 项通过；快照未入候选，产物守卫失败保留。

2026-10-17 EX-01/D14 后续：[工作区快照与变更导出](2026-10-17-windows-workspace-snapshot.md)当前定向 23/23，通过实际私有任务增删改、来源变更拒绝、硬链接/junction/越界拒绝及同日志审批前绑定。摘要的产品审批展示、整树终态约束、F08 合入和默认 Host/CLI 装配仍待完成，D14 不解除；一次 5 秒超时原因未定位。

2026-10-17 EX-01/REVIEW-01：[快照终态导出](2026-10-17-workspace-snapshot-settlement.md)已消费共享日志的 exited/退出观察/输出完整及快照绑定事实；真实任务与磁盘重放断言在 23/23 中通过。审批展示、启动复核及 F08/CAS 接线待实施，默认门禁不开放。

2026-10-17 EX-01/REVIEW-01：[快照审批与启动复核](2026-10-17-workspace-snapshot-approval.md)新增精确票绑定回执摘要、任务投影及页面范围展示；实际来源更新后拒绝恢复线程。核心集成 24/24，页面状态/渲染 13/13；完整桌面/Host 快照生命周期和 F08/CAS 仍待接线，门禁保持关闭。

2026-10-17 REVIEW-01/产物：[任务差异登记与真实 Host 消费](2026-10-17-task-review-persistence-host.md)复用 AttachmentStore 保存前后文件对象，同日志 execution/review 登记身份；核心 24/24、页面 16/16、当前 Host 真实历史投影及页面渲染通过。正文预览、F08/CAS 写回、Host 快照执行生命周期和完整桌面仍待完成，默认门禁关闭。

2026-10-17 F08/REVIEW-01：[任务正文预览](2026-10-17-task-review-body-preview.md)新增有限 execution/review-file，Host/CLI/IPC/页面读取登记的前后内容对象；核心24/24、页面19/19、桥接3/3及真实Host/CLI通过。写回审批/CAS与默认Host快照执行未开放。

2026-10-17 F08写回前置：[单文件条件写](2026-10-17-review-file-compare-exchange.md)新增独占句柄核对旧字节的内部创建/替换/删除原语，真实DLL定向28/28。尚非多文件或断电原子合入；审批/持久意图/部分成功与未知结算及产品写回未接，门禁关闭。

2026-10-17 F08：[写回审批与持久意图](2026-10-17-review-apply-journal.md)核心复用同一日志/lease/精确一次票/取消令牌，写前屏障与逐文件结算、部分成功及未知不重放，真实DLL定向36/36。公共写回动作、hunk及完整桌面仍未接，不升级产品完成状态。

2026-10-17 F08：[目录身份与固定原生库装配](2026-10-17-review-directory-identity.md)完成核心保护，真实DLL定向39/39、零跳过。拒绝同路径目录实体替换；旧记录保留只读。公共异步写回、双入口与桌面操作仍待接通，不升级产品完成状态。

2026-10-17 F08：[异步写回与停止边界](2026-10-17-review-apply-async.md)核心40/40通过；提交中查询/停止及时返回，后续文件不再写入，重复启动拒绝。公共双入口和页面仍待接通，默认门禁关闭。

2026-10-17 F08：[双入口及页面实际写回](2026-10-17-review-apply-product-entries.md)有限prepare/apply/describe/stop及页面独立确认已接；核心41/41、页面24/24、桥接4/4、真实组件→IPC→Host及CLI17项通过，合成项目实际增删改。Host176/IPC147；完整Electron/安装态、默认快照执行及在途Host停止仍待验，不解除D14与整体目标。

2026-10-17 EX-01/F08：[原工作区与私有执行目录映射](2026-10-17-snapshot-logical-workspace.md)真实定向42/42、页面27/27。会话目录/修订与原文件不变，仅私有副本改变并登记差异；默认Host/CLI生命周期尚未装配，D14及整体目标保持未完成。并发源码边界见证据。

2026-10-17 EX-01：[私有副本有界清理](2026-10-17-private-workspace-disposal.md)新增仅消费自有根句柄的内容清理，真实定向45/45。嵌套清理、占用后重试及链接拒绝/外部哨兵保护通过；默认Host/CLI资源生命周期尚未装配，D14与整体目标保持未完成。格式后复编边界见证据。

2026-10-17 EX-01/F08：[自动审查与资源收束](2026-10-17-execution-snapshot-settlement.md)共享监督器可信结束阶段47/47，差异持久化后才删除副本/释放profile和库；失败保留真实退出事实，晚期释放可在同进程重试。默认Host/CLI准备所有权尚未接通，D14与整体目标未解除。

2026-10-18 F08/EX-01：[私有执行生命周期与真实双入口](2026-10-18-execution-capsule-entries.md)：核心定向50/50、真实状态层→IPC→Host及CLI 13项、桌面定向14/14；同进程准备/独立审批/执行/审查/写回及EOF取消收束已实测。未提交增量；项目与会话数据重合、完整Electron/安装态及隔离专项仍待验，整体功能不升级完成。

2026-10-18 F08/EX-01：[项目与会话数据同目录](2026-10-18-colocated-execution-metadata.md)：按真实日志/租约/附件路径排除元数据，保留用户同名文件；新产物同目录与分离布局真实Host/CLI各13项通过。核心52项首轮51通过1清理错误，修正夹具后完整52/52通过、零跳过/错误/失败；不升级整体完成状态。

2026-10-20 模型 shell：[io-error:shell-pwsh 诊断折叠与 Windows 强制隔离接线](2026-10-20-model-shell-io-error-diagnosis-and-windows-wiring.md)：诊断折叠已闭合（真实 Host 回执由裸 `io-error:shell-pwsh` 变为带 `SANDBOX_UNAVAILABLE`）；根因确认为 Windows 默认 platformSandbox 无 provider。既有 AppContainer 私有通路已接入模型 shell，仅 `SACODE_WINDOWS_ENFORCING`+原生 DLL 时启用，默认 fail-closed；enforcing 下命令真实启动并观测真实退出码，但 AppContainer 内 PowerShell 与工作区 ACL 未完成，`node --test` 未取得通过结算。不声称"读取→审批→修改→运行测试→通过结算"已走通。

2026-10-20 AppContainer 根因：[exit 1 / 空输出诊断](2026-10-20-appcontainer-exit1-root-cause.md)：AppContainer 内 `cmd`/`powershell`/`hostname`/最小静态 exe 全部 exit 1 空输出，普通进程同管道/环境 exit 0；token 为 `caps=0`、无 `S-1-15-2-1` 的 LPAC 形态，且原始 `verify-windows-process.c` 在本机重编译后 `FAIL real-exit-code`。判定为 OS/AppContainer 层回归，非 PowerShell 参数、非 ACL、非产品源码；未改 ACL/产品代码。
