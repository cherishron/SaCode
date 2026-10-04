package core
import std.collection.*
import std.fs.*
import std.unittest.*

// 附件上游契约（M5/M6）：`ctx.attachments` 承载用户上传的文件引用；
// `attachment/record` 事件承载 `<name>::<mimeType>::<size>` 三字段（都字符串
// 避开 Int64 parse 陷阱）。空 name/mime 抛。

@Test
func attachmentRecordsAndListsBack() {
    let root = "core-att-list"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let att = AttachmentStore(log)
    att.record("report.pdf", "application/pdf", "1024")
    att.record("photo.png", "image/png", "2048")
    let list = att.entries()
    @Expect(list.size, Int64(2))
    @Expect(list[0], "report.pdf::application/pdf::1024")
    @Expect(list[1], "photo.png::image/png::2048")
    removeIfExists(root, recursive: true)
}

@Test
func attachmentRejectsEmptyNameOrMime() {
    let root = "core-att-empty"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let att = AttachmentStore(log)
    var threwName = false
    try {
        att.record("", "application/pdf", "1")
    } catch (e: Exception) {
        threwName = true
    }
    @Expect(threwName, true)
    var threwMime = false
    try {
        att.record("a.pdf", "", "1")
    } catch (e: Exception) {
        threwMime = true
    }
    @Expect(threwMime, true)
    @Expect(att.entries().size, Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func attachmentEventIsLogOnlyAcrossReplay() {
    let root = "core-att-replay"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let att = AttachmentStore(log)
    log.append("user/message", "开工")
    att.record("a.pdf", "application/pdf", "1")
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    @Expect(fresh.deriveMessages().size, Int64(1))
    @Expect(AttachmentStore(fresh).entries().size, Int64(1))
    removeIfExists(root, recursive: true)
}
