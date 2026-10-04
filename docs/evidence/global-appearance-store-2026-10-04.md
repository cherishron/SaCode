# 全局外观存储基础（2026-10-04）

## 上游边界

直读冻结版本 [theme-settings.ts](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-theme/src/theme-settings.ts)：主题和内容字号属于 Host 用户设置文档；字号为整数 10–22px，默认 14px。不是按会话保存。

[FontSizeRow.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-theme/src/client/FontSizeRow.tsx) 的显示值来自已持久设置，按钮每次增减 1px；[对应 CSS](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-theme/src/client/FontSizeRow.module.css) 定义标题/说明与右侧 36px 控件同行居中。当前 SaCode 会话主题不能作为该全局配置域的替代。

## 本批实现

新增仓颉 `GlobalAppearanceSettings` 与只读快照。配置位于调用方指定的固定用户配置根目录下 `user-settings.log`，独立于会话日志；当前目录切换和会话选择不作为其根目录来源。数据使用本仓日志编码存储，尚不声明与上游用户设置文档格式兼容。

默认主题 system、字号 14；校验三种主题和 10–22 整数字号。每次读取重新回放磁盘，不建立前端或内存真源。保存先取得独立配置租约，重读另一入口可能已修改的值，仅更新目标字段，然后将包含完整主题/字号的临时日志落盘并 rename 发布。成功后释放租约；无变化不创建配置文件。临时文件位于同一配置目录，发布不直接截断旧配置。

损坏、物理截断、未知配置事件和非法字段显式拒绝，不回默认值覆盖历史内容；被其他写者占用时不改文件。事件为 `settings/theme`、`settings/font-size`，不进入模型历史或会话索引。

## 验收

干净 `0db9ebe` 导出源码，仅加入本批两个新 core 文件，在 `dualtest/global-appearance/source/core` 使用仓颉 1.1.3 执行完整单测：**143/143，失败/错误 0，退出码 0**。最终日志 `dualtest/global-appearance/core-final.log`。

新增五项测试覆盖：默认与非法边界不写文件；多实例重读、边界值与更新一字段时保留另一字段；独立写租约拒绝竞争写入；损坏/截断时保留原始内容且释放租约；真实 SessionCatalog 新建和切换后全局设置保持、会话日志及模型投影不受污染。

## 待接入

这是全局配置核心基础，尚未接入 Host 固定协议、Electron/preload、字号控件或 CSS 字号轴，界面依然使用原有会话主题。还需确定两入口统一的用户配置根目录、处理已有会话主题与全局主题的迁移/优先级，并完成真实跨进程写入及发布失败故障验收。

下一步绑定已持久化的字号到消息、流式正文和输入区的同一轴，字号改变时重新测量草稿高度，并验证默认/最大/最小字号下的亮暗主题和窄窗口。不得把核心单测通过声明为字号设置页面、全局设置域或完整桌面目标完成。本批不涉及并行 SSE/Next SDK 改动，未重打桌面产物。

## 用户根目录与 Host 协议增量

核心新增 `GlobalAppearanceSettings.forUser()`：显式 `SACODE_USER_SETTINGS_DIR` 只接受绝对路径；否则读取非空 USERPROFILE，再回退 HOME，使用 `<用户主目录>/.sacode/user`。主目录缺失显式报错，不能回退项目或会话 cwd。两入口可调用同一解析逻辑；CLI 设置命令尚未接入。

Host 登记三个固定方法：`global/appearance/get`、`global/appearance/set-theme`、`global/appearance/set-font-size`。返回主题、数值字号、`scope:user`，写成功才返回 `saved:true`，无变化返回 `changed:false`。参数从解析后的 JSON params 读取，非法数值类型、小数和越界拒绝；不接受由参数提供的根目录。全局配置独立于会话故障、租约及执行状态，协议分派先处理全局方法，避免损坏会话阻止用户读取配置。

从暂存树导出 `dualtest/global-appearance-host/source`，只纳入本批 core、Host 和新测试，不含并行 provider/SSE/Next SDK 改动。使用仓颉 1.1.3 构建自包含 Host 后，最终核心 **143/143**、桌面 Node **90/90**，退出码均 0，日志 `core-verified.log`、`desktop-verified.log` 均位于上述 dualtest 根目录。

六项新 Host 测试覆盖两个真实进程共享用户设置及重启/会话切换；严格参数及重复写无变化；会话写者租约与损坏会话不阻塞全局设置；活进程配置租约及损坏配置拒绝写入并保留原始内容；相对根目录拒绝；默认 HOME 根目录和缺失主目录时拒绝回退 cwd。测试均显式隔离配置目录，不改当前用户的真实设置。

本增量未改 Electron IPC/preload，也未绑定渲染层。当前会话主题 API 和现有界面继续保留；全局与会话主题的迁移/优先级仍待处理。下一批需接入有限命名 IPC、全局字号控件与共享 CSS 轴，并处理字体变化后的草稿测量。安装包和 UI 端到端验收尚未覆盖这些新协议。

## Electron 字号控件与共享内容轴增量

Electron/preload 新增两个固定命名入口：读取全局外观、保存整数字号。保存只接受 10–22 的整数，渲染层只在核心确认保存后更新读数及 CSS；写者租约占用时显示中文错误并保留原值。UI 自测使用独立用户配置目录，不修改真实用户设置。全局主题保存尚未暴露到界面，现有会话主题继续保留。

中文字号行使用上游的 72×36px、12px 圆角、8px 控件间距及悬停/焦点箭头。消息、流式正文与输入区共享字号和行高变量；Markdown 标题随内容字号增量变化，代码和操作控件保持原字号。草稿测量缓存加入字号及行高，字号变化后重新计算高度。

从隔离源码 `dualtest/font-ui/source` 验证，Host/DLL 沿用本页上一增量已验的核心/Host（本批未修改它们），不纳入工作区未提交的 provider/SSE/Next SDK 改动。桌面 Node **91/91**，真实 Electron UI **180 项**，布局 **160 组/1184 项**，失败均为 0，退出码均为 0。日志分别为 `dualtest/font-ui/desktop-tests.log`、`ui-smoke-final.log`、`layout-smoke-final.log`；结构布局报告位于该源码的 `apps/desktop/dist/layout/layout-report.json`。

UI 覆盖字号保存、重载恢复、上下限、非法小数及租约失败不回显；布局覆盖四种窗口尺寸、亮暗主题和 10/22/14 三种字号，检查正文与输入区轴、草稿高度重测、控件居中、固定尺寸、键盘焦点箭头及无页面溢出。实际查看 860×600 暗色 22px 截图，中文内容和 SaCode 图标保留，设置页在窗口内滚动。本增量未重跑核心单测、未重打安装包，也不证明全局主题迁移或完整 DSH 页面目标已完成。

## 全局主题作用域与选择卡增量

再次直读冻结上游 [AppearanceRow.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-theme/src/client/AppearanceRow.tsx) 和 [样式](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-theme/src/client/AppearanceRow.module.css)。主题选择由持久偏好驱动，顺序为亮色、深色、跟随系统；采用图标在上、文字在下的选择卡。实现对应 8px 行间距、4px 图标/文字间距、20/32px 内边距、180px flex 基础宽度和 20px 圆角，窄窗口换行。三种装饰图标来自冻结 [ui-primitives/icons/index.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-primitives/src/icons/index.tsx)，沿用现有 MIT 授权；SaCode 品牌图标未改。

新增有限命名的全局主题保存 IPC，严格校验 system/light/dark，成功回执后才应用 Electron nativeTheme。界面启动、会话切换、全局读取及外观保存均以用户配置快照驱动窗口。字号保存也应用返回快照中的主题，避免另一入口刚修改主题后界面选中态与窗口颜色不同。主题/字号按钮在任一外观保存期间共同禁用。

优先级明确为用户配置（缺省 system）；旧会话主题及读写协议保留，但不应用到桌面窗口。不会从当前会话自动迁移或覆盖用户配置，不删除会话历史；损坏的用户配置显式报错，不以旧会话主题代替。此为本仓旧会话设置到用户级界面的转换策略，不声明兼容上游用户设置文件格式或已提供跨进程实时订阅。

最终代码与 `dualtest/theme-ui/source` 九个界面源码/资产逐文件哈希一致，未纳入并行 provider/SSE/Next SDK 改动；核心/Host 未改，沿用上一已验自包含 bundle。本批桌面 Node **91/91**、真实 Electron UI **186 项**、布局 **160 组/1240 项**，失败 0、退出码 0。最终日志为 `dualtest/theme-ui/desktop-tests-final.log`、`ui-smoke-final.log`、`layout-smoke-final.log`，结构布局报告位于该隔离源码 `apps/desktop/dist/layout/layout-report.json`。早一轮日志保留，最终结论只用 final 日志。

UI 新增验证全局主题保存失败不切换颜色/选中态、非法主题拒绝、另一入口主题经字号保存同步、主题保存保留字号，以及新建/切换会话时全局深色保持、旧会话亮色记录仍可读取。布局用实际设置按钮保存两种主题，增加选择卡顺序、唯一选中态、纵向排列、同行对齐、内边距/圆角、图标尺寸与文字中心轴、行间距检查；实际打开亮暗两张 860×600 通用设置截图，确认换行、装饰图标和中文文案。未重打安装包，未重复核心单测，完整页面、全局实时订阅及打包态验收仍未完成。
