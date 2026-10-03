package core

import std.fs.*
import std.unittest.*

@Test
func catalogListsLegacyAndChildLogsWithoutWriting() {
    let root = "core-catalog-list"
    removeIfExists(root, recursive: true)
    Directory.create("${root}/sessions/中文会话", recursive: true)
    File.writeTo("${root}/session.log", "0\tuser/message\t根会话\n".toArray())
    File.writeTo("${root}/sessions/中文会话/session.log", "0\tuser/message\t带空格的任务\n1\tappearance/theme\tdark\n".toArray())
    let entries = SessionCatalog(root).list()
    @Expect(entries.size, Int64(2))
    @Expect(entries[0].id, "current")
    @Expect(entries[0].title, "根会话")
    @Expect(entries[1].id, "sessions/中文会话")
    @Expect(entries[1].title, "带空格的任务")
    @Expect(entries[1].durable, Int64(2))
    @Expect(entries[1].status, "ready")
    @Expect(String.fromUtf8(File.readFrom("${root}/session.log")), "0\tuser/message\t根会话\n")
    @Expect(exists("${root}/session.log.lease"), false)
    removeIfExists(root, recursive: true)
}

@Test
func catalogEmptyRootDoesNotCreateLogsOrFolders() {
    let root = "core-catalog-empty"
    removeIfExists(root, recursive: true)
    Directory.create(root)
    @Expect(SessionCatalog(root).list().size, Int64(0))
    @Expect(Directory.readFrom(root).size, Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func catalogDoesNotRecurseOrTreatArbitraryFilesAsSessions() {
    let root = "core-catalog-depth"
    removeIfExists(root, recursive: true)
    Directory.create("${root}/sessions/parent/nested", recursive: true)
    File.writeTo("${root}/sessions/parent/nested/session.log", "0\tuser/message\t忽略\n".toArray())
    File.writeTo("${root}/sessions/not-a-session.txt", "文字".toArray())
    File.writeTo("${root}/other.log", "0\tuser/message\t忽略\n".toArray())
    @Expect(SessionCatalog(root).list().size, Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func catalogShowsRejectedAndTruncatedLogsWithoutRepairing() {
    let root = "core-catalog-rejected"
    removeIfExists(root, recursive: true)
    Directory.create("${root}/sessions/broken", recursive: true)
    Directory.create("${root}/sessions/tail", recursive: true)
    let broken = "0\tuser/message\t前缀\n8\tuser/message\t中段缺帧\n9\tuser/message\t尾部\n"
    let tail = "0\tuser/message\t有效前缀\n1\tuser/message\t未完"
    File.writeTo("${root}/sessions/broken/session.log", broken.toArray())
    File.writeTo("${root}/sessions/tail/session.log", tail.toArray())
    let entries = SessionCatalog(root).list()
    @Expect(entries.size, Int64(2))
    for (item in entries) {
        if (item.id == "sessions/broken") {
            @Expect(item.status, "replay-rejected")
            @Expect(item.title, "")
            @Expect(item.durable, Int64(0))
        } else {
            @Expect(item.status, "truncated-tail")
            @Expect(item.title, "有效前缀")
            @Expect(item.durable, Int64(1))
        }
    }
    @Expect(String.fromUtf8(File.readFrom("${root}/sessions/broken/session.log")), broken)
    @Expect(String.fromUtf8(File.readFrom("${root}/sessions/tail/session.log")), tail)
    removeIfExists(root, recursive: true)
}
