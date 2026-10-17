package core

import std.collection.*

// 插件生命周期投影与事实定义。这是 A12「一切皆插件」闭环的第一段：
// 安装态（PluginStore）此前把「已安装且 enabled」硬编码成 phase=active，
// 于是「装了」与「跑起来了」在清单里长得一模一样——那正是最难查的一类假成功。
//
// 本文件的纪律：
//   1. **状态由事件推导**，不驻留内存真源：崩溃后从 plugins.log 回放即可重建。
//   2. **阶段取值是闭集**，与桌面 plugin-manager-adapter.ts 的 PHASES 逐字一致；
//      多一个取值就等于界面多一条认不出的状态。
//   3. **投影是纯函数**：输入事件与种子，输出事实，不做 I/O、不改输入。
//   4. **失败带可执行理由**：只说「失败」而不说为什么，用户没有下一步可走。

// 生命周期阶段闭集。取值与 apps/desktop/renderer/pages/plugin-manager-adapter.ts
// 的 PHASES 逐字一致——两边任何一处多一个值，界面就会出现一条认不出的状态。
public let lifecyclePhases = ["pending", "loading", "active", "failed", "unloading"]

public func isLifecyclePhase(value: String): Bool {
    return lifecyclePhases.contains(value)
}

// 生命周期事实事件类型。与既有 plugin/install|uninstall|enabled 同日志、同租约、同回放。
public let pluginActivateEvent = "plugin/activate"
public let pluginDeactivateEvent = "plugin/deactivate"
public let pluginFailedEvent = "plugin/failed"
public let pluginReassembleEvent = "plugin/reassemble"

// 投影种子：一条安装事实（包名 + 启用标记）。未启用不是错误，投影为空状态
// （phase=""），不是 failed——用户随时勾回来，画一条红色失败是在撒谎。
public class LifecycleSeed {
    public let name: String
    public let enabled: Bool

    public init(name: String, enabled: Bool) {
        this.name = name
        this.enabled = enabled
    }
}

// 投影输入：一条生命周期事件。done 只对 plugin/deactivate 有意义
// （停用完成回落到 pending，安装事实保留）。
public class LifecycleFactEvent {
    public let eventType: String
    public let name: String
    public let phase: String
    public let reason: String
    public let done: Bool

    public init(eventType: String, name: String, phase: String, reason: String, done: Bool) {
        this.eventType = eventType
        this.name = name
        this.phase = phase
        this.reason = reason
        this.done = done
    }
}

// 投影输出：一个插件的生命周期事实。
public class PluginLifecycleFact {
    public let name: String
    public let phase: String
    public let reason: String

    public init(name: String, phase: String, reason: String) {
        this.name = name
        this.phase = phase
        this.reason = reason
    }
}

// 纯投影。无状态、无 I/O、确定性：同一份事件与种子必然算出同一份事实。
// 有安装事实但无任何生命周期事件 ⇒ pending（未启用则为空状态）。
public class LifecycleProjection {
    public static func project(events: Array<LifecycleFactEvent>, seeds: Array<LifecycleSeed>): Array<PluginLifecycleFact> {
        let names = ArrayList<String>()
        let phases = ArrayList<String>()
        let reasons = ArrayList<String>()
        for (seed in seeds) {
            names.add(seed.name)
            phases.add(if (seed.enabled) { "pending" } else { "" })
            reasons.add("")
        }
        for (ev in events) {
            var i: Int64 = 0
            while (i < Int64(names.size)) {
                if (names[i] == ev.name) {
                    if (ev.eventType == pluginActivateEvent) {
                        phases[i] = ev.phase
                        if (ev.phase == "active") {
                            reasons[i] = ""
                        }
                    } else if (ev.eventType == pluginDeactivateEvent) {
                        // 停用完成回落到 pending：安装事实保留，下次重装配还能被激活。
                        phases[i] = if (ev.done) { "pending" } else { "unloading" }
                        reasons[i] = ""
                    } else if (ev.eventType == pluginFailedEvent) {
                        phases[i] = "failed"
                        reasons[i] = ev.reason
                    }
                }
                i += 1
            }
        }
        let out = ArrayList<PluginLifecycleFact>()
        var j: Int64 = 0
        while (j < Int64(names.size)) {
            out.add(PluginLifecycleFact(names[j], phases[j], reasons[j]))
            j += 1
        }
        return out.toArray()
    }
}