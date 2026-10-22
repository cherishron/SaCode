package com.sa.demo.agent.rpc

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

class RemoteProtocolTest {
    @Test fun only_real_loopback_can_use_cleartext() {
        listOf("http://localhost:18937", "http://127.0.0.1:18937", "http://[::1]:18937", "https://pc.example:443").forEach {
            assertNull(RemoteEndpoint.validate(it), it)
        }
        listOf("http://localhost.evil", "http://127.example", "http://127.0.0.999", "https://user@pc.example", "https://pc.example/path", "ftp://localhost", "https://pc.example:0", "https://pc.example:65536").forEach {
            assertNotNull(RemoteEndpoint.validate(it), it)
        }
    }

    @Test fun response_identity_and_exclusive_payload_are_validated() {
        val ok = """{"jsonrpc":"2.0","id":"a","result":null}"""
        assertIs<AgentRpc.Parsed.ParsedOk>(AgentRpc.parse(ok, "a"))
        assertIs<AgentRpc.Parsed.ParsedErr>(AgentRpc.parse(ok, "b"))
        assertIs<AgentRpc.Parsed.ParsedErr>(AgentRpc.parse("""{"id":"a","result":{}}"""))
        assertIs<AgentRpc.Parsed.ParsedErr>(AgentRpc.parse("""{"jsonrpc":"2.0","id":"a","result":{},"error":{"code":-1,"message":"bad"}}"""))
    }

    @Test fun structured_error_data_survives() {
        val error = assertIs<AgentRpc.Parsed.ParsedErr>(AgentRpc.parse("""{"jsonrpc":"2.0","id":"a","error":{"code":-32019,"message":"unknown","data":{"retryable":false}}}""", "a"))
        assertEquals(-32019, error.code)
        assertNotNull(error.data as? JsonObject)
    }

    @Test fun sse_preserves_frame_boundaries_and_multiline_data() {
        val parser = RemoteSseParser()
        assertNull(parser.accept(": connected"))
        assertNull(parser.accept(""))
        assertNull(parser.accept("id: s|12"))
        assertNull(parser.accept("event: durable"))
        assertNull(parser.accept("data: first"))
        assertNull(parser.accept("data: second\r"))
        assertEquals(RemoteSseFrame("s|12", "durable", "first\nsecond"), parser.accept(""))
        parser.accept("event: ephemeral")
        parser.accept("data: live")
        assertEquals(RemoteSseFrame(null, "ephemeral", "live"), parser.accept(""))
    }

    @Test fun explicit_resource_context_is_added() {
        val params = RemoteRequestContext("ws", "s").params(buildJsonObject { put("limit", 20) }, "op")
        assertEquals("\"ws\"", params["workspaceId"].toString())
        assertEquals("\"s\"", params["sessionId"].toString())
        assertEquals("\"op\"", params["operationId"].toString())
    }
}
