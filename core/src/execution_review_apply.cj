package core

import std.collection.*
import std.sync.*
import std.fs.*
import stdx.encoding.json.*

// 句柄只代表当前进程的在途写回；恢复仍以持久日志为准，不重放文件写入。
public class ReviewApplyRun {
    let token: TurnToken
    let result: Future<String>
    let done: AtomicBool
    init(result: Future<String>, done: AtomicBool, token: TurnToken) {
        this.token = token
        this.result = result
        this.done = done
    }
    public func cancel(): Unit { token.requestReviewStop() }
    public func settled(): Bool { return done.load() }
    public func wait(timeoutMs!: Int64 = 310000): String {
        return result.get(timeoutMs * Duration.millisecond)
    }
}

// 写回沿用原执行的 SessionLog、WriteLease、ApprovalDesk 与 TurnToken；没有第二份任务队列。
class ReviewWriteResult {
    let error: UInt32
    let mayHaveChanged: Bool
    init(error: UInt32, mayHaveChanged: Bool) {
        this.error = error
        this.mayHaveChanged = mayHaveChanged
    }
}

class ReviewExchangeAction <: CancellationStartAction {
    let call: () -> ReviewWriteResult
    var result: ?ReviewWriteResult = None
    init(call: () -> ReviewWriteResult) {
        this.call = call
    }
    public func start(): Bool {
        result = Some(call())
        return true
    }
}

class ExecutionReviewApply {
    let service: ExecutionService
    let store: AttachmentStore
    let desk: ApprovalDesk
    let writer: (String, String, String, ?Array<Byte>, ?Array<Byte>) -> ReviewWriteResult
    init(service: ExecutionService, store: AttachmentStore, desk: ApprovalDesk,
        writer!: (String, String, String, ?Array<Byte>, ?Array<Byte>) -> ReviewWriteResult) {
        this.service = service
        this.store = store
        this.desk = desk
        this.writer = writer
    }
    private func persist(kind: String, value: JsonObject): Unit {
        if (!service.lease.protects(service.log.path)) {
            throw Exception("already-owned")
        }
        value.put("version", JsonInt(1));
        value.put("sessionId", JsonString(service.sessionId))
        service.log.append(kind, value.toString())
        if (!service.checkpoint() || !service.lease.protects(service.log.path)) {
            service.persistenceFailed = true
            throw Exception("persistence-failed")
        }
    }
    private func checkWorkspace(plan: JsonObject): Unit {
        let workspace = SessionWorkspace(service.log)
        let source = plan.get("sourceDirectory").getOrThrow().asString().getValue()
        if (!workspace.available() || workspace.revision() !=
            plan.get("workspaceRevision").getOrThrow().asInt().getValue() ||
            normalizeWriterPath(canonicalize(source)) != normalizeWriterPath(canonicalize(workspace.directory())) ||
            platformReviewDirectoryIdentity(source) != plan.get("sourceIdentity").getOrThrow().asString().getValue()) {
            throw Exception("workspace-changed")
        }
    }
    private func planFor(id: String): String {
        var found = ""
        for (event in service.log.snapshotEvents()) {
            if (event.eventType != "execution/review-apply-proposed" || event.seq >= service.log.durableCount()) {
                continue
            }
            let value = JsonValue.fromStr(event.data).asObject()
            if (value.get("applyId").getOrThrow().asString().getValue() != id) {
                continue
            }
            if (value.get("version").getOrThrow().asInt().getValue() != 1 ||
                value.get("sessionId").getOrThrow().asString().getValue() != service.sessionId || (found.size > 0 &&
                found != event.data)) {
                throw Exception("review-apply-binding-conflict")
            }
            found = event.data
        }
        if (found.size == 0) {
            throw Exception("review-apply-not-found")
        }
        return found
    }
    func propose(executionId: String, revision: Int64, requestId: String, paths: Array<String>): String {
        synchronized(service.log.mtx) {
            if (requestId.trimAscii().size == 0 || requestId.size > 128 || paths.size < 1 || paths.size > 128) {
                throw Exception("bad-review-apply-arguments")
            }
            let state = service.describe(executionId)
            if (state.revision != revision) {
                throw Exception("revision-conflict")
            }
            let reviewText = service.review(executionId)
            if (reviewText.size == 0) {
                throw Exception("workspace-review-missing")
            }
            let review = JsonValue.fromStr(reviewText).asObject()
            let available = review.get("files").getOrThrow().asArray()
            let selected = JsonArray();
            let seen = HashMap<String, Bool>()
            for (path in paths) {
                if (path.size < 1 || path.size > 4096 || path.contains("\\") || path.contains(":") || path.startsWith(
                    "/")) {
                    throw Exception("bad-review-apply-path")
                }
                for (part in path.split("/")) {
                    let name = part.toAsciiLower()
                    if (part.size == 0 || part == "." || part == ".." || name == ".git" || name == "target" || name ==
                        "node_modules") {
                        throw Exception("bad-review-apply-path")
                    }
                }
                let key = normalizeWriterPath(Path(path))
                if (seen.contains(key)) {
                    throw Exception("bad-review-apply-path")
                };
                seen[key] = true
                var index: Int64 = 0;
                var matched = false
                while (let Some(item) <- available.get(index)) {
                    index += 1
                    if (item.asObject().get("path").getOrThrow().asString().getValue() == path) {
                        selected.add(item);
                        matched = true
                        break
                    }
                }
                if (!matched) {
                    throw Exception("workspace-review-path-not-recorded")
                }
            }
            let plan = JsonObject()
            plan.put("sessionId", JsonString(service.sessionId));
            plan.put("version", JsonInt(1))
            plan.put("executionId", JsonString(executionId));
            plan.put("executionRevision", JsonInt(revision))
            plan.put("requestId", JsonString(requestId));
            plan.put("reviewDigest", JsonString(sha256Hex(reviewText.toArray())))
            let identity = review.get("sourceIdentity")
            if (identity.isNone()) {
                throw Exception("review-source-identity-missing")
            }
            plan.put("sourceIdentity", identity.getOrThrow())
            plan.put("sourceDirectory", review.get("sourceDirectory").getOrThrow())
            plan.put("workspaceRevision", JsonInt(SessionWorkspace(service.log).revision()));
            plan.put("files", selected)
            checkWorkspace(plan)
            let id = "review-apply-" + sha256Hex(plan.toString().toArray())
            plan.put("applyId", JsonString(id))
            let payload = plan.toString()
            if (payload.size > 262144) {
                throw Exception("review-apply-plan-too-large")
            }
            for (event in service.log.snapshotEvents()) {
                if (event.eventType != "execution/review-apply-proposed") {
                    continue
                }
                let previous = JsonValue.fromStr(event.data).asObject()
                if (previous.get("requestId").getOrThrow().asString().getValue() != requestId) {
                    continue
                }
                if (event.data != payload) {
                    throw Exception("request-conflict")
                }
                return planFor(id)
            }
            persist("execution/review-apply-proposed", plan)
            return payload
        }
    }
    func proposal(id: String): String {
        synchronized(service.log.mtx) { return planFor(id) }
    }
    func describe(id: String): String {
        synchronized(service.log.mtx) {
            let plan = JsonValue.fromStr(planFor(id)).asObject()
            var phase = "awaiting-approval";
            let rows = JsonArray()
            let results = HashMap<String, String>();
            let intents = HashMap<String, Bool>()
            let durable = service.log.durableCount()
            for (event in service.log.snapshotEvents()) {
                if (event.seq >= durable || (event.eventType != "execution/review-apply-begin" && event.eventType !=
                    "execution/review-apply-intent" && event.eventType != "execution/review-apply-result" &&
                    event.eventType != "execution/review-apply-settled")) {
                    continue
                }
                let obj = JsonValue.fromStr(event.data).asObject()
                if (obj.get("applyId").getOrThrow().asString().getValue() != id) {
                    continue
                }
                if (event.eventType == "execution/review-apply-begin") {
                    phase = if (service.reviewApplyTokens.contains(id)) {
                        "applying"
                    } else {
                        "unknown"
                    }
                } else if (event.eventType == "execution/review-apply-settled") {
                    phase = obj.get("phase").getOrThrow().asString().getValue()
                } else {
                    let path = obj.get("path").getOrThrow().asString().getValue()
                    if (event.eventType == "execution/review-apply-intent") {
                        intents[path] = true
                    } else {
                        results[path] = obj.get("phase").getOrThrow().asString().getValue()
                    }
                }
            }
            var index: Int64 = 0;
            let files = plan.get("files").getOrThrow().asArray()
            while (let Some(file) <- files.get(index)) {
                index += 1
                let path = file.asObject().get("path").getOrThrow().asString().getValue()
                let row = JsonObject();
                row.put("path", JsonString(path))
                row.put("phase", JsonString(if (results.contains(path)) {
                    results[path]
                } else if (intents.contains(path)) {
                    if (phase == "applying") {
                        "writing"
                    } else {
                        "unknown"
                    }
                } else {
                    "not-attempted"
                }))
                rows.add(row)
            }
            let out = JsonObject();
            out.put("version", JsonInt(1));
            out.put("applyId", JsonString(id))
            out.put("sessionId", JsonString(service.sessionId));
            out.put("phase", JsonString(phase));
            out.put("files", rows)
            return out.toString()
        }
    }
    private func bytes(row: JsonObject, side: String): ?Array<Byte> {
        let object = row.get(side + "Object").getOrThrow().asString().getValue()
        let digest = row.get(side + "Digest").getOrThrow().asString().getValue()
        if (object.size == 0) {
            if (digest.size != 0) {
                throw Exception("workspace-review-object-corrupt")
            }
            return None
        }
        if (object != "sha256:" + digest) {
            throw Exception("workspace-review-object-corrupt")
        }
        let data = store.read(object)
        if (data.size > 8388608 || sha256Hex(data) != digest) {
            throw Exception("workspace-review-object-corrupt")
        }
        return Some(data)
    }
    private func admit(id: String, approvalId: Int64, token: TurnToken): ?JsonObject {
        let payload = synchronized(service.log.mtx) {
            planFor(id)
        }
        if (JsonValue.fromStr(describe(id)).asObject().get("phase").getOrThrow().asString().getValue() !=
            "awaiting-approval") {
            return None // 包括unknown：只回放，不重复副作用或消费新票。
        }
        if (desk.consumeExactForCall(approvalId, "execution/review-apply", payload) != "allowed-once") {
            throw Exception("not-authorized")
        }
        let plan = JsonValue.fromStr(payload).asObject()
        synchronized(service.log.mtx) {
            if (JsonValue.fromStr(describe(id)).asObject().get("phase").getOrThrow().asString().getValue() !=
                "awaiting-approval") {
                return None
            }
            checkWorkspace(plan)
            let execution = plan.get("executionId").getOrThrow().asString().getValue()
            if (service.describe(execution).revision != plan.get("executionRevision").getOrThrow().asInt().getValue() ||
                sha256Hex(service.review(execution).toArray()) !=
                plan.get("reviewDigest").getOrThrow().asString().getValue()) {
                throw Exception("review-apply-binding-conflict")
            }
            let begin = JsonObject();
            begin.put("applyId", JsonString(id))
            persist("execution/review-apply-begin", begin)
            service.reviewApplyTokens[id] = token
        }
        return Some(plan)
    }
    func apply(id: String, approvalId: Int64, token!: TurnToken = TurnToken()): String {
        if (let Some(plan) <- admit(id, approvalId, token)) {
            return execute(id, plan, token)
        }
        return describe(id)
    }
    func start(id: String, approvalId: Int64): ReviewApplyRun {
        let token = TurnToken()
        // 审批、工作区核对和持久开始屏障在返回前完成；并发start不能生成第二次写入。
        let plan = admit(id, approvalId, token).getOrThrow()
        let done = AtomicBool(false)
        let result = spawn {
            => try { execute(id, plan, token) }
            finally { done.store(true) }
        }
        return ReviewApplyRun(result, done, token)
    }
    func stop(id: String): String {
        synchronized(service.log.mtx) {
            planFor(id)
            if (let Some(token) <- service.reviewApplyTokens.get(id)) {
                token.requestReviewStop()
            }
        }
        return describe(id)
    }
    private func execute(id: String, plan: JsonObject, token: TurnToken): String {
        var finalPhase = "completed";
        var applied: Int64 = 0
        try {
            let files = plan.get("files").getOrThrow().asArray();
            var index: Int64 = 0
            while (let Some(item) <- files.get(index)) {
                index += 1
                if (token.cancelled()) {
                    finalPhase = if (applied > 0) {
                        "partial-cancelled"
                    } else {
                        "cancelled"
                    };
                    break
                }
                let row = item.asObject();
                let path = row.get("path").getOrThrow().asString().getValue()
                let before = bytes(row, "before");
                let after = bytes(row, "after")
                synchronized(service.log.mtx) {
                    checkWorkspace(plan)
                    let intent = JsonObject();
                    intent.put("applyId", JsonString(id));
                    intent.put("path", JsonString(path))
                    persist("execution/review-apply-intent", intent)
                }
                let action = ReviewExchangeAction(
                    {
                        => writer(plan.get("sourceDirectory").getOrThrow().asString().getValue(),
                        plan.get("sourceIdentity").getOrThrow().asString().getValue(), path, before, after)
                    })
                var phase = "unknown";
                var error: UInt32 = 0
                try {
                    if (!token.runStartIfNotCancelled(action)) {
                        phase = "cancelled"
                    } else if (let Some(result) <- action.result) {
                        error = result.error
                        phase = if (error == 0) {
                            "applied"
                        } else if (result.mayHaveChanged) {
                            "unknown"
                        } else {
                            "conflict"
                        }
                    }
                } catch (_: Exception) {
                    phase = "unknown"
                }
                synchronized(service.log.mtx) {
                    let result = JsonObject();
                    result.put("applyId", JsonString(id));
                    result.put("path", JsonString(path))
                    result.put("phase", JsonString(phase));
                    result.put("error", JsonInt(Int64(error)))
                    persist("execution/review-apply-result", result)
                }
                if (phase != "applied") {
                    finalPhase = if (applied > 0 && phase != "unknown") {
                        "partial-" + phase
                    } else {
                        phase
                    };
                    break
                }
                applied += 1
            }
            synchronized(service.log.mtx) {
                let settled = JsonObject();
                settled.put("applyId", JsonString(id));
                settled.put("phase", JsonString(finalPhase))
                persist("execution/review-apply-settled", settled)
            }
        } finally {
            synchronized(service.log.mtx) {
                service.reviewApplyTokens.remove(id)
            }
        }
        return describe(id)
    }
}
