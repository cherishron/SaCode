package host
import core.*
import stdx.encoding.json.*

func providerCatalogInstanceRequest(body: String, idText: String): Unit {
    var catalogId = ""
    var revision = Int64(-1)
    try {
        let params = JsonValue.fromStr(body).asObject().get("params").getOrThrow().asObject()
        if (params.size() != 2) { throw Exception("bad-model-catalog-request") }
        catalogId = params.get("catalogId").getOrThrow().asString().getValue()
        revision = params.get("expectedRevision").getOrThrow().asInt().getValue()
        if (catalogId.size == 0 || catalogId.size > 64 || revision < 0) { throw Exception("bad-model-catalog-request") }
    } catch (_: Exception) { emit(errFrame(idText, -32602, "bad-model-catalog-request")); return }
    try {
        let registry = ProviderRegistry.forUser()
        registry.addCatalogInstance(catalogId, revision)
        emit(okFrame(idText, providerViewJson(registry.describe(), CredentialStore.forUser())))
    } catch (e: Exception) {
        let reason = if (e.message == "settings-conflict" || e.message == "provider-settings-busy" || e.message == "settings-rejected") { e.message } else { "catalog-create-failed" }
        emit(errFrame(idText, -32020, reason))
    }
}

func providerCredentialRequest(body: String, idText: String): Unit {
    var providerId = ""
    var value = ""
    var revision = Int64(-1)
    try {
        let params = JsonValue.fromStr(body).asObject().get("params").getOrThrow().asObject()
        if (params.size() != 3) { throw Exception("bad-model-credential-request") }
        providerId = params.get("providerId").getOrThrow().asString().getValue()
        value = params.get("key").getOrThrow().asString().getValue()
        revision = params.get("expectedRevision").getOrThrow().asInt().getValue()
        if (providerId.size == 0 || providerId.size > 64 || value.size == 0 || value.size > 4096 || revision < 0) {
            throw Exception("bad-model-credential-request")
        }
    } catch (_: Exception) {
        emit(errFrame(idText, -32602, "bad-model-credential-request")); return
    }
    try {
        ProviderRegistry.forUser().saveCredential(providerId, revision, value, CredentialStore.forUser())
        emit(okFrame(idText, "{\"saved\":true}"))
    } catch (e: Exception) {
        let reason = if (e.message == "settings-conflict" || e.message == "provider-settings-busy") {
            e.message
        } else { "credential-save-failed" }
        emit(errFrame(idText, -32020, reason))
    }
}
