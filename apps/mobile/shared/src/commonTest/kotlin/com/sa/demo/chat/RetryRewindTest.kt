package com.sa.demo.chat

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class RetryRewindTest {

    private fun u(text: String) = ChatTurn("user", text)
    private fun a(text: String) = ChatTurn("assistant", text)

    private fun roles(turns: List<ChatTurn>) = turns.map { "${it.role}:${it.content}" }

    @Test
    fun empty_history_stays_empty() {
        assertTrue(RetryRewind.rewind(emptyList()).isEmpty())
    }

    @Test
    fun failed_path_history_already_has_no_user_turn() {
        // 发送失败后 onFailure 删掉了 user 轮 -> history 为空，重试不应再摘
        val history = emptyList<ChatTurn>()
        assertTrue(RetryRewind.rewind(history).isEmpty())
    }

    @Test
    fun stopped_path_drops_assistant_then_user() {
        // 用户停止后 history = [user, assistant]；两者都要摘，否则 send 会重复追加 user
        val history = listOf(u("hi"), a("部分回复"))
        assertTrue(RetryRewind.rewind(history).isEmpty())
    }

    @Test
    fun only_trailing_pair_is_removed() {
        val history = listOf(u("q1"), a("r1"), u("q2"), a("半截"))
        assertEquals(listOf("user:q1", "assistant:r1"), roles(RetryRewind.rewind(history)))
    }

    @Test
    fun lone_trailing_user_is_removed() {
        // 例如仅追加了 user 轮就中断
        val history = listOf(u("q1"), a("r1"), u("q2"))
        assertEquals(listOf("user:q1", "assistant:r1"), roles(RetryRewind.rewind(history)))
    }

    @Test
    fun trailing_assistant_only_is_removed() {
        val history = listOf(u("q1"), a("r1"), a("r2"))
        assertEquals(listOf("user:q1", "assistant:r1"), roles(RetryRewind.rewind(history)))
    }

    @Test
    fun original_list_is_not_mutated() {
        val history = mutableListOf(u("hi"), a("部分"))
        RetryRewind.rewind(history)
        assertEquals(2, history.size, "rewind 应返回新列表，不得改动入参")
    }

    @Test
    fun round_trip_retry_does_not_duplicate_user_turn() {
        // 模拟「停止 -> 重试」：回退后由 send 重新追加 user，应恰好一条
        var history = listOf(u("hi"), a("部分回复"))
        history = RetryRewind.rewind(history)
        history = history + u("hi") // send() 的 history.add(user)
        assertEquals(listOf("user:hi"), roles(history))
    }
}
