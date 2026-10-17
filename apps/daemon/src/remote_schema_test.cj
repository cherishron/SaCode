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

@Test
func hostHeaderMatchesAllowlistExactlyAfterPortAndCaseNormalisation() {
    // §7 的 DNS rebinding 那一档：Origin 出现即拒只挡得住「浏览器会带 Origin」的那类
    // 攻击；把 attacker.example 解析到 127.0.0.1 后，Host 是唯一还留下的判据。
    // 端口与大小写是同一个主机的两种写法，不该要求各客户端去对齐书写习惯。
    @Expect(RemoteRequestSchema.hostViolation("127.0.0.1:51234", "127.0.0.1,localhost") == "", true)
    @Expect(RemoteRequestSchema.hostViolation("localhost", "127.0.0.1,localhost") == "", true)
    @Expect(RemoteRequestSchema.hostViolation("LOCALHOST:8443", "localhost") == "", true)
    // IPv6 在 Host 里是带方括号的形态，去掉括号才能和 allowlist 里的 ::1 比。
    @Expect(RemoteRequestSchema.hostViolation("[::1]:8443", "::1,localhost") == "", true)
}

@Test
func hostHeaderRejectsForeignSuffixAndMissingWithoutSubstringMatch() {
    // 后缀拼贴是最容易被「包含式」实现放过的一类：127.0.0.1.attacker.example 里
    // 确实含着 127.0.0.1，但它不是那个主机。
    @Expect(RemoteRequestSchema.hostViolation("127.0.0.1.attacker.example", "127.0.0.1") == SCHEMA_DENY_HOST, true)
    @Expect(RemoteRequestSchema.hostViolation("evil127.0.0.1", "127.0.0.1") == SCHEMA_DENY_HOST, true)
    @Expect(RemoteRequestSchema.hostViolation("evil.example", "127.0.0.1,localhost") == SCHEMA_DENY_HOST, true)
    // HTTP/1.1 的 Host 是必需头；缺失等于「说不出这是在访问谁」，只能拒。
    @Expect(RemoteRequestSchema.hostViolation("", "127.0.0.1") == SCHEMA_DENY_HOST, true)
    // 同一字段被堆成两个值（a.com, b.com）时两个主机指向不同实例，拒掉比猜一个安全。
    @Expect(RemoteRequestSchema.hostViolation("a.com, b.com", "a.com,b.com") == SCHEMA_DENY_HOST, true)
}

@Test
func hostAllowlistEmptyDeniesEverythingWhileWildcardIsExplicitOptOut() {
    // allowlist 为空必须是「全拒」而不是「全放」：配置读失败时宁可起不来也别开门。
    @Expect(RemoteRequestSchema.hostViolation("127.0.0.1", "") == SCHEMA_DENY_HOST, true)
    // 通配是 LAN 部署的显式退出：写了 * 就是承认「任何主机名都算我」。
    @Expect(RemoteRequestSchema.hostViolation("nas.example", "*") == "", true)
}

@Test
func stackedHostIsRejectedEvenWhenAllowlistIsWildcard() {
    // 这条是「含逗号/空格即拒」唯一能被单独观察到的场景：允许集是 '*' 时，
    // 精确比对不再起作用（任何名字都放行），只有堆叠判定本身还在挡。
    // 变异反证记在案：把该判定改成永不触发时，上一条用例不会红（因为
    // "a.com, b.com" 整串本来就匹配不到 allowlist 里的任何一项），只有这条会红。
    @Expect(RemoteRequestSchema.hostViolation("a.com, b.com", "*") == SCHEMA_DENY_HOST, true)
    @Expect(RemoteRequestSchema.hostViolation("a.com\tb.com", "*") == SCHEMA_DENY_HOST, true)
    // 反过来，正常单值 Host 在 '*' 下必须放行——否则这条守卫就成了永久拒绝。
    @Expect(RemoteRequestSchema.hostViolation("a.com", "*") == "", true)
}

@Test
func defaultAllowedHostsCarriesBindAndLoopbackButNeverWildcard() {

    // 默认集 = 绑定地址本身 + 回环三写法。绑到具体地址时「用它访问」天然合法，
    // 不该要求运维再配一遍环境变量才能用。
    let loop = RemoteRequestSchema.allowedHosts("127.0.0.1", "")
    @Expect(RemoteRequestSchema.hostViolation("127.0.0.1:51234", loop) == "", true)
    @Expect(RemoteRequestSchema.hostViolation("localhost:51234", loop) == "", true)
    @Expect(RemoteRequestSchema.hostViolation("[::1]:51234", loop) == "", true)
    @Expect(RemoteRequestSchema.hostViolation("attacker.example", loop) == SCHEMA_DENY_HOST, true)
    // 0.0.0.0 不是一个可被 Host 指名道姓的主机，不能因为它就放行任意主机名；
    // 网卡地址由 SACODE_REMOTE_ALLOWED_HOSTS 显式给。
    let any = RemoteRequestSchema.allowedHosts("0.0.0.0", "nas.example, phone.lan")
    @Expect(RemoteRequestSchema.hostViolation("nas.example:8443", any) == "", true)
    @Expect(RemoteRequestSchema.hostViolation("PHONE.LAN", any) == "", true)
    @Expect(RemoteRequestSchema.hostViolation("0.0.0.0", any) == SCHEMA_DENY_HOST, true)
    @Expect(RemoteRequestSchema.hostViolation("evil.example", any) == SCHEMA_DENY_HOST, true)
    // 默认集里永远不该出现 '*'——那等于这条防线没上。
    @Expect(RemoteRequestSchema.allowedHosts("127.0.0.1", "").contains("*") == false, true)
}


