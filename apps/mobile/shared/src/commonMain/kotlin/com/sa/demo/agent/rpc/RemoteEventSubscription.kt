package com.sa.demo.agent.rpc

import com.sa.demo.auth.saaiJson
import com.sa.demo.core.platform.*
import kotlinx.serialization.json.JsonObject

fun interface RemoteStreamExecutor {
    fun stream(request: HttpRequest, token: CancelToken, line: (String) -> Unit)
}

/** 后台阻塞订阅。只接受当前会话 durable；瞬时通知仅作为刷新提示，不推进持久游标。 */
class RemoteEventSubscription(
    private val baseUrl: String,
    private val sessionId: String,
    private val auth: RemoteAuthRepository,
    private val stream: RemoteStreamExecutor = RemoteStreamExecutor(::remoteStreamSse),
    private val wait: (Long, CancelToken) -> Boolean = ::remoteWait,
) {
    fun run(token: CancelToken, onState: (String) -> Unit, onRefresh: () -> Unit) {
        require(RemoteEndpoint.validate(baseUrl) == null)
        require(sessionId.isNotBlank())
        var failures = 0
        var lastEventId = ""
        while (!token.isCancelled) {
            var closeReason: String? = null
            try {
                val bearer = auth.token()
                if (token.isCancelled) return
                val parser = RemoteSseParser()
                onState("事件订阅连接中")
                stream.stream(HttpRequest("GET", "${baseUrl.trimEnd('/')}/sse", buildMap {
                    put("Accept", "text/event-stream")
                    put("Authorization", "Bearer $bearer")
                    if (lastEventId.isNotBlank()) put("Last-Event-ID", lastEventId)
                }), token) { line ->
                    if (line.startsWith(':')) { onState("事件订阅已连接"); return@stream }
                    val frame = parser.accept(line) ?: return@stream
                    onState("事件订阅已连接")
                    val obj = runCatching { saaiJson.parseToJsonElement(frame.data) as? JsonObject }.getOrNull()
                        ?: return@stream
                    when (frame.event) {
                        "close" -> closeReason = obj.string("reason")
                        "ephemeral" -> {
                            val notification = RemoteNotification.parse(obj)
                            val params = notification?.params as? JsonObject
                            if (params?.string("sessionId") == sessionId) onRefresh()
                        }
                        else -> {
                            if (obj.string("sessionId") == sessionId) {
                                val seq = obj.string("seq")
                                if (seq.matches(Regex("[0-9]{1,18}")) && frame.id == "$sessionId|$seq") {
                                    lastEventId = frame.id
                                    failures = 0
                                    onRefresh()
                                }
                            }
                        }
                    }
                }
                if (token.isCancelled) return
                when (closeReason) {
                    "revoked", "device-revoked" -> { onState("设备已撤销，请重新登记"); return }
                    "expired", "token-expired" -> auth.invalidateToken()
                }
                onRefresh() // 连接关闭后补读，不能只依赖最多 200 条 SSE 自动回放。
            } catch (e: Exception) {
                if (token.isCancelled) return
                if (e is RemoteAuthException && e.status == 401) {
                    onState("设备凭据无效，请重新登记"); return
                }
                if (e is RemoteStreamException && e.status == 401) auth.invalidateToken()
                if (e is RemoteStreamException && e.status in listOf(403, 404)) {
                    onState("目标不允许事件订阅"); return
                }
            }
            failures++
            // 上限约 30 秒，加抖动；任何结束/错误均不忙循环。
            val delay = (1000L shl minOf(failures - 1, 5)).coerceAtMost(30_000L) + (0..500).random()
            onState("事件连接中断，稍后重连并补读")
            if (!wait(delay, token)) return
        }
    }
}
