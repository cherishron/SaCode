package core
import std.collection.*
import stdx.encoding.json.*
import std.sync.*

// 异步句柄只取消自身令牌；完成包含真实退出与输出收束，不以请求回执代替。
public class ExecutionRun {
    public let starting: ExecutionSnapshot
    let token: TurnToken
    let result: Future<ShellResult>
    let done: AtomicBool
    public init(starting: ExecutionSnapshot, token: TurnToken, result: Future<ShellResult>, done: AtomicBool) {
        this.starting = starting; this.token = token; this.result = result; this.done = done
    }
    public func cancel(): Unit { token.cancel() }
    public func settled(): Bool { return done.load() }
    public func wait(timeoutMs!: Int64 = 310000): ShellResult {
        return result.get(timeoutMs * Duration.millisecond)
    }
}

// 本实例持有的 SubProcess 句柄监督；重启不按 PID 接管。
// 当前 ShellExecutor 尚无真正隔离，默认门禁关闭；探针不能升级产品能力。
public class ExecutionSupervisor {
    let service: ExecutionService
    let ready: () -> Bool
    let executor: ShellExecutor
    public init(service: ExecutionService, providerReady!: () -> Bool = { => false },
        executor!: ShellExecutor = ShellExecutor()) {
        this.service = service; this.ready = providerReady; this.executor = executor
    }
    private func saveOutput(id: String, channel: String, text: String, eof: Bool, truncated: Bool): Unit {
        let bytes = text.toArray()
        var offset = Int64(0)
        while (offset < bytes.size) {
            let end = if (offset + 512 < bytes.size) { offset + 512 } else { bytes.size }
            service.captureOutput(id, channel, bytes[offset..end])
            offset = end
        }
        service.captureOutput(id, channel, Array<Byte>(), endOfCapture: true, eof: eof, truncated: truncated)
    }
    public func start(id: String, revision: Int64): ExecutionRun {
        if (!ready()) { throw Exception("execution-provider-unverified") }
        let token = TurnToken()
        let starting = service.beginStart(id, revision, token: token)
        let done = AtomicBool(false)
        let result = spawn { =>
            try { supervise(starting, token) }
            finally { done.store(true) }
        }
        return ExecutionRun(starting, token, result, done)
    }
    public func run(id: String, revision: Int64): ShellResult {
        return start(id, revision).wait()
    }
    private func supervise(starting: ExecutionSnapshot, token: TurnToken): ShellResult {
        let id = starting.id
        let proposal = JsonValue.fromStr(starting.proposal).asObject()
        let arguments = ArrayList<String>()
        let argv = proposal.get("argv").getOrThrow().asArray()
        for (index in 0..argv.size()) { arguments.add(argv.get(index).getOrThrow().asString().getValue()) }
        let processCreated = AtomicBool(false)
        let observedStart = AtomicBool(false)
        let result = executor.run(proposal.get("executable").getOrThrow().asString().getValue(), arguments.toArray(),
            cwd: proposal.get("cwd").getOrThrow().asString().getValue(),
            timeoutMs: proposal.get("timeoutMs").getOrThrow().asInt().getValue(),
            outputLimit: proposal.get("outputLimit").getOrThrow().asInt().getValue(),
            cancelled: { => token.cancelled() }, startToken: Some(token), onCreated: { _ => processCreated.store(true) },
            onStarted: { pid =>
                let current = service.describe(id)
                service.startedSupervised(id, current.revision, "owned-subprocess:${id}:pid=${pid}")
                observedStart.store(true)
            })
        let current = service.describe(id)
        if (let Some(facts) <- result) {
            saveOutput(id, "stdout", facts.stdout, facts.outputComplete, facts.stdoutTruncated)
            saveOutput(id, "stderr", facts.stderr, facts.outputComplete, facts.stderrTruncated)
            if (!facts.exitObserved) { service.supervisionLost(id, current.revision, "process-exit-unobserved") }
            else {
                try { service.finish(id, current.revision, facts.exitCode, facts.timedOut, facts.cancelled, facts.outputComplete) }
                catch (e: Exception) {
                    if (e.message != "revision-conflict") { throw e }
                    // stop 可在读取修订后先落库，结算必须保留其取消裁决。
                    service.finish(id, service.describe(id).revision, facts.exitCode, facts.timedOut, facts.cancelled, facts.outputComplete)
                }
            }
            return facts
        }
        if (!observedStart.load()) {
            if (!processCreated.load() && token.cancelled()) {
                service.cancelledBeforeStart(id, current.revision)
                return ShellResult(-1, "", "", false, "cancelled-before-start", cancelled: true,
                    outputComplete: false, exitObserved: false)
            }
            service.startFailed(id, current.revision, "provider-start-failed")
        } else { service.supervisionLost(id, current.revision, "provider-observation-failed") }
        throw Exception("execution-provider-failed")
    }
}
