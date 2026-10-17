package core
import std.collection.HashMap

// ACP 两层门控状态机（design §2.6.2）。
// L1 可开启 = 开关有效值 + 环境探测/安装结论（REQ-E-09）。
// L2 可委派 = L1 通过 + initialize 能力协商 + 协议探针 + 认证就绪。
// 两层分别记录、分别门控、互不替代：可开启 ≠ 可委派（spec §10.4）。

// 门控状态快照
public class AcpGateStatus {
    public let canEnable: Bool
    public let canEnableReason: String
    public let canDelegate: Bool
    public let canDelegateReason: String
    public let effectiveSwitch: String    // "on" / "off"
    public let switchSource: String       // "user" / "project" / "default"

    public init(canEnable: Bool, canEnableReason: String,
        canDelegate: Bool, canDelegateReason: String,
        effectiveSwitch: String, switchSource: String) {
        this.canEnable = canEnable
        this.canEnableReason = canEnableReason
        this.canDelegate = canDelegate
        this.canDelegateReason = canDelegateReason
        this.effectiveSwitch = effectiveSwitch
        this.switchSource = switchSource
    }
}

// 产品环境探测结论（由 AcpEnvProbe 填充，此处只读消费）
public class AcpEnvInput {
    public let peerId: String
    public let envState: String    // acpEnvStates 闭集成员
    public let authReady: Bool
    public init(peerId: String, envState: String, authReady: Bool) {
        this.peerId = peerId
        this.envState = envState
        this.authReady = authReady
    }
}

// 协议探针结论（由 AcpProtocolProbe 填充，此处只读消费）
public class AcpProbeInput {
    public let peerId: String
    public let verdict: String      // acpProbeVerdicts 闭集成员
    public init(peerId: String, verdict: String) {
        this.peerId = peerId
        this.verdict = verdict
    }
}

public class AcpGate {
    let settings: AcpSettingsService
    var envInputs = HashMap<String, AcpEnvInput>()
    var probeInputs = HashMap<String, AcpProbeInput>()

    public init(settings: AcpSettingsService) {
        this.settings = settings
    }

    // 更新某产品的环境探测结论
    public func updateEnv(input: AcpEnvInput) {
        envInputs[input.peerId] = input
    }

    // 更新某产品的协议探针结论
    public func updateProbe(input: AcpProbeInput) {
        probeInputs[input.peerId] = input
    }

    // L1 门控状态：开关 + 环境探测
    public func status(scope: String): AcpGateStatus {
        let snap = settings.describe(scope)
        let switchOn = snap.enabled

        // L1: 可否开启
        var canEnable = false
        var canEnableReason = ""
        if (!switchOn) {
            canEnable = false
            canEnableReason = "acp-switch-off"
        } else {
            // 开关已开：检查是否有任意已安装可用的产品
            var anyUsable = false
            var anyReason = ""
            for ((peerId, env) in envInputs) {
                if (env.envState == "installed-usable") {
                    anyUsable = true
                } else if (env.envState == "not-installed") {
                    anyReason = "${peerId}:not-installed"
                } else if (env.envState == "installed-auth-missing") {
                    anyReason = "${peerId}:auth-missing"
                } else if (env.envState == "entry-unsupported") {
                    anyReason = "${peerId}:entry-unsupported"
                } else if (env.envState == "pending-verification") {
                    anyReason = "${peerId}:pending-verification"
                }
            }
            if (anyUsable) {
                canEnable = true
                canEnableReason = "env-ok"
            } else {
                canEnable = false
                if (anyReason.size > 0) {
                    canEnableReason = "no-product-available:${anyReason}"
                } else {
                    canEnableReason = "no-product-available"
                }
            }
        }

        // L2: 可否委派（对所有产品整体判断）
        // L2 只在 L1 通过后才有意义
        var canDelegate = false
        var canDelegateReason = ""
        if (!canEnable) {
            canDelegate = false
            canDelegateReason = "l1-not-passed:" + canEnableReason
        } else {
            // 检查是否有任意产品探针通过 + 认证就绪
            var anyDelegatable = false
            for ((peerId, env) in envInputs) {
                if (env.envState == "installed-usable" && env.authReady) {
                    if (let Some(probe) <- probeInputs.get(peerId)) {
                        if (probe.verdict == "measured") {
                            anyDelegatable = true
                        } else {
                            canDelegateReason = "${peerId}:probe-${probe.verdict}"
                        }
                    } else {
                        canDelegateReason = "${peerId}:probe-not-done"
                    }
                } else if (env.envState == "installed-usable" && !env.authReady) {
                    canDelegateReason = "${peerId}:auth-not-ready"
                }
            }
            if (anyDelegatable) {
                canDelegate = true
                canDelegateReason = "l2-ok"
            } else {
                if (canDelegateReason.size == 0) {
                    canDelegateReason = "no-delegatable-product"
                }
            }
        }

        return AcpGateStatus(canEnable, canEnableReason,
            canDelegate, canDelegateReason,
            snap.effective, snap.source)
    }

    // 检查某特定产品可否委派
    public func statusForPeer(scope: String, peerId: String): AcpGateStatus {
        let snap = settings.describe(scope)
        let switchOn = snap.enabled

        var canEnable = false
        var canEnableReason = ""
        if (!switchOn) {
            canEnable = false
            canEnableReason = "acp-switch-off"
        } else if (let Some(env) <- envInputs.get(peerId)) {
            if (env.envState == "installed-usable") {
                canEnable = true
                canEnableReason = "env-ok"
            } else {
                canEnable = false
                canEnableReason = "env:${env.envState}"
            }
        } else {
            canEnable = false
            canEnableReason = "env:not-probed"
        }

        var canDelegate = false
        var canDelegateReason = ""
        if (!canEnable) {
            canDelegate = false
            canDelegateReason = "l1-not-passed:" + canEnableReason
        } else if (let Some(env) <- envInputs.get(peerId)) {
            if (!env.authReady) {
                canDelegate = false
                canDelegateReason = "auth-not-ready"
            } else if (let Some(probe) <- probeInputs.get(peerId)) {
                if (probe.verdict == "measured") {
                    canDelegate = true
                    canDelegateReason = "l2-ok"
                } else {
                    canDelegate = false
                    canDelegateReason = "probe:${probe.verdict}"
                }
            } else {
                canDelegate = false
                canDelegateReason = "probe:not-done"
            }
        } else {
            canDelegate = false
            canDelegateReason = "env:not-probed"
        }

        return AcpGateStatus(canEnable, canEnableReason,
            canDelegate, canDelegateReason,
            snap.effective, snap.source)
    }

    // 门控未过时抛异常（用于委派入口前置检查）
    public func requireCanEnable(scope: String): Unit {
        let s = status(scope)
        if (!s.canEnable) {
            throw Exception("unsupported:${s.canEnableReason}")
        }
    }

    // 某产品委派门控未过时抛异常
    public func requireCanDelegate(scope: String, peerId: String): Unit {
        let s = statusForPeer(scope, peerId)
        if (!s.canDelegate) {
            throw Exception("provider-unavailable:${s.canDelegateReason}")
        }
    }
}