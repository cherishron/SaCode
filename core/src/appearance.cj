package core

// 当前会话的外观偏好也是日志事实；不另存一份前端或 Electron 配置。
// 只接受已知主题，不进入模型消息投影。调用方负责租约和 flush 屏障。
public class SessionAppearance {
    let log: SessionLog

    public init(log: SessionLog) {
        this.log = log
    }

    public static func validTheme(theme: String): Bool {
        return theme == "system" || theme == "light" || theme == "dark"
    }

    public func theme(): String {
        var current = "system"
        for (event in log.snapshotEvents()) {
            if (event.eventType == "appearance/theme" && validTheme(event.data)) {
                current = event.data
            }
        }
        return current
    }

    public func setTheme(value: String): Bool {
        if (!validTheme(value) || value == theme()) {
            return false
        }
        log.append("appearance/theme", value)
        return true
    }
}
