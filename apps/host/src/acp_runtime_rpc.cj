package host

import core.*
import stdx.encoding.json.*

// 活运行时只能由可信插件装配代码注入；协议没有可执行文件、认证布尔值或任意启动参数入口。
func handleAcpRuntimeRpc(host: HostRuntime, method: String, body: String, idText: String): Bool {
    if (!AcpRuntimeApi.handles(method)) {
        return false
    }
    try {
        if (host.turnBusy && method == "acp/delegation/create") {
            throw Exception("turn-in-flight")
        }
        let params = JsonValue.fromStr(body).asObject().get("params").getOrThrow().asObject()
        if (params.get("sessionId").getOrThrow().asString().getValue() != host.activeId) {
            throw Exception("not-authorized:acp-session-changed")
        }
        if (host.acpRuntime.isNone()) {
            throw Exception("provider-unavailable:acp-runtime-not-attached")
        }
        let runtime = host.acpRuntime.getOrThrow()
        if (!host.leaseHeld || !runtime.belongsTo(host.activeId, host.p, sessionWorkingDirectory(host.shared))) {
            throw Exception("not-authorized:acp-runtime-owner-changed")
        }
        emit(okFrame(idText, runtime.dispatch(method, params.toString())))
    } catch (e: Exception) {
        emit(errFrame(idText, -32027, e.message))
    }
    return true
}

func acpControlDuringTurn(method: String): Bool {
    return AcpRuntimeApi.handles(method) && method != "acp/delegation/create"
}

func acpSafeWhileOwned(method: String): Bool {
    return AcpRuntimeApi.handles(method) || AcpHistory.handles(method) || method == "initialize" || method ==
        "session/projection" || method == "session/subscribe" || method == "session/catalog" || method == "workspace/get" ||
        method == "model/get" || method == "approval/get-mode" || method == "appearance/get" || method ==
        "global/appearance/get"
}
