package host
import core.*
import stdx.encoding.json.*

// 资料面仅允许昵称读写，错误只发稳定业务原因，不回传文件异常或内部路径。
func profileSurfaceRequest(method: String, body: String, id: String): Unit {
    try {
        let store = UserProfile.forUser()
        if (method == "profile/get") {
            emit(okFrame(id, store.read().asJson()))
            return
        }
        var nickname = ""
        var revision: Int64 = 0
        try {
            let obj = JsonValue.fromStr(paramsTextOf(body)).asObject()
            if (obj.size() != 2) { throw Exception("shape") }
            nickname = obj.get("nickname").getOrThrow().asString().getValue()
            revision = obj.get("expectedRevision").getOrThrow().asInt().getValue()
            UserProfile.normalNickname(nickname)
            if (revision < 0) { throw Exception("revision") }
        } catch (_: Exception) { throw Exception("bad-profile-nickname") }
        let saved = store.update(nickname, revision)
        emit(okFrame(id, saved.asJson()))
    } catch (e: Exception) {
        var message = "profile-storage-unavailable"
        var reason = "persistence-failed"
        var retryable = true
        var code: Int64 = -32003
        if (e.message == "bad-profile-nickname" || e.message == "bad-profile-revision") {
            message = e.message; reason = "invalid-input"; retryable = false; code = -32602
        } else if (e.message == "profile-revision-conflict") {
            message = e.message; reason = "revision-conflict"; code = -32031
        } else if (e.message == "profile-already-owned") {
            message = e.message; reason = "busy"; code = -32001
        } else if (e.message == "profile-owner-unknown") {
            message = e.message; reason = "outcome-unknown"; retryable = false; code = -32001
        } else if (e.message == "profile-replay-rejected" || e.message == "profile-path-rejected") {
            message = e.message; retryable = false
        }
        var data = "{\"reason\":\"${reason}\",\"retryable\":${retryable}"
        if (reason == "revision-conflict") {
            try { data += ",\"currentRevision\":${UserProfile.forUser().read().revision}" } catch (_: Exception) {}
        }
        emit(errFrameData(id, code, message, data + "}"))
    }
}
