package core

import std.fs.*

// 命令和认证探针只由可信插件构造，不解析页面或模型传入的启动向量。
public class AcpProtocolProvider <: AcpProvider {
    let peer: String
    let command: String
    let arguments: Array<String>
    let authentication: () -> Bool
    let environment: Array<(String, String)>
    public init(peer: String, command: String, arguments: Array<String>, authentication!: () -> Bool = {=> false},
        environment!: Array<(String, String)> = []) {
        if (peer.size == 0 || command.size == 0) {
            throw Exception("invalid-input:acp-protocol-provider")
        }
        this.peer = peer
        this.command = command
        this.arguments = Array<String>(arguments.size, {i => arguments[i]})
        this.authentication = authentication
        this.environment = Array<(String, String)>(environment.size, {i => environment[i]})
    }
    public func peerId(): String {
        return peer
    }
    public func open(workspace: String): AcpProcess {
        return AcpProcess(command, arguments, workingDirectory: canonicalize(workspace), environment: environment)
    }
    public func probe(workspace: String): AcpProviderReadiness {
        if (!authentication()) {
            return AcpProviderReadiness("installed-auth-missing", false, "pending-verification", 0,
                "authentication-not-verified")
        }
        let process = open(workspace)
        try {
            if (!process.start()) {
                return AcpProviderReadiness("probe-failed-unknown", false, "blocked", 0, "transport-start-failed")
            }
            let initialization = process.acpInitialize(1, "sacode-probe", "0.1.0").getOrThrow()
            acpValidateInitialization(initialization)
            let session = acpReadCreatedSession(process.sessionNew(workspace).getOrThrow())
            if (session.size == 0) {
                throw Exception("invalid-acp-probe-session")
            }
            process.kill()
            if (!process.exitObserved()) {
                return AcpProviderReadiness("probe-failed-unknown", false, "blocked", 1,
                    "probe-process-exit-unconfirmed")
            }
            return AcpProviderReadiness("installed-usable", true, "measured", 1,
                "initialize-and-session-new-observed:no-task")
        } catch (_: Exception) {
            process.kill()
            return AcpProviderReadiness("probe-failed-unknown", false, "blocked", 0, "protocol-probe-unconfirmed")
        }
    }
}
