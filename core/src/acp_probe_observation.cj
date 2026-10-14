package core

import stdx.encoding.json.*

// 白名单协议观测；不保存原始配置、authMethods、_meta 或凭据正文。
public class AcpProbeObservation {
    public let diagnosticId: String
    public let workspace: String
    public let executable: String
    public let agentName: String
    public let agentVersion: String
    public let sessionModel: String
    public let sessionMode: String
    public let processIntegrity: String
    public init(diagnosticId!: String = "", workspace!: String = "", executable!: String = "", agentName!: String = "",
        agentVersion!: String = "", sessionModel!: String = "", sessionMode!: String = "",
        processIntegrity!: String = "unknown") {
        this.diagnosticId = diagnosticId
        this.workspace = workspace
        this.executable = executable
        this.agentName = agentName
        this.agentVersion = agentVersion
        this.sessionModel = sessionModel
        this.sessionMode = sessionMode
        this.processIntegrity = processIntegrity
    }
    public func withExecutable(value: String): AcpProbeObservation {
        return AcpProbeObservation(diagnosticId: diagnosticId, workspace: workspace, executable: value,
            agentName: agentName, agentVersion: agentVersion, sessionModel: sessionModel, sessionMode: sessionMode,
            processIntegrity: processIntegrity)
    }
    public func withProcessIntegrity(value: String): AcpProbeObservation {
        return AcpProbeObservation(diagnosticId: diagnosticId, workspace: workspace, executable: executable,
            agentName: agentName, agentVersion: agentVersion, sessionModel: sessionModel, sessionMode: sessionMode,
            processIntegrity: value)
    }
    func report(environment: String, authenticated: Bool, verdict: String, version: Int64, evidence: String): AcpProviderReadiness {
        return AcpProviderReadiness(environment, authenticated, verdict, version, evidence, observation: this)
    }
    public func toJson(): String {
        let value = JsonObject()
        value.put("version", JsonInt(1));
        value.put("diagnosticId", JsonString(diagnosticId))
        value.put("workspace", JsonString(workspace));
        value.put("executable", JsonString(executable))
        for ((key, text) in [("agentName", agentName), ("agentVersion", agentVersion), ("sessionModel", sessionModel),
            ("sessionMode", sessionMode)]) {
            if (text.size == 0) {
                value.put(key, JsonNull())
            } else {
                value.put(key, JsonString(text))
            }
        }
        value.put("source", JsonString("acp-observation"))
        value.put("processIntegrity", JsonString(processIntegrity))
        value.put("configSources", JsonString("unknown"));
        value.put("processIdentity", JsonString("unknown"))
        value.put("primaryAgent", JsonString("unknown"));
        value.put("price", JsonString("unknown"))
        value.put("pluginModels", JsonString("unknown"));
        value.put("network", JsonString("not-tested"))
        value.put("modelTask", JsonString("not-tested"))
        return value.toString()
    }
}

func acpObservedText(value: JsonObject, key: String): String {
    try {
        let text = value.get(key).getOrThrow().asString().getValue()
        if (text.size == 0 || text.size > 256) {
            return ""
        }
        for (byte in text.toArray()) {
            if (byte < 32 || byte == 127) {
                return ""
            }
        }
        return text
    } catch (_: Exception) {
        return ""
    }
}

func acpProbeObservedInitialization(previous: AcpProbeObservation, raw: String): AcpProbeObservation {
    var name = "";
    var version = ""
    try {
        let info = acpRpcResult(raw).get("agentInfo").getOrThrow().asObject()
        name = acpObservedText(info, "name")
        version = acpObservedText(info, "version")
    } catch (_: Exception) {}
    return AcpProbeObservation(diagnosticId: previous.diagnosticId, workspace: previous.workspace,
        executable: previous.executable, agentName: name, agentVersion: version, sessionModel: previous.sessionModel,
        sessionMode: previous.sessionMode, processIntegrity: previous.processIntegrity)
}

func acpProbeObservedSession(previous: AcpProbeObservation, raw: String): AcpProbeObservation {
    let result = acpRpcResult(raw)
    var model = "";
    var mode = "";
    var modelSelectors: Int64 = 0
    try {
        let options = result.get("configOptions").getOrThrow().asArray()
        if (options.size() <= 128) {
            for (i in 0..options.size()) {
                try {
                    let option = options.get(i).getOrThrow().asObject()
                    if (acpObservedText(option, "category") == "model") {
                        modelSelectors += 1
                        if (acpObservedText(option, "type") == "select") {
                            model = acpObservedText(option, "currentValue")
                        }
                    }
                } catch (_: Exception) {}
            }
        }
    } catch (_: Exception) {}
    if (modelSelectors != 1) {
        model = ""
    }
    try {
        mode = acpObservedText(result.get("modes").getOrThrow().asObject(), "currentModeId")
    } catch (_: Exception) {}
    return AcpProbeObservation(diagnosticId: previous.diagnosticId, workspace: previous.workspace,
        executable: previous.executable, agentName: previous.agentName, agentVersion: previous.agentVersion,
        sessionModel: model, sessionMode: mode, processIntegrity: previous.processIntegrity)
}

// 仅返回封闭原因码，不把 stderr 中的路径、配置、令牌或原始异常送到页面。
func acpProbeFailureEvidence(stage: String, diagnostic: String): String {
    let permission = diagnostic.contains("EPERM") || diagnostic.contains("Permission denied") || diagnostic.contains(
        "Access is denied")
    let logFile = diagnostic.contains(".log") && (diagnostic.contains("\\log\\") || diagnostic.contains("/log/"))
    if (permission && logFile) {
        return "protocol-${stage}-log-file-permission-denied-unconfirmed:no-task"
    }
    return "protocol-${stage}-unconfirmed:no-task"
}
