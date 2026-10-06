package core

import std.fs.*
import std.env.*

// 用户外观独立于会话；切换会话不会改变字号，配置不会进入模型消息。
public class GlobalAppearanceSnapshot {
    public let theme: String
    public let fontSize: Int64
    public let busySend: String
    public init(theme: String, fontSize: Int64) {
        this.theme = theme
        this.fontSize = fontSize
        this.busySend = "queue"
    }
    public init(theme: String, fontSize: Int64, busySend: String) {
        this.theme = theme
        this.fontSize = fontSize
        this.busySend = busySend
    }
}

public class GlobalAppearanceSettings {
    let root: String
    let path: String

    // 两入口使用同一用户目录；显式绝对路径覆盖供部署和隔离验收使用。
    public static func forUser(): GlobalAppearanceSettings {
        let override = getVariable("SACODE_USER_SETTINGS_DIR") ?? ""
        var home = getVariable("USERPROFILE") ?? ""
        if (home.size == 0) { home = getVariable("HOME") ?? "" }
        if (override.size == 0 && home.size == 0) { throw Exception("settings-home-unavailable") }
        let directory = if (override.size > 0) { override } else { "${home}/.sacode/user" }
        let bytes = directory.toArray()
        let absolute = (bytes.size > 0 && bytes[0] == 47) ||
            (bytes.size >= 3 && bytes[1] == 58 && (bytes[2] == 47 || bytes[2] == 92)) ||
            (bytes.size >= 2 && bytes[0] == 92 && bytes[1] == 92)
        if (!absolute) { throw Exception("settings-root-not-absolute") }
        if (!exists(directory)) { Directory.create(directory, recursive: true) }
        return GlobalAppearanceSettings(directory)
    }

    public init(directory: String) {
        root = canonicalize(directory).toString()
        if (!FileInfo(root).isDirectory()) { throw Exception("bad-settings-directory") }
        path = "${root}/user-settings.log"
    }

    public func settingsPath(): String { return path }

    public static func validFontSize(value: Int64): Bool {
        return value >= 10 && value <= 22
    }

    public static func validBusySend(value: String): Bool { return value == "queue" || value == "steer" }

    // 桌面与 CLI 共用送达判据：空闲时排入下一轮，繁忙时修饰键使用互补行为。
    public static func sendMode(preferred: String, running: Bool, accelerated: Bool): String {
        if (!validBusySend(preferred)) { throw Exception("bad-busy-send") }
        if (!running) { return "queue" }
        return if (!accelerated) { preferred } else if (preferred == "queue") { "steer" } else { "queue" }
    }

    private func parsedFontSize(value: String): Int64 {
        // 只接收规范十进制，避免溢出或隐藏控制字符混入持久配置。
        let bytes = value.toArray()
        if (bytes.size != 2 || bytes[0] < 48 || bytes[0] > 57 || bytes[1] < 48 || bytes[1] > 57) {
            return -1
        }
        let size = Int64(bytes[0] - 48) * 10 + Int64(bytes[1] - 48)
        return if (validFontSize(size)) { size } else { -1 }
    }

    public func read(): GlobalAppearanceSnapshot {
        if (exists(path) && canonicalize(path).parent.toString() != root) {
            throw Exception("settings-path-rejected")
        }
        let log = SessionLog(path)
        if (!log.load() || log.isTruncatedTail()) { throw Exception("settings-replay-rejected") }
        var theme = "system"
        var fontSize: Int64 = 14
        var busySend = "queue"
        for (event in log.snapshotEvents()) {
            if (event.eventType == "settings/theme" && SessionAppearance.validTheme(event.data)) {
                theme = event.data
            } else if (event.eventType == "settings/font-size" && parsedFontSize(event.data) >= 0) {
                fontSize = parsedFontSize(event.data)
            } else if (event.eventType == "settings/busy-send" && validBusySend(event.data)) {
                busySend = event.data
            } else {
                // 配置损坏须显式失败，不能回默认值再覆盖有效的历史设置。
                throw Exception("settings-replay-rejected")
            }
        }
        return GlobalAppearanceSnapshot(theme, fontSize, busySend)
    }

    public func setTheme(value: String): Bool {
        if (!SessionAppearance.validTheme(value)) { throw Exception("bad-theme") }
        return update(value, -1, "")
    }

    public func setFontSize(value: Int64): Bool {
        if (!validFontSize(value)) { throw Exception("bad-font-size") }
        return update("", value, "")
    }

    public func setBusySend(value: String): Bool {
        if (!validBusySend(value)) { throw Exception("bad-busy-send") }
        return update("", -1, value)
    }

    private func update(wantedTheme: String, wantedSize: Int64, wantedBusySend: String): Bool {
        let lease = WriteLease(path)
        if (!lease.takeoverIfStale()) { throw Exception("settings-already-owned") }
        var temporary = ""
        try {
            // 拿到独立配置租约后重读，防止另一入口已保存的字段被旧内存覆盖。
            let current = read()
            let theme = if (wantedTheme.size == 0) { current.theme } else { wantedTheme }
            let size = if (wantedSize < 0) { current.fontSize } else { wantedSize }
            let busySend = if (wantedBusySend.size == 0) { current.busySend } else { wantedBusySend }
            if (theme == current.theme && size == current.fontSize && busySend == current.busySend) { return false }
            let file = File.createTemp(Path(root))
            temporary = file.info.path.toString()
            file.close()
            let draft = SessionLog(temporary)
            draft.append("settings/theme", theme)
            draft.append("settings/font-size", "${size}")
            // 缺失此字段的旧档案默认为排队；默认值保持旧二字段文件兼容。
            if (busySend != "queue") { draft.append("settings/busy-send", busySend) }
            if (!draft.flush()) { throw Exception("settings-flush-failed") }
            // 完整草稿落盘后发布；不直接截断用户已有的配置文件。
            rename(temporary, to: path, overwrite: true)
            return true
        } finally {
            if (temporary.size > 0) {
                try { removeIfExists(temporary, recursive: false) } catch (_: Exception) {}
            }
            lease.release()
        }
    }
}
