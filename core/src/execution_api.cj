package core

import stdx.encoding.json.*

// 双入口共用的有限动作解析；不接收任意工具或进程回调。
public class ExecutionApi {
    let service: ExecutionService
    let desk: ApprovalDesk
    let sessionId: String
    public init(service: ExecutionService, desk: ApprovalDesk, sessionId: String) {
        this.service = service
        this.desk = desk
        this.sessionId = sessionId
    }
    public static func handles(method: String): Bool {
        return method == "execution/propose" || method == "execution/authorize" || method == "execution/start" ||
            method == "execution/describe" || method == "execution/output" || method == "execution/stop" || method ==
            "execution/list"
    }
    public static func readOnly(method: String): Bool {
        return method == "execution/describe" || method == "execution/output" || method == "execution/list"
    }
    private func listJson(cursor: Int64, limit: Int64): String {
        if (cursor < -1 || limit < 1 || limit > 16) {
            throw Exception("bad-execution-arguments")
        }
        let states = service.list()
        if (cursor >= states.size) {
            throw Exception("bad-execution-cursor")
        }
        let rows = JsonArray()
        var next = cursor
        for (index in (cursor + 1)..states.size) {
            if (rows.size() >= limit) {
                break
            }
            let state = states[index]
            let row = JsonObject()
            row.put("executionId", JsonString(state.id));
            row.put("sessionId", JsonString(state.sessionId))
            row.put("taskId", JsonString(state.taskId));
            row.put("requestId", JsonString(state.requestId))
            row.put("revision", JsonInt(state.revision));
            row.put("phase", JsonString(state.phase))
            rows.add(row);
            next = index
        }
        let result = JsonObject()
        result.put("version", JsonInt(1));
        result.put("sessionId", JsonString(sessionId))
        result.put("source", JsonString("durable-history"));
        result.put("records", rows)
        result.put("nextCursor", JsonInt(next));
        result.put("hasMore", JsonBool(next + 1 < states.size))
        return result.toString()
    }
    private func stateJson(state: ExecutionSnapshot): String {
        let result = JsonObject()
        result.put("executionId", JsonString(state.id));
        result.put("sessionId", JsonString(state.sessionId))
        result.put("taskId", JsonString(state.taskId));
        result.put("requestId", JsonString(state.requestId))
        result.put("proposal", JsonString(state.proposal));
        result.put("proposalDigest", JsonString(state.digest))
        result.put("revision", JsonInt(state.revision));
        result.put("phase", JsonString(state.phase))
        result.put("result", JsonString(state.result))
        let proposal = JsonValue.fromStr(state.proposal).asObject()
        let providerReason = platformExecutionBlockReason(proposal.get("cwd").getOrThrow().asString().getValue())
        result.put("providerAvailable", JsonBool(providerReason.size == 0))
        result.put("providerReason", JsonString(providerReason))
        if (state.phase == "awaiting-approval") {
            result.put("approvalArguments", JsonString(service.approvalArguments(state.id)))
        }
        return result.toString()
    }
    public func dispatch(method: String, params: String, asynchronous!: Bool = false,
        onStarted!: (ExecutionRun) -> Unit = {_ =>}): String {
        if (!ExecutionApi.handles(method)) {
            throw Exception("unknown-execution-method")
        }
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
                if (obj.size() != 4) {
                    throw Exception("shape")
                }
                task = obj.get("taskId").getOrThrow().asString().getValue()
                request = obj.get("requestId").getOrThrow().asString().getValue()
                proposal = obj.get("proposal").getOrThrow().asString().getValue()
            } else if (method == "execution/list") {
                if (obj.size() != 3) {
                    throw Exception("shape")
                }
                cursor = obj.get("cursor").getOrThrow().asInt().getValue()
                limit = obj.get("limit").getOrThrow().asInt().getValue()
            } else {
                id = obj.get("executionId").getOrThrow().asString().getValue()
                if (id.size == 0) {
                    throw Exception("id")
                }
                if (method == "execution/describe") {
                    if (obj.size() != 2) {
                        throw Exception("shape")
                    }
                } else if (method == "execution/output") {
                    if (obj.size() != 4) {
                        throw Exception("shape")
                    }
                    cursor = obj.get("cursor").getOrThrow().asInt().getValue()
                    limit = obj.get("limit").getOrThrow().asInt().getValue()
                } else {
                    revision = obj.get("revision").getOrThrow().asInt().getValue()
                    if (revision < 1) {
                        throw Exception("revision")
                    }
                    if (method == "execution/authorize") {
                        if (obj.size() != 5) {
                            throw Exception("shape")
                        }
                        digest = obj.get("proposalDigest").getOrThrow().asString().getValue()
                        approvalId = obj.get("approvalId").getOrThrow().asInt().getValue()
                        if (approvalId < 1 || digest.size != 64) {
                            throw Exception("approval")
                        }
                    } else {
                        if (obj.size() != 3) {
                            throw Exception("shape")
                        }
                    }
                }
            }
        } catch (_: Exception) {
            throw Exception("bad-execution-arguments")
        }
        if (session != sessionId) {
            throw Exception("execution-session-changed")
        }
        if (method == "execution/list") {
            return listJson(cursor, limit)
        }
        if (method == "execution/propose") {
            return stateJson(service.propose(task, request, proposal))
        }
        if (method == "execution/describe") {
            return stateJson(service.describe(id))
        }
        if (method == "execution/output") {
            return service.output(id, cursor, limit)
        }
        if (method == "execution/authorize") {
            if (service.describe(id).digest != digest) {
                throw Exception("approval-mismatch")
            }
            return stateJson(service.authorize(id, revision, approvalId, desk))
        }
        if (method == "execution/stop") {
            return stateJson(service.stop(id, revision))
        }
        // 就绪来自本平台固定命令探测，不接受 RPC 自报的 providerAvailable。
        let state = service.describe(id)
        let directory = JsonValue.fromStr(state.proposal).asObject().get("cwd").getOrThrow().asString().getValue()
        let supervisor = ExecutionSupervisor(service, providerReady: {=> platformExecutionReady(directory)},
            executor: ShellExecutor(workingDirectory: directory, sandboxRuntime: platformSandbox(directory)))
        if (asynchronous) {
            let run = supervisor.start(id, revision)
            onStarted(run)
            return stateJson(run.starting)
        }
        supervisor.run(id, revision)
        return stateJson(service.describe(id))
    }
}
