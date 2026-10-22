package com.sa.demo.core.platform

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CancelTokenTest {

    @Test
    fun fresh_token_is_not_cancelled() {
        assertFalse(CancelToken().isCancelled)
    }

    @Test
    fun cancel_flips_flag() {
        val t = CancelToken()
        t.cancel()
        assertTrue(t.isCancelled)
    }

    @Test
    fun hook_runs_once_on_cancel() {
        val t = CancelToken()
        var count = 0
        t.onCancel { count++ }
        assertEquals(0, count)

        t.cancel()
        assertEquals(1, count)

        t.cancel() // 幂等：重复 cancel 不应重复触发钩子
        assertEquals(1, count)
    }

    @Test
    fun hook_registered_after_cancel_runs_immediately() {
        val t = CancelToken()
        t.cancel()

        var ran = false
        t.onCancel { ran = true }
        assertTrue(ran, "已取消后注册的钩子应立即执行，否则资源不会被释放")
    }

    @Test
    fun multiple_hooks_all_run() {
        val t = CancelToken()
        var a = 0
        var b = 0
        t.onCancel { a++ }
        t.onCancel { b++ }
        t.cancel()
        assertEquals(1, a)
        assertEquals(1, b)
    }

    @Test
    fun throwing_hook_does_not_block_other_hooks() {
        val t = CancelToken()
        var reached = false
        t.onCancel { throw IllegalStateException("boom") }
        t.onCancel { reached = true }

        t.cancel()

        assertTrue(reached, "前一个钩子抛异常不应影响后续钩子")
        assertTrue(t.isCancelled)
    }

    @Test
    fun hook_registered_after_cancel_with_thrower_is_contained() {
        val t = CancelToken()
        t.cancel()
        // 已取消状态下注册抛异常的钩子，也不应把异常抛给调用方
        t.onCancel { throw IllegalStateException("boom") }
        assertTrue(t.isCancelled)
    }
}
