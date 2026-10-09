# 自主产品第一批设计与原型交付

日期：2026-10-07。基线：`35a69ca9e0f8b7b6ac51271ec76eff3515eaa820`，分支 `refactor/dsh-learning`。本批未提交或推送。固定基线与工作区差异见[追踪表](../plans/sacode-product-traceability-2026-10-07.md)，不能把未提交原型称作已有安装包功能。

## 交付与适用边界

- [需求追踪](../plans/sacode-product-traceability-2026-10-07.md)：F01–F20 的核心候选、Host/CLI 入口、桌面消费、测试候选、缺口、工作包主责与依赖。当前主责为职责分工，具体实施者尚待认领；未核项保持待核。
- [接口设计](../plans/sacode-product-interfaces-2026-10-07.md)：权威源、状态、增量方法与 CLI 动作、授权、持久化、失败及恢复；新增方法未实现，不加入产品能力声明。
- [独立交互原型](../../apps/desktop/prototype/README.md)：自有入口，Vue runtime + h()、OpenTiny、复用 SlotCore/ClientScope。构建产物无 eval/new Function/import()，CSP script-src self、connect-src none，不包含运行时 npm 加载，不调用 Host 或真实提供方。目录不纳入现有桌面打包白名单。
- PRD F18 修正为增强直接替换与按钮/Ctrl+Z 回退，不弹预览。原型增强只改演示草稿，不发送真实消息、不执行工具；模拟文本保留原任务，不额外添加要求。

## 本轮实测

| 层面 | 命令/结果 | 结论与边界 |
| --- | --- | --- |
| 构建 | `node apps/desktop/prototype/build.mjs`，PROTOTYPE_BUILD_PASS，rc=0 | 仅独立原型构建，未构建核心或产品安装包 |
| 静态覆盖 | 逐项检查两份新文档均有 F01–F20 行；PRD 新版无“增强前后对照”冲突 | 追踪/接口覆盖 PASS，不是业务验收 |
| 真实 Electron | 设置 SACODE_ELECTRON_TEST_EXE 后 `node apps/desktop/prototype/verify.mjs` | PROTOTYPE_PASS 139 checks / 0 failed；ELECTRON_RC=0，无渲染异常。包含入口检查，139 不是业务用例或能力数量 |
| 反证 | 私有复制原型，将 rev!==editingRevision.value 替换为 false，再跑同一 smoke | rc=1，明确命中“改回同文拒绝迟到增强”，MUTATION_CAUGHT。正式原型未删保护 |
| 预览服务 | 本机 GET / 与 /vendor/vue.js 为 200，非白名单 README/host-bridge 路径为 404 | 仅本机六个资源，未暴露仓库或执行端点 |

真实 Electron 使用 `D:/Temp/SaCode-window-test-runtime-20261006/SaCode.exe`（既有核验同版本运行时），不是宣称默认 npm Electron 或其他平台通过。测试创建私有 user-data；不读取用户数据或凭据。第一次 PowerShell 直接 GUI 启动没有取到完整退出状态，未计成功；后续 Node spawn 获取真实退出码。早期 OpenTiny resetTime 默认 1000ms 使快速交互测试碰到禁用状态，改为 resetTime:0，由独立请求状态阻止重复增强；未修改组件依赖。

检查涵盖：直接增强、按钮回退、用户继续编辑后的撤销顺序、编辑改回同文/取消/切会话/失败保护；队列引用与编辑消费互斥；未保存关闭取消；标签拆分、聚焦、合并、前移、常用和全部 20 类资源挂载；模型中心统一入口；Ctrl+K/Escape/弹层焦点；九种场景、亮暗消费、窄窗无横向溢出及工作台切换。多数资源内容仍是模拟骨架，不代表相应业务接通。

## 证据与复跑

运行后本机证据（gitignore，不入库）：

- `apps/desktop/prototype/evidence/checks.json`、smoke.log、exit-code.txt。
- [亮色截图](../../apps/desktop/prototype/evidence/light.png)、[深色截图](../../apps/desktop/prototype/evidence/dark.png)、[窄窗截图](../../apps/desktop/prototype/evidence/narrow.png)。截图已目视检查；初版外层溢出、标签换行及深色按钮问题修正后重新生成。
- 反证日志：`D:/Temp/SaCode-prototype-20261007/mutant/mutation.log`；仅取证副本，未污染正式源码。

在仓库根目录先 build，再 verify；预览运行 `node apps/desktop/prototype/serve.mjs`，打开 http://127.0.0.1:3197/，Ctrl+C 停止。前端模拟状态刷新即重置，不冒充产品持久化。

## 后续与未完成事项

### 2026-10-07 视觉重做补充

用户否决上述初版外观，明确选择接近 Codex 的留白、简洁、对话突出方向。ui-sketcher 提供暖白布局并复核首屏；修订内容记录在 `docs/plans/sacode-workbench-visual-direction-2026-10-07.md`。默认浅色、助手自然段、扁平导航、紧凑输入区、默认两个资源标签，繁杂操作转为可访问菜单。设置齿轮与左右侧栏图标已区分。目视暗色截图发现 OpenTiny 默认文字在导航中对比度不足，补语义文字颜色后重新取证。

同一指定 Electron 运行时的修订版验证为 **173 checks / 0 failed，ELECTRON_RC=0**；139 为旧版历史读数。新增菜单可达、默认尺寸、无助手卡片及窄窗导航恢复检查。测量中央 826px、右栏 380px、输入区约 137.3px、顶部 32px（均 CSS 像素）；默认两个标签且输入框可见。截图取证为 `initial-light.png`、`initial-dark.png` 和 `narrow.png`，交互后多资源截图不作为默认首屏展示。

构建仍使用 Vue runtime、OpenTiny 与 SlotCore，CSP script-src 'self'；不增加运行时 npm 依赖。修订只涉及独立原型和本批文档，未替换产品主入口、未接真实执行、未提交推送。自动检查通过不是用户视觉批准。

第一批设计材料和可操作原型已交付。视觉评审与具体实施者认领尚待完成；布局尺寸仍可依据评审调整。核心/Host/CLI 实现、真实模型/提供方、权限持久化、完整扫描/数据库/ACP 和阶段 4–6 的双入口三平台交付未在本批实施或验收。真实业务仍须逐需求正向、失败/越权、恢复/并发取证；本原型通过不更新旧矩阵勾选。

公共入口与他人改动没有被覆盖：本批只改 PRD 的冲突文案、新增两份设计表、本证据和 prototype 目录。未安装新依赖、未启动真实 NSIS 安装、未自动提交推送或发布。

### 2026-10-07 逐轮交互修订与二级添加菜单

按用户反馈调整独立原型：左栏收缩为图标栏；目标与队列移至输入区前，目标提供暂停/继续、编辑、删除与累计运行时长；语音原地模拟启停；设置弹窗；头像上浮快捷设置；输入 `/` 上浮命令筛选；权限显示 Plan/Build/YOLO/Auto Review；输入右侧为增强、语音、上下文环形指示、发送。知识库区分用户/项目级，自动化提供目录/模型/Cron/时区，扩展为模拟市场，连接按 SSH/数据库/MCP 配置与控制。

本次加号菜单增加带图标的一级入口和二级浮层：文件目录树/搜索；技能、MCP 搜索与对应市场分类跳转；知识引用；上传附件；目标；计划。计划逐行创建、在对话中勾选步骤。附件选择使用浏览器文件选择器，仅引用文件名，不读取正文或上传。工作区树、技能/MCP 目录均显式为示例，不代表真实注册表已接入。

复跑指定 Electron 运行时 `node apps/desktop/prototype/verify.mjs`：**PROTOTYPE_PASS 360 checks / 0 failed，ELECTRON_RC=0**。新增二级菜单搜索、目录展开、图标、市场跳转、计划创建以及宽窗浮层不越界检查；截图 `evidence/plus-files.png`、`plus-skills.png` 已取证，文件二级菜单已目视复核。初次新增测试因注入字符串换行转义错误 rc=1，修正测试串后再取上述读数，没有修改被测业务来掩盖失败。

以上仍为原型内存交互，真实 Host、核心授权、上下文投影、调度、麦克风、市场安装及远程连接未在本轮接通；未构建安装包、提交或推送。历史计数保留为各版读数，不升级业务完成状态。


## 正式桌面视觉迁入第一批（2026-10-07）

状态：实施中。此批不是完整原型迁移，也不是发布验收。

- 基线 HEAD：`35a69ca9e0f8b7b6ac51271ec76eff3515eaa820`；验证对象为含在途改动的工作区，不宣称固定提交通过。
- 技术栈沿用 Electron、Vue runtime + h()、现有 OpenTiny 与客户端槽位；正式 index 加载 product-design.css，不加载 prototype/ 的模拟数据。
- 新增正式暖色亮暗视觉层，统一导航、输入框、侧栏和弹窗；通用弹窗关闭改 SVG 图标；目标暂停/继续、编辑、删除改有无障碍名称的图标，仍调用原 GoalAdapter 的 CAS 方法。
- 未修改 main.cjs/preload.cjs/app.js 等公共业务入口，未覆盖其在途改动；本批路径登记在责任表。

### 本次实测

1. `node --test apps/desktop/test/goal-bar.test.mjs apps/desktop/test/page-sources-parse.test.mjs`：7/7，rc=0。编辑测试改按 aria-label 定位图标；原 CAS、迟到响应、卸载和键盘行为断言保留。
2. `node scripts/pack-pages.mjs`：rc=0，既有构建静态检查通过。
3. `cd apps/host; cjpm build -i`：rc=0；有编译警告。将新 main.exe 复制到桌面 dist/host/bin/sacode-host.exe，原二进制已备份到 D:/Temp。未生成安装包。
4. `node apps/desktop/test-support/product-design-verify.mjs`：真实 Electron + 正式 main/preload/renderer + 上述新 Host，10/10，Electron rc=0。检查真实 session/projection 和 global/settings/get、亮暗 1384/700 宽度、图标关闭和回焦。Host SHA256 `eb7bbaadc29d3e9a7c5241fdacca322823b463d24d14792c5e3d4bd1d62d9b54`。证据目录 `apps/desktop/.tmp-test/product-design-1791354757234/`，含 baseline.json、checks.json、smoke.log、exit-code.txt 和截图。已人工查看亮色宽窗与暗色窄窗。

备用 Electron：`D:/Temp/SaCode-window-test-runtime-20261006/SaCode.exe`，通过 SACODE_ELECTRON_TEST_EXE 指定。它默认 isPackaged=true，因此源码验收明确置开发态后才加载正式 main，使 paths.cjs 选择本仓库 dist/host；不替换 IPC 或 Host 响应。此前 9 项视觉探针使用了备用运行时自己的旧 Host，不能作为新源码集成证据；添加 global/settings/get 契约探针后先红，再纠正路径并取上述 10 项结果。没有验证打包路径。

### 尚未收口

- `node --test apps/desktop/test/goal-control.test.mjs`：0/1，rc=1。新 Host 在空白目标校验前返回 -32001 already-owned，未到预期 bad-goal-objective。改用 D:/Temp 私有 TEMP/TMP 后仍红，不能归因为系统 Temp；目标写入/恢复链待 B（租约）与 A（Host）分诊。图标和组件测试通过不代表该业务链通过。
- 对话的 + 二级菜单、队列/目标顺序、权限菜单、真实上下文压力、设置分类、管理页面与多资源工作台仍需按批准原型逐项接入现有契约。没有把模拟模型、终端、数据库、语音或服务结果迁入产品。
- 主 Agent、全量回归、打包态、安装升级和平台交付尚未验收；本批没有提交、推送、安装或发布。


## 正式输入区菜单与队列呈现第二批（2026-10-07）

基线仍为 `35a69ca9e0f8b7b6ac51271ec76eff3515eaa820` 的工作区态。未提交、未发布。

### 迁入内容

- 正式 AddButton 改用 `composer-menu.ts` 的悬浮菜单，不打开模态窗；图标、键盘上下选择、Escape 回焦、外部点击关闭及卸载清理。
- 上传仍用既有 file input → addAttachments → attachmentUpload 链，没有另造上传真源。
- 二级文件选择调用既有 workspaceFiles(path)，按当前目录搜索、进入目录与返回上级；选择文件仅插入「工作区文件：相对路径」草稿文本，明确不上传文件内容、不发送消息、不执行读取工具。未配置工作区则禁用入口。
- 技能与 MCP 二级区明确当前清单尚未接入，提供现有扩展管理入口；没有模拟安装清单。创建计划明确禁用待接入。
- ＋内设置目标打开已有 GoalBar 编辑面；隐藏独立的空目标创建栏。增量接线改变输入前的 DOM 顺序为 Todo → Queue → Goal → Composer，保留既有模型中心、自定义模型选择与任务起轮改动。
- 队列任何条数均有可折叠标题，首次展示展开；呈现完整文本（不再用 200 字摘要作为正文），将「即时补充」改名「引导」，仍走现有 steer 协议。没有做假排序：当前 preload 没有 reorder 动作，拖拽排序仍待公共接口实施。
- 目录请求绑定组件实例和序号：关闭、再次打开、卸载之后的迟到回执不覆盖新清单；会话切换按 scrollSession 重建菜单实例。

### 验证

- `node --test apps/desktop/test/composer-menu.test.mjs apps/desktop/test/goal-bar.test.mjs apps/desktop/test/page-sources-parse.test.mjs`：10/10、rc=0。菜单三个夹具测试分别证明关闭重开竞态、只插路径且目录读取路径正确、卸载迟到回执丢弃；夹具不代表真实目录服务验收。
- `node scripts/pack-pages.mjs`：rc=0，沿用 Vue 全局 runtime 与现有构建 CSP 静态检查，无新依赖。
- `node apps/desktop/test-support/product-design-verify.mjs`：17/17、Electron rc=0，使用新 Host 的真实会话投影及通用设置读取，新增正式 ＋入口、二级面板视口、未接通计划禁用、Escape 回焦、目标编辑取消检查。不执行模型、Shell 或目标保存。
- 最新证据目录 `apps/desktop/.tmp-test/product-design-1791364195216/`，含 baseline/checks/log/exit-code 和 plus-menu/plus-secondary 截图；已人工核二级面板截图。
- Host 哈希仍为 `eb7bbaadc29d3e9a7c5241fdacca322823b463d24d14792c5e3d4bd1d62d9b54`，本批无核心或 Host 源码改动。

### 留待下一批

计划创建、技能/MCP 可引用清单、队列 reorder 契约需要真实 Host 接口。目标持久写入仍受上一批 `already-owned` 红例阻挡，不以本批目标编辑 UI 检查代替业务验收。菜单中的文件路径文字也不能记成已实现结构化文件引用。完整右侧工作台、权限选择及上下文压力的数据契约仍未收口。


## 正式右侧工作台迁入第三批（2026-10-07）

基线仍为 `35a69ca9e0f8b7b6ac51271ec76eff3515eaa820`，验证工作区而非固定提交。复用 Electron、Vue runtime h()、OpenTiny 和 client-slots；无新增 npm 依赖，无核心/Host 源码修改，未提交、推送或打包。

### 实施内容

- WorkbenchTabs 替代静态标签与旧工具条：添加资源的搜索图标列表、独立关闭按钮、拖拽和 Alt+Shift+左右键重排；关闭最后标签显示空工作台，关闭侧栏返回对话按钮焦点。
- 全屏/缩小图标直接放在 ＋旁，Escape 恢复对话布局；默认右栏宽 380px。保留既有上下拆分操作。
- 文件结构、文件预览、工具与预算、会话轨迹、指南使用既有真实页面；其余搜索/编辑/Git/终端/测试/扫描/部署等资源明确禁用待接入，不迁入原型模拟结果。
- 文件树点击及 Enter/Space 进入预览，经 registry 判断读取可用与审批要求，再调用既有 toolCall(read,path,0)。遵守真实 Host 返回 `{result:string}`；任务运行/工具不可用/需审批时拒绝直接读取。
- file-preview 展示控制器区分加载、成功和错误，切换文件、关闭资源、会话切换、卸载后丢弃迟到回执；失败清空旧正文，不用历史记录冒充成功。
- 读取会经过原工具授权与日志，呈现有界文本快照；不是直接文件系统旁路。浮动预览复用当前内容。拆分副窗格仍是历史成功读取快照，不算独立多资源窗格完成。

### 验证与边界

1. `node --test apps/desktop/test/file-preview.test.mjs apps/desktop/test/composer-menu.test.mjs apps/desktop/test/goal-bar.test.mjs apps/desktop/test/page-sources-parse.test.mjs`：13/13，rc=0。涵盖文件切换、错误、关闭/卸载迟到结果和已有组件行为。
2. `node scripts/pack-pages.mjs`：rc=0，沿用既有 CSP/打包检查。
3. 正式 Electron + main/preload/renderer + dist Host：29/29，Electron rc=0。涵盖资源添加/关闭/键盘重排/全屏恢复/空面板，以及真实读取私有 session 目录 preview-smoke.txt 和不存在文件的 -32010 not-found 拒绝；成功后失败没有残留正文。
4. 文件检查通过正式根组件的 openWorkspaceFile 处理器触发，未伪造树清单或 IPC/Host；因此是处理器到 Host 的正反链路证据，不能代替已配置真实项目的树点击完整验收。临时夹具仅写在独立测试目录。
5. 最新证据 `apps/desktop/.tmp-test/product-design-1791365938690/`，含 baseline/checks/log/exit-code、workbench.png、file-preview.png；已目视核文件预览实际正文与 380px 对话布局。截图等待动画帧，避免 DOM 已更新而合成帧仍旧。
6. Host 哈希仍为 `eb7bbaadc29d3e9a7c5241fdacca322823b463d24d14792c5e3d4bd1d62d9b54`。本次没重编 Host，测试不能外推当前全部源码可编或打包态通过。先前目标持久写入 already-owned 红例仍未收口。

下一批：迁入设置分类和头像快捷设置，保留既有模型中心作为唯一模型入口；代码编辑、Git 差异、终端等需补真实接口后逐项开放。toolCall 当前没有显式会话 ID，本批 UI 丢弃迟到响应不代表已经实现 Host 级会话绑定授权。


## 正式设置分类与头像快捷菜单第四批（2026-10-07）

仍为 `35a69ca9e0f8b7b6ac51271ec76eff3515eaa820` 工作区态。沿用 Electron、Vue runtime h()、OpenTiny、现有槽位和 Host，未改核心、main/preload 或安装包。

- 设置扩为通用、外观、对话与输入、模型中心、内置插件、快捷键、隐私与数据、个人资料、关于九类。模型分类仍装配同一 modelCenter.Outlet；不另造模型选择与凭据真源。
- 外观的主题/字号使用已有全局配置动作；对话仅装配 busy-send/transcript-view/composer-enter，隐私仅 session-log。其余旧贡献仍可按插件注册/卸载，但正式页面不会显示其写死的外观、字号、版本或权限状态。
- 修复设置装配读取不存在 entry.id 的旧错误，改为 entry.options.id；修复三个偏好组件 setup 返回 VNode 而非 render 函数的问题。新回归证明分类筛选、子 owner 绑定、真实渲染函数和保存调用，已有生命周期卸载测试保留。
- 配置未读取显示“尚未读取”并禁用；保存失败显示原因且保留原回读值，保存中禁止重复操作。原先三个偏好直接用默认值并且保存 reject 没有捕获，本批改为未知态与行内失败反馈。
- 侧栏底部本地用户菜单向上悬浮：个人资料跳转同一设置；浅色/深色/系统快捷按钮转交同一 setTheme；开机自启禁用待宿主接口；Escape 回焦，外部点击关闭，卸载移除监听。账户仅表示本地模式，不虚构昵称/头像已保存。
- 默认权限、资料编辑、自启、快捷键自定义、导出清理、版本检查等缺接口，明确待接入；日志开关只保存偏好，不宣称上传服务已实现。

### 本次验证

- `node --test apps/desktop/test/general-settings.test.mjs apps/desktop/test/global-appearance-ipc.test.mjs apps/desktop/test/page-sources-parse.test.mjs`：4/4，rc=0（含新增装配行为回归）。
- `node scripts/pack-pages.mjs`：rc=0，CSP 与单 Vue runtime 静态检查通过，无新 npm 依赖。
- 正式 Electron/main/preload/renderer + 同一 dist Host：40/40，rc=0。新增头像浮层、Escape、资料分类、九类设置、无重复假外观、真实 Host 主题保存回读、Enter 换行保存回读、唯一模型中心、实际快捷键和 700px 设置边界检查。测试仅修改私有 user-settings，未触碰用户真实配置。
- 证据目录 `apps/desktop/.tmp-test/product-design-1791366381953/`；Host SHA256 仍为 `eb7bbaadc29d3e9a7c5241fdacca322823b463d24d14792c5e3d4bd1d62d9b54`。已目视核 settings-appearance.png：左侧图标分类、右侧真实主题和字号、图标关闭。
- 从 apps/desktop cwd，私有 TEMP/TMP 下跑 `node --test test/global-appearance.test.mjs test/appearance.test.mjs`：8 条 / 1 pass / 7 fail / rc=1。完整日志和退出码存上述目录 appearance-regression.log、appearance-regression-exit.txt；红例包含 already-owned 与中文目录 Permission denied 等，尚未归因修复，不把同目录真实保存成功外推为重启/并发/恢复全绿。

阶段仍实施中。下一批继续权限与上下文呈现、管理页面迁入；后端持久/路径红例仍交 A/B 的公共入口与核心契约分诊。本批未提交、推送、安装或发布。


## 正式输入区上下文与扩展页第五批（2026-10-07）

基线仍为 `35a69ca9e0f8b7b6ac51271ec76eff3515eaa820` 工作区态；无核心/Host/preload 改动，未提交、推送或打包。

- 输入区右侧固定增强 → 语音 → 上下文环 → 发送。语音无真实入口，按钮禁用，不展示模拟录音。
- 上下文环从输入区下方移到发送左边，悬浮、键盘聚焦或点击展开详情，支持 Escape 回焦、外点关闭和视口边界。修复 Hover 后 Escape 回焦又触发 focus 重开的竞态。
- 移除 app.js 把 usage.used 累计账本读数当 projectedTokens 的错误映射。现阶段 Host 没有压力投影接口，仅可读取当前模型目录 contextWindow；不具备用量时保持未知环，不画 0% 或拼造 k 数。有真实压力 props 时仍显示比例、K/M 与分项。
- 权限菜单列 Plan / Build / Yolo / Auto Review 四项，全部模式切换禁用；当前实际授权继续由工具注册表与一次性工单执行，不虚构选中 Build 已生效。菜单文字居中、Escape 回焦。
- 既有插件管理入口改称扩展，进入时右栏宽度归零、管理页占中心；提供返回对话，恢复原 workbench 状态。点击会话也返回对话。沿用原 PluginManager 与安装适配器，不改安装生命周期，不宣称已完成 Skills/MCP 市场。

### 验证

- pack-pages rc=0，沿用 CSP、唯一 Vue runtime 与运行时零 npm 依赖约束。
- 七个相关组件/IPC/解析测试文件合计 18/18，rc=0，日志在最新证据目录 components.log 与 components-exit.txt。新增上下文测试区分仅容量/错误压力/未知态与具备用量+容量的有效态，证明真实 props 下 32K/128K 显示 25%。夹具不代表 Host 已提供压力。
- 正式 Electron + main/preload/renderer + 同一 dist Host：50/50、rc=0。新增输入区顺序、语音禁用、四种权限不能伪生效、浮层与 Escape、管理页无右栏、返回恢复、真实 pluginsDescribe 返回清单。没有测试安装副作用。
- 最新证据 `apps/desktop/.tmp-test/product-design-1791366986342/`；截图 composer-context.png、extensions.png。目视核前一版同结构截图后修正了上下文详情头部拥挤换行和不必要实现术语；终版重新取证。
- Host 哈希仍为 `eb7bbaadc29d3e9a7c5241fdacca322823b463d24d14792c5e3d4bd1d62d9b54`，本批不外推当前源码全量构建或安装态成功。上一批外观回归 1/8（7 fail）仍未修复，未重复结算为通过。

### 待接线的具体条件

| 工作项 | 缺口与下一步 | 主责 | 验收条件 |
| --- | --- | --- | --- |
| 四种权限 | 先在共享核心定义各模式的工具副作用/审批矩阵，再提供会话模式读取与 CAS 更新；轮次启动固定授权快照，CLI 同一规则 | A Host/CLI + E 执行授权，G 消费 | 拒绝越权、模式变更不提升在途授权、恢复不自动授权；桌面与 CLI 一致后开放按钮 |
| 上下文压力 | Host 提供绑定 session/model/revision 的当前投影 token 数、容量及估算来源；不得复用累计费用或用量 | D 模型/容量 + A Host，G 消费 | 历史切换、迟到回执、压缩与在途工具竞态；未知不作零，压力与费用分开 |
| 语音 | 能力探针、开始/结束/取消、会话草稿修订身份与权限；麦克风拒绝或缺 ASR 如实失败 | H 驱动 + A 接线，G 消费 | 不弹录音窗、拒绝授权/取消/迟到转写不覆盖新草稿，不自动发送 |
| 完整市场与管理页 | 在既有插件安装协议之上补类型发现/搜索与 Skills/MCP 贡献；知识库、自动化、连接需各自真实接口 | C 插件 + F 自动化 + H 集成 + A 接线，G 页面 | 安装、取消、失败、卸载及在途引用闭环；独立管理页不带对话右栏 |

以上为增量接线条件，不是声称已存在的新 Host 动作。后续仍需管理页面业务接入、授权/持久化红例、双入口与安装交付验收。

## 正式工作区文件搜索第六批（2026-10-07）

基线仍为 `35a69ca9e0f8b7b6ac51271ec76eff3515eaa820` 工作区态。本批仅接既有 `workspace/files` 目录接口；未改核心、Host、preload，未提交、推送或打包。

- 右侧资源选择开放文件搜索，支持按文件名和相对路径匹配、取消、结果打开。未配置工作区时提示选择目录，不生成模拟结果。
- 遍历最多 128 个目录、4096 个条目、200 个结果、6 层；排除 `.git/node_modules/target/dist`。限额与部分目录失败分别标明，不能把部分结果当完整清单。
- 取消、重新搜索、目录变化、关闭或卸载会丢弃迟到回执；当前目录请求不能在 Host 中撤回，但不会继续遍历或覆盖新搜索。目录条目校验拒绝路径分隔符和 `..` 等无效名称。
- 搜索只读取目录，不搜索正文。点击结果复用既有授权工具读取与预览管线，不绕过授权。

### 本次验证及阻塞

- 八个相关测试文件共 23/23，rc=0；包含真实 Host 回放已配置临时工作区并搜索磁盘上的 `src/actual.cj`。该用例证明只读目录发现，不证明工作区设置写入或读取工具成功。
- 正式 Electron/main/preload/renderer + 同一 dist Host：53/53，rc=0。新增搜索入口、未配置空态和关闭资源检查；不将页面测试算作完整项目读取验收。
- 证据目录 `apps/desktop/.tmp-test/product-design-1791368283906/`，包含 components.log、components-exit.txt、checks.json、smoke.log、exit-code.txt 和 workspace-search-empty.png。已目视核空态截图与右栏布局。
- 两个独立真实 Host 探针仍失败：`workspace/set-directory` 与已配置会话的 `extension/call` 读取均返回 `-32001 already-owned`；session.log 未改变。结果存 workspace-write-probes.json，探针退出码为 1，不并入上述通过计数。
- 只读源码复核发现 WriteLease.acquire 将临时文件创建、写入或 rename 的所有异常转成 false，入口再映射为 already-owned。因此错误码不能证明存在其他写者；租约获取的底层失败原因仍待分诊，本批未修改该公共契约。
- Host SHA256 仍为 `eb7bbaadc29d3e9a7c5241fdacca322823b463d24d14792c5e3d4bd1d62d9b54`。工作区选择 → 搜索 → 打开预览整链仍阻塞，不能宣称通过。历史目标与外观持久化红例仍保留。

下一步先查清租约获取失败并完成工作区写入、工具读取的实测闭环，再扩展代码编辑、Git、终端等真实资源页。知识库、自动化、连接管理尚缺桌面管理接口，核心存在驱动不等于页面已接通。

## 租约失败分诊与真实项目搜索验收第七批（2026-10-07）

仍为同一 SHA 的工作区态。本批未修改 lease/procwin/Host 源码。扩展正式桌面验收夹具，重建并更新本地开发 Host；未生成安装包、提交或发布。

### 纠偏与环境对照

1. 独立仓颉探针的 File.createTemp、写入、关闭、rename 均通过；当前 WriteLease/procwin 源码在私有目录编译后获取/释放通过，O2 与相同桌面 DLL 亦通过。
2. 同一诊断 EXE 复制到仓库 dist/host/bin 后，写 D:/Temp 的探针在 createTemp 报 `Failed to create the temporary file!`。同哈希 Host 在私有目录与仓库目录启动也表现不同。此前协议层 already-owned 隐藏了这一底层写入失败，不能认定有另一个写者。
3. 新 Host 在仓库目录启动、测试 TEMP/TMP 指向 D:/Temp：12 条 / 1 pass / 11 fail；改为仓库内 `apps/desktop/.tmp-test/host-runtime-20261007`：12/12，rc=0。没有修改 ACL、关闭安全机制或移除他人的租约。
4. 旧 Host 备份与原 DLL 放同一私有目录、使用仓库内测试 TEMP/TMP，也得到 12/12。因此撤回中途“构建缓存是根因”的推测；证据支持启动位置和可写临时路径影响行为，但没有判定具体系统限制机制。
5. 诊断与前后对照在 `D:/Temp/sacode-lease-probe-b9540bd047db405aa548f641c642b961/`；仓库环境记录在 `apps/desktop/.tmp-test/host-runtime-20261007/`。这不证明任意安装位置、任意用户临时目录均可写。

### 最新产物及验收

- `cd apps/host; cjpm build --target-dir D:/Temp/sacode-lease-probe-b9540bd047db405aa548f641c642b961/host-target -V` 私有完整构建 rc=0；随后 `cjpm build` 在默认目标目录完整构建 rc=0（日志 default-build.log，仍有已有警告）。不以 `cjpm build -i` 的缓存成功当重建证据。
- 最终默认 main.exe 与本地开发 dist/host/bin/sacode-host.exe 同 SHA256：`19e0f92e1deac6df22367439425ceadc459deae54c15326cd66123eecc9188cc`。旧产物备份保留；不改源代码和 DLL。
- 最终产物运行 `node --test test/workspace.test.mjs test/goal-control.test.mjs test/global-appearance.test.mjs test/appearance.test.mjs`（cwd apps/desktop，TEMP/TMP 均为上述仓库私有目录）：12/12、rc=0。包含工作区保存/恢复、真实读写、会话切换、另一写者拒绝、落盘失败保护、目标 CAS/跨会话拒绝、外观中文路径/并发/恢复。日志 final-integration.log 与 final-integration-exit.txt。
- 正式 Electron/main/preload/renderer + 最终 dist Host：55/55、rc=0；证据 `apps/desktop/.tmp-test/product-design-1791370431701/`。新增独立已配置会话磁盘夹具，由正式 selectSession 处理器切换，页面真实目录搜索并点击结果，经真实工具读取展示实际文件内容。不替换 IPC 或 Host 请求。
- 已目视核前一遍同布局 workspace-search-preview.png，最终更换默认构建产物后重跑并重新截图。工作区选择的原生目录选择器未由本次 Electron 流程操作；设置与持久恢复由独立真实 Host 测试覆盖，不能将两类证据混成原生选择器全流程。

当前阻塞更新：先前工作区/目标/外观红例在已登记可写测试环境中通过，保留旧红及环境边界。尚未完成代码编辑、Git、终端、真实压力、四模式授权与安装态验收；仍不升级整个能力域完成状态。

## 正式文件编辑与保存前差异第八批（2026-10-07）

基线仍为 `35a69ca9e0f8b7b6ac51271ec76eff3515eaa820` 工作区态。未新增 Host/IPC 动作，未改核心、Host 或 preload；main.cjs 的已有在途改动保留。

- 文件预览增加“编辑文件”，右栏开放代码编辑与保存前差异两类资源。差异是当前工具读取版本与本地草稿的变更区间，带前后行号、增删行与上下文，不冒充 Git HEAD/索引差异。
- 使用现有 JSON 参数的 read/write 工具，保留路径和正文中的空白、中文、空行、末尾换行与空文件。超过 64K 字符、二进制或包含 read-truncated 标记的读取拒绝整文件编辑，避免截断覆盖。
- 草稿不自动落盘；“审查并保存”只展示差异，不创建票或写盘。“允许一次并保存”先回读比对原始正文，再经真实 approval/ask → approval/answer → extension/call write → read 回读核对。工具仍由共享核心执行原子替换和已观察版本保护。
- 外部修改不覆盖，保留草稿与错误。待审批期间草稿冻结；读取/保存时阻止桌面会话切换、目录改变、发送、起轮及其他工具请求。未保存草稿阻止换文件、会话和工作区；关闭标签仍保留控制器草稿，再次打开可继续编辑。放弃修改才解除保护。
- 文件编辑不是独立后台持久真源；页面草稿仅在内存。应用退出后的草稿恢复未实现。toolCall 仍无显式 sessionId/expectedRevision，本批页面互斥不能代替 Host 级请求身份契约。审批回执迟到且页面卸载时不再发起写入；已放行票的取消/查询仍依赖既有核心到期语义，未新增撤销接口。

### 本次实测

- `node scripts/pack-pages.mjs` rc=0，沿用 Vue runtime h()、CSP 与零 npm 运行时依赖；日志 `.tmp-test/editor-pack-pages.log` 与退出码文件。
- `node --test apps/desktop/test/file-editor.test.mjs apps/desktop/test/file-preview.test.mjs apps/desktop/test/page-sources-parse.test.mjs`：11/11，rc=0。含审查不写盘、取消保留、审批拒绝、未保存换文件、截断/二进制/大文件、卸载迟到与差异限额。
- 其中一条真实 Host 用例覆盖工作区设置、中文空白换行保存、审批前外部修改拒绝、审批后写入前改盘导致 fs-stale-version 拒绝，以及保存空文件。夹具明确写在仓库 `.tmp-test`，不碰用户项目。
- 正式 Electron/main/preload/renderer + 第七批真实 Host：60/60，rc=0。真实项目搜索 → 预览 → 编辑 → 差异 → 一次审批 → 磁盘核对；并测试未保存时会话切换被拒，保留草稿。没有模拟 Host 或写入响应。
- 最终证据 `apps/desktop/.tmp-test/product-design-1791370927481/`；组件日志 `.tmp-test/editor-components.log`，rc 记录 editor-components-exit.txt。已目视核 editor-review.png，红绿差异、行号、路径、未保存与审批按钮清晰。
- Host SHA256 仍为 `19e0f92e1deac6df22367439425ceadc459deae54c15326cd66123eecc9188cc`，未再重编。本批未提交、推送、安装或打包。

### Git 接线变更单（待实现，不是已存在动作）

现有 preload、main 与 Host 没有 Git 读取动作，核心工具表也未登记 Git。下一批需先由共享核心提供只读操作，再接有限 IPC，不能让网页发任意 shell。

| 拟议动作 | 输入与身份 | 输出与边界 | 失败与验收 |
| --- | --- | --- | --- |
| workspace/git-status | sessionId、workspaceRevision；根目录由会话投影解析 | HEAD/分支、porcelain -z 条目、索引与工作区状态、未跟踪；输出限额与查询身份 | 非 Git/缺 git/超时/目录改变分别结构化失败；中文、重命名、空仓、冲突与迟到响应 |
| workspace/git-diff | 同一身份、相对 path、scope=working/index；拒绝外部路径和任意参数 | 对应 HEAD/索引的真实 patch、二进制标记、截断标记；分项读取不把未跟踪文件当空差异 | 保留 staged/unstaged 区别、文件删除与大 patch；会话切换和查询取消后不覆盖新页 |

主责：E 共享文件/Git 执行与安全边界，A Host/CLI 和有限 IPC，G 页面消费。只读查询不获得暂存/提交/推送授权；后续三类写操作各需具体范围和分别审批。核心、CLI、桌面与打包态验收分开登记。

## 真实 Git 状态与差异第九批（2026-10-07）

固定基线仍为 `35a69ca9e0f8b7b6ac51271ec76eff3515eaa820`，本批属于未提交工作区验收。沿用共享仓颉核心、Host NDJSON、有限 preload IPC 和 Vue runtime h()，未增加网页任意 Shell 入口。

- 新增 `core/src/git_workbench.cj` 的真实只读查询。固定 argv 执行 Git，关闭可选锁、外部 diff/textconv、fsmonitor 和未跟踪缓存；每次进程等待预算 2 秒、每个输出管道最多保留 262144 字节，剩余输出排空并返回截断标记。标准输出与错误并行读取。非零退出、缺少 Git、超时均返回结构化失败。
- Host 增加 `workspace/git-status` / `workspace/git-diff`。实际身份输入为 sessionId 与预期 directory，不是上一批拟议的 workspaceRevision；会话权威工作区从日志投影读取并核对。必须恰好位于 Git 仓库根目录，禁止子目录查询扩展到父仓库。差异 scope 仅 working/index，相对路径拒绝越界、绝对路径与非法片段。
- preload 只增加 workspaceGitStatus / workspaceGitDiff 两条固定接口。桌面 Git 资源按已暂存、工作区修改、未跟踪分组，分别读取索引与工作区 patch；中文、空格与重命名使用 NUL 状态协议。未跟踪文件打开真实预览，目录项进入文件树。保存前草稿差异仍是独立资源，不与 Git 差异混同。
- 页面关闭、身份改变或新请求开始后丢弃迟到结果，失败清空旧列表/patch，不展示虚假干净状态。关闭标签不是杀死 Git 进程；当前仅有核心超时终止，尚未实现主动取消接口。Host 查询仍串行，CLI 接线及 Git 写动作均未实施；暂存、提交、推送仍需分别授权。

### 构建与实测

- `cd apps/host; cjpm build --target-dir D:/Project/sa/saai/sa-code/apps/desktop/.tmp-test/git-host-final` 完整构建 rc=0，日志 git-final-build.log / git-final-build-exit.txt。已有编译警告保留。
- 私有目标 release/bin/main.exe 复制到本地开发 dist/host/bin/sacode-host.exe，SHA256 为 `996ef73de922b146ab0825aeaad651d879bd126a3e9dac7db6f7373f1c4ba062`。默认 apps/host/target 仍是上一批产物；后续打包须重新构建或明确采用本批私有目标，不能默认二者相同。没有生成安装包。
- `node scripts/pack-pages.mjs` rc=0。`node --test apps/desktop/test/git-workbench.test.mjs apps/desktop/test/file-editor.test.mjs apps/desktop/test/page-sources-parse.test.mjs` 最终 13/13、rc=0；日志 .tmp-test/git-components.log / git-components-exit.txt。
- 真实 Git 仓库与真实 Host 覆盖同一文件的 staged/unstaged、中文空格路径、重命名、未跟踪、巨型 patch 截断、非法 scope、越界路径、会话/目录不匹配、父仓库边界、非仓库与缺少 Git。只读请求前后 session.log 与 .git/index 不变。非仓库夹具设置 GIT_CEILING_DIRECTORIES，避免被本产品父仓库接管。
- 首次缺 Git 探针误删了仓颉运行库 PATH，Host 以 3221225781 退出，记录为失败；改为保留运行库且隔离 Git 后才验证 git-process-failed。没有把 Host 未启动当作 Git 契约通过。
- 更新 bridge handshake 能力断言，专项 1/1、rc=0；没有宣称全量 bridge 套件通过。
- 正式 Electron/main/preload/renderer + 本批 dist Host 最终 64/64、rc=0。真实编辑保存后打开 Git、核对实际磁盘 patch，切换到无工作区会话后旧列表与差异清空。证据目录 `apps/desktop/.tmp-test/product-design-1791371756487/`，含 baseline、checks.json、smoke.log、退出码与 git-workbench.png；已目视核截图。
- 纠正本会话新增责任登记的成员代号、工作包代号和重复公共路径，未改其他会话责任。归属门禁最终 12/12、自证 12/12。原表待创建路径仍按原状态登记。

本批只证明上述只读桌面链路和对应私有构建；未进行全量核心回归、CLI Git 行为、安装态、缺运行库的独立部署或真实 Git 写动作验收。未提交、推送、安装或发布。

## 正式终端输出回放第十批（2026-10-07）

同一固定 SHA `35a69ca9e0f8b7b6ac51271ec76eff3515eaa820` 的未提交工作区增量，保持指定技术栈。没有新增 Shell 执行入口，也没有修改既有 TerminalBuffer 日志格式或其他会话执行器。

### 接口及页面

- 新增共享核心 `terminal_view.cj`，从 SessionLog 的 terminal/chunk 投影输出。按 seq 分页；同名 jobId 保留为不同记录，不能将进程重启后重复编号误合并成一个任务。损坏分隔或超长 jobId 明确计数，单条正文最多 8192 UTF-8 字节且不切断中文字符。
- 新增有限 Host 动作 `session/terminal-output` 和 preload terminalOutput。输入为 sessionId、整数 cursor>=0、整数 limit=1..16，恰好三个字段；查询必须匹配当前会话。返回 sessionId 与 page（rows、nextCursor、more、malformed）。读取 fresh 日志，只展示已落盘事实，不获取写租约或改变日志。
- 输出页有任务编号、事件序号、折叠、刷新、后续分页、截断、加载/空/失败状态。页面最多保留最近 128 条已读取输出，明确登记省略数量。身份改变、关闭页面、卸载与迟到响应分别处理，不保留前一会话内容。
- TerminalBuffer 记录没有持久退出码、命令或运行状态；JobStore 是内存表，不能从输出推断完成/运行。现有 Host 也未登记 pwsh/bash 的产品工具入口。本批不开放伪终端输入或停止，不将回放等同 PTY。没有运行 Shell 取证命令，回放种子均显式写明“取证夹具，未执行 Shell”。
- 同步修正预览页的旧“Git 尚未接入”说明；不改变文件读取/保存逻辑。构建测试、安全扫描等未接资源继续禁用。

### 本批验收

- `cd apps/host; cjpm build --target-dir D:/Project/sa/saai/sa-code/apps/desktop/.tmp-test/terminal-host` 最终 rc=0；日志 .tmp-test/terminal-build.log、terminal-build-exit.txt。初次 Host 使用未导入的 Int64.parse 编译失败，保留 terminal-build-first.log；改用既有 JSON 整数读取 API 后构建通过，不复用失败产物。
- 最终私有目标 main.exe 与本地开发 dist/host/bin/sacode-host.exe SHA256 同为 `db3d311b64d126763b3c8b1ef9d020d2426656a0050fc6f99018cf2756719ec8`。默认 Host target 尚未更新，不能据它打包本批。没有生成新安装包。
- `node scripts/pack-pages.mjs` rc=0，CSP 静态脚本构建守卫通过。
- `node --test apps/desktop/test/terminal-output.test.mjs apps/desktop/test/git-workbench.test.mjs apps/desktop/test/page-sources-parse.test.mjs` 最终 12/12、rc=0。真实 Host 查询落盘夹具覆盖分页、中文截断、损坏记录、非法数值/额外字段、其他会话拒绝、重启回读、日志不变；组件覆盖同编号保留、长历史上限、迟到/卸载和失败。此读面取证不代表真实 Shell 执行验收。
- bridge handshake 新能力断言专项 1/1、rc=0，记录 .tmp-test/terminal-capabilities.log；不宣称全量 bridge 套件通过。
- 正式 main/preload/renderer + 最终 Host 的 Electron 检查最终 68/68、rc=0。新增真实 Host 回放取证夹具、无执行输入/停止入口、折叠和切换会话清空。最终目录 `apps/desktop/.tmp-test/product-design-1791373094864/` 含 baseline、checks、退出码及 terminal-output.png，已目视核截图。
- 原 node_modules Electron 本轮启动即以 2147483651 退出；使用已登记备用 Electron runtime `D:/Temp/SaCode-window-test-runtime-20261006/SaCode.exe`，加载本批正式源码和 dist Host 后通过，不将其旧安装载荷作为本批证据。中间两遍失败分别为旧“终端应禁用”断言及夹具会话 ID 缺少 sessions/ 前缀，修正后重跑，红记录保留。
- 路径责任登记及门禁、自证各 12/12；git diff --check rc=0。公共入口只加有限动作与页面接线，保留其他 dirty。

### 后续终端与构建测试解锁条件

需先扩展共享核心与 Host：持久 jobId/requestId/sessionId、命令/cwd/退出码/超时/取消原因、stdout/stderr 有界流、独立任务查询和停止、真实进程/子进程终止与沙箱能力探针。当前 SandboxRuntime.confine 只校验模式并返回 argv，不能宣称具备操作系统隔离。CLI 与桌面执行、拒绝授权、失败、取消/断连、恢复均须独立取证。完成这些契约与探针后再开放终端输入和构建测试动作。

本批未进行全量核心回归、真实 Shell 执行、独立 PTY、打包或安装态验收；未提交、推送、安装或发布。


## 执行契约、超时与真实结果判据第十一批（2026-10-07）

固定提交仍为 `35a69ca9e0f8b7b6ac51271ec76eff3515eaa820`，工作区态。没有增加 Host/CLI Shell 产品入口，也没有新增日志事件类型。阶段交付为 [F02/F09 执行契约](../plans/sacode-execution-contract-2026-10-07.md)、核心基础修正与实际能力探针，不等于持久任务、交互 PTY 或构建测试全部完成。

### 红先事实与实现

- 旧 ShellExecutor 在主线程读完 stdout 后才检查 wait 超时。独立 Node 夹具只打印并保持管道打开 8 秒，要求 timeoutMs=200；实际耗时 8.158 秒，返回 timedOut=false / exitCode=0，探针 exit=1。完整记录 `.tmp-test/shell-contract-probe/before.json`，此前 3 秒外部看门狗记录另存 before-watchdog.json。
- 修正为双管道并行读取、独立单调时钟等待循环、每路保留 64 KiB 后继续排空，截断保留完整 UTF-8 字符。新增内部取消回调及 cancelled、stdoutTruncated、stderrTruncated、outputComplete 字段；保留原构造器调用兼容。预先取消/非法超时不启动；退出等待和输出收集均有上限。
- 捕获/编码不完整返回明确错误。同步修正 ToolRuntime.shellStep：拒绝不完整结果，截断进入旧终端缓冲时带明确标记；非零退出、超时或取消不再标为 verified，也不返回成功工具结果。现有 Agent/Host 尚未绑定运行中取消信号，不能宣称发送区停止覆盖 Shell。
- 集成探针还实际复现了当前 cmd 包装的引用问题：带引号的执行路径被误转义，命令返回错误，旧工具层却标 allowed=true / verified=true。红记录 `.tmp-test/shell-pipeline/run-quoted-failure.log` 保留；本批修正退出判据，未修任意 cmd 引用。后续无空格路径脚本夹具用于验证实际结果链，不冒充引用兼容验收。
- 初次直接静态库探针缺少 stdx 显式链接，构建红另存 shell-pipeline/build-first.log；可复跑验证器按实际 Host cjpm.toml 读取依赖路径、显式链接后通过。不以旧库或失败构建运行结果证明修正。

### 最终取证

- `node apps/desktop/test-support/shell-execution-verify.mjs`：实际 shlex.cj / sandbox.cj 与独立仓颉取证程序，12 项执行器检查通过；另一个当前 Windows 根/直接子进程终止探针通过。最终 `.tmp-test/shell-execution-1791374153256/`，含源码/程序哈希、构建命令、build/run 真实退出码及 tree-observation。不是完整核心单测分母。
- 执行器覆盖保持管道打开的超时、运行中取消、包装入口取消传递、双路大输出/中文限额、非零退出、argv 字面量、不合法期限、启动前取消、缺后端/未知策略、缺程序、无效编码和后续执行独立性。均为明确授权的无副作用 Node 夹具。
- 子进程观察在人工清理前进行，根与本次直接子进程均不存活。最初验证器假定“子进程会残留”而报红，实际观测证伪该假定；纠正为记录正向结果，未归因为提供方失败。该读数不能扩展到脱离子树、孙进程、竞争创建或其他平台。
- `node apps/desktop/test-support/shell-pipeline-verify.mjs`：刚构建的真实 core 静态库 + ApprovalDesk 工单 + ToolRuntime，4/4、rc=0。覆盖拒绝工单、不完整捕获拒绝、截断声明与实际退出码 42 不成功。最终 `.tmp-test/shell-pipeline-1791374725478/`；基线记录静态库、agent/executor、探针源码哈希。工单由取证程序对已授权私有夹具产生，不证明新版精确提案绑定。
- `cd apps/host; cjpm build --target-dir D:/Project/sa/saai/sa-code/apps/desktop/.tmp-test/shell-host` 最终完整构建 rc=0，已有编译警告保留。私有目标 main.exe 与 dist/host/bin/sacode-host.exe SHA256 为 `922004d216a719504c098fea530131652f892d7d36290f5e8acaeadffda0f3a8`；默认 target 未更新。旧 dist Host 保留在 .tmp-test，不改 DLL 或 SDK 依赖。
- 文件编辑、Git、终端回放、页面解析四文件 Node 回归最终 19/19、rc=0，日志 .tmp-test/shell-host-regression.log / shell-host-regression-exit.txt。
- 正式 Electron/main/preload/renderer + 最终 Host 68/68、rc=0，`.tmp-test/product-design-1791374792658/` 记录最终 Host 哈希、退出码和检查。沿用已登记备用 Electron runtime，仅加载本批开发源码，不使用其旧安装载荷。没有新的 Shell 产品页面验收。
- 责任门禁与自证各 12/12，定向 git diff --check rc=0；保留其他会话 dirty。未提交、推送、安装、打包或发布。

### 当前解锁清单

F02/F09 具体状态、身份、拟议 RPC/CLI、审批摘要绑定、启动与结算持久屏障、恢复不自动执行、独立停止与输出证据、构建报告分母已写入契约。现有模式名称检查不能证明真正隔离；cmd 引用、持久任务与准入、跨重启退出证据、Host/CLI 接线、PTY 与完整子树/平台探针仍未完成。按这些具体前提解锁执行入口，不通过新增按钮或声明整体通过收口。

## 原始参数精确审批第十二批（2026-10-07）

固定提交仍为 35a69ca9e0f8b7b6ac51271ec76eff3515eaa820，工作区态；仅续接既有 ApprovalDesk、ToolRuntime 和 approval/ask，不另造业务系统。

- 旧 dist Host（上一批 SHA256 922004d216a719504c098fea530131652f892d7d36290f5e8acaeadffda0f3a8）实跑新协议反证：非字符串参数未拒绝，审批后替换正文也未拒绝；两次测试各 0/1、rc=1。分别保存在 .tmp-test/exact-approval-before.log 和 exact-approval-substitution-before.log，并附真实退出码文件。
- 工单新增不可变原始 arguments；精准发号 askForCall 与同锁 consumeForCall 核对工具和参数。旧 consume 无法绕过参数绑定，挪用不烧原票。已批准未消费的票到期也失效，修正旧逻辑只过期 pending 的缺口。旧工具名工单兼容仍保留，不宣称所有入口已精准化。
- Host approval/ask 接可选字符串 args 并严格拒绝非字符串/超限；模型工具回调按实际 call.args 发号。桌面 preload/main 同步有限字段，文件编辑保存使用审查过的路径和正文发号，ToolRuntime 在实际派发前拒绝参数替换。没有新增 IPC 通道或日志事件类型。
- 新参数不写入旧 approval/asked 事件；新 Desk 不重建允许票。本批仅证明进程内工具参数绑定，不证明完整任务身份、环境绑定、持久审批摘要、CLI、跨进程恢复或真正沙箱。Windows cmd 引用仍未修复，不能将普通 argv 的引用行为套用到 cmd /c。

取证：

- apps/host 私有目标 .tmp-test/exact-approval-host 构建 rc=0；日志 exact-approval-host-build.log / exact-approval-host-build-exit.txt。正式开发 dist Host 同步该产物，SHA256 4b63cd5095a76351426542b47cd7db706861e5e7ded88102bb25ad8fa2fb01ac。默认 Host target 与已安装应用没有更新。
- node apps/desktop/test-support/exact-approval-verify.mjs：实际新 core 静态库 + ApprovalDesk + ToolRuntime，12/12、rc=0。最终 .tmp-test/exact-approval-1791384733594，包含源码/库/探针哈希、构建命令、日志和真实退出码。覆盖精准放行、旧消费绕过拒绝、换参数/跨工具、一次性、批准后过期、拒绝改判、JSON 重编码、新实例不恢复、旧兼容、8 路竞争仅一个成功、真实工具派发前拒绝。不属于全 core 单测分母。
- node --test bridge.test.mjs file-editor.test.mjs git-workbench.test.mjs terminal-output.test.mjs page-sources-parse.test.mjs（路径均为 apps/desktop/test/）：63/63，fail=0、skipped=0、rc=0。日志 exact-approval-host-regression.log / exact-approval-host-regression-exit.txt。实际 Host 新用例证明替换正文拒绝且磁盘未变、原票可保存原正文、重复消费拒绝；另有 preload 参数透传与页面审查快照验证。
- 正式 Electron main/preload/renderer + 最终 Host：68/68、rc=0，.tmp-test/product-design-1791384693810。继续使用已登记备用 Electron runtime 加载当前开发源码，不沿用旧安装载荷；该读数不代表打包安装已验收。
- 归属门禁及其自证均 12/12；新路径先登记；定向 git diff --check 与 JS 语法检查通过。未提交、推送、安装、打包或发布；他人进行中改动保留。

下一步继续解决 Windows Shell 命令引用，并补持久任务准入与恢复。完整执行入口须满足既有 W10/沙箱/身份门槛，不能用本批参数匹配替代。

## Windows Shell 引用第十三批（2026-10-07）

固定提交仍为 35a69ca9e0f8b7b6ac51271ec76eff3515eaa820，工作区态。本批闭合现有 Windows cmd /c 与 Windows PowerShell -Command 两种标准形式的正文传递，不增加桌面 Shell/PTY 按钮或持久日志格式。

- 红先：真实复制 Node 到私有含空格、中文和单引号路径，旧执行器把可执行路径转成字面量反斜杠引号，cmd 返回 exitCode=1、找不到程序。记录 .tmp-test/shell-quoting-1791385058600，含源码/探针哈希、命令、日志及 run-exit=1。
- 修正以 UTF-16LE/Base64 编码交给 Windows PowerShell，cmd 通过 .NET 原始 Arguments 启动真正的 cmd /d /s /c。用户正文作为字符串数据传递，cmd 自己处理引号、变量与运算符；显式转交退出码，并关闭 stdin、并行转发两路原始输出。外层沿用实际 ShellExecutor 的限额、单调期限与取消。细则见执行契约 §11。
- 验证中修正了三个边界：本环境没有 OS 环境变量，改用编译目标识别 Windows；仅声明继承标准流曾拿到成功空输出，改为两路 BaseStream.CopyToAsync 并以真实 stdout 验证；PowerShell 直接调原生程序的内嵌引号有其自身行为，专项明确区分脚本正文与原生 argv，不以调整后的脚本检查冒充解决该提供方全部参数限制。
- 已识别 Shell 的未验证参数形式、空字符及超长正文明确拒绝，不回退旧转义，不截断执行。cmd 保守上限 7500 UTF-8 字节，最终编码参数上限 28000。Windows PowerShell 缺失/启动失败不返回模拟成功；禁用 profile/AutoRun 与交互提示，没有改注册表、系统权限或执行策略。

最终证据：

- 引用专项 13/13、rc=0：.tmp-test/shell-quoting-1791385931931。覆盖空格/单引号路径、中文及 emoji、cmd 原生 argv 内嵌双引号、PowerShell 正文引号、真实退出码、变量展开、复合命令、打开输出后的超时/取消，以及过长/空字符/未知参数拒绝。提供方记录 Windows 10.0.26300、Windows PowerShell 5.1.26100.9444、.NET 4.0.30319.42000 和 PowerShell EXE 哈希；不宣称其他版本/平台已通过。
- 最终源码执行器专项 12/12、rc=0，另有当前 Windows 根/直接子进程观察通过：.tmp-test/shell-execution-1791386113569。仍不扩展为脱离子树、所有孙进程或其他平台保证。
- 完整私有 Host 构建 rc=0，quoting-host-build.log / quoting-host-build-exit.txt；最终 Host 和开发 dist 同步 SHA256 1f8ccea3f32707880aca40c270c69d6bccd702b2207a2137d1610656e3507f86。已有 143 core + 2 Host 编译警告保留，本批新增拼接警告已消除。默认 target 和安装目录未更新。
- 实际新 core 静态库 + 精确审批 + ToolRuntime：shell-pipeline 4/4、rc=0，私有目录现在确实含空格、中文和单引号，所有执行路径带引号。记录 .tmp-test/shell-pipeline-1791385953009/quoted 中文' path；验证拒绝票、不完整编码拒绝、真实 80KB 输出截断声明、退出码 42 不成功。
- 精确审批专项重新取证 12/12、rc=0：.tmp-test/exact-approval-1791385956108。上述四类计数各自独立，不充作全 core 回归分母。
- bridge、文件编辑、Git、终端回放和页面解析回归 63/63、skipped=0、rc=0，quoting-host-regression.log / quoting-host-regression-exit.txt。正式 Electron/main/preload/renderer 加载最终 Host 68/68、rc=0：.tmp-test/product-design-1791386050441；沿用已登记备用 Electron runtime 加载当前开发源码，不沿用旧安装载荷。
- 新路径已登记，归属门禁/自证各 12/12，定向 git diff --check 和 Node 语法检查通过。未提交、推送、安装、打包或发布；其他进行中改动保留。

当前可继续进入持久任务准入、身份、取消与恢复实施。Shell 引用通过只关闭本批标准形式的已知问题；真正隔离、持久屏障、任务恢复及双入口接线仍需独立验收。

## 第一批阶段 3 覆盖补齐与第二轮复核第十四批（2026-10-07）

固定提交仍为 35a69ca9e0f8b7b6ac51271ec76eff3515eaa820，分支 refactor/dsh-learning，工作区态、未提交未推送。本批只针对第一批阶段 3 的出口条件复核并补缺失覆盖，不新接业务、不改主入口、不改核心或 Host。

### 复核发现（此前被误判为已交付）

对照 PRD §3.1/§3.2 与计划中阶段 3 覆盖清单逐项核对 `checks.json`，发现四处真实缺口：

- **待办**：原型只有执行详情里的一行文字，没有与计划、目标分开的独立对象；而 PRD §3.2 明确“计划、目标和待办是不同对象，不能用同一状态替代”。
- **会话树**：PRD §3.1 要求左侧项目会话树支持置顶、重命名、归档，原型只有两个可切换的会话按钮。
- **执行详情**：与计划步骤混在同一 `details` 内，工具轨迹只是文本，未呈现请求/工具/结果分列。
- **附件与 `@`**：功能已存在（附件写入草稿引用区、`@` 打开引用搜索），但没有任何独立断言，覆盖率上不可见。

### 本批改动（仅原型与其验收）

- `apps/desktop/prototype/prototype.js`：新增独立待办对象（新增/勾选完成/删除，标题标注“与计划和目标分开”）；会话行支持置顶（本机偏好标记）、重命名（本机显示名）、归档与从归档恢复；`execution-details` 拆为“计划”和“工具与结算”两段，轨迹按 请求/工具/结果 分列；归档分组仅在存在归档时渲染，避免导航溢出。
- `apps/desktop/prototype/prototype.css`：待办、执行轨迹、会话行与归档分组样式，沿用既有语义令牌与对比度基线。
- `apps/desktop/prototype/smoke.cjs`：新增 30 项断言，覆盖置顶/取消置顶、重命名更新标题、归档移出项目树与恢复、待办新增/完成/删除且计划步骤数不变、附件仅引用名称且可移除、`@` 搜索筛选与加入引用、执行详情与计划待办分离、引用区清理无残留。

### 取证

- 构建：`node apps/desktop/prototype/build.mjs` → `PROTOTYPE_BUILD_PASS`，rc=0；产物仍无 `eval` / `new Function` / `import(`，CSP 仍为 `script-src 'self'`、`connect-src 'none'`，无运行时 npm 加载。
- 验收：指定运行时 `D:/Temp/SaCode-window-test-runtime-20261006/SaCode.exe` 下 `node apps/desktop/prototype/verify.mjs` → **PROTOTYPE_PASS 602 checks / 0 failed**，`ELECTRON_RC=0`；`evidence/exit-code.txt`=0，`checks.json` 的 `errors` 为空。计数从 572 增至 602（新增断言与辅助入口断言合计），不是业务用例数。
- 迭代事实：首跑 rc=1，命中“归档会话移出项目树”；原因是归档分组内“取消归档 <会话名>”按钮文本本身包含会话名，使按 `.nav` 全文包含判断失真。改为只检查 `.session-row .session-open` 后复跑通过；未放宽被测行为。
- 截图：`evidence/light.png`、`dark.png`、`narrow.png` 已按新界面重生成并目视复核——亮/暗一致，待办与目标、计划分离，会话行带独立操作菜单，窄窗无水平溢出且导航折叠。
- 文档：追踪表 P3 状态改为 602 并新增“第二轮复核登记”；原型 README 增补本批说明，并新增“原型检查表：需求 ID 对照”，按 F01–F20 逐域标注原型交互面、代表检查名与原型状态，满足需求表/接口表/原型检查表同 ID 的要求，同时显式登记未演示项（任务 Header 的 Workspace Actions、F19 导入流程）；UI QA 报告加复核状态注记（其 139 读数为历史版本，D1 顶条已移除，其余待修项保持待修）。

### 边界与下一步

- 本批**不升级任何 F01–F20 业务状态**；原型仍不连 Host、不读凭据、不执行真实动作，全部结果为模拟。
- 工作区中 `core/src/agent.cj`、`approval.cj`、`goal_runner.cj`、`model_agent.cj`、`model_tool_runtime.cj`、`shlex.cj`、`goal_evidence.cj` 与 `apps/host/src/main.cj` 有未提交改动，另有 `git_workbench.cj`、`goal_claim.cj`、`terminal_view.cj` 等新文件；本批**未编译、未运行其测试**，不得据原型通过推定其可用。
- 下一步按依赖：先用新文件复验 F04 目标证据与轮次准入、F08 Git 暂存/提交边界、F09 终端与 Workspace Actions，再进入阶段 4 的主闭环；提交、推送、安装、发布仍按各次授权执行。
