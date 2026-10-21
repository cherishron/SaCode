package core

import std.collection.HashSet
import std.convert.*
import std.fs.*
import std.time.*

// 只在真实执行线程收束且检查点成功后发布结果；usage 未知不是零消耗。
public struct SubagentRunResult {
    public let sessionPath: String
    public let turn: TurnResult
    public let timedOut: Bool
    // 保守预算占用（含未知请求预留），不是供应商精确计费。
    public let chargedTokens: Int64
    public init(sessionPath: String, turn: TurnResult, timedOut: Bool, chargedTokens: Int64) {
        this.sessionPath = sessionPath
        this.turn = turn
        this.timedOut = timedOut
        this.chargedTokens = chargedTokens
    }
}

// 此映射刻意是闭集；能力名不是模型工具名，exec 不隐含 PTC/run_code。
func subagentExecutionTools(role: SubagentRole, parentTools: Array<String>): HashSet<String> {
    let requested = HashSet<String>()
    for (capability in role.tools) {
        if (capability == "read" || capability == "glob" || capability == "grep" ||
            capability == "write" || capability == "edit") {
            requested.add(capability)
        } else if (capability == "exec") {
            requested.add("bash")
            requested.add("pwsh")
        } else {
            throw Exception("subagent-capability-unavailable:${capability}")
        }
    }
    let effective = HashSet<String>()
    for (name in parentTools) {
        if (requested.contains(name)) { effective.add(name) }
    }
    return effective
}

// 仅由模型执行线程访问。UTF-8 字节 + 开销是准入估计，不是供应商 tokenizer。
// 工厂必须原样使用 model/body、遵守 max_tokens 并绑定 token；不能拼接主 context，异常须脱敏。
// Provider 仅有 next，无法保证实际计费硬上限，也无法抢占不响应取消的网络调用。
class SubagentRequestBudget {
    let budget: SubagentBudget
    let log: SessionLog
    let lease: WriteLease
    let token: TurnToken
    let model: String
    let runtime: ModelToolRuntime
    let factory: (TurnToken, String, String) -> Provider
    var requests: Int64 = 0
    var charged: Int64 = 0

    init(budget: SubagentBudget, log: SessionLog, lease: WriteLease, token: TurnToken,
        model: String, runtime: ModelToolRuntime, factory: (TurnToken, String, String) -> Provider) {
        this.budget = budget
        this.log = log
        this.lease = lease
        this.token = token
        this.model = model
        this.runtime = runtime
        this.factory = factory
    }

    func checkpoint(): Unit {
        if (!log.durableCheckpointBatched(lease)) {
            log.freezeAfterDurableFailure()
            token.cancel()
            throw Exception("subagent-persistence-unsettled")
        }
    }

    func make(): Provider {
        if (token.cancelled()) { throw Exception("subagent-cancelled") }
        if (requests >= budget.maxTurns) { throw Exception("subagent-request-limit") }
        let events = log.snapshotEvents().toArray()
        let specs = runtime.specs()
        let estimate = Int64(modelRequestJson(model, events, tools: specs).toArray().size) + 256
        let output = budget.maxTokens - charged - estimate
        if (output < 1) { throw Exception("subagent-token-admission-denied") }
        let body = modelRequestJson(model, events, tools: specs, maxOutputTokens: output)
        requests += 1
        log.append("subagent/request", "${requests}:${estimate}:${output}")
        checkpoint()
        if (token.cancelled()) { throw Exception("subagent-cancelled") }
        // 首请求也经此工厂；工厂异常意味着远端是否计费未知，保留全部预留额。
        charged += estimate + output
        let provider = factory(token, model, body)
        return SubagentBudgetProvider(provider, this, estimate, output)
    }
}

class SubagentBudgetProvider <: Provider & Resource {
    let provider: Provider
    let state: SubagentRequestBudget
    let input: Int64
    let output: Int64
    var usage: ?Int64 = None
    var completed = false
    var closed = false

    init(provider: Provider, state: SubagentRequestBudget, input: Int64, output: Int64) {
        this.provider = provider
        this.state = state
        this.input = input
        this.output = output
    }

    public func next(): ?Chunk {
        if (closed || state.token.cancelled()) { return None }
        let value = provider.next()
        if (let Some(chunk) <- value) {
            if (chunk.kind == "usage") {
                var count: Int64 = 0
                try {
                    count = Int64.parse(chunk.text)
                    if (count < 0) { throw Exception("negative-usage") }
                } catch (_: Exception) { throw Exception("subagent-usage-invalid") }
                if (let Some(previous) <- usage) {
                    if (count < previous) { throw Exception("subagent-usage-regressed") }
                }
                usage = Some(count)
                // 逐请求观察，不等整次任务结束才发现超限；usage 是请求累计值。
                state.log.append("subagent/usage", "${state.requests}:${count}")
                state.checkpoint()
                if (count > input + output) { throw Exception("subagent-token-limit-exceeded") }
            }
            if (chunk.kind == "finish") {
                if (usage.isNone()) { throw Exception("subagent-usage-unknown") }
                completed = true
            }
        } else if (!state.token.cancelled() && usage.isNone()) {
            throw Exception("subagent-usage-unknown")
        }
        return value
    }

    public func close(): Unit {
        if (closed) { return }
        closed = true
        var released = false
        try {
            if (let Some(resource) <- (provider as Resource)) { resource.close() }
            released = true
        } finally {
            if (let Some(count) <- usage) {
                state.charged += if (completed && released) { max(input, count) - input - output }
                    else { max(Int64(0), count - input - output) }
            }
            if (!completed || !released || usage.isNone()) {
                // 中断、异常或未报告最终 usage 均保留预留额，不能按部分 usage 退款。
                state.log.append("subagent/usage-unknown", "${state.requests}")
            }
            state.checkpoint()
        }
    }

    public func isClosed(): Bool { return closed }
}

// 可信调度方装配入口，不读取模型凭据，也不接收父消息历史。
// parentMode 是已授权父策略快照；parentGuard 必须在每次执行前重查撤权、工作区及系统策略。
// approval 回调只能在传入的独立 desk 上发放精确参数工单，并须响应子 token。
// 时间预算只保证截止后请求取消并等待真实收束；不合作的 provider/审批/工具可使 run 一直等待。
public class SubagentRunner {
    let root: String
    let workingDirectory: String
    let parentTools: Array<String>
    let parentMode: String
    let parentGuard: (String, String) -> Bool
    let approval: (ApprovalDesk, SessionLog, TurnToken, ModelToolCall) -> Int64
    let factory: (TurnToken, String, String) -> Provider
    let sandbox: SandboxRuntime

    public init(runRoot: String, workingDirectory: String, parentAllowedTools: Array<String>,
        parentMode: String, parentGuard: (String, String) -> Bool,
        approval: (ApprovalDesk, SessionLog, TurnToken, ModelToolCall) -> Int64,
        modelFactory: (TurnToken, String, String) -> Provider, sandboxRuntime: SandboxRuntime) {
        if (parentMode != "plan" && parentMode != "build" && parentMode != "auto" && parentMode != "yolo") {
            throw Exception("subagent-parent-policy-required")
        }
        this.root = canonicalize(runRoot).toString()
        this.workingDirectory = canonicalize(workingDirectory).toString()
        if (!FileInfo(root).isDirectory() || !FileInfo(this.workingDirectory).isDirectory()) {
            throw Exception("subagent-directory-unavailable")
        }
        this.parentTools = parentAllowedTools.clone()
        this.parentMode = parentMode
        this.parentGuard = parentGuard
        this.approval = approval
        this.factory = modelFactory
        this.sandbox = sandboxRuntime
    }

    // maxTurns 映射为模型请求步数，不是用户回合数；不承诺精确 tokenizer 或硬抢占。
    // runRoot 须由调度方控制，不允许不可信进程替换其目录/链接；每次 run 原子生成独立目录。
    public func run(role: SubagentRole, task: String, inheritedModel: String,
        parentToken: TurnToken, sink: FrameSink): SubagentRunResult {
        subagentRoleValidate(role)
        // acpEnabled 只是允许申请；本地 runtime 不注册 ACP 工具，不据此拒绝角色。
        let allowed = subagentExecutionTools(role, parentTools)
        let model = if (role.model.size > 0) { role.model } else { inheritedModel }
        if (model.trimAscii().size == 0) { throw Exception("subagent-model-required") }
        if (task.trimAscii().size == 0) { throw Exception("subagent-task-required") }
        let token = parentToken.child()
        if (token.cancelled()) { throw Exception("subagent-cancelled") }
        let begin = MonoTime.now()
        let directory = canonicalize(Directory.createTemp(root)).toString()
        if (canonicalize(directory).parent.toString() != root) {
            throw Exception("subagent-session-path-rejected")
        }
        let path = "${directory}/session.log"
        if (exists(path)) { throw Exception("subagent-session-path-reused") }
        let log = SessionLog(path)
        let lease = WriteLease(path)
        if (!lease.takeoverIfStale()) { throw Exception("subagent-session-busy") }
        try {
            // 即使父策略是 build，也显式记录，绝不依赖空子日志的默认 allow。
            log.append("mode/mode", parentMode)
            log.append("subagent/role", subagentRoleJson(role, true).toString())
            log.append("system/message", role.systemPrompt)
            log.append("user/message", task)
            let desk = ApprovalDesk(log)
            let runtime = ModelToolRuntime(log, false, files: true, workingDirectory: workingDirectory,
                sandboxRuntime: sandbox, desk: desk, lspToken: token,
                approval: { call => approval(desk, log, token, call) },
                guard: { name, args =>
                    if (token.cancelled() || !allowed.contains(name) || !parentGuard(name, args)) { return false }
                    // 批准与前序事实先耐久，再允许真正副作用；失败冻结而非继续执行。
                    if (!log.durableCheckpointBatched(lease)) {
                        log.freezeAfterDurableFailure()
                        token.cancel()
                        return false
                    }
                    return true
                })
            for (name in runtime.registry.list().toArray()) {
                if (!allowed.contains(name)) { runtime.registry.unregister(name) }
            }
            let state = SubagentRequestBudget(role.budget, log, lease, token, model, runtime, factory)
            state.checkpoint()
            let first = DeferredProvider({ => state.make() }, token)
            let handle = ModelAgentRunner().start(first, { _ => state.make() }, model, token, log, sink,
                false, maxSteps: role.budget.maxTurns, toolRuntime: Some(runtime))
            var timedOut = false
            var joined = false
            try {
                while (handle.isRunning()) {
                    if ((MonoTime.now() - begin).toMilliseconds() >= role.budget.maxTimeMs) {
                        timedOut = true
                        token.cancel()
                    }
                    sleep(Duration.millisecond)
                }
                let result = handle.result()
                joined = true
                if ((MonoTime.now() - begin).toMilliseconds() >= role.budget.maxTimeMs) { timedOut = true }
                log.append("subagent/settled", "${timedOut}:${state.requests}:${state.charged}")
                state.checkpoint()
                return SubagentRunResult(path, result, timedOut, state.charged)
            } finally {
                // 不用 future.cancel 伪造已退出；任何监督异常仍须 join 后才能释放租约。
                if (!joined) {
                    token.cancel()
                    try { handle.result() }
                    finally { log.freezeAfterDurableFailure() }
                }
            }
        } finally {
            if (!lease.release()) {
                log.freezeAfterDurableFailure()
                throw Exception("subagent-lease-release-unsettled")
            }
        }
    }
}
