package core

import std.collection.*

// 路由器：**纯决策**。给定自定义模型 + 请求所需能力 + 健康视图 + 账本视图 + 凭据视图，
// 选一条路由，或返回**带类型的拒绝**。
//
// 形态纪律（断言 48/64，照测试 #48 的检法）：这个文件里不出现 CredentialStore、
// Client/HttpRequestBuilder、也不调用任何读时钟的函数——凭据只以「已配置的引用列表」
// 形态进来，时钟由调用方注入。这样「身份认证、配置存储、凭证存储与调度业务分离」
// 才是可检的东西，而不是一句描述话。
//
// 过滤链顺序固定（§4），任一环不过都返回带类型码的拒绝，不返回模糊的「失败」：
//   自定义模型 enabled → 供应商 enabled → 绑定 enabled 且非 dangling →
//   上游 availability 满足能力 → 凭据可解析 → 健康未暂停 → 预算允许 → 按 mode 选一条

public class RouteRequest {
    public let customModelId: String
    public let needs: Array<String>
    public init(customModelId: String, needs: Array<String>) {
        this.customModelId = customModelId
        this.needs = needs
    }
}

// 凭据视图：只有「哪些引用已配置」这一个事实，拿不到值也拿不到 store
public class CredentialView {
    public let configured: Array<String>
    public init(configured: Array<String>) {
        this.configured = configured
    }
    public func has(ref: String): Bool {
        for (r in configured) {
            if (r == ref) { return true }
        }
        return false
    }
}

// 账本视图：B2 只读**注入的**用量与在途预留来证纯函数与优先级；接真账本在 B3。
public class LedgerView {
    public let usedByModel: Array<(String, Int64)>
    public init(usedByModel: Array<(String, Int64)>) {
        this.usedByModel = usedByModel
    }
    public func usedFor(customModelId: String): Int64 {
        for (kv in usedByModel) {
            if (kv[0] == customModelId) { return kv[1] }
        }
        return 0
    }
}

// 游标：轮询位置与平滑加权的当前权重都是**跨次携带**的状态，由调用方持有。
// 它住在进程内——不落 route-health.log（请求路径上多一次同步落盘），
// 更不许落配置文档（每选一次就把用户编辑面的 revision 推高）。
public class Cursor {
    public var index: Int64 = 0
    public var weights: Array<(String, Int64)> = []
    public init() {}
    func weightOf(key: String): Int64 {
        for (kv in weights) {
            if (kv[0] == key) { return kv[1] }
        }
        return 0
    }
    func setWeight(key: String, value: Int64): Unit {
        var replaced = false
        var i = Int64(0)
        while (i < Int64(weights.size)) {
            if (weights[i][0] == key) {
                weights[i] = (key, value)
                replaced = true
            }
            i += 1
        }
        if (!replaced) {
            let next = ArrayList<(String, Int64)>()
            for (kv in weights) { next.add(kv) }
            next.add((key, value))
            weights = next.toArray()
        }
    }
}

public class RouteDecision {
    public let providerId: String
    public let modelId: String
    public let protocol: String
    public let bindingIndex: Int64
    public init(providerId: String, modelId: String, protocol: String, bindingIndex: Int64) {
        this.providerId = providerId
        this.modelId = modelId
        this.protocol = protocol
        this.bindingIndex = bindingIndex
    }
    public func key(): String {
        return "${providerId}/${modelId}"
    }
}

public class RouteRejection {
    public let code: String
    public let detail: String
    public init(code: String, detail: String) {
        this.code = code
        this.detail = detail
    }
}

public class RouteOutcome {
    public let decision: Option<RouteDecision>
    public let rejection: Option<RouteRejection>
    public init(decision: Option<RouteDecision>, rejection: Option<RouteRejection>) {
        this.decision = decision
        this.rejection = rejection
    }
}

// 候选：绑定的下标 + 它落到的供应商与上游模型
class RouteCandidate {
    let bindingIndex: Int64
    let provider: ProviderRecord
    let spec: ModelSpec
    let weight: Int64
    let order: Int64
    init(bindingIndex: Int64, provider: ProviderRecord, spec: ModelSpec, weight: Int64, order: Int64) {
        this.bindingIndex = bindingIndex
        this.provider = provider
        this.spec = spec
        this.weight = weight
        this.order = order
    }
    func key(): String {
        return "${provider.id}/${spec.id}"
    }
}

public func route(request: RouteRequest, customs: CustomModelView, providers: ProviderView,
    health: RouteHealthView, creds: CredentialView, ledger: LedgerView,
    cursor: Cursor, now: Int64): RouteOutcome {
    var custom: Option<CustomModelRecord> = None
    for (m in customs.models) {
        if (m.id == request.customModelId) { custom = Some(m) }
    }
    if (custom.isNone()) {
        return reject("custom-model-not-found", request.customModelId)
    }
    let model = custom.getOrThrow()
    if (!model.enabled) {
        return reject("custom-model-disabled", model.id)
    }
    // 预算闸：-1 = 未设该维度上限（不是 0——0 会被读成「立刻耗尽」）
    if (model.dailyTokens >= 0 && ledger.usedFor(model.id) >= model.dailyTokens) {
        return reject("budget-exhausted", "${ledger.usedFor(model.id)}/${model.dailyTokens}")
    }

    let candidates = ArrayList<RouteCandidate>()
    var firstReject = ""
    var index = Int64(0)
    while (index < Int64(model.bindings.size)) {
        let b = model.bindings[index]
        index += 1
        if (!b.enabled) { continue }
        var provider: Option<ProviderRecord> = None
        for (p in providers.providers) {
            if (p.id == b.providerId) { provider = Some(p) }
        }
        if (provider.isNone()) {
            // dangling：配置保留但不参与调度
            if (firstReject.size == 0) { firstReject = "provider-missing" }
            continue
        }
        let p = provider.getOrThrow()
        if (!p.enabled) {
            if (firstReject.size == 0) { firstReject = "provider-disabled" }
            continue
        }
        var spec: Option<ModelSpec> = None
        for (m in p.models) {
            if (m.id == b.modelId) { spec = Some(m) }
        }
        if (spec.isNone()) {
            if (firstReject.size == 0) { firstReject = "upstream-model-missing" }
            continue
        }
        let s = spec.getOrThrow()
        // availability 不是 available 就拒：unknown 不等于满足
        if (s.availability != "available") {
            if (firstReject.size == 0) { firstReject = "capability-unsatisfied" }
            continue
        }
        if (!fitsNeeds(s, request.needs)) {
            if (firstReject.size == 0) { firstReject = "capability-unsatisfied" }
            continue
        }
        if (!creds.has(p.credentialRef)) {
            if (firstReject.size == 0) { firstReject = "credential-unconfigured" }
            continue
        }
        // 两档都要看：模型自身故障（upstream）与凭证/额度档（route-set）
        if (health.isCooling("${p.id}/${s.id}", now) || health.isCooling(p.credentialRef, now)) {
            if (firstReject.size == 0) { firstReject = "route-cooling" }
            continue
        }
        candidates.add(RouteCandidate(index - 1, p, s, b.weight, b.order))
    }
    if (candidates.size == 0) {
        if (firstReject.size > 0) {
            return reject(firstReject, model.id)
        }
        return reject("no-enabled-binding", model.id)
    }

    var pick = Int64(0)
    if (model.mode == "round-robin") {
        pick = cursor.index % Int64(candidates.size)
        cursor.index += 1
    } else {
        // 平滑加权轮询（Nginx 式）：每次给各候选加 weight，选累计值最大者并减总权重。
        // 长期比例可确定断言，且不需要随机数——小样本失衡且难测难解释。
        var total: Int64 = 0
        var i = Int64(0)
        while (i < Int64(candidates.size)) {
            let c = candidates[i]
            let current = cursor.weightOf(c.key()) + c.weight
            cursor.setWeight(c.key(), current)
            total += c.weight
            i += 1
        }
        var best = Int64(0)
        var bestValue = cursor.weightOf(candidates[0].key())
        i = 0
        while (i < Int64(candidates.size)) {
            let v = cursor.weightOf(candidates[i].key())
            if (v > bestValue) {
                bestValue = v
                best = i
            }
            i += 1
        }
        pick = best
        let chosen = candidates[pick]
        cursor.setWeight(chosen.key(), cursor.weightOf(chosen.key()) - total)
    }

    let c = candidates[pick]
    return RouteOutcome(Some(RouteDecision(c.provider.id, c.spec.id, c.provider.protocol, c.bindingIndex)), None)
}

// requires 里混着两类词，满足路径不同：模态词查 outputModalities，能力位查 supports
func fitsNeeds(spec: ModelSpec, needs: Array<String>): Bool {
    for (need in needs) {
        if (need == "text-output") {
            if (!hasValue(spec.outputModalities, "text")) { return false }
        } else if (need == "image-output") {
            if (!hasValue(spec.outputModalities, "image")) { return false }
        } else if (!spec.hasCapability(need)) {
            return false
        }
    }
    return true
}

func hasValue(list: Array<String>, value: String): Bool {
    for (v in list) {
        if (v == value) { return true }
    }
    return false
}

func reject(code: String, detail: String): RouteOutcome {
    return RouteOutcome(None, Some(RouteRejection(code, detail)))
}

// ---------------------------------------------------------------------------
// 决策 → 装配：把「选哪条绑定」展开成宿主真正发请求要用的完整计划。
//
// 这一段仍然是**纯决策**：不出现 CredentialStore、不发请求、不读时钟。宿主拿到
// `AttemptPlan` 后才自己 resolve 凭据值、组装请求体、调 `Transport`。
//
// 为什么必须展开：`RouteDecision` 只有 providerId/modelId/protocol/bindingIndex，
// 宿主要拿到 baseUrl 还得回注册表查一遍，要拿到费率还得回自定义模型查一遍——
// 两处查错任何一处，账单就错了。展开成一个不可变快照，账单口径就只有一份真源。
// ---------------------------------------------------------------------------

// 一次上游尝试的完整装配计划（不可变快照）
public class AttemptPlan {
    public let customModelId: String
    public let providerId: String
    public let modelId: String
    public let baseUrl: String
    public let credentialRef: String
    public let protocol: String
    public let images: Bool
    public let currency: String
    public let priceVersion: String
    public let priceInMicro: Int64
    public let priceOutMicro: Int64
    public let priceCacheReadMicro: Int64
    public let priceCacheWriteMicro: Int64
    public let dailyAmountMicro: Int64
    public let transport: String
    public let bindingIndex: Int64
    public let attemptId: String

    public init(customModelId: String, providerId: String, modelId: String, baseUrl: String,
        credentialRef: String, protocol: String, images: Bool, currency: String,
        priceVersion: String, priceInMicro: Int64, priceOutMicro: Int64,
        priceCacheReadMicro: Int64, priceCacheWriteMicro: Int64, dailyAmountMicro: Int64,
        transport: String, bindingIndex: Int64, attemptId: String) {
        this.customModelId = customModelId
        this.providerId = providerId
        this.modelId = modelId
        this.baseUrl = baseUrl
        this.credentialRef = credentialRef
        this.protocol = protocol
        this.images = images
        this.currency = currency
        this.priceVersion = priceVersion
        this.priceInMicro = priceInMicro
        this.priceOutMicro = priceOutMicro
        this.priceCacheReadMicro = priceCacheReadMicro
        this.priceCacheWriteMicro = priceCacheWriteMicro
        this.dailyAmountMicro = dailyAmountMicro
        this.transport = transport
        this.bindingIndex = bindingIndex
        this.attemptId = attemptId
    }

    // 作用域键：必须与 `route` 查健康用的两把键逐字一致，否则熔断记在 A 上、查在 B 上
    public func key(): String {
        return "${providerId}/${modelId}"
    }

    // 本次尝试的费率卡：四档各自可 -1 = 未登记，未登记维度遇用量时落「待核算」
    public func rateCard(): RateCard {
        return RateCard(priceInMicro, priceOutMicro, priceCacheReadMicro,
            priceCacheWriteMicro, currency, priceVersion)
    }

    // attemptId 由宿主分配（每次尝试一个新值），这里不自己编号
    public func withAttemptId(next: String): AttemptPlan {
        return AttemptPlan(customModelId, providerId, modelId, baseUrl, credentialRef,
            protocol, images, currency, priceVersion, priceInMicro, priceOutMicro,
            priceCacheReadMicro, priceCacheWriteMicro, dailyAmountMicro, transport,
            bindingIndex, next)
    }
}

// 装配失败的带类型拒绝：与路由阶段的拒绝共用一个码空间，宿主可以一套错误表处理
public class RoutingAttempt {
    public let plan: Option<AttemptPlan>
    public let reject: Option<RouteRejection>
    public init(plan: Option<AttemptPlan>, reject: Option<RouteRejection>) {
        this.plan = plan
        this.reject = reject
    }
}

// 把路由决策展开成装配计划。缺供应商 / 缺上游模型 / 决策与绑定对不上，一律
// 返回 `route-expand-failed`——宁可拒，不可按名字猜 baseUrl 或凭据引用。
public func planFor(customId: String, decision: RouteDecision, customs: CustomModelView,
    providers: ProviderView): Option<AttemptPlan> {
    var custom: Option<CustomModelRecord> = None
    for (m in customs.models) {
        if (m.id == customId) { custom = Some(m) }
    }
    if (custom.isNone()) { return None }
    let model = custom.getOrThrow()
    var binding: Option<BindingRecord> = None
    var pos: Int64 = 0
    while (pos < Int64(model.bindings.size)) {
        if (pos == decision.bindingIndex) { binding = Some(model.bindings[pos]) }
        pos += 1
    }
    if (binding.isNone()) { return None }
    let b = binding.getOrThrow()
    // 决策里带的 provider/model 必须与绑定条目逐字相等：绑定被改过就重路由，不复用旧决策
    if (b.providerId != decision.providerId || b.modelId != decision.modelId) { return None }
    var provider: Option<ProviderRecord> = None
    for (p in providers.providers) {
        if (p.id == decision.providerId) { provider = Some(p) }
    }
    if (provider.isNone()) { return None }
    let p = provider.getOrThrow()
    var spec: Option<ModelSpec> = None
    for (s in p.models) {
        if (s.id == decision.modelId) { spec = Some(s) }
    }
    if (spec.isNone()) { return None }
    let s = spec.getOrThrow()
    return Some(AttemptPlan(model.id, p.id, decision.modelId, p.baseUrl, p.credentialRef,
        p.protocol, s.image, b.currency, b.priceVersion.toString(), b.priceInMicro,
        b.priceOutMicro, b.priceCacheReadMicro, b.priceCacheWriteMicro,
        model.dailyAmountMicro, p.transport, decision.bindingIndex, ""))
}

// 失败归因：按**实际受影响范围**选最窄的一档作用域，返回该档 + 是否计数。
public class FailureRoute {
    public let scope: RouteScope
    public let category: String
    public init(scope: RouteScope, category: String) {
        this.scope = scope
        this.category = category
    }
}

// 归因规则（断言 6、9、55、81）：
//   401/403      → credential：不消耗三次机会，但立即暂停该凭证档
//   未到达上游    → channel：请求字节没进线路，不计入模型三次失败
//   protocol/read → unknown：归因不明，不判为模型故障
//   429          → effective + route-set：额度按凭证给，换模型也躲不掉
//   5xx          → effective + upstream：模型自身故障
//   其余 4xx     → request：请求本身的问题，不算模型故障
//   cancelled    → cancelled：调用方主动放弃，不计入任何计数
public func classifyFailure(failure: TransportFailure, providerId: String, modelId: String,
    credentialRef: String, transport: String): FailureRoute {
    let upstream = RouteScope("${providerId}/${modelId}", "upstream")
    if (failure.kind == "cancelled") {
        return FailureRoute(upstream, "cancelled")
    }
    if (failure.status == Int64(401) || failure.status == Int64(403)) {
        return FailureRoute(RouteScope(credentialRef, "route-set"), "credential")
    }
    if (!failure.reachedUpstream) {
        return FailureRoute(RouteScope(transport, "channel"), "channel")
    }
    if (failure.kind == "protocol" || failure.kind == "read") {
        return FailureRoute(upstream, "unknown")
    }
    if (failure.status == Int64(429)) {
        return FailureRoute(RouteScope(credentialRef, "route-set"), "effective")
    }
    if (failure.status >= Int64(500)) {
        return FailureRoute(upstream, "effective")
    }
    return FailureRoute(upstream, "request")
}

// 凭据视图只暴露「哪些引用已配置」这一个事实。这里唯一一次触到 store 的地方
// 是宿主：它拿到列表后才交给 `route`，store 本身永远不进调度函数。
public func credentialViewOf(providers: ProviderView, store: CredentialStore): CredentialView {
    let refs = ArrayList<String>()
    for (p in providers.providers) {
        if (store.resolve(p.credentialRef).isNone()) { continue }
        var seen = false
        for (r in refs) { if (r == p.credentialRef) { seen = true } }
        if (!seen) { refs.add(p.credentialRef) }
    }
    return CredentialView(refs.toArray())
}
