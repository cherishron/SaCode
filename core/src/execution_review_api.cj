package core

import std.collection.*
import stdx.encoding.json.*

// 双入口写回契约；来源目录、原生库与writer不进入调用参数。
public class ExecutionReviewApi {
    let apply: ExecutionReviewApply
    let session: String
    public init(service: ExecutionService, store: AttachmentStore, desk: ApprovalDesk, session: String) {
        this.session = session
        this.apply = ExecutionReviewApply(service, store, desk, writer: platformReviewExchange)
    }
    private func status(id: String): String {
        let value = JsonValue.fromStr(apply.describe(id)).asObject()
        if (value.get("phase").getOrThrow().asString().getValue() == "awaiting-approval") {
            value.put("approvalArguments", JsonString(apply.proposal(id)))
        }
        return value.toString()
    }
    public func dispatch(method: String, params: String, asynchronous!: Bool = false,
        onStarted!: (ReviewApplyRun) -> Unit = {_ =>}): String {
        let obj = JsonValue.fromStr(params).asObject()
        var id = ""
        var execution = ""
        var revision: Int64 = 0
        var request = ""
        var ticket: Int64 = 0
        let paths = ArrayList<String>()
        try {
            if (obj.get("sessionId").getOrThrow().asString().getValue() != session) {
                throw Exception("session")
            }
            if (method == "execution/review-prepare") {
                if (obj.size() != 5) { throw Exception("shape") }
                execution = obj.get("executionId").getOrThrow().asString().getValue()
                revision = obj.get("revision").getOrThrow().asInt().getValue()
                request = obj.get("requestId").getOrThrow().asString().getValue()
                let items = obj.get("paths").getOrThrow().asArray()
                if (items.size() < 1 || items.size() > 128 || revision < 1 || execution.size == 0) { throw Exception("shape") }
                for (index in 0..items.size()) { paths.add(items.get(index).getOrThrow().asString().getValue()) }
            } else {
                id = obj.get("applyId").getOrThrow().asString().getValue()
                if (id.trimAscii().size == 0 || id.size > 256) { throw Exception("id") }
                if (method == "execution/review-apply") {
                    if (obj.size() != 3) { throw Exception("shape") }
                    ticket = obj.get("approvalId").getOrThrow().asInt().getValue()
                    if (ticket < 1) { throw Exception("ticket") }
                } else if (method != "execution/review-apply-describe" && method != "execution/review-apply-stop") {
                    throw Exception("method")
                } else if (obj.size() != 2) { throw Exception("shape") }
            }
        } catch (_: Exception) { throw Exception("bad-review-apply-arguments") }
        if (method == "execution/review-prepare") {
            let plan = JsonValue.fromStr(apply.propose(execution, revision, request, paths.toArray())).asObject()
            return status(plan.get("applyId").getOrThrow().asString().getValue())
        }
        if (method == "execution/review-apply-describe") { return status(id) }
        if (method == "execution/review-apply-stop") { apply.stop(id); return status(id) }
        // 重复请求只回放，不产生第二个worker，也不消费其他票。
        if (JsonValue.fromStr(apply.describe(id)).asObject().get("phase").getOrThrow().asString().getValue() != "awaiting-approval") {
            return status(id)
        }
        if (asynchronous) { onStarted(apply.start(id, ticket)) }
        else { apply.apply(id, ticket) }
        return status(id)
    }
}
