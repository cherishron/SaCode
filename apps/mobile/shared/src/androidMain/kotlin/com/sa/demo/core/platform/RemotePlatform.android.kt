package com.sa.demo.core.platform

import java.net.HttpURLConnection
import java.net.URL

actual fun remoteHttpExecuteBlocking(request: HttpRequest): HttpResponse {
    val connection = URL(request.url).openConnection() as HttpURLConnection
    connection.instanceFollowRedirects = false
    connection.requestMethod = request.method
    connection.connectTimeout = 15_000
    connection.readTimeout = 30_000
    request.headers.forEach { (key, value) -> connection.setRequestProperty(key, value) }
    try {
        request.body?.let { body ->
            val bytes = body.encodeToByteArray()
            require(bytes.size <= 1_048_576) { "请求体过大" }
            connection.doOutput = true
            connection.setFixedLengthStreamingMode(bytes.size)
            connection.outputStream.use { it.write(bytes) }
        }
        val status = connection.responseCode
        if (status in 300..399) throw IllegalStateException("设备接口禁止重定向")
        val stream = if (status >= 400) connection.errorStream else connection.inputStream
        val text = stream?.use { input ->
            val output = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(8192)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                require(output.size() + count <= 1_048_576) { "响应体过大" }
                output.write(buffer, 0, count)
            }
            output.toByteArray().toString(Charsets.UTF_8)
        }.orEmpty()
        return HttpResponse(status, text)
    } finally { connection.disconnect() }
}

actual fun remoteWait(delayMs: Long, token: CancelToken): Boolean {
    val latch = java.util.concurrent.CountDownLatch(1)
    val removeHook = token.registerCancel { latch.countDown() }
    try {
        latch.await(delayMs, java.util.concurrent.TimeUnit.MILLISECONDS)
        return !token.isCancelled
    } finally { removeHook() }
}

actual fun postToKuikly(block: () -> Unit) {
    val dispatch = KuiklyThreadBridge.dispatch ?: error("Kuikly 线程桥未初始化")
    dispatch(block)
}

actual fun remoteStreamSse(request: HttpRequest, token: CancelToken, onLine: (String) -> Unit) {
    val connection = URL(request.url).openConnection() as HttpURLConnection
    connection.instanceFollowRedirects = false
    connection.connectTimeout = 15_000
    connection.readTimeout = 45_000
    connection.requestMethod = "GET"
    request.headers.forEach { (key, value) -> connection.setRequestProperty(key, value) }
    val removeHook = token.registerCancel { connection.disconnect() }
    try {
        if (token.isCancelled) return
        val status = connection.responseCode
        if (status != 200) throw RemoteStreamException(status, "事件连接失败（HTTP $status）")
        val mediaType = connection.contentType.orEmpty().substringBefore(';').trim().lowercase()
        if (mediaType != "text/event-stream") throw RemoteStreamException(status, "事件连接媒体类型无效")
        connection.inputStream.bufferedReader(Charsets.UTF_8).use { reader ->
            while (!token.isCancelled) {
                val line = reader.readLine() ?: break
                // 完整空行是帧终止信号，必须交给解析器。
                onLine(line)
            }
        }
    } catch (e: Exception) {
        if (!token.isCancelled) throw e
    } finally { removeHook(); connection.disconnect() }
}
