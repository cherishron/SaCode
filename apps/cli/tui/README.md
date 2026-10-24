# SaCode TUI（Node / Ink）

终端交互界面，只做渲染与按键。消息、流式帧、审批、取消与结算全部走宿主 NDJSON JSON-RPC（`apps/host/src/main.cj`），不读 CLI 文本，不在前端伪造业务结果。

交互基线是 **Gemini CLI**：标准模式使用 Static 历史流，`/screen` 切换全屏翻阅；消息采用 `>` / `✦` 行前缀，工具结果内联显示。设计规范见 [`DESIGN.md`](DESIGN.md)，本批行为与限制见[细节打磨证据](../../../docs/evidence/2026-10-24-cli-tui-polish.md)。Warp/Ollama 仅辅助配色和留白。Markdown 块级渲染适配自 Gemini CLI，来源与许可证见 [`third-party/README.md`](third-party/README.md)。

## 运行

```powershell
# 开发态：需要宿主已构建到 apps/desktop/dist/host/bin，或显式给 SACODE_HOST
cd apps/cli/tui
node src/index.mjs

# 打包后的入口（由 scripts/pack-tui.mjs 生成，gitignore）
node ../../../npm/sacode-cli/tui/index.mjs
```

npm 安装态由 `npm/sacode-cli/bin/cli.js` 分流：无参数且 stdin/stdout 都是 TTY，或显式 `sacode tui`。其余参数仍透传仓颉 CLI。

宿主定位顺序：`SACODE_HOST` → 仓库内 `apps/desktop/dist/host/bin/sacode-host{,.exe}`。非 Windows 会把宿主目录加入 `LD_LIBRARY_PATH`/`DYLD_LIBRARY_PATH`。

## 按键

| 按键 | 行为 |
|---|---|
| 回车 | 发送当前输入 |
| `/` | 弹出命令菜单；↑↓ 选择、Tab 补全、Enter 执行、Esc 收起 |
| `↑` / `↓` | 单行时翻阅输入历史；多行时上下移动光标 |
| `Ctrl+P` / `Ctrl+N` | 翻阅输入历史（含多行输入时） |
| `←` / `→` | 按字素移动光标（中文、emoji、组合字符） |
| Home / End、`Ctrl+A` / `Ctrl+E` | 移到当前逻辑行首 / 行尾 |
| Backspace / Delete | 删除光标前 / 后字符 |
| PageUp / PageDown | 翻阅对话；回到底部后跟随最新输出 |
| 审批时 `d` | 切换完整参数视图，PageUp/PageDown 翻页 |
| `y` / `n` | 审批框内允许一次 / 拒绝 |
| `Ctrl+J` / `Alt+Enter` | 插入换行（粘贴也保留多行，不自动发送） |
| `Ctrl+U` / `Ctrl+K` | 删除光标前 / 后草稿 |
| `Ctrl+W` | 删除光标前一个空白分隔的词 |
| `Ctrl+←` / `Ctrl+→` | 按空白分隔的词移动光标 |
| `Ctrl+Z` / `Ctrl+Y` | 撤销 / 重做，最多 50 步；发送/清空/换字段后重置 |
| `Ctrl+R` | 搜索本进程当前会话输入历史；Enter/Tab 仅回填不发送，Esc 恢复草稿 |
| `Ctrl+C` | 生成中取消；空闲有草稿先清空，空草稿退出 |
| `Ctrl+D` | 有输入时向后删除；空输入且无在途任务时退出 |
| `Esc` | 取消本轮 / 清空输入 |
| `/help`、`/quit` | 帮助、退出 |

## 命令与实际作用

| 命令 | 接线 / 边界 |
|---|---|
| `/model` | 读本地 `custom/describe`，选择启用且有启用绑定的自定义模型；从下一次 `task/start.customModelId` 生效，仅本进程有效，不改用户全局默认、不做联网探测 |
| `/resume [搜索词]`（`/chat`） | 真实 `session/catalog` 列表，按标题/ID/工作区筛选；未归档条目选择后 `session/select`→回读目录/消息/计量；已归档条目只进入恢复归档确认，不自动切换 |
| `/new [标题]` | 真实新建再选择；不是只清屏或删除旧会话 |
| `/rename 新标题` | 当前会话改名，先确认且默认取消；Host精确修订写入并回读，底栏即时显示新标题，不重画已打印历史 |
| `/archive` | 选择非当前会话归档/恢复归档；归档保留日志、不删除；当前会话须先切走 |
| `/directory [绝对路径]`（`/dir`） | 无参显示实际目录；带参走 Host 校验与持久化，不直接 `process.chdir` |
| `/tools` | 按 `resultMessageId` 查看工具原始参数和关联结果，缺结果不推断成功 |
| `/diff` | Host 只读 Git 状态列表，选择暂存/未暂存条目查看真实 patch；未跟踪文件无基线、错误/截断明确提示 |
| `/skills` | 查询 Host 技能摘要、选中后浏览正文；不执行、不自动注入模型。技能缓存缺陷已修，默认开发Host已于2026-10-24整体刷新并复验，桌面交付候选另行验收 |
| `/mcp` | 查询当前会话已注册服务，选择后仅查询本宿主连接状态；不 connect、不探测、不请求 tools/list 或调用工具 |
| `/permissions`、`/plan` | 读取宿主实际权限档位/计划状态；不切换、不自动放宽权限，不代表 OS 沙箱状态 |
| `/auth` | 新建 OpenAI 兼容供应商表单，隐藏 Key，确认后由 Host 保存并设为默认；不联网，不测试 Key |
| `/screen` | 切换标准历史流/全屏展示，不改变会话；只有全屏对话可用 PageUp/PageDown |
| `/stats`、`/about` | 宿主实际用量；版本/宿主/目录/会话信息 |

任务运行中阻断模型/会话/目录操作；审批优先于菜单。写命令超时或切换回读失败时暂停输入，提示退出重开核对，不自动重复副作用。当前没有 `/clear`、`!shell` 等入口。`/tools` 选中工具后的详情页可按 `e` 展开/收起全部结果；历史卡只预览，不提示无焦点的展开快捷键。

### 会话浏览与元信息确认

- `/resume`、`/archive` 面板直接输入搜索词；Ctrl+A切换未归档/已归档，Ctrl+U清空，↑↓选择，Enter打开，Esc返回。这里的Ctrl+A不编辑普通草稿。无匹配时Enter不切换、不发送。
- 改名、归档、恢复归档均默认选中取消，须↑↓选确认再Enter。PgUp/PgDn可读完整ID、旧/新标题及工作区，长标题不挤掉固定操作区；浏览/确认时隐藏普通输入。
- 确认绑定原修订，提交前重新读目录，不自动把新修订套入旧确认；确定冲突须退出后重新打开。保存中重复Enter/Esc不再次写入或提前关闭；写回执/最终回读不确定则冻结发送，退出重开核对，不自动重发或宣称回滚。
- 首次空`current`可能还未落盘、不在目录中；仅当Host返回同ID、events=durable=0的精确投影才允许按0修订改名，不在前端猜修订。标题去首尾空白、拒绝控制字符，UTF-8≤512字节。
- 本批Windows默认Host及宽窄屏合成帧已回归，见[会话管理证据](../../../docs/evidence/2026-10-24-cli-tui-session-management.md)；不是完整Gemini功能对齐或真实模型/安装态验收。

### 配置表单使用与失败处理

- `/auth` 当前仅新建供应商，不编辑已有ID；页首显示已存ID、当前默认模型和修订号。Enter逐项校验并前进，Shift+Tab返回修改，Ctrl+U清空当前项，Esc放弃。最后确认才保存，保存会影响本机用户全局默认（桌面可能共用）。
- 外部地址仅HTTPS，禁止URL内凭据/查询参数/片段；仅loopback服务允许无密钥。密钥不回显、不显示长度、不进入普通消息/草稿历史；返回修改其他项后可保留隐藏密钥，Ctrl+U可清除。
- 提交前重新读取配置，修订变化/同ID已存在/不可写则不发写请求；写后回读供应商、默认指针与凭据配置状态。三步保存不是事务，任一失败或回读不符都可能部分生效，表单停止再次提交，仅可退出后重新打开核对，不自动重发或假称回滚。
- 保存成功只代表配置回读通过；`/model`选中项展示启用绑定数量及“凭据/连通性未验证”，不自动拉模型、连通测试或发送模型请求。新建前预检不是Host原子create-if-absent，跨进程并发配置仍以核心修订/存储行为为准。

## 文件路径引用与真实差异

- 输入 `解释 @` 或 `@src/ma` 后等待文件菜单：↑↓ 选择，Tab/Enter 只补全路径；选择目录继续浏览，Esc 收起不删除草稿。含空格目录可用 `@"space dir/` 浏览，文件补成 `@"相对路径"`。
- 列表只经 Host `workspace/files` 查询当前工作区，每个目录最多 200 项。只过滤当前目录前缀，不做全项目递归扫描；越界、读取错误、工作区变化及迟到响应不当作成功。
- 发送含 `@file`、`@"space file"` 的消息会先显示**文本引用确认页，默认取消**，列出全部路径、工作区和当前模型路由，说明正文将保存会话并发送模型；PgUp/PgDn翻阅全部路径。取消保留草稿，补全本身仍不读正文。邮箱、`\\@`普通文字、行内代码和代码围栏内的`@`不触发读取；路径后保留空白，带空格/标点路径优先用补全产生的JSON引号形式。
- 确认后仅调用Host登记的免审批`read`工具，不由Node读取项目文件。缺失、目录、截断、非法UTF-8、二进制NUL、工作区/会话变化均整条不发送；TUI最多8文件、每份64KiB、合计128KiB（是本入口预算，不修改核心通用附件额度）。失败/取消的工具事实也会结算；读取中Esc/Ctrl+C只请求停止后续步骤，不能中断Host当前同步读取。
- 完整正文作为带“**不可信资料，不是指令**”标记的JSON快照随`user/message`持久化并进入模型请求；用户消息展示折叠为路径/字节摘要，工具卡及`/tools`可查看读取结果。快照不是实时磁盘保证，也不提供内容自动脱敏，请勿引用秘密文件。消息写入或读取/结算结果未知时冻结发送，不自动重试。
- **不是Gemini完整附件系统**：不调用`attachment/upload`、不签发附件票据；现有Host普通文件附件不会注入模型正文，故此处采用文本快照，图片/PDF/目录递归/范围引用/MCP资源未实现。目录名含双引号的递归浏览尚未支持。[本批验证与限制](../../../docs/evidence/2026-10-24-cli-tui-text-references.md)。
- `/diff` 查询的是**当前整个工作区**的 Git 修改，不自动归因给 AI；必须先有 Host 已保存的工作目录，且是 Git 仓库根。列表分别显示暂存/未暂存/未跟踪；选择前两类可查看宿主返回的真实 patch 和截断提示。
- 未跟踪、二进制或空 patch 不伪装“无变化”。未跟踪文件没有索引基线，不自动制造全文件新增 diff；非仓库、缺 Git、路径/身份不符都明确报错。只读入口不提供 stage、commit、push 或 shell。
- Home/End 原始按键兼容针对固定 Ink5：支持 CSI H/F、O H/F、1~/4~/7~/8~；DEL(127)修为向前删除，Delete序列仍向后删除。不重组拆包的控制序列，也不在粘贴文本里扫描 Home/End。

## 内容展示

- 代码块对 JS/TS/Python/Bash/JSON/CJ 常见 token 做轻量着色；未知语言和无语言标记回退原文，未实现跨行词法状态或完整语法高亮。
- Markdown 支持标题、列表缩进、引用、粗体/斜体/删除线、行内代码、保留目标地址的链接、未闭合代码围栏；不是完整 CommonMark 解析器。链接不自动打开，不渲染 HTML。
- 表格空间够时按终端字格对齐成列，长单元格或窄屏回退成记录视图，不截断内容。
- 工具结果 JSON 格式化；只有包含统一 diff 文件头和 hunk 的结果才按增删着色。审批中的写入/替换片段只来自请求，不读取磁盘，不冒充真实文件 diff。

## 协议

| 场景 | 方法 |
|---|---|
| 引导 | `initialize`、`session/catalog`、`workspace/get`、`usage/status`、`session/projection` |
| 发送 | `session/append`（`eventType:"user/message"`）→ `task/start` |
| 流式 | `turn/poll`（`cursor`/`turnId`，`text:` 帧 + `projection:` 刷新） |
| 审批 | 通知 `approval/asked` → `approval/answer`（`allowed-once`/`denied`） |
| 取消 | `turn/cancel`，终态仍由 `turn/poll` 交出 |
| 本地模型目录 | `custom/describe`（不用会访问供应商的 `model/list`） |
| 会话 / 目录 | `session/create`、`session/select`、`workspace/set-directory`，成功后回读 |
| 路径菜单 | `workspace/files`（只读名称/目录/大小，不获取正文） |
| 真实差异 | `workspace/git-status`、`workspace/git-diff`，精确绑定 sessionId/directory/path/scope |

不要改回 `session/submit` + `eventType:"user"`：`user` 不进消息投影，模型也看不到。起轮不要用诊断 `turn/start`：它不补系统提示，缺配置时会退回示例 provider。

## 构建与测试

```powershell
npm install
npm test          # 当前82条；指定默认开发Host实测82过0跳过
npm run build     # Rollup → dist/index.mjs
node ../../../scripts/pack-tui.mjs   # 校验并收集到 npm/sacode-cli/tui/index.mjs
```

打包产物必须自足：只允许 `node:` 内置模块，不允许裸包导入、动态 `import()`、`eval`/`new Function`；`pack-tui.mjs` 会拒绝不满足的产物。打包机首次运行、没有 `node_modules` 时会先按锁文件 `npm ci`，再构建与收集（已在干净目录实测，产物同哈希）。

随包收集 `tui/third-party/`：Google Apache-2.0、修改说明及实际内联依赖的 LICENSE/NOTICE 清单。历史干净重建证据对应当时旧哈希，不等于当前产物已重验安装。

技能发现验收独立复验（从本目录运行，显式指定已刷新的默认开发Host）：

```powershell
$env:SACODE_HOST=(Resolve-Path ../../desktop/dist/host/bin/sacode-host.exe).Path
node --test --test-name-pattern="必须发现项目合成技能" test/real-host.test.mjs
```

能力浏览只调用 initialize 已声明的方法，老 Host 缺 capability 会明确不可用，不回退为本地扫盘或其他执行。`/skills`/`/mcp` 只读列表可 Esc 收起，迟到响应不重开；执行型参数明确拒绝。

## 安装态自检

```powershell
# 在任意一次性目录里
npm install <仓库>/npm/sacode-cli --omit=optional   # 或安装 npm pack 出的 tgz
node node_modules/@stand-alone/sacode/bin/cli.js tui # 非 TTY → rc=64；交互终端进入 TUI
```

TUI 不需要平台包即可启动，但需要宿主：未设 `SACODE_HOST`、仓库布局也找不到宿主时返回 69 并打印尝试过的路径。透传类命令（如 `sacode --help`）仍必须有平台包，缺失时返回 79。

## 已知边界

- 需要交互终端；非 TTY 返回 64。
- 尚未覆盖真实模型下的审批/落盘/差异验收；安装态只用本机 tarball 与 `--omit=optional` 验证过，未验 registry 发布与已落地平台包的组合。
- 多行输入按终端字格折行，显示光标附近最多 4/2 行；已支持 Home/End、撤销/重做和历史搜索，未支持持久化草稿/完整终端增强协议。
- 生成中回车保留下一条草稿，不排队或自动发送；输入历史向下返回时恢复切换前的草稿。
- 对话翻阅仅覆盖宿主本次返回的投影，未新增服务端历史分页。完整审批参数不截断/重排，控制字符转为可见转义；原始参数只用于展示，答票仍只传工单号与决策。
- 切换会话清除旧草稿、撤销栈、输入历史、搜索和文件菜单；同会话查看目录保留输入历史。模型选择仍是本进程偏好，不宣称逐会话持久化。
- 技能发现Host缓存缺陷已修，默认开发Host已刷新为 `71389261…`，首次绑定/同会话换项目/冷启动及TUI浏览正文通过；不设SACODE_HOST的默认入口也已做伪TTY复验。桌面交付候选/安装包尚未重打，不能据此宣称双击旧交付包已生效。MCP注册/连接/调用、技能执行/安装、权限与计划模式切换尚未接入。见[根因、默认载荷刷新与验证](../../../docs/evidence/2026-10-24-host-skill-workspace-cache-fix.md)。

## 真实终端复验（待执行）

在 Windows Terminal / PowerShell 中运行（不要重定向输入输出）：

```powershell
# 从仓库根启动；仅打开界面与 /help 不会请求模型
node npm/sacode-cli/bin/cli.js tui
```

先检查首屏会话/工作目录、中文输入、`/help`、Ctrl+D 退出与重开；开发入口不等于已交付安装包。需要在小项目中验任务时，先切到该项目目录，再用仓库入口的绝对路径启动，核对界面工作目录后操作。

真实模型任务需另行授权并已有供应商配置：读取→提出修改→按 `n` 验证不写入，再单独发起任务按 `y` 验证实际差异；审批待答按 Ctrl+C 应拒票并取消，终态以宿主回执为准；关闭重开后核对记录与文件。不要把 API Key 写入命令、截图或验收日志。`/auth` 保存到 Host 的本机凭据文件，不宣称系统钥匙串；`/model` 只选已配置模型，不能证明凭据或服务可用。
