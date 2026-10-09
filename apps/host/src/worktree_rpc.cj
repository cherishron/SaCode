package host

import core.*
import std.env.*
import std.fs.*
import stdx.encoding.json.*

// 仅有限协议适配；Git、副作用及所有权一律由共享核心负责。
//
// 六个方法名写成字面量链（与 isQueueMethod / isLspMethod 同形）：本仓的门禁按
// `method == "字面量"` 取分派集，拼出来的方法名它收不到。能力登记与分派条件
// 都从同一批字面量走，免得出现「声明了却没分派 / 分派了却没声明」。
func isWorktreeMethod(method: String): Bool {
    return method == "worktree/enter" || method == "worktree/describe" ||
        method == "worktree/exit" || method == "worktree/agent-prepare" ||
        method == "worktree/agent-finish" || method == "worktree/cleanup"
}

// describe 是这六条里唯一的读面；其余五条都会动会话日志与 Git 元数据，
// 必须按写动作走「资源门 + 租约 + 重载 + flush」，并被在途轮次/待决审批/扩展在飞挡住。
func isWorktreeWriteMethod(method: String): Bool {
    return isWorktreeMethod(method) && method != "worktree/describe"
}

// 会话有效目录（含 worktree 绑定）：起轮的工作目录与 workspace 面的高目录只能由这一处
// 算出来。两处各算一份迟早漂移——「人在工作树里、工具还在主检出里跑」就是这么来的。
func sessionWorkingDirectory(log: SessionLog): String {
    var processDirectory = ""
    try {
        processDirectory = canonicalize(".").toString()
    } catch (e: Exception) {
        processDirectory = ""
    }
    return SessionWorkspace(log, fallback: processDirectory).effectiveDirectory()
}

// 活动绑定判定是「能不能改工作区绑定」的门。探不到就按「有绑定」拒——
// 默认成非活动后放行重绑，绑定与实际目录就会不一致，属不可恢复状态。
func worktreeBound(log: SessionLog): Bool {
    try {
        return SessionWorktree(log, fallback: sessionWorkingDirectory(log)).active()
    } catch (e: Exception) {
        getStdErr().writeln("worktree-active-probe-failed:${e.message}")
        return true
    }
}

// 适配层的两类失败在协议面上必须分得开：-32602 是「话没说对」，
// -32003 是「话说对了但核心拒了」（脏目录、独有提交、缺 origin…）。
public class WorktreeReply {
    public let ok: Bool
    public let code: Int64
    public let text: String

    public init(ok: Bool, code: Int64, text: String) {
        this.ok = ok
        this.code = code
        this.text = text
    }
}

func worktreeParamsOf(body: String): JsonObject {
    let request = JsonValue.fromStr(body).asObject()
    if (let Some(value) <- request.get("params")) {
        return value.asObject()
    }
    return JsonObject()
}

// 类型不符时 stdx 的 asString/asBool 会抛，由外层统一收成 -32602；
// 这里不自己猜「数字 1 大概想当字符串用」。
func worktreeStringField(params: JsonObject, key: String): String {
    return params.get(key).getOrThrow().asString().getValue()
}

func worktreeOptionalString(params: JsonObject, key: String): Option<String> {
    if (let Some(value) <- params.get(key)) {
        return Some(value.asString().getValue())
    }
    return None
}

func worktreeOptionalBool(params: JsonObject, key: String): Bool {
    if (let Some(value) <- params.get(key)) {
        return value.asBool().getValue()
    }
    return false
}

func worktreeParamMessage(e: Exception): String {
    if (e.message.startsWith("bad-worktree")) { return e.message }
    return "bad-worktree-arguments:${e.message}"
}

class WorktreeRpcRequest {
    let method: String
    let name: String
    let reference: String
    let byReference: Bool
    let action: String
    let discard: Bool
    let agentId: String

    // 只读六个方法各自需要的键；多带的键忽略——「待决审批时不许切换」那条用例就是
    // 一次性把 name/action/agentId 都塞给每个方法，挡住它的必须是资源门而不是参数门。
    // log 只用于退出时的身份核对（读投影，不落任何事件）。
    init(method: String, params: JsonObject, log: SessionLog) {
        var name0 = ""
        var reference0 = ""
        var byReference0 = false
        var action0 = ""
        var discard0 = false
        var agent0 = ""
        if (method == "worktree/enter") {
            let hasName = params.get("name").isSome()
            let hasReference = params.get("reference").isSome()
            // 二选一：同时给（自相矛盾）或都不给（不知要哪个）都拒。
            // 空串 name 是合法取值——冻结契约里 enter("") 就是自动生成名称。
            if (hasName == hasReference) { throw Exception("bad-worktree-enter-selector") }
            if (hasName) { name0 = worktreeStringField(params, "name") }
            if (hasReference) {
                reference0 = worktreeStringField(params, "reference")
                if (reference0.size == 0) { throw Exception("bad-worktree-reference") }
                byReference0 = true
            }
        } else if (method == "worktree/exit") {
            if (params.get("action").isNone()) { throw Exception("bad-worktree-exit-action") }
            action0 = worktreeStringField(params, "action")
            // 退出动作只有 keep / remove 两种取值：草稿里出现过的 delete 一律不认。
            if (action0 != "keep" && action0 != "remove") { throw Exception("bad-worktree-exit-action") }
            if (let Some(value) <- worktreeOptionalString(params, "name")) { name0 = value }
            discard0 = worktreeOptionalBool(params, "discardChanges")
            // 调用方点名要退哪个工作树时，必须与当前绑定一致；否则就是拿旧界面退新
            // 工作树，退完人还在原地。无绑定时不比名——核心自己会拒。
            let bound = SessionWorktree(log, fallback: sessionWorkingDirectory(log))
            if (name0.size > 0 && bound.active() && name0 != bound.name()) {
                throw Exception("bad-worktree-exit-name:${name0}")
            }
        } else if (method == "worktree/agent-prepare" || method == "worktree/agent-finish") {
            if (params.get("agentId").isNone()) { throw Exception("bad-worktree-agent-id") }
            agent0 = worktreeStringField(params, "agentId")
            if (agent0.size == 0) { throw Exception("bad-worktree-agent-id") }
        }
        this.method = method
        this.name = name0
        this.reference = reference0
        this.byReference = byReference0
        this.action = action0
        this.discard = discard0
        this.agentId = agent0
    }

    // 返回值必须是合法 JSON：describe 交核心原文，其余都自己拼对象。
    // 核心那几个返回 String 的方法（exit / finishAgent）原文形态未经证实，直接拼进
    // result 会让 stdout 出现非协议帧——一律包成字段。
    func execute(log: SessionLog): String {
        let worktree = SessionWorktree(log, fallback: sessionWorkingDirectory(log))
        if (method == "worktree/describe") {
            // 冻结契约的 8 个字段原样透传：Host 不改名、不增删、不补默认值。
            return worktree.describe()
        }
        if (method == "worktree/enter") {
            let path = if (byReference) { worktree.enterPullRequest(reference) } else { worktree.enter(name) }
            return "{\"directory\":\"${jsonEscapeText(path)}\"}"
        }
        if (method == "worktree/exit") {
            // 核心 exit() 返回的就是退出后的 describe() 原文（已直读 worktree.cj 证实，
            // keep 与 remove 两条路径都是），所以这里透传：调用方一帧就看到 active:false
            // 与恢复后的 directory，不再造第二种返回形状。
            return worktree.exit(action, discardChanges: discard)
        }
        if (method == "worktree/cleanup") {
            return "{\"cleaned\":${worktree.cleanupAgents()}}"
        }
        // 这是目录与账本生命周期，不是子 agent 执行器。未来的执行器必须把返回目录
        // 传给子进程 cwd 或子轮次 ModelToolRuntime，并在执行结束后调用 finishAgent。
        // executorStarted 恒为 false 就是这条线还没接的自证，不拿登记冒充执行。
        if (method == "worktree/agent-prepare") {
            let path = worktree.prepareAgent(agentId)
            return "{\"agentId\":\"${jsonEscapeText(agentId)}\",\"directory\":\"${jsonEscapeText(path)}\",\"executorStarted\":false}"
        }
        // finishAgent 返回 {"agentId","directory","retained","removed"}（同上，直读证实）。
        return worktree.finishAgent(agentId)
    }
}

// 入口：先校参数（不碰核心），再执行。租约/重载/flush 由调用方（主循环）负责，
// 这里只做「一次会话日志上的核心调用」。
public func worktreeRequest(method: String, body: String, log: SessionLog): WorktreeReply {
    var parsed: Option<WorktreeRpcRequest> = None
    try {
        parsed = Some(WorktreeRpcRequest(method, worktreeParamsOf(body), log))
    } catch (e: Exception) {
        return WorktreeReply(false, -32602, worktreeParamMessage(e))
    }
    if (let Some(request) <- parsed) {
        try {
            return WorktreeReply(true, Int64(0), request.execute(log))
        } catch (e: Exception) {
            return WorktreeReply(false, -32003, e.message)
        }
    }
    return WorktreeReply(false, -32602, "bad-worktree-request")
}
