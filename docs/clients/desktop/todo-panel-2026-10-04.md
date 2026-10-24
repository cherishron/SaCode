# Todo 任务面板与共享状态标记首轮复刻（2026-10-04）

依据冻结提交 `639ed015397290b3745d163aafe02ffee4aa3f84` 的 `ui-conversation/src/client/skeleton/TodoPanel.tsx`、样式、中文 locale，以及 `ui-primitives/StateDot` 和 `packages/todo/tool-todo` 契约。实现为 Vue 3/TypeScript `h()`，构建期经典脚本，沿用唯一 Vue runtime；MIT 许可证保留于 `renderer/assets/dsh-ui-LICENSE.txt`。

## 已实现

- 空投影不显示；任务默认折叠；展开显示 completed/in_progress/pending 三态任务。
- 统计按已完成、进行中、待处理顺序，省略零计数，中文文案与冻结 locale 一致。支持多个进行中任务展示，是否允许并行由后端策略决定。
- 任务更新保留局部折叠状态；长内容单行省略，清单最多 180px 后滚动。面板只展示投影，没有手工改任务状态入口。
- 共享 StateDot 的完成/等待/警告/错误及步骤圆圈、进行中旋转标记；旋转与弧线动画固定到文档时间 0，使不同挂载时间的标记同步。CSS 保留减少动画偏好规则。
- 输入区的 Todo 槽位放在队列槽位之前，对应官方 order 0/20。暂无真实投影时传空清单，不显示示例任务。

## 验证

- todo-panel.ts、state-dot.ts 严格 TypeScript 检查通过；十个页面模块 pack-pages 构建与经典脚本约束通过；冒烟脚本语法检查通过。
- 最新隔离 Electron `todo-captures/reports.json`：236 组、660 条检查，无失败，实际进程退出码 0；日志为 `D:\Temp\SaCode-ui-scroll-20261004\todo.stdout.log`。
- 已查看 `todo-captures/todo-panel-fixture.png`，截图为控制式测试投影，不代表真实工具已经产出任务。动画检查在本次系统未开启减少动画偏好时验证两个动画的 startTime 0，减少动画规则尚未单独动态验收。

## 仓颉差距

当前 core/src/todo.cj 已有全量替换的三态 TodoStore，但尚未接入 Host 的 todos 投影与模型 todo_write 工具。对照官方发现：

1. 官方内容会 trim、拒绝空内容与重复项；本仓尚缺这些校验。
2. 官方按部署 allowParallelInProgress 限制进行中任务数量；本仓没有此策略。
3. 官方 todo/write 事件为结构化完整快照；本仓以内容/状态分隔编码，额外拒绝竖线与换行，需要补齐无损内容与事件契约。
4. 官方 todos 投影在 turn/start 后清空，在 turn/end 保留完成清单；本仓 list() 只返回最后一份 todo/write，缺少此轮次生命周期。

PlanModeController 是独立域，不能拿 active 标记代替 Todo 清单。真实工具调用、持久投影、有限 IPC 和实际会话切换仍待补齐与验收；本轮隔离 Host 使用此前构建，不包含未提交模型设置原型。全量前端、后端接入、真实模型测试、npm CLI 与最终安装即用交付尚未完成。
