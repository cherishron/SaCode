package core

import std.collection.*
import std.fs.*
import std.sync.*
import stdx.encoding.json.*

// 同进程同一路径只准一个团队写实例；跨进程由真实写租约互斥。
let teamBoardRegistryMutex = Mutex()
let teamBoardRegistry = HashSet<String>()

private func boardString(obj: JsonObject, key: String): String {
    return obj.get(key).getOrThrow().asString().getValue()
}
private func boardFlag(obj: JsonObject, key: String): Bool {
    return obj.get(key).getOrThrow().asBool().getValue()
}
private func boardNonblank(text: String): Unit {
    if (text.trimAscii().size == 0) { throw Exception("team-board-empty-value") }
}
private func boardFields(fields: Array<(String, String)>): JsonObject {
    let obj = JsonObject()
    for ((key, value) in fields) { obj.put(key, JsonString(value)) }
    return obj
}

// 只存在于一次持锁操作中的日志投影，不保留第二业务真源。
private class BoardProjection {
    let members = ArrayList<JsonObject>()
    let tasks = ArrayList<JsonObject>()
    let messages = ArrayList<JsonObject>()
    func replace(items: ArrayList<JsonObject>, obj: JsonObject): Unit {
        let id = boardString(obj, "id")
        for (i in 0..items.size) {
            if (boardString(items[i], "id") == id) { items[i] = obj; return }
        }
        items.add(obj)
    }
    func find(items: ArrayList<JsonObject>, id: String): JsonObject {
        for (obj in items) { if (boardString(obj, "id") == id) { return obj } }
        throw Exception("team-board-unknown-id")
    }
    func actor(sessionId: String): JsonObject {
        for (obj in members) {
            if (boardString(obj, "sessionId") == sessionId && boardFlag(obj, "active")) { return obj }
        }
        throw Exception("team-board-unknown-session")
    }
    func leader(sessionId: String): Unit {
        if (boardString(actor(sessionId), "role") != "leader") { throw Exception("team-board-leader-required") }
    }
    func array(items: ArrayList<JsonObject>): JsonArray {
        let arr = JsonArray()
        for (obj in items) { arr.add(obj) }
        return arr
    }
}

public class TeamBoard {
    let log: SessionLog
    let lease: WriteLease
    let mtx = Mutex()
    let registryKey: String
    var closed = false

    public init(log: SessionLog, lease: WriteLease) {
        this.log = log
        this.lease = lease
        // 即使日志尚不存在，也规范化父目录；Windows 文件路径不区分大小写。
        let path = Path(log.path)
        this.registryKey = (canonicalize(path.parent).toString() + "/" + path.fileName).toAsciiLower()
        synchronized(teamBoardRegistryMutex) {
            if (!lease.protects(log.path) || teamBoardRegistry.contains(registryKey)) {
                throw Exception("team-board-writer-conflict")
            }
            teamBoardRegistry.add(registryKey)
        }
        try {
            if (log.isDurableFrozen() || log.pendingCount() != 0) { throw Exception("team-board-log-not-durable") }
            if (log.eventCount() == 0 && !log.load()) { throw Exception("team-board-replay-rejected") }
            projection()
        } catch (e: Exception) {
            synchronized(teamBoardRegistryMutex) { teamBoardRegistry.remove(registryKey) }
            throw e
        }
    }

    private func requireOpen(): Unit {
        if (closed) { throw Exception("team-board-closed") }
        if (log.isDurableFrozen()) { throw Exception("team-board-durable-frozen") }
        if (!lease.protects(log.path)) {
            log.freezeAfterDurableFailure()
            throw Exception("team-board-lost-lease")
        }
    }
    private func projection(): BoardProjection {
        requireOpen()
        let state = BoardProjection()
        for (ev in log.snapshotEvents()) {
            if (ev.eventType == "team-board/member") {
                state.replace(state.members, JsonValue.fromStr(ev.data).asObject())
            } else if (ev.eventType == "team-board/task") {
                state.replace(state.tasks, JsonValue.fromStr(ev.data).asObject())
            } else if (ev.eventType == "team-board/message") {
                state.replace(state.messages, JsonValue.fromStr(ev.data).asObject())
            }
        }
        return state
    }
    // 一次变更只追加一条完整 JSON 事件；成功回执必须在真实持久屏障之后。
    private func commit(kind: String, obj: JsonObject): Unit {
        requireOpen()
        try {
            log.append("team-board/" + kind, obj.toString())
            if (!log.durableCheckpointBatched(lease)) { throw Exception("team-board-checkpoint-failed") }
        } catch (e: Exception) {
            log.freezeAfterDurableFailure()
            throw e
        }
    }

    public func join(actorSessionId: String, id: String, role: String, sessionId: String): Unit {
        synchronized(mtx) {
            let s = projection()
            boardNonblank(id); boardNonblank(role); boardNonblank(sessionId)
            if (s.members.size == 0) {
                if (role != "leader" || actorSessionId != sessionId) { throw Exception("team-board-bootstrap-leader") }
            } else {
                s.leader(actorSessionId)
                if (role == "leader") { throw Exception("team-board-single-leader") }
            }
            for (member in s.members) {
                if (boardString(member, "id") == id || boardString(member, "sessionId") == sessionId) {
                    throw Exception("team-board-duplicate-member")
                }
            }
            let obj = boardFields([("id", id), ("role", role), ("sessionId", sessionId)])
            obj.put("active", JsonBool(true))
            commit("member", obj)
        }
    }
    public func leave(actorSessionId: String, id: String): Unit {
        synchronized(mtx) {
            let s = projection()
            let actor = s.actor(actorSessionId)
            if (boardString(actor, "id") != id) { s.leader(actorSessionId) }
            let member = s.find(s.members, id)
            if (!boardFlag(member, "active")) { return }
            member.put("active", JsonBool(false))
            commit("member", member)
        }
    }
    public func createTask(actorSessionId: String, id: String, title: String, dependencies: Array<String>): Unit {
        synchronized(mtx) {
            let s = projection(); s.leader(actorSessionId)
            boardNonblank(id); boardNonblank(title)
            for (task in s.tasks) {
                if (boardString(task, "id") == id) { throw Exception("team-board-duplicate-task") }
            }
            let deps = JsonArray()
            let seen = HashSet<String>()
            for (dep in dependencies) {
                if (dep == id || seen.contains(dep)) { throw Exception("team-board-invalid-dependency") }
                s.find(s.tasks, dep); seen.add(dep); deps.add(JsonString(dep))
            }
            let obj = boardFields([("id", id), ("title", title), ("phase", "pending"), ("owner", ""), ("assignedTo", ""), ("result", "")])
            obj.put("dependencies", deps)
            commit("task", obj)
        }
    }
    public func assign(actorSessionId: String, id: String, memberId: String): Unit {
        synchronized(mtx) {
            let s = projection(); s.leader(actorSessionId)
            if (!boardFlag(s.find(s.members, memberId), "active")) { throw Exception("team-board-inactive-member") }
            let task = s.find(s.tasks, id)
            if (boardString(task, "phase") != "pending") { throw Exception("team-board-task-not-pending") }
            if (boardString(task, "assignedTo") == memberId) { return }
            task.put("assignedTo", JsonString(memberId)); commit("task", task)
        }
    }
    public func claim(actorSessionId: String, id: String): Bool {
        return synchronized(mtx) {
            let s = projection(); let actor = s.actor(actorSessionId)
            let task = s.find(s.tasks, id)
            if (boardString(task, "phase") != "pending") { return false }
            let memberId = boardString(actor, "id")
            let assigned = boardString(task, "assignedTo")
            if (assigned.size > 0 && assigned != memberId) { throw Exception("team-board-assignment-mismatch") }
            let deps = task.get("dependencies").getOrThrow().asArray()
            for (i in 0..deps.size()) {
                let dep = deps.get(i).getOrThrow().asString().getValue()
                if (boardString(s.find(s.tasks, dep), "phase") != "completed") { throw Exception("team-board-dependency-pending") }
            }
            task.put("owner", JsonString(memberId)); task.put("phase", JsonString("in_progress"))
            commit("task", task)
            return true
        }
    }
    public func complete(actorSessionId: String, id: String, result: String): Unit {
        synchronized(mtx) {
            let s = projection(); let actor = s.actor(actorSessionId)
            boardNonblank(result)
            let task = s.find(s.tasks, id)
            if (boardString(task, "phase") != "in_progress" || boardString(task, "owner") != boardString(actor, "id")) {
                throw Exception("team-board-completion-denied")
            }
            task.put("phase", JsonString("completed")); task.put("result", JsonString(result))
            commit("task", task)
        }
    }
    public func send(actorSessionId: String, recipientId: String, text: String): String {
        return synchronized(mtx) {
            let s = projection(); let actor = s.actor(actorSessionId)
            boardNonblank(text)
            let recipient = s.find(s.members, recipientId)
            if (!boardFlag(recipient, "active")) { throw Exception("team-board-inactive-recipient") }
            let id = "team-message-${log.eventCount()}"
            let obj = boardFields([("id", id), ("sender", boardString(actor, "id")), ("senderSessionId", actorSessionId),
                ("recipient", recipientId), ("recipientSessionId", boardString(recipient, "sessionId")), ("text", text)])
            obj.put("delivered", JsonBool(false)); commit("message", obj)
            return id
        }
    }
    public func acknowledge(actorSessionId: String, id: String): Unit {
        synchronized(mtx) {
            let s = projection(); s.actor(actorSessionId)
            let message = s.find(s.messages, id)
            if (boardString(message, "recipientSessionId") != actorSessionId) { throw Exception("team-board-ack-denied") }
            if (boardFlag(message, "delivered")) { return }
            message.put("delivered", JsonBool(true)); commit("message", message)
        }
    }
    public func ackDelivery(actorSessionId: String, id: String): Unit { acknowledge(actorSessionId, id) }
    private func deliveries(actorSessionId: String, delivered: Bool): String {
        let s = projection(); s.actor(actorSessionId)
        let out = JsonArray()
        for (message in s.messages) {
            if (boardString(message, "recipientSessionId") == actorSessionId && boardFlag(message, "delivered") == delivered) { out.add(message) }
        }
        return out.toString()
    }
    public func pending(actorSessionId: String): String {
        return synchronized(mtx) { deliveries(actorSessionId, false) }
    }
    public func delivered(actorSessionId: String): String {
        return synchronized(mtx) { deliveries(actorSessionId, true) }
    }
    public func task(id: String): String {
        return synchronized(mtx) { let s = projection(); s.find(s.tasks, id).toString() }
    }
    public func snapshot(): String {
        return synchronized(mtx) {
            let s = projection(); let obj = JsonObject()
            obj.put("members", s.array(s.members)); obj.put("tasks", s.array(s.tasks)); obj.put("messages", s.array(s.messages))
            obj.toString()
        }
    }
    // 关闭仅退还本实例登记，不释放调用方持有的租约；幂等且不再访问失败日志。
    public func close(): Unit {
        synchronized(mtx) {
            if (closed) { return }
            closed = true
            synchronized(teamBoardRegistryMutex) { teamBoardRegistry.remove(registryKey) }
        }
    }
}
