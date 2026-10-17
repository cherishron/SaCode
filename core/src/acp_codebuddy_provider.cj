package core

import std.env.getVariable
import std.fs.*
import core.launch_context.currentProcessIntegrity

// 可信装配读取启动位置；页面与模型不能提供任意命令或启动参数。
func codeBuddyFromWindowsSearchPath(searchPath: String): String {
    for (entry in searchPath.split(";", removeEmpty: true)) {
        try {
            let directory = Path(entry.trimAscii())
            if (!directory.isAbsolute()) {
                continue
            }
            let executable = directory.join("codebuddy.exe")
            if (exists(executable) && !FileInfo(executable).isDirectory()) {
                return canonicalize(executable).toString()
            }
        } catch (_: Exception) {}
    }
    throw Exception("provider-unavailable:codebuddy-executable-not-configured")
}

public func configuredCodeBuddyExecutable(): String {
    let configured = getVariable("SACODE_ACP_CODEBUDDY_EXECUTABLE") ?? ""
    if (configured.size > 0) {
        return canonicalize(configured).toString()
    }
    return codeBuddyFromWindowsSearchPath(getVariable("PATH") ?? getVariable("Path") ?? "")
}

// 与 OpenCode 共用协议、审批和取消实现。认证只根据实际 ACP 回执判断；
// 不读取密钥、不执行登录、不更换模型，不注入跳过审批或沙箱的参数。
public class CodeBuddyAcpProvider <: AcpProvider {
    let command: String
    let environment: Array<(String, String)>
    public init(command: String, environment!: Array<(String, String)> = []) {
        if (command.size == 0) {
            throw Exception("invalid-input:codebuddy-command")
        }
        this.command = command
        this.environment = Array<(String, String)>(environment.size, {i => environment[i]})
    }
    public func peerId(): String {
        return "codebuddy"
    }
    public func open(workspace: String): AcpProcess {
        return AcpProcess(command, ["--acp"], workingDirectory: canonicalize(workspace), environment: environment)
    }
    public func probe(workspace: String): AcpProviderReadiness {
        return probeWithToken(workspace, TurnToken())
    }
    public func probeWithToken(workspace: String, token: TurnToken): AcpProviderReadiness {
        let report = AcpProtocolProvider("codebuddy", command, ["--acp"], authentication: {=> true},
            environment: environment).probeWithToken(workspace, token)
        return AcpProviderReadiness(report.environment, report.authenticated, report.verdict, report.protocolVersion,
            report.evidence + ";configuration-owner=codebuddy;model-selection=provider-default;remote-model-not-tested",
            observation: report.observation.withExecutable(command))
    }
}

public func probeConfiguredCodeBuddy(workspace: String, token: TurnToken,
    resolver!: () -> String = {=> configuredCodeBuddyExecutable()}): AcpProviderReadiness {
    var observation = AcpProbeObservation(diagnosticId: "acp-" + randomHex(16), workspace: workspace)
    if (token.cancelled()) {
        return observation.report("pending-verification", false, "pending-verification", 0,
            "probe-cancelled-before-start:no-task")
    }
    observation = observation.withProcessIntegrity(currentProcessIntegrity())
    try {
        let command = resolver()
        if (token.cancelled()) {
            return observation.report("pending-verification", false, "pending-verification", 0,
                "probe-cancelled-before-start:no-task")
        }
        if (!exists(command) || FileInfo(command).isDirectory()) {
            return observation.report("probe-failed-unknown", false, "blocked", 0,
                "codebuddy-executable-not-found:no-task")
        }
        return CodeBuddyAcpProvider(command).probeWithToken(workspace, token)
    } catch (e: Exception) {
        if (token.cancelled()) {
            return observation.report("pending-verification", false, "pending-verification", 0,
                "probe-cancelled-before-start:no-task")
        }
        let reason = if (e.message == "provider-unavailable:codebuddy-executable-not-configured") {
            "codebuddy-executable-not-found:no-task"
        } else {
            "codebuddy-discovery-unconfirmed:no-task"
        }
        return observation.report("probe-failed-unknown", false, "blocked", 0, reason)
    }
}
