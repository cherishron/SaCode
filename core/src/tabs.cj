package core
import std.collection.*

// Sidebar/Rightbar 上游契约（M5/M6）：React 组合系统里有 tab-type registry；
// 本仓 Vue runtime 架构根本不同，只做非渲染 tab-type 元数据登记。
// `register(tabId, kind)` + `list()` + `unregister(tabId)`；kind 走白名单
// （panel / view / widget 三选一）。

class TabEntry {
    let id: String
    let kind: String
    var active: Bool
    init(id: String, kind: String, active: Bool) {
        this.id = id
        this.kind = kind
        this.active = active
    }
}

public class TabTypeRegistry {
    let tabs = ArrayList<TabEntry>()

    public init() {}

    public func register(id: String, kind: String): Unit {
        if (id.size == 0) {
            throw Exception("tabs-empty-id")
        }
        if (kind != "panel" && kind != "view" && kind != "widget") {
            throw Exception("tabs-bad-kind")
        }
        let i = indexOf(id)
        if (i >= 0) {
            tabs[i].active = true
            return
        }
        tabs.add(TabEntry(id, kind, true))
    }

    public func unregister(id: String): Unit {
        let i = indexOf(id)
        if (i < 0) {
            return
        }
        tabs[i].active = false
    }

    public func list(): ArrayList<String> {
        let out = ArrayList<String>()
        for (t in tabs) {
            if (t.active) {
                out.add(t.id)
            }
        }
        return out
    }

    public func kind(id: String): String {
        let i = indexOf(id)
        if (i < 0 || !tabs[i].active) {
            return ""
        }
        return tabs[i].kind
    }

    private func indexOf(id: String): Int64 {
        var i: Int64 = 0
        while (i < Int64(tabs.size)) {
            if (tabs[i].id == id) {
                return i
            }
            i = i + 1
        }
        return Int64(-1)
    }
}
