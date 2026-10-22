# Kuikly DSL 错题本

> 本项目开发过程中遇到的所有 Kuikly API 踩坑记录。
> **编写任何 UI 代码前必须先查阅此文件 + 官方文档。**
>
> 本文记**语法陷阱**（怎么写才不出错）；
> 怎么把代码拆得可测、可维护见 [AGENTS.md 代码解构规约](../AGENTS.md#代码解构规约)。
>
> 🚨 **元规则：永远不简化、不逃避、不降级。遇到错误 → 查文档/源码 → 找到正确 API → 完整实现。**

**典型逃避行为（已犯过的错，绝对禁止再犯）：**

| # | 逃避行为 | 后果 | 正确做法 |
|---|---------|------|---------|
| E1 | OAuthButtons 用 `View` 替代 `Button` | 按钮无按下态、无文本属性 | 查 button.html → 用 `titleAttr {}` |
| E2 | LoginPage 简化成只有 Logo+两行 Text | 登录页功能完全缺失 | 按设计稿实现完整 UI |
| E3 | MainPage/HomePage 简化为 `return {}` 空页面 | 主页面无法展示任何内容 | 实现完整的主页布局 |
| E4 | 未验证就声明"Button 类不存在" | 导致后续代码全部基于错误假设 | 去 GitHub 搜索源码确认 |

>
> 官方参考：
> - 📖 API 文档: https://kuikly.tds.qq.com/API/components/
> - 🔧 基础属性: https://kuikly.tds.qq.com/API/components/basic-attr-event.html
> - 💻 框架源码: https://github.com/Tencent-TDS/KuiklyUI
> - 📝 Demo 示例: `KuiklyUI/demo/src/commonMain/kotlin/`

---

## 错误 #01: Text 链式调用语法 ❌→✅

**错误时间**: 2026-04-21 (初次编译)
**影响文件**: LoginPage.kt, OAuthButtons.kt, HomePage.kt 等

### ❌ 错误写法

```kotlin
// 写法 A: 构造函数参数 + 链式调用
Text("Hello").textSize(20f).textColor(Color.RED)

// 写法 B: lambda 内赋值
Text { text = "Hello" }
```

### ✅ 正确写法

```kotlin
// 组件必须用 lambda 包裹，属性在 attr{} 块内用函数调用
Text {
    attr {
        text("Hello")
        fontSize(20f)
        color(Color.RED)
    }
}
```

### 根因分析

| 概念 | 说明 |
|------|------|
| **Kuikly DSL 模型** | 基于 `ViewContainer` 的声明式 DSL，每个组件是接收者 lambda |
| **attr {} 块本质** | 是一个带 `Attr` 接收者的作用域，内部只能调用其定义的函数 |
| **为什么链式不行** | `Text("str")` 返回的不是可链式调用的 Builder，而是直接注册组件 |

### 官方依据

> 来源: [kuikly.tds.qq.com/API/components/text.html](https://kuikly.tds.qq.com/API/components/text.html)
> 
> ```kotlin
> // 官方示例 — 所有属性都在 attr{} 中
> Text { 
>     attr { 
>         text("这是一个文本")
>         fontSize(20f)
>         color(Color.BLUE) 
>     } 
> }
> ```

---

## 错误 #02: 属性赋值 vs 函数调用 ❌→✅

**错误时间**: 2026-04-21
**影响文件**: LoginPage.kt (用户尝试修复时引入)

### ❌ 错误写法

```kotlin
Text {
    attr {
        text = "Hello"           // ← 编译错误: Variable expected
        backgroundColor = Color.RED  // ← 编译错误: Function invocation expected
    }
}
```

### ✅ 正确写法

```kotlin
Text {
    attr {
        text("Hello")              // ← 函数调用
        backgroundColor(Color.RED)   // ← 函数调用
    }
}
```

### 根因

`attr {}` 块的接收者是 `Attr` 接口，其中每个属性都是**函数定义**而非属性：

```kotlin
// Attr 接口内部大致如下（简化）
interface Attr {
    fun text(value: String)
    fun fontSize(size: Float)
    fun color(color: Long)       // 注意: 部分属性期望 Long
    fun color(color: Color)      // 部分 API 期望 Color 对象!
    fun backgroundColor(color: Long)
    fun border(border: Border)
    // ...
}
```

---

## 错误 #03: Button 组件误判为不存在 ❌→✅

**错误时间**: 2026-04-21
**影响文件**: OAuthButtons.kt

### ❌ 错误判断 & 写法

```kotlin
// 当时认为 Button 类不存在，用 View 替代
View {
    attr {
        size(44f, 44f)
        backgroundColor(Color.parseString16ToLong("#07C160"))
        borderRadius(Radius.Circle)
    }
    event { click { onWeChatLogin() } }
}

// 文档中也标记了: ❌ Button() → com.tencent.kuikly.core.views.button.Button 可能不存在
```

### ✅ 正确写法 — Button 组件存在且功能丰富！

```kotlin
Button {
    attr {
        size(200f, 44f)
        backgroundColor(Color.BLUE)
        borderRadius(22f)
        highlightBackgroundColor(Color(0xDD0000))  // ← 独有能力: 按下态颜色
    }
    titleAttr {                    // ← 独特子块: 设置按钮文本
        text("登录")
        fontSize(16f)
        color(Color.WHITE)
    }
    imageAttr {                   // ← 可选: 设置图标
        // ...
    }
    event {
        click { /* 处理点击 */ }
    }
}
```

### Button 独有能力（View 没有）

| 能力 | 说明 | 示例 |
|------|------|------|
| `titleAttr {}` | 文本属性块 | `titleAttr { text("登录"); fontSize(16f) }` |
| `imageAttr {}` | 图标属性块 | `imageAttr { src("icon.png"); size(20f, 20f) }` |
| `highlightBackgroundColor()` | 按下态颜色 | `highlightBackgroundColor(Color.GRAY)` |
| `flexDirection` | 图标与文本排列方向 | `flexDirectionRow()` 图标在左文字在右 |
| `glassEffectIOS()` | iOS 液态玻璃效果 | iOS 26+ 专属 |

### 官方依据

> 来源: [kuikly.tds.qq.com/API/components/button.html](https://kuikly.tds.qq.com/API/components/button.html)
> 
> > Button(按钮): 按钮组件。除了支持所有基础属性，还支持以下属性:
> > - `titleAttr`: 设置文本属性
> > - `imageAttr`: 设置图片属性  
> > - `highlightBackgroundColor`: 设置按下态颜色
> > - `flexDirection`: 设置图标和文本的排列方向

### 待修复项

- [ ] OAuthButtons.kt 中的微信/Google 按钮: `View` → `Button` + `titleAttr{}`

---

## 错误 #04: 边框 API ❌→✅

**错误时间**: 2026-04-21
**影响文件**: OAuthButtons.kt

### ❌ 错误写法

```kotlin
// 写法 A: 分离的边宽/边色方法（不存在！）
View {
    attr {
        borderWidth(1f)          // ← Unresolved reference 'borderWidth'
        borderColor(Color.RED)   // ← Unresolved reference 'borderColor'
    }
}
```

### ✅ 正确写法

```kotlin
// 必须使用 Border 对象统一设置
View {
    attr {
        border(
            Border(
                lineWidth = 1f,
                lineStyle = BorderStyle.SOLID,   // SOLID / DOTTED / DASHED
                color = Color.RED               // 注意: 这里期望 Color 对象!
            )
        )
    }
}
```

### BorderStyle 枚举值

| 值 | 效果 |
|----|------|
| `BorderStyle.SOLID` | 实线（最常用） |
| `BorderStyle.DOTTED` | 点线 |
| `BorderStyle.DASHED` | 虚线 |

### 官方依据

> 来源: [basic-attr-event.html](https://kuikly.tds.qq.com/API/components/basic-attr-event.html)
> 
> > border 方法: 为组件设置边框样式。该方法接收 Border 对象作为参数
> > - lineWidth: 边框线宽 Float
> > - lineStyle: 边框线样式 BorderStyle
> > - color: 边框样色 Color

---

## 错误 #05: Color 类型混淆 ❌→✅

**错误时间**: 2026-04-21
**影响文件**: OAuthButtons.kt, LoginPage.kt

### ❌ 错误写法

```kotlin
// 场景 A: Border 的 color 参数传了 Long
border(Border(lineWidth = 1f, color = Color.parseString16ToLong("#FF0000")))
// ↑ Argument type mismatch: actual Long, expected Color

// 场景 B: backgroundColor 传了 Color 对象
backgroundColor(Color(Color.RED))
// ↑ 可能编译通过但不是最优写法
```

### ✅ 正确写法

```kotlin
// 规则 1: 大多数样式属性期望 Long（十六进制颜色值）
backgroundColor(Color.parseString16ToLong("#FF0000"))  // ✅ String → Long
backgroundColor(0xffFF0000L)                              // ✅ 直接 Long
backgroundColor(Color.RED)                                // ✅ Color 常量（返回 Long）

// 规则 2: Border() 的 color 参数期望 Color 对象
border(Border(lineWidth = 1f, color = Color(Color.RED)))     // ✅ Long → Color 对象
border(Border(lineWidth = 1f, color = Color(0xffFF0000L)))  // ✅ Long → Color 对象
```

### 类型速查表

| API | 期望类型 | 推荐写法 |
|-----|---------|---------|
| `backgroundColor(c)` | **Long** | `Color.parseColor("#xxx")` 或 `Color.RED` |
| `text color(c)` | **Long** | 同上 |
| `Border(..., color=c)` | **Color 对象** | `Color(Color.parseLong(...))` |
| `textStroke(c, w)` | **Color** (第一个参数) | `Color(Color.RED)` |

---

## 错误 #06: paddingHorizontal 不存在 ❌→✅

**错误时间**: 2026-04-21
**影响文件**: LoginPage.kt (早期版本)

### ❌ 错误写法

```kotlin
Column {
    attr {
        paddingHorizontal(16f)   // ← Unresolved reference 'paddingHorizontal'
    }
}
```

### ✅ 替代方案

```kotlin
// 方案 1: 使用四参数 padding()
padding(top = 0f, left = 16f, bottom = 0f, right = 16f)

// 方案 2: 使用 margin() 达到类似效果（叶子组件不支持 padding）
margin(top = 0f, left = 16f, bottom = 0f, right = 16f)

// 方案 3: 组合 marginTop + marginLeft
marginTop(8f)
marginLeft(16f)
```

### 注意事项

> **叶子组件不支持 padding 方法**，可使用 margin 方法达到相同的效果。

---

## 错误 #07: .dp / .sp 后缀扩展 ❌→✅

**错误时间**: 2026-04-21
**影响文件**: 早期 LoginPage.kt, OAuthButtons.kt

### ❌ 错误写法

```kotlin
size(100.dp, 50.dp)      // ← Unresolved reference 'dp'
fontSize(20.sp)          // ← Unresolved reference 'sp'
```

### ✅ 正确写法

```kotlin
// Kuikly 默认单位就是 dp，直接传 Float
size(100f, 50f)           // ✅ 单位: dp
fontSize(20f)             // ✅ 字体大小也是 dp（非 sp）

// 如需 sp 单位（字体不跟随系统缩放），使用 useDpFontSizeDim()
Text {
    attr {
        fontSize(20f)
        useDpFontSizeDim()  // ← 明确指定使用 dp 作为字体单位
    }
}
```

---

## 错误 #08: body() 返回类型错误 ❌→✅

**错误时间**: 2026-04-21
**影响文件**: LoginPage.kt

### ❌ 错误写法

```kotlin
// 写法 A: 返回 Ui 对象（不存在此类型）
override fun body(): Ui = Column { ... }

// 写法 B: 缺少返回类型
override fun body() = { ... }

// 写法 C: 返回类型不匹配
override fun body(): ViewBuilder = { ... }  // ← 这个其实是对的!
// 但早期尝试过其他错误签名导致混淆
```

### ✅ 正确写法

```kotlin
// Pager 基类定义: body(): ViewContainer<*, *>.() -> Unit
// 即: 返回类型是一个带接收者的 lambda (Unit 返回值)

// 写法 1: 显式类型（推荐）
override fun body(): ViewBuilder = {
    attr { backgroundColor(Color.WHITE) }
    Text { attr { text("Hello") } }
}

// 写法 2: 推断类型
override fun body() = {
    attr { backgroundColor(Color.WHITE) }
    Text { attr { text("Hello") } }
}
```

---

## 错误 #09: Column 扩展函数上下文 ❌→✅

**错误时间**: 2026-04-21
**影响文件**: LoginPage.kt, OAuthButtons.kt

### ❌ 错误写法

```kotlin
// 尝试在 body() 顶层 lambda 中直接调用 Column 扩展函数
override fun body() = {
    Column {
        buildContent()  // ← cannot be called in this context with an implicit receiver
    }
}

private fun Column.buildContent() = apply {
    Text("Hello").textSize(20f)  // ← 又回到链式调用错误...
}
```

### ✅ 正确模式（两种）

#### 模式 A: 直接嵌套（简单页面推荐）

```kotlin
@Page("MyPage")
class MyPage : Pager() {
    override fun body() = {
        attr { allCenter() }

        Column {
            attr { flexDirectionColumn() }

            Text { attr { text("Title") } }
            Image { attr { src("logo.png") } }
        }
    }
}
```

#### 模式 B: 提取为独立函数（复杂页面推荐）

> ⚠️ 2026-10-09 更正：本节原示例 `fun ViewBuilder.buildPageContent() = apply { }` **无法编译**，
> 容器扩展的接收者也误写成了 `Column`（那是函数不是类型）。已按实测改正。

```kotlin
@Page("MyPage")
class MyPage : Pager() {

    override fun body(): ViewBuilder = {
        buildPageContent().invoke(this)   // ← 返回 ViewBuilder，调用点 invoke
    }

    // ✅ 返回 ViewBuilder，而非拿 ViewBuilder 当扩展接收者
    private fun buildPageContent(): ViewBuilder = {
        Column {
            attr { flexDirectionColumn() }
            buildHeaderSection()
            buildBodySection()
        }
    }

    // ✅ 容器扩展的接收者是「视图类型」ColumnView，不是函数 Column
    private fun ColumnView.buildHeaderSection() = apply {
        Text { attr { text("Title") } }
    }

    private fun ColumnView.buildBodySection() = apply {
        Image { attr { src("logo.png") } }
    }
}
```

### 关键区别

| 写法 | 接收者 | 能否编译 | 适用场景 |
|------|--------|---------|---------|
| `body(): ViewBuilder = { ... }` | — | ✅ | 顶层，可直接写 `Column{}, Text{}` |
| `private fun xxx(): ViewBuilder = { ... }` + `.invoke(this)` | — | ✅ | **提取顶层逻辑块（推荐）** |
| `private fun ColumnView.xxx() = apply { }` | `ColumnView` | ✅ | 提取 Column 内部逻辑块 |
| `private fun RowView.xxx() = apply { }` | `RowView` | ✅ | 提取 Row 内部逻辑块 |
| ~~`fun ViewBuilder.xxx() = apply { }`~~ | `ViewBuilder` | ❌ | 编译失败，见下 |
| ~~`fun Column.xxx() = apply { }`~~ | `Column`（函数） | ❌ | `Unresolved reference 'Column'` |

### 为什么 `ViewBuilder` 不能当扩展接收者

`ViewBuilder` 是 `typealias ViewBuilder = ViewContainer<*, *>.() -> Unit`——**一个函数类型**。
拿它做扩展接收者时，`this` 是那个 lambda 本身，不是 `ViewContainer`，
于是块内的 `Column{}` / `View{}` / `Text{}` 全部找不到接收者：

```
Unresolved reference. None of the following candidates is applicable
because of a receiver type mismatch:
  fun ViewContainer<*, *>.Column(init: ColumnView.() -> Unit): Unit
```

编译器给出的候选签名 `fun ViewContainer<*, *>.() -> Unit.blockA()` 也印证了这一点：
扩展挂在**函数类型**上，而非容器上。

而 `Column` 是工厂**函数**，`Row` 同理——它们不是类型，不能作接收者；
真正的视图类型是 `ColumnView` / `RowView`。

---

## 错误 #10: 枚举常量引用方式 ❌→✅

**错误时间**: 2026-04-21
**影响文件**: LoginPage.kt (用户修复尝试)

### ❌ 错误写法

```kotlin
// 写法 A: 字符串字面量
justifyContent("center")              // ← 期望枚举

// 写法 B: 不存在的静态成员
justifyContent = FlexJustifyContent.CENTER  // ← 赋值语法

// 写法 C: 不存在的 Attr 嵌套类
flexDirection = Attr.FLEX_DIRECTION.COLUMN  // ← Unresolved reference
```

### ✅ 正确写法

```kotlin
// 导入枚举类
import com.tencent.kuikly.core.layout.FlexJustifyContent
import com.tencent.kuikly.core.base.FlexDirection

// 使用枚举值作为函数参数
Column {
    attr {
        justifyContent(FlexJustifyContent.CENTER)    // ← 函数调用 + 枚举值
        flexDirection(FlexDirection.COLUMN)          // ← 函数调用 + 枚举值
        alignItems(FlexAlign.CENTER)                 // ← 同上
    }
}
```

### 常用枚举速查

| 枚举类 | 常用值 | 说明 |
|--------|--------|------|
| `FlexDirection` | COLUMN, ROW, COLUMN_REVERSE, ROW_REVERSE | 主轴方向 |
| `FlexJustifyContent` | FLEX_START, CENTER, FLEX_END, SPACE_BETWEEN, SPACE_AROUND, SPACE_EVENLY | 主轴对齐 |
| `FlexAlign` | FLEX_START, CENTER, FLEX_END, STRETCH | 交叉轴对齐 |
| `FlexPositionType` | RELATIVE, ABSOLUTE | 定位方式 |
| `FlexWrap` | NOWRAP, WRAP | 是否换行 |
| `BorderStyle` | SOLID, DOTTED, DASHED | 边框线型 |
| `Direction` (渐变) | TO_TOP, TO_BOTTOM, TO_LEFT, TO_RIGHT, ... | 渐变方向 |

---

## 错误 #11: fontWeight 传参错误 ❌→✅

**错误时间**: 2026-04-21
**影响文件**: LoginPage.kt (早期版本)

### ❌ 错误写法

```kotlin
// 写法 A: 传 Int 参数
fontWeight(600)                  // ← 无此重载

// 写法 B: 传 FontWeight 枚举（可能不存在）
fontWeight(FontWeight.Bold)     // ← Unresolved reference
```

### ✅ 正确写法

```kotlin
// Kuikly 提供专用的无参方法
Text {
    attr {
        fontWeightNormal()        // 400
        fontWeightMedium()        // 500
        fontWeightSemiBold()      // 600
        fontWeightBold()          // 700
        fontWeightExtraBold()    // 800
        fontWeightBlack()        // 900
        fontWeightLight()        // 细体 (iOS/鸿蒙)
        fontWeightExtraLight()   // 超细 (iOS/鸿蒙)
    }
}
```

### 兼容性提示

> 在个别小米机型的 MiSans（系统默认）字体中，设置 normal 以外的字重会导致韩文字符中的圆圈显示为实心圆形。

---

## 错误 #12: borderRadius 重载混淆 ❌→✅

**错误时间**: 2026-04-21
**影响文件**: LoginPage.kt, OAuthButtons.kt

### ❌ 错误写法

```kotlin
// 混淆了两种形式
borderRadius(Radius.Circle)     // ← Radius.Circle 可能不是 Float
```

### ✅ 正确写法

```kotlin
// 形式 1: 统一圆角（Float）— 最常用
borderRadius(12f)               // 四角相同
borderRadius(999f)              // 超大值 = 完全圆形（圆形头像/按钮）

// 形式 2: 四角独立圆角（BorderRectRadius 对象）
borderRadius(BorderRectRadius(
    topLeftCornerRadius = 20f,
    topRightCornerRadius = 5f,
    bottomLeftCornerRadius = 5f,
    bottomRightCornerRadius = 20f
))

// 形式 3: 项目中的常量封装
borderRadius(Radius.Circle)     // 如果 Radius.Circle 定义为 999f 则 OK
```

---

## SaUI 组件开发中发现的 API 陷阱

### 1. Input `color()` / `placeholderColor()` 需 Color 对象（非 Long）

`Input` 组件的文字颜色属性接收 `Color` 对象，而非 `Long` 值。需双层包裹：

```kotlin
// 正确
Input { attr { color(Color(Color.parseString16ToLong(SaUIColors.TextPrimarySolid))) } }

// 错误 - color() 期望 Color，传入了 Long
Input { attr { color(Color.parseString16ToLong(SaUIColors.TextPrimarySolid)) } }
```

### 2. ActivityIndicator 无 `color` 属性

Kuikly 的 `ActivityIndicator` 不提供颜色设置 API，颜色由系统默认决定。

```kotlin
// 可用
ActivityIndicator { attr { size(36f, 36f) } }

// 不可用 - ActivityIndicator 没有 color() 方法
ActivityIndicator { attr { size(36f, 36f); color(Color(...)) } }
```

### 3. 无 `WIDTH_MATCH_PARENT` / `HEIGHT_MATCH_PARENT`

Kuikly 没有 `MATCH_PARENT` 常量。实现全宽应使用 `flex(1f)`：

```kotlin
// 正确
View { attr { flex(1f) } }

// 错误 - MATCH_PARENT 不存在于 Kuikly Size 类中
View { attr { width(Size.WIDTH_MATCH_PARENT) } }
```

### 4. ViewBuilder 中禁止 `return`

`ViewBuilder`（即 `ViewContainer<*, *>.() -> Unit`）是 lambda，不能使用 `return@xxx`。必须用 `if (condition) { ... }` 包裹：

```kotlin
// 正确
fun build(visible: Boolean): ViewBuilder = {
    if (visible) {
        View { attr { absolutePosition(0f, 0f, 0f, 0f) } }
    }
}

// 错误 - return 在 ViewBuilder 中禁止
fun build(visible: Boolean): ViewBuilder = {
    if (!visible) return@build
    View { ... }
}
```

### 5. `when` 分支多语句需花括号

在 Kuikly `attr {}` 块内使用 `when` 表达式时，多语句分支必须用 `{}` 包裹：

```kotlin
// 正确
attr {
    when (placement) {
        Placement.BOTTOM -> {
            alignItems(FlexAlign.CENTER)
            justifyContent(FlexJustifyContent.FLEX_END)
        }
    }
}

// 错误 - 两个独立语句不能放在同一 when 分支中
attr {
    when (placement) {
        Placement.BOTTOM -> alignItems(FlexAlign.CENTER)
            justifyContent(FlexJustifyContent.FLEX_END)
    }
}
```

### 6. Modal 组件 API 受限

Kuikly `Modal` 组件的 `inWindow()` 和渲染行为在各版本不一致。弹窗类组件（Popup/Drawer）建议使用 **绝对定位 View + 半透明背景** 替代：

```kotlin
// 推荐：自建遮罩层
View {
    attr {
        absolutePosition(0f, 0f, 0f, 0f)
        backgroundColor(0x80000000L)
    }
    event { click { onClose() } }
    // ... 内容
}
```

### 7. Pager 中的私有方法不可直接调用

在 Pager 的 `body()` ViewBuilder 内，`this` 是 `ViewContainer` 而不是 Pager 实例。调用 Pager 的私有方法需先捕获引用：

```kotlin
class MyPage : Pager() {
    override fun body(): ViewBuilder = {
        val page = this@MyPage  // 捕获 Pager 引用
        Column {
            page.myPrivateMethod().invoke(this)
        }
    }
}
```

---

## 错误总结: 快速自查清单

在编写/修改 Kuikly UI 代码前，逐条检查：

```
□ 组件用 lambda 包裹:  Text { attr { } }  而非  Text("...")
□ 属性在 attr{} 内:    attr { text("hi") }  而非  text = "hi"
□ 事件在 event{} 内:    event { click {} }   而非  attr { onClick {} }
□ 边框用 Border():     border(Border(lw, style, c))  而非  borderWidth()
□ 颜色类型匹配:        backgroundColor(Long)  vs  Border(Color对象)
□ Button 用 titleAttr:  Button { titleAttr { text("") } }
□ 尺寸直接传 Float:   size(100f, 50f)        而非  100.dp
□ 枚举值做参数:       justifyContent(CENTER) 而非  "center"
□ 字重用专用方法:     fontWeightBold()         而非  fontWeight(700)
□ Input 颜色用 Color(): color(Color(parse(...))) 非 color(parse(...))
□ ViewBuilder 禁 return: if(cond) { ... }      非 if(!cond) return
□ Pager 方法需引用:   val page = this@Page     非 this.method()
□ 全宽用 flex(1f):    flex(1f)                 非 WIDTH_MATCH_PARENT
□ when 多句加 {}:     BOTTOM -> { a(); b() }   非 BOTTOM -> a() \n b()
□ 滚动容器给尺寸:     Scroller { flex(1f) }     非 内部内容 flex(1f)
□ 输入行用 Row:       Row { Input { flex(1f) } } 非 View + alignItems(CENTER)
□ ViewBuilder 要执行: page.card().invoke(this)  非 page.card()
□ 宿主切页判线程:     runOnUiThread { loadPage } 非 直接操作视图
```

---

---

## 运行时静默失效陷阱（真机白屏 / 空白类）

下面这几条**编译完全通过、日志无报错**，只表现为页面白屏或某一块空白，排查成本极高。
均为 2026-10-22 真机（Android + Kuikly 2.6.0-2.0.21）实测确认。

### 错误 #13: 滚动容器没有确定尺寸 → 整页不可见

`Scroller` / `List` 等滚动容器必须有确定的宽高约束。根容器不写 `flex(1f)`，
内容在滚动容器里高度计算为 0，屏幕上就是一片空白。

```kotlin
// ❌ 整页白屏（内层 Column 写 flex(1f) 更是直接塌陷为 0）
Scroller { Column { attr { flex(1f) } } }

// ✅ 滚动容器自己撑满，内容不写 flex
Scroller {
    attr { flex(1f) }
    Column { attr { padding(...) } }
}
```

**滚动容器内部的内容不要再写 `flex(1f)`** —— 在滚动方向上 flex 主尺寸不确定，
结果是塌陷而不是撑满。

### 错误 #14: 输入行用默认纵向 View + alignItems(CENTER) → Input 宽度塌陷为 0

`View` 的 flexDirection 默认是 **COLUMN**。`Row` 与 `Column` 是独立视图类，
各自显式设置 `flexDirectionRow()` / `flexDirectionColumn()`，默认 `alignItems` 为 `STRETCH`。

在纵向容器上再写 `alignItems(FlexAlign.CENTER)`，交叉轴（宽度）退化为 wrap-content：
空 `Input` 内容宽度为 0 → **placeholder 不显示、点击无焦点、键盘不弹出**，且没有任何报错。

```kotlin
// ❌ placeholder 永远不显示，输入框点不动
View {
    attr { height(44f); alignItems(FlexAlign.CENTER) }
    Input { attr { flex(1f); placeholder("手机号") } }
}

// ✅ 输入行一律用 Row：flex(1f) 才拿到整行宽度
Row {
    attr { height(44f); alignItems(FlexAlign.CENTER) }
    Input { attr { flex(1f); placeholder("手机号") } }
}
```

自查手段：`adb shell dumpsys input_method` 看 `mServedView`。
正确时是 `KRTextFieldView{... 0-824,149}`，错误时是 `DecorView`（焦点没进输入框）。

### 错误 #15: 返回 ViewBuilder 的函数漏写 `.invoke(this)` → 节点被静默丢弃

`ViewBuilder = ViewContainer<*, *>.() -> Unit` 是**函数类型**。只调用不执行，
节点不会进入视图树，也不会有任何警告。

```kotlin
// ❌ 整页空白：57 处这样写，页面一个卡片都没有
page.sectionHeader("Base 基础")
page.demoCard("Button") { ... }

// ✅
page.sectionHeader("Base 基础").invoke(this)
page.demoCard("Button") { ... }.invoke(this)
```

**不能改用 `ViewContainer<*, *>` 扩展函数来规避**：在 Kuikly 的 lambda 接收者下会编译报
`cannot be called in this context with an implicit receiver`；并且调用点必须带显式接收者
（写 `page.xxx()`，不能写成裸 `xxx()`），去掉 `page.` 前缀同样报该错。

排查脚本：`.workbuddy/tmp/audit_vb.py`（收集所有返回 ViewBuilder 的函数名，做括号配对
检查调用点是否带 `.invoke(` / `.apply(`）。改动后跑一次即可复查。

### 宿主层：Kuikly 核心不在主线程，切勿直接操作 Android 视图

Kuikly 核心跑在独立的 `KRHandlerThread`（`KuiklyRenderCoreContextScheduler` 自带 Looper）。
页面点击回调里若直接执行宿主的 `removeAllViews()` / `addView()`，会抛：

```
Only the original thread that created a view hierarchy can touch its views
```

宿主切页入口必须先做线程判定：

```kotlin
if (Looper.myLooper() != Looper.getMainLooper()) {
    runOnUiThread { loadPage(pageName) }
    return
}
```

### 宿主层：整页重建会丢失页面栈（返回键直接退出应用）

把 Kuikly 的 `RouterModule.openPage` 回接到「复用同一个 container 重新 onAttach」，
等于每跳一次就重建整个渲染视图，回退栈为空 → 返回键直接退出 App。

需要区分两类导航：
- **根页替换**（Tab 切换、登录后进主页、登出回登录页）：重建，不入栈；
- **进入子页**（组件库、绑定电脑等）：入栈，返回键弹出来源页。

---

*最后更新: 2026-10-22 | 版本: 1.2.0 (新增运行时静默失效陷阱 #13-#15 及宿主线程/页面栈)*
