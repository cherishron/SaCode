package core

import std.collection.*
import std.convert.*
import std.env.*
import std.fs.*
import std.process.*
import std.sync.Mutex
import std.time.*
import std.unicode.*
import stdx.encoding.json.*

// 有限 Git 动作服务。prepare 不执行写操作；apply 只接受本实例已保存的动作 ID 和精确票。
// 生产默认不装写后端：现有快照进程提供方不能代替源仓库 Git 权限，禁止裸 shell 兜底。
// 后端仅供可信编译期装配，不是 RPC 参数；其实现还须验证源目录身份、子进程隔离与取消。
public interface GitServiceWriteBackend {
    func supports(kind: String): Bool
    // 只处理 stage/unstage，写 candidateIndex；不得写真实 index/refs/worktree。
    // 必须保留 clean/filter 行为、核对选中内容；取消须收束全部自有进程后才返回。
    func updateIndex(proposal: GitServiceProposal, candidateIndex: String, token: TurnToken): GitQueryResult
    // commit/stash 需要后端的完整源仓库事务，不能拿 index.lock 包住 git commit 导致自锁。
    // supports 必须在并发、hooks、签名及源仓库隔离保证可用时才返回 true。
    func commit(proposal: GitServiceProposal, token: TurnToken): GitQueryResult
    func stash(proposal: GitServiceProposal, token: TurnToken): GitQueryResult
}

public class GitServiceObservation {
    public let directory: String
    public let gitDirectory: String
    public let commonDirectory: String
    public let head: String
    public let indexPath: String
    public let indexDigest: String
    public let indexEntries: String
    public let status: String
    public let filesDigest: String
    public let stashHead: String
    public let workspaceRevision: Int64
    public let digest: String
    init(directory: String, gitDirectory: String, commonDirectory: String, head: String,
        indexPath: String, indexDigest: String, indexEntries: String, status: String,
        filesDigest: String, stashHead: String, workspaceRevision: Int64) {
        this.directory = directory; this.gitDirectory = gitDirectory; this.commonDirectory = commonDirectory
        this.head = head; this.indexPath = indexPath; this.indexDigest = indexDigest
        this.indexEntries = indexEntries; this.status = status; this.filesDigest = filesDigest
        this.stashHead = stashHead; this.workspaceRevision = workspaceRevision
        let fields = JsonArray()
        for (v in [directory, gitDirectory, commonDirectory, head, indexPath, indexDigest,
            indexEntries, status, filesDigest, stashHead, workspaceRevision.toString()]) { fields.add(JsonString(v)) }
        digest = sha256Hex(fields.toString().toArray())
    }
}

public class GitServiceProposal {
    public let id: String
    public let sessionId: String
    public let kind: String
    public let message: String
    public let stashOid: String
    public let observation: GitServiceObservation
    // 数组仅保存在不可变 JSON 中，外部改动返回值不能改变内部授权内容。
    let pathsJson: String
    public let payload: String
    public let digest: String
    init(id: String, sessionId: String, kind: String, paths: Array<String>, message: String,
        stashOid: String, observation: GitServiceObservation) {
        this.id = id; this.sessionId = sessionId; this.kind = kind; this.message = message
        this.stashOid = stashOid; this.observation = observation
        let arr = JsonArray(); for (path in paths) { arr.add(JsonString(path)) }; pathsJson = arr.toString()
        let obj = JsonObject()
        obj.put("version", JsonInt(1)); obj.put("id", JsonString(id)); obj.put("sessionId", JsonString(sessionId))
        obj.put("kind", JsonString(kind)); obj.put("paths", arr); obj.put("message", JsonString(message))
        obj.put("stashOid", JsonString(stashOid)); obj.put("observationDigest", JsonString(observation.digest))
        obj.put("directory", JsonString(observation.directory)); obj.put("head", JsonString(observation.head))
        obj.put("indexDigest", JsonString(observation.indexDigest))
        payload = obj.toString(); digest = sha256Hex(payload.toArray())
    }
    public func paths(): Array<String> {
        let out = ArrayList<String>(); let arr = JsonValue.fromStr(pathsJson).asArray()
        for (i in 0..arr.size()) { out.add(arr.get(i).getOrThrow().asString().getValue()) }
        return out.toArray()
    }
    public func approvalTool(): String { return "workspace/git-${kind}" }
    public func approvalArguments(): String { return "${sessionId}:${id}:${digest}:${payload}" }
}

public class GitServiceResult {
    public let actionId: String
    public let outcome: String
    public let reason: String
    public let exitCode: Int64
    public let verified: Bool
    public let commitOid: String
    public init(actionId: String, outcome: String, reason: String, exitCode!: Int64 = -1,
        verified!: Bool = false, commitOid!: String = "") {
        this.actionId = actionId; this.outcome = outcome; this.reason = reason
        this.exitCode = exitCode; this.verified = verified; this.commitOid = commitOid
    }
    public func toJson(): String {
        let obj = JsonObject(); obj.put("actionId", JsonString(actionId)); obj.put("outcome", JsonString(outcome))
        obj.put("reason", JsonString(reason)); obj.put("exitCode", JsonInt(exitCode))
        obj.put("verified", JsonBool(verified)); obj.put("commitOid", JsonString(commitOid)); return obj.toString()
    }
}

public class GitServiceCommit {
    public let oid: String
    public let parents: String
    public let authorName: String
    public let committedAt: Int64
    public let subject: String
    init(oid: String, parents: String, authorName: String, committedAt: Int64, subject: String) {
        this.oid = oid; this.parents = parents; this.authorName = authorName
        this.committedAt = committedAt; this.subject = subject
    }
}
public class GitServiceLogPage {
    public let anchorOid: String
    public let commits: Array<GitServiceCommit>
    public let nextOffset: Int64
    public init(anchorOid: String, commits: Array<GitServiceCommit>, nextOffset: Int64) {
        this.anchorOid = anchorOid; this.commits = commits; this.nextOffset = nextOffset
    }
}

// 与 checkedPath 同一安全规则：相对、逐组件、禁控制字符/反斜杠/盘符/越界。
// 额外拒 .git、路径魔法、平台别名和目录；Git 参数由本模块固定生成，不接受任意 argv。
public func gitServiceCheckedPath(path: String): String {
    if (path.size == 0 || path.size > 512 || path.startsWith("/") || path.contains("\\") || path.contains(":")) {
        throw Exception("bad-git-path")
    }
    for (b in path.toArray()) { if (b < 32 || b == 127) { throw Exception("bad-git-path") } }
    for (part in path.split("/")) {
        if (part.size == 0 || part == "." || part == ".." || part.toAsciiLower() == ".git" ||
            part.endsWith(".") || part.endsWith(" ") || wtIsWindowsReservedName(part)) { throw Exception("bad-git-path") }
    }
    return path
}

func gsOid(value: String): Bool {
    if (value.size != 40 && value.size != 64) { return false }
    for (b in value.toArray()) { if (!((b >= 48 && b <= 57) || (b >= 97 && b <= 102))) { return false } }
    return true
}
func gsKey(path: String): String { return normalizeWriterPath(Path(path)).replace("\\", "/") }
func gsInside(path: String, root: String): Bool {
    return gsKey(path) == gsKey(root) || gsKey(path).startsWith(gsKey(root) + "/")
}
// 不用全量 File.readFrom；上限+1探测，读失败不返回部分前缀。
func gsRead(path: String, limit: Int64): Array<Byte> {
    let file = File(path, OpenMode.Read)
    try {
        let out = ArrayList<Byte>()
        var done = false
        while (!done) {
            let buffer = Array<Byte>(min(Int64(8192), limit + 1 - out.size), repeat: 0)
            let n = file.read(buffer)
            if (n == 0) {
                done = true
            } else {
                for (i in 0..n) { out.add(buffer[i]) }
                if (out.size > limit) { throw Exception("git-observation-too-large") }
            }
        }
        return out.toArray()
    } finally { file.close() }
}
func gsFileDigest(path: String): String {
    if (!exists(path)) { return "absent" }
    if (!FileInfo(path).isRegular() || FileInfo(path).isSymbolicLink()) { throw Exception("git-path-rejected") }
    return sha256Hex(gsRead(path, 8388608))
}
func gsAssertPath(directory: String, relative: String): Unit {
    gitServiceCheckedPath(relative)
    var path = directory
    for (part in relative.split("/")) {
        path += "/" + part
        if (exists(path)) {
            if (FileInfo(path).isSymbolicLink() || !gsInside(canonicalize(path).toString(), directory)) {
                throw Exception("git-path-rejected")
            }
        }
    }
    if (exists(path) && !FileInfo(path).isRegular()) { throw Exception("git-path-rejected") }
}
func gsNoLinkedAncestors(path: String): Unit {
    var current = Path(path)
    for (_ in 0..256) {
        let info = FileInfo(current)
        if (info.isSymbolicLink()) { throw Exception("git-path-rejected") }
        let parent = current.parent
        if (parent.toString() == current.toString() || parent.toString().size == 0) { return }
        current = parent
    }
    throw Exception("git-path-rejected")
}
func gsText(directory: String, args: Array<String>): String {
    // 复用既有 argv/cwd/有界捕获；这些调用均为固定只读 plumbing，不执行 hooks/filter。
    let fixed = ArrayList<String>()
    for (v in ["--no-optional-locks", "--literal-pathspecs", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false"]) { fixed.add(v) }
    for (v in args) { fixed.add(v) }
    let result = wtGitRun(directory, fixed.toArray())
    // wtRunProgram旧结果不独立转发truncated；达到其保留上限即拒，不拿边界输出作完整数据。
    if (result.exitCode != 0 || result.incomplete || result.timedOut || result.output.size >= 1048576 ||
        result.diagnostic.size >= 1048576) { throw Exception("git-query-failed") }
    return result.output
}

// 私有候选index只读核验。此环境不经RPC输入；GIT_INDEX_FILE只指本事务独占候选。
func gsCandidateEntries(directory: String, index: String): String {
    let env = HashMap<String, String>()
    for ((key, value) in getVariables()) { env[key] = value }
    env["GIT_INDEX_FILE"] = index
    let p = launch("git", ["--no-optional-locks", "--literal-pathspecs", "-c", "core.fsmonitor=false",
        "-C", directory, "ls-files", "--stage", "-z"], workingDirectory: Some(Path(directory)), environment: Some(env),
        stdIn: ProcessRedirect.Discard, stdOut: ProcessRedirect.Pipe, stdErr: ProcessRedirect.Pipe)
    let stdout = spawn { => wtReadPipeBounded(p.stdOutPipe) }
    let stderr = spawn { => wtReadPipeBounded(p.stdErrPipe) }
    var code: Int64 = -1
    try { code = p.wait(timeout: 10 * Duration.second) }
    catch (_: Exception) { p.terminate(force: true); p.wait(timeout: 2 * Duration.second); throw Exception("git-timeout") }
    let out = stdout.get(2 * Duration.second); let err = stderr.get(2 * Duration.second)
    if (code != 0 || out.truncated || !out.complete || err.truncated || !err.complete) { throw Exception("git-index-format-unsupported") }
    return out.text
}
func gsIndexMap(text: String): HashMap<String, String> {
    let map = HashMap<String, String>()
    for (entry in text.split("\0")) {
        if (entry.size == 0) { continue }
        let tab = entry.indexOf("\t") ?? throw Exception("git-index-format-unsupported")
        let record = entry[0..tab].split(" ")
        if (record.size != 3 || (record[0] != "100644" && record[0] != "100755") || !gsOid(record[1]) || record[2] != "0") {
            throw Exception("git-index-format-unsupported")
        }
        let path = gitServiceCheckedPath(entry[tab + 1..entry.size])
        if (map.contains(path)) { throw Exception("git-index-format-unsupported") }
        map[path] = entry[0..tab]
    }
    return map
}
func gsFailureReason(message: String): String {
    for (known in ["git-observation-stale", "git-index-busy", "git-index-lock-lost", "git-index-format-unsupported",
        "git-index-sync-failed", "git-index-scope-mismatch", "git-query-failed", "git-timeout", "git-path-rejected",
        "workspace-changed", "persistence-failed"]) { if (message == known) { return known } }
    // 后端异常可能包含Git配置、URL或凭据，不能原样进入事件和UI。
    return "git-outcome-unknown"
}
func gsAssertIndexScope(before: String, after: String, paths: Array<String>): Unit {
    let old = gsIndexMap(before); let current = gsIndexMap(after); let selected = HashSet<String>()
    for (path in paths) { selected.add(path) }
    for ((path, value) in old) {
        if (!selected.contains(path) && current.get(path) != Some(value)) { throw Exception("git-index-scope-mismatch") }
    }
    for ((path, value) in current) {
        if (!selected.contains(path) && old.get(path) != Some(value)) { throw Exception("git-index-scope-mismatch") }
    }
}
func gsRef(directory: String, refName: String): String {
    let result = gitRun(directory, ["rev-parse", "--verify", "--quiet", refName])
    if (result.exitCode == 1 && !result.truncated) { return "" }
    let value = result.output.trimAscii()
    if (result.failure.size > 0 || result.truncated || !gsOid(value)) { throw Exception("git-reference-unavailable") }
    return value
}
func gsResolve(directory: String, raw: String): String {
    let path = raw.trimAscii()
    return canonicalize(if (Path(path).isAbsolute()) { path } else { "${directory}/${path}" }).toString()
}

class GsStatusEntry {
    let path: String
    let x: String
    let y: String
    init(path: String, x: String, y: String) { this.path = path; this.x = x; this.y = y }
}
func gsStatus(text: String): ArrayList<GsStatusEntry> {
    let out = ArrayList<GsStatusEntry>()
    for (line in text.split("\0")) {
        if (line.size == 0 || line.startsWith("## ")) { continue }
        if (line.size < 4 || line[2..3] != " ") { throw Exception("git-status-unsupported") }
        let x = line[0..1]; let y = line[1..2]
        // 重命名有额外NUL路径；冲突/子模块/特殊index不猜测处理。
        if (x == "R" || x == "C" || y == "R" || y == "C" || x == "U" || y == "U" ||
            (x == "A" && y == "A") || (x == "D" && y == "D")) { throw Exception("git-status-unsupported") }
        out.add(GsStatusEntry(gitServiceCheckedPath(line[3..line.size]), x, y))
    }
    return out
}

// Git锁事务：独占发布 index.lock 后复制私有候选，后端只改候选；最终原子替换真实index。
// 不用 SessionLog 的 .lease 冒充 Git index.lock。仅清理由本实例持有且内容仍匹配的锁。
class GsIndexTransaction {
    let index: String
    let lockPath: String
    let candidate: String
    let marker: String
    var owned = false
    init(index: String) {
        this.index = index; this.lockPath = index + ".lock"
        let temp = File.createTemp(Path(index).parent)
        candidate = temp.info.path.toString(); marker = "sacode-index-" + candidate
        try { temp.write(marker.toArray()) } finally { temp.close() }
        try { nativePublishNewFile(candidate, lockPath); owned = true }
        catch (_: Exception) { removeIfExists(candidate); throw Exception("git-index-busy") }
    }
    func owns(): Bool {
        try { return owned && String.fromUtf8(gsRead(lockPath, 8192)) == marker }
        catch (_: Exception) { return false }
    }
    func seed(): Unit {
        if (!owns()) { throw Exception("git-index-lock-lost") }
        if (exists(index)) { File.writeTo(candidate, gsRead(index, 8388608)) }
    }
    func publish(expectedDigest: String): Unit {
        if (!owns() || gsFileDigest(index) != expectedDigest) { throw Exception("git-observation-stale") }
        // 先核候选确为普通完整index；不把截断输出当index。
        let bytes = gsRead(candidate, 8388608)
        gsIndexHeader(bytes)
        if (!nativeAppendDurable(candidate, bytes, [], bytes.size)) { throw Exception("git-index-sync-failed") }
        // 保持 index.lock 连续存在：私有候选原子替换自己持有的marker，再publish到index。
        nativeReplaceFile(candidate, lockPath)
        owned = false // 锁已变成待发布index，不再允许 marker 清理逻辑删除它。
        nativeReplaceFile(lockPath, index)
    }
    func close(): Unit {
        if (owns()) { removeIfExists(lockPath) }
        removeIfExists(candidate)
    }
}
func gsIndexHeader(bytes: Array<Byte>): Unit {
    if (bytes.size < 12 || bytes[0] != 68 || bytes[1] != 73 || bytes[2] != 82 || bytes[3] != 67 ||
        bytes[4] != 0 || bytes[5] != 0 || bytes[6] != 0 || (bytes[7] != 2 && bytes[7] != 3)) {
        throw Exception("git-index-format-unsupported")
    }
}

public class GitService {
    let log: SessionLog
    let sessionId: String
    let directory: String
    let backend: ?GitServiceWriteBackend
    let mutex = Mutex()
    let actions = HashMap<String, GitServiceProposal>()
    let completed = HashMap<String, GitServiceResult>()
    var frozen = false
    public init(log: SessionLog, sessionId: String, directory: String,
        backend!: ?GitServiceWriteBackend = None) {
        this.log = log; this.sessionId = sessionId; this.directory = canonicalize(directory).toString()
        this.backend = backend
    }
    func workspaceCheck(): Int64 {
        // 不允许继承的Git环境将命令重定向到另一仓库/index或额外配置。
        for ((key, _) in getVariables()) {
            if (key.toAsciiUpper().startsWith("GIT_")) { throw Exception("git-environment-unsupported") }
        }
        let workspace = SessionWorkspace(log)
        if (workspace.directory().size == 0 || gsKey(canonicalize(workspace.directory()).toString()) != gsKey(directory)) {
            throw Exception("workspace-changed")
        }
        return workspace.revision()
    }
    public func observe(): GitServiceObservation { return synchronized(mutex) { observeNow() } }
    func observeNow(): GitServiceObservation {
        let revision = workspaceCheck()
        gsNoLinkedAncestors(directory)
        let status = queryWorkspaceGit(directory, "status", "", "")
        if (status.failure.size > 0 || status.truncated) { throw Exception("git-observation-unavailable") }
        let gitDir = gsResolve(directory, gsText(directory, ["rev-parse", "--absolute-git-dir"]))
        let common = gsResolve(directory, gsText(directory, ["rev-parse", "--git-common-dir"]))
        gsNoLinkedAncestors(gitDir); gsNoLinkedAncestors(common)
        let index = gitDir + "/index"
        for (item in Directory.readFrom(gitDir)) {
            if (item.path.fileName.toString().startsWith("sharedindex.")) { throw Exception("git-index-format-unsupported") }
        }
        if (exists(index)) { gsIndexHeader(gsRead(index, 8388608)) }
        let entries = gsText(directory, ["ls-files", "--stage", "-z"])
        gsIndexMap(entries)
        // 冲突项、submodule、symlink、sparse/split等格式不静默改写。
        for (entry in entries.split("\0")) {
            if (entry.size == 0) { continue }
            let tab = entry.indexOf("\t") ?? throw Exception("git-index-format-unsupported")
            if (!entry[0..tab].endsWith(" 0") || entry.startsWith("160000 ") || entry.startsWith("120000 ")) {
                throw Exception("git-index-format-unsupported")
            }
        }
        for (key in ["core.splitIndex", "core.sparseCheckout"]) {
            let setting = gitRun(directory, ["config", "--bool", "--get", key])
            if ((setting.exitCode != 0 && setting.exitCode != 1) || setting.truncated || setting.output.trimAscii() == "true") {
                throw Exception("git-index-format-unsupported")
            }
        }
        let files = JsonArray(); var count: Int64 = 0
        for (entry in gsStatus(status.output)) {
            count += 1; if (count > 256) { throw Exception("git-observation-too-large") }
            gsAssertPath(directory, entry.path)
            let item = JsonArray(); item.add(JsonString(entry.path))
            item.add(JsonString(gsFileDigest(directory + "/" + entry.path))); files.add(item)
        }
        return GitServiceObservation(directory, gitDir, common, gsRef(directory, "HEAD"), index,
            gsFileDigest(index), entries, status.output, sha256Hex(files.toString().toArray()),
            gsRef(directory, "refs/stash"), revision)
    }
    func persist(event: String, data: String): Unit {
        if (frozen || log.isDurableFrozen()) { throw Exception("persistence-failed") }
        log.append(event, data)
        if (!log.flush()) { frozen = true; log.freezeAfterDurableFailure(); throw Exception("persistence-failed") }
    }
    func selected(paths: Array<String>): Array<String> {
        if (paths.size == 0 || paths.size > 256) { throw Exception("bad-git-paths") }
        let seen = HashSet<String>(); let out = ArrayList<String>(); var size: Int64 = 0
        for (path in paths) {
            gitServiceCheckedPath(path); size += path.size
            if (size > 16000 || !seen.add(path)) { throw Exception("bad-git-paths") }
            gsAssertPath(directory, path); out.add(path)
        }
        return out.toArray()
    }
    func prepare(kind: String, paths: Array<String>, message: String, stashOid: String): GitServiceProposal {
        let observation = observeNow()
        if (kind == "stage" || kind == "unstage" || kind == "stash-push") {
            for (path in paths) {
                var found = false
                for (entry in gsStatus(observation.status)) {
                    if (entry.path != path) { continue }
                    if (kind == "stage" && !((entry.x == " " && entry.y != " ") || (entry.x == "?" && entry.y == "?"))) {
                        throw Exception("git-partial-index-requires-review")
                    }
                    if (kind == "unstage" && (entry.x == " " || entry.x == "?")) { throw Exception("git-path-not-staged") }
                    if (kind == "stash-push" && (entry.x != " " || entry.y == "?")) { throw Exception("git-stash-scope-unsupported") }
                    found = true
                }
                if (!found) { throw Exception("git-path-not-changed") }
            }
        }
        if (kind == "commit") {
            if (message.trimAscii().size == 0 || message.size > 4000 || message.contains("\0")) { throw Exception("bad-git-message") }
            var staged = false
            for (entry in gsStatus(observation.status)) { if (entry.x != " " && entry.x != "?") { staged = true } }
            if (!staged) { throw Exception("git-index-empty") }
        }
        if ((kind == "stash-apply" || kind == "stash-drop") &&
            (!gsOid(stashOid) || observation.stashHead != stashOid)) { throw Exception("git-stash-stale") }
        if (kind.startsWith("stash-") && observation.head.size == 0) { throw Exception("git-stash-unborn-unsupported") }
        if (kind == "stash-push" && stashOid.size > 0) { throw Exception("bad-git-stash-action") }
        let proposal = GitServiceProposal("git-action-${log.eventCount()}", sessionId, kind, paths, message, stashOid, observation)
        persist("git/action-proposal", proposal.payload); actions[proposal.id] = proposal
        return proposal
    }
    public func gitStage(paths: Array<String>): GitServiceProposal {
        return synchronized(mutex) { prepare("stage", selected(paths), "", "") }
    }
    public func gitUnstage(paths: Array<String>): GitServiceProposal {
        return synchronized(mutex) { prepare("unstage", selected(paths), "", "") }
    }
    public func gitCommit(message: String): GitServiceProposal {
        return synchronized(mutex) { prepare("commit", [], message, "") }
    }
    // 这里只准备stash写操作；list/show由gitStashRead独立只读执行。
    public func gitStash(action: String, paths!: Array<String> = [], oid!: String = ""): GitServiceProposal {
        return synchronized(mutex) {
            if (action != "push" && action != "apply" && action != "drop") { throw Exception("bad-git-stash-action") }
            if (action != "push" && paths.size > 0) { throw Exception("bad-git-paths") }
            prepare("stash-${action}", if (action == "push") { selected(paths) } else { [] }, "", oid)
        }
    }
    public func gitLog(anchorOid!: String = "", offset!: Int64 = 0, limit!: Int64 = 50): GitServiceLogPage {
        return synchronized(mutex) {
            workspaceCheck()
            if (limit < 1 || limit > 100 || offset < 0 || offset > 10000 ||
                (offset > 0 && anchorOid.size == 0) || (anchorOid.size > 0 && !gsOid(anchorOid))) {
                throw Exception("bad-git-log-arguments")
            }
            let status = queryWorkspaceGit(directory, "status", "", "")
            if (status.failure.size > 0 || status.truncated) { throw Exception("git-observation-unavailable") }
            let anchor = if (anchorOid.size > 0) { anchorOid } else { gsRef(directory, "HEAD") }
            if (anchor.size == 0) { return GitServiceLogPage("", [], -1) }
            let raw = gsText(directory, ["--no-replace-objects", "log", "--no-show-signature", "--no-decorate",
                "-z", "--format=%H%x00%P%x00%an%x00%ct%x00%s", "--skip=${offset}", "--max-count=${limit + 1}", anchor, "--"])
            let fields = raw.split("\0"); let rows = ArrayList<GitServiceCommit>(); var i: Int64 = 0
            while (i + 4 < fields.size) {
                if (!gsOid(fields[i])) { throw Exception("git-log-format-invalid") }
                for (parent in fields[i + 1].split(" ", removeEmpty: true)) {
                    if (!gsOid(parent)) { throw Exception("git-log-format-invalid") }
                }
                rows.add(GitServiceCommit(fields[i], fields[i + 1], fields[i + 2], Int64.parse(fields[i + 3]), fields[i + 4]))
                i += 5
            }
            if (i < fields.size && (i != fields.size - 1 || fields[i].size > 0)) { throw Exception("git-log-format-invalid") }
            let more = rows.size > limit; let kept = ArrayList<GitServiceCommit>()
            for (j in 0..min(rows.size, limit)) { kept.add(rows[j]) }
            return GitServiceLogPage(anchor, kept.toArray(), if (more) { offset + limit } else { -1 })
        }
    }
    public func gitStashRead(action: String, oid!: String = ""): GitQueryResult {
        return synchronized(mutex) {
            workspaceCheck()
            let status = queryWorkspaceGit(directory, "status", "", "")
            if (status.failure.size > 0 || status.truncated) { throw Exception("git-observation-unavailable") }
            if (action == "list") {
                return gitRun(directory, ["stash", "list", "-z", "--max-count=100", "--format=%H%x00%gs"])
            }
            if (action != "show" || !gsOid(oid)) { throw Exception("bad-git-stash-action") }
            return gitRun(directory, ["stash", "show", "--no-ext-diff", "--no-textconv", "--no-color", "-p", oid])
        }
    }
    public func gitDescribe(actionId: String): GitServiceResult {
        return synchronized(mutex) {
            if (let Some(result) <- completed.get(actionId)) { return result }
            if (actions.contains(actionId)) { return GitServiceResult(actionId, "awaiting-approval", "") }
            var found = false
            var settled: ?GitServiceResult = None
            for (event in log.snapshotEvents()) {
                if (event.eventType == "git/action-proposal") {
                    let obj = JsonValue.fromStr(event.data).asObject()
                    if (obj.get("id").getOrThrow().asString().getValue() == actionId &&
                        obj.get("sessionId").getOrThrow().asString().getValue() == sessionId) { found = true }
                }
                if (found && event.eventType == "git/action-result") {
                    let obj = JsonValue.fromStr(event.data).asObject()
                    if (obj.get("actionId").getOrThrow().asString().getValue() != actionId) { continue }
                    settled = Some(GitServiceResult(actionId, obj.get("outcome").getOrThrow().asString().getValue(),
                        obj.get("reason").getOrThrow().asString().getValue(),
                        exitCode: obj.get("exitCode").getOrThrow().asInt().getValue(),
                        verified: obj.get("verified").getOrThrow().asBool().getValue(),
                        commitOid: obj.get("commitOid").getOrThrow().asString().getValue()))
                }
            }
            if (let Some(result) <- settled) { return result }
            if (found) { return GitServiceResult(actionId, "unknown", "git-action-recovery-read-only") }
            throw Exception("git-action-not-found")
        }
    }
    public func gitApply(actionId: String, approvalId: Int64, desk: ApprovalDesk,
        token!: TurnToken = TurnToken()): GitServiceResult {
        return synchronized(mutex) {
            if (frozen || log.isDurableFrozen()) { throw Exception("persistence-failed") }
            if (let Some(result) <- completed.get(actionId)) { return result }
            let proposal = actions.get(actionId) ?? throw Exception("git-action-recovery-read-only")
            if (token.cancelled()) { return GitServiceResult(actionId, "cancelled-before-start", "cancelled") }
            if (observeNow().digest != proposal.observation.digest) { throw Exception("git-observation-stale") }
            let provider = backend ?? throw Exception("git-provider-unavailable")
            if (!provider.supports(proposal.kind)) { throw Exception("git-provider-unavailable") }
            if (!refEq(desk.log, log) || desk.consumeExactForCall(approvalId, proposal.approvalTool(), proposal.approvalArguments()) != "allowed-once") {
                throw Exception("not-authorized")
            }
            persist("git/action-start", proposal.payload)
            // 开始事件后异常一律结算unknown；不借旧工单重试不确定的Git副作用。
            var result = GitServiceResult(actionId, "unknown", "git-outcome-unknown")
            try {
                if (token.cancelled()) { result = GitServiceResult(actionId, "cancelled-before-start", "cancelled") }
                else if (proposal.kind == "stage" || proposal.kind == "unstage") { result = applyIndex(proposal, provider, token) }
                else {
                    if (observeNow().digest != proposal.observation.digest) { throw Exception("git-observation-stale") }
                    let run = if (proposal.kind == "commit") { provider.commit(proposal, token) } else { provider.stash(proposal, token) }
                    result = finishCommand(proposal, run, token)
                }
            } catch (e: Exception) {
                // provider开始后无法从异常推断“没有副作用”，不报failed并自动重试。
                result = GitServiceResult(actionId, "unknown", gsFailureReason(e.message))
            }
            completed[actionId] = result
            try { persist("git/action-result", result.toJson()) }
            catch (_: Exception) {
                result = GitServiceResult(actionId, "unknown", "persistence-failed"); completed[actionId] = result
            }
            return result
        }
    }
    func applyIndex(proposal: GitServiceProposal, provider: GitServiceWriteBackend, token: TurnToken): GitServiceResult {
        let transaction = GsIndexTransaction(proposal.observation.indexPath)
        try {
            if (observeNow().digest != proposal.observation.digest) { throw Exception("git-observation-stale") }
            transaction.seed()
            let run = provider.updateIndex(proposal, transaction.candidate, token)
            if (run.exitCode != 0 || run.failure.size > 0 || run.truncated) {
                return GitServiceResult(proposal.id, "failed", "git-index-candidate-failed", exitCode: run.exitCode)
            }
            if (token.cancelled()) { return GitServiceResult(proposal.id, "cancelled-before-start", "cancelled") }
            if (!transaction.owns() || observeNow().digest != proposal.observation.digest) { throw Exception("git-observation-stale") }
            let candidateEntries = gsCandidateEntries(directory, transaction.candidate)
            gsAssertIndexScope(proposal.observation.indexEntries, candidateEntries, proposal.paths())
            if (!transaction.owns() || observeNow().digest != proposal.observation.digest) { throw Exception("git-observation-stale") }
            // 核心再核未选路径不变；选中内容/过滤器与原始文件身份由受控后端保证。
            transaction.publish(proposal.observation.indexDigest)
            return GitServiceResult(proposal.id, "succeeded", "", exitCode: 0, verified: true)
        } finally { transaction.close() }
    }
    func finishCommand(proposal: GitServiceProposal, run: GitQueryResult, token: TurnToken): GitServiceResult {
        if (token.cancelled() || run.truncated || run.failure == "git-timeout" || run.exitCode < 0) {
            return GitServiceResult(proposal.id, "unknown", "git-outcome-unknown", exitCode: run.exitCode)
        }
        let head = gsRef(directory, "HEAD")
        if (proposal.kind == "commit") {
            if (run.exitCode != 0 || run.failure.size > 0) {
                return GitServiceResult(proposal.id, if (head == proposal.observation.head) { "failed" } else { "unknown" },
                    "git-commit-failed", exitCode: run.exitCode)
            }
            if (head == proposal.observation.head || !gsOid(head)) { return GitServiceResult(proposal.id, "unknown", "git-commit-not-observed") }
            let parents = gsText(directory, ["show", "--no-patch", "--format=%P", head]).trimAscii()
            let treeEntries = gsText(directory, ["ls-tree", "-r", "-z", head])
            // 索引记录mode oid stage\tpath；commit树mode type oid\tpath，转为共同格式逐字核对。
            var expected = ""
            for (line in treeEntries.split("\0")) {
                if (line.size == 0) { continue }
                let tab = line.indexOf("\t") ?? throw Exception("git-log-format-invalid")
                let fields = line[0..tab].split(" ")
                if (fields.size != 3) { throw Exception("git-log-format-invalid") }
                expected += fields[0] + " " + fields[2] + " 0\t" + line[tab + 1..line.size] + "\0"
            }
            if (parents != proposal.observation.head || expected != proposal.observation.indexEntries) {
                return GitServiceResult(proposal.id, "unknown", "git-commit-scope-mismatch", commitOid: head)
            }
            return GitServiceResult(proposal.id, "succeeded", "", exitCode: 0, verified: true, commitOid: head)
        }
        // stash与worktree原子性由受控后端提供；核心再核refs和冲突，不自动pop/drop。
        let after = gsRef(directory, "refs/stash")
        if (run.exitCode != 0 || run.failure.size > 0) {
            let conflicts = gitRun(directory, ["ls-files", "--unmerged", "-z"])
            if (proposal.kind == "stash-apply" && conflicts.failure.size == 0 && !conflicts.truncated && conflicts.output.size > 0) {
                return GitServiceResult(proposal.id, "conflicted", "git-stash-conflict", exitCode: run.exitCode)
            }
            return GitServiceResult(proposal.id, "unknown", "git-stash-not-settled", exitCode: run.exitCode)
        }
        if (proposal.kind == "stash-push" && (after.size == 0 || after == proposal.observation.stashHead)) {
            return GitServiceResult(proposal.id, "unknown", "git-stash-not-observed")
        }
        if (proposal.kind == "stash-apply" && after != proposal.stashOid) { return GitServiceResult(proposal.id, "unknown", "git-stash-stale") }
        if (proposal.kind == "stash-drop" && after == proposal.stashOid) { return GitServiceResult(proposal.id, "unknown", "git-stash-not-observed") }
        return GitServiceResult(proposal.id, "succeeded", "", exitCode: 0, verified: true)
    }
}
