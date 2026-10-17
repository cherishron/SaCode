package core
import std.fs.*
import std.unittest.*

// 会话待办清单：上游契约刻意「极简」——每项只有 content 与三态 status，
// 无 id/priority/activeForm；`todo/write` 事件携带完整替换列表（last-write-wins）；
// 且它是 log-only，不进模型历史（isSurfaceEvent 白名单里没有它）。

@Test
func todoWriteIsLogOnlyAndReplaysLastSnapshot() {
    let root = "core-todo-roundtrip"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let todos = TodoStore(log)
    log.append("user/message", "开工")
    todos.write([TodoItem("甲", "pending"), TodoItem("乙", "in_progress")])
    @Expect(todos.list().size, Int64(2))
    @Expect(todos.list()[0].content, "甲")
    @Expect(todos.list()[1].status, "in_progress")
    @Expect(log.flush(), true)

    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    let replayed = TodoStore(fresh)
    @Expect(replayed.list().size, Int64(2))
    @Expect(replayed.list()[0].status, "pending")
    // 关键：待办不进模型历史，只看到那一条 user/message。
    @Expect(fresh.deriveMessages().size, Int64(1))
    removeIfExists(root, recursive: true)
}

@Test
func todoWriteReplacesWholesaleNotAppends() {
    let root = "core-todo-replace"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let todos = TodoStore(log)
    todos.write([TodoItem("旧一", "pending"), TodoItem("旧二", "pending")])
    todos.write([TodoItem("新一", "completed")])
    // 第二次 write 完全覆盖第一次，不追加。
    @Expect(todos.list().size, Int64(1))
    @Expect(todos.list()[0].content, "新一")
    @Expect(todos.list()[0].status, "completed")
    removeIfExists(root, recursive: true)
}

@Test
func todoWriteRejectsUnknownStatusWithoutAppending() {
    let root = "core-todo-bad"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let todos = TodoStore(log)
    var threw = false
    try {
        todos.write([TodoItem("甲", "someday-maybe")])
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    // 非法 status 拒绝写入且不留任何事件——不然回放会看到半套历史。
    @Expect(log.snapshotEvents().size, Int64(0))
    @Expect(todos.list().size, Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func todoEmptyListStillPersistsClearSnapshot() {
    let root = "core-todo-clear"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let todos = TodoStore(log)
    todos.write([TodoItem("先记一项", "pending")])
    todos.write([])
    // 空数组也要落——上一轮有清单，这一轮清了，日志必须能追问「什么时候清的」。
    @Expect(todos.list().size, Int64(0))
    @Expect(log.snapshotEvents().size, Int64(2))
    removeIfExists(root, recursive: true)
}

// JSON 快照允许正文里的分隔符、换行、引号和控制字符无损回放。
@Test
func todoStructuredSnapshotRoundTripsSpecialContent() {
    let root = "core-todo-delimi"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let todos = TodoStore(log)
    let controls: Array<Byte> = [0, 12]
    let content = "甲|乙\n引号\"路径\\" + String.fromUtf8(controls) + "末尾"
    todos.write([TodoItem(content, "pending")])
    @Expect(log.eventCount(), Int64(1))
    @Expect(todos.list()[0].content, content)
    @Expect(log.flush(), true)
    let fresh = SessionLog("${root}/session.log")
    @Expect(fresh.load(), true)
    @Expect(TodoStore(fresh).list()[0].content, content)
    @Expect(fresh.deriveMessages().size, Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func todoRejectsEmptyDuplicateAndDisallowedParallelAtomically() {
    let log = SessionLog("todo-validation-unused.log")
    let todos = TodoStore(log)
    for (items in [
        [TodoItem(" \t　  ", "pending")],
        [TodoItem("  同一个  ", "pending"), TodoItem("同一个", "completed")],
        [TodoItem("甲", "in_progress"), TodoItem("乙", "in_progress")]
    ]) {
        var rejected = false
        try { todos.write(items) } catch (_: Exception) { rejected = true }
        @Expect(rejected, true)
        @Expect(log.eventCount(), Int64(0))
    }
    let parallel = TodoStore(log, allowParallelInProgress: true)
    parallel.write([TodoItem("　甲 ", "in_progress"), TodoItem("乙", "in_progress")])
    @Expect(parallel.list().size, Int64(2))
    @Expect(parallel.list()[0].content, "甲")
}

@Test
func todoProjectionClearsAtNewTurnAndRetainsAtEnd() {
    let log = SessionLog("todo-lifecycle-unused.log")
    let todos = TodoStore(log)
    @Expect(todos.projectionJson(), "null")
    todos.write([TodoItem("完成", "completed")])
    log.append("turn/end", "")
    @Expect(todos.list().size, Int64(1))
    log.append("turn/start", "")
    @Expect(todos.list().size, Int64(0))
    @Expect(todos.projectionJson(), "null")
    todos.write([TodoItem("下一轮", "pending")])
    @Expect(todos.list()[0].content, "下一轮")
    todos.write([])
    @Expect(todos.projectionJson(), "[]")
}

@Test
func todoReadsLegacyLogSnapshotsBeforeNewStructuredWrites() {
    let log = SessionLog("todo-legacy-unused.log")
    log.append("todo/write", "旧任务|pending\n旧完成|completed")
    let todos = TodoStore(log)
    @Expect(todos.list().size, Int64(2))
    @Expect(todos.list()[1].status, "completed")
    log.append("todo/write", "{\"todos\":旧任务|pending")
    @Expect(todos.list()[0].content, "{\"todos\":旧任务")
    todos.write([TodoItem("新|任务", "pending")])
    @Expect(todos.list()[0].content, "新|任务")
}
