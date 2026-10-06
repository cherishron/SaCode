package core

import std.collection.ArrayList
import std.unittest.*

// 贡献面 SPI 测试：五类面各自的登记成功、重名拒绝、撤销移除、撤销幂等、撤销后 has() 为假。
// 同时测试统一归属账本的记录、按插件查询、整包移除与幂等。

@TestSuite
class PluginSurfaceTests {
    @Test
    func toolSurfaceRegisterRefuseRevoke() {
        let reg = ToolRegistry()
        let surface = ToolSurface(reg)
        let decl = ContributionDecl("tool", "search", "{}", false)
        let r = surface.register("myplugin", decl)
        @Expect(r.ok, true)
        @Expect(surface.has("search"), true)

        // 重名拒绝
        let r2 = surface.register("other", decl)
        @Expect(r2.refused, true)

        // 撤销移除
        let handle = r.handle.getOrThrow()
        let rev = surface.revoke(handle)
        @Expect(rev.wasPresent, true)
        @Expect(surface.has("search"), false)

        // 撤销幂等
        let rev2 = surface.revoke(handle)
        @Expect(rev2.wasPresent, false)
        @Expect(rev2.ok, true)
    }

    @Test
    func serviceSurfaceRegisterRefuseRevoke() {
        let reg = ServiceRegistry()
        let surface = ServiceSurface(reg)
        let decl = ContributionDecl("service", "myService", "{}", false)
        let r = surface.register("myplugin", decl)
        @Expect(r.ok, true)
        @Expect(surface.has("myService"), true)

        let r2 = surface.register("other", decl)
        @Expect(r2.refused, true)

        let handle = r.handle.getOrThrow()
        let rev = surface.revoke(handle)
        @Expect(rev.wasPresent, true)
        @Expect(surface.has("myService"), false)

        let rev2 = surface.revoke(handle)
        @Expect(rev2.wasPresent, false)
    }

    @Test
    func presetSurfaceRegisterRefuseRevoke() {
        let reg = PresetRegistry()
        let surface = PresetSurface(reg)
        let decl = ContributionDecl("preset", "myPreset", "{}", false)
        let r = surface.register("myplugin", decl)
        @Expect(r.ok, true)
        @Expect(surface.has("myPreset"), true)

        let r2 = surface.register("other", decl)
        @Expect(r2.refused, true)

        let handle = r.handle.getOrThrow()
        let rev = surface.revoke(handle)
        @Expect(rev.wasPresent, true)
        @Expect(surface.has("myPreset"), false)

        let rev2 = surface.revoke(handle)
        @Expect(rev2.wasPresent, false)
    }

    @Test
    func modelSurfaceRegisterRefuseRevoke() {
        let reg = ModelRegistry()
        let surface = ModelSurface(reg)
        let decl = ContributionDecl("model", "myModel", "{}", false)
        let r = surface.register("myplugin", decl)
        @Expect(r.ok, true)
        @Expect(surface.has("myModel"), true)

        let r2 = surface.register("other", decl)
        @Expect(r2.refused, true)

        let handle = r.handle.getOrThrow()
        let rev = surface.revoke(handle)
        @Expect(rev.wasPresent, true)
        @Expect(surface.has("myModel"), false)

        let rev2 = surface.revoke(handle)
        @Expect(rev2.wasPresent, false)
    }

    @Test
    func uiSurfaceRegisterRefuseRevoke() {
        let reg = UiRegistry()
        let surface = UiSurface(reg)
        let decl = ContributionDecl("ui", "myWidget", "{}", false)
        let r = surface.register("myplugin", decl)
        @Expect(r.ok, true)
        @Expect(surface.has("myWidget"), true)

        let r2 = surface.register("other", decl)
        @Expect(r2.refused, true)

        let handle = r.handle.getOrThrow()
        let rev = surface.revoke(handle)
        @Expect(rev.wasPresent, true)
        @Expect(surface.has("myWidget"), false)

        let rev2 = surface.revoke(handle)
        @Expect(rev2.wasPresent, false)
    }

    @Test
    func contributionLedgerRecordQueryRemove() {
        let ledger = ContributionLedger()
        let h1 = ContributionHandle("pluginA", "tool", "tool1")
        let h2 = ContributionHandle("pluginA", "service", "svc1")
        let h3 = ContributionHandle("pluginB", "model", "model1")

        ledger.record("pluginA", h1, "tool")
        ledger.record("pluginA", h2, "service")
        ledger.record("pluginB", h3, "model")

        // 查询 pluginA 的贡献
        let handles = ledger.handlesOf("pluginA")
        @Expect(Int64(handles.size), Int64(2))

        // 幂等：重复登记不增加
        ledger.record("pluginA", h1, "tool")
        @Expect(ledger.count(), Int64(3))

        // 整包移除 pluginA
        let removed = ledger.removeAll("pluginA")
        @Expect(Int64(removed.size), Int64(2))
        @Expect(ledger.hasContributions("pluginA"), false)
        @Expect(ledger.hasContributions("pluginB"), true)

        // 再次移除（幂等）
        let removed2 = ledger.removeAll("pluginA")
        @Expect(Int64(removed2.size), Int64(0))
    }
}
