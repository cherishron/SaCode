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

## 配置语义补齐（后续增量）

- 提供商区分 declared，内置目录条目不再错误标为自定义，内置提供商隐藏自有 ID/协议编辑；环境提供的凭证只读，删除文案保留外部凭证。
- 模型目录具有默认/自定义状态，恢复默认只变更草稿，保存后由核心承接持久化；只读配置可查看但禁用写操作。
- 页面 Adapter 的 load 返回 revision/writable，save/remove 携带打开卡片时的 expectedRevision；冲突显示官方中文说明并保留草稿，关闭后重载，再打开使用新版本。订阅卸载时回收；较早返回的目录请求不能覆盖最新快照。真实后端尚未实现该契约。
- TypeScript 5.9.3 严格检查通过：在 apps/desktop 执行 `npm exec --yes --package=typescript@5.9.3 -- tsc --noEmit --strict --lib ES2022,DOM --module ESNext --moduleResolution Bundler --target ES2022 renderer/pages/models-page.ts`。首次检查发现删除弹窗 slot 中 nullable 引用，修为可选访问后通过。检查器通过 npm exec 使用，不作为运行时依赖。
- 当前整页 Electron 最终 59 组/210 条检查通过（退出码 0）；新增默认恢复、环境凭证只读、版本冲突/重新打开、只读写阻断、刷新乱序、订阅回收。日志 `D:\Temp\SaCode-ui-scroll-20261004\models-version-frame.log`，报告 `models-version-captures/reports.json`。依旧是组件 fixture 的配置行为验收，不是仓颉业务完成证明。

- 最终虚拟 Vue 模块构建去除了随机临时 shim 路径，同一源码连续构建 SHA256 均为 `3C912DD2D72ED10F240368FD979D16B2DB13200A3E1A8F3D0093CD1EF4531124`；仅证明模型页面 bundle 的重复构建一致，不代表全产品产物已可复现。实际最终 bundle 经 Electron 59 组/210 条检查通过，日志 `models-version-stable.log`，报告 `models-version-stable/reports.json`。
