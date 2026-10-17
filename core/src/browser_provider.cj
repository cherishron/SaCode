package core

import std.fs.*
import std.sync.*

// 浏览器 provider 子进程的 NDJSON JSON-RPC 客户端。
// 复用 ExtProcess 的 spawn/帧读写模式，驱动 Node 浏览器 provider。
// 核心不持有 Playwright 对象，只经 NDJSON 请求/响应与 provider 通信。

public class BrowserProviderResult {
    public let ok: Bool
    public let verb: String
    public let content: String
    public let exitCode: Int64
    public let failureKind: String
    public let message: String

    public init(ok: Bool, verb: String, content: String, exitCode: Int64,
                failureKind: String, message: String) {
        this.ok = ok
        this.verb = verb
        this.content = content
        this.exitCode = exitCode
        this.failureKind = failureKind
        this.message = message
    }
}

public class BrowserProviderClient {
    let proc: ExtProcess
    let idCounter = AtomicInt64(0)
    var started = false

    public init(command: String, arguments: Array<String>, workingDirectory!: Path) {
        this.proc = ExtProcess(command, arguments, workingDirectory: workingDirectory)
    }

    public func start(): Bool {
        started = proc.start()
        return started
    }

    public func invoke(verb: String, args: String,
                       token!: TurnToken = TurnToken(), timeoutMs!: Int64 = 30000): BrowserProviderResult {
        if (token.cancelled()) {
            return BrowserProviderResult(false, verb, "", Int64(-1), "cancelled", "browser-cancelled")
        }
        if (!started || !proc.alive()) {
            return BrowserProviderResult(false, verb, "", Int64(-1), "provider-not-alive", "browser-provider-not-started")
        }
        let id = idCounter.fetchAdd(1) + Int64(1)
        let params = "{\"verb\":\"${verb}\",\"args\":${args}}"
        let reply = proc.request(id, "browser/invoke", params, timeoutMs: timeoutMs)
        if (let Some(body) <- reply) {
            let ok = body.contains("\"ok\":true")
            if (ok) {
                return BrowserProviderResult(true, verb, body, Int64(0), "", "")
            } else {
                return BrowserProviderResult(false, verb, body, Int64(-1), "provider-error", body)
            }
        }
        return BrowserProviderResult(false, verb, "", Int64(-1), "timeout", "browser-provider-timeout")
    }

    public func close(): Int64 {
        return proc.close()
    }
}