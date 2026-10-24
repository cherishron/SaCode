# 2026-10-24 TUI 回到 Gemini CLI 交互基线

## 纠偏与授权范围

用户指出“参考 Gemini CLI”没有得到落实，外观差距大、功能不全。此前实现被缩成基础聊天框，后续 Warp/Ollama 视觉参考又替代了原始交互目标；这是执行偏差，不是用户已接受删减功能。此记录兼作纠偏学习，不改全局/项目 AGENTS、不另建游离根目录。

本批按用户“继续”完善同一 TUI，限 Node 展示与已有 Host 契约消费；没有改 `.cj`、桌面、供应商或密钥配置，没有收费请求、新依赖安装、Git 提交/推送或发布。仍不把本次当完整 Gemini CLI 复刻或交付。

## 实际参考（非凭记忆推测）

上游固定 SHA `a3dd9f8c7bcb495a46d0b505b6f179996ccd8332`：

- [命令参考](https://github.com/google-gemini/gemini-cli/blob/a3dd9f8c7bcb495a46d0b505b6f179996ccd8332/docs/reference/commands.md)、[键盘参考](https://github.com/google-gemini/gemini-cli/blob/a3dd9f8c7bcb495a46d0b505b6f179996ccd8332/docs/reference/keyboard-shortcuts.md)。最初猜旧路径返回 404，改用 GitHub 树发现现行路径。
- 阅读 `packages/cli/src/ui/components/{AppHeader,Header,SuggestionsDisplay,Footer}.tsx`，以及提取 `InputPrompt/ModelDialog/SessionBrowser.tsx` 中输入、边框、选择和状态的实现片段；不宣称完整审计上游全部 UI。
- 本项目独立实现，不复制 Gemini 品牌或代码；Google 登录、Gemini 模型和远程服务不搬进 SaCode。Context7 当前无端点，Ink API 以本地已安装 5.2.1 源码/测试核实。

## 功能对齐台账（未完成项不消失）

| 参考面 | 本批前 | 本批实际增量 | 仍缺/限制 |
|---|---|---|---|
| 启动与底部信息 | 简单标题/空态 | 自有标识引导、命令提示、底部实际 cwd/本进程模型选择 | 真终端观感未验；仍是全屏视口，不是上游全部 transcript/alternate-buffer 模式 |
| `/` 命令发现 | 仅 help/quit | 统一注册表、前缀过滤、↑↓选择、Tab补全、Enter执行、Esc收起 | 非模糊搜索/参数补全；不做假命令 |
| 输入编辑 | 单行、粘贴转空格 | 多行粘贴保留、Ctrl+J/Alt+Enter换行、上下行移动、Ctrl+P/N历史、Ctrl+U/K删除、Ctrl+C先清草稿、Ctrl+D向后删/空输入退出 | Home/End、词移动、撤销、反向搜索、外部编辑器、自动队列/终端增强协议未齐 |
| `/model` | 无 | 只读本地 `custom/describe`，启用且有启用绑定的模型选择；下次 task/start 带 customModelId | 仅本进程，不持久化；不保证凭据/供应商可用，不是全模型配置；宿主默认行不宣告已配置 |
| `/auth`/供应商配置 | 无 | **未实施** | 阻断无配置用户独立上手；下一批优先，必须安全表单/宿主持久化，不用命令明文 Key |
| `/resume`、`/new` | 无 | 实际 catalog/create/select，成功后回读会话/目录/投影/计量 | 无搜索/归档/重命名；模型选择为本进程偏好，不声称每会话持久 |
| `/directory` | 只能启动 cwd | 实际 Host 工作目录读取/保存，带当前 sessionId | 本轮单目录，非 Gemini multi-directory；需绝对路径，Host最终校验 |
| 工具结果 | 只有摘要行 | `/tools` 列表→原始参数/结果查看，按 resultMessageId 关联 | 无内联展开卡片、文件差异视图、代码高亮/Markdown；结果缺失保持未知 |
| `/stats`、`/about` | 零散底栏 | 实际 usage/status、入口/版本/会话信息 | 不假造成本/上下文比例/耗时；无完整统计页 |
| 审批/取消/结算 | 已有单次审批/详情 | 保留；菜单不抢审批键；运行中禁止上下文切换；退出须先等任务结算 | 真模型任务与失联/取消/恢复完整验收未齐；不复制 Gemini 自动放行策略 |
| 写入未知态 | 命令此前没有 | create/select/set-directory 超时或回读失败冻结发送并提示重开，不自动重发 | 需用户重开核对；并非自动恢复完成 |
| `@文件`、附件 | 无 | **未实施** | 文件补全/授权引用/图片等仍缺，不直接拼文件正文绕过核心 |
| Markdown/代码/内联diff | 无 | **未实施** | 重要可读性缺口，不以纯文本输出当对齐 |
| MCP/技能/计划/设置/压缩 | 无 | **未实施** | 后端能力各自映射，不照抄名字；shell不允许绕过核心安全 |
| `/clear` | 曾误宣告后删除 | **未实施** | Gemini当前命令会新上下文，Ctrl+L仅视觉清屏；不能混同删会话/清屏 |
| 安装与真终端真实任务 | 旧包局部证据 | 本包构建＋伪终端烟测 | 新哈希安装、平台组合、真实终端、真实模型审批/差异/恢复均待验 |

下一步按上述缺口推进，不再把装饰调整或单测数量等同于用户要的完整编程终端。大范围供应商表单/附件/新宿主方法先说明方案，不改其他会话共享实现。

## 接线与安全事实

- 新文件 `commands.mjs/dialogs.mjs/actions.mjs` 分离命令注册、选择展示与 Host 消费，`app.mjs` 统一接线。
- 模型选择**不用** `model/list`（它在 Host 源码会请求供应商），只用本地 `custom/describe`；只传自定义模型 ID 到产品 `task/start`，不使用诊断 turn/start。
- 会话/目录读写核 `apps/host/src/main.cj`：create 不自动选中，必须显式 select；select 检查 selected/id 再回读 sessionId，写失败/未知不继续以旧 UI 发任务。所有写仅用户执行命令时发生，不自动重试；在途阻断。
- 工具结果核 `core/src/{message_projection,tool_call_projection}.cj`，只用标准 resultMessageId，不按正文推断。
- 展示中的控制码可见转义；没有写密钥、安装字体或引入 SDK/服务。

## 验证与产物

- Windows、Node v22.23.2，未提交工作区。`npm test` 指定开发态 Host：**36 tests / 36 pass / 0 fail / 0 skip**，约 6.88 s。
- 新增 13 项测试（此前23）：命令过滤/别名/空格参数、本地模型目录过滤、失败选择不读假状态、工具身份关联、多行移动、菜单补全/模型实际起轮 ID、多行提交/Ctrl+C、在途阻断、会话/目录 UI 接线、模型目录失败返回、写入未知冻结、真实 Host 会话/目录冷重开、工具/统计菜单结果查看与返回。合成用例不当真实模型证据。
- 真实 Host 新增用例使用隔离设置与临时工作区：create→select→set-directory→切回→恢复→Host停启→再次回读标题/目录通过，不请求真实供应商。
- Host 入口 `apps/desktop/dist/host/bin/sacode-host.exe` SHA256 `052917f95f2d6f966aa94a941b988d07f1081d50c1c0b8d44dc008297f4fb4ea`；仅开发态测试，不冒充桌面交付候选同源验收。
- 新 bundle **476,975 B**，dist/主包目录 SHA256 同为 `78690d469af7db61f8cd8f34c56b8ae00f4646a955fb406f0dcf700de37796e1`；`pack-tui` 自足校验通过。
- 新包伪 TTY 菜单→help→Ctrl+D退出 rc=0；19 个 `.mjs` 语法检查通过。无 lint/typecheck 脚本，不将语法检查冒充两项。
- 日志 `target/tmp/tui-gemini-verified-20261024-c56bb447/{tests.log,smoke.log}`。终端文字帧已查看，无真终端截图/用户验收。

状态仍为 **部分对齐、候选待验**。未重打桌面候选/平台包/安装，不改当前唯一对外桌面入口，不升级 F 域完成状态。
