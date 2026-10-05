package core

import std.collection.*
import stdx.net.http.*
import stdx.net.tls.*

// 加速转发核心（B4）：只决定「走哪条线」，不做调度、不做预算、不重试已可能送达的请求。
//
// 三种发送形态（chat / discover / probe）共用同一份 slug 允许集与同一条路径形态。
// 路径形态：{relayBase}/upstream/{relaySlug}/{protocolPath}
// 与 provider_registry.cj:680 的 baseUrl 校验共用同一纪律（https 或本机回环，禁 @ ? #）。
//
// 流式输出、工具调用增量、usage 传递与取消沿用 RealSseProvider（sse.cj）的既有形态，
// 本模块不重写帧解析：只把 URL 换成 relay 路径，让同一个 provider 走加速线路。
// 失败分类沿用 transport_failure.cj 的结构化对象，不在本模块另建。
//
// 设计文档 §6 的关键约束：
//   * 不做开放代理——slug 不在允许集内即 relay-target-rejected
//   * 不盲目重放——dispatched 标记先落盘才允许发送，标记写不下去就不发
//   * 重发白名单只在确认请求未发出、或供应商提供可靠幂等凭据时打开
//   * 线路健康与模型健康分档——channel 作用域走 RouteHealth（§5.1），本模块不参与计数

// 发送形态：kind 是分类标签，method 是 HTTP 方法，path 是协议侧的规范路径。
// 三种用途共用同一个通道决策，只在 method 与 path 上分叉。
public class RelayMode {
    public let kind: String
    public let method: String
    public let path: String

    public init(kind: String, method: String, path: String) {
        this.kind = kind
        this.method = method
        this.path = path
    }
}

// chat：POST /chat/completions（OpenAI 兼容形态）
public let CHAT_MODE = RelayMode("chat", "POST", "chat/completions")
// discover：GET /models（模型清单拉取）
public let DISCOVER_MODE = RelayMode("discover", "GET", "models")
// probe（只读健康接口）：GET /health（零推理成本，优先）
public let PROBE_HEALTH_MODE = RelayMode("probe", "GET", "health")
// probe（最小真实请求）：POST /chat/completions（会产生费用，计入 usage_kind=probe）
public let PROBE_MINIMAL_MODE = RelayMode("probe", "POST", "chat/completions")

// 拒绝码：闭集，调用方按码分诊，不解析文案。
public let RELAY_TARGET_REJECTED = "relay-target-rejected"
public let RELAY_BASE_INVALID = "relay-base-invalid"
public let RELAY_SLUG_INVALID = "relay-slug-invalid"
public let RELAY_TRANSPORT_UNKNOWN = "relay-transport-unknown"
public let DISPATCH_MARK_FAILED = "dispatch-mark-failed"

// 结构化拒绝：code 是分类标签，detail 是给人看的短句。
public class RelayRejection {
    public let code: String
    public let detail: String

    public init(code: String, detail: String) {
        this.code = code
        this.detail = detail
    }

    public func message(): String {
        return code
    }
}

// 目标计划：给定 slug、允许集、模式，产出目标 URL 或结构化拒绝。
// ok=true 时 url 可用作 RealSseProvider.open / ModelCatalog().fetch 的 baseUrl；
// ok=false 时 url 为空，rejection 给出原因。
public class RelayPlan {
    public let ok: Bool
    public let url: String
    public let slug: String
    public let mode: RelayMode
    public let rejection: Option<RelayRejection>

    public init(ok: Bool, url: String, slug: String, mode: RelayMode, rejection: Option<RelayRejection>) {
        this.ok = ok
        this.url = url
        this.slug = slug
        this.mode = mode
        this.rejection = rejection
    }
}

// relayBase 校验：与 provider_registry.cj:680 的 baseUrl 校验共用同一纪律。
// 只允许 https，或本机回环 http（联调用本地 mock）；禁 @ ? #；长度上限 2048。
public func validateRelayBase(url: String): Bool {
    if (url.size == 0 || url.size > 2048) {
        return false
    }
    if (url.contains("@") || url.contains("?") || url.contains("#")) {
        return false
    }
    let secure = url.startsWith("https://") && url.size > 8
    let local = url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:")
    return secure || local
}

// slug 校验：小写字母开头 + [a-z0-9-]，长度 ≤ 64。
// 与 provider_registry.cj:75 checkStableId 同构的稳定 ID 规则。
public func validateRelaySlug(slug: String): Bool {
    let bs = slug.toArray()
    if (bs.size == 0 || bs.size > 64) {
        return false
    }
    let first = bs[0]
    if (!(first >= 97 && first <= 122)) {
        return false
    }
    var i: Int64 = 1
    while (i < bs.size) {
        let b = bs[i]
        let ok = (b >= 97 && b <= 122) || (b >= 48 && b <= 57) || b == 45
        if (!ok) {
            return false
        }
        i += 1
    }
    return true
}

// slug 是否在允许集内。允许集是闭集：slug 必须精确匹配其中一个。
public func slugAllowed(slug: String, allowed: Array<String>): Bool {
    if (!validateRelaySlug(slug)) {
        return false
    }
    for (a in allowed) {
        if (a == slug) {
            return true
        }
    }
    return false
}

// 拼装 URL：{relayBase}/upstream/{slug}/{path}
// relayBase 末尾多余 "/" 会被去掉，避免双斜杠；path 前面不加 "/"。
public func buildRelayUrl(base: String, slug: String, mode: RelayMode): String {
    var trimmedBase = base
    while (trimmedBase.size > 0 && trimmedBase[trimmedBase.size - 1] == 47) {
        trimmedBase = trimmedBase[0..trimmedBase.size - 1]
    }
    return "${trimmedBase}/upstream/${slug}/${mode.path}"
}

// 生成计划：校验 slug + relayBase，拼装 URL；任一校验失败返回结构化拒绝。
public func planRelay(base: String, slug: String, allowed: Array<String>, mode: RelayMode): RelayPlan {
    if (!validateRelayBase(base)) {
        return RelayPlan(false, "", slug, mode, Some(RelayRejection(RELAY_BASE_INVALID, "relayBase 必须是 https 或本机回环 http")))
    }
    if (!validateRelaySlug(slug)) {
        return RelayPlan(false, "", slug, mode, Some(RelayRejection(RELAY_SLUG_INVALID, "slug 形态不合法")))
    }
    if (!slugAllowed(slug, allowed)) {
        return RelayPlan(false, "", slug, mode, Some(RelayRejection(RELAY_TARGET_REJECTED, "slug 不在允许集内")))
    }
    let url = buildRelayUrl(base, slug, mode)
    return RelayPlan(true, url, slug, mode, None)
}

// 传输计划：根据 transport 字段决定走 direct 还是 relay。
// direct：用 providerBaseUrl 原样；relay：走 planRelay。
// transport 只允许 "direct" 或 "relay"，其余值一律拒绝。
public class TransportPlan {
    public let kind: String       // "direct" | "relay"
    public let url: String
    public let slug: String
    public let mode: RelayMode
    public let rejection: Option<RelayRejection>

    public init(kind: String, url: String, slug: String, mode: RelayMode, rejection: Option<RelayRejection>) {
        this.kind = kind
        this.url = url
        this.slug = slug
        this.mode = mode
        this.rejection = rejection
    }
}

public func planTransport(providerBaseUrl: String, relayBase: String, slug: String,
                          allowed: Array<String>, transport: String, mode: RelayMode): TransportPlan {
    if (transport == "direct") {
        return TransportPlan("direct", providerBaseUrl, "", mode, None)
    }
    if (transport == "relay") {
        let plan = planRelay(relayBase, slug, allowed, mode)
        if (!plan.ok) {
            return TransportPlan("relay", "", slug, mode, plan.rejection)
        }
        return TransportPlan("relay", plan.url, slug, mode, None)
    }
    return TransportPlan("unknown", "", slug, mode, Some(RelayRejection(RELAY_TRANSPORT_UNKNOWN, "transport 只允许 direct 或 relay")))
}

// 重放闸：判定是否允许重发同一个上游请求。
//
// 判据（§6、§5.2、断言 79/80/81）：
//   - attempt/dispatched 事件已落盘 → 请求字节已进入线路，默认不重发
//   - 无 dispatched 事件 → 请求可能未发送，允许重发
//   - 例外：供应商给了可靠幂等凭据（如 Idempotency-Key）时，允许在 dispatched 之后重发
//
// 这个判定不消费网络、不写日志：日志侧的 dispatched 事件由 B2 落，
// 本模块只读它并给出布尔判定。重发白名单只在确认请求未发出、或供应商提供
// 可靠幂等凭据时打开——绝不按错误文案猜测。
public class ReplayDecision {
    public let allowed: Bool
    public let reason: String  // "not-dispatched" | "already-dispatched" | "idempotent-allowed"

    public init(allowed: Bool, reason: String) {
        this.allowed = allowed
        this.reason = reason
    }
}

public func decideReplay(dispatched: Bool, hasIdempotentKey: Bool): ReplayDecision {
    if (!dispatched) {
        return ReplayDecision(true, "not-dispatched")
    }
    if (hasIdempotentKey) {
        return ReplayDecision(true, "idempotent-allowed")
    }
    return ReplayDecision(false, "already-dispatched")
}

// 发送闸（fail-closed）：标记写不下去就不发。
// 返回 true 表示「可以发送」（租约可拿、落盘路径可用）。
// 返回 false 表示「拒绝发送」（写标记失败）——绝不「先发出去、回头补记」。
//
// 两条配套纪律（断言 80）：
//   * 标记写不下去就不发（fail-closed）
//   * 两次持锁都不跨网络：reserve 与 dispatched 各是「取租约 → 写一条 → 归还」的短临界区
public class DispatchGateResult {
    public let canSend: Bool
    public let code: String  // "ok" | "dispatch-mark-failed"

    public init(canSend: Bool, code: String) {
        this.canSend = canSend
        this.code = code
    }
}

public func dispatchGateOk(canAcquireLease: Bool, canWriteLog: Bool): DispatchGateResult {
    if (canAcquireLease && canWriteLog) {
        return DispatchGateResult(true, "ok")
    }
    return DispatchGateResult(false, DISPATCH_MARK_FAILED)
}

// 打开一次 relay chat 请求：走加速线路的 SSE provider。
// 失败沿用 RealSseProvider.open 的 SseOpenResult 形态，不新建失败类型。
// 流式输出、工具调用增量、usage 传递与取消全部沿用 RealSseProvider 的既有实现。
public func openRelayChat(relayBase: String, slug: String, allowed: Array<String>,
                          apiKey: String, requestJsonBody: String, token: TurnToken,
                          readTimeout!: Duration = Duration.second * 30): SseOpenResult {
    let plan = planRelay(relayBase, slug, allowed, CHAT_MODE)
    if (!plan.ok) {
        return SseOpenResult(None, Some(failureOf("credential", false, summary: "relay-target-rejected")))
    }
    // 用 plan.url 作为 baseUrl，RealSseProvider.open 会自动追加 "/chat/completions"
    return RealSseProvider.open(plan.url, apiKey, requestJsonBody, token, readTimeout: readTimeout)
}

// 拉取模型清单：走加速线路的模型发现。
// 失败沿用 ModelCatalog().fetch 的异常形态，不新建失败类型。
public func fetchRelayModels(relayBase: String, slug: String, allowed: Array<String>,
                             apiKey: String, readTimeout!: Duration = Duration.second * 15): Array<String> {
    let plan = planRelay(relayBase, slug, allowed, DISCOVER_MODE)
    if (!plan.ok) {
        if (let Some(rej) <- plan.rejection) {
            throw Exception(rej.message())
        }
        throw Exception(RELAY_TARGET_REJECTED)
    }
    return ModelCatalog().fetch(plan.url, apiKey, readTimeout: readTimeout)
}
