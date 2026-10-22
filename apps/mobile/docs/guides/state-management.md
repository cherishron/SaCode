# 状态管理指南

学习如何在 Kuikly UI 框架中有效管理应用状态。

## 响应式数据基础

Kuikly 使用 `observable` 关键字创建响应式数据，当数据变化时自动触发 UI 更新。

### 1. 基本响应式变量

```kotlin
@Page("BasicState")
class BasicState : Pager() {

    // 字符串响应式变量
    var message by observable("Hello World")

    // 数值响应式变量
    var counter by observable(0)

    // 布尔响应式变量
    var isLoading by observable(false)

    override fun body(): ViewBuilder = {
        Column {
            attr { allCenter() }

            Text {
                attr {
                    text(message)
                    fontSize(24f)
                }
            }

            Button {
                titleAttr { text("计数: $counter") }
                event { click { counter++ } }
            }

            vif({ isLoading }) {
                LoadingIndicator()
            }
        }
    }
}
```

### 2. 复杂对象响应式

```kotlin
data class UserProfile(
    val name: String,
    val email: String,
    val avatar: String?,
    val preferences: UserPreferences
)

data class UserPreferences(
    val theme: String,
    val language: String,
    val notifications: Boolean
)

@Page("ComplexState")
class ComplexState : Pager() {

    var userProfile by observable(
        UserProfile(
            name = "默认用户",
            email = "user@example.com",
            avatar = null,
            preferences = UserPreferences(
                theme = "light",
                language = "zh-CN",
                notifications = true
            )
        )
    )

    override fun body(): ViewBuilder = {
        ScrollView {
            Column {
                attr { padding(16f) }

                // 头像显示
                if (userProfile.avatar != null) {
                    Image {
                        attr {
                            uri(userProfile.avatar)
                            size(100f, 100f)
                            borderRadius(50f)
                        }
                    }
                }

                // 用户信息
                Text {
                    attr {
                        text(userProfile.name)
                        fontSize(20f)
                        fontWeightBold()
                    }
                }

                Text {
                    attr {
                        text(userProfile.email)
                        color(Color.GRAY)
                    }
                }

                // 主题设置
                Row {
                    Text { attr { text("主题") } }
                    Spacer(flex = 1f)
                    DropdownPicker {
                        attr {
                            selectedValue(userProfile.preferences.theme)
                            options(listOf("light", "dark"))
                        }
                        event { selectionChange { theme -> updateTheme(theme) } }
                    }
                }
            }
        }
    }

    private fun updateTheme(newTheme: String) {
        userProfile = userProfile.copy(
            preferences = userProfile.preferences.copy(theme = newTheme)
        )
    }
}
```

## 状态容器模式

对于复杂的状态管理，推荐使用状态容器模式。

### 1. 创建状态容器

```kotlin
class AppStateContainer {
    var currentUser by observable<User?>(null)
    var chatSessions by observable<List<ChatSession>>(emptyList())
    var isAuthenticated by observable(false)
    var networkStatus by observable(NetworkStatus.ONLINE)

    // 计算属性
    val unreadCount by computed {
        chatSessions.sumOf { it.unreadCount }
    }

    // 派生状态
    val hasActiveChats by computed {
        chatSessions.any { !it.isArchived }
    }

    // 状态操作方法
    fun login(user: User) {
        currentUser = user
        isAuthenticated = true
        loadChatSessions()
    }

    fun logout() {
        currentUser = null
        chatSessions = emptyList()
        isAuthenticated = false
    }

    fun addChatSession(session: ChatSession) {
        chatSessions = chatSessions + session
    }

    fun updateChatSession(sessionId: String, updates: ChatSession.() -> ChatSession) {
        chatSessions = chatSessions.map { session ->
            if (session.id == sessionId) session.updates() else session
        }
    }

    private fun loadChatSessions() {
        // 异步加载聊天会话
        launch {
            try {
                val sessions = chatRepository.getSessions(currentUser!!.id)
                chatSessions = sessions
            } catch (e: Exception) {
                // 处理错误
            }
        }
    }
}

// 全局状态容器实例
val appState by lazy { AppStateContainer() }
```

### 2. 在页面中使用状态容器

```kotlin
@Page("StateContainerDemo")
class StateContainerDemo : Pager() {

    private val state = appState

    override fun body(): ViewBuilder = {
        Column {
            attr { flexDirectionColumn() }

            // 显示未读消息数
            Text {
                attr {
                    text("未读消息: ${state.unreadCount}")
                    fontWeightBold()
                    color(Color.BLUE)
                }
            }

            // 登录/登出按钮
            vif({ !state.isAuthenticated }) {
                Button {
                    titleAttr { text("登录") }
                    event { click { showLoginScreen() } }
                }
            } velse {
                Button {
                    titleAttr { text("登出") }
                    event { click { state.logout() } }
                }
            }

            // 聊天会话列表
            vif({ state.hasActiveChats }) {
                LazyColumn {
                    items(state.chatSessions) { session ->
                        SessionItem(
                            session = session,
                            onClick = { openChat(session.id) }
                        )
                    }
                }
            }
        }
    }

    private fun showLoginScreen() {
        // 显示登录界面
    }

    private fun openChat(sessionId: String) {
        // 打开聊天界面
        router.push("ChatDetailPage?sessionId=$sessionId")
    }
}
```

## 异步状态处理

### 1. 加载状态管理

```kotlin
class AsyncData<T> {
    var data: T? by observable(null)
    var isLoading by observable(false)
    var error by observable<Throwable?>(null)

    suspend fun loadData(dataLoader: suspend () -> T): Result<T> {
        return try {
            isLoading = true
            error = null
            
            val result = dataLoader()
            data = result
            Result.success(result)
        } catch (e: Exception) {
            error = e
            Result.failure(e)
        } finally {
            isLoading = false
        }
    }
}

@Page("AsyncStateDemo")
class AsyncStateDemo : Pager() {

    private val userData = AsyncData<User>()

    override fun body(): ViewBuilder = {
        Column {
            attr { allCenter() }

            vif({ userData.isLoading }) {
                CircularProgressIndicator()
            } velse {
                vif({ userData.error != null }) {
                    ErrorView(
                        error = userData.error!!,
                        onRetry = { loadUserData() }
                    )
                } velse {
                    vif({ userData.data != null }) {
                        UserProfileView(user = userData.data!!)
                    }
                }
            }
        }
    }

    init {
        loadUserData()
    }

    private fun loadUserData() {
        launch {
            userData.loadData {
                userRepository.getCurrentUser()
            }
        }
    }
}
```

### 2. 流式数据处理

```kotlin
class StreamProcessor<T> {
    private val _items = mutableListOf<T>()
    val items by observable(_items.toList())

    private val _isProcessing by observable(false)
    val isProcessing by observable(_isProcessing)

    suspend fun processStream(stream: Flow<T>) {
        _isProcessing = true
        _items.clear()

        try {
            stream.collect { item ->
                _items.add(item)
                // 通知 UI 更新（通过 observable）
            }
        } finally {
            _isProcessing = false
        }
    }
}

// 使用示例
@Page("StreamDemo")
class StreamDemo : Pager() {

    private val processor = StreamProcessor<String>()

    override fun body(): ViewBuilder = {
        Column {
            Button {
                titleAttr { text("开始流式处理") }
                event { startStreamProcessing() }
            }

            vif({ processor.isProcessing }) {
                Text { attr { text("处理中...") } }
            }

            LazyColumn {
                items(processor.items) { item ->
                    Text {
                        attr {
                            text(item)
                            padding(8f)
                        }
                    }
                }
            }
        }
    }

    private fun startStreamProcessing() {
        launch {
            processor.processStream(
                aiService.streamReply("session_123", "生成一些测试数据")
            )
        }
    }
}
```

## 状态持久化

### 1. 本地存储集成

```kotlin
class PersistentStateManager {
    private val storageModule = getModule<StorageModule>()

    fun saveUserPreferences(preferences: UserPreferences) {
        storageModule.setString("user_preferences", Json.encodeToString(preferences))
    }

    fun loadUserPreferences(): UserPreferences? {
        return try {
            val json = storageModule.getString("user_preferences")
            if (json != null) {
                Json.decodeFromString<UserPreferences>(json)
            } else {
                defaultPreferences()
            }
        } catch (e: Exception) {
            defaultPreferences()
        }
    }

    private fun defaultPreferences(): UserPreferences {
        return UserPreferences(
            theme = "light",
            language = "zh-CN",
            notifications = true
        )
    }
}

@Page("PersistentState")
class PersistentState : Pager() {

    private val stateManager = PersistentStateManager()
    var preferences by observable<UserPreferences>(stateManager.loadUserPreferences() ?: defaultPreferences())

    override fun body(): ViewBuilder = {
        Column {
            Switch {
                attr {
                    checked(preferences.notifications)
                }
                event { checkChange { checked ->
                    preferences = preferences.copy(notifications = checked)
                    stateManager.saveUserPreferences(preferences)
                } }
            }

            Text {
                attr { text("当前语言: ${preferences.language}") }
            }
        }
    }
}
```

## 性能优化技巧

### 1. 选择性更新

```kotlin
@Page("OptimizedUpdates")
class OptimizedUpdates : Pager() {

    // 避免不必要的更新
    var userData by observable(UserData())
    var lastUpdateTime by observable(0L)

    // 批量更新
    fun updateMultipleFields(updates: UserData.() -> UserData) {
        val newData = userData.updates()
        if (newData != userData) {
            userData = newData
            lastUpdateTime = System.currentTimeMillis()
        }
    }

    // 防抖更新
    private var debounceTimer: Job? = null
    fun debouncedSearch(query: String) {
        debounceTimer?.cancel()
        debounceTimer = delay(300)
            .let { launch { performSearch(query) } }
    }
}
```

### 2. 内存管理

```kotlin
@Page("MemoryManagement")
class MemoryManagement : Pager() {

    // 清理资源
    override fun onDispose() {
        super.onDispose()
        // 取消所有协程
        coroutineScope.cancel()
        // 清理大对象
        largeDataCache.clear()
    }

    // 弱引用缓存
    private val cache = Collections.synchronizedMap(
        WeakHashMap<String, Bitmap>()
    )

    fun getCachedImage(key: String): Bitmap? {
        return cache[key] ?: loadAndCacheImage(key)
    }

    private fun loadAndCacheImage(key: String): Bitmap? {
        val bitmap = imageLoader.loadImage(key)
        if (bitmap != null) {
            cache[key] = bitmap
        }
        return bitmap
    }
}
```

## 测试状态管理

### 1. 单元测试

```kotlin
@Test
fun testStateContainer() {
    val container = AppStateContainer()

    // 测试初始状态
    assertEquals(false, container.isAuthenticated)
    assertTrue(container.chatSessions.isEmpty())

    // 测试登录
    container.login(testUser)

    assertEquals(true, container.isAuthenticated)
    assertEquals(testUser, container.currentUser)
    assertFalse(container.chatSessions.isEmpty())
}

@Test
fun testAsyncData() {
    val asyncData = AsyncData<String>()
    val testData = "test"

    runBlocking {
        val result = asyncData.loadData {
            delay(100) // 模拟网络延迟
            testData
        }

        assertTrue(asyncData.isLoading)
        assertEquals(testData, asyncData.data)
        assertEquals(null, asyncData.error)
    }
}
```

### 2. 集成测试

```kotlin
@Test
fun testStateFlowIntegration() = runTest {
    val container = AppStateContainer()
    
    // 监听状态变化
    val job = launch {
        container.isAuthenticated.asFlow().collect { isAuth ->
            assertEquals(isAuth, expectedValue)
        }
    }

    // 触发状态变化
    container.login(testUser)

    job.cancel()
}
```

## 最佳实践总结

1. **单一职责**: 每个状态容器只负责一个领域的状态
2. **不可变性**: 使用 copy()方法创建新状态，避免直接修改
3. **异步安全**: 确保状态操作是线程安全的
4. **错误处理**: 妥善处理异步操作的异常情况
5. **性能监控**: 监控状态更新的频率和性能影响
6. **测试覆盖**: 为状态逻辑编写充分的测试用例

---

*最后更新: 2026-04-22*
*参考文档: [KuiklyUI 状态管理](https://kuikly.tds.qq.com/API/components/state-management/)*