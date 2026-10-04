# 模型管理页面复刻增量与边界

## 上游证据

冻结 deepseek-ai/deepseek-harness @ 639ed015397290b3745d163aafe02ffee4aa3f84。2026-10-04 重取完整 Git tree（truncated=false）及 ui-settings-models 的 ModelsSection.tsx、CustomProviderCard.tsx、ProviderEditor.tsx、ModelListEditor.tsx、ModelRow.tsx、EditorFooter.tsx、locales.ts、ModelsSection.module.css。原文存于 D:\Temp\SaCode-official-639ed015。本次依据源码和 SaCode Chromium 截图；不是官方桌面视觉比对通过。

## 实现

renderer/pages/models-page.ts 使用 TypeScript/Vue 3 runtime h()，scripts/pack-pages.mjs 通过 esbuild 编译为 renderer/vendor/models-page.iife.js。Vue 别名接入现有唯一 globalThis.Vue，产物通过静态依赖及运行时求值守卫，不引入运行时模块加载器或模板编译器。TypeScript 已编译，尚未单独执行 tsc 严格类型检查。TinyVue/TinyRobot 原有构建链保留；Next SDK 产品功能仍待接入，不据本页面宣称指定技术栈整体完成。

页面具有多提供商列表、密钥状态点、编辑、删除确认、第三方目录/自定义 API 添加、模式切换保留草稿、三种协议草稿选择、密码框、模型列表、容量/图片选项、远端目录搜索与选择合并。业务操作通过显式 Adapter 注入，不在渲染层持久化设置。产品当前未注入 Adapter，明确提示后端未接入；不能把测试适配器的保存当作仓颉持久化完成。

## 验证

- pack-pages 构建及 bundle guard 通过，无动态/外部导入、无运行时求值、复用唯一 Vue。
- bundle guard 单测 1/1 通过。
- 真实 Electron UI 冒烟 200 条通过，退出码 0，日志 D:\Temp\SaCode-ui-scroll-20261004\models-ui.log。
- 整页+新模型页最终 51 组/188 条通过，退出码 0，日志 models-frame-retry.log，报告 models-captures-retry/reports.json。
- 模型页 fixture 验证草稿保留、缺模型拒绝、远端搜索/合并、保存失败草稿保留、保存后重载、删除前确认及删除后刷新；fixture 为内存适配器，只证明组件交互。实际产品入口亦验证不存在 DeepSeek 文案、密钥框掩码、后端未接入提示。截图 models-captures-retry/models-custom-form.png 已查看。
- 初次 fixture 同帧点击未等待 Vue 更新而报错，修为 nextTick 后复验；其后断言错误地读取隐藏模式输入，修为当前可见模式后复验。旧滚动 fixture 两个固定 120ms 等待曾失败，改为有上限的真实锚点/恢复位置等待，最终通过，保留失败日志 models-frame-final.log。未修改滚动产品实现。

## 未完成

多提供商仓颉配置/凭证引用及平台凭证存储、模型目录查询、协议请求适配尚未接入。现有 core/model_settings.cj 原型仅单路配置，不能满足整个页面契约。提供商 schema、只读/版本冲突、默认模型恢复、插件 footer 等官方交互仍需补齐。完整页面复刻、后端接入、真实 StepFun 验收、独立 npm CLI 和最终安装包仍未完成；本次没有生成最终安装包。
