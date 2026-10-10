// JSON-RPC 客户端：信封按 0.2 的形状发，**HTTP 层与协议层分开归因**。
//
// 为什么要分档：401/413 这类是「请求没进到 RPC 面」，-32xxx 才是「RPC 面拒了你」。
// 混成一档会让调用方以为换个方法名就能过，实际缺的是认证。
package sacode

import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

sealed class RpcResult {
    data class Ok(val result: String, val id: Long) : RpcResult()
    data class Protocol(val code: Long, val message: String, val id: Long) : RpcResult()
    data class Http(val status: Int, val body: String) : RpcResult()
}

internal fun HttpClient.post(url: String, body: String, auth: String?): Pair<Int, String> {
    val builder = HttpRequest.newBuilder(URI.create(url))
        .timeout(Duration.ofSeconds(12))
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
    if (auth != null && auth.isNotBlank()) builder.header("Authorization", auth)
    val resp = this.send(builder.POST(HttpRequest.BodyPublishers.ofString(body)).build(),
        HttpResponse.BodyHandlers.ofString())
    return Pair(resp.statusCode(), resp.body())
}

class RpcClient(
    private val transport: SecureTransport,
    private val base: String,
    private val bearer: () -> String
) {
    fun call(method: String, params: String, id: Long): RpcResult = call(method, params, id, emptyMap())

    // 显式归属：workspaceId/sessionId/operationId 走 params 顶层，不靠服务端「当前会话」全局态。
    fun call(method: String, params: String, id: Long, ownership: Map<String, String>): RpcResult {
        val root = validatedBase(base)
        if (methodNameViolation(method) != "") throw IllegalArgumentException("method-name-invalid")
        val envelope = LinkedHashMap<String, Any?>()
        envelope["jsonrpc"] = "2.0"
        envelope["id"] = id
        envelope["method"] = method
        envelope["params"] = withOwnership(params, ownership)
        val auth = try {
            bearer()
        } catch (e: Throwable) {
            ""
        }
        val sent = transport.client().post("$root/rpc", Json.stringify(envelope), auth)
        if (sent.first != 200) return RpcResult.Http(sent.first, sent.second)
        val doc = try {
            Json.obj(Json.parse(sent.second))
        } catch (e: Throwable) {
            return RpcResult.Http(0, "unparseable-rpc-response")
        }
        val returnedId = (doc["id"] as? Long) ?: id
        val error = doc["error"]
        if (error != null) {
            val e = Json.obj(error)
            val code = e["code"] as? Long ?: -1L
            val message = e["message"] as? String ?: "no-message"
            return RpcResult.Protocol(code, message, returnedId)
        }
        return RpcResult.Ok(Json.stringify(doc["result"]), returnedId)
    }

    private fun withOwnership(params: String, ownership: Map<String, String>): Any? {
        val parsed = if (params.isBlank()) LinkedHashMap<String, Any?>() else Json.obj(Json.parse(params))
        if (ownership.isEmpty()) return parsed
        val merged = LinkedHashMap<String, Any?>()
        merged.putAll(parsed)
        for ((k, v) in ownership) if (v.isNotBlank()) merged[k] = v
        return merged
    }

    companion object {
        private val ALLOWED = Regex("^[A-Za-z0-9._/-]{1,64}$")
        fun methodNameViolation(method: String): String = if (ALLOWED.matches(method)) "" else "method-name-invalid"
    }
}
