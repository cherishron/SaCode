package com.sa.demo.storage

/**
 * 敏感凭据存储（access/refresh token、网关 api_key）。
 * 平台实现必须加密；禁止把明文 token 写入日志或普通偏好。
 */
interface SecureStore {
    fun getString(key: String): String?
    fun putString(key: String, value: String)
    fun remove(key: String)
    fun clear()
}

object SecureStoreKeys {
    const val ACCESS_TOKEN = "sa.access_token"
    const val REFRESH_TOKEN = "sa.refresh_token"
    const val ID_TOKEN = "sa.id_token"
    const val API_KEY = "sa.api_key"
    const val USER_SUB = "sa.user_sub"
    const val PENDING_VERIFIER = "sa.pending_verifier"
    const val PENDING_STATE = "sa.pending_state"
    const val EXPIRES_AT = "sa.expires_at"
}

object SecureStores {
    @Volatile
    private var instance: SecureStore? = null

    fun init(store: SecureStore) {
        instance = store
    }

    fun get(): SecureStore =
        instance ?: error("SecureStore not initialized; call SecureStores.init() at app startup")
}

expect fun createSecureStore(): SecureStore
