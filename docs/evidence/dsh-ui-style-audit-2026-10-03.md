# 冻结 DSH UI 样式核对

日期：2026-10-03。仅核对样式文档，不代表完整桌面源码、页面或截图已经验收。快照 `639ed015397290b3745d163aafe02ffee4aa3f84` 与现有 S0 一致。

GitHub API 递归树和 contents 通道本次返回成功；web 浏览工具无法读取同一 API URL，未据此推断文件不存在。原始取证暂存 `dualtest/upstream-ui/tree.json`、`web-styling.zh.md`、`ui-radius.zh.md`，不作为业务源码提交。

## 一手来源与当前差距

- [圆角规范](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/docs/ui-radius.zh.md)：按用途分档。紧凑控件 R8、标准控件 R12、分组内容 R16、独立卡片 R20、主面板和对话框 R28。当前 SaCode 共享圆角为 6/10/16px，按钮、卡片、弹窗的用途映射尚未对齐。后续需分别调整，不能简单替换一个变量覆盖所有表面。
- [样式职责](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/docs/web-styling.zh.md)：主题集中拥有全局令牌，功能组件复用语义值；支持的引擎使用平滑曲线，圆形保留圆弧；高层表面材质、焦点和减少动态效果有共同约束。当前 SaCode 的主题集中管理已具备，表面投影和曲线尚未逐项实现及验证。

上游使用 React 与自有控件。用户明确要求保留现有仓颉/Electron/Vue runtime/TinyVue/TinyRobot 技术栈和 SaCode 品牌，因此移植布局及视觉规则，不替换为上游框架，也不复制上游图标。

## 下一步验证范围

读取 `ui-theme/src/styles/base.css`、`corner-shape.css` 及相关组件 CSS，核对控件、导航、卡片、输入区和对话框的具体映射；为亮暗主题、标准/禁用/悬停/焦点状态补实际计算样式和截图验收。完整页面布局仍须读取 ui-layout、ui-chat、ui-schedule 等模块，不能从这两份规范推断全部页面已经对齐。

## 圆角映射增量

本次又读取冻结快照的 [base.css](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-theme/src/styles/base.css) 和 [corner-shape.css](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-theme/src/styles/corner-shape.css)，确认六档数值及引擎回退规则。已将 SaCode 标准按钮/输入/导航映射 R12，紧凑折叠控件 R8，工具和审批分组、文件预览 R16，独立内容卡片与气泡 R20，输入主容器/弹窗 R28。保留 SaCode 标志原始图片。

曲线按支持条件作用于已映射表面；组件库内部未核对的圆形图形不被全局覆盖，待审批状态点声明 round。本机 Electron 的 `CSS.supports('corner-shape','superellipse(1.5)')` 返回 false；本轮只能证明圆弧回退、各档实际圆角和状态几何，尚不能证明平滑曲线的渲染效果。圆角映射关闭了前述对应差距，但表面材质、完整主题令牌、完整页面基线仍待核对。

## 表面层级增量

继续读取冻结快照的 [gradient-shadow-text.css](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-theme/src/styles/gradient-shadow-text.css)、[elevation 样式契约](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-theme/tests/elevation-styles.client.spec.ts) 和 `design-platform.css`。确认描边色应继承，派生投影需逐元素计算，避免根级已解析变量导致表面颜色重绑失效。

SaCode 输入框采用 soft、浮动预览采用 panel、模态弹窗采用 prominent 参数，浮起表面使用无实体边框的共享投影；中性平面描边改为发丝线，状态色边框保持实体 1px。参数沿用上游并保留完整 MIT 授权文件 `apps/desktop/renderer/assets/dsh-ui-LICENSE.txt`，通过现有 renderer 打包规则进入产物。主题颜色仍由 SaCode 集中令牌提供，不表示全部上游色板已经迁移。完整菜单材质和未实现页面继续待核。
