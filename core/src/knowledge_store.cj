package core

import std.fs.*
import std.collection.ArrayList
import stdx.encoding.json.*

// 知识原文是真源；检索是可重建的字面匹配，不冒充语义索引。
public class KnowledgeStore {
    let root: String
    let path: String
    public let scope: String
    public let workspace: String
    public init(directory: String, scope: String, workspace: String) {
        if (scope != "user" && scope != "project") {
            throw Exception("knowledge-bad-scope")
        }
        this.root = canonicalize(directory).toString()
        this.scope = scope
        this.workspace = if (scope == "project") {
            canonicalize(workspace).toString()
        } else {
            ""
        }
        if (!FileInfo(root).isDirectory() || (scope == "project" && !FileInfo(this.workspace).isDirectory())) {
            throw Exception("knowledge-directory-unavailable")
        }
        let key = if (scope == "user") {
            "user"
        } else {
            sha256Hex(this.workspace.toArray())
        }
        path = "${root}/knowledge-${key}.log"
    }
    public static func forScope(scope: String, workspace: String): KnowledgeStore {
        return KnowledgeStore(Path(GlobalAppearanceSettings.forUser().settingsPath()).parent.toString(), scope,
            workspace)
    }
    public func read(): JsonObject {
        if (exists(path) && (canonicalize(path).parent.toString() != root || !FileInfo(path).isRegular() ||
            FileInfo(path).size > 4194304)) {
            throw Exception("knowledge-path-rejected")
        }
        let log = SessionLog(path)
        if (!log.load() || log.isTruncatedTail()) {
            throw Exception("knowledge-replay-rejected")
        }
        let events = log.snapshotEvents()
        if (events.size == 0) {
            if (exists(path)) {
                throw Exception("knowledge-replay-rejected")
            }
            let obj = JsonObject();
            obj.put("revision", JsonInt(0));
            obj.put("documents", JsonArray())
            obj.put("scope", JsonString(scope));
            obj.put("workspace", JsonString(workspace))
            return obj
        }
        if (events.size != 1 || events[0].eventType != "knowledge/snapshot") {
            throw Exception("knowledge-replay-rejected")
        }
        let obj = JsonValue.fromStr(events[0].data).asObject()
        let revision = obj.get("revision").getOrThrow().asInt().getValue()
        let docs = obj.get("documents").getOrThrow().asArray()
        if (revision < 1 || docs.size() > 200) {
            throw Exception("knowledge-replay-rejected")
        }
        let seen = ArrayList<String>()
        for (value in docs.getItems()) {
            let doc = value.asObject()
            let id = doc.get("id").getOrThrow().asString().getValue()
            let title = doc.get("title").getOrThrow().asString().getValue()
            let content = doc.get("content").getOrThrow().asString().getValue()
            let docRevision = doc.get("revision").getOrThrow().asInt().getValue()
            let kind = doc.get("sourceKind").getOrThrow().asString().getValue()
            if (id.size == 0 || id.size > 80 || title.trimAscii().size == 0 || title.size > 600 || content.size > 65536 ||
                docRevision < 1 || docRevision > revision || (kind != "note" && kind != "file")) {
                throw Exception("knowledge-replay-rejected")
            }
            for (old in seen) {
                if (old == id) {
                    throw Exception("knowledge-replay-rejected")
                }
            }
            seen.add(id)
        }
        if (obj.get("scope").getOrThrow().asString().getValue() != scope ||
            obj.get("workspace").getOrThrow().asString().getValue() != workspace) {
            throw Exception("knowledge-scope-mismatch")
        }
        return obj
    }
    public func query(query: String): String {
        if (query.size > 500) {
            throw Exception("knowledge-bad-query")
        }
        let obj = read();
        let matches = JsonArray()
        for (value in obj.get("documents").getOrThrow().asArray().getItems()) {
            let doc = value.asObject()
            doc.put("sourceStatus", JsonString(sourceStatus(doc)))
            if (query.size == 0 || doc.get("title").getOrThrow().asString().getValue().contains(query) ||
                doc.get("content").getOrThrow().asString().getValue().contains(query)) {
                matches.add(value)
            }
        }
        obj.put("documents", matches);
        obj.put("searchKind", JsonString("literal"))
        return obj.toString()
    }
    public func save(id: String, title: String, content: String, expectedRevision: Int64, remove: Bool,
        sourcePath!: String = ""): String {
        if (id.size == 0 || id.size > 80 || title.size > 600 || content.size > 65536 || expectedRevision < 0 || (!remove &&
            title.trimAscii().size == 0)) {
            throw Exception("knowledge-bad-document")
        }
        let lease = WriteLease(path)
        if (!lease.takeoverIfStale()) {
            throw Exception("knowledge-busy")
        }
        var temporary = ""
        try {
            let obj = read();
            let revision = obj.get("revision").getOrThrow().asInt().getValue()
            if (revision != expectedRevision) {
                throw Exception("knowledge-revision-conflict")
            }
            let docs = JsonArray();
            var found = false
            for (value in obj.get("documents").getOrThrow().asArray().getItems()) {
                if (value.asObject().get("id").getOrThrow().asString().getValue() == id) {
                    found = true
                } else {
                    docs.add(value)
                }
            }
            if (remove && !found) {
                throw Exception("knowledge-not-found")
            }
            if (!remove) {
                let doc = JsonObject();
                doc.put("id", JsonString(id));
                doc.put("title", JsonString(title));
                doc.put("content", JsonString(content))
                doc.put("revision", JsonInt(revision + 1));
                doc.put("sourceKind", JsonString(if (sourcePath.size > 0) {
                    "file"
                } else {
                    "note"
                }))
                doc.put("sourcePath", JsonString(sourcePath));
                doc.put("sourceDigest", JsonString(if (sourcePath.size > 0) {
                    sha256Hex(content.toArray())
                } else {
                    ""
                }));
                docs.add(doc)
            }
            if (docs.size() > 200) {
                throw Exception("knowledge-capacity")
            }
            obj.put("documents", docs);
            obj.put("revision", JsonInt(revision + 1))
            let text = obj.toString()
            if (text.size > 2097152) {
                throw Exception("knowledge-capacity")
            }
            let file = File.createTemp(Path(root));
            temporary = file.info.path.toString()
            file.close()
            if (!appendDurablePrefix(temporary, Array<Byte>(), "0\tknowledge/snapshot\t${escField(text)}\n".toArray())) {
                throw Exception("knowledge-persistence-failed")
            }
            if (!lease.protects(path)) {
                throw Exception("knowledge-owner-unknown")
            }
            nativeReplaceFile(temporary, path)
            return read().toString()
        } finally {
            if (temporary.size > 0) {
                try {
                    removeIfExists(temporary, recursive: false)
                } catch (_: Exception) {}
            }
            lease.release()
        }
    }
    func sourceText(relative: String): String {
        if (scope != "project" || relative.size == 0 || lspIsAbsolutePath(relative) ||
            !lspPathInsideWorkspace(relative, workspace)) {
            throw Exception("knowledge-source-rejected")
        }
        let candidate = lspNormalizePath(relative, workspace)
        let file = FileInfo(candidate)
        if (!file.isRegular() || file.size > 65536) {
            throw Exception("knowledge-source-rejected")
        }
        let bytes = File.readFrom(candidate)
        if (bytes.size > 65536) {
            throw Exception("knowledge-source-rejected")
        }
        let text = String.fromUtf8(bytes)
        if (text.contains("\u{0}")) {
            throw Exception("knowledge-source-rejected")
        }
        return text
    }
    func sourceStatus(doc: JsonObject): String {
        if (doc.get("sourceKind").getOrThrow().asString().getValue() != "file") {
            return "note"
        }
        try {
            let current = sourceText(doc.get("sourcePath").getOrThrow().asString().getValue())
            return if (sha256Hex(current.toArray()) == doc.get("sourceDigest").getOrThrow().asString().getValue()) {
                "current"
            } else {
                "stale"
            }
        } catch (_: Exception) {
            return "unavailable"
        }
    }
    public func importFile(id: String, title: String, relative: String, revision: Int64): String {
        return save(id, title, sourceText(relative), revision, false, sourcePath: relative)
    }
    public func reference(id: String, revision: Int64): String {
        let obj = read()
        if (obj.get("revision").getOrThrow().asInt().getValue() != revision) {
            throw Exception("knowledge-revision-conflict")
        }
        for (value in obj.get("documents").getOrThrow().asArray().getItems()) {
            let doc = value.asObject()
            if (doc.get("id").getOrThrow().asString().getValue() == id) {
                let status = sourceStatus(doc)
                if (status == "stale" || status == "unavailable") {
                    throw Exception("knowledge-source-stale")
                }
                obj.put("document", doc);
                obj.put("documents", JsonArray())
                return obj.toString()
            }
        }
        throw Exception("knowledge-not-found")
    }
}
