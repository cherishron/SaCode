package cli

import std.collection.ArrayList
import std.env.*
import std.io.InputStream
import stdx.encoding.json.*
import stdx.net.http.*

// 远程入口只承担传输，不创建本地日志，也不调用本地 agent。
let remoteBodyLimit: Int64 = 1048576

func remoteUsage(): Int64 {
    getStdErr().writeln("usage: sacode --remote <1..65535> [rpc <method> [<params JSON对象或数组>] | subscribe]")
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

func remoteRpcResponse(text: String): Int64 {
    let obj = JsonValue.fromStr(text).asObject()
    if (obj.get("jsonrpc").getOrThrow().asString().getValue() != "2.0" ||
        obj.get("id").getOrThrow().asInt().getValue() != 1 ||
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

func runRemote(args: Array<String>): Int64 {
    var flags: Int64 = 0
    for (a in args) { if (a == "--remote") { flags += 1 } }
    if (flags != 1 || args.size < 2 || args[0] != "--remote") { return remoteUsage() }
    var port: Int64 = 0
    if (args[1].size == 0 || args[1].size > 5) { return remoteUsage() }
    for (b in args[1].toArray()) {
        if (b < 48 || b > 57) { return remoteUsage() }
        port = port * 10 + Int64(b - 48)
    }
    if (port < 1 || port > 65535) { return remoteUsage() }
    let subscribe = args.size >= 3 && args[2] == "subscribe"
    var method = "initialize"
    var params: JsonValue = JsonObject()
    if (subscribe) {
        if (args.size != 3) { return remoteUsage() }
    } else if (args.size != 2) {
        if (args.size < 4 || args.size > 5 || args[2] != "rpc" ||
            args[3].trimAscii().size == 0 || args[3].startsWith("--")) { return remoteUsage() }
        method = args[3]
        if (args.size == 5) {
            try {
                params = JsonValue.fromStr(args[4])
                if (!(match (params.kind()) { case JsObject | JsArray => true; case _ => false })) { return remoteUsage() }
            } catch (e: Exception) { return remoteUsage() }
        }
    }
    try {
        let client = ClientBuilder().noProxy().autoRedirect(false)
            .readTimeout(30 * Duration.second).writeTimeout(10 * Duration.second).build()
        try {
            let url = "http://127.0.0.1:${port}"
            let request = if (subscribe) {
                HttpRequestBuilder().get().url("${url}/sse").header("Accept", "text/event-stream").build()
            } else {
                let envelope = JsonObject()
                envelope.put("jsonrpc", JsonString("2.0"))
                envelope.put("id", JsonInt(1))
                envelope.put("method", JsonString(method))
                envelope.put("params", params)
                HttpRequestBuilder().post().url("${url}/rpc")
                    .header("Content-Type", "application/json").body(envelope.toString()).build()
            }
            let resp = client.send(request)
            try {
                if (resp.status < 200 || resp.status >= 300) {
                    throw Exception("remote-http-status:${resp.status}")
                }
                if (subscribe) {
                    let media = (resp.headers.getFirst("Content-Type") ?? "").split(";")[0].trimAscii().toAsciiLower()
                    if (media != "text/event-stream") { throw Exception("remote-invalid-sse-content-type") }
                    return remoteSubscribe(resp.body)
                }
                return remoteRpcResponse(remoteReadBody(resp.body))
            } finally { resp.close() }
        } finally { client.close() }
    } catch (e: Exception) {
        getStdErr().writeln("remote: ${e.message}")
        return 1
    }
}
