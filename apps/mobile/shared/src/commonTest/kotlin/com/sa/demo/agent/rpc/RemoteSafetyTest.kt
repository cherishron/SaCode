package com.sa.demo.agent.rpc

import com.sa.demo.core.platform.CancelToken
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class RemoteSafetyTest {
    @Test fun removed_cancel_hook_is_not_retained_or_called() {
        val token = CancelToken()
        var calls = 0
        val remove = token.registerCancel { calls++ }
        remove()
        token.cancel()
        assertEquals(0, calls)
        token.registerCancel { calls++ }
        assertEquals(1, calls)
    }

    @Test fun read_client_rejects_execution_before_token_or_network() {
        val client = RemoteDaemonClient("https://pc.example", { error("不得读取令牌") }, RemoteHttpExecutor {
            error("不得发送网络请求")
        }, { "req" })
        assertFailsWith<IllegalArgumentException> { client.call("task/start") }
        assertFailsWith<IllegalArgumentException> { client.call("approval/answer") }
    }
}
