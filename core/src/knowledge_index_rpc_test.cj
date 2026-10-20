package core

import std.fs.*
import std.unittest.*
import stdx.encoding.json.*

class KnowledgeIndexRpcFixture {
    let root: String
    let log: SessionLog
    let state: SessionWorkspace
    let rpc: KnowledgeIndexRpc
    init(maxFileBytes!: Int64 = 1048576) {
        root = canonicalize(Directory.createTemp(Path(coreTestRoot()))).toString()
        log = SessionLog("${root}/session.log")
        state = SessionWorkspace(log)
        state.setDirectory(root)
        rpc = KnowledgeIndexRpc(state, "index-rpc-test", maxFileBytes: maxFileBytes)
    }
    func params(): JsonObject {
        let obj = JsonObject()
        obj.put("sessionId", JsonString("index-rpc-test"))
        obj.put("workspace", JsonString(root))
        obj.put("workspaceRevision", JsonInt(state.revision()))
        return obj
    }
    func file(path: String, text: String): JsonObject {
        let parent = Path("${root}/${path}").parent
        if (!exists(parent)) {
            Directory.create(parent, recursive: true)
        }
        File.writeTo("${root}/${path}", text.toArray())
        let row = JsonObject()
        row.put("path", JsonString(path));
        row.put("digest", JsonString(sha256Hex(text.toArray())))
        return row
    }
    func build(files: Array<JsonValue>, revision!: Int64 = 0, token!: TurnToken = TurnToken()): JsonObject {
        let obj = params()
        obj.put("indexRevision", JsonInt(revision));
        obj.put("files", JsonArray(files))
        return JsonValue.fromStr(rpc.dispatch("knowledge/index-build", obj.toString(), token: token)).asObject()
    }
    func search(query: String, revision!: Int64 = 1): JsonObject {
        let obj = params()
        obj.put("indexRevision", JsonInt(revision));
        obj.put("query", JsonString(query))
        return JsonValue.fromStr(rpc.dispatch("knowledge/search", obj.toString())).asObject()
    }
    func describe(): JsonObject {
        return JsonValue.fromStr(rpc.dispatch("knowledge/describe-index", params().toString())).asObject()
    }
    func close(): Unit {
        coreTestTidy(root)
    }
}

func knowledgeIndexRpcTestString(obj: JsonObject, key: String): String {
    return obj.get(key).getOrThrow().asString().getValue()
}

func knowledgeIndexRpcTestRevision(obj: JsonObject): Int64 {
    return obj.get("indexRevision").getOrThrow().asInt().getValue()
}

func knowledgeIndexRpcTestArray(obj: JsonObject, key: String): JsonArray {
    return obj.get(key).getOrThrow().asArray()
}

@Test
func knowledgeIndexRpcBuildSearchDescribeOnlyReturnBoundSourceMetadata() {
    let f = KnowledgeIndexRpcFixture()
    try {
        let text = "func Lookup() {}\n// SOURCE_BODY_MUST_NOT_LEAVE_RPC\n"
        let file = f.file("src/lookup.cj", text)
        let beforeEvents = f.log.eventCount()
        let built = f.build([file])
        @Expect(knowledgeIndexRpcTestRevision(built), Int64(1))
        @Expect(knowledgeIndexRpcTestString(built, "phase"), "ready")
        @Expect(knowledgeIndexRpcTestString(built, "lastBuildPhase"), "ready")
        @Expect(knowledgeIndexRpcTestString(built, "indexDigest").size, Int64(64))
        let result = f.search("Lookup")
        @Expect(knowledgeIndexRpcTestString(result, "status"), "matched")
        let matches = knowledgeIndexRpcTestArray(result, "matches")
        @Expect(matches.size(), Int64(1))
        let hit = matches.get(0).getOrThrow().asObject()
        @Expect(knowledgeIndexRpcTestString(hit, "path"), "src/lookup.cj")
        @Expect(knowledgeIndexRpcTestString(hit, "digest"), sha256Hex(text.toArray()))
        @Expect(knowledgeIndexRpcTestString(hit, "symbol"), "Lookup")
        @Expect(knowledgeIndexRpcTestRevision(hit), Int64(1))
        @Expect(hit.get("workspaceRevision").getOrThrow().asInt().getValue(), Int64(1))
        @Expect(hit.get("startLine").getOrThrow().asInt().getValue(), Int64(1))
        @Expect(result.toString().contains("SOURCE_BODY_MUST_NOT_LEAVE_RPC"), false)
        for (key in ["excerpt", "text", "content", "sourceText"]) {
            @Expect(hit.get(key).isNone(), true)
        }
        let described = f.describe()
        @Expect(knowledgeIndexRpcTestArray(described, "files").size(), Int64(1))
        @Expect(knowledgeIndexRpcTestString(described, "searchKind"), "bounded-literal-lexical")
        @Expect(described.toString().contains("SOURCE_BODY_MUST_NOT_LEAVE_RPC"), false)
        @Expect(f.log.eventCount(), beforeEvents)
        @Expect(String.fromUtf8(File.readFrom("${f.root}/src/lookup.cj")), text)
    } finally {
        f.close()
    }
}

@Test
func knowledgeIndexRpcWrongDigestDoesNotPublishOrDiscardPreviousIndex() {
    let f = KnowledgeIndexRpcFixture()
    try {
        let file = f.file("original.cj", "func Original() {}\n")
        let built = f.build([file])
        let bad = f.file("candidate.cj", "func Candidate() {}\n")
        bad.put("digest", JsonString(sha256Hex("not-the-disk-content".toArray())))
        @ExpectThrows[Exception](f.build([bad], revision: 1))
        let state = f.describe()
        @Expect(knowledgeIndexRpcTestRevision(state), Int64(1))
        @Expect(knowledgeIndexRpcTestString(state, "indexDigest"), knowledgeIndexRpcTestString(built, "indexDigest"))
        @Expect(knowledgeIndexRpcTestString(state, "lastBuildPhase"), "failed")
        @Expect(knowledgeIndexRpcTestArray(f.search("Original"), "matches").size(), Int64(1))
        @Expect(knowledgeIndexRpcTestArray(f.search("Candidate"), "matches").size(), Int64(0))
        @Expect(String.fromUtf8(File.readFrom("${f.root}/original.cj")), "func Original() {}\n")
        @Expect(String.fromUtf8(File.readFrom("${f.root}/candidate.cj")), "func Candidate() {}\n")
    } finally {
        f.close()
    }
}

@Test
func knowledgeIndexRpcDropsStaleDigestButKeepsCurrentMatches() {
    let f = KnowledgeIndexRpcFixture()
    try {
        let a = f.file("a.cj", "func Shared() { return 1 }\n")
        let b = f.file("b.cj", "func Shared() { return 2 }\n")
        f.build([a, b])
        f.file("a.cj", "func Shared() { return 3 }\n")
        let result = f.search("Shared")
        let matches = knowledgeIndexRpcTestArray(result, "matches")
        let dropped = knowledgeIndexRpcTestArray(result, "dropped")
        @Expect(matches.size(), Int64(1))
        @Expect(knowledgeIndexRpcTestString(matches.get(0).getOrThrow().asObject(), "path"), "b.cj")
        @Expect(dropped.size(), Int64(1))
        @Expect(knowledgeIndexRpcTestString(dropped.get(0).getOrThrow().asObject(), "status"), "stale")
        @Expect(knowledgeIndexRpcTestString(result, "phase"), "stale")
        removeIfExists("${f.root}/b.cj", recursive: false)
        let removed = f.search("Shared")
        @Expect(knowledgeIndexRpcTestArray(removed, "matches").size(), Int64(0))
        @Expect(knowledgeIndexRpcTestString(removed, "status"), "stale-rejected")
    } finally {
        f.close()
    }
}

@Test
func knowledgeIndexRpcRenamedSymbolRejectsOldHitAndRebuildAdvancesPublicRevision() {
    let f = KnowledgeIndexRpcFixture()
    try {
        f.build([f.file("code.py", "def old_name():\n    return 1\n")])
        let next = f.file("code.py", "def new_name():\n    return 2\n")
        let old = f.search("old_name")
        @Expect(knowledgeIndexRpcTestArray(old, "matches").size(), Int64(0))
        @Expect(knowledgeIndexRpcTestString(knowledgeIndexRpcTestArray(old, "dropped").get(0).getOrThrow().asObject(), "status"), "symbol-missing")
        @Expect(knowledgeIndexRpcTestRevision(f.build([next], revision: 1)), Int64(2))
        @ExpectThrows[Exception](f.search("new_name", revision: 1))
        let result = f.search("new_name", revision: 2)
        let hit = knowledgeIndexRpcTestArray(result, "matches").get(0).getOrThrow().asObject()
        @Expect(knowledgeIndexRpcTestRevision(hit), Int64(2))
        @Expect(knowledgeIndexRpcTestString(hit, "symbol"), "new_name")
        @Expect(knowledgeIndexRpcTestArray(f.search("old_name", revision: 2), "matches").size(), Int64(0))
    } finally {
        f.close()
    }
}

@Test
func knowledgeIndexRpcPartialAndCancelledBuildsPreservePreviousGeneration() {
    let f = KnowledgeIndexRpcFixture(maxFileBytes: 64)
    try {
        let old = f.file("old.cj", "func Retained() {}")
        f.build([old])
        let huge = f.file("huge.cj", String(Array<Rune>(128, repeat: r'x')))
        let partial = f.build([huge], revision: 1)
        @Expect(knowledgeIndexRpcTestString(partial, "lastBuildPhase"), "partial")
        @Expect(knowledgeIndexRpcTestString(partial, "phase"), "ready")
        @Expect(knowledgeIndexRpcTestRevision(partial), Int64(1))
        @Expect(knowledgeIndexRpcTestArray(partial, "lastBuildUnindexed").size(), Int64(1))
        let token = TurnToken();
        token.cancel()
        @ExpectThrows[Exception](f.build([old], revision: 1, token: token))
        @Expect(knowledgeIndexRpcTestString(f.describe(), "lastBuildPhase"), "cancelled")
        @Expect(knowledgeIndexRpcTestArray(f.search("Retained"), "matches").size(), Int64(1))
        @Expect(String.fromUtf8(File.readFrom("${f.root}/old.cj")), "func Retained() {}")
    } finally {
        f.close()
    }
}

@Test
func knowledgeIndexRpcBindsSessionWorkspaceAndRevisionBeforeReading() {
    let f = KnowledgeIndexRpcFixture()
    try {
        let obj = f.params()
        obj.put("sessionId", JsonString("other-session"))
        @ExpectThrows[Exception](f.rpc.dispatch("knowledge/describe-index", obj.toString()))
        obj.put("sessionId", JsonString("index-rpc-test"))
        obj.put("workspace", JsonString("other-project"))
        @ExpectThrows[Exception](f.rpc.dispatch("knowledge/describe-index", obj.toString()))
        obj.put("workspace", JsonString(f.root));
        obj.put("workspaceRevision", JsonInt(9))
        @ExpectThrows[Exception](f.rpc.dispatch("knowledge/describe-index", obj.toString()))
        Directory.create("${f.root}/other")
        let original = f.params().toString()
        f.state.setDirectory("${f.root}/other")
        @ExpectThrows[Exception](f.rpc.dispatch("knowledge/describe-index", original))
        f.state.setDirectory(f.root)
        @ExpectThrows[Exception](f.rpc.dispatch("knowledge/describe-index", f.params().toString()))
    } finally {
        f.close()
    }
}

@Test
func knowledgeIndexRpcRejectsUnknownMethodsMalformedShapesAndQueryBounds() {
    let f = KnowledgeIndexRpcFixture()
    try {
        @Expect(KnowledgeIndexRpc.handles("knowledge/search"), true)
        @Expect(KnowledgeIndexRpc.handles("knowledge/index-build"), true)
        @Expect(KnowledgeIndexRpc.handles("knowledge/describe-index"), true)
        @Expect(KnowledgeIndexRpc.handles("knowledge/index/start"), false)
        @ExpectThrows[Exception](f.rpc.dispatch("knowledge/index/start", "{}"))
        @ExpectThrows[Exception](f.rpc.dispatch("knowledge/search", "not-json"))
        let obj = f.params();
        obj.put("extra", JsonBool(true))
        @ExpectThrows[Exception](f.rpc.dispatch("knowledge/describe-index", obj.toString()))
        let search = f.params();
        search.put("indexRevision", JsonInt(0));
        search.put("query", JsonString("anything"))
        search.put("limit", JsonInt(0))
        @ExpectThrows[Exception](f.rpc.dispatch("knowledge/search", search.toString()))
        search.put("limit", JsonInt(13))
        @ExpectThrows[Exception](f.rpc.dispatch("knowledge/search", search.toString()))
        search.put("limit", JsonInt(1));
        search.put("query", JsonString(String(Array<Rune>(2049, repeat: r'x'))))
        @ExpectThrows[Exception](f.rpc.dispatch("knowledge/search", search.toString()))
        search.put("query", JsonInt(5))
        @ExpectThrows[Exception](f.rpc.dispatch("knowledge/search", search.toString()))
        @Expect(knowledgeIndexRpcTestRevision(f.describe()), Int64(0))
    } finally {
        f.close()
    }
}

@Test
func knowledgeIndexRpcRejectsBadPathsDigestsDuplicatesAndFileShape() {
    let f = KnowledgeIndexRpcFixture()
    try {
        let file = f.file("safe.cj", "func Safe() {}")
        for (path in ["../safe.cj", "C:/safe.cj", "/safe.cj", "safe.cj:stream", "a//safe.cj", "a/./safe.cj", "safe.cj ",
            "bad\t.cj"]) {
            let bad = JsonValue.fromStr(file.toString()).asObject()
            bad.put("path", JsonString(path))
            @ExpectThrows[Exception](f.build([bad]))
        }
        let badDigest = JsonValue.fromStr(file.toString()).asObject();
        badDigest.put("digest", JsonString("bad"))
        @ExpectThrows[Exception](f.build([badDigest]))
        let extra = JsonValue.fromStr(file.toString()).asObject();
        extra.put("text", JsonString("never accepted"))
        @ExpectThrows[Exception](f.build([extra]))
        @ExpectThrows[Exception](f.build([file, file]))
        @Expect(knowledgeIndexRpcTestRevision(f.describe()), Int64(0))
        @Expect(String.fromUtf8(File.readFrom("${f.root}/safe.cj")), "func Safe() {}")
    } finally {
        f.close()
    }
}

@Test
func knowledgeIndexRpcEmptyBuildClearsDerivedPostingsWithoutDeletingSource() {
    let f = KnowledgeIndexRpcFixture()
    try {
        @Expect(knowledgeIndexRpcTestString(f.describe(), "phase"), "idle")
        @Expect(knowledgeIndexRpcTestArray(f.search("missing", revision: 0), "matches").size(), Int64(0))
        f.build([f.file("safe.cj", "func Safe() {}")])
        let cleared = f.build([], revision: 1)
        @Expect(knowledgeIndexRpcTestRevision(cleared), Int64(2))
        @Expect(knowledgeIndexRpcTestArray(cleared, "files").size(), Int64(0))
        @Expect(knowledgeIndexRpcTestArray(f.search("Safe", revision: 2), "matches").size(), Int64(0))
        @Expect(String.fromUtf8(File.readFrom("${f.root}/safe.cj")), "func Safe() {}")
    } finally {
        f.close()
    }
}

@Test
func knowledgeIndexRpcScopeDigestIsStableAcrossOrderAndPathsNormalize() {
    let f = KnowledgeIndexRpcFixture()
    try {
        let a = f.file("src/a.cj", "func Alpha() {}")
        let b = f.file("src/b.cj", "func Beta() {}")
        let first = f.build([b, a])
        a.put("path", JsonString("src\\a.cj"))
        let second = f.build([a, b], revision: 1)
        @Expect(knowledgeIndexRpcTestString(first, "indexDigest"), knowledgeIndexRpcTestString(second, "indexDigest"))
        @Expect(knowledgeIndexRpcTestRevision(second), Int64(2))
        let result = f.search("Alpha", revision: 2)
        @Expect(knowledgeIndexRpcTestString(knowledgeIndexRpcTestArray(result, "matches").get(0).getOrThrow().asObject(), "path"), "src/a.cj")
        @ExpectThrows[Exception](f.build([b], revision: 1))
    } finally {
        f.close()
    }
}

@Test
func knowledgeIndexRpcDoesNotPublishExcludedOrMissingSources() {
    let f = KnowledgeIndexRpcFixture()
    try {
        let secret = f.file(".env", "PRIVATE_FIXTURE_VALUE=not-a-real-secret")
        let partial = f.build([secret])
        @Expect(knowledgeIndexRpcTestRevision(partial), Int64(0))
        @Expect(knowledgeIndexRpcTestString(partial, "lastBuildPhase"), "partial")
        @Expect(partial.toString().contains("not-a-real-secret"), false)
        let missing = JsonObject();
        missing.put("path", JsonString("missing.cj"))
        missing.put("digest", JsonString(sha256Hex("missing".toArray())))
        @Expect(knowledgeIndexRpcTestRevision(f.build([missing])), Int64(0))
        @Expect(String.fromUtf8(File.readFrom("${f.root}/.env")), "PRIVATE_FIXTURE_VALUE=not-a-real-secret")
    } finally {
        f.close()
    }
}

@Test
func knowledgeIndexRpcSearchHonorsBoundedLimitWithoutReturningFileBodies() {
    let f = KnowledgeIndexRpcFixture()
    try {
        let a = f.file("a.cj", "func Common() {}\n// body a must stay local")
        let b = f.file("b.cj", "func Common() {}\n// body b must stay local")
        f.build([a, b])
        let obj = f.params()
        obj.put("indexRevision", JsonInt(1));
        obj.put("query", JsonString("Common"));
        obj.put("limit", JsonInt(1))
        let report = JsonValue.fromStr(f.rpc.dispatch("knowledge/search", obj.toString())).asObject()
        @Expect(knowledgeIndexRpcTestArray(report, "matches").size(), Int64(1))
        @Expect(report.toString().contains("must stay local"), false)
        @Expect(knowledgeIndexRpcTestArray(report, "files").size(), Int64(0))
    } finally {
        f.close()
    }
}

@Test
func knowledgeIndexRpcLinkedSourceCannotReplaceExistingIndexWhenFixtureAllowsLink() {
    let f = KnowledgeIndexRpcFixture()
    let outsideRoot = canonicalize(Directory.createTemp(Path(coreTestRoot()))).toString()
    var linked = false
    try {
        f.build([f.file("safe.cj", "func Local() {}")])
        let text = "func Outside() {}"
        File.writeTo("${outsideRoot}/outside.cj", text.toArray())
        try {
            SymbolicLink.create("${f.root}/linked", to: outsideRoot);
            linked = true
        } catch (_: Exception) {}
        if (linked) {
            let row = JsonObject()
            row.put("path", JsonString("linked/outside.cj"));
            row.put("digest", JsonString(sha256Hex(text.toArray())))
            let report = f.build([row], revision: 1)
            @Expect(knowledgeIndexRpcTestRevision(report), Int64(1))
            @Expect(knowledgeIndexRpcTestString(report, "lastBuildPhase"), "partial")
            @Expect(knowledgeIndexRpcTestArray(f.search("Outside"), "matches").size(), Int64(0))
            @Expect(knowledgeIndexRpcTestArray(f.search("Local"), "matches").size(), Int64(1))
        } else {
            @Expect(exists("${f.root}/linked"), false)
        }
        @Expect(String.fromUtf8(File.readFrom("${outsideRoot}/outside.cj")), text)
    } finally {
        if (linked) {
            removeIfExists("${f.root}/linked", recursive: false)
        }
        coreTestTidy(outsideRoot);
        f.close()
    }
}

@Test
func knowledgeIndexRpcCancelledReadsReturnNoPartialResponse() {
    let f = KnowledgeIndexRpcFixture()
    try {
        f.build([f.file("safe.cj", "func Safe() {}")])
        let token = TurnToken();
        token.cancel()
        let obj = f.params();
        obj.put("indexRevision", JsonInt(1));
        obj.put("query", JsonString("Safe"))
        @ExpectThrows[Exception](f.rpc.dispatch("knowledge/search", obj.toString(), token: token))
        @ExpectThrows[Exception](f.rpc.dispatch("knowledge/describe-index", f.params().toString(), token: token))
        @Expect(knowledgeIndexRpcTestArray(f.search("Safe"), "matches").size(), Int64(1))
    } finally {
        f.close()
    }
}
