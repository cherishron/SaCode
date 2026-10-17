package host
import core.*
import stdx.encoding.json.*

func approvalModeReadRequest(log: SessionLog, idText: String): Unit {
    try { emit(okFrame(idText, "{\"ok\":true,\"mode\":\"${ModeController(log).current()}\"}")) }
    catch (_: Exception) { emit(errFrame(idText, -32020, "mode-persistence-unsettled")) }
}

func approvalModeWriteRequest(log: SessionLog, lease: WriteLease, payload: String, idText: String): Unit {
    var mode = ""
    try {
        let params = JsonValue.fromStr(payload).asObject()
        if (params.size() != 1) { throw Exception("bad-mode") }
        mode = params.get("mode").getOrThrow().asString().getValue()
        if (mode != "plan" && mode != "build" && mode != "auto" && mode != "yolo") { throw Exception("bad-mode") }
    } catch (_: Exception) { emit(errFrame(idText, -32602, "bad-approval-mode")); return }
    try {
        let result = ModeController(log).setDurable(mode, lease)
        emit(okFrame(idText, "{\"ok\":true,\"result\":\"${result}\"}"))
    } catch (_: Exception) { emit(errFrame(idText, -32020, "mode-persistence-failed")) }
}
