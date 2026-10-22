package com.sa.demo.agent.rpc

import com.sa.demo.auth.saaiJson
import com.sa.demo.core.platform.HttpRequest
import com.sa.demo.core.platform.HttpResponse
import com.sa.demo.core.platform.remoteHttpExecuteBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.put
import kotlinx.serialization.json.buildJsonObject

/** 阻塞网络口只在后台调用；可注入夹具，不依赖 Android 或页面。 */
fun interface RemoteHttpExecutor {
    fun execute(request: HttpRequest): HttpResponse
}

class RemoteRpcException(val failure: AgentRpc.Parsed.ParsedErr) : Exception(failure.message)

class RemoteDaemonClient(
    baseUrl: String,
    private val tokenProvider: () -> String,
    private val http: RemoteHttpExecutor = RemoteHttpExecutor(::remoteHttpExecuteBlocking),
    private val nextRequestId: () -> String,
    private val invalidateToken: () -> Unit = {},
) {
    private val base = baseUrl.trim().trimEnd('/')

    fun call(method: String, params: JsonObject? = null): JsonObject = callRead(method, params, true)

    private fun callRead(method: String, params: JsonObject?, allowRefresh: Boolean): JsonObject {
        require(method in setOf("initialize", "session/catalog", "session/events")) { "客户端仅允许安全只读方法" }
        require(RemoteEndpoint.validate(base) == null) { "远程服务地址无效" }
        val token = tokenProvider()
        require(token.isNotBlank()) { "缺少设备访问令牌" }
        val id = nextRequestId()
        val body = AgentRpc.request(id, method, params)
        require(body.encodeToByteArray().size <= 1_048_576) { "请求体超过 1 MiB" }
        val response = http.execute(HttpRequest("POST", "$base/rpc", mapOf(
            "Authorization" to "Bearer $token", "Content-Type" to "application/json", "Accept" to "application/json",
        ), body))
        return when (val parsed = AgentRpc.parseHttp(response.statusCode, response.body, id)) {
            is AgentRpc.Parsed.ParsedErr -> {
                val invalidAuth = response.statusCode == 401 ||
                    (parsed.code == AgentRpc.ERR_AUTHDENIED && parsed.message in setOf("authz-denied:invalid-token", "authz-denied:missing-bearer"))
                if (allowRefresh && invalidAuth) {
                    invalidateToken()
                    callRead(method, params, false)
                } else throw RemoteRpcException(parsed)
            }
            is AgentRpc.Parsed.ParsedOk -> parsed.result as? JsonObject ?: error("方法返回值不是对象")
        }
    }

    fun initialize(): RemoteInitialization = RemoteInitialization.parse(call(AgentMethods.INITIALIZE))

    fun catalog(context: RemoteRequestContext): AgentRpc.Catalog =
        AgentRpc.parseCatalog(call(AgentMethods.SESSION_CATALOG, context.params()))

    fun events(context: RemoteRequestContext, afterSeq: String = "", generation: String = "", limit: Int = 100): RemoteEventPage {
        require(context.sessionId.isNotBlank()) { "缺少远程 sessionId" }
        require(limit in 1..200)
        val extra = buildJsonObject {
            put("limit", limit)
            if (afterSeq.isNotBlank()) put("afterSeq", afterSeq)
            if (generation.isNotBlank()) put("generation", generation)
        }
        return RemoteEventPage.parse(call("session/events", context.params(extra)))
    }
}

data class RemoteInitialization(
    val instanceId: String,
    val protocolVersion: String,
    val capabilities: Set<String>,
    val sandboxEnforcing: Boolean,
    val sandboxLimitations: List<String>,
) {
    companion object {
        fun parse(obj: JsonObject): RemoteInitialization {
            val sandbox = obj["sandboxEnforcement"] as? JsonObject
            return RemoteInitialization(
                obj.string("instanceId"), obj.string("protocolVersion"), AgentRpc.parseCapabilities(obj),
                (sandbox?.get("enforcing") as? JsonPrimitive)?.booleanOrNull ?: false,
                (sandbox?.get("limitations") as? kotlinx.serialization.json.JsonArray).orEmpty().mapNotNull {
                    (it as? JsonPrimitive)?.takeIf { v -> v.isString }?.content
                },
            )
        }
    }
}

data class RemoteDurableEvent(val seq: String, val eventType: String, val data: String)
data class RemoteEventPage(
    val generation: String,
    val nextSeq: String,
    val hasMore: Boolean,
    val gap: String?,
    val events: List<RemoteDurableEvent>,
) {
    companion object {
        fun parse(obj: JsonObject): RemoteEventPage {
            val generation = obj.string("generation")
            require(generation.isNotBlank()) { "事件响应缺少 generation" }
            val events = obj.getValue("events").jsonArray.map { element ->
                val event = element as? JsonObject ?: error("事件项不是对象")
                val seq = event.string("seq")
                require(seq.matches(Regex("[0-9]{1,18}"))) { "事件游标无效" }
                RemoteDurableEvent(seq, event.string("eventType"), event.string("data"))
            }
            val nextSeq = obj.string("nextSeq")
            require(nextSeq.isEmpty() || nextSeq.matches(Regex("[0-9]{1,18}"))) { "分页游标无效" }
            val gap = (obj["gap"] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
            return RemoteEventPage(generation, nextSeq,
                (obj["hasMore"] as? JsonPrimitive)?.booleanOrNull ?: error("缺少 hasMore"), gap, events)
        }
    }
}

internal fun JsonObject.string(key: String): String =
    (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content.orEmpty()
