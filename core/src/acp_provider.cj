package core

import std.collection.*
import std.sync.*

public class AcpProviderReadiness {
    public let environment: String
    public let authenticated: Bool
    public let verdict: String
    public let protocolVersion: Int64
    public let evidence: String
    public let observation: AcpProbeObservation
    public init(environment: String, authenticated: Bool, verdict: String, protocolVersion: Int64, evidence: String,
        observation!: AcpProbeObservation = AcpProbeObservation()) {
        this.environment = environment
        this.authenticated = authenticated
        this.verdict = verdict
        this.protocolVersion = protocolVersion
        this.evidence = evidence
        this.observation = observation
    }
}

// 提供方由可信插件装配；probe 不发送任务，open 只构造尚未启动的传输。
public interface AcpProvider {
    func peerId(): String
    func probe(workspace: String): AcpProviderReadiness
    func open(workspace: String): AcpProcess
}

class AcpProviderRegistration {
    let owner: String
    let provider: AcpProvider
    let generation: Int64
    init(owner: String, provider: AcpProvider, generation: Int64) {
        this.owner = owner
        this.provider = provider
        this.generation = generation
    }
}

public class AcpProviders {
    let registered = HashMap<String, AcpProviderRegistration>()
    let mtx = Mutex()
    var generation: Int64 = 0
    public func register(owner: String, provider: AcpProvider): Bool {
        let peer = provider.peerId()
        if (owner.size == 0 || peer.size == 0 || peer.size > 256) {
            throw Exception("invalid-input:acp-provider")
        }
        mtx.lock()
        try {
            if (registered.contains(peer)) {
                return false
            }
            generation += 1
            registered[peer] = AcpProviderRegistration(owner, provider, generation)
            return true
        } finally {
            mtx.unlock()
        }
    }
    public func revoke(owner: String, peer: String): Bool {
        mtx.lock()
        try {
            if (let Some(entry) <- registered.get(peer)) {
                if (entry.owner != owner) {
                    throw Exception("not-authorized:acp-provider-owner")
                }
                registered.remove(peer);
                return true
            }
            return false
        } finally {
            mtx.unlock()
        }
    }
    func current(peer: String, expected: Int64): Bool {
        mtx.lock()
        try {
            if (let Some(entry) <- registered.get(peer)) {
                return entry.generation == expected
            }
            return false
        } finally {
            mtx.unlock()
        }
    }
    public func service(peer: String, workspace: String, settings: AcpSettingsService, log: SessionLog,
        lease: WriteLease, sessionId: String, settingsScope!: String = "user"): AcpDelegationService {
        if (settingsScope != "user" && settingsScope != "project") {
            throw Exception("invalid-input:acp-settings-scope")
        }
        if (!lease.protects(log.path) || log.isDurableFrozen()) {
            throw Exception("not-authorized:acp-provider-runtime-owner")
        }
        if (!settings.describe(settingsScope).enabled) {
            throw Exception("provider-unavailable:acp-disabled")
        }
        mtx.lock()
        let entry: AcpProviderRegistration
        try {
            if (!registered.contains(peer)) {
                throw Exception("provider-unavailable:acp-provider-not-registered")
            }
            entry = registered.get(peer).getOrThrow()
        } finally {
            mtx.unlock()
        }
        let report = entry.provider.probe(workspace)
        if (!acpEnvStateValid(report.environment) || !acpProbeVerdictValid(report.verdict) || report.protocolVersion != 1 ||
            report.evidence.size == 0 || report.environment != "installed-usable" || !report.authenticated ||
            report.verdict != "measured") {
            throw Exception("provider-unavailable:acp-provider-probe-not-ready")
        }
        if (!current(peer, entry.generation)) {
            throw Exception("provider-unavailable:acp-provider-revoked")
        }
        let gate = AcpGate(settings)
        gate.updateEnv(AcpEnvInput(peer, report.environment, report.authenticated))
        gate.updateProbe(AcpProbeInput(peer, report.verdict))
        let registry = this
        return AcpDelegationService(
            sessionId,
            gate,
            {
                wanted =>
                    if (wanted != peer || !registry.current(peer, entry.generation)) {
                        throw Exception("provider-unavailable:acp-provider-revoked")
                    }
                    let process = entry.provider.open(workspace)
                    if (process.alive()) {
                        throw Exception("not-authorized:acp-provider-prestarted-transfer")
                    }
                    process.bindProviderGate({=> registry.current(peer, entry.generation)})
                    return process
            },
            journal: Some(AcpDelegationJournal(log, lease, sessionId)),
            settingsScope: settingsScope
        )
    }
}
