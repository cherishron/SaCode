# 组件开发指南

学习如何在 Kuikly UI 框架中创建自定义组件。

## 基础概念

Kuikly 组件是基于 Kotlin DSL 的声明式 UI 构建系统。每个组件都继承自基础 View 类，通过属性配置和事件处理来定义行为。

## 创建自定义组件

### 1. 定义组件类

```kotlin
@Page("CustomButton")
class CustomButton : Pager() {

    // 响应式数据
    var title by observable("默认文本")
    var isEnabled by observable(true)

    override fun body(): ViewBuilder = {
        Button {
            titleAttr { text(title) }
            attr {
                size(200f, 44f)
                backgroundColor(if (isEnabled) Color.BLUE else Color.GRAY)
                borderRadius(8f)
                opacity(if (isEnabled) 1.0f else 0.5f)
            }
            event {
                click {
                    if (isEnabled) {
                        // 处理点击逻辑
                        println("按钮被点击")
                    }
                }
            }
        }
    }
}
```

### 2. 添加组件属性

```kotlin
@Page("StyledCard")
class StyledCard : Pager() {

    var cornerRadius by observable(8f)
    var shadowOffset by observable(2f)
    var backgroundColor by observable(Color.WHITE)

    override fun body(): ViewBuilder = {
        View {
            attr {
                backgroundColor(backgroundColor)
                borderRadius(cornerRadius)
                padding(16f)
                margin(8f)

                // 阴影效果
                shadow(
                    offsetX = shadowOffset,
                    offsetY = shadowOffset,
                    blurRadius = 4f,
                    color = Color.GRAY
                )
            }

            // 内容区域
            Column {
                children()
            }
        }
    }

    // 添加子组件支持
    operator fun invoke(content: () -> Unit) {
        children = content
    }
}
```

### 3. 使用自定义组件

```kotlin
@Page("DemoPage")
class DemoPage : Pager() {

    override fun body(): ViewBuilder = {
        Column {
            attr {
                flexDirectionColumn()
                padding(16f)
            }

            // 使用自定义按钮
            CustomButton {
                title = "点击我"
                isEnabled = true
            }

            // 使用自定义卡片
            StyledCard {
                Text {
                    attr {
                        text("这是一个卡片组件")
                        fontSize(16f)
                        color(Color.BLACK)
                    }
                }
            }
        }
    }
}
```

## 高级特性

### 1. 动态样式

```kotlin
@Page("DynamicStyleComponent")
class DynamicStyleComponent : Pager() {

    var theme by observable("light")

    private val lightTheme = Theme(
        backgroundColor = Color.WHITE,
        textColor = Color.BLACK,
        accentColor = Color.BLUE
    )

    private val darkTheme = Theme(
        backgroundColor = Color.BLACK,
        textColor = Color.WHITE,
        accentColor = Color.CYAN
    )

    override fun body(): ViewBuilder = {
        View {
            attr {
                backgroundColor(lightTheme.backgroundColor)
            }

            Text {
                attr {
                    text("主题示例")
                    color(themeColor)
                }
            }
        }
    }

    private val themeColor: Long
        get() = if (theme == "light") lightTheme.textColor else darkTheme.textColor
}
```

### 2. 动画集成

```kotlin
@Page("AnimatedComponent")
class AnimatedComponent : Pager() {

    var isExpanded by observable(false)

    override fun body(): ViewBuilder = {
        Column {
            attr {
                padding(16f)
            }

            // 触发按钮
            Button {
                titleAttr { text(if (isExpanded) "收起" else "展开") }
                event { click { isExpanded = !isExpanded } }
            }

            // 可折叠内容
            vif({ isExpanded }) {
                View {
                    attr {
                        height(100f)
                        backgroundColor(Color.LIGHT_GRAY)
                    }
                    animate {
                        transition {
                            from { height(0f) }
                            to { height(100f) }
                            duration(300)
                            easing(Easing.EASE_IN_OUT)
                        }
                    }
                }
            }
        }
    }
}
```

## 最佳实践

### 1. 性能优化

```kotlin
@Page("OptimizedComponent")
class OptimizedComponent : Pager() {

    // 使用 remember 避免重复计算
    private val expensiveData by remember {
        mutableStateOf(generateExpensiveData())
    }

    // 使用 LazyColumn 处理大量数据
    override fun body(): ViewBuilder = {
        LazyColumn {
            items(itemsList) { item ->
                ItemView(item)
            }
        }
    }
}
```

### 2. 可复用性设计

```kotlin
// 通用卡片组件
@Composable
fun CardComponent(
    title: String,
    content: @Composable () -> Unit,
    modifier: Modifier = Modifier
) {
    View(modifier) {
        attr {
            backgroundColor(Color.WHITE)
            borderRadius(8f)
            padding(16f)
            margin(8f)
            shadow(
                offsetX = 1f,
                offsetY = 1f,
                blurRadius = 3f,
                color = Color.GRAY
            )
        }

        Column {
            Text {
                attr {
                    text(title)
                    fontSize(18f)
                    fontWeightBold()
                    color(Color.BLACK)
                }
            }

            Spacer(height = 8.dp)

            content()
        }
    }
}
```

## 测试自定义组件

### 1. 单元测试

```kotlin
@Test
fun testCustomButton() {
    // 测试组件初始化
    val component = CustomButton()
    assertEquals("默认文本", component.title)
    assertTrue(component.isEnabled)

    // 测试属性变化
    component.title = "新文本"
    assertEquals("新文本", component.title)
}
```

### 2. UI 测试

```kotlin
@Test
fun testButtonClick() {
    composeTestRule.setContent {
        CustomButton {
            title = "测试按钮"
        }
    }

    // 查找并点击按钮
    onNodeWithText("测试按钮").performClick()

    // 验证结果
    verifyInteraction()
}
```

## 常见问题

### Q: 如何确保组件的可访问性？
A: 为组件添加语义标签：
```kotlin
attr {
    accessibilityLabel("自定义按钮")
    accessibilityHint("双击以执行操作")
}
```

### Q: 如何处理组件间的复杂交互？
A: 使用状态管理或事件总线：
```kotlin
// 发布事件
EventBus.publish(CustomEvent(data))

// 订阅事件
EventBus.subscribe<CustomEvent> { event ->
    handleEvent(event.data)
}
```

---

*最后更新: 2026-04-22*
*参考文档: [KuiklyUI 官方文档](https://kuikly.tds.qq.com/API/components/)*