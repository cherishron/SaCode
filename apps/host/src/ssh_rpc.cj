package host

import core.*
import std.sync.*
import stdx.encoding.json.*

func isSshExecMethod(method: String): Bool {
    return method == "ssh/exec" || method == "ssh/describe"
}

func sshResultJson(result: SshExecResult): String {
    return "{\"ok\":${result.ok},\"exitCode\":${result.exitCode}," +
        "\"stdout\":\"${jsonEscapeText(result.stdout)}\",\"stderr\":\"${jsonEscapeText(result.stderr)}\"," +
        "\"timedOut\":${result.timedOut},\"cancelled\":${result.cancelled}," +
        "\"failureKind\":\"${jsonEscapeText(result.failureKind)}\"," +
        "\"message\":\"${jsonEscapeText(result.message)}\",\"elapsedMs\":${result.elapsedMs}}"
}

class SshRpcCall {
    let host: String
    let command: String
    let user: String
    let port: Int64
    let timeoutMs: Int64
    let connectTimeoutSec: Int64
    init(arguments: String) {
        let params = JsonValue.fromStr(arguments).asObject()
        // 固定字段使审批与执行共用同一份参数，不接受 options、二进制或信任文件路径。
        if (params.size() != 6) { throw Exception("invalid-input:ssh-arguments") }
        host = params.get("host").getOrThrow().asString().getValue()
        command = params.get("command").getOrThrow().asString().getValue()
        user = params.get("user").getOrThrow().asString().getValue()
        port = params.get("port").getOrThrow().asInt().getValue()
        timeoutMs = params.get("timeoutMs").getOrThrow().asInt().getValue()
        connectTimeoutSec = params.get("connectTimeoutSec").getOrThrow().asInt().getValue()
        if (host.size == 0 || command.size == 0 || port < 1 || port > 65535 ||
            timeoutMs <= 0 || timeoutMs > 300000 || connectTimeoutSec <= 0 || connectTimeoutSec > 60) {
            throw Exception("invalid-input:ssh-arguments")
        }
    }
}

// 每个活会话一个实例。调度方须注入同一会话的日志、审批台和租约，接手租约重载后重建实例；
// 不在本文件接管 main、自动登记连接或确认指纹，也不把历史登记解释为真实连接。
public class SshExecRpc {
    public let registry: SshRegistry
    public let sessionId: String
    let log: SessionLog
    let desk: ApprovalDesk
    let lease: WriteLease
    let executor: SshExecutor
    let mtx = Mutex()
    var running = false
    var phase = "idle"
    var activeToken: Option<TurnToken> = None
    var lastResult: Option<SshExecResult> = None

    public init(log: SessionLog, desk: ApprovalDesk, lease: WriteLease,
                sessionId: String, trust: SshHostTrust) {
        if (sessionId.size == 0) { throw Exception("invalid-input:ssh-session") }
        this.log = log
        this.desk = desk
        this.lease = lease
        this.sessionId = sessionId
        this.registry = SshRegistry(log)
        this.executor = SshExecutor(registry, log, trust: Some(trust))
    }

    func checkpoint() {
        if (log.isDurableFrozen() || !log.durableCheckpoint(lease)) {
            log.freezeAfterDurableFailure()
            throw Exception("ssh-persistence-failed")
        }
    }

    func checkMode() {
        if (PermissionPolicy().decide(ModeController(log).current(), "ssh/exec") == "deny") {
            throw Exception("approval-mode-denied")
        }
    }

    public func approvalArguments(arguments: String): String {
        SshRpcCall(arguments)
        // JSON 字符串封装避免分隔符碰撞；不重编码远端参数，批准绑定原始字节。
        return "{\"sessionId\":\"${jsonEscapeText(sessionId)}\",\"arguments\":\"${jsonEscapeText(arguments)}\"}"
    }

    // 供调度方的现有审批入口调用，不增加第三个 ssh RPC；应答仍使用同一个 ApprovalDesk。
    public func prepareApproval(arguments: String): Int64 {
        let bound = approvalArguments(arguments)
        mtx.lock()
        var id: Int64 = 0
        try {
            if (running) { throw Exception("ssh-execution-in-flight") }
            checkpoint()
            checkMode()
            id = desk.askForCall("ssh/exec", bound)
            checkpoint()
        } finally { mtx.unlock() }
        return id
    }

    public func busy(): Bool {
        mtx.lock()
        var value = false
        try { value = running } finally { mtx.unlock() }
        return value
    }

    // 同步等待真实结果，调度方须在受监督 worker 调用，主循环继续处理 describe 与取消。
    public func exec(arguments: String, approvalId: Int64, token!: TurnToken = TurnToken()): SshExecResult {
        let call = SshRpcCall(arguments)
        let bound = approvalArguments(arguments)
        mtx.lock()
        try {
            if (running) { throw Exception("ssh-execution-in-flight") }
            checkpoint()
            checkMode()
            if (token.cancelled()) { throw Exception("ssh-cancelled-before-start") }
            if (desk.consumeExactForCall(approvalId, "ssh/exec", bound) != "allowed-once") {
                throw Exception("not-authorized:ssh-exec")
            }
            // 先落批准事实与一次性启动意图；屏障失败不调用执行器，已消费的票不恢复重放。
            log.append("ssh/exec-starting", "{\"sessionId\":\"${jsonEscapeText(sessionId)}\"," +
                "\"approvalId\":${approvalId},\"argumentsDigest\":\"${sha256Hex(bound.toArray())}\"}")
            checkpoint()
            running = true
            phase = "running"
            lastResult = None
            activeToken = Some(token)
        } finally { mtx.unlock() }
        try {
            let result = executor.run(call.host, call.command, user: call.user, port: call.port,
                token: token, timeoutMs: call.timeoutMs, connectTimeoutSec: call.connectTimeoutSec)
            // core 自己记录 ssh/exec；此处补全结构化结算，早期准入失败也有事实，不重复伪造执行事件。
            // 日志不保存命令、输出或异常文本，避免把凭据和远端敏感内容复制进审计。
            log.append("ssh/exec-result", "{\"approvalId\":${approvalId},\"ok\":${result.ok}," +
                "\"exitCode\":${result.exitCode},\"timedOut\":${result.timedOut}," +
                "\"cancelled\":${result.cancelled},\"failureKind\":\"${jsonEscapeText(result.failureKind)}\"}")
            checkpoint()
            mtx.lock()
            try {
                lastResult = Some(result)
                phase = "settled"
            } finally { mtx.unlock() }
            return result
        } catch (_: Exception) {
            // 可能已经派发远端副作用，不能用本地异常断言远端失败或自动重试。
            mtx.lock()
            try { phase = "unknown" } finally { mtx.unlock() }
            if (log.isDurableFrozen()) {
                throw Exception("ssh-persistence-failed:remote-state-unknown")
            }
            throw Exception("ssh-execution-unknown:inspect-session-before-new-approval")
        } finally {
            mtx.lock()
            try { running = false; activeToken = None } finally { mtx.unlock() }
        }
    }

    // 可信生命周期接缝，不新增取消 RPC；会话切换/关闭前取消并由调度方等待 worker 收束。
    public func cancel(): Unit {
        mtx.lock()
        try {
            if (let Some(token) <- activeToken) { token.cancel() }
        } finally { mtx.unlock() }
    }

    public func describe(): String {
        mtx.lock()
        var text = ""
        try {
            let result = if (let Some(value) <- lastResult) { sshResultJson(value) } else { "null" }
            // 仅描述当前实例；重启不恢复为 running，本地结果不证明远端后代已停止。
            text = "{\"sessionId\":\"${jsonEscapeText(sessionId)}\",\"phase\":\"${phase}\"," +
                "\"running\":${running},\"scope\":\"current-instance\",\"remoteState\":\"unknown\",\"result\":${result}}"
        } finally { mtx.unlock() }
        return text
    }

    // 返回 JSON 结果，由调度方统一封装 okFrame/errFrame；参数错误与审批拒绝以异常交回。
    // exec params = {sessionId, arguments: JSON字符串, approvalId}；describe params 只收 sessionId。
    public func request(method: String, body: String): String {
        if (!isSshExecMethod(method)) { throw Exception("method-not-found") }
        let params = JsonValue.fromStr(body).asObject().get("params").getOrThrow().asObject()
        if (params.get("sessionId").getOrThrow().asString().getValue() != sessionId) {
            throw Exception("not-authorized:ssh-session-changed")
        }
        if (method == "ssh/describe") {
            if (params.size() != 1) { throw Exception("invalid-input:ssh-describe") }
            return describe()
        }
        if (params.size() != 3) { throw Exception("invalid-input:ssh-exec") }
        return sshResultJson(exec(params.get("arguments").getOrThrow().asString().getValue(),
            params.get("approvalId").getOrThrow().asInt().getValue()))
    }
}
