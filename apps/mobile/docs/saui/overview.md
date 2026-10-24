# SaUI 组件库

> 基于 Kuikly 原生组件封装的 SaUI 设计系统组件库。提供 SaUI 风格 Token 系统和 26 个基础组件 + 2 个聊天业务组件，覆盖基础、表单、数据展示、反馈、导航等场景。

## 设计原则

1. **Kuikly 原生可用的直接用**：Switch、AlertDialog、Slider、TextArea、DatePicker、Tabs、ActionSheet、ActivityIndicator 等 15+ 原生组件无需封装，在业务代码中直接使用
2. **只封装有实质注入的**：每个组件必须注入 SaUI Token（颜色/间距/圆角/字体），纯参数透传的薄包装已移除
3. **使用 `object` + `fun build(): ViewBuilder` 模式**：统一调用风格，所有组件通过 `build()` 方法返回 Kuikly ViewBuilder

## 架构

```
saui/
├── SaUI.kt          # 统一导出入口 (SaUIComponents / SaUITokens)
├── token/          # SaUI Token 层
│   ├── SaUIColors.kt      # 颜色体系 (BrandPrimary #0052D9)
│   ├── SaUITypography.kt  # 字体体系
│   ├── SaUISpacing.kt     # 间距体系 (xxs=2, xs=4, sm=8, md=12, lg=16, xl=20, xxl=24, xxxl=32, huge=48, massive=64)
│   ├── SaUIRadius.kt      # 圆角体系 (Small=4, Medium=8, Large=12, ExtraLarge=16, Round=999, Circle=999)
│   └── SaUIShadow.kt      # 阴影体系
├── base/           # 基础组件
│   └── SaButton.kt           # 按钮 (6 variants x 3 sizes)
├── foundation/     # 基础元素
│   ├── SaIcon.kt             # 图标组件 (buildChar 字符 / buildSrc 图片, 5 档 Size)
│   │                         # 内含 SaIcons 字符集 (49 个 Unicode 常量)
│   ├── SaDivider.kt          # 分割线 (横/竖/带文字)
│   └── SaBadge.kt            # 徽标 (DOT/COUNT)
├── form/           # 表单组件
│   ├── SaInput.kt            # 输入框 (label/prefix/suffix/error)
│   ├── SaSearchBar.kt        # 搜索栏 (胶囊/圆角 + 清除/取消按钮)
│   ├── SaCheckBox.kt         # 复选框 (Row + CheckBox + Text label)
│   ├── SaRadio.kt            # 单选框 + SaRadioGroup
│   └── SaStepper.kt          # 步进器 (-/+ 按钮 + 数值)
├── data/           # 数据展示
│   ├── SaAvatar.kt           # 头像 (buildText/buildSrc, 6 档尺寸 x 2 形状)
│   ├── SaCell.kt             # 单元格 + buildGroup 容器
│   ├── SaTag.kt              # 标签 (5 色 x 3 尺寸 + closable)
│   └── SaCollapse.kt         # 折叠面板
├── feedback/       # 反馈组件
│   ├── SaLoading.kt          # 加载指示器
│   ├── SaToast.kt            # 轻提示 (SUCCESS/ERROR/WARNING/INFO/LOADING)
│   ├── SaEmpty.kt            # 空状态 (6 种图标类型 + 操作按钮)
│   ├── SaProgress.kt         # 进度条 (LINE/CIRCLE)
│   ├── SaResult.kt           # 结果页 (5 种状态)
│   ├── SaRate.kt             # 评分 (星标)
│   ├── SaNoticeBar.kt        # 通知栏 (4 种语义色)
│   ├── SaSkeleton.kt         # 骨架屏 (4 种变体)
│   ├── SaPopup.kt            # 弹出层 (BOTTOM/TOP/CENTER/LEFT/RIGHT)
│   └── SaDrawer.kt           # 抽屉 (左/右)
├── navigation/     # 导航组件
│   ├── SaNavbar.kt           # 导航栏
│   ├── SaTabBar.kt           # 标签栏
│   └── SaSteps.kt            # 步骤条 (HORIZONTAL/VERTICAL)
└── chat/           # 聊天业务组件
│   ├── ChatMessageBubble.kt  # 消息气泡 (左右对齐 + 围栏代码块 + 流式光标)
│   └── StreamingInputBar.kt  # 流式输入栏 (输入/流式开关/模型切换/发送停止)

```

## Token 系统

SaUI 品牌蓝 `#0052D9` 替代项目原有微信绿 `#07C160`。

```kotlin
import com.sa.demo.saui.SaUITokens

SaUITokens.Colors.BrandPrimary     // "#0052D9"  品牌主色
SaUITokens.Colors.TextPrimarySolid  // "#1A1A1A"  主文字色（不含 alpha 的实色版）
SaUITokens.Colors.BgContainer       // "#FFFFFF"  容器背景
SaUITokens.Spacing.md              // 12f        中等间距
SaUITokens.Radius.Medium           // 8f          中等圆角
```

## 使用方式

```kotlin
import com.sa.demo.saui.SaUIComponents
import com.sa.demo.saui.base.SaButton

// 按钮
SaButton.build(
    text = "确定",
    variant = SaButton.Variant.PRIMARY,
    size = SaButton.ButtonSize.MEDIUM,
    disabled = false
) { /* onClick */ }.invoke(this)

// 输入框（注意：onTextChange 是具名参数，不是尾随 lambda）
SaUIComponents.Input.build(
    label = "用户名",
    placeholder = "请输入",
    required = true,
    onTextChange = { value -> /* ... */ }
).invoke(this)

// 搜索栏
SaUIComponents.SearchBar.build(
    value = currentValue,
    onTextChange = { newValue -> ... },
    onSearch = { query -> ... }
).invoke(this)

// 标签
SaTag.build(
    text = "已通过",
    variant = SaTag.Variant.SUCCESS,
    closable = false
).invoke(this)
```

## Kuikly 原生组件对照

以下 Kuikly 原生组件可直接使用，无需 SaUI 封装（仅需注入 SaUI Token 颜色）：

| SaUI 概念 | Kuikly 原生组件 | 使用建议 |
|-------------|----------------|---------|
| Switch | `Switch { attr { isOn(...); onColor(...) } }` | 使用 `SaUITokens.Colors.BrandPrimary` |
| Dialog | `AlertDialog { attr { title(...); message(...); actionButtons(...) } }` | 原生 API 完全等价 |
| Slider | `Slider { attr { ... } }` | 原生组件 |
| TextArea | `TextArea { attr { ... } }` | 原生组件 |
| DatePicker | `DatePicker { attr { ... } }` | 原生组件 |
| ScrollPicker | `ScrollPicker { attr { ... } }` | 原生组件 |
| ActionSheet | `ActionSheet { attr { ... } }` | 原生组件 |
| Tabs | `Tabs { attr { ... } }` | 原生组件 |
| Refresh | `Refresh { attr { ... } }` | 原生下拉刷新 |
| SliderPage | `SliderPage { attr { ... } }` | 原生轮播图 |
| Mask | `Mask { attr { ... } }` | 原生遮罩 |
| Hover | `Hover { attr { ... } }` | 原生悬停/吸顶 |
| ActivityIndicator | `ActivityIndicator { attr { ... } }` | 原生活动指示器 |
| Image | `Image { attr { ... } }` | 原生图片组件 |
| CheckBox | `CheckBox { attr { ... } }` | 原生复选框（无 label 时） |

详见 [components.md](./components.md) 完整 API 参考。

