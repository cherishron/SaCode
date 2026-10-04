package core
import std.collection.*

// 附件：log-only `attachment/record` 事件承载 `<name>::<mime>::<size>`；
// 空 name 抛 `attachment-empty-name`、空 mime 抛 `attachment-empty-mime`；
// size 允许为空（未知长度）。
//
// 本切片假设 name/mime/size 不含 `::`；未来放开需换长度前缀编码。
public class AttachmentStore {
    let log: SessionLog

    public init(log: SessionLog) {
        this.log = log
    }

    public func record(name: String, mime: String, size: String): Unit {
        if (name.size == 0) {
            throw Exception("attachment-empty-name")
        }
        if (mime.size == 0) {
            throw Exception("attachment-empty-mime")
        }
        log.append("attachment/record", "${name}::${mime}::${size}")
    }

    public func entries(): ArrayList<String> {
        let out = ArrayList<String>()
        for (event in log.snapshotEvents()) {
            if (event.eventType == "attachment/record") {
                out.add(event.data)
            }
        }
        return out
    }
}
