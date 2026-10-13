package core
import std.collection.*
import std.sync.*
import stdx.encoding.json.*

// 外部权限提案按未知工具处理：Plan 拒绝，其余模式仍须精确的一次性工单。
func acpPermissionPolicyAllows(log: SessionLog): Bool {
    try { return PermissionPolicy().decide(ModeController(log).current(), "acp/permission") != "deny" }
    catch (_: Exception) { return false }
}

public class AcpPermissionOption {
    public let id: String
    public let kind: String
    public init(id: String, kind: String) { this.id = id; this.kind = kind }
}

public class AcpWirePermission {
    public let frame: AcpInboundFrame
    public let session: String
    public let toolCallId: String
    public let options: Array<AcpPermissionOption>
    public init(frame: AcpInboundFrame, session: String, toolCallId: String, options: Array<AcpPermissionOption>) {
        this.frame = frame; this.session = session; this.toolCallId = toolCallId; this.options = options
    }
}

public func acpReadWirePermission(frame: AcpInboundFrame): AcpWirePermission {
    let parsed = acpDecodeInbound(frame.raw, generation: frame.generation)
    if (parsed.kind != "request" || parsed.method != "session/request_permission" || parsed.idJson != frame.idJson) { throw Exception("invalid-acp-permission-frame") }
    let params = JsonValue.fromStr(parsed.params).asObject()
    let session = params.get("sessionId").getOrThrow().asString().getValue()
    let tool = params.get("toolCall").getOrThrow().asObject().get("toolCallId").getOrThrow().asString().getValue()
    if (session.size == 0 || tool.size == 0) { throw Exception("invalid-acp-permission-identity") }
    let options = params.get("options").getOrThrow().asArray()
    if (options.size() == 0 || options.size() > 32) { throw Exception("invalid-acp-permission-options") }
    let ids = HashSet<String>()
    let out = ArrayList<AcpPermissionOption>()
    for (i in 0..options.size()) {
        let option = options.get(i).getOrThrow().asObject()
        let id = option.get("optionId").getOrThrow().asString().getValue()
        let name = option.get("name").getOrThrow().asString().getValue()
        let kind = option.get("kind").getOrThrow().asString().getValue()
        if (id.size == 0 || name.size == 0 || ids.contains(id) || (kind != "allow_once" && kind != "allow_always" && kind != "reject_once" && kind != "reject_always")) { throw Exception("invalid-acp-permission-options") }
        ids.add(id); out.add(AcpPermissionOption(id, kind))
    }
    return AcpWirePermission(parsed, session, tool, out.toArray())
}

public func acpWirePermissionOutcome(permission: AcpWirePermission, decision: String, optionId: String): String {
    if (decision == "cancelled" && optionId.size == 0) { return "{\"outcome\":{\"outcome\":\"cancelled\"}}" }
    let required = if (decision == "allowed-once") { "allow_once" } else if (decision == "denied") { "reject_once" } else { "" }
    if (required.size > 0) {
        for (option in permission.options) {
            if (option.id == optionId && option.kind == required) {
                return "{\"outcome\":{\"outcome\":\"selected\",\"optionId\":\"${jsonEscapeText(optionId)}\"}}"
            }
        }
    }
    throw Exception("invalid-acp-permission-selection")
}

// 请求代际、ID、原始提案共同绑定。写失败也消费，绝不自动重发副作用授权。
public class AcpPermissionReplies {
    let pending = HashMap<String, AcpInboundFrame>()
    let mtx = Mutex()
    var generation: Int64 = 0
    public func reset(value: Int64) {
        mtx.lock()
        try { generation = value; pending.clear() } finally { mtx.unlock() }
    }
    public func register(frame: AcpInboundFrame): Bool {
        mtx.lock()
        try {
            if (frame.kind != "request" || frame.method != "session/request_permission" || frame.generation != generation || pending.contains(frame.idJson) || pending.size >= 128) { return false }
            pending[frame.idJson] = frame
            return true
        } finally { mtx.unlock() }
    }
    public func containsExact(frame: AcpInboundFrame): Bool {
        mtx.lock()
        try {
            if (let Some(saved) <- pending.get(frame.idJson)) { return generation == frame.generation && saved.generation == frame.generation && saved.raw == frame.raw }
            return false
        } finally { mtx.unlock() }
    }
    public func discard(frame: AcpInboundFrame) {
        mtx.lock()
        try {
            if (let Some(saved) <- pending.get(frame.idJson)) {
                if (saved.generation == frame.generation && saved.raw == frame.raw) { pending.remove(frame.idJson) }
            }
        } finally { mtx.unlock() }
    }
    public func deliverExact(frame: AcpInboundFrame, authorize: () -> Bool, send: () -> Bool): Bool {
        mtx.lock()
        try {
            if (let Some(saved) <- pending.get(frame.idJson)) {
                if (generation != frame.generation || saved.generation != frame.generation || saved.raw != frame.raw) { return false }
                if (!authorize()) { return false }
                pending.remove(frame.idJson)
            } else { return false }
        } finally { mtx.unlock() }
        // 管道I/O不占登记锁，防止读线程回压与回传写互相阻塞。
        return send()
    }
}
