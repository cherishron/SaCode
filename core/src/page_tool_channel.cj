package core

import std.collection.*
import std.sync.*
import stdx.encoding.json.*

class PageToolPending {
    let request: PageToolRequest
    var dispatched = false
    var reply: ?PageToolReply = None
    init(request: PageToolRequest) {
        this.request = request
    }
}
// 提供方传输只接受核心已经登记的请求；页面不能凭名字创建执行许可。
public class PageToolChannel <: PageToolProvider {
    public let sessionId: String
    let pending = HashMap<String, PageToolPending>()
    let mtx = Mutex()
    public init(sessionId: String) {
        this.sessionId = sessionId
    }
    public func execute(request: PageToolRequest): PageToolReply {
        if (request.sessionId != sessionId || request.token.cancelled()) {
            throw Exception("page-request-not-owned")
        }
        mtx.lock()
        try {
            if (pending.size >= 32 || pending.contains(request.requestId)) {
                throw Exception("page-channel-capacity")
            }
            pending[request.requestId] = PageToolPending(request)
        } finally {
            mtx.unlock()
        }
        try {
            let clock = monotonicSeconds()
            let deadline = clock() + 30
            for (_ in 0..1200) {
                if (request.token.cancelled()) {
                    throw Exception("page-request-cancelled")
                }
                mtx.lock()
                let reply: ?PageToolReply
                try {
                    reply = pending.get(request.requestId).getOrThrow().reply
                } finally {
                    mtx.unlock()
                }
                if (let Some(result) <- reply) {
                    return result
                }
                if (clock() >= deadline) {
                    break
                }
                sleep(25 * Duration.millisecond)
            }
            throw Exception("page-reply-timeout")
        } finally {
            mtx.lock();
            pending.remove(request.requestId);
            mtx.unlock()
        }
    }
    public func queued(): Array<PageToolRequest> {
        mtx.lock()
        try {
            let out = ArrayList<PageToolRequest>()
            for ((_, entry) in pending) {
                if (!entry.dispatched && !entry.request.token.cancelled()) {
                    out.add(entry.request)
                }
            }
            return out.toArray()
        } finally {
            mtx.unlock()
        }
    }
    public func peek(requestId: String): PageToolRequest {
        mtx.lock()
        try {
            let entry = pending.get(requestId).getOrThrow()
            if (entry.dispatched || entry.request.token.cancelled()) {
                throw Exception("page-request-not-dispatchable")
            }
            return entry.request
        } finally {
            mtx.unlock()
        }
    }
    public func claim(requestId: String): Bool {
        mtx.lock()
        try {
            if (let Some(entry) <- pending.get(requestId)) {
                if (entry.dispatched || entry.request.token.cancelled()) {
                    return false
                }
                entry.dispatched = true
                return true
            }
            return false
        } finally {
            mtx.unlock()
        }
    }
    public func deliver(session: String, requestId: String, result: String): Bool {
        if (session != sessionId || result.size > 65536) {
            return false
        }
        JsonValue.fromStr(result).asObject()
        mtx.lock()
        try {
            if (let Some(entry) <- pending.get(requestId)) {
                if (!entry.dispatched || entry.reply.isSome() || entry.request.token.cancelled()) {
                    return false
                }
                entry.reply = Some(PageToolReply(session, requestId, result))
                return true
            }
            return false
        } finally {
            mtx.unlock()
        }
    }
    public func cancel() {
        mtx.lock()
        try {
            for ((_, entry) in pending) {
                entry.request.token.cancel()
            }
        } finally {
            mtx.unlock()
        }
    }
}
