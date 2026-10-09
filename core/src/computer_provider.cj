package core

import std.fs.*
import std.sync.*
import std.time.*
import stdx.encoding.json.*

public class ComputerProviderResult {
    public let ok: Bool
    public let verb: String
    public let content: String
    public let failureKind: String
    public let message: String

    public init(ok: Bool, verb: String, content: String, failureKind: String, message: String) {
        this.ok = ok
        this.verb = verb
        this.content = content
        this.failureKind = failureKind
        this.message = message
    }
}

func computerFailure(verb: String, kind: String, message: String): ComputerProviderResult {
    return ComputerProviderResult(false, verb, "{}", kind, message)
}

// ExtProcess 只负责运输和初步配对；收到后仍须严格检查顶层 JSON-RPC 信封。
func computerDecode(frame: String, id: Int64, verb: String): ComputerProviderResult {
    try {
        let envelope = JsonValue.fromStr(frame).asObject()
        if (envelope["jsonrpc"].asString().getValue() != "2.0" ||
            envelope["id"].asInt().getValue() != id || envelope.containsKey("error") ||
            envelope.containsKey("method") || envelope.size() != 3) {
            return computerFailure(verb, "protocol-error", "计算机提供者响应信封非法")
        }
        let result = envelope["result"].asObject()
        let ok = result["ok"].asBool().getValue()
        let returnedVerb = result["verb"].asString().getValue()
        let content = result["content"].asObject().toString()
        let kind = result["failureKind"].asString().getValue()
        let message = result["message"].asString().getValue()
        if (returnedVerb != verb || result.size() != 5 || (ok && kind != "") || (!ok && kind == "")) {
            return computerFailure(verb, "protocol-error", "计算机提供者结果契约非法")
        }
        return ComputerProviderResult(ok, returnedVerb, content, kind, message)
    } catch (_: Exception) {
        return computerFailure(verb, "protocol-error", "计算机提供者响应 JSON 或字段类型非法")
    }
}

public class ComputerProviderClient {
    let proc: ExtProcess
    let started = AtomicBool(false)

    public init(command: String, arguments: Array<String>, workingDirectory!: Path) {
        this.proc = ExtProcess(command, arguments, workingDirectory: workingDirectory)
    }

    public func start(): Bool {
        let ok = proc.start()
        started.store(ok)
        return ok
    }

    public func invoke(verb: String, args: String,
                       token!: TurnToken = TurnToken(), timeoutMs!: Int64 = 30000): ComputerProviderResult {
        // 未发出的请求可确认为取消；已发出的动作只能按原请求终态结算。
        if (token.cancelled()) { return computerFailure(verb, "cancelled", "计算机调用发送前已取消") }
        if (!started.load() || !proc.alive()) {
            return computerFailure(verb, "provider-not-alive", "计算机提供者未启动")
        }
        if (timeoutMs <= 0) { return computerFailure(verb, "invalid-args", "等待时限必须为正数") }
        let params = JsonObject()
        try {
            params.put("verb", JsonString(verb))
            params.put("args", JsonValue.fromStr(args).asObject())
        } catch (_: Exception) {
            return computerFailure(verb, "invalid-args", "计算机调用参数必须是合法 JSON 对象")
        }
        if (token.cancelled()) { return computerFailure(verb, "cancelled", "计算机调用发送前已取消") }
        // 全部请求（包含取消和 shutdown）共用 ExtProcess 的编号源，避免互相撞号。
        let id = proc.nextRequestId()
        let began = MonoTime.now()
        if (!proc.sendRequest(id, "computer/invoke", params.toString())) {
            return computerFailure(verb, "outcome-unknown", "请求发送失败，不能确认动作是否已送达")
        }
        let reply = spawn { => proc.awaitReply(id, timeoutMs) }
        var cancelSent = false
        while ((MonoTime.now() - began).toMilliseconds() < timeoutMs) {
            if (let Some(frame) <- reply.tryGet()) {
                if (let Some(body) <- frame) { return computerDecode(body, id, verb) }
                return computerFailure(verb, "outcome-unknown", "等待原调用终态超时，动作结果未知")
            }
            if (token.cancelled() && !cancelSent) {
                cancelSent = true
                let cancelId = proc.nextRequestId()
                // 带外取消只发送一次，确认帧不改变原动作结算，也不阻塞轮询。
                let remaining = max(Int64(1), timeoutMs - (MonoTime.now() - began).toMilliseconds())
                if (proc.sendRequest(cancelId, "computer/cancel", "{\"requestId\":${id}}")) {
                    spawn { => proc.awaitReply(cancelId, min(Int64(1500), remaining)) }
                }
            }
            sleep(5 * Duration.millisecond)
        }
        // 在边界再收一次已经到达的原终态，绝不拿取消确认伪造动作撤销。
        if (let Some(frame) <- reply.tryGet()) {
            if (let Some(body) <- frame) { return computerDecode(body, id, verb) }
        }
        return computerFailure(verb, "outcome-unknown", "等待原调用终态超时，动作结果未知")
    }

    public func close(): Int64 {
        started.store(false)
        return proc.close()
    }
}
