package com.sa.demo.auth

import com.sa.demo.core.platform.HttpRequest
import com.sa.demo.core.platform.HttpResponse
import com.sa.demo.core.platform.currentTimeMillis
import com.sa.demo.core.platform.httpExecuteBlocking
import com.sa.demo.core.platform.urlEncode
import com.sa.demo.env.SaaiEnv
import com.sa.demo.storage.SecureStoreKeys
import com.sa.demo.storage.SecureStores
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

class AuthException(message: String, val statusCode: Int? = null) : Exception(message)

val saaiJson = kotlinx.serialization.json.Json {
    ignoreUnknownKeys = true
    isLenient = true
    encodeDefaults = true
}

private fun jsonBody(vararg pairs: Pair<String, String>): String =
    buildJsonObject {
        pairs.forEach { (k, v) -> put(k, JsonPrimitive(v)) }
    }.toString()

/**
 * 移动端主路径：App 内直接调 sa-idp 身份接口拿三件套令牌，
 * 再 POST {gateway}/api/auth/exchange 换网关 api_key。
 * OAuth 浏览器授权码 + PKCE 仅作可选兜底。
 */
object AuthRepository {

    fun loginPassword(env: SaaiEnv, username: String, password: String): AuthState {
        val body = jsonBody("username" to username.trim(), "password" to password)
        return postTokensAndExchange(env, "${env.issuer.trimEnd('/')}/api/login/password", body)
    }

    fun sendSmsCode(env: SaaiEnv, phone: String, scene: String = "login"): SendCodeResponse {
        val body = jsonBody("channel" to "sms", "target" to phone.trim(), "scene" to scene)
        val resp = postJson("${env.issuer.trimEnd('/')}/api/verification/send", body)
        return parseOrThrow(resp) { saaiJson.decodeFromString(SendCodeResponse.serializer(), it) }
    }

    fun loginSms(env: SaaiEnv, phone: String, code: String): AuthState {
        val body = jsonBody("phone" to phone.trim(), "code" to code.trim())
        return postTokensAndExchange(env, "${env.issuer.trimEnd('/')}/api/login/sms", body)
    }

    fun registerPhone(env: SaaiEnv, phone: String, code: String, password: String): AuthState {
        val body = jsonBody(
            "phone" to phone.trim(),
            "code" to code.trim(),
            "password" to password,
        )
        return postTokensAndExchange(env, "${env.issuer.trimEnd('/')}/api/register/phone", body)
    }

    fun buildAuthorizeUrl(env: SaaiEnv, pkce: Pkce): String {
        val query = listOf(
            "response_type" to "code",
            "client_id" to env.clientId,
            "redirect_uri" to env.redirectUri,
            "scope" to env.scope,
            "state" to pkce.state,
            "code_challenge" to pkce.challenge,
            "code_challenge_method" to pkce.method,
        ).joinToString("&") { (k, v) -> "${urlEncode(k)}=${urlEncode(v)}" }
        return "${env.authorizeUrl}?$query"
    }

    fun savePending(pkce: Pkce) {
        val store = SecureStores.get()
        store.putString(SecureStoreKeys.PENDING_VERIFIER, pkce.verifier)
        store.putString(SecureStoreKeys.PENDING_STATE, pkce.state)
    }

    fun peekPendingState(): String? = SecureStores.get().getString(SecureStoreKeys.PENDING_STATE)

    fun clearPending() {
        val store = SecureStores.get()
        store.remove(SecureStoreKeys.PENDING_VERIFIER)
        store.remove(SecureStoreKeys.PENDING_STATE)
    }

    fun completeAuthorizationCode(env: SaaiEnv, code: String, state: String): AuthState {
        val store = SecureStores.get()
        val expectedState = store.getString(SecureStoreKeys.PENDING_STATE)
        val verifier = store.getString(SecureStoreKeys.PENDING_VERIFIER)
        if (expectedState.isNullOrBlank() || verifier.isNullOrBlank()) {
            throw AuthException("登录会话已失效，请重新发起登录")
        }
        if (state != expectedState) {
            clearPending()
            throw AuthException("state 校验失败，可能存在跨应用劫持")
        }
        val form = listOf(
            "grant_type" to "authorization_code",
            "client_id" to env.clientId,
            "code" to code,
            "redirect_uri" to env.redirectUri,
            "code_verifier" to verifier,
        ).joinToString("&") { (k, v) -> "${urlEncode(k)}=${urlEncode(v)}" }
        clearPending()
        val tokenResp = httpExecuteBlocking(
            HttpRequest(
                method = "POST",
                url = env.tokenUrl,
                headers = mapOf(
                    "Content-Type" to "application/x-www-form-urlencoded",
                    "Accept" to "application/json",
                ),
                body = form,
            )
        )
        val tokens = parseOrThrow(tokenResp) { saaiJson.decodeFromString(TokenResponse.serializer(), it) }
        return persistAndExchange(env, tokens)
    }

    fun isLoggedIn(): Boolean =
        !SecureStores.get().getString(SecureStoreKeys.ACCESS_TOKEN).isNullOrBlank() &&
            !SecureStores.get().getString(SecureStoreKeys.API_KEY).isNullOrBlank()

    /**
     * 产品策略：短 access（IdP 默认 ≤1h）+ **持久化 refresh** + 客户端自动续期
     * → 体验上的「一周免登录」。**不是**把 access TTL 拉长到一周。
     * IdP 侧 `refresh_token_ttl_secs` 种子默认 30 天，覆盖 7 日窗口绰绰有余；
     * 客户端在过期前/启动时 `grant_type=refresh_token` 换新 access，并幂等 refresh api_key。
     */
    fun hasRefreshToken(): Boolean =
        !SecureStores.get().getString(SecureStoreKeys.REFRESH_TOKEN).isNullOrBlank()

    fun accessExpiresAt(): Long? =
        SecureStores.get().getString(SecureStoreKeys.EXPIRES_AT)?.toLongOrNull()

    /** access 是否即将过期（默认提前 120s 续期，避免飞行中 401） */
    fun isAccessExpiring(skewMs: Long = 120_000): Boolean {
        val exp = accessExpiresAt() ?: return true
        return currentTimeMillis() + skewMs >= exp
    }

    /** 桌面语义：有 refresh 即视为「可静默恢复会话」（一周免登录窗口内） */
    fun canSilentRestore(): Boolean = hasRefreshToken()

    /**
     * 用 refresh_token 换新三件套；旧 refresh 复用被 IdP 判泄露时会失败 → 清本地。
     * 阻塞 API，须在后台线程调用。
     */
    fun refreshTokens(env: SaaiEnv): AuthState {
        val store = SecureStores.get()
        val refresh = store.getString(SecureStoreKeys.REFRESH_TOKEN)
            ?: throw AuthException("无 refresh_token，请重新登录")
        val form = listOf(
            "grant_type" to "refresh_token",
            "client_id" to env.clientId,
            "refresh_token" to refresh,
        ).joinToString("&") { (k, v) -> "${urlEncode(k)}=${urlEncode(v)}" }
        val resp = httpExecuteBlocking(
            HttpRequest(
                method = "POST",
                url = env.tokenUrl,
                headers = mapOf(
                    "Content-Type" to "application/x-www-form-urlencoded",
                    "Accept" to "application/json",
                ),
                body = form,
            )
        )
        return try {
            val tokens = parseOrThrow(resp) { saaiJson.decodeFromString(TokenResponse.serializer(), it) }
            persistAndExchange(env, tokens)
        } catch (e: AuthException) {
            // 401/invalid_grant：会话已失效
            if (resp.statusCode == 400 || resp.statusCode == 401) {
                store.remove(SecureStoreKeys.REFRESH_TOKEN)
                store.remove(SecureStoreKeys.ACCESS_TOKEN)
                store.remove(SecureStoreKeys.API_KEY)
            }
            throw AuthException("刷新会话失败：${e.message}", resp.statusCode)
        }
    }

    /**
     * 保证当前会话可用：
     * - access 仍有效 → 直接返回本地状态（不打网）
     * - access 过期/将过期且有 refresh → **自动 refresh** 再 exchange
     * - 无 refresh → 要求重新登录
     * 启动静默恢复与所有业务 API 前调用。阻塞；后台线程执行。
     */
    fun ensureSession(env: SaaiEnv, forceRefresh: Boolean = false): AuthState {
        val store = SecureStores.get()
        val access = store.getString(SecureStoreKeys.ACCESS_TOKEN)
        val apiKey = store.getString(SecureStoreKeys.API_KEY)
        if (!forceRefresh && !access.isNullOrBlank() && !apiKey.isNullOrBlank() && !isAccessExpiring()) {
            return AuthState(
                tokens = AuthTokens(
                    accessToken = access,
                    refreshToken = store.getString(SecureStoreKeys.REFRESH_TOKEN),
                    idToken = store.getString(SecureStoreKeys.ID_TOKEN),
                    expiresAtEpochMs = accessExpiresAt(),
                ),
                apiKey = apiKey,
                username = storedUsername(),
            )
        }
        if (!hasRefreshToken()) {
            if (!access.isNullOrBlank() && !apiKey.isNullOrBlank() && !forceRefresh) {
                // 无 refresh 但仍有效：放行（旧会话）
                return AuthState(
                    tokens = AuthTokens(access, null, null, accessExpiresAt()),
                    apiKey = apiKey,
                    username = storedUsername(),
                )
            }
            throw AuthException("登录已过期，请重新登录（无 refresh_token）")
        }
        return refreshTokens(env)
    }

    /**
     * 启动时静默续期：有 refresh 就试一次 ensureSession；失败则要求登录。
     * 阻塞；由 UI asyncRun 调用。
     */
    fun silentRestore(env: SaaiEnv): AuthState = ensureSession(env)

    fun storedUsername(): String? = SecureStores.get().getString(SecureStoreKeys.USER_SUB)

    /**
     * 当前 access_token（未登录返回 null）。
     *
     * 供调 sa-idp 身份接口使用——`/api/identity` 系列接口接受 Bearer access_token
     * （`sa-idp/.../login_wechat.rs:417-424`）。
     */
    fun accessTokenOrNull(): String? =
        SecureStores.get().getString(SecureStoreKeys.ACCESS_TOKEN)?.takeIf { it.isNotBlank() }

    fun storedApiKey(): String? = SecureStores.get().getString(SecureStoreKeys.API_KEY)

    fun logoutLocal() {
        LocalSessionEpoch.clearSession { SecureStores.get().clear() }
    }

    fun exchangeApiKey(env: SaaiEnv, accessToken: String): String {
        val resp = httpExecuteBlocking(
            HttpRequest(
                method = "POST",
                url = env.exchangeUrl,
                headers = mapOf(
                    "Authorization" to "Bearer $accessToken",
                    "Accept" to "application/json",
                ),
            )
        )
        return parseOrThrow(resp) {
            saaiJson.decodeFromString(ExchangeResponse.serializer(), it).api_key
        }
    }

    fun fetchModels(env: SaaiEnv): List<ModelItem> {
        ensureSession(env)
        val apiKey = SecureStores.get().getString(SecureStoreKeys.API_KEY)
            ?: throw AuthException("未登录或缺少网关 api_key，请先完成登录")
        val resp = httpExecuteBlocking(
            HttpRequest(
                method = "GET",
                url = env.modelsUrl,
                headers = mapOf(
                    "Authorization" to "Bearer $apiKey",
                    "Accept" to "application/json",
                ),
            )
        )
        return parseOrThrow(resp) {
            saaiJson.decodeFromString(ModelsEnvelope.serializer(), it).data
        }
    }

    private fun postTokensAndExchange(env: SaaiEnv, url: String, jsonBody: String): AuthState {
        val resp = postJson(url, jsonBody)
        val tokens = parseOrThrow(resp) { saaiJson.decodeFromString(TokenResponse.serializer(), it) }
        return persistAndExchange(env, tokens)
    }

    private fun postJson(url: String, jsonBody: String): HttpResponse =
        httpExecuteBlocking(
            HttpRequest(
                method = "POST",
                url = url,
                headers = mapOf(
                    "Content-Type" to "application/json",
                    "Accept" to "application/json",
                ),
                body = jsonBody,
            )
        )

    private fun persistAndExchange(env: SaaiEnv, tokens: TokenResponse): AuthState {
        val store = SecureStores.get()
        val expiresAt = tokens.expires_in?.let { currentTimeMillis() + it * 1000 }
        store.putString(SecureStoreKeys.ACCESS_TOKEN, tokens.access_token)
        tokens.refresh_token?.let { store.putString(SecureStoreKeys.REFRESH_TOKEN, it) }
        tokens.id_token?.let { store.putString(SecureStoreKeys.ID_TOKEN, it) }
        tokens.username?.let { store.putString(SecureStoreKeys.USER_SUB, it) }
        expiresAt?.let { store.putString(SecureStoreKeys.EXPIRES_AT, it.toString()) }

        val apiKey = exchangeApiKey(env, tokens.access_token)
        store.putString(SecureStoreKeys.API_KEY, apiKey)

        return AuthState(
            tokens = AuthTokens(
                accessToken = tokens.access_token,
                refreshToken = tokens.refresh_token,
                idToken = tokens.id_token,
                expiresAtEpochMs = expiresAt,
            ),
            apiKey = apiKey,
            username = tokens.username ?: storedUsername(),
        )
    }

    private inline fun <T> parseOrThrow(resp: HttpResponse, parse: (String) -> T): T {
        if (!resp.isSuccess) {
            throw AuthException(errorDetail(resp), resp.statusCode)
        }
        return try {
            parse(resp.body)
        } catch (e: Exception) {
            throw AuthException("响应解析失败: ${e.message}")
        }
    }

    fun errorDetail(resp: HttpResponse): String {
        val body = resp.body
        val parsed = try {
            saaiJson.decodeFromString(ApiErrorBody.serializer(), body)
        } catch (_: Exception) {
            null
        }
        val msg = parsed?.detail ?: parsed?.error_description ?: parsed?.message ?: parsed?.title
            ?: parsed?.error ?: body.take(200)
        return "HTTP ${resp.statusCode}: $msg"
    }
}
