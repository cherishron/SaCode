package core

// 设置：`settings/document-updated` 是 log-only 事件（不进 `isSurfaceEvent`
// 白名单），承载三种变更：
// - `update::<key>::<value>` 合并单键
// - `replace::<k1=v1,k2=v2,...>` 先清空再应用整份
// - `mutate::<key>::<expected>::<new>` 按路径 CAS 编辑
//
// 本切片假设 key/value 不含 `::`、`,`、`=`（现有工具产生的字段符合此约定），
// 未来放开该限制需换长度前缀编码。
public class SettingsStore {
    let log: SessionLog

    public init(log: SessionLog) {
        this.log = log
    }

    public func update(key: String, value: String): Unit {
        log.append("settings/document-updated", "update::${key}::${value}")
    }

    public func replace(pairs: Array<Array<String>>): Unit {
        var body = ""
        for (i in 0..pairs.size) {
            if (i > 0) { body += "," }
            body += "${pairs[i][0]}=${pairs[i][1]}"
        }
        log.append("settings/document-updated", "replace::${body}")
    }

    public func mutate(key: String, expected: String, next: String): Unit {
        let current = get(key)
        if (current != expected) {
            throw Exception("stale-settings-revision")
        }
        log.append("settings/document-updated", "mutate::${key}::${expected}::${next}")
    }

    // 简单「取某 key 前缀段」——`<prefix>::<rest>` 结构里取 rest。
    private static func afterPrefix(data: String, prefix: String): String {
        if (!data.startsWith(prefix)) {
            return ""
        }
        return data[prefix.size..data.size]
    }

    private static func splitOnce(rest: String, sep: String): (String, String) {
        let idx = rest.indexOf(sep) ?? Int64(-1)
        if (idx < 0) {
            return (rest, "")
        }
        return (rest[0..idx], rest[(idx + sep.size)..rest.size])
    }

    public func get(key: String): String {
        var current = ""
        for (event in log.snapshotEvents()) {
            if (event.eventType != "settings/document-updated") {
                continue
            }
            let body = event.data
            if (body.startsWith("update::")) {
                let rest = SettingsStore.afterPrefix(body, "update::")
                let (k, v) = SettingsStore.splitOnce(rest, "::")
                if (k == key) {
                    current = v
                }
            } else if (body.startsWith("replace::")) {
                current = ""
                let rest = SettingsStore.afterPrefix(body, "replace::")
                if (rest.size == 0) {
                    continue
                }
                for (pair in rest.split(",")) {
                    let eq = pair.indexOf("=") ?? Int64(-1)
                    if (eq < 0) {
                        continue
                    }
                    if (pair[0..eq] == key) {
                        current = pair[(eq + 1)..pair.size]
                    }
                }
            } else if (body.startsWith("mutate::")) {
                let rest = SettingsStore.afterPrefix(body, "mutate::")
                let (k, tail) = SettingsStore.splitOnce(rest, "::")
                if (k != key) {
                    continue
                }
                let (_, next) = SettingsStore.splitOnce(tail, "::")
                current = next
            }
        }
        return current
    }
}
