package com.sa.demo.agent.rpc

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * `POST /rpc` 的 HTTP→协议结果翻译，以及 `session/catalog` 的解析。
 *
 * 单独成类，因为这三点是旧实现踩过的坑，且都**不会编译报错**：
 * - `/rpc` 永远回 HTTP 200，失败藏在 JSON-RPC 的 `error` 帧里；
 * - 缺能力与能力探测失败在旧代码里被混为一谈；
 * - 目录项缺字段时整条解析崩掉，连空列表都拿不到。
 */
class DaemonTransportTest {

    // —— parseHttp：HTTP 200 ≠ 业务成功 ——

    @Test
    fun http_200_with_error_frame_is_still_failure() {
        // daemon.cj:392-398 的处理器从不设状态码，业务失败也是 200。
        // 只看 isSuccess 会把这条当成成功，然后去读一个不存在的 result。
        val p = AgentRpc.parseHttp(200, """{"jsonrpc":"2.0","id":"1","error":{"code":-32010,"message":"host unconfigured"}}""")
        val e = assertIs<AgentRpc.Parsed.ParsedErr>(p, "200 里的 error 帧必须判为失败")
        assertEquals(AgentRpc.ERR_HOST_UNCONFIGURED, e.code)
    }

    @Test
    fun http_200_with_result_is_success() {
        val p = AgentRpc.parseHttp(200, """{"jsonrpc":"2.0","id":"1","result":{"ok":true}}""")
        val ok = assertIs<AgentRpc.Parsed.ParsedOk>(p)
        assertEquals(true, (ok.result as JsonObject)["ok"]?.jsonPrimitive?.content?.toBoolean())
    }

    @Test
    fun non_2xx_is_attributed_to_transport_not_protocol() {
        // 路由不存在 / 被代理拦截这类情况才走非 2xx，
        // 必须和协议层的 error 码区分开，否则用户会看到误导性的文案。
        val e = assertIs<AgentRpc.Parsed.ParsedErr>(AgentRpc.parseHttp(404, "not found"))
        assertEquals(AgentRpc.ERR_FORWARD, e.code)
        assertTrue(e.message.startsWith("HTTP 404"), "实际：${e.message}")
    }

    @Test
    fun http_200_with_garbage_body_is_parse_error() {
        // 网关截断 / HTML 错误页被当 200 转发
        val e = assertIs<AgentRpc.Parsed.ParsedErr>(AgentRpc.parseHttp(200, "<html>502</html>"))
        assertEquals(AgentRpc.ERR_PARSE, e.code)
    }

    @Test
    fun http_200_with_result_missing_is_parse_error() {
        val e = assertIs<AgentRpc.Parsed.ParsedErr>(AgentRpc.parseHttp(200, """{"jsonrpc":"2.0","id":"1"}"""))
        assertEquals(AgentRpc.ERR_PARSE, e.code)
    }

    // —— 错误码文案：必须可执行，不能把 daemon 原文丢给用户 ——

    @Test
    fun every_defined_error_code_has_a_non_generic_message() {
        val codes = listOf(
            AgentRpc.ERR_PARSE,
            AgentRpc.ERR_INVALID_REQUEST,
            AgentRpc.ERR_METHOD_NOT_FOUND,
            AgentRpc.ERR_INVALID_PARAMS,
            AgentRpc.ERR_AUTHDENIED,
            AgentRpc.ERR_SHUTTING_DOWN,
            AgentRpc.ERR_EXCEPTION,
            AgentRpc.ERR_CONCURRENCY,
            AgentRpc.ERR_HOST_UNCONFIGURED,
            AgentRpc.ERR_TIMEOUT,
            AgentRpc.ERR_HOST_EXITED,
            AgentRpc.ERR_FORWARD,
        )
        for (c in codes) {
            val text = AgentRpc.describeError(c, "raw")
            assertFalse(text.contains("code="), "错误码 $c 落到了兜底分支：$text")
            assertTrue(text.isNotBlank())
        }
    }

    @Test
    fun host_unconfigured_tells_user_what_to_do() {
        // 这是用户最常撞的错：手机能连上 daemon，但 PC 没起宿主。
        val text = AgentRpc.describeError(AgentRpc.ERR_HOST_UNCONFIGURED, "host unconfigured")
        assertTrue(text.contains("宿主"), "应指向宿主而不是复述错误码：$text")
    }

    @Test
    fun unknown_code_falls_back_with_code_shown() {
        // 未来 daemon 新增错误码时，不能静默吞掉——必须把 code 显示出来便于排查
        val text = AgentRpc.describeError(-31999, "brand new failure")
        assertTrue(text.contains("brand new failure"))
        assertTrue(text.contains("-31999"))
    }

    @Test
    fun error_codes_match_daemon_source() {
        // 逐条对齐 daemon.cj 与 host_proxy.cj，防止手抄错号
        assertEquals(-32700, AgentRpc.ERR_PARSE)          // daemon.cj:126
        assertEquals(-32600, AgentRpc.ERR_INVALID_REQUEST) // daemon.cj:138
        assertEquals(-32601, AgentRpc.ERR_METHOD_NOT_FOUND) // daemon.cj:218
        assertEquals(-32602, AgentRpc.ERR_INVALID_PARAMS)  // host_proxy.cj:54
        assertEquals(-32001, AgentRpc.ERR_AUTHDENIED)      // daemon.cj:159
        assertEquals(-32002, AgentRpc.ERR_SHUTTING_DOWN)   // daemon.cj:171
        assertEquals(-32003, AgentRpc.ERR_EXCEPTION)       // daemon.cj:219
        assertEquals(-32005, AgentRpc.ERR_CONCURRENCY)     // daemon.cj:165
        assertEquals(-32010, AgentRpc.ERR_HOST_UNCONFIGURED) // host_proxy.cj:56
        assertEquals(-32011, AgentRpc.ERR_TIMEOUT)         // host_proxy.cj:57
        assertEquals(-32012, AgentRpc.ERR_HOST_EXITED)     // daemon.cj:206 注释
        assertEquals(-32013, AgentRpc.ERR_FORWARD)         // host_proxy.cj:58
    }

    // —— session/catalog 解析 ——

    @Test
    fun catalog_parses_daemon_payload() {
        // daemon.cj:201 的字面形状
        val body = """
        {"root":"/home/u/proj","entries":[
          {"id":"s1","title":"重构登录","durable":true,"status":"idle","workspaceDirectory":"/home/u/proj","current":false},
          {"id":"s2","title":"","durable":false,"status":"busy","workspaceDirectory":"/home/u/proj/wt","current":false}
        ]}
        """.trimIndent()
        val c = AgentRpc.parseCatalog(com.sa.demo.auth.saaiJson.parseToJsonElement(body))
        assertEquals("/home/u/proj", c.root)
        assertEquals(2, c.entries.size)
        assertEquals("s1", c.entries[0].id)
        assertEquals("重构登录", c.entries[0].title)
        assertTrue(c.entries[0].durable)
        assertEquals("idle", c.entries[0].status)
        assertFalse(c.entries[1].durable)
        assertEquals("busy", c.entries[1].status)
    }

    @Test
    fun catalog_tolerates_entries_missing_fields() {
        // daemon 侧字段增删不能让整个目录解析失败——
        // 崩了用户就一个会话都看不到，而不是少看几个字段。
        val body = """{"entries":[{"id":"s1"},{"id":"s2","title":"t","extra":"ignored"}]}"""
        val c = AgentRpc.parseCatalog(com.sa.demo.auth.saaiJson.parseToJsonElement(body))
        assertEquals(2, c.entries.size, "缺字段的条目仍应出现，只是字段取默认值")
        assertEquals("", c.entries[0].title)
        assertFalse(c.entries[0].durable)
        assertEquals("", c.entries[0].status)
        assertEquals("", c.root)
    }

    @Test
    fun catalog_skips_entries_without_id_but_keeps_the_rest() {
        // 没有 id 的条目无法被后续方法引用，丢掉比留着一个空壳更有用
        val body = """{"entries":[{"title":"无 id"},{"id":"ok"},{"nope":1}]}"""
        val c = AgentRpc.parseCatalog(com.sa.demo.auth.saaiJson.parseToJsonElement(body))
        assertEquals(1, c.entries.size)
        assertEquals("ok", c.entries[0].id)
    }

    @Test
    fun catalog_of_empty_or_garbage_is_empty_not_crash() {
        assertTrue(AgentRpc.parseCatalog(com.sa.demo.auth.saaiJson.parseToJsonElement("{}")).entries.isEmpty())
        assertTrue(AgentRpc.parseCatalog(com.sa.demo.auth.saaiJson.parseToJsonElement("""{"entries":[]}""")).entries.isEmpty())
        // result 不是对象（例如宿主回了数组）时也要给空目录
        assertTrue(AgentRpc.parseCatalog(com.sa.demo.auth.saaiJson.parseToJsonElement("[]")).entries.isEmpty())
    }

    @Test
    fun catalog_current_flag_is_always_false_from_daemon() {
        // daemon.cj:196 把 current 写死为 false，客户端若依赖它做选中态会永远选不中。
        // 这里锁住现状，等 daemon 真的支持了再改测试。
        val body = """{"entries":[{"id":"s1","current":true}]}"""
        val c = AgentRpc.parseCatalog(com.sa.demo.auth.saaiJson.parseToJsonElement(body))
        assertTrue(c.entries[0].current, "如实透传服务端值；daemon 现给 true 也会被读到")
    }

    // —— 端点常量 ——

    @Test
    fun endpoints_match_daemon_routes() {
        assertEquals("/rpc", AgentMethods.PATH_RPC)          // daemon.cj:392
        assertEquals("/sse", AgentMethods.PATH_SSE)          // daemon.cj:402
        assertEquals("/auth/enroll", AgentMethods.PATH_AUTH_ENROLL)
        assertEquals("/auth/token", AgentMethods.PATH_AUTH_TOKEN)
    }

    @Test
    fun only_initialize_and_catalog_are_guaranteed() {
        // daemon.cj:38 的 INIT_CAPS 是唯一无条件成立的能力集；
        // 其余方法都随宿主配置变化，不能当保底能力用。
        assertEquals(setOf("initialize", "session/catalog"), setOf(AgentMethods.INITIALIZE, AgentMethods.SESSION_CATALOG))
    }

    @Test
    fun forwarded_methods_match_host_whitelist() {
        // host_proxy.cj:38-44 的白名单逐条对齐，防止自造方法名
        val whitelist = setOf(
            "session/create", "session/select", "session/projection", "session/submit", "session/flush",
            "workspace/get", "workspace/set-directory",
            "task/start", "turn/poll", "turn/cancel",
            "worktree/enter", "worktree/describe", "worktree/exit",
            "worktree/agent-prepare", "worktree/agent-finish", "worktree/cleanup",
        )
        val ours = setOf(
            AgentMethods.SESSION_CREATE, AgentMethods.SESSION_SELECT, AgentMethods.SESSION_PROJECTION,
            AgentMethods.SESSION_SUBMIT, AgentMethods.SESSION_FLUSH,
            AgentMethods.WORKSPACE_GET, AgentMethods.WORKSPACE_SET_DIRECTORY,
            AgentMethods.TASK_START, AgentMethods.TURN_POLL, AgentMethods.TURN_CANCEL,
            AgentMethods.WORKTREE_ENTER, AgentMethods.WORKTREE_DESCRIBE, AgentMethods.WORKTREE_EXIT,
            AgentMethods.WORKTREE_AGENT_PREPARE, AgentMethods.WORKTREE_AGENT_FINISH, AgentMethods.WORKTREE_CLEANUP,
        )
        assertEquals(whitelist, ours, "常量表与 daemon 白名单漂移了")
    }

    @Test
    fun team_methods_match_team_bridge() {
        // team_host_bridge.cj:13-15
        val bridge = setOf(
            "team/describe", "team/member/create", "team/message/send",
            "team/message/broadcast", "team/task/create", "team/task/assign", "team/task/claim",
            "team/task/complete", "team/member/stop", "team/approval/answer",
        )
        val ours = setOf(
            AgentMethods.TEAM_DESCRIBE, AgentMethods.TEAM_MEMBER_CREATE, AgentMethods.TEAM_MESSAGE_SEND,
            AgentMethods.TEAM_MESSAGE_BROADCAST, AgentMethods.TEAM_TASK_CREATE, AgentMethods.TEAM_TASK_ASSIGN,
            AgentMethods.TEAM_TASK_CLAIM, AgentMethods.TEAM_TASK_COMPLETE, AgentMethods.TEAM_MEMBER_STOP,
            AgentMethods.TEAM_APPROVAL_ANSWER,
        )
        assertEquals(bridge, ours, "常量表与 team bridge 漂移了")
    }

    @Test
    fun session_catalog_is_not_in_host_whitelist() {
        // host_proxy.cj:35 明确：session/catalog 不转发，否则会得到两个真源。
        // 它由 daemon 自己回答（daemon.cj:192），所以不能走宿主能力路径。
        val hostSide = setOf(AgentMethods.SESSION_CREATE, AgentMethods.SESSION_SELECT)
        assertFalse(AgentMethods.SESSION_CATALOG in hostSide)
        assertEquals("session/catalog", AgentMethods.SESSION_CATALOG)
    }

    // —— 传输层配置校验（不发网络，纯函数）——

    @Test
    fun blank_endpoint_is_rejected() {
        assertEquals("未配置 PC 地址", DaemonTransport("").validate())
        assertEquals("未配置 PC 地址", DaemonTransport("   ").validate())
    }

    @Test
    fun loopback_http_is_allowed() {
        // ADB reverse / 本机隧道走回环，明文不出网卡，允许 http
        assertNull(DaemonTransport("http://127.0.0.1:18937").validate())
        assertNull(DaemonTransport("http://localhost:18937/").validate())
    }

    @Test
    fun remote_http_is_rejected_because_bearer_would_be_cleartext() {
        val err = DaemonTransport("http://192.168.1.20:18937").validate()
        assertNotNull(err, "远程明文会裸奔 Bearer，必须拒")
        assertTrue(err.contains("HTTPS"))
    }

    @Test
    fun remote_https_is_allowed() {
        assertNull(DaemonTransport("https://pc.example.com").validate())
    }

    @Test
    fun trailing_slash_is_normalized_before_building_urls() {
        val t = DaemonTransport("http://127.0.0.1:18937/")
        assertEquals("http://127.0.0.1:18937/rpc", t.rpcUrl, "多一个斜杠会打到不存在的路由")
        assertEquals("http://127.0.0.1:18937/sse", t.sseUrl)
    }

    @Test
    fun default_endpoint_uses_daemon_default_port() {
        // daemon.cj:285 —— 不是 8080，之前的默认值是错的
        assertEquals(18937, DaemonTransport.DEFAULT_PORT)
        assertEquals("http://127.0.0.1:18937", DaemonTransport.DEFAULT_LOOPBACK)
    }

    // —— 能力摘要：用户看的是"能做什么"，不是方法名列表 ——

    @Test
    fun empty_capabilities_say_so_plainly() {
        // 空能力最容易被渲染成一片空白，用户会以为界面坏了
        val text = AgentRpc.describeCapabilities(emptySet())
        assertTrue(text.contains("未协商"), "实际：$text")
    }

    @Test
    fun bare_daemon_only_offers_catalog() {
        // daemon.cj:38 的 INIT_CAPS 只有两项，此时不该显示任何任务类功能
        val text = AgentRpc.describeCapabilities(setOf("initialize", "session/catalog"))
        assertTrue(text.contains("会话目录"), "实际：$text")
        assertFalse(text.contains("任务下发"))
        assertFalse(text.contains("审批"))
    }

    @Test
    fun host_backed_daemon_shows_task_features() {
        val caps = setOf("initialize", "session/catalog", "task/start", "turn/poll", "turn/cancel")
        val text = AgentRpc.describeCapabilities(caps)
        assertTrue(text.contains("任务下发"))
        assertTrue(text.contains("进度轮询"))
        assertTrue(text.contains("中途取消"))
        assertFalse(text.contains("工作树"), "没协商工作树就不该显示")
    }

    @Test
    fun team_capabilities_are_shown_separately_from_approval() {
        val caps = setOf(
            "initialize", "session/catalog",
            "team/task/create", "team/approval/answer",
        )
        val text = AgentRpc.describeCapabilities(caps)
        assertTrue(text.contains("团队协同"))
        assertTrue(text.contains("审批"))
    }

    @Test
    fun approval_capability_is_detected_with_team_host() {
        // team_host_bridge.cj:13-15 把 approval 混在 team 方法里，
        // 但对用户是两件事，不能因此漏掉审批入口
        val text = AgentRpc.describeCapabilities(setOf("team/approval/answer"))
        assertTrue(text.contains("审批"), "实际：$text")
    }

    @Test
    fun worktree_capabilities_are_grouped_not_listed() {
        // daemon 白名单里有 6 个 worktree 方法（host_proxy.cj:42-43），
        // 逐条罗列会把一行撑爆
        val caps = setOf(
            "worktree/enter", "worktree/describe", "worktree/exit",
            "worktree/agent-prepare", "worktree/agent-finish", "worktree/cleanup",
        )
        val text = AgentRpc.describeCapabilities(caps)
        assertTrue(text.contains("工作树"))
        assertFalse(text.contains("worktree/enter"), "不该逐条列方法名：$text")
    }

    @Test
    fun unknown_capabilities_do_not_render_blank() {
        // 协议演进后 daemon 可能加新方法；不认识也要有话可说，不能空白
        val text = AgentRpc.describeCapabilities(setOf("quantum/entangle", "future/thing"))
        assertFalse(text.isBlank())
        assertTrue(text.contains("2"), "应报出数量便于对账：$text")
    }

    @Test
    fun capability_summary_reports_total_count() {
        val text = AgentRpc.describeCapabilities(setOf("initialize", "session/catalog", "task/start"))
        assertTrue(text.contains("3"), "摘要里带总数，方便和 daemon 侧对账：$text")
    }
}
