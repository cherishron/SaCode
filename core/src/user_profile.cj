package core
import std.fs.*
import std.unicode.*
import stdx.encoding.json.*

// 本机资料独立于外观和会话，只保存昵称与修订，不引入云账号或前端第二真源。
public class UserProfileSnapshot {
    public let nickname: String
    public let revision: Int64
    public init(nickname: String, revision: Int64) {
        this.nickname = nickname
        this.revision = revision
    }
    public func asJson(): String {
        let value = JsonObject()
        value.put("nickname", JsonString(nickname))
        value.put("revision", JsonInt(revision))
        return value.toString()
    }
}

public class UserProfile {
    let root: String
    let path: String
    public init(directory: String) {
        root = canonicalize(directory).toString()
        if (!FileInfo(root).isDirectory()) { throw Exception("profile-storage-unavailable") }
        path = "${root}/profile.log"
    }
    public static func forUser(): UserProfile {
        // 复用两入口已统一的用户根解析；不向严格的外观日志塞入资料事件。
        let directory = Path(GlobalAppearanceSettings.forUser().settingsPath()).parent.toString()
        return UserProfile(directory)
    }
    public static func normalNickname(raw: String): String {
        for (b in raw.toArray()) {
            if (b < 32 || b == 127) { throw Exception("bad-profile-nickname") }
        }
        let name = raw.trimStart({ r => r.isWhiteSpace() }).trimEnd({ r => r.isWhiteSpace() })
        if (name.size == 0 || name.toRuneArray().size > 40) { throw Exception("bad-profile-nickname") }
        return name
    }
    public func read(): UserProfileSnapshot {
        if (exists(path) && (canonicalize(path).parent.toString() != root || !FileInfo(path).isRegular())) {
            throw Exception("profile-path-rejected")
        }
        let log = SessionLog(path)
        if (!log.load() || log.isTruncatedTail()) { throw Exception("profile-replay-rejected") }
        let events = log.snapshotEvents()
        if (events.size == 0) {
            if (exists(path)) { throw Exception("profile-replay-rejected") }
            return UserProfileSnapshot("本地用户", 0)
        }
        if (events.size != 1 || events[0].eventType != "profile/nickname") { throw Exception("profile-replay-rejected") }
        try {
            let value = JsonValue.fromStr(events[0].data).asObject()
            if (value.size() != 2) { throw Exception("shape") }
            let name = value.get("nickname").getOrThrow().asString().getValue()
            let revision = value.get("revision").getOrThrow().asInt().getValue()
            if (normalNickname(name) != name || revision < 1) { throw Exception("value") }
            return UserProfileSnapshot(name, revision)
        } catch (_: Exception) { throw Exception("profile-replay-rejected") }
    }
    public func update(nickname: String, expectedRevision: Int64): UserProfileSnapshot {
        let name = normalNickname(nickname)
        if (expectedRevision < 0) { throw Exception("bad-profile-revision") }
        let lease = WriteLease(path)
        if (!lease.takeoverIfStale()) {
            if (lease.acquisitionFailure() == "busy") { throw Exception("profile-already-owned") }
            if (lease.acquisitionFailure() == "owner-unknown") { throw Exception("profile-owner-unknown") }
            throw Exception("profile-storage-unavailable")
        }
        var temporary = ""
        try {
            let current = read()
            if (current.revision != expectedRevision) { throw Exception("profile-revision-conflict") }
            if (current.nickname == name) { return current }
            let next = UserProfileSnapshot(name, current.revision + 1)
            let file = File.createTemp(Path(root))
            temporary = file.info.path.toString()
            file.close()
            // 完整快照先做追加持久屏障，再原子发布；旧文件不会被半截保存覆盖。
            let frame = "0\tprofile/nickname\t${escField(next.asJson())}\n"
            if (!appendDurablePrefix(temporary, Array<Byte>(), frame.toArray())) { throw Exception("profile-storage-unavailable") }
            if (!lease.protects(path)) { throw Exception("profile-owner-unknown") }
            nativeReplaceFile(temporary, path)
            return read()
        } finally {
            if (temporary.size > 0) {
                try { removeIfExists(temporary, recursive: false) } catch (_: Exception) {}
            }
            lease.release()
        }
    }
}
