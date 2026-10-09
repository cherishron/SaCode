package core

import std.fs.*
import std.sync.*
import std.unittest.*

// 官方 std.fs 的 createTemp 原子创建唯一目录；保留在 gitignored target 内。
// 不递归清理 Git 只读对象，也不认领或删除其他会话创建的夹具。
func teamWorkspaceFixture(): String {
    return Directory.createTemp("D:/Project/sa/saai/sa-code/core/target/team-workspace-20261008/tmp").toString()
}

@Test
func teamWorkspaceRejectsMemberPathTraversal() {
    let root = teamWorkspaceFixture()
    let workspace = TeamWorkspace(root)
    for (id in ["../outside", "..", "/outside", "a/b", "a\\b", "C:outside", "", "a.b"]) {
        var rejected = false
        try { workspace.prepare(id) }
        catch (e: Exception) { rejected = e.message == "bad-team-member-id" }
        @Expect(rejected, true)
    }
    @Expect(exists("${root}/.sacode-team-workspaces"), false)
}

@Test
func teamWorkspaceGitMemberChangesDoNotChangeLeaderFiles() {
    let root = teamWorkspaceFixture()
    @Assert(gitRun(root, ["init"]).exitCode, Int64(0))
    File.writeTo("${root}/source.txt", "leader".toArray())
    @Assert(gitRun(root, ["add", "source.txt"]).exitCode, Int64(0))
    @Assert(gitRun(root, ["-c", "user.name=TeamTest", "-c", "user.email=team-test@localhost", "commit", "-m", "夹具基线"]).exitCode, Int64(0))
    let workspace = TeamWorkspace(root)
    let member = workspace.prepare("worker-1")
    @Expect(member.isolated, true)
    @Expect(member.directory != canonicalize(root).toString(), true)
    File.writeTo("${member.directory}/source.txt", "worker".toArray())
    @Expect(String.fromUtf8(File.readFrom("${root}/source.txt")), "leader")
    @Expect(String.fromUtf8(File.readFrom("${member.directory}/source.txt")), "worker")
    @Expect(workspace.prepare("worker-1").directory, member.directory)
    @Expect(gitRun(root, ["diff", "--", "source.txt"]).output, "")
}

@Test
func teamWorkspaceNonGitUsesExclusiveSharedWriter() {
    let root = teamWorkspaceFixture()
    let workspace = TeamWorkspace(root)
    let first = workspace.prepare("one")
    @Expect(first.isolated, false)
    @Expect(first.directory, canonicalize(root).toString())
    @Expect(workspace.acquireWriter("one"), true)
    @Expect(workspace.acquireWriter("two"), false)
    workspace.releaseWriter("two")
    @Expect(workspace.acquireWriter("two"), false)
    workspace.releaseWriter("one")
    @Expect(workspace.acquireWriter("two"), true)
    workspace.releaseWriter("two")
}

// 两个 spawn 在主线程同时放行，获胜者在两次 get 之前不得释放。
func teamWorkspaceWriterRace(workspace: TeamWorkspace): String {
    let gate = Mutex()
    let ready = synchronized(gate) { gate.condition() }
    let arrived = AtomicInt64(0)
    let go = AtomicBool(false)
    let first = spawn { =>
        synchronized(gate) {
            arrived.fetchAdd(1)
            ready.notifyAll()
            while (!go.load()) { ready.wait() }
        }
        workspace.acquireWriter("one")
    }
    let second = spawn { =>
        synchronized(gate) {
            arrived.fetchAdd(1)
            ready.notifyAll()
            while (!go.load()) { ready.wait() }
        }
        workspace.acquireWriter("two")
    }
    synchronized(gate) {
        while (arrived.load() != 2) { ready.wait() }
        go.store(true)
        ready.notifyAll()
    }
    let a = first.get(5 * Duration.second)
    let b = second.get(5 * Duration.second)
    @Expect(a != b, true)
    return if (a) { "one" } else { "two" }
}

@Test
func teamWorkspaceWriterSpawnRaceHasExactlyOneOwner() {
    let workspace = TeamWorkspace(teamWorkspaceFixture())
    for (_ in 0..32) {
        let owner = teamWorkspaceWriterRace(workspace)
        @Expect(workspace.acquireWriter(owner), true)
        let other = if (owner == "one") { "two" } else { "one" }
        workspace.releaseWriter(other)
        @Expect(workspace.acquireWriter(other), false)
        workspace.releaseWriter(owner)
    }
}

@Test
func teamWorkspaceWriterSpawnRaceAfterReleaseHasExactlyOneOwner() {
    let workspace = TeamWorkspace(teamWorkspaceFixture())
    for (_ in 0..32) {
        @Assert(workspace.acquireWriter("leader"), true)
        workspace.releaseWriter("leader")
        let owner = teamWorkspaceWriterRace(workspace)
        @Expect(workspace.acquireWriter("leader"), false)
        workspace.releaseWriter(owner)
        @Expect(workspace.acquireWriter("leader"), true)
        workspace.releaseWriter("leader")
    }
}

@Test
func teamWorkspaceGitFailuresNeverBecomeSharedMode() {
    let root = teamWorkspaceFixture()
    for (result in [
        GitQueryResult("", "", 1, false, "git-command-failed"),
        GitQueryResult("", "fatal: not a git repository (or any of the parent directories): .git", -1, false, "git-timeout"),
        GitQueryResult("", "access denied", 128, false, "git-command-failed"),
        GitQueryResult("", "missing executable", -1, false, "git-process-failed"),
        GitQueryResult(root, "", 0, true, "")
    ]) {
        var rejected = false
        try { teamWorkspaceSharedMode(root, result) }
        catch (_: Exception) { rejected = true }
        @Expect(rejected, true)
    }
}

@Test
func teamWorkspaceConfirmedNonGitUsesSharedMode() {
    let root = teamWorkspaceFixture()
    @Expect(teamWorkspaceSharedMode(root, GitQueryResult("", "fatal: not a git repository (or any of the parent directories): .git\n", 128, false, "git-command-failed")), true)
}

@Test
func teamWorkspaceBrokenGitMetadataIsRejected() {
    let root = teamWorkspaceFixture()
    File.writeTo("${root}/.git", "gitdir: missing-directory\n".toArray())
    var rejected = false
    try { TeamWorkspace(root).prepare("one") }
    catch (e: Exception) { rejected = e.message.startsWith("team-workspace-query-failed:") }
    @Expect(rejected, true)
    @Expect(exists("${root}/.sacode-team-workspaces"), false)
}
