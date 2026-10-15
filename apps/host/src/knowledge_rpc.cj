package host

import core.*
import stdx.encoding.json.*

func knowledgeRequest(method: String, body: String, id: String, activeId: String, log: SessionLog): Unit {
    try {
        let args = JsonValue.fromStr(paramsTextOf(body)).asObject()
        if (args.get("sessionId").getOrThrow().asString().getValue() != activeId) {
            throw Exception("knowledge-session-changed")
        }
        let scope = args.get("scope").getOrThrow().asString().getValue()
        let workspace = SessionWorkspace(log).directory()
        if (scope == "project" && workspace.size == 0) {
            throw Exception("knowledge-project-required")
        }
        let store = KnowledgeStore.forScope(scope, workspace)
        if (method == "knowledge/list") {
            if (args.size() != 3) {
                throw Exception("knowledge-bad-args")
            }
            emit(okFrame(id, store.query(args.get("query").getOrThrow().asString().getValue())))
        } else if (method == "knowledge/reference") {
            if (args.size() != 4) {
                throw Exception("knowledge-bad-args")
            }
            emit(
                okFrame(id,
                    store.reference(args.get("id").getOrThrow().asString().getValue(),
                        args.get("revision").getOrThrow().asInt().getValue())))
        } else if (method == "knowledge/import") {
            if (args.size() != 6) {
                throw Exception("knowledge-bad-args")
            }
            emit(
                okFrame(id,
                    store.importFile(args.get("id").getOrThrow().asString().getValue(),
                        args.get("title").getOrThrow().asString().getValue(),
                        args.get("path").getOrThrow().asString().getValue(),
                        args.get("revision").getOrThrow().asInt().getValue())))
        } else {
            if (args.size() != 6) {
                throw Exception("knowledge-bad-args")
            }
            emit(
                okFrame(id,
                    store.save(args.get("id").getOrThrow().asString().getValue(),
                        args.get("title").getOrThrow().asString().getValue(),
                        args.get("content").getOrThrow().asString().getValue(),
                        args.get("revision").getOrThrow().asInt().getValue(), method == "knowledge/remove")))
        }
    } catch (e: Exception) {
        let reason = if (e.message.startsWith("knowledge-")) {
            e.message
        } else {
            "knowledge-storage-unavailable"
        }
        emit(errFrame(id, if (reason == "knowledge-revision-conflict") {
            -32031
        } else {
            -32003
        }, reason))
    }
}
