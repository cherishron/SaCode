package daemon

import core.*
import stdx.net.http.*
import stdx.encoding.json.*
import std.io.*
import std.fs.*
import std.sync.*
import std.collection.*
import std.env.*

// JSON-RPC 帧直接写入 HTTP 响应体，不发布请求或审批凭据。
func okRpc(id: String, result: String): String {
    "{\"jsonrpc\":\"2.0\",\"id\":${id},\"result\":${result}}"
}

func errRpc(id: String, code: Int64, msg: String): String {
    "{\"jsonrpc\":\"2.0\",\"id\":${id},\"error\":{\"code\":${code},\"message\":\"${jsonEscapeText(msg)}\"}}"
}

// HTTP 请求体不是 Seekable，按块读取后交给真正的 JSON 解析器。
func readBody(stream: InputStream): String {
    let out = ArrayList<Byte>()
    let chunk = Array<Byte>(4096, repeat: 0)
    while (true) {
        let n = stream.read(chunk)
        if (n <= 0) { break }
        if (out.size + n > 1048576) { throw Exception("request-body-too-large") }
        var i: Int64 = 0
        while (i < n) { out.add(chunk[i]); i += 1 }
    }
    return String.fromUtf8(out.toArray())
}

let INIT_CAPS = "[\"initialize\",\"session/catalog\"]"
let bus = EventBus()
let teamHost = TeamHostBridge(bus)
let hostProxy = HostProxyBridge(bus)
let daemonStopping = AtomicBool(false)

func dispatchRpc(body: String): String {
    var idText = "null"
    var parsed: Option<JsonObject> = None
    try { parsed = Some(JsonValue.fromStr(body).asObject()) }
    catch (_: Exception) { return errRpc("null", -32700, "parse error") }
    let request = parsed.getOrThrow()
    var method = ""
    var params = "{}"
    try {
        let id = request.get("id").getOrThrow()
        match (id.kind()) {
            case JsString => idText = id.toString()
            case JsInt => idText = id.toString()
            case _ => return errRpc("null", -32600, "id must be string or integer")
        }
        if (request.get("jsonrpc").getOrThrow().asString().getValue() != "2.0") {
            return errRpc(idText, -32600, "invalid jsonrpc version")
        }
        method = request.get("method").getOrThrow().asString().getValue()
        if (let Some(value) <- request.get("params")) { params = value.asObject().toString() }
    } catch (_: Exception) { return errRpc(idText, -32600, "invalid request") }
    if (daemonStopping.load()) { return errRpc(idText, -32002, "daemon is shutting down") }
    try {
        if (method == "initialize") {
            var capabilities = INIT_CAPS
            if (teamHost.configured()) {
                teamHost.ensureStarted()
                let caps = JsonValue.fromStr(INIT_CAPS).asArray()
                for (name in teamHost.capabilities()) { caps.add(JsonString(name)) }
                caps.add(JsonString("daemon/shutdown"))
                capabilities = caps.toString()
            }
            // 代理能力只在宿主可配时登记（此时还没起进程，只登记形状）：宿主不可用
            // 就不宣称，免得调用方按不存在的能力发请求。逐条追加到既有清单之后，
            // 不重建别人的那条数组。
            if (hostProxy.configured()) {
                for (name in hostProxy.capabilities()) {
                    capabilities = "${capabilities[0..capabilities.size - 1]},\"${jsonEscapeText(name)}\"]"
                }
            }
            let result = "{\"protocolVersion\":\"0.1\",\"capabilities\":${capabilities},\"core\":\"cangjie\",\"transport\":\"http-sse\"}"
            bus.publish("daemon/client-initialized", "{\"protocolVersion\":\"0.1\",\"transport\":\"http-sse\"}")
            return okRpc(idText, result)
        } else if (method == "session/catalog") {
            var items = "["
            var comma = ""
            for (item in SessionCatalog(".").list()) {
                items += comma + "{\"id\":\"${jsonEscapeText(item.id)}\",\"title\":\"${jsonEscapeText(item.title)}\",\"durable\":${item.durable},\"status\":\"${item.status}\",\"workspaceDirectory\":\"${jsonEscapeText(item.workspaceDirectory)}\",\"current\":false}"
                comma = ","
            }
            items += "]"
            let root = jsonEscapeText(canonicalize(".").toString())
            return okRpc(idText, "{\"root\":\"${root}\",\"entries\":${items}}")
        } else if (acceptsTeamMethod(method)) {
            return teamHost.forward(method, params, idText)
        } else if (forwarded(method)) {
            // 会话/工作树这一支只经 HostProxyBridge 白名单转发，不就近假答；
            // 宿主没配置或已退出都由代理归一成 -32010/-32012，远程 CLI 才分得清。
            // 分派层只留了 id 的 JSON 文本，代理要的是 id 节点本身（回写响应用），
            // 这里显式还原，不另发明第三种 id 表示。
            return hostProxy.forward(method, params, JsonValue.fromStr(idText))
        } else if (method == "daemon/shutdown") {
            teamHost.shutdown()
            hostProxy.shutdown()
            // Host 确已退出且读线程已 join 才允许 daemon 结束。
            // 短有界延迟留出 HTTP 响应写出窗口，不在处理器内直接 exit。
            spawn { => sleep(200 * Duration.millisecond); daemonStopping.store(true) }
            return okRpc(idText, "{\"ok\":true}")
        }
        return errRpc(idText, -32601, "method not found")
    } catch (e: Exception) { return errRpc(idText, -32003, e.message) }
}

main(args: Array<String>): Int64 {
    var port: UInt16 = 18937
    if (args.size != 0) {
        if (args.size != 2 || args[0] != "--port" || args[1].size == 0 || args[1].size > 5) { return 64 }
        var number: Int64 = 0
        for (b in args[1].toArray()) {
            if (b < 48 || b > 57) { return 64 }
            number = number * 10 + Int64(b - 48)
        }
        if (number > 65535) { return 64 }
        port = UInt16(number)
    }
    let server = ServerBuilder().addr("127.0.0.1").port(port).build()
    server.distributor.register("/health", {
        ctx => ctx.responseBuilder
            .header("Content-Type", "application/json")
            .body("{\"status\":\"ok\",\"sseSubscribers\":${bus.subscriberCount()}}")
    })
    server.distributor.register("/rpc", {
        ctx =>
        let response = try { dispatchRpc(readBody(ctx.request.body)) }
            catch (e: Exception) { errRpc("null", -32600, e.message) }
        ctx.responseBuilder.header("Content-Type", "application/json").body(response)
    })
    server.distributor.register("/sse", {
        ctx =>
        ctx.responseBuilder
            .header("Content-Type", "text/event-stream")
            .header("Cache-Control", "no-cache")
            .header("Connection", "keep-alive")
            .header("transfer-encoding", "chunked")
        let writer = HttpResponseWriter(ctx)
        let sub = bus.subscribe()
        try {
            writer.write((": connected\n\n").toArray())
            while (!ctx.isClosed() && !sub.isClosed()) {
                if (let Some(frame) <- sub.poll(1 * Duration.second)) {
                    writer.write(("data: ${frame}\n\n").toArray())
                } else if (!sub.isClosed()) {
                    // 定期探测对端断连，空闲时也能进入 finally 退订。
                    writer.write((": keepalive\n\n").toArray())
                }
            }
            if (sub.closeReason() == "overflow") {
                getStdErr().writeln("sse subscription ${sub.id} closed: overflow")
            }
        } finally { bus.unsubscribe(sub.id) }
    })
    let ready = SyncCounter(1)
    server.afterBind({ => ready.dec() })
    spawn { server.serve() }
    ready.waitUntilZero()
    println("daemon on http://127.0.0.1:${server.port}")
    getStdOut().flush()
    while (!daemonStopping.load()) { sleep(50 * Duration.millisecond) }
    return 0
}
