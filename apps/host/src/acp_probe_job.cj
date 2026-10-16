package host

import core.*
import std.sync.*

// 仅托管无 prompt 的只读协议探测，不是修复执行器或第二套任务队列。
class HostAcpProbe {
    let mtx = Mutex()
    var accepting = true
    var running = false
    var settled = true
    var token: ?TurnToken = None
    var worker: ?Future<Unit> = None
    var peer = ""

    func start(workspace: String, rpcId: String, peerId!: String = "opencode",
        record!: (AcpProviderReadiness, TurnToken) -> Bool = {_, _ => false}) {
        mtx.lock()
        try {
            acpProviderEvent("acp/diagnostic", peerId)
            if (!accepting) {
                throw Exception("acp-probe-shutting-down")
            }
            if (!settled && !running) {
                throw Exception("acp-probe-unsettled")
            }
            if (running) {
                throw Exception("acp-probe-in-flight")
            }
            let cancellation = TurnToken()
            token = Some(cancellation)
            running = true
            settled = false
            peer = peerId
            let state = this
            worker = Some(spawn {
                => try {
                    let result = if (peerId == "codebuddy") {
                        probeConfiguredCodeBuddy(workspace, cancellation)
                    } else {
                        probeConfiguredOpenCode(workspace, cancellation)
                    }
                    state.mtx.lock()
                    state.settled = !result.evidence.contains("probe-process-exit-unconfirmed")
                    state.mtx.unlock()
                    let saved = record(result, cancellation)
                    emit(okFrame(rpcId, acpReadinessJson(peerId, result, diagnosticSaved: Some(saved))))
                } catch (_: Exception) {
                    try {
                        emit(errFrame(rpcId, -32027, "acp-probe-result-unconfirmed"))
                    } catch (_: Exception) {}
                } finally {
                    state.mtx.lock();
                    state.running = false
                    state.mtx.unlock()
                }
            })
        } finally {
            mtx.unlock()
        }
    }
    func cancel(peerId!: String = "") {
        mtx.lock()
        try {
            if (peerId.size > 0 && peerId != peer) {
                return
            }
            if (let Some(current) <- token) {
                current.cancel()
            }
        } finally {
            mtx.unlock()
        }
    }
    func shutdown(): Bool {
        mtx.lock()
        accepting = false
        if (let Some(current) <- token) {
            current.cancel()
        }
        let currentWorker = worker
        mtx.unlock()
        if (let Some(current) <- currentWorker) {
            try {
                current.get(8000 * Duration.millisecond)
            } catch (_: Exception) {
                return false
            }
        }
        mtx.lock()
        try {
            return settled && !running
        } finally {
            mtx.unlock()
        }
    }
}
