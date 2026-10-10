// SSE 订阅侧：握手状态先判，再逐帧交付；关闭原因是一等数据的帧，不是「流没了」。
//
// 读循环放在守护线程里往有界队列投帧，`next(timeoutMs)` 才能既给测试一个明确的
// 等待上界，又不把「服务端没东西可发」和「连接断了」混成同一种结局。
package sacode

import java.io.BufferedReader
import java.io.InputStream
import java.io.InputStreamReader
import java.net.URI
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

class SseFrame(
    val greeting: Boolean = false,
    val event: String = "",
    val data: String = "",
    val id: String? = null,
    val error: String? = null
)

class SseStream internal constructor(private val body: InputStream, val httpStatus: Int) {
    private val queue = LinkedBlockingQueue<SseFrame>()
    @Volatile private var stopped = false

    init {
        val t = Thread({ readLoop() })
        t.isDaemon = true
        t.name = "sacode-sse-reader"
        t.start()
    }

    private fun readLoop() {
        try {
            val reader = BufferedReader(InputStreamReader(body, Charsets.UTF_8))
            var event = ""
            var data = StringBuilder()
            var id: String? = null
            var comment = false
            while (true) {
                val line = reader.readLine() ?: break
                if (line.isEmpty()) {
                    if (comment) {
                        queue.add(SseFrame(greeting = true, event = "connected"))
                    } else if (event.isNotEmpty() || data.isNotEmpty()) {
                        queue.add(SseFrame(event = event, data = data.toString(), id = id))
                    }
                    event = ""
                    data = StringBuilder()
                    id = null
                    comment = false
                    continue
                }
                if (line.startsWith(":")) { comment = true; continue }
                if (line.startsWith("event:")) event = line.substring(6).trim()
                else if (line.startsWith("data:")) {
                    if (data.isNotEmpty()) data.append("\n")
                    data.append(line.substring(5).trimStart())
                } else if (line.startsWith("id:")) id = line.substring(3).trim()
            }
            queue.add(SseFrame(event = "close", data = "{\"reason\":\"stream-ended\"}"))
        } catch (e: Throwable) {
            if (!stopped) queue.add(SseFrame(event = "error", data = "", error = e.javaClass.simpleName))
        }
    }

    fun next(timeoutMs: Long): SseFrame? = queue.poll(timeoutMs, TimeUnit.MILLISECONDS)

    fun close() {
        stopped = true
        try { body.close() } catch (_: Exception) {}
    }
}

class SseClient(
    private val transport: SecureTransport,
    private val base: String,
    private val bearer: () -> String
) {
    fun open(lastEventId: String?): SseStream {
        val root = validatedBase(base)
        val auth = try {
            bearer()
        } catch (e: Throwable) {
            ""
        }
        val builder = HttpRequest.newBuilder(URI.create("$root/sse"))
            .timeout(Duration.ofSeconds(60))
            .header("Accept", "text/event-stream")
        if (auth.isNotBlank()) builder.header("Authorization", auth)
        if (lastEventId != null && lastEventId.isNotBlank()) builder.header("Last-Event-ID", lastEventId)
        val resp = transport.client().send(builder.GET().build(), HttpResponse.BodyHandlers.ofInputStream())
        if (resp.statusCode() != 200) {
            try { resp.body().close() } catch (_: Exception) {}
            throw IllegalStateException("sse-http-${resp.statusCode()}")
        }
        val contentType = resp.headers().firstValue("content-type").orElse("")
        if (!contentType.startsWith("text/event-stream")) {
            try { resp.body().close() } catch (_: Exception) {}
            throw IllegalStateException("sse-content-type-$contentType")
        }
        return SseStream(resp.body(), resp.statusCode())
    }
}
