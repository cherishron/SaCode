package com.sa.demo.core.platform

data class HttpRequest(
    val method: String,
    val url: String,
    val headers: Map<String, String> = emptyMap(),
    val body: String? = null,
)

data class HttpResponse(
    val statusCode: Int,
    val body: String,
) {
    val isSuccess: Boolean get() = statusCode in 200..299
}

/** 在后台线程执行阻塞 HTTP；回调在主线程。 */
expect fun httpExecuteBlocking(request: HttpRequest): HttpResponse

/**
 * 取消令牌：用于中断进行中的阻塞操作（如流式 SSE）。
 *
 * 线程安全，可在任意线程 [cancel]；[onCancel] 钩子用于唤醒阻塞中的 IO
 * （例如 `HttpURLConnection.disconnect()`），使阻塞读立即返回而不是等下一行数据。
 */
class CancelToken {
    @Volatile
    private var cancelled = false

    private val lock = Any()
    private val hooks = mutableListOf<() -> Unit>()

    val isCancelled: Boolean get() = cancelled

    fun cancel() {
        val toRun: List<() -> Unit>
        synchronized(lock) {
            if (cancelled) return
            cancelled = true
            toRun = hooks.toList()
            hooks.clear()
        }
        // 钩子异常不应影响取消语义
        toRun.forEach { runCatching { it() } }
    }

    /** 注册取消回调；若已取消则立即同步执行。 */
    fun onCancel(hook: () -> Unit) {
        registerCancel(hook)
    }

    /** 长期重连任务每次 IO/等待结束必须注销钩子，避免无限持有旧连接。 */
    fun registerCancel(hook: () -> Unit): () -> Unit {
        val runNow = synchronized(lock) {
            if (cancelled) true else { hooks += hook; false }
        }
        if (runNow) runCatching { hook() }
        return { synchronized(lock) { hooks.remove(hook); Unit } }
    }
}

/**
 * SSE/流式 HTTP：逐行回调 [onLine]（含原始 `data: ...` 行）。
 * 阻塞直至流结束、被 [token] 取消或出错；须在后台线程调用。
 *
 * 被取消时静默返回（不抛异常），已产出的部分内容由调用方自行保留。
 */
expect fun httpStreamSse(request: HttpRequest, token: CancelToken, onLine: (String) -> Unit)

/** 后台执行 [work]，主线程回调 Result。 */
expect fun <T> asyncRun(work: () -> T, onDone: (Result<T>) -> Unit)

/** 投递到主线程（流式增量回 UI）。 */
expect fun postToMain(block: () -> Unit)

expect fun openUrlInBrowser(url: String)

/** 宿主页面路由桥；MainActivity 注入。 */
object PageRouterBridge {
    @Volatile
    var navigate: ((String) -> Unit)? = null

    /** 进入子页：来源页入栈，返回键可回退（宿主未注入时退化为 [open]）。 */
    @Volatile
    var push: ((String) -> Unit)? = null

    /** 根页替换：Tab 切换 / 登录后进入主页 / 登出回登录页，不留回退栈。 */
    fun open(pageName: String) {
        val nav = navigate
        if (nav != null) {
            nav(pageName)
        } else {
            // 平台 actual 兜底
            navigateToPage(pageName)
        }
    }

    /** 进入子页（组件库、绑定电脑等）：返回键可回到来源页。 */
    fun push(pageName: String) {
        val p = push
        if (p != null) p(pageName) else open(pageName)
    }
}

/** 跳转 Kuikly 页面（宿主 Router 兜底实现）。 */
expect fun navigateToPage(pageName: String)

/** 墙钟毫秒（用于 access_token 过期判断）。 */
expect fun currentTimeMillis(): Long

