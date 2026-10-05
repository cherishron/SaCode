package core

import std.collection.*
import std.fs.*
import stdx.encoding.json.*

// 路由健康：熔断单位是**作用域**，不是「当天累计三次就停到次日」。
//
// 三档作用域（按实际受影响范围选最窄的一档）：
//   upstream   —— providerId + modelId：模型自身故障
//   route-set  —— credentialRef：额度/限流/凭证失效是按凭证或账户给的，
//                 换自定义模型也不能绕过（堵住「换个模型名继续撞额度」）
//   channel    —— transport + relaySlug：线路故障，不计入模型三次失败
//
// **三档键里都没有品牌与 baseUrl**：同一供应商的两份实例各用自己的 credentialRef，
// 一份挂了只暂停那一份——按 name/baseUrl 聚合会把「一把 key 挂了」放大成整池不可用。
//
// 持久化纪律：落盘的 notBefore/下次探测时刻只能是**墙钟 epoch 秒**。
// 单调钟每进程各有一套零点，把单调值写进日志对宿主之外的读者等于写了个随机数。
// 墙钟不可信，所以另加两道护栏：写入值与写入时刻之差 clamp 到 maxHorizon；
// 读侧维护「本机见过的最大时间戳」作为现在下界，把系统时钟往回拨只会让冷却更早到期。

public class RouteScope {
    public let key: String
    public let kind: String   // upstream | route-set | channel
    public init(key: String, kind: String) {
        this.key = key
        this.kind = kind
    }
}

public class ScopeState {
    public let key: String
    public let kind: String
    public let failures: Int64
    public let cooling: Bool
    public let notBefore: Int64
    public let level: Int64
    public let clamped: Bool
    public let lastCategory: String
    public let lastKind: String
    public let lastReachedUpstream: Bool
    public let lastSummary: String
    public init(key: String, kind: String, failures: Int64, cooling: Bool, notBefore: Int64,
        level: Int64, clamped: Bool, lastCategory: String, lastKind: String,
        lastReachedUpstream: Bool, lastSummary: String) {
        this.key = key
        this.kind = kind
        this.failures = failures
        this.cooling = cooling
        this.notBefore = notBefore
        this.level = level
        this.clamped = clamped
        this.lastCategory = lastCategory
        this.lastKind = lastKind
        this.lastReachedUpstream = lastReachedUpstream
        this.lastSummary = lastSummary
    }
}

public class RouteHealthView {
    public let states: Array<ScopeState>
    public let highWater: Int64
    public init(states: Array<ScopeState>, highWater: Int64) {
        this.states = states
        this.highWater = highWater
    }
}

// 退避阶梯：30min → 1h → 2h → 4h，同一作用域连续冷却逐档抬升，上限 4h（可配置）
let coolingLadder = [1800, 3600, 7200, 14400]
let cooldownMaxHorizon: Int64 = 86400
let coolingThreshold: Int64 = 3

public class RouteHealth {
    let file: String
    public init(file: String) {
        this.file = file
    }

    public static func forUser(): RouteHealth {
        let dir = Path(GlobalAppearanceSettings.forUser().settingsPath()).parent.toString()
        return RouteHealth("${dir}/route-health.log")
    }

    public func view(): RouteHealthView {
        let replay = replayEvents()
        return RouteHealthView(replay[0], replay[1])
    }

    public func stateOf(key: String): ScopeState {
        for (st in view().states) {
            if (st.key == key) { return st }
        }
        return ScopeState(key, "", 0, false, -1, 0, false, "", "", false, "")
    }

    // 冷却判定用「注入的 now」与读侧水位二者的大者：
    // 系统时钟被往回拨时，水位保证冷却不会被延长（也不会被错误解除）。
    public func isCooling(key: String, now: Int64): Bool {
        let effective = if (now > view().highWater) { now } else { view().highWater }
        for (st in view().states) {
            if (st.key == key && st.cooling) {
                return effective < st.notBefore
            }
        }
        return false
    }

    public func recordFailure(scope: RouteScope, failure: TransportFailure, category: String, now: Int64): Unit {
        let current = stateOf(scope.key)
        var failures = current.failures
        var cooling = current.cooling
        var level = current.level
        // 有效失败才累加；取消/本地拒绝/工具失败/归因不明都不进任何一档计数
        if (category == "effective") {
            failures += 1
            if (failures >= coolingThreshold) { cooling = true }
        } else if (category == "credential") {
            // 401/403：不消耗三次机会，但立即暂停该凭证作用域，且不做定时盲试
            cooling = true
        }
        var notBefore = current.notBefore
        var clamped = current.clamped
        if (cooling) {
            level += 1
            if (level > Int64(coolingLadder.size)) { level = Int64(coolingLadder.size) }
            var window = coolingLadder[level - 1]
            // 供应商证据优先：Retry-After 或额度重置时刻
            if (failure.retryAfterSeconds > 0) {
                window = failure.retryAfterSeconds
            } else if (failure.resetEpoch > 0) {
                window = failure.resetEpoch - now
            }
            if (window < 0) { window = 0 }
            clamped = false
            if (window > cooldownMaxHorizon) {
                window = cooldownMaxHorizon
                clamped = true
            }
            notBefore = now + window
        }
        let data = "{\"key\":\"${jsonEscapeText(scope.key)}\",\"kind\":\"${jsonEscapeText(scope.kind)}\","
            + "\"category\":\"${jsonEscapeText(category)}\",\"failures\":${failures},"
            + "\"cooling\":${boolText(cooling)},\"notBefore\":${notBefore},\"level\":${level},"
            + "\"clamped\":${boolText(clamped)},\"failureKind\":\"${jsonEscapeText(failure.kind)}\","
            + "\"reachedUpstream\":${boolText(failure.reachedUpstream)},"
            + "\"summary\":\"${jsonEscapeText(failure.summary)}\",\"epoch\":${now}}"
        appendEvent("route/failed", data)
    }

    // 成功不清零累计失败数，但恢复正常调度；累计数只做展示与归因
    public func recordSuccess(scope: RouteScope, now: Int64): Unit {
        appendEvent("route/recovered", "{\"key\":\"${jsonEscapeText(scope.key)}\",\"reason\":\"success\",\"epoch\":${now}}")
    }

    // 凭据轮转（revision 变大）：该作用域立即重新纳入候选，不等冷却窗口——
    // 这正是「改了密钥就该重试」那条缝的落地
    public func noteCredentialRotated(credentialRef: String, revision: Int64, now: Int64): Unit {
        appendEvent("route/recovered",
            "{\"key\":\"${jsonEscapeText(credentialRef)}\",\"reason\":\"credential-rotated\",\"revision\":${revision},\"epoch\":${now}}")
    }

    // 冷却到期且**不是凭证失效**的作用域才进探测队列：
    // 凭证失效要用户去修，定时盲试既烧钱又不会好
    public func probeDue(now: Int64): Array<RouteScope> {
        let v = view()
        let effective = if (now > v.highWater) { now } else { v.highWater }
        let out = ArrayList<RouteScope>()
        for (st in v.states) {
            if (!st.cooling) { continue }
            if (st.lastCategory == "credential") { continue }
            if (effective >= st.notBefore) { out.add(RouteScope(st.key, st.kind)) }
        }
        return out.toArray()
    }

    // 回放得到 [states, highWater]：水位 = 日志里见过的最大 epoch（单调不减）
    private func replayEvents(): (Array<ScopeState>, Int64) {
        let states = ArrayList<ScopeState>()
        var highWater: Int64 = -1
        if (!exists(file)) {
            return (states.toArray(), highWater)
        }
        let log = SessionLog(file)
        if (!log.load()) {
            throw Exception("route-health-replay-rejected")
        }
        for (ev in log.snapshotEvents()) {
            let epoch = intOfText(ev.data, "epoch")
            if (epoch > highWater) { highWater = epoch }
            if (ev.eventType == "route/failed") {
                let rec = ScopeState(fieldOfText(ev.data, "key"), fieldOfText(ev.data, "kind"),
                    intOfText(ev.data, "failures"), boolOfText(ev.data, "cooling"),
                    intOfText(ev.data, "notBefore"), intOfText(ev.data, "level"),
                    boolOfText(ev.data, "clamped"), fieldOfText(ev.data, "category"),
                    fieldOfText(ev.data, "failureKind"), boolOfText(ev.data, "reachedUpstream"),
                    fieldOfText(ev.data, "summary"))
                var replaced = false
                var i = Int64(0)
                while (i < Int64(states.size)) {
                    if (states[i].key == rec.key) { states[i] = rec; replaced = true }
                    i += 1
                }
                if (!replaced) { states.add(rec) }
            } else if (ev.eventType == "route/recovered") {
                let key = fieldOfText(ev.data, "key")
                var i = Int64(0)
                while (i < Int64(states.size)) {
                    if (states[i].key == key) {
                        let old = states[i]
                        // 保留累计失败数与档位：恢复调度不等于抹掉历史
                        states[i] = ScopeState(old.key, old.kind, old.failures, false, -1, old.level,
                            old.clamped, old.lastCategory, old.lastKind, old.lastReachedUpstream, old.lastSummary)
                    }
                    i += 1
                }
            }
        }
        return (states.toArray(), highWater)
    }

    private func appendEvent(eventType: String, data: String): Unit {
        let lease = WriteLease(file)
        if (!lease.takeoverIfStale()) {
            throw Exception("route-health-already-owned")
        }
        try {
            let log = SessionLog(file)
            if (exists(file) && !log.load()) {
                throw Exception("route-health-replay-rejected")
            }
            log.append(eventType, data)
            if (!log.flush()) {
                throw Exception("route-health-flush-failed")
            }
        } finally {
            lease.release()
        }
    }

    private static func boolText(v: Bool): String {
        return if (v) { "true" } else { "false" }
    }

    private static func fieldOfText(text: String, key: String): String {
        try {
            let obj = JsonValue.fromStr(text).asObject()
            if (let Some(v) <- obj.get(key)) {
                return v.asString().getValue()
            }
        } catch (e: Exception) {
            return ""
        }
        return ""
    }

    private static func intOfText(text: String, key: String): Int64 {
        try {
            let obj = JsonValue.fromStr(text).asObject()
            if (let Some(v) <- obj.get(key)) {
                return v.asInt().getValue()
            }
        } catch (e: Exception) {
            return -1
        }
        return -1
    }

    private static func boolOfText(text: String, key: String): Bool {
        try {
            let obj = JsonValue.fromStr(text).asObject()
            if (let Some(v) <- obj.get(key)) {
                return v.asBool().getValue()
            }
        } catch (e: Exception) {
            return false
        }
        return false
    }
}
