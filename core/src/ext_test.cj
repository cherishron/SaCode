package core

import std.unittest.*
import std.collection.ArrayList
import std.fs.*

// 注册表是 CLI 与桌面两个入口的唯一真源：这里先写「期望的 API」，再让实现跟上。

@Test
func registerThenListShowsTool() {
    let r = ToolRegistry()
    @Expect(r.register(ToolSpec("fs.write", "写临时文件", "path,content", true)), true)
    @Expect(r.has("fs.write"), true)
    @Expect(r.count(), Int64(1))
    @Expect(r.list()[0], "fs.write")
}

@Test
func duplicateRegisterIsRejected() {
    let r = ToolRegistry()
    r.register(ToolSpec("fs.write", "first", "a", true))
    // 重名必须拒绝，且原描述不得被覆盖
    @Expect(r.register(ToolSpec("fs.write", "second", "b", false)), false)
    @Expect(r.count(), Int64(1))
    @Expect(r.describe("fs.write"), "first")
}

@Test
func unregisterRemovesToolAndCount() {
    let r = ToolRegistry()
    r.register(ToolSpec("fs.read", "读", "path", false))
    r.register(ToolSpec("fs.write", "写", "path,content", true))
    @Expect(r.unregister("fs.read"), true)
    @Expect(r.has("fs.read"), false)
    @Expect(r.count(), Int64(1))
    @Expect(r.list()[0], "fs.write")
}

@Test
func unregisterUnknownNameFails() {
    let r = ToolRegistry()
    // 卸载不存在的工具不能假装成功
    @Expect(r.unregister("nope"), false)
}

@Test
func listSnapshotIsIndependent() {
    let r = ToolRegistry()
    r.register(ToolSpec("a.tool", "a", "", true))
    let snap = r.list()
    snap.add("ghost.tool")
    @Expect(Int64(snap.size), Int64(2))
    @Expect(r.count(), Int64(1))
    @Expect(r.has("ghost.tool"), false)
}

@Test
func unknownToolRequiresApproval() {
    let r = ToolRegistry()
    // fail-closed：查不到的工具一律按「需要审批」处理，而不是放行
    @Expect(r.requiresApproval("never.registered"), true)
    r.register(ToolSpec("auto.tool", "无需审批", "", false))
    @Expect(r.requiresApproval("auto.tool"), false)
    @Expect(r.requiresApproval("fs.write") , true)
    r.register(ToolSpec("fs.write", "需要审批", "path", true))
    @Expect(r.requiresApproval("fs.write"), true)
}

@Test
func listenersOffBringsResidualToZero() {
    let l = ListenerRegistry()
    let h1 = l.on("tool/call")
    let h2 = l.on("tool/call")
    let h3 = l.on("session/flush")
    @Expect(l.count(), Int64(3))
    @Expect(l.countFor("tool/call"), Int64(2))
    @Expect(l.off(h1), true)
    @Expect(l.off(h2), true)
    @Expect(l.countFor("tool/call"), Int64(0))
    @Expect(l.off(h3), true)
    @Expect(l.count(), Int64(0))
}

@Test
func listenerHandleIsSingleUse() {
    let l = ListenerRegistry()
    let h = l.on("turn/start")
    @Expect(l.off(h), true)
    // 同一 handle 二次撤销必须失败：不得让「残留为 0」的断言被重复撤销凑数
    @Expect(l.off(h), false)
    @Expect(l.count(), Int64(0))
}

@Test
func unregisteredToolIsRejectedAndCounted() {
    let rt = ToolRuntime(SessionLog("core-test-rt-miss.log"), ToolRegistry())
    // 未登记即拒绝：审批应答再正确也不能放行（deny-by-default）
    let out = rt.execute("write", "core-test-rt-miss.txt hi", "allowed-once", true)
    @Expect(out.allowed, false)
    @Expect(out.why, "unregistered-tool:write")
    @Expect(rt.registryMisses, Int64(1))
    cleanTool("rt-miss")
}

@Test
func registeredToolTakesApprovalFlagFromRegistry() {
    let reg = ToolRegistry()
    reg.register(ToolSpec("write", "写文件", "path content", true))
    let rt = ToolRuntime(SessionLog("core-test-rt-ap.log"), reg)
    let denied = rt.execute("write", "core-test-rt-ap.txt a", "none", true)
    @Expect(denied.allowed, false)
    @Expect(denied.why, "approval-not-allowed-once")
    let ok = rt.execute("write", "core-test-rt-ap.txt a", "allowed-once", true)
    @Expect(ok.allowed, true)
    @Expect(ok.why, "ok:core-test-rt-ap.txt")
    @Expect(rt.registryMisses, Int64(0))
    cleanTool("rt-ap")
}

@Test
func registeredToolWithoutApprovalRunsDirectly() {
    let reg = ToolRegistry()
    reg.register(ToolSpec("write", "写文件", "path content", false))
    let rt = ToolRuntime(SessionLog("core-test-rt-no.log"), reg)
    let out = rt.execute("write", "core-test-rt-no.txt b", "", true)
    @Expect(out.allowed, true)
    @Expect(rt.guardDenials, Int64(0))
    cleanTool("rt-no")
}

// 工具会真的写文件：用例结束后还原工作区，免得每跑一次测试就留一批残渣
func cleanTool(tag: String) {
    removeIfExists("core-test-${tag}.log", recursive: false)
    removeIfExists("core-test-${tag}.txt", recursive: false)
}
