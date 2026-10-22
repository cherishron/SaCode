package com.sa.demo.storage

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.sa.demo.core.platform.AndroidPlatform
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

actual fun createSecureStore(): SecureStore = AndroidSecureStore(AndroidPlatform.appContext)

/**
 * Android Keystore (AES-GCM) + SharedPreferences。
 * api_key / refresh_token 等敏感项仅密文落盘。
 */
class AndroidSecureStore(context: Context) : SecureStore {

    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    override fun getString(key: String): String? {
        val raw = prefs.getString(key, null) ?: return null
        return try {
            decrypt(raw)
        } catch (_: Exception) {
            null
        }
    }

    override fun putString(key: String, value: String) {
        prefs.edit().putString(key, encrypt(value)).apply()
    }

    override fun remove(key: String) {
        prefs.edit().remove(key).apply()
    }

    override fun clear() {
        prefs.edit().clear().apply()
    }

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let {
            return it.secretKey
        }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return generator.generateKey()
    }

    private fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val iv = cipher.iv
        val bytes = cipher.doFinal(plain.encodeToByteArray())
        val packed = ByteArray(iv.size + bytes.size)
        System.arraycopy(iv, 0, packed, 0, iv.size)
        System.arraycopy(bytes, 0, packed, iv.size, bytes.size)
        return Base64.encodeToString(packed, Base64.NO_WRAP)
    }

    private fun decrypt(payload: String): String {
        val packed = Base64.decode(payload, Base64.NO_WRAP)
        val iv = packed.copyOfRange(0, IV_LEN)
        val body = packed.copyOfRange(IV_LEN, packed.size)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, iv))
        return cipher.doFinal(body).decodeToString()
    }

    companion object {
        private const val PREFS_NAME = "sa_app_secure_v1"
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val KEY_ALIAS = "sa_app_secure_store"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val IV_LEN = 12
    }
}
