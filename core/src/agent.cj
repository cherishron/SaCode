package core
import std.collection.ArrayList
import std.collection.HashMap
import std.fs.*
import std.io.*

// provider 增量；工具参数保留原始字符串分片，不解析或重编码。
public class Chunk {
    let kind: String    // text | tool-call-delta | usage | finish
    public let text: String
    let reason: String
    public let choiceIndex: Option<Int64>
    public let toolIndex: Option<Int64>
    public let toolId: Option<String>
    public let toolName: Option<String>
    public init(kind: String, text: String, reason: String,
        choiceIndex!: Option<Int64> = None, toolIndex!: Option<Int64> = None,
        toolId!: Option<String> = None, toolName!: Option<String> = None) {
        this.kind = kind
        this.text = text
        this.reason = reason
        this.choiceIndex = choiceIndex
        this.toolIndex = toolIndex
        this.toolId = toolId
        this.toolName = toolName
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
    // 已观察过的路径 → 当时那份字节的状态。它是 write 的判断依据：
    // 「我上次看到的就是现在这份吗」，答不出就不能拿旧认知去覆盖别人的改动。
    let observed = HashMap<String, FileObservation>()
    let workingDirectory: String

    public init(log: SessionLog, registry: ToolRegistry, workingDirectory!: String = "") {
        this.log = log
        this.registry = registry
        this.workingDirectory = workingDirectory
    }

    private func workingPath(path: String): String {
        let base = SessionWorkspace(log, fallback: workingDirectory).effectiveDirectory()
        if (base.size == 0 || Path(path).isAbsolute()) { return path }
        return Path(base).join(path).toString()
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
        if (name == "read") {
            return readStep(args)
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
        let path = workingPath(parsed.path)
        lastDetail.snapshotBefore = priorSize(path)
        lastDetail.snapshotExpected = parsed.content.toArray().size
        // snapshot 段顺手取当前那份字节的状态。观察过且状态已变＝第三方动过手，
        // 这一段必须在任何写入之前判：拒了还照写，等于覆盖掉别人的工作。
        var key = ""
        var wasExisting = false
        try {
            wasExisting = exists(path)
            key = fileObservationKey(path)
            let seen = observed.get(key)
            if (wasExisting) {
                if (let Some(prior) <- seen) {
                    if (!prior.present) { return failFile("fs-not-observed", path) }
                    if (!sameFileBytes(prior.bytes, File.readFrom(path))) {
                        return failFile("fs-stale-version", path)
                    }
                } else {
                    return failFile("fs-not-observed", path)
                }
                File.writeTo(path, parsed.content.toArray())
            } else {
                if (let Some(prior) <- seen) {
                    if (prior.present) { return failFile("fs-stale-version", path) }
                }
                // 发布新文件必须在落位时拒绝覆盖，不能靠 exists→write 的时间窗口。
                publishNewFile(path, parsed.content.toArray())
            }
        } catch (e: IOException) {
            lastDetail.stage = "io-error"
            log.append("tool/result", "io-error:${path}")
            return ApprovalOutcome(false, "io-error:${path}")
        } catch (e: Exception) {
            lastDetail.stage = "threw"
            log.append("tool/result", "threw:${path}")
            return ApprovalOutcome(false, "threw:${path}")
        }
        // post-execute：写后重读逐字节比对，掉一个字节、被改写一个字节都不算成功
        var back: Array<Byte> = []
        try {
            back = File.readFrom(path)
            key = fileObservationKey(path)
        } catch (e: Exception) {
            return failFile("post-read-error", path)
        }
        let want = parsed.content.toArray()
        if (!sameFileBytes(back, want)) {
            lastDetail.verified = false
            lastDetail.stage = "torn-write"
            log.append("tool/result", "torn-write:${path}:expected=${want.size},got=${back.size}")
            return ApprovalOutcome(false, "torn-write:${path}")
        }
        // 这一份刚由本工具写下并核对过，观察记录跟着更新，否则下一次自己写自己会被自己拦
        observed[key] = FileObservation(true, back)
        lastDetail.verified = true
        lastDetail.stage = "ran"
        let out = "ok:${path}"
        log.append("tool/result", out)
        return ApprovalOutcome(true, out)
    }

    // 读侧也走前两段与后两段：pre-execute 只裁首尾空白得到路径，post-execute 交回的
    // 必须是盘上真实读到的字节（顺手记下这一份的状态供 write 判断）。
    // 缓存读结果等于没读——FS_NOT_OBSERVED 说的就是这件事。
    private func readStep(args: String): ApprovalOutcome {
        let raw = args.trimAscii()
        let path = if (raw.size == 0) { raw } else { workingPath(raw) }
        lastDetail.argsAfterPre = path
        lastDetail.preRewrote = (path != args)
        if (path.size == 0) {
            lastDetail.stage = "bad-args"
            log.append("tool/result", "bad-args")
            return ApprovalOutcome(false, "bad-args")
        }
        if (!exists(Path(path))) {
            // 缺失也是观察；若之后别人创建了它，只能走禁止覆盖的创建意图。
            try { observed[fileObservationKey(path)] = FileObservation(false, []) } catch (e: Exception) {
                // 父目录也不存在时无法解析身份，创建本来就会失败；读仍报 not-found。
            }
            lastDetail.stage = "not-found"
            log.append("tool/result", "not-found:${path}")
            return ApprovalOutcome(false, "not-found:${path}")
        }
        var bytes: Array<Byte> = []
        try {
            bytes = File.readFrom(path)
        } catch (e: IOException) {
            lastDetail.stage = "io-error"
            log.append("tool/result", "io-error:${path}")
            return ApprovalOutcome(false, "io-error:${path}")
        } catch (e: Exception) {
            lastDetail.stage = "threw"
            log.append("tool/result", "threw:${path}")
            return ApprovalOutcome(false, "threw:${path}")
        }
        var text = ""
        var key = ""
        try {
            text = String.fromUtf8(bytes)
            key = fileObservationKey(path)
        } catch (e: IllegalArgumentException) {
            return failFile("invalid-encoding", path)
        } catch (e: Exception) {
            return failFile("io-error", path)
        }
        // 解码与身份解析都成功，才登记已观察并记录成功，失败不能冒充 read 成功。
        observed[key] = FileObservation(true, bytes)
        lastDetail.snapshotBefore = bytes.size
        lastDetail.snapshotExpected = bytes.size
        lastDetail.verified = true
        lastDetail.stage = "ran"
        // 模型将看到的正文必须进日志，不能只存路径和长度而让重放丢掉依据。
        log.append("tool/result", "ok-read:${path}:${bytes.size}\n${text}")
        return ApprovalOutcome(true, text)
    }

    private func failFile(stage: String, path: String): ApprovalOutcome {
        lastDetail.stage = stage
        log.append("tool/result", "${stage}:${path}")
        return ApprovalOutcome(false, "${stage}:${path}")
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

// 当前 Windows 构建的观察键：解析绝对路径和软链接，统一 ASCII 大小写。
// 逐字节保存观察值，不能用会碰撞的自制短哈希代替内容一致性。
func fileObservationKey(path: String): String {
    if (exists(path)) { return canonicalize(path).toString().toAsciiLower() }
    let parent = Path(path).parent.toString()
    let dir = if (parent.size == 0) { "./" } else { parent }
    let full = canonicalize(dir).join(Path(path).fileName)
    return full.toString().toAsciiLower()
}

class FileObservation {
    let present: Bool
    let bytes: Array<Byte>
    init(present: Bool, bytes: Array<Byte>) { this.present = present; this.bytes = bytes }
}

func sameFileBytes(left: Array<Byte>, right: Array<Byte>): Bool {
    if (left.size != right.size) { return false }
    var i: Int64 = 0
    while (i < left.size) {
        if (left[i] != right[i]) { return false }
        i += 1
    }
    return true
}

// 独占临时文件先写完整，再原子落位；目标抢先出现时不替换它。
func publishNewFile(path: String, bytes: Array<Byte>): Unit {
    let parent = Path(path).parent.toString()
    let dir = if (parent.size == 0) { "./" } else { parent }
    let tmp = File.createTemp(Path(dir))
    let staging = tmp.info.path.toString()
    var closed = false
    try {
        tmp.write(bytes)
        tmp.close()
        closed = true
        rename(staging, to: path, overwrite: false)
    } finally {
        if (!closed) { tmp.close() }
        removeIfExists(staging, recursive: false)
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
