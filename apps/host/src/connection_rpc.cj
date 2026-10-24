package host

import core.*
import stdx.encoding.json.*

func connectionRequest(method: String, body: String, id: String, activeId: String, log: SessionLog): Unit {
    try {
        let args = JsonValue.fromStr(paramsTextOf(body)).asObject()
        if (args.get("sessionId").getOrThrow().asString().getValue() != activeId) {
            throw Exception("connection-session-mismatch")
        }
        let scope = args.get("scope").getOrThrow().asString().getValue()
        let workspace = SessionWorkspace(log).directory()
        if (scope == "project" && workspace.size == 0) { throw Exception("connection-project-required") }
        let store = ConnectionDefinitionStore.forScope(scope, workspace)
        if (method == "connection/list") {
            if (args.size() != 2) { throw Exception("connection-bad-arguments") }
            emit(okFrame(id, store.describe()))
        } else if (method == "connection/save") {
            if (args.size() != 4) { throw Exception("connection-bad-arguments") }
            emit(okFrame(id, store.save(args.get("definition").getOrThrow().asObject().toString(),
                args.get("revision").getOrThrow().asInt().getValue())))
        } else if (method == "connection/control") {
            if (args.size() != 5) { throw Exception("connection-bad-arguments") }
            emit(okFrame(id, store.control(args.get("id").getOrThrow().asString().getValue(),
                args.get("action").getOrThrow().asString().getValue(), args.get("revision").getOrThrow().asInt().getValue())))
        } else { throw Exception("connection-bad-arguments") }
    } catch (e: Exception) {
        var reason = "connection-request-rejected"
        for (known in ["connection-session-mismatch", "connection-project-required", "connection-bad-arguments",
            "connection-bad-scope", "connection-revision-conflict", "connection-busy", "connection-not-found",
            "connection-bad-definition", "connection-bad-id", "connection-bad-credential-ref", "connection-bad-host",
            "connection-bad-port", "connection-bad-engine", "connection-tls-required", "connection-bad-transport",
            "connection-bad-kind", "connection-bad-endpoint", "connection-bad-environment", "connection-capacity",
            "connection-definition-too-large", "connection-path-rejected", "connection-replay-rejected",
            "connection-persistence-failed", "connection-bad-revision", "connection-bad-action"]) {
            if (e.message == known) { reason = known }
        }
        emit(errFrame(id, if (reason == "connection-revision-conflict") { -32031 } else { -32003 }, reason))
    }
}
