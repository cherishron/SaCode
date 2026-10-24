package host

import core.PtySession
import std.collection.{ArrayList, HashMap}
import std.sync.Mutex
import stdx.crypto.crypto.SecureRandom
import stdx.encoding.base64.{fromBase64String, toBase64String}
import stdx.encoding.json.*

// Host 侧有界直播环的一块。seq 单调，是 terminal/output 的游标基准。
class TerminalChunk {
    let seq: Int64
    let data: Array<Byte>
    let truncated: Bool
    init(seq: Int64, data: Array<Byte>, truncated: Bool) {
        this.seq = seq
        this.data = data
        this.truncated = truncated
    }
}

// 独立适配类，已装配 main/initialize/IPC。sessionId 是 PTY 身份，不是聊天会话身份。
// close=只拆视图（view-closed，不停进程树），kill=停自有进程树；两者语义分开（设计稿 §3.1/§4）。
// 调度方须长寿命持有本类，并在会话切换/退出时调用 close() 收束自有资源。
class TerminalRpcEntry {
    let pty: PtySession
    let cwd: String
    let mutex = Mutex()
    var cols: Int64
    var rows: Int64
    var viewClosed = false
    var stopped = false
    var stopConfirmed = false
    var truncated = false
    var eof = false
    var exitCode: ?Int64 = None
    var failure = ""
    var nextSeq: Int64 = 0
    var ringBase: Int64 = 0
    let ring = ArrayList<TerminalChunk>()
    init(pty: PtySession, cwd: String, cols: Int64, rows: Int64) {
        this.pty = pty
        this.cwd = cwd
        this.cols = cols
        this.rows = rows
    }
}

public class TerminalRpc {
    let sessions = HashMap<String, TerminalRpcEntry>()
    let mutex = Mutex()
    let authorizeCreate: (String, HashMap<String, String>, Int64, Int64) -> Bool
    var disposed = false

    // 回调仅由可信 Host 装配注入，必须核验当前聊天会话工作区；默认拒绝。
    // 不接受 RPC 的 approved/命令/可执行文件字段，不继承 Host 环境。
    public init(authorizeCreate!: (String, HashMap<String, String>, Int64, Int64) -> Bool = {_, _, _, _ => false}) {
        this.authorizeCreate = authorizeCreate
    }

    public static func handles(method: String): Bool {
        return method == "terminal/create" || method == "terminal/input" || method == "terminal/resize" ||
            method == "terminal/interrupt" || method == "terminal/describe" || method == "terminal/output" ||
            method == "terminal/close" || method == "terminal/kill"
    }

    func fields(args: JsonObject, required: Array<String>, optional!: Array<String> = []): Unit {
        for (name in required) {
            if (!args.containsKey(name)) {
                throw Exception("terminal-bad-arguments")
            }
        }
        for ((name, _) in args.getFields()) {
            var allowed = false
            for (key in required) {
                if (key == name) {
                    allowed = true
                }
            }
            for (key in optional) {
                if (key == name) {
                    allowed = true
                }
            }
            if (!allowed) {
                throw Exception("terminal-bad-arguments")
            }
        }
    }

    func dimensions(cols: Int64, rows: Int64): Unit {
        if (cols < 1 || cols > 32767 || rows < 1 || rows > 32767) {
            throw Exception("terminal-invalid-size")
        }
    }

    func create(args: JsonObject): String {
        fields(args, ["cwd", "env", "cols", "rows"])
        let cwd = args.get("cwd").getOrThrow().asString().getValue()
        let cols = args.get("cols").getOrThrow().asInt().getValue()
        let rows = args.get("rows").getOrThrow().asInt().getValue()
        dimensions(cols, rows)
        let env = HashMap<String, String>()
        for ((key, value) in args.get("env").getOrThrow().asObject().getFields()) {
            env[key] = value.asString().getValue()
        }
        // 授权回调不得修改env；传独立副本，PTY使用原请求的冻结值。
        let approvalEnv = HashMap<String, String>()
        for ((key, value) in env) {
            approvalEnv[key] = value
        }
        return synchronized(mutex) {
            if (disposed) {
                throw Exception("terminal-disposed")
            }
            if (sessions.size >= 32) {
                throw Exception("terminal-capacity")
            }
            if (!authorizeCreate(cwd, approvalEnv, cols, rows)) {
                throw Exception("terminal-create-not-authorized")
            }
            let nonce = Array<Byte>(24, repeat: 0)
            SecureRandom().nextBytes(nonce)
            // URL 安全身份：用 hex 而非 base64，避免 PTY 身份里出现 `/`、`+` 这类字符。
            let sessionId = "pty-" + terminalIdHex(nonce)
            if (sessions.contains(sessionId)) {
                throw Exception("terminal-id-collision")
            }
            // 在产生副作用前准备响应；创建失败不留下可查找的半初始化实例。
            let result = JsonObject()
            result.put("sessionId", JsonString(sessionId))
            result.put("cwd", JsonString(cwd))
            result.put("phase", JsonString("running"))
            let response = result.toString()
            let pty = PtySession.open(cwd, env, cols, rows)
            sessions[sessionId] = TerminalRpcEntry(pty, cwd, cols, rows)
            return response
        }
    }

    func lookup(sessionId: String): TerminalRpcEntry {
        return synchronized(mutex) {
            if (sessionId.size == 0 || sessionId.size > 128) {
                throw Exception("terminal-session-not-found")
            }
            return sessions.get(sessionId).getOrThrow({=> Exception("terminal-session-not-found")})
        }
    }

    // core.readOutput 是破坏性排空，output/describe 都经这一处取回并分块入环，
    // 避免两条路径各自排空互相抢字节。环有界，溢出丢最旧块并如实标 truncated。
    func drain(entry: TerminalRpcEntry): Unit {
        synchronized(entry.mutex) {
            let out = entry.pty.readOutput(8192)
            if (out.data.size > 0) {
                entry.ring.add(TerminalChunk(entry.nextSeq, out.data, out.truncated))
                entry.nextSeq += 1
                while (entry.ring.size > 512) {
                    entry.ring.remove(at: 0)
                    entry.ringBase += 1
                }
            }
            entry.truncated = entry.truncated || out.truncated
            entry.eof = out.eof
            if (let Some(code) <- out.exitCode) {
                entry.exitCode = Some(code)
            }
            if (out.failure.size > 0) {
                entry.failure = out.failure
            }
        }
    }

    // phase 用前端可识别的闭集；view-closed 与进程仍 running 分开呈现（设计稿 §4）。
    func phaseOf(entry: TerminalRpcEntry): String {
        if (entry.exitCode.isSome()) {
            return "exited"
        }
        if (entry.stopped) {
            return "exiting"
        }
        if (entry.viewClosed) {
            return "view-closed"
        }
        return "running"
    }

    func describe(args: JsonObject): String {
        fields(args, ["sessionId"], optional: ["limit"])
        if (let Some(value) <- args.get("limit")) {
            let limit = value.asInt().getValue()
            if (limit < 1 || limit > 262144) {
                throw Exception("terminal-invalid-output-limit")
            }
        }
        let sessionId = args.get("sessionId").getOrThrow().asString().getValue()
        let entry = lookup(sessionId)
        drain(entry)
        let result = JsonObject()
        result.put("sessionId", JsonString(sessionId))
        result.put("cwd", JsonString(entry.cwd))
        result.put("phase", JsonString(phaseOf(entry)))
        result.put("closed", JsonBool(entry.viewClosed))
        result.put("treeStopConfirmed", JsonBool(entry.stopConfirmed))
        result.put("exitObserved", JsonBool(entry.exitCode.isSome()))
        if (let Some(code) <- entry.exitCode) {
            result.put("exitCode", JsonInt(code))
        } else {
            result.put("exitCode", JsonNull())
        }
        result.put("truncated", JsonBool(entry.truncated))
        result.put("eof", JsonBool(entry.eof))
        synchronized(entry.mutex) {
            result.put("cols", JsonInt(entry.cols))
            result.put("rows", JsonInt(entry.rows))
        }
        // failure 是固定诊断码，不含终端原始输出/环境值。
        if (entry.failure.size > 0) {
            result.put("failure", JsonString(entry.failure))
        }
        return result.toString()
    }

    func output(args: JsonObject): String {
        fields(args, ["sessionId", "cursor"])
        let sessionId = args.get("sessionId").getOrThrow().asString().getValue()
        let cursor = args.get("cursor").getOrThrow().asInt().getValue()
        if (cursor < 0) {
            throw Exception("terminal-bad-arguments")
        }
        let entry = lookup(sessionId)
        drain(entry)
        // 游标落后的已丢弃块不回放；从环内有界游标服务，游标不足只向前补洞。
        let chunkArr = synchronized(entry.mutex) {
            let arr = JsonArray()
            for (chunk in entry.ring) {
                if (chunk.seq >= cursor) {
                    let row = JsonObject()
                    row.put("seq", JsonInt(chunk.seq))
                    row.put("data", JsonString(toBase64String(chunk.data)))
                    row.put("truncated", JsonBool(chunk.truncated))
                    arr.add(row)
                }
            }
            arr
        }
        let result = JsonObject()
        result.put("sessionId", JsonString(sessionId))
        result.put("chunks", chunkArr)
        result.put("nextCursor", JsonInt(entry.nextSeq))
        result.put("more", JsonBool(false))
        result.put("truncated", JsonBool(entry.truncated || cursor < entry.ringBase))
        result.put("phase", JsonString(phaseOf(entry)))
        return result.toString()
    }

    // kill=停自有进程树；关闭失败保留条目，不将“请求过关闭”冒充进程树已退出。
    func killTree(entry: TerminalRpcEntry): Unit {
        let alreadyStopped = synchronized(entry.mutex) {
            if (entry.stopped) {
                if (!entry.stopConfirmed) {
                    throw Exception("pty-tree-stop-unconfirmed")
                }
                true
            } else {
                entry.stopped = true
                false
            }
        }
        if (alreadyStopped) {
            return
        }
        entry.pty.close()
        synchronized(entry.mutex) {
            entry.stopConfirmed = true
        }
    }

    public func requestJson(method: String, args: JsonObject): String {
        if (!TerminalRpc.handles(method)) {
            throw Exception("terminal-method-not-found")
        }
        if (method == "terminal/create") {
            return create(args)
        }
        if (method == "terminal/output") {
            return output(args)
        }
        if (method == "terminal/describe") {
            return describe(args)
        }
        if (method == "terminal/input") {
            fields(args, ["sessionId", "data"])
        } else if (method == "terminal/resize") {
            fields(args, ["sessionId", "cols", "rows"])
        } else {
            fields(args, ["sessionId"])
        }
        let sessionId = args.get("sessionId").getOrThrow().asString().getValue()
        let entry = lookup(sessionId)
        if (method == "terminal/close") {
            // 只拆视图：不停进程树。后台进程仍可在 describe 里看到 running。
            synchronized(entry.mutex) {
                entry.viewClosed = true
            }
            let result = JsonObject()
            result.put("sessionId", JsonString(sessionId))
            result.put("closed", JsonBool(true))
            result.put("phase", JsonString(phaseOf(entry)))
            return result.toString()
        }
        if (method == "terminal/kill") {
            killTree(entry)
            let result = JsonObject()
            result.put("sessionId", JsonString(sessionId))
            result.put("treeStopConfirmed", JsonBool(true))
            result.put("exitObserved", JsonBool(entry.exitCode.isSome()))
            if (let Some(code) <- entry.exitCode) {
                result.put("exitCode", JsonInt(code))
            } else {
                result.put("exitCode", JsonNull())
            }
            result.put("phase", JsonString(phaseOf(entry)))
            return result.toString()
        }
        // 视图已关或已停的实例不再接受输入/尺寸/中断；元数据与输出仍可读。
        let gate = synchronized(entry.mutex) {
            entry.viewClosed || entry.stopped
        }
        if (gate) {
            throw Exception("terminal-closed")
        }
        let result = JsonObject()
        result.put("sessionId", JsonString(sessionId))
        if (method == "terminal/input") {
            let data = args.get("data").getOrThrow().asString().getValue()
            if (data.size > 5464) {
                throw Exception("terminal-input-too-large")
            }
            let bytes = fromBase64String(data).getOrThrow({=> Exception("terminal-invalid-base64")})
            if (bytes.size > 4096) {
                throw Exception("terminal-input-too-large")
            }
            // 写入不持锁，以便 kill 能取消阻塞的点。失败可能已写入前缀，绝不自动重试。
            result.put("bytesWritten", JsonInt(entry.pty.write(bytes)))
        } else if (method == "terminal/resize") {
            let cols = args.get("cols").getOrThrow().asInt().getValue()
            let rows = args.get("rows").getOrThrow().asInt().getValue()
            dimensions(cols, rows)
            synchronized(entry.mutex) {
                if (entry.viewClosed || entry.stopped) {
                    throw Exception("terminal-closed")
                }
                entry.pty.resize(cols, rows)
                entry.cols = cols
                entry.rows = rows
            }
            result.put("resized", JsonBool(true))
        } else {
            entry.pty.interrupt()
            result.put("status", JsonString("interrupt-requested"))
            // ETX 写入不是前台程序收到信号或退出的证据。
        }
        return result.toString()
    }

    // 与现有Host类模式一致：未知方法不发帧；stdout仅走协议帧。
    public func handle(method: String, body: String, idText: String): Bool {
        if (!TerminalRpc.handles(method)) {
            return false
        }
        try {
            let params = JsonValue.fromStr(body).asObject().get("params").getOrThrow().asObject()
            emit(okFrame(idText, requestJson(method, params)))
        } catch (e: Exception) {
            // 不回显JSON异常、路径、环境或输入；IO失败不得暗示零字节写入。
            let reason = terminalRpcReason(e.message)
            let code: Int64 = if (reason == "terminal-bad-arguments") {
                -32602
            } else {
                -32003
            }
            emit(errFrame(idText, code, reason))
        }
        return true
    }

    // 可信生命周期入口，不是第九条RPC。切会话/退出必须调用，不接管旧PID：停全部自有进程树。
    // 返回false时资源结算未确认；保留实例供诊断，不得宣称已停止。
    public func close(): Bool {
        let entries: Array<TerminalRpcEntry> = synchronized(mutex) {
            disposed = true
            let snapshot = ArrayList<TerminalRpcEntry>()
            for ((_, entry) in sessions) {
                snapshot.add(entry)
            }
            snapshot.toArray()
        }
        var confirmed = true
        for (entry in entries) {
            try {
                killTree(entry)
            } catch (_: Exception) {
                confirmed = false
            }
        }
        return confirmed
    }
}

// PTY 身份用 hex：URL 安全、固定长度，不含 base64 的 `+`/`/`。
func terminalIdHex(bytes: Array<Byte>): String {
    let digits = "0123456789abcdef".toArray()
    let out = ArrayList<Byte>()
    for (b in bytes) {
        out.add(digits[Int64(b / 16)])
        out.add(digits[Int64(b % 16)])
    }
    return String.fromUtf8(out.toArray())
}

func terminalRpcReason(message: String): String {
    for (known in ["terminal-bad-arguments", "terminal-invalid-size", "terminal-disposed", "terminal-capacity",
        "terminal-create-not-authorized", "terminal-id-collision", "terminal-session-not-found",
        "terminal-method-not-found", "terminal-invalid-output-limit", "terminal-closed", "terminal-input-too-large",
        "terminal-invalid-base64"]) {
        if (message == known) {
            return known
        }
    }
    // core只公开已知常量错误；其他错误统一隐藏，防止泄露路径或敏感参数。
    for (known in ["pty-unavailable", "pty-invalid-cwd", "pty-invalid-environment", "pty-invalid-environment-key",
        "pty-duplicate-environment", "pty-environment-too-large", "pty-closed", "pty-tree-stop-unconfirmed",
        "pty-reader-stop-unconfirmed", "pty-input-io-error", "pty-input-cancelled-or-failed", "pty-shell-unavailable",
        "pty-security-unavailable", "pty-output-io-error"]) {
        if (message == known) {
            return known
        }
    }
    return "terminal-request-failed"
}