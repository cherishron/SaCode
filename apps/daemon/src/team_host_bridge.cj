package daemon

import core.*
import std.env.*
import std.fs.*
import std.io.*
import std.process.*
import std.sync.*
import std.collection.ArrayList
import stdx.encoding.json.*

// 只负责传输，团队身份、审批及持久状态均由同一个仓颉 Host 裁决。
let TEAM_METHODS = ["team/describe", "team/member/create", "team/message/send",
    "team/message/broadcast", "team/task/create", "team/task/assign", "team/task/claim",
    "team/task/complete", "team/member/stop", "team/approval/answer"]

func acceptsTeamMethod(method: String): Bool {
    for (name in TEAM_METHODS) { if (name == method) { return true } }
    return false
}

class TeamHostBridge {
    let command: String
    let root: Path
    let events: EventBus
    // 生命周期锁保护单例启动、停机与整帧写出，不在等待业务应答时持锁。
    let lifecycle = Mutex()
    let table = ReplyTable(256)
    let sequence = AtomicInt64(0)
    let inflight = AtomicInt64(0)
    let ended = AtomicBool(false)
    var proc: Option<SubProcess> = None
    var reader: Option<Future<Int64>> = None
    var closing = false
    var failure = ""
    let availableMethods = ArrayList<String>()

    public init(events: EventBus) {
        command = getVariable("SACODE_HOST") ?? ""
        root = canonicalize(".")
        this.events = events
    }

    public func configured(): Bool { command.size > 0 }

    private func drain(pipe: InputStream): Int64 {
        let input: StringReader<InputStream> = StringReader(pipe)
        try {
            while (true) {
                if (let Some(line) <- input.readln()) {
                    if (line.size == 0) { continue }
                    try {
                        let frame = JsonValue.fromStr(line).asObject()
                        if (frame.get("jsonrpc").getOrThrow().asString().getValue() != "2.0") {
                            throw Exception("invalid-host-frame")
                        }
                        if (let Some(id) <- frame.get("id")) {
                            // 请求不是应答：只认带 result 或 error 的内部整数编号。
                            if (frame.get("method").isSome() ||
                                (!frame.get("result").isSome() && !frame.get("error").isSome())) {
                                continue
                            }
                            table.put(id.asInt().getValue(), frame.toString())
                        } else {
                            let method = frame.get("method").getOrThrow().asString().getValue()
                            let params = frame.get("params").getOrThrow()
                            if (frame.get("result").isSome() || frame.get("error").isSome()) { continue }
                            // 不发布请求或应答；方法转义后交给既有 SSE 总线。
                            events.publish(jsonEscapeText(method), params.toString())
                        }
                    } catch (_: Exception) {
                        getStdErr().writeln("team-host: invalid stdout protocol frame")
                    }
                } else { break }
            }
        } catch (_: Exception) {
            getStdErr().writeln("team-host: stdout pipe closed")
        } finally {
            ended.store(true)
            table.stop()
        }
        return 0
    }

    private func exchange(p: SubProcess, method: String, params: String, timeoutMs: Int64): String {
        let id = sequence.fetchAdd(1) + 1
        table.track(id)
        try {
            // 调用方持生命周期锁，覆盖 write + flush 整帧。
            p.stdInPipe.write(("{\"jsonrpc\":\"2.0\",\"id\":${id},\"method\":\"${method}\",\"params\":${params}}\n").toArray())
            p.stdInPipe.flush()
            if (let Some(reply) <- table.take(id, timeoutMs)) { return reply }
            throw Exception("team-host-reply-timeout")
        } finally { table.untrack(id) }
    }

    public func ensureStarted(): Unit {
        synchronized(lifecycle) {
            if (closing) { throw Exception("team-host-closing") }
            if (failure.size > 0) { throw Exception(failure) }
            if (proc.isSome()) {
                if (ended.load()) { throw Exception("team-host-exited") }
                return
            }
            if (!configured()) { throw Exception("SACODE_HOST is not configured") }
            if (!Path(command).isAbsolute() || !exists(command)) {
                throw Exception("SACODE_HOST must specify an existing absolute executable")
            }
            try {
                if ((getVariable("SACODE_COMPUTER_USE") ?? "") == "1") {
                    throw Exception("computer-use-remote-grant-required")
                }
                let arguments = ArrayList<String>()
                if (let Some(raw) <- getVariable("SACODE_HOST_ARGS")) {
                    let values = JsonValue.fromStr(raw).asArray()
                    for (i in 0..values.size()) { arguments.add(values.get(i).getOrThrow().asString().getValue()) }
                }
                let p = launch(command, arguments.toArray(), workingDirectory: Some(root),
                    stdIn: ProcessRedirect.Pipe, stdOut: ProcessRedirect.Pipe,
                    stdErr: ProcessRedirect.Inherit)
                proc = Some(p)
                let pipe = p.stdOutPipe
                reader = Some(spawn { => this.drain(pipe) })
                // 真实握手证明可启动，而非仅凭路径存在发布能力。
                let reply = JsonValue.fromStr(exchange(p, "initialize", "{}", 3000)).asObject()
                let caps = reply.get("result").getOrThrow().asObject().get("capabilities").getOrThrow().asArray()
                var teamAvailable = false
                for (i in 0..caps.size()) {
                    let name = caps.get(i).getOrThrow().asString().getValue()
                    if (name == "team/describe") { teamAvailable = true }
                    if ((acceptsTeamMethod(name) || forwarded(name)) && !availableMethods.contains(name)) {
                        availableMethods.add(name)
                    }
                }
                if (teamAvailable && !availableMethods.contains("team/approval/answer")) {
                    availableMethods.add("team/approval/answer")
                }
                if (!teamAvailable) { throw Exception("team-host-capability-unavailable") }
                if (ended.load()) { throw Exception("team-host-exited") }
            } catch (_: Exception) {
                failure = "team-host-start-or-initialize-failed"
                table.stop()
                if (let Some(p) <- proc) {
                    p.terminate(force: true)
                    p.wait(timeout: 3000 * Duration.millisecond)
                }
                if (let Some(join) <- reader) { join.get(2000 * Duration.millisecond) }
                proc = None
                reader = None
                throw Exception(failure)
            }
        }
    }

    public func capabilities(): ArrayList<String> {
        ensureStarted()
        return synchronized(lifecycle) {
            let result = ArrayList<String>()
            for (name in availableMethods) { result.add(name) }
            result
        }
    }

    public func forward(method: String, params: String, clientId: String): String {
        if (!acceptsTeamMethod(method) && !forwarded(method)) { return errRpc(clientId, -32601, "method not found") }
        if (!hostParamsOk(params)) { return errRpc(clientId, -32602, "参数必须是 JSON 对象") }
        ensureStarted()
        synchronized(lifecycle) {
            if (!availableMethods.contains(method)) { throw Exception("host-method-unavailable") }
        }
        if (inflight.fetchAdd(1) >= 16) {
            inflight.fetchSub(1)
            throw Exception("team-host-too-many-inflight")
        }
        let id = sequence.fetchAdd(1) + 1
        table.track(id)
        try {
            synchronized(lifecycle) {
                if (closing || ended.load()) { throw Exception("team-host-unavailable") }
                let p = proc.getOrThrow()
                p.stdInPipe.write(("{\"jsonrpc\":\"2.0\",\"id\":${id},\"method\":\"${method}\",\"params\":${params}}\n").toArray())
                p.stdInPipe.flush()
            }
            if (let Some(line) <- table.take(id, 5000)) {
                let reply = JsonValue.fromStr(line).asObject()
                reply.put("id", JsonValue.fromStr(clientId))
                return reply.toString()
            }
            throw Exception("team-host-reply-timeout; outcome unknown")
        } finally { table.untrack(id); inflight.fetchSub(1) }
    }

    public func shutdown(): Unit {
        synchronized(lifecycle) {
            if (closing) { throw Exception("team-host-shutdown-already-requested") }
            closing = true
            if (let Some(p) <- proc) {
                try {
                    if (!ended.load()) {
                        // Host 将空行解释为输入结束，随后结算成员并归还租约。
                        p.stdInPipe.write("\n".toArray())
                        p.stdInPipe.flush()
                    }
                    try {
                        let code = p.wait(timeout: 3000 * Duration.millisecond)
                        if (code != 0) { getStdErr().writeln("team-host-nonzero-exit:${code}") }
                    } catch (_: Exception) {
                        p.terminate(force: true)
                        p.wait(timeout: 3000 * Duration.millisecond)
                        getStdErr().writeln("team-host-shutdown-forced")
                    }
                } finally {
                    table.stop()
                    if (let Some(f) <- reader) { f.get(2000 * Duration.millisecond) }
                }
            }
        }
    }
}
