package core
import std.collection.ArrayList
import std.fs.*
import std.io.*

// 一次 provider attempt 产出的 chunk 序列（假 provider，真实 SSE 后续接入）
public class Chunk {
    let kind: String    // text | tool-call-delta | usage | finish
    public let text: String
    let reason: String
    public init(kind: String, text: String, reason: String) {
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
    public let text = ArrayList<String>()
    public let toolCalls = ArrayList<String>()
    public var usage: String = ""
    public var finishReason: String = ""
    public var interrupted: Bool = true

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
    public let allowed: Bool
    public let why: String
    public init(allowed: Bool, why: String) {
        this.allowed = allowed
        this.why = why
    }
}

public class ToolRuntime {
    let log: SessionLog
    let registry: ToolRegistry
    public var guardDenials: Int64 = 0
    public var registryMisses: Int64 = 0
    // 每次执行都从头新建：留在上一次上会被读成「这次也走过了那一段」
    public var lastDetail = ToolDetail()

    public init(log: SessionLog, registry: ToolRegistry) {
        this.log = log
        this.registry = registry
    }

    // 固定序：注册表查询 → 审批 → guard → pre-execute → snapshot → execute → post-execute（无损校验）
    public func execute(name: String, args: String, answer: String, allowedByGuard: Bool): ApprovalOutcome {
        lastDetail = ToolDetail()
        log.append("tool/call", "${name} ${args}")
        if (!registry.has(name)) {
            // 未登记的工具不走审批：拒绝并计数，审批应答再正确也无效
            registryMisses += 1
            lastDetail.stage = "unregistered"
            log.append("tool/result", "unregistered:${name}")
            return ApprovalOutcome(false, "unregistered-tool:${name}")
        }
        if (registry.requiresApproval(name)) {
            // fail-closed：只有 allowed-once 放行，无应答者/非法应答一律拒
            if (answer != "allowed-once") {
                lastDetail.stage = "approval-denied"
                log.append("tool/result", "denied:${name}:${answer}")
                return ApprovalOutcome(false, "approval-not-allowed-once")
            }
        }
        return pipeline(name, args, allowedByGuard)
    }

    // 走审批工单的固定序：注册表 → 消费一次性凭据 → guard → execute → tool/result 落盘。
    // 与 execute() 的区别只在审批来源：这里的答案必须是 desk 发过号的工单，
    // 调用方自己声明「批过了」不作数；工单过期、被拒、已用过，全都拒。
    public func executeWithApproval(name: String, args: String, approvalId: Int64, allowedByGuard: Bool, desk: ApprovalDesk): ApprovalOutcome {
        lastDetail = ToolDetail()
        log.append("tool/call", "${name} ${args}")
        if (!registry.has(name)) {
            registryMisses += 1
            lastDetail.stage = "unregistered"
            log.append("tool/result", "unregistered:${name}")
            return ApprovalOutcome(false, "unregistered-tool:${name}")
        }
        if (registry.requiresApproval(name)) {
            if (desk.consume(approvalId) != "allowed-once") {
                let st = desk.stateOf(approvalId)
                lastDetail.stage = "approval-denied"
                log.append("tool/result", "denied:${name}:approval-${st}")
                return ApprovalOutcome(false, "approval-not-granted:${st}")
            }
        }
        // guard 之后的执行统一走 pipeline：两种审批来源共用同一条管线，
        // 审批怎么来的不该改变参数归一化、snapshot 或无损校验的行为。
        return pipeline(name, args, allowedByGuard)
    }

    // guard → pre-execute → snapshot → execute → post-execute（无损校验），五段都在
    // lastDetail 上留痕；失败一律归一成互不相同的阶段码——只报「没成功」的管线，
    // 日志和界面都答不出该找谁。
    private func pipeline(name: String, args: String, allowedByGuard: Bool): ApprovalOutcome {
        if (!allowedByGuard) {
            guardDenials += 1
            lastDetail.stage = "guard-denied"
            log.append("tool/result", "denied:${name}:guard")
            return ApprovalOutcome(false, "guard-denied")
        }
        if (name != "write") {
            // 注册过但这个实现还没写的工具：与「未登记」是两种失败，必须分开归一
            lastDetail.stage = "unknown-tool"
            log.append("tool/result", "unknown-tool:${name}")
            return ApprovalOutcome(false, "unknown-tool:${name}")
        }
        let parsed = normalizeArgs(args)
        lastDetail.preRewrote = (parsed.norm != args)
        lastDetail.argsAfterPre = parsed.norm
        if (!parsed.ok) {
            lastDetail.stage = "bad-args"
            log.append("tool/result", "bad-args")
            return ApprovalOutcome(false, "bad-args")
        }
        lastDetail.snapshotBefore = priorSize(parsed.path)
        lastDetail.snapshotExpected = parsed.content.toArray().size
        try {
            File.writeTo(parsed.path, parsed.content.toArray())
        } catch (e: IOException) {
            lastDetail.stage = "io-error"
            log.append("tool/result", "io-error:${parsed.path}")
            return ApprovalOutcome(false, "io-error:${parsed.path}")
        } catch (e: Exception) {
            lastDetail.stage = "threw"
            log.append("tool/result", "threw:${parsed.path}")
            return ApprovalOutcome(false, "threw:${parsed.path}")
        }
        // post-execute：写后重读比对字节，少一个都不算成功
        let back = File.readFrom(parsed.path)
        let want = parsed.content.toArray()
        if (back.size != want.size) {
            lastDetail.verified = false
            lastDetail.stage = "torn-write"
            log.append("tool/result", "torn-write:${parsed.path}:expected=${want.size},got=${back.size}")
            return ApprovalOutcome(false, "torn-write:${parsed.path}")
        }
        lastDetail.verified = true
        lastDetail.stage = "ran"
        let out = "ok:${parsed.path}"
        log.append("tool/result", out)
        return ApprovalOutcome(true, out)
    }

    // pre-execute 的归一化只动「路径与正文之间」的空白：路径前的空白、路径与正文之间多余的
    // 空白都吃掉，但正文内部的空格是内容，不是分隔符——把它当分隔符会静默丢内容。
    func normalizeArgs(args: String): ToolArgs {
        let parts = args.split(" ")
        var path = ""
        var body = ArrayList<String>()
        var i: Int64 = 0
        while (i < parts.size) {
            if (parts[i].size > 0) {
                break
            }
            i += 1
        }
        if (i < parts.size) {
            path = parts[i]
            i += 1
        }
        while (i < parts.size && parts[i].size == 0) {
            i += 1
        }
        while (i < parts.size) {
            body.add(parts[i])
            i += 1
        }
        if (path.size == 0 || body.size == 0) {
            return ToolArgs(path, "", "${path}", false)
        }
        // 尾部空白同属要丢掉的「分隔区」，只有正文中间的空白才是内容
        var last = body.size - 1
        while (last >= 0 && body[last].size == 0) {
            last -= 1
        }
        if (last < 0) {
            return ToolArgs(path, "", "${path}", false)
        }
        var content = body[0]
        var j: Int64 = 1
        while (j <= last) {
            content = "${content} ${body[j]}"
            j += 1
        }
        return ToolArgs(path, content, "${path} ${content}", true)
    }

    func priorSize(path: String): Int64 {
        if (!exists(Path(path))) {
            return Int64(0)
        }
        try {
            return File.readFrom(path).size
        } catch (e: Exception) {
            return Int64(-2)
        }
    }
}

// pre-execute 的产物：路径、正文、归一化后的整串（用于判断有没有改写过）。
public class ToolArgs {
    public let path: String
    public let content: String
    public let norm: String
    public let ok: Bool

    public init(path: String, content: String, norm: String, ok: Bool) {
        this.path = path
        this.content = content
        this.norm = norm
        this.ok = ok
    }
}

// 管线各段留下的事实。两个入口与日志都靠它回答「走到哪一段、为什么停」，
// 而不是靠返回值猜。
public class ToolDetail {
    public var stage: String = "not-run"
    public var argsAfterPre: String = ""
    public var preRewrote: Bool = false
    public var snapshotBefore: Int64 = -1
    public var snapshotExpected: Int64 = 0
    public var verified: Bool = false
}
