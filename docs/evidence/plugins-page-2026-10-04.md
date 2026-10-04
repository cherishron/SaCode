# 内置插件页面复刻增量

## 官方源证据

冻结 deepseek-ai/deepseek-harness @ 639ed015397290b3745d163aafe02ffee4aa3f84 的 ui-settings-plugins（PluginsSettingsSection.tsx、CSS、locales.ts、index.ts）及 ui-settings-plugin-inventory（PluginInventorySettingsTab.tsx、CSS、locales.ts）。文件位于 D:\Temp\SaCode-official-639ed015。源码明确此页用于查看内置部署的插件，贡献页签负责其具体页面；不存在据本页即可推断的安装/卸载入口。

## 本方实现

新增 renderer/pages/plugins-page.ts（TypeScript/Vue 3 runtime h）及 plugins-page.css，通过 pack-pages.mjs 编译 SaCodePlugins 经典脚本，使用唯一 Vue runtime，产物通过 CSP/静态依赖守卫。设置分类名调整为内置插件。

页面支持贡献视图按 order 排序、单贡献时省略页签、首次访问挂载、访问后隐藏保留状态、方向键/Home/End 同步焦点。清单区有独立 Host 读取/失败重试、页面客户端同步/失败重试、全局与会话预设分组、默认/损坏预设标记、故障优先、启用/条件/预设/运行状态、元信息错误、详情、模块身份、搜索与跨预设匹配跳转。清单只读，不在渲染层变更 Host 插件启用事实。官方布局按 520px 容器宽度将两列切为单列，本方已使用同类 container query。

现有真实仓颉工具清单保留在独立的当前核心工具区域，仍逐项对应 tools/list；插件 Adapter 尚未注入，产品明确提示插件清单接口未接入。不得把工具清单包装成已完成的插件 inventory。配置卡片可作为贡献视图挂载，具体 Agent/Shell/Subagent/WebSearch 等设置内容仍待实现。

## 验证

- TypeScript 5.9.3 对 models-page.ts 与 plugins-page.ts 严格检查通过（--noEmit --strict --lib ES2022,DOM --module ESNext --moduleResolution Bundler --target ES2022）。
- pack-pages 与 renderer app.js 语法检查通过；两个页面产物均复用 globalThis.Vue，无动态/外部导入、无运行时求值。
- 真 Electron UI 黄金路径 200 条通过、退出码 0，日志 D:\Temp\SaCode-ui-scroll-20261004\plugins-ui.log；工具清单仍逐项对应核心响应。该运行之后仅分类文案与插件容器 CSS/fixture 改动，最终另行执行下面整页检查。
- 最新整页 74 组/247 条通过，退出码 0；日志 plugins-frame-container.log、报告 plugins-captures-container/reports.json。覆盖插件懒挂载、草稿/快照保留、键盘焦点、故障优先、预设搜索/跳转、Host 与客户端重试独立、两列/单列容器布局、订阅回收。
- 产品截图 plugins-product.png 已查看；fixture 截图初次附加在正文流中导致页面截图混入会话，后改为独立固定区域并等绘制完成。最终 plugins-inventory-fixture.png 是组件测试数据，不是产品已经接入的插件。

隔离环境使用此前已构建 Host，本轮没有测试最新后端增量，没有调用外部大模型，没有重新生成最终安装包。官方原生桌面视觉基线仍缺，不能据源码与本方截图宣称整体视觉复刻验收通过。全前端、全部仓颉功能接入、真实模型测试、npm CLI 与完整安装产品仍未完成。
