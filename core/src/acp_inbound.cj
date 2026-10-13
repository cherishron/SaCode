package core
import std.collection.*
import std.sync.*
import stdx.encoding.json.*

// 服务端请求和通知与本机请求的回复使用独立队列，避免双向同号串单。
public class AcpInboundFrame {
    public let kind: String
    public let idJson: String
    public let method: String
    public let params: String
    public let raw: String
    public init(kind: String, idJson: String, method: String, params: String, raw: String) {
        this.kind = kind; this.idJson = idJson; this.method = method; this.params = params; this.raw = raw
    }
}

public func acpDecodeInbound(raw: String): AcpInboundFrame {
    if (raw.size > 65536) { throw Exception("acp-frame-too-large") }
    let obj = JsonValue.fromStr(raw).asObject()
    if (obj.get("jsonrpc").getOrThrow().asString().getValue() != "2.0") { throw Exception("acp-invalid-frame") }
    if (let Some(methodValue) <- obj.get("method")) {
        if (obj.get("result").isSome() || obj.get("error").isSome()) { throw Exception("acp-invalid-frame") }
        let method = methodValue.asString().getValue()
        if (method.size == 0) { throw Exception("acp-invalid-frame") }
        let params = obj.get("params").getOrThrow()
        params.asObject()
        if (let Some(id) <- obj.get("id")) {
            try { id.asInt() } catch (_: Exception) { id.asString() }
            return AcpInboundFrame("request", id.toString(), method, params.toString(), raw)
        }
        return AcpInboundFrame("notification", "", method, params.toString(), raw)
    }
    if (obj.get("result").isSome() == obj.get("error").isSome()) { throw Exception("acp-invalid-frame") }
    let id = obj.get("id").getOrThrow()
    id.asInt()
    return AcpInboundFrame("response", id.toString(), "", "", raw)
}

public class AcpInboundInbox {
    let frames = ArrayList<AcpInboundFrame>()
    let mtx = Mutex()
    let capacity: Int64
    public init(capacity!: Int64 = 128) {
        if (capacity < 1) { throw Exception("acp-invalid-inbox-capacity") }
        this.capacity = capacity
    }
    public func put(frame: AcpInboundFrame): Bool {
        if (frame.kind == "response") { return false }
        mtx.lock()
        try {
            if (frames.size >= capacity) { return false }
            frames.add(frame)
            return true
        } finally { mtx.unlock() }
    }
    public func take(): ?AcpInboundFrame {
        mtx.lock()
        try {
            if (frames.size == 0) { return None }
            return Some(frames.remove(at: 0))
        } finally { mtx.unlock() }
    }
}
