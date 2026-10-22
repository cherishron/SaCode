package com.sa.demo.kuikly.adapter

import com.sa.demo.kuikly.KuiklyErrorSink
import com.tencent.kuikly.core.render.android.adapter.IKRUncaughtExceptionHandlerAdapter

object KRExceptionAdapter : IKRUncaughtExceptionHandlerAdapter {
    override fun uncaughtException(throwable: Throwable) {
        android.util.Log.e("KuiklyException", throwable.stackTraceToString())
        // 核心执行期的异常被框架内部直接路由到此处且不会回调到页面 delegator，
        // 因而白屏时 UI 看不到任何报错。统一汇聚到 KuiklyErrorSink 让 UI 层可见。
        KuiklyErrorSink.emit(throwable)
    }
}