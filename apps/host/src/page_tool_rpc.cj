package host

import core.*
import std.sync.*
import stdx.encoding.json.*

class HostPageRuntime {
    let channel: PageToolChannel
    let log: SessionLog
    let desk: ApprovalDesk
    let lease: WriteLease
    let path: String
    let sessionId: String
    let mtx = Mutex()
    var manualRunning = false
    var manualToken: ?TurnToken = None
    var worker: ?Future<Unit> = None
    init(log: SessionLog, desk: ApprovalDesk, lease: WriteLease, sessionId: String, path: String) {
        this.log = log
        this.desk = desk
        this.lease = lease
        this.sessionId = sessionId
        this.channel = PageToolChannel(sessionId)
        this.path = path
    }
    func busy(): Bool {
        mtx.lock();
        try {
            return manualRunning
        } finally {
            mtx.unlock()
        }
    }
    func checkpoint(event: String, body: String) {
        if (!lease.protects(path) || log.isDurableFrozen()) {
            throw Exception("page-not-writer")
        }
        log.append(event, body)
        if (!log.durableCheckpoint(lease)) {
            log.freezeAfterDurableFailure();
            throw Exception("page-persistence-failed")
        }
    }
    func prepare(name: String, args: String): String {
        PageToolExecutor(channel, sessionId).validateArguments(name, args)
        if (PermissionPolicy().decide(ModeController(log).current(), name) == "deny") {
            throw Exception("approval-mode-denied")
        }
        let id = if (name == "page.readState") {
            Int64(0)
        } else {
            desk.askForCall(name, args)
        }
        if (!log.durableCheckpoint(lease)) {
            log.freezeAfterDurableFailure();
            throw Exception("page-persistence-failed")
        }
        return "{\"sessionId\":\"${jsonEscapeText(sessionId)}\",\"approvalId\":${id}}"
    }
    func start(name: String, args: String, approvalId: Int64, rpcId: String) {
        mtx.lock()
        try {
            if (manualRunning) {
                throw Exception("page-call-in-flight")
            }
            let token = TurnToken();
            manualRunning = true
            manualToken = Some(token)
            let state = this
            worker = Some(spawn {
                => try {
                    let registry = ToolRegistry()
                    for (spec in pageToolSpecs()) {
                        registry.register(spec)
                    }
                    let runtime = ToolRuntime(state.log, registry, modelProtocol: true,
                        page: Some(PageToolExecutor(state.channel, state.sessionId)), lspToken: token)
                    let outcome = runtime.executeWithApproval(name, args, approvalId, true, state.desk)
                    let result = if (outcome.allowed || outcome.structured) {
                        outcome.why
                    } else {
                        "{\"error\":\"${jsonEscapeText(outcome.why)}\"}"
                    }
                    state.checkpoint("page-tool/result", result)
                    emit(okFrame(rpcId, result))
                } catch (e: Exception) {
                    emit(errFrame(rpcId, -32028, e.message))
                } finally {
                    state.mtx.lock();
                    state.manualRunning = false
                    state.mtx.unlock()
                }
            })
        } finally {
            mtx.unlock()
        }
    }
    func shutdown(): Bool {
        cancel()
        if (let Some(handle) <- worker) {
            try {
                handle.get(5 * Duration.second)
            } catch (_: Exception) {
                return false
            }
        }
        return !busy()
    }
    func cancel() {
        mtx.lock()
        try { if (let Some(token) <- manualToken) { token.cancel() } } finally { mtx.unlock() }
        channel.cancel()
    }
}

func isPageToolMethod(method: String): Bool {
    return method == "page/tool/attach" || method == "page/tool/prepare" || method == "page/tool/call" || method ==
        "page/tool/poll" || method == "page/tool/claim" || method == "page/tool/result" || method == "page/tool/cancel"
}

func handlePageToolRpc(host: HostRuntime, method: String, body: String, rpcId: String): Bool {
    if (!isPageToolMethod(method)) {
        return false
    }
    try {
        let params = JsonValue.fromStr(body).asObject().get("params").getOrThrow().asObject()
        if (method == "page/tool/attach") {
            if (params.size() != 0) {
                throw Exception("bad-page-arguments")
            }
            if (host.pageRuntime.isNone() || host.pageRuntime.getOrThrow().sessionId != host.activeId) {
                host.pageRuntime = Some(HostPageRuntime(host.shared, host.approvalDesk, host.lease, host.activeId,
                    host.p))
            }
            emit(okFrame(rpcId, "{\"sessionId\":\"${jsonEscapeText(host.activeId)}\"}"));
            return true
        }
        let runtime = host.pageRuntime.getOrThrow()
        if (runtime.sessionId != host.activeId || params.get("sessionId").getOrThrow().asString().getValue() != host
            .activeId) {
            throw Exception("page-session-changed")
        }
        if (method == "page/tool/poll") {
            if (params.size() != 1) {
                throw Exception("bad-page-arguments")
            }
            let requests = JsonArray()
            for (request in runtime.channel.queued()) {
                let entry = JsonObject();
                entry.put("sessionId", JsonString(request.sessionId));
                entry.put("requestId", JsonString(request.requestId))
                entry.put("name", JsonString(request.name));
                entry.put("arguments", JsonString(request.arguments));
                requests.add(entry)
            }
            let result = JsonObject();
            result.put("sessionId", JsonString(host.activeId));
            result.put("requests", requests)
            emit(okFrame(rpcId, result.toString()));
            return true
        }
        if (method == "page/tool/cancel") {
            if (params.size() != 1) {
                throw Exception("bad-page-arguments")
            }
            runtime.cancel();
            emit(okFrame(rpcId, "{\"stopRequested\":true,\"outcome\":\"unconfirmed\"}"));
            return true
        }
        if (!host.leaseHeld) {
            if (!host.lease.takeoverIfStale()) {
                throw Exception("already-owned")
            }
            if (!loadForWrite(host.shared, host.meter)) {
                host.lease.release();
                throw Exception("replay-rejected")
            }
            host.leaseHeld = true
        }
        if (method == "page/tool/prepare" || method == "page/tool/call") {
            if (params.size() != (if (method == "page/tool/prepare") {
                3
            } else {
                4
            })) {
                throw Exception("bad-page-arguments")
            }
            let name = params.get("name").getOrThrow().asString().getValue()
            let args = params.get("arguments").getOrThrow().asString().getValue()
            if (method == "page/tool/prepare") {
                emit(okFrame(rpcId, runtime.prepare(name, args)))
            } else {
                runtime.start(name, args, params.get("approvalId").getOrThrow().asInt().getValue(), rpcId)
            }
            return true
        }
        let requestId = params.get("requestId").getOrThrow().asString().getValue()
        if (method == "page/tool/claim") {
            if (params.size() != 2) {
                throw Exception("bad-page-arguments")
            }
            let request = runtime.channel.peek(requestId)
            let event = JsonObject();
            event.put("sessionId", JsonString(request.sessionId));
            event.put("requestId", JsonString(request.requestId))
            event.put("name", JsonString(request.name));
            event.put("arguments", JsonString(request.arguments))
            runtime.checkpoint("page-tool/dispatch", event.toString())
            let allowed = runtime.channel.claim(requestId)
            emit(okFrame(rpcId, "{\"allowed\":${if (allowed) { "true" } else { "false" }}}"))
        } else {
            if (params.size() != 3) {
                throw Exception("bad-page-arguments")
            }
            let result = params.get("result").getOrThrow().asString().getValue()
            let accepted = runtime.channel.deliver(host.activeId, requestId, result)
            emit(okFrame(rpcId, "{\"accepted\":${if (accepted) { "true" } else { "false" }}}"))
        }
    } catch (e: Exception) {
        emit(errFrame(rpcId, -32028, e.message))
    }
    return true
}
