package host

import core.PtySession
import std.collection.{ArrayList, HashMap}
import std.sync.Mutex
import stdx.crypto.crypto.SecureRandom
import stdx.encoding.base64.{fromBase64String, toBase64String}
import stdx.encoding.json.*

// 独立适配类，尚未装配 main/initialize/IPC。sessionId 是 PTY 身份，不是聊天会话身份。
// 调度方须长寿命持有本类，并在会话切换/EOF 时调用 close() 收束自有资源。
// 本切片 close RPC 明确表示强制终止进程树，不是设计稿中的“关闭视图”。
class TerminalRpcEntry {
    let pty: PtySession
    let cwd: String
    let mutex = Mutex()
    var cols: Int64
    var rows: Int64
    var closed = false
    var stopConfirmed = false
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

    // 回调仅由可信 Host 装配注入，必须核验当前聊天会话、工作区修订与一次性审批。
    // 默认拒绝；不接受 RPC 的 approved/命令/可执行文件字段，不继承 Host 环境。
    public init(authorizeCreate!: (String, HashMap<String, String>, Int64, Int64) -> Bool = {_, _, _, _ => false}) {
        this.authorizeCreate = authorizeCreate
    }

    public static func handles(method: String): Bool {
        return method == "terminal/create" || method == "terminal/input" || method == "terminal/resize" || method ==
            "terminal/interrupt" || method == "terminal/describe" || method == "terminal/close"
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
            let sessionId = "pty-" + toBase64String(nonce)
            if (sessions.contains(sessionId)) {
                throw Exception("terminal-id-collision")
            }
            // 在产生副作用前准备响应；创建失败不留下可查找的半初始化实例。
            let result = JsonObject()
            result.put("sessionId", JsonString(sessionId))
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

    // 关闭失败仍保留条目，不能将“请求过关闭”冒充进程树已退出。
    func stop(entry: TerminalRpcEntry): Unit {
        synchronized(entry.mutex) {
            entry.closed = true
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
        if (method == "terminal/input") {
            fields(args, ["sessionId", "data"])
        } else if (method == "terminal/resize") {
            fields(args, ["sessionId", "cols", "rows"])
        } else if (method == "terminal/describe") {
            fields(args, ["sessionId"], optional: ["limit"])
        } else {
            fields(args, ["sessionId"])
        }
        let sessionId = args.get("sessionId").getOrThrow().asString().getValue()
        let entry = lookup(sessionId)
        let result = JsonObject()
        result.put("sessionId", JsonString(sessionId))
        if (method == "terminal/close") {
            // 不持表锁或条目锁等待IO；core负责取消阻塞写入与回收读线程。
            stop(entry)
            result.put("treeStopConfirmed", JsonBool(true))
        } else if (method == "terminal/describe") {
            var limit: Int64 = 8192
            if (let Some(value) <- args.get("limit")) {
                limit = value.asInt().getValue()
            }
            if (limit < 1 || limit > 262144) {
                throw Exception("terminal-invalid-output-limit")
            }
            let output = entry.pty.readOutput(limit)
            result.put("data", JsonString(toBase64String(output.data)))
            result.put("bytes", JsonInt(output.data.size))
            result.put("truncated", JsonBool(output.truncated))
            result.put("eof", JsonBool(output.eof))
            result.put("exitObserved", JsonBool(output.exitCode.isSome()))
            if (let Some(code) <- output.exitCode) {
                result.put("exitCode", JsonInt(code))
            } else {
                result.put("exitCode", JsonNull())
            }
            // core failure是固定诊断码，不含终端原始输出/环境值。
            result.put("failure", JsonString(output.failure))
            result.put("cwd", JsonString(entry.cwd))
            synchronized(entry.mutex) {
                result.put("cols", JsonInt(entry.cols))
                result.put("rows", JsonInt(entry.rows))
                result.put("closed", JsonBool(entry.closed))
                result.put("treeStopConfirmed", JsonBool(entry.stopConfirmed))
            }
        } else {
            // 元数据锁只用于准入/尺寸更新；写入不持锁，以便close能取消IO。
            synchronized(entry.mutex) {
                if (entry.closed) {
                    throw Exception("terminal-closed")
                }
            }
            if (method == "terminal/input") {
                let data = args.get("data").getOrThrow().asString().getValue()
                if (data.size > 5464) {
                    throw Exception("terminal-input-too-large")
                }
                let bytes = fromBase64String(data).getOrThrow({=> Exception("terminal-invalid-base64")})
                if (bytes.size > 4096) {
                    throw Exception("terminal-input-too-large")
                }
                // 失败可能已写入前缀，绝不自动重试；成功返回真实字节数。
                result.put("bytesWritten", JsonInt(entry.pty.write(bytes)))
            } else if (method == "terminal/resize") {
                let cols = args.get("cols").getOrThrow().asInt().getValue()
                let rows = args.get("rows").getOrThrow().asInt().getValue()
                dimensions(cols, rows)
                synchronized(entry.mutex) {
                    if (entry.closed) {
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
                // ETX写入不是前台程序收到信号或退出的证据。
            }
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

    // 可信生命周期入口，不是第七条RPC。切会话/EOF必须调用，不接管旧PID。
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
                stop(entry)
            } catch (_: Exception) {
                confirmed = false
            }
        }
        return confirmed
    }
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
        "pty-reader-stop-unconfirmed", "pty-input-io-error", "pty-input-cancelled-or-failed"]) {
        if (message == known) {
            return known
        }
    }
    return "terminal-request-failed"
}
