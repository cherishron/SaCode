package com.sa.demo.agent.rpc

import com.sa.demo.core.platform.HttpResponse
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class RemoteReadRecoveryTest {
    @Test fun invalid_token_refreshes_once_but_scope_denial_never_refreshes() {
        var calls = 0
        var refreshed = 0
        val client = RemoteDaemonClient("https://pc.example", { "token" }, RemoteHttpExecutor {
            calls++
            if (calls == 1) HttpResponse(200, """{"jsonrpc":"2.0","id":"req","error":{"code":-32001,"message":"authz-denied:invalid-token"}}""")
            else HttpResponse(200, """{"jsonrpc":"2.0","id":"req","result":{}}""")
        }, { "req" }, { refreshed++ })
        client.call("initialize")
        assertEquals(2, calls)
        assertEquals(1, refreshed)
        val denied = RemoteDaemonClient("https://pc.example", { "token" }, RemoteHttpExecutor {
            HttpResponse(200, """{"jsonrpc":"2.0","id":"req","error":{"code":-32001,"message":"authz-denied:scope-required"}}""")
        }, { "req" }, { error("不能通过刷新绕过权限") })
        assertFailsWith<RemoteRpcException> { denied.call("initialize") }
    }

    @Test fun repeated_auth_failure_is_bounded() {
        var calls = 0
        val client = RemoteDaemonClient("https://pc.example", { "token" }, RemoteHttpExecutor {
            calls++
            HttpResponse(401, "")
        }, { "req" })
        assertFailsWith<RemoteRpcException> { client.call("initialize") }
        assertEquals(2, calls)
    }
}
