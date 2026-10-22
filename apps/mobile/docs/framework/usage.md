# Kuikly Framework 使用指南

> 如何在项目中集成和使用 framework 模块。

## 快速集成

### 1. 添加模块依赖

在 `settings.gradle.kts` 中添加 framework 模块：

```kotlin
include("framework")
include("shared")
include("androidApp")
```

在 `androidApp/build.gradle.kts` 中添加依赖：

```kotlin
dependencies {
    implementation(project(":framework"))
    implementation(project(":shared"))
    // ... 其他依赖
}
```

### 2. Application 初始化

```kotlin
class AndroidApplication : Application() {
    override fun onCreate() {
        super.onCreate()

        // 1. 日志初始化（必须最先）
        NapierInitializer.init()

        // 2. 平台上下文
        platformContext = PlatformContext(this)

        // 3. Koin DI
        initAndroidApp(this)

        // 4. Kuikly 适配器初始化
        KuiklyFramework.initAdapters()

        // 5. Kuikly Core Entry（依赖 shared 模块 KSP 生成）
        kuiklyCoreEntry = KuiklyCoreEntry().apply {
            delegate = object : IKuiklyCoreEntry.Delegate {
                override fun callNative(methodId: Int, arg0: Any?, arg1: Any?, arg2: Any?, arg3: Any?, arg4: Any?, arg5: Any?): Any? = null
            }
        }
    }

    companion object {
        lateinit var platformContext: PlatformContext
        lateinit var kuiklyCoreEntry: KuiklyCoreEntry
    }
}
```

### 3. Activity 初始化

```kotlin
class MainActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 1. 设置图片适配器（覆盖 placeholder）
        KuiklyFramework.setImageAdapter(this)

        // 2. 设置路由回调
        KuiklyFramework.setRouterCallbacks(
            onNavigate = { pageName -> loadPage(pageName) },
            onClose = { closeCurrentPage() }
        )

        setContentView(R.layout.activity_main)

        // 3. 注册页面
        registerAllPages()

        // 4. 启动业务流程
        startAuthAndNavigate()
    }
}
```

---

## API 详细说明

### KuiklyFramework.initAdapters()

初始化 6 个适配器（图片为 placeholder）：

```kotlin
fun initAdapters() {
    // 日志适配器
    KuiklyRenderAdapterManager.krLogAdapter = KRLogAdapter
    
    // 图片适配器（placeholder - Activity 中必须覆盖）
    KuiklyRenderAdapterManager.krImageAdapter = placeholder
    
    // 线程适配器
    KuiklyRenderAdapterManager.krThreadAdapter = KRThreadAdapter()
    
    // 异常适配器
    KuiklyRenderAdapterManager.krUncaughtExceptionHandlerAdapter = KRExceptionAdapter
    
    // 颜色解析适配器
    KuiklyRenderAdapterManager.krColorParseAdapter = KRColorParserAdapter()
    
    // 字体适配器
    KuiklyRenderAdapterManager.krFontAdapter = KRFontAdapter()
}
```

### AndroidApplication.initCoreEntry()（内联）

`KuiklyCoreEntry` 由 shared 模块 KSP 生成，因此初始化逻辑放在 AndroidApplication 中直接内联，而非 framework 模块：

```kotlin
kuiklyCoreEntry = KuiklyCoreEntry().apply {
    delegate = object : IKuiklyCoreEntry.Delegate {
        override fun callNative(...): Any? = null
    }
}
```

### KuiklyFramework.setImageAdapter(context)

设置真实图片适配器：

```kotlin
fun setImageAdapter(context: Context) {
    KuiklyRenderAdapterManager.krImageAdapter = KRImageAdapter(context)
}
```

### KuiklyFramework.setRouterCallbacks(onNavigate, onClose)

设置路由回调：

```kotlin
fun setRouterCallbacks(
    onNavigate: (String) -> Unit,
    onClose: () -> Unit
) {
    KRRouterAdapter.onNavigateToPage = onNavigate
    KRRouterAdapter.onClosePage = onClose
    KuiklyRenderAdapterManager.krRouterAdapter = KRRouterAdapter()
}
```

---

## ContextCodeHandler 使用

### 初始化并打开页面

```kotlin
private fun loadPage(pageName: String) {
    // 1. 清理旧视图
    container.removeAllViews()

    // 2. 创建处理器
    contextCodeHandler = ContextCodeHandler(this, pageName)

    // 3. 初始化
    contextCodeHandler.initContextHandler()

    // 4. 打开页面
    contextCodeHandler.openPage(container, pageName, mapOf(
        "appId" to 1,
        "debug" to 1
    ))
}
```

### 生命周期管理

```kotlin
override fun onResume() {
    super.onResume()
    if (::contextCodeHandler.isInitialized) {
        contextCodeHandler.kuiklyRenderViewDelegator.onResume()
    }
}

override fun onPause() {
    super.onPause()
    if (::contextCodeHandler.isInitialized) {
        contextCodeHandler.kuiklyRenderViewDelegator.onPause()
    }
}

override fun onDestroy() {
    super.onDestroy()
    if (::contextCodeHandler.isInitialized) {
        contextCodeHandler.kuiklyRenderViewDelegator.onDetach()
    }
}
```

### 返回键处理

```kotlin
override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    if (event.keyCode == KeyEvent.KEYCODE_BACK && event.action == KeyEvent.ACTION_UP) {
        if (::contextCodeHandler.isInitialized) {
            if (contextCodeHandler.kuiklyRenderViewDelegator.onBackPressed()) {
                return true
            }
        }
    }
    return super.dispatchKeyEvent(event)
}
```

---

## 页面注册

在 MainActivity 中注册页面（SaUI Demo 仅需一个入口）：

### 页面栈管理

### 简单实现

```kotlin
private val pageStack = mutableListOf<String>()
private val contextHandlerStack = mutableListOf<ContextCodeHandler>()

private fun loadPage(pageName: String) {
    // ... 初始化页面
    pageStack.add(pageName)
    contextHandlerStack.add(contextCodeHandler)
}

fun closeCurrentPage() {
    if (pageStack.size <= 1) {
        finish()
        return
    }
    
    pageStack.removeLast()
    contextHandlerStack.removeLast()
    
    val previousPage = pageStack.lastOrNull()
    val previousHandler = contextHandlerStack.lastOrNull()
    
    if (previousPage != null && previousHandler != null) {
        container.removeAllViews()
        contextCodeHandler = previousHandler
        previousHandler.openPage(container, previousPage, pageData)
    } else {
        finish()
    }
}
```

---

## 常见问题

### 1. 图片无法加载

**原因**：Activity 未覆盖 Application 的 placeholder 适配器

**解决**：确保 Activity 中调用 `KuiklyFramework.setImageAdapter(this)`，且不要用 `if == null` 判断

### 2. 页面跳转不生效

**原因**：路由回调未设置或页面未注册

**解决**：
- 确保 Activity 中调用 `KuiklyFramework.setRouterCallbacks(...)`
- 确保页面已在 `registerAllPages()` 中注册

### 3. 页面白屏

**原因**：页面未注册到 BridgeManager

**解决**：检查 `registerAllPages()` 方法，确保所有 @Page 页面都已注册

### 4. KSP 页面注册遗漏

**原因**：KSP 增量编译只处理变更文件

**解决**：
- 新增页面后手动添加到 `registerAllPages()`
- 或执行 `./gradlew clean` 清理后重新构建

---

## 最佳实践

1. **初始化顺序严格遵循**：Napier → PlatformContext → Koin → Kuikly Adapters → Kuikly Core
2. **图片适配器无条件覆盖**：Application 设置 placeholder，Activity 必须覆盖
3. **路由回调尽早设置**：在 `onCreate()` 中，`setContentView()` 之前
4. **页面注册保持同步**：新增 @Page 页面后立即添加到 `registerAllPages()`
5. **生命周期正确管理**：确保 onResume/onPause/onDestroy 调用 delegator 对应方法

---

*最后更新: 2026-05-22*