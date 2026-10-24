# 2026-10-23 UI 冒烟 283/16 分诊与测试支持修复

- 类别：⑦历史证据（本目录冻结，只增不改）
- 取证日：2026-10-23；执行：Qoder 会话（Windows 本机）
- 对象：`D:/tmp/sacode-final-20261023`（Windows 同源候选，`app.asar` SHA256 `03bb917d…37400a`）
- **结论：16 项失败全部归因为 `apps/desktop/test-support/ui-smoke.cjs` 自身滞后或选点错误，不是产品 UI 缺陷。** 修复测试支持后，在与候选产品代码逐文件一致的诊断副本上得到 **301 UI OK / 0 UI FAIL / `UI_SMOKE PASS`**。候选包内仍是旧版测试支持，交付包直接跑 `--ui-smoke` 仍会报 283/16；本记录不把候选包说成 UI 冒烟通过，也不把测试支持修复当成产品修复。

## 1. 基线读数

| 运行对象 | 日志 | 结果 |
|---|---|---|
| 候选包 `sacode-final-20261023` | [neutral-ui-smoke3-out.log](../../../target/tmp/candidate-rebuild-20261023/neutral-ui-smoke3-out.log) | 283 UI OK / 16 UI FAIL，`EXITCODE=1` |
| 旧候选 `sacode-final-20261021` | [neutral-ui-smoke-old-out.log](../../../target/tmp/candidate-rebuild-20261023/neutral-ui-smoke-old-out.log) | 283 / 16，失败行与候选逐项相同 |
| 诊断副本（修复前） | [diag2-ui-out.log](../../../target/tmp/candidate-rebuild-20261023/diag2-ui-out.log) | 283 / 16，同一失败集合 |
| 诊断副本（修复后） | [diag3-ui-out.log](../../../target/tmp/candidate-rebuild-20261023/diag3-ui-out.log) | **301 / 0，`UI_SMOKE PASS`** |

2026-10-23 Linux 同源包为 282/17，多出的 1 项是「窄窗口重新折行」（Windows 通过），其余为同一集合。

## 2. 16 项逐条分诊

失败行原文取自 [diag-ui-out.log](../../../target/tmp/candidate-rebuild-20261023/diag-ui-out.log)。

| # | 失败读数 | 归因 | 修复（仅测试支持） |
|---|---|---|---|
| 1 | `Vue 挂载后气泡组数=2（核心投影给出）` | 断言仍假设 system/developer 各成一组上屏；产品决策是这两类只进日志与模型上下文 | 改为断言 user/assistant 两组存在且正文逐字匹配 |
| 2 | `preload 未登记的额外键=` 49 条通道 | UI 侧自维护清单滞后；IPC parity 门禁实测 198/198 `GATE: PASS` | 把 49 条已有通道补进清单 |
| 3 | `状态筛选段控件覆盖…（实际 [null,"all","ready","truncated-tail","replay-rejected"]）` | 目录弹窗的「存档」切换按钮没有 `data-catalog-status`，被旧选择器当成状态段 | 选择器限定 `button[data-catalog-status]` |
| 4 | `消息等待真实回执时侧栏搜索与弹窗日志筛选一并禁用` | 同一选择器把存档按钮算进 `filterCount`（期望 4） | 同上，只数状态段 |
| 5 | `同帧重复点击仅写入一条真实用户消息` | 用事件总数当「发了几条」；队列路径还会写 `agent/inbox/spliced`，事件数不再等于发送数 | 改为数真实 `session/append(user/message)` 调用数与对话面正文出现次数 |
| 6 | `种子角色分布=undefined/undefined/1/1|组2` | 同 #1；另 `data-role` 不是 system/developer | 改为解析 user/assistant/system/developer 计数并断言 system/developer 为 0 |
| 7 | `developer 气泡=no-developer-group` | 产品不上屏 developer 气泡；旧断言要求可见 | 改为断言气泡为 0，同时断言 `developer/message` 仍在会话日志 |
| 8 | `角色定位=end|start|missing|missing` | 同 #7 | 只对 user/assistant 断言定位 |
| 9 | `连续 user 合并：组数 2 → 2（应不变且 ≥ 3）` | 种子只剩 user/assistant 两组，旧的 ≥3 下限失效 | 改为 ≥2，并保留「组数不变」与正文出现两个前提 |
| 10 | `流式正文与助手消息共享字号和行高` | `#stream` 流式回显框已由 BubbleList 的 live 气泡取代 | 改为探测 `#messages .msg-node[data-live-message="true"]` 与已投影消息的 `font-size`/`line-height` |
| 11 | `取消后的流式正文使用共享 Markdown 组件` | 同上 | 断言 live 气泡内存在 `.markdown-body` |
| 12 | `取消轮回显保留半截正文=""` | 同上 | 从 live 气泡取正文并断言包含 `你好，world` |
| 13 | `指南页保留待审批提示与返回入口` | 渲染层重载后侧栏只剩默认标签，待审批圆点没有挂载点 | 先像用户一样从资源面板把工具与审批标签加回来，再断言圆点 |
| 14 | `tool 气泡=visible|no-source-role` | tool 消息已改为结构化卡片 `.tool-node`；旧断言找 `data-source-role` | 断言卡片数、`data-msg-id` 数、`unknown` 状态数、「缺少调用关联」文案与正文一致 |
| 15 | `项目菜单 Escape 关闭并恢复导航焦点` | `workspaceBusy` 在「已保存」文案之后才落定，紧接着的点击被吞；程序化 click 不产生焦点 | 等 `workspaceBusy===false` 且菜单关闭，先 `focus()` 再 click，等 popover 打开后再按 Escape |
| 16 | `「不再提醒」…重新打开立刻恢复（…"restored":"goal"}）` | 切会话按产品设计清空提醒条；旧断言没有真正「重新打开工作台」 | 在 `bridge.start()` 后 `win.reload()`，按真实启动路径等提醒条重新出现 |

## 3. 修复范围与对账

- 唯一代码改动：`apps/desktop/test-support/ui-smoke.cjs`（工作区未提交，118 行差异）；未改 renderer、preload、main、Host、core。
- 计数对账：**283 OK + 16 项转绿 + 2 项新增断言 = 301 OK，0 FAIL**。新增的两项是「工作台资源面板可添加工具与审批标签」与「重开工作台后启动提醒条重新出现」；其余替换为等量断言，未删检查项来凑绿。

## 4. 诊断副本的产品同源性

为排除「改测试的同时改了产品」，对两份 `app.asar` 做了解包逐文件 SHA256 对比：

- 候选：`D:/tmp/sacode-final-20261023/resources/app.asar`
- 诊断副本：`D:/tmp/sa-code-ui-diag/resources/app.asar`
- 输出目录：[ui-asar-compare-20261023](../../../target/tmp/ui-asar-compare-20261023/)
- 结果：两侧文件集合相同，无新增/缺失；**唯一内容差异为 `test-support/ui-smoke.cjs`**。

因此 301/0 证明的是「同一份产品代码 + 修复后的测试支持」，不是「另一份产品代码碰巧通过」。

## 5. stderr 说明

修复后运行仍有一条 `Error occurred in handler for 'sacode:taskStart': Error: -32016 model-not-configured`（[diag3-ui-err.log](../../../target/tmp/candidate-rebuild-20261023/diag3-ui-err.log)）。它来自冒烟自身「新会话未配模型仍先落用户消息」的负向路径，界面按设计保留消息并从核心投影；该轮 0 FAIL，没有断言被它带过。

## 6. 边界

- 候选包 `app.asar` 内仍是旧版 `ui-smoke.cjs`，**未重新打包**。交付包直接运行 `--ui-smoke` 仍会复现 283/16；要让交付包也显示 301/0，需要重打 asar/候选，属新的构建动作，未在本轮执行。
- 本记录只证明「16 项失败不是产品 UI 缺陷」与「修复后的测试支持在同源产品上全绿」，不替代用户亲手 GUI 复验；真实 LongCat GUI 主闭环另见 [2026-10-23 LongCat 真实模型主闭环](../../evidence/2026-10-23-longcat-real-task-loop.md)。
- 未提交、推送、安装或发布。
