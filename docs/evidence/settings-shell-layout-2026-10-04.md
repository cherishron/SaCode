# 设置双列布局对齐（2026-10-04）

## 上游依据与范围

冻结上游 `639ed015397290b3745d163aafe02ffee4aa3f84` 的 [SettingsRoot.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-settings-general/src/client/SettingsRoot.tsx) 和 [SettingsRoot.module.css](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-settings-general/src/client/SettingsRoot.module.css) 定义固定双列设置面板，分类导航与内容分别滚动，切页不改变面板尺寸。本批替换 SaCode 原来的横向标签栏与内容决定高度的设置弹窗，不将外壳对齐声明为模型配置、插件设置或完整设置能力已完成。

## 实现

- 原生 `SaCodeDialog` 增加可选自定义框架槽位；模态、Escape、关闭回调和触发元素焦点恢复仍由同一组件管理，其他对话框继续使用原布局。
- 设置面板宽 800px，宽度上限为视口减 48px；高度为 800px 与视口减 48px 中较小值，R28，遮罩透明度 24%。不随分类内容长度变化。
- 左导航宽 188px，内边距 22/12/0px，标题 16/24px、字重 500，标题/分类间距 18px；分类纵向间距 4px、行高 40px、R12，内边距 9/16/9/12px，16px 图标与标签间距 8px。分类列独立滚动；焦点环内收，避免被滚动边界裁剪。
- 右侧固定操作栏高 54px，关闭为 28px 按钮、14px 图标；选项区内边距 0/24/24px，独立滚动，左导航和操作栏不跟随正文滚动。
- 打开后焦点进入当前分类；上下方向键、Home/End 同步选中页和焦点，沿用已有左右键兼容。页面仍为通用、模型、工具与扩展三项，模型及扩展配置未完成时明确说明，未虚构账号或其他页面。
- 分类及关闭装饰图标取冻结上游 [ui-primitives/icons/index.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-primitives/src/icons/index.tsx)，对应 Settings/Data/Personalization/Close，保留已有 MIT 授权。使用当前 Vue runtime/h() 与原有 Electron 原生对话框，不引入 React；SaCode 名称与原品牌图标保留。

## 验证边界

隔离源码位于 `dualtest/settings-shell/source`，基于 `24e5afc` 导出后仅加入本批桌面文件，未纳入工作区未提交的 provider/SSE/Next SDK 改动。核心及 Host 本批未改，使用先前已验的自包含 Host/DLL；因此本批结果只证明该桌面增量，不证明当前整仓、最新核心集成或安装包已验。

布局压力样本只验证滚动与几何：长说明和导航长列表属于自测 DOM fixture，执行后移除，不持久化、不宣称真实模块数量或已提供导航功能。实际工具列表、预算、全局外观、会话及工作区仍来自核心。

初两轮 UI 的向下键未进入下一分类，事实记录为 focus/selected 均仍在 models；原因是测试向 Electron 注入了 `ArrowDown` 浏览器键名，改为 Electron 的 `Down`/`Up` 后真实键盘路径通过，未改渲染层方向键逻辑，也未移除切页断言。第一轮截图另发现滚动列裁剪分类的外置焦点环，最终 CSS 将其内收，须以最终源码复验结果为准。

完整模型设置、第三方凭证、插件配置、更多设置分类、跨进程实时设置订阅、完整上游页面基线和新安装包继续待完成；不据三项分类的外壳验收缩小目标范围。

## 最终结果

Node **91/91**，真实 Electron UI **191 项**，布局 **160 组/1432 项**，失败均为 0、退出码均为 0。Node 日志为 `dualtest/settings-shell/desktop-tests.log`；最终界面与布局日志为 `ui-smoke-verified.log`、`layout-smoke-verified.log`，结构报告为隔离源码内 `apps/desktop/dist/layout/layout-report.json`。本批八个源码/图标与隔离已验版本逐文件哈希一致，早期失败日志保留，不以早期截图代替最终结果。

布局新增验证固定面板尺寸、188px 导航宽度、两列接缝、纵向分类及间距、54px 操作栏/28px 关闭按钮、选项内边距、图标/标签中心轴，以及内容和导航独立滚动。仍覆盖四种窗口尺寸、亮暗主题与三种内容字号；其他模态、浮动预览和拆分窗格继续通过。UI 新增打开焦点、切页不变尺寸、上下键及 Home/End 的真实按键验证。

实际打开最终亮暗两张 860×600 通用设置截图，确认导航分类、主题选择卡、内容边界、滚动区域及完整焦点环；原 SaCode 图标可见，设置标题为 SaCode 设置。最新核心新增模块没有纳入该旧 Host bundle 的集成测试，安装包也未重新构建，不将本批结果扩称整仓或完整桌面验收。
