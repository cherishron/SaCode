package com.sa.demo.agent.rpc

import com.sa.demo.core.platform.CancelToken
import com.sa.demo.core.platform.HttpRequest
import com.sa.demo.core.platform.asyncRun
import com.sa.demo.core.platform.currentTimeMillis
import com.sa.demo.core.platform.httpExecuteBlocking
import com.sa.demo.core.platform.httpStreamSse
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * SaCode daemon 的 JSON-RPC 传输层。
 *
 * 协议事实来自 `sa-code/apps/daemon/src/daemon.cj`，逐条核对过：
 * - 业务面只有两个端点：`POST /rpc`（`daemon.cj:392`）与 `GET /sse`（`daemon.cj:402`）。
 *   `/health` 只给最小存活信息，且明确不含能力、目录、设备列表（`daemon.cj:367-368`）。
 * - `/rpc` 只接受 POST，`Content-Type` 必须以 `application/json` 开头
 *   （`daemon.cj:99-109`），否则回 `-32600`。
 * - `/rpc` 的处理器**从不设置 HTTP 状态码**（`daemon.cj:392-398` 只写 Content-Type
 *   与响应体），所以业务失败也是 HTTP 200，失败信息在 JSON-RPC 的 `error` 帧里。
 *   → 一律走 [AgentRpc.parseHttp]，不要用 `isSuccess` 判定业务成败。
 * - `/sse` 只接受 GET（其余方法回 405），未过认证回 401，并发超限回 429
 *   （`daemon.cj:404-424`）。
 * - 默认监听 `127.0.0.1:18937`（`daemon.cj:285` + `remote_access.cj:350`），
 *   可用 `--port` 覆盖；bind 由 `SACODE_REMOTE_BIND` 决定。
 *
 * **能力驱动**：daemon 的基础能力只有 `initialize` 与 `session/catalog`
 * （`daemon.cj:38`）。`task/start`、`turn/poll` 等只有在宿主配置后才登记，
 * `team` 开头的方法只有在团队宿主配置后才登记（`daemon.cj:172-188`）。
 * 所以业务方法调用前先 [initialize] 确认能力，否则只会拿到语义模糊的 -32601/-32010。
 */
class DaemonTransport(
    baseUrl: String,
    private val bearerToken: String = "",
) {

    /** 已归一化的 base，形如 `http://127.0.0.1:18937`（无尾部斜杠）。 */
    private val base: String = baseUrl.trim().trimEnd('/')

    val rpcUrl: String get() = "$base${AgentMethods.PATH_RPC}"
    val sseUrl: String get() = "$base${AgentMethods.PATH_SSE}"

    /**
     * 配置层面的问题（非协议问题），返回可展示的中文原因；无问题返回 null。
     *
     * 远程链路要求 HTTPS：Bearer 会明文过网。回环（127./localhost/::1）例外，
     * 那通常是 ADB reverse 或本机隧道，不出网卡。
     */
    fun validate(): String? = if (base.isBlank()) "未配置 PC 地址" else RemoteEndpoint.validate(base)

    private fun headers(json: Boolean) = buildMap {
        put("Accept", if (json) "application/json" else "text/event-stream")
        if (json) put("Content-Type", "application/json")
        if (bearerToken.isNotBlank()) put("Authorization", "Bearer $bearerToken")
    }

    /**
     * 发起一次 JSON-RPC 调用。
     *
     * @param params 必须是对象或 null——daemon 对非对象 `params` 直接回 -32600
     *               （`daemon.cj:145` 的 `asObject()`）。
     */
    fun call(method: String, params: JsonObject? = null, onDone: (AgentRpc.Parsed) -> Unit) {
        if (method !in setOf(AgentMethods.INITIALIZE, AgentMethods.SESSION_CATALOG, "session/events")) {
            onDone(AgentRpc.Parsed.ParsedErr(AgentRpc.ERR_FORWARD, "当前仅开放安全只读接入；执行与审批须等待权限、会话归属和沙箱验收"))
            return
        }
        val bad = validate()
        if (bad != null) {
            onDone(AgentRpc.Parsed.ParsedErr(AgentRpc.ERR_FORWARD, bad))
            return
        }
        val requestId = nextId()
        val body = AgentRpc.request(requestId, method, params)
        asyncRun({
            httpExecuteBlocking(HttpRequest("POST", rpcUrl, headers(json = true), body))
        }) { result ->
            result.fold(
                onSuccess = { onDone(AgentRpc.parseHttp(it.statusCode, it.body, requestId)) },
                onFailure = {
                    onDone(AgentRpc.Parsed.ParsedErr(AgentRpc.ERR_FORWARD, it.message ?: "网络失败"))
                },
            )
        }
    }

    // —— 业务方法 ——
    // 每个都先查能力再发。能力缺失时给出可执行提示，而不是把 daemon 的
    // -32601 / -32010 原文丢给用户。

    /** 能力协商。返回 (能力集合, 协议版本)；出错时能力为空集、版本为错误文案。 */
    fun initialize(onDone: (Set<String>, String?) -> Unit) {
        call(AgentMethods.INITIALIZE) { p ->
            when (p) {
                is AgentRpc.Parsed.ParsedOk ->
                    onDone(AgentRpc.parseCapabilities(p.result), AgentRpc.parseProtocolVersion(p.result))
                is AgentRpc.Parsed.ParsedErr -> onDone(emptySet(), AgentRpc.describeError(p.code, p.message))
            }
        }
    }

    /** 会话目录。daemon 自有方法，不依赖宿主。 */
    fun catalog(onDone: (AgentRpc.Catalog?, String?) -> Unit) {
        call(AgentMethods.SESSION_CATALOG) { p ->
            when (p) {
                is AgentRpc.Parsed.ParsedOk -> onDone(AgentRpc.parseCatalog(p.result), null)
                is AgentRpc.Parsed.ParsedErr -> onDone(null, AgentRpc.describeError(p.code, p.message))
            }
        }
    }

    /**
     * 发起一轮任务（`task/start`）。
     *
     * `prompt` 与 `mode` 透传给宿主；宿主侧必填校验失败会回 -32602。
     */
    fun startTask(
        prompt: String,
        mode: String = "build",
        sessionId: String? = null,
        onDone: (JsonObject?, String?) -> Unit,
    ) = requireCapability(AgentMethods.TASK_START, "请先在 PC 上启动宿主", onDone) {
        call(
            AgentMethods.TASK_START,
            buildJsonObject {
                put("prompt", prompt)
                put("mode", mode)
                sessionId?.takeIf { it.isNotBlank() }?.let { put("sessionId", it) }
            },
        ) { unwrap(onDone, it) }
    }

    /** 轮询一轮结果（`turn/poll`）。 */
    fun pollTurn(turnId: String, onDone: (JsonObject?, String?) -> Unit) =
        requireCapability(AgentMethods.TURN_POLL, "请先在 PC 上启动宿主", onDone) {
            call(AgentMethods.TURN_POLL, buildJsonObject { put("turnId", turnId) }) { unwrap(onDone, it) }
        }

    /** 取消一轮（`turn/cancel`）。 */
    fun cancelTurn(turnId: String, onDone: (JsonObject?, String?) -> Unit) =
        requireCapability(AgentMethods.TURN_CANCEL, "请先在 PC 上启动宿主", onDone) {
            call(AgentMethods.TURN_CANCEL, buildJsonObject { put("turnId", turnId) }) { unwrap(onDone, it) }
        }

    /** 审批答复（`team/approval/answer`）。需要团队宿主。 */
    fun answerApproval(
        approvalId: String,
        approved: Boolean,
        note: String = "",
        onDone: (JsonObject?, String?) -> Unit,
    ) = requireCapability(AgentMethods.TEAM_APPROVAL_ANSWER, "目标端未启用团队宿主", onDone) {
        call(
            AgentMethods.TEAM_APPROVAL_ANSWER,
            buildJsonObject {
                put("approvalId", approvalId)
                put("approved", approved)
                if (note.isNotBlank()) put("note", note)
            },
        ) { unwrap(onDone, it) }
    }

    // —— 事件流 ——

    /**
     * 订阅 `GET /sse`。
     *
     * daemon 行为（`daemon.cj:436-443`）：建连先发 `: connected`，空闲时每秒发
     * `: keepalive`，真实事件是 `data: <json>`。**必须过滤注释行**，
     * 否则会把心跳当事件解析。
     *
     * @param onEvent 收到一个事件载荷（心跳已滤掉）
     * @param onEnded 流结束或出错时回调一次；参数是原因，null 表示正常结束
     */
    fun openEvents(
        token: CancelToken,
        onEvent: (JsonObject) -> Unit,
        onEnded: (String?) -> Unit,
    ) {
        val bad = validate()
        if (bad != null) {
            onEnded(bad)
            return
        }
        val req = HttpRequest("GET", sseUrl, headers(json = false))
        // 包一层 try：断流是常态（切网、daemon 退出、宿主重启），
        // 异常必须变成 onEnded，而不是抛回后台线程把 App 带崩。
        try {
            httpStreamSse(req, token) { line ->
                if (AgentSse.isComment(line)) return@httpStreamSse
                val payload = AgentSse.dataLine(line) ?: return@httpStreamSse
                AgentSse.parseEvent(payload)?.let(onEvent)
            }
            onEnded(null)
        } catch (e: Throwable) {
            onEnded(e.message ?: "事件流中断")
        }
    }

    // —— 内部 ——

    /**
     * 先探能力再执行，缺能力时给出可执行提示。
     *
     * 为什么要多一次往返：daemon 的基础能力只有 `initialize` 与 `session/catalog`
     * （`daemon.cj:38`），业务能力随宿主与团队宿主是否配置而变化（`daemon.cj:172-188`）。
     * 不先问就发，拿回来的是 -32601（方法不存在）或 -32010（宿主未配置），
     * 两者语义不同且都不可执行；先问一次能给出「去 PC 上启动宿主」这种真提示。
     *
     * 代价是每个业务调用多一个 RTT。这里**故意不缓存**能力：宿主随时可能退出，
     * 缓存会引入「以为能做、实际回 -32012」的窗口。
     */
    private fun requireCapability(
        method: String,
        hint: String,
        onDone: (JsonObject?, String?) -> Unit,
        block: () -> Unit,
    ) {
        val bad = validate()
        if (bad != null) {
            onDone(null, bad)
            return
        }
        initialize { caps, err ->
            when {
                // initialize 本身就失败（网络不通/配置错）——此时无法判断能力，直接归因
                err != null -> onDone(null, err)
                method !in caps -> onDone(null, "目标端不支持「$method」：$hint")
                else -> block()
            }
        }
    }

    private fun unwrap(onDone: (JsonObject?, String?) -> Unit, p: AgentRpc.Parsed) {
        when (p) {
            is AgentRpc.Parsed.ParsedOk ->
                onDone(p.result as? JsonObject ?: JsonObject(emptyMap()), null)
            is AgentRpc.Parsed.ParsedErr -> onDone(null, AgentRpc.describeError(p.code, p.message))
        }
    }

    /**
     * 请求 id。用「毫秒 + 序号」字符串——daemon 只接受 string 或 int
     * （`daemon.cj:135-138`），其余类型直接 -32600。字符串还顺带避开大整数精度问题。
     */
    private fun nextId(): String = "${currentTimeMillis()}-${seq++}"

    companion object {
        /** daemon 默认端口（`daemon.cj:285`），可被 `--port` 覆盖。 */
        const val DEFAULT_PORT = 18937

        const val DEFAULT_LOOPBACK = "http://127.0.0.1:$DEFAULT_PORT"

        private var seq = 0
    }
}
