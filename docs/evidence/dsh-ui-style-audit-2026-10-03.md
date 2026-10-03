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

## 输入卡片与正文排版增量

本批读取冻结快照的 [InputBar.module.css](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-conversation/src/client/skeleton/InputBar.module.css)、[MessageItem.module.css](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-chat/src/client/chat/MessageItem.module.css) 和 `ChatView.module.css`。输入正文与操作条在同一卡片内纵向排列；默认正文 14px，输入及助手正文行高 24px，用户正文行高 22px；用户气泡按宽度轴的 70.2% 限制并右对齐。

原 SaCode 的文本框和发送按钮并列、正文使用界面辅助字号，属于上游结构差距。本批将发送操作移入输入卡片底部，统一正文轴并同步流式正文；更新以前自定的“文本域与发送按钮同底边”断言为卡片内纵向结构验收，没有用旧规范阻止上游结构对齐。仍保留原发送、快捷键、草稿与核心真源机制。

本批未实现上游完整 composer 的模型/预设/附件选择、编辑器引用、自动增长和共享拖动宽度轴；不能把输入卡片结构调整宣称为完整 composer 完成。完整 Markdown、字体大小设置与上下文节点也仍待补齐。

## 自动增长与紧凑停靠增量

继续核对 InputBar 的 `.grow`、`.scroll` 和 `.input`：上游停靠编辑区起步为 36px，自然随正文增长，滚动容器承担 14 行上限。此前 SaCode 的 80px 最小高度及手动调整是自定值，现改为 36px 单行起步、草稿派生高度和内部滚动；受小窗口限制时进一步收紧上限，保留对话空间。

以 Vue runtime 指令和 ResizeObserver 适配原生 textarea，正文或宽度改变才重新测量，保存当前内部滚动位置；卸载时撤销观察和待执行帧。不引入第二份 Vue、模板编译器或业务状态。自动增长项已补齐，模型/预设/附件、引用编辑器和共享宽度轴仍待实现，不能据此声明完整 composer 通过。

## 助手 Markdown 块流增量（2026-10-04）

直读冻结版本 [AssistantMarkdown.module.css](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-chat/src/client/chat/AssistantMarkdown.module.css)：正文为纵向 flex，14px/24px，块 gap 16px。SaCode 采用相同块流与间距，在当前 Vue runtime + TinyRobot 消息面接入构建期折叠的 markdown-it，将 token 转为 h() 节点。标题、嵌套列表、引用、代码及表格现在有对应排版；用户与工具消息不解释为 Markdown，折叠摘要保留原文。

代码高亮、远程图片/附件、流式 Markdown、上游宽表格突破消息宽度轴、上下文节点、操作页脚和字号偏好仍未实现。基础表格仅在正文范围滚动，不宣称完成上游宽表格方案。布局夹具只验证正文渲染器，不冒充真实模型回复或日志事件。

## 流式正文与投影正文统一（2026-10-04）

后续增量已补齐基础流式 Markdown：`SaCodeMarkdown.Body` 是流式与投影助手消息共用的 Vue 组件；`Stream` 只接收已有 turn/poll 派生文本和运行状态，不保存业务状态。取消保留半截正文，正常收束撤去回显的原有规则保持不变。

原流式框左侧实体边框造成正文轴偏移，现改用独立中文角色与状态标签，正文采用与 TinyRobot 消息盒一致的内边距。`.msg-node` 中正文占整行，折叠按钮独立换行，避免短正文和长代码因 flex 自动尺寸走不同宽度轴。基础流式已补齐；代码高亮、附件、宽表格、上下文节点及其完整交互继续待补齐。
