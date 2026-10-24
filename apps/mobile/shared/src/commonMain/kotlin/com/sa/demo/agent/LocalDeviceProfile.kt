package com.sa.demo.agent

import com.sa.demo.core.platform.randomBytes
import com.sa.demo.storage.SecureStore

/** 本机安装的凭据命名空间，不是 IdP 用户、daemon 身份或授权凭证。 */
class LocalDeviceProfile(
    private val store: SecureStore,
    private val random: (Int) -> ByteArray = ::randomBytes,
) {
    fun ownerId(): String = synchronized(lock) {
        val stored = store.getString(KEY)
        if (stored != null) {
            check(FORMAT.matches(stored)) { "本机设备档案无效" }
            return@synchronized stored
        }
        val bytes = random(32)
        check(bytes.size == 32) { "本机设备档案随机源无效" }
        val owner = PREFIX + bytes.joinToString("") { (it.toInt() and 255).toString(16).padStart(2, '0') }
        store.putString(KEY, owner)
        check(store.getString(KEY) == owner) { "本机设备档案保存失败" }
        owner
    }

    fun isCurrent(owner: String): Boolean = synchronized(lock) {
        FORMAT.matches(owner) && store.getString(KEY) == owner
    }

    fun <T> ifCurrent(owner: String, action: () -> T): T = synchronized(lock) {
        check(isCurrent(owner)) { "本机设备档案已改变" }
        action()
    }

    private companion object {
        val lock = Any()
        const val KEY = "sacode.local-device-profile.v1"
        const val PREFIX = "sacode-local-v1-"
        val FORMAT = Regex("${PREFIX}[0-9a-f]{64}")
    }
}
