# 独立插件安装管理页面首轮实现

## 官方依据与范围

上游冻结提交为 deepseek-ai/deepseek-harness 的 639ed015397290b3745d163aafe02ffee4aa3f84。核对 packages/client/ui-plugin-manager/src/client 的 PluginManagerPage.tsx、manager-store.ts、locales.ts、presentation.ts 与 PluginManagerPage.module.css；参考文件位于 D:\Temp\SaCode-official-639ed015。

新增 apps/desktop/renderer/pages/plugin-manager.ts，使用构建期 TypeScript、Vue runtime h()，由 pack-pages 生成经典脚本。侧栏「工具与扩展」进入独立中心页面，不再借用设置里的内置插件清单。保留官方配置与随产品提供的可选包入口，用户安装的包单独分组；包详情包括组件数量、运行状态、只读原因、十个以上组件时的筛选与按 entryId 启停。卸载先确认，未确认前不移除。

安装状态覆盖 idle、checking、starting、running、cancelling、applying、unconfirmed、unknown、done、failed。包括输入法确认防误提交、空输入阻断、安装源选择及自定义 URL 校验、安装引导、任务详情与长日志首尾各六行折叠、脚本显式授权、取消待确认、收尾阶段禁止取消、丢失回复时核对状态、关闭后后台任务入口与完成后的启用动作。所有安装动作均通过类型化适配器；不在渲染层启动安装命令。

产品文案使用 SaCode，不增加官方账号、登录或额度入口。无适配器时显示尚未接入且禁用安装按钮，不能将静态配置入口认作真实已安装能力。

## 验证

隔离 Electron 环境 D:\Temp\SaCode-ui-scroll-20261004 使用当前前端源码与此前已构建的 Host；管理交互适配器是测试内存桩。

- pack-pages 五模块编译及运行时脚本约束检查通过；新增模块 TypeScript 严格检查通过。
- 首两次整页冒烟因测试在 Vue DOM 更新前点击按钮而退出码 1；加入 Vue.nextTick 后重新验收。最终 manager-frame-reviewed.log 退出码 0，manager-captures-reviewed/reports.json 共 120 组、371 条检查，失败 0。
- manager-ui.log 退出码 0，200 条 UI OK，0 条 UI FAIL，UI_SMOKE PASS。该回归在最终文案和官方/安装包分组的小幅修正前执行；这些修正之后的整页验收已通过。
- 已查看最终产品入口截图 plugin-manager-product.png 及收尾阶段安装截图 plugin-manager-install-fixture.png，后者为测试数据，不是实际安装证据。
- app.js、新增冒烟脚本语法检查及 git diff --check 通过。

## 未完成与后续

本批是独立管理页面首轮实现，未证明完整上游视觉一致。尚需补全组件配置贡献槽位、官方图片资产、安装源浮层的完整键盘与定位行为、结构化兼容性/网络失败提示及镜像恢复交互。完整前端验收仍在进行。

仓颉插件管理 profile、包检查/安装任务、脚本审批、取消与结果核对服务尚未接入本页；当前类型化适配器不是这些服务的替代实现。未执行真实 npm/Git/本地目录安装或真实外部模型测试，未重新生成最终安装包。CLI、仓颉后端全部功能接入与安装即用双入口产品交付范围保持不变。

## 第二轮：配置贡献与页面生命期

对照官方 ItemDetail、RowDetail、PackageDetail 的配置、动作、徽标与附加说明槽位，新增本地 Vue Contribution 契约。贡献按 item / bundle / row 三种主体匹配；组件匹配同时包含包名和 rowId，避免不同插件的同名组件串用配置。每个槽位按 order、id 稳定排序。官方功能、插件包、单个组件可各自挂载独立配置视图。配置由本地组件注册，不接收后端可执行脚本；组件自己的有限适配器仍需连接仓颉。

组件配置页显示名称、技术标识与模块名，并返回所属包；返回保留包内筛选词，但卸载离开的表单，放弃其未提交草稿。动态撤销贡献会卸载已打开表单。包停用后隐藏其组件启停开关，保留包配置，符合上游 PackageDetail 的 toggle 条件。

验证环境与前述相同。pack-pages 五模块构建、plugin-manager.ts TypeScript 严格检查、新增冒烟语法检查及 git diff --check 通过。manager-config-frame-final.log 退出码 0；manager-config-captures-final/reports.json 共 126 组、390 条检查，失败 0。本批新增包配置唯一挂载、跨包同名组件隔离、贡献排序、返回释放草稿、动态撤销、官方配置选择、包停用条件等交互检查。

该结果证明前端配置贡献契约和生命周期，不证明完整 Cordis 插件兼容、共享配置持久化或真实仓颉插件启停。安装源浮层、完整结构化错误恢复与视觉资产仍需继续，最终双入口产品尚未完成。

## 第三轮：结构化安装失败与恢复

核对官方 failureText、githubRecoveryRegistry、InstallDialog 及中文文案，扩展前端安装快照：记录兼容性拒绝、具体失败类别、失败归因、真实安装源尝试、结果/取消/接收的不确定状态和已授权脚本。兼容性拒绝优先于通用安装故障，提示插件版本、SaCode 版本和兼容要求。分别显示磁盘不足、权限不足、安装包校验失败、缺少安装器、没有匹配版本等原因；待批准脚本为空时提供手动配置说明，不编造脚本列表。

多安装源网络失败列出实际尝试过的源，可返回编辑并展开安装源选项。Git 直链归因单独提示；仅在后端明确报告 GitHub 网络/超时故障且提供国内镜像选项时，展示恢复入口，用户显式选择后清空地址并提示填写真实 npm 包名，不声称换 npm 源能下载原 Git 地址。取消未确认时保留取消/核对入口，不宣称已停止。安装完成但无新增依赖时明确说明；脚本审批展示持久授权的后果。刷新失败保留已接受的清单及后台任务入口，并提示保留上次状态，成功重试后清除提示。

pack-pages 五模块构建与约束检查、plugin-manager.ts TypeScript 严格检查、冒烟脚本语法检查及 git diff --check 通过。隔离环境 manager-recovery-frame-final.log 退出码 0；manager-recovery-captures-final/reports.json 共 139 组、422 条检查，失败 0。新增错误分类、兼容优先级、多源故障、更换源、GitHub 显式恢复、取消不确定、无新增依赖和刷新恢复的真实 Chromium 交互检查。适配器仍是内存桩，未执行真实网络安装。

本批补齐所列错误视图和恢复动作契约，不宣称完整后端安装兼容或完整前端验收完成。安装源浮层定位与键盘细节、完整视觉资产仍待继续；真实仓颉服务、外部模型验收、npm CLI 和最终安装包仍在后续完整交付范围。

## 第四轮：安装源浮层

对照官方 InstallDialog 的安装源浮层、Tab 路径、Escape 与外部点击行为，抽出 registry-picker.ts。使用 Chromium 原生 manual popover 顶层，在原生 dialog 内保持可交互，不把节点移到模态框外的 inert 区域。浮层按按钮末端对齐，以 12px 窗口边距裁限；空间不足时向上展开，限制高度并提供内部滚动。ResizeObserver、窗口 resize 和滚动更新位置，卸载时释放观察器、监听器和动画帧。浮层不参与表单布局，不改变安装窗口高度。

提供默认源、后端提供的源与自定义源单选；按钮显示当前所选源。自定义 URL 使用 URL 解析验证协议和主机，非法地址阻断安装。Tab 从已选单选项进入地址输入；Shift+Tab 返回单选项，越过两者时关闭并回到按钮。Escape 捕获阻断原生模态框的关闭，点击外部只收起浮层。安装检查阶段隐藏浮层并禁用选择。

pack-pages 五模块构建与约束检查、plugin-manager.ts 和 registry-picker.ts 的 TypeScript 严格检查、冒烟语法及 git diff --check 通过。首次新增窗口缩小用例请求 640px，低于产品 BrowserWindow 的 minWidth=860，等待失败；未修改产品最小宽度，改在允许的 860×620 范围验收。manager-picker-frame-final.log 退出码 0；manager-picker-captures-final/reports.json 共 145 组、436 条检查，失败 0。包含真实 Electron 键盘事件驱动的 Tab、Shift+Tab 和 Escape 检查。已查看 plugin-manager-registry-small.png，浮层在小窗口可见且可滚动。

这些检查仍使用内存安装适配器，不证明仓颉配置及真实安装完成。完整官方视觉资产和其他前端页面、后端全部能力接入、真实模型测试以及 npm CLI/最终安装包继续纳入完整验收范围。
