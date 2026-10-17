package host

import core.*
import stdx.encoding.json.*

// 有限产品控制面；不接受启动位置、模型、凭据或额外命令行参数。
func handleCodeBuddyAcpControl(host: HostRuntime, method: String, params: JsonObject, rpcId: String): Bool {
    if (method != "acp/settings/describe" && method != "acp/settings/set-enabled" && method != "acp/provider/probe" &&
        method != "acp/diagnostics/describe" && method != "acp/diagnostics/keep") {
        return false
    }
    if (params.get("peerId").isNone()) {
        return false
    }
    if (params.get("peerId").getOrThrow().asString().getValue() != "codebuddy") {
        throw Exception("provider-unavailable:acp-provider-not-registered")
    }
    let writing = method == "acp/settings/set-enabled" || method == "acp/diagnostics/keep" || method ==
        "acp/provider/probe"
    let size = if (method == "acp/settings/set-enabled" || method == "acp/diagnostics/keep") {
        4
    } else {
        2
    }
    if (params.size() != size) {
        throw Exception("invalid-input:acp-codebuddy-control")
    }
    if (writing) {
        ensureAcpJournalWriter(host)
    }
    let source = if (writing) {
        host.shared
    } else {
        SessionLog(host.p)
    }
    if (!writing && !source.load()) {
        throw Exception("replay-rejected")
    }
    let settings = AcpSessionSettings(source, host.lease, peerId: "codebuddy")
    if (method == "acp/settings/describe") {
        emit(okFrame(rpcId, settings.describe()));
        return true
    }
    if (method == "acp/settings/set-enabled") {
        let enabled = params.get("enabled").getOrThrow().asBool().getValue()
        let revision = params.get("revision").getOrThrow().asInt().getValue()
        var result = ""
        if (let Some(runtime) <- host.acpRuntime) {
            if (runtime.peerId == "codebuddy") { result = runtime.updateProviderEnabled(enabled, revision) }
        }
        if (result.size == 0) { result = settings.setEnabled(enabled, revision) }
        if (!enabled) {
            host.acpProbe.cancel(peerId: "codebuddy")
        }
        emit(okFrame(rpcId, result));
        return true
    }
    let workspace = sessionWorkingDirectory(source)
    let journal = AcpDiagnosticJournal(source, host.lease, host.activeId, workspace, peerId: "codebuddy")
    if (method == "acp/diagnostics/describe") {
        emit(okFrame(rpcId, journal.describe()));
        return true
    }
    if (method == "acp/diagnostics/keep") {
        emit(
            okFrame(rpcId,
                journal.keep(params.get("diagnosticId").getOrThrow().asString().getValue(),
                    params.get("revision").getOrThrow().asInt().getValue())));
        return true
    }
    if (!settings.effective.describe("project").enabled) {
        throw Exception("provider-unavailable:acp-disabled")
    }
    if (workspace.size == 0) {
        throw Exception("workspace-not-selected")
    }
    let scope = journal.scopeRevision()
    host
        .acpProbe
        .start(workspace, rpcId, peerId: "codebuddy",
            record: {result, token => journal.recordIfCurrent(result, scope, token)})
    return true
}
