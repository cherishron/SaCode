# 提示词增强与回退：实现与验收记录（2026-10-05）

口径：会话输入框旁的「增强提示词」图标，用当前会话选中的模型改写这一条草稿，返回后直接应用到输入框，
图标转为「回退」，可用回退按钮或输入框内 Ctrl+Z 还原原文；用户一改就作废，迟到结果不得覆盖输入框。
本批只含这一件事，不含目标持续执行与运行中插话。

## 一、落地的四面

| 面 | 落点 | 职责边界 |
|----|------|----------|
| 核心 | `core/src/prompt_enhance.cj` | 请求体只有「一条指令 + 这一条草稿」；`stream:true` 且**不带 `tools` 键**；转调期模型若发出工具调用直接判 `enhance-unexpected-tool`；终态优先级 取消 > 工具 > 截断 > 空结果 |
| 宿主 | `apps/host/src/main.cj` 的 `prompt/enhance` / `prompt/poll` / `prompt/cancel` | 独立第三条车道：不占 `turnBusy`、不接工具执行循环、一槽只放一笔；点击即定档（注册表默认 → 单路设置 → 环境变量），之后换模型只影响下一次；用量只在 `prompt/poll` 结算一次 |
| 桌面 IPC | `apps/desktop/main.cjs` + `preload.cjs` | 渲染层只能送 `{draft}`；空白、超长（>8000）在校验层拒，不转发宿主；无泛化转发通道 |
| 渲染层 | `apps/desktop/renderer/app.js` + `styles.css` | 三态图标（增强 / 取消 / 回退）；应用与回退后重算高度并把光标送回输入框末尾；Ctrl+Z 只在「上一次替换还完整留在框里」且无模态弹层时接管 |

未配置、无凭据、协议不支持一律显式回错并保留草稿，不静默换模型；凭据不进渲染层、不进日志；
草稿与增强结果都不写会话消息（只有用量那一笔进同一份账）。

## 二、逐层实测（本会话内新跑的数）

| 层 | 命令（按原样跑） | 实测 |
|----|------------------|------|
| 核心单测 | `cd core && cjpm test` | rc=0，`Summary: TOTAL: 503`，PASSED 502，SKIPPED 1，FAILED 0，ERROR 0；其中本批新增 13 条（含 `enhanceRequestBodyIsDraftOnly`、`enhancerRejectsToolCallsFromModel`、`runnerCancelIsLocalToItsOwnToken`） |
| 宿主协议 | `cd apps/desktop && node --test test/prompt-enhance.test.mjs test/prompt-enhance-ipc.test.mjs test/task-start-ipc.test.mjs` | `# tests 9` `# pass 9` `# fail 0`；覆盖请求形状（`tools=0`）、凭据不入帧、不新增会话消息、用量只入账一次、空白草稿 -32602、未配置 -32016、在途第二笔 -32001、取消不牵连 turn |
| 真模型往返 | `DSH_HOST='<win-unpacked>/resources/host/bin/dsh-host.exe' node --test test/real-provider-enhance.test.mjs` | `# tests 1` `# pass 1` `# fail 0`，**跑的是安装包内那份宿主**；断言回执模型 = 会话选中模型、增强文本非空且不等于草稿、保留「队列/插话」意图而不 invent 技术栈、投影里没有 assistant 消息、用量读数不低于回执 usage |
| 开发态窗口 | `cd apps/desktop && npm run ui-smoke -- "--session-dir=D:\Project\sa\saai\sa-code\target\du1"` | rc=0，231 条 `UI OK`，0 条 `UI FAIL`，`UI_SMOKE PASS` |
| 打包态窗口 | `cd apps/desktop/dist/electron/win-unpacked && ELECTRON_ENABLE_LOGGING=1 SACODE_SSE_FIXTURE='D:\Project\sa\saai\sa-code\scripts\sse-contract-server.cjs' ./SaCode.exe --ui-smoke --session-dir='D:\Project\sa\saai\sa-code\target\pu2'` | rc=0，231 条 `UI OK`，0 条 `UI FAIL`，`UI_SMOKE PASS`；`target/pu2/ui-smoke-report.json` 记 `{total:231, failed:0, passed:231}`。其中增强段 24 条断言逐条为绿，含「图标变回退」「Ctrl+Z 被应用接管」「继续编辑后 Ctrl+Z 交回输入框」「请求途中改过草稿，迟到结果不覆盖输入框」「加载态再点一次即取消」 |

## 三、交付链对账

| 项 | 实测 |
|----|------|
| 安装包 | `apps/desktop/dist/electron/SaCode Setup 0.1.0.exe`，86,999,405 B，12:04，`npx electron-builder --config.electronDist=node_modules/electron/dist` rc=0，日志无 `⨯` |
| 宿主三份一致 | `dist/host/bin/dsh-host.exe`、`win-unpacked/resources/host/bin/dsh-host.exe`、从 NSIS 的 `$PLUGINSDIR/app-64.7z` 里抽出的同名文件，sha256 前缀同为 `f4445ff62f88bc49ad81ddd8` |
| 安装包 asar 载荷 | 从 NSIS 载荷抽出的 `resources/app.asar` 内：`renderer/app.js` 有 `composer-enhance`+`undoEnhance`、`main.cjs` 有 `dsh:promptEnhance`+`dsh:promptCancel`、`preload.cjs` 有 `promptPoll`、`renderer/styles.css` 有 `.composer-enhance` —— 均为 true |
| 打包态协议面 | `win-unpacked/SaCode.exe --smoke` rc=0 `SMOKE PASS`，其 `initialize` 回执 capabilities 内已列出 `prompt/enhance`、`prompt/poll`、`prompt/cancel` |
| 签名 | 未签名（`signExecutable:false` 仍是显式配置），本轮未改 |

## 四、这轮踩到并留下的三条现场事实

1. **装包态控制台不接管道。** `win-unpacked/SaCode.exe` 是 GUI 子系统程序，不带 `ELECTRON_ENABLE_LOGGING=1` 时
   stdout 一行也拿不到（`rc=0` + 空输出跟「跑得很慢」长得一模一样）。打包态取证只认两样：
   落盘的 `ui-smoke-report.json`，以及带这个环境变量重跑后的日志。
2. **`electron-builder` 不跑 `npm run vendor`。** 第一次打包态复跑（11:54 那份包）报 18 条红，根因不是提示词增强：
   `renderer/vendor/*.iife.js` 是构建期折叠产物，`.ts` 改了而折叠没重跑，asar 里就是过期副本，
   会话目录那一段整块级联失败，连带把我这段的 4 条断言一起拖红（其中 Ctrl+Z 三条是「弹层还开着，
   应用按设计不劫持」）。重跑 `npm run vendor` 后重打，同一套断言 231/231 全绿。
   **判「安装包对不对」之前必须先跑 vendor，这不是可选步骤。**
3. **当前 `dist/host/bin/dsh-host.exe`（11:08 构建）落后于 HEAD。** 按字符串对账：
   `prompt/enhance` 在 exe 有 1 处而 HEAD 源码 0 处（正是本批待提交的部分），
   但 `attachment/image-read`（HEAD 3 处）与 `goal/describe`（HEAD 4 处）在 exe 里都是 0 处。
   这条解释了桌面聚合用例里 `握手声明协议与能力` 与 `真实宿主只读取当前会话持有的图片引用` 两条红——
   它们红在过期二进制，不红在源码。重装宿主后应自清，本批没有替它重编。

## 五、桌面聚合套件（`cd apps/desktop && npm test`）本次读数与归因

`# tests 169` `# pass 164` `# fail 5`（rc=1）。这 5 条逐条：

| 用例 | 归因 |
|------|------|
| 握手声明协议与能力 | 第四节第 3 条：dev 宿主二进制缺 HEAD 已提交的 `attachment/image-read` 与 `goal/*` |
| 真实宿主只读取当前会话持有的图片引用 | 同上，缺同一能力 |
| 真实目标控制持久化且拒绝跨会话和陈旧修订，网页没有完成动作 | 目标线（`core/src/goal_scheduler*.cj` 工作区未落库改动）自己那条，与本批无关 |
| 排队条目由核心铸造 id，同一次提交不会重复入列 | HEAD 级过期断言，上一轮已归因，本批未动队列 |
| 真实提供商往返：配置面登记的模型能出真答复 | `error: 'timeout: task/start'`，桥接 5 s 上限遇上同步建 provider，与本批无关；本批的真模型用例单独跑是绿的 |

## 六、凭据处理

真模型验证的 base / key / model 只从环境变量 `STEPFUN_API_KEY` 或已 gitignore 的 `target/step.key` 读，
未写进源码、配置、日志、报告或记忆；协议用例另外断言「凭据明文不出现在界面与任何一帧里」。

## 七、还没做（不许当成已做）

- 安装包**没有真机双击安装**并跑装后验收；本轮打包态证据来自 `win-unpacked` 直跑 + 从 NSIS 载荷抽出的 asar/exe 对账。
- npm CLI 那份平台包（`npm/dsh-cli-win32-x64/bin`）里的宿主还没跟着换，两个入口现在携带的宿主不是同一份二进制；
  提示词增强是桌面入口的能力，CLI 侧未接。
- 签名与代码所有权仍是 `signExecutable:false` 原样。
