package core
import std.fs.*
import std.env.*
import std.unittest.*
import stdx.encoding.json.*

class AcpTaskFixture {
    let root: String
    let log: SessionLog
    let lease: WriteLease
    let service: AcpDelegationService
    let snapshot: AcpDelegationSnapshot
    let process: AcpProcess
    init(reason: String, program!: String = "", peerId!: String = "opencode") {
        root = canonicalize(Directory.createTemp(Path(getVariable("TMP").getOrThrow()))).toString()
        log = SessionLog(Path(root).join("session.log").toString())
        lease = WriteLease(log.path)
        if (!lease.acquire()) { throw Exception("fixture-lease-failed") }
        let settings = AcpSettingsService(); settings.setEnabled("user", true, 0)
        let gate = AcpGate(settings)
        gate.updateEnv(AcpEnvInput(peerId, "installed-usable", true))
        gate.updateProbe(AcpProbeInput(peerId, "measured"))
        let defaultProgram = "const fs=require('node:fs'),p=require('node:path');let pending;const send=(id,result)=>console.log(JSON.stringify({jsonrpc:'2.0',id,result}));require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line);if(q.method==='initialize')send(q.id,{protocolVersion:1,agentCapabilities:{}});else if(q.method==='session/new')send(q.id,{sessionId:'fixture'});else if(q.method==='session/prompt'){pending=q.id;fs.appendFileSync(p.join(process.cwd(),'prompt-count'),'1');if('${reason}'!=='timeout'&&'${reason}'!=='wait-cancel')send(q.id,{stopReason:'${reason}'});}else if(q.method==='session/cancel'&&pending)send(pending,{stopReason:'cancelled'});});"
        let script = if (program.size > 0) { program } else { defaultProgram }
        let workingRoot = root
        service = AcpDelegationService("s1", gate, { _ => AcpProcess("node", ["-e", script], workingDirectory: Path(workingRoot)) },
            journal: Some(AcpDelegationJournal(log, lease, "s1")))
        snapshot = service.create("task", "request", peerId, "fixture task", root)
        if (snapshot.phase != "running") { throw Exception("fixture-create:${snapshot.result}") }
        process = service.permissionProcess(snapshot.id).getOrThrow()
    }
    func close() { process.kill(); lease.release(); removeIfExists(root, recursive: true) }
}

@Test
func acpTaskSendsBoundPromptOnceAndPublishesEndTurn() {
    let f = AcpTaskFixture("end_turn")
    try {
        @ExpectThrows[Exception](f.service.runTask(f.snapshot.id, f.snapshot.revision, "different task"))
        let done = f.service.runTask(f.snapshot.id, f.snapshot.revision, "fixture task", timeoutMs: 5000)
        @Expect(done.phase, "completed")
        @Expect(done.result, "prompt-stop:end_turn")
        @Expect(String.fromUtf8(File.readFrom(Path(f.root).join("prompt-count"))), "1")
        @Expect(f.log.pendingCount(), 0)
        var starts: Int64 = 0; var settled: Int64 = 0
        for (event in f.log.snapshotEvents()) {
            if (event.eventType == "acp/task/start") { starts += 1 }
            if (event.eventType == "acp/task/settled") { settled += 1 }
        }
        @Expect(starts, 1); @Expect(settled, 1)
        @ExpectThrows[Exception](f.service.runTask(done.id, done.revision, "fixture task"))
        let recovered = AcpDelegationService("s1", AcpGate(AcpSettingsService()),
            { _ => throw Exception("recovery-must-not-spawn") }, journal: Some(AcpDelegationJournal(f.log, f.lease, "s1")))
        @Expect(recovered.describe(done.id).phase, "completed")
        @Expect(recovered.describe(done.id).result, "prompt-stop:end_turn")
        @ExpectThrows[Exception](recovered.runTask(done.id, recovered.describe(done.id).revision, "fixture task"))
    } finally { f.close() }
}

@Test
func acpTaskWithoutWriteLeaseDoesNotSendPrompt() {
    let f = AcpTaskFixture("end_turn")
    try {
        f.lease.release()
        let done = f.service.runTask(f.snapshot.id, f.snapshot.revision, "fixture task")
        @Expect(done.result, "persistence-failed:acp-task-start")
        @Expect(exists(Path(f.root).join("prompt-count")), false)
    } finally { f.close() }
}

@Test
func acpTaskTimeoutIsUnknownAndCannotReplay() {
    let f = AcpTaskFixture("timeout")
    try {
        let done = f.service.runTask(f.snapshot.id, f.snapshot.revision, "fixture task", timeoutMs: 100)
        @Expect(done.phase, "outcome-unknown")
        @ExpectThrows[Exception](f.service.runTask(done.id, done.revision, "fixture task"))
        @Expect(String.fromUtf8(File.readFrom(Path(f.root).join("prompt-count"))), "1")
        let recovered = AcpDelegationService("s1", AcpGate(AcpSettingsService()),
            { _ => throw Exception("recovery-must-not-spawn") }, journal: Some(AcpDelegationJournal(f.log, f.lease, "s1")))
        let old = recovered.describe(done.id)
        @Expect(old.phase, "outcome-unknown")
        @ExpectThrows[Exception](recovered.runTask(old.id, old.revision, "fixture task"))
    } finally { f.close() }
}

@Test
func acpTaskUnknownStopReasonDoesNotClaimCompletion() {
    let f = AcpTaskFixture("invented-success")
    try {
        let done = f.service.runTask(f.snapshot.id, f.snapshot.revision, "fixture task", timeoutMs: 5000)
        @Expect(done.phase, "outcome-unknown")
    } finally { f.close() }
}

@Test
func acpTaskCancellationRequiresCorrespondingPromptReply() {
    let f = AcpTaskFixture("wait-cancel")
    try {
        let result = spawn { => f.service.runTask(f.snapshot.id, f.snapshot.revision, "fixture task", timeoutMs: 5000) }
        for (_ in 0..1000) {
            if (exists(Path(f.root).join("prompt-count"))) { break }
            sleep(2 * Duration.millisecond)
        }
        let current = f.service.describe(f.snapshot.id)
        let cancelling = f.service.cancel(current.id, current.revision)
        @Expect(cancelling.phase == "outcome-unknown" || cancelling.phase == "cancelled", true)
        let done = result.get(6000 * Duration.millisecond)
        @Expect(done.phase, "cancelled")
        @Expect(done.result, "prompt-stop:cancelled")
    } finally { f.close() }
}

@Test
func acpTaskRechecksDisabledDelegationGateBeforeSending() {
    let f = AcpTaskFixture("end_turn")
    try {
        let settings = f.service.gate.settings
        settings.setEnabled("user", false, settings.describe("user").revision)
        @ExpectThrows[Exception](f.service.runTask(f.snapshot.id, f.snapshot.revision, "fixture task"))
        @Expect(exists(Path(f.root).join("prompt-count")), false)
    } finally { f.close() }
}

@Test
func acpTaskRecoveryRejectsDuplicateSettlementFact() {
    let f = AcpTaskFixture("end_turn")
    try {
        f.service.runTask(f.snapshot.id, f.snapshot.revision, "fixture task", timeoutMs: 5000)
        var fact = ""
        for (event in f.log.snapshotEvents()) { if (event.eventType == "acp/task/settled") { fact = event.data } }
        f.log.append("acp/task/settled", fact)
        @Expect(f.log.durableCheckpoint(f.lease), true)
        @ExpectThrows[Exception](AcpDelegationJournal(f.log, f.lease, "s1").recover())
    } finally { f.close() }
}

@Test
func acpTaskRecoveryRejectsCrossTaskStartFact() {
    let f = AcpTaskFixture("timeout")
    try {
        f.service.runTask(f.snapshot.id, f.snapshot.revision, "fixture task", timeoutMs: 100)
        var fact = ""
        for (event in f.log.snapshotEvents()) { if (event.eventType == "acp/task/start") { fact = event.data } }
        let wrong = JsonValue.fromStr(fact).asObject()
        wrong.put("taskId", JsonString("other-task"))
        f.log.append("acp/task/start", wrong.toString())
        @Expect(f.log.durableCheckpoint(f.lease), true)
        @ExpectThrows[Exception](AcpDelegationJournal(f.log, f.lease, "s1").recover())
    } finally { f.close() }
}
