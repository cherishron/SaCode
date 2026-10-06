package core

import std.collection.ArrayList
import std.io.*
import std.time.MonoTime
import stdx.net.http.*
import stdx.net.tls.*

// Web 真实驱动（H/W70）：上游 `ctx.web.fetch(url, method)` 的「真 HTTP」实现。
//
// 与 `web.cj` 的分工：`WebClient` 是**权限面**（host 白名单 + `web/fetch` 审计事件），
// 本执行器是**执行面**——真正连网发请求。两条面合成一个闭环：
//   1. 权限：请求前先过 `WebClient.fetch` 这道门，host 不在允许集就**连连接都不发起**，
//      于是「未授权的 host」既拿不到字节、也不会在日志里留下任何成功痕迹；
//   2. 审计：`web/fetch` 事件只在放行时落盘，`web/fetch` 的条数 == 真实发出的请求数；
//   3. 取消：`TurnToken` 在三个检查点生效——发请求前、响应头到达后、响应体逐块读取之间。
//      响应体是流，取消点在读取循环里，所以「下载中途打断」也能在下一个检查点收束；
//   4. 上限：正文有字节上限（`maxBodyBytes`），超了标记 truncated 而不是无限吃内存；
//   5. fail-closed：任何异常都归一成一个互不相同的 `failureKind`，绝不返回假 200。
//
// 只读语义：只放行 GET/HEAD/OPTIONS。写方法不放行——写请求必须走带审批的另一条通道，
// 本执行器不自作主张发写请求。

// 真实抓取结果：一律结构化返回（不抛），ok=false 时 failureKind 指名原因。
public class WebFetchResult {
    public let ok: Bool
    public let status: Int64
    public let method: String
    public let url: String
    public let contentType: String
    public let body: String
    public let bodyBytes: Int64
    public let truncated: Bool
    public let elapsedMs: Int64
    public let failureKind: String   // "" | not-allowed | bad-url | transport | timeout | cancelled
    public let message: String

    public init(ok: Bool, status: Int64, method: String, url: String, contentType: String,
                body: String, bodyBytes: Int64, truncated: Bool, elapsedMs: Int64,
                failureKind: String, message: String) {
        this.ok = ok
        this.status = status
        this.method = method
        this.url = url
        this.contentType = contentType
        this.body = body
        this.bodyBytes = bodyBytes
        this.truncated = truncated
        this.elapsedMs = elapsedMs
        this.failureKind = failureKind
        this.message = message
    }
}

// 只读方法闭集。
func isReadOnlyMethod(m: String): Bool {
    return m == "GET" || m == "HEAD" || m == "OPTIONS"
}

// 可打印 ASCII 的查表数组（下标 0 == 字节 32）。避开 String 单字符索引的可移植性问题：
// 本仓既有做法（sha256Hex）是先把查表串转成字节数组再按下标取字节。
let printableAscii = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~".toArray()
let hexDigits = "0123456789abcdef".toArray()

// 响应体可能含非 UTF-8 字节：直接 String.fromUtf8 会抛，而「抓下来的是二进制」
// 不该让整次调用失败。保守降级——纯可打印 ASCII 原样返回；否则控制字节转义、
// 高字节转 \xNN，调用方按 bodyBytes 对账真实字节数。
func bytesToText(bytes: Array<Byte>): String {
    var allPrintable = true
    for (i in 0..bytes.size) {
        let b = Int64(bytes[i])
        if (b < 32 || b >= 127) {
            allPrintable = false
            break
        }
    }
    if (allPrintable) {
        return String.fromUtf8(bytes)
    }
    let out = ArrayList<Byte>()
    for (i in 0..bytes.size) {
        let b = Int64(bytes[i])
        if (b == 10) {
            out.add(UInt8(92))
            out.add(UInt8(110))
        } else if (b == 13) {
            out.add(UInt8(92))
            out.add(UInt8(114))
        } else if (b == 9) {
            out.add(UInt8(92))
            out.add(UInt8(116))
        } else if (b >= 32 && b < 127) {
            out.add(printableAscii[b - 32])
        } else {
            out.add(UInt8(92))
            out.add(UInt8(120))
            out.add(hexDigits[b / 16])
            out.add(hexDigits[b % 16])
        }
    }
    return String.fromUtf8(out.toArray())
}

// 有上限、带取消检查点的响应体读取。
// 逐块读、块间查取消令牌：真流里的取消点必须在读循环里，
// 否则「连接一直挂着不吐字节」的端点会让本进程无限等下去。
class BodyDrain {
    let bytes: ArrayList<Byte>
    var truncated = false
    var cancelled = false
    init() {
        this.bytes = ArrayList<Byte>()
    }
}

func drainBody(stream: InputStream, cap: Int64, token: TurnToken): BodyDrain {
    let out = BodyDrain()
    let buf = Array<UInt8>(8192, repeat: 0)
    while (true) {
        if (token.cancelled()) {
            out.cancelled = true
            break
        }
        if (Int64(out.bytes.size) >= cap) {
            out.truncated = true
            break
        }
        let left = cap - Int64(out.bytes.size)
        let chunk = if (left < Int64(buf.size)) { left } else { Int64(buf.size) }
        let n = stream.read(buf)
        if (n <= 0) {
            break
        }
        if (n > chunk) {
            out.truncated = true
        }
        let take = min(n, chunk)
        for (i in 0..take) {
            out.bytes.add(buf[i])
        }
        if (Int64(out.bytes.size) >= cap) {
            out.truncated = true
            break
        }
    }
    return out
}

// 真实 HTTP 执行器。默认 body 上限 4 MiB、超时 30 秒，均可注入。
public class WebExecutor {
    let web: WebClient
    let maxBodyBytes: Int64

    public init(web: WebClient, maxBodyBytes!: Int64 = 4194304) {
        this.web = web
        this.maxBodyBytes = maxBodyBytes
    }

    // 抓取 URL。method 只接受读方法；token 是协作式取消令牌；timeoutMs 是连接/读超时；
    // capBytes <= 0 时用实例默认上限。
    public func fetch(url: String, method: String, body!: String = "",
                      token!: TurnToken = TurnToken(), timeoutMs!: Int64 = 30000,
                      capBytes!: Int64 = -1): WebFetchResult {
        let started = MonoTime.now()
        let cap = if (capBytes > 0) { capBytes } else { maxBodyBytes }
        let normMethod = method.toAsciiUpper()

        // 检查点 1：还没连网就查一次取消
        if (token.cancelled()) {
            return fail(started, normMethod, url, "cancelled", "web-cancelled")
        }
        if (url.size == 0) {
            return fail(started, normMethod, url, "bad-url", "web-empty-url")
        }
        if (!isReadOnlyMethod(normMethod)) {
            return fail(started, normMethod, url, "not-allowed", "web-method-not-allowed")
        }

        // 权限门：host 白名单 + 审计事件（marker 只在此处落盘）
        try {
            web.fetch(url, normMethod)
        } catch (_: Exception) {
            return fail(started, normMethod, url, "not-allowed", "web-host-not-allowed")
        }

        let c = ClientBuilder().tlsConfig(TlsClientConfig()).autoRedirect(false).build()
        var opened: Option<HttpResponse> = None
        try {
            let base = HttpRequestBuilder().url(url).readTimeout(Duration.millisecond * timeoutMs)
            let req = if (normMethod == "POST") {
                base.post().body(body).build()
            } else {
                base.get().build()
            }
            let resp = c.send(req)
            opened = Some(resp)

            let status = Int64(resp.status)
            var contentType = ""
            if (let Some(v) <- resp.headers.getFirst("content-type")) {
                contentType = v
            }

            // 检查点 2：响应头已到，读体之前再看一次取消
            if (token.cancelled()) {
                closeBoth(opened, c)
                return fail(status, normMethod, url, started, "cancelled", "web-cancelled", contentType)
            }

            let drained = drainBody(resp.body, cap, token)
            let bytes = drained.bytes.toArray()
            let text = bytesToText(bytes)
            closeBoth(opened, c)

            if (drained.cancelled) {
                return fail(status, normMethod, url, started, "cancelled", "web-cancelled", contentType)
            }
            let ok = status >= 200 && status < 300
            return WebFetchResult(ok, status, normMethod, url, contentType, text,
                Int64(bytes.size), drained.truncated, elapsedOf(started),
                if (ok) { "" } else { "http-status" },
                if (ok) { "" } else { "http-status:${status}" })
        } catch (e: HttpTimeoutException) {
            closeBoth(opened, c)
            return fail(started, normMethod, url, "timeout", "web-timeout")
        } catch (e: TimeoutException) {
            closeBoth(opened, c)
            return fail(started, normMethod, url, "timeout", "web-timeout")
        } catch (e: Exception) {
            closeBoth(opened, c)
            return fail(started, normMethod, url, "transport", "web-request-error")
        }
    }

    func fail(started: MonoTime, method: String, url: String, kind: String, message: String): WebFetchResult {
        return WebFetchResult(false, Int64(0), method, url, "", "", Int64(0), false,
            elapsedOf(started), kind, message)
    }

    func fail(status: Int64, method: String, url: String, started: MonoTime,
              kind: String, message: String, contentType: String): WebFetchResult {
        return WebFetchResult(false, status, method, url, contentType, "", Int64(0), false,
            elapsedOf(started), kind, message)
    }

    func closeBoth(opened: Option<HttpResponse>, c: Client) {
        if (let Some(resp) <- opened) {
            try { resp.close() } catch (_: Exception) {}
        }
        try { c.close() } catch (_: Exception) {}
    }

    func elapsedOf(started: MonoTime): Int64 {
        return (MonoTime.now() - started).toSeconds() * 1000
    }
}
