# 2026-10-24 Gemini CLI 源码与界面逐项对照（改造前）

## 结论

当前 SaCode TUI **没有达到 Gemini CLI 的布局与交互参考目标**。上一批新增命令是真接线，但同名命令与单测通过不能证明界面相似、流程完整。用户连续指出差距，此轮停止零散加入口，先核源码和渲染帧；此文是诊断与待批准方案，不是已实施重写或验收报告。

## 实际取得的材料

- 上游固定版本 `google-gemini/gemini-cli@a3dd9f8c7bcb495a46d0b505b6f179996ccd8332`，不是随 main 漂移的比较。
- 下载 19 个文件（LICENSE、CLI package.json、布局、正文、输入、工具、审批、Markdown/diff、认证输入、文本缓冲和两份快照），逐文件 SHA256/大小记录于 `target/tmp/tui-gemini-source-audit-20261024/upstream-manifest.json`。`NOTICE` 请求未取得，不据此断言所有上游/依赖都没有 NOTICE。
- 较短组件完整阅读；MainContent/InputPrompt/工具分组/审批重点读取布局、焦点与渲染分支；text-buffer 仅接口与依赖取样。没有将“下载成功”等同于已读完所有 132KB 的输入缓冲实现。
- 本地合成 App 渲染 80×24、48×18 两种尺寸，每种取 idle、命令、模型选择、审批共 8 帧：`target/tmp/tui-gemini-source-audit-20261024/local-frames.json`。驱动 `capture-local.mjs` 无 Host/模型请求，不读用户设置。
- 本轮没有真实运行 Gemini CLI；上游依据是源码与其测试快照（部分父组件快照有 mock，不能当完整产品截图）。本地依据是 Ink 渲染帧，不冒充 Windows Terminal GUI 对照。

## 具体差异（并非颜色问题）

| 面 | Gemini CLI 证据（上游相对路径） | SaCode 当前事实 | 需要改动 |
|---|---|---|---|
| 根布局 | `ui/layouts/DefaultAppLayout.tsx:30–80`：仅 alternate buffer 固定高度，MainContent 后接控制区，DialogManager **替换** Composer | `src/app.mjs:560–579` 无条件固定整屏高度；Header 固定顶端；选择框后仍画输入框和 Footer | 分离历史流与控制区；区分标准 transcript/全屏模式；对话框不再和普通输入叠放 |
| 历史输出 | `ui/components/MainContent.tsx:331–464`：Header 属于历史；标准路径用 Static，另一条用 ScrollableList；历史/最后轮/待处理分层 | `src/viewport.mjs:26–32` 全历史同一个负 margin 视口，每次重绘；附加一行“最新/PgUp” | 标准模式静态历史＋活动轮；全屏仅在明确模式使用滚动视图，不把整屏重绘当标准终端行为 |
| 启动 | AppHeader 随历史；可窄屏折叠，元信息由真实状态给出 | 固定小标题＋另一个空态框；80×24 idle 8 空行，48×18 idle 7 空行 | 一套自有启动头与引导，不在会话开始后常驻重复；不复制 Gemini 商标 |
| 输入形状/流 | `InputPrompt.tsx:1797–1933`：上/下单边线、背景模式、视口行、终端光标；suggestions 按 buffer 模式决定上下 | `components.mjs:141–175` 围框＋`▌`模拟光标，长行截断，不按终端字格形成视觉行 | 按上游输入视口/焦点结构适配，不再只按逻辑换行裁 4 行 |
| 命令建议 | SuggestionsDisplay 结构化列、选择/滚动/空态；InputPrompt 绑定补全语义 | `dialogs.mjs:22–32` 单条长字符串截断；菜单永远在输入上方 | 对齐列布局、描述、滚动和补全；保留 SaCode 已接通命令，不复制无法执行的命令 |
| 普通消息 | `messages/UserMessage.tsx` 用 `> ` 行前缀；`GeminiMessage.tsx` 用 `✦ ` 和 MarkdownDisplay | `components.mjs:46–55` “你/SaCode”各占标题行，正文另缩进，始终纯文本 | 历史项采用角色前缀同行，助手正文结构化渲染；用户内容不当指令执行 |
| Markdown/代码 | `utils/MarkdownDisplay.tsx` 完整块/行内/表格/未闭合围栏处理，CodeColorizer 等协作 | MessageRow 只有 Text，没有 Markdown、表格、代码、diff 展示组件 | 评估移植小型纯展示组件及依赖闭包，测试流式半成品，不能用几个 regex 假称完整 Markdown |
| 工具 | `messages/ToolGroupMessage.tsx` 与 ToolMessage：在历史流中按调用分组，状态＋正文/输出/diff，运行/完成可更新 | 工具从 messages 中剥离，最多6条钉底；结果需 `/tools`→选择→另一个详情页 | 按日志 seq/id 合成历史项，工具卡内显示结果；`/tools` 仅补充历史导航，不代替内联反馈 |
| 审批 | MainContent 中插入确认队列；`Composer.tsx:85–86` 需要时收起输入；ToolConfirmationMessage 按编辑/shell/MCP呈现详情和选项 | 独立黄框＋“请先回答审批”的额外输入框，48×18占11行控制区；只有摘要/y/n，详情另开视图 | 让审批接管控制焦点与高度，默认可读关键请求；展示可复用，决策仍只走 SaCode 工单，不搬自动放行策略 |
| 模型/会话 | 上游有独立 ModelDialog、SessionBrowser、状态层；不是一套通用字符串列表 | 复用 SelectionDialog，只有ID列表，没有搜索/细节/持久偏好 | 分别定义数据适配与对话框状态，错误/加载/关闭/选中一致；不要假称凭据可用 |
| 无配置启动 | AuthDialog/ApiAuthDialog 独立流程和输入缓冲；原生 Google/Gemini认证依赖其 core | `/model`仅本地 custom 目录；无记录时还只显示“宿主默认路由”，没有独立配供应商过程 | SaCode自己的无秘密状态检查与配置入口；秘密输入走遮罩/不入消息历史，调用现有 Host，不能照搬 Google 登录 |

### 本地渲染帧确认的直接问题

1. 80×24 `/model` 打开后，上面仍显示“开始使用”空态，下面同时有选择框、输入框和两行底栏。
2. 48×18 审批时同时显示审批框、另一个“请先回答”的输入框、目录和状态；而上游 Composer 有明确收起路径。
3. 本轮 bundle 仍是 `78690d469af7db61f8cd8f34c56b8ae00f4646a955fb406f0dcf700de37796e1`；没有重打新产物或把审查当作新版本。

## 开源复用与兼容事实

- 上游 LICENSE 为 Apache-2.0，允许遵守条件的复制、修改与分发。我此前在 DESIGN.md 写“一律不拷贝源码”是自加限制，不是许可证要求。改造应优先评估可复用组件，而非闭眼重写简化版。
- 复制/改造时保留适用版权头、许可证、修改说明及适用 NOTICE，检查所带第三方依赖；不复制 Gemini 品牌，也不把外来文件版权改称本仓独占。**本轮尚未复制任何上游实现进产品源码**。
- 上游当前 `packages/cli/package.json`：React 19.2.4、`ink` 指向 `@jrichman/ink@6.6.9`、Node≥20；本仓 React18.3.1/Ink5.2.1/Node≥18。InputPrompt 使用 `terminalCursorFocus/terminalCursorPosition` 等能力，同时依赖 core、contexts、text-buffer、clipboard、key matcher、语法高亮。不能直接把整个 CLI 目录塞进本仓就称可运行。
- 可先移植独立渲染/布局，隔离主题与数据适配；若必须换 Ink/React/Node 基线，要单独说明兼容、锁文件/打包影响并获批准，不静默升级或安装。`@google/gemini-cli-core` 不作为 SaCode 业务引擎引入。

## 待批准的整体改造方案（当前不执行）

### 1. 固定对照及验收帧

保留上述固定上游与 SaCode 当前帧；增加真实任务流的 loading/流式 Markdown/工具运行与完成/审批/拒绝/取消/错误八类状态，采用同样宽高和同样合成内容。后续每一批同时给出结构前后对照，不再只报用例数。真实终端测试仍是独立门槛，当前工具没有真实 TTY，不能冒充完成。

### 2. 替换显示骨架，不动业务协议

把 app.mjs 的“固定Header＋独立工具区＋叠放控件”改为 `MainContent(启动头＋按seq排序的消息/工具历史＋活动轮)` 和互斥 `Controls(普通输入/选择框/审批/配置)`。以 Gemini 标准 transcript为默认目标，研究 Static 的稳定键/恢复/重绘，再保留明确全屏模式；不破坏用户已有日志与分页语义。抽出 Host 事件适配，保留 task/start、工单、取消/结算事实。

### 3. 合规移植独立展示组件

先核 Markdown/行内/代码/diff依赖闭包与许可证，能分离的组件改为本仓主题与 Host projection 数据；工具 card按调用ID/事件seq归位。没有宿主diff时显示“无已验证差异”，不自行造before/after。审批仅复用布局和详情，不搬权限放宽。

### 4. 输入与配置流程

优先适配上游文本缓冲/视觉折行/焦点/补全结构；评估继续Ink5适配还是单独批准升级。实现无配置入口、供应商选择/编辑/遮罩密钥，明确保存影响与宿主回读；密钥不放命令历史、消息投影、截图或诊断日志。不能为演示把认证记录当成功请求。

### 5. 逐项运行验证

已有回归保护协议；新增真实渲染帧对照、长历史/流式/resize、焦点互斥、取消/拒绝/未知结果防重试，Host隔离冷重开，之后新包安装及用户真实终端/实际模型任务。收费请求、安装、提交和发布各自授权；不重打当前桌面候选。

改造范围显著大于此前小步修改，按项目规则**本轮仅调查与方案，等待用户批准整体骨架替换**。批准不自动包括依赖升级、装包或收费请求。
