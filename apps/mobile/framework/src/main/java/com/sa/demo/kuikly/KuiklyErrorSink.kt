package com.sa.demo.kuikly

import android.util.Log

/**
 * 全局 Kuikly 运行期异常汇聚点。
 *
 * Kuikly 核心（JVM 执行模式）在页面 body() 执行期间抛出的异常，
 * 会被框架内部捕获并直接路由到 [com.tencent.kuikly.core.render.android.adapter.IKRUncaughtExceptionHandlerAdapter]
 * （本工程为 [com.sa.demo.kuikly.adapter.KRExceptionAdapter]），
 * 而不会经过 delegator 的 onPageLoadComplete/onUnhandledException 回调，
 * 因此 MainActivity 的错误可视化回调收不到 —— 表现为「白屏且无红字」。
 *
 * 这里提供一个可被任意位置注册的 handler，让被吞掉的异常能被 UI 层展示出来。
 */
object KuiklyErrorSink {
    /** 由 UI 层（MainActivity）注册，用于在屏幕上展示异常。 */
    var handler: ((Throwable) -> Unit)? = null

    fun emit(t: Throwable) {
        Log.e(TAG, "Kuikly uncaught: ${t.stackTraceToString()}")
        handler?.invoke(t)
    }

    private const val TAG = "KuiklyErrorSink"
}
