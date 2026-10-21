package core

import std.fs.*
import std.unittest.*

@Test
func quotaSourceSeparatesLocalAndExternalSessionUsageAfterReplay() {
    let tag = "source-session"
    mtCleanup(tag)
    let log = SessionLog(mtPath(tag))
    let meter = TokenMeter(log, budget: 12)
    @Expect(meter.record("12"), "recorded")
    let usage = SessionUsageLedger(log)
    @Expect(usage.recordExternal("task-1", "opencode", usage: LedgerUsage(20, 5, 0, 0, "vendor"), totalTokens: 25), true)
    @Expect(usage.recordExternal("task-2", "codebuddy"), true)
    @Expect(meter.used(), 12)
    @Expect(meter.over(), true)
    @Expect(meter.recordExternalFallback("spent-1", "opencode"), true)
    @Expect(log.flush(), true)
    let replay = SessionLog(mtPath(tag))
    @Expect(replay.load(), true)
    let restored = TokenMeter(replay, budget: 12)
    @Expect(restored.rebuild(), 12)
    let totals = restored.sourceTotals()
    @Expect(totals.size, 3)
    @Expect(totals[0].quotaSource, "local-token")
    @Expect(totals[0].totalTokens, 12)
    @Expect(totals[1].externalAgentId, "opencode")
    @Expect(totals[1].input, 20)
    @Expect(totals[1].totalTokens, 25)
    @Expect(totals[2].externalAgentId, "codebuddy")
    @Expect(totals[2].input, -1)
    @Expect(totals[2].totalTokens, -1)
    mtCleanup(tag)
}

@Test
func quotaSourceLedgerExternalUsageNeverChargesLocalModelBudget() {
    let tag = "source-ledger"
    lgClean(tag)
    let ledger = UsageLedger(lgPath(tag))
    let rates = RateCard(10, 20, 0, 0, "CNY", "pv1")
    @Expect(ledger.settle(AttemptAccounting("local-1", LedgerUsage(2, 1, 0, 0, "vendor"), rates,
        customModelId: "model-1")).amountMicros, 40)
    let external = AttemptAccounting("external-1", LedgerUsage(100, 30, 0, 0, "vendor"), rates,
        quotaSource: "external-agent", externalAgentId: "opencode", customModelId: "model-1")
    @Expect(ledger.settle(external).code, "external-account")
    @Expect(ledger.settle(external).idempotent, true)
    @Expect(ledger.settle(AttemptAccounting("external-1", LedgerUsage(1, 1, 0, 0, "vendor"), rates)).code, "quota-source-mismatch")
    @Expect(ledger.amountOf("external-1"), -1)
    @Expect(ledger.state().localUsed("CNY"), 40)
    @Expect(ledger.modelTotals()[0].usedMicros, 40)
    let totals = ledger.sourceTotals()
    @Expect(totals.size, 2)
    @Expect(totals[0].quotaSource, "local-token")
    @Expect(totals[1].quotaSource, "external-agent")
    @Expect(totals[1].attempts, 1)
    @Expect(totals[1].input, 100)
    @Expect(ledger.describeJson().contains("\"sources\""), true)
    @Expect(ledger.attemptEntry("external-1").contains("\"externalAgentId\":\"opencode\""), true)
    lgClean(tag)
}

@Test
func quotaSourceRejectsInvalidBindingAndLocalReservationRelabel() {
    let tag = "source-refused"
    lgClean(tag)
    let ledger = UsageLedger(lgPath(tag))
    let rates = RateCard(1, 1, 0, 0, "CNY", "pv1")
    @Expect(ledger.settle(AttemptAccounting("bad-1", LedgerUsage.absent(), rates,
        quotaSource: "external-agent")).code, "bad-quota-source")
    @Expect(ledger.settle(AttemptAccounting("bad-2", LedgerUsage.absent(), rates,
        quotaSource: "unknown")).code, "bad-quota-source")
    @Expect(ledger.reserve(ReserveIntent("reserved-1", 5, "CNY"), 10).accepted, true)
    @Expect(ledger.settle(AttemptAccounting("reserved-1", LedgerUsage.absent(), rates,
        quotaSource: "external-agent", externalAgentId: "opencode")).code, "quota-source-mismatch")
    @Expect(ledger.state().localInFlight("CNY"), 5)
    @Expect(ledger.sourceTotals().size, 0)
    lgClean(tag)
}

@Test
func quotaSourceFallbackIsIdempotentAndReplaysBothEndpoints() {
    let tag = "source-fallback"
    mtCleanup(tag)
    let log = SessionLog(mtPath(tag))
    let usage = SessionUsageLedger(log)
    @Expect(TokenMeter(log, budget: 12).recordExternalFallback("not-exhausted", "opencode"), false)
    @Expect(usage.recordFallback("switch-1", "local-token", "", "opencode"), true)
    @Expect(usage.recordFallback("switch-1", "local-token", "", "opencode"), true)
    @Expect(usage.recordFallback("switch-2", "external-agent", "opencode", "codebuddy"), true)
    @ExpectThrows[Exception](usage.recordFallback("switch-1", "local-token", "", "codebuddy"))
    @ExpectThrows[Exception](usage.recordFallback("bad", "external-agent", "opencode", "opencode"))
    @Expect(mtEventCount(log, "usage/fallback"), 2)
    @Expect(log.flush(), true)
    let replay = SessionLog(mtPath(tag))
    @Expect(replay.load(), true)
    let facts = SessionUsageLedger(replay).fallbackEvents()
    @Expect(facts.size, 2)
    @Expect(ledgerFieldText(facts[0], "reason"), "quota-exhausted")
    @Expect(ledgerFieldText(facts[0], "fromSource"), "local-token")
    @Expect(ledgerFieldText(facts[0], "toAgentId"), "opencode")
    @Expect(ledgerFieldText(facts[1], "fromAgentId"), "opencode")
    @Expect(ledgerFieldText(facts[1], "toAgentId"), "codebuddy")
    @Expect(SessionUsageLedger(replay).recordFallback("switch-1", "local-token", "", "opencode"), true)
    @Expect(replay.pendingCount(), 0)
    mtCleanup(tag)
}

@Test
func quotaSourceExternalIdempotencyUnknownAndUnitIsolation() {
    let tag = "source-units"
    mtCleanup(tag)
    let log = SessionLog(mtPath(tag))
    let usage = SessionUsageLedger(log)
    @Expect(usage.recordExternal("request-1", "opencode"), true)
    @Expect(usage.recordExternal("request-1", "opencode"), true)
    @ExpectThrows[Exception](usage.recordExternal("request-1", "codebuddy"))
    @ExpectThrows[Exception](usage.recordExternal("request-2", "token=secret"))
    @Expect(usage.recordExternal("request-3", "opencode", meterUnit: "credit"), true)
    @Expect(mtEventCount(log, "usage/external"), 2)
    let totals = usage.sourceTotals()
    @Expect(totals.size, 2)
    @Expect(totals[0].attempts, 1)
    @Expect(totals[0].input, -1)
    @Expect(totals[0].meterUnit, "token")
    @Expect(totals[1].meterUnit, "credit")
    mtCleanup(tag)
}

@Test
func quotaSourceAcpTaskIntentIsDurableWithoutInventingConsumption() {
    let tag = "source-acp"
    mtCleanup(tag)
    let path = mtPath(tag)
    let log = SessionLog(path)
    let lease = WriteLease(path)
    let journal = AcpDelegationJournal(log, lease, "session")
    let admission = AcpDelegationSnapshot("delegation-1", "session", "task", "request", "opencode", "", "initializing", 1, "", "")
    let running = AcpDelegationSnapshot("delegation-1", "session", "task", "request", "opencode", "protocol-1", "running", 2, "", "")
    @Expect(journal.taskFact(running, "acp/task/start", 2, "intent-before-send"), false)
    @Expect(log.eventCount(), 0)
    @Expect(lease.acquire(), true)
    @Expect(journal.admit(admission, "workspace", sha256Hex("task".toArray())), true)
    @Expect(journal.taskFact(running, "acp/task/start", 2, "intent-before-send"), true)
    @Expect(log.pendingCount(), 0)
    @Expect(lease.release(), true)
    let replay = SessionLog(path)
    @Expect(replay.load(), true)
    let total = SessionUsageLedger(replay).sourceTotals()[0]
    @Expect(total.quotaSource, "external-agent")
    @Expect(total.externalAgentId, "opencode")
    @Expect(total.input, -1)
    @Expect(total.totalTokens, -1)
    @Expect(AcpDelegationJournal(replay, WriteLease(path), "session").recover().size, 1)
    let reported = SessionUsageLedger(replay)
    @Expect(reported.recordExternal("delegation-1:2", "opencode", usage: LedgerUsage(4, 2, 0, 0, "vendor"), totalTokens: 6), true)
    @Expect(reported.sourceTotals()[0].attempts, 1)
    @Expect(reported.sourceTotals()[0].totalTokens, 6)
    mtCleanup(tag)
}

@Test
func quotaSourceHistoricalLedgerWithoutSourceStillReadsAsLocal() {
    let tag = "source-history"
    lgClean(tag)
    let log = SessionLog(lgPath(tag))
    log.append("ledger/settled", "{\"attemptId\":\"old\",\"amountMicros\":7,\"currency\":\"CNY\",\"input\":2,\"output\":1,\"cacheRead\":0,\"cacheWrite\":0}")
    @Expect(log.flush(), true)
    let ledger = UsageLedger(lgPath(tag))
    @Expect(ledger.state().localUsed("CNY"), 7)
    @Expect(ledger.sourceTotals()[0].quotaSource, "local-token")
    @Expect(ledger.sourceTotals()[0].input, 2)
    lgClean(tag)
}

@Test
func q1cExternalUnknownSurvivesKnownUsageAndReplay() {
    let tag = "q1c-source-unknown"
    mtCleanup(tag)
    try {
        let log = SessionLog(mtPath(tag))
        let usage = SessionUsageLedger(log)
        @Expect(usage.recordExternal("q1c-unknown", "opencode"), true)
        @Expect(usage.recordExternal("q1c-known", "opencode",
            usage: LedgerUsage(4, 2, 0, 0, "vendor"), totalTokens: 6), true)
        @Expect(log.flush(), true)
        let replay = SessionLog(mtPath(tag))
        @Expect(replay.load(), true)
        let totals = SessionUsageLedger(replay).sourceTotals()
        @Expect(totals.size, Int64(1))
        @Expect(totals[0].quotaSource, "external-agent")
        @Expect(totals[0].externalAgentId, "opencode")
        @Expect(totals[0].attempts, Int64(2))
        // -1 是未知哨兵，不是可抵扣的负消费；混合已知记录后也不能洗成零。
        @Expect(totals[0].input, Int64(-1))
        @Expect(totals[0].output, Int64(-1))
        @Expect(totals[0].cacheRead, Int64(-1))
        @Expect(totals[0].cacheWrite, Int64(-1))
        @Expect(totals[0].totalTokens, Int64(-1))
        @Expect(TokenMeter(replay).used(), Int64(0))
    } finally {
        mtCleanup(tag)
    }
}

@Test
func q1cExternalNegativeConsumptionIsRejectedWithoutEvent() {
    let tag = "q1c-source-negative"
    mtCleanup(tag)
    try {
        let log = SessionLog(mtPath(tag))
        let usage = SessionUsageLedger(log)
        for (invalid in [LedgerUsage(-2, 0, 0, 0, "vendor"), LedgerUsage(0, -2, 0, 0, "vendor"),
            LedgerUsage(0, 0, -2, 0, "vendor"), LedgerUsage(0, 0, 0, -2, "vendor")]) {
            @ExpectThrows[Exception](usage.recordExternal("q1c-negative", "opencode", usage: invalid))
        }
        @ExpectThrows[Exception](usage.recordExternal("q1c-negative-total", "opencode", totalTokens: -2))
        @Expect(mtEventCount(log, "usage/external"), Int64(0))
        @Expect(usage.sourceTotals().size, Int64(0))
        @Expect(log.pendingCount(), Int64(0))
    } finally {
        mtCleanup(tag)
    }
}

@Test
func q1cExternalUnknownLedgerRemainsUnsettledAfterReplay() {
    let tag = "q1c-ledger-unknown"
    lgClean(tag)
    try {
        let ledger = UsageLedger(lgPath(tag))
        let out = ledger.settle(AttemptAccounting("q1c-external", LedgerUsage.absent(),
            RateCard(100, 100, 0, 0, "CNY", "q1c"),
            quotaSource: "external-agent", externalAgentId: "opencode"))
        @Expect(out.status, "unsettled")
        @Expect(out.code, "external-account")
        @Expect(out.amountMicros, Int64(-1))
        let replay = UsageLedger(lgPath(tag))
        @Expect(replay.amountOf("q1c-external"), Int64(-1))
        @Expect(replay.state().localUsed("CNY"), Int64(0))
        let totals = replay.sourceTotals()
        @Expect(totals.size, Int64(1))
        @Expect(totals[0].quotaSource, "external-agent")
        @Expect(totals[0].externalAgentId, "opencode")
        @Expect(totals[0].input, Int64(-1))
        @Expect(totals[0].output, Int64(-1))
        let entry = replay.attemptEntry("q1c-external")
        @Expect(entry.contains("\"quotaSource\":\"external-agent\""), true)
        @Expect(entry.contains("\"externalAgentId\":\"opencode\""), true)
    } finally {
        lgClean(tag)
    }
}
