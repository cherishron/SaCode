package core

// 公开装配只接受固定产品，不把提供方标识拼成任意程序或协议方法。
public func acpProviderEvent(base: String, peerId: String): String {
    if (peerId != "opencode" && peerId != "codebuddy") {
        throw Exception("provider-unavailable:acp-provider-not-registered")
    }
    return if (peerId == "opencode") {
        base
    } else {
        "${base}/codebuddy"
    }
}
