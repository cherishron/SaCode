package core

import std.collection.*
import std.unittest.*

// 插件装配层的用例。判据来自 PRD A12（docs/product/PRD.md）：
// 「工具/模型/业务服务/前端贡献各选代表插件，在两入口验证依赖激活、缺依赖拒绝、
//  配置变更、初始化失败回滚、停用卸载和作用域隔离；固定硬编码能力或仅工具回调不得判通过」。
// 差距与判据全文见 docs/evidence/plugin-everything-a12-audit-2026-10-06.md。
//
// 这一层只回答两个问题：谁能上、谁为什么上不了。它不 require、不 spawn、不读目录——
// 那些动作属于宿主与扩展宿主。所以下面每条断言都只读装配计划本身，
// 不需要真的有一个 JS 进程在场，也不需要临时目录。

// 造一个单元。参数按位置给：仓颉的类构造不接受命名实参。
func unit(name: String, kind: String, enabled: Bool, deps: Array<String>): PluginUnit {
    return PluginUnit(name, kind, enabled, deps)
}

func plan(units: Array<PluginUnit>): PluginAssemblyPlan {
    return PluginAssembly(units).resolve()
}

// 计划里的激活顺序（只认顺序，不认理由）。
func orderOf(p: PluginAssemblyPlan): String {
    var out = ""
    var bar = ""
    for (n in p.units) {
        out += bar + n
        bar = "|"
    }
    return out
}

// 被拒的包与它的码，按装配层的输出顺序拼成一行。不排序：
// 装配层的 rejected 必须按输入顺序产出，那样这条断言同时也是一次确定性检查。
func rejectedOf(p: PluginAssemblyPlan): String {
    var out = ""
    var bar = ""
    for (r in p.rejected) {
        out += bar + "${r.name}=${r.reason}"
        bar = "|"
    }
    return out
}

@Test
func assemblyActivatesDependeeBeforeDependent() {
    let p = plan([
        unit("@local/upper", "tool", true, ["@local/base"]),
        unit("@local/base", "tool", true, [])
    ])
    @Expect(orderOf(p), "@local/base|@local/upper")
    @Expect(p.rejected.size, Int64(0))
    // 反证：把拓扑定序改成「按输入顺序」，upper 会排到 base 前面，这条必须转红。
}

@Test
func assemblyRejectsMissingDependencyAndKeepsTheRest() {
    // 逐包降级：一个包缺依赖只坏它自己。这条纪律与安装态第 6 类行为同源
    // （一个坏包不让整份清单消失，插件_store_test.cj 的 degrade 用例是同一判据）。
    let p = plan([
        unit("@local/good", "tool", true, []),
        unit("@local/hungry", "tool", true, ["@local/absent"])
    ])
    @Expect(orderOf(p), "@local/good")
    @Expect(rejectedOf(p), "@local/hungry=missing-dependency:@local/absent")
}

@Test
func assemblyDistinguishesDisabledDependencyFromMissing() {
    // 两句话必须分开：「依赖没装」要用户去装，「依赖装了但没启用」只要勾一下。
    // 合并成一条错误，用户就没有下一步可走。
    let disabled = plan([
        unit("@local/upper", "tool", true, ["@local/base"]),
        unit("@local/base", "tool", false, [])
    ])
    @Expect(rejectedOf(disabled), "@local/upper=disabled-dependency:@local/base")
    @Expect(orderOf(disabled), "")

    let missing = plan([
        unit("@local/upper", "tool", true, ["@local/base"])
    ])
    @Expect(rejectedOf(missing), "@local/upper=missing-dependency:@local/base")
}

@Test
func assemblyActivatesEveryWiredKind() {
    // 五类已全部接通激活路径（A12 推进）：工具之外的模型/服务/界面/预设
    // 不再被 kind-not-wired 拒掉，而是各自进入装配序。顺序仍由名字定。
    let p = plan([
        unit("@local/tool-a", "tool", true, []),
        unit("@local/model-a", "model", true, []),
        unit("@local/service-a", "service", true, []),
        unit("@local/ui-a", "ui", true, []),
        unit("@local/preset-a", "preset", true, [])
    ])
    @Expect(orderOf(p), "@local/model-a|@local/preset-a|@local/service-a|@local/tool-a|@local/ui-a")
    @Expect(p.rejected.size, Int64(0))
}

@Test
func assemblyStillRejectsKindWithoutActivationPath() {
    // 防御位：五类之外的名字在解析层已被拒；即便有人绕过解析层造出这种单元，
    // 装配层也要如实拒并携带种类名，而不是静默当工具装上。
    let p = plan([unit("@local/weird", "magic", true, [])])
    @Expect(orderOf(p), "")
    @Expect(rejectedOf(p), "@local/weird=kind-not-wired:magic")
}

@Test
func assemblyRejectionReasonsMapToCodesAndChinese() {
    // 契约码与可执行中文必须由同一映射层产出：界面显示的码要能在契约词表里查到，
    // 中文要带上具体的依赖名/种类名，用户才有下一步可走。
    let missing = PluginAssemblyEntry("@local/upper", "failed", "missing-dependency:@local/base")
    @Expect(reasonCodeOf(missing), "plugin-dependency-missing")
    @Expect(reasonOf(missing).contains("@local/base"), true)
    let disabled = PluginAssemblyEntry("@local/upper", "failed", "disabled-dependency:@local/base")
    @Expect(reasonCodeOf(disabled), "plugin-dependency-disabled")
    @Expect(reasonOf(disabled).contains("@local/base"), true)
    let cycle = PluginAssemblyEntry("@local/a", "failed", "cycle")
    @Expect(reasonCodeOf(cycle), "plugin-dependency-cycle")
    let unwired = PluginAssemblyEntry("@local/x", "failed", "kind-not-wired:magic")
    @Expect(reasonCodeOf(unwired), "plugin-kind-not-wired")
    @Expect(reasonOf(unwired).contains("magic"), true)
    // 认不出的码原样带出，不编造一条中文。
    let other = PluginAssemblyEntry("@local/x", "failed", "something-else")
    @Expect(reasonCodeOf(other), "something-else")
    @Expect(reasonOf(other), "something-else")
}

@Test
func assemblyRejectsCyclesAsAGroupNotSilently() {
    // 环没有「谁先谁后」的正确答案。挑一个节点强行破环就是替用户做决定，
    // 而且破掉的那条边从此再没人看得见——整组拒掉才能把边说出来。
    let p = plan([
        unit("@local/a", "tool", true, ["@local/b"]),
        unit("@local/b", "tool", true, ["@local/a"]),
        unit("@local/free", "tool", true, [])
    ])
    @Expect(orderOf(p), "@local/free")
    // 两个成员都要出现，且各自说出它卡在谁身上。
    @Expect(rejectedOf(p), "@local/a=cycle|@local/b=cycle")
}

@Test
func assemblyIgnoresDisabledPackageWithoutRejectingIt() {
    // 未启用不是一个错误，用户随时可以勾回来。把它塞进 rejected 会让界面
    // 在「已停用」的插件上画一条红色失败，而没有任何东西失败过。
    let p = plan([unit("@local/quiet", "tool", false, [])])
    @Expect(orderOf(p), "")
    @Expect(p.rejected.size, Int64(0))
}

@Test
func assemblyIsDeterministicForIndependentPackages() {
    // 三个互不依赖的包：顺序必须由名字定，不能由输入顺序或哈希遍历顺序定。
    // 装配顺序不确定，「作用域隔离」就没有可复现的判据可言。
    let forward = plan([
        unit("@local/c", "tool", true, []),
        unit("@local/a", "tool", true, []),
        unit("@local/b", "tool", true, [])
    ])
    let backward = plan([
        unit("@local/b", "tool", true, []),
        unit("@local/a", "tool", true, []),
        unit("@local/c", "tool", true, [])
    ])
    @Expect(orderOf(forward), "@local/a|@local/b|@local/c")
    @Expect(orderOf(backward), "@local/a|@local/b|@local/c")
}

@Test
func assemblyPlanJsonCarriesPhaseAndReason() {
    // 清单视图的 phase 字段一直在等这一层的事实（此前只有 active 与空串两种值）。
    let p = plan([
        unit("@local/ok", "tool", true, []),
        unit("@local/hungry", "tool", true, ["@local/absent"])
    ])
    let text = p.asJson()
    @Expect(text.contains("\"name\":\"@local/ok\""), true)
    @Expect(text.contains("\"phase\":\"active\""), true)
    @Expect(text.contains("\"phase\":\"failed\""), true)
    @Expect(text.contains("\"reason\":\"missing-dependency:@local/absent\""), true)
    // 顺序字段给宿主按它装配，不接受界面自己排。
    @Expect(text.contains("\"order\":[\"@local/ok\"]"), true)
}
