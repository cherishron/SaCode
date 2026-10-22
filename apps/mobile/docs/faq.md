# 常见问题解答

这里收集了在使用 Kuikly UI 框架过程中最常见的问题及其解决方案。

## 编译和构建问题

### Q: Gradle 同步失败，提示网络错误

**A**: 这通常是由于 Maven 仓库访问问题导致的。请按以下步骤解决：

1. **检查网络连接** - 确保您能正常访问互联网
2. **更新 Maven 配置** - 确认 `settings.gradle.kts` 包含腾讯镜像：

```kotlin
allprojects {
    repositories {
        google()
        mavenCentral()
        maven {
            url = uri("https://mirrors.tencent.com/nexus/repository/maven-tencent/")
        }
    }
}
```

3. **清除缓存** - 在 Android Studio 中选择 `File → Invalidate Caches / Restart`
4. **手动删除缓存目录** - 删除项目根目录下的 `.gradle` 文件夹后重新同步

### Q: 找不到 Kuikly 相关类或方法

**A**: 这可能是因为依赖没有正确添加或 KSP 注解处理器没有运行。请检查：

1. **依赖配置** - 确保 `build.gradle.kts` 包含正确的 Kuikly 依赖：

```kotlin
dependencies {
    implementation("com.tencent.kuikly:core:2.6.0-2.0.21")
    implementation("com.tencent.kuikly:annotations:2.6.0-2.0.21")
    ksp("com.tencent.kuikly:ksp-processor:2.6.0-2.0.21")
}
```

2. **KSP 配置** - 确认启用了 Kotlin Symbol Processing：

```kotlin
plugins {
    id("org.jetbrains.kotlin.plugin.ksp")
}
```

3. **重新构建** - 运行 `./gradlew clean` 然后重新同步

### Q: 编译错误 "Cannot resolve symbol 'observable'"

**A**: 这通常是因为缺少必要的导入或响应式支持没有启用：

```kotlin
// 添加必要的导入
import com.tencent.kuikly.core.observable

// 确保在 build.gradle.kts 中添加了响应式依赖
implementation("com.tencent.kuikly:reactive:2.6.0-2.0.21")
```

## 组件开发问题

### Q: Button 点击事件不触发

**A**: 请检查事件处理器的写法是否正确：

```kotlin
// 正确写法
Button {
    titleAttr { text("点击我") }
    event {
        click { /* 处理点击逻辑 */ }
    }
}

// 错误写法（不要这样）
Button {
    attr {
        onClick { /* 错误的位置 */ }
    }
}
```

### Q: Text 组件显示空白或不正确的内容

**A**: 确保文本属性在 `attr` 块内正确设置：

```kotlin
// 正确写法
Text {
    attr {
        text("Hello World")  // 文本内容
        fontSize(16f)        // 字体大小
        color(Color.BLACK)   // 文字颜色
    }
}

// 错误写法
Text("Hello World")  // 这是错误的，Kuikly 不使用这种语法
```

### Q: 布局组件尺寸不生效

**A**: 检查尺寸属性的单位和使用方式：

```kotlin
Column {
    attr {
        // 使用 Float 类型，不是 dp 单位
        width(300f)
        height(200f)
        padding(16f)      // 内边距
        margin(8f)        // 外边距
    }
}
```

## 状态管理问题

### Q: 响应式数据变化但 UI 不更新

**A**: 确保使用了正确的响应式关键字：

```kotlin
@Page("MyPage")
class MyPage : Pager() {

    // 正确：使用 observable 关键字
    var message by observable("初始消息")

    override fun body(): ViewBuilder = {
        Text {
            attr { text(message) }  // 会自动响应 message 的变化
        }
    }
}
```

### Q: vif/vfor 指令不起作用

**A**: 检查 lambda 表达式的写法：

```kotlin
// 正确写法
vif({ isLoading }) {
    LoadingIndicator()
} velse {
    ContentView()
}

// 错误写法
vif(isLoading) {  // 缺少 lambda 括号
    LoadingIndicator()
}
```

## 性能问题

### Q: 应用运行缓慢，内存占用过高

**A**: 这可能是由于内存泄漏或不正确的资源管理导致的。请尝试：

1. **清理资源** - 在页面销毁时释放资源：

```kotlin
override fun onDispose() {
    super.onDispose()
    // 取消所有协程
    coroutineScope.cancel()
    // 清理大对象缓存
    largeCache.clear()
}
```

2. **优化列表渲染** - 使用 LazyColumn 处理大量数据：

```kotlin
LazyColumn {
    items(itemsList) { item ->
        ItemComponent(item)
    }
}
```

3. **避免不必要的重建** - 使用 remember 缓存计算结果：

```kotlin
private val expensiveData by remember {
    mutableStateOf(generateExpensiveData())
}
```

### Q: 滚动列表卡顿

**A**: 优化列表性能和数据加载：

```kotlin
// 使用 LazyColumn 替代普通 Column
LazyColumn(
    state = rememberLazyListState(),
    userScrollEnabled = true
) {
    items(items, key = { it.id }) { item ->
        // 每个 item 的渲染逻辑
    }
}

// 实现分页加载
fun loadMoreItems() {
    if (!isLoading && hasMoreItems) {
        loadNextPage()
    }
}
```

## 网络和数据问题

### Q: 网络请求失败或超时

**A**: 配置合适的网络超时和重试机制：

```kotlin
val networkModule = NetworkModule.create {
    baseUrl = "https://api.example.com"
    timeout = 30_000  // 30秒超时
    retryCount = 3    // 重试次数
}
```

### Q: JSON 序列化失败

**A**: 确保正确配置了 kotlinx.serialization：

```kotlin
// build.gradle.kts
plugins {
    id("org.jetbrains.kotlin.plugin.serialization")
}

// 数据类定义
@Serializable
data class User(
    val id: String,
    val name: String,
    val email: String
)

// 序列化使用
val json = Json.encodeToString(User.serializer(), user)
```

## 平台适配问题

### Q: Android 和 HarmonyOS 行为不一致

**A**: 检查平台特定的实现：

```kotlin
// commonMain/kotlin/com/example/platform/Platform.kt
expect class Platform() {
    val platform: String
}

// androidMain/kotlin/com/example/platform/Platform.android.kt
actual class Platform actual constructor() {
    actual val platform: String = "Android"
}

// ohosMain/kotlin/com/example/platform/Platform.ohos.kt
actual class Platform actual constructor() {
    actual val platform: String = "HarmonyOS"
}
```

### Q: 某些功能在 HarmonyOS 上不可用

**A**: 使用条件编译或平台检查：

```kotlin
@OptIn(ExperimentalStdlibApi::class)
fun getPlatformSpecificFeature(): String {
    return when (Platform().platform) {
        "Android" -> "android_feature"
        "HarmonyOS" -> "harmony_feature"
        else -> "default_feature"
    }
}
```

## 调试技巧

### Q: 如何查看应用日志

**A**: 使用 Android Studio 的 Logcat 工具：

1. 打开 **Logcat** 面板（通常在底部）
2. 选择您的设备或模拟器
3. 过滤日志标签：`Kuikly`, `App` 等
4. 查看详细错误信息

### Q: 如何调试响应式数据流

**A**: 添加调试观察者来监控数据变化：

```kotlin
var counter by observable(0)

init {
    // 调试观察者
    counter.asFlow().onEach { value ->
        println("Counter changed to: $value")
    }.launchIn(this)
}
```

## 获取更多帮助

如果以上解决方案都不能解决您的问题，请：

1. **查看官方文档** - [KuiklyUI 官方文档](https://kuikly.tds.qq.com/)
2. **搜索 GitHub Issues** - [KuiklyUI Issues](https://github.com/Tencent-TDS/KuiklyUI/issues)
3. **加入社区讨论** - [QQ 技术交流群](https://qm.qq.com/q/example)
4. **提交详细问题报告** - 包括错误日志、代码片段和环境信息

---

*最后更新: 2026-04-22*
*常见问题解答版本: v1.0*

希望这些答案能帮助您快速解决问题！