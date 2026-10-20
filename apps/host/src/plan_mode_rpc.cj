package host
import core.*
import stdx.encoding.json.*

// 计划模式读：与 approval/get-mode 同口径——只读当前会话日志折叠出的 plan/mode 状态。
func planModeReadRequest(log: SessionLog, idText: String): Unit {
    try {
        let activeText = if (PlanModeController(log).active()) { "true" } else { "false" }
        emit(okFrame(idText, "{\"ok\":true,\"active\":${activeText}}"))
    } catch (_: Exception) { emit(errFrame(idText, -32020, "plan-persistence-unsettled")) }
}

// 计划模式写：字段唯一（active 布尔），写许可 + 持久检查点，失败即冻结不谎报。
func planModeWriteRequest(log: SessionLog, lease: WriteLease, payload: String, idText: String): Unit {
    var active = false
    try {
        let params = JsonValue.fromStr(payload).asObject()
        if (params.size() != 1) { throw Exception("bad-plan-mode") }
        active = params.get("active").getOrThrow().asBool().getValue()
    } catch (_: Exception) { emit(errFrame(idText, -32602, "bad-plan-mode")); return }
    try {
        // 进入：记录原档并压到只读；退出：恢复原档（不隐式升级）。两者都过持久检查点。
        let result = if (active) { PlanModeController(log).enterDurable(lease) } else { PlanModeController(log).exitDurable(lease) }
        let now = PlanModeController(log).active()
        let activeText = if (now) { "true" } else { "false" }
        emit(okFrame(idText, "{\"ok\":true,\"result\":\"${result}\",\"active\":${activeText}}"))
    } catch (_: Exception) { emit(errFrame(idText, -32020, "plan-persistence-failed")) }
}
