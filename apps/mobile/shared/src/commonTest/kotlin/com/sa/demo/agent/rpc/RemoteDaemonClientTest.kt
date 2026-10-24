package com.sa.demo.agent.rpc

import com.sa.demo.auth.saaiJson
import com.sa.demo.core.platform.HttpResponse
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class RemoteDaemonClientTest {
    @Test fun protected_read_request_carries_context_and_checks_id() {
        val client = RemoteDaemonClient("https://pc.example", { "device-token" }, RemoteHttpExecutor { request ->
            assertEquals("Bearer device-token", request.headers["Authorization"])
            val body = saaiJson.parseToJsonElement(request.body!!).jsonObject
            assertEquals("session/events", body["method"]?.jsonPrimitive?.content)
            val params = body.getValue("params").jsonObject
            assertEquals("ws", params["workspaceId"]?.jsonPrimitive?.content)
            assertEquals("s", params["sessionId"]?.jsonPrimitive?.content)
            assertEquals("123", params["afterSeq"]?.jsonPrimitive?.content)
            assertFalse(params.containsKey("operationId"))
            HttpResponse(200, """{"jsonrpc":"2.0","id":"req","result":{"generation":"g","nextSeq":"124","hasMore":false,"gap":null,"events":[{"seq":"124","eventType":"user/message","data":"hello"}]}}""")
        }, { "req" })
        val page = client.events(RemoteRequestContext("ws", "s"), "123", "g")
        assertEquals("124", page.nextSeq)
        assertEquals("hello", page.events.single().data)
    }

    @Test fun initialize_sends_workspace_id_in_params() {
        val client = RemoteDaemonClient("https://pc.example", { "token" }, RemoteHttpExecutor { request ->
            val body = saaiJson.parseToJsonElement(request.body!!).jsonObject
            assertEquals("initialize", body["method"]?.jsonPrimitive?.content)
            val params = body.getValue("params").jsonObject
            assertEquals("ws", params["workspaceId"]?.jsonPrimitive?.content)
            HttpResponse(200, """{"jsonrpc":"2.0","id":"req","result":{"instanceId":"i","protocolVersion":"0.1","capabilities":[],"sandboxEnforcement":{"enforcing":false,"limitations":[]}}}""")
        }, { "req" })
        client.initialize("ws")
    }

    @Test fun initialize_does_not_treat_capability_as_execution_permission() {
        val client = RemoteDaemonClient("https://pc.example", { "token" }, RemoteHttpExecutor {
            HttpResponse(200, """{"jsonrpc":"2.0","id":"req","result":{"instanceId":"i","protocolVersion":"0.1","capabilities":["task/start"],"sandboxEnforcement":{"enforcing":false,"limitations":["no-file-system-isolation"]}}}""")
        }, { "req" })
        val init = client.initialize("ws")
        assertEquals("i", init.instanceId)
        assertTrue("task/start" in init.capabilities)
        assertFalse(init.sandboxEnforcing)
    }

    @Test fun wrong_response_id_is_not_accepted() {
        val client = RemoteDaemonClient("https://pc.example", { "token" }, RemoteHttpExecutor {
            HttpResponse(200, """{"jsonrpc":"2.0","id":"wrong","result":{}}""")
        }, { "req" })
        assertEquals(AgentRpc.ERR_PARSE, assertFailsWith<RemoteRpcException> { client.initialize("ws") }.failure.code)
    }

    @Test fun unsupported_page_shapes_fail_instead_of_advancing_cursor() {
        assertFailsWith<IllegalArgumentException> {
            RemoteEventPage.parse(saaiJson.parseToJsonElement("""{"generation":"g","nextSeq":"1","hasMore":false,"events":[{"seq":1,"eventType":"x","data":"y"}]}""").jsonObject)
        }
    }
}
