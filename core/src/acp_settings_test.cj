package core
import std.collection.HashMap
import std.unittest.*

// AcpSettingsService 单测（任务 5.1）。
// 验收：正向 展示最终有效值与来源；失败/越权 expectedRevision 不符 revision-conflict，项目级不扩大授权；
// 恢复/并发 重启恢复上次值与来源不重置默认。

@Test
func acpSettingsDefaultIsOffFromDefault() {
    let svc = AcpSettingsService()
    let snap = svc.describe("user")
    @Expect(snap.enabled, false)
    @Expect(snap.effective, "off")
    @Expect(snap.source, "default")
    @Expect(snap.revision, Int64(0))
}

@Test
func acpSettingsSetEnabledUserScope() {
    let svc = AcpSettingsService()
    let snap = svc.setEnabled("user", true, Int64(0))
    @Expect(snap.enabled, true)
    @Expect(snap.effective, "on")
    @Expect(snap.source, "user")
    @Expect(snap.revision, Int64(1))
}

@Test
func acpSettingsSetEnabledRevisionConflict() {
    let svc = AcpSettingsService()
    var threw = false
    try {
        let _ = svc.setEnabled("user", true, Int64(99))
    } catch (e: Exception) {
        threw = e.message.contains("revision-conflict")
    }
    @Expect(threw, true)
}

@Test
func acpSettingsProjectOverridesUser() {
    let svc = AcpSettingsService()
    let _ = svc.setEnabled("user", true, Int64(0))
    // 用户级开了，但项目级没改过 → 项目级回看用户级
    let projectSnap = svc.describe("project")
    @Expect(projectSnap.enabled, true)
    @Expect(projectSnap.source, "user")
    // 项目级改过后 → 项目级自己
    let _ = svc.setEnabled("project", false, Int64(0))
    let projectSnap2 = svc.describe("project")
    @Expect(projectSnap2.enabled, false)
    @Expect(projectSnap2.source, "project")
}

@Test
func acpSettingsSetWeight() {
    let svc = AcpSettingsService()
    let snap = svc.setWeight("user", "opencode", Int64(50), Int64(0))
    @Expect(snap.revision, Int64(1))
    let snap2 = svc.describe("user")
    @Expect(snap2.weights.get("opencode").getOrThrow(), Int64(50))
}

@Test
func acpSettingsSetWeightRevisionConflict() {
    let svc = AcpSettingsService()
    var threw = false
    try {
        let _ = svc.setWeight("user", "opencode", Int64(50), Int64(99))
    } catch (e: Exception) {
        threw = e.message.contains("revision-conflict")
    }
    @Expect(threw, true)
}

@Test
func acpSettingsIsEffectiveEnabled() {
    let svc = AcpSettingsService()
    @Expect(svc.isEffectiveEnabled("user"), false)
    let _ = svc.setEnabled("user", true, Int64(0))
    @Expect(svc.isEffectiveEnabled("user"), true)
}

@Test
func acpSettingsMultipleUpdatesIncrementRevision() {
    let svc = AcpSettingsService()
    let s1 = svc.setEnabled("user", true, Int64(0))
    @Expect(s1.revision, Int64(1))
    let s2 = svc.setWeight("user", "opencode", Int64(10), Int64(1))
    @Expect(s2.revision, Int64(2))
    let s3 = svc.setEnabled("user", false, Int64(2))
    @Expect(s3.revision, Int64(3))
    @Expect(s3.enabled, false)
}