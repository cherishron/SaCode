# 导航系统指南

学习 Kuikly UI 框架中的页面路由和导航管理。

## 路由基础概念

Kuikly 使用基于模块的路由系统，通过 RouterModule 实现跨页面的导航功能。

### 1. 基本页面跳转

```kotlin
@Page("HomePage")
class HomePage : Pager() {

    override fun body(): ViewBuilder = {
        Column {
            attr { allCenter() }

            Text {
                attr {
                    text("主页")
                    fontSize(24f)
                }
            }

            Button {
                titleAttr { text("前往详情页") }
                event { click { navigateToDetail() } }
            }
        }
    }

    private fun navigateToDetail() {
        val router = acquireModule(RouterModule.MODULE_NAME) as RouterModule
        router.push("DetailPage", mapOf("id" to "123"))
    }
}
```

### 2. 参数传递

```kotlin
@Page("DetailPage")
class DetailPage : Pager() {

    private var itemId by observable<String?>(null)

    override fun body(): ViewBuilder = {
        Column {
            vif({ itemId != null }) {
                Text {
                    attr {
                        text("详情页 - ID: $itemId")
                        fontSize(20f)
                    }
                }
            }

            Button {
                titleAttr { text("返回") }
                event { click { goBack() } }
            }
        }
    }

    override fun onInit(params: Map<String, Any>) {
        super.onInit(params)
        itemId = params["id"] as? String
    }

    private fun goBack() {
        val router = acquireModule(RouterModule.MODULE_NAME) as RouterModule
        router.pop()
    }
}
```

## 路由配置

### 1. 定义路由表

```kotlin
object AppRoutes {
    const val HOME = "HomePage"
    const val DETAIL = "DetailPage"
    const val SETTINGS = "SettingsPage"
    const val PROFILE = "ProfilePage"

    // 带参数的路径
    fun detailRoute(itemId: String): String = "$DETAIL?id=$itemId"
    fun profileRoute(userId: String): String = "$PROFILE?userId=$userId"
}
```

### 2. 全局路由管理

```kotlin
class RouterManager {
    private val router = acquireModule(RouterModule.MODULE_NAME) as RouterModule

    fun navigateTo(route: String, params: Map<String, Any> = emptyMap()) {
        val fullRoute = if (params.isNotEmpty()) {
            buildRouteWithParams(route, params)
        } else {
            route
        }
        router.push(fullRoute, params)
    }

    fun navigateAndReplace(route: String, params: Map<String, Any> = emptyMap()) {
        val fullRoute = buildRouteWithParams(route, params)
        router.replace(fullRoute, params)
    }

    fun navigateBack() {
        if (router.canPop()) {
            router.pop()
        }
    }

    fun navigateBackTo(route: String) {
        while (router.canPop()) {
            router.pop()
            // 检查当前页面是否是目标页面
            if (isCurrentPage(route)) break
        }
    }

    private fun buildRouteWithParams(baseRoute: String, params: Map<String, Any>): String {
        return if (params.isEmpty()) baseRoute else {
            val paramString = params.entries.joinToString("&") { (key, value) ->
                "$key=${value.toString().replace(" ", "%20")}"
            }
            "$baseRoute?$paramString"
        }
    }

    private fun isCurrentPage(targetRoute: String): Boolean {
        // 实现当前页面判断逻辑
        return false
    }
}

// 全局路由管理器实例
val routerManager by lazy { RouterManager() }
```

## 高级导航模式

### 1. 底部导航栏

```kotlin
@Page("MainTabBar")
class MainTabBar : Pager() {

    private var selectedTab by observable(0)

    override fun body(): ViewBuilder = {
        Column {
            attr { flexDirectionColumn() }

            // 底部标签栏
            Row {
                attr {
                    backgroundColor(Color.WHITE)
                    padding(8f)
                }

                TabButton(
                    title = "首页",
                    icon = "home",
                    isSelected = selectedTab == 0,
                    onClick = { selectedTab = 0 }
                )

                TabButton(
                    title = "聊天",
                    icon = "chat",
                    isSelected = selectedTab == 1,
                    onClick = { selectedTab = 1 }
                )

                TabButton(
                    title = "我的",
                    icon = "profile",
                    isSelected = selectedTab == 2,
                    onClick = { selectedTab = 2 }
                )
            }

            Divider()

            // 内容区域
            when (selectedTab) {
                0 -> HomeContent()
                1 -> ChatListContent()
                2 -> ProfileContent()
            }
        }
    }
}
```

### 2. 侧边抽屉导航

```kotlin
@Page("DrawerNavigation")
class DrawerNavigation : Pager() {

    private var drawerOpen by observable(false)

    override fun body(): ViewBuilder = {
        Column {
            attr { flexDirectionColumn() }

            // 顶部工具栏
            TopAppBar {
                attr {
                    title("应用标题")
                    navigationIcon("menu") {
                        // 打开抽屉
                    }
                }
            }

            // 主内容区域
            ContentArea()

            // 抽屉菜单
            vif({ drawerOpen }) {
                DrawerMenu {
                    attr { width(250f) }

                    DrawerItem(
                        icon = "home",
                        title = "首页",
                        onClick = { closeDrawer(); navigateTo("HomePage") }
                    )

                    DrawerItem(
                        icon = "chat",
                        title = "聊天",
                        onClick = { closeDrawer(); navigateTo("ChatListPage") }
                    )

                    DrawerDivider()

                    DrawerItem(
                        icon = "settings",
                        title = "设置",
                        onClick = { closeDrawer(); navigateTo("SettingsPage") }
                    )
                }
            }
        }
    }

    private fun closeDrawer() {
        drawerOpen = false
    }
}
```

### 3. 堆栈式导航

```kotlin
@Page("StackNavigation")
class StackNavigation : Pager() {

    private val navigationStack = mutableListOf<String>()

    override fun body(): ViewBuilder = {
        Column {
            attr { flexDirectionColumn() }

            // 面包屑导航
            BreadcrumbNavigation()

            // 主内容区域
            StackContentView()
        }
    }

    fun pushTo(page: String, params: Map<String, Any> = emptyMap()) {
        navigationStack.add(page)
        routerManager.navigateTo(page, params)
    }

    fun popFrom(): String? {
        return if (navigationStack.isNotEmpty()) {
            val removed = navigationStack.removeLast()
            routerManager.navigateBack()
            removed
        } else null
    }

    fun popToRoot() {
        navigationStack.clear()
        routerManager.navigateBack()
    }
}
```

## 导航守卫

### 1. 权限验证

```kotlin
abstract class ProtectedPage : Pager() {

    protected abstract fun getRequiredPermission(): String

    override fun beforeNavigate(): Boolean {
        val user = getUserFromStorage()
        return if (user.hasPermission(getRequiredPermission())) {
            true
        } else {
            showPermissionDeniedDialog()
            false
        }
    }

    private fun getUserFromStorage(): User {
        return storageModule.getObject<User>("current_user") ?: User.empty()
    }

    private fun showPermissionDeniedDialog() {
        AlertDialog {
            titleAttr { text("权限不足") }
            messageAttr { text("您没有访问此页面的权限") }
            positiveButtonAttr { text("确定") }
        }
    }
}

@Page("AdminPanel")
class AdminPanel : ProtectedPage() {

    override fun getRequiredPermission(): String = "admin_access"

    override fun body(): ViewBuilder = {
        Column {
            Text {
                attr {
                    text("管理员面板")
                    fontSize(24f)
                }
            }

            // 管理员专属功能
            AdminControls()
        }
    }
}
```

### 2. 数据预加载

```kotlin
@Page("DataPreloadPage")
class DataPreloadPage : Pager() {

    private var isDataLoaded by observable(false)
    private var loadingError by observable<Throwable?>(null)

    override fun onInit(params: Map<String, Any>) {
        super.onInit(params)
        preloadData(params)
    }

    private fun preloadData(params: Map<String, Any>) {
        launch {
            try {
                val data = loadDataFromNetwork(params)
                updateUI(data)
            } catch (e: Exception) {
                loadingError = e
            }
        }
    }

    private suspend fun loadDataFromNetwork(params: Map<String, Any>): PageData {
        delay(2000) // 模拟网络请求
        return PageData.fromParams(params)
    }

    private fun updateUI(data: PageData) {
        runOnUiThread {
            isDataLoaded = true
            // 更新 UI
        }
    }

    override fun body(): ViewBuilder = {
        Column {
            vif({ !isDataLoaded && loadingError == null }) {
                LoadingIndicator()
            }

            vif({ loadingError != null }) {
                ErrorView(
                    error = loadingError!!,
                    onRetry = { preloadData(getCurrentParams()) }
                )
            }

            vif({ isDataLoaded }) {
                LoadedContentView()
            }
        }
    }
}
```

## 导航动画

### 1. 自定义转场动画

```kotlin
@Page("AnimatedTransitionPage")
class AnimatedTransitionPage : Pager() {

    override fun getTransitionAnimation(): TransitionAnimation {
        return SlideInFromRightAnimation()
    }
}

class SlideInFromRightAnimation : TransitionAnimation {

    override fun animateEnter(duration: Long) {
        // 实现从右侧滑入的动画效果
        startAnimation(
            fromX = 1.0f,
            toX = 0.0f,
            duration = duration
        )
    }

    override fun animateExit(duration: Long) {
        // 实现向左滑出的动画效果
        startAnimation(
            fromX = 0.0f,
            toX = -1.0f,
            duration = duration
        )
    }
}
```

### 2. 共享元素动画

```kotlin
@Page("SharedElementPage")
class SharedElementPage : Pager() {

    private var sharedElements = listOf<SharedElement>()

    override fun prepareForTransition(elements: List<SharedElement>) {
        sharedElements = elements
        setupSharedElementAnimations()
    }

    private fun setupSharedElementAnimations() {
        sharedElements.forEach { element ->
            element.startSharedTransition()
        }
    }
}
```

## 测试导航

### 1. 单元测试

```kotlin
@Test
fun testNavigationFlow() {
    val routerManager = RouterManager()

    // 测试页面跳转
    routerManager.navigateTo("DetailPage", mapOf("id" to "123"))

    // 验证路由参数正确传递
    assertEquals("123", getCurrentPageParam("id"))
}

@Test
fun testProtectedPageAccess() {
    val adminPanel = AdminPanel()
    adminPanel.setUser(User.withoutPermission("admin_access"))

    // 测试无权限访问
    assertFalse(adminPanel.beforeNavigate())
}
```

### 2. 集成测试

```kotlin
@Test
fun testFullNavigationScenario() = runTest {
    // 模拟用户导航流程
    val scenario = NavigationScenario()

    // 开始导航
    scenario.startAt("HomePage")

    // 点击跳转按钮
    scenario.clickButton("gotoDetail")

    // 验证跳转到详情页
    assertEquals("DetailPage", scenario.getCurrentPage())

    // 返回上一页
    scenario.goBack()

    // 验证回到首页
    assertEquals("HomePage", scenario.getCurrentPage())
}
```

## 最佳实践

### 1. 路由设计原则

- **单一职责**: 每个页面只负责一个主要功能
- **参数验证**: 对所有传入参数进行验证
- **错误处理**: 提供友好的错误提示
- **性能优化**: 避免不必要的页面重建

### 2. 导航状态管理

```kotlin
class NavigationState {
    var currentPage by observable<String?>(null)
    var previousPages by observable<List<String>>(emptyList())
    var navigationHistory by observable<List<NavigationEntry>>(emptyList())

    fun recordNavigation(from: String?, to: String, params: Map<String, Any>) {
        val entry = NavigationEntry(
            fromPage = from,
            toPage = to,
            timestamp = System.currentTimeMillis(),
            params = params
        )
        navigationHistory = navigationHistory + entry
    }
}
```

### 3. 内存管理

```kotlin
class NavigationLifecycleManager {
    private val pageCache = LruCache<String, WeakReference<Pager>>(10)

    fun clearUnusedPages() {
        pageCache.evictAll()
    }

    fun cachePage(page: Pager) {
        pageCache.put(page.getRouteName(), WeakReference(page))
    }

    fun getCachedPage(route: String): Pager? {
        return pageCache.get(route)?.get()
    }
}
```

---

*最后更新: 2026-04-22*
*参考文档: [RouterModule API](https://kuikly.tds.qq.com/API/modules/router/)*