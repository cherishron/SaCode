package host
import core.*
import stdx.encoding.json.*

func automationRequest(method: String, body: String, id: String, activeId: String, log: SessionLog): Unit {
    try {
        let args = JsonValue.fromStr(paramsTextOf(body)).asObject()
        if (args.get("sessionId").getOrThrow().asString().getValue() != activeId) { throw Exception("automation-session-changed") }
        let scope = args.get("scope").getOrThrow().asString().getValue()
        let workspace = SessionWorkspace(log).directory()
        if (scope == "project" && workspace.size == 0) { throw Exception("automation-project-required") }
        let store = AutomationStore.forScope(scope, workspace)
        if (method == "automation/list") {
            if (args.size() != 2) { throw Exception("automation-bad-args") }
            emit(okFrame(id, store.describe()))
        } else if (method == "automation/save") {
            if (args.size() != 4) { throw Exception("automation-bad-args") }
            let definition = args.get("definition").getOrThrow().asObject()
            let chosen = definition.get("modelId").getOrThrow().asString().getValue()
            var found = false; for (model in CustomModelRegistry.forUser().describe().models) { if (model.id == chosen && model.enabled) { found = true } }
            if (!found) { throw Exception("automation-model-unavailable") }
            emit(okFrame(id, store.save(definition.toString(), args.get("revision").getOrThrow().asInt().getValue())))
        } else {
            if (args.size() != 5) { throw Exception("automation-bad-args") }
            emit(okFrame(id, store.control(args.get("id").getOrThrow().asString().getValue(), args.get("action").getOrThrow().asString().getValue(), args.get("revision").getOrThrow().asInt().getValue())))
        }
    } catch (e: Exception) {
        let reason = if (e.message.startsWith("automation-")) { e.message } else { "automation-request-rejected" }
        emit(errFrame(id, if (reason == "automation-revision-conflict") { -32031 } else { -32003 }, reason))
    }
}
