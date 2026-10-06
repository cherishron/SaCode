# 前端页面复刻缺口审计（2026-10-05，Lead 据 ui-smoke 实测断言修正）

## 为什么有这份修正稿

成员 frontend-repl 两次交付 54 项判定表，把 41 项标为「未接 / 证据：无」。该判定**不可用**，原因是方法错误：它以「有没有独立的 renderer/pages/*.ts 页面文件」作为判定依据，而本仓的主应用载体是 `apps/desktop/renderer/app.js`——11 个页面插件加上大量内置界面都在那里实现。按它的判据，设置、主题、快捷键、会话、工具、审批、工作区这些**有完整实测断言**的功能全都成了「未接」。

本稿改以 **`apps/desktop/test-support/ui-smoke.cjs` 的 249 条 `note(...)` 实测断言**为第一证据源。这些断言全部随 `npm run ui-smoke` 真实跑过（`UI_SMOKE PASS`，退出码 0），比「有没有独立文件」可靠得多。

判定口径：
- **已接**：ui-smoke.cjs 里有对应断言，或能在 app.js / renderer/pages/*.ts 定位到实现
- **部分接**：实现存在但功能域不完整（说清缺哪一段）
- **未接**：ui-smoke.cjs、app.js、renderer/ 三处都找不到，且上游确实有该能力

## 一、已被 ui-smoke 实测覆盖（此前被误判为「未接」的）

| 冻结包 | 判定 | ui-smoke.cjs 实测断言（行号） |
|---|---|---|
| ui-theme | **已接** | 193 默认跟随系统；196 保存并驱动 Electron 主题 light/dark/system；199/210 重载从核心恢复；203 主题落盘用户配置且不写会话日志；220/224/227/230 拒收与跨入口同步；687 用户级深色主题跨会话保持 |
| ui-settings-general | **已接** | 190/191 中文设置窗口与焦点；192 通用分区中文且预算集中在右侧；193-230 主题与字号全套；237-247 分类键盘切换、Home/End、焦点归还 |
| ui-settings | **已接** | 179 Ctrl+, 打开；181 焦点不穿透模态；183 关闭归还焦点；190-247 分类与各分区 |
| ui-session | **已接** | 131-139 目录由核心加载、标题来自日志、落盘事件数、Escape 关闭、焦点恢复、只读不写；712-735 新建/切回/隔离/预算独立/主题保留 |
| ui-tool | **已接** | 145-156 真实工具详情弹窗、协议标识与授权要求、Tab 不逸出、Escape 关闭、焦点归还、不增事件；245 工具清单逐项对应核心响应；496-535 需审批工具全流程与免审批只读工具 |
| ui-approval | **已接** | 497 审批浮层带工单号且无永久授权按钮；500-505 指南往返保留工单并聚焦、拒绝结果；508-514 第二张工单、允许一次、放行结果；895-898 放行/拒绝/asked/decided 全进会话日志 |
| ui-attachment | **已接** | 103 经宿主落盘显示就绪；104 一次选择一张卡片；106 移除撤下卡片；113-122 外来凭证被挡、宿主放行的凭证被接受、引用落成事实、字节不进日志 |
| ui-workspace | **已接** | 646-662 工作区窗口读目录、取消保留、经核心落盘、中文与系统选择契约一致、Escape 关闭、写入仍走一次性审批、相对文件写入带空格中文目录；676-680 目录丢失恢复提示、不可用保留原路径、刷新未结算时锁定 |
| ui-shortcuts | **已接** | 179 Ctrl+,；185 Ctrl+Shift+P；187 Ctrl+L；594 Ctrl+Enter 经核心记录 |
| ui-sidebar | **已接** | 1042/1046 侧边栏与导航；179-187 导航焦点管控 |
| ui-sidebar-right | **已接** | 158-169 指南标签切右侧独立页面、Home 切首个标签、预算导航恢复工具页；1425-1426 右侧页面与分隔 |
| ui-reference / ui-sidebar-documentpreview | **已接** | 533-537 预览逐字显示实际读取正文、文件名与字节数来自会话读取记录、成功读取替换空状态、浮动预览同一快照；542-590 浮动预览方向键移动与缩放、真实鼠标拖动、窗口缩小时保持边距、可叠加工具模态、Escape 分层关闭、拆分窗格共享投影、分隔条键盘与鼠标调整 |
| ui-primitives | **已接** | 395 跑一轮按钮由 TinyVue 渲染；400 TinyVue 主色令牌接到本仓令牌 |
| ui-renderer | **已接** | 56 TinyRobot 折叠产物已加载；61 Vue 挂载气泡组数；324-348 BubbleList 容器、角色分布、developer 气泡、角色定位、组标签；357-359 连续 user 合并；380-390 长消息折叠/展开/收起；462-465 流式正文共享字号行高、共享 Markdown 组件、取消撤提示 |
| ui-input-trigger / ui-message-feedback | **部分接** | 253-306 空白禁用、多行自动扩展、上限内部滚动、删除回缩、窄窗重折、过长被拒保留草稿、等待回执锁态、同帧重复点击只写一条；但 @提及/命令状态机等触发面未见断言 |
| ui-brand-official | **部分接** | 159 中文指南明确当前可用操作与模型限制；品牌化的官方分组卡片未见断言 |

## 二、已有实现但**后端未接**（这是真缺口，但不是「页面没做」）

| 冻结包 | 判定 | 缺口 |
|---|---|---|
| ui-plugin-manager | **部分接** | 页面 `plugin-manager.ts` 与适配器 `plugin-manager-adapter.ts`（29KB）已生成，但 9 条 `sacode:plugins*` 通道在 preload / main / host **三层都没有**。适配器设计是诚实的：缺通道时整体返回 null，页面保持 unconnected，不伪造快照 |
| ui-model-selection | **已接** | models-page.ts + app.js:656；232 模型页由宿主交出读写面 |
| ui-goal | **部分接** | goal-bar.ts 已在 app.js:1272 挂载并接 6 条 goal* IPC；但 backend-audit 查出 `GoalRunner/GoalDriver/GoalScheduler` 在 Host 无 `goal/run`，产品里**没有任何东西能让目标从 active 变 complete** |

## 三、复核后仍为「未接」的（这才是真缺口）

按用户目标 1「复刻前端页面」排序：

1. **ui-deliverables** — 交付物面板，ui-smoke 无断言，renderer 无实现
2. **ui-plan** — /plan 命令与边界状态（能力矩阵已记「仍缺 /plan 命令、边界状态」）
3. **ui-jobs** — 后台任务面板
4. **ui-schedule** — 定时任务
5. **ui-workflow-run** — 工作流运行视图
6. **ui-subagent** — 子智能体面板（注意：ui-settings-subagent 的设置字段与它是两回事）
7. **ui-agent-preset** — agent 预设装配（与「一切皆插件」的预设装配直接相关）
8. **ui-settings-agent-loop / ui-settings-web-search / ui-settings-plugin-inventory / ui-settings-session-log / ui-settings-account** — 设置分区。其中 ui-settings-account 按产品裁剪**可能本就不做**（用户要求去除账号体系），需先确认再决定是否列为缺口
9. **ui-sidebar-files / ui-sidebar-terminal / ui-sidebar-browser** — 侧边面板
10. **ui-commands** — 命令面板
11. **ui-skill** — 技能面板
12. **ui-trajectory** — 轨迹/瀑布流
13. **ui-user-questions** — 用户提问
14. **ui-open-in-app** — 在应用中打开
15. **ui-permission-presets** — 权限预设
16. **ui-dockkit** — 停靠框架
17. **session-log-export** — 会话日志导出。上游在 `packages/session-query/session-log-export`（archive.ts / routes.ts / Dialog.tsx / HeaderAction.tsx / controller.ts + 9 个测试），**正文读不到**（本机 DSH 路径不可访问、官方 raw 源网络失败），格式一律标待核，未猜

## 四、与后端缺口的交叉（不属于前端但会阻塞前端验收）

backend-audit 只读审计发现两处**严重**缺口，直接导致「真实模型这一轮」不可用，且都比前端页面缺口更优先：

1. **Host 的 `task/start` 不发系统提示**：`apps/host/src/main.cj` 搜 `SystemPromptBuilder|system/message|sysprompt` 0 命中；`SystemPromptBuilder` 全部调用点只有 `apps/cli/src/main.cj:219/666/989/994`（全是自测）和 `sysprompt_test.cj`。真实模型收到空 system。
2. **真实模型只能调 `todo_write` 一个工具**：`apps/host/src/main.cj:1388` 的 `ModelAgentRunner().start(...)` 没传 toolRuntime，落到 `model_tool_runtime.cj:11` 的 `files=false` 分支；而桌面 `toolsList/toolCall` 用的 extReg（`main.cj:653-656`）注册了 read/write——人能调，模型不能。

另有一条与前端直接相关：`backend-integrate` 查出 `renderer/app.js` 的 `pollEnhance` 在宿主返回 `settled:false` 时**无限轮询**（setTimeout 120ms 无上限），会 CPU 占用、卡顿、内存泄漏。

## 五、结论

前端页面复刻的真实状态比 frontend-repl 报告的好得多：**54 项里约 20 项已被 ui-smoke 实测覆盖**，其中它误判为「未接」的有 17 项。真缺口集中在交付物、计划、任务/定时/工作流、子智能体与预设装配、以及侧边面板与命令面板这批**独立页面**；另有插件管理器（后端断）、goal（无完成通路）、日志导出（上游正文读不到）三项属于跨层缺口。

修正这份判定不是为了把红灯数压小，而是为了**把力气花在真缺口上**——按错误判据去「补」已经做完的功能，只会制造重复实现和回归。
