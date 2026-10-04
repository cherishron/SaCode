package core
import std.collection.ArrayList

// 待办项：与上游 `TodoItem` 契约一致——刻意极简，只有 content 与三态 status，
// 无 id / priority / activeForm。整份清单在每次 write 时全量替换（last-write-wins）。
public class TodoItem {
    public let content: String
    public let status: String // "pending" | "in_progress" | "completed"
    public init(content: String, status: String) {
        this.content = content
        this.status = status
    }
}

// `todo/write` 事件：log-only，不进 isSurfaceEvent 白名单，不进模型历史。
//
// 编码：每条记录 `<content>|<status>`，记录之间用 `\n` 分隔；空清单落空字符串。
// 本切片假设 content 不含 `|` 与 `\n`（现有 CLI/桌面两个入口的 todo 工具
// 均按此约定产生），未来若要放开该限制，需换成长度前缀编码；此处不预设。
public class TodoStore {
    let log: SessionLog

    public init(log: SessionLog) {
        this.log = log
    }

    private static func validStatus(s: String): Bool {
        return s == "pending" || s == "in_progress" || s == "completed"
    }

    // 全量替换：任一 status 非法则整次 write 拒绝且一条事件都不落，
    // 保证日志里出现的 todo/write 一定对应一份合法快照。
    public func write(items: Array<TodoItem>): Unit {
        for (item in items) {
            if (!validStatus(item.status)) {
                throw Exception("bad-todo-status")
            }
        }
        var encoded = ""
        for (i in 0..items.size) {
            if (i > 0) { encoded += "\n" }
            encoded += "${items[i].content}|${items[i].status}"
        }
        log.append("todo/write", encoded)
    }

    // 取当前清单——回放最后一条 todo/write；未写过则空。
    public func list(): Array<TodoItem> {
        var lastData = ""
        var seen = false
        for (event in log.snapshotEvents()) {
            if (event.eventType == "todo/write") {
                lastData = event.data
                seen = true
            }
        }
        let acc = ArrayList<TodoItem>()
        if (!seen || lastData.size == 0) {
            return acc.toArray()
        }
        for (line in lastData.split("\n")) {
            let idxOpt = line.indexOf("|")
            match (idxOpt) {
                case Some(idx) => acc.add(TodoItem(line[0..idx], line[(idx + 1)..line.size]))
                case None => ()
            }
        }
        return acc.toArray()
    }
}
