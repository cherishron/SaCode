package daemon

import std.collection.*

// 设计 §7「请求安全」里结构那一档：嵌套深度上界、方法名上界与字符集、顶层批量、Origin、Host。
// 全是无状态字节判定，不依赖身份也不依赖 gate——远程接入未启用时同样成立。
//
// 为什么深度要在 JSON 解析**之前**判：stdx 的解析器按递归下降建对象图，
// 一棵 50 万层的 `[[[...` 会先在解析器里把栈炸掉，轮不到我们给出拒绝原因。
// 所以这里做的是字节扫描，代价与正文长度同阶，且一旦越界立刻早退。

// §7 明写的两个数。结构深度 32；方法名上界 64 是自有增量——契约里最长的一条
// 是 `global/settings/set-transcript-view`（35 字节），留一倍余量，
// 但方法名是要拼进审计行的裸字符串，不给它上界等于让客户端决定日志一行有多长。
public let REQUEST_DEPTH_LIMIT: Int64 = 32
public let REQUEST_METHOD_MAX_LEN: Int64 = 64

// 拒绝原因串。归因要能分开，是因为客户端对这四条的处置完全不同：
// 超深/超长是自己构造错了，批量/通知是这条通道不支持的用法，Origin 是压根不该有浏览器来打。
public let SCHEMA_DENY_DEPTH: String = "structure-too-deep"
public let SCHEMA_DENY_BATCH: String = "batch-not-allowed"
public let SCHEMA_DENY_METHOD: String = "method-name-invalid"
public let SCHEMA_DENY_ORIGIN: String = "origin-not-allowed"
// 无 id 的业务通知：判定要等信封解析出来，所以常量放在这里由分派支取用，
// 不塞进 preParseViolation——字节扫描分不出「没有 id」和「id 是 null」。
public let SCHEMA_DENY_NOTIFICATION: String = "notification-not-allowed"
// Host 不在允许集里。它和前四条不是一类：前三条客户端改构造就能过，这条改的是
// **调用方自称在访问谁**——正常客户端不会踩到，踩到基本意味着 DNS 重绑定或配置漂了。
public let SCHEMA_DENY_HOST: String = "host-not-allowed"

public class RemoteRequestSchema {
    // 解析前的结构判定，返回拒绝原因，空串表示放行。
    // 先判深度再判批量：一条正文同时踩中两条时，报出的是 DoS 面那条。
    public static func preParseViolation(body: String, limit: Int64): String {
        if (depthExceeded(body, limit)) { return SCHEMA_DENY_DEPTH }
        if (startsWithArray(body)) { return SCHEMA_DENY_BATCH }
        return ""
    }

    // 容器字符只在字符串外计数。JSON 的字符串内容里 `{` `[` 可以任意多，
    // 裸计数会把一份合法请求误判成超深——那是砍能力，不是加防线。
    static func depthExceeded(text: String, limit: Int64): Bool {
        var depth: Int64 = 0
        var inString = false
        var escaped = false
        for (b in text.toArray()) {
            if (inString) {
                // 字符串内只有反斜杠能改变判法：`\X` 整体跳过，`\"` 不算串结束。
                if (escaped) { escaped = false } else if (b == 92) { escaped = true } else if (b == 34) { inString = false }
                continue
            }
            if (b == 34) { inString = true } else if (b == 123 || b == 91) {
                depth += 1
                if (depth > limit) { return true }
            } else if (b == 125 || b == 93) {
                if (depth > 0) { depth -= 1 }
            }
        }
        return false
    }

    // 顶层是数组就是 JSON-RPC 批量。§7 要求拒，且不能只靠「asObject() 会抛」
    // 把它归成 parse error——帧没写坏，是这个面不支持批量用法。
    static func startsWithArray(text: String): Bool {
        for (b in text.toArray()) {
            // 前导空白不属于正文：`   [1,2]` 仍是批量信封。
            if (b == 32 || b == 9 || b == 10 || b == 13) { continue }
            return b == 91
        }
        return false
    }

    // 方法名：非空、按字节不超过上界，且只允许标识符与路径分隔字符。
    // 字符集这一半不是装饰——未登记的方法名同样会带着它落进审计行，
    // 允许引号/换行/大括号就等于让调用方在审计里插字段。
    // 长度按字节算，非 ASCII 因此一律拒（同一个数不能既当字符数又当字节数）。
    public static func methodViolation(name: String): String {
        let bytes = name.toArray()
        if (bytes.size <= 0 || bytes.size > REQUEST_METHOD_MAX_LEN) { return SCHEMA_DENY_METHOD }
        for (b in bytes) {
            let ok = (b >= 48 && b <= 57) || (b >= 65 && b <= 90) || (b >= 97 && b <= 122) ||
                b == 45 || b == 46 || b == 47 || b == 95
            if (!ok) { return SCHEMA_DENY_METHOD }
        }
        return ""
    }

    // §7「外部 CORS 默认不开放」。本产品没有浏览器客户端，所以判据就是「出现即拒」，
    // 不看值也不配 allowlist。反过来「没有 Origin」不是放行理由——非浏览器客户端
    // 本来就不发它，那条要靠认证与授权挡，不是靠这个函数。
    public static func originViolation(header: String): String {
        return if (header.size > 0) { SCHEMA_DENY_ORIGIN } else { "" }
    }

    // Host 归一：转小写、剥 IPv6 方括号、去端口。
    // 端口只能按「唯一冒号」切：裸 IPv6（`::1`）里全是冒号，按第一个冒号切会把它砍没；
    // 而带括号的 `[::1]:8443` 必须先剥括号，否则括号内的冒号会被当成端口分隔符。
    static func normalizeHost(value: String): String {
        let v = value.toAsciiLower()
        let bytes = v.toArray()
        if (bytes.size > 0 && bytes[0] == 91) {  // '['
            let close = v.indexOf("]") ?? Int64(-1)
            return if (close >= 0) { v[1..close] } else { v }
        }
        var colons = Int64(0)
        var at = Int64(-1)
        var i = Int64(0)
        for (b in bytes) {
            if (b == 58) { colons += 1; at = i }  // ':'
            i += 1
        }
        return if (colons == 1) { v[0..at] } else { v }
    }

    // §7 的 DNS rebinding 那一档。Origin「出现即拒」只挡得住浏览器会带 Origin 的路线；
    // 攻击者把 attacker.example 解析到 127.0.0.1 之后，Host 是唯一还留下的判据——
    // 所以它必须按 allowlist 精确比对，而不是「看着像本机」。
    public static func hostViolation(header: String, allowed: String): String {
        if (header.size <= 0) { return SCHEMA_DENY_HOST }
        // 同一个字段被堆成 "a.com, b.com" 时是两个主机，指向不同实例，猜哪个都不该猜。
        for (b in header.toArray()) {
            if (b == 44 || b == 32 || b == 9) { return SCHEMA_DENY_HOST }  // ',' ' ' '\t'
        }
        let want = normalizeHost(header)
        if (want.size <= 0) { return SCHEMA_DENY_HOST }
        // allowlist 为空 = 全拒：配置读失败宁可拒干净，别把「没配」读成「不限」。
        if (allowed.size <= 0) { return SCHEMA_DENY_HOST }
        for (item in allowed.split(",")) {
            let name = normalizeHost(item.trimAscii())
            // '*' 是 LAN 部署的显式退出，必须写在配置里，不是默认值。
            if (name == "*") { return "" }
            if (name.size > 0 && name == want) { return "" }
        }
        return SCHEMA_DENY_HOST
    }

    // 默认允许集 = 绑定地址本身 + 回环三写法 + SACODE_REMOTE_ALLOWED_HOSTS。
    // 绑到具体地址时「用它访问」天然合法，不该逼运维再配一遍环境变量才能用；
    // 但 0.0.0.0 / :: 是「所有网卡」而不是一个能被 Host 指名道姓的主机，
    // 把它们塞进集合等于放行任意主机名，所以 LAN 场景必须显式给 extra。
    // 这里绝不产出 '*'：通配只能来自调用方写在 extra 里的决定。
    public static func allowedHosts(bind: String, extra: String): String {
        var names = ArrayList<String>()
        let b = normalizeHost(bind)
        if (b.size > 0 && b != "0.0.0.0" && b != "::") { names.add(b) }
        names.add("127.0.0.1")
        names.add("localhost")
        names.add("::1")
        if (extra.size > 0) {
            for (item in extra.split(",")) {
                let name = normalizeHost(item.trimAscii())
                if (name.size > 0) { names.add(name) }
            }
        }
        var joined = ""
        var comma = ""
        for (n in names) {
            joined += comma + n
            comma = ","
        }
        return joined
    }
}
