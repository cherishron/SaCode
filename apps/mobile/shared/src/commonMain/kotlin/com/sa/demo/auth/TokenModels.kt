package com.sa.demo.auth

import kotlinx.serialization.Serializable

@Serializable
data class TokenResponse(
    val access_token: String,
    val token_type: String = "Bearer",
    val expires_in: Long? = null,
    val refresh_token: String? = null,
    val id_token: String? = null,
    val scope: String? = null,
    val user_id: Long? = null,
    val username: String? = null,
    val phone: String? = null,
    val email: String? = null,
    val need_phone: Boolean? = null,
)

@Serializable
data class ExchangeResponse(
    val api_key: String,
    val issued: Boolean = false,
)

@Serializable
data class ModelsEnvelope(
    val `object`: String? = null,
    val data: List<ModelItem> = emptyList(),
)

@Serializable
data class ModelItem(
    val id: String,
    val `object`: String? = null,
)

@Serializable
data class SendCodeResponse(
    val sent: Boolean = true,
    val hint: String? = null,
    val dev_hint: String? = null,
    val provider: String? = null,
    val delivered: Boolean? = null,
)

@Serializable
data class ApiErrorBody(
    val detail: String? = null,
    val error: String? = null,
    val error_description: String? = null,
    val message: String? = null,
    val title: String? = null,
)

data class AuthTokens(
    val accessToken: String,
    val refreshToken: String?,
    val idToken: String?,
    val expiresAtEpochMs: Long?,
)

data class AuthState(
    val tokens: AuthTokens,
    val apiKey: String?,
    val username: String?,
)

/**
 * 客户端 session 策略（产品「一周免登录」）：
 * - access_token：短命（IdP 默认 3600s），**不**为免登录而加长
 * - refresh_token：持久化在 SecureStore；TTL 由 IdP 客户端配置（种子默认 30 天）
 * - 客户端：启动 / access 临近过期时 `grant_type=refresh_token` 自动续期
 * - 体验窗口 ≈ refresh TTL 与「用户仍在设备上」的交集；产品文案可按 7 日运营配置收紧 IdP refresh TTL
 */
object SessionPolicy {
    /** access 提前续期阈值 */
    const val ACCESS_REFRESH_SKEW_MS = 120_000L
    /** 产品对外文案窗口（配置参考，非代码强制） */
    const val PRODUCT_SILENT_LOGIN_DAYS = 7
}
