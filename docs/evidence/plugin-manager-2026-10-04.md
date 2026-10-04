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
