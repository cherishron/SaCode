# 共享提示浮层布局增量（2026-10-04）

## 冻结依据与实现

上游基线为 `639ed015397290b3745d163aafe02ffee4aa3f84`，对应 [Tooltip.module.css](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-primitives/src/Tooltip.module.css)、[Tooltip.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-primitives/src/Tooltip.tsx) 与 [ShortcutKeys.module.css](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-primitives/src/ShortcutKeys.module.css)。

`renderer/tooltip.js` 使用 Vue runtime 指令保留原锚点，不增加布局包装层。代码卡、导航、右侧页签与字号箭头共用中文提示；移除这些锚点的原生 title，避免同时出现两种提示。字号 13/20px、内边距 3/7px、圆角 8px，快捷键 11/14px、键帽高度 16px。浅色背景 rgb(44,44,46)，暗色 rgb(67,69,74)，文字白色，淡入 150ms，减少动态效果配置禁用动画。代码卡动作圆角同步到上游 8px。

提示支持悬停、键盘焦点、Escape/Tab 关闭、延迟取消、点击固定、外部点击关闭、禁用与卸载清理。上下方距锚点 8px，右侧 10px；视口保留 12px 安全边距，必要时上下翻转，宽度最多半个视口，长词可换行；滚动与窗口变化重新定位。嵌套提示优先展示内层，离开内层恢复外层。已有 aria-describedby 保留，只增删自身标识。

模态 dialog 外的节点属于 inert 范围，因此采用最近已打开 dialog 作为 DOM 归属，再用原生 Popover 进入顶层，避免提示被裁切或落在模态层后。普通页面归属 body。此项是现有 Electron/Vue 技术栈的适配，不引入 React、运行时模块、模板编译器或新 IPC。品牌与原 SaCode 图标保持现状。

## 验收范围与红灯

隔离源码目录 `dualtest/tooltip/source` 来自已提交基线 `abda896ccf963aa4dcd45327267fb84e358b8e18` 加本批渲染层及测试改动。独立 node_modules 与重新生成 vendor；Host/DLL 复用此前代码卡验收版本，不能用本次结果证明最新核心、真实模型或新安装包通过。

- Node 全量 100/100，失败 0，退出码 0，日志 `dualtest/tooltip/desktop-tests-final.log`。
- 首轮 GUI 发现字号按钮绕过通用节点助手，随后显式接入指令。
- 后续 GUI 发现 body portal 在模态 dialog 外无法命中；修复 DOM 归属后，真实 hit-test 与焦点保留通过。
- `layout-smoke-portal.log`、`layout-smoke-paint.log` 为失败记录，不能作为全绿证据。暗色 860×600 主按钮最终色值比较失败；180ms 后提示淡入尚未绘制完成也导致 modalOpaque 失败。新版验收先等待实际动画帧启动，再等待动画 finished 并提交后续绘制帧，原断言不删不弱化。
- 最终全量布局 **184 组 / 2008 项 / 失败 0 / 退出码 0**，日志 `dualtest/tooltip/layout-smoke-final.log`，结构报告 `dualtest/tooltip/source/apps/desktop/dist/layout/layout-report.json`。其中 Tooltip 为 8 组，每组 34 项；模态提示计算 opacity 全部为 1，取样时动画集合为空。
- 最终 UI 行为冒烟 **191 项通过 / 失败 0 / 退出码 0**，日志 `dualtest/tooltip/ui-smoke-final.log`。两套 GUI 顺序执行，不并行争抢焦点。
- 实际打开浅色最小窗口模态提示、暗色最小窗口代码提示与浅色边缘长提示截图，核对提示背景、文字、位置、长词换行和视口边距。最终绘制同步消除了先前淡入取样红灯；暗色按钮配色比较同时通过，未改生产主按钮颜色，也未弱化比较断言。

真实 Electron 覆盖浅/暗两主题及四个窗口尺寸，检查提示字体、间距、色值、无布局位移、模态层级、键盘焦点、边缘避让、长词、窗口缩放、延迟、固定、禁用、卸载与嵌套行为。截图为 `dist/layout/sacode-tooltip-{code,modal,edge}-<theme>-<size>.png`。

## 仍未完成

全部页面调用点、富内容悬浮卡、完整 composer/附件/上下文/模型设置、全页面布局及新安装包仍需继续验收。原生系统剪贴板端到端与可选行号不由本次 Tooltip 测试证明。目标仍为完整桌面端对齐，不能由本次共享控件增量宣称完成。
