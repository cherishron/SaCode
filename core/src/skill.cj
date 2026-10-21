package core
import std.collection.*

// 技能注册表：log-only `skill/register` 事件承载 `<name>::<description>`；
// `skill/uninstall` 事件承载 `<name>` 做软删（active=false）；`list()` 只回
// active 名称、`describe(name)` 只对 active 者返描述，卸载后返空串。
//
// name/description 含 `::` 在 register 处被拒（`skill-delimiter-in-name` /
// `skill-delimiter-in-description`），不再是「假设不会发生」；放开需换长度前缀编码。

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
    let providers = ArrayList<SkillProvider>()

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
        // `<name>::<description>` 里 `::` 就是字段分隔符：名字或描述带上它，
        // 回放时字段错切，describe() 交回的就不是注册时给的那句。
        if ((name.indexOf("::") ?? -1) >= 0) {
            throw Exception("skill-delimiter-in-name")
        }
        if ((description.indexOf("::") ?? -1) >= 0) {
            throw Exception("skill-delimiter-in-description")
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

    // ===== 以下为第 2 段新增：provider 聚合（与上方 log-only register/uninstall 并存） =====
    // listSummaries/getSkill/skillDigest 聚合 provider；register/uninstall/list/describe 保留向后兼容。

    public func registerProvider(provider: SkillProvider): Unit {
        providers.add(provider)
    }

    // 聚合 provider 摘要：按注册顺序先到先得（项目层先注册则优先覆盖同名）。
    public func listSummaries(): ArrayList<SkillSummary> {
        let out = ArrayList<SkillSummary>()
        let seen = HashSet<String>()
        for (p in providers) {
            for (s in p.list()) {
                if (!seen.contains(s.name)) {
                    seen.add(s.name)
                    out.add(s)
                }
            }
        }
        return out
    }

    // 取某 name 完整定义：按 provider 注册顺序，第一个返回 Some 即返回（先到先得）。
    public func getSkill(name: String): ?SkillDefinition {
        for (p in providers) {
            let r = p.get(name)
            if (let Some(_) <- r) {
                return r
            }
        }
        return None
    }

    // 稳定摘要 digest：按 name 排序的 name|description 拼接，用于检测目录变化。
    // 不引 crypto；用确定序拼接字符串即可做相等比较。
    public func skillDigest(): String {
        let summaries = listSummaries()
        var names = ArrayList<String>()
        for (s in summaries) { names.add(s.name) }
        // 冒泡排序（避免引入 sort API 的不确定性）
        var a = Int64(0)
        while (a < names.size) {
            var b = Int64(0)
            while (b < names.size - Int64(1) - a) {
                if (names[b] > names[b + Int64(1)]) {
                    let t = names[b]
                    names[b] = names[b + Int64(1)]
                    names[b + Int64(1)] = t
                }
                b = b + Int64(1)
            }
            a = a + Int64(1)
        }
        var out = ""
        for (n in names) {
            for (s in summaries) {
                if (s.name == n) {
                    out = out + n + "|" + s.description + "\n"
                }
            }
        }
        return out
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
