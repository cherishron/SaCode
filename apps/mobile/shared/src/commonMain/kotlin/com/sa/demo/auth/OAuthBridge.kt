package com.sa.demo.auth

/**
 * Android 深链 / 宿主 → Kuikly 登录页 的 OAuth 回调桥。
 */
object OAuthBridge {
    data class Callback(
        val code: String?,
        val state: String?,
        val error: String?,
        val errorDescription: String?,
    )

    @Volatile
    private var pending: Callback? = null

    @Volatile
    var listener: ((Callback) -> Unit)? = null

    fun deliver(callback: Callback) {
        val l = listener
        if (l != null) {
            l(callback)
        } else {
            pending = callback
        }
    }

    fun consumePending(): Callback? {
        val p = pending
        pending = null
        return p
    }
}
