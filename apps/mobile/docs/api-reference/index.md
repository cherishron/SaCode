# Kuikly UI API 参考

完整的 API 接口文档，涵盖所有组件、模块和框架功能的详细说明。

## 核心组件 API

### View 基础组件

```kotlin
View {
    // 属性设置
    attr {
        backgroundColor(Color.BLUE)     // 背景颜色
        opacity(0.8f)                  // 透明度 (0.0 - 1.0)
        borderRadius(8f)               // 圆角半径
        width(200f)                    // 宽度
        height(100f)                   // 高度
        margin(16f)                    // 外边距
        padding(8f)                    // 内边距
    }

    // 事件处理
    event {
        click { /* 点击事件 */ }
        longClick { /* 长按事件 */ }
    }
}
```

### Text 文本组件

```kotlin
Text {
    attr {
        text("Hello World")            // 文本内容
        fontSize(16f)                  // 字体大小
        color(Color.BLACK)             // 文字颜色
        fontWeightBold()              // 字体粗细
        lineHeight(24f)               // 行高
    }
}
```

### Button 按钮组件

```kotlin
Button {
    titleAttr { text("确定") }          // 按钮文字
    attr {
        size(200f, 44f)               // 宽度和高度
        backgroundColor(Color.BLUE)     // 背景色
        borderRadius(4f)              // 圆角
    }
    event { click { /* 处理点击 */ } }
}
```

## 布局容器 API

### Column 垂直布局

```kotlin
Column {
    attr {
        flexDirectionColumn()         // 垂直方向
        justifyContent(CENTER)        // 主轴对齐
        alignItems(CENTER)           // 交叉轴对齐
        padding(16f)                 // 内边距
    }
}
```

### Row 水平布局

```kotlin
Row {
    attr {
        flexDirectionRow()            // 水平方向
        justifyContent(SPACE_BETWEEN) // 主轴分布
        alignItems(CENTER)           // 交叉轴对齐
    }
}
```

## 表单组件 API

### TextInput 文本输入

```kotlin
TextInput {
    attr {
        hint("请输入内容")              // 提示文字
        maxLength(50)                 // 最大长度
        keyboardType(KEYBOARD_TYPE_TEXT) // 键盘类型
    }
    event { textChange { text -> /* 文本变化 */ } }
}
```

### Checkbox 复选框

```kotlin
Checkbox {
    attr {
        checked(true)                // 是否选中
        size(20f, 20f)              // 尺寸
    }
    event { checkChange { isChecked -> /* 状态变化 */ } }
}
```

## 选择器组件 API

### DatePicker 日期选择

```kotlin
DatePicker {
    attr {
        date(System.currentTimeMillis()) // 当前日期
        minDate(minTimestamp)          // 最小日期
        maxDate(maxTimestamp)          // 最大日期
    }
    event { dateSelected { date -> /* 日期选择 */ } }
}
```

## 效果组件 API

### Shadow 阴影效果

```kotlin
View {
    attr {
        shadow(
            offsetX = 2f,
            offsetY = 2f,
            blurRadius = 4f,
            color = Color.GRAY
        )
    }
}
```

### Border 边框样式

```kotlin
View {
    attr {
        border(
            width = 1f,
            style = BorderStyle.SOLID,
            color = Color.BLUE
        )
    }
}
```

## 动画组件 API

### Transition 转场动画

```kotlin
Text {
    attr { text("Animated Text") }
    animate {
        transition {
            from { opacity(0f) }
            to { opacity(1f) }
            duration(500)
            easing(Easing.EASE_IN_OUT)
        }
    }
}
```

### Transform 变形动画

```kotlin
View {
    animate {
        transform {
            scaleX(1.0f) to scaleX(1.5f)
            rotation(0f) to rotation(360f)
            duration(1000)
        }
    }
}
```

## 模块系统 API

### NetworkModule 网络模块

```kotlin
val network = getModule<NetworkModule>()

// GET 请求
network.get("https://api.example.com/data") { response ->
    println(response)
}

// POST 请求
network.post("https://api.example.com/send", data) { response ->
    println(response)
}
```

### StorageModule 存储模块

```kotlin
val storage = getModule<StorageModule>()

// 保存数据
storage.setString("key", "value")

// 获取数据
val value = storage.getString("key")
```

## 响应式数据 API

### observable 响应式变量

```kotlin
var message by observable("")
var count by observable(0)
var isLoading by observable(false)

// UI 自动更新
fun updateUI() {
    if (isLoading) {
        showLoading()
    } else {
        showContent(message)
    }
}
```

### vfor 列表渲染

```kotlin
val items = listOf("A", "B", "C")

vfor(item in items) { index, item ->
    Text {
        attr { text(item) }
    }
}
```

### vif 条件渲染

```kotlin
vif({ isLoading }) {
    LoadingIndicator()
} velse {
    Text { attr { text("加载完成") } }
}
```

## 路由系统 API

### RouterModule 路由模块

```kotlin
val router = acquireModule(RouterModule.MODULE_NAME) as RouterModule

// 页面跳转
router.push("ChatDetailPage", pageData)

// 返回上一页
router.pop()

// 替换当前页面
router.replace("LoginPage")
```

## 平台适配 API

### Expect/Actual 多平台实现

```kotlin
// 公共接口定义
expect class Platform() {
    val platform: String
}

// Android 实现
actual class Platform actual constructor() {
    actual val platform: String = "Android"
}

// HarmonyOS 实现  
actual class Platform actual constructor() {
    actual val platform: String = "HarmonyOS"
}
```

## 主题系统 API

### AppTheme 应用主题

```kotlin
AppTheme {
    // 应用根组件
    LoginPage()
}
```

## 颜色系统 API

### Color 颜色定义

```kotlin
// 预定义颜色
Color.WHITE
Color.BLACK
Color.RED
Color.GREEN
Color.BLUE

// 自定义颜色
Color(0xFF5733.toLong())

// 16进制字符串转换
Color.parseString16ToLong("#FF5733")
```

## 枚举常量

### FlexBox 布局枚举

```kotlin
enum class FlexDirection {
    COLUMN,      // 垂直方向
    ROW,         // 水平方向
    COLUMN_REVERSE, // 反向垂直
    ROW_REVERSE   // 反向水平
}

enum class JustifyContent {
    FLEX_START,  // 起点对齐
    CENTER,      // 居中对齐
    FLEX_END,    // 终点对齐
    SPACE_BETWEEN, // 两端对齐
    SPACE_AROUND,  // 均匀分布
    SPACE_EVENLY   // 等间距
}

enum class AlignItems {
    FLEX_START,  // 起点对齐
    CENTER,      // 居中对齐
    FLEX_END,    // 终点对齐
    STRETCH      // 拉伸填充
}
```

## 事件系统

### 通用事件处理器

```kotlin
event {
    click { /* 点击事件 */ }
    longClick { /* 长按事件 */ }
    focus { /* 获得焦点 */ }
    blur { /* 失去焦点 */ }
    scroll { /* 滚动事件 */ }
}
```

## 性能优化 API

### 懒加载组件

```kotlin
LazyColumn {
    items(itemsList) { item ->
        ItemComponent(item)
    }
}
```

---

*API 版本: Kuikly UI v2.6.0-2.0.21*
*最后更新: 2026-04-22*