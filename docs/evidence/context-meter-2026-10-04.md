# 上下文用量圆环与分项详情首轮复刻（2026-10-04）

依据冻结提交 `639ed015397290b3745d163aafe02ffee4aa3f84` 的 `ui-conversation/src/client/skeleton/ContextMeter.tsx`、样式和 `context-occupancy.ts`。实现为 Vue 3/TypeScript `h()`，构建时折叠经典脚本，沿用唯一 Vue runtime；MIT 许可证保留在 `renderer/assets/dsh-ui-LICENSE.txt`。

## 实现与数据口径

- 当前上下文使用 `projectedTokens ?? pressureTokens`，只有容量与用量都存在才显示；百分比四舍五入且最大 100%，详情保留超过容量的原始 token 读数。
- 分项为系统提示词、工具、对话；分项估算值只决定总体占用条内部的比例，不替代提供方占用读数。无分项时显示总体单色条，零占用不绘制具有最小宽度的分段。
- 点击圆环显示非模态详情，原生 popover 顶层避免被祖先 transform 和滚动区裁剪；定位保持视口 12px 边距，监听尺寸与滚动变化。
- Escape 关闭并恢复入口焦点，外部点击关闭；模型切换暂缺容量时撤去旧圆环/弹层；卸载清理监听与顶层状态。
- 紧凑数量使用 K/M，详情以 `~` 标示估算。对于无效负数、非有限数或非正容量，额外拒绝展示，避免 NaN/Infinity 误导。
- 输入区已放置组件；当前未传入上下文压力数据，因此真实会话不编造百分比。

## 验证

- `context-meter.ts` 严格 TypeScript 检查通过；九个页面模块的 pack-pages 构建及经典脚本约束通过；渲染 JS 与冒烟脚本语法检查通过。
- 最新隔离 Electron 全页检查 `context-captures/reports.json`：226 组、633 条检查，失败 0，实际进程退出码 0。日志为 `D:\Temp\SaCode-ui-scroll-20261004\context.stdout.log`。
- 已查看 `context-captures/context-meter-fixture.png`。截图中的读数为控制式测试投影，不是真实模型用量，也不证明官方完整像素一致。

## 仓颉后端缺口

已检查 `core/src/meter.cj`、`core/src/sse.cj` 和 `apps/host/src/main.cj`。当前 TokenMeter 从会话日志累计已消耗 token，Host 暴露 usage/status 与 usage/set-budget；尚无 contextPressure/contextBreakdown 及当前路由 contextWindow 的投影接口。累计预算不是上下文容量，不能直接将现有 used/budget 比例接到该圆环。

后续需补齐提供方 prompt token 采样、消息变化后的上下文重估、路由容量、分项估算和会话投影，再通过有限 IPC 接入。真实模型用量验证、实际会话切换、最终安装包及全量交付仍未完成；本轮隔离 Host 使用此前构建，不含未提交模型设置原型。
