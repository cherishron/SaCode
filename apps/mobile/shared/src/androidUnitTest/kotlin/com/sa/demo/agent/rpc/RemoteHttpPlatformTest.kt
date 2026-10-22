package com.sa.demo.agent.rpc

import com.sa.demo.core.platform.HttpRequest
import com.sa.demo.core.platform.remoteHttpExecuteBlocking
import com.sa.demo.core.platform.remoteStreamSse
import com.sa.demo.core.platform.CancelToken
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

/** 真实 JVM HTTP 连接、本机随机端口；不依赖 daemon 或 Android UI。 */
class RemoteHttpPlatformTest {
    @Test fun registration_post_never_follows_redirect_or_forwards_secret() {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        val forwarded = AtomicInteger()
        server.createContext("/auth/enroll") { exchange ->
            exchange.requestBody.use { it.readBytes() }
            exchange.responseHeaders.add("Location", "/capture")
            exchange.sendResponseHeaders(307, -1)
            exchange.close()
        }
        server.createContext("/capture") { exchange ->
            forwarded.incrementAndGet()
            exchange.sendResponseHeaders(200, -1)
            exchange.close()
        }
        server.start()
        try {
            assertFailsWith<IllegalStateException> {
                remoteHttpExecuteBlocking(HttpRequest("POST", "http://127.0.0.1:${server.address.port}/auth/enroll",
                    mapOf("Content-Type" to "application/json"), "{\"enrollmentSecret\":\"never-forward\"}"))
            }
            assertEquals(0, forwarded.get())
        } finally { server.stop(0) }
    }

    @Test fun response_larger_than_one_mebibyte_is_rejected() {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/large") { exchange ->
            val body = ByteArray(1_048_577) { 65 }
            exchange.sendResponseHeaders(200, body.size.toLong())
            exchange.responseBody.use { it.write(body) }
        }
        server.start()
        try {
            assertFailsWith<IllegalArgumentException> {
                remoteHttpExecuteBlocking(HttpRequest("GET", "http://127.0.0.1:${server.address.port}/large"))
            }
        } finally { server.stop(0) }
    }

    @Test fun stream_keeps_blank_lines_and_multibyte_text() {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/sse") { exchange ->
            val body = "event: durable\r\ndata: 中文\r\n\r\n".encodeToByteArray()
            exchange.responseHeaders.add("Content-Type", "text/event-stream; charset=utf-8")
            exchange.sendResponseHeaders(200, body.size.toLong())
            exchange.responseBody.use { it.write(body) }
        }
        server.start()
        try {
            val lines = mutableListOf<String>()
            remoteStreamSse(HttpRequest("GET", "http://127.0.0.1:${server.address.port}/sse"), CancelToken()) { lines += it }
            assertEquals(listOf("event: durable", "data: 中文", ""), lines)
        } finally { server.stop(0) }
    }
}
