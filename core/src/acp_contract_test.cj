package core
import std.unittest.*

// ACP 契约闭集与能力声明类型的单测（任务 2.1）。
// 验收：正向 闭集取值与 design §2.2.2 一致；失败/越权 未知 phase/reason 拒绝；恢复/并发 纯数据无状态。

@Test
func acpContractDelegationPhasesClosedSetMatchesDesign() {
    @Expect(acpPhaseCount(), Int64(15))
    @Expect(acpPhaseValid("pending"), true)
    @Expect(acpPhaseValid("initializing"), true)
    @Expect(acpPhaseValid("running"), true)
    @Expect(acpPhaseValid("awaiting-permission"), true)
    @Expect(acpPhaseValid("outcome-unknown"), true)
    @Expect(acpPhaseValid("rejected"), true)
    @Expect(acpPhaseValid("completed"), true)
    @Expect(acpPhaseValid("cancelled"), true)
    @Expect(acpPhaseValid("nonsense"), false)
    @Expect(acpPhaseValid(""), false)
    @Expect(acpPhaseValid("success"), false)
}

@Test
func acpContractFailReasonsClosedSetMatchesDesign() {
    @Expect(acpFailReasonCount(), Int64(10))
    @Expect(acpFailReasonValid("invalid-input"), true)
    @Expect(acpFailReasonValid("revision-conflict"), true)
    @Expect(acpFailReasonValid("not-authorized"), true)
    @Expect(acpFailReasonValid("unsupported"), true)
    @Expect(acpFailReasonValid("provider-unavailable"), true)
    @Expect(acpFailReasonValid("persistence-failed"), true)
    @Expect(acpFailReasonValid("outcome-unknown"), true)
    @Expect(acpFailReasonValid("额度耗尽"), false)
    @Expect(acpFailReasonValid("unknown"), false)
}

@Test
func acpContractPermissionElicitationProbeClosedSets() {
    @Expect(acpPermissionDecisionCount(), Int64(3))
    @Expect(acpPermissionDecisionValid("allowed-once"), true)
    @Expect(acpPermissionDecisionValid("denied"), true)
    @Expect(acpPermissionDecisionValid("expired"), true)
    @Expect(acpPermissionDecisionValid("always"), false)
    @Expect(acpElicitationDecisionCount(), Int64(3))
    @Expect(acpElicitationDecisionValid("submitted"), true)
    @Expect(acpElicitationDecisionValid("abandoned"), true)
    @Expect(acpElicitationDecisionValid("expired"), true)
    @Expect(acpElicitationDecisionValid("cancelled"), false)
    @Expect(acpProbeVerdictCount(), Int64(3))
    @Expect(acpProbeVerdictValid("measured"), true)
    @Expect(acpProbeVerdictValid("pending-verification"), true)
    @Expect(acpProbeVerdictValid("blocked"), true)
    @Expect(acpProbeVerdictValid("verified"), false)
}

@Test
func acpContractEnvAndInstallClosedSets() {
    @Expect(acpEnvStateCount(), Int64(6))
    @Expect(acpEnvStateValid("not-installed"), true)
    @Expect(acpEnvStateValid("installed-usable"), true)
    @Expect(acpEnvStateValid("installed-auth-missing"), true)
    @Expect(acpEnvStateValid("entry-unsupported"), true)
    @Expect(acpEnvStateValid("probe-failed-unknown"), true)
    @Expect(acpEnvStateValid("pending-verification"), true)
    @Expect(acpEnvStateValid("installed"), false)
    @Expect(acpInstallPhaseCount(), Int64(6))
    @Expect(acpInstallPhaseValid("awaiting-authorization"), true)
    @Expect(acpInstallPhaseValid("running"), true)
    @Expect(acpInstallPhaseValid("succeeded"), true)
    @Expect(acpInstallPhaseValid("failed"), true)
    @Expect(acpInstallPhaseValid("cancelled"), true)
    @Expect(acpInstallPhaseValid("timed-out"), true)
    @Expect(acpInstallPhaseValid("pending"), false)
}

@Test
func acpContractCapabilityKindSupportsVerbAndCarriesFields() {
    let verbs: Array<String> = ["initialize", "session/new", "session/cancel"]
    let auth: Array<String> = ["env"]
    let cfg: Array<String> = ["context-window"]
    let dialect: Array<String> = ["session/set_multitask"]
    let cap = AcpCapabilityKind("2025-11", auth, verbs, true, true, cfg, dialect)
    @Expect(cap.version, "2025-11")
    @Expect(cap.supports("initialize"), true)
    @Expect(cap.supports("session/new"), true)
    @Expect(cap.supports("session/cancel"), true)
    @Expect(cap.supports("session/prompt"), false)
    @Expect(cap.supports("bogus"), false)
    @Expect(cap.toolProxy, true)
    @Expect(cap.multitask, true)
    let std = AcpCapabilityKind("2025-11", auth, ["initialize", "session/prompt"], false, false, cfg, dialect)
    @Expect(std.supports("session/set_multitask"), false)
    @Expect(std.toolProxy, false)
    @Expect(std.multitask, false)
}