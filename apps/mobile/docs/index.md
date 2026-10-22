# SaApp 文档中心

> 完整的项目文档索引，帮助快速找到所需信息。
> 本目录同时服务两块内容：**saai 接入实现**（`shared/.../auth|chat|agent|history`）与 **Kuikly/SaUI 组件库底座**。

---

## 🚦 saai 接入与进度（先看这里）

| 文档 | 说明 |
|------|------|
| [PROGRESS.md](./PROGRESS.md) | 手机局部进度与迁入边界；产品完成以根 PRD 台账为准 |
| [sa-code-integration-progress.md](./sa-code-integration-progress.md) | P0/P1 三 RPC 只读客户端实施与历史验证边界 |
| [sa-code-upgrade-assessment-2026-10-22.md](./sa-code-upgrade-assessment-2026-10-22.md) | 迁入前 SaCode 更新兼容性复评与 P2 安全阻塞 |
| [sa-code-mobile-integration-plan.md](./sa-code-mobile-integration-plan.md) | 历史接入方案，路径已适配同仓 |
| [MVP-GOAL.md](./MVP-GOAL.md) | 历史手机 MVP 目标，不能替代根交付主线 |
| [agent-pc-bridge.md](./agent-pc-bridge.md) | 历史手机与 PC 桥接设计 |
| [../README.md](../README.md) | 项目总览：技术栈、结构、构建命令、接入 saai 步骤 |
| [../AGENTS.md](../AGENTS.md) | 开发规则手册 |
| [SaCode PRD 台账](../../../docs/product/PRD-tracking.md) | 同仓唯一产品进度与当前交付卡 |
| [根文档索引](../../../docs/README.md) | 权威顺序与分类索引；原产品线 `../../docs/STATUS.md` 未导入 |

接入代码位置（`shared/src/commonMain/kotlin/com/sa/demo/`）：`env/SaaiEnv.kt`（环境配置）· `auth/`（OAuth+PKCE+exchange）· `chat/`（Gateway Chat）· `agent/`（Agent 桥）· `history/`（云端历史）· `storage/SecureStore.kt` · `feature/{login,chat,agent}/`。

---

## 📚 文档导航

### 🚀 快速开始

| 文档 | 说明 | 优先级 |
|------|------|--------|
| [getting-started.md](./getting-started.md) | 项目快速开始指南 | ⭐⭐⭐ |
| [best-practices.md](./best-practices.md) | 最佳实践指南 | ⭐⭐ |
| [faq.md](./faq.md) | 常见问题解答 | ⭐⭐ |

### 🎨 KuiklyUI 框架

| 文档 | 说明 | 重要性 |
|------|------|--------|
| [kuikly-dsl-gotchas.md](./kuikly-dsl-gotchas.md) | **Kuikly DSL 陷阱与规则** | 🔴 必读 |
| [kuikly-official-api-index.md](./kuikly-official-api-index.md) | Kuikly 官方 API 索引 | 📖 参考 |
| [Kuikly框架学习总结.md](./Kuikly框架学习总结.md) | Kuikly 框架学习总结 | 📝 学习 |

### 🧩 SaUI 组件库

| 文档 | 说明 | 重要性 |
|------|------|--------|
| [saui/overview.md](./saui/overview.md) | **组件库总览与设计原则** | 🔴 必读 |
| [saui/components.md](./saui/components.md) | 26 个基础组件 API 参考 + Kuikly 原生对照 | 📖 参考 |

### 📦 组件文档

#### 基础组件
- [00_overview.md](./components/00_overview.md) - 组件概览
- [01_basic_attr.md](./components/01_basic_attr.md) - 基础属性与事件
- [02_pager.md](./components/02_pager.md) - Pager 页面容器
- [04_text.md](./components/04_text.md) - Text 文本组件
- [05_image.md](./components/05_image.md) - Image 图片组件
- [07_button.md](./components/07_button.md) - **Button 按钮组件** ⭐
- [07_input.md](./components/07_input.md) - Input 输入框

#### 容器组件
- [08_scroller.md](./components/08_scroller.md) - Scroller 滚动容器
- [09_list.md](./components/09_list.md) - List 列表组件
- [10_modal.md](./components/10_modal.md) - Modal 弹窗
- [11_tabs.md](./components/11_tabs.md) - Tabs 标签页

#### 表单组件
- [12_switch.md](./components/12_switch.md) - Switch 开关
- [20_slider.md](./components/20_slider.md) - Slider 滑块
- [21_checkbox.md](./components/21_checkbox.md) - Checkbox 复选框
- [18_textarea.md](./components/18_textarea.md) - TextArea 多行输入

#### 高级组件
- [13_video.md](./components/13_video.md) - Video 视频
- [14_richtext.md](./components/14_richtext.md) - RichText 富文本
- [15_waterfalllist.md](./components/15_waterfalllist.md) - WaterfallList 瀑布流
- [16_sliderpage.md](./components/16_sliderpage.md) - SliderPage 轮播
- [17_pagelist.md](./components/17_pagelist.md) - PageList 分页列表

#### 弹窗与选择器
- [22_alertdialog.md](./components/22_alertdialog.md) - AlertDialog 警告对话框
- [23_actionsheet.md](./components/23_actionsheet.md) - ActionSheet 底部菜单
- [24_datepicker.md](./components/24_datepicker.md) - DatePicker 日期选择器
- [25_scrollpicker.md](./components/25_scrollpicker.md) - ScrollPicker 滚动选择器

#### 刷新与效果
- [26_refresh.md](./components/26_refresh.md) - Refresh 下拉刷新
- [27_footerrefresh.md](./components/27_footerrefresh.md) - FooterRefresh 上拉加载
- [28_activityindicator.md](./components/28_activityindicator.md) - ActivityIndicator 加载指示器
- [29_blur.md](./components/29_blur.md) - Blur 模糊效果
- [30_mask.md](./components/30_mask.md) - Mask 遮罩

#### iOS 特有组件
- [31_hover.md](./components/31_hover.md) - Hover 悬停效果
- [32_liquidglass.md](./components/32_liquidglass.md) - LiquidGlass 液态玻璃
- [33_glasseffectcontainer.md](./components/33_glasseffectcontainer.md) - GlassEffectContainer
- [37_ios26_liquid_glass.md](./components/37_ios26_liquid_glass.md) - iOS 26 液态玻璃

#### 动画与媒体
- [34_pag.md](./components/34_pag.md) - PAG 动画
- [35_apng.md](./components/35_apng.md) - APNG 动画图片
- [36_iossegmentedcontrol.md](./components/36_iossegmentedcontrol.md) - iOS 分段控制

### 🏗️ Framework 模块

| 文档 | 说明 |
|------|------|
| [framework/overview.md](./framework/overview.md) | Framework 模块概述 |
| [framework/adapters.md](./framework/adapters.md) | 7 个适配器详细说明 |
| [framework/usage.md](./framework/usage.md) | 使用指南 |

### 🔧 Kuikly 模块文档

| 模块 | 文档 | 说明 |
|------|------|------|
| 概览 | [modules/00_overview.md](./modules/00_overview.md) | 模块系统概览 |
| 内存缓存 | [modules/01_memory_cache.md](./modules/01_memory_cache.md) | MemoryCacheModule |
| 本地存储 | [modules/02_sp.md](./modules/02_sp.md) | SharedPreferencesModule |
| 路由 | [modules/03_router.md](./modules/03_router.md) | RouterModule |
| 网络 | [modules/04_network.md](./modules/04_network.md) | NetworkModule |
| 通知 | [modules/05_notify.md](./modules/05_notify.md) | NotifyModule |
| 截图 | [modules/06_snapshot.md](./modules/06_snapshot.md) | SnapshotModule |
| 编解码 | [modules/07_codec.md](./modules/07_codec.md) | CodecModule |
| 日历 | [modules/08_calendar.md](./modules/08_calendar.md) | CalendarModule |
| 性能 | [modules/09_performance.md](./modules/09_performance.md) | PerformanceModule |

### 📦 组件文档

| 指南 | 文档 | 说明 |
|------|------|------|
| 组件开发 | [component-development.md](./guides/component-development.md) | 如何开发自定义组件 |
| 导航 | [neavigation.md](./guides/neavigation.md) | 页面导航与路由 |
| 状态管理 | [state-management.md](./guides/state-management.md) | 响应式状态管理 |

---

## 🔥 重要提醒

### 必读文档

1. **[kuikly-dsl-gotchas.md](./kuikly-dsl-gotchas.md)** - Kuikly DSL 陷阱
   - 记录了所有常见的错误用法
   - 提供了正确的代码示例
   - **开发前必读**

2. **[AGENTS.md](../AGENTS.md)** - 开发规则手册
   - 铁律：永不简化
   - KuiklyUI 开发强制流程
   - 必须使用 KuiklyUI AI Skills

3. **[README.md](../README.md)** - 项目总览
   - 技术栈
   - 项目结构
   - 构建命令与 saai 接入步骤

4. **[PROGRESS.md](./PROGRESS.md)** - 进度真源
   - 已落地范围、验证状态、真机验收与遗留

---

## 🎯 快速查找

### 按场景查找

| 场景 | 推荐文档 |
|------|---------|
| 第一次使用 Kuikly | [getting-started.md](./getting-started.md) → [kuikly-dsl-gotchas.md](./kuikly-dsl-gotchas.md) |
| 使用 SaUI 组件 | [saui/overview.md](./saui/overview.md) → [saui/components.md](./saui/components.md) |
| 创建页面 | [02_pager.md](./components/02_pager.md) → [07_button.md](./components/07_button.md) → [07_input.md](./components/07_input.md) |
| 创建列表页面 | [09_list.md](./components/09_list.md) → [26_refresh.md](./components/26_refresh.md) |
| 页面跳转 | [03_router.md](./modules/03_router.md) → [neavigation.md](./guides/neavigation.md) |
| 网络请求 | [04_network.md](./modules/04_network.md) |
| 状态管理 | [state-management.md](./guides/state-management.md) |
| 遇到编译错误 | [kuikly-dsl-gotchas.md](./kuikly-dsl-gotchas.md) → [faq.md](./faq.md) |

### 按组件查找

| 组件 | 文档位置 |
|------|---------|
| Button | [components/07_button.md](./components/07_button.md) |
| Text | [components/04_text.md](./components/04_text.md) |
| Image | [components/05_image.md](./components/05_image.md) |
| Input | [components/07_input.md](./components/07_input.md) |
| List | [components/09_list.md](./components/09_list.md) |
| Modal | [components/10_modal.md](./components/10_modal.md) |

---

## 📝 文档维护

### 文档结构

```
docs/
├── index.md                          # 本文件 - 文档索引
├── getting-started.md                # 快速开始
├── best-practices.md                 # 最佳实践
├── faq.md                            # 常见问题
├── kuikly-dsl-gotchas.md             # Kuikly DSL 陷阱 ⭐
├── kuikly-official-api-index.md      # 官方 API 索引
├── Kuikly框架学习总结.md              # 学习总结
├── structure-summary.md              # 结构总结
├── framework/                        # Framework 模块文档 🆕
│   ├── overview.md                   # 模块概述
│   ├── adapters.md                   # 适配器详细说明
│   └── usage.md                      # 使用指南
├── components/                       # 组件文档
│   ├── 00_overview.md
│   ├── 01_basic_attr.md
│   ├── 07_button.md
│   └── ...
├── modules/                          # Kuikly 模块文档
│   ├── 00_overview.md
│   ├── 03_router.md
│   └── ...
└── guides/                           # 开发指南
    ├── component-development.md
    ├── state-management.md
    └── ...
```

### 更新规则

1. **新增组件时**：在 `components/` 下创建对应文档
2. **新增 Kuikly 模块时**：在 `modules/` 下创建对应文档
3. **遇到问题时**：更新 `kuikly-dsl-gotchas.md` 和 `faq.md`
4. **学习新知识时**：更新 `Kuikly框架学习总结.md`
5. **修改 framework 时**：更新 `framework/` 下对应文档

---

## 🔗 外部资源

### KuiklyUI 官方资源

| 资源 | 链接 |
|------|------|
| 官网 | https://kuikly.tds.qq.com/ |
| API 文档 | https://kuikly.tds.qq.com/API/components/ |
| 基础属性 | https://kuikly.tds.qq.com/API/components/basic-attr-event.html |
| GitHub | https://github.com/Tencent-TDS/KuiklyUI |
| 快速开始 | https://kuikly.tds.qq.com/QuickStart/hello-world.html |

### 本地资源

| 资源 | 路径 |
|------|------|
| KuiklyUI AI Skills | `.agents/skills/` |
| 本地文档 | `.agents/skills/kuikly-ui-framework/references/KuiklyUI/docs/` |
| 官方 Demo | `temp_kuikly_demo/` |

---

## 💡 使用建议

### 学习路径

```
1. getting-started.md
   ↓
2. kuikly-dsl-gotchas.md (必读)
   ↓
3. components/00_overview.md
   ↓
4. components/01_basic_attr.md
   ↓
5. 实践：创建简单页面
   ↓
6. 遇到问题 → faq.md + kuikly-dsl-gotchas.md
```

### 开发流程

```
1. 查看 AGENTS.md - 确认规则
   ↓
2. 激活 KuiklyUI AI Skill
   ↓
3. 查阅本文档索引 - 找到对应组件文档
   ↓
4. 参考官方文档 - 确认 API
   ↓
5. 编写代码 - 严格遵循语法
   ↓
6. 遇到错误 → kuikly-dsl-gotchas.md
```

---

*最后更新: 2026-09-21*
