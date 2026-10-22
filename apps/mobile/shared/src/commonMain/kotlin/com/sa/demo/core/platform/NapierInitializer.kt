package com.sa.demo.core.platform

/**
 * Napier 日志初始化器（expect/actual）
 * 各平台提供自己的日志后端实现
 */
expect object NapierInitializer {

    /**
     * 初始化平台特定的日志后端
     * Android: LogCat, iOS: NSLog, JVM: System.out
     */
    fun init()
}
