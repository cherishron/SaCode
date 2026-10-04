package core
import std.collection.*

// 技能注册表：log-only `skill/register` 事件承载 `<name>::<description>`；
// `skill/uninstall` 事件承载 `<name>` 做软删（active=false）；`list()` 只回
// active 名称、`describe(name)` 只对 active 者返描述，卸载后返空串。
//
// 本切片假设 name/description 不含 `::`；未来放开需换长度前缀编码。

class SkEntry {
    let name: String
    let description: String
    var active: Bool
    init(name: String, description: String, active: Bool) {
        this.name = name
        this.description = description
        this.active = active
    }
}

public class SkillRegistry {
    let log: SessionLog
    let entries = ArrayList<SkEntry>()

    public init(log: SessionLog) {
        this.log = log
        for (event in log.snapshotEvents()) {
            let t = event.eventType
            if (t == "skill/register") {
                let body = event.data
                let idx = body.indexOf("::") ?? Int64(-1)
                let name = if (idx < 0) { body } else { body[0..idx] }
                let desc = if (idx < 0) { "" } else { body[(idx + 2)..body.size] }
                let i = indexOf(name)
                if (i >= 0) {
                    entries[i].active = true
                } else {
                    entries.add(SkEntry(name, desc, true))
                }
            } else if (t == "skill/uninstall") {
                let i = indexOf(event.data)
                if (i >= 0) {
                    entries[i].active = false
                }
            }
        }
    }

    public func register(name: String, description: String): Unit {
        if (name.size == 0) {
            throw Exception("skill-empty-name")
        }
        if (description.size == 0) {
            throw Exception("skill-empty-description")
        }
        let i = indexOf(name)
        if (i >= 0 && entries[i].active) {
            return
        }
        log.append("skill/register", "${name}::${description}")
        if (i >= 0) {
            entries[i].active = true
        } else {
            entries.add(SkEntry(name, description, true))
        }
    }

    public func uninstall(name: String): Unit {
        let i = indexOf(name)
        if (i < 0 || !entries[i].active) {
            return
        }
        log.append("skill/uninstall", name)
        entries[i].active = false
    }

    public func list(): ArrayList<String> {
        let out = ArrayList<String>()
        for (e in entries) {
            if (e.active) {
                out.add(e.name)
            }
        }
        return out
    }

    public func describe(name: String): String {
        let i = indexOf(name)
        if (i < 0 || !entries[i].active) {
            return ""
        }
        return entries[i].description
    }

    private func indexOf(name: String): Int64 {
        var i: Int64 = 0
        while (i < Int64(entries.size)) {
            if (entries[i].name == name) {
                return i
            }
            i = i + 1
        }
        return Int64(-1)
    }
}
