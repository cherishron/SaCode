# Kuikly UI 最佳实践

遵循这些最佳实践可以帮助您构建更高效、可维护的 Kuikly UI 应用。

## 代码组织规范

### 1. 项目结构

推荐的项目目录结构：

```
src/
├── commonMain/kotlin/
│   ├── com/example/app/
│   │   ├── core/           # 核心基础设施
│   │   ├── data/           # 数据层
│   │   ├── domain/         # 领域层
│   │   ├── router/         # 路由管理
│   │   └── ui/             # UI 组件
│   │       ├── pages/      # 页面组件
│   │       ├── components/# 可复用组件
│   │       └── themes/     # 主题定义
│   └── sqldelight/         # SQLDelight schema
├── androidMain/kotlin/
│   └── com/example/app/platform/  # Android 特定实现
└── ohosMain/kotlin/
    └── com/example/app/platform/  # HarmonyOS 特定实现
```

### 2. 文件命名规范

- **类名**: `PascalCase` (例: `UserProfilePage`)
- **文件名**: `kebab-case.kt` (例: `user-profile-page.kt`)
- **接口名**: `IPascalCase` (例: `IAuthService`)
- **常量名**: `UPPER_SNAKE_CASE` (例: `MAX_RETRY_COUNT`)

## 组件开发规范

### 1. 基础组件设计

```kotlin
@Page("BaseComponent")
abstract class BaseComponent : Pager() {

    // 抽象属性 - 子类必须实现
    protected abstract val componentId: String

    // 公共方法 - 子类可以重写
    protected open fun onInit() {
        // 初始化逻辑
    }

    override fun body(): ViewBuilder = {
        Column {
            attr { padding(16f) }

            // 渲染子内容
            renderContent()
        }
    }

    // 抽象方法 - 强制子类实现
    protected abstract fun renderContent(): Unit
}

// 具体实现
@Page("ButtonComponent")
class ButtonComponent : BaseComponent() {

    override val componentId = "button_component"

    private var title by observable("默认按钮")

    override fun onInit() {
        super.onInit()
        println("ButtonComponent initialized with ID: $componentId")
    }

    override fun renderContent(): Unit = {
        Button {
            titleAttr { text(title) }
            attr {
                backgroundColor(Color.BLUE)
                borderRadius(8f)
            }
            event { click { handleClick() } }
        }
    }

    private fun handleClick() {
        // 点击处理逻辑
    }
}
```

### 2. 组件 Props 模式

```kotlin
data class CardProps(
    val title: String,
    val content: String,
    val onClick: () -> Unit,
    val backgroundColor: Long = Color.WHITE,
    val cornerRadius: Float = 8f
)

@Composable
fun Card(props: CardProps) {
    View {
        attr {
            backgroundColor(props.backgroundColor)
            borderRadius(props.cornerRadius)
            padding(16f)
            shadow(
                offsetX = 2f,
                offsetY = 2f,
                blurRadius = 4f,
                color = Color.GRAY
            )
        }

        Column {
            Text {
                attr {
                    text(props.title)
                    fontSize(18f)
                    fontWeightBold()
                }
            }

            Spacer(height = 8.dp)

            Text {
                attr {
                    text(props.content)
                    fontSize(14f)
                    color(Color.BLACK)
                }
            }

            Spacer(height = 12.dp)

            Button {
                titleAttr { text("查看详情") }
                attr { backgroundColor(Color.LIGHT_BLUE) }
                event { click { props.onClick() } }
            }
        }
    }
}

// 使用示例
Card(
    title = "示例卡片",
    content = "这是一个使用 Props 模式的卡片组件",
    onClick = { /* 处理点击 */ },
    backgroundColor = Color.parseString16ToLong("#F0F8FF"),
    cornerRadius = 12f
)
```

## 状态管理规范

### 1. 单一状态源原则

```kotlin
class UserStateManager {
    // 集中管理用户相关状态
    var currentUser by observable<User?>(null)
    var isLoggedIn by observable(false)
    var loadingState by observable(LoadingState.IDLE)

    sealed class LoadingState {
        object IDLE : LoadingState()
        object LOADING : LoadingState()
        data class SUCCESS(val message: String) : LoadingState()
        data class ERROR(val error: Throwable) : LoadingState()
    }

    suspend fun login(username: String, password: String): Result<User> {
        return try {
            loadingState = LoadingState.LOADING

            val user = authRepository.login(username, password)
            currentUser = user
            isLoggedIn = true

            loadingState = LoadingState.SUCCESS("登录成功")
            Result.success(user)
        } catch (e: Exception) {
            loadingState = LoadingState.ERROR(e)
            Result.failure(e)
        }
    }
}
```

### 2. 响应式数据优化

```kotlin
class OptimizedStateContainer {
    // 避免不必要的更新
    private var _userData by observable(UserData())
    val userData by computed { _userData }

    // 批量更新
    fun updateUserData(updates: UserData.() -> UserData) {
        val newData = _userData.updates()
        if (newData != _userData) {
            _userData = newData
        }
    }

    // 防抖搜索
    private var searchJob: Job? = null
    fun debouncedSearch(query: String, delayMs: Long = 300) {
        searchJob?.cancel()
        searchJob = launch {
            delay(delayMs)
            performSearch(query)
        }
    }

    private suspend fun performSearch(query: String) {
        // 执行搜索逻辑
    }
}
```

## 性能优化指南

### 1. 列表渲染优化

```kotlin
@Page("OptimizedListPage")
class OptimizedListPage : Pager() {

    private val items = mutableStateOf<List<Item>>(emptyList())
    private val filteredItems by computed {
        // 计算属性自动缓存结果
        if (searchQuery.value.isEmpty()) {
            items.value
        } else {
            items.value.filter { it.name.contains(searchQuery.value, ignoreCase = true) }
        }
    }

    override fun body(): ViewBuilder = {
        Column {
            // 搜索框
            TextInput {
                attr {
                    hint("搜索...")
                    value(searchQuery.value)
                }
                event { textChange { searchQuery.value = it } }
            }

            // 优化的列表
            LazyColumn {
                // 使用 key 提高渲染效率
                items(filteredItems, key = { it.id }) { item ->
                    ItemRow(item = item)
                        .key(item.id)  // 添加键值
                }
            }
        }
    }
}
```

### 2. 内存管理最佳实践

```kotlin
@Page("MemoryManagedPage")
class MemoryManagedPage : Pager() {

    // 弱引用缓存
    private val imageCache = Collections.synchronizedMap(
        WeakHashMap<String, Bitmap>()
    )

    // 资源清理
    override fun onDispose() {
        super.onDispose()
        cleanupResources()
    }

    private fun cleanupResources() {
        // 取消所有协程
        coroutineScope.cancel()

        // 清理大对象
        largeDataCache.clear()

        // 释放图像资源
        imageCache.clear()
    }

    fun loadImageWithCache(url: String): Bitmap? {
        return imageCache[url] ?: loadAndCacheImage(url)
    }

    private fun loadAndCacheImage(url: String): Bitmap? {
        val bitmap = imageLoader.loadFromNetwork(url)
        if (bitmap != null) {
            imageCache[url] = bitmap
        }
        return bitmap
    }
}
```

## 测试策略

### 1. 单元测试规范

```kotlin
@Test
fun testUserLoginSuccess() = runTest {
    // Given - 准备测试数据
    val authService = mockk<AuthService>()
    whenever(authService.login("test", "password"))
        .thenReturn(Result.success(testUser))

    val stateManager = UserStateManager()

    // When - 执行操作
    val result = stateManager.login("test", "password")

    // Then - 验证结果
    assertTrue(result.isSuccess)
    assertEquals(testUser, stateManager.currentUser)
    assertEquals(true, stateManager.isLoggedIn)
}

@Test
fun testUserLoginFailure() = runTest {
    // Given
    val authService = mockk<AuthService>()
    val exception = RuntimeException("Invalid credentials")
    whenever(authService.login("test", "wrong"))
        .thenReturn(Result.failure(exception))

    val stateManager = UserStateManager()

    // When
    val result = stateManager.login("test", "wrong")

    // Then
    assertTrue(result.isFailure)
    assertNull(stateManager.currentUser)
    assertEquals(false, stateManager.isLoggedIn)
}
```

### 2. UI 测试规范

```kotlin
@OptIn(ExperimentalTestApi::class)
@Test
fun testButtonClickUpdatesText() {
    composeTestRule.setContent {
        TestablePage()
    }

    // 查找并点击按钮
    onNodeWithTag("update-button").performClick()

    // 验证文本更新
    onNodeWithText("Updated!").assertIsDisplayed()
}
```

## 错误处理和日志规范

### 1. 统一的错误处理

```kotlin
sealed class AppError {
    object NetworkError : AppError()
    object ValidationError : AppError()
    data class ApiError(val code: Int, val message: String) : AppError()
    data class UnknownError(val cause: Throwable) : AppError()
}

class ErrorHandler {

    suspend fun <T> safeCall(
        operation: suspend () -> T
    ): Result<T> = try {
        Result.success(operation())
    } catch (e: NetworkException) {
        Result.failure(AppError.NetworkError)
    } catch (e: ValidationException) {
        Result.failure(AppError.ValidationError)
    } catch (e: Exception) {
        Result.failure(AppError.UnknownError(e))
    }
}
```

### 2. 结构化日志记录

```kotlin
class AppLogger {
    companion object {
        private const val TAG = "KuiklyApp"

        fun debug(message: String, vararg args: Any?) {
            Log.d(TAG, formatMessage(message, *args))
        }

        fun info(message: String, vararg args: Any?) {
            Log.i(TAG, formatMessage(message, *args))
        }

        fun warn(message: String, vararg args: Any?) {
            Log.w(TAG, formatMessage(message, *args))
        }

        fun error(message: String, throwable: Throwable? = null, vararg args: Any?) {
            Log.e(TAG, formatMessage(message, *args), throwable)
        }

        private fun formatMessage(message: String, vararg args: Any?): String {
            return if (args.isEmpty()) message else String.format(message, *args)
        }
    }
}

// 使用示例
AppLogger.info("用户登录成功，用户名: {}", username)
AppLogger.error("网络请求失败", exception)
```

## 安全最佳实践

### 1. 敏感数据处理

```kotlin
class SecureStorage {
    private val encryptedPrefs by lazy {
        EncryptedSharedPreferences.create(
            context,
            "secure_prefs",
            MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
        )
    }

    fun saveSecureToken(token: String) {
        encryptedPrefs.edit().putString("auth_token", token).apply()
    }

    fun getSecureToken(): String? {
        return encryptedPrefs.getString("auth_token", null)
    }
}
```

### 2. 输入验证

```kotlin
object InputValidator {
    private val EMAIL_REGEX = Regex("^[A-Za-z0-9+_.-]+@([A-Za-z0-9.-]+\\.[A-Za-z]{2,})$")

    fun isValidEmail(email: String): Boolean {
        return email.matches(EMAIL_REGEX)
    }

    fun isValidPassword(password: String): Boolean {
        return password.length >= 8 &&
               password.any { it.isDigit() } &&
               password.any { it.isUpperCase() }
    }

    fun validatePhone(phone: String): ValidationResult {
        return when {
            phone.length != 11 -> ValidationResult.Invalid("手机号长度不正确")
            !phone.startsWith("1") -> ValidationResult.Invalid("手机号格式错误")
            else -> ValidationResult.Valid
        }
    }
}
```

## 持续集成和部署

### 1. CI/CD 配置示例

```yaml
# .github/workflows/build.yml
name: Build and Test

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  build:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Set up JDK 17
      uses: actions/setup-java@v3
      with:
        java-version: '17'
        distribution: 'temurin'
    
    - name: Grant execute permission for gradlew
      run: chmod +x gradlew
    
    - name: Build with Gradle
      run: ./gradlew build
    
    - name: Run tests
      run: ./gradlew test
    
    - name: Upload APK
      uses: actions/upload-artifact@v3
      with:
        name: app-debug.apk
        path: androidApp/build/outputs/apk/debug/app-debug.apk
```

---

*最后更新: 2026-04-22*
*Kuikly UI 最佳实践版本: v1.0*

遵循这些最佳实践将帮助您构建高质量的 Kuikly UI 应用！