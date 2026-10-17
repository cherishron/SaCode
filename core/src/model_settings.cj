package core

import std.fs.*

// 模型配置由共享核心持久化；这份日志只保存**凭证引用**（POSIX 环境变量名），
// 值由 CredentialStore 的分层 provider 持有——配置面任何一条读面都不带明文穿过。
public class ModelSettingsSnapshot {
    public let baseUrl: String
    public let model: String
    public let credentialRef: String
    public init(baseUrl: String, model: String, credentialRef: String) {
        this.baseUrl = baseUrl; this.model = model; this.credentialRef = credentialRef
    }
}

public class ModelSettings {
    let root: String
    let path: String
    public static func forUser(): ModelSettings {
        return ModelSettings(Path(GlobalAppearanceSettings.forUser().settingsPath()).parent.toString())
    }
    public init(directory: String) {
        root = canonicalize(directory).toString()
        path = "${root}/model-settings.log"
    }
    public static func validate(baseUrl: String, model: String, credentialRef: String): Unit {
        let secure = baseUrl.startsWith("https://") && baseUrl.size > 8
        let local = baseUrl.startsWith("http://127.0.0.1:") || baseUrl.startsWith("http://localhost:")
        if ((!secure && !local) || baseUrl.size > 2048 || baseUrl.contains("@") || baseUrl.contains("?") || baseUrl.contains("#")) {
            throw Exception("bad-model-url")
        }
        for (value in [baseUrl, model, credentialRef]) {
            for (byte in value.toArray()) { if (byte < 32 || byte == 127) { throw Exception("bad-model-config") } }
        }
        if (model.trimAscii().size == 0 || model.size > 200 || credentialRef.size > 100) { throw Exception("bad-model-config") }
        for (byte in credentialRef.toArray()) {
            if (!((byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122) || byte == 45)) {
                throw Exception("bad-credential-ref")
            }
        }
    }
    public func read(): ModelSettingsSnapshot {
        if (exists(path) && canonicalize(path).parent.toString() != root) { throw Exception("model-path-rejected") }
        let log = SessionLog(path)
        if (!log.load() || log.isTruncatedTail()) { throw Exception("model-replay-rejected") }
        var url = ""; var model = ""; var credential = ""
        for (event in log.snapshotEvents()) {
            if (event.eventType == "model/base-url") { url = event.data }
            else if (event.eventType == "model/name") { model = event.data }
            else if (event.eventType == "model/credential-ref") { credential = event.data }
            else { throw Exception("model-replay-rejected") }
        }
        if (url.size > 0 || model.size > 0 || credential.size > 0) { validate(url, model, credential) }
        return ModelSettingsSnapshot(url, model, credential)
    }
    public func save(url: String, model: String, credential: String): Unit {
        validate(url, model, credential)
        let lease = WriteLease(path)
        if (!lease.takeoverIfStale()) { throw Exception("model-already-owned") }
        var temporary = ""
        try {
            read()
            let file = File.createTemp(Path(root)); temporary = file.info.path.toString(); file.close()
            let draft = SessionLog(temporary)
            draft.append("model/base-url", url); draft.append("model/name", model); draft.append("model/credential-ref", credential)
            if (!draft.flush()) { throw Exception("model-flush-failed") }
            rename(temporary, to: path, overwrite: true)
        } finally {
            if (temporary.size > 0) { try { removeIfExists(temporary, recursive: false) } catch (_: Exception) {} }
            lease.release()
        }
    }
}
