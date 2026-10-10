package daemon
import core.*

import std.collection.*
import std.unittest.*

// 设计 §7「请求安全」里结构那一档的语义测试：深度上界、方法名上界与字符集、
// 顶层 batch 归因、Origin 出现即拒。
// 这一层只验结构判定本身；「拒绝发生在 Host.forward 之前」与审计里不出现被拒方法名
// 由 apps/daemon/test/remote-request-limits.test.mjs 在真 HTTP 面上钉。

func repeated(unit: String, times: Int64): String {
    var out = ""
    for (i in 0..times) { out += unit }
    return out
}

// depth 层数组：`[[[[]]]]` 形态，最外层记第 1 层——与 preParseViolation 的判法一致。
func nestedArrays(depth: Int64): String {
    var out = ""
    for (i in 0..depth) { out += "[" }
    for (i in 0..depth) { out += "]" }
    return out
}

// depth 层嵌套对象：`{"a":{"a":{…}}}`，最外层记第 1 层。
// 边界用例用它而不是裸数组——裸数组会先撞上批量判定，读不出深度归因。
func nestedObjects(depth: Int64): String {
    var out = ""
    for (i in 1..depth) { out += "{\"a\":" }
    out += "{}"
    for (i in 1..depth) { out += "}" }
    return out
}

@Test
func depthLimitCutsAtThirtyThreeNotWider() {
    // 边界必须是「再深一层就拒」，宽一档等于把 §7 那个 32 改成别的数。
    @Expect(RemoteRequestSchema.preParseViolation(nestedObjects(32), REQUEST_DEPTH_LIMIT) == "", true)
    @Expect(RemoteRequestSchema.preParseViolation(nestedObjects(33), REQUEST_DEPTH_LIMIT)
        == SCHEMA_DENY_DEPTH, true)
    // 两条判定同时命中时的顺序也钉住：超深又是批量，报深度（DoS 面更要紧）；
    // 32 层的裸数组不超深，才落到批量归因。
    @Expect(RemoteRequestSchema.preParseViolation(nestedArrays(33), REQUEST_DEPTH_LIMIT)
        == SCHEMA_DENY_DEPTH, true)
    @Expect(RemoteRequestSchema.preParseViolation(nestedArrays(32), REQUEST_DEPTH_LIMIT)
        == SCHEMA_DENY_BATCH, true)
    // 常量本身也要钉住规格值，免得改动限当时只改了实现没改文档。
    @Expect(REQUEST_DEPTH_LIMIT, Int64(32))
}

@Test
func bracesInsideStringsDoNotCountAsDepth() {
    // {"a":"{{{{…100 个…{{{{"} —— 字符串里的花括号不是容器。
    // 按字节裸计数的实现会把这份合法请求误判成超深，把能力面砍掉一截。
    let payload = "{\"a\":\"" + repeated("{", 100) + "\"}"
    @Expect(RemoteRequestSchema.preParseViolation(payload, REQUEST_DEPTH_LIMIT) == "", true)
}

@Test
func escapedQuoteKeepsTheScannerInsideTheString() {
    // 值里带一个转义引号 \"，紧跟 100 个花括号——这些花括号仍在字符串内。
    // 不跟进转义态的扫描器在这里会提前「闭合」字符串，然后把它们全数成层。
    let payload = "{\"a\":\"x\\\"" + repeated("{", 100) + "\"}"
    @Expect(RemoteRequestSchema.preParseViolation(payload, REQUEST_DEPTH_LIMIT) == "", true)
    // 把同一片花括号从字符串里挪出来变成真嵌套，就必须落在界外。
    // 两条一起才说明「拒因是嵌套本身」，不是扫描器看不懂字符串。
    let realNesting = "{\"a\":" + nestedArrays(33) + "}"
    @Expect(RemoteRequestSchema.preParseViolation(realNesting, REQUEST_DEPTH_LIMIT)
        == SCHEMA_DENY_DEPTH, true)
}

@Test
func depthScanCoversWholeRequestNotJustParams() {
    // 深度算整份请求体：params 里嵌 33 层要拒，信封本身那 1 层也计入。
    let payload = "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session/submit\",\"params\":"
        + nestedArrays(32) + "}"
    @Expect(RemoteRequestSchema.preParseViolation(payload, REQUEST_DEPTH_LIMIT)
        == SCHEMA_DENY_DEPTH, true)
    let insideBound = "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session/submit\",\"params\":"
        + nestedArrays(20) + "}"
    @Expect(RemoteRequestSchema.preParseViolation(insideBound, REQUEST_DEPTH_LIMIT) == "", true)
}

@Test
func topLevelArrayIsAttributedToBatchNotParseError() {
    // §7 明写「拒绝 JSON-RPC batch」。拒是早就会拒的（asObject() 抛），
    // 但归因成 parse error 会让客户端以为自己的帧写坏了，而不是「这个面不支持批量」。
    @Expect(RemoteRequestSchema.preParseViolation("[{\"jsonrpc\":\"2.0\",\"id\":\"b\"}]", REQUEST_DEPTH_LIMIT)
        == SCHEMA_DENY_BATCH, true)
    // 前导空白不改判法。
    @Expect(RemoteRequestSchema.preParseViolation("   \n [1,2]", REQUEST_DEPTH_LIMIT)
        == SCHEMA_DENY_BATCH, true)
    // 对象信封放行；连 JSON 都不是的正文交回解析器报 -32700，这里不冒充信封判定。
    @Expect(RemoteRequestSchema.preParseViolation("{\"jsonrpc\":\"2.0\"}", REQUEST_DEPTH_LIMIT) == "", true)
    @Expect(RemoteRequestSchema.preParseViolation("nope", REQUEST_DEPTH_LIMIT) == "", true)
}

@Test
func methodNameAcceptsHostShapeAndRejectsOverlong() {
    @Expect(RemoteRequestSchema.methodViolation("session/submit") == "", true)
    // 契约里最长的一条（global/settings/set-transcript-view，35 字节）必须仍在界内。
    @Expect(RemoteRequestSchema.methodViolation("global/settings/set-transcript-view") == "", true)
    @Expect(RemoteRequestSchema.methodViolation(repeated("a", 64)) == "", true)
    @Expect(RemoteRequestSchema.methodViolation(repeated("a", 65)) == SCHEMA_DENY_METHOD, true)
    // 空方法名不能算「合法但未知」——它到授权表那里只会成一条说不清原因的拒绝。
    @Expect(RemoteRequestSchema.methodViolation("") == SCHEMA_DENY_METHOD, true)
    @Expect(REQUEST_METHOD_MAX_LEN, Int64(64))
}

@Test
func methodNameRejectsCharactersThatCouldForgeAuditLine() {
    // 审计行是拼出来的 JSON，方法名里带引号/换行/大括号就能伪造或挤掉同一行的别的字段。
    @Expect(RemoteRequestSchema.methodViolation("a\"b") == SCHEMA_DENY_METHOD, true)
    @Expect(RemoteRequestSchema.methodViolation("a\nb") == SCHEMA_DENY_METHOD, true)
    @Expect(RemoteRequestSchema.methodViolation("a b") == SCHEMA_DENY_METHOD, true)
    @Expect(RemoteRequestSchema.methodViolation("a{b") == SCHEMA_DENY_METHOD, true)
    // 非 ASCII 一律拒：长度按字节算，多字节串会在字符数与字节数之间给出两种判法。
    @Expect(RemoteRequestSchema.methodViolation("会话/提交") == SCHEMA_DENY_METHOD, true)
}

@Test
func originHeaderPresenceIsDeniedWithoutParsingItsValue() {
    // 本产品没有浏览器客户端：带 Origin 的请求一律拒，不看值。
    // 「没有 Origin 就放行」不是判据——非浏览器客户端本来就不发它，那条靠认证挡。
    @Expect(RemoteRequestSchema.originViolation("") == "", true)
    @Expect(RemoteRequestSchema.originViolation("null") == SCHEMA_DENY_ORIGIN, true)
    @Expect(RemoteRequestSchema.originViolation("http://127.0.0.1:18080") == SCHEMA_DENY_ORIGIN, true)
    @Expect(RemoteRequestSchema.originViolation("https://evil.example") == SCHEMA_DENY_ORIGIN, true)
}
