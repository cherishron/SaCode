package core

import std.collection.*
import std.fs.*
import std.sort.*
import std.sync.*
import stdx.encoding.json.*

// Host/CLI 共用的分派准备层，不注册入口、不授予工作区信任。可信装配方必须先确认
// 文件范围并应用项目 ignore；RPC 只接受该会话当前目录的显式 path+SHA-256 清单。
// 生命周期绑定会话及工作区修订；切换工作区后必须重新装配，不复用旧项目索引。
public class KnowledgeIndexRpc {
    let state: SessionWorkspace
    let sessionId: String
    let workspace: String
    let workspaceRevision: Int64
    let workspaceInfo: FileInfo
    let maxFiles: Int64
    let maxFileBytes: Int64
    let maxTotalBytes: Int64
    let mutex = Mutex()
    var index: KnowledgeIndex
    var revision: Int64 = 0
    var indexDigest = ""
    var lastBuildPhase = "idle"
    var lastBuildUnindexed = JsonArray()

    public init(state: SessionWorkspace, sessionId: String, maxFiles!: Int64 = 10000, maxFileBytes!: Int64 = 1048576,
        maxTotalBytes!: Int64 = 16777216) {
        if (sessionId.trimAscii().size == 0 || sessionId.size > 256) {
            throw Exception("knowledge-index-rpc-bad-session")
        }
        this.state = state
        this.sessionId = sessionId
        this.maxFiles = maxFiles
        this.maxFileBytes = maxFileBytes
        this.maxTotalBytes = maxTotalBytes
        index = KnowledgeIndex(state, maxFiles: maxFiles, maxFileBytes: maxFileBytes, maxTotalBytes: maxTotalBytes)
        workspace = canonicalize(state.directory()).toString()
        workspaceRevision = state.revision()
        workspaceInfo = FileInfo(workspace)
        checkWorkspace()
    }

    public static func handles(method: String): Bool {
        return method == "knowledge/index-build" || method == "knowledge/search" || method == "knowledge/describe-index"
    }

    // describe: {sessionId, workspace, workspaceRevision}
    // build:    上述字段 + indexRevision + files:[{path,digest}]，完整替换范围，不隐式遍历。
    // search:   上述字段 + indexRevision + query + 可选 limit(1..12)。
    // revision 是本分派实例的单调发布号，不泄露临时 KnowledgeIndex 总是从 1 开始的内部代号。
    public func dispatch(method: String, params: String, token!: TurnToken = TurnToken()): String {
        if (!KnowledgeIndexRpc.handles(method)) {
            throw Exception("unsupported:knowledge-index-method")
        }
        if (params.size > 12582912) {
            throw Exception("knowledge-index-rpc-capacity")
        }
        let obj = JsonValue.fromStr(params).asObject()
        synchronized(mutex) {
            checkBinding(obj)
            if (method == "knowledge/describe-index") {
                if (obj.size() != 3) {
                    throw Exception("knowledge-index-rpc-bad-arguments")
                }
                checkCancelled(token)
                return describeLocked().toString()
            }
            let expected = obj.get("indexRevision").getOrThrow().asInt().getValue()
            if (expected != revision) {
                throw Exception("knowledge-index-rpc-revision-conflict")
            }
            if (method == "knowledge/index-build") {
                if (obj.size() != 5) {
                    throw Exception("knowledge-index-rpc-bad-arguments")
                }
                return buildLocked(obj.get("files").getOrThrow().asArray(), token)
            }
            let hasLimit = obj.get("limit").isSome()
            if (obj.size() != if (hasLimit) {
                6
            } else {
                5
            }) {
                throw Exception("knowledge-index-rpc-bad-arguments")
            }
            let query = obj.get("query").getOrThrow().asString().getValue()
            let limit = if (hasLimit) {
                obj.get("limit").getOrThrow().asInt().getValue()
            } else {
                Int64(6)
            }
            if (query.size > 2048 || limit < 1 || limit > 12) {
                throw Exception("knowledge-index-rpc-bad-query")
            }
            return searchLocked(query, limit, token)
        }
    }

    func checkWorkspace(): Unit {
        if (!state.available() || state.revision() != workspaceRevision || canonicalize(state.directory()).toString() !=
            workspace || FileInfo(workspace) != workspaceInfo) {
            throw Exception("knowledge-index-rpc-workspace-changed")
        }
    }

    func checkBinding(obj: JsonObject): Unit {
        if (obj.get("sessionId").getOrThrow().asString().getValue() != sessionId) {
            throw Exception("knowledge-index-rpc-session-mismatch")
        }
        if (obj.get("workspace").getOrThrow().asString().getValue() != workspace ||
            obj.get("workspaceRevision").getOrThrow().asInt().getValue() != workspaceRevision) {
            throw Exception("knowledge-index-rpc-workspace-mismatch")
        }
        checkWorkspace()
    }

    func checkCancelled(token: TurnToken): Unit {
        if (token.cancelled()) {
            throw Exception("knowledge-index-rpc-cancelled")
        }
    }

    func describeLocked(): JsonObject {
        let out = JsonValue.fromStr(index.describe()).asObject()
        out.put("version", JsonInt(1))
        out.put("sessionId", JsonString(sessionId))
        out.put("revision", JsonInt(revision))
        out.put("indexRevision", JsonInt(revision))
        out.put("indexDigest", JsonString(indexDigest))
        out.put("lastBuildPhase", JsonString(lastBuildPhase))
        out.put("lastBuildUnindexed", lastBuildUnindexed)
        out.put("sourceTextIncluded", JsonBool(false))
        return out
    }

    func buildLocked(items: JsonArray, token: TurnToken): String {
        // 先验证完整参数，不因形状错误读取一部分文件或污染当前索引状态。
        if (items.size() > maxFiles) {
            throw Exception("knowledge-index-rpc-capacity")
        }
        let paths = ArrayList<String>()
        let digests = HashMap<String, String>()
        let aliases = HashSet<String>()
        for (i in 0..items.size()) {
            let item = items.get(i).getOrThrow().asObject()
            if (item.size() != 2) {
                throw Exception("knowledge-index-rpc-bad-file")
            }
            let path = knowledgeIndexRelative(item.get("path").getOrThrow().asString().getValue())
            for (b in path.toArray()) {
                if (b < 32 || b == 127) {
                    throw Exception("knowledge-index-rpc-bad-file")
                }
            }
            let digest = item.get("digest").getOrThrow().asString().getValue()
            if (!knowledgeIndexDigest(digest) || !aliases.add(normalizeWriterPath(Path(path)))) {
                throw Exception("knowledge-index-rpc-bad-file")
            }
            paths.add(path)
            digests[path] = digest
        }
        lastBuildUnindexed = JsonArray()
        lastBuildPhase = "indexing"
        try {
            checkCancelled(token)
            // build 的 partial 也只属于候选：不发布半索引，不抹掉上一代可检索范围。
            let candidate = KnowledgeIndex(state, maxFiles: maxFiles, maxFileBytes: maxFileBytes,
                maxTotalBytes: maxTotalBytes)
            let names = paths.toArray()
            sort(names)
            let status = JsonValue.fromStr(candidate.build(names, token: token)).asObject()
            let phase = status.get("phase").getOrThrow().asString().getValue()
            lastBuildUnindexed = status.get("unindexed").getOrThrow().asArray()
            if (phase != "ready") {
                lastBuildPhase = phase
                checkWorkspace()
                checkCancelled(token)
                return describeLocked().toString()
            }
            let files = status.get("files").getOrThrow().asArray()
            if (files.size() != names.size) {
                throw Exception("knowledge-index-rpc-incomplete-build")
            }
            for (i in 0..files.size()) {
                let file = files.get(i).getOrThrow().asObject()
                let path = file.get("path").getOrThrow().asString().getValue()
                let digest = file.get("digest").getOrThrow().asString().getValue()
                if (digests.get(path).isNone() || digests[path] != digest) {
                    throw Exception("knowledge-index-rpc-digest-mismatch")
                }
                // 构建后再走既有磁盘守卫复核；不存原文，也不相信请求里的 digest 是磁盘事实。
                checkCancelled(token)
                if (sha256Hex(candidate.readSource(path, token).toArray()) != digest) {
                    throw Exception("knowledge-index-rpc-digest-mismatch")
                }
            }
            let binding = JsonArray()
            binding.add(JsonString(workspace))
            binding.add(JsonInt(workspaceRevision))
            binding.add(JsonString("bounded-literal-lexical:declaration-heuristic-v1"))
            for (name in names) {
                let file = JsonArray()
                file.add(JsonString(name));
                file.add(JsonString(digests[name]));
                binding.add(file)
            }
            let digest = sha256Hex(binding.toString().toArray())
            checkWorkspace()
            checkCancelled(token)
            index = candidate
            indexDigest = digest
            revision += 1
            lastBuildPhase = "ready"
            return describeLocked().toString()
        } catch (e: Exception) {
            lastBuildPhase = if (token.cancelled()) {
                "cancelled"
            } else {
                "failed"
            }
            throw e
        }
    }

    func searchLocked(query: String, limit: Int64, token: TurnToken): String {
        checkCancelled(token)
        let hits = index.search(query, limit: limit)
        let matches = JsonArray()
        let dropped = JsonArray()
        for (hit in hits) {
            checkCancelled(token)
            let checked = index.verify(hit, token: token)
            let row = JsonObject()
            row.put("path", JsonString(hit.path))
            row.put("digest", JsonString(hit.digest))
            row.put("workspaceRevision", JsonInt(workspaceRevision))
            row.put("indexRevision", JsonInt(revision))
            row.put("symbol", JsonString(hit.symbol))
            row.put("startLine", JsonInt(checked.symbolLine))
            row.put("score", JsonInt(hit.score))
            row.put("status", JsonString(checked.status))
            // verify 的 excerpt 故意不进入 RPC；陈旧/已删除/符号消失只进入 dropped 元数据。
            if (checked.status == "current" && checked.currentDigest == hit.digest) {
                matches.add(row)
            } else {
                dropped.add(row)
            }
        }
        checkWorkspace()
        checkCancelled(token)
        let out = describeLocked()
        out.put("status", JsonString(if (matches.size() > 0) {
            "matched"
        } else if (dropped.size() > 0) {
            "stale-rejected"
        } else {
            "no-match"
        }))
        out.put("queryDigest", JsonString(sha256Hex(query.toArray())))
        out.put("matches", matches)
        out.put("dropped", dropped)
        // 检索响应无需复制整个文件清单；describe-index 才提供完整覆盖元数据。
        out.put("files", JsonArray())
        out.put("unindexed", JsonArray())
        out.put("lastBuildUnindexed", JsonArray())
        let response = out.toString()
        checkWorkspace()
        checkCancelled(token)
        return response
    }
}
