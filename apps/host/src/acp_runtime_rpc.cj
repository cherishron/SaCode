package host

import core.*
import stdx.encoding.json.*

// 活运行时只能由可信插件装配代码注入；协议没有可执行文件、认证布尔值或任意启动参数入口。
func handleAcpRuntimeRpc(host: HostRuntime, method: String, body: String, idText: String): Bool {
    if (!isAcpProductMethod(method)) {
        return false
    }
    try {
        if (host.turnBusy && !acpControlDuringTurn(method)) {
            throw Exception("turn-in-flight")
        }
        let params = JsonValue.fromStr(body).asObject().get("params").getOrThrow().asObject()
        if (params.get("sessionId").getOrThrow().asString().getValue() != host.activeId) {
            throw Exception("not-authorized:acp-session-changed")
        }
        if (method == "acp/settings/describe") {
            if (params.size() != 1) {
                throw Exception("invalid-input:acp-settings")
            }
            let source = SessionLog(host.p)
            if (!source.load()) {
                throw Exception("replay-rejected")
            }
            emit(okFrame(idText, AcpSessionSettings(source, host.lease).describe()));
            return true
        }
        if (method == "acp/provider/probe") {
            if (params.size() != 1) {
                throw Exception("invalid-input:acp-probe")
            }
            let source = SessionLog(host.p)
            if (!source.load()) {
                throw Exception("replay-rejected")
            }
            if (!AcpSessionSettings(source, host.lease).effective.describe("project").enabled) {
                throw Exception("provider-unavailable:acp-disabled")
            }
            let workspace = sessionWorkingDirectory(source)
            if (workspace.size == 0) {
                throw Exception("workspace-not-selected")
            }
            let report = OpenCodeAcpProvider(hostOpenCodeExecutable()).probe(workspace)
            emit(okFrame(idText, openCodeReadinessJson(report)));
            return true
        }
        if (method == "acp/settings/set-enabled" || method == "acp/delegation/create") {
            if (!host.leaseHeld) {
                if (!host.lease.takeoverIfStale()) {
                    throw Exception("already-owned")
                }
                if (!loadForWrite(host.shared, host.meter)) {
                    host.lease.release();
                    throw Exception("replay-rejected")
                }
                host.leaseHeld = true
                if (let Some(previous) <- host.acpRuntime) {
                    if (!previous.quiescent() || !previous.shutdown()) {
                        throw Exception("acp-shutdown-unconfirmed")
                    }
                    host.acpRuntime = None
                }
                // 重新接手租约后，以重载后的日志重建开关；不复用旧内存中的 enabled。
                host.acpSettings = None
            }
            if (host.acpSettings.isNone()) {
                host.acpSettings = Some(AcpSessionSettings(host.shared, host.lease))
            }
            let settings = host.acpSettings.getOrThrow()
            if (!settings.belongsTo(host.p)) {
                throw Exception("not-authorized:acp-settings-owner-changed")
            }
            if (method == "acp/settings/set-enabled") {
                if (params.size() != 3) {
                    throw Exception("invalid-input:acp-settings")
                }
                emit(
                    okFrame(idText,
                        settings.setEnabled(params.get("enabled").getOrThrow().asBool().getValue(),
                            params.get("revision").getOrThrow().asInt().getValue())))
                return true
            }
            if (!settings.effective.describe("project").enabled) {
                throw Exception("provider-unavailable:acp-disabled")
            }
            if (params.get("peerId").getOrThrow().asString().getValue() != "opencode") {
                throw Exception("provider-unavailable:acp-provider-not-registered")
            }
            if (host.acpRuntime.isNone()) {
                let providers = AcpProviders()
                providers.register("builtin/opencode", OpenCodeAcpProvider(hostOpenCodeExecutable()))
                let workspace = sessionWorkingDirectory(host.shared)
                if (workspace.size == 0) {
                    throw Exception("workspace-not-selected")
                }
                let service = providers.service("opencode", workspace, settings.effective, host.shared, host.lease,
                    host.activeId, settingsScope: "project")
                host.acpRuntime = Some(AcpRuntimeApi(service, host.approvalDesk, host.lease, workspace))
            }
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
    return (AcpRuntimeApi.handles(method) && method != "acp/delegation/create") || method == "acp/settings/describe"
}

func acpSafeWhileOwned(method: String): Bool {
    return isAcpProductMethod(method) || AcpHistory.handles(method) || method == "initialize" || method ==
        "session/projection" || method == "session/subscribe" || method == "session/catalog" || method == "workspace/get" ||
        method == "model/get" || method == "approval/get-mode" || method == "appearance/get" || method ==
        "global/appearance/get"
}

func isAcpProductMethod(method: String): Bool {
    return AcpRuntimeApi.handles(method) || method == "acp/settings/describe" || method == "acp/settings/set-enabled" ||
        method == "acp/provider/probe"
}

// 只从宿主环境或受控产品发现结果取路径，不从请求参数构造命令。
func hostOpenCodeExecutable(): String {
    return configuredOpenCodeExecutable()
}

func acpChangesOwner(method: String): Bool {
    return method == "session/select" || method == "session/create" || method == "workspace/set-directory" || method ==
        "workspace/select-recent" || (method.startsWith("worktree/") && method != "worktree/describe")
}
