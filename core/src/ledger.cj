package core

import std.collection.*
import std.fs.*
import std.sync.*
import stdx.encoding.json.*

// B3 账本核心（§7.1/§7.2/§7.3）。用法与纪律：
//
// 1) 定点金额：Int64 微单位（1 货币单位 = 10^6 微单位）+ ISO 币种码。加法与乘法
//    全部显式查溢出，越界即拒绝结算并把该笔标「待核算」，绝不静默回绕。
//    上界 = Int64 最大值 / 10^6 ≈ 9.2234×10^12 货币单位。
// 2) 计价快照：结算把当时的四档费率与 priceVersion 写进账本条目；改价只影响之后的
//    请求，历史账单永不重算——二次结算交回首结论，不按当前价重算。
// 3) 尝试粒度：一笔账 = 一次上游尝试（attemptId），不是「一轮」。
// 4) 与 attempt_log.cj **同一个文件**（usage-ledger.log）、同一条租约写路径：
//    「取租约 → 回放本机账本 → 写一条 → 归还」。临界区只做本机文件读写，
//    不跨网络、不自己读时间（时间由调用方注入）；网络调用只允许出现在归还之后。
// 5) 维度计价：四档费率各自可 -1（未登记）。某维度**有用量**而未登记 → 该笔落
//    「待核算」，不用已登记维度反推，也不拿总量乘单一单价。
// 6) 作用域：键只有本机账本路径（同机 CLI 与桌面共用一本账，跨机器不共享）。
//    键里没有任何机器、设备或网络标识——本地累计不是账户余额。

// ===== 定点金额 =====

// 金额恒非负（负数只会在解析/展示的边界上被拒），因此 plus 只需查上溢与下溢两侧，
// 越界一律回 None，由调用方落「待核算」——绝不允许静默回绕。
public class LedgerMoney {
    public let micros: Int64
    public let currency: String

    public init(micros: Int64, currency: String) {
        this.micros = micros
        this.currency = currency
    }

    // 币种不同不许直接相加（同币种才可合计，跨币种要先有换算来源）
    public func plus(other: LedgerMoney): Option<LedgerMoney> {
        if (currency != other.currency) {
            return None
        }
        if (other.micros > 0 && micros > Int64.Max - other.micros) {
            return None
        }
        if (other.micros < 0 && micros < (0 - Int64.Max) - 1 - other.micros) {
            return None
        }
        return Some(LedgerMoney(micros + other.micros, currency))
    }

    public func isNegative(): Bool {
        return micros < 0
    }

    public func decimal(): String {
        return ledgerDecimalOf(micros)
    }

    public func text(): String {
        return "${ledgerDecimalOf(micros)} ${currency}"
    }
}

// 微单位 → 最小十进制：去掉尾零但不丢刻度（300000 → "0.3"，1 → "0.000001"）
public func ledgerDecimalOf(micros: Int64): String {
    if (micros < 0) {
        // 金额恒非负；负数只作展示兜底
        return "-${ledgerDecimalOf(0 - micros)}"
    }
    let whole = micros / 1000000
    var frac = micros % 1000000
    if (frac == 0) {
        return "${whole}"
    }
    var digits: Int64 = 6
    while (digits > 1 && frac % 10 == 0) {
        frac = frac / 10
        digits -= 1
    }
    var text = "${frac}"
    var pad = digits - Int64(text.size)
    while (pad > 0) {
        text = "0${text}"
        pad -= 1
    }
    return "${whole}.${text}"
}

// 十进制 → 微单位：只认非负、最多 6 位小数；更细的精度直接拒，不做静默舍入
public func ledgerMicrosOfDecimal(text: String): Option<Int64> {
    let bytes = text.toArray()
    if (bytes.size == 0) {
        return None
    }
    var whole: Int64 = 0
    var frac: Int64 = 0
    var fracDigits: Int64 = 0
    var seenDot = false
    var i: Int64 = 0
    while (i < Int64(bytes.size)) {
        let code = Int64(bytes[i])
        if (code == 46) {
            if (seenDot) {
                return None
            }
            seenDot = true
        } else if (code >= 48 && code <= 57) {
            let digit = code - 48
            if (seenDot) {
                if (fracDigits >= 6) {
                    return None
                }
                frac = frac * 10 + digit
                fracDigits += 1
            } else {
                if (whole > (Int64.Max - digit) / 10) {
                    return None
                }
                whole = whole * 10 + digit
            }
        } else {
            return None
        }
        i += 1
    }
    if (seenDot && fracDigits == 0) {
        return None
    }
    while (fracDigits < 6) {
        frac = frac * 10
        fracDigits += 1
    }
    if (whole > (Int64.Max - frac) / 1000000) {
        return None
    }
    return Some(whole * 1000000 + frac)
}

// ===== 计价与用量 =====

// 四档费率：-1 = 该维度未登记；>=0（含 0 = 明确零费率）才是已登记。
// 单位由该上游的 meterUnit 决定（token / 张 / 秒 / 请求 / 文档），费率是「每单位微元」。
public class RateCard {
    public let inputMicrosPerUnit: Int64
    public let outputMicrosPerUnit: Int64
    public let cacheReadMicrosPerUnit: Int64
    public let cacheWriteMicrosPerUnit: Int64
    public let currency: String
    public let priceVersion: String

    public init(inputMicrosPerUnit: Int64, outputMicrosPerUnit: Int64,
        cacheReadMicrosPerUnit: Int64, cacheWriteMicrosPerUnit: Int64,
        currency: String, priceVersion: String) {
        this.inputMicrosPerUnit = inputMicrosPerUnit
        this.outputMicrosPerUnit = outputMicrosPerUnit
        this.cacheReadMicrosPerUnit = cacheReadMicrosPerUnit
        this.cacheWriteMicrosPerUnit = cacheWriteMicrosPerUnit
        this.currency = currency
        this.priceVersion = priceVersion
    }

    public static func unpriced(currency: String, priceVersion: String): RateCard {
        return RateCard(-1, -1, -1, -1, currency, priceVersion)
    }

    func rateOf(dimension: String): Int64 {
        if (dimension == "input") {
            return inputMicrosPerUnit
        }
        if (dimension == "output") {
            return outputMicrosPerUnit
        }
        if (dimension == "cacheRead") {
            return cacheReadMicrosPerUnit
        }
        if (dimension == "cacheWrite") {
            return cacheWriteMicrosPerUnit
        }
        return -1
    }
}

// 分档用量：每一维 -1 = 上游没回该维度；0 是「上游回了零」，与「没回」不是一回事。
// meterSource：vendor（供应商 usage）/ local-estimate（本地按价推算）/ unknown（用量未知）。
public class LedgerUsage {
    public let input: Int64
    public let output: Int64
    public let cacheRead: Int64
    public let cacheWrite: Int64
    public let meterSource: String
    public let rawField: String

    public init(input: Int64, output: Int64, cacheRead: Int64, cacheWrite: Int64,
        meterSource: String, rawField!: String = "") {
        this.input = input
        this.output = output
        this.cacheRead = cacheRead
        this.cacheWrite = cacheWrite
        this.meterSource = meterSource
        this.rawField = rawField
    }

    // 缺 usage：四维全 -1，来源 unknown——不是零消费
    public static func absent(): LedgerUsage {
        return LedgerUsage(-1, -1, -1, -1, "unknown")
    }

    // 「上游回过至少一个维度」（哪怕是 0）
    public func hasReported(): Bool {
        return input >= 0 || output >= 0 || cacheRead >= 0 || cacheWrite >= 0
    }

    func usageOf(dimension: String): Int64 {
        if (dimension == "input") {
            return input
        }
        if (dimension == "output") {
            return output
        }
        if (dimension == "cacheRead") {
            return cacheRead
        }
        if (dimension == "cacheWrite") {
            return cacheWrite
        }
        return -1
    }
}

// 一次上游尝试的记账输入：attemptId 是账本粒度，logicalRequestId 只用于回溯。
public class AttemptAccounting {
    public let attemptId: String
    public let logicalRequestId: String
    public let usageKind: String
    public let customModelId: String
    public let providerId: String
    public let modelId: String
    public let session: String
    public let goal: String
    public let turn: String
    public let resultClass: String
    public let meterUnit: String
    public let startedEpoch: Int64
    public let endedEpoch: Int64
    public let durationMillis: Int64
    public let imageCount: Int64
    public let audioSeconds: Int64
    public let usage: LedgerUsage
    public let rates: RateCard

    public init(attemptId: String, usage: LedgerUsage, rates: RateCard,
        logicalRequestId!: String = "", usageKind!: String = "chat",
        customModelId!: String = "", providerId!: String = "", modelId!: String = "",
        session!: String = "", goal!: String = "", turn!: String = "",
        resultClass!: String = "", meterUnit!: String = "token",
        startedEpoch!: Int64 = 0, endedEpoch!: Int64 = 0, durationMillis!: Int64 = 0,
        imageCount!: Int64 = 0, audioSeconds!: Int64 = 0) {
        this.attemptId = attemptId
        this.logicalRequestId = logicalRequestId
        this.usageKind = usageKind
        this.customModelId = customModelId
        this.providerId = providerId
        this.modelId = modelId
        this.session = session
        this.goal = goal
        this.turn = turn
        this.resultClass = resultClass
        this.meterUnit = meterUnit
        this.startedEpoch = startedEpoch
        this.endedEpoch = endedEpoch
        this.durationMillis = durationMillis
        this.imageCount = imageCount
        this.audioSeconds = audioSeconds
        this.usage = usage
        this.rates = rates
    }
}

// 预留意图：预算是「已用 + 在途预留」不得突破的上限（调用方按模型额度传入）
public class ReserveIntent {
    public let attemptId: String
    public let reservedMicros: Int64
    public let currency: String
    public let logicalRequestId: String
    public let usageKind: String
    public let customModelId: String
    public let providerId: String
    public let modelId: String
    public let epoch: Int64

    public init(attemptId: String, reservedMicros: Int64, currency: String,
        logicalRequestId!: String = "", usageKind!: String = "chat",
        customModelId!: String = "", providerId!: String = "", modelId!: String = "",
        epoch!: Int64 = 0) {
        this.attemptId = attemptId
        this.reservedMicros = reservedMicros
        this.currency = currency
        this.logicalRequestId = logicalRequestId
        this.usageKind = usageKind
        this.customModelId = customModelId
        this.providerId = providerId
        this.modelId = modelId
        this.epoch = epoch
    }
}

public class LedgerDecision {
    public let accepted: Bool
    public let code: String
    public let reservedMicros: Int64
    public let usedMicros: Int64
    public let inFlightMicros: Int64

    public init(accepted: Bool, code: String, reservedMicros: Int64,
        usedMicros: Int64, inFlightMicros: Int64) {
        this.accepted = accepted
        this.code = code
        this.reservedMicros = reservedMicros
        this.usedMicros = usedMicros
        this.inFlightMicros = inFlightMicros
    }
}

// status: settled（已核算）/ unsettled（待核算）/ rejected（拒收，未产生账目）
// amountMicros: >=0 已核算金额；-1 = 未核算，绝不冒充零
public class SettleOutcome {
    public let status: String
    public let code: String
    public let amountMicros: Int64
    public let currency: String
    public let priceVersion: String
    public let meterSource: String
    public let idempotent: Bool

    public init(status: String, code: String, amountMicros: Int64, currency: String,
        priceVersion: String, meterSource: String, idempotent: Bool) {
        this.status = status
        this.code = code
        this.amountMicros = amountMicros
        this.currency = currency
        this.priceVersion = priceVersion
        this.meterSource = meterSource
        this.idempotent = idempotent
    }
}

public class CurrencyTotal {
    public let currency: String
    public let usedMicros: Int64
    public let inFlightMicros: Int64

    public init(currency: String, usedMicros: Int64, inFlightMicros: Int64) {
        this.currency = currency
        this.usedMicros = usedMicros
        this.inFlightMicros = inFlightMicros
    }
}

// 本地累计：按币种分列，不冒充余额、不跨币种合加
public class LedgerState {
    public let totals: Array<CurrencyTotal>

    public init(totals: Array<CurrencyTotal>) {
        this.totals = totals
    }

    public func localUsed(currency: String): Int64 {
        for (t in totals) {
            if (t.currency == currency) {
                return t.usedMicros
            }
        }
        return 0
    }

    public func localInFlight(currency: String): Int64 {
        for (t in totals) {
            if (t.currency == currency) {
                return t.inFlightMicros
            }
        }
        return 0
    }
}

// 分组统计条目：usageKind 分组用 key=usageKind；实例分组用 key=providerId + customModelId。
// 聚合时不许把实例维度抹掉——号池里要看得清「哪把 key 花了多少」。
public class UsageTotal {
    public let key: String
    public let customModelId: String
    public let currency: String
    public let usedMicros: Int64

    public init(key: String, customModelId: String, currency: String, usedMicros: Int64) {
        this.key = key
        this.customModelId = customModelId
        this.currency = currency
        this.usedMicros = usedMicros
    }
}

// ===== 事件回放 =====

let ledgerDimensions = ["input", "output", "cacheRead", "cacheWrite"]

func ledgerFieldText(data: String, key: String): String {
    try {
        let obj = JsonValue.fromStr(data).asObject()
        if (let Some(v) <- obj.get(key)) {
            return v.asString().getValue()
        }
    } catch (e: Exception) {
        return ""
    }
    return ""
}

func ledgerFieldInt(data: String, key: String): Int64 {
    try {
        let obj = JsonValue.fromStr(data).asObject()
        if (let Some(v) <- obj.get(key)) {
            return v.asInt().getValue()
        }
    } catch (e: Exception) {
        return -1
    }
    return -1
}

// 认不出的来源一律降级成 unknown：不许把没认出来的东西当成已知
func ledgerSourceOf(usage: LedgerUsage): String {
    if (!usage.hasReported()) {
        return "unknown"
    }
    if (usage.meterSource == "vendor" || usage.meterSource == "local-estimate" || usage.meterSource == "unknown") {
        return usage.meterSource
    }
    return "unknown"
}

// 有用量而未登记费率的第一个维度；没有则回 ""
func ledgerMissingRate(a: AttemptAccounting): String {
    for (dim in ledgerDimensions) {
        if (a.usage.usageOf(dim) > 0 && a.rates.rateOf(dim) < 0) {
            return "rate-unregistered:${dim}"
        }
    }
    return ""
}

// 分档计价：每维各自乘自己的费率再累加，两次运算都显式查溢出。
// 返回 None = 溢出，调用方据此落「待核算」而不是回绕或清零。
func ledgerAmountOf(a: AttemptAccounting): Option<Int64> {
    var total: Int64 = 0
    for (dim in ledgerDimensions) {
        let units = a.usage.usageOf(dim)
        if (units <= 0) {
            continue
        }
        let rate = a.rates.rateOf(dim)
        if (rate < 0) {
            return None
        }
        if (rate > 0 && units > Int64.Max / rate) {
            return None
        }
        let part = units * rate
        if (part > Int64.Max - total) {
            return None
        }
        total += part
    }
    return Some(total)
}

// 一次回放得到的账本视图（纯内存；不含任何跨机信息）
class LedgerSnapshot {
    let usedByCurrency = ArrayList<(String, Int64)>()
    // 第 4 位是 customModelId：预算挂在**模型**上（`dailyAmountMicro` 属于
    // CustomModelRecord），撤回在途时必须知道扣回哪个模型的在途。
    let liveReservations = ArrayList<(String, String, Int64, String)>()
    // 按模型 × 币种的在途预留聚合，与 `modelTotals`（已结算）配对
    let modelInFlight = ArrayList<(String, String, Int64)>()
    let finalEntries = ArrayList<(String, String)>()
    let results = ArrayList<(String, String)>()
    let refusals = ArrayList<(String, String)>()
    let voidedAttempts = ArrayList<String>()
    let unsettledList = ArrayList<String>()
    let dispatchedList = ArrayList<String>()
    let usageKindTotals = ArrayList<(String, String, Int64)>()
    let providerTotals = ArrayList<(String, String, String, Int64)>()
    let modelTotals = ArrayList<(String, String, Int64)>()
    var overflowed = false

    // 累加显式查溢出：越界置 overflowed，整份回放判不可信——不静默回绕
    private func bump(list: ArrayList<(String, Int64)>, key: String, delta: Int64): Unit {
        var i: Int64 = 0
        while (i < Int64(list.size)) {
            if (list[i][0] == key) {
                let old = list[i][1]
                if (delta > 0 && old > Int64.Max - delta) {
                    overflowed = true
                    return
                }
                list[i] = (key, old + delta)
                return
            }
            i += 1
        }
        list.add((key, delta))
    }

    func addUsed(currency: String, amount: Int64): Unit {
        if (amount < 0) {
            // 已结算事件里出现负金额 = 账本坏了，宁可不认
            overflowed = true
            return
        }
        bump(usedByCurrency, currency, amount)
    }

    func used(currency: String): Int64 {
        for (kv in usedByCurrency) {
            if (kv[0] == currency) {
                return kv[1]
            }
        }
        return 0
    }

    // 在途预留在途总量：查溢出时按不可表示的上界饱和，预算判定一律判超限（保守方向）
    func inFlight(currency: String): Int64 {
        var total: Int64 = 0
        for (r in liveReservations) {
            if (r[1] != currency) {
                continue
            }
            if (total > Int64.Max - r[2]) {
                return Int64.Max
            }
            total += r[2]
        }
        return total
    }

    func currencies(): ArrayList<String> {
        let out = ArrayList<String>()
        for (kv in usedByCurrency) {
            out.add(kv[0])
        }
        for (r in liveReservations) {
            var seen = false
            for (c in out) {
                if (c == r[1]) {
                    seen = true
                }
            }
            if (!seen) {
                out.add(r[1])
            }
        }
        return out
    }

    func addReservation(attemptId: String, currency: String, amount: Int64, customModelId: String): Unit {
        if (let Some(old) <- liveReservation(attemptId)) {
            // 重复预留事件：先撤回旧的模型在途，再记新的
            takeFromModelInFlight(old[3], old[1], old[2])
        }
        liveReservations.add((attemptId, currency, amount, customModelId))
        bumpModelInFlight(customModelId, currency, amount)
    }

    // 撤回在途预留：先从 liveReservations 找出该 attempt 的模型维度，
    // 再递减模型聚合——否则 `modelInFlight` 会越攒越大，预算判据失真。
    func removeReservation(attemptId: String): Unit {
        var i: Int64 = 0
        while (i < Int64(liveReservations.size)) {
            if (liveReservations[i][0] == attemptId) {
                takeFromModelInFlight(liveReservations[i][3], liveReservations[i][1], liveReservations[i][2])
                liveReservations.remove(i..(i + 1))
                return
            }
            i += 1
        }
    }

    func liveReservation(attemptId: String): Option<(String, String, Int64, String)> {
        for (r in liveReservations) {
            if (r[0] == attemptId) {
                return Some(r)
            }
        }
        return None
    }

    // 某模型在某币种下的已结算金额（预算判据的「已用」半）
    func usedForModel(customModelId: String, currency: String): Int64 {
        if (customModelId.size == 0) { return 0 }
        for (kv in modelTotals) {
            if (kv[0] == customModelId && kv[1] == currency) { return kv[2] }
        }
        return 0
    }

    // 某模型在某币种下的在途预留总量（预算判据的「在途」半）
    func inFlightForModel(customModelId: String, currency: String): Int64 {
        if (customModelId.size == 0) { return 0 }
        for (kv in modelInFlight) {
            if (kv[0] == customModelId && kv[1] == currency) { return kv[2] }
        }
        return 0
    }

    private func bumpModelInFlight(customModelId: String, currency: String, amount: Int64): Unit {
        if (customModelId.size == 0) { return }
        var i: Int64 = 0
        while (i < Int64(modelInFlight.size)) {
            if (modelInFlight[i][0] == customModelId && modelInFlight[i][1] == currency) {
                let old = modelInFlight[i][2]
                if (amount > 0 && old > Int64.Max - amount) { overflowed = true; return }
                modelInFlight[i] = (customModelId, currency, old + amount)
                return
            }
            i += 1
        }
        modelInFlight.add((customModelId, currency, amount))
    }

    private func takeFromModelInFlight(customModelId: String, currency: String, amount: Int64): Unit {
        if (customModelId.size == 0) { return }
        var i: Int64 = 0
        while (i < Int64(modelInFlight.size)) {
            if (modelInFlight[i][0] == customModelId && modelInFlight[i][1] == currency) {
                let old = modelInFlight[i][2]
                if (amount > old) { overflowed = true; return }
                if (old - amount == 0) {
                    modelInFlight.remove(i..(i + 1))
                } else {
                    modelInFlight[i] = (customModelId, currency, old - amount)
                }
                return
            }
            i += 1
        }
    }

    func setFinal(attemptId: String, result: String, data: String): Unit {
        var replaced = false
        var i: Int64 = 0
        while (i < Int64(finalEntries.size)) {
            if (finalEntries[i][0] == attemptId) {
                finalEntries[i] = (attemptId, data)
                results[i] = (attemptId, result)
                replaced = true
            }
            i += 1
        }
        if (!replaced) {
            finalEntries.add((attemptId, data))
            results.add((attemptId, result))
        }
    }

    func hasFinal(attemptId: String): Bool {
        return finalEntry(attemptId).isSome()
    }

    func finalEntry(attemptId: String): Option<String> {
        for (kv in finalEntries) {
            if (kv[0] == attemptId) {
                return Some(kv[1])
            }
        }
        return None
    }

    func addRefusal(attemptId: String, data: String): Unit {
        refusals.add((attemptId, data))
    }

    func refusal(attemptId: String): Option<String> {
        for (kv in refusals) {
            if (kv[0] == attemptId) {
                return Some(kv[1])
            }
        }
        return None
    }

    func addVoided(attemptId: String): Unit {
        for (id in voidedAttempts) {
            if (id == attemptId) {
                return
            }
        }
        voidedAttempts.add(attemptId)
    }

    func isVoided(attemptId: String): Bool {
        for (id in voidedAttempts) {
            if (id == attemptId) {
                return true
            }
        }
        return false
    }

    func markUnsettled(attemptId: String): Unit {
        for (id in unsettledList) {
            if (id == attemptId) {
                return
            }
        }
        unsettledList.add(attemptId)
    }

    func addDispatched(attemptId: String): Unit {
        if (attemptId.size == 0) {
            return
        }
        for (id in dispatchedList) {
            if (id == attemptId) {
                return
            }
        }
        dispatchedList.add(attemptId)
    }

    // 未结算的已派发尝试：崩溃恢复要靠它认出「可能已送达但没记账」的那几笔
    func dispatchedUnsettled(): ArrayList<String> {
        let out = ArrayList<String>()
        for (id in dispatchedList) {
            if (!hasFinal(id) && !isVoided(id)) {
                out.add(id)
            }
        }
        return out
    }

    func addUsageKind(usageKind: String, currency: String, amount: Int64): Unit {
        if (usageKind.size == 0) {
            return
        }
        bumpKeyed(usageKindTotals, usageKind, currency, amount)
    }

    func addProvider(providerId: String, customModelId: String, currency: String, amount: Int64): Unit {
        if (providerId.size == 0) {
            return
        }
        var i: Int64 = 0
        while (i < Int64(providerTotals.size)) {
            if (providerTotals[i][0] == providerId && providerTotals[i][1] == customModelId
                && providerTotals[i][2] == currency) {
                providerTotals[i] = (providerId, customModelId, currency, providerTotals[i][3] + amount)
                return
            }
            i += 1
        }
        providerTotals.add((providerId, customModelId, currency, amount))
    }

    func addModel(customModelId: String, currency: String, amount: Int64): Unit {
        if (customModelId.size == 0) {
            return
        }
        bumpKeyed(modelTotals, customModelId, currency, amount)
    }

    private func bumpKeyed(list: ArrayList<(String, String, Int64)>, key: String,
        currency: String, amount: Int64): Unit {
        var i: Int64 = 0
        while (i < Int64(list.size)) {
            if (list[i][0] == key && list[i][1] == currency) {
                list[i] = (key, currency, list[i][2] + amount)
                return
            }
            i += 1
        }
        list.add((key, currency, amount))
    }
}

// 从事件序列回放。返回 None = 回放不出可信账本（缺帧/累计越界），写路径一律拒绝。
func ledgerReplay(events: ArrayList<SessionEvent>): Option<LedgerSnapshot> {
    let snap = LedgerSnapshot()
    for (ev in events) {
        let kind = ev.eventType
        if (kind == "ledger/reserved") {
            snap.addReservation(ledgerFieldText(ev.data, "attemptId"),
                ledgerFieldText(ev.data, "currency"), ledgerFieldInt(ev.data, "reservedMicros"),
                ledgerFieldText(ev.data, "customModelId"))
        } else if (kind == "ledger/settled") {
            let id = ledgerFieldText(ev.data, "attemptId")
            snap.removeReservation(id)
            let amount = ledgerFieldInt(ev.data, "amountMicros")
            let currency = ledgerFieldText(ev.data, "currency")
            snap.addUsed(currency, amount)
            snap.addUsageKind(ledgerFieldText(ev.data, "usageKind"), currency, amount)
            snap.addProvider(ledgerFieldText(ev.data, "providerId"),
                ledgerFieldText(ev.data, "customModelId"), currency, amount)
            snap.addModel(ledgerFieldText(ev.data, "customModelId"), currency, amount)
            snap.setFinal(id, "settled", ev.data)
        } else if (kind == "ledger/unsettled") {
            let id = ledgerFieldText(ev.data, "attemptId")
            snap.removeReservation(id)
            snap.markUnsettled(id)
            snap.setFinal(id, "unsettled", ev.data)
        } else if (kind == "ledger/voided") {
            let id = ledgerFieldText(ev.data, "attemptId")
            snap.removeReservation(id)
            snap.addVoided(id)
        } else if (kind == "ledger/refused") {
            snap.addRefusal(ledgerFieldText(ev.data, "attemptId"), ev.data)
        } else if (kind == "attempt/dispatched") {
            // 与 attempt_log.cj 共用一个文件：B2 的先发标记在这里被认出来
            snap.addDispatched(ledgerFieldText(ev.data, "attemptId"))
        }
    }
    if (snap.overflowed) {
        return None
    }
    return Some(snap)
}

// 账目原文 → 结算结论（幂等回放同一份结论）
func ledgerOutcomeOf(data: String, idempotent: Bool): SettleOutcome {
    let result = ledgerFieldText(data, "result")
    var status = "rejected"
    if (result == "settled") {
        status = "settled"
    } else if (result == "unsettled") {
        status = "unsettled"
    }
    var code = ledgerFieldText(data, "reason")
    if (code.size == 0) {
        code = status
    }
    return SettleOutcome(status, code, ledgerFieldInt(data, "amountMicros"),
        ledgerFieldText(data, "currency"), ledgerFieldText(data, "priceVersion"),
        ledgerFieldText(data, "meterSource"), idempotent)
}

// 被拒的结算：不产生账目，也不改任何金额
func ledgerRefusalOutcome(data: String, idempotent: Bool): SettleOutcome {
    return SettleOutcome("rejected", ledgerFieldText(data, "code"), -1,
        ledgerFieldText(data, "currency"), ledgerFieldText(data, "priceVersion"), "unknown", idempotent)
}

func ledgerReservedData(intent: ReserveIntent): String {
    return "{\"attemptId\":\"${jsonEscapeText(intent.attemptId)}\","
        + "\"logicalRequestId\":\"${jsonEscapeText(intent.logicalRequestId)}\","
        + "\"usageKind\":\"${jsonEscapeText(intent.usageKind)}\","
        + "\"customModelId\":\"${jsonEscapeText(intent.customModelId)}\","
        + "\"providerId\":\"${jsonEscapeText(intent.providerId)}\","
        + "\"modelId\":\"${jsonEscapeText(intent.modelId)}\","
        + "\"reservedMicros\":${intent.reservedMicros},"
        + "\"currency\":\"${jsonEscapeText(intent.currency)}\",\"epoch\":${intent.epoch}}"
}

// 结算事件名：settled / unsettled / refused 三种落点各一条事件
func ledgerEventTypeOf(result: String): String {
    if (result == "settled") {
        return "ledger/settled"
    }
    if (result == "unsettled") {
        return "ledger/unsettled"
    }
    return "ledger/refused"
}

// 被拒的结算只记「为什么拒」，不产生金额
func ledgerEntryData(a: AttemptAccounting, result: String, reason: String, amount: Int64): String {
    if (result == "refused") {
        return "{\"attemptId\":\"${jsonEscapeText(a.attemptId)}\",\"code\":\"${jsonEscapeText(reason)}\","
            + "\"currency\":\"${jsonEscapeText(a.rates.currency)}\","
            + "\"priceVersion\":\"${jsonEscapeText(a.rates.priceVersion)}\"}"
    }
    return ledgerAccountingData(a, result, reason, amount)
}

// 结算/待核算事件体：费率与 priceVersion 一起落盘，这就是「计价快照」——
// 历史账单只认这一份，改价不重算。
func ledgerAccountingData(a: AttemptAccounting, result: String, reason: String, amount: Int64): String {
    return "{\"attemptId\":\"${jsonEscapeText(a.attemptId)}\","
        + "\"logicalRequestId\":\"${jsonEscapeText(a.logicalRequestId)}\","
        + "\"usageKind\":\"${jsonEscapeText(a.usageKind)}\","
        + "\"customModelId\":\"${jsonEscapeText(a.customModelId)}\","
        + "\"providerId\":\"${jsonEscapeText(a.providerId)}\","
        + "\"modelId\":\"${jsonEscapeText(a.modelId)}\","
        + "\"session\":\"${jsonEscapeText(a.session)}\","
        + "\"goal\":\"${jsonEscapeText(a.goal)}\","
        + "\"turn\":\"${jsonEscapeText(a.turn)}\","
        + "\"resultClass\":\"${jsonEscapeText(a.resultClass)}\","
        + "\"meterUnit\":\"${jsonEscapeText(a.meterUnit)}\","
        + "\"result\":\"${jsonEscapeText(result)}\",\"reason\":\"${jsonEscapeText(reason)}\","
        + "\"input\":${a.usage.input},\"output\":${a.usage.output},"
        + "\"cacheRead\":${a.usage.cacheRead},\"cacheWrite\":${a.usage.cacheWrite},"
        + "\"imageCount\":${a.imageCount},\"audioSeconds\":${a.audioSeconds},"
        + "\"meterSource\":\"${jsonEscapeText(ledgerSourceOf(a.usage))}\","
        + "\"rawField\":\"${jsonEscapeText(a.usage.rawField)}\","
        + "\"amountMicros\":${amount},\"currency\":\"${jsonEscapeText(a.rates.currency)}\","
        + "\"priceVersion\":\"${jsonEscapeText(a.rates.priceVersion)}\","
        + "\"rateInputMicrosPerUnit\":${a.rates.inputMicrosPerUnit},"
        + "\"rateOutputMicrosPerUnit\":${a.rates.outputMicrosPerUnit},"
        + "\"rateCacheReadMicrosPerUnit\":${a.rates.cacheReadMicrosPerUnit},"
        + "\"rateCacheWriteMicrosPerUnit\":${a.rates.cacheWriteMicrosPerUnit},"
        + "\"startedEpoch\":${a.startedEpoch},\"endedEpoch\":${a.endedEpoch},"
        + "\"durationMillis\":${a.durationMillis}}"
}

// ===== 账本 =====

public class UsageLedger {
    let file: String
    // 进程内闸门：同进程的并发预留/结算必须串行，否则两个线程会各自「读→判→写」，
    // 租约只能保证写不撕裂，保证不了判定原子。租约负责跨进程互斥，两者缺一不可。
    static let gate = Mutex()

    public init(file: String) {
        this.file = file
    }

    // 与 attempt_log.cj 同一条路径表达式：同一份 usage-ledger.log
    public static func forUser(): UsageLedger {
        let dir = Path(GlobalAppearanceSettings.forUser().settingsPath()).parent.toString()
        return UsageLedger("${dir}/usage-ledger.log")
    }

    // 账本的作用域键：只有本机路径（同机两入口共用一本账，跨机器不共享）。
    // 键里没有机器名、设备号或网络地址——「本地累计」不是账户余额，也不是多设备同步。
    public func scopeKey(): String {
        return "local:${file}"
    }

    // 原子预留：判据是「已用 + 在途预留 + 本次」不得突破上限。
    // 返回 accepted=false 表示调用方不许发请求（fail-closed）。
    public func reserve(intent: ReserveIntent, limitMicros: Int64): LedgerDecision {
        gate.lock()
        try {
            let lease = WriteLease(file)
            if (!lease.takeoverIfStale()) {
                return LedgerDecision(false, "ledger-busy", 0, 0, 0)
            }
            try {
                if (intent.attemptId.size == 0) {
                    return LedgerDecision(false, "bad-attempt-id", 0, 0, 0)
                }
                if (intent.reservedMicros < 0) {
                    return LedgerDecision(false, "bad-amount", 0, 0, 0)
                }
                if (limitMicros < 0) {
                    return LedgerDecision(false, "bad-limit", 0, 0, 0)
                }
                if (intent.currency.size == 0) {
                    return LedgerDecision(false, "bad-currency", 0, 0, 0)
                }
                let log = SessionLog(file)
                if (exists(file) && !log.load()) {
                    return LedgerDecision(false, "ledger-corrupt", 0, 0, 0)
                }
                let loaded = ledgerReplay(log.snapshotEvents())
                if (loaded.isNone()) {
                    return LedgerDecision(false, "ledger-corrupt", 0, 0, 0)
                }
                let snap = loaded.getOrThrow()
                let used = snap.used(intent.currency)
                let inFlight = snap.inFlight(intent.currency)
                // 预算挂在**模型**上（`dailyAmountMicro` 属于 CustomModelRecord），
                // 所以判据比的是该模型自己的「已结算 + 在途」，不是账户总量——
                // 号池里两个模型同币种时，账户总量会把别人的消费算进自己的预算，
                // 表现为「我刚建的新模型立刻预算耗尽」。
                // 未填 customModelId 的旧调用方退回账户口径，行为与改动前一致。
                let modelUsed = if (intent.customModelId.size > 0) {
                    snap.usedForModel(intent.customModelId, intent.currency)
                } else { used }
                let modelInFlight = if (intent.customModelId.size > 0) {
                    snap.inFlightForModel(intent.customModelId, intent.currency)
                } else { inFlight }
                // 同一 attempt 重复预留：不叠加，交回同一条预留
                if (let Some(existing) <- snap.liveReservation(intent.attemptId)) {
                    return LedgerDecision(true, "already-reserved", existing[2], modelUsed, modelInFlight)
                }
                if (snap.hasFinal(intent.attemptId)) {
                    return LedgerDecision(false, "already-settled", 0, modelUsed, modelInFlight)
                }
                if (snap.isVoided(intent.attemptId)) {
                    return LedgerDecision(false, "attempt-voided", 0, modelUsed, modelInFlight)
                }
                // 「已用 + 在途预留」不得突破上限：先查这次加法会不会回绕，再比上限
                var over = false
                if (modelUsed > Int64.Max - modelInFlight) {
                    over = true
                } else {
                    let committed = modelUsed + modelInFlight
                    if (intent.reservedMicros > limitMicros - committed) {
                        over = true
                    }
                }
                if (over) {
                    return LedgerDecision(false, "budget-exceeded", 0, modelUsed, modelInFlight)
                }
                log.append("ledger/reserved", ledgerReservedData(intent))
                if (!log.flush()) {
                    return LedgerDecision(false, "ledger-write-failed", 0, modelUsed, modelInFlight)
                }
                let afterInFlight = if (modelInFlight > Int64.Max - intent.reservedMicros) {
                    Int64.Max
                } else {
                    modelInFlight + intent.reservedMicros
                }
                return LedgerDecision(true, "reserved", intent.reservedMicros, modelUsed, afterInFlight)
            } finally {
                lease.release()
            }
        } finally {
            gate.unlock()
        }
    }

    // 按 attemptId 幂等结算：二次结算交回首次结论、不重复扣费；
    // 缺 usage / 费率未登记 / 金额溢出 → 落「待核算」，金额记 -1（未知），不冒充零。
    public func settle(accounting: AttemptAccounting): SettleOutcome {
        gate.lock()
        try {
            let lease = WriteLease(file)
            if (!lease.takeoverIfStale()) {
                return SettleOutcome("rejected", "ledger-busy", -1, accounting.rates.currency,
                    accounting.rates.priceVersion, "unknown", false)
            }
            try {
                if (accounting.attemptId.size == 0) {
                    return SettleOutcome("rejected", "bad-attempt-id", -1, accounting.rates.currency,
                        accounting.rates.priceVersion, "unknown", false)
                }
                let log = SessionLog(file)
                if (exists(file) && !log.load()) {
                    return SettleOutcome("rejected", "ledger-corrupt", -1, accounting.rates.currency,
                        accounting.rates.priceVersion, "unknown", false)
                }
                let loaded = ledgerReplay(log.snapshotEvents())
                if (loaded.isNone()) {
                    return SettleOutcome("rejected", "ledger-corrupt", -1, accounting.rates.currency,
                        accounting.rates.priceVersion, "unknown", false)
                }
                let snap = loaded.getOrThrow()
                // 1) 幂等：已有首次结论（账目或拒收）就原样交回
                if (let Some(refused) <- snap.refusal(accounting.attemptId)) {
                    return ledgerRefusalOutcome(refused, true)
                }
                // 1b) 幂等：已有首次结算结论（已结算或待核算）就原样交回，不重复扣费
                if (let Some(entry) <- snap.finalEntry(accounting.attemptId)) {
                    return ledgerOutcomeOf(entry, true)
                }
                // 2) 已作废的尝试不许再产生费用；3) 币种必须与在途预留一致（跨币种不许静默合并）
                var reason = ""
                var refused = false
                if (snap.isVoided(accounting.attemptId)) {
                    refused = true
                    reason = "attempt-voided"
                } else if (let Some(live) <- snap.liveReservation(accounting.attemptId)) {
                    if (live[1] != accounting.rates.currency) {
                        refused = true
                        reason = "currency-mismatch"
                    }
                }
                // 4) 维度计价与快照完整性
                if (!refused) {
                    if (!accounting.usage.hasReported() || ledgerSourceOf(accounting.usage) == "unknown") {
                        reason = "usage-unspecified"
                    } else if (accounting.rates.currency.size == 0) {
                        reason = "currency-unspecified"
                    } else if (accounting.rates.priceVersion.size == 0) {
                        reason = "price-version-unspecified"
                    } else {
                        reason = ledgerMissingRate(accounting)
                    }
                }
                var amount: Int64 = -1
                var result = "unsettled"
                if (refused) {
                    result = "refused"
                } else if (reason.size == 0) {
                    let computed = ledgerAmountOf(accounting)
                    if (computed.isNone()) {
                        // 溢出即拒：整笔落「待核算」，不清零也不回绕
                        reason = "amount-overflow"
                    } else {
                        amount = computed.getOrThrow()
                        result = "settled"
                    }
                }
                // 唯一的落盘点：整段临界区里只有这一次写入
                log.append(ledgerEventTypeOf(result),
                    ledgerEntryData(accounting, result, reason, amount))
                if (!log.flush()) {
                    return SettleOutcome("rejected", "ledger-write-failed", -1,
                        accounting.rates.currency, accounting.rates.priceVersion, "unknown", false)
                }
                if (result == "refused") {
                    return SettleOutcome("rejected", reason, -1, accounting.rates.currency,
                        accounting.rates.priceVersion, "unknown", false)
                }
                let status = if (result == "settled") { "settled" } else { "unsettled" }
                let code = if (reason.size == 0) { "settled" } else { reason }
                return SettleOutcome(status, code, amount, accounting.rates.currency,
                    accounting.rates.priceVersion, ledgerSourceOf(accounting.usage), false)
            } finally {
                lease.release()
            }
        } finally {
            gate.unlock()
        }
    }

    // 作废：供应商关闭或会话被抛弃时把在途预留显式放掉，不让它永久占位。
    // 已结算的尝试不动钱；重复作废不再写一条。
    public func voidAttempt(attemptId: String, reason: String, epoch!: Int64 = 0): String {
        gate.lock()
        try {
            let lease = WriteLease(file)
            if (!lease.takeoverIfStale()) {
                return "ledger-busy"
            }
            try {
                let log = SessionLog(file)
                if (exists(file) && !log.load()) {
                    return "ledger-corrupt"
                }
                let loaded = ledgerReplay(log.snapshotEvents())
                if (loaded.isNone()) {
                    return "ledger-corrupt"
                }
                let snap = loaded.getOrThrow()
                if (snap.isVoided(attemptId)) {
                    return "already-voided"
                }
                if (snap.hasFinal(attemptId)) {
                    return "already-settled"
                }
                if (snap.liveReservation(attemptId).isNone()) {
                    return "no-reservation"
                }
                log.append("ledger/voided", "{\"attemptId\":\"${jsonEscapeText(attemptId)}\","
                    + "\"reason\":\"${jsonEscapeText(reason)}\",\"epoch\":${epoch}}")
                if (!log.flush()) {
                    return "ledger-write-failed"
                }
                return "voided"
            } finally {
                lease.release()
            }
        } finally {
            gate.unlock()
        }
    }

    // 本地累计（按币种分列）：只报核心自己算出来的数，不冒充供应商余额
    public func state(): LedgerState {
        let snap = loadSnapshot()
        let totals = ArrayList<CurrencyTotal>()
        for (currency in snap.currencies()) {
            totals.add(CurrencyTotal(currency, snap.used(currency), snap.inFlight(currency)))
        }
        return LedgerState(totals.toArray())
    }

    // 该 attempt 的账目原文（settled / unsettled 事件体）；没有账目回空串
    public func attemptEntry(attemptId: String): String {
        let snap = loadSnapshot()
        if (let Some(entry) <- snap.finalEntry(attemptId)) {
            return entry
        }
        return ""
    }

    // >=0 已核算金额；-1 待核算（不冒充零）；-2 无账目
    public func amountOf(attemptId: String): Int64 {
        let snap = loadSnapshot()
        if (let Some(entry) <- snap.finalEntry(attemptId)) {
            return ledgerFieldInt(entry, "amountMicros")
        }
        return -2
    }

    public func meterSourceOf(attemptId: String): String {
        let snap = loadSnapshot()
        if (let Some(entry) <- snap.finalEntry(attemptId)) {
            return ledgerFieldText(entry, "meterSource")
        }
        return ""
    }

    public func priceVersionOf(attemptId: String): String {
        let snap = loadSnapshot()
        if (let Some(entry) <- snap.finalEntry(attemptId)) {
            return ledgerFieldText(entry, "priceVersion")
        }
        return ""
    }

    // 待核算账目（缺 usage / 未登记维度 / 溢出）
    public func unsettledAttempts(): Array<String> {
        return loadSnapshot().unsettledList.toArray()
    }

    // 在途预留：预留了但还没结算也没作废的那几笔
    public func pendingReservations(): Array<String> {
        let snap = loadSnapshot()
        let out = ArrayList<String>()
        for (r in snap.liveReservations) {
            out.add(r[0])
        }
        return out.toArray()
    }

    // 已派发但未结算的尝试（崩溃恢复读面，断言 82 的 B3 半）
    public func dispatchedUnsettled(): Array<String> {
        return loadSnapshot().dispatchedUnsettled().toArray()
    }

    // 按 usageKind 分组的已结算金额
    public func usageKindTotals(): Array<UsageTotal> {
        let snap = loadSnapshot()
        let out = ArrayList<UsageTotal>()
        for (kv in snap.usageKindTotals) {
            out.add(UsageTotal(kv[0], "", kv[1], kv[2]))
        }
        return out.toArray()
    }

    // 按实例（providerId + customModelId）分组的已结算金额：聚合不许抹掉实例维度
    public func providerTotals(): Array<UsageTotal> {
        let snap = loadSnapshot()
        let out = ArrayList<UsageTotal>()
        for (kv in snap.providerTotals) {
            out.add(UsageTotal(kv[0], kv[1], kv[2], kv[3]))
        }
        return out.toArray()
    }

    // 按模型分组的已结算金额。`providerTotals` 抹掉了 usageKind、
    // `usageKindTotals` 抹掉了模型，两路都回答不了「这个模型的预算用掉多少」——
    // 预算面板的「已用 / 预算」进度条就是要它。
    // key 与 customModelId 都填模型 ID：一个模型只有一个 currency（断言 46），
    // 所以这里不出现同模型多币种。
    public func modelTotals(): Array<UsageTotal> {
        let snap = loadSnapshot()
        let out = ArrayList<UsageTotal>()
        for (kv in snap.modelTotals) {
            out.add(UsageTotal(kv[0], kv[0], kv[1], kv[2]))
        }
        return out.toArray()
    }

    // 供路由器判预算的只读视图：只给「某币种下各自定义模型的本地已用」，
    // 路由器拿不到 store、也拿不到任何写面。
    public func routerView(currency: String): LedgerView {
        let snap = loadSnapshot()
        let used = ArrayList<(String, Int64)>()
        for (kv in snap.modelTotals) {
            if (kv[1] == currency) {
                used.add((kv[0], kv[2]))
            }
        }
        return LedgerView(used.toArray())
    }

    // 读面（ledger/describe 的核心形态）：本地累计按币种分列，usageKind 与实例维度各自成组；
    // 待核算与在途预留如实列出。所有数字都由账本算出，调用方不许二次累加。
    public func describeJson(): String {
        let snap = loadSnapshot()
        var totals = ""
        for (currency in snap.currencies()) {
            if (totals.size > 0) {
                totals += ","
            }
            totals += "{\"currency\":\"${jsonEscapeText(currency)}\","
                + "\"usedMicros\":${snap.used(currency)},\"inFlightMicros\":${snap.inFlight(currency)}}"
        }
        var kinds = ""
        for (kv in snap.usageKindTotals) {
            if (kinds.size > 0) {
                kinds += ","
            }
            kinds += "{\"usageKind\":\"${jsonEscapeText(kv[0])}\","
                + "\"currency\":\"${jsonEscapeText(kv[1])}\",\"usedMicros\":${kv[2]}}"
        }
        var providers = ""
        for (kv in snap.providerTotals) {
            if (providers.size > 0) {
                providers += ","
            }
            providers += "{\"providerId\":\"${jsonEscapeText(kv[0])}\","
                + "\"customModelId\":\"${jsonEscapeText(kv[1])}\","
                + "\"currency\":\"${jsonEscapeText(kv[2])}\",\"usedMicros\":${kv[3]}}"
        }
        var unsettled = ""
        for (id in snap.unsettledList) {
            if (unsettled.size > 0) {
                unsettled += ","
            }
            unsettled += "\"${jsonEscapeText(id)}\""
        }
        var pending = ""
        for (r in snap.liveReservations) {
            if (pending.size > 0) {
                pending += ","
            }
            pending += "\"${jsonEscapeText(r[0])}\""
        }
        return "{\"scopeKey\":\"${jsonEscapeText(scopeKey())}\"," +
            "\"localUsedLabel\":\"本地累计\",\"totals\":[${totals}]," +
            "\"usageKinds\":[${kinds}],\"providers\":[${providers}]," +
            "\"unsettled\":[${unsettled}],\"pending\":[${pending}]}"
    }

    // 读面：损坏的账本抛错，不静默给零——把「读不出」说成「没花钱」是最坏的一种谎
    private func loadSnapshot(): LedgerSnapshot {
        let log = SessionLog(file)
        if (exists(file) && !log.load()) {
            throw Exception("ledger-replay-rejected")
        }
        let loaded = ledgerReplay(log.snapshotEvents())
        if (loaded.isNone()) {
            throw Exception("ledger-replay-rejected")
        }
        return loaded.getOrThrow()
    }
}
