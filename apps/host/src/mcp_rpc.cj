package host

import core.*
import std.collection.*
import stdx.encoding.json.*

// 一个实例只属于一个会话；注册表是日志投影，不把历史注册解释为连接。
class McpRpc {
    let log: SessionLog
    let desk: ApprovalDesk
    let lease: WriteLease
    let sessionId: String
    let sessionPath: String
    let clients = HashMap<String, McpClient>()

    init(log: SessionLog, desk: ApprovalDesk, lease: WriteLease, sessionId: String, sessionPath: String) {
        this.log = log
        this.desk = desk
        this.lease = lease
        this.sessionId = sessionId
        this.sessionPath = sessionPath
    }

    static func handles(method: String): Bool {
        return method == "mcp/list" || method == "mcp/connect" || method == "mcp/disconnect" ||
            method == "mcp/tools" || method == "mcp/call" || method == "mcp/status"
    }

    func close(): Unit {
        for ((_, client) in clients) { client.close() }
        clients.clear()
    }

    func checkpoint(): Unit {
        if (log.isDurableFrozen() || !lease.protects(sessionPath) || !log.durableCheckpoint(lease)) {
            log.freezeAfterDurableFailure()
            throw Exception("mcp-persistence-failed")
        }
    }

    func resultJson(result: McpOpResult): String {
        var tools = "["
        for (tool in result.tools) {
            if (tools != "[") { tools += "," }
            let schema = if (tool.inputSchema.size == 0) { "{\"type\":\"object\"}" } else { tool.inputSchema }
            tools += "{\"name\":\"${jsonEscapeText(tool.name)}\",\"description\":\"${jsonEscapeText(tool.description)}\",\"inputSchema\":${schema}}"
        }
        tools += "]"
        // 传输异常文本可能含路径或凭据；只公开稳定失败分类，不复制原始 message。
        let message = if (result.ok) { "" } else { "mcp-" + result.failureKind }
        return "{\"ok\":${result.ok},\"op\":\"${jsonEscapeText(result.op)}\",\"failureKind\":\"${jsonEscapeText(result.failureKind)}\"," +
            "\"message\":\"${message}\",\"elapsedMs\":${result.elapsedMs},\"protocolVersion\":\"${jsonEscapeText(result.protocolVersion)}\"," +
            "\"serverName\":\"${jsonEscapeText(result.serverName)}\",\"serverVersion\":\"${jsonEscapeText(result.serverVersion)}\"," +
            "\"tools\":${tools},\"content\":\"${jsonEscapeText(result.content)}\",\"isError\":${result.isError}}"
    }

    func text(obj: JsonObject, key: String): String {
        return obj.get(key).getOrThrow().asString().getValue()
    }

    func closed(obj: JsonObject, keys: Array<String>): Unit {
        if (obj.size() != keys.size) { throw Exception("mcp-bad-arguments") }
        for (key in keys) {
            if (obj.get(key).isNone()) { throw Exception("mcp-bad-arguments") }
        }
    }

    func dispatch(method: String, obj: JsonObject, activeId: String): String {
        let requested = text(obj, "sessionId")
        if (requested != sessionId || activeId != sessionId || requested.size == 0) {
            throw Exception("mcp-session-mismatch")
        }
        let registry = McpRegistry(log)
        if (method == "mcp/list") {
            closed(obj, ["sessionId"])
            var names = "["
            for (name in registry.list()) {
                if (names != "[") { names += "," }
                names += "\"${jsonEscapeText(name)}\""
            }
            return "{\"servers\":" + names + "]}"
        }
        let name = text(obj, "name")
        if (!registry.isRegistered(name)) {
            if (let Some(client) <- clients.get(name)) { client.close() }
            clients.remove(name)
            throw Exception("mcp-not-registered")
        }
        if (method == "mcp/status" || method == "mcp/disconnect") {
            closed(obj, ["sessionId", "name"])
            if (method == "mcp/disconnect") {
                if (let Some(client) <- clients.get(name)) { client.close() }
                clients.remove(name)
                return "{\"connected\":false}"
            }
            let connected = if (let Some(client) <- clients.get(name)) { client.isConnected() } else { false }
            return "{\"connected\":${connected}}"
        }
        var raw = ""
        var timeoutMs: Int64 = 15000
        var command = ""
        let commandArgs = ArrayList<String>()
        let commandEnv = ArrayList<(String, String)>()
        var tool = ""
        var argumentsJson = ""
        if (method == "mcp/tools") {
            closed(obj, ["sessionId", "name", "timeoutMs"])
            timeoutMs = obj.get("timeoutMs").getOrThrow().asInt().getValue()
        } else {
            closed(obj, ["sessionId", "name", "args", "approvalId"])
            raw = text(obj, "args")
            if (raw.size > 1048576) { throw Exception("mcp-bad-arguments") }
            let args = JsonValue.fromStr(raw).asObject()
            timeoutMs = args.get("timeoutMs").getOrThrow().asInt().getValue()
            if (method == "mcp/connect") {
                if (args.get("env").isSome()) {
                    closed(args, ["command", "args", "timeoutMs", "env"])
                    let environment = args.get("env").getOrThrow().asArray()
                    if (environment.size() > 128) { throw Exception("mcp-bad-arguments") }
                    for (entry in environment.getItems()) {
                        let pair = entry.asObject()
                        closed(pair, ["key", "value"])
                        let key = text(pair, "key")
                        let value = text(pair, "value")
                        if (key.size == 0 || key.size > 4096 || key.contains("=") || key.contains("\u{0}") ||
                            value.size > 32767 || value.contains("\u{0}")) {
                            throw Exception("mcp-bad-arguments")
                        }
                        commandEnv.add((key, value))
                    }
                } else {
                    closed(args, ["command", "args", "timeoutMs"])
                }
                command = text(args, "command")
                if (command.size == 0 || command.size > 4096 || command.contains("\u{0}")) {
                    throw Exception("mcp-bad-arguments")
                }
                let entries = args.get("args").getOrThrow().asArray()
                if (entries.size() > 128) { throw Exception("mcp-bad-arguments") }
                for (entry in entries.getItems()) {
                    let value = entry.asString().getValue()
                    if (value.size > 4096 || value.contains("\u{0}")) { throw Exception("mcp-bad-arguments") }
                    commandArgs.add(value)
                }
            } else {
                closed(args, ["tool", "argumentsJson", "timeoutMs"])
                tool = text(args, "tool")
                // core 当前直接拼接工具名；限制到 MCP 常用安全字符，堵住 JSON 注入。
                if (tool.size == 0 || tool.size > 128) { throw Exception("mcp-bad-arguments") }
                for (byte in tool.toArray()) {
                    if (!((byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122) ||
                        (byte >= 48 && byte <= 57) || byte == 95 || byte == 45 || byte == 46)) {
                        throw Exception("mcp-bad-arguments")
                    }
                }
                argumentsJson = text(args, "argumentsJson")
                JsonValue.fromStr(argumentsJson).asObject()
            }
        }
        if (timeoutMs < 1 || timeoutMs > 30000) { throw Exception("mcp-bad-arguments") }
        if (method != "mcp/connect") {
            if (clients.get(name).isNone()) { throw Exception("mcp-not-connected") }
            if (!clients.get(name).getOrThrow().isConnected()) { throw Exception("mcp-not-connected") }
        } else if (let Some(existing) <- clients.get(name)) {
            if (existing.isConnected()) { throw Exception("mcp-already-connected") }
            existing.close()
            clients.remove(name)
        }
        checkpoint()
        if (method == "mcp/connect" || method == "mcp/call") {
            if (PermissionPolicy().decide(ModeController(log).current(), method) == "deny") {
                throw Exception("mcp-mode-denied")
            }
            // approval/ask 的 args 必须逐字等于该封装；原始执行参数不重编码。
            let bound = "{\"sessionId\":\"${jsonEscapeText(sessionId)}\",\"name\":\"${jsonEscapeText(name)}\",\"args\":\"${jsonEscapeText(raw)}\"}"
            let approvalId = obj.get("approvalId").getOrThrow().asInt().getValue()
            if (desk.consumeExactForCall(approvalId, method, bound) != "allowed-once") {
                throw Exception("mcp-not-authorized")
            }
            log.append("mcp/starting", "{\"approvalId\":${approvalId},\"argumentsDigest\":\"${sha256Hex(bound.toArray())}\"}")
            checkpoint()
        }
        var result: McpOpResult
        try {
        if (method == "mcp/connect") {
            let client = McpClient(registry, log, name, command, commandArgs.toArray(), env: commandEnv.toArray())
            clients[name] = client
            result = client.connect(timeoutMs: timeoutMs)
        } else if (method == "mcp/tools") {
            result = clients.get(name).getOrThrow().listTools(timeoutMs: timeoutMs)
        } else {
            result = clients.get(name).getOrThrow().callTool(tool, argumentsJson, timeoutMs: timeoutMs)
        }
        } catch (_: Exception) {
            if (let Some(client) <- clients.get(name)) { client.close() }
            clients.remove(name)
            result = McpOpResult(false, method, "protocol", "mcp-protocol", 0)
        }
        checkpoint()
        return resultJson(result)
    }

    func request(method: String, body: String, idText: String, activeId: String): Bool {
        try {
            let params = JsonValue.fromStr(body).asObject().get("params").getOrThrow().asObject()
            emit(okFrame(idText, dispatch(method, params, activeId)))
        } catch (e: Exception) {
            var reason = "mcp-bad-arguments"
            for (known in ["mcp-session-mismatch", "mcp-not-registered", "mcp-not-connected", "mcp-already-connected",
                "mcp-mode-denied", "mcp-not-authorized", "mcp-persistence-failed"]) {
                if (e.message == known) { reason = known }
            }
            // 不让异常越过宿主总兜底并回显服务端任意文本；失败后清理全部会话客户端。
            if (reason == "mcp-persistence-failed") { close() }
            emit(errFrame(idText, -32003, reason))
        }
        return true
    }
}
