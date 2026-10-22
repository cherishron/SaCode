package daemon

import std.fs.*
import std.env.*
import std.collection.*
import std.sync.*
import std.unittest.*
import std.unittest.testmacro.*

func securityClaim(l: IdempotencyLedger, op: String, digest: String): LedgerOutcome {
    return l.claim(instanceId: "security", principalId: "synthetic", workspaceId: "ws",
        sessionId: "s", method: "session/submit", operationId: op, contentDigest: digest)
}

@Test
func securityConcurrentClaimHasExactlyOneExecutor() {
    let l = IdempotencyLedger()
    let start = AtomicBool(false)
    let jobs = ArrayList<Future<String>>()
    for (_ in 0..32) {
        jobs.add(spawn { =>
            while (!start.load()) { sleep(Duration.millisecond) }
            securityClaim(l, "op", "d").kind
        })
    }
    start.store(true)
    var executed = 0
    var replayed = 0
    for (job in jobs) {
        let kind = job.get()
        if (kind == LEDGER_KIND_EXECUTE) { executed += 1 }
        if (kind == LEDGER_KIND_REPLAY) { replayed += 1 }
    }
    @Expect(executed, 1)
    @Expect(replayed, 31)
    @Expect(securityClaim(l, "op", "different").kind, LEDGER_KIND_CONFLICT)
    @Expect(ledgerIsUnknown(securityClaim(l, "op", "d").receipt), true)
}

@Test
func securityIntentSurvivesRestartBeforeCompletionAndCannotBeEvicted() {
    let root = Directory.createTemp(getTempDirectory())
    let path = root.join("ledger.jsonl").toString()
    let l = IdempotencyLedger(cap: 1, storePath: path)
    @Expect(securityClaim(l, "op", "d").kind, LEDGER_KIND_EXECUTE)
    @Expect(securityClaim(l, "other", "d").kind, LEDGER_KIND_UNAVAILABLE)
    let reopened = IdempotencyLedger(cap: 1, storePath: path)
    let hit = securityClaim(reopened, "op", "d")
    @Expect(hit.kind, LEDGER_KIND_REPLAY)
    @Expect(ledgerIsUnknown(hit.receipt), true)
}

@Test
func securityFailedIntentPersistenceNeverAuthorizesExecution() {
    let root = Directory.createTemp(getTempDirectory())
    let l = IdempotencyLedger(storePath: root.join("missing/ledger.jsonl").toString())
    @Expect(securityClaim(l, "op", "d").kind, LEDGER_KIND_UNAVAILABLE)
    @Expect(securityClaim(l, "op", "d").kind, LEDGER_KIND_REPLAY)
    @Expect(l.persistedFailureCount(), 1)
}

@Test
func securitySafeReleasePersistsAndAllowsLaterExecution() {
    let root = Directory.createTemp(getTempDirectory())
    let path = root.join("ledger.jsonl").toString()
    let l = IdempotencyLedger(cap: 2, storePath: path)
    @Expect(securityClaim(l, "op", "d").kind, LEDGER_KIND_EXECUTE)
    l.release(instanceId: "security", principalId: "synthetic", workspaceId: "ws", sessionId: "s",
        method: "session/submit", operationId: "op", contentDigest: "d")
    let reopened = IdempotencyLedger(cap: 2, storePath: path)
    @Expect(securityClaim(reopened, "op", "d").kind, LEDGER_KIND_EXECUTE)
}

@Test
func securityJournalCompactionPreservesPendingIntents() {
    let root = Directory.createTemp(getTempDirectory())
    let path = root.join("ledger.jsonl").toString()
    let l = IdempotencyLedger(cap: 2, storePath: path)
    @Expect(securityClaim(l, "pending", "d").kind, LEDGER_KIND_EXECUTE)
    for (i in 0..10) {
        @Expect(securityClaim(l, "done-${i}", "d").kind, LEDGER_KIND_EXECUTE)
        l.recordDone(instanceId: "security", principalId: "synthetic", workspaceId: "ws", sessionId: "s",
            method: "session/submit", operationId: "done-${i}", contentDigest: "d", receipt: "{\"result\":{}}")
    }
    let reopened = IdempotencyLedger(cap: 2, storePath: path)
    let hit = securityClaim(reopened, "pending", "d")
    @Expect(hit.kind, LEDGER_KIND_REPLAY)
    @Expect(ledgerIsUnknown(hit.receipt), true)
    @Expect(l.persistedFailureCount(), 0)
}

@Test
func securityMalformedBusinessReceiptRemainsUnknown() {
    @Expect(ledgerDisposition("not-json"), LEDGER_DISPOSITION_UNKNOWN)
    @Expect(ledgerDisposition("{}"), LEDGER_DISPOSITION_UNKNOWN)
    @Expect(ledgerDisposition("{\"error\":{}}"), LEDGER_DISPOSITION_UNKNOWN)
}
