package core

import std.collection.*
import std.sync.*
import stdx.encoding.json.*

// 双入口共用的操作契约。提供方和工作区由可信装配传入，请求不能指定可执行文件。
public class AcpRuntimeApi {
    let service: AcpDelegationService
    let desk: ApprovalDesk
    let lease: WriteLease
    let workspace: String
    let tasks = HashMap<String, AcpLiveTask>()
    let mtx = Mutex()
    var accepting = true
    public init(service: AcpDelegationService, desk: ApprovalDesk, lease: WriteLease, workspace: String) {
        if (workspace.size == 0 || service.journal.isNone() || service.journal.getOrThrow().log.path != desk.log.path ||
            !lease.protects(desk.log.path)) {
            throw Exception("not-authorized:acp-runtime-owner")
        }
        this.service = service
        this.desk = desk
        this.lease = lease
        this.workspace = workspace
    }
    public static func handles(method: String): Bool {
        return method == "acp/delegation/create" || method == "acp/delegation/poll" || method == "acp/delegation/answer" ||
            method == "acp/delegation/cancel" || method == "acp/delegation/close"
    }
    // 会话切换必须同时等到工作线程结束与所拥有进程退出；终态文字不替代退出事实。
    public func quiescent(): Bool {
        mtx.lock()
        try {
            for ((_, live) in tasks) {
                if (!live.progress.finished.load() || !live.process.exitObserved()) {
                    return false
                }
            }
            return true
        } finally {
            mtx.unlock()
        }
    }
    // 关闭准入后不再重启。只收束本实例实际持有的任务，恢复记录没有进程可重放。
    public func shutdown(): Bool {
        let owned = ArrayList<AcpLiveTask>()
        mtx.lock()
        try {
            accepting = false
            for ((_, live) in tasks) {
                owned.add(live)
            }
        } finally {
            mtx.unlock()
        }
        var settled = true
        for (live in owned) {
            // 先通知并等本轮回执，避免先杀进程让 ReplyTable 挂到请求超时。
            if (!live.progress.finished.load()) {
                try {
                    live.cancel(service.describe(live.id).revision)
                } catch (_: Exception) {}
                try {
                    live.wait(timeoutMs: 5000)
                } catch (_: Exception) {}
            }
            var closed = false
            for (_ in 0..3) {
                try {
                    let state = service.describe(live.id)
                    service.close(live.id, state.revision)
                    closed = live.process.exitObserved()
                    break
                } catch (e: Exception) {
                    if (!e.message.startsWith("revision-conflict:")) {
                        break
                    }
                }
            }
            try {
                live.wait(timeoutMs: 5000)
            } catch (_: Exception) {
                settled = false
            }
            if (!closed || !live.process.exitObserved() || !live.progress.finished.load()) {
                settled = false
            }
        }
        return settled && !desk.log.isDurableFrozen() && desk.log.durableCheckpoint(lease)
    }
    public func dispatch(method: String, params: String): String {
        if (!AcpRuntimeApi.handles(method)) {
            throw Exception("unsupported:acp-runtime-method")
        }
        let obj = JsonValue.fromStr(params).asObject()
        if (obj.get("sessionId").getOrThrow().asString().getValue() != service.sessionId) {
            throw Exception("not-authorized:acp-session-changed")
        }
        let size = if (method == "acp/delegation/create" || method == "acp/delegation/answer") {
            5
        } else if (method == "acp/delegation/poll") {
            2
        } else {
            3
        }
        if (obj.size() != size) {
            throw Exception("invalid-input:acp-runtime-arguments")
        }
        if (method == "acp/delegation/create") {
            let taskId = obj.get("taskId").getOrThrow().asString().getValue()
            let requestId = obj.get("requestId").getOrThrow().asString().getValue()
            let peer = obj.get("peerId").getOrThrow().asString().getValue()
            let text = obj.get("taskText").getOrThrow().asString().getValue()
            if (taskId.size == 0 || taskId.size > 256 || requestId.size == 0 || requestId.size > 256 || peer.size == 0 ||
                peer.size > 256 || text.size == 0 || text.size > 65536) {
                throw Exception("invalid-input:acp-task")
            }
            mtx.lock()
            try {
                if (!accepting) {
                    throw Exception("not-authorized:acp-runtime-closed")
                }
                let created = service.create(taskId, requestId, peer, text, workspace)
                if (let Some(existing) <- tasks.get(created.id)) {
                    return existing.poll()
                }
                if (created.phase != "running") {
                    throw Exception("provider-unavailable:${created.result}")
                }
                let live = AcpLiveTask(service, desk, lease, created.id, created.revision, text)
                tasks[created.id] = live
                return live.poll()
            } finally {
                mtx.unlock()
            }
        }
        let id = obj.get("delegationId").getOrThrow().asString().getValue()
        if (id.size == 0 || id.size > 256) {
            throw Exception("invalid-input:acp-delegation-id")
        }
        mtx.lock()
        let live: AcpLiveTask
        try {
            if (tasks.get(id).isNone()) {
                throw Exception("outcome-unknown:no-owned-acp-task")
            }
            live = tasks.get(id).getOrThrow()
        } finally {
            mtx.unlock()
        }
        if (method == "acp/delegation/poll") {
            return live.poll()
        }
        if (method == "acp/delegation/answer") {
            let approval = obj.get("approvalId").getOrThrow().asInt().getValue()
            let decision = obj.get("decision").getOrThrow().asString().getValue()
            let option = obj.get("optionId").getOrThrow().asString().getValue()
            if (approval < 1 || option.size > 256 || (decision != "allowed-once" && decision != "denied")) {
                throw Exception("invalid-input:acp-permission-answer")
            }
            let answer = live.answer(approval, decision, option)
            let result = JsonObject();
            result.put("state", JsonString(answer.state));
            result.put("reason", JsonString(answer.reason))
            return result.toString()
        }
        let revision = obj.get("revision").getOrThrow().asInt().getValue()
        if (revision < 1) {
            throw Exception("invalid-input:acp-revision")
        }
        if (method == "acp/delegation/cancel") {
            live.cancel(revision)
        } else {
            service.close(id, revision)
        }
        return live.poll()
    }
}
