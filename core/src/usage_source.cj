package core

import std.collection.*
import std.sync.*
import stdx.encoding.json.*

// 来源维度与计量依据独立；缺用量或累计溢出不能变成零消费。
public class QuotaUsageTotal {
    public let quotaSource: String
    public let externalAgentId: String
    public let meterUnit: String
    public var attempts: Int64 = 0
    public var totalTokens: Int64 = 0
    public var input: Int64 = 0
    public var output: Int64 = 0
    public var cacheRead: Int64 = 0
    public var cacheWrite: Int64 = 0

    public init(quotaSource: String, externalAgentId: String, meterUnit: String) {
        this.quotaSource = quotaSource
        this.externalAgentId = externalAgentId
        this.meterUnit = meterUnit
    }

    func add(data: String): Unit {
        attempts += 1
        totalTokens = quotaUsageSum(totalTokens, ledgerFieldInt(data, "totalTokens"))
        input = quotaUsageSum(input, ledgerFieldInt(data, "input"))
        output = quotaUsageSum(output, ledgerFieldInt(data, "output"))
        cacheRead = quotaUsageSum(cacheRead, ledgerFieldInt(data, "cacheRead"))
        cacheWrite = quotaUsageSum(cacheWrite, ledgerFieldInt(data, "cacheWrite"))
    }
}

func quotaUsageSum(a: Int64, b: Int64): Int64 {
    if (a < 0 || b < 0) {
        return -1
    }
    if (a > Int64.Max - b) {
        throw Exception("usage-source-overflow")
    }
    return a + b
}

func usageIdentityValid(value: String): Bool {
    if (value.size == 0 || value.size > 200) {
        return false
    }
    for (b in value.toArray()) {
        if (!((b >= 48 && b <= 57) || (b >= 65 && b <= 90) || (b >= 97 && b <= 122) || b == 45 || b == 95 || b == 46 ||
            b == 58)) {
            return false
        }
    }
    return true
}

func quotaSourceValid(source: String, agent: String): Bool {
    return (source == "local-token" && agent.size == 0) || (source == "external-agent" && usageIdentityValid(agent))
}

// 只有缺少字段的历史模型账目默认本地来源；非法新值不回退为本地。
func ledgerQuotaSource(data: String): String {
    let obj = JsonValue.fromStr(data).asObject()
    if (let Some(value) <- obj.get("quotaSource")) {
        return value.asString().getValue()
    }
    return "local-token"
}

func quotaUsageAdd(totals: ArrayList<QuotaUsageTotal>, data: String): Unit {
    let source = ledgerQuotaSource(data)
    let agent = ledgerFieldText(data, "externalAgentId")
    if (!quotaSourceValid(source, agent)) {
        throw Exception("usage-source-invalid")
    }
    let unit = ledgerFieldText(data, "meterUnit")
    for (total in totals) {
        if (total.quotaSource == source && total.externalAgentId == agent && total.meterUnit == unit) {
            total.add(data)
            return
        }
    }
    let total = QuotaUsageTotal(source, agent, unit)
    total.add(data)
    totals.add(total)
}

func quotaUsageJson(totals: Array<QuotaUsageTotal>): JsonArray {
    let out = JsonArray()
    for (total in totals) {
        let obj = JsonObject()
        obj.put("quotaSource", JsonString(total.quotaSource))
        obj.put("externalAgentId", JsonString(total.externalAgentId))
        obj.put("meterUnit", JsonString(total.meterUnit))
        obj.put("attempts", JsonInt(total.attempts));
        obj.put("totalTokens", JsonInt(total.totalTokens))
        obj.put("input", JsonInt(total.input));
        obj.put("output", JsonInt(total.output))
        obj.put("cacheRead", JsonInt(total.cacheRead));
        obj.put("cacheWrite", JsonInt(total.cacheWrite))
        out.add(obj)
    }
    return out
}

// 会话额度账仅追加事实，不执行切换、不重放任务、不授予外部执行权限。
// 与 TokenMeter 一样由持有会话租约的调用方 checkpoint；日志仍是唯一真源。
public class SessionUsageLedger {
    let log: SessionLog
    static let gate = Mutex()
    public init(log: SessionLog) {
        this.log = log
    }

    public func recordExternal(attemptId: String, agentId: String, usage!: LedgerUsage = LedgerUsage.absent(),
        meterUnit!: String = "token", totalTokens!: Int64 = -1): Bool {
        if (!usageIdentityValid(attemptId) || !usageIdentityValid(agentId) || !usageIdentityValid(meterUnit) ||
            usage.input < -1 || usage.output < -1 || usage.cacheRead < -1 || usage.cacheWrite < -1 || totalTokens < -1) {
            throw Exception("usage-source-invalid")
        }
        let obj = JsonObject()
        obj.put("schema", JsonInt(1));
        obj.put("attemptId", JsonString(attemptId))
        obj.put("quotaSource", JsonString("external-agent"));
        obj.put("externalAgentId", JsonString(agentId))
        obj.put("meterUnit", JsonString(meterUnit));
        obj.put("meterSource", JsonString(ledgerSourceOf(usage)))
        obj.put("totalTokens", JsonInt(totalTokens))
        obj.put("input", JsonInt(usage.input));
        obj.put("output", JsonInt(usage.output))
        obj.put("cacheRead", JsonInt(usage.cacheRead));
        obj.put("cacheWrite", JsonInt(usage.cacheWrite))
        return appendOnce("usage/external", "attemptId", attemptId, obj.toString())
    }

    // 由调度方在真实切换时调用；显式绑定两端和原因，不从 429 或自由文本推断额度耗尽。
    public func recordFallback(transitionId: String, fromSource: String, fromAgentId: String, toAgentId: String): Bool {
        if (!usageIdentityValid(transitionId) || !quotaSourceValid(fromSource, fromAgentId) ||
            !usageIdentityValid(toAgentId) || (fromSource == "external-agent" && fromAgentId == toAgentId)) {
            throw Exception("usage-fallback-invalid")
        }
        let obj = JsonObject()
        obj.put("schema", JsonInt(1));
        obj.put("transitionId", JsonString(transitionId))
        obj.put("reason", JsonString("quota-exhausted"))
        obj.put("fromSource", JsonString(fromSource));
        obj.put("fromAgentId", JsonString(fromAgentId))
        obj.put("toSource", JsonString("external-agent"));
        obj.put("toAgentId", JsonString(toAgentId))
        return appendOnce("usage/fallback", "transitionId", transitionId, obj.toString())
    }

    private func appendOnce(kind: String, key: String, id: String, data: String): Bool {
        gate.lock()
        try {
            if (log.isDurableFrozen()) {
                return false
            }
            for (event in log.snapshotEvents()) {
                if (event.eventType == kind && ledgerFieldText(event.data, key) == id) {
                    if (event.data != data) {
                        throw Exception("usage-source-conflict")
                    }
                    return true
                }
            }
            log.append(kind, data)
            return true
        } finally {
            gate.unlock()
        }
    }

    public func sourceTotals(): Array<QuotaUsageTotal> {
        let totals = ArrayList<QuotaUsageTotal>()
        let seen = HashSet<String>()
        let events = log.snapshotEvents()
        let reported = HashMap<String, String>()
        for (event in events) {
            if (event.eventType == "usage/external") {
                let obj = JsonValue.fromStr(event.data).asObject()
                let id = ledgerFieldText(event.data, "attemptId")
                if (obj.size() != 11 || ledgerFieldInt(event.data, "schema") != 1 || ledgerQuotaSource(event.data) !=
                    "external-agent" || !usageIdentityValid(id) ||
                    !usageIdentityValid(ledgerFieldText(event.data, "meterUnit")) ||
                    ledgerFieldInt(event.data, "totalTokens") < -1) {
                    throw Exception("usage-source-invalid")
                }
                if (reported.contains(id)) {
                    throw Exception("usage-source-duplicate")
                }
                reported[id] = ledgerFieldText(event.data, "externalAgentId")
            }
        }
        for (event in events) {
            if (event.eventType == "turn/usage") {
                if (let Some(count) <- parseCount(event.data.split(":")[0])) {
                    // 历史 token-meter 只有总 token，不能反推 input/output。
                    let data = "{\"quotaSource\":\"local-token\",\"meterUnit\":\"token\",\"totalTokens\":${count},\"input\":-1,\"output\":-1,\"cacheRead\":-1,\"cacheWrite\":-1}"
                    quotaUsageAdd(totals, data)
                }
            } else if (event.eventType == "acp/task/start" && ledgerQuotaSource(event.data) == "external-agent") {
                let id = "${ledgerFieldText(event.data, "delegationId")}:${ledgerFieldInt(event.data, "protocolRequestId")}"
                if (!seen.add(id)) {
                    throw Exception("usage-source-duplicate")
                }
                // 后续显式用量取代未知意图，不能把同一调用累计两次。
                if (!reported.contains(id)) {
                    let obj = JsonObject()
                    obj.put("quotaSource", JsonString("external-agent"))
                    obj.put("externalAgentId", JsonString(ledgerFieldText(event.data, "externalAgentId")))
                    obj.put("meterUnit", JsonString("token"))
                    quotaUsageAdd(totals, obj.toString())
                } else if (reported.get(id).getOrThrow() != ledgerFieldText(event.data, "externalAgentId")) {
                    throw Exception("usage-source-conflict")
                }
            } else if (event.eventType == "usage/external") {
                quotaUsageAdd(totals, event.data)
            }
        }
        return totals.toArray()
    }

    public func fallbackEvents(): Array<String> {
        let out = ArrayList<String>()
        let seen = HashSet<String>()
        for (event in log.snapshotEvents()) {
            if (event.eventType == "usage/fallback") {
                let obj = JsonValue.fromStr(event.data).asObject()
                if (obj.size() != 7 || ledgerFieldInt(event.data, "schema") != 1 ||
                    !usageIdentityValid(ledgerFieldText(event.data, "transitionId")) ||
                    ledgerFieldText(event.data, "reason") != "quota-exhausted" ||
                    ledgerFieldText(event.data, "toSource") != "external-agent" ||
                    !quotaSourceValid(ledgerFieldText(event.data, "fromSource"),
                    ledgerFieldText(event.data, "fromAgentId")) ||
                    !usageIdentityValid(ledgerFieldText(event.data, "toAgentId"))) {
                    throw Exception("usage-fallback-invalid")
                }
                if (!seen.add(ledgerFieldText(event.data, "transitionId")) || (ledgerFieldText(event.data, "fromSource") ==
                    "external-agent" && ledgerFieldText(event.data, "fromAgentId") == ledgerFieldText(event.data,
                    "toAgentId"))) {
                    throw Exception("usage-fallback-invalid")
                }
                out.add(event.data)
            }
        }
        return out.toArray()
    }
}
