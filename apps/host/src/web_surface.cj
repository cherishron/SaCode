package host
import core.*
import stdx.encoding.json.*

// 网络搜索设置面（web_search / web_fetch 的启用、提供方与密钥）：
//   web/settings/describe        读快照 + 每个提供方的默认值与凭据状态；值一律只谈「配置了没有」，
//                                读面没有任何槽位能带出密钥本体（凭据状态只取自 CredentialInfo）。
//   web/settings/apply           单文档写入：修订号走核心屏障（expectedRevision），键位白名单在
//                                web_settings.cj 复核；本文件只做参数形状收口。
//   web/settings/set-credential  独立密钥通道：值写进 CredentialStore（env 供值的引用只读），
//                                密钥永不进入设置文件。
// 错误只发稳定原因：形状/取值错 -32602，修订冲突 web-settings-conflict，环境供值只读
// web-credential-read-only；其余落 web-settings-unavailable / web-credential-store-unreadable，
// 不回传内部路径。

func webSettingsViewJson(settings: WebSettings, credentials: CredentialStore): String {
    let snapshot = settings.snapshot()
    let object = JsonObject()
    object.put("revision", JsonInt(snapshot.revision)); object.put("enabled", JsonBool(snapshot.enabled))
    object.put("selectedProvider", JsonString(snapshot.selectedProvider))
    let rows = JsonArray()
    for (provider in snapshot.providers) {
        let row = provider.toJsonValue()
        // 默认值由核心构造器给出：界面判断「已覆盖」不能自己再抄一份默认表，否则默认值一改两边就漂。
        let defaults = WebProviderSettings(provider.id)
        let defaultsObject = JsonObject()
        defaultsObject.put("endpoint", JsonString(defaults.endpoint)); defaultsObject.put("maxUses", JsonInt(defaults.maxUses))
        row.put("defaults", defaultsObject)
        let info = credentials.describe(provider.credentialRef)
        let credential = JsonObject()
        credential.put("configured", JsonBool(info.configured)); credential.put("writable", JsonBool(info.writable))
        row.put("credential", credential)
        rows.add(row)
    }
    object.put("providers", rows)
    return object.toString()
}

func webSurfaceRequest(method: String, body: String, idText: String): Unit {
    try {
        let settings = WebSettings.forUser()
        let credentials = CredentialStore.forUser()
        if (method == "web/settings/describe") {
            emit(okFrame(idText, webSettingsViewJson(settings, credentials)))
            return
        }
        if (method == "web/settings/apply") {
            let document = JsonObject()
            try {
                let params = JsonValue.fromStr(paramsTextOf(body)).asObject()
                if (params.size() != 2) { throw Exception("shape") }
                let revision = params.get("expectedRevision").getOrThrow().asInt().getValue()
                if (revision < 0) { throw Exception("revision") }
                let patch = params.get("patch").getOrThrow().asObject()
                // revision 只能由本面注入：补丁里再带一个会让「屏障比的是谁」说不清。
                if (patch.get("revision").isSome()) { throw Exception("revision-key") }
                document.put("revision", JsonInt(revision))
                for ((key, value) in patch.getFields()) { document.put(key, value) }
            } catch (_: Exception) { throw Exception("bad-web-settings-params") }
            settings.updateJson(document.toString())
            emit(okFrame(idText, webSettingsViewJson(settings, credentials)))
            return
        }
        if (method == "web/settings/set-credential") {
            let providers = settings.snapshot().providers
            var reference = ""
            var secret = ""
            try {
                let params = JsonValue.fromStr(paramsTextOf(body)).asObject()
                if (params.size() != 2) { throw Exception("shape") }
                let providerId = params.get("providerId").getOrThrow().asString().getValue()
                secret = params.get("key").getOrThrow().asString().getValue()
                // 空值不当作「清除」：清除应该是另一个动作，别让空输入顺手抹掉可用配置。
                if (secret.size == 0 || secret.size > 8192) { throw Exception("key") }
                for (provider in providers) {
                    if (provider.id == providerId) { reference = provider.credentialRef }
                }
                if (reference.size == 0) { throw Exception("unknown") }
            } catch (_: Exception) { throw Exception("bad-web-credential-params") }
            credentials.set(reference, secret)
            emit(okFrame(idText, webSettingsViewJson(settings, credentials)))
            return
        }
    } catch (e: Exception) {
        if (e.message == "web-settings-revision-conflict") {
            emit(errFrame(idText, -32031, "web-settings-conflict"))
        } else if (e.message == "credential-read-only") {
            emit(errFrame(idText, -32030, "web-credential-read-only"))
        } else if (e.message == "credential-store-unreadable") {
            emit(errFrame(idText, -32030, "web-credential-store-unreadable"))
        } else if (e.message == "web-settings-home-missing") {
            emit(errFrame(idText, -32030, "web-settings-unavailable"))
        } else if (e.message.startsWith("bad-web") || e.message.startsWith("web-") || e.message.startsWith("bad-credential")) {
            emit(errFrame(idText, -32602, e.message))
        } else {
            emit(errFrame(idText, -32030, "web-settings-unavailable"))
        }
    }
}
