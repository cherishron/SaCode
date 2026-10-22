package com.sa.demo.storage

actual fun createSecureStore(): SecureStore {
    val map = mutableMapOf<String, String>()
    return object : SecureStore {
        override fun getString(key: String): String? = map[key]
        override fun putString(key: String, value: String) {
            map[key] = value
        }
        override fun remove(key: String) {
            map.remove(key)
        }
        override fun clear() {
            map.clear()
        }
    }
}
