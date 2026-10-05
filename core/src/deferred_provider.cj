package core
import std.io.*

// 提供商的网络初始化推迟到执行线程的首次 next；协议线程不能等待 HTTP 响应头。
public class DeferredProvider <: Provider & Resource {
    let makeProvider: () -> Provider
    let token: TurnToken
    var value: ?Provider = None
    var closed = false
    public init(makeProvider: () -> Provider, token: TurnToken) {
        this.makeProvider = makeProvider
        this.token = token
    }
    public func next(): ?Chunk {
        if (closed || token.cancelled()) { close(); return None }
        if (value.isNone()) {
            try { value = Some(makeProvider()) }
            catch (e: Exception) { closed = true; throw e }
        }
        return value.getOrThrow().next()
    }
    public func close(): Unit {
        if (closed) { return }
        closed = true
        if (let Some(provider) <- value) {
            if (let Some(resource) <- (provider as Resource)) { resource.close() }
        }
    }
    public func isClosed(): Bool { return closed }
}
