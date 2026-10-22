# 文档更新日志

记录项目文档的重要更新和维护历史。

---

## 2026-09-20 - 工程杂物清理

### 删除项
- ❌ `plugin/` — Gradle `init` 生成的示例插件空壳（`org.example.greeting`），零引用；同步从 `settings.gradle.kts` 与 `settings.ohos.gradle.kts` 移除 `include("plugin")`
- ❌ `KuiklyApiUrls.kt` — 游离在模块根目录、不属于任何 Gradle 模块、不参与编译
- ❌ `nul` — Windows 下 `2>nul` 重定向被误解析为文件名而产生的垃圾文件
- ❌ `androidApp/src/main/assets/ic_report.png` — 伪 PNG（562 字节，实为另一个工程的 Gradle 编译日志被重定向写入），零引用

### 新增项
- ✅ `local.properties` — 配置 `sdk.dir` 指向本机 Android SDK，免除每次构建手动注入 `ANDROID_HOME`（已在 `.gitignore` 中）

### 重命名
- 🔄 `rootProject.name`：`app_assistant` → `sa-app`（`settings.gradle.kts`）；鸿蒙链 `sa-app-ohos` 保持不变

### 更新的文档
- 📝 `AGENTS.md` - 构建命令章节补充 `local.properties` 配置说明，新增 `./gradlew projects`

### 验证
- ✅ `./gradlew projects` 模块树为 `framework` / `shared` / `androidApp`
- ✅ `./gradlew :androidApp:assembleDebug` BUILD SUCCESSFUL

### 资源文件巡检（扩展名 vs 文件头魔数）
对全库 60+ 个 `.png/.jpg/.gif/.webp/.bmp` 逐个读取文件头比对：

- ✅ 全部文件头均为合法 PNG 魔数 `89 50 4E 47`，**无第二例**"重定向写坏资源"事故
- ✅ `androidApp/src/main/res/drawable/ic_report.png`（3755 字节，合法 PNG）仍在 —— 证实被误覆盖的只是 `assets/` 下的副本，真图标未丢失
- ⚠️ `ohosApp/AppScope/resources/base/media/app_icon.png` 为 32x32 的 DevEco 默认占位图标（98 字节），分辨率偏低；鸿蒙上架通常要求 114x114 及以上，建议替换为正式图标（非阻塞）

## 2026-09-20 - Catalog 页组件覆盖补全

### 代码变更
- ✅ `shared/.../saui/catalog/SaUICatalogPage.kt` - 补齐此前遗漏的 `Drawer` 组件（`drawerVisible` 状态此前声明未使用），并新增 11 个变体卡片，卡片数 33 → 45

### 新增的 Demo 卡片
| 分类 | 新增卡片 |
|------|---------|
| Foundation | Divider - 竖向 |
| Form | Input - 错误态、RadioGroup - 横向 |
| Data | Avatar - 6 种尺寸、Tag - 3 种尺寸、Cell - Group |
| Feedback | Loading - DOTS、Empty - 带操作、Progress - CIRCLE、Skeleton - TEXT 多行 / CIRCLE、Drawer |
| Navigation | Steps - vertical |

### 更新的文档
- 📝 `AGENTS.md` - 组件目录页卡片数 34 → 45
- 📝 `docs/saui/overview.md` - 同步卡片数

## 2026-07-10 - SaUI 组件库文档

### 新增文档
- ✅ `saui/overview.md` - SaUI 组件库总览：设计原则、架构、Token 系统、原生对照
- ✅ `saui/components.md` - 28 个组件完整 API 参考 + Kuikly 原生可用组件清单
- ✅ `shared/.../saui/catalog/SaUICatalogPage.kt` - 组件目录页（34 个 Demo 卡片，含交互验证）

### 更新的文档
- 📝 `AGENTS.md` - 新增 SaUI 组件库章节（设计原则、组件清单、统一入口），更新构建命令（含 JAVA_HOME），项目结构增加 saui/ 目录
- 📝 `docs/index.md` - 新增 SaUI 组件库文档导航入口
- 📝 `docs/kuikly-dsl-gotchas.md` - 新增 7 个 SaUI 组件开发中发现的 API 陷阱（Input color、ActivityIndicator、MATCH_PARENT、ViewBuilder return、when 多语句、Modal 限制、Pager 方法引用）

## 2026-04-22 - KuiklyUI 集成文档整理

### 新增文档
- ✅ `index.md` - 完整的文档索引和导航
- ✅ `DOCUMENTATION_CHANGELOG.md` - 文档更新日志

### 文档结构优化
- 📁 整理了 `components/` 目录下的 37 个组件文档
- 📁 整理了 `modules/` 目录下的 10 个模块文档
- 📁 整理了 `guides/` 目录下的开发指南

### 重点文档标注
- 🔴 `kuikly-dsl-gotchas.md` - 标记为必读文档
- ⭐ `components/07_button.md` - 标记为重要组件文档
- 📖 `kuikly-official-api-index.md` - 标记为参考文档

### 导航优化
- ✅ 添加了按场景查找的快速导航
- ✅ 添加了按组件查找的快速导航
- ✅ 添加了学习路径建议
- ✅ 添加了开发流程建议

### 外部资源链接
- ✅ 添加了 KuiklyUI 官网链接
- ✅ 添加了 API 文档链接
- ✅ 添加了 GitHub 仓库链接
- ✅ 添加了本地资源路径

---

## 文档统计

### 组件文档 (37个)
- 基础组件: 7个 (Text, Image, Button, Input, Pager, 基础属性, 概览)
- 容器组件: 4个 (Scroller, List, Modal, Tabs)
- 表单组件: 4个 (Switch, Slider, Checkbox, TextArea)
- 高级组件: 5个 (Video, RichText, WaterfallList, SliderPage, PageList)
- 弹窗选择器: 4个 (AlertDialog, ActionSheet, DatePicker, ScrollPicker)
- 刷新效果: 5个 (Refresh, FooterRefresh, ActivityIndicator, Blur, Mask)
- iOS特有: 4个 (Hover, LiquidGlass, GlassEffectContainer, iOS26)
- 动画媒体: 3个 (PAG, APNG, IOSSegmentedControl)

### 模块文档 (10个)
- MemoryCache, SP, Router, Network, Notify
- Snapshot, Codec, Calendar, Performance
- 概览文档

### 指南文档 (4个)
- 组件开发指南
- 导航指南
- 状态管理指南
- 快速开始指南

### 根级文档 (7个)
- index.md (文档索引)
- getting-started.md (快速开始)
- best-practices.md (最佳实践)
- faq.md (常见问题)
- kuikly-dsl-gotchas.md (DSL陷阱) ⭐
- kuikly-official-api-index.md (API索引)
- Kuikly框架学习总结.md (学习总结)

---

## 待办事项

### 文档完善
- [ ] 为每个组件添加完整的使用示例
- [ ] 为每个模块添加完整的 API 示例
- [ ] 添加更多常见问题到 faq.md
- [ ] 完善 kuikly-dsl-gotchas.md 的错误案例

### 文档翻译
- [ ] 考虑添加英文版本文档
- [ ] 添加中英文对照的关键术语表

### 文档自动化
- [ ] 考虑使用工具自动生成 API 文档
- [ ] 考虑添加文档测试（验证代码示例可运行）

---

## 文档维护规则

### 更新频率
- **每次遇到新问题**：立即更新 `kuikly-dsl-gotchas.md` 和 `faq.md`
- **每次新增组件**：同步创建对应的组件文档
- **每次学习新知识**：更新 `Kuikly框架学习总结.md`
- **每周**：检查并更新 `index.md` 的链接

### 文档质量标准
- ✅ 每个示例代码必须可运行
- ✅ 每个链接必须有效
- ✅ 每个说明必须清晰准确
- ✅ 必须标注重要程度和优先级

### 文档命名规范
- 组件文档：`{编号}_{组件名}.md` (如 `07_button.md`)
- 模块文档：`{编号}_{模块名}.md` (如 `03_router.md`)
- 指南文档：`{主题}.md` (如 `state-management.md`)
- 根级文档：`{用途}.md` (如 `faq.md`)

---

*最后更新: 2026-04-22*
