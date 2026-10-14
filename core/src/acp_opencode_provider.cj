package core

import std.env.getVariable
import std.fs.*
import stdx.encoding.json.*
import core.launch_context.currentProcessIntegrity

// Host 与 CLI 共用可信启动位置解析；模型或页面参数没有此入口。
func openCodeFromWindowsSearchPath(searchPath: String): String {
    for (entry in searchPath.split(";", removeEmpty: true)) {
        try {
            let directory = Path(entry.trimAscii())
            if (!directory.isAbsolute()) {
                continue
            }
            let native = directory.join("opencode.exe")
            if (exists(native) && !FileInfo(native).isDirectory()) {
                return canonicalize(native).toString()
            }
            let shim = directory.join("opencode.cmd")
            if (!exists(shim)) {
                continue
            }
            let packageRoot = directory.join("node_modules").join("@opencode").join("cli")
            let manifestPath = packageRoot.join("package.json")
            if (FileInfo(shim).size > 65536 || FileInfo(manifestPath).size > 65536) {
                continue
            }
            let manifest = JsonValue.fromStr(String.fromUtf8(File.readFrom(manifestPath))).asObject()
            if (manifest.get("name").getOrThrow().asString().getValue() != "@opencode/cli" ||
                manifest.get("bin").getOrThrow().asObject().get("opencode").getOrThrow().asString().getValue() !=
                "./bin/opencode.exe") {
                continue
            }
            let script = String.fromUtf8(File.readFrom(shim))
            if (!script.contains("\\node_modules\\@opencode\\cli\\bin\\opencode.exe")) {
                continue
            }
            let executable = packageRoot.join("bin").join("opencode.exe")
            if (exists(executable) && !FileInfo(executable).isDirectory()) {
                return canonicalize(executable).toString()
            }
        } catch (_: Exception) {
            continue
        }
    }
    throw Exception("provider-unavailable:opencode-executable-not-configured")
}

public func configuredOpenCodeExecutable(): String {
    let configured = getVariable("SACODE_ACP_OPENCODE_EXECUTABLE") ?? ""
    if (configured.size > 0) {
        return canonicalize(configured).toString()
    }
    // Windows 只看显式 PATH 绝对目录；不搜索当前目录，不经 shell 执行 --version。
    return openCodeFromWindowsSearchPath(getVariable("PATH") ?? getVariable("Path") ?? "")
}

// 发现失败也返回可持久、可解释的诊断；关闭入口不得调用本函数。
// resolver 仅供可信装配/测试使用，不进入 RPC 参数。
public func probeConfiguredOpenCode(workspace: String, token: TurnToken,
    resolver!: () -> String = {=> configuredOpenCodeExecutable()}): AcpProviderReadiness {
    var observation = AcpProbeObservation(diagnosticId: "acp-" + randomHex(16), workspace: workspace)
    if (token.cancelled()) {
        return observation.report("pending-verification", false, "pending-verification", 0,
            "probe-cancelled-before-start:no-task")
    }
    observation = observation.withProcessIntegrity(currentProcessIntegrity())
    try {
        let executable = resolver()
        if (token.cancelled()) {
            return observation.report("pending-verification", false, "pending-verification", 0,
                "probe-cancelled-before-start:no-task")
        }
        if (!exists(executable) || FileInfo(executable).isDirectory()) {
            return observation.report("probe-failed-unknown", false, "blocked", 0,
                "opencode-executable-not-found:no-task")
        }
        return OpenCodeAcpProvider(executable).probeWithToken(workspace, token)
    } catch (e: Exception) {
        if (token.cancelled()) {
            return observation.report("pending-verification", false, "pending-verification", 0,
                "probe-cancelled-before-start:no-task")
        }
        let reason = if (e.message == "provider-unavailable:opencode-executable-not-configured") {
            "opencode-executable-not-found:no-task"
        } else {
            "opencode-discovery-unconfirmed:no-task"
        }
        return observation.report("probe-failed-unknown", false, "blocked", 0, reason)
    }
}

public func openCodeReadinessJson(report: AcpProviderReadiness, diagnosticSaved!: ?Bool = None): String {
    let result = JsonObject()
    result.put("peerId", JsonString("opencode"));
    result.put("environment", JsonString(report.environment))
    result.put("protocolReady",
        JsonBool(report.environment == "installed-usable" && report.verdict == "measured" && report.protocolVersion == 1));
    result.put("verdict", JsonString(report.verdict))
    result.put("protocolVersion", JsonInt(report.protocolVersion));
    result.put("evidence", JsonString(report.evidence))
    result.put("modelTaskTested", JsonBool(false))
    if (let Some(saved) <- diagnosticSaved) {
        result.put("diagnosticSaved", JsonBool(saved))
    }
    result.put("diagnostics", JsonValue.fromStr(report.observation.toJson()))
    return result.toString()
}

// 内置 OpenCode 插件适配器；只有可信装配代码能指定二进制和环境，RPC 不接受它们。
public class OpenCodeAcpProvider <: AcpProvider {
    let command: String
    let environment: Array<(String, String)>
    public init(command: String, environment!: Array<(String, String)> = []) {
        this.command = canonicalize(command).toString()
        this.environment = Array<(String, String)>(environment.size, {i => environment[i]})
    }
    public func peerId(): String {
        return "opencode"
    }
    public func open(workspace: String): AcpProcess {
        return AcpProcess(command, ["acp", "--log-level", "none"], workingDirectory: canonicalize(workspace),
            environment: openCodeMetadataEnvironment(environment, ""))
    }
    public func probe(workspace: String): AcpProviderReadiness {
        return probeWithToken(workspace, TurnToken())
    }
    public func probeWithToken(workspace: String, token: TurnToken): AcpProviderReadiness {
        if (token.cancelled()) {
            return AcpProtocolProvider("opencode", command, ["acp", "--log-level", "none"], authentication: {=> true},
                environment: environment).probeWithToken(workspace, token)
        }
        let metadata = OpenCodeProbeMetadata(workspace)
        try {
            let protocol = AcpProtocolProvider("opencode", command, ["acp", "--log-level", "none"],
                authentication: {=> true}, environment: metadata.environment(environment))
            let report = protocol.probeWithToken(workspace, token, diagnosticId: metadata.diagnosticId,
                observeSession: {value, session, cancellation => metadata.observe(value, session, cancellation)})
            return AcpProviderReadiness(report.environment, report.authenticated, report.verdict, report.protocolVersion,
                report.evidence +
                    ";configuration-owner=opencode;model-selection=provider-default;remote-model-not-tested",
                observation: report.observation.withExecutable(command))
        } finally {
            metadata.close()
        }
    }
}
