package host

import core.*
import stdx.encoding.json.*

public func handleApprovalSetMode(log: SessionLog, payload: String): String {
    let obj = JsonValue.fromStr(payload).asObject()
    let mode = obj.get("mode").getOrThrow().asString().getValue()
    let mc = ModeController(log)
    let result = mc.set(mode)
    return "{\"ok\":true,\"result\":\"${result}\"}"
}

public func handleApprovalGetMode(log: SessionLog, _payload: String): String {
    let mc = ModeController(log)
    return "{\"ok\":true,\"mode\":\"${mc.current()}\"}"
}
