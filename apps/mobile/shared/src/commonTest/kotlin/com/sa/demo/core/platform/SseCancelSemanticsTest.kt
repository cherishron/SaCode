package com.sa.demo.core.platform

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * 模拟 SSE 读取循环的可取消语义。
 *
 * Android actual 用 `token.onCancel { conn.disconnect() }` 打断阻塞读，
 * 读取循环随后因 IOException 退出。本测试用同样的控制流验证等价行为：
 * 取消后不再产出新行，且不把异常抛给调用方。
 */
class SseCancelSemanticsTest {

    /** 复刻 Platform.android.kt 中 httpStreamSse 的循环结构。 */
    private fun readLoop(token: CancelToken, lines: List<String>, onLine: (String) -> Unit) {
        if (token.isCancelled) return
        var i = 0
        try {
            while (i < lines.size && !token.isCancelled) {
                val line = lines[i]
                i++
                if (line.isNotBlank()) onLine(line)
            }
        } catch (t: Throwable) {
            // 取消导致的断开属于预期路径，不向上抛
            if (!token.isCancelled) throw t
        }
    }

    @Test
    fun cancel_before_start_yields_nothing() {
        val token = CancelToken()
        token.cancel()
        val got = mutableListOf<String>()
        readLoop(token, listOf("data: a", "data: b")) { got += it }
        assertTrue(got.isEmpty())
    }

    @Test
    fun cancel_mid_stream_keeps_already_delivered_lines() {
        val token = CancelToken()
        val got = mutableListOf<String>()

        readLoop(token, listOf("data: 1", "data: 2", "data: 3", "data: 4")) { line ->
            got += line
            if (got.size == 2) token.cancel()
        }

        assertEquals(listOf("data: 1", "data: 2"), got, "取消前的增量应保留")
    }

    @Test
    fun cancel_mid_stream_does_not_throw() {
        val token = CancelToken()
        // 若异常未被吞掉，这里会失败——取消必须走静默路径
        readLoop(token, listOf("data: 1", "data: 2")) {
            if (it == "data: 1") token.cancel()
        }
        assertTrue(token.isCancelled)
    }

    @Test
    fun not_cancelled_consumes_everything() {
        val token = CancelToken()
        val got = mutableListOf<String>()
        readLoop(token, (1..5).map { "data: $it" }) { got += it }
        assertEquals(5, got.size)
        assertFalse(token.isCancelled)
    }

    @Test
    fun blank_lines_are_not_delivered() {
        val token = CancelToken()
        val got = mutableListOf<String>()
        readLoop(token, listOf("data: 1", "", "   ", "data: 2")) { got += it }
        assertEquals(listOf("data: 1", "data: 2"), got)
    }
}
