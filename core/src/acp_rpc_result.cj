package core
import stdx.encoding.json.*

func acpRpcResult(raw: String): JsonObject {
    let frame = acpDecodeInbound(raw)
    if (frame.kind != "response") { throw Exception("provider-unavailable:invalid-acp-response") }
    let obj = JsonValue.fromStr(raw).asObject()
    if (let Some(error) <- obj.get("error")) {
        let fields = error.asObject()
        let code = fields.get("code").getOrThrow().asInt().getValue()
        fields.get("message").getOrThrow().asString()
        throw Exception("provider-unavailable:acp-rpc-error:${code}")
    }
    return obj.get("result").getOrThrow().asObject()
}

public func acpValidateInitialization(raw: String) {
    let result = acpRpcResult(raw)
    if (result.get("protocolVersion").getOrThrow().asInt().getValue() != 1) {
        throw Exception("unsupported:acp-protocol-version")
    }
}

public func acpReadCreatedSession(raw: String): String {
    let session = acpRpcResult(raw).get("sessionId").getOrThrow().asString().getValue()
    if (session.size == 0) { throw Exception("provider-unavailable:empty-acp-session") }
    return session
}

public func acpSupportsSessionClose(raw: String): Bool {
    acpValidateInitialization(raw)
    let capabilities = acpRpcResult(raw).get("agentCapabilities").getOrThrow().asObject()
    if (let Some(session) <- capabilities.get("sessionCapabilities")) {
        if (let Some(close) <- session.asObject().get("close")) {
            close.asObject()
            return true
        }
    }
    return false
}
