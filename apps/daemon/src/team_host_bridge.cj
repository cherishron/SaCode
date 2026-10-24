package daemon

import core.*
import std.collection.ArrayList
import std.sync.*

// 团队面的传输与准入层：进程、写锁、应答配对全部复用 HostProxyBridge 的同一个
// 宿主。曾经这里自起第二个宿主，两条持久阻塞的 stdout 读线程在 2 vCPU 上各占
// 一个原生调度线程，HTTP 处理器被饿死——session/create 的应答读到了却发不出去。
// 团队身份、审批及持久状态均由同一个仓颉 Host 裁决，这一层只做三件事：
// 能力过滤、在途上限（16）与团队错误语义（超时措辞）。
let TEAM_METHODS = ["team/describe", "team/member/create", "team/message/send",
    "team/message/broadcast", "team/task/create", "team/task/assign", "team/task/claim",
    "team/task/complete", "team/member/stop", "team/approval/answer"]

func acceptsTeamMethod(method: String): Bool {
    for (name in TEAM_METHODS) { if (name == method) { return true } }
    return false
}

class TeamHostBridge {
    let proxy: HostProxyBridge
    // 保护单例启动与能力清单，不在等待业务应答时持锁。
    let lifecycle = Mutex()
    let inflight = AtomicInt64(0)
    var started = false
    let availableMethods = ArrayList<String>()

    public init(proxy: HostProxyBridge) {
        this.proxy = proxy
    }

    public func configured(): Bool { proxy.configured() }

    // 共享宿主的 initialize 只做一次；宿主没声明 team/describe 时抛
    // team-host-capability-unavailable——调用方据此保留会话面、不宣称团队面，
    // 不把这个结果缓存成永久失败（宿主本身仍可用于会话转发）。
    public func ensureStarted(): Unit {
        synchronized(lifecycle) {
            if (started) { return }
            if (!configured()) { throw Exception("SACODE_HOST is not configured") }
            let caps = proxy.ensureInitialized()
            var teamAvailable = false
            for (name in caps) {
                if (name == "team/describe") { teamAvailable = true }
                if ((acceptsTeamMethod(name) || forwarded(name)) && !availableMethods.contains(name)) {
                    availableMethods.add(name)
                }
            }
            if (teamAvailable && !availableMethods.contains("team/approval/answer")) {
                availableMethods.add("team/approval/answer")
            }
            if (!teamAvailable) { throw Exception("team-host-capability-unavailable") }
            started = true
        }
    }

    public func capabilities(): ArrayList<String> {
        ensureStarted()
        return synchronized(lifecycle) {
            let result = ArrayList<String>()
            for (name in availableMethods) { result.add(name) }
            result
        }
    }

    public func forward(method: String, params: String, clientId: String): String {
        if (!acceptsTeamMethod(method) && !forwarded(method)) { return errRpc(clientId, -32601, "method not found") }
        if (!hostParamsOk(params)) { return errRpc(clientId, -32602, "参数必须是 JSON 对象") }
        ensureStarted()
        synchronized(lifecycle) {
            if (!availableMethods.contains(method)) { throw Exception("host-method-unavailable") }
        }
        if (inflight.fetchAdd(1) >= 16) {
            inflight.fetchSub(1)
            throw Exception("team-host-too-many-inflight")
        }
        try {
            return proxy.requestTeam(method, params, clientId, 5000)
        } catch (e: Exception) {
            // 代理层的 host-timeout 含义是「请求已发出、结果未知」，团队面沿用原措辞；
            // 其余失败（宿主退出/未配置）原样抛，由分派层归 -32003。
            if (e.message == "host-timeout") { throw Exception("team-host-reply-timeout; outcome unknown") }
            throw e
        } finally { inflight.fetchSub(1) }
    }
}
