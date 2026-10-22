package com.sa.demo.core.platform

import android.util.Log
import io.github.aakira.napier.Antilog
import io.github.aakira.napier.LogLevel

/**
 * Napier Android LogCat 初始化器
 * 在 androidMain 中定义，可访问 Android 平台特定的 Napier 实现
 */
actual object NapierInitializer {

    /**
     * 使用 Android LogCat 作为日志输出后端
     */
    actual fun init() {
        val antilog = object : Antilog() {
            override fun performLog(
                priority: LogLevel,
                tag: String?,
                throwable: Throwable?,
                message: String?
            ) {
                val androidTag = tag ?: "Napier"
                val formattedMessage = message ?: ""

                when (priority) {
                    LogLevel.VERBOSE -> Log.v(androidTag, formattedMessage, throwable)
                    LogLevel.DEBUG -> Log.d(androidTag, formattedMessage, throwable)
                    LogLevel.INFO -> Log.i(androidTag, formattedMessage, throwable)
                    LogLevel.WARNING -> Log.w(androidTag, formattedMessage, throwable)
                    LogLevel.ERROR -> Log.e(androidTag, formattedMessage, throwable)
                    LogLevel.ASSERT -> Log.wtf(androidTag, formattedMessage, throwable)
                }
            }
        }

        io.github.aakira.napier.Napier.base(antilog = antilog)
        Log.d("NapierInitializer", "✅ Napier initialized with Android LogCat backend")
    }
}
