package core
import std.unittest.*

// Sidebar/Rightbar 上游契约（M5/M6）：React 组合系统里有 tab-type registry；
// 本仓 Vue runtime 架构根本不同，只做非渲染 tab-type 元数据登记。
// `register(tabId, kind)` + `list()` + `unregister(tabId)`；kind 走白名单
// （panel / view / widget 三选一）。

@Test
func tabsRegisterAndList() {
    let r = TabTypeRegistry()
    r.register("chat", "panel")
    r.register("history", "view")
    @Expect(r.list().size, Int64(2))
    @Expect(r.kind("chat"), "panel")
}

@Test
func tabsRejectsBadKind() {
    let r = TabTypeRegistry()
    var threw = false
    try {
        r.register("x", "unknown")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    @Expect(r.list().size, Int64(0))
}

@Test
func tabsUnregisterRemoves() {
    let r = TabTypeRegistry()
    r.register("chat", "panel")
    r.unregister("chat")
    @Expect(r.list().size, Int64(0))
    @Expect(r.kind("chat"), "")
}

@Test
func tabsEmptyIdRejected() {
    let r = TabTypeRegistry()
    var threw = false
    try {
        r.register("", "panel")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
}
