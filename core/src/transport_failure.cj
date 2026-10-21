package core

import std.collection.*
import std.convert.*
import std.env.getVariable

// 结构化失败：把「哪一类失败」「请求是否已进入线路」「供应商给了什么恢复时间」
// 从异常文案里解放出来。设计文档 §5.2 实测三段输入通路全缺——非 200 时先 close
// 再抛，响应头与正文都拿不到；除 http-status: 前缀外一律塌成 http-request-error。
// 不补这两段，「遵守供应商恢复时间」与「线路/模型分档」只能由夹具喂绿。
//
// 纪律：
//   * reachedUpstream 是**入参**，不从 kind 反推：同是 transport，连接被拒/DNS/TLS
//     握手失败是「未上线」，读超时与半身后断是「已上线」；
//   * 错误正文原文永不入日志（上游错误体常回显请求片段，可能含我们发出去的键值材料），
//     只留长度与脱敏摘要；
//   * 未知就是 -1，不把「认不出」当成 0（0 会被读成「立刻可重试」）。

public class TransportFailure {
    public let kind: String              // transport | http-status | protocol | read | cancelled | credential
    public let reachedUpstream: Bool     // 请求字节是否已进入线路（来自调用点证据）
    public let status: Int64             // -1 = 未知
    public let retryAfterSeconds: Int64  // -1 = 供应商没给
    public let resetEpoch: Int64         // -1 = 供应商没给
    public let bodyLen: Int64            // -1 = 没有正文
    public let summary: String           // 脱敏摘要，不含正文原文
    public let reason: String            // 稳定的失败原因；认不出就是 http-request-error
    public init(kind: String, reachedUpstream: Bool, status: Int64, retryAfterSeconds: Int64,
        resetEpoch: Int64, bodyLen: Int64, summary: String, reason!: String = "") {
        this.kind = kind
        this.reachedUpstream = reachedUpstream
        this.status = status
        this.retryAfterSeconds = retryAfterSeconds
        this.resetEpoch = resetEpoch
        this.bodyLen = bodyLen
        this.summary = summary
        this.reason = reason
    }

    // 兼容既有调用方的文本面：http-status:<n> / http-request-error 的形态不能变，
    // 否则 sse_test.cj 里那批按 message 断言的用例会被迫改写。
    public func message(): String {
        if (summary.size > 0) { return summary }
        if (status > 0) { return "http-status:${status}" }
        return "http-request-error"
    }

    // 给上层（宿主与界面）的形态：文本面保持不变，只在已知原因时挂一个后缀。
    // 2026-10-12 实测：连接类失败一律塌成 http-request-error，界面只能显示
    // 「连不上模型」——TLS 锚缺失、对端拒绝握手与真的断网长得一模一样，用户无从下手。
    public func messageWithReason(): String {
        if (reason.size > 0 && reason != "http-request-error" && kind == "transport") {
            return "${message()}:${reason}"
        }
        return message()
    }
}

// Provider 接口只允许抛 Exception；结构化失败要靠这个包装过接口边界，
// 不能让 ModelAgentLoop 再从 message 文本反推 status/Retry-After。
public class TransportFailureException <: Exception {
    public let failure: TransportFailure
    public init(failure: TransportFailure) {
        super(failure.messageWithReason())
        this.failure = failure
    }
    public override func getClassName(): String {
        return "TransportFailureException"
    }
}

public func failureOf(kind: String, reachedUpstream: Bool, status!: Int64 = -1,
    retryAfterSeconds!: Int64 = -1, resetEpoch!: Int64 = -1, bodyLen!: Int64 = -1,
    summary!: String = "", reason!: String = ""): TransportFailure {
    return TransportFailure(kind, reachedUpstream, status, retryAfterSeconds, resetEpoch, bodyLen, summary, reason: reason)
}

// 原始异常文案只用来选出稳定原因，绝不原样外传：里面可能带 URL、证书路径甚至请求片段。
// 顺序按「越靠前越具体」排列——先命中锚缺失，再命中握手/协议，最后才是笼统的网络类。
public func transportReason(raw: String): String {
    let mapped = classifyTransportReason(raw)
    // 运维诊断通道：只有显式设置 SACODE_TRANSPORT_DEBUG=1 才会带上脱敏后的原文摘要，
    // 用于判断「是缺哪张证书 / 对端发了什么 ClientHello」这类必须看原文的问题。
    // 默认关闭；摘要里的引号内容与超长部分先削掉，避免把 URL、路径带出去。
    if (getVariable("SACODE_TRANSPORT_DEBUG") == "1") {
        return "${mapped}|${sanitizeTransportText(raw)}"
    }
    return mapped
}

private func classifyTransportReason(raw: String): String {
    let text = raw.toAsciiLower()
    // 这里只分类已观测错误，不把错误栈当根因。缺 SNI 也会让服务器返回默认站点的
    // 过期证书；补 SNI 的同客户端对照已推翻「供应商不兼容」与「ALPN 根因」结论。
    if (matchesAny(text, ["certificate expired", "certificate_expired"])) { return "tls-certificate-expired" }
    if (matchesAny(text, ["certificate verify failed", "certificate_verify_failed", "certificate has expired"])) { return "tls-certificate-rejected" }
    if (matchesAny(text, ["unable to get local issuer", "certificate_verify_failed_unknown", "self signed certificate", "self-signed certificate"])) { return "tls-anchor-missing" }
    if (matchesAny(text, ["no application protocol"])) { return "tls-alpn-unsupported" }
    if (matchesAny(text, ["alert internal error", "alert handshake", "handshake failure", "no shared cipher",
        "wrong version number", "alert protocol version", "alert unknown ca", "sslv3", "tlsv1"])) { return "tls-handshake-rejected" }
    if (matchesAny(text, ["getaddrinfo", "no such host", "name or service not known", "nodename nor servname"])) { return "dns-failed" }
    if (matchesAny(text, ["connection refused", "actively refused"])) { return "connection-refused" }
    if (matchesAny(text, ["connection reset", "connection closed", "broken pipe", "eof", "unexpected end"])) { return "connection-reset" }
    if (matchesAny(text, ["timeout", "timed out"])) { return "timeout" }
    return "http-request-error"
}

func matchesAny(text: String, needles: Array<String>): Bool {
    for (needle in needles) {
        if (text.contains(needle)) { return true }
    }
    return false
}

// 脱敏摘要：去掉引号包裹的内容（URL/路径最常出现的地方），只保留可打印字符，截断到 160 字节。
func sanitizeTransportText(raw: String): String {
    let bytes = ArrayList<Byte>()
    var quoted = false
    for (b in raw.toArray()) {
        if (bytes.size >= 400) { break }
        if (b == 39 || b == 34) { quoted = !quoted; continue }
        if (quoted) { continue }
        bytes.add(if (b >= 32 && b < 127) { b } else { UInt8(46) })
    }
    return String.fromUtf8(bytes.toArray())
}

// 只有这些头参与重试与恢复判定；其余（含 Set-Cookie/Authorization/Content-*）
// 一律不进失败对象——失败对象会落日志，不能变成第二条凭据通道。
let failureHeaderWhitelist = ["retry-after", "x-ratelimit-reset", "x-ratelimit-reset-requests", "x-ratelimit-reset-tokens"]

public func whitelistedHeaders(raw: Array<(String, String)>): Array<(String, String)> {
    let out = ArrayList<(String, String)>()
    for (kv in raw) {
        let name = kv[0].toAsciiLower()
        for (w in failureHeaderWhitelist) {
            if (name == w) { out.add(kv) }
        }
    }
    return out.toArray()
}

// 从白名单头里取 Retry-After。头里没有 → -1（未知），不是 0。
public func retryAfterFromHeaders(headers: Array<(String, String)>, nowEpoch: Int64): Int64 {
    for (kv in headers) {
        if (kv[0].toAsciiLower() == "retry-after") {
            return parseRetryAfterSeconds(kv[1], nowEpoch)
        }
    }
    return -1
}

// 秒数形态：纯十进制。其余形态（HTTP-date）本批回 -1——
// 符号面只有 RFC1123 的格式化方向，没有解析入口，不靠编译器猜；
// 拿不到就如实标「未实现」，绝不把认不出的形态当成 0 秒。
public func parseRetryAfterSeconds(value: String, nowEpoch: Int64): Int64 {
    let text = value.trimAscii()
    if (text.size == 0 || text.size > 20) {
        return -1
    }
    let bs = text.toArray()
    var i = Int64(0)
    while (i < Int64(bs.size)) {
        if (bs[i] < 48 || bs[i] > 57) {
            return -1
        }
        i += 1
    }
    return Int64.parse(text)
}

// 正文摘要：返回 (原文长度, 脱敏摘要)。摘要只保留可打印 ASCII——
// 错误体可能含中文，按字节截断会切进多字节序列；摘要仅用于日志阅读、
// 不参与任何判定，转义是可接受的降级。
public func redactBody(text: String): (Int64, String) {
    let len = Int64(text.size)
    let bytes = text.toArray()
    let out = ArrayList<Byte>()
    var i = Int64(0)
    while (i < Int64(bytes.size)) {
        if (matchesAt(bytes, i, "sk-") || matchesAtIgnoreCase(bytes, i, "bearer ")) {
            let keep = if (matchesAt(bytes, i, "sk-")) { 3 } else { 7 }
            i += keep
            while (i < Int64(bytes.size) && !isTokenDelimiter(bytes[i])) { i += 1 }
            for (b in "[redacted]".toArray()) { out.add(b) }
            continue
        }
        let b = bytes[i]
        out.add(if (b < 32 || b >= 127) { UInt8(46) } else { b })
        i += 1
    }
    var n = Int64(out.size)
    if (n > 80) { n = 80 }
    let head = Array<Byte>(n, repeat: 0)
    var k = Int64(0)
    while (k < n) {
        head[k] = out[k]
        k += 1
    }
    return (len, String.fromUtf8(head))
}

func matchesAt(bytes: Array<Byte>, pos: Int64, needle: String): Bool {
    let n = needle.toArray()
    if (pos + Int64(n.size) > Int64(bytes.size)) { return false }
    var i = Int64(0)
    while (i < Int64(n.size)) {
        if (bytes[pos + i] != n[i]) { return false }
        i += 1
    }
    return true
}

func matchesAtIgnoreCase(bytes: Array<Byte>, pos: Int64, needle: String): Bool {
    let n = needle.toArray()
    if (pos + Int64(n.size) > Int64(bytes.size)) { return false }
    var i = Int64(0)
    while (i < Int64(n.size)) {
        var a = bytes[pos + i]
        if (a >= 65 && a <= 90) { a = a + UInt8(32) }
        var b = n[i]
        if (b >= 65 && b <= 90) { b = b + UInt8(32) }
        if (a != b) { return false }
        i += 1
    }
    return true
}

func isTokenDelimiter(b: Byte): Bool {
    return b == 32 || b == 34 || b == 39 || b == 44 || b == 125 || b == 93 || b == 10 || b == 13 || b == 9
}
