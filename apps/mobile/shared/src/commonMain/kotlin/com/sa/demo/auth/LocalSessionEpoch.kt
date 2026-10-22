package com.sa.demo.auth

/** 防止退出登录清库之后，在途登记重新写回设备秘密。锁不跨网络 IO。 */
object LocalSessionEpoch {
    private val lock = Any()
    private var revision = 0L
    fun current(): Long = synchronized(lock) { revision }
    fun <T> ifCurrent(expected: Long, action: () -> T): T = synchronized(lock) {
        check(revision == expected) { "登录会话已改变" }
        action()
    }
    fun clearSession(action: () -> Unit) = synchronized(lock) {
        revision++
        action()
    }
}
