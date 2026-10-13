package core
import std.fs.*
import std.unittest.*

// AcpApprovalBridge 单测（任务 4.1）。
// 验收：正向 生成审批卡并回传用户决定；
// 失败/越权 跨委派复用被拒；恢复/并发 重启不恢复放行、工单进程内绑定。

// 假钟使用不可变对象引用，避免逃逸 lambda 捕获可变局部变量。
class AcpApprovalClock {
    var now: Int64 = 0
}

// 仅桥接层单测的显式运行态夹具，不代表真实进程或权限协议验收。
func acpSeedApprovalDelegations(service: AcpDelegationService) {
    for (id in ["delegation-1", "delegation-A", "delegation-B"]) {
        let entry = AcpDelegationEntry(id, "sess-1", "task", "request-${id}", "opencode", "digest", ".")
        entry.phase = "running"; entry.revision = 1; entry.protocolSessionId = "protocol-${id}"
        service.delegations[id] = entry
    }
}
@Test
func acpApprovalBridgeAskAndAnswerAllowedOnce() {
    let path = "acp-approval-ask-allow.log"; removeIfExists(path)
    let log = SessionLog(path); let lease = WriteLease(path)
    let desk = ApprovalDesk(log)
    let settings = AcpSettingsService()
    let gate = AcpGate(settings)
    let svc = AcpDelegationService("sess-1", gate, { peerId => AcpProcess("echo", [], workingDirectory: Path(".")) })
    acpSeedApprovalDelegations(svc)
    let bridge = AcpApprovalBridge(desk, svc, "sess-1")
    let proposal = AcpPermissionProposal("write_file", "写入 src/foo.ts", "write_file:src/foo.ts:content...")
    let id = bridge.askPermission("delegation-1", proposal)
    @Expect(id > Int64(0), true)
    // 批准 → consumeExactForCall 精确匹配
    let granted = bridge.answerPermission(id, "allowed-once")
    @Expect(granted, true)
    @Expect(desk.stateOf(id), "used")
    @Expect(bridge.answerPermission(id, "allowed-once"), false)
}

@Test
func acpApprovalBridgeDeniedDoesNotExecute() {
    let path = "acp-approval-deny.log"; removeIfExists(path)
    let log = SessionLog(path); let lease = WriteLease(path)
    let desk = ApprovalDesk(log)
    let settings = AcpSettingsService()
    let gate = AcpGate(settings)
    let svc = AcpDelegationService("sess-1", gate, { peerId => AcpProcess("echo", [], workingDirectory: Path(".")) })
    acpSeedApprovalDelegations(svc)
    let bridge = AcpApprovalBridge(desk, svc, "sess-1")
    let proposal = AcpPermissionProposal("run_command", "执行 npm test", "run_command:npm test")
    let id = bridge.askPermission("delegation-1", proposal)
    // 拒绝 → 不执行
    let denied = bridge.answerPermission(id, "denied")
    @Expect(denied, true)
    // 工单状态应为 denied
    @Expect(desk.stateOf(id), "denied")
}

@Test
func acpApprovalBridgeInvalidDecisionRejected() {
    let path = "acp-approval-invalid.log"; removeIfExists(path)
    let log = SessionLog(path); let lease = WriteLease(path)
    let desk = ApprovalDesk(log)
    let settings = AcpSettingsService()
    let gate = AcpGate(settings)
    let svc = AcpDelegationService("sess-1", gate, { peerId => AcpProcess("echo", [], workingDirectory: Path(".")) })
    acpSeedApprovalDelegations(svc)
    let bridge = AcpApprovalBridge(desk, svc, "sess-1")
    let proposal = AcpPermissionProposal("write_file", "写文件", "write_file:foo")
    let id = bridge.askPermission("delegation-1", proposal)
    // 非法决定 → 拒绝
    let invalid = bridge.answerPermission(id, "allowed-always")
    @Expect(invalid, false)
    // 工单仍 pending
    @Expect(desk.stateOf(id), "pending")
}

@Test
func acpApprovalBridgeProposalImmutable() {
    // 提案不可变：批准后不能修改提案内容
    let path = "acp-approval-immutable.log"; removeIfExists(path)
    let log = SessionLog(path); let lease = WriteLease(path)
    let desk = ApprovalDesk(log)
    let settings = AcpSettingsService()
    let gate = AcpGate(settings)
    let svc = AcpDelegationService("sess-1", gate, { peerId => AcpProcess("echo", [], workingDirectory: Path(".")) })
    acpSeedApprovalDelegations(svc)
    let bridge = AcpApprovalBridge(desk, svc, "sess-1")
    let proposal = AcpPermissionProposal("write_file", "写 src/foo.ts", "write_file:src/foo.ts:content1")
    let id = bridge.askPermission("delegation-1", proposal)
    // 直接调 desk.consumeExactForCall 传不同参数 → 不匹配
    let grant = desk.consumeExactForCall(id, "write_file", "sess-1:delegation-1:写 src/foo.ts:write_file:src/foo.ts:DIFERENT")
    @Expect(grant == "", true)
    // 工单仍 allowed-once（未消费）
    @Expect(desk.stateOf(id), "pending")
}

@Test
func acpApprovalBridgeCrossDelegationRejected() {
    // 跨委派复用被拒：approvalId 绑定了 delegationId=A，delegationId=B 消费不匹配
    let path = "acp-approval-cross.log"; removeIfExists(path)
    let log = SessionLog(path); let lease = WriteLease(path)
    let desk = ApprovalDesk(log)
    let settings = AcpSettingsService()
    let gate = AcpGate(settings)
    let svc = AcpDelegationService("sess-1", gate, { peerId => AcpProcess("echo", [], workingDirectory: Path(".")) })
    acpSeedApprovalDelegations(svc)
    let bridge = AcpApprovalBridge(desk, svc, "sess-1")
    let proposal = AcpPermissionProposal("write_file", "写文件", "write_file:foo:content")
    let id = bridge.askPermission("delegation-A", proposal)
    // 批准
    @Expect(bridge.answerPermission(id, "allowed-once"), true)
    // 已消费 → state=used
    @Expect(desk.stateOf(id), "used")
    // 再用同 id 消费 → 空串（一次性）
    let argsA = bridge.permissionArguments("delegation-A", proposal)
    let grantAgain = desk.consumeExactForCall(id, "write_file", argsA)
    @Expect(grantAgain == "", true)
}

@Test
func acpApprovalBridgeExpiredRejected() {
    // 过期工单：设短 TTL → 等 → 过期
    let path = "acp-approval-expired.log"; removeIfExists(path)
    let log = SessionLog(path); let lease = WriteLease(path)
    let fake = AcpApprovalClock()
    let desk = ApprovalDesk(log, clock: { => fake.now })
    let settings = AcpSettingsService()
    let gate = AcpGate(settings)
    let svc = AcpDelegationService("sess-1", gate, { peerId => AcpProcess("echo", [], workingDirectory: Path(".")) })
    acpSeedApprovalDelegations(svc)
    let bridge = AcpApprovalBridge(desk, svc, "sess-1")
    let proposal = AcpPermissionProposal("write_file", "写文件", "write_file:foo")
    let id = bridge.askPermission("delegation-1", proposal)
    // 推进假钟到过期后
    fake.now = Int64(200)
    // 过期后批准 → consumeExactForCall 找不到 allowed-once → 失败
    let expired = bridge.answerPermission(id, "allowed-once")
    @Expect(expired, false)
    @Expect(desk.stateOf(id), "expired")
}

@Test
func acpApprovalBridgePermissionArgumentsFormat() {
    let path = "acp-approval-args.log"; removeIfExists(path)
    let log = SessionLog(path)
    let desk = ApprovalDesk(log)
    let settings = AcpSettingsService()
    let gate = AcpGate(settings)
    let svc = AcpDelegationService("sess-1", gate, { peerId => AcpProcess("echo", [], workingDirectory: Path(".")) })
    acpSeedApprovalDelegations(svc)
    let bridge = AcpApprovalBridge(desk, svc, "sess-1")
    let proposal = AcpPermissionProposal("run_command", "执行测试", "run_command:npm test")
    let args = bridge.permissionArguments("delegation-1", proposal)
    // 格式：sessionId:delegationId:摘要:原文
    @Expect(args.contains("sess-1:"), true)
    @Expect(args.contains("delegation-1:"), true)
    @Expect(args.contains("执行测试:"), true)
    @Expect(args.contains("run_command:npm test"), true)
}

@Test
func acpApprovalBridgeElicitationDecisionValidation() {
    let path = "acp-approval-elicitation.log"; removeIfExists(path)
    let log = SessionLog(path)
    let desk = ApprovalDesk(log)
    let settings = AcpSettingsService()
    let gate = AcpGate(settings)
    let svc = AcpDelegationService("sess-1", gate, { peerId => AcpProcess("echo", [], workingDirectory: Path(".")) })
    acpSeedApprovalDelegations(svc)
    let bridge = AcpApprovalBridge(desk, svc, "sess-1")
    // 合法决定
    @Expect(bridge.answerElicitation("req-1", "submitted", "answer text"), true)
    @Expect(bridge.answerElicitation("req-1", "abandoned", ""), true)
    @Expect(bridge.answerElicitation("req-1", "expired", ""), true)
    // 非法决定
    @Expect(bridge.answerElicitation("req-1", "approved", ""), false)
    @Expect(bridge.answerElicitation("req-1", "", ""), false)
}

@Test
func acpApprovalBridgeDoubleAnswerRejected() {
    // 已结算工单不接受第二次应答
    let path = "acp-approval-double.log"; removeIfExists(path)
    let log = SessionLog(path); let lease = WriteLease(path)
    let desk = ApprovalDesk(log)
    let settings = AcpSettingsService()
    let gate = AcpGate(settings)
    let svc = AcpDelegationService("sess-1", gate, { peerId => AcpProcess("echo", [], workingDirectory: Path(".")) })
    acpSeedApprovalDelegations(svc)
    let bridge = AcpApprovalBridge(desk, svc, "sess-1")
    let proposal = AcpPermissionProposal("write_file", "写文件", "write_file:foo")
    let id = bridge.askPermission("delegation-1", proposal)
    @Expect(bridge.answerPermission(id, "denied"), true)
    // 第二次应答 → 被拒
    @Expect(bridge.answerPermission(id, "allowed-once"), false)
    @Expect(desk.stateOf(id), "denied")
}

@Test
func acpApprovalBridgePendingCount() {
    let path = "acp-approval-pending.log"; removeIfExists(path)
    let log = SessionLog(path); let lease = WriteLease(path)
    let desk = ApprovalDesk(log)
    let settings = AcpSettingsService()
    let gate = AcpGate(settings)
    let svc = AcpDelegationService("sess-1", gate, { peerId => AcpProcess("echo", [], workingDirectory: Path(".")) })
    acpSeedApprovalDelegations(svc)
    let bridge = AcpApprovalBridge(desk, svc, "sess-1")
    @Expect(bridge.pendingFor("delegation-1"), Int64(0))
    let proposal = AcpPermissionProposal("write_file", "写文件", "write_file:foo")
    let _ = bridge.askPermission("delegation-1", proposal)
    @Expect(bridge.pendingFor("delegation-1"), Int64(1))
}

func acpApprovalScopeFixture(): AcpDelegationService {
    let service = AcpDelegationService("sess-1", AcpGate(AcpSettingsService()), { _ => AcpProcess("nonexistent-approval-scope", [], workingDirectory: Path(".")) })
    acpSeedApprovalDelegations(service)
    return service
}

@Test
func acpApprovalRejectsMissingInactiveAndCrossSessionDelegations() {
    let desk = ApprovalDesk(SessionLog("approval-scope-missing.log"))
    let service = acpApprovalScopeFixture()
    @ExpectThrows[Exception](AcpApprovalBridge(desk, service, "other-session"))
    let bridge = AcpApprovalBridge(desk, service, "sess-1")
    let proposal = AcpPermissionProposal("write_file", "写文件", "body")
    @ExpectThrows[Exception](bridge.askPermission("missing", proposal))
    service.delegations.get("delegation-1").getOrThrow().phase = "failed"
    @ExpectThrows[Exception](bridge.askPermission("delegation-1", proposal))
    @Expect(desk.pendingCount(), 0)
}

@Test
func acpApprovalPendingCountIsDelegationScoped() {
    let desk = ApprovalDesk(SessionLog("approval-scope-count.log"))
    let bridge = AcpApprovalBridge(desk, acpApprovalScopeFixture(), "sess-1")
    let proposal = AcpPermissionProposal("write_file", "写文件", "body")
    let first = bridge.askPermission("delegation-A", proposal)
    bridge.askPermission("delegation-B", proposal)
    desk.ask("unrelated")
    @Expect(bridge.pendingFor("delegation-A"), 1)
    @Expect(bridge.pendingFor("delegation-B"), 1)
    @Expect(bridge.pendingFor("missing"), 0)
    @Expect(bridge.answerPermission(first, "denied"), true)
    @Expect(bridge.pendingFor("delegation-A"), 0)
    @Expect(bridge.pendingFor("delegation-B"), 1)
}

@Test
func acpApprovalRevisionAndProtocolIdentityChangesRejectGrant() {
    let desk = ApprovalDesk(SessionLog("approval-scope-revision.log"))
    let service = acpApprovalScopeFixture()
    let bridge = AcpApprovalBridge(desk, service, "sess-1")
    let proposal = AcpPermissionProposal("write_file", "写文件", "body")
    let entry = service.delegations.get("delegation-1").getOrThrow()
    let first = bridge.askPermission("delegation-1", proposal)
    entry.revision += 1
    @Expect(bridge.answerPermission(first, "allowed-once"), false)
    @Expect(desk.stateOf(first), "denied")
    let second = bridge.askPermission("delegation-1", proposal)
    entry.protocolSessionId = "other-protocol-session"
    @Expect(bridge.answerPermission(second, "allowed-once"), false)
    @Expect(desk.stateOf(second), "denied")
}

@Test
func acpApprovalCancelledTurnCannotConsumePendingGrant() {
    let desk = ApprovalDesk(SessionLog("approval-scope-cancel.log"))
    let service = acpApprovalScopeFixture()
    let bridge = AcpApprovalBridge(desk, service, "sess-1")
    let id = bridge.askPermission("delegation-1", AcpPermissionProposal("write_file", "写文件", "body"))
    service.delegations.get("delegation-1").getOrThrow().cancelToken.cancel()
    @Expect(bridge.answerPermission(id, "allowed-once"), false)
    @Expect(desk.stateOf(id), "denied")
}
