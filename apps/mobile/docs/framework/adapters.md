# Kuikly 适配器详细说明

> 7 个核心适配器的实现细节和使用说明。

## 适配器概览

| 适配器 | 接口 | 类型 | 初始化时机 |
|--------|------|------|-----------|
| KRLogAdapter | IKRLogAdapter | object | Application |
| KRImageAdapter | IKRImageAdapter | class | Activity |
| KRThreadAdapter | IKRThreadAdapter | class | Application |
| KRExceptionAdapter | IKRUncaughtExceptionHandlerAdapter | object | Application |
| KRRouterAdapter | IKRRouterAdapter | class | Activity |
| KRColorParserAdapter | IKRColorParserAdapter | class | Application |
| KRFontAdapter | IKRFontAdapter | class | Application |

---

## 1. KRLogAdapter - 日志适配器

### 接口方法

```kotlin
object KRLogAdapter : IKRLogAdapter {
    override val asyncLogEnable: Boolean = false
    override fun i(tag: String, msg: String) { Log.i(tag, msg) }
    override fun d(tag: String, msg: String) { Log.d(tag, msg) }
    override fun e(tag: String, msg: String) { Log.e(tag, msg) }
}
```

### 说明

- `asyncLogEnable`：是否异步日志，设为 `false` 保证日志顺序
- 使用 Android `Log` 类输出，tag 和 msg 直接传递

### 注册方式

```kotlin
KuiklyRenderAdapterManager.krLogAdapter = KRLogAdapter
```

---

## 2. KRImageAdapter - 图片加载适配器

### 接口方法

```kotlin
class KRImageAdapter(private val context: Context) : IKRImageAdapter {
    override fun fetchDrawable(option: HRImageLoadOption, params: JSONObject?, callback: (Drawable?) -> Unit)
    override fun getDrawableWidth(ctx: KuiklyRenderViewContext, drawable: Drawable): Float
    override fun getDrawableHeight(ctx: KuiklyRenderViewContext, drawable: Drawable): Float
    override val shouldWaitViewDidLoad: Boolean = false
}
```

### 支持的图片来源

| Scheme | 示例 | 说明 |
|--------|------|------|
| `assets://` | `assets://common/ic_logo.png` | 本地 assets 资源 |
| `file://` | `file:///sdcard/image.png` | 本地文件 |
| `http(s)://` | `https://example.com/image.png` | 网络图片 |

### 实现要点

1. **线程池**：3 个线程并发加载图片
2. **回调到主线程**：使用 `Handler(Looper.getMainLooper()).post { callback(drawable) }`
3. **Bitmap 解码**：使用 `BitmapFactory.decodeStream` / `decodeByteArray`
4. **超时设置**：网络图片 15s 连接超时，30s 读取超时

### 注册方式

```kotlin
// Application 中使用 placeholder（必须先设置）
KuiklyFramework.initAdapters() // 设置 placeholder

// Activity 中覆盖真实适配器
KuiklyFramework.setImageAdapter(this) // 设置真实适配器
```

### 注意事项

> 图片适配器必须无条件覆盖 Application 的 placeholder！
> 
> Application 在 `onCreate()` 先于 Activity 执行，设置了返回 `null` 的占位适配器。
> 如果 Activity 用 `if == null` 判断，真实适配器永远不会被设置！

---

## 3. KRThreadAdapter - 线程适配器

### 接口方法

```kotlin
class KRThreadAdapter : IKRThreadAdapter {
    private val subThreadPoolExecutor by lazy { Executors.newFixedThreadPool(2) }
    
    override fun executeOnSubThread(task: () -> Unit) {
        subThreadPoolExecutor.execute { task() }
    }
    
    override fun stackSize(): Long = 0
}
```

### 说明

- 使用固定 2 线程池执行子线程任务
- `stackSize()` 返回 0，使用默认线程栈大小

### 注册方式

```kotlin
KuiklyRenderAdapterManager.krThreadAdapter = KRThreadAdapter()
```

---

## 4. KRExceptionAdapter - 异常处理适配器

### 接口方法

```kotlin
object KRExceptionAdapter : IKRUncaughtExceptionHandlerAdapter {
    override fun uncaughtException(throwable: Throwable) {
        Log.e("KuiklyException", throwable.stackTraceToString())
    }
}
```

### 说明

- 捕获 Kuikly 运行时未处理异常
- 输出完整堆栈信息到 Android Log

### 注册方式

```kotlin
KuiklyRenderAdapterManager.krUncaughtExceptionHandlerAdapter = KRExceptionAdapter
```

---

## 5. KRRouterAdapter - 路由适配器

### 接口方法

```kotlin
class KRRouterAdapter : IKRRouterAdapter {
    companion object {
        var onNavigateToPage: ((String) -> Unit)? = null
        var onClosePage: (() -> Unit)? = null
    }
    
    override fun openPage(context: Context, pageName: String, pageData: JSONObject) {
        onNavigateToPage?.invoke(pageName)
    }
    
    override fun closePage(context: Context) {
        onClosePage?.invoke()
    }
}
```

### 说明

- 通过静态回调将 Kuikly DSL 的路由调用转发到 Activity
- `openPage`：页面跳转（如 `router.openPage("ChatDetailPage")`）
- `closePage`：关闭当前页面（如 `router.closePage()`）

### 注册方式

```kotlin
KuiklyFramework.setRouterCallbacks(
    onNavigate = { pageName -> loadPage(pageName) },
    onClose = { closeCurrentPage() }
)
```

### 使用示例

在 Kuikly DSL 中：

```kotlin
Button {
    attr { text("查看详情") }
    event {
        click {
            router.openPage("ChatDetailPage", JSONObject().apply {
                put("sessionId", "123")
            })
        }
    }
}
```

---

## 6. KRColorParserAdapter - 颜色解析适配器

### 接口方法

```kotlin
class KRColorParserAdapter : IKRColorParserAdapter {
    override fun toColor(colorStr: String): Int? = colorStr.toLongOrNull()?.toInt()
}
```

### 说明

- 将颜色字符串解析为 Int 颜色值
- 支持十六进制字符串（如 `"0xFF0000"` → `0xFF0000.toInt()`）

### 注册方式

```kotlin
KuiklyRenderAdapterManager.krColorParseAdapter = KRColorParserAdapter()
```

---

## 7. KRFontAdapter - 字体适配器

### 接口方法

```kotlin
class KRFontAdapter : IKRFontAdapter {
    override fun getTypeface(fontFamily: String, result: (Typeface?) -> Unit) {
        result(null) // 使用系统默认字体
    }
}
```

### 说明

- 返回 `null` 表示使用系统默认字体
- 可扩展：根据 `fontFamily` 名称加载自定义字体文件

### 注册方式

```kotlin
KuiklyRenderAdapterManager.krFontAdapter = KRFontAdapter()
```

### 扩展示例

```kotlin
class CustomFontAdapter(private val context: Context) : IKRFontAdapter {
    override fun getTypeface(fontFamily: String, result: (Typeface?) -> Unit) {
        when (fontFamily) {
            "CustomFont" -> result(Typeface.createFromAsset(context.assets, "fonts/custom.ttf"))
            else -> result(null)
        }
    }
}
```

---

## 适配器生命周期

```
Application.onCreate()
    │
    ├── NapierInitializer.init()
    ├── PlatformContext 初始化
    ├── initAndroidApp() (Koin DI)
    │
    ├── KuiklyFramework.initAdapters()
    │       ├── KRLogAdapter ✅
    │       ├── KRImageAdapter (placeholder) ⚠️
    │       ├── KRThreadAdapter ✅
    │       ├── KRExceptionAdapter ✅
    │       ├── KRColorParserAdapter ✅
    │       └── KRFontAdapter ✅
    │
    └── AndroidApplication.initCoreEntry()

Activity.onCreate()
    │
    ├── KuiklyFramework.setImageAdapter(this)
    │       └── KRImageAdapter (真实) ✅ 覆盖 placeholder
    │
    └── KuiklyFramework.setRouterCallbacks(onNavigate, onClose)
            └── KRRouterAdapter ✅
```

---

## 扩展适配器

若需自定义适配器行为，可继承对应类并覆盖方法：

```kotlin
// 自定义日志适配器（写入文件）
class FileLogAdapter : IKRLogAdapter {
    override val asyncLogEnable: Boolean = true
    override fun i(tag: String, msg: String) { writeToFile("I", tag, msg) }
    override fun d(tag: String, msg: String) { writeToFile("D", tag, msg) }
    override fun e(tag: String, msg: String) { writeToFile("E", tag, msg) }
}

// 在 Application 中使用
KuiklyRenderAdapterManager.krLogAdapter = FileLogAdapter()
```

---

*最后更新: 2026-05-22*