package core

import std.fs.*
import std.unittest.*

// 路由健康：熔断单位是**作用域**，三档按实际受影响范围选最窄的一档。
// 三档键里都没有品牌：同一供应商的两份实例各用自己的 credentialRef，
// 一份 401 只暂停那一份（号池的安全性质，断言 57）。
let rhFile = "core-test-route-health.log"

func rhCleanup(): Unit {
    for (f in [rhFile, "${rhFile}.lease"]) {
        if (exists(f)) {
            try { removeIfExists(f, recursive: false) } catch (e: Exception) {}
        }
    }
}

func rhScope(key: String, kind: String): RouteScope {
    return RouteScope(key, kind)
}

func rhFail(status: Int64, retryAfter: Int64): TransportFailure {
    return failureOf("http-status", true, status: status, retryAfterSeconds: retryAfter)
}

// 断言 5：第 3 次有效失败 → cooling 且 notBefore 非空；换实例读同一份日志仍在
@Test
func thirdEffectiveFailureCoolsAndSurvivesRestart() {
    rhCleanup()
    let h = RouteHealth(rhFile)
    let s = rhScope("step/m-a", "upstream")
    h.recordFailure(s, rhFail(500, -1), "effective", 5000)
    h.recordFailure(s, rhFail(500, -1), "effective", 5001)
    @Expect(RouteHealth(rhFile).stateOf("step/m-a").cooling, false)
    h.recordFailure(s, rhFail(500, -1), "effective", 5002)
    // 唯一证据是盘上那份日志：换新实例
    let after = RouteHealth(rhFile).stateOf("step/m-a")
    @Expect(after.cooling, true)
    @Expect(after.failures, Int64(3))
    @Expect(after.notBefore > Int64(5002), true)
    rhCleanup()
}

// 断言 6：额度类失败升档 route-set——同凭证另一模型也拦得住。
// 作用域键就是 credentialRef：换个模型名继续撞额度是必须堵住的行为。
@Test
func quotaFailurePausesTheWholeCredentialScope() {
    rhCleanup()
    let h = RouteHealth(rhFile)
    let cred = rhScope("SA_CODE_STEP_API_KEY", "route-set")
    h.recordFailure(cred, rhFail(429, -1), "effective", 6000)
    h.recordFailure(cred, rhFail(429, -1), "effective", 6001)
    h.recordFailure(cred, rhFail(429, -1), "effective", 6002)
    @Expect(RouteHealth(rhFile).isCooling("SA_CODE_STEP_API_KEY", 6003), true)
    // 按模型键查是另一条作用域：额度失败没有被记进 upstream 档，
    // 调度侧用 credentialRef 查，所以同凭证的其它模型一起被挡
    @Expect(RouteHealth(rhFile).isCooling("step/m-b", 6003), false)
    rhCleanup()
}

// 断言 7：供应商给了 Retry-After 就取该值；没给才走阶梯第一档（30 分钟）
@Test
func providerEvidenceBeatsTheBackoffLadder() {
    rhCleanup()
    let h = RouteHealth(rhFile)
    let s = rhScope("step/m-a", "upstream")
    h.recordFailure(s, rhFail(500, -1), "effective", 7000)
    h.recordFailure(s, rhFail(500, -1), "effective", 7001)
    h.recordFailure(s, rhFail(429, 17), "effective", 7002)
    @Expect(RouteHealth(rhFile).stateOf("step/m-a").notBefore, Int64(7019))
    // 无证据的作用域走阶梯：30 分钟
    let t = rhScope("step/m-b", "upstream")
    h.recordFailure(t, rhFail(500, -1), "effective", 8000)
    h.recordFailure(t, rhFail(500, -1), "effective", 8001)
    h.recordFailure(t, rhFail(500, -1), "effective", 8002)
    @Expect(RouteHealth(rhFile).stateOf("step/m-b").notBefore, Int64(8002 + 1800))
    rhCleanup()
}

// 断言 9：401/403 不消耗三次机会，但**立即**暂停该凭证作用域，且不入定时探测队列
// （要用户去修凭证，不是定时盲试）
@Test
func credentialFailureDoesNotBurnTheThreeStrikes() {
    rhCleanup()
    let h = RouteHealth(rhFile)
    let cred = rhScope("SA_CODE_STEP_API_KEY", "route-set")
    var i = Int64(0)
    while (i < 5) {
        h.recordFailure(cred, failureOf("credential", true, status: 401), "credential", 9000 + i)
        i += 1
    }
    let s = RouteHealth(rhFile).stateOf("SA_CODE_STEP_API_KEY")
    @Expect(s.failures, Int64(0))          // 不消耗三次机会
    @Expect(s.cooling, true)               // 但立即暂停
    // 定时探测队列里不该有它：凭证失效不是探测能解决的问题
    @Expect(RouteHealth(rhFile).probeDue(999999).size, Int64(0))
    rhCleanup()
}

// 断言 57：号池隔离——同一 baseUrl 两份实例，一份 cooling 不影响另一份
@Test
func oneInstanceCoolingDoesNotPoisonItsTwin() {
    rhCleanup()
    let h = RouteHealth(rhFile)
    let a = rhScope("SA_CODE_A_API_KEY", "route-set")
    var i = Int64(0)
    while (i < 3) {
        h.recordFailure(a, rhFail(429, -1), "effective", 10000 + i)
        i += 1
    }
    @Expect(RouteHealth(rhFile).isCooling("SA_CODE_A_API_KEY", 10003), true)
    @Expect(RouteHealth(rhFile).isCooling("SA_CODE_B_API_KEY", 10003), false)
    // 键里不含品牌与地址：按品牌/baseUrl 聚合会把「一把 key 挂了」放大成整池不可用
    let view = RouteHealth(rhFile).view()
    for (st in view.states) {
        @Expect(st.key.contains("example.com"), false)
        @Expect(st.key == "step" || st.key == "StepFun", false)
    }
    rhCleanup()
}

// 断言 38：落盘的是墙钟且被 maxHorizon 裁剪；超界另记一条「恢复时刻已裁剪」
@Test
func persistedDeadlinesAreWallClockAndClamped() {
    rhCleanup()
    let h = RouteHealth(rhFile)
    let s = rhScope("step/m-a", "upstream")
    // 供应商给 3 天：必须裁到 24h，并如实标「估算」
    h.recordFailure(s, rhFail(500, -1), "effective", 11000)
    h.recordFailure(s, rhFail(500, -1), "effective", 11001)
    h.recordFailure(s, rhFail(429, 259200), "effective", 11002)
    let st = RouteHealth(rhFile).stateOf("step/m-a")
    @Expect(st.notBefore <= Int64(11002 + 86400), true)
    @Expect(st.clamped, true)
    rhCleanup()
}

// 断言 37/38：时钟往回拨**不得延长**冷却——读侧以「本机见过的最大时间戳」为下界
@Test
func clockRollbackShortensRatherThanExtends() {
    rhCleanup()
    let h = RouteHealth(rhFile)
    let s = rhScope("step/m-a", "upstream")
    h.recordFailure(s, rhFail(500, -1), "effective", 12000)
    h.recordFailure(s, rhFail(500, -1), "effective", 12001)
    h.recordFailure(s, rhFail(500, -1), "effective", 12002)
    let st = RouteHealth(rhFile).stateOf("step/m-a")
    @Expect(st.notBefore, Int64(12002 + 1800))
    // 回拨到 100：水位仍是 12002，冷却既没被延长也没被错误解除
    @Expect(RouteHealth(rhFile).isCooling("step/m-a", 100), true)
    @Expect(RouteHealth(rhFile).isCooling("step/m-a", 14000), false)
    rhCleanup()
}

// 水位真正的作用：冷却**到期之后**把时钟往回拨，不得让它复活。
// 这条能区分「有水位」与「没有水位」——先让水位越过 notBefore，再回拨。
// 注意水位是**全局**的、冷却状态是**个体**的：用另一条作用域的事件推水位，
// 才既能越过 notBefore 又不触碰被测作用域的冷却状态。
@Test
func rollbackAfterExpiryDoesNotResurrectTheCooldown() {
    rhCleanup()
    let h = RouteHealth(rhFile)
    let s = rhScope("step/m-a", "upstream")
    h.recordFailure(s, rhFail(500, -1), "effective", 12000)
    h.recordFailure(s, rhFail(500, -1), "effective", 12001)
    h.recordFailure(s, rhFail(500, -1), "effective", 12002)
    @Expect(RouteHealth(rhFile).stateOf("step/m-a").notBefore, Int64(12002 + 1800))
    // 另一条作用域在 14000 发生了一次失败：水位随之推到 14000（冷却已到期），
    // 但被测作用域的 cooling 状态不受影响
    h.recordFailure(rhScope("step/m-z", "upstream"), rhFail(500, -1), "effective", 14000)
    @Expect(RouteHealth(rhFile).isCooling("step/m-a", 14000), false)
    // 现在回拨到 13000：没有水位的话 13000 < 13802 会让冷却「复活」，
    // 于是用户可以靠改时钟把一条已经恢复的路由重新冻住
    @Expect(RouteHealth(rhFile).isCooling("step/m-a", 13000), false)
    rhCleanup()
}

// 成功不清零累计失败数，但恢复正常调度；累计数只做展示与归因
@Test
func successRestoresSchedulingWithoutClearingTheCount() {
    rhCleanup()
    let h = RouteHealth(rhFile)
    let s = rhScope("step/m-a", "upstream")
    var i = Int64(0)
    while (i < 3) {
        h.recordFailure(s, rhFail(500, -1), "effective", 13000 + i)
        i += 1
    }
    @Expect(RouteHealth(rhFile).isCooling("step/m-a", 13003), true)
    h.recordSuccess(s, 13010)
    let st = RouteHealth(rhFile).stateOf("step/m-a")
    @Expect(st.cooling, false)
    @Expect(st.failures, Int64(3))   // 不清零
    @Expect(RouteHealth(rhFile).isCooling("step/m-a", 13011), false)
    rhCleanup()
}

// 断言 32：凭据轮转（revision 变大）后该作用域**立即**重新纳入候选，不等冷却窗口
@Test
func credentialRotationReopensTheScopeImmediately() {
    rhCleanup()
    let h = RouteHealth(rhFile)
    let cred = rhScope("SA_CODE_STEP_API_KEY", "route-set")
    h.recordFailure(cred, failureOf("credential", true, status: 401), "credential", 14000)
    @Expect(RouteHealth(rhFile).isCooling("SA_CODE_STEP_API_KEY", 14001), true)
    h.noteCredentialRotated("SA_CODE_STEP_API_KEY", 2, 14002)
    @Expect(RouteHealth(rhFile).isCooling("SA_CODE_STEP_API_KEY", 14003), false)
    rhCleanup()
}
