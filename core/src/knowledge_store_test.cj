package core
import std.fs.*
import std.env.getVariable
import std.unittest.*
import stdx.encoding.json.*

@Test
func knowledgeStorePersistsScopesSearchAndRejectsStaleWrite() {
    let root = canonicalize(Directory.createTemp(Path(getVariable("TMP").getOrThrow()))).toString()
    try {
        let user = KnowledgeStore(root, "user", "")
        let project = KnowledgeStore(root, "project", root)
        @Expect(user.read().get("revision").getOrThrow().asInt().getValue(), 0)
        user.save("one", "项目约束", "必须验证再提交", 0, false)
        @Expect(project.read().get("documents").getOrThrow().asArray().size(), 0)
        @Expect(JsonValue.fromStr(KnowledgeStore(root, "user", "").query("验证")).asObject().get("documents").getOrThrow().asArray().size(), 1)
        @Expect(JsonValue.fromStr(user.query("不存在")).asObject().get("documents").getOrThrow().asArray().size(), 0)
        @ExpectThrows[Exception](user.save("one", "旧写入", "不应覆盖", 0, false))
        @ExpectThrows[Exception](user.save("bad", "", "", 1, false))
        user.save("one", "", "", 1, true)
        @Expect(user.read().get("documents").getOrThrow().asArray().size(), 0)
        @ExpectThrows[Exception](user.save("one", "", "", 2, true))
        File.writeTo("${root}/source.md", "first".toArray())
        project.importFile("source", "源码说明", "source.md", 0)
        @Expect(JsonValue.fromStr(project.reference("source", 1)).asObject().get("document").getOrThrow().asObject().get("content").getOrThrow().asString().getValue(), "first")
        File.writeTo("${root}/source.md", "changed".toArray())
        @ExpectThrows[Exception](project.reference("source", 1))
        @ExpectThrows[Exception](project.importFile("escape", "越界", "../outside.md", 1))
        @ExpectThrows[Exception](user.importFile("source", "不跨域", "source.md", 2))
        project.importFile("source", "源码说明", "source.md", 1)
        @Expect(JsonValue.fromStr(project.reference("source", 2)).asObject().get("document").getOrThrow().asObject().get("content").getOrThrow().asString().getValue(), "changed")
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func knowledgeStoreRejectsBusyWriterAndDamagedReplay() {
    let root = canonicalize(Directory.createTemp(Path(getVariable("TMP").getOrThrow()))).toString()
    let lease = WriteLease("${root}/knowledge-user.log")
    try {
        let store = KnowledgeStore(root, "user", "")
        @Expect(lease.acquire(), true)
        @ExpectThrows[Exception](store.save("one", "不能竞争写入", "原文", 0, false))
        lease.release()
        @Expect(store.read().get("revision").getOrThrow().asInt().getValue(), 0)
        File.writeTo("${root}/knowledge-user.log", "broken snapshot".toArray())
        @ExpectThrows[Exception](store.read())
        @ExpectThrows[Exception](store.save("one", "不能覆盖损坏日志", "原文", 0, false))
        @Expect(String.fromUtf8(File.readFrom("${root}/knowledge-user.log")), "broken snapshot")
    } finally { lease.release(); removeIfExists(root, recursive: true) }
}
