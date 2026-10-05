package core

import std.collection.*
import std.fs.*
import stdx.encoding.json.*

// 每次上游尝试的「先发标记」与「失败事实」——落 usage-ledger.log，
// 与 B3 的账本同一个文件、同一条租约写路径：B2 只写这两类事件，不写金额。
//
// 为什么标记要先落盘：设计文档 §6 的重放闸判据是「该 attemptId 有无 dispatched 事件」。
// 内存标志在崩溃后毫无痕迹，于是重启可能把已经送达上游的请求再发一遍，用户付两遍钱。
// 因此纪律是 fail-closed：标记写不下去（拿不到租约/落盘失败）就**不发请求**，
// 且两次持锁都只圈一条写入，绝不把网络调用圈进任何一次持锁。
public class AttemptLog {
    let file: String

    public init(file: String) {
        this.file = file
    }

    public static func forUser(): AttemptLog {
        let dir = Path(GlobalAppearanceSettings.forUser().settingsPath()).parent.toString()
        return AttemptLog("${dir}/usage-ledger.log")
    }

    // 返回 false = 标记没写下去：调用方必须不发（fail-closed），不许「先发再补记」。
    public func markDispatched(logicalRequestId: String, attemptId: String, routeKey: String): Bool {
        let data = "{\"logicalRequestId\":\"${jsonEscapeText(logicalRequestId)}\","
            + "\"attemptId\":\"${jsonEscapeText(attemptId)}\",\"routeKey\":\"${jsonEscapeText(routeKey)}\"}"
        return appendEvent("attempt/dispatched", data)
    }

    public func markFailed(attemptId: String, failure: TransportFailure): Bool {
        let data = "{\"attemptId\":\"${jsonEscapeText(attemptId)}\",\"kind\":\"${jsonEscapeText(failure.kind)}\","
            + "\"reachedUpstream\":${boolText(failure.reachedUpstream)},\"status\":${failure.status},"
            + "\"retryAfterSeconds\":${failure.retryAfterSeconds},\"bodyLen\":${failure.bodyLen},"
            + "\"summary\":\"${jsonEscapeText(failure.summary)}\"}"
        return appendEvent("attempt/failed", data)
    }

    // 重放闸的唯一判据：这条 attempt 有没有「已派发且未结算」的标记
    public func dispatched(attemptId: String): Bool {
        for (id in lastDispatchedUnsettled()) {
            if (id == attemptId) { return true }
        }
        return false
    }

    // 未结算的已派发尝试：崩溃恢复要靠它认出「可能已送达但没记账」的那几笔
    public func lastDispatchedUnsettled(): Array<String> {
        let pending = ArrayList<String>()
        if (!exists(file)) {
            return pending.toArray()
        }
        let log = SessionLog(file)
        if (!log.load()) {
            throw Exception("attempt-replay-rejected")
        }
        var live = pending
        for (ev in log.snapshotEvents()) {
            let id = fieldOfText(ev.data, "attemptId")
            if (ev.eventType == "attempt/dispatched") {
                var seen = false
                for (x in live) {
                    if (x == id) { seen = true }
                }
                if (!seen) { live.add(id) }
            } else if (ev.eventType == "attempt/failed") {
                let kept = ArrayList<String>()
                for (x in live) {
                    if (x != id) { kept.add(x) }
                }
                live = kept
            }
        }
        return live.toArray()
    }

    // 失败事实留在日志里供 RouteHealth 回放归因；这里只数条数（B3 的账本会做更细的分组）
    public func failedCount(): Int64 {
        if (!exists(file)) {
            return 0
        }
        let log = SessionLog(file)
        if (!log.load()) {
            throw Exception("attempt-replay-rejected")
        }
        var n: Int64 = 0
        for (ev in log.snapshotEvents()) {
            if (ev.eventType == "attempt/failed") { n += 1 }
        }
        return n
    }

    // 短临界区：取租约 → 写一条 → 归还。调用方在归还之后才允许发网络请求。
    private func appendEvent(eventType: String, data: String): Bool {
        let lease = WriteLease(file)
        if (!lease.takeoverIfStale()) {
            return false
        }
        try {
            let log = SessionLog(file)
            if (exists(file) && !log.load()) {
                return false
            }
            log.append(eventType, data)
            if (!log.flush()) {
                return false
            }
            return true
        } finally {
            lease.release()
        }
    }

    private static func boolText(v: Bool): String {
        return if (v) { "true" } else { "false" }
    }

    private static func fieldOfText(text: String, key: String): String {
        try {
            let obj = JsonValue.fromStr(text).asObject()
            if (let Some(v) <- obj.get(key)) {
                return v.asString().getValue()
            }
        } catch (e: Exception) {
            return ""
        }
        return ""
    }
}
