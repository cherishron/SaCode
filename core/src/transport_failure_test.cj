package core

import std.unittest.*

// 失败对象要带得出「请求是否已上线」这一维：同是 transport，
// 连接被拒/DNS/TLS 握手失败是「未上线」，读超时与半身后断是「已上线」——
// 缺这一维时 §6 交给 TransportChannel 的重发白名单只能靠错误文案猜。
@Test
func reachedUpstreamIsAnInputNotADerivation() {
    let refused = failureOf("transport", false, summary: "connection-refused")
    let half = failureOf("transport", true, summary: "read-timeout-after-headers")
    @Expect(refused.reachedUpstream, false)
    @Expect(half.reachedUpstream, true)
    // 两者 kind 同名，这一维必须来自调用点的证据，不能由 kind 反推
    @Expect(refused.kind, half.kind)
}

@Test
func onlyWhitelistedHeadersSurvive() {
    let kept = whitelistedHeaders([("Content-Type", "application/json"), ("Retry-After", "17"),
        ("X-RateLimit-Reset", "1730000000"), ("Set-Cookie", "session=abc")])
    @Expect(kept.size, Int64(2))
    var sawRetry = false
    for (kv in kept) {
        if (kv[0].toAsciiLower() == "retry-after") { sawRetry = true }
        // Cookie 与内容类型都不该出现在重试判据里
        @Expect(kv[0].toAsciiLower() == "set-cookie", false)
    }
    @Expect(sawRetry, true)
}

@Test
func retryAfterAcceptsSecondsAndRejectsTheUnknown() {
    @Expect(parseRetryAfterSeconds("17", 1000), Int64(17))
    // 认不出的形态回 -1（不猜、也不当成 0 秒）
    @Expect(parseRetryAfterSeconds("not-a-date", 1000), Int64(-1))
    @Expect(parseRetryAfterSeconds("", 1000), Int64(-1))
}

@Test
func errorBodyNeverEntersTheLogVerbatim() {
    let (len, summary) = redactBody("{\"error\":{\"message\":\"bad key sk-abcdef123456\"}}")
    @Expect(len > Int64(0), true)
    @Expect(summary.contains("sk-abcdef123456"), false)
    @Expect(summary.size <= Int64(80), true)
}

// 断言 53：429 且**响应头里真有** Retry-After 时，结构化失败必须带得出该值。
// 这条走真实网络夹具（不是常量注入）——夹具路由见 scripts/sse-contract-server.cjs 的 quota。
@Test
func quotaFailureCarriesRetryAfterFromTheRealHeader() {
    withSseNetwork({ base, secure =>
        let quota = RealSseProvider.open("${base}/quota", "fixture-only", "{}", TurnToken())
        @Expect(quota.provider.isNone(), true)
        let f = quota.failure.getOrThrow()
        @Expect(f.status, Int64(429))
        @Expect(f.retryAfterSeconds, Int64(42))
        // 请求字节确实进了线路：这是 5xx/4xx 与「连接被拒」的分档依据
        @Expect(f.reachedUpstream, true)
        // 头里没有时是 -1（未知），不是 0——0 会被读成「立刻可重试」
        let plain = RealSseProvider.open("${base}/500", "fixture-only", "{}", TurnToken())
        @Expect(plain.provider.isNone(), true)
        @Expect(plain.failure.getOrThrow().retryAfterSeconds, Int64(-1))
        // 构造器路径的旧契约不变：message 形态照旧
        var message = ""
        try {
            RealSseProvider("${base}/500", "fixture-only", "{}", TurnToken())
        } catch (e: Exception) {
            message = e.message
        }
        @Expect(message, "http-status:500")
    })
}

// 纯函数面：从头对里取值（不经过网络），未知头必须回 -1
@Test
func retryAfterComesFromTheHeaderNotAConstant() {
    let headers = whitelistedHeaders([("Retry-After", "42"), ("Content-Length", "10")])
    let f = failureOf("http-status", true, status: 429,
        retryAfterSeconds: retryAfterFromHeaders(headers, 0), summary: "http-status:429")
    @Expect(f.status, Int64(429))
    @Expect(f.retryAfterSeconds, Int64(42))
    // 头里没有时必须是 -1（未知），不是 0（那会被读成「立刻可重试」）
    let bare = failureOf("http-status", true, status: 500,
        retryAfterSeconds: retryAfterFromHeaders(whitelistedHeaders([]), 0), summary: "http-status:500")
    @Expect(bare.retryAfterSeconds, Int64(-1))
}
