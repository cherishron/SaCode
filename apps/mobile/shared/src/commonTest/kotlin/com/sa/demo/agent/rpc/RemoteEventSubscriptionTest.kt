package com.sa.demo.agent.rpc

import com.sa.demo.core.platform.CancelToken
import com.sa.demo.core.platform.HttpResponse
import com.sa.demo.storage.SecureStore
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class RemoteEventSubscriptionTest {
    private fun auth(): RemoteAuthRepository {
        val values = mutableMapOf<String, String>()
        val store = object : SecureStore {
            override fun getString(key: String) = values[key]
            override fun putString(key: String, value: String) { values[key] = value }
            override fun remove(key: String) { values.remove(key) }
            override fun clear() { values.clear() }
        }
        val vault = RemoteCredentialVault(store)
        vault.save("a", "t", RemoteDeviceCredential("i", "d", "c"))
        return RemoteAuthRepository("https://pc.example", "a", "t", vault, RemoteHttpExecutor {
            HttpResponse(200, """{"accessToken":"token","expiresInMs":60000,"tokenType":"Bearer"}""")
        })
    }

    @Test fun durable_cursor_reused_but_wrong_session_and_ephemeral_do_not_advance_it() {
        var connects = 0
        var refreshes = 0
        val token = CancelToken()
        val subscription = RemoteEventSubscription("https://pc.example", "s", auth(), RemoteStreamExecutor { request, _, line ->
            connects++
            if (connects == 2) {
                assertEquals("s|12", request.headers["Last-Event-ID"])
                token.cancel()
            } else {
                line("id: wrong|11"); line("event: durable")
                line("data: {\"sessionId\":\"wrong\",\"seq\":\"11\"}"); line("")
                line("id: s|12"); line("event: durable")
                line("data: {\"sessionId\":\"s\",\"seq\":\"12\"}"); line("")
                line("event: ephemeral")
                line("data: {\"jsonrpc\":\"2.0\",\"method\":\"approval/asked\",\"params\":{\"sessionId\":\"s\"}}"); line("")
            }
        }, { _, _ -> true })
        subscription.run(token, {}, { refreshes++ })
        assertEquals(2, connects)
        assertEquals(3, refreshes) // durable、瞬时提示、断线补读
    }

    @Test fun revoked_stream_does_not_reconnect() {
        var connects = 0
        val states = mutableListOf<String>()
        val subscription = RemoteEventSubscription("https://pc.example", "s", auth(), RemoteStreamExecutor { _, _, line ->
            connects++
            line("event: close"); line("data: {\"reason\":\"revoked\"}"); line("")
        }, { _, _ -> error("不应重连") })
        subscription.run(CancelToken(), { states += it }, {})
        assertEquals(1, connects)
        assertTrue(states.last().contains("撤销"))
    }
}
