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
