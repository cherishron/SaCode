package daemon

import core.*
import stdx.net.http.*
import stdx.net.tls.*
import stdx.crypto.x509.*
import stdx.crypto.keys.*
import stdx.encoding.json.*
import std.io.*
import std.fs.*
import std.sync.*
import std.collection.*
import std.env.*

// JSON-RPC 帧直接写入 HTTP 响应体，不发布请求或审批凭据。
func okRpc(id: String, result: String): String {
    "{\"jsonrpc\":\"2.0\",\"id\":${id},\"result\":${result}}"
}

func errRpc(id: String, code: Int64, msg: String): String {
    "{\"jsonrpc\":\"2.0\",\"id\":${id},\"error\":{\"code\":${code},\"message\":\"${jsonEscapeText(msg)}\"}}"
}

// 游标类字段允许调用方写字符串或数字两种形状，取出十进制文本后统一交给
// parseDecimal 判法——语义只有一个真源，不在分派层再复制一套「什么算合法游标」。
func scalarText(node: JsonValue): String {
    return match (node.kind()) {
        case JsString => node.asString().getValue()
        case JsInt => node.asInt().getValue().toString()
        case _ => ""
    }
}

// HTTP 请求体不是 Seekable，按块读取后交给真正的 JSON 解析器。
func readBody(stream: InputStream): String {
    let out = ArrayList<Byte>()
    let chunk = Array<Byte>(4096, repeat: 0)
    while (true) {
        let n = stream.read(chunk)
        if (n <= 0) { break }
        if (out.size + n > 1048576) { throw Exception("request-body-too-large") }
        var i: Int64 = 0
        while (i < n) { out.add(chunk[i]); i += 1 }
    }
    return String.fromUtf8(out.toArray())
}

let INIT_CAPS = "[\"initialize\",\"session/catalog\",\"session/events\"]"
let bus = EventBus()
let teamHost = TeamHostBridge(bus)
let hostProxy = HostProxyBridge(bus)
let daemonStopping = AtomicBool(false)
// 限额只在接入启用（gate 在位）时 consult；未启用时它是空的，也不会有人抢槽。
let remoteLimiter = RemoteConcurrencyLimiter()

// 远程接入的门面。默认 None 表示「接入未启用」，保持 0.1 无认证旧路径不变；
// 一旦 set，dispatchRpcWithAuth 每条请求先走 gate.check(authHeader, method, workspaceId,
// sessionId, operationId)，拒则原样回 -32001 且不进 Host.forward。
// 这是设计 §4.2「远程接入是 daemon 内置可启停扩展」的落点。
let remoteGateRef = AtomicBool(false)
let remoteGateSlot = Mutex()
var remoteGateValue: Option<RemoteRequestGate> = None

func setRemoteGate(gate: Option<RemoteRequestGate>): Unit {
    remoteGateSlot.lock()
    remoteGateValue = gate
    remoteGateSlot.unlock()
    remoteGateRef.store(gate.isSome())
}

func currentRemoteGate(): Option<RemoteRequestGate> {
    if (!remoteGateRef.load()) { return None }
    remoteGateSlot.lock()
    let g = remoteGateValue
    remoteGateSlot.unlock()
    return g
}

// 幂等账自己的三条拒绝码。放在宿主与传输带之外另起一段，是为了让客户端
// 一眼分得清「账本没放行」和「宿主答了个业务错」：宿主本人已经用到
// -32001..-32004 与 -32010..-32016，daemon 传输占 -32010..-32013，
// 所以这里取上面第一条空闲连续段 -32017..-32019。
let LEDGER_ERR_OPERATION_ID_REQUIRED: Int64 = -32017
let LEDGER_ERR_CONFLICT: Int64 = -32018
let LEDGER_ERR_UNKNOWN: Int64 = -32019

// 服务端幂等账（设计 §5）：进程级一本。键里带了 instanceId 与 principalId，
// 多台设备共用同一本不会串号；有界与按插入序淘汰的语义在 IdempotencyLedger 里，
// 上限取 §7 那条实例级额度常量，不用类自己的默认值。
let idempotencyLedger = IdempotencyLedger(cap: IDEMPOTENCY_LEDGER_LIMIT)

let LEDGER_DISPOSITION_RECORD: String = "record"
let LEDGER_DISPOSITION_UNKNOWN: String = "unknown"
let LEDGER_DISPOSITION_NONE: String = "none"
// 这几条码意味着「请求可能已经落到宿主」，副作用不确定，只能记 unknown：
// 超时、宿主中途退出、以及分派支自己抛的异常都可能是做了一半。
let LEDGER_UNCERTAIN_ERRORS: Array<Int64> = [-32003, -32011, -32012]
// 这几条确证请求没到宿主（正在关停、宿主未配置、转发前置失败）：不建账，
// 同一条操作在宿主配好之后必须还能真跑一次——把「没配宿主」永久钉进账里，
// 等于让客户端的重试永远拿到一条过期错误。
let LEDGER_NEVER_REACHED_ERRORS: Array<Int64> = [-32002, -32010, -32013]

// 一条写请求的六元组键。放在一个持有者里是为了让「执行后记账」这一步
// 只传一个对象，而不是把六个裸串按位置传来传去。
class LedgerKeyOf {
    var instanceId = ""
    var principalId = ""
    var workspaceId = ""
    var sessionId = ""
    var method = ""
    var operationId = ""
}

func errorCodePresent(list: Array<Int64>, code: Int64): Bool {
    for (v in list) { if (v == code) { return true } }
    return false
}

// 一条业务响应该怎么记账。判定单独成函数，是因为「超时算不算业务失败」这条
// 不该等到真起一个会卡的宿主才能验。
func ledgerDisposition(response: String): String {
    var obj = JsonObject()
    let parsed = try { obj = JsonValue.fromStr(response).asObject(); true }
        catch (_: Exception) { false }
    // 读不出信封按「结果确定」记：宁可留一条可重放的回执，
    // 也不把一次可能已经发生的副作用标成 unknown。
    if (!parsed) { return LEDGER_DISPOSITION_RECORD }
    if (obj.get("result").isSome()) { return LEDGER_DISPOSITION_RECORD }
    var code = Int64(0)
    let coded = try {
        code = obj.get("error").getOrThrow().asObject().get("code").getOrThrow().asInt().getValue()
        true
    } catch (_: Exception) { false }
    if (!coded) { return LEDGER_DISPOSITION_RECORD }
    if (errorCodePresent(LEDGER_UNCERTAIN_ERRORS, code)) { return LEDGER_DISPOSITION_UNKNOWN }
    if (errorCodePresent(LEDGER_NEVER_REACHED_ERRORS, code)) { return LEDGER_DISPOSITION_NONE }
    return LEDGER_DISPOSITION_RECORD
}

// 重放要换成本次请求的 id：留着第一次的 id，客户端的 id 配对就永远等不到应答。
func replayReceipt(receipt: String, idText: String): String {
    if (ledgerIsUnknown(receipt)) {
        return errRpc(idText, LEDGER_ERR_UNKNOWN, "idempotency-unknown:${ledgerUnknownQueryId(receipt)}")
    }
    var obj = JsonObject()
    let parsed = try { obj = JsonValue.fromStr(receipt).asObject(); true }
        catch (_: Exception) { false }
    if (parsed && obj.get("result").isSome()) {
        return okRpc(idText, obj.get("result").getOrThrow().toString())
    }
    var code = Int64(0)
    var msg = ""
    let coded = try {
        let e = obj.get("error").getOrThrow().asObject()
        code = e.get("code").getOrThrow().asInt().getValue()
        msg = e.get("message").getOrThrow().asString().getValue()
        true
    } catch (_: Exception) { false }
    if (coded) { return errRpc(idText, code, msg) }
    // 走到这里说明账里那条连信封都不是，那是本模块自己的 bug：如实报错，不假成功。
    return errRpc(idText, -32003, "idempotency-receipt-unreadable")
}

// 执行完的去向：记原回执 / 记 unknown 并把响应换成「结果未知 + 查询标识」/ 不建账。
func ledgerAfterExecution(response: String, idText: String, ledgerOn: Bool,
                          k: LedgerKeyOf, contentDigest: String): String {
    if (!ledgerOn) { return response }
    let disposition = ledgerDisposition(response)
    if (disposition == LEDGER_DISPOSITION_NONE) { return response }
    if (disposition == LEDGER_DISPOSITION_UNKNOWN) {
        // queryId 就用客户端自己的 operationId：§5 要求「通过状态核实」，而核实面
        // （session/projection、task/describe）认的是这些既有标识符，
        // 再造一个不透明 id 反而没地方查。
        idempotencyLedger.recordUnknown(instanceId: k.instanceId, principalId: k.principalId,
            workspaceId: k.workspaceId, sessionId: k.sessionId, method: k.method,
            operationId: k.operationId, contentDigest: contentDigest, queryId: k.operationId)
        return errRpc(idText, LEDGER_ERR_UNKNOWN, "idempotency-unknown:${k.operationId}")
    }
    idempotencyLedger.recordDone(instanceId: k.instanceId, principalId: k.principalId,
        workspaceId: k.workspaceId, sessionId: k.sessionId, method: k.method,
        operationId: k.operationId, contentDigest: contentDigest, receipt: response)
    return response
}

// 身份引导端点（POST /auth/enroll、POST /auth/token）。接入未启用时为 None，
// 两个路由根本不注册——不是「注册了但返回 404」，免得留下可探测的面。
let remoteEndpointsSlot = Mutex()
var remoteEndpointsValue: Option<RemoteAccessEndpoints> = None

func setRemoteEndpoints(api: Option<RemoteAccessEndpoints>): Unit {
    remoteEndpointsSlot.lock()
    remoteEndpointsValue = api
    remoteEndpointsSlot.unlock()
}

func currentRemoteEndpoints(): Option<RemoteAccessEndpoints> {
    remoteEndpointsSlot.lock()
    let a = remoteEndpointsValue
    remoteEndpointsSlot.unlock()
    return a
}

// Host 允许集（§7 的 DNS rebinding 那一档）。开服前算一次，之后只读。
// 空串在这里是合法值而不是「未设置」——允许集为空 = 全拒，见 RemoteRequestSchema.hostViolation。
let remoteHostsSlot = Mutex()
var remoteHostsValue = ""

func setRemoteAllowedHosts(allowed: String): Unit {
    remoteHostsSlot.lock()
    remoteHostsValue = allowed
    remoteHostsSlot.unlock()
}

func currentRemoteAllowedHosts(): String {
    remoteHostsSlot.lock()
    let a = remoteHostsValue
    remoteHostsSlot.unlock()
    return a
}

// 请求头不区分大小写（HttpHeaders 内部转小写存储），缺失返空串。
// 空串等价「未带凭据」，由 gate 归一成 missing-bearer。
func requestHeader(request: HttpRequest, name: String): String {
    if (let Some(v) <- request.headers.getFirst(name)) { return v }
    return ""
}

// 解析门禁绑定的工作区标识。只在 SACODE_WORKSPACE_ID 环境变量显式非空时启用
// （opt-in）；空串表示这台实例不启用归属核验。
// 之所以不从 SACODE_HOST_ARGS 的 --workspace 自动派生：那会把「今天没检查」的
// 默认变成「今天检查」的默认，把大量以 workspaceId='ws-1' 做审计/脱敏测试的
// 夹具一并翻红。显式开这一开关，是把「跨工作区写入必须被拒」的语义真正
// 落进生产路径，而不是靠约定。
func boundWorkspaceId(): String {
    if (let Some(v) <- getVariable("SACODE_WORKSPACE_ID")) { return v }
    return ""
}

// 设计 §7：/rpc 与 /auth/* 仅 POST、/sse 与 /health 仅 GET；业务请求 Content-Type
// 必须是 application/json；外部 CORS 默认不开放（Origin 出现即拒）。这四条是路由级约束，
// 不依赖 gate，未启用接入时同样生效。
// 顺序有讲究：Origin 最先——它拒的是「本不该存在的调用方」，不值得先替它读一整段体。
// 之后先按流读体（readBody 自带 1 MiB 上限），再验媒体类型——大小是传输层
// 硬限，对任何体都成立；若先验 Content-Type，一个「又长又错类型」的请求会被归因成
// 类型问题，把体积防线显得像可有可无的语义检查。
func jsonBodyOf(ctx: HttpContext, wantPost: Bool): String {
    if (ctx.request.method != (if (wantPost) { "POST" } else { "GET" })) {
        throw Exception(if (wantPost) { "rpc-requires-post" } else { "endpoint-requires-get" })
    }
    if (RemoteRequestSchema.originViolation(requestHeader(ctx.request, "Origin")) != "") {
        throw Exception(SCHEMA_DENY_ORIGIN)
    }
    // Host 紧跟 Origin：两条挡的都是「自称在访问别的东西」，都不值得先替它读体。
    if (RemoteRequestSchema.hostViolation(requestHeader(ctx.request, "Host"), currentRemoteAllowedHosts()) != "") {
        throw Exception(SCHEMA_DENY_HOST)
    }
    if (!wantPost) { return "" }
    let body = readBody(ctx.request.body)
    if (!requestHeader(ctx.request, "Content-Type").startsWith("application/json")) {
        throw Exception("content-type-must-be-json")
    }
    return body
}

// 限速来源取连接真实地址（request.remoteAddr），不读 X-Forwarded-For：
// 设计 §7「来源地址不信任任意 X-Forwarded-For」。去掉 :port 只按主机归并。
func sourceAddress(request: HttpRequest): String {
    let addr = request.remoteAddr
    if (let Some(i) <- addr.lastIndexOf(":")) { return addr[0..i] }
    return addr
}

// 认证段：`remoteGateValue` 是 Some 时每条请求都过 gate.check；None 保持 0.1 旧路径。
// 拒时 -32001 归 jsonrpc-error 但**不进** Host/Team/SessionCatalog 任何一支。
// authHeader 从 stdx HttpRequest 传入；空串等价「无 Bearer」——若 gate 已开启即拒。
func dispatchRpcWithAuth(body: String, authHeader: String): String {
    // §7 的结构门禁排在解析与认证之前，两条理由各管一半：
    // 深度必须在对象图建起来之前判掉（stdx 解析器递归下降，超深正文会先把栈炸掉，
    // 轮不到我们给原因）；批量归因必须在 asObject() 抛之前判掉，否则一份合法的
    // 批量帧会被报成 parse error，客户端以为自己的 JSON 写坏了。
    // 拒在认证之前不泄露授权面信息——它只说这份骨架不合法，不说哪台设备、哪个会话。
    let preViolation = RemoteRequestSchema.preParseViolation(body, REQUEST_DEPTH_LIMIT)
    if (preViolation != "") { return errRpc("null", -32600, preViolation) }
    var idText = "null"
    var parsed: Option<JsonObject> = None
    try { parsed = Some(JsonValue.fromStr(body).asObject()) }
    catch (_: Exception) { return errRpc("null", -32700, "parse error") }
    let request = parsed.getOrThrow()
    var method = ""
    var params = "{}"
    var workspaceId = ""
    var sessionId = ""
    var operationId = ""
    try {
        // 无 id 就是 JSON-RPC 通知。§7 拒它：这一面承诺「每条请求一条应答」，
        // 让通知进来等于开一条没人收结果、却照样会打到宿主的执行路径。
        if (let Some(id) <- request.get("id")) {
            match (id.kind()) {
                case JsString => idText = id.toString()
                case JsInt => idText = id.toString()
                case _ => return errRpc("null", -32600, "id must be string or integer")
            }
        } else { return errRpc("null", -32600, SCHEMA_DENY_NOTIFICATION) }
        if (request.get("jsonrpc").getOrThrow().asString().getValue() != "2.0") {
            return errRpc(idText, -32600, "invalid jsonrpc version")
        }
        method = request.get("method").getOrThrow().asString().getValue()
        // 方法名上界与字符集要在 gate.check 之前：未登记的方法名是要原样落进审计行的，
        // 让一条 1 MiB 或带引号的方法名进去，等于让客户端决定我们日志一行长什么样。
        if (RemoteRequestSchema.methodViolation(method) != "") {
            return errRpc(idText, -32600, SCHEMA_DENY_METHOD)
        }
        if (let Some(value) <- request.get("params")) {
            params = value.asObject().toString()
            // 显式归属：设计 §5「客户端选择会话不发送全局 session/select」，
            // workspaceId/sessionId/operationId 都从 params 顶层取；缺失即空串，
            // 交给 gate 依 CapabilitySpec.needsWorkspace/Session 决定拒因。
            let obj = value.asObject()
            if (let Some(v) <- obj.get("workspaceId")) { workspaceId = v.asString().getValue() }
            if (let Some(v) <- obj.get("sessionId")) { sessionId = v.asString().getValue() }
            if (let Some(v) <- obj.get("operationId")) { operationId = v.asString().getValue() }
        }
    } catch (_: Exception) { return errRpc(idText, -32600, "invalid request") }
    var slotDevice = ""
    var authCtx: Option<AuthenticationContext> = None
    // 管理面要拿的是**门禁实际判定过的那个视图**（带 scope），不是从 context 重造一个。
    // 没有它就没有「执行前再核一次管理权」的第二个输入，规格 §2 那条只能靠调用层自觉。
    var authView: Option<DeviceAuthzView> = None
    // 幂等账的键在认证之后才凑得齐：principalId 只能来自认证上下文，
    // 客户端自报的归属字段要过 gate 的资源校验才算数。
    let k = LedgerKeyOf()
    var ledgerOn = false
    var contentDigest = ""
    if (let Some(gate) <- currentRemoteGate()) {
        let outcome = gate.check(authHeader, method, workspaceId, sessionId, operationId)
        if (!outcome.allowed) {
            return errRpc(idText, -32001, "authz-denied:${outcome.denyReason}")
        }
        // 认证通过才占槽：先占后认会让未认证请求把某台设备的槽位打满（限额面变成 DoS 面）。
        if (let Some(c) <- outcome.context) {
            let slot = remoteLimiter.acquireRpc(c.deviceId)
            if (!slot.allowed) {
                return errRpc(idText, -32005, "concurrency-denied:${slot.reason}")
            }
            slotDevice = c.deviceId
            authCtx = Some(c)
            authView = outcome.view
            k.instanceId = gate.instanceId
            // 只有策略表里标了 durable 的写操作才建账；判定回到登记它的那张表，
            // daemon 不维护第二份写操作名单。被限额拒掉的请求走不到这里，
            // 所以拒掉的请求也不会在账本里留下半个键。
            if (let Some(spec) <- gate.authorizer.specOf(method)) { ledgerOn = spec.durable }
        }
    }
    try {
        if (ledgerOn) {
            // 建账前必须拿到 operationId：没有它就没有键，也就没有「同一次操作」这件事。
            if (operationId.size == 0) { return errRpc(idText, LEDGER_ERR_OPERATION_ID_REQUIRED, "operation-id-required") }
            // 三个归属字段按审计同一套净化规则取值，账本与审计说的是同一个资源；
            // 内容摘要覆盖整个 params——万一两条请求净化后撞进同一个键而内容不同，
            // 只会得到 -32018 拒绝，不会互相顶掉回执（fail-closed）。
            k.method = method
            k.operationId = RemoteRequestGate.sanitizeId(operationId)
            k.workspaceId = RemoteRequestGate.sanitizeId(workspaceId)
            k.sessionId = RemoteRequestGate.sanitizeId(sessionId)
            if (let Some(c) <- authCtx) { k.principalId = c.principalId }
            contentDigest = canonicalDigest(JsonValue.fromStr(params))
            let prior = idempotencyLedger.consult(instanceId: k.instanceId, principalId: k.principalId,
                workspaceId: k.workspaceId, sessionId: k.sessionId, method: k.method,
                operationId: k.operationId, contentDigest: contentDigest)
            if (prior.kind == LEDGER_KIND_REPLAY) { return replayReceipt(prior.receipt, idText) }
            if (prior.kind == LEDGER_KIND_CONFLICT) { return errRpc(idText, LEDGER_ERR_CONFLICT, "idempotency-conflict") }
        }
        return ledgerAfterExecution(dispatchBusiness(method, params, idText, mgmtView: authView), idText, ledgerOn, k, contentDigest)
    } catch (e: Exception) { return errRpc(idText, -32003, e.message) }
    finally {
        // 早退（业务分支里的 return）也必须归还槽位，否则跑几轮就把 8 个槽吃干。
        if (slotDevice.size > 0) { remoteLimiter.releaseRpc(slotDevice) }
    }
}

// 业务分派支：认证与限额都过了才走到这里。整段是从 dispatchRpcWithAuth
// 原样搬出来的，一条分支都没改——搬出来只为了让幂等账能在它前后各插一步
// （执行前 consult，执行后按去向记账），不是为了顺手重写这段分派。
func dispatchBusiness(method: String, params: String, idText: String,
                      mgmtView!: Option<DeviceAuthzView> = None): String {
        if (daemonStopping.load()) { return errRpc(idText, -32002, "daemon is shutting down") }
        if (method == "initialize") {
            var capabilities = INIT_CAPS
            if (teamHost.configured()) {
                teamHost.ensureStarted()
                let caps = JsonValue.fromStr(INIT_CAPS).asArray()
                for (name in teamHost.capabilities()) { caps.add(JsonString(name)) }
                caps.add(JsonString("daemon/shutdown"))
                capabilities = caps.toString()
            }
            // 代理能力只在宿主可配时登记（此时还没起进程，只登记形状）：宿主不可用
            // 就不宣称，免得调用方按不存在的能力发请求。逐条追加到既有清单之后，
            // 不重建别人的那条数组。
            if (hostProxy.configured()) {
                for (name in hostProxy.capabilities()) {
                    capabilities = "${capabilities[0..capabilities.size - 1]},\"${jsonEscapeText(name)}\"]"
                }
            }
            let enforcementJson = RemoteSandboxEnforcement.current().toJson()
            var announceId = ""
            if (let Some(g) <- currentRemoteGate()) { announceId = g.instanceId }
            // 宣告必须与实际分派同源：sandboxEnforcement 直接取门禁用的那个探针值，
            // 客户端据此判断「这台目标现在能不能远程跑代码」，不用试了才知道。
            let result = "{\"protocolVersion\":\"0.1\",\"capabilities\":${capabilities},\"core\":\"cangjie\",\"transport\":\"http-sse\",\"instanceId\":\"${jsonEscapeText(announceId)}\",\"sandboxEnforcement\":${enforcementJson}}"
            bus.publish("daemon/client-initialized", "{\"protocolVersion\":\"0.1\",\"transport\":\"http-sse\"}")
            return okRpc(idText, result)
        } else if (method == "session/catalog") {
            var items = "["
            var comma = ""
            for (item in SessionCatalog(".").list()) {
                items += comma + "{\"id\":\"${jsonEscapeText(item.id)}\",\"title\":\"${jsonEscapeText(item.title)}\",\"durable\":${item.durable},\"status\":\"${item.status}\",\"workspaceDirectory\":\"${jsonEscapeText(item.workspaceDirectory)}\",\"current\":false}"
                comma = ","
            }
            items += "]"
            let root = jsonEscapeText(canonicalize(".").toString())
            return okRpc(idText, "{\"root\":\"${root}\",\"entries\":${items}}")
        } else if (method == "session/events") {
            // 持久事件补读面在 daemon 自己手里（契约锚点 apps/daemon/src/event_replay.cj）：
            // 转给宿主只会拿到 -32601，宿主本人不声明这个方法。
            // afterSeq/limit 允许字符串或数字两种写法，语义都由 parseDecimal 收口；
            // afterSeq 不传就是「从头读，含 seq 0」，第一条持久事件对新客户端必须可达。
            let obj = JsonValue.fromStr(params).asObject()
            var sessionIdText = ""
            var afterSeq = ""
            var limit = "50"
            var wantedGeneration = ""
            if (let Some(v) <- obj.get("sessionId")) { sessionIdText = v.asString().getValue() }
            if (let Some(v) <- obj.get("afterSeq")) { afterSeq = scalarText(v) }
            if (let Some(v) <- obj.get("limit")) { limit = scalarText(v) }
            if (let Some(v) <- obj.get("generation")) { wantedGeneration = v.asString().getValue() }
            let page = SessionEventReplay(root: ".").page(sessionId: sessionIdText,
                afterSeq: afterSeq, limit: limit, generation: wantedGeneration)
            if (page.kind == REPLAY_KIND_REJECTED) { return errRpc(idText, -32602, page.reason) }
            return okRpc(idText, page.toJson())
        } else if (method == "auth/devices" || method == "auth/revoke") {
            // 认证 RPC 管理面（规格 §5 后半个通路）。这两个方法**不进宿主转发**：
            // 它们读的是 daemon 自己的身份存储与快照，宿主既没有这份数据也不该有。
            // 视图缺失就当无权限——正常路径上门禁放行时一定带着它，这里兜住的是
            // 「有人改了分派却没把视图接上」那种漂移。
            var store: Option<RemoteIdentityStore> = None
            var snap = ""
            if (let Some(g) <- currentRemoteGate()) {
                store = Some(g.identity)
                snap = g.snapshotPath
            }
            if (let Some(s) <- store) {
                var view = DeviceAuthzView(AuthenticationContext("unauthenticated", "unauthenticated", Int64(0)))
                if (let Some(v) <- mgmtView) { view = v }
                let svc = RemoteManagementService(s, snapshotPath: snap)
                if (method == "auth/devices") { return okRpc(idText, svc.devicesJson(view)) }
                return okRpc(idText, svc.revokeJson(view, RemoteAccessEndpoints.field(params, "deviceId")))
            }
            return errRpc(idText, -32001, "authz-denied:remote-access-disabled")
        } else if (acceptsTeamMethod(method)) {
            return teamHost.forward(method, params, idText)
        } else if (forwarded(method)) {
            // 会话/工作树这一支只经 HostProxyBridge 白名单转发，不就近假答；
            // 宿主没配置或已退出都由代理归一成 -32010/-32012，远程 CLI 才分得清。
            // 分派层只留了 id 的 JSON 文本，代理要的是 id 节点本身（回写响应用），
            // 这里显式还原，不另发明第三种 id 表示。
            return hostProxy.forward(method, params, JsonValue.fromStr(idText))
        } else if (method == "daemon/shutdown") {
            teamHost.shutdown()
            hostProxy.shutdown()
            // Host 确已退出且读线程已 join 才允许 daemon 结束。
            // 短有界延迟留出 HTTP 响应写出窗口，不在处理器内直接 exit。
            spawn { => sleep(200 * Duration.millisecond); daemonStopping.store(true) }
            return okRpc(idText, "{\"ok\":true}")
        }
        return errRpc(idText, -32601, "method not found")
}

// 本地管理入口（设计 §4.2「首次登记由目标端本地管理入口创建一次性登记秘密」，
// §4「设备列表、确认、撤销只能通过本机受保护管理入口或具有显式管理权限的认证 RPC」）。
// 走 CLI 而不是网络端口：网络面仍然只有 /auth/enroll 与 /auth/token。
// 形状不合一律 64（EX_USAGE），改盘失败一律 78——「打印了成功但盘上没变」最难诊断。
func manageCommand(args: Array<String>): Int64 {
    let verb = args[1]
    if (verb == "list-devices") {
        if (args.size != 3) { return 64 }
        let listing = RemoteIdentityStore()
        listing.loadSnapshot(args[2])
        let listed = listing.listDevices()
        for (d in listed) {
            println("${d.deviceId}\t${d.principalId}\t${d.kind}\t${if (d.revoked) { "revoked" } else { "active" }}")
        }
        println("device-count ${listed.size}")
        getStdOut().flush()
        return 0
    }
    if (args.size != 4) { return 64 }
    let storePath = args[2]
    let operand = args[3]
    let manageStore = RemoteIdentityStore()
    manageStore.loadSnapshot(storePath)
    if (verb == "enroll-ticket") {
        let ticket = try { manageStore.createTicketForManagement(operand, storePath) }
            catch (e: Exception) {
                getStdErr().writeln("manage-failed: ${e.message}")
                getStdErr().flush()
                return 78
            }
        println("enrollment-ticket-for ${operand}")
        println("${ticket.value}")
        getStdOut().flush()
        return 0
    }
    if (verb == "revoke-device") {
        if (!manageStore.revokeDevice(operand)) {
            getStdErr().writeln("manage-denied: device-not-found")
            getStdErr().flush()
            return 78
        }
        if (!manageStore.saveSnapshot(storePath)) {
            getStdErr().writeln("manage-failed: snapshot-unwritable")
            getStdErr().flush()
            return 78
        }
        println("revoked ${operand}")
        getStdOut().flush()
        return 0
    }
    return 64
}

main(args: Array<String>): Int64 {
    // 本地管理入口（设计 §4.2「首次登记由目标端本地管理入口创建一次性登记秘密」）。
    // 这是 CLI 子命令，不是第三个网络端点：网络面仍只有 /auth/enroll 与 /auth/token。
    // 秘密原文只打到本命令的 stdout 给操作者（扫码/手动输入），
    // 落盘的快照里只有它的摘要。
    if (args.size >= 2 && args[0] == "--manage") { return manageCommand(args) }
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
    // 接入启用时的启动校验：缺 TLS / 身份 / 策略任一项即拒绝启动，不降级裸跑。
    let accessConfig = RemoteAccessConfig.fromEnvironment()
    if (let Some(reason) <- accessConfig.validate()) {
        getStdErr().writeln("remote-access-startup-refused: ${reason}")
        getStdErr().flush()
        return 78
    }
    // §7 Host 允许集：开服前算一次。未启用接入时同样生效——这条挡的是
    // 「自称在访问别的主机」，与认证无关，所以不给它一个「只在启用时检查」的例外。
    setRemoteAllowedHosts(RemoteRequestSchema.allowedHosts(
        accessConfig.bind, getVariable("SACODE_REMOTE_ALLOWED_HOSTS") ?? ""))
    if (accessConfig.enabled) {
        let identity = RemoteInstanceIdentity.loadOrCreate(accessConfig.identityPath)
        let auditSink = FileAuditSink("${accessConfig.identityPath}.audit.log")
        let audit = RemoteAuditLog(auditSink)
        // 设备身份跨重启保持：先加载快照再开服。加载失败只说明「无历史」，
        // 不是致命项——首次启动本来就没有这个文件。
        let store = RemoteIdentityStore()
        let deviceSnapshot = "${accessConfig.identityPath}.devices.json"
        if (store.loadSnapshot(deviceSnapshot)) {
            getStdErr().writeln("remote-access-devices-restored-from-snapshot")
            getStdErr().flush()
        }
        let authorizer = RemoteAccessAuthorizer()
        if (let Some(reason) <- RemotePolicyLoader.load(accessConfig.policyPath, authorizer)) {
            getStdErr().writeln("remote-access-startup-refused: ${reason}")
            getStdErr().flush()
            return 78
        }
        // 幂等账接盘（§5「副作用与幂等账不能仅靠内存锁」）：路径与实例身份同处，
        // 进程换了以后同一条 operationId 仍认得出「做过」，不会替客户端重下副作用。
        // 接入没启用就完全不接——0.1 无认证旧路径不写任何新文件。
        idempotencyLedger.attachStore(path: "${accessConfig.identityPath}.ledger.jsonl")
        setRemoteGate(Some(RemoteRequestGate(store, authorizer, audit, identity.instanceId,
            snapshotPath: deviceSnapshot, boundWorkspace: boundWorkspaceId())))
        setRemoteEndpoints(Some(RemoteAccessEndpoints(
            store, audit, RemoteAuthRateLimiter(), identity.instanceId,
            snapshotPath: deviceSnapshot)))
    }

    // 限额 §7「请求头/体接收超时 10 秒」：慢启动客户端不能占着分发器不放。
    var builder = ServerBuilder().addr(accessConfig.bind).port(port)
        .readHeaderTimeout(10 * Duration.second)
        .readTimeout(10 * Duration.second)
    var scheme = "http"
    if (accessConfig.certPath.size > 0 && accessConfig.keyPath.size > 0) {
        // 证书存在却解析失败时必须拒启动：「配了 TLS 却实际明文服务」比启动失败危险得多
        // ——客户端以为 bearer 走在加密通道上，整条凭据其实裸奔。
        let certText = try { String.fromUtf8(File.readFrom(Path(accessConfig.certPath))) }
            catch (_: Exception) { "" }
        let keyText = try { String.fromUtf8(File.readFrom(Path(accessConfig.keyPath))) }
            catch (_: Exception) { "" }
        if (certText.size == 0 || keyText.size == 0) {
            getStdErr().writeln("remote-access-startup-refused: tls-files-unreadable")
            getStdErr().flush()
            return 78
        }
        // 证书与私钥各自归因：运维拿到「解析失败」要能一眼分清是 .crt 还是 .key，
        // 两者排查路径完全不同（链式/编码 vs 密钥类型/加密口令）。
        var failReason = ""
        var certs: Option<Array<X509Certificate>> = None
        try { certs = Some(X509Certificate.decodeFromPem(certText)) }
        catch (_: Exception) { failReason = "tls-cert-undecodable" }
        var key: Option<RSAPrivateKey> = None
        if (failReason.size == 0) {
            // 本机 stdx 的 PrivateKey 是接口，decodeFromPem 只在具体密钥类上实现；
            // RSA 之外的私钥（ECDSA/SM2）留待有需求时按同一形状补。
            try { key = Some(RSAPrivateKey.decodeFromPem(keyText)) }
            catch (_: Exception) { failReason = "tls-key-undecodable" }
        }
        if (failReason.size > 0) {
            getStdErr().writeln("remote-access-startup-refused: ${failReason}")
            getStdErr().flush()
            return 78
        }
        builder = builder.tlsConfig(TlsServerConfig(certs.getOrThrow(), key.getOrThrow()))
        scheme = "https"
    }
    let server = builder.build()
    // /health：本机无凭据只给最小存活信息；非本机要求认证，且两种口径都不出
    // 目录、能力、设备列表（设计 §4.2）。
    server.distributor.register("/health", {
        ctx =>
        let source = sourceAddress(ctx.request)
        let isLocal = source == "127.0.0.1" || source == "::1" || source.startsWith("127.")
        let gate = currentRemoteGate()
        var status: UInt16 = 200
        var body = "{\"status\":\"ok\"}"
        if (let Some(g) <- gate) {
            let outcome = g.checkStreamAuth(requestHeader(ctx.request, "Authorization"), "")
            if (!isLocal && !outcome.allowed) {
                status = 401
                body = "{\"error\":\"authentication-required\"}"
            } else if (outcome.allowed) {
                // 认证通过才给订阅计数——它属于规模/能力信息。
                body = "{\"status\":\"ok\",\"sseSubscribers\":${bus.subscriberCount()}}"
            }
        } else if (isLocal) {
            // 接入未启用（本机开发态）时保留原有存活计数。
            body = "{\"status\":\"ok\",\"sseSubscribers\":${bus.subscriberCount()}}"
        }
        ctx.responseBuilder.status(status).header("Content-Type", "application/json").body(body)
    })
    // /rpc：每次请求都认证（设计 §4.2「initialize 不例外」），未启用接入时保持旧路径。
    server.distributor.register("/rpc", {
        ctx =>
        let response = try {
            dispatchRpcWithAuth(jsonBodyOf(ctx, true), requestHeader(ctx.request, "Authorization"))
        } catch (e: Exception) { errRpc("null", -32600, e.message) }
        ctx.responseBuilder.header("Content-Type", "application/json").body(response)
    })
    // /sse：建立即认证；认证不过不订阅，也不暴露 EventBus 是否存在。
    // 这一支的返回类型必须是 Unit（响应靠 builder 就地配置 + HttpResponseWriter 流式写），
    // 所以拒绝路径也写成「配置 builder 后 return」，不能 return builder 表达式。
    server.distributor.register("/sse", {
        ctx =>
        if (ctx.request.method != "GET") {
            ctx.responseBuilder.status(405).header("Content-Type", "application/json")
                .body("{\"error\":\"sse-requires-get\"}")
            return
        }
        // §7「外部 CORS 默认不开放」：Origin 出现即拒，且要挡在订阅与抢槽之前——
        // 一条打不开认证的浏览器请求也不该占掉这台设备的 2 条流位之一。
        if (RemoteRequestSchema.originViolation(requestHeader(ctx.request, "Origin")) != "") {
            ctx.responseBuilder.status(403).header("Content-Type", "application/json")
                .body("{\"error\":\"${SCHEMA_DENY_ORIGIN}\"}")
            return
        }
        // Host 同一条防线，也要挡在订阅与抢槽之前：重绑定出来的请求连认证都到不了。
        if (RemoteRequestSchema.hostViolation(requestHeader(ctx.request, "Host"), currentRemoteAllowedHosts()) != "") {
            ctx.responseBuilder.status(403).header("Content-Type", "application/json")
                .body("{\"error\":\"${SCHEMA_DENY_HOST}\"}")
            return
        }
        var streamDevice = ""
        var streamAuth = ""
        var resumeCursor = ""
        let gateForStream = currentRemoteGate()
        if (let Some(g) <- gateForStream) {
            streamAuth = requestHeader(ctx.request, "Authorization")
            resumeCursor = requestHeader(ctx.request, "Last-Event-ID")
            let outcome = g.checkStreamAuth(streamAuth, resumeCursor)
            if (!outcome.allowed) {
                ctx.responseBuilder.status(401).header("Content-Type", "application/json")
                    .body("{\"error\":\"authentication-required\"}")
                return
            }
            if (let Some(c) <- outcome.context) {
                let slot = remoteLimiter.acquireSse(c.deviceId)
                if (!slot.allowed) {
                    ctx.responseBuilder.status(429).header("Content-Type", "application/json")
                        .body("{\"error\":\"concurrency-denied\",\"reason\":\"${slot.reason}\"}")
                    return
                }
                streamDevice = c.deviceId
            }
        }
        ctx.responseBuilder
            .header("Content-Type", "text/event-stream")
            .header("Cache-Control", "no-cache")
            .header("Connection", "keep-alive")
            .header("transfer-encoding", "chunked")
        let writer = HttpResponseWriter(ctx)
        // §6 的首订阅顺序：先建立缓冲订阅，再读持久高水位。反过来做会因这两步之间
        // 落盘的事件既不在页里、也不在缓冲里——那是「恢复」最隐蔽的一种丢事件。
        let sub = bus.subscribe(device: streamDevice)
        let delivered = ArrayList<String>()
        try {
            writer.write((": connected\n\n").toArray())
            // 带 Last-Event-ID 才补读：首订阅的客户端要的是直播，不是整本历史。
            let resume = SseResume.build(root: ".", lastEventId: resumeCursor, limit: Int64(200))
            var k: Int64 = 0
            while (k < Int64(resume.frames.size)) {
                writer.write(resume.frames[k].toArray())
                delivered.add(resume.ids[k])
                k += 1
            }
            while (!ctx.isClosed() && !sub.isClosed()) {
                if (let Some(frame) <- sub.poll(1 * Duration.second)) {
                    // 补读交付过的游标，缓冲里再取到同一条就丢：顺序保证了「只多不少」。
                    if (SseFrame.delivered(ids: delivered, id: SseFrame.idOf(frame))) { continue }
                    writer.write(SseFrame.renderLive(frame).toArray())
                } else if (!sub.isClosed()) {
                    // 定期探测对端断连，空闲时也能进入 finally 退订。
                    writer.write((": keepalive\n\n").toArray())
                    // 空闲 tick 上重认一次身份：带外撤销（另一个进程改盘）只有这条路
                    // 能进已经建好的连接。按设备关流，这台设备的两条 SSE 一起断。
                    if (streamDevice.size > Int64(0)) {
                        if (let Some(g) <- gateForStream) {
                            // 原因由 gate 给：到期关流要让客户端续期后带游标重连，
                            // 撤销关流要让客户端去重新登记——两者恢复动作相反。
                            let endReason = g.revalidateStreamEndReason(streamAuth, deviceId: streamDevice)
                            if (endReason.size > Int64(0)) {
                                bus.closeFor(device: streamDevice, reason: endReason)
                            }
                        }
                    }
                }
            }
            let why = sub.closeReason()
            if (why != "" && why != SSE_CLOSE_UNSUBSCRIBED) {
                // §6「超过任一限额关闭并给出可恢复原因」：原因要发到流里，
                // 只写 stderr 就是让客户端靠连接自己断来猜该重连还是该缩页。
                writer.write(SseFrame.renderClose(why).toArray())
                getStdErr().writeln("sse subscription ${sub.id} closed: ${why}")
            }
        } finally {
            bus.unsubscribe(sub.id)
            if (streamDevice.size > 0) { remoteLimiter.releaseSse(streamDevice) }
        }
    })
    // 身份引导面只在接入启用时注册——未启用就不存在这个面，而不是返回 404。
    if (let Some(api) <- currentRemoteEndpoints()) {
        server.distributor.register("/auth/enroll", {
            ctx =>
            let resp = try { api.enroll(jsonBodyOf(ctx, true), sourceAddress(ctx.request)) }
                catch (e: Exception) { AuthResponse(400, "{\"error\":\"${jsonEscapeText(e.message)}\"}") }
            ctx.responseBuilder.status(UInt16(resp.status))
                .header("Content-Type", "application/json").body(resp.body)
        })
        server.distributor.register("/auth/token", {
            ctx =>
            let resp = try { api.token(jsonBodyOf(ctx, true), sourceAddress(ctx.request)) }
                catch (e: Exception) { AuthResponse(400, "{\"error\":\"${jsonEscapeText(e.message)}\"}") }
            ctx.responseBuilder.status(UInt16(resp.status))
                .header("Content-Type", "application/json").body(resp.body)
        })
    }
    let ready = SyncCounter(1)
    server.afterBind({ => ready.dec() })
    spawn { server.serve() }
    ready.waitUntilZero()
    println("daemon on ${scheme}://${accessConfig.bind}:${server.port}")
    getStdOut().flush()
    // 告警走 stderr：那行 `127.0.0.1:port` 是测试与客户端解析端口的唯一锚点，
    // 不能因为多打一条信息就把它挪位或换格式。
    if (accessConfig.bind == "0.0.0.0" && (getVariable("SACODE_REMOTE_ALLOWED_HOSTS") ?? "") == "") {
        getStdErr().writeln("remote-host-warning: bind=0.0.0.0 且未配 SACODE_REMOTE_ALLOWED_HOSTS，"
            + "只有回环主机名可用；LAN 客户端要按网卡地址显式加白")
        getStdErr().flush()
    }
    while (!daemonStopping.load()) { sleep(50 * Duration.millisecond) }
    return 0
}
