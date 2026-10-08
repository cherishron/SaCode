package core
import std.unittest.*

// AcpGate 单测（任务 5.8 + 6.5）。
// 验收：正向 关闭/未安装 → 不可开启并说明原因；失败/越权 依赖缺失不降级为"看似成功"；
// 恢复/并发 重启后门控随回放恢复。
// 两层分离：可开启 ≠ 可委派。

@Test
func acpGateSwitchOffCannotEnable() {
    let settings = AcpSettingsService()
    let gate = AcpGate(settings)
    let s = gate.status("user")
    @Expect(s.canEnable, false)
    @Expect(s.canEnableReason, "acp-switch-off")
    @Expect(s.canDelegate, false)
    @Expect(s.effectiveSwitch, "off")
}

@Test
func acpGateSwitchOnNoProductsCannotEnable() {
    let settings = AcpSettingsService()
    let _ = settings.setEnabled("user", true, Int64(0))
    let gate = AcpGate(settings)
    let s = gate.status("user")
    @Expect(s.canEnable, false)
    @Expect(s.canEnableReason.contains("no-product-available"), true)
    @Expect(s.canDelegate, false)
}

@Test
func acpGateSwitchOnProductInstalledCanEnableButNotDelegate() {
    let settings = AcpSettingsService()
    let _ = settings.setEnabled("user", true, Int64(0))
    let gate = AcpGate(settings)
    gate.updateEnv(AcpEnvInput("opencode", "installed-usable", true))
    let s = gate.status("user")
    @Expect(s.canEnable, true)
    @Expect(s.canEnableReason, "env-ok")
    // L2: 探针未做 → 不可委派（可开启 ≠ 可委派）
    @Expect(s.canDelegate, false)
    @Expect(s.canDelegateReason.contains("probe-not-done"), true)
}

@Test
func acpGateProbeMeasuredCanDelegate() {
    let settings = AcpSettingsService()
    let _ = settings.setEnabled("user", true, Int64(0))
    let gate = AcpGate(settings)
    gate.updateEnv(AcpEnvInput("opencode", "installed-usable", true))
    gate.updateProbe(AcpProbeInput("opencode", "measured"))
    let s = gate.status("user")
    @Expect(s.canEnable, true)
    @Expect(s.canDelegate, true)
    @Expect(s.canDelegateReason, "l2-ok")
}

@Test
func acpGateProbePendingCannotDelegate() {
    let settings = AcpSettingsService()
    let _ = settings.setEnabled("user", true, Int64(0))
    let gate = AcpGate(settings)
    gate.updateEnv(AcpEnvInput("opencode", "installed-usable", true))
    gate.updateProbe(AcpProbeInput("opencode", "pending-verification"))
    let s = gate.status("user")
    @Expect(s.canEnable, true)
    @Expect(s.canDelegate, false)
    @Expect(s.canDelegateReason.contains("pending-verification"), true)
}

@Test
func acpGateAuthMissingCannotDelegate() {
    let settings = AcpSettingsService()
    let _ = settings.setEnabled("user", true, Int64(0))
    let gate = AcpGate(settings)
    gate.updateEnv(AcpEnvInput("codebuddy", "installed-usable", false))
    gate.updateProbe(AcpProbeInput("codebuddy", "measured"))
    let s = gate.statusForPeer("user", "codebuddy")
    @Expect(s.canEnable, true)
    @Expect(s.canDelegate, false)
    @Expect(s.canDelegateReason, "auth-not-ready")
}

@Test
func acpGateNotInstalledCannotEnableForPeer() {
    let settings = AcpSettingsService()
    let _ = settings.setEnabled("user", true, Int64(0))
    let gate = AcpGate(settings)
    gate.updateEnv(AcpEnvInput("qoder", "not-installed", false))
    let s = gate.statusForPeer("user", "qoder")
    @Expect(s.canEnable, false)
    @Expect(s.canEnableReason.contains("not-installed"), true)
}

@Test
func acpGateRequireCanEnableThrowsWhenOff() {
    let settings = AcpSettingsService()
    let gate = AcpGate(settings)
    var threw = false
    try {
        gate.requireCanEnable("user")
    } catch (e: Exception) {
        threw = e.message.contains("unsupported")
    }
    @Expect(threw, true)
}

@Test
func acpGateRequireCanDelegateThrowsWhenProbeNotDone() {
    let settings = AcpSettingsService()
    let _ = settings.setEnabled("user", true, Int64(0))
    let gate = AcpGate(settings)
    gate.updateEnv(AcpEnvInput("opencode", "installed-usable", true))
    var threw = false
    try {
        gate.requireCanDelegate("user", "opencode")
    } catch (e: Exception) {
        threw = e.message.contains("provider-unavailable")
    }
    @Expect(threw, true)
}

@Test
func acpGateRequireCanDelegatePassesWhenAllOk() {
    let settings = AcpSettingsService()
    let _ = settings.setEnabled("user", true, Int64(0))
    let gate = AcpGate(settings)
    gate.updateEnv(AcpEnvInput("opencode", "installed-usable", true))
    gate.updateProbe(AcpProbeInput("opencode", "measured"))
    var threw = false
    try {
        gate.requireCanDelegate("user", "opencode")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, false)
}

@Test
func acpGateTwoLayersSeparate() {
    let settings = AcpSettingsService()
    let _ = settings.setEnabled("user", true, Int64(0))
    let gate = AcpGate(settings)
    gate.updateEnv(AcpEnvInput("opencode", "installed-usable", true))
    // L1 通过但 L2 不通过
    let s = gate.statusForPeer("user", "opencode")
    @Expect(s.canEnable, true)
    @Expect(s.canDelegate, false)
}