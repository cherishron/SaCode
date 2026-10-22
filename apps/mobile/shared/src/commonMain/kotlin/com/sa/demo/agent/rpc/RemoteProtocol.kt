package com.sa.demo.agent.rpc

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** 只接受无路径、无凭据的 HTTP(S) 服务根地址；回环例外必须匹配完整主机。 */
object RemoteEndpoint {
    fun validate(raw: String): String? {
        val value = raw.trim().trimEnd('/')
        val match = Regex("^(https?)://(\\[[0-9a-fA-F:]+]|[A-Za-z0-9.-]+)(?::([0-9]{1,5}))?$").matchEntire(value)
            ?: return "地址必须为 HTTP(S) 服务根地址，不能包含用户名、路径、查询或片段"
        val port = match.groupValues[3]
        if (port.isNotEmpty() && port.toInt() !in 1..65535) return "端口须为 1–65535"
        val host = match.groupValues[2].lowercase()
        val parts = host.split('.')
        val ipv4Loopback = parts.size == 4 && parts[0] == "127" && parts.all {
            it.isNotEmpty() && it.all(Char::isDigit) && it.toIntOrNull() in 0..255 && (it == "0" || !it.startsWith('0'))
        }
        val loopback = host == "localhost" || host == "[::1]" || ipv4Loopback
        if (match.groupValues[1] == "http" && !loopback) return "远程连接须使用 HTTPS，不能明文传输令牌"
        return null
    }
}

/** 资源上下文不能被业务参数覆盖。operationId 属于逻辑操作，不是 HTTP 请求编号。 */
data class RemoteRequestContext(val workspaceId: String, val sessionId: String = "") {
    fun params(extra: JsonObject = JsonObject(emptyMap()), operationId: String? = null): JsonObject {
        require(workspaceId.isNotBlank()) { "缺少 workspaceId" }
        require(extra.keys.none { it in setOf("workspaceId", "sessionId", "operationId") }) { "业务参数不能覆盖资源上下文" }
        return buildJsonObject {
            extra.forEach { (key, value) -> put(key, value) }
            put("workspaceId", workspaceId)
            if (sessionId.isNotBlank()) put("sessionId", sessionId)
            operationId?.let { require(it.isNotBlank()); put("operationId", it) }
        }
    }
}

data class RemoteSseFrame(val id: String?, val event: String, val data: String)

/** 按空行交付完整帧。输入为解码后的完整行，调用方必须保留空行。 */
class RemoteSseParser(private val maxFrameBytes: Int = 1_048_576) {
    private var id: String? = null
    private var event = "message"
    private val data = mutableListOf<String>()
    private var bytes = 0

    fun accept(rawLine: String): RemoteSseFrame? {
        val line = rawLine.removeSuffix("\r")
        bytes += line.encodeToByteArray().size + 1
        require(bytes <= maxFrameBytes) { "SSE 帧超过大小限制" }
        if (line.isEmpty()) {
            val frame = if (data.isEmpty()) null else RemoteSseFrame(id, event, data.joinToString("\n"))
            reset()
            return frame
        }
        if (line.startsWith(':')) return null
        val colon = line.indexOf(':')
        val field = if (colon < 0) line else line.take(colon)
        val value = if (colon < 0) "" else line.substring(colon + 1).removePrefix(" ")
        when (field) {
            "id" -> if ('\u0000' !in value) id = value
            "event" -> event = value
            "data" -> data += value
        }
        return null
    }

    /** EOF 的未完成帧不得当作成功事件。 */
    fun reset() {
        id = null
        event = "message"
        data.clear()
        bytes = 0
    }
}

/** 完整帧原样保留：瞬时通知没有持久游标，禁止自行制造续读承诺。 */
data class RemoteNotification(val method: String, val params: JsonElement?) {
    companion object {
        fun parse(obj: JsonObject): RemoteNotification? {
            if ((obj["jsonrpc"] as? JsonPrimitive)?.content != "2.0") return null
            if (obj.keys.any { it in setOf("id", "result", "error") }) return null
            val method = (obj["method"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
            return method.takeIf { it.isNotBlank() }?.let { RemoteNotification(it, obj["params"]) }
        }
    }
}
