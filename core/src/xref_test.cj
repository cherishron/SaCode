package core
import std.fs.*
import std.unittest.*

// 会话引用上游契约（225 行）：`FileReference` 候选 + `SessionReferenceMention`
// + 7 ErrorCode（invalid-kind / not-found / stale-version / outside-workspace /
// denied / malformed / too-large）。本切片以 log-only `session/reference` 事件
// 承载「按 kind::path::version 落一条引用」；候选解析读回放里出现过的所有引用。

@Test
func sessionReferenceAddAndListCandidates() {
    let root = "core-xref-add"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let xref = SessionReferenceStore(log)
    xref.add("file", "a.txt", "v1")
    xref.add("file", "b.txt", "v2")
    let list = xref.candidates()
    @Expect(list.size, Int64(2))
    @Expect(list[0], "file::a.txt::v1")
    @Expect(list[1], "file::b.txt::v2")
    removeIfExists(root, recursive: true)
}

@Test
func sessionReferenceRejectsEmptyKindOrPath() {
    let root = "core-xref-reject"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let xref = SessionReferenceStore(log)
    var threwKind = false
    try {
        xref.add("", "a.txt", "v1")
    } catch (e: Exception) {
        threwKind = true
    }
    @Expect(threwKind, true)
    var threwPath = false
    try {
        xref.add("file", "", "v1")
    } catch (e: Exception) {
        threwPath = true
    }
    @Expect(threwPath, true)
    // 两次拒都不落事件。
    @Expect(xref.candidates().size, Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func sessionReferenceDedupesSameKey() {
    let root = "core-xref-dedupe"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let xref = SessionReferenceStore(log)
    xref.add("file", "a.txt", "v1")
    xref.add("file", "a.txt", "v1")
    @Expect(xref.candidates().size, Int64(1))
    removeIfExists(root, recursive: true)
}

@Test
func sessionReferenceEventIsLogOnlyAcrossReplay() {
    let root = "core-xref-replay"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let xref = SessionReferenceStore(log)
    log.append("user/message", "开工")
    xref.add("file", "a.txt", "v1")
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    @Expect(fresh.deriveMessages().size, Int64(1))
    @Expect(SessionReferenceStore(fresh).candidates().size, Int64(1))
    removeIfExists(root, recursive: true)
}
