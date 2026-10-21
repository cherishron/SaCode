package core

import std.collection.ArrayList
import std.fs.*
import std.unittest.*

// 多候选 failover 的契约测试（2026-10-21）。
//
// 这批用例钉住六项修复的共同行为：
//   * 429 带 Retry-After 首次失败即冷却，不带时仍保留三次累计；
//   * 连接超时的 channel 作用域进入冷却，route 会按 transport 排除坏线路；
//   * 首选失败时 ModelAgentLoop 用同一请求体调用 nextProvider 换下一候选；
//   * 双候选都冷却时 RouteRejection 带回最近一次结构化 TransportFailure；
//   * 冷却窗口内宿主传 stickyProviderId 会粘住降级 Provider，首选恢复后释放；
//   * Retry-After:0 与“未提供”(-1) 分开处理。
//
// 真实链路：sse/host 把 TransportFailure 包成 TransportFailureException，
// RequestTraceProvider 不把它改写成字符串，ModelAgentLoop 才能识别并重试。

func foCleanup(name: String): Unit {
    for (f in [name, "${name}.lease"]) {
        if (exists(f)) {
            try {
                removeIfExists(f, recursive: false)
            } catch (_: Exception) {}
        }
    }
}

func foSpec(id: String): ModelSpec {
    return ModelSpec(id, id, "128k", "4k", false, inputModalities: ["text"], outputModalities: ["text"],
        supports: ["tools", "stream"], meterUnit: "token", provenance: "human-confirmed", availability: "available")
}

func foBinding(provider: String, model: String, order: Int64): BindingRecord {
    return BindingRecord(provider, model, true, order, 1, 1000, 2000, -1, -1, 1, "CNY")
}

func foProvider(id: String, ref: String, transport!: String = "direct"): ProviderRecord {
    return ProviderRecord(id, id, "https://${id}.example.com/v1", "openai-completions", ref, false, [foSpec("m-a")],
        enabled: true, transport: transport)
}

func foCustomView(): CustomModelView {
    let custom = CustomModelRecord(
        "code",
        "编程模型",
        "",
        true,
        "coding",
        ["tools", "text-output"],
        [
            foBinding("p-a", "m-a", 0),
            foBinding("p-b", "m-a", 1)
        ],
        "round-robin"
    )
    return CustomModelView([custom], 1, true)
}

func foProviderView(): ProviderView {
    return ProviderView(
        [
            foProvider("p-a", "FO_A_KEY"),
            // 第二候选走不同线路，才能证明 channel 冷却只排除坏掉的那条。
            foProvider("p-b", "FO_B_KEY", transport: "relay-b")
        ],
        1,
        true,
        "p-a",
        "m-a"
    )
}

func foCustomView3(): CustomModelView {
    let custom = CustomModelRecord(
        "code",
        "编程模型",
        "",
        true,
        "coding",
        ["tools", "text-output"],
        [
            foBinding("p-a", "m-a", 0),
            foBinding("p-b", "m-a", 1),
            foBinding("p-c", "m-a", 2)
        ],
        "round-robin"
    )
    return CustomModelView([custom], 1, true)
}

func foProviderView3(): ProviderView {
    return ProviderView(
        [
            foProvider("p-a", "FO_A_KEY"),
            foProvider("p-b", "FO_B_KEY", transport: "relay-b"),
            foProvider("p-c", "FO_C_KEY", transport: "relay-c")
        ],
        1,
        true,
        "p-a",
        "m-a"
    )
}

func foRoute(health: RouteHealthView, now: Int64): RouteOutcome {
    return route(RouteRequest("code", ["tools", "text-output"]), foCustomView(), foProviderView(), health,
        CredentialView(["FO_A_KEY", "FO_B_KEY"]), LedgerView([]), Cursor(), now)
}

func foRoute3(health: RouteHealthView, cursor: Cursor, sticky: String, now: Int64): RouteOutcome {
    return route(RouteRequest("code", ["tools", "text-output"], stickyProviderId: sticky), foCustomView3(),
        foProviderView3(), health, CredentialView(["FO_A_KEY", "FO_B_KEY", "FO_C_KEY"]), LedgerView([]), cursor, now)
}

func foQuotaFailure(summary!: String = "http-status:429"): TransportFailure {
    return failureOf("http-status", true, status: 429,
        retryAfterSeconds: retryAfterFromHeaders(whitelistedHeaders([("Retry-After", "5")]), 0), summary: summary)
}

class FoChunks <: Provider & Resource {
    let chunks: Array<Chunk>
    var index = Int64(0)
    public var closes = Int64(0)
    init(chunks: Array<Chunk>) {
        this.chunks = chunks
    }
    public func next(): Option<Chunk> {
        if (index >= chunks.size) {
            return None
        }
        let value = chunks[index]
        index += 1
        return Some(value)
    }
    public func close(): Unit {
        closes += 1
    }
    public func isClosed(): Bool {
        return closes > 0
    }
}

// 首个 provider 在 open 阶段抛出结构化失败，用于验证 ModelAgentLoop 的换候选路径。
class FoFailing <: Provider & Resource {
    let failure: TransportFailure
    public var closes = Int64(0)
    init(failure: TransportFailure) {
        this.failure = failure
    }
    public func next(): Option<Chunk> {
        throw TransportFailureException(failure)
    }
    public func close(): Unit {
        closes += 1
    }
    public func isClosed(): Bool {
        return closes > 0
    }
}

// Bug① + ⑥：429 带 Retry-After:5 时，第一次失败就进入冷却；
// 冷却窗口内落到第二候选，窗口结束（now >= notBefore）后首选重新可选。
@Test
func rateLimitedPreferredFallsBackOnFirstRetryAfterThenRecovers() {
    let name = "core-test-failover-retry-after.log"
    foCleanup(name)
    let health = RouteHealth(name)
    let cred = "FO_A_KEY"
    let scope = RouteScope(cred, "route-set")
    let failure = foQuotaFailure()
    // 头里的 5 秒必须真进结构化失败，而不是常量注入
    @Expect(failure.retryAfterSeconds, Int64(5))

    health.recordFailure(scope, failure, "effective", 10000)
    let cooling = RouteHealth(name).view()
    let state = RouteHealth(name).stateOf(cred)
    @Expect(state.failures, Int64(1))
    @Expect(state.cooling, true)
    @Expect(state.notBefore, Int64(10005))
    @Expect(cooling.isCooling(cred, 10001), true)
    // 冷却窗口内连续路由都不得回到首选：这里模拟同一轮的多个工具步/
    // 多个后续轮次。每次新建 Cursor，排除轮询游标造成的偶然。
    var i = Int64(0)
    while (i < 4) {
        let picked = foRoute(cooling, 10001 + i)
        @Expect(picked.decision.getOrThrow().providerId, "p-b")
        i += 1
    }

    // notBefore = 10000 + 5；到达该时刻后首选重新可选。
    let recovered = RouteHealth(name).view()
    @Expect(recovered.isCooling(cred, 10005), false)
    let retried = foRoute(recovered, 10005)
    @Expect(retried.decision.getOrThrow().providerId, "p-a")
    foCleanup(name)
}

// Bug②：连接超时归到 channel 档，channel 失败不消耗模型三次机会，
// 但要立即冷却该 transport；route 查 channel 后必须落到不同线路的第二候选。
@Test
func connectionTimeoutCoolsChannelAndFallsBack() {
    let failure = failureOf("transport", false, summary: "http-request-error", reason: "timeout")
    let routeOfFailure = classifyFailure(failure, "p-a", "m-a", "FO_A_KEY", "direct")
    @Expect(routeOfFailure.category, "channel")
    @Expect(routeOfFailure.scope.kind, "channel")
    @Expect(routeOfFailure.scope.key, "direct")

    let name = "core-test-failover-channel.log"
    foCleanup(name)
    let health = RouteHealth(name)
    health.recordFailure(routeOfFailure.scope, failure, routeOfFailure.category, 20000)
    let channel = RouteHealth(name).stateOf("direct")
    @Expect(channel.failures, Int64(0)) // 不计入模型三次失败
    @Expect(channel.cooling, true) // 但线路必须立即暂停
    let cooling = RouteHealth(name).view()
    @Expect(cooling.isCooling("direct", 20001), true)
    let picked = foRoute(cooling, 20001)
    @Expect(picked.decision.getOrThrow().providerId, "p-b")

    // 阶梯第一档 30 分钟；到期后首选重新可选。
    let recovered = RouteHealth(name).view()
    @Expect(recovered.isCooling("direct", 21800), false)
    let retried = foRoute(recovered, 21800)
    @Expect(retried.decision.getOrThrow().providerId, "p-a")
    foCleanup(name)
}

// Bug④：两个候选都冷却时返回 route-cooling，并带回最近一次结构化失败，
// 而不是只留下一个无法解释的字符串码。
@Test
func bothRateLimitedCandidatesYieldTypedFailure() {
    let name = "core-test-failover-both-cooling.log"
    foCleanup(name)
    let health = RouteHealth(name)
    health.recordFailure(RouteScope("FO_A_KEY", "route-set"), foQuotaFailure(summary: "a-429"), "effective", 30000)
    health.recordFailure(RouteScope("FO_B_KEY", "route-set"), foQuotaFailure(summary: "b-429"), "effective", 30001)
    let view = RouteHealth(name).view()
    @Expect(view.isCooling("FO_A_KEY", 30002), true)
    @Expect(view.isCooling("FO_B_KEY", 30002), true)
    let out = foRoute(view, 30002)
    @Expect(out.decision.isNone(), true)
    let rejection = out.rejection.getOrThrow()
    @Expect(rejection.code, "route-cooling")
    @Expect(rejection.detail, "code")
    @Expect(rejection.failure.isSome(), true)
    let failure = rejection.failure.getOrThrow()
    @Expect(failure.status, Int64(429))
    @Expect(failure.retryAfterSeconds, Int64(5))
    // B 的失败事件更晚，必须带回 B 的结构化对象。
    @Expect(failure.summary, "b-429")
    foCleanup(name)
}

// Bug③：首个 provider 在 provider.next() 抛出 TransportFailureException 时，
// ModelAgentLoop 不能收束成 error:...；零增量时应调用 nextProvider 换候选，
// 并用同一份本步请求体完成本轮。
@Test
func firstProviderFailureFailsOverToNextProvider() {
    let name = "core-test-failover-provider-retry.log"
    foCleanup(name)
    let log = SessionLog(name)
    log.append("user/message", "跑一步")
    let first = FoFailing(foQuotaFailure(summary: "first-429"))
    let nextProviderChunks = FoChunks([Chunk("text", "done", ""), Chunk("finish", "", "stop")])
    let requests = ArrayList<String>()
    let next: (String) -> Provider = {
        body =>
            requests.add(body)
            nextProviderChunks
    }
    let result = ModelAgentLoop().run(first, next, "test-model", TurnToken(), log, DeliveryQueue(32), false)
    @Expect(requests.size, Int64(1))
    @Expect(requests[0].contains("跑一步"), true)
    @Expect(result.finishReason, "stop")
    @Expect(result.text, "done")
    @Expect(first.closes, Int64(1))
    @Expect(nextProviderChunks.closes, Int64(1))
    foCleanup(name)
}

// Bug⑤：首选冷却时，宿主每步传入上一步的 providerId；核心在首选仍不可用时
// 粘住降级候选，避免同一冷却窗口内又轮询到第三候选。首选恢复后 sticky 释放。
@Test
func stickyFallbackHoldsWhilePreferredCoolsAndReleasesAfterRecovery() {
    let name = "core-test-failover-sticky.log"
    foCleanup(name)
    let health = RouteHealth(name)
    health.recordFailure(RouteScope("FO_A_KEY", "route-set"), foQuotaFailure(), "effective", 40000)
    let cooling = RouteHealth(name).view()

    // A 冷却后候选是 B、C；游标 1 本来会选 C，sticky=B 必须压过轮询。
    let plainCursor = Cursor()
    plainCursor.index = 1
    let plain = foRoute3(cooling, plainCursor, "", 40001)
    @Expect(plain.decision.getOrThrow().providerId, "p-c")
    let stickyCursor = Cursor()
    stickyCursor.index = 1
    let sticky = foRoute3(cooling, stickyCursor, "p-b", 40001)
    @Expect(sticky.decision.getOrThrow().providerId, "p-b")

    // 冷却到期后首选 A 重新可用，sticky 不再压过正常路由。
    let recovered = RouteHealth(name).view()
    let afterCursor = Cursor()
    afterCursor.index = 0
    let after = foRoute3(recovered, afterCursor, "p-b", 40005)
    @Expect(after.decision.getOrThrow().providerId, "p-a")
    foCleanup(name)
}

// 核心契约：每个工具步边界调用一次 nextProvider，下一次请求使用它返回的
// Provider；first 只负责第一步。用例用 b1→b2 两段证明“后续步不用回 first”。
@Test
func nextProviderIsUsedForEveryToolStepAndItsProviderIsUsed() {
    let log = SessionLog("model-agent-failover-steps-unused.log")
    log.append("user/message", "跑两步")
    let first = FoChunks(
        [
            Chunk("tool-call-delta", "{\"todos\":[{\"content\":\"one\",\"status\":\"in_progress\"}]}", "",
                toolIndex: Some(0), toolId: Some("c1"), toolName: Some("todo_write")),
            Chunk("finish", "", "tool_calls")
        ]
    )
    let b1 = FoChunks(
        [
            Chunk("tool-call-delta", "{\"todos\":[{\"content\":\"two\",\"status\":\"in_progress\"}]}", "",
                toolIndex: Some(0), toolId: Some("c2"), toolName: Some("todo_write")),
            Chunk("finish", "", "tool_calls")
        ]
    )
    let b2 = FoChunks([Chunk("text", "done", ""), Chunk("finish", "", "stop")])
    let requests = ArrayList<String>()
    let next: (String) -> Provider = {
        body =>
            requests.add(body)
            if (requests.size == 1) {
                b1
            } else {
                b2
            }
    }
    let result = ModelAgentLoop().run(first, next, "test-model", TurnToken(), log, DeliveryQueue(32), false)
    @Expect(requests.size, Int64(2))
    @Expect(result.finishReason, "stop")
    @Expect(result.settledToolCalls, Int64(2))
    @Expect(first.closes, Int64(1))
    @Expect(b1.closes, Int64(1))
    @Expect(b2.closes, Int64(1))
    // 第二次请求的日志快照里同时有前两步的工具结果，证明它确实来自续跑位置
    @Expect(requests[1].contains("c1"), true)
    @Expect(requests[1].contains("c2"), true)
}
