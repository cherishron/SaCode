package core
import std.collection.ArrayList
import stdx.encoding.json.*

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

// 与 ECMAScript trim 的空白集合一致，避免只有全角空格的任务进入清单。
func trimTodoContent(raw: String): String {
    let marks = [" ", " ", " ", " ", " ", " ", " ", " ", " ", " ", " ", " ", " ", " ", " ", " ", " ", "　", "﻿"]
    var text = raw.trimAscii()
    var changed = true
    while (changed) {
        changed = false
        for (mark in marks) {
            if (text.startsWith(mark)) { text = text[mark.size..text.size].trimAscii(); changed = true }
            if (text.endsWith(mark)) { text = text[0..(text.size - mark.size)].trimAscii(); changed = true }
        }
    }
    return text
}

// JSON 快照无损承载换行、分隔符和控制字符；也供 Host 投影使用。
public func todoListJson(items: Array<TodoItem>): String {
    var result = "["
    for (i in 0..items.size) {
        if (i > 0) { result += "," }
        result += "{\"content\":\"${jsonEscapeText(items[i].content)}\",\"status\":\"${jsonEscapeText(items[i].status)}\"}"
    }
    return result + "]"
}

// `todo/write` 是 log-only 的完整快照；部署策略显式决定是否允许并行进行中任务。
public class TodoStore {
    let log: SessionLog
    let allowParallelInProgress: Bool

    public init(log: SessionLog, allowParallelInProgress!: Bool = false) {
        this.log = log
        this.allowParallelInProgress = allowParallelInProgress
    }

    private static func validStatus(s: String): Bool {
        return s == "pending" || s == "in_progress" || s == "completed"
    }

    // 全量替换：任一 status 非法则整次 write 拒绝且一条事件都不落，
    // 保证日志里出现的 todo/write 一定对应一份合法快照。
    // 正文使用 JSON 编码，允许分隔符、换行及控制字符无损回放。
    public func write(items: Array<TodoItem>): Unit {
        let canonical = ArrayList<TodoItem>()
        var active = Int64(0)
        for (item in items) {
            if (!validStatus(item.status)) {
                throw Exception("bad-todo-status")
            }
            let content = trimTodoContent(item.content)
            if (content.size == 0) {
                throw Exception("bad-todo-content")
            }
            for (previous in canonical) {
                if (previous.content == content) { throw Exception("duplicate-todo-content") }
            }
            if (item.status == "in_progress") { active += 1 }
            canonical.add(TodoItem(content, item.status))
        }
        if (!allowParallelInProgress && active > 1) { throw Exception("parallel-todo-rejected") }
        log.append("todo/write", "{\"todos\":${todoListJson(canonical.toArray())}}")
    }

    // 取当前清单——回放最后一条 todo/write；未写过则空。
    private func projected(): Option<Array<TodoItem>> {
        var lastData = ""
        var seen = false
        for (event in log.snapshotEvents()) {
            if (event.eventType == "todo/write") {
                lastData = event.data
                seen = true
            } else if (event.eventType == "turn/start") {
                lastData = ""
                seen = false
            }
        }
        let acc = ArrayList<TodoItem>()
        if (!seen) { return None }
        if (lastData.size == 0) {
            return Some(acc.toArray())
        }
        let legacy = lastData.endsWith("|pending") || lastData.endsWith("|in_progress") || lastData.endsWith("|completed")
        if (!legacy && lastData.startsWith("{\"todos\":")) {
            let values = JsonValue.fromStr(lastData).asObject().get("todos").getOrThrow().asArray()
            var index = Int64(0)
            while (let Some(value) <- values.get(index)) {
                let item = value.asObject()
                let content = item.get("content").getOrThrow().asString().getValue()
                let status = item.get("status").getOrThrow().asString().getValue()
                if (!validStatus(status)) { throw Exception("bad-todo-snapshot") }
                acc.add(TodoItem(content, status))
                index += 1
            }
            return Some(acc.toArray())
        }
        // 旧版本日志仍按原编码回放；所有新写入都使用结构化 JSON。
        for (line in lastData.split("\n")) {
            let idxOpt = line.indexOf("|")
            match (idxOpt) {
                case Some(idx) => acc.add(TodoItem(line[0..idx], line[(idx + 1)..line.size]))
                case None => ()
            }
        }
        return Some(acc.toArray())
    }

    public func list(): Array<TodoItem> { return projected() ?? [] }

    // null 表示本轮尚无快照，[] 表示工具明确清空清单，不能混为一谈。
    public func projectionJson(): String {
        if (let Some(items) <- projected()) { return todoListJson(items) }
        return "null"
    }
}
