package daemon

import core.*
import stdx.net.http.*
import std.io.*
import std.fs.*
import std.sync.*
import std.collection.*
import std.env.*

// JSON-RPC 帧构造（与 host 同构，但不经 emit/notifyFrame，直接写入 HTTP 响应体）。
func okRpc(id: String, result: String): String {
    "{\"jsonrpc\":\"2.0\",\"id\":${id},\"result\":${result}}"
}

func errRpc(id: String, code: Int64, msg: String): String {
    "{\"jsonrpc\":\"2.0\",\"id\":${id},\"error\":{\"code\":${code},\"message\":\"${jsonEscapeText(msg)}\"}}"
}

// JSON 字段提取（从 host 复制：字节级扫描，不依赖 stdx.encoding.json）。
func bytesOf(s: String): Array<Byte> {
    s.toArray()
}

func fromBytes(bs: ArrayList<Byte>): String {
    String.fromUtf8(bs.toArray())
}

func jsonStr(body: String, key: String): String {
    let hay = bytesOf(body)
    let pat = bytesOf("\"${key}\":\"")
    let plen = pat.size
    let hlen = hay.size
    if (plen > hlen) {
        return ""
    }
    var i: Int64 = 0
    while (i <= hlen - plen) {
        var same = true
        var k: Int64 = 0
        while (k < plen) {
            if (hay[i + k] != pat[k]) {
                same = false
                break
            }
            k += 1
        }
        if (same) {
            let out = ArrayList<Byte>()
            var j = i + plen
            while (j < hlen) {
                let c = hay[j]
                if (c == 34) {
                    return fromBytes(out)
                }
                if (c == 92 && j + 1 < hlen) {
                    let e = hay[j + 1]
                    if (e == 34) {
                        out.add(34)
                        j += 2
                        continue
                    } else if (e == 92) {
                        out.add(92)
                        j += 2
                        continue
                    } else if (e == 110) {
                        out.add(10)
                        j += 2
                        continue
                    } else if (e == 114) {
                        out.add(13)
                        j += 2
                        continue
                    } else if (e == 116) {
                        out.add(9)
                        j += 2
                        continue
                    }
                    out.add(c)
                    j += 1
                    continue
                }
                out.add(c)
                j += 1
            }
            return fromBytes(out)
        }
        i += 1
    }
    return ""
}

func jsonId(body: String): String {
    let hay = bytesOf(body)
    let pat = bytesOf("\"id\":")
    let plen = pat.size
    let hlen = hay.size
    if (plen > hlen) {
        return "null"
    }
    var i: Int64 = 0
    while (i <= hlen - plen) {
        var same = true
        var k: Int64 = 0
        while (k < plen) {
            if (hay[i + k] != pat[k]) {
                same = false
                break
            }
            k += 1
        }
        if (same) {
            let num = ArrayList<Byte>()
            var j = i + plen
            while (j < hlen) {
                let b = hay[j]
                let n = Int64(b)
                if (n >= 48 && n <= 57) {
                    num.add(b)
                } else {
                    break
                }
                j += 1
            }
            if (num.size == 0) {
                return "null"
            }
            return fromBytes(num)
        }
        i += 1
    }
    return "null"
}

// HTTP 请求体是 InputStream（非 Seekable），readToEnd/readString 都要求 Seekable，
// 需手动按块读取再拼字符串。
func readBody(stream: InputStream): String {
    let out = ArrayList<Byte>()
    let chunk = Array<Byte>(4096, repeat: 0)
    while (true) {
        let n = stream.read(chunk)
        if (n <= 0) { break }
        var i: Int64 = 0
        while (i < n) {
            out.add(chunk[i])
            i += 1
        }
    }
    return String.fromUtf8(out.toArray())
}

let INIT_CAPS = "[\"initialize\",\"session/catalog\"]"
let bus = EventBus()

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
    let server = ServerBuilder()
        .addr("127.0.0.1")
        .port(port)
        .build()

    server.distributor.register("/health", {
        ctx => ctx.responseBuilder
            .header("Content-Type", "application/json")
            .body("{\"status\":\"ok\",\"sseSubscribers\":${bus.subscriberCount()}}")
    })

    server.distributor.register("/rpc", {
        ctx =>
        let bodyStr = readBody(ctx.request.body)
        let method = jsonStr(bodyStr, "method")
        let idText = jsonId(bodyStr)
        if (method == "initialize") {
            let result = "{\"protocolVersion\":\"0.1\",\"capabilities\":${INIT_CAPS},\"core\":\"cangjie\",\"transport\":\"http-sse\"}"
            ctx.responseBuilder
                .header("Content-Type", "application/json")
                .body(okRpc(idText, result))
            // 仅初始化处理成功后发瞬时生命周期通知；不复制请求 id、参数或凭证。
            bus.publish("daemon/client-initialized", "{\"protocolVersion\":\"0.1\",\"transport\":\"http-sse\"}")
        } else if (method == "session/catalog") {
            var items = "["
            var comma = ""
            for (item in SessionCatalog(".").list()) {
                items += comma + "{\"id\":\"${jsonEscapeText(item.id)}\",\"title\":\"${jsonEscapeText(item.title)}\",\"durable\":${item.durable},\"status\":\"${item.status}\",\"workspaceDirectory\":\"${jsonEscapeText(item.workspaceDirectory)}\",\"current\":false}"
                comma = ","
            }
            items += "]"
            let root = jsonEscapeText(canonicalize(".").toString())
            ctx.responseBuilder
                .header("Content-Type", "application/json")
                .body(okRpc(idText, "{\"root\":\"${root}\",\"entries\":${items}}"))
        } else {
            ctx.responseBuilder
                .header("Content-Type", "application/json")
                .body(errRpc(idText, -32601, "method not found"))
        }
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
                    // 定期写探测对端断连，空闲时也能及时进入 finally 退订。
                    writer.write((": keepalive\n\n").toArray())
                }
            }
            if (sub.closeReason() == "overflow") {
                // 结束该响应，客户端必须把 EOF 视为失败，不能继续消费缺帧流。
                getStdErr().writeln("sse subscription ${sub.id} closed: overflow")
            }
        } finally {
            bus.unsubscribe(sub.id)
        }
    })

    let ready = SyncCounter(1)
    server.afterBind({ => ready.dec() })
    spawn { server.serve() }
    ready.waitUntilZero()

    println("daemon on http://127.0.0.1:${server.port}")
    getStdOut().flush()
    while (true) {
        sleep(1 * Duration.second)
    }
    return 0
}
