package core

import std.collection.*
import std.fs.*
import std.unittest.*

// 插件生命周期事实与状态投影的用例（任务组 1）。
//
// 反证核心：把 viewOf 的 phase 改回「enabled 硬编码 active」，本文件里所有
// 「装了但未激活应为 pending」「失败应为 failed」的断言必须转红——那正是这次
// 要修掉的假成功。

// 造一个带一条工具声明的源插件，用于观察 rows 的 phase/reason。
func plSource(tag: String, name: String): String {
    return psSource(tag, name, "\"tools\":[{\"name\":\"echo\",\"description\":\"回声\"}]")
}

@Test
func pluginLifecycleProjectsPhaseFromFacts() {
    let tag = "lifecycle"
    psClean(tag)
    let base = psRoot(tag)
    let src = plSource(tag, "@local/sacode-tool-echo")
    let store = PluginStore(base)
    @Expect(psInstallCode(store, src), "ok:@local/sacode-tool-echo@0.1.0")

    // 装了但未激活：phase=pending，不是 active（旧实现恒 active 的假成功）。
    let fresh = PluginStore(base)
    @Expect(fresh.describe().packages[0].rows[0].phase, "pending")
    @Expect(fresh.describe().packages[0].rows[0].readOnlyReason, "")

    // 激活中间态与完成态。
    store.recordActivate("@local/sacode-tool-echo", "loading")
    @Expect(PluginStore(base).describe().packages[0].rows[0].phase, "loading")
    store.recordActivate("@local/sacode-tool-echo", "active")
    @Expect(PluginStore(base).describe().packages[0].rows[0].phase, "active")
    @Expect(PluginStore(base).describe().packages[0].rows[0].readOnlyReason, "")

    // 失败事实必须带可执行理由，且理由能被清单读回。
    store.recordFailed("@local/sacode-tool-echo", "plugin-load-failed")
    let failedView = PluginStore(base).describe()
    @Expect(failedView.packages[0].rows[0].phase, "failed")
    @Expect(failedView.packages[0].rows[0].readOnlyReason, "plugin-load-failed")

    // 停用完成回落到 pending：安装事实保留。
    store.recordDeactivate("@local/sacode-tool-echo", true)
    @Expect(PluginStore(base).describe().packages[0].rows[0].phase, "pending")

    psClean(tag)
    try { removeIfExists(src, recursive: true); () } catch (e: Exception) {}
}

@Test
func pluginLifecycleUnloadingIsIntermediateBeforeDone() {
    let tag = "unloading"
    psClean(tag)
    let base = psRoot(tag)
    let src = plSource(tag, "@local/sacode-tool-echo")
    let store = PluginStore(base)
    @Expect(psInstallCode(store, src), "ok:@local/sacode-tool-echo@0.1.0")
    store.recordActivate("@local/sacode-tool-echo", "active")
    // 停用开始：unloading 是对外可见的中间态，不是直接消失。
    store.recordDeactivate("@local/sacode-tool-echo", false)
    @Expect(PluginStore(base).describe().packages[0].rows[0].phase, "unloading")
    psClean(tag)
    try { removeIfExists(src, recursive: true); () } catch (e: Exception) {}
}

@Test
func pluginLifecycleRejectsFactForUnknownPlugin() {
    let tag = "unknown"
    psClean(tag)
    let base = psRoot(tag)
    let store = PluginStore(base)
    var code = ""
    try { store.recordActivate("@local/none", "active") } catch (e: Exception) { code = e.message }
    @Expect(code, "plugin-not-found")
    psClean(tag)
}

@Test
func pluginLifecycleRejectsBogusPhase() {
    let tag = "bogus"
    psClean(tag)
    let base = psRoot(tag)
    let src = plSource(tag, "@local/sacode-tool-echo")
    let store = PluginStore(base)
    @Expect(psInstallCode(store, src), "ok:@local/sacode-tool-echo@0.1.0")
    var code = ""
    try { store.recordActivate("@local/sacode-tool-echo", "running") } catch (e: Exception) { code = e.message }
    @Expect(code, "plugin-rejected")
    // 拒绝不落事实：仍是 pending。
    @Expect(PluginStore(base).describe().packages[0].rows[0].phase, "pending")
    psClean(tag)
    try { removeIfExists(src, recursive: true); () } catch (e: Exception) {}
}

@Test
func lifecycleProjectionIsPendingByDefaultAndPure() {
    let seeds = ArrayList<LifecycleSeed>()
    seeds.add(LifecycleSeed("a", true))
    seeds.add(LifecycleSeed("b", false))
    let events = ArrayList<LifecycleFactEvent>()
    events.add(LifecycleFactEvent(pluginActivateEvent, "a", "active", "", false))
    let facts = LifecycleProjection.project(events.toArray(), seeds.toArray())
    @Expect(facts.size, Int64(2))
    @Expect(facts[0].phase, "active")
    // 未启用不是错误：空状态，不是 failed。
    @Expect(facts[1].phase, "")
    // 纯函数：同样的输入再算一遍必须一致（无隐藏状态）。
    let again = LifecycleProjection.project(events.toArray(), seeds.toArray())
    @Expect(again[0].phase, "active")
    @Expect(again[1].phase, "")
    // 闭集校验：认不出的阶段名不进闭集。
    @Expect(isLifecyclePhase("pending"), true)
    @Expect(isLifecyclePhase("running"), false)
}

@Test
func lifecyclePhasesMatchDesktopClosedSet() {
    // 与桌面 plugin-manager-adapter.ts 的 PHASES 逐字一致（多了界面就认不出）。
    @Expect(lifecyclePhases.size, Int64(5))
    @Expect(lifecyclePhases.contains("pending"), true)
    @Expect(lifecyclePhases.contains("loading"), true)
    @Expect(lifecyclePhases.contains("active"), true)
    @Expect(lifecyclePhases.contains("failed"), true)
    @Expect(lifecyclePhases.contains("unloading"), true)
}