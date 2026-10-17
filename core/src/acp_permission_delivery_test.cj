package core
import std.fs.*
import std.unittest.*

class AcpPermissionDeliveryFixture {
    let root: String
    let log: SessionLog
    let lease: WriteLease
    let desk: ApprovalDesk
    let process: AcpProcess
    let delivery: AcpPermissionDelivery
    let frame: AcpInboundFrame
    public init() {
        root = Directory.createTemp(Path(coreTestRoot())).toString()
        log = SessionLog("${root}/session.log"); lease = WriteLease(log.path)
        if (!lease.acquire()) { throw Exception("fixture-lease-unavailable") }
        let fixture = "const rl=require('node:readline').createInterface({input:process.stdin});let replied=false;rl.on('line',s=>{const f=JSON.parse(s),send=o=>console.log(JSON.stringify(o));if(f.method==='initialize')send({jsonrpc:'2.0',id:f.id,result:{protocolVersion:1,agentCapabilities:{}}});else if(f.method==='session/new')send({jsonrpc:'2.0',id:f.id,result:{sessionId:'fixture'}});else if(f.method==='session/prompt')send({jsonrpc:'2.0',id:'permission',method:'session/request_permission',params:{sessionId:'fixture',toolCall:{toolCallId:'tool1'},options:[{optionId:'once',name:'Once',kind:'allow_once'},{optionId:'reject',name:'Reject',kind:'reject_once'}]}});else if(f.method==='probe/ready')send({jsonrpc:'2.0',id:f.id,result:{ready:true}});else if(f.method==='probe/close-input'){rl.close();process.stdin.on('error',()=>{});try{require('node:fs').closeSync(0);}catch{}send({jsonrpc:'2.0',id:f.id,result:{closed:true}});process.exit(0);}else if(f.method==='probe/status')send({jsonrpc:'2.0',id:f.id,result:{replied}});else if(f.id==='permission'){replied=true;send({jsonrpc:'2.0',id:3,result:{stopReason:'end_turn',approved:f.result?.outcome?.optionId==='once'}});}});"
        let journal = AcpDelegationJournal(log, lease, "sess-1")
        let workingRoot = root
        let service = AcpDelegationService("sess-1", acpCreationCancelGate(), { _ => AcpProcess("node", ["-e", fixture], workingDirectory: Path(workingRoot)) }, journal: Some(journal))
        let snapshot = service.create("task", "request", "opencode", "fixture task", root)
        if (snapshot.phase != "running") { throw Exception("fixture-start-failed:${snapshot.result}") }
        process = service.permissionProcess(snapshot.id).getOrThrow()
        desk = ApprovalDesk(log)
        let bridge = AcpApprovalBridge(desk, service, "sess-1")
        delivery = AcpPermissionDelivery(bridge, lease, snapshot.id)
        if (!process.sendRequest(3, "session/prompt", "{\"sessionId\":\"fixture\",\"prompt\":[{\"type\":\"text\",\"text\":\"fixture task\"}]}")) { throw Exception("fixture-prompt-failed") }
        process.request(4, "probe/ready", "{}").getOrThrow()
        frame = process.nextInbound().getOrThrow()
    }
    func close() { process.kill(); lease.release(); removeIfExists(root, recursive: true) }
}

@Test
func acpPermissionDeliveryPublishesActualApprovalBeforeRealReply() {
    let fixture = AcpPermissionDeliveryFixture()
    try {
        let id = fixture.delivery.accept(fixture.frame)
        @Expect(fixture.log.pendingCount(), 0)
        @Expect(fixture.desk.stateOf(id), "pending")
        @Expect(fixture.delivery.answer(id, "allowed-once", "missing").state, "not-sent")
        @Expect(fixture.desk.stateOf(id), "pending")
        @Expect(fixture.delivery.answer(id, "allowed-once", "once").state, "sent")
        @Expect(fixture.desk.stateOf(id), "used")
        @Expect(fixture.log.pendingCount(), 0)
        @Expect(fixture.process.awaitReply(3, 5000).getOrThrow().contains("\"approved\":true"), true)
        let before = fixture.log.snapshotEvents().size
        @Expect(fixture.delivery.answer(id, "allowed-once", "once").reason, "already-decided")
        @Expect(fixture.log.snapshotEvents().size, before)
        @ExpectThrows[Exception](fixture.delivery.accept(fixture.frame))
        var requests: Int64 = 0; var decisions: Int64 = 0; var sent: Int64 = 0
        for (event in fixture.log.snapshotEvents()) {
            if (event.eventType == "acp/permission/request") { requests += 1 }
            if (event.eventType == "acp/permission/decided") { decisions += 1 }
            if (event.eventType == "acp/permission/sent") { sent += 1 }
        }
        @Expect(requests, 1); @Expect(decisions, 1); @Expect(sent, 1)
    } finally { fixture.close() }
}

@Test
func acpPermissionDeliveryPublicationFailureNeverSendsGrant() {
    let fixture = AcpPermissionDeliveryFixture()
    try {
        let id = fixture.delivery.accept(fixture.frame)
        File.writeTo(fixture.log.path, "changed-prefix\n".toArray())
        let result = fixture.delivery.answer(id, "allowed-once", "once")
        @Expect(result.state, "not-sent")
        @Expect(result.reason, "persistence-failed:acp-permission-decision")
        @Expect(fixture.log.isDurableFrozen(), true)
        @Expect(fixture.desk.stateOf(id), "used")
        @Expect(fixture.process.request(5, "probe/status", "{}").getOrThrow().contains("\"replied\":false"), true)
        @Expect(fixture.delivery.answer(id, "allowed-once", "once").reason, "already-decided")
    } finally { fixture.close() }
}

@Test
func acpPermissionDeliveryWithoutLeaseDoesNotIssueTicket() {
    let fixture = AcpPermissionDeliveryFixture()
    try {
        fixture.lease.release()
        let before = fixture.log.snapshotEvents().size
        @ExpectThrows[Exception](fixture.delivery.accept(fixture.frame))
        @Expect(fixture.desk.pendingCount(), 0)
        @Expect(fixture.log.snapshotEvents().size, before)
    } finally { fixture.close() }
}

@Test
func acpPermissionDeliveryWriteFailureIsUnknownAndNeverRetried() {
    let fixture = AcpPermissionDeliveryFixture()
    try {
        let id = fixture.delivery.accept(fixture.frame)
        @Expect(fixture.process.request(6, "probe/close-input", "{}").getOrThrow().contains("\"closed\":true"), true)
        @Expect(fixture.process.proc.getOrThrow().wait(timeout: 1000 * Duration.millisecond), 0)
        let result = fixture.delivery.answer(id, "allowed-once", "once")
        @Expect(result.state, "outcome-unknown")
        @Expect(result.reason, "permission-write-unconfirmed")
        @Expect(fixture.desk.stateOf(id), "used")
        @Expect(fixture.delivery.answer(id, "allowed-once", "once").reason, "already-decided")
    } finally { fixture.close() }
}

@Test
func acpPermissionRecoveryNeverRestoresGrantOrStartsProcess() {
    let fixture = AcpPermissionDeliveryFixture()
    try {
        let id = fixture.delivery.accept(fixture.frame)
        @Expect(fixture.delivery.answer(id, "allowed-once", "once").state, "sent")
        fixture.process.awaitReply(3, 5000).getOrThrow()
        let replay = SessionLog(fixture.log.path)
        replay.load()
        let counter = AcpPermissionWireCounter()
        let workingRoot = fixture.root
        let recovered = AcpDelegationService("sess-1", acpCreationCancelGate(), { _ => counter.writes += 1; AcpProcess("node", ["-e", "process.exit(99)"], workingDirectory: Path(workingRoot)) }, journal: Some(AcpDelegationJournal(replay, fixture.lease, "sess-1")))
        @Expect(recovered.list()[0].phase, "outcome-unknown")
        let desk = ApprovalDesk(replay)
        @Expect(desk.stateOf(id), "unknown")
        let bridge = AcpApprovalBridge(desk, recovered, "sess-1")
        @ExpectThrows[Exception](AcpPermissionDelivery(bridge, fixture.lease, recovered.list()[0].id))
        @Expect(counter.writes, 0)
    } finally { fixture.close() }
}

@Test
func acpPermissionDeliveryRejectsSeparateApprovalJournal() {
    let fixture = AcpPermissionDeliveryFixture()
    try {
        let desk = ApprovalDesk(SessionLog("${fixture.root}/other.log"))
        let bridge = AcpApprovalBridge(desk, fixture.delivery.bridge.delegations, "sess-1")
        @ExpectThrows[Exception](AcpPermissionDelivery(bridge, fixture.lease, fixture.delivery.delegationId))
    } finally { fixture.close() }
}
