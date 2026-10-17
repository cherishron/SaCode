package core

@When[os == "Windows"]
import std.collection.*
@When[os == "Windows"]
import std.fs.*
@When[os == "Windows"]
import std.sort.sort
@When[os == "Windows"]
import std.sync.Mutex
@When[os == "Windows"]
import stdx.encoding.json.*

// 仅核心可信装配使用。根路径来自固定句柄的最终名称，读侧不提供写入动作。
@When[os == "Windows"]
class WorkspaceCasResult {
    let error: UInt32
    let mayHaveChanged: Bool
    init(error: UInt32, mayHaveChanged: Bool) {
        this.error = error
        this.mayHaveChanged = mayHaveChanged
    }
}

@When[os == "Windows"]
class WindowsWorkspaceTree {
    let library: WindowsProcessLibrary
    let owned: CPointer<Unit>
    let listCall: CFunc<(CPointer<Unit>, CPointer<UInt16>, CPointer<Byte>, UInt32, CPointer<UInt32>) -> UInt32>
    let readCall: CFunc<(CPointer<Unit>, CPointer<UInt16>, CPointer<Byte>, UInt32, CPointer<UInt32>) -> UInt32>
    let mkdirCall: CFunc<(CPointer<Unit>, CPointer<UInt16>) -> UInt32>
    let writeCall: CFunc<(CPointer<Unit>, CPointer<UInt16>, CPointer<Byte>, UInt32) -> UInt32>
    let casCall: CFunc<(CPointer<Unit>, CPointer<UInt16>, UInt32, CPointer<Byte>, UInt32, CPointer<Byte>, UInt32,
        CPointer<UInt32>) -> UInt32>
    let closeCall: CFunc<(CPointer<Unit>) -> UInt32>
    let path: String
    let identity: String
    let gate = Mutex()
    var closed = false
    init(library: WindowsProcessLibrary, root: String, writable: Bool) {
        let text = fileWidePath(root)
        library.retain()
        var handle = CPointer<Unit>()
        try {
            let open = CFunc<(CPointer<UInt16>, UInt32, CPointer<CPointer<Unit>>) -> UInt32>(
                windowsRequiredExport(library.module, "sacode_windows_tree_open"))
            let describe = CFunc<(CPointer<Unit>, CPointer<Byte>, UInt32, CPointer<UInt32>) -> UInt32>(
                windowsRequiredExport(library.module, "sacode_windows_tree_describe"))
            let list = CFunc<(CPointer<Unit>, CPointer<UInt16>, CPointer<Byte>, UInt32, CPointer<UInt32>) -> UInt32>(
                windowsRequiredExport(library.module, "sacode_windows_tree_list"))
            let read = CFunc<(CPointer<Unit>, CPointer<UInt16>, CPointer<Byte>, UInt32, CPointer<UInt32>) -> UInt32>(
                windowsRequiredExport(library.module, "sacode_windows_tree_read"))
            let mkdir = CFunc<(CPointer<Unit>, CPointer<UInt16>) -> UInt32>(
                windowsRequiredExport(library.module, "sacode_windows_tree_mkdir"))
            let write = CFunc<(CPointer<Unit>, CPointer<UInt16>, CPointer<Byte>, UInt32) -> UInt32>(
                windowsRequiredExport(library.module, "sacode_windows_tree_write_new"))
            let close = CFunc<(CPointer<Unit>) -> UInt32>(
                windowsRequiredExport(library.module, "sacode_windows_tree_close"))
            let p = unsafe { acquireArrayRawData(text) }
            let error = try {
                unsafe { open(p.pointer, if (writable) {
                    UInt32(1)
                } else {
                    UInt32(0)
                }, inout handle) }
            } finally {
                unsafe { releaseArrayRawData(p) }
            }
            if (error != 0 || handle.isNull()) {
                throw Exception("workspace-tree-open:${error}")
            }
            let buffer = Array<Byte>(131072, repeat: 0)
            let memory = unsafe { acquireArrayRawData(buffer) }
            var count: UInt32 = 0
            let described = try {
                unsafe { describe(handle, memory.pointer, UInt32(buffer.size), inout count) }
            } finally {
                unsafe { releaseArrayRawData(memory) }
            }
            if (described != 0 || Int64(count) >= buffer.size) {
                throw Exception("workspace-tree-describe:${described}")
            }
            this.path = String.fromUtf8(buffer[0..Int64(count)])
            let identify = CFunc<(CPointer<Unit>, CPointer<Byte>, UInt32, CPointer<UInt32>) -> UInt32>(
                windowsRequiredExport(library.module, "sacode_windows_tree_identity"))
            let identityBytes = Array<Byte>(49, repeat: 0)
            let identityMemory = unsafe { acquireArrayRawData(identityBytes) }
            count = 0
            let identified = try {
                unsafe { identify(handle, identityMemory.pointer, UInt32(identityBytes.size), inout count) }
            } finally {
                unsafe { releaseArrayRawData(identityMemory) }
            }
            if (identified != 0 || count != 48) {
                throw Exception("workspace-tree-identity-unavailable")
            }
            this.identity = String.fromUtf8(identityBytes[0..Int64(count)])
            this.library = library
            this.owned = handle
            this.listCall = list
            this.readCall = read
            this.mkdirCall = mkdir
            this.writeCall = write
            this.closeCall = close
            this.casCall = CFunc<(CPointer<Unit>, CPointer<UInt16>, UInt32, CPointer<Byte>, UInt32, CPointer<Byte>,
                    UInt32, CPointer<UInt32>) -> UInt32>(
                windowsRequiredExport(library.module, "sacode_windows_tree_compare_exchange"))
        } catch (e: Exception) {
            if (!handle.isNull()) {
                let close = CFunc<(CPointer<Unit>) -> UInt32>(
                    windowsRequiredExport(library.module, "sacode_windows_tree_close"))
                unsafe { close(handle) }
            }
            library.release()
            throw e
        }
    }
    func requireOpen(): Unit {
        if (closed) {
            throw Exception("workspace-tree-closed")
        }
    }
    func bytes(relative: String, directory: Bool): Array<Byte> {
        gate.lock()
        try {
            requireOpen()
            let text = if (relative.size == 0) {
                [UInt16(0)]
            } else {
                fileWidePath(relative)
            }
            let buffer = Array<Byte>(if (directory) {
                2097152
            } else {
                8388608
            }, repeat: 0)
            let p = unsafe { acquireArrayRawData(text) }
            var count: UInt32 = 0
            let error = try {
                let memory = unsafe { acquireArrayRawData(buffer) }
                try {
                    if (directory) {
                        unsafe { listCall(owned, p.pointer, memory.pointer, UInt32(buffer.size), inout count) }
                    } else {
                        unsafe { readCall(owned, p.pointer, memory.pointer, UInt32(buffer.size), inout count) }
                    }
                } finally {
                    unsafe { releaseArrayRawData(memory) }
                }
            } finally {
                unsafe { releaseArrayRawData(p) }
            }
            if (error != 0 || Int64(count) > buffer.size) {
                throw Exception("workspace-tree-read:${error}")
            }
            return buffer[0..Int64(count)]
        } finally {
            gate.unlock()
        }
    }
    func entries(relative: String): Array<String> {
        let values = String.fromUtf8(bytes(relative, true)).split("\u{0}", removeEmpty: true)
        if (values.size > 8192) {
            throw Exception("workspace-snapshot-entry-limit")
        }
        sort(values)
        return values
    }
    func mkdir(relative: String): Unit {
        gate.lock()
        try {
            requireOpen()
            let p = unsafe { acquireArrayRawData(fileWidePath(relative)) }
            let error = try {
                unsafe { mkdirCall(owned, p.pointer) }
            } finally {
                unsafe { releaseArrayRawData(p) }
            }
            if (error != 0) {
                throw Exception("workspace-tree-mkdir:${error}")
            }
        } finally {
            gate.unlock()
        }
    }
    func writeNew(relative: String, bytes: Array<Byte>): Unit {
        if (bytes.size > 8388608) {
            throw Exception("workspace-snapshot-file-limit")
        }
        gate.lock()
        try {
            requireOpen()
            let p = unsafe { acquireArrayRawData(fileWidePath(relative)) }
            let data = if (bytes.size == 0) {
                [UInt8(0)]
            } else {
                bytes
            }
            let error = try {
                let memory = unsafe { acquireArrayRawData(data) }
                try {
                    unsafe { writeCall(owned, p.pointer, memory.pointer, UInt32(bytes.size)) }
                } finally {
                    unsafe { releaseArrayRawData(memory) }
                }
            } finally {
                unsafe { releaseArrayRawData(p) }
            }
            if (error != 0) {
                throw Exception("workspace-tree-write:${error}")
            }
        } finally {
            gate.unlock()
        }
    }
    // 仅可信写回装配调用；调用前必须持久化意图，出错且mayHaveChanged时不得重放。
    func compareExchange(relative: String, expected: ?Array<Byte>, desired: ?Array<Byte>): WorkspaceCasResult {
        if (expected.isNone() && desired.isNone()) {
            throw Exception("workspace-cas-invalid-operation")
        }
        let before = expected ?? []
        let after = desired ?? []
        if (before.size > 8388608 || after.size > 8388608) {
            throw Exception("workspace-snapshot-file-limit")
        }
        gate.lock()
        try {
            requireOpen()
            let name = unsafe { acquireArrayRawData(fileWidePath(relative)) }
            let a = unsafe { acquireArrayRawData(if (before.size > 0) {
                before
            } else {
                [UInt8(0)]
            }) }
            let b = unsafe { acquireArrayRawData(if (after.size > 0) {
                after
            } else {
                [UInt8(0)]
            }) }
            var changed: UInt32 = 0
            let error = try {
                unsafe { casCall(owned, name.pointer, if (expected.isNone()) {
                    UInt32(0)
                } else if (desired.isNone()) {
                    UInt32(2)
                } else {
                    UInt32(1)
                }, a.pointer, UInt32(before.size), b.pointer, UInt32(after.size), inout changed) }
            } finally {
                unsafe {
                    releaseArrayRawData(b);
                    releaseArrayRawData(a);
                    releaseArrayRawData(name)
                }
            }
            return WorkspaceCasResult(error, changed != 0)
        } finally {
            gate.unlock()
        }
    }
    func close(): Unit {
        gate.lock()
        try {
            if (closed) {
                return
            }
            let error = unsafe { closeCall(owned) }
            if (error != 0) {
                throw Exception("workspace-tree-close:${error}")
            }
            closed = true
            library.release()
        } finally {
            gate.unlock()
        }
    }
}

@When[os == "Windows"]
func workspaceSnapshotExcluded(name: String): Bool {
    let lower = name.toAsciiLower()
    return lower == ".git" || lower == "target" || lower == "node_modules"
}

// 只供可信装配使用；解析尚未创建的存储子目录时固定现存祖先。
@When[os == "Windows"]
func workspaceSnapshotOwnedPath(path: String): String {
    let value = Path(path).normalize()
    if (exists(value.toString())) {
        return canonicalize(value).toString()
    }
    let parent = value.parent.toString()
    if (parent.size == 0) {
        return canonicalize(".").join(value.fileName).toString()
    }
    if (parent == value.toString()) {
        throw Exception("workspace-snapshot-owned-path-invalid")
    }
    return Path(workspaceSnapshotOwnedPath(parent)).join(value.fileName).toString()
}

@When[os == "Windows"]
class WorkspaceSnapshotFile {
    let path: String
    let digest: String
    let bytes: Array<Byte>
    init(path: String, bytes: Array<Byte>) {
        this.path = path
        this.digest = sha256Hex(bytes)
        this.bytes = bytes
    }
}

@When[os == "Windows"]
class WorkspaceSnapshotChange {
    let path: String
    let kind: String
    let beforeDigest: String
    let afterDigest: String
    let bytes: Array<Byte>
    init(path: String, kind: String, beforeDigest: String, afterDigest: String, bytes: Array<Byte>) {
        this.path = path
        this.kind = kind
        this.beforeDigest = beforeDigest
        this.afterDigest = afterDigest
        this.bytes = bytes
    }
}

// 清单与数据均有上界；不借助 glob 静默跳过深层、拒绝或在途改变的来源。
@When[os == "Windows"]
class WindowsWorkspaceSnapshot {
    let source: WindowsWorkspaceTree
    let destination: WindowsWorkspaceTree
    let sessionId: String
    let taskId: String
    let requestId: String
    let workspaceRevision: Int64
    let toolBinding: String
    let managed = ArrayList<String>()
    let manifest = ArrayList<String>()
    let skipped = ArrayList<String>()
    let hashes = HashMap<String, String>()
    let gate = Mutex()
    var total: Int64 = 0
    var count: Int64 = 0
    var captured = false
    var attempted = false
    var digest = ""
    init(source: WindowsWorkspaceTree, destination: WindowsWorkspaceTree, sessionId: String, taskId: String,
        requestId: String, workspaceRevision: Int64, ownedPaths!: Array<String> = [], toolBinding!: String = "") {
        if (sessionId.trimAscii().size == 0 || taskId.trimAscii().size == 0 || requestId.trimAscii().size == 0 ||
            workspaceRevision < 1) {
            throw Exception("workspace-snapshot-bad-binding")
        }
        let a = source.path.toAsciiLower().trimEnd({r => r == r'\\'})
        let b = destination.path.toAsciiLower().trimEnd({r => r == r'\\'})
        if (a.size <= 3 || b.size <= 3 || a == b || a.startsWith(b + "\\") || b.startsWith(a + "\\")) {
            throw Exception("workspace-snapshot-overlap")
        }
        this.toolBinding = toolBinding
        this.source = source
        this.destination = destination
        this.sessionId = sessionId
        this.taskId = taskId
        this.requestId = requestId
        this.workspaceRevision = workspaceRevision
        for (owned in ownedPaths) {
            let absolute = workspaceSnapshotOwnedPath(owned).toAsciiLower().trimEnd({r => r == r'\\'})
            if (absolute == a || a.startsWith(absolute + "\\")) {
                throw Exception("workspace-snapshot-owned-root-overlap")
            }
            if (absolute.startsWith(a + "\\")) {
                let relative = absolute[a.size + 1..absolute.size].replace("\\", "/")
                managed.add(relative)
            }
        }
        sort(managed)
    }
    func managedPath(path: String): Bool {
        let lower = path.toAsciiLower()
        for (owned in managed) {
            if (lower == owned || lower.startsWith(owned + "/")) {
                return true
            }
        }
        return false
    }
    // 元数据祖先仍遍历用户条目，但不以空目录出现/消失改变快照。
    func managedAncestor(path: String): Bool {
        let lower = path.toAsciiLower()
        for (owned in managed) {
            if (owned.startsWith(lower + "/")) {
                return true
            }
        }
        return false
    }
    func walk(tree: WindowsWorkspaceTree, relative: String, depth: Int64, copy: Bool, rows: ArrayList<String>,
        files: ArrayList<WorkspaceSnapshotFile>, rejectExcluded: Bool): Unit {
        if (depth > 32) {
            throw Exception("workspace-snapshot-depth-limit")
        }
        for (entry in tree.entries(relative)) {
            if (entry.size < 2) {
                throw Exception("workspace-snapshot-entry-invalid")
            }
            let name = entry[1..entry.size]
            let path = if (relative.size == 0) {
                name
            } else {
                relative + "/" + name
            }
            if (workspaceSnapshotExcluded(name) || managedPath(path)) {
                if (rejectExcluded) {
                    throw Exception("workspace-snapshot-protected-output")
                }
                if (copy) {
                    skipped.add(path)
                }
                continue
            }
            count += 1
            if (count > 8192) {
                throw Exception("workspace-snapshot-entry-limit")
            }
            if (entry.startsWith("D")) {
                if (depth >= 32) {
                    throw Exception("workspace-snapshot-depth-limit")
                }
                if (!managedAncestor(path)) {
                    rows.add("D\t" + path)
                }
                if (copy) {
                    destination.mkdir(path)
                }
                walk(tree, path, depth + 1, copy, rows, files, rejectExcluded)
            } else if (entry.startsWith("F")) {
                let data = tree.bytes(path, false)
                total += data.size
                if (total > 67108864) {
                    throw Exception("workspace-snapshot-total-limit")
                }
                let digest = sha256Hex(data)
                rows.add("F\t" + path + "\t" + digest)
                if (copy) {
                    destination.writeNew(path, data);
                    hashes[path] = digest
                } else if (rejectExcluded) {
                    files.add(WorkspaceSnapshotFile(path, data))
                }
            } else {
                throw Exception("workspace-snapshot-reparse-or-special")
            }
        }
    }
    func capture(): String {
        gate.lock()
        try {
            if (attempted) {
                throw Exception("workspace-snapshot-already-captured")
            }
            attempted = true
            try {
                if (destination.entries("").size != 0) {
                    throw Exception("workspace-snapshot-target-not-empty")
                }
                walk(source, "", 0, true, manifest, ArrayList<WorkspaceSnapshotFile>(), false)
                captured = true
                verifyFresh(sessionId, taskId, requestId, workspaceRevision)
                var text = "${sessionId}\n${taskId}\n${requestId}\n${workspaceRevision}\n${source.path}\n${destination.path}\n${source.identity}\n${destination.identity}\n"
                text += "TOOL\t" + toolBinding + "\n"
                for (owned in managed) {
                    text += "OWNED\t" + owned + "\n"
                }
                for (row in manifest) {
                    text += row + "\n"
                }
                digest = sha256Hex(text.toArray())
                return digest
            } catch (e: Exception) {
                captured = false
                throw e
            }
        } finally {
            gate.unlock()
        }
    }
    func assertFresh(expectedSession: String, expectedTask: String, expectedRequest: String, expectedRevision: Int64): Unit {
        gate.lock()
        try {
            verifyFresh(expectedSession, expectedTask, expectedRequest, expectedRevision)
        } finally {
            gate.unlock()
        }
    }
    // 快照绑定事实仍进入同一会话日志，不创建另一份任务存储。
    func record(log: SessionLog, lease: WriteLease, execution: ExecutionSnapshot): Unit {
        gate.lock()
        try {
            verifyFresh(sessionId, taskId, requestId, workspaceRevision)
            synchronized(log.mtx) {
                let actual = ExecutionService(log, lease, sessionId).describe(execution.id)
                let proposal = JsonValue.fromStr(actual.proposal).asObject()
                if (actual.revision != execution.revision || actual.phase != "awaiting-approval" || actual.proposal != execution
                    .proposal || (proposal.get("cwd").getOrThrow().asString().getValue().toAsciiLower() !=
                    destination.path.toAsciiLower() &&
                    proposal.get("cwd").getOrThrow().asString().getValue().toAsciiLower() != source.path.toAsciiLower()) ||
                    actual.sessionId != sessionId || actual.taskId != taskId || actual.requestId != requestId ||
                    proposal.get("workspaceRevision").getOrThrow().asInt().getValue() != workspaceRevision) {
                    throw Exception("workspace-snapshot-execution-mismatch")
                }
                let receipt = JsonObject()
                receipt.put("executionId", JsonString(actual.id));
                receipt.put("proposalDigest", JsonString(actual.digest))
                receipt.put("sessionId", JsonString(sessionId));
                receipt.put("requestId", JsonString(requestId))
                receipt.put("version", JsonInt(1));
                receipt.put("taskId", JsonString(taskId))
                receipt.put("workspaceRevision", JsonInt(workspaceRevision));
                receipt.put("manifestDigest", JsonString(digest))
                receipt.put("sourceIdentity", JsonString(source.identity));
                receipt.put("sourceDirectory", JsonString(source.path));
                receipt.put("executionDirectory", JsonString(destination.path))
                receipt.put("entryCount", JsonInt(manifest.size));
                receipt.put("byteCount", JsonInt(total))
                let excluded = JsonArray()
                for (path in managed) {
                    excluded.add(JsonString(path))
                }
                for (path in skipped) {
                    excluded.add(JsonString(path))
                }
                receipt.put("excluded", excluded)
                if (toolBinding.size > 0) {
                    receipt.put("toolBinding", JsonString(toolBinding))
                }
                let payload = receipt.toString()
                for (event in log.snapshotEvents()) {
                    if (event.eventType != "execution/workspace-snapshot") {
                        continue
                    }
                    let previous = JsonValue.fromStr(event.data).asObject()
                    if (previous.get("version").getOrThrow().asInt().getValue() != 1) {
                        throw Exception("workspace-snapshot-format-unsupported")
                    }
                    if (previous.get("executionId").getOrThrow().asString().getValue() != actual.id) {
                        continue
                    }
                    if (event.data != payload) {
                        throw Exception("workspace-snapshot-binding-conflict")
                    }
                    if (!log.durableCheckpoint(lease)) {
                        throw Exception("workspace-snapshot-persistence-failed")
                    }
                    return
                }
                log.append("execution/workspace-snapshot", payload)
                if (!log.durableCheckpoint(lease)) {
                    throw Exception("workspace-snapshot-persistence-failed")
                }
            }
        } finally {
            gate.unlock()
        }
    }
    func verifyFresh(expectedSession: String, expectedTask: String, expectedRequest: String, expectedRevision: Int64): Unit {
        if (!captured || expectedSession != sessionId || expectedTask != taskId || expectedRequest != requestId ||
            expectedRevision != workspaceRevision) {
            throw Exception("workspace-snapshot-binding-mismatch")
        }
        count = 0
        total = 0
        let rows = ArrayList<String>()
        walk(source, "", 0, false, rows, ArrayList<WorkspaceSnapshotFile>(), false)
        if (rows.size != manifest.size) {
            throw Exception("workspace-snapshot-source-changed")
        }
        for (i in 0..rows.size) {
            if (rows[i] != manifest[i]) {
                throw Exception("workspace-snapshot-source-changed")
            }
        }
    }
    // 产品装配使用此入口：只信共享日志的当前终态与已持久化快照绑定。
    func settledChanges(log: SessionLog, lease: WriteLease, execution: ExecutionSnapshot): ArrayList<WorkspaceSnapshotChange> {
        synchronized(log.mtx) {
            let actual = ExecutionService(log, lease, sessionId).describe(execution.id)
            if (actual.revision != execution.revision || actual.proposal != execution.proposal || actual.sessionId !=
                sessionId || actual.taskId != taskId || actual.requestId != requestId || actual.phase != "exited") {
                throw Exception("workspace-snapshot-execution-unsettled")
            }
            let result = JsonValue.fromStr(actual.result).asObject()
            if (!result.get("exitObserved").getOrThrow().asBool().getValue() ||
                !result.get("outputComplete").getOrThrow().asBool().getValue()) {
                throw Exception("workspace-snapshot-execution-unsettled")
            }
            var bound = false
            for (event in log.snapshotEvents()) {
                if (event.eventType != "execution/workspace-snapshot") {
                    continue
                }
                let receipt = JsonValue.fromStr(event.data).asObject()
                if (receipt.get("executionId").getOrThrow().asString().getValue() != actual.id) {
                    continue
                }
                if (receipt.get("version").getOrThrow().asInt().getValue() != 1 ||
                    receipt.get("manifestDigest").getOrThrow().asString().getValue() != digest ||
                    receipt.get("proposalDigest").getOrThrow().asString().getValue() != actual.digest ||
                    receipt.get("sourceIdentity").getOrThrow().asString().getValue() != source.identity ||
                    receipt.get("sourceDirectory").getOrThrow().asString().getValue() != source.path ||
                    receipt.get("executionDirectory").getOrThrow().asString().getValue() != destination.path ||
                    receipt.get("sessionId").getOrThrow().asString().getValue() != sessionId ||
                    receipt.get("taskId").getOrThrow().asString().getValue() != taskId ||
                    receipt.get("requestId").getOrThrow().asString().getValue() != requestId ||
                    receipt.get("workspaceRevision").getOrThrow().asInt().getValue() != workspaceRevision) {
                    throw Exception("workspace-snapshot-binding-conflict")
                }
                bound = true
            }
            if (!bound) {
                throw Exception("workspace-snapshot-binding-missing")
            }
        }
        return changedFiles(sessionId, taskId, requestId, workspaceRevision)
    }
    // 复用附件内容寻址存储：先持久化文件字节，再在同一会话日志登记审查清单。
    func recordReview(log: SessionLog, lease: WriteLease, execution: ExecutionSnapshot, store: AttachmentStore): String {
        let changes = settledChanges(log, lease, execution)
        let rows = JsonArray()
        for (change in changes) {
            let row = JsonObject()
            row.put("path", JsonString(change.path));
            row.put("kind", JsonString(change.kind))
            row.put("beforeDigest", JsonString(change.beforeDigest));
            row.put("afterDigest", JsonString(change.afterDigest))
            var before = ""
            var after = ""
            if (change.kind != "added") {
                let bytes = source.bytes(change.path, false)
                if (sha256Hex(bytes) != change.beforeDigest) {
                    throw Exception("workspace-snapshot-source-changed")
                }
                before = store.saveFile(bytes, change.path).attachmentId
                if (sha256Hex(store.read(before)) != change.beforeDigest) {
                    throw Exception("workspace-review-object-corrupt")
                }
            }
            if (change.kind != "deleted") {
                after = store.saveFile(change.bytes, change.path).attachmentId
                if (sha256Hex(store.read(after)) != change.afterDigest) {
                    throw Exception("workspace-review-object-corrupt")
                }
            }
            row.put("beforeObject", JsonString(before));
            row.put("afterObject", JsonString(after))
            rows.add(row)
        }
        // 复制过程中用户仍可编辑原项目，登记前再做一次来源核对。
        assertFresh(sessionId, taskId, requestId, workspaceRevision)
        let receipt = JsonObject()
        receipt.put("version", JsonInt(1));
        receipt.put("executionId", JsonString(execution.id))
        receipt.put("sessionId", JsonString(sessionId));
        receipt.put("taskId", JsonString(taskId))
        receipt.put("requestId", JsonString(requestId));
        receipt.put("executionRevision", JsonInt(execution.revision))
        receipt.put("proposalDigest", JsonString(execution.digest));
        receipt.put("manifestDigest", JsonString(digest))
        receipt.put("sourceIdentity", JsonString(source.identity));
        receipt.put("sourceDirectory", JsonString(source.path));
        receipt.put("files", rows)
        let payload = receipt.toString()
        synchronized(log.mtx) {
            let actual = ExecutionService(log, lease, sessionId).describe(execution.id)
            if (actual.revision != execution.revision || actual.phase != "exited") {
                throw Exception("workspace-snapshot-execution-unsettled")
            }
            for (event in log.snapshotEvents()) {
                if (event.eventType != "execution/review") {
                    continue
                }
                let previous = JsonValue.fromStr(event.data).asObject()
                if (previous.get("executionId").getOrThrow().asString().getValue() != execution.id) {
                    continue
                }
                if (event.data != payload) {
                    throw Exception("workspace-review-conflict")
                }
                if (!log.durableCheckpoint(lease)) {
                    throw Exception("workspace-review-persistence-failed")
                }
                return payload
            }
            log.append("execution/review", payload)
            if (!log.durableCheckpoint(lease)) {
                throw Exception("workspace-review-persistence-failed")
            }
        }
        return payload
    }
    // 只导出数据清单，不写回 source。调用方必须先确认整树终止，之后再走 F08/CAS。
    func changedFiles(expectedSession: String, expectedTask: String, expectedRequest: String, expectedRevision: Int64): ArrayList<WorkspaceSnapshotChange> {
        gate.lock()
        try {
            verifyFresh(expectedSession, expectedTask, expectedRequest, expectedRevision)
            count = 0
            total = 0
            let files = ArrayList<WorkspaceSnapshotFile>()
            walk(destination, "", 0, false, ArrayList<String>(), files, true)
            let changes = ArrayList<WorkspaceSnapshotChange>()
            let seen = HashMap<String, Bool>()
            for (file in files) {
                seen[file.path] = true
                if (!hashes.contains(file.path)) {
                    changes.add(WorkspaceSnapshotChange(file.path, "added", "", file.digest, file.bytes))
                } else if (hashes[file.path] != file.digest) {
                    changes.add(WorkspaceSnapshotChange(file.path, "modified", hashes[file.path], file.digest,
                        file.bytes))
                }
            }
            for (row in manifest) {
                if (!row.startsWith("F\t")) {
                    continue
                }
                let path = row.split("\t")[1]
                if (!seen.contains(path)) {
                    changes.add(WorkspaceSnapshotChange(path, "deleted", hashes[path], "", []))
                }
            }
            return changes
        } finally {
            gate.unlock()
        }
    }
}
