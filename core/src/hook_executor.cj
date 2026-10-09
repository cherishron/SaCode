package core

import std.collection.*
import std.env.*
import std.fs.*
import std.io.*
import std.net.*
import std.process.*
import std.sync.*
import std.time.*
import std.convert.*
import stdx.encoding.json.*
import stdx.net.http.*
import stdx.net.tls.*

public class HookSecurityPolicy {
    public let allowedHookUrls: Array<String>
    public let allowedHookEnvVars: Array<String>
    public let allowPrivateNetworkHooks: Bool
    public init(allowedHookUrls!: Array<String> = [], allowedHookEnvVars!: Array<String> = [],
        allowPrivateNetworkHooks!: Bool = false) {
        this.allowedHookUrls = allowedHookUrls.clone()
        this.allowedHookEnvVars = allowedHookEnvVars.clone()
        this.allowPrivateNetworkHooks = allowPrivateNetworkHooks
    }
}

func hookContains(values: Array<String>, value: String): Bool {
    for (entry in values) { if (entry == value) { return true } }
    return false
}

func hookOptional(value: Option<String>): JsonValue {
    if (let Some(text) <- value) { return JsonString(text) }
    return JsonNull()
}

public func hookInputJson(input: HookInput): String {
    let obj = JsonObject()
    obj.put("sessionId", JsonString(input.sessionId))
    obj.put("transcriptPath", JsonString(input.transcriptPath))
    obj.put("cwd", JsonString(input.cwd))
    obj.put("hookEventName", JsonString(input.hookEventName))
    obj.put("timestamp", JsonInt(input.timestamp))
    obj.put("agentId", hookOptional(input.agentId))
    obj.put("agentType", hookOptional(input.agentType))
    let data = JsonObject()
    match (input.eventSpecific) {
        case Tool(id, value) => data.put("toolId", JsonString(id)); data.put("toolInput", JsonString(value))
        case Prompt(submitted, prompt) => data.put("submittedPrompt", hookOptional(submitted)); data.put("prompt", JsonString(prompt))
        case Session(source) => data.put("source", JsonString(source))
        case End(reason) => data.put("reason", JsonString(reason))
        case Delete => ()
        case Message(role, preview) => data.put("role", JsonString(role)); data.put("contentPreview", JsonString(preview))
        case Stop(usage, limit, tokens) => data.put("contextUsage", JsonInt(usage)); data.put("contextLimit", JsonInt(limit)); data.put("inputTokens", JsonInt(tokens))
        case StopFailure(error) => data.put("error", JsonString(error))
        case Subagent(id, kind) => data.put("agentId", JsonString(id)); data.put("agentType", JsonString(kind))
        case Compact(trigger) => data.put("trigger", JsonString(trigger))
        case Notification(kind) => data.put("type", JsonString(kind))
        case Permission(id) => data.put("toolId", JsonString(id))
        case Todo(id, content) => data.put("todoId", JsonString(id)); data.put("content", JsonString(content))
        case Webhook(id, kind) => data.put("deliveryId", JsonString(id)); data.put("kind", JsonString(kind))
        case Schedule(id, cron) => data.put("taskId", JsonString(id)); data.put("cron", JsonString(cron))
        case WorkflowStep(id, label, reason) => data.put("stepId", JsonString(id)); data.put("label", JsonString(label)); data.put("reason", hookOptional(reason))
    }
    obj.put("eventSpecific", data)
    return obj.toString()
}

func hookString(obj: JsonObject, key: String): Option<String> {
    if (let Some(value) <- obj.get(key)) {
        if (let JsonKind.JsNull <- value.kind()) { return None }
        return Some(value.asString().getValue())
    }
    return None
}
func hookBool(obj: JsonObject, key: String, fallback: Bool): Bool {
    if (let Some(value) <- obj.get(key)) { return value.asBool().getValue() }
    return fallback
}
func hookParse(text: String): HookResult {
    try {
        let obj = JsonValue.fromStr(text).asObject()
        let decision = match ((hookString(obj, "decision") ?? "allow").toAsciiLower()) {
            case "allow" => HookDecision.Allow
            case "deny" => HookDecision.Deny
            case "ask" => HookDecision.Ask
            case "block" => HookDecision.Block
            case _ => throw Exception("hook-invalid-decision")
        }
        return HookResult(decision: decision, reason: hookString(obj, "reason"),
            additionalContext: hookString(obj, "additionalContext"), updatedInput: hookString(obj, "updatedInput"),
            continueFlag: hookBool(obj, "continueFlag", true), suppressOutput: hookBool(obj, "suppressOutput", false),
            systemMessage: hookString(obj, "systemMessage"))
    } catch (_: Exception) { return HookResult(decision: HookDecision.Allow) }
}

// 超过保留上限后仍抽干管道，避免子进程被满缓冲区卡住；截断的 JSON 不解析。
func hookDrain(pipe: InputStream): (String, Bool) {
    let bytes = ArrayList<Byte>()
    let buffer = Array<Byte>(8192, repeat: 0)
    var truncated = false
    while (true) {
        let count = pipe.read(buffer)
        if (count == 0) { break }
        let take = min(count, 1048576 - bytes.size)
        for (i in 0..take) { bytes.add(buffer[i]) }
        if (take < count) { truncated = true }
    }
    return (String.fromUtf8(bytes.toArray()), truncated)
}

public class HookExecutor {
    public static func executeCommand(command: String, shell: Option<String>, env: HashMap<String, String>,
        input: HookInput, timeout: Int64): HookResult {
        if (timeout <= 0) { return HookResult(decision: HookDecision.Allow) }
        // std 的 OutputStream 无 close 接口；用独占临时文件重定向 stdin，让读到 EOF 的 Hook 也能工作。
        let file = File.createTemp(getTempDirectory())
        let path = file.info.path
        let scriptPath = Path(path.toString() + ".cmd")
        var child: Option<SubProcess> = None
        try {
            file.write(hookInputJson(input).toArray())
            file.seek(SeekPosition.Begin(0))
            let windows = getVariable("OS") == Some("Windows_NT")
            let executable = shell ?? if (windows) { getVariable("ComSpec") ?? "cmd.exe" } else { "/bin/sh" }
            let args = if (executable.toAsciiLower().endsWith("cmd.exe") || executable.toAsciiLower() == "cmd") {
                // Windows launch 会转义嵌套引号；交给脚本文件避免把整条命令当 argv 再次引用。
                File.writeTo(scriptPath, ("@echo off\r\n" + command + "\r\n").toArray())
                ["/d", "/c", scriptPath.toString()]
            } else { ["-c", command] }
            let variables = HashMap<String, String>()
            for ((key, value) in getVariables()) { variables[key] = value }
            for ((key, value) in env) { variables[key] = value }
            let p = launch(executable, args, workingDirectory: if (input.cwd.size == 0) { None } else { Some(Path(input.cwd)) },
                environment: Some(variables), stdIn: ProcessRedirect.FromFile(file),
                stdOut: ProcessRedirect.Pipe, stdErr: ProcessRedirect.Pipe)
            child = Some(p)
            let outPipe = p.stdOutPipe
            let errPipe = p.stdErrPipe
            let stdout = spawn { => hookDrain(outPipe) }
            let stderr = spawn { => hookDrain(errPipe) }
            var code: Int64 = -1
            var timedOut = false
            try { code = p.wait(timeout: Duration.millisecond * timeout) }
            catch (_: Exception) {
                timedOut = true
                if (windows) {
                    try { execute("taskkill.exe", ["/PID", p.pid.toString(), "/T", "/F"],
                        stdOut: ProcessRedirect.Discard, stdErr: ProcessRedirect.Discard, timeout: Duration.second * 2) } catch (_: Exception) {}
                }
                p.terminate(force: true)
                code = p.wait(timeout: Duration.second * 2)
            }
            let (out, truncated) = stdout.get(Duration.second * 2)
            let (err, _) = stderr.get(Duration.second * 2)
            if (timedOut) { return HookResult(decision: HookDecision.Allow) }
            if (code == 2) { return HookResult(decision: HookDecision.Deny, reason: Some(err), continueFlag: false) }
            if (code == 0 && !truncated) { return hookParse(out) }
        } catch (_: Exception) {
            if (let Some(p) <- child) {
                try { p.terminate(force: true) } catch (_: Exception) {}
                try { p.wait(timeout: Duration.second * 2) } catch (_: Exception) {}
            }
        } finally {
            file.close()
            try { remove(path) } catch (_: Exception) {}
            try { remove(scriptPath) } catch (_: Exception) {}
        }
        return HookResult(decision: HookDecision.Allow)
    }

    public static func executeHttp(url: String, headers: HashMap<String, String>, allowedEnvVars: Array<String>,
        input: HookInput, timeout: Int64, policy!: HookSecurityPolicy = HookSecurityPolicy()): HookResult {
        return hookHttp(url, headers, allowedEnvVars, input, timeout, policy)
    }
}

func hookAddressAllowed(address: IPAddress, policy: HookSecurityPolicy): Bool {
    // 链路本地、IPv4 映射/转换与云元数据永不因私网开关放行。
    for (prefix in ["169.254.0.0/16", "fe80::/10", "::ffff:0:0/96", "64:ff9b::/96", "0.0.0.0/8", "::/128", "224.0.0.0/4", "ff00::/8"]) {
        if (IPPrefix.parse(prefix).contains(address)) { return false }
    }
    if (address.isLoopback()) { return true }
    if (address.isPrivate()) { return policy.allowPrivateNetworkHooks }
    return address.isGlobalUnicast() && !address.isMulticast()
}

class HookConnection {
    let lock = Mutex()
    let done = AtomicBool(false)
    var socket: Option<TcpSocket> = None
    func attach(value: TcpSocket): Unit {
        synchronized(lock) {
            if (done.load()) { value.close(); throw Exception("hook-timeout") }
            socket = Some(value)
        }
    }
    func close(): Unit {
        synchronized(lock) { if (let Some(s) <- socket) { try { s.close() } catch (_: Exception) {} } }
    }
}

func hookInterpolate(value: String, local: Array<String>, policy: HookSecurityPolicy): String {
    var result = value
    while (let Some(start) <- result.indexOf("\u{0024}{")) {
        let tail = result[(start + 2)..]
        let end = tail.indexOf("}") ?? throw Exception("hook-bad-env")
        let key = tail[0..end]
        if (!hookContains(local, key) || !hookContains(policy.allowedHookEnvVars, key)) { throw Exception("hook-env-denied") }
        let replacement = getVariable(key) ?? ""
        if (replacement.contains("\u{0024}{")) { throw Exception("hook-recursive-env") }
        result = result[0..start] + replacement + tail[(end + 1)..]
    }
    return result
}

func hookHttp(rawUrl: String, headers: HashMap<String, String>, allowedEnv: Array<String>, input: HookInput,
    timeout: Int64, policy: HookSecurityPolicy): HookResult {
    var url = ""
    var host = ""
    var port: UInt16 = 0
    let expanded = HashMap<String, String>()
    try {
        url = hookInterpolate(rawUrl, allowedEnv, policy)
        if (!hookContains(policy.allowedHookUrls, url)) { throw Exception("hook-url-denied") }
        // 使用独立解析器，不复用禁止环回的 Web 策略。
        let target = HookUrlTarget(url)
        host = target.host; port = target.port
        for ((name, value) in headers) {
            let key = name.toAsciiLower()
            if (key == "host" || key == "content-length" || key == "transfer-encoding" || key == "connection") { throw Exception("hook-header-denied") }
            expanded[name] = hookInterpolate(value, allowedEnv, policy)
        }
        if (timeout <= 0) { throw Exception("hook-bad-timeout") }
    } catch (e: Exception) { return HookResult(decision: HookDecision.Deny, reason: Some(e.message), continueFlag: false) }
    let state = HookConnection()
    let started = MonoTime.now()
    let watchdog = spawn {
        while (!state.done.load()) {
            if (MonoTime.now() - started >= Duration.millisecond * timeout) {
                state.done.store(true); state.close(); break
            }
            sleep(Duration.millisecond * 5)
        }
    }
    var client: Option<Client> = None
    var response: Option<HttpResponse> = None
    try {
        let addresses = IPAddress.resolve(host)
        if (addresses.size == 0) { throw Exception("hook-dns-empty") }
        for (address in addresses) {
            if (!hookAddressAllowed(address, policy)) { return HookResult(decision: HookDecision.Deny, reason: Some("hook-address-denied"), continueFlag: false) }
        }
        let pinned = addresses[0]
        let pinnedPort = port
        let connector: (SocketAddress) -> StreamingSocket = { _ =>
            let socket = TcpSocket(IPSocketAddress(pinned, pinnedPort))
            state.attach(socket)
            socket.connect(timeout: Duration.millisecond * timeout)
            return socket
        }
        let connection = ClientBuilder().noProxy().autoRedirect(false).cookieJar(None)
            .connector(connector).tlsConfig(TlsClientConfig()).readTimeout(Duration.millisecond * timeout)
            .writeTimeout(Duration.millisecond * timeout).build()
        client = Some(connection)
        let request = HttpRequestBuilder().url(url).method("POST").header("content-type", "application/json").body(hookInputJson(input))
        for ((key, value) in expanded) { request.header(key, value) }
        let received = connection.send(request.build())
        response = Some(received)
        if (received.status < 200 || received.status >= 300) { return HookResult(decision: HookDecision.Allow) }
        let (body, truncated) = hookDrain(received.body)
        if (!truncated && !state.done.load()) { return hookParse(body) }
    } catch (_: Exception) {} finally {
        state.done.store(true); state.close()
        if (let Some(r) <- response) { try { r.close() } catch (_: Exception) {} }
        if (let Some(c) <- client) { try { c.close() } catch (_: Exception) {} }
        watchdog.get()
    }
    return HookResult(decision: HookDecision.Allow)
}

class HookUrlTarget {
    let host: String
    let port: UInt16
    init(url: String) {
        for (byte in url.toArray()) { if (byte <= 32 || byte == 127 || byte == 92) { throw Exception("hook-bad-url") } }
        let offset = url.indexOf("://") ?? throw Exception("hook-bad-url")
        let scheme = url[0..offset].toAsciiLower()
        if (scheme != "http" && scheme != "https") { throw Exception("hook-bad-scheme") }
        let remainder = url[(offset + 3)..]
        var end = remainder.size
        for (delimiter in ["/", "?", "#"]) { if (let Some(i) <- remainder.indexOf(delimiter)) { end = min(end, i) } }
        let authority = remainder[0..end]
        if (authority.size == 0 || authority.contains("@") || authority.contains("%")) { throw Exception("hook-bad-authority") }
        var hostname = authority
        var portText = ""
        if (authority.startsWith("[")) {
            let close = authority.indexOf("]") ?? throw Exception("hook-bad-ipv6")
            hostname = authority[1..close]
            if (!IPAddress.parse(hostname).isIPv6()) { throw Exception("hook-bad-ipv6") }
            let suffix = authority[(close + 1)..]
            if (suffix.size > 0) {
                if (!suffix.startsWith(":")) { throw Exception("hook-bad-port") }
                portText = suffix[1..]
                if (portText.size == 0) { throw Exception("hook-bad-port") }
            }
        } else if (let Some(colon) <- authority.indexOf(":")) {
            hostname = authority[0..colon]; portText = authority[(colon + 1)..]
            if (portText.size == 0) { throw Exception("hook-bad-port") }
        }
        if (hostname.size == 0) { throw Exception("hook-bad-host") }
        this.host = hostname
        this.port = if (portText.size == 0) { if (scheme == "https") { UInt16(443) } else { UInt16(80) } } else { UInt16.parse(portText) }
        if (port == 0) { throw Exception("hook-bad-port") }
    }
}
