package com.sa.demo.agent.rpc

import com.sa.demo.auth.saaiJson
import com.sa.demo.core.platform.HttpRequest
import com.sa.demo.core.platform.currentTimeMillis
import com.sa.demo.core.platform.remoteHttpExecuteBlocking
import com.sa.demo.storage.SecureStore
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/** 与 IdP OAuth 独立；异常不包含请求、响应或秘密原文。 */
class RemoteAuthException(val status: Int, val reason: String) : Exception("设备认证失败：$reason（HTTP $status）")

@Serializable
data class RemoteDeviceCredential(val instanceId: String, val enrolledDeviceId: String, val credential: String)

/** 一条加密 KV 保存完整登记回执，避免分字段写入导致半绑定。 */
class RemoteCredentialVault(private val store: SecureStore) {
    private fun key(accountId: String, targetId: String): String {
        require(accountId.isNotBlank() && targetId.isNotBlank())
        return "sa.remote.credential.${accountId.length}:$accountId:${targetId.length}:$targetId"
    }
    fun save(accountId: String, targetId: String, value: RemoteDeviceCredential) {
        val encoded = saaiJson.encodeToString(RemoteDeviceCredential.serializer(), value)
        store.putString(key(accountId, targetId), encoded)
        check(store.getString(key(accountId, targetId)) == encoded) { "设备凭据保存失败" }
    }
    fun load(accountId: String, targetId: String): RemoteDeviceCredential? =
        store.getString(key(accountId, targetId))?.let {
            runCatching { saaiJson.decodeFromString(RemoteDeviceCredential.serializer(), it) }.getOrNull()
        }
    fun remove(accountId: String, targetId: String) = store.remove(key(accountId, targetId))
}

/** 阻塞式，必须后台调用。每个目标一个实例；锁合并并发续期，令牌只保留在内存。 */
class RemoteAuthRepository(
    baseUrl: String,
    private val accountId: String,
    private val targetId: String,
    private val vault: RemoteCredentialVault,
    private val http: RemoteHttpExecutor = RemoteHttpExecutor(::remoteHttpExecuteBlocking),
    private val now: () -> Long = ::currentTimeMillis,
    private val persistCredential: (RemoteDeviceCredential) -> Unit = { vault.save(accountId, targetId, it) },
) {
    private val base = baseUrl.trim().trimEnd('/')
    private val lock = Any()
    private var accessToken = ""
    private var expiresAt = 0L
    private var renewAt = 0L
    private var credentialRejected = false

    init { require(RemoteEndpoint.validate(base) == null) { "远程服务地址无效" } }

    fun enroll(secret: String, protocolDeviceName: String): RemoteDeviceCredential = synchronized(lock) {
        require(secret.isNotBlank()) { "缺少一次性登记秘密" }
        require(protocolDeviceName.matches(Regex("[A-Za-z0-9_-]{1,64}"))) { "协议设备名须为 1–64 个字母、数字、横线或下划线" }
        // 不自动重发一次性登记；响应丢失应由操作者重新出票。
        val response = post("/auth/enroll", buildJsonObject {
            put("enrollmentSecret", secret)
            put("deviceName", protocolDeviceName)
            put("kind", "mobile")
        })
        val receipt = RemoteDeviceCredential(response.string("instanceId"), response.string("deviceId"), response.string("credential"))
        require(receipt.instanceId.isNotBlank() && receipt.enrolledDeviceId.isNotBlank() && receipt.credential.isNotBlank()) {
            "登记回执不完整，请重新出票登记"
        }
        persistCredential(receipt)
        clearToken()
        credentialRejected = false
        receipt
    }

    fun token(): String = synchronized(lock) {
        if (credentialRejected) throw RemoteAuthException(401, "需要重新登记")
        val start = now()
        if (accessToken.isNotBlank() && start < renewAt) return@synchronized accessToken
        val receipt = vault.load(accountId, targetId) ?: throw RemoteAuthException(401, "未登记设备")
        val response = try {
            post("/auth/token", buildJsonObject {
                put("deviceId", receipt.enrolledDeviceId)
                put("credential", receipt.credential)
            })
        } catch (e: RemoteAuthException) {
            if (e.status == 401) { credentialRejected = true; clearToken() }
            throw e
        }
        val token = response.string("accessToken")
        val ttl = (response["expiresInMs"] as? JsonPrimitive)?.takeIf { !it.isString }?.longOrNull ?: 0
        require(token.isNotBlank() && response.string("tokenType") == "Bearer" && ttl > 0 && ttl <= Long.MAX_VALUE - start) {
            "令牌回执无效"
        }
        // TTL 从请求开始计，保守扣除网络耗时；短 TTL 不使用固定 30 秒提前量。
        expiresAt = start + ttl
        require(now() < expiresAt) { "令牌回执已过期" }
        accessToken = token
        renewAt = expiresAt - minOf(30_000L, ttl / 10)
        token
    }

    /** 仅失效当前内存令牌；权限不足不能调用此方法并无限刷新。 */
    fun invalidateToken() = synchronized(lock) { clearToken() }

    fun forget() = synchronized(lock) {
        clearToken()
        credentialRejected = true
        vault.remove(accountId, targetId)
    }

    private fun clearToken() { accessToken = ""; expiresAt = 0; renewAt = 0 }

    private fun post(path: String, params: JsonObject): JsonObject {
        val body = params.toString()
        require(body.encodeToByteArray().size <= 1_048_576)
        val response = http.execute(HttpRequest("POST", "$base$path", mapOf(
            "Content-Type" to "application/json", "Accept" to "application/json",
        ), body))
        if (!response.isSuccess) {
            // 服务端 error 只能来自固定原因白名单，不反射任意响应内容。
            val reason = when (response.statusCode) {
                400 -> "登记参数无效"
                401 -> "登记秘密或设备凭据无效"
                404 -> "目标未启用设备登记"
                413 -> "请求过大"
                429 -> "请求过于频繁，请稍后重试"
                else -> "目标认证服务异常"
            }
            throw RemoteAuthException(response.statusCode, reason)
        }
        return runCatching { saaiJson.parseToJsonElement(response.body) as? JsonObject }.getOrNull()
            ?: throw RemoteAuthException(response.statusCode, "响应格式无效")
    }
}
