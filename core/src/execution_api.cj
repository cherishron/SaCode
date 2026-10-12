package core
import stdx.encoding.json.*

// 双入口共用的有限动作解析；不接收任意工具或进程回调。
public class ExecutionApi {
    let service: ExecutionService
    let desk: ApprovalDesk
    let sessionId: String
    public init(service: ExecutionService, desk: ApprovalDesk, sessionId: String) {
        this.service = service; this.desk = desk; this.sessionId = sessionId
    }
    public static func handles(method: String): Bool {
        return method == "execution/propose" || method == "execution/authorize" || method == "execution/start" ||
            method == "execution/describe" || method == "execution/output" || method == "execution/stop"
    }
    public static func readOnly(method: String): Bool { return method == "execution/describe" || method == "execution/output" }
    private func stateJson(state: ExecutionSnapshot): String {
        let result = JsonObject()
        result.put("executionId", JsonString(state.id)); result.put("sessionId", JsonString(state.sessionId))
        result.put("taskId", JsonString(state.taskId)); result.put("requestId", JsonString(state.requestId))
        result.put("proposal", JsonString(state.proposal)); result.put("proposalDigest", JsonString(state.digest))
        result.put("revision", JsonInt(state.revision)); result.put("phase", JsonString(state.phase))
        result.put("result", JsonString(state.result)); result.put("providerAvailable", JsonBool(false))
        if (state.phase == "awaiting-approval") { result.put("approvalArguments", JsonString(service.approvalArguments(state.id))) }
        return result.toString()
    }
    public func dispatch(method: String, params: String, asynchronous!: Bool = false,
        onStarted!: (ExecutionRun) -> Unit = { _ => }): String {
        if (!ExecutionApi.handles(method)) { throw Exception("unknown-execution-method") }
        let obj = JsonValue.fromStr(params).asObject()
        var id = ""
        var revision = Int64(0)
        var cursor = Int64(-1)
        var limit = Int64(1)
        var approvalId = Int64(0)
        var digest = ""
        var task = ""
        var request = ""
        var proposal = ""
        var session = ""
        try {
            session = obj.get("sessionId").getOrThrow().asString().getValue()
            if (method == "execution/propose") {
                if (obj.size() != 4) { throw Exception("shape") }
                task = obj.get("taskId").getOrThrow().asString().getValue()
                request = obj.get("requestId").getOrThrow().asString().getValue()
                proposal = obj.get("proposal").getOrThrow().asString().getValue()
            } else {
                id = obj.get("executionId").getOrThrow().asString().getValue()
                if (id.size == 0) { throw Exception("id") }
                if (method == "execution/describe") { if (obj.size() != 2) { throw Exception("shape") } }
                else if (method == "execution/output") {
                    if (obj.size() != 4) { throw Exception("shape") }
                    cursor = obj.get("cursor").getOrThrow().asInt().getValue()
                    limit = obj.get("limit").getOrThrow().asInt().getValue()
                } else {
                    revision = obj.get("revision").getOrThrow().asInt().getValue()
                    if (revision < 1) { throw Exception("revision") }
                    if (method == "execution/authorize") {
                        if (obj.size() != 5) { throw Exception("shape") }
                        digest = obj.get("proposalDigest").getOrThrow().asString().getValue()
                        approvalId = obj.get("approvalId").getOrThrow().asInt().getValue()
                        if (approvalId < 1 || digest.size != 64) { throw Exception("approval") }
                    } else { if (obj.size() != 3) { throw Exception("shape") } }
                }
            }
        } catch (_: Exception) { throw Exception("bad-execution-arguments") }
        if (session != sessionId) { throw Exception("execution-session-changed") }
        if (method == "execution/propose") { return stateJson(service.propose(task, request, proposal)) }
        if (method == "execution/describe") { return stateJson(service.describe(id)) }
        if (method == "execution/output") { return service.output(id, cursor, limit) }
        if (method == "execution/authorize") {
            if (service.describe(id).digest != digest) { throw Exception("approval-mismatch") }
            return stateJson(service.authorize(id, revision, approvalId, desk))
        }
        if (method == "execution/stop") { return stateJson(service.stop(id, revision)) }
        // 当前产品提供方没有通过隔离门禁，不能借 RPC 将探针放行值注入。
        let supervisor = ExecutionSupervisor(service)
        if (asynchronous) {
            let run = supervisor.start(id, revision)
            onStarted(run)
            return stateJson(run.starting)
        }
        supervisor.run(id, revision)
        return stateJson(service.describe(id))
    }
}
