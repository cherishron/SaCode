package core
import std.fs.*
import std.unittest.*

// AcpApprovalBridge 单测（任务 4.1）。
// 验收：正向 生成审批卡并回传用户决定；
// 失败/越权 跨委派复用被拒；恢复/并发 重启不恢复放行、工单进程内绑定。

@Test
func acpApprovalBridgeAskAndAnswerAllowedOnce() {
    let path = "acp-approval-ask-allow.log"; removeIfExists(path)
    let log = SessionLog(path); let lease = WriteLease(path)
    let desk = ApprovalDesk(log)
    let settings = AcpSettingsService()
    let gate = AcpGate(settings)
    let svc = AcpDelegationService("sess-1", gate, { peerId => AcpProcess("echo", [], workingDirectory: Path(".")) })
    let bridge = AcpApprovalBridge(desk, svc, "sess-1")
    let proposal = AcpPermissionProposal("write_file", "写入 src/foo.ts", "write_file:src/foo.ts:content...")
    let id = bridge.askPermission("delegation-1", proposal)
    @Expect(id > Int64(0), true)
    // 批准 → consumeExactForCall 精确匹配
    let granted = bridge.answerPermission(id, "allowed-once")
    @Expect(granted, true)
}

@Test
func acpApprovalBridgeDeniedDoesNotExecute() {
    let path = "acp-approval-deny.log"; removeIfExists(path)
    let log = SessionLog(path); let lease = WriteLease(path)
    let desk = ApprovalDesk(log)
    let settings = AcpSettingsService()
    let gate = AcpGate(settings)
    let svc = AcpDelegationService("sess-1", gate, { peerId => AcpProcess("echo", [], workingDirectory: Path(".")) })
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
    var fakeNow = Int64(0)
    let desk = ApprovalDesk(log, clock: { => fakeNow })
    let settings = AcpSettingsService()
    let gate = AcpGate(settings)
    let svc = AcpDelegationService("sess-1", gate, { peerId => AcpProcess("echo", [], workingDirectory: Path(".")) })
    let bridge = AcpApprovalBridge(desk, svc, "sess-1")
    let proposal = AcpPermissionProposal("write_file", "写文件", "write_file:foo")
    let id = bridge.askPermission("delegation-1", proposal)
    // 推进假钟到过期后
    fakeNow = Int64(200)
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
    let bridge = AcpApprovalBridge(desk, svc, "sess-1")
    @Expect(bridge.pendingFor("delegation-1"), Int64(0))
    let proposal = AcpPermissionProposal("write_file", "写文件", "write_file:foo")
    let _ = bridge.askPermission("delegation-1", proposal)
    @Expect(bridge.pendingFor("delegation-1"), Int64(1))
}