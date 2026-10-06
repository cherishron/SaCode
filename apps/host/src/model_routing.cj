package host
import core.*
import std.io.*
import std.time.*
import std.collection.ArrayList

// 宿主注入时钟；路由核心仍然纯读。每个模型步骤重新装配，不沿用旧绑定。
func routingRequestId(): String { return "${ownProcessId()}-${DateTime.nowUTC().toUnixTimeStamp().toMilliseconds()}" }
func routingEpoch(): Int64 { return DateTime.nowUTC().toUnixTimeStamp().toSeconds() }

func usageTotalsJson(rows: Array<UsageTotal>): String {
    var out = "["
    for (i in 0..rows.size) {
        if (i > 0) { out += "," }
        let r = rows[i]
        out += "{\"key\":\"${jsonEscapeText(r.key)}\",\"customModelId\":\"${jsonEscapeText(r.customModelId)}\",\"currency\":\"${jsonEscapeText(r.currency)}\",\"usedMicros\":${r.usedMicros}}"
    }
    return out + "]"
}
func routingIdsJson(ids: Array<String>): String {
    var out = "["
    for (i in 0..ids.size) {
        if (i > 0) { out += "," }
        out += "\"${jsonEscapeText(ids[i])}\""
    }
    return out + "]"
}
func ledgerStatsJson(): String {
    let ledger = UsageLedger.forUser()
    let pending = ArrayList<String>()
    for (id in ledger.unsettledAttempts()) { pending.add(id) }
    for (id in ledger.dispatchedUnsettled()) {
        var seen = false
        for (old in pending) { if (old == id) { seen = true } }
        if (!seen) { pending.add(id) }
    }
    return "{\"providerTotals\":${usageTotalsJson(ledger.providerTotals())},\"modelTotals\":${usageTotalsJson(ledger.modelTotals())},\"usageKindTotals\":${usageTotalsJson(ledger.usageKindTotals())},\"unsettledAttempts\":${routingIdsJson(pending.toArray())},\"pendingReservations\":${routingIdsJson(ledger.pendingReservations())},\"revision\":null}"
}

class HostModelRoute {
    let customId: String
    let logicalId: String
    let sessionId: String
    let cursor = Cursor()
    var seq: Int64 = 0
    init(customId: String, logicalId: String, sessionId: String) {
        this.customId = customId; this.logicalId = logicalId; this.sessionId = sessionId
    }
    func select(preview!: Bool = false): AttemptPlan {
        let customs = CustomModelRegistry.forUser().describe()
        let providers = ProviderRegistry.forUser().describe()
        var currency = ""
        for (m in customs.models) {
            if (m.id == customId && m.bindings.size > 0) { currency = m.bindings[0].currency }
        }
        let out = route(RouteRequest(customId, ["text-output"]), customs, providers,
            RouteHealth.forUser().view(), credentialViewOf(providers, CredentialStore.forUser()),
            UsageLedger.forUser().routerView(currency), if (preview) { Cursor() } else { cursor }, routingEpoch())
        if (let Some(reject) <- out.rejection) { throw Exception("route-rejected:${reject.code}") }
        let plan = planFor(customId, out.decision.getOrThrow(), customs, providers)
        if (plan.isNone()) { throw Exception("route-expand-failed") }
        if (plan.getOrThrow().protocol != "openai-completions") { throw Exception("protocol-not-supported") }
        return plan.getOrThrow()
    }
    func open(log: SessionLog, token: TurnToken, attach: AttachmentStore,
        tools: ModelToolRuntime): Provider {
        if (token.cancelled()) { throw Exception("cancelled") }
        let start = routingEpoch()
        seq += 1
        let plan = select().withAttemptId("${logicalId}-a${seq}")
        // 请求校验先于派发标记，校验失败没有上游尝试。
        let request = modelRequestJson(plan.modelId, log.snapshotEvents().toArray(),
            tools: tools.specs(), attachStore: attach, supportsImages: plan.images)
        let creds = CredentialStore.forUser().resolve(plan.credentialRef)
        if (creds.isNone()) { throw Exception("route-rejected:credential-unconfigured") }
        let ledger = UsageLedger.forUser()
        if (plan.dailyAmountMicro >= 0) {
            let gate = ledger.reserve(ReserveIntent(plan.attemptId, 0, plan.currency,
                logicalRequestId: logicalId, customModelId: customId, providerId: plan.providerId,
                modelId: plan.modelId, epoch: start), plan.dailyAmountMicro)
            if (!gate.accepted) { throw Exception("budget-${gate.code}") }
        }
        let attempts = AttemptLog.forUser()
        if (!attempts.markDispatched(logicalId, plan.attemptId, plan.key())) {
            ledger.voidAttempt(plan.attemptId, "attempt-mark-failed", epoch: start)
            throw Exception("attempt-mark-failed")
        }
        if (token.cancelled()) {
            let f = failureOf("cancelled", false)
            attempts.markFailed(plan.attemptId, f)
            ledger.voidAttempt(plan.attemptId, "cancelled", epoch: routingEpoch())
            throw Exception("cancelled")
        }
        let opened = RealSseProvider.open(plan.baseUrl, creds.getOrThrow().value, request, token)
        if (let Some(failure) <- opened.failure) {
            recordRouteFailure(plan, failure)
            throw Exception(failure.message())
        }
        return AccountedModelProvider(opened.provider.getOrThrow(), plan, logicalId, sessionId, start, token)
    }
}
func recordRouteFailure(plan: AttemptPlan, failure: TransportFailure) {
    let now = routingEpoch()
    let fr = classifyFailure(failure, plan.providerId, plan.modelId, plan.credentialRef, plan.transport)
    if (!AttemptLog.forUser().markFailed(plan.attemptId, failure)) { throw Exception("attempt-failure-write-failed") }
    RouteHealth.forUser().recordFailure(fr.scope, failure, fr.category, now)
    UsageLedger.forUser().voidAttempt(plan.attemptId, "attempt-failed", epoch: now)
}

// 结算跟随每次真实上游流；工具续跑是新尝试。取消和断流不冒充成功。
class AccountedModelProvider <: Provider & Resource {
    let inner: RealSseProvider
    let plan: AttemptPlan
    let logicalId: String
    let sessionId: String
    let started: Int64
    let token: TurnToken
    let assembly = Assembly()
    var settled = false
    var closed = false
    init(inner: RealSseProvider, plan: AttemptPlan, logicalId: String, sessionId: String,
        started: Int64, token: TurnToken) {
        this.inner = inner; this.plan = plan; this.logicalId = logicalId
        this.sessionId = sessionId; this.started = started; this.token = token
    }
    public func next(): ?Chunk {
        try {
            let ch = inner.next()
            if (let Some(c) <- ch) {
                assembly.push(c)
                if (!settled && !assembly.interrupted && inner.doneReceived && !token.cancelled()) {
                    let now = routingEpoch()
                    // SSE 当前只有合计 token；不能伪造四档用量或零费用。
                    // 流已成功结束；账本拒收时保留 dispatched/预留，不转写成传输失败。
                    settled = true
                    let accounting = UsageLedger.forUser().settle(AttemptAccounting(plan.attemptId, LedgerUsage.absent(), plan.rateCard(),
                        logicalRequestId: logicalId, customModelId: plan.customModelId,
                        providerId: plan.providerId, modelId: plan.modelId, session: sessionId,
                        resultClass: "done", startedEpoch: started, endedEpoch: now))
                    if (accounting.status == "rejected") { throw Exception("ledger-settlement-rejected") }
                    settled = true
                    let health = RouteHealth.forUser()
                    health.recordSuccess(RouteScope(plan.key(), "upstream"), now)
                    if (plan.credentialRef.size > 0) { health.recordSuccess(RouteScope(plan.credentialRef, "route-set"), now) }
                }
            }
            return ch
        } catch (e: Exception) {
            if (!settled) {
                settled = true
                recordRouteFailure(plan, failureOf(if (token.cancelled()) { "cancelled" } else { "read" }, true))
            }
            throw e
        }
    }
    public func close() {
        if (closed) { return }
        closed = true
        try {
            if (!settled) {
                settled = true
                recordRouteFailure(plan, failureOf(if (token.cancelled()) { "cancelled" } else { "read" }, true))
            }
        } finally { inner.close() }
    }
    public func isClosed(): Bool { return closed }
}
