package cli
import std.collection.ArrayList
import std.fs.*
import std.io.*

// 一次 provider attempt 产出的 chunk 序列（假 provider，真实 SSE 后续接入）
public class Chunk {
    let kind: String    // text | tool-call-delta | usage | finish
    let text: String
    let reason: String
    init(kind: String, text: String, reason: String) {
        this.kind = kind
        this.text = text
        this.reason = reason
    }
}

public class FakeProvider {
    // 半帧/多字节分片：text 被切成两块，装配必须拼回原值
    public func script(): ArrayList<Chunk> {
        let c = ArrayList<Chunk>()
        c.add(Chunk("text", "你好，", ""))
        c.add(Chunk("text", "world", ""))
        c.add(Chunk("tool-call-delta", "read", ""))
        c.add(Chunk("usage", "12", ""))
        c.add(Chunk("finish", "", "stop"))
        return c
    }
}

public class Assembly {
    let text = ArrayList<String>()
    let toolCalls = ArrayList<String>()
    var usage: String = ""
    var finishReason: String = ""
    var interrupted: Bool = true

    // 规则：usage 必须先于 finish；finish 后不再接收 chunk；
    // max-tokens 结束时全部 tool calls 作废。
    public func push(ch: Chunk) {
        if (!interrupted) {
            return   // finish 之后的 chunk 视为协议违例，丢弃并保持终态
        }
        if (ch.kind == "text") {
            text.add(ch.text)
            return
        }
        if (ch.kind == "tool-call-delta") {
            toolCalls.add(ch.text)
            return
        }
        if (ch.kind == "usage") {
            if (finishReason.size == 0) { usage = ch.text }
            return
        }
        if (ch.kind == "finish") {
            finishReason = ch.reason
            interrupted = false
            if (ch.reason == "max-tokens") {
                toolCalls.clear()
            }
        }
    }

    public func assembledText(): String {
        var s = ""
        for (t in text) { s += t }
        return s
    }
}

public class ApprovalOutcome {
    let allowed: Bool
    let why: String
    init(allowed: Bool, why: String) {
        this.allowed = allowed
        this.why = why
    }
}

public class ToolRuntime {
    let log: SessionLog
    var guardDenials: Int64 = 0

    public init(log: SessionLog) {
        this.log = log
    }

    // 固定序：pre-execute → 审批 → guard → execute → tool/result 落盘
    public func execute(name: String, args: String, needsApproval: Bool, answer: String, allowedByGuard: Bool): ApprovalOutcome {
        log.append("tool/call", "${name} ${args}")
        if (needsApproval) {
            // fail-closed：只有 allowed-once 放行，无应答者/非法应答一律拒
            if (answer != "allowed-once") {
                log.append("tool/result", "denied:${name}:${answer}")
                return ApprovalOutcome(false, "approval-not-allowed-once")
            }
        }
        if (!allowedByGuard) {
            guardDenials += 1
            log.append("tool/result", "denied:${name}:guard")
            return ApprovalOutcome(false, "guard-denied")
        }
        let out = runTool(name, args)
        log.append("tool/result", out)
        return ApprovalOutcome(true, out)
    }

    func runTool(name: String, args: String): String {
        if (name != "write") {
            return "unknown-tool:${name}"
        }
        let parts = args.split(" ")
        if (parts.size < 2) {
            return "bad-args"
        }
        let body = parts[1].toArray()
        try {
            File.writeTo(parts[0], body)
            return "ok:${parts[0]}"
        } catch (e: IOException) {
            return "io-error"
        }
    }
}
