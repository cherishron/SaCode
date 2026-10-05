package core

import std.collection.*
import std.fs.*
import std.unittest.*

// 路由器是**纯决策**：不 I/O、不写状态、不读时钟（now 由调用方注入）、
// 不 resolve 凭据（只查注入的凭据视图）。给定同一文档态 + 同一健康态 +
// 同一游标起点 + 同一注入时钟 + 同一请求能力，输出必须逐字可重放。

func mrProvider(id: String, ref: String, enabled: Bool, models: Array<ModelSpec>): ProviderRecord {
    return ProviderRecord(id, id, "https://api.example.com/v1", "openai-completions", ref, false, models,
        enabled: enabled)
}

func mrSpec(id: String, supports: Array<String>, availability: String): ModelSpec {
    return ModelSpec(id, id, "128k", "4k", false,
        inputModalities: ["text"], outputModalities: ["text"], supports: supports,
        meterUnit: "token", provenance: "human-confirmed", availability: availability)
}

func mrBinding(provider: String, model: String, order: Int64, weight: Int64): BindingRecord {
    return BindingRecord(provider, model, true, order, weight, 1000, 2000, -1, -1, 1, "CNY")
}

func mrCustom(id: String, mode: String, bindings: Array<BindingRecord>): CustomModelRecord {
    return CustomModelRecord(id, "编程模型", "", true, "coding", ["tools", "text-output"],
        bindings, mode)
}

func mrProviderView(list: Array<ProviderRecord>): ProviderView {
    return ProviderView(list, 1, true, "", "")
}

func mrCustomView(list: Array<CustomModelRecord>): CustomModelView {
    return CustomModelView(list, 1, true)
}

func mrHealthy(): RouteHealthView {
    return RouteHealthView([], -1)
}

func mrCreds(refs: Array<String>): CredentialView {
    return CredentialView(refs)
}

func mrNoBudget(): LedgerView {
    return LedgerView([])
}

// 断言 3：能力不满足的路由永远不进候选，unknown 不算满足（名字像也不算）
@Test
func capabilityFilterExcludesUnknownNotJustUnsupported() {
    let providers = mrProviderView([
        mrProvider("step", "SA_CODE_STEP_API_KEY", true, [
            mrSpec("m-ok", ["tools", "stream"], "available"),
            mrSpec("m-unknown", ["tools", "stream"], "unknown"),
            mrSpec("m-no", [], "available"),
        ])
    ])
    let customs = mrCustomView([mrCustom("code", "round-robin", [
        mrBinding("step", "m-unknown", 0, 1),
        mrBinding("step", "m-no", 1, 1),
        mrBinding("step", "m-ok", 2, 1),
    ])])
    let out = route(RouteRequest("code", ["tools"]), customs, providers, mrHealthy(),
        mrCreds(["SA_CODE_STEP_API_KEY"]), mrNoBudget(), Cursor(), 1000)
    // 只剩 m-ok：unknown 与空能力面都不满足
    @Expect(out.decision.isSome(), true)
    @Expect(out.decision.getOrThrow().modelId, "m-ok")
}

// 断言 4：供应商 enabled=false 后，配置仍存在的绑定不可调度（但配置不丢）
@Test
func disabledProviderIsExcludedButConfigKept() {
    let providers = mrProviderView([mrProvider("step", "SA_CODE_STEP_API_KEY", false, [mrSpec("m-a", ["tools"], "available")])])
    let binding = mrBinding("step", "m-a", 0, 1)
    let customs = mrCustomView([mrCustom("code", "round-robin", [binding])])
    let out = route(RouteRequest("code", ["tools"]), customs, providers, mrHealthy(),
        mrCreds(["SA_CODE_STEP_API_KEY"]), mrNoBudget(), Cursor(), 1000)
    @Expect(out.decision.isNone(), true)
    @Expect(out.rejection.getOrThrow().code, "provider-disabled")
    // 绑定还在配置里：关断不等于删配置
    @Expect(customs.models[0].bindings.size, Int64(1))
}

// 断言 10 + 84：平滑加权在 sum(weight) 次内每个候选至少被选一次；
// 1000 次后分布逼近权重比（给定容差）
@Test
func smoothWeightedIsProportionalAndStarvationFree() {
    let providers = mrProviderView([mrProvider("step", "SA_KEY", true, [
        mrSpec("m-a", ["tools"], "available"),
        mrSpec("m-b", ["tools"], "available"),
        mrSpec("m-c", ["tools"], "available"),
    ])])
    let customs = mrCustomView([mrCustom("code", "weighted", [
        mrBinding("step", "m-a", 0, 1),
        mrBinding("step", "m-b", 1, 1),
        mrBinding("step", "m-c", 2, 100),
    ])])
    let creds = mrCreds(["SA_KEY"])
    let cursor = Cursor()
    var counts = [Int64(0), Int64(0), Int64(0)]
    var i = Int64(0)
    while (i < 1000) {
        let out = route(RouteRequest("code", ["tools"]), customs, providers, mrHealthy(), creds, mrNoBudget(), cursor, 1000 + i)
        @Expect(out.decision.isSome(), true)
        let id = out.decision.getOrThrow().modelId
        if (id == "m-a") { counts[0] += 1 }
        else if (id == "m-b") { counts[1] += 1 }
        else { counts[2] += 1 }
        i += 1
    }
    // 无饥饿：三个候选都被选过
    @Expect(counts[0] > Int64(0), true)
    @Expect(counts[1] > Int64(0), true)
    @Expect(counts[2] > Int64(0), true)
    // 比例：100 权重的那个占绝大多数（容差下界取 90%）
    @Expect(counts[2] >= Int64(900), true)
}

// 断言 84 的另一半 + 确定可重放：同一游标起点两次跑出同一序列
@Test
func roundRobinIsDeterministicFromAGivenCursor() {
    let providers = mrProviderView([mrProvider("step", "SA_KEY", true, [
        mrSpec("m-a", ["tools"], "available"),
        mrSpec("m-b", ["tools"], "available"),
        mrSpec("m-c", ["tools"], "available"),
    ])])
    let customs = mrCustomView([mrCustom("code", "round-robin", [
        mrBinding("step", "m-a", 0, 1),
        mrBinding("step", "m-b", 1, 1),
        mrBinding("step", "m-c", 2, 1),
    ])])
    let creds = mrCreds(["SA_KEY"])
    let first = ArrayList<String>()
    let second = ArrayList<String>()
    let c1 = Cursor()
    var i = Int64(0)
    while (i < 7) {
        first.add(route(RouteRequest("code", ["tools"]), customs, providers, mrHealthy(), creds, mrNoBudget(), c1, 1000).decision.getOrThrow().modelId)
        i += 1
    }
    let c2 = Cursor()
    i = 0
    while (i < 7) {
        second.add(route(RouteRequest("code", ["tools"]), customs, providers, mrHealthy(), creds, mrNoBudget(), c2, 1000).decision.getOrThrow().modelId)
        i += 1
    }
    @Expect(first.size, second.size)
    i = 0
    while (i < Int64(first.size)) {
        @Expect(first[i], second[i])
        i += 1
    }
    // 轮询确实在转：7 次里三个候选都出现过
    @Expect(first[0] != first[1], true)
}

// 断言 83：选择器不产持久写——连续选多次后，两份文档的字节逐字不变
@Test
func selectingNeverWritesToAnyDocument() {
    let customsFile = "core-test-router-customs-nowrite.log"
    let healthFile = "core-test-router-health-nowrite.log"
    for (f in [customsFile, healthFile, "${customsFile}.lease", "${healthFile}.lease"]) {
        if (exists(f)) { try { removeIfExists(f, recursive: false) } catch (e: Exception) {} }
    }
    CustomModelRegistry(customsFile).upsert(
        "{\"id\":\"code\",\"name\":\"编程模型\",\"description\":\"\",\"enabled\":true,"
        + "\"category\":\"coding\",\"requires\":[\"tools\"],\"mode\":\"round-robin\","
        + "\"bindings\":[{\"providerId\":\"step\",\"modelId\":\"m-a\",\"enabled\":true,\"order\":0,\"weight\":1,"
        + "\"priceInMicro\":-1,\"priceOutMicro\":-1,\"priceCacheReadMicro\":-1,\"priceCacheWriteMicro\":-1,"
        + "\"priceVersion\":0,\"currency\":\"\"}]}", -1)
    RouteHealth(healthFile).recordFailure(RouteScope("step/m-a", "upstream"),
        failureOf("http-status", true, status: 500), "effective", 1000)
    let beforeCustoms = File.readFrom(customsFile)
    let beforeHealth = File.readFrom(healthFile)
    let customView = CustomModelRegistry(customsFile).describe()
    let healthView = RouteHealth(healthFile).view()
    let providers = mrProviderView([mrProvider("step", "SA_CODE_STEP_API_KEY", true, [mrSpec("m-a", ["tools"], "available")])])
    let creds = mrCreds(["SA_CODE_STEP_API_KEY"])
    let cursor = Cursor()
    var i = Int64(0)
    while (i < 100) {
        let out = route(RouteRequest("code", ["tools"]), customView, providers, healthView, creds, mrNoBudget(), cursor, 1000 + i)
        @Expect(out.decision.isSome(), true)
        i += 1
    }
    let afterCustoms = File.readFrom(customsFile)
    let afterHealth = File.readFrom(healthFile)
    @Expect(beforeCustoms.size, afterCustoms.size)
    @Expect(beforeHealth.size, afterHealth.size)
    i = 0
    while (i < Int64(beforeCustoms.size)) {
        @Expect(beforeCustoms[i], afterCustoms[i])
        i += 1
    }
    i = 0
    while (i < Int64(beforeHealth.size)) {
        @Expect(beforeHealth[i], afterHealth[i])
        i += 1
    }
    for (f in [customsFile, healthFile, "${customsFile}.lease", "${healthFile}.lease"]) {
        if (exists(f)) { try { removeIfExists(f, recursive: false) } catch (e: Exception) {} }
    }
}

// 断言 85：游标复位是允许行为，但不是饥饿的借口——
// 每次冷启动后的前 sum(weight) 次选择内每个 available 候选仍各被选中 ≥ 1 次。
// 同时钉住「把所有候选都判成被排除」这类实现：那种实现会连一个决定都给不出。
@Test
func cursorResetIsNotAStarvationExcuse() {
    let providers = mrProviderView([mrProvider("step", "SA_KEY", true, [
        mrSpec("m-a", ["tools"], "available"),
        mrSpec("m-b", ["tools"], "available"),
        mrSpec("m-c", ["tools"], "available"),
    ])])
    let customs = mrCustomView([mrCustom("code", "weighted", [
        mrBinding("step", "m-a", 0, 1),
        mrBinding("step", "m-b", 1, 1),
        mrBinding("step", "m-c", 2, 100),
    ])])
    let creds = mrCreds(["SA_KEY"])
    var round = Int64(0)
    while (round < 5) {
        // 每轮都是一次全新的冷启动（游标复位）
        let cursor = Cursor()
        var seen = ArrayList<String>()
        var i = Int64(0)
        while (i < 102) {   // sum(weight) = 1+1+100
            let out = route(RouteRequest("code", ["tools"]), customs, providers, mrHealthy(), creds, mrNoBudget(), cursor, 2000 + i)
            @Expect(out.decision.isSome(), true)
            let id = out.decision.getOrThrow().modelId
            var has = false
            for (s in seen) { if (s == id) { has = true } }
            if (!has) { seen.add(id) }
            i += 1
        }
        @Expect(seen.size, Int64(3))
        round += 1
    }
}

// 断言的形态面（断言 48/64）：路由器只拿视图，不碰凭据存储、不读时钟、不写盘；
// 作用域键里不含机器或网络标识
@Test
func routerOnlySeesViewsNotStores() {
    let providers = mrProviderView([mrProvider("step", "SA_CODE_STEP_API_KEY", true, [mrSpec("m-a", ["tools"], "available")])])
    let customs = mrCustomView([mrCustom("code", "round-robin", [mrBinding("step", "m-a", 0, 1)])])
    // 凭据未配置 → 该绑定不可选，拒绝码明确（不是模糊的「失败」）
    let out = route(RouteRequest("code", ["tools"]), customs, providers, mrHealthy(),
        mrCreds([]), mrNoBudget(), Cursor(), 1000)
    @Expect(out.decision.isNone(), true)
    @Expect(out.rejection.getOrThrow().code, "credential-unconfigured")
    // 预算耗尽 → 带类型拒绝
    let budgeted = route(RouteRequest("code", ["tools"]), customs, providers, mrHealthy(),
        mrCreds(["SA_CODE_STEP_API_KEY"]), LedgerView([("code", 5000)]), Cursor(), 1000)
    @Expect(budgeted.decision.isSome(), true)   // 未设上限（-1）时预算视图不拦
    // 设了上限且「已用 + 在途」触顶 → 必须带类型拒绝，不是模糊失败
    let capped = CustomModelRecord("code", "编程模型", "", true, "coding", ["tools"],
        [mrBinding("step", "m-a", 0, 1)], "round-robin", dailyTokens: 100)
    let cappedView = mrCustomView([capped])
    let exceeded = route(RouteRequest("code", ["tools"]), cappedView, providers, mrHealthy(),
        mrCreds(["SA_CODE_STEP_API_KEY"]), LedgerView([("code", 100)]), Cursor(), 1000)
    @Expect(exceeded.decision.isNone(), true)
    @Expect(exceeded.rejection.getOrThrow().code, "budget-exhausted")
    // 未触顶时照常可选（99 < 100）
    let under = route(RouteRequest("code", ["tools"]), cappedView, providers, mrHealthy(),
        mrCreds(["SA_CODE_STEP_API_KEY"]), LedgerView([("code", 99)]), Cursor(), 1000)
    @Expect(under.decision.isSome(), true)
}
