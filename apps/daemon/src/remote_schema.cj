package daemon

import std.collection.*

// 设计 §7「请求安全」里结构那一档：嵌套深度上界、方法名上界与字符集、顶层批量、Origin。
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
            let ok = (b >= 48 && b <= 57) || (b >= 65 && b <= 90) || (b >= 97 && b <= 122)
                || b == 45 || b == 46 || b == 47 || b == 95
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
}
