package com.sa.demo

import android.os.Bundle
import android.view.KeyEvent
import android.view.ViewGroup
import androidx.appcompat.app.AppCompatActivity
import com.sa.demo.feature.home.ProductRoutes
import com.sa.demo.core.platform.PageRouterBridge
import com.sa.demo.kuikly.ContextCodeHandler
import com.sa.demo.kuikly.KuiklyErrorSink
import com.sa.demo.kuikly.KuiklyFramework
import com.tencent.kuikly.core.manager.BridgeManager

class MainActivity : AppCompatActivity() {

    private lateinit var container: ViewGroup
    private lateinit var contextCodeHandler: ContextCodeHandler

    /** 当前显示的 Kuikly 页面名。 */
    private var currentPage: String = ""
    /** 宿主侧页面回退栈：进入子页（push）时压入来源页，返回键弹出。根页替换不入栈。 */
    private val pageStack = ArrayDeque<String>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        KuiklyFramework.setImageAdapter(this)
        KuiklyFramework.setRouterCallbacks(
            onNavigate = { pageName -> loadPage(pageName) },
            onClose = { /* single-activity：暂不销毁 */ },
        )
        PageRouterBridge.navigate = { pageName -> loadPage(pageName) }
        PageRouterBridge.push = { pageName -> pushPage(pageName) }

        setContentView(R.layout.activity_main)
        container = findViewById(R.id.container)

        // 汇聚 Kuikly 核心执行期被吞掉的异常，直接展示到屏幕上（避免白屏无提示）
        KuiklyErrorSink.handler = { t ->
            val msg = buildString {
                append("Kuikly 运行异常：")
                append(t.message ?: t.javaClass.simpleName)
                append("\n\n")
                append(t.stackTraceToString().take(1800))
            }
            showError(msg)
        }

        com.sa.demo.core.platform.KuiklyThreadBridge.dispatch = { task ->
            com.tencent.kuikly.core.render.android.scheduler.KuiklyRenderCoreContextScheduler
                .scheduleTask(0) { task() }
        }
        registerPages()
        loadPage(ProductRoutes.START_PAGE)
    }

    private fun registerPages() {
        BridgeManager.registerPageRouter("RemoteDevicesPage") {
            com.sa.demo.feature.agent.RemoteDevicesPage()
        }
        android.util.Log.d("MainActivity", "Pages: RemoteDevicesPage")
    }

    private fun loadPage(requestedPage: String) {
        val pageName = ProductRoutes.resolve(requestedPage)
        // Kuikly 核心运行在独立的 KRHandlerThread 上；页面内点击回调会从该线程直接进来。
        // Android 视图树只能由创建它的线程（主线程）操作，否则抛
        // "Only the original thread that created a view hierarchy can touch its views"。
        if (android.os.Looper.myLooper() != android.os.Looper.getMainLooper()) {
            runOnUiThread { loadPage(pageName) }
            return
        }
        try {
            if (::contextCodeHandler.isInitialized) {
                contextCodeHandler.kuiklyRenderViewDelegator.onPause()
                contextCodeHandler.kuiklyRenderViewDelegator.onDetach()
            }
            container.removeAllViews()
            contextCodeHandler = ContextCodeHandler(this, pageName)
            contextCodeHandler.onError = { showError(it) }
            contextCodeHandler.initContextHandler()
            contextCodeHandler.openPage(container, pageName, mapOf("appId" to 1, "debug" to 1))
            currentPage = pageName
            android.util.Log.d("MainActivity", "Page loaded: $pageName")
        } catch (e: Exception) {
            android.util.Log.e("MainActivity", "Failed to load: $pageName", e)
            showError("加载 $pageName 失败: ${e.message ?: e}")
        }
    }

    /** 进入子页：把来源页压栈，返回键可回退。 */
    private fun pushPage(pageName: String) {
        if (android.os.Looper.myLooper() != android.os.Looper.getMainLooper()) {
            runOnUiThread { pushPage(pageName) }
            return
        }
        if (currentPage.isNotEmpty() && currentPage != pageName) pageStack.addLast(currentPage)
        loadPage(pageName)
    }

    private fun showError(msg: String) {
        if (!::container.isInitialized) return
        runOnUiThread {
            val tv = android.widget.TextView(this).apply {
                text = "❌ 加载失败\n\n$msg"
                setTextColor(0xFFFF0000.toInt())
                textSize = 14f
                setPadding(32, 32, 32, 32)
            }
            container.removeAllViews()
            container.addView(tv)
        }
    }

    override fun onResume() {
        super.onResume()
        if (::contextCodeHandler.isInitialized) contextCodeHandler.kuiklyRenderViewDelegator.onResume()
    }

    override fun onPause() {
        super.onPause()
        if (::contextCodeHandler.isInitialized) contextCodeHandler.kuiklyRenderViewDelegator.onPause()
    }

    override fun onDestroy() {
        super.onDestroy()
        if (::contextCodeHandler.isInitialized) contextCodeHandler.kuiklyRenderViewDelegator.onDetach()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode == KeyEvent.KEYCODE_BACK && event.action == KeyEvent.ACTION_UP) {
            // 1) 先给 Kuikly 内部（Modal / 内嵌页面）机会
            if (::contextCodeHandler.isInitialized && contextCodeHandler.kuiklyRenderViewDelegator.onBackPressed()) {
                return true
            }
            // 2) 再回退宿主的页面栈（进入子页时压入的来源页）
            if (pageStack.isNotEmpty()) {
                val back = pageStack.removeLast()
                loadPage(back)
                return true
            }
        }
        return super.dispatchKeyEvent(event)
    }
}
