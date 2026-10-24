# 插件配置共用表单与三项配置增量

## 上游依据

冻结 deepseek-ai/deepseek-harness @ 639ed015397290b3745d163aafe02ffee4aa3f84：ui-settings-agent-loop、ui-settings-shell、ui-settings-web-search 的 Card/controller/locales；ui-primitives/src/settings-form 的 SettingsForm.tsx、form-model.ts、fields.tsx 及 CSS。另读取 ui-settings-subagent 的委派限制/模型选择字段和 PluginManagerPage.tsx，确认子代理授权和独立安装向导是后续保留需求，不据当前内置清单页裁剪。源文件位于 D:\Temp\SaCode-official-639ed015。

## 已实现的前端契约

- plugin-configuration.ts 使用 TypeScript/Vue runtime h，由 pack-pages 编译 SaCodeConfiguration。Agent 循环编辑 maxParallelToolCalls，终端编辑 timeoutMs/maxOutputBytes，网络搜索编辑 baseURL/maxUses 和独立凭证。页面无官方账号/DeepSeek 品牌文案。
- 编辑只暂存；保存只提交有变化的字段，带首次编辑时的修订号；恢复默认计划为 unset，避免前端猜测默认值。字段数值格式依据官方 Number.isFinite，最终业务范围仍由共享核心校验。
- 设置不可写与凭证不可写分别控制。设置只读时仍允许独立可写凭证保存；环境凭证不可替换。字段快照从不携带明文密钥。未加载命名空间隐藏不可接收的控件。离开表单回收订阅并丢弃草稿。
- 保存按官方配置先、凭证后顺序。本方对成功部分结算：配置成功但凭证失败时保留密钥草稿，重试不重复配置写入；这是显式的重试处理增量，不声称与官方表单所有内部行为完全一致。
- 内置插件提供插件配置和插件列表两个贡献视图。当前默认配置三项为目标页面，不等于核心已服务其 namespace；没有 Adapter 时不伪造参数/默认值，显示未接入提示。子代理完整模型授权页面、schema 通用配置、独立插件管理安装向导尚未完成。

## 验证

- 三个 TypeScript 模块严格 tsc 5.9.3 检查通过，pack-pages 及静态依赖/CSP 守卫通过，全部共用唯一 Vue runtime。
- 初次整页 1 项失败：多个 Vue 根应用的 useId 可重复，页签 document.getElementById 聚焦到另一实例。为插件页和共用表单追加组件实例序号后复验通过，保留 configuration-frame.log。
- 最新整页 89 组/292 条检查通过，退出码 0，日志 D:\Temp\SaCode-ui-scroll-20261004\configuration-frame-retry.log，报告 configuration-captures-retry/reports.json。配置 fixture 覆盖只暂存、非有限值拒绝、不改写输入、定向修订写、默认 unset、冲突保留、只读、独立凭证、部分成功重试、未加载控件隐藏、卸载清理。配置和凭证适配器均为内存桩，不证明仓颉接入。
- 真 Electron UI 黄金路径 200 条通过，退出码 0，configuration-ui.log；现有核心工具、审批、会话等链路保持通过。
- configuration-captures-final/plugin-config-product.png 已查看，产品明确显示配置未接入。未把该截图当作官方原生视觉比对完成证据。

本轮未连接新仓颉配置域、未调用外部大模型、未生成最终安装包。完整前端、所有仓颉业务接入、StepFun 真模型、npm CLI 和安装即用交付仍未完成。
