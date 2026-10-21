package core

import std.collection.{ArrayList, HashSet}
import std.fs.*
import stdx.encoding.json.*

// 配置里的服务器定义：注册表只存 name+transport 标签；command/args/env 由这里交给
// 调用方构造 McpClient。加载器本身不 spawn 子进程，连接仍由 McpClient.connect() 负责。
public class McpServerDefinition {
    public let name: String
    public let command: String
    public let args: Array<String>
    public let env: Array<(String, String)>
    public let transport: String
    public init(name: String, command: String, args: Array<String>, env: Array<(String, String)>, transport: String) {
        this.name = name
        this.command = command
        this.args = args
        this.env = env
        this.transport = transport
    }
}

// 被跳过的服务器：只给名字与稳定原因码，绝不带 env 值或命令原文。
public class McpConfigSkip {
    public let name: String
    public let reason: String
    public init(name: String, reason: String) {
        this.name = name
        this.reason = reason
    }
}

// 结构化结果：error 为空才算加载成功；servers 是已注册项，skipped 是明确未注册项。
public class McpConfigResult {
    public let error: String
    public let servers: Array<McpServerDefinition>
    public let skipped: Array<McpConfigSkip>
    public init(error: String, servers: Array<McpServerDefinition>, skipped: Array<McpConfigSkip>) {
        this.error = error
        this.servers = servers
        this.skipped = skipped
    }
    public func ok(): Bool { return error.size == 0 }
}

// 密钥类 env 键：命中就不注册该服务器，且任何日志/错误里都不出现值。
// 这是保守策略——带令牌的服务器目前会整条跳过，而不是带着凭据进入未知日志面。
func mcpConfigSecretKey(name: String): Bool {
    let upper = name.toAsciiUpper()
    return upper.contains("KEY") || upper.contains("PASSWORD") || upper.contains("SECRET") ||
        upper.contains("TOKEN") || upper.startsWith("SACODE_")
}

func mcpConfigNameValid(name: String): Bool {
    if (name.size == 0 || name.size > 128 || name.contains("::")) { return false }
    for (b in name.toArray()) {
        if (b < 32 || b == 127) { return false }
    }
    return true
}

func mcpConfigTextValid(value: String, max: Int64, forbidEquals: Bool): Bool {
    if (value.size == 0 || value.size > max || value.contains("\u{0}")) { return false }
    if (forbidEquals && value.contains("=")) { return false }
    return true
}

func mcpConfigFailure(code: String): McpConfigResult {
    return McpConfigResult(code, Array<McpServerDefinition>(), Array<McpConfigSkip>())
}

// 只读加载器：解析 → 校验 → 逐项注册。任何一项 schema 非法都整份失败，
// 不做部分注册，避免“看起来加载成功但少了半个配置”。
public class McpConfigLoader {
    public static func load(path: String, registry: McpRegistry): McpConfigResult {
        if (path.size == 0 || !exists(path)) { return mcpConfigFailure("mcp-config-not-found") }
        let info = FileInfo(path)
        if (!info.isRegular()) { return mcpConfigFailure("mcp-config-not-found") }
        if (info.size > 1048576) { return mcpConfigFailure("mcp-config-too-large") }
        var text = ""
        try { text = String.fromUtf8(File.readFrom(path)) }
        catch (_: Exception) { return mcpConfigFailure("mcp-config-not-found") }
        let parsed = McpConfigLoader.parse(text)
        if (!parsed.ok()) { return parsed }
        let registered = ArrayList<McpServerDefinition>()
        let skipped = ArrayList<McpConfigSkip>()
        for (item in parsed.skipped) { skipped.add(item) }
        for (item in parsed.servers) {
            try {
                registry.register(item.name, item.transport)
                registered.add(item)
            } catch (_: Exception) {
                // 注册失败只报稳定原因码；不回显 name 之外的内容。
                skipped.add(McpConfigSkip(item.name, "mcp-config-register-failed"))
            }
        }
        return McpConfigResult("", registered.toArray(), skipped.toArray())
    }

    // 纯解析：不读盘、不注册，便于单测与调用方先校验再决定是否落注册表。
    public static func parse(text: String): McpConfigResult {
        var root: JsonObject
        try { root = JsonValue.fromStr(text).asObject() }
        catch (_: Exception) { return mcpConfigFailure("mcp-config-parse-error") }
        let serversValue = root.get("mcpServers")
        if (serversValue.isNone()) { return mcpConfigFailure("mcp-config-bad-server") }
        var serversField: JsonObject
        try { serversField = serversValue.getOrThrow().asObject() }
        catch (_: Exception) { return mcpConfigFailure("mcp-config-bad-server") }
        let servers = ArrayList<McpServerDefinition>()
        let skipped = ArrayList<McpConfigSkip>()
        let seen = HashSet<String>()
        for ((name, value) in serversField.getFields()) {
            if (!mcpConfigNameValid(name)) { return mcpConfigFailure("mcp-config-bad-server") }
            if (!seen.add(name)) { return mcpConfigFailure("mcp-config-bad-server") }
            var obj: JsonObject
            try { obj = value.asObject() } catch (_: Exception) {
                return mcpConfigFailure("mcp-config-bad-server")
            }
            // command 必填；空串或非字符串都算坏配置。
            let commandValue = obj.get("command")
            if (commandValue.isNone()) { return mcpConfigFailure("mcp-config-bad-server") }
            var command = ""
            try { command = commandValue.getOrThrow().asString().getValue() }
            catch (_: Exception) { return mcpConfigFailure("mcp-config-bad-server") }
            if (!mcpConfigTextValid(command, 4096, false)) { return mcpConfigFailure("mcp-config-bad-server") }
            // args 可选：只接受字符串数组。
            let args = ArrayList<String>()
            if (let Some(argsValue) <- obj.get("args")) {
                var arr: JsonArray
                try { arr = argsValue.asArray() }
                catch (_: Exception) { return mcpConfigFailure("mcp-config-bad-server") }
                if (arr.size() > 128) { return mcpConfigFailure("mcp-config-bad-server") }
                for (entry in arr.getItems()) {
                    var arg = ""
                    try { arg = entry.asString().getValue() }
                    catch (_: Exception) { return mcpConfigFailure("mcp-config-bad-server") }
                    if (!mcpConfigTextValid(arg, 4096, false)) { return mcpConfigFailure("mcp-config-bad-server") }
                    args.add(arg)
                }
            }
            // env 可选：键值都必须是字符串；密钥类键命中即整条跳过（不注册、不记录值）。
            let env = ArrayList<(String, String)>()
            var secretHit = false
            if (let Some(envValue) <- obj.get("env")) {
                var envObj: JsonObject
                try { envObj = envValue.asObject() }
                catch (_: Exception) { return mcpConfigFailure("mcp-config-bad-server") }
                if (envObj.size() > 128) { return mcpConfigFailure("mcp-config-bad-server") }
                for ((key, envEntry) in envObj.getFields()) {
                    if (!mcpConfigTextValid(key, 256, true)) { return mcpConfigFailure("mcp-config-bad-server") }
                    var val = ""
                    try { val = envEntry.asString().getValue() }
                    catch (_: Exception) { return mcpConfigFailure("mcp-config-bad-server") }
                    if (val.size > 8192 || val.contains("\u{0}")) { return mcpConfigFailure("mcp-config-bad-server") }
                    if (mcpConfigSecretKey(key)) {
                        secretHit = true
                        continue
                    }
                    env.add((key, val))
                }
            }
            // transport 可选，默认 stdio；必须是不含分隔符的短标签，避免污染注册事件编码。
            var transport = "stdio"
            if (let Some(transportValue) <- obj.get("transport")) {
                try { transport = transportValue.asString().getValue() }
                catch (_: Exception) { return mcpConfigFailure("mcp-config-bad-server") }
                if (!mcpConfigTextValid(transport, 64, false) || transport.contains("::") ||
                    transport.contains("\n") || transport.contains("\r")) {
                    return mcpConfigFailure("mcp-config-bad-server")
                }
            }
            if (secretHit) {
                skipped.add(McpConfigSkip(name, "mcp-config-secret"))
            } else {
                servers.add(McpServerDefinition(name, command, args.toArray(), env.toArray(), transport))
            }
        }
        return McpConfigResult("", servers.toArray(), skipped.toArray())
    }
}
