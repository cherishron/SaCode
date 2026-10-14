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
        return probeWithToken(workspace, TurnToken())
    }
    // 取消只传令牌，由探测线程独占启动、等待及回收，不跨线程操作进程生命周期。
    public func probeWithToken(workspace: String, token: TurnToken): AcpProviderReadiness {
        if (token.cancelled()) {
            return AcpProviderReadiness("pending-verification", false, "pending-verification", 0,
                "probe-cancelled-before-start:no-task")
        }
        if (!authentication()) {
            return AcpProviderReadiness("installed-auth-missing", false, "pending-verification", 0,
                "authentication-not-verified")
        }
        let process = open(workspace)
        var stage = "initialize"
        var version: Int64 = 0
        try {
            if (token.cancelled()) {
                throw Exception("acp-probe-cancelled")
            }
            if (!process.start()) {
                return AcpProviderReadiness("probe-failed-unknown", false, "blocked", 0, "transport-start-failed")
            }
            let initialization = process.acpInitialize(1, "sacode-probe", "0.1.0", token: token).getOrThrow()
            acpValidateInitialization(initialization)
            version = 1
            stage = "session-new"
            if (token.cancelled()) {
                throw Exception("acp-probe-cancelled")
            }
            let session = acpReadCreatedSession(process.sessionNew(workspace, token: token).getOrThrow())
            if (token.cancelled()) {
                throw Exception("acp-probe-cancelled")
            }
            if (session.size == 0) {
                throw Exception("invalid-acp-probe-session")
            }
            process.kill()
            if (!process.exitObserved()) {
                return AcpProviderReadiness("probe-failed-unknown", false, "blocked", 1,
                    "probe-process-exit-unconfirmed")
            }
            if (token.cancelled()) {
                return AcpProviderReadiness("pending-verification", false, "pending-verification", version,
                    "probe-cancelled:no-task")
            }
            return AcpProviderReadiness("installed-usable", true, "measured", 1,
                "initialize-and-session-new-observed:no-task")
        } catch (e: Exception) {
            process.kill()
            if (!process.exitObserved()) {
                return AcpProviderReadiness("probe-failed-unknown", false, "blocked", 0,
                    "probe-process-exit-unconfirmed")
            }
            if (token.cancelled()) {
                return AcpProviderReadiness("pending-verification", false, "pending-verification", version,
                    "probe-cancelled:no-task")
            }
            // ACP v1 的 -32000 才是认证要求；超时、日志和其他失败不冒充认证错误。
            if (e.message == "provider-unavailable:acp-rpc-error:-32000") {
                return AcpProviderReadiness("installed-auth-missing", false, "blocked", 1, "acp-auth-required:no-task")
            }
            return AcpProviderReadiness("probe-failed-unknown", false, "blocked", version,
                "protocol-${stage}-unconfirmed:no-task")
        }
    }
}
