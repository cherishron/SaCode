package core
import std.collection.*

// 代理团队：log-only `agent-team/membership` 事件承载 `join::<id>::<role>` /
// `leave::<id>`；`agent-team/broadcast` 事件承载 `<text>`。空 id 抛。
//
// 本切片假设 id/role/text 不含 `::`；text 是整段 broadcast 内容，若含 `::`
// 也不影响（因为整段作为一条 data 存）。

class TeamMember {
    let id: String
    var active: Bool
    init(id: String, active: Bool) {
        this.id = id
        this.active = active
    }
}

public class AgentTeam {
    let log: SessionLog
    let roster = ArrayList<TeamMember>()

    public init(log: SessionLog) {
        this.log = log
        for (event in log.snapshotEvents()) {
            let t = event.eventType
            if (t == "agent-team/membership") {
                let body = event.data
                if (body.startsWith("join::")) {
                    let rest = body[6..body.size]
                    let idx = rest.indexOf("::") ?? Int64(-1)
                    let id = if (idx < 0) { rest } else { rest[0..idx] }
                    ensureActive(id)
                } else if (body.startsWith("leave::")) {
                    let id = body[7..body.size]
                    let i = indexOf(id)
                    if (i >= 0) {
                        roster[i].active = false
                    }
                }
            }
        }
    }

    public func join(id: String, role: String): Unit {
        if (id.size == 0) {
            throw Exception("team-empty-id")
        }
        if (role.size == 0) {
            throw Exception("team-empty-role")
        }
        let i = indexOf(id)
        if (i >= 0 && roster[i].active) {
            return
        }
        log.append("agent-team/membership", "join::${id}::${role}")
        ensureActive(id)
    }

    public func leave(id: String): Unit {
        let i = indexOf(id)
        if (i < 0 || !roster[i].active) {
            return
        }
        log.append("agent-team/membership", "leave::${id}")
        roster[i].active = false
    }

    public func members(): ArrayList<String> {
        let out = ArrayList<String>()
        for (m in roster) {
            if (m.active) {
                out.add(m.id)
            }
        }
        return out
    }

    public func broadcast(text: String): Unit {
        if (text.size == 0) {
            throw Exception("team-empty-text")
        }
        log.append("agent-team/broadcast", text)
    }

    public func messageCount(): Int64 {
        var n: Int64 = 0
        for (event in log.snapshotEvents()) {
            if (event.eventType == "agent-team/broadcast") {
                n = n + 1
            }
        }
        return n
    }

    private func indexOf(id: String): Int64 {
        var i: Int64 = 0
        while (i < Int64(roster.size)) {
            if (roster[i].id == id) {
                return i
            }
            i = i + 1
        }
        return Int64(-1)
    }

    private func ensureActive(id: String): Unit {
        let i = indexOf(id)
        if (i >= 0) {
            roster[i].active = true
        } else {
            roster.add(TeamMember(id, true))
        }
    }
}
