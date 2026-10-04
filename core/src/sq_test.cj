package core
import std.collection.*
import std.fs.*
import std.unittest.*

// 会话查询上游契约（M1）：`ctx.sessionQuery` 提供按事件类型/关键词的过滤面。
// 本切片以纯进程内 `SessionQuery` 承接三件：`byType(t)` 取同类型事件序列、
// `byKeyword(k)` 取 data 含 k 的事件、`countAll()` 总数。

@Test
func sessionQueryByTypeFilter() {
    let root = "core-sq-type"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    log.append("user/message", "甲")
    log.append("assistant/message", "乙")
    log.append("user/message", "丙")
    let q = SessionQuery(log)
    let users = q.byType("user/message")
    @Expect(users.size, Int64(2))
    @Expect(users[0], "甲")
    @Expect(users[1], "丙")
    removeIfExists(root, recursive: true)
}

@Test
func sessionQueryByKeyword() {
    let root = "core-sq-kw"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    log.append("user/message", "hello world")
    log.append("user/message", "foo bar")
    let q = SessionQuery(log)
    let hits = q.byKeyword("world")
    @Expect(hits.size, Int64(1))
    @Expect(hits[0], "hello world")
    removeIfExists(root, recursive: true)
}

@Test
func sessionQueryEmptyResultNotError() {
    let root = "core-sq-empty"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let q = SessionQuery(log)
    @Expect(q.byType("ghost").size, Int64(0))
    @Expect(q.byKeyword("xyz").size, Int64(0))
    @Expect(q.countAll(), Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func sessionQueryCountAll() {
    let root = "core-sq-count"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    log.append("user/message", "a")
    log.append("assistant/message", "b")
    log.append("tool/result", "c")
    @Expect(SessionQuery(log).countAll(), Int64(3))
    removeIfExists(root, recursive: true)
}
