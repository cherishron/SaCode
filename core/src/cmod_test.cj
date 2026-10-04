package core
import std.unittest.*

// 客户端模块上游契约（M5/M6）：`ctx.clientModules` 提供纯进程内的模块装载表；
// `register(id, version)` 落名；`activate(id)` 触发；`isLoaded()` 查状态；
// 未知名 activate 拒。本切片以纯进程内 `ClientModuleRegistry` 承接四件核心。

@Test
func clientModuleRegisterAndActivate() {
    let reg = ClientModuleRegistry()
    reg.register("panel", "1.0.0")
    @Expect(reg.isLoaded("panel"), false)
    reg.activate("panel")
    @Expect(reg.isLoaded("panel"), true)
}

@Test
func clientModuleUnknownActivateRejected() {
    let reg = ClientModuleRegistry()
    var threw = false
    try {
        reg.activate("ghost")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
}

@Test
func clientModuleDuplicateRegisterRejected() {
    let reg = ClientModuleRegistry()
    reg.register("panel", "1.0.0")
    var threw = false
    try {
        reg.register("panel", "2.0.0")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    @Expect(reg.size(), Int64(1))
}

@Test
func clientModuleEmptyIdOrVersionRejected() {
    let reg = ClientModuleRegistry()
    var threwId = false
    try {
        reg.register("", "1.0.0")
    } catch (e: Exception) {
        threwId = true
    }
    @Expect(threwId, true)
    var threwVer = false
    try {
        reg.register("panel", "")
    } catch (e: Exception) {
        threwVer = true
    }
    @Expect(threwVer, true)
}
