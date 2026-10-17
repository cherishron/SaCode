package core

// 权限预设：把 sandbox mode + approval policy 打包成具名预设。
// `permission/preset` 是 log-only 事件（不进 isSurfaceEvent），数据即预设名。
// 未知名拒绝且不留事件；同值 noop 不重复落。
public class PermissionPresets {
    let log: SessionLog

    public init(log: SessionLog) {
        this.log = log
    }

    private static func valid(name: String): Bool {
        return name == "workspace-write" || name == "danger-full-access"
    }

    // 回放最后一条 permission/preset；未设置返回 ""。
    public func current(): String {
        var value = ""
        for (event in log.snapshotEvents()) {
            if (event.eventType == "permission/preset") {
                value = event.data
            }
        }
        return value
    }

    // 未知名抛且不留事件；同值返回 false（noop）；否则落事件返回 true。
    public func set(name: String): Bool {
        if (!valid(name)) {
            throw Exception("unknown-permission-preset")
        }
        if (current() == name) {
            return false
        }
        log.append("permission/preset", name)
        return true
    }
}
