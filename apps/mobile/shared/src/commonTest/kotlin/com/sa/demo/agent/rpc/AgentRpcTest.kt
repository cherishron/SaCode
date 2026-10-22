package com.sa.demo.agent.rpc

import com.sa.demo.auth.saaiJson
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AgentRpcTest {

    private fun parseOk(body: String) =
        assertIs<AgentRpc.Parsed.ParsedOk>(AgentRpc.parse(body), "应解析为成功帧").result

    private fun parseErr(body: String) =
        assertIs<AgentRpc.Parsed.ParsedErr>(AgentRpc.parse(body), "应解析为错误帧")

    // —— 请求构造 ——

    @Test
    fun request_carries_version_id_and_method() {
        val body = AgentRpc.request("7", "initialize")
        val o = saaiJson.parseToJsonElement(body).jsonObject
        assertEquals("2.0", o["jsonrpc"]?.jsonPrimitive?.content)
        assertEquals("7", o["id"]?.jsonPrimitive?.content)
        assertEquals("initialize", o["method"]?.jsonPrimitive?.content)
        assertNull(o["params"], "未传 params 时不应出现该键")
    }

    @Test
    fun request_id_is_string_so_daemon_accepts_it() {
        // daemon.cj:52-54 只接受 string 或 int；字符串同时避免大整数精度问题
        val body = AgentRpc.request("9007199254740993", AgentMethods.TASK_START)
        val id = saaiJson.parseToJsonElement(body).jsonObject["id"]
        assertTrue(id is kotlinx.serialization.json.JsonPrimitive)
        assertEquals("9007199254740993", id.jsonPrimitive.content)
    }

    @Test
    fun request_params_are_nested_under_params_key() {
        val p = buildJsonObject { put("prompt", "hi") }
        val o = saaiJson.parseToJsonElement(AgentRpc.request("1", AgentMethods.TASK_START, p)).jsonObject
        assertEquals("hi", o["params"]?.jsonObject?.get("prompt")?.jsonPrimitive?.content)
    }

    // —— 响应解析（帧格式逐字对齐 daemon.cj:13-19）——

    @Test
    fun parse_success_frame() {
        val r = parseOk("""{"jsonrpc":"2.0","id":1,"result":{"ok":true}}""")
        assertEquals(true, r.jsonObject["ok"]?.jsonPrimitive?.content?.toBoolean())
    }

    @Test
    fun parse_error_frame_keeps_code_and_message() {
        val e = parseErr("""{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"method not found"}}""")
        assertEquals(-32601, e.code)
        assertEquals("method not found", e.message)
    }

    @Test
    fun parse_host_unconfigured_surfaces_distinct_code() {
        // host_proxy.cj:56 —— 宿主未配置；与「方法不存在」是不同故障，UI 提示也应不同
        val e = parseErr("""{"jsonrpc":"2.0","id":"1","error":{"code":-32010,"message":"host not configured"}}""")
        assertEquals(AgentRpc.ERR_HOST_UNCONFIGURED, e.code)
        assertTrue(AgentRpc.describeError(e.code, e.message).contains("宿主"))
    }

    @Test
    fun parse_non_json_body_reports_parse_error() {
        assertEquals(AgentRpc.ERR_PARSE, parseErr("<html>502</html>").code)
    }

    @Test
    fun parse_frame_without_result_or_error_is_parse_error() {
        assertEquals(AgentRpc.ERR_PARSE, parseErr("""{"jsonrpc":"2.0","id":1}""").code)
    }

    @Test
    fun ambiguous_result_and_error_is_rejected() {
        // 信封必须恰好包含其中之一；不可把损坏帧当业务失败处理。
        val e = parseErr("""{"jsonrpc":"2.0","id":1,"result":{},"error":{"code":-32002,"message":"shutting down"}}""")
        assertEquals(AgentRpc.ERR_PARSE, e.code)
    }

    @Test
    fun error_without_code_is_invalid_envelope() {
        val e = parseErr("""{"jsonrpc":"2.0","id":1,"error":{"message":"weird"}}""")
        assertEquals(AgentRpc.ERR_PARSE, e.code)
    }

    // —— 能力协商（daemon.cj:64-83）——

    @Test
    fun capabilities_are_read_from_initialize_result() {
        val r = parseOk(
            """{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"0.1","capabilities":["initialize","session/catalog","task/start"],"core":"cangjie","transport":"http-sse"}}"""
        )
        assertEquals(setOf("initialize", "session/catalog", "task/start"), AgentRpc.parseCapabilities(r))
        assertEquals("0.1", AgentRpc.parseProtocolVersion(r))
    }

    @Test
    fun capabilities_absent_yields_empty_set_not_crash() {
        // daemon.cj:76-79 明确：宿主不可用时不宣称其能力，客户端必须能吃空清单
        val r = parseOk("""{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"0.1","capabilities":[]}}""")
        assertTrue(AgentRpc.parseCapabilities(r).isEmpty())
        // 连 capabilities 键都没有时也不能崩
        val bare = parseOk("""{"jsonrpc":"2.0","id":1,"result":{}}""")
        assertTrue(AgentRpc.parseCapabilities(bare).isEmpty())
    }

    @Test
    fun capabilities_may_vary_by_host_availability() {
        // 同一 daemon，有宿主时多出 task/turn/worktree；这正是「能力驱动」的依据
        val withHost = parseOk(
            """{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"0.1","capabilities":["initialize","session/catalog","task/start","turn/cancel","team/approval/answer","worktree/enter"]}}"""
        )
        val caps = AgentRpc.parseCapabilities(withHost)
        assertTrue(AgentMethods.TASK_START in caps)
        assertTrue(AgentMethods.TURN_CANCEL in caps)
        assertTrue(AgentMethods.TEAM_APPROVAL_ANSWER in caps)
        assertTrue(AgentMethods.WORKTREE_ENTER in caps)
    }

    // —— SSE 事件（daemon.cj:138-160）——

    @Test
    fun sse_data_line_is_extracted() {
        assertEquals("""{"a":1}""", AgentSse.dataLine("""data: {"a":1}"""))
    }

    @Test
    fun sse_ignores_connected_and_keepalive_comments() {
        // daemon 连发 `: connected` 与每秒 `: keepalive`；当事件解析会直接崩
        assertNull(AgentSse.dataLine(": connected"))
        assertNull(AgentSse.dataLine(": keepalive"))
        assertTrue(AgentSse.isComment(": connected"))
        assertTrue(AgentSse.isComment(": keepalive"))
        assertTrue(!AgentSse.isComment("""data: {"a":1}"""))
    }

    @Test
    fun sse_blank_and_unknown_lines_are_dropped() {
        assertNull(AgentSse.dataLine(""))
        assertNull(AgentSse.dataLine("   "))
        assertNull(AgentSse.dataLine("event: message"))
        assertNull(AgentSse.dataLine("id: 42"))
    }

    @Test
    fun sse_event_parses_to_object() {
        val o = AgentSse.parseEvent("""{"kind":"delta","text":"你好"}""")
        assertEquals("你好", o?.get("text")?.jsonPrimitive?.content)
        assertNull(AgentSse.parseEvent("not-json"))
    }

    @Test
    fun sse_text_extraction_accepts_known_keys_only() {
        assertEquals("片段", AgentSse.extractText(AgentSse.parseEvent("""{"kind":"delta","text":"片段"}""")!!))
        assertEquals("c", AgentSse.extractText(AgentSse.parseEvent("""{"content":"c"}""")!!))
        // 未知形状返回 null 而不是猜——协议演进时才不会静默丢数据
        assertNull(AgentSse.extractText(AgentSse.parseEvent("""{"kind":"progress","pct":40}""")!!))
    }
}
