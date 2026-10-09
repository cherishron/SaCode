package cli

import std.collection.ArrayList
import std.collection.ArrayList
import std.env.*
import std.io.InputStream
import stdx.encoding.json.*
import stdx.net.http.*

// 远程入口只承担传输，不创建本地日志，也不调用本地 agent。
let remoteBodyLimit: Int64 = 1048576

func remoteUsage(): Int64 {
    getStdErr().writeln("usage: sacode [--worktree[=<名称>|#<PR编号>|<github pull URL>]] --remote <1..65535> "
        + "[rpc <method> [<params JSON对象或数组>] | subscribe | worktree <enter|describe|exit|agent-prepare|agent-finish|cleanup> [<值>] [--discard-changes] "
        + "| session send <提示词>] --session <会话>")
    return 64
}

func remoteReadBody(body: InputStream): String {
    let bytes = ArrayList<Byte>()
    let buf = Array<Byte>(4096, repeat: 0)
    while (true) {
        let n = body.read(buf)
        if (n == 0) { break }
        if (bytes.size + n > remoteBodyLimit) { throw Exception("remote-body-too-large") }
        for (i in 0..n) { bytes.add(buf[i]) }
    }
    return String.fromUtf8(bytes.toArray())
}

func remoteRpcResponse(text: String, expectedId: Int64): Int64 {
    let obj = JsonValue.fromStr(text).asObject()
    if (obj.get("jsonrpc").getOrThrow().asString().getValue() != "2.0" ||
        obj.get("id").getOrThrow().asInt().getValue() != expectedId ||
        obj.containsKey("result") == obj.containsKey("error")) {
        throw Exception("remote-invalid-rpc-response")
    }
    // 整个信封原结构输出，尤其不能把 error.data 压成一条字符串。
    println(obj.toString())
    getStdOut().flush()
    if (obj.containsKey("error")) {
        getStdErr().writeln("remote-rpc-error")
        return 1
    }
    return 0
}

func remoteNotification(text: String): Unit {
    let obj = JsonValue.fromStr(text).asObject()
    if (obj.get("jsonrpc").getOrThrow().asString().getValue() != "2.0" ||
        obj.containsKey("id") || obj.containsKey("result") || obj.containsKey("error") ||
        obj.get("method").getOrThrow().asString().getValue().size == 0) {
        throw Exception("remote-invalid-notification")
    }
    if (let Some(params) <- obj.get("params")) {
        if (!(match (params.kind()) { case JsObject | JsArray => true; case _ => false })) {
            throw Exception("remote-invalid-notification-params")
        }
    }
    println(obj.toString())
    getStdOut().flush()
}

// 按字节积累到行界才解 UTF-8；网络块可以切在中文编码中间。
// 行与整个事件都限为 1 MiB，注释也计入帧额度，不能靠不发空行无限占内存。
func remoteSubscribe(body: InputStream): Int64 {
    let lineBytes = ArrayList<Byte>()
    let buf = Array<Byte>(4096, repeat: 0)
    var frameBytes: Int64 = 0
    var data = ""
    var hasData = false
    var afterCr = false
    while (true) {
        let n = body.read(buf)
        if (n == 0) { throw Exception("remote-sse-eof") }
        for (i in 0..n) {
            let b = buf[i]
            if (afterCr && b == 10) { afterCr = false; continue }
            afterCr = false
            frameBytes += 1
            if (frameBytes > remoteBodyLimit) { throw Exception("remote-sse-frame-too-large") }
            if (b != 10 && b != 13) {
                lineBytes.add(b)
                continue
            }
            afterCr = b == 13
            let line = String.fromUtf8(lineBytes.toArray())
            lineBytes.clear()
            if (line.size == 0) {
                if (hasData) { remoteNotification(data) }
                data = ""
                hasData = false
                frameBytes = 0
            } else if (line == "data" || line.startsWith("data:")) {
                var value = if (line == "data") { "" } else { line[5..] }
                if (value.startsWith(" ")) { value = value[1..] }
                if (hasData) { data += "\n" }
                data += value
                hasData = true
            }
            // 注释、event、id 与 retry 字段不产生输出，也不触发重连。
        }
    }
    return 1
}

// —— 远端请求计划 ---------------------------------------------------------------
// remote 是一条**闭集**通道：动词形状在这里就折成 (method, params)，之后只管传输。
// 新增 worktree / session send 两条动词不是「发任意方法」的口子——方法名固定、
// 字段名固定、会话必填；通用透传只保留在既有的 `rpc` 一条上，行为逐字未动。
class RemoteRequest {
    public let method: String
    public let params: String

    public init(method: String, params: String) {
        this.method = method
        this.params = params
    }
}

func parseRemotePort(token: String): Option<Int64> {
    if (token.size == 0 || token.size > 5) {
        return None
    }
    var port: Int64 = 0
    for (b in token.toArray()) {
        if (b < 48 || b > 57) {
            return None
        }
        port = port * 10 + Int64(b - 48)
    }
    if (port < 1 || port > 65535) {
        return None
    }
    return Some(port)
}

// 会话 ID：--session/--resume 都只接受一次，值不得为空、不得是另一个选项。
func takeRemoteSession(verbs: ArrayList<String>, at: Int64, token: String, sessionId: String): String {
    if (sessionId.size > 0) {
        throw Exception("remote-usage:--session 重复")
    }
    if (token.startsWith("--session=")) {
        let value = token[10..]
        if (value.size == 0 || value.startsWith("--")) {
            throw Exception("remote-usage:--session 的值非法")
        }
        return value
    }
    if (token.startsWith("--resume=")) {
        let value = token[9..]
        if (value.size == 0 || value.startsWith("--")) {
            throw Exception("remote-usage:--resume 的值非法")
        }
        return value
    }
    if (at + 1 >= Int64(verbs.size)) {
        throw Exception("remote-usage:${token} 缺值")
    }
    let value = verbs[at + 1]
    if (value.size == 0 || value.startsWith("--")) {
        throw Exception("remote-usage:${token} 的值非法")
    }
    return value
}

// session send <提示词>：与本地会话入口同一条起轮路径，只是落在远端宿主上。
// session/submit 的字段名（eventType/data）与 task/start 的形状都取自宿主协议，不另立一名。
func remoteSessionSend(verbs: Array<String>, sessionId: String): RemoteRequest {
    if (Int64(verbs.size) != 3 || verbs[1] != "send") {
        throw Exception("remote-usage:session 只接 send <提示词>")
    }
    let text = verbs[2]
    if (text.size == 0 || text.startsWith("--")) {
        throw Exception("remote-usage:提示词非法")
    }
    let submit = JsonObject()
    submit.put("sessionId", JsonString(sessionId))
    submit.put("eventType", JsonString("user/message"))
    submit.put("data", JsonString(text))
    return RemoteRequest("session/submit", submit.toString())
}

func remoteStartParams(sessionId: String): String {
    let obj = JsonObject()
    obj.put("sessionId", JsonString(sessionId))
    return obj.toString()
}

// 把「修饰符 + 动词序列」折成有序请求；任何形状非法都抛 remote-usage（发帧之前就退）。
class RemotePlan {
    public let subscribe: Bool
    public let requests: ArrayList<RemoteRequest>

    public init(subscribe: Bool, requests: ArrayList<RemoteRequest>) {
        this.subscribe = subscribe
        this.requests = requests
    }
}

func remotePlanRequests(verbs: ArrayList<String>): RemotePlan {
    let requests = ArrayList<RemoteRequest>()
    var sessionId = ""
    var worktreeGiven = false
    var worktreeRef: Option<WorktreeRef> = None
    var i: Int64 = 0
    let kept = ArrayList<String>()
    while (i < Int64(verbs.size)) {
        let a = verbs[i]
        if (a == "--session" || a == "--resume") {
            sessionId = takeRemoteSession(verbs, i, a, sessionId)
            i += 1
        } else if (a.startsWith("--session=") || a.startsWith("--resume=")) {
            sessionId = takeRemoteSession(verbs, i, a, sessionId)
        } else if (a == "--worktree") {
            if (worktreeGiven) {
                throw Exception("remote-usage:--worktree 重复")
            }
            worktreeGiven = true
        } else if (a.startsWith("--worktree=")) {
            if (worktreeGiven) {
                throw Exception("remote-usage:--worktree 重复")
            }
            worktreeGiven = true
            worktreeRef = Some(classifyWorktreeValue(a[11..]))
        } else if (a == "--remote") {
            throw Exception("remote-usage:--remote 只能出现一次")
        } else {
            kept.add(a)
        }
        i += 1
    }
    if (worktreeGiven) {
        // 修饰符排在最前：先让远端进入工作树，后面的动词才落在那个工作树上。
        requests.add(RemoteRequest("worktree/enter", remoteEnterParams(sessionId, worktreeRef)))
    }
    if (Int64(kept.size) == 0) {
        if (sessionId.size > 0) {
            throw Exception("remote-usage:--session 需要跟着动词")
        }
        requests.add(RemoteRequest("initialize", JsonObject().toString()))
        return RemotePlan(false, requests)
    }
    let head = kept[0]
    if (head == "subscribe") {
        if (Int64(kept.size) != 1 || sessionId.size > 0 || worktreeGiven) {
            throw Exception("remote-usage:subscribe 不接受参数与修饰符")
        }
        return RemotePlan(true, requests)
    }
    if (head == "rpc") {
        if (sessionId.size > 0 || worktreeGiven) {
            throw Exception("remote-usage:rpc 不与 --session/--worktree 同用")
        }
        if (Int64(kept.size) < 2 || Int64(kept.size) > 3) {
            throw Exception("remote-usage:rpc 形状非法")
        }
        let method = kept[1]
        if (method.trimAscii().size == 0 || method.startsWith("--")) {
            throw Exception("remote-usage:方法名非法")
        }
        var params = JsonObject().toString()
        if (Int64(kept.size) == 3) {
            // 坏 JSON 与「不是对象/数组」都是用法错误（退 64），不是传输错误。
            try {
                params = tryParseRemoteParams(kept[2])
            } catch (e: Exception) {
                throw Exception("remote-usage:参数必须是 JSON 对象或数组")
            }
        }
        requests.add(RemoteRequest(method, params))
        return RemotePlan(false, requests)
    }
    if (head == "worktree") {
        if (sessionId.size == 0) {
            throw Exception("remote-usage:worktree 通道必须带 --session")
        }
        let command = parseWorktreeCommand(sliceFrom(kept.toArray(), 1))
        requests.add(RemoteRequest(command.method, command.paramsJson(sessionId)))
        return RemotePlan(false, requests)
    }
    if (head == "session") {
        if (sessionId.size == 0) {
            throw Exception("remote-usage:session send 必须带 --session")
        }
        requests.add(remoteSessionSend(kept.toArray(), sessionId))
        requests.add(RemoteRequest("task/start", remoteStartParams(sessionId)))
        return RemotePlan(false, requests)
    }
    throw Exception("remote-usage:未知远程动词 ${head}")
}

// --worktree 修饰符折成的 worktree/enter 参数：name 与 reference 二选一，
// 裸标志传空串，由远端核心生成名称。
func remoteEnterParams(sessionId: String, worktreeRef: Option<WorktreeRef>): String {
    let params = JsonObject()
    params.put("sessionId", JsonString(sessionId))
    if (let Some(r) <- worktreeRef) {
        if (r.byReference) {
            params.put("reference", JsonString(r.value))
        } else {
            params.put("name", JsonString(r.value))
        }
    } else {
        params.put("name", JsonString(""))
    }
    return params.toString()
}

func tryParseRemoteParams(raw: String): String {
    let parsed = JsonValue.fromStr(raw)
    if (!(match (parsed.kind()) { case JsObject | JsArray => true; case _ => false })) {
        throw Exception("remote-usage:参数必须是 JSON 对象或数组")
    }
    return parsed.toString()
}

func remoteSendRequests(port: Int64, requests: ArrayList<RemoteRequest>): Int64 {
    let client = ClientBuilder().noProxy().autoRedirect(false)
        .readTimeout(30 * Duration.second).writeTimeout(10 * Duration.second).build()
    try {
        let url = "http://127.0.0.1:${port}"
        var sent: Int64 = 0
        for (request in requests) {
            sent += 1
            let envelope = JsonObject()
            envelope.put("jsonrpc", JsonString("2.0"))
            envelope.put("id", JsonInt(sent))
            envelope.put("method", JsonString(request.method))
            envelope.put("params", JsonValue.fromStr(request.params))
            let http = HttpRequestBuilder().post().url("${url}/rpc")
                .header("Content-Type", "application/json").body(envelope.toString()).build()
            let resp = client.send(http)
            try {
                if (resp.status < 200 || resp.status >= 300) {
                    throw Exception("remote-http-status:${resp.status}")
                }
                let code = remoteRpcResponse(remoteReadBody(resp.body), sent)
                if (code != 0) {
                    // 前一笔没过就不再发后面的：失败之后继续推请求会掩盖第一处真因。
                    return code
                }
            } finally { resp.close() }
        }
        return 0
    } finally { client.close() }
}

func runRemote(args: Array<String>): Int64 {
    var remoteAt: Int64 = -1
    var remoteCount: Int64 = 0
    var i: Int64 = 0
    while (i < Int64(args.size)) {
        if (args[i] == "--remote") {
            remoteCount += 1
            remoteAt = i
        }
        i += 1
    }
    if (remoteCount != 1 || remoteAt + 1 >= Int64(args.size)) {
        return remoteUsage()
    }
    let port = parseRemotePort(args[remoteAt + 1])
    if (port.isNone()) {
        return remoteUsage()
    }
    let portNumber = port.getOrThrow()
    // --remote 不再要求在首位：`--worktree=<名称> --remote <端口> …` 是同一条通道的
    // 启动修饰符写法。放宽的只有「标志位置」，动词文法反而更紧（见 remotePlanRequests）。
    let rest = ArrayList<String>()
    var k: Int64 = 0
    while (k < Int64(args.size)) {
        if (k != remoteAt && k != remoteAt + 1) {
            rest.add(args[k])
        }
        k += 1
    }
    // 解析与传输分开归因：文法错误一律先落到 64（并且一帧都不发），
    // 传输/应答错误才走 "remote:" 前缀的非零退出。
    try {
        let plan = remotePlanRequests(rest)
        if (plan.subscribe) {
            return remoteSubscribePort(portNumber)
        }
        return remoteSendRequests(portNumber, plan.requests)
    } catch (e: Exception) {
        let message = e.message
        if (message.startsWith("remote-usage") || message.startsWith("worktree-usage")) {
            getStdErr().writeln(message)
            return remoteUsage()
        }
        getStdErr().writeln("remote: ${message}")
        return 1
    }
}
func remoteSubscribePort(port: Int64): Int64 {
    let client = ClientBuilder().noProxy().autoRedirect(false)
        .readTimeout(30 * Duration.second).writeTimeout(10 * Duration.second).build()
    try {
        let request = HttpRequestBuilder().get().url("http://127.0.0.1:${port}/sse")
            .header("Accept", "text/event-stream").build()
        let resp = client.send(request)
        try {
            if (resp.status < 200 || resp.status >= 300) {
                throw Exception("remote-http-status:${resp.status}")
            }
            let media = (resp.headers.getFirst("Content-Type") ?? "").split(";")[0].trimAscii().toAsciiLower()
            if (media != "text/event-stream") {
                throw Exception("remote-invalid-sse-content-type")
            }
            return remoteSubscribe(resp.body)
        } finally { resp.close() }
    } finally { client.close() }
}
