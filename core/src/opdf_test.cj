package core
import std.collection.*
import std.fs.*
import std.unittest.*

// Office → PDF 上游契约（M8）：`ctx.officeToPdf.convert(path)` 触发异步转换任务；
// `settle(taskId, outcome)` 结算。本切片以 log-only `office-to-pdf/task` 事件
// 承载 `start::<taskId>::<sourcePath>` / `done::<taskId>::<pdfPath>` /
// `fail::<taskId>::<reason>`；状态 pending/done/failed。

@Test
func officeToPdfTaskLifecycle() {
    let root = "core-opdf-happy"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let t = OfficeToPdfLedger(log)
    t.start("task-1", "doc.docx")
    @Expect(t.status("task-1"), "pending")
    t.done("task-1", "doc.pdf")
    @Expect(t.status("task-1"), "done")
    removeIfExists(root, recursive: true)
}

@Test
func officeToPdfRejectsDoubleStart() {
    let root = "core-opdf-dup"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let t = OfficeToPdfLedger(log)
    t.start("task-1", "doc.docx")
    var threw = false
    try {
        t.start("task-1", "other.docx")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    removeIfExists(root, recursive: true)
}

@Test
func officeToPdfRejectsEmptyIdOrPath() {
    let root = "core-opdf-empty"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let t = OfficeToPdfLedger(log)
    var threwId = false
    try {
        t.start("", "doc.docx")
    } catch (e: Exception) {
        threwId = true
    }
    @Expect(threwId, true)
    var threwPath = false
    try {
        t.start("task-1", "")
    } catch (e: Exception) {
        threwPath = true
    }
    @Expect(threwPath, true)
    removeIfExists(root, recursive: true)
}

@Test
func officeToPdfEventsAreLogOnlyAcrossReplay() {
    let root = "core-opdf-replay"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let t = OfficeToPdfLedger(log)
    log.append("user/message", "开工")
    t.start("task-1", "doc.docx")
    t.done("task-1", "doc.pdf")
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    @Expect(fresh.deriveMessages().size, Int64(1))
    @Expect(OfficeToPdfLedger(fresh).status("task-1"), "done")
    removeIfExists(root, recursive: true)
}
