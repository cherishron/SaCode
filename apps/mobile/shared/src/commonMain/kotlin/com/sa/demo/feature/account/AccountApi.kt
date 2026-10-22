package com.sa.demo.feature.account

import com.sa.demo.auth.AuthException
import com.sa.demo.auth.saaiJson
import com.sa.demo.core.platform.HttpRequest
import com.sa.demo.core.platform.HttpResponse
import com.sa.demo.core.platform.httpExecuteBlocking
import com.sa.demo.env.SaaiEnv
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * sa-idp 身份与安全接口。
 *
 * 字段严格对齐 `sa-idp/backend/src/identity/` 的实际响应，**不是照文档推测**：
 * - `me`   → profile.rs:86-113
 * - `devices` → devices.rs:154-169
 * - `logout` / `logout-all` → logout.rs:42,95
 *
 * 注意：IdP 返回的是 `phone_masked` / `device_id_masked` 等**打码字段**，
 * 客户端不要试图还原原始值；撤销设备用的是数字 `id`（devices.rs:221）。
 */
object AccountApi {

    // —— 数据模型 ——

    @Serializable
    data class Binding(
        val provider: String,
        @SerialName("app_id") val appId: String? = null,
        @SerialName("external_id_masked") val externalIdMasked: String? = null,
        @SerialName("union_id_masked") val unionIdMasked: String? = null,
    )

    @Serializable
    data class SsoProvider(
        val id: String,
        val name: String,
        val enabled: Boolean = false,
        val status: String? = null,
    )

    @Serializable
    data class Profile(
        @SerialName("user_id") val userId: String = "",
        val username: String? = null,
        val name: String? = null,
        @SerialName("phone_masked") val phoneMasked: String? = null,
        @SerialName("phone_verified") val phoneVerified: Boolean = false,
        @SerialName("email_masked") val emailMasked: String? = null,
        @SerialName("email_verified") val emailVerified: Boolean = false,
        val role: String? = null,
        val status: String? = null,
        @SerialName("session_epoch") val sessionEpoch: Long = 0,
        @SerialName("has_password") val hasPassword: Boolean = false,
        @SerialName("need_phone") val needPhone: Boolean = false,
        val bindings: List<Binding> = emptyList(),
        @SerialName("sso_available") val ssoAvailable: List<SsoProvider> = emptyList(),
        @SerialName("login_paths") val loginPaths: List<String> = emptyList(),
    ) {
        /** 展示用主标识：优先用户名，其次脱敏手机号。 */
        val displayName: String
            get() = name?.takeIf { it.isNotBlank() }
                ?: username?.takeIf { it.isNotBlank() }
                ?: phoneMasked
                ?: "未命名用户"
    }

    @Serializable
    data class Device(
        val id: String,
        @SerialName("device_id_masked") val deviceIdMasked: String? = null,
        @SerialName("client_type") val clientType: String? = null,
        val platform: String? = null,
        @SerialName("device_name") val deviceName: String? = null,
        @SerialName("last_active_at") val lastActiveAt: String? = null,
        val status: String? = null,
    ) {
        val displayName: String
            get() = deviceName?.takeIf { it.isNotBlank() }
                ?: platform?.takeIf { it.isNotBlank() }
                ?: deviceIdMasked
                ?: "未知设备"
    }

    @Serializable
    data class DeviceList(
        val devices: List<Device> = emptyList(),
        val count: Int = 0,
    )

    // —— 接口 ——

    private fun url(env: SaaiEnv, path: String) = "${env.issuer.trimEnd('/')}$path"

    private fun bearer(accessToken: String) = mapOf(
        "Accept" to "application/json",
        "Authorization" to "Bearer $accessToken",
    )

    private fun get(env: SaaiEnv, path: String, accessToken: String): HttpResponse =
        httpExecuteBlocking(HttpRequest("GET", url(env, path), bearer(accessToken)))

    private fun post(env: SaaiEnv, path: String, accessToken: String): HttpResponse =
        httpExecuteBlocking(HttpRequest("POST", url(env, path), bearer(accessToken)))

    /** GET /api/identity/me */
    fun profile(env: SaaiEnv, accessToken: String): Profile {
        val resp = get(env, "/api/identity/me", accessToken)
        if (!resp.isSuccess) throw AuthException(errorDetail(resp), resp.statusCode)
        return decode(resp.body)
    }

    /** GET /api/identity/devices */
    fun devices(env: SaaiEnv, accessToken: String): DeviceList {
        val resp = get(env, "/api/identity/devices", accessToken)
        if (!resp.isSuccess) throw AuthException(errorDetail(resp), resp.statusCode)
        return decode(resp.body)
    }

    /** DELETE /api/identity/devices/:id —— :id 是数字主键，不是打码的 device_id。 */
    fun revokeDevice(env: SaaiEnv, accessToken: String, deviceId: String): Boolean {
        if (deviceId.isBlank()) return false
        val resp = httpExecuteBlocking(
            HttpRequest("DELETE", url(env, "/api/identity/devices/$deviceId"), bearer(accessToken))
        )
        return resp.isSuccess
    }

    /** POST /api/identity/logout —— 仅注销当前会话。 */
    fun logout(env: SaaiEnv, accessToken: String): Boolean =
        post(env, "/api/identity/logout", accessToken).isSuccess

    /**
     * POST /api/identity/logout-all —— 全端下线。
     *
     * 会 `session_epoch++`，**所有设备上的旧 access_token 立即失效**
     * （login_wechat.rs:430-432 会比对 epoch）。返回后调用方必须清本地会话。
     */
    fun logoutAll(env: SaaiEnv, accessToken: String): Boolean =
        post(env, "/api/identity/logout-all", accessToken).isSuccess

    // —— 解析 ——

    private inline fun <reified T> decode(body: String): T =
        runCatching { saaiJson.decodeFromString<T>(body) }
            .getOrElse { throw AuthException("响应解析失败：${it.message}") }

    /**
     * 从 sa-idp 的错误体取 `detail` 展示给用户。
     *
     * IdP 错误形如 `{"type":...,"title":...,"status":401,"detail":"令牌无效"}`。
     */
    fun errorDetail(resp: HttpResponse): String {
        val fallback = "HTTP ${resp.statusCode}"
        return runCatching {
            val o = saaiJson.parseToJsonElement(resp.body).jsonObject
            o["detail"]?.jsonPrimitive?.content
                ?: o["title"]?.jsonPrimitive?.content
                ?: o["message"]?.jsonPrimitive?.content
                ?: fallback
        }.getOrElse { fallback }
    }

    @Suppress("unused")
    private fun JsonObject.firstArray(key: String) = this[key]?.jsonArray
}
