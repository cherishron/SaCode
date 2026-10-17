package core

import std.collection.HashMap
import std.fs.*
import std.sync.Mutex

public class TeamWorkspaceEntry {
    public let directory: String
    public let isolated: Bool
    public init(directory: String, isolated: Bool) {
        this.directory = directory
        this.isolated = isolated
    }
}

// 只把 Git 明确确认的非仓库或父仓子目录视为共享模式。
// gitRun 自带两秒超时；进程、权限、损坏元数据等错误必须原样拒绝。
func teamWorkspaceSharedMode(root: String, result: GitQueryResult): Bool {
    if (result.truncated) { throw Exception("team-workspace-query-truncated") }
    if (result.exitCode != 0 || result.failure.size > 0) {
        let diagnostic = result.diagnostic.trimEnd({ r => r == r'\r' || r == r'\n' || r == r' ' })
        if ((result.exitCode == 128 || result.exitCode == 1) && result.failure == "git-command-failed" &&
            diagnostic == "fatal: not a git repository (or any of the parent directories): .git") {
            return true
        }
        throw Exception("team-workspace-query-failed:${result.failure}:${result.exitCode}:${result.diagnostic}")
    }
    let gitRoot = result.output.trimEnd({ r => r == r'\r' || r == r'\n' || r == r' ' })
    if (gitRoot.size == 0) { throw Exception("team-workspace-query-empty") }
    return canonicalize(gitRoot).toString() != root
}

public class TeamWorkspace {
    let root: String
    let mutex = Mutex()
    let entries = HashMap<String, TeamWorkspaceEntry>()
    var writer = ""

    public init(directory: String) {
        this.root = canonicalize(directory).toString()
    }

    private func validate(memberId: String): Unit {
        if (memberId.size == 0 || memberId.size > 80) { throw Exception("bad-team-member-id") }
        for (b in memberId.toArray()) {
            if (!((b >= 97 && b <= 122) || (b >= 65 && b <= 90) || (b >= 48 && b <= 57) || b == 45 || b == 95)) {
                throw Exception("bad-team-member-id")
            }
        }
    }

    public func prepare(memberId: String): TeamWorkspaceEntry {
        validate(memberId)
        synchronized(mutex) {
            if (let Some(entry) <- entries.get(memberId)) { return entry }
            let git = gitRun(root, ["rev-parse", "--show-toplevel"])
            if (teamWorkspaceSharedMode(root, git)) {
                let entry = TeamWorkspaceEntry(root, false)
                entries.add(memberId, entry)
                return entry
            }
            let parent = "${root}/.sacode-team-workspaces"
            if (!exists(parent)) { Directory.create(parent) }
            if (canonicalize(parent).parent.toString() != root) { throw Exception("team-workspace-path-escape") }
            let path = "${parent}/${memberId}"
            // 不认领磁盘上来源不明的目录；仅本实例创建的工作区可复用。
            if (exists(path)) { throw Exception("team-workspace-already-exists") }
            let result = gitRun(root, ["worktree", "add", "--detach", path, "HEAD"])
            if (result.exitCode != 0 || result.truncated || result.failure.size > 0) {
                throw Exception("team-workspace-create-failed:${result.failure}:${result.exitCode}:${result.diagnostic}")
            }
            let entry = TeamWorkspaceEntry(canonicalize(path).toString(), true)
            entries.add(memberId, entry)
            return entry
        }
    }

    public func acquireWriter(memberId: String): Bool {
        validate(memberId)
        synchronized(mutex) {
            if (writer.size > 0 && writer != memberId) { return false }
            writer = memberId
            return true
        }
    }

    public func releaseWriter(memberId: String): Unit {
        synchronized(mutex) {
            if (writer == memberId) { writer = "" }
        }
    }
}
