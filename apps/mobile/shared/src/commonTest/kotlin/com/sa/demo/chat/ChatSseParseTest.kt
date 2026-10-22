package com.sa.demo.chat

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ChatSseParseTest {

    @Test
    fun parse_sse_data_line() {
        assertEquals("{\"a\":1}", ChatRepository.parseSseDataLine("data: {\"a\":1}"))
        assertEquals("[DONE]", ChatRepository.parseSseDataLine("data: [DONE]"))
        assertNull(ChatRepository.parseSseDataLine("event: message"))
        assertNull(ChatRepository.parseSseDataLine(""))
    }

    @Test
    fun parse_delta_from_chunk() {
        val json = """{"choices":[{"delta":{"content":"Hello"}}]}"""
        assertEquals("Hello", ChatRepository.parseDelta(json))
        val full = """{"choices":[{"message":{"role":"assistant","content":"World"}}]}"""
        assertEquals("World", ChatRepository.parseDelta(full))
        assertNull(ChatRepository.parseDelta("not-json"))
    }

    @Test
    fun chat_url_points_to_gateway() {
        val env = com.sa.demo.env.SaaiEnv.Dev
        assertTrue(ChatRepository.chatUrl(env).endsWith("/v1/chat/completions"))
        assertTrue(ChatRepository.chatUrl(env).startsWith("http://127.0.0.1:8090"))
    }
}
