package core

import std.net.*
import std.sync.*
import std.time.*
import stdx.net.http.Client

// 单次模型发现的控制面。取消/总预算与提交准入共锁，但锁内绝不进行网络或磁盘 IO。
// 超时标记阻止迟到写入；实际工作线程是否退出须由调用方独立登记，不能伪报已收束。
public class ModelCatalogRequest {
    let mtx = Mutex()
    let started = MonoTime.now()
    let budget: Int64
    var state = "running"
    var client: ?Client = None
    var socket: ?TcpSocket = None

    public init(timeoutMs: Int64) {
        if (timeoutMs < 100 || timeoutMs > 25000) {
            throw Exception("bad-model-pull-timeout")
        }
        budget = timeoutMs
    }

    public func elapsedMs(): Int64 {
        return (MonoTime.now() - started).toMilliseconds()
    }

    public func reason(): String {
        mtx.lock()
        try {
            if (state == "running" && elapsedMs() >= budget) {
                state = "timed-out"
            }
            return if (state == "timed-out") {
                "model-pull-deadline"
            } else if (state == "cancelled") {
                "model-pull-cancelled"
            } else {
                ""
            }
        } finally {
            mtx.unlock()
        }
    }

    public func checkpoint(): Unit {
        let stopped = reason()
        if (stopped.size > 0) {
            throw Exception(stopped)
        }
    }

    public func cancel(): Bool {
        mtx.lock()
        try {
            if (state != "running") {
                return false
            }
            state = if (elapsedMs() >= budget) {
                "timed-out"
            } else {
                "cancelled"
            }
            return state == "cancelled"
        } finally {
            mtx.unlock()
        }
    }

    public func beginCommit(): Unit {
        mtx.lock()
        try {
            if (state == "running" && elapsedMs() >= budget) {
                state = "timed-out"
            }
            if (state != "running") {
                throw Exception(if (state == "timed-out") {
                    "model-pull-deadline"
                } else {
                    "model-pull-cancelled"
                })
            }
            state = "committing"
        } finally {
            mtx.unlock()
        }
    }

    // 结束失败/成功准备阶段时冻结预算状态，不能让已完成的网络错误日后变成超时。
    public func finish(): String {
        mtx.lock()
        try {
            if (state == "running" && elapsedMs() >= budget) {
                state = "timed-out"
            }
            if (state == "running" || state == "committing") {
                state = "finished"
            }
            return if (state == "timed-out") {
                "model-pull-deadline"
            } else if (state == "cancelled") {
                "model-pull-cancelled"
            } else {
                ""
            }
        } finally {
            mtx.unlock()
        }
    }

    public func attachClient(value: Client): Unit {
        mtx.lock();
        client = Some(value)
        mtx.unlock()
        checkpoint()
    }

    public func connect(address: SocketAddress): StreamingSocket {
        checkpoint()
        let value = TcpSocket(address)
        mtx.lock();
        socket = Some(value)
        mtx.unlock()
        try {
            checkpoint()
            let remaining = max(Int64(1), budget - elapsedMs())
            value.connect(timeout: Duration.millisecond * remaining)
            checkpoint()
            return value
        } catch (e: Exception) {
            try {
                value.close()
            } catch (_: Exception) {}
            throw e
        }
    }

    // 先关原始 socket，使连接/TLS/读体都可被打断；再关请求独占 Client。
    public func closeNetwork(): Unit {
        mtx.lock()
        let currentSocket = socket
        let currentClient = client
        socket = None
        client = None
        mtx.unlock()
        if (let Some(value) <- currentSocket) {
            try {
                value.close()
            } catch (_: Exception) {}
        }
        if (let Some(value) <- currentClient) {
            try {
                value.close()
            } catch (_: Exception) {}
        }
    }
}
