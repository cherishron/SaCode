package core

import std.collection.*

// 插件装配层。这是 A12「一切皆插件」缺的那座桥（判据与差距见
// docs/evidence/plugin-everything-a12-audit-2026-10-06.md §1、§4）：
// 此前安装态（PluginStore：manifest、事件真源、包目录）与运行态（extproc + extjs：
// 按调用方给的路径 require）是两个互不相干的世界——装一个包对可调用集合没有任何影响，
// 而 manifest 的 dependencies 解析出来之后无人消费。
//
// 这一层的纪律，逐条对应 A12 的六个验证维度：
//
//   1. **只回答「谁能上、谁为什么上不了」**。不 require、不 spawn、不读目录、不认识
//      文件系统。装配顺序与拒绝理由是事实，副作用是宿主与扩展宿主的动作——把它们混在
//      一起就没有可复现的判据可言（顺序一旦取决于 I/O 完成时刻，作用域隔离无法验证）。
//   2. **未接的种类要如实拒，不是静默不装**。五类（tool/model/service/ui/preset）
//      已全部接通激活路径；将来若有第六类未接，仍要拒成 `kind-not-wired:*`
//      （携带种类名）。静默不装会得到一个「已启用但看不见」的包，那是最难查的一类假成功。
//   3. **拒绝必须说得出是哪条依赖**。missing 与 disabled 是两个动作不同的下一步
//      （去装 vs 勾回来），合并成一条错误就等于没说。
//   4. **环整组拒，不挑一条边破环**。破环等于替用户决定哪条依赖不重要，
//      而被破掉的那条边此后再也无人看得见。
//   5. **顺序与输入顺序无关**。同一份安装态在两入口必须算出同一个序，
//      否则「CLI 装了、桌面看得见」这句话连可验证的形式都没有。

// 已接的装配种类：五类全部接通各自的激活路径（贡献面 SPI 见 plugin_surface.cj）。
// 接一类就往这里加一名 + 提供对应 ContributionSurface 实现 + manifest 声明解析分支——
// 「加这名 + 加实现」是唯一能让该种类上路的动作，而不是在宿主里再多一个 if
// （架构不变量 5：新增插件不修改 agent 主循环与入口分派链）。
let pluginWiredKinds = ["tool", "model", "service", "ui", "preset"]

public class PluginUnit {
    public let name: String
    public let kind: String
    public let enabled: Bool
    public let dependencies: Array<String>

    public init(name: String, kind: String, enabled: Bool, dependencies: Array<String>) {
        this.name = name
        this.kind = kind
        this.enabled = enabled
        this.dependencies = dependencies
    }
}

public class PluginAssemblyEntry {
    public let name: String
    public let phase: String
    public let reason: String

    public init(name: String, phase: String, reason: String) {
        this.name = name
        this.phase = phase
        this.reason = reason
    }
}

public class PluginAssemblyPlan {
    public let units: Array<String>
    public let rejected: Array<PluginAssemblyEntry>

    public init(units: Array<String>, rejected: Array<PluginAssemblyEntry>) {
        this.units = units
        this.rejected = rejected
    }

    // 宿主对 plugin/assembly 的应答体。order 是给宿主的装配指令，
    // active/rejected 是给清单视图的 phase 与 reason——那个字段一直在等这里的事实。
    public func asJson(): String {
        var text = "{\"order\":["
        var comma = ""
        for (n in units) {
            text += comma
            text += "\"${jsonEscapeText(n)}\""
            comma = ","
        }
        text += "],\"active\":["
        comma = ""
        for (n in units) {
            text += comma + "{\"name\":\"${jsonEscapeText(n)}\",\"phase\":\"active\"" + optJson("reason", "") + "}"
            comma = ","
        }
        text += "],\"rejected\":["
        comma = ""
        for (r in rejected) {
            text += comma + "{\"name\":\"${jsonEscapeText(r.name)}\",\"phase\":\"${jsonEscapeText(r.phase)}\"" +
                optJson("reason", r.reason) + "}"
            comma = ","
        }
        text += "]}"
        return text
    }
}

public class PluginAssembly {
    let units: Array<PluginUnit>

    public init(units: Array<PluginUnit>) {
        this.units = units
    }

    public func resolve(): PluginAssemblyPlan {
        let order = ArrayList<String>()
        let rejected = ArrayList<PluginAssemblyEntry>()
        let remaining = ArrayList<PluginUnit>()
        for (u in units) {
            // 未启用不是错误：用户随时勾回来，画一条红色失败是在撒谎。
            if (!u.enabled) {
                continue
            }
            if (!pluginWiredKinds.contains(u.kind)) {
                rejected.add(PluginAssemblyEntry(u.name, "failed", "kind-not-wired:${u.kind}"))
                continue
            }
            let problem = dependencyProblem(u)
            if (problem.size > 0) {
                rejected.add(PluginAssemblyEntry(u.name, "failed", problem))
                continue
            }
            remaining.add(u)
        }

        // Kahn 定序，每轮取「名字最小且已就绪」的那个：结果与输入顺序无关。
        while (remaining.size > 0) {
            var picked = Int64(-1)
            var i: Int64 = 0
            while (i < remaining.size) {
                let cand = remaining[i]
                if (depsPlaced(cand, order)) {
                    if (picked < 0 || cand.name < remaining[picked].name) {
                        picked = i
                    }
                }
                i += 1
            }
            if (picked < 0) {
                // 一个都不就绪 ⇒ 剩下的全在环上。整组拒掉，且每个都说出自己是环的一员。
                for (u in remaining) {
                    rejected.add(PluginAssemblyEntry(u.name, "failed", "cycle"))
                }
                return PluginAssemblyPlan(order.toArray(), rejected.toArray())
            }
            order.add(remaining[picked].name)
            // remove at index: swap with last and pop
            let last = remaining.size - 1
            remaining[picked] = remaining[last]
            remaining.remove(last..last+1)
        }
        return PluginAssemblyPlan(order.toArray(), rejected.toArray())
    }

    // 装配层不认识哈希表，也不认识文件系统：包的数量是「装了多少个插件」，
    // 逐个比对足够，而且遍历顺序即输入顺序——确定性本身就是这一层要给的性质。
    private func unitNamed(name: String): PluginUnit {
        for (u in units) {
            if (u.name == name) {
                return u
            }
        }
        return PluginUnit("", "", false, [])
    }

    // 第一条不成立的依赖。按声明顺序取第一条，不做「挑一条最要紧的」那种判断。
    private func dependencyProblem(u: PluginUnit): String {
        for (dep in u.dependencies) {
            let d = unitNamed(dep)
            if (d.name.size == 0) {
                return "missing-dependency:${dep}"
            }
            if (!d.enabled) {
                return "disabled-dependency:${dep}"
            }
        }
        return ""
    }

    private func depsPlaced(u: PluginUnit, order: ArrayList<String>): Bool {
        for (dep in u.dependencies) {
            if (!order.contains(dep)) {
                return false
            }
        }
        return true
    }
}
// —— 拒绝理由的对外映射（单一映射层）。
//
// 装配层内部用短码加参数（`missing-dependency:@local/base`），契约面要稳定错误码
// （`plugin-dependency-missing`），界面要可执行中文（「缺少依赖 X，请先安装」）。
// 三者只该在「一条理由」上成立，所以映射收在一处——散在宿主与桌面各拼一份，
// 迟早出现「界面显示的码在契约词表里查不到」。
public func reasonOf(entry: PluginAssemblyEntry): String {
    let code = reasonCodePart(entry.reason)
    let arg = reasonArgPart(entry.reason)
    if (code == "kind-not-wired") {
        return "插件种类 ${arg} 尚未接通激活路径"
    }
    if (code == "missing-dependency") {
        return "缺少依赖 ${arg}，请先安装它"
    }
    if (code == "disabled-dependency") {
        return "依赖 ${arg} 已停用，请先启用它"
    }
    if (code == "cycle") {
        return "依赖成环，本组插件全部拒绝"
    }
    return entry.reason
}

public func reasonCodeOf(entry: PluginAssemblyEntry): String {
    let code = reasonCodePart(entry.reason)
    if (code == "kind-not-wired") {
        return "plugin-kind-not-wired"
    }
    if (code == "missing-dependency") {
        return "plugin-dependency-missing"
    }
    if (code == "disabled-dependency") {
        return "plugin-dependency-disabled"
    }
    if (code == "cycle") {
        return "plugin-dependency-cycle"
    }
    return code
}

private func reasonCodePart(reason: String): String {
    let colon = reason.indexOf(":") ?? Int64(-1)
    if (colon < 0) {
        return reason
    }
    return reason[0..colon]
}

private func reasonArgPart(reason: String): String {
    let colon = reason.indexOf(":") ?? Int64(-1)
    if (colon < 0) {
        return ""
    }
    return reason[(colon + 1)..reason.size]
}
