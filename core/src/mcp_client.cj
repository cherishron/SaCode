package core

import std.collection.*
import std.io.*
import std.process.*
import std.sync.*
import std.time.MonoTime
import stdx.encoding.json.*

// MCP 真实客户端（H/W70）：上游 `ctx.mcp` 的真 stdio 子进程 + 真 JSON-RPC 实现。
//
// 与 `mcp.cj` 的分工：`McpRegistry` 是**权限面**（服务器注册表 + `mcp/server` 事件），
// 本客户端是**执行面**——真正 spawn 一个 MCP 服务器子进程、按 stdio 传输做
// JSON-RPC 握手与工具调用。两条面合成一个闭环：
//   1. 权限：`connect()` 要求服务器名已在注册表里且处于 active，未登记一律不 spawn；
//   2. 审计：真正发生过的一次调用落 `mcp/call` 事件 `<name>::<method>::<verdict>`，
//      于是日志能答出「这台 MCP 服务器被调过几次、各次结局如何」；
//   3. 取消：`TurnToken` 在发起前与每次读回复的轮询里生效；断开时强杀子进程，
//      绝不留孤儿；
//   4. 超时：读回复用真实单调钟算 deadline，超时即强杀，区分 timeout 与 cancelled；
//   5. fail-closed：二进制缺失、握手失败、协议错误、服务端报 error 各自归一为
//      结构化结果，不抛。
//
// 传输层：stdio + 逐行 NDJSON（MCP 规定的标准形态）。回复读用一个独立线程把
// 子进程 stdout 逐行喂进队列，主线程在队列上按 deadline 轮询——这样「取消」
// 和「超时」都能在有限时间内被看见，而不是卡在一次阻塞的 readln 上。

// MCP 工具清单条目。
public class McpToolInfo {
    public let name: String
    public let description: String

    public init(name: String, description: String) {
        this.name = name
        this.description = description
    }
}

// MCP 一次操作的结果：一律结构化返回（不抛）。
// 只读字段用 let；握手/列表/调用三处需要延后填充的字段用 var。
public class McpOpResult {
    public let ok: Bool
    public let op: String
    public var protocolVersion: String
    public var serverName: String
    public var serverVersion: String
    public var tools: ArrayList<McpToolInfo>
    public var content: String
    public var isError: Bool
    public let failureKind: String   // "" | not-registered | bad-args | spawn-failed | transport | timeout | cancelled | protocol
    public let message: String
    public let elapsedMs: Int64

    public init(ok: Bool, op: String, failureKind: String, message: String, elapsedMs: Int64) {
        this.ok = ok
        this.op = op
        this.protocolVersion = ""
        this.serverName = ""
        this.serverVersion = ""
        this.tools = ArrayList<McpToolInfo>()
        this.content = ""
        this.isError = false
        this.failureKind = failureKind
        this.message = message
        this.elapsedMs = elapsedMs
    }
}

// 读回复的轮询睡眠：短到让取消在 ~5ms 内被看见，又不至于把 CPU 打成空转。
let mcpPollSleepMs: Int64 = 5

// 回复行队列：读线程 push，主线程按 id 取；done 表示子进程 stdout 已 EOF。
class McpLineQueue {
    let items = ArrayList<String>()
    let lock = Mutex()
    var done: Bool = false

    func push(s: String): Unit {
        lock.lock()
        items.add(s)
        lock.unlock()
    }

    func markDone(): Unit {
        lock.lock()
        done = true
        lock.unlock()
    }

    // 取出与 wantId 匹配的那一行，其余原样保留（顺序不变）。
    func take(idOf: (String) -> Int64, wantId: Int64): Option<String> {
        lock.lock()
        var out: Option<String> = None
        var rest = ArrayList<String>()
        var i: Int64 = 0
        while (i < Int64(items.size)) {
            let line = items[i]
            if (idOf(line) == wantId) {
                out = Some(line)
            } else {
                rest.add(line)
            }
            i = i + 1
        }
        items.clear()
        var j: Int64 = 0
        while (j < Int64(rest.size)) {
            items.add(rest[j])
            j = j + 1
        }
        lock.unlock()
        return out
    }

    func isEmpty(): Bool {
        lock.lock()
        let empty = Int64(items.size) == Int64(0)
        lock.unlock()
        return empty
    }

    func isDone(): Bool {
        lock.lock()
        let d = done
        lock.unlock()
        return d
    }

    func clear(): Unit {
        lock.lock()
        items.clear()
        lock.unlock()
    }
}

func isJsonValueNull(v: JsonValue): Bool {
    match (v.kind()) {
        case JsNull => true
        case _ => false
    }
}

func jsonText(obj: JsonObject, key: String): String {
    if (let Some(v) <- obj.get(key)) {
        if (isJsonValueNull(v)) {
            return ""
        }
        return v.asString().getValue()
    }
    return ""
}

func jsonBool(obj: JsonObject, key: String): Bool {
    if (let Some(v) <- obj.get(key)) {
        if (isJsonValueNull(v)) {
            return false
        }
        return v.asBool().getValue()
    }
    return false
}

func jsonNumber(obj: JsonObject, key: String): Int64 {
    if (let Some(v) <- obj.get(key)) {
        if (isJsonValueNull(v)) {
            return Int64(-1)
        }
        return v.asInt().getValue()
    }
    return Int64(-1)
}

// 从一行 JSON-RPC 里取 id；取不到（非 JSON、无 id 的通知）返回 -1。
func jsonRpcId(line: String): Int64 {
    try {
        return jsonNumber(JsonValue.fromStr(line).asObject(), "id")
    } catch (_: Exception) {
        return Int64(-1)
    }
}

// request 的内部返回：终态结果 + 若成功则附带 result 体，供调用方继续解析。
class McpReply {
    let result: McpOpResult
    let body: Option<JsonObject>

    init(result: McpOpResult, body: Option<JsonObject>) {
        this.result = result
        this.body = body
    }
}

// 读线程主体：把子进程 stdout 逐行喂进队列。
func readMcpStdout(queue: McpLineQueue, pipe: InputStream): Unit {
    let rd = StringReader(pipe)
    while (true) {
        let line = rd.readln()
        if (let Some(s) <- line) {
            queue.push(s)
        } else {
            queue.markDone()
            break
        }
    }
}

func joinStrings(items: Array<String>, sep: String): String {
    var out = ""
    var first = true
    for (s in items) {
        if (!first) {
            out += sep
        }
        out += s
        first = false
    }
    return out
}

// 真实 MCP stdio 客户端。
public class McpClient {
    let registry: McpRegistry
    let log: SessionLog
    let serverName: String
    let command: String
    let args: Array<String>
    var proc: Option<SubProcess> = None
    var queue = McpLineQueue()
    var nextId: Int64 = 1
    var connected: Bool = false

    public init(registry: McpRegistry, log: SessionLog, serverName: String,
                command: String, args: Array<String>) {
        this.registry = registry
        this.log = log
        this.serverName = serverName
        this.command = command
        this.args = args
    }

    public func isConnected(): Bool {
        return connected
    }

    // 握手：spawn 子进程 + initialize 请求 + initialized 通知。
    public func connect(token!: TurnToken = TurnToken(), timeoutMs!: Int64 = 15000): McpOpResult {
        let started = MonoTime.now()
        if (token.cancelled()) {
            return McpOpResult(false, "initialize", "cancelled", "mcp-cancelled", elapsedOf(started))
        }
        if (serverName.size == 0 || command.size == 0) {
            return McpOpResult(false, "initialize", "bad-args", "mcp-empty-arg", elapsedOf(started))
        }
        // 权限门：未登记的服务器不 spawn
        if (!registry.isRegistered(serverName)) {
            return McpOpResult(false, "initialize", "not-registered", "mcp-server-not-registered",
                elapsedOf(started))
        }
        if (connected) {
            return McpOpResult(true, "initialize", "", "mcp-already-connected", elapsedOf(started))
        }

        let launched = launchServer(command, args)
        if (launched.isNone()) {
            return McpOpResult(false, "initialize", "spawn-failed", "mcp-spawn-failed",
                elapsedOf(started))
        }
        let p = launched.getOrThrow()
        proc = Some(p)
        spawn { => readAllStream(p.stdErrPipe) }
        let stdoutPipe = p.stdOutPipe
        spawn { => readMcpStdout(queue, stdoutPipe) }

        let initParams = "{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"sacode-mcp-client\",\"version\":\"1.0.0\"}}"
        let reply = request("initialize", initParams, token, timeoutMs, started)
        let r = reply.result
        if (r.ok) {
            // 握完手补发 initialized 通知（无 id、无回复）
            writeLine("{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}")
            connected = true
            logCall("initialize", "ok")
            return r
        }
        closeProcess()
        logCall("initialize", "err")
        return r
    }

    // tools/list：列出服务器声明的工具。
    public func listTools(token!: TurnToken = TurnToken(), timeoutMs!: Int64 = 15000): McpOpResult {
        let started = MonoTime.now()
        if (let Some(p) <- precheck("tools/list", token, started)) {
            return p
        }
        let reply = request("tools/list", "{}", token, timeoutMs, started)
        if (!reply.result.ok) {
            closeProcess()
            logCall("tools/list", "err")
            return reply.result
        }
        let tools = ArrayList<McpToolInfo>()
        if (let Some(result) <- reply.body) {
            if (let Some(v) <- result.get("tools")) {
                if (!isJsonValueNull(v)) {
                    let arr = v.asArray()
                    var pos: Int64 = 0
                    while (let Some(item) <- arr.get(pos)) {
                        pos += 1
                        if (isJsonValueNull(item)) {
                            continue
                        }
                        let t = item.asObject()
                        tools.add(McpToolInfo(jsonText(t, "name"), jsonText(t, "description")))
                    }
                }
            }
        }
        let out = McpOpResult(true, "tools/list", "", "", elapsedOf(started))
        out.tools = tools
        logCall("tools/list", "ok")
        return out
    }

    // tools/call：调用一个工具。argumentsJson 是调用方给的 JSON 对象字面量。
    public func callTool(name: String, argumentsJson: String,
                         token!: TurnToken = TurnToken(), timeoutMs!: Int64 = 15000): McpOpResult {
        let started = MonoTime.now()
        if (let Some(p) <- precheck("tools/call", token, started)) {
            return p
        }
        if (name.size == 0) {
            return McpOpResult(false, "tools/call", "bad-args", "mcp-empty-tool", elapsedOf(started))
        }
        let params = "{\"name\":\"${name}\",\"arguments\":${argumentsJson}}"
        let reply = request("tools/call", params, token, timeoutMs, started)
        if (!reply.result.ok) {
            closeProcess()
            logCall("tools/call", "err")
            return reply.result
        }
        var content = ""
        var isError = false
        if (let Some(result) <- reply.body) {
            if (let Some(v) <- result.get("content")) {
                if (!isJsonValueNull(v)) {
                    let parts = ArrayList<String>()
                    let arr = v.asArray()
                    var pos: Int64 = 0
                    while (let Some(item) <- arr.get(pos)) {
                        pos += 1
                        if (isJsonValueNull(item)) {
                            continue
                        }
                        let t = item.asObject()
                        if (jsonText(t, "type") == "text") {
                            parts.add(jsonText(t, "text"))
                        }
                    }
                    content = joinStrings(parts.toArray(), "\n")
                }
            }
            isError = jsonBool(result, "isError")
        }
        let out = McpOpResult(true, "tools/call", "", "", elapsedOf(started))
        out.content = content
        out.isError = isError
        logCall("tools/call", if (isError) { "iserr" } else { "ok" })
        return out
    }

    public func close(): Unit {
        connected = false
        closeProcess()
    }

    func precheck(op: String, token: TurnToken, started: MonoTime): Option<McpOpResult> {
        if (token.cancelled()) {
            return Some(McpOpResult(false, op, "cancelled", "mcp-cancelled", elapsedOf(started)))
        }
        if (!connected) {
            return Some(McpOpResult(false, op, "not-registered", "mcp-not-connected",
                elapsedOf(started)))
        }
        return None
    }

    // 发一个带 id 的请求并按 deadline 等匹配 id 的回复；返回终态。
    func request(method: String, params: String, token: TurnToken, timeoutMs: Int64,
                 started: MonoTime): McpReply {
        let id = nextId
        nextId = nextId + 1
        let line = "{\"jsonrpc\":\"2.0\",\"id\":${id},\"method\":\"${method}\",\"params\":${params}}"
        if (!writeLine(line)) {
            closeProcess()
            return McpReply(McpOpResult(false, method, "transport", "mcp-write-failed",
                elapsedOf(started)), None)
        }
        let deadline = MonoTime.now() + Duration.millisecond * timeoutMs
        var pending: Option<McpReply> = None
        while (pending.isNone()) {
            if (token.cancelled()) {
                closeProcess()
                pending = Some(McpReply(McpOpResult(false, method, "cancelled", "mcp-cancelled",
                    elapsedOf(started)), None))
                break
            }
            if ((deadline - MonoTime.now()).toMilliseconds() <= 0) {
                closeProcess()
                pending = Some(McpReply(McpOpResult(false, method, "timeout", "mcp-reply-timeout",
                    elapsedOf(started)), None))
                break
            }
            if (let Some(reply) <- queue.take(jsonRpcId, id)) {
                if (let Some(parsed) <- parseReply(reply, id, method, started)) {
                    pending = Some(parsed)
                    break
                }
            }
            if (queue.isDone() && queue.isEmpty()) {
                closeProcess()
                pending = Some(McpReply(McpOpResult(false, method, "transport", "mcp-server-closed",
                    elapsedOf(started)), None))
                break
            }
            sleep(mcpPollSleepMs * Duration.millisecond)
        }
        return pending.getOrThrow()
    }

    // 解析一行回复。Some 为终态；None 表示该行不是给本 id 的，继续等。
    func parseReply(line: String, wantId: Int64, method: String, started: MonoTime): Option<McpReply> {
        let objOpt: Option<JsonObject>
        try {
            objOpt = Some(JsonValue.fromStr(line).asObject())
        } catch (_: Exception) {
            return None   // 服务器日志误入 stdout 之类的噪声：跳过继续等
        }
        let obj = objOpt.getOrThrow()
        if (jsonNumber(obj, "id") != wantId) {
            return None
        }
        if (let Some(err) <- obj.get("error")) {
            var code: Int64 = Int64(-1)
            var msg = ""
            if (!isJsonValueNull(err)) {
                let eo = err.asObject()
                code = jsonNumber(eo, "code")
                msg = jsonText(eo, "message")
            }
            return Some(McpReply(McpOpResult(false, method, "protocol", "mcp-rpc-error-${code}:${msg}",
                elapsedOf(started)), None))
        }
        if (obj.get("result").isNone()) {
            return Some(McpReply(McpOpResult(false, method, "protocol", "mcp-missing-result",
                elapsedOf(started)), None))
        }
        let res = obj.get("result").getOrThrow()
        let ok = McpOpResult(true, method, "", "", elapsedOf(started))
        let body: Option<JsonObject>
        if (isJsonValueNull(res)) {
            body = None
        } else {
            let result = res.asObject()
            if (method == "initialize") {
                ok.protocolVersion = jsonText(result, "protocolVersion")
                if (let Some(si) <- result.get("serverInfo")) {
                    if (!isJsonValueNull(si)) {
                        ok.serverName = jsonText(si.asObject(), "name")
                        ok.serverVersion = jsonText(si.asObject(), "version")
                    }
                }
            }
            body = Some(result)
        }
        return Some(McpReply(ok, body))
    }

    func writeLine(line: String): Bool {
        if (proc.isNone()) {
            return false
        }
        let p = proc.getOrThrow()
        try {
            p.stdInPipe.write((line + "\n").toArray())
            p.stdInPipe.flush()
            return true
        } catch (_: Exception) {
            return false
        }
    }

    func launchServer(cmd: String, args: Array<String>): Option<SubProcess> {
        try {
            let p = launch(cmd, args, stdIn: ProcessRedirect.Pipe,
                stdOut: ProcessRedirect.Pipe, stdErr: ProcessRedirect.Pipe)
            return Some(p)
        } catch (_: Exception) {
            return None
        }
    }

    func closeProcess(): Unit {
        if (proc.isNone()) {
            return
        }
        let p = proc.getOrThrow()
        proc = None
        connected = false
        try { p.terminate(force: true) } catch (_: Exception) {}
        try { p.wait() } catch (_: Exception) {}
        queue.clear()
    }

    func logCall(method: String, verdict: String): Unit {
        log.append("mcp/call", "${serverName}::${method}::${verdict}")
    }

    func elapsedOf(started: MonoTime): Int64 {
        return (MonoTime.now() - started).toMilliseconds()
    }
}
