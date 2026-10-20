package core

import std.collection.*
import std.env.*
import std.fs.*
import std.process.*
import std.time.*
import std.unittest.*

// 仅合成独占仓库：以下裸Git后端只供测试，不是生产受控执行提供方。
// 不自动执行；交给统一构建窗口运行。绝不在用户项目/真实远端暂存或提交。
class GsFixture {
    let root: String
    let repo: String
    let log: SessionLog
    let desk: ApprovalDesk
    init() {
        Directory.create("target/tmp/git-service-tests", recursive: true)
        root = canonicalize(Directory.createTemp("target/tmp/git-service-tests")).toString()
        repo = root + "/repo"; Directory.create(repo)
        let result = wtRunProgram("git", ["init", "-b", "main", repo], root, 10000)
        if (result.exitCode != 0 || result.incomplete) { throw Exception("fixture-git-unavailable") }
        log = SessionLog(root + "/session.log")
        SessionWorkspace(log).setDirectory(repo)
        desk = ApprovalDesk(log)
    }
    func service(backend!: ?GitServiceWriteBackend = None): GitService {
        return GitService(log, "current", repo, backend: backend)
    }
    func write(path: String, text: String): Unit { File.writeTo(repo + "/" + path, text.toArray()) }
    func approve(p: GitServiceProposal): Int64 {
        let id = desk.askForCall(p.approvalTool(), p.approvalArguments(), ttl: 300)
        if (!desk.answer(id, "allowed-once")) { throw Exception("fixture-approval-failed") }
        return id
    }
    func command(args: Array<String>): GitQueryResult {
        let result = wtGitRun(repo, args)
        return GitQueryResult(result.output, result.diagnostic, result.exitCode, result.incomplete,
            if (result.exitCode == 0 && !result.incomplete) { "" } else { "fixture-command-failed" })
    }
    func initial(): Unit {
        write("a.txt", "initial\n")
        if (command(["add", "--", "a.txt"]).exitCode != 0 ||
            command(["-c", "user.name=合成测试", "-c", "user.email=test@example.invalid", "commit", "-m", "initial"]).exitCode != 0) {
            throw Exception("fixture-initial-failed")
        }
    }
    func close(): Unit { coreTestTidy(root) }
}

class GsFixtureBackend <: GitServiceWriteBackend {
    var calls: Int64 = 0
    var failIndex = false
    var tamperCandidate = false
    var changeSource = false
    var commitFailure = false
    var throwCommit = false
    public func supports(kind: String): Bool {
        return kind == "stage" || kind == "unstage" || kind == "commit" ||
            kind == "stash-push" || kind == "stash-apply" || kind == "stash-drop"
    }
    // 精确argv测试驱动；不经shell。GIT_INDEX_FILE仅在此子进程环境中设置。
    func run(repo: String, args: Array<String>, index: String): GitQueryResult {
        let env = HashMap<String, String>(); for ((key, value) in getVariables()) { env[key] = value }
        if (index.size > 0) { env["GIT_INDEX_FILE"] = index }
        let argv = ArrayList<String>()
        for (v in ["--literal-pathspecs", "-c", "user.name=合成测试", "-c", "user.email=test@example.invalid", "-C", repo]) { argv.add(v) }
        for (v in args) { argv.add(v) }
        let p = launch("git", argv.toArray(), workingDirectory: Some(Path(repo)), environment: Some(env),
            stdIn: ProcessRedirect.Discard, stdOut: ProcessRedirect.Pipe, stdErr: ProcessRedirect.Pipe)
        let out = spawn { => wtReadPipeBounded(p.stdOutPipe) }; let err = spawn { => wtReadPipeBounded(p.stdErrPipe) }
        let code = p.wait(timeout: 20 * Duration.second)
        let stdout = out.get(2 * Duration.second); let stderr = err.get(2 * Duration.second)
        return GitQueryResult(stdout.text, stderr.text, code, stdout.truncated || !stdout.complete || !stderr.complete,
            if (code == 0) { "" } else { "fixture-command-failed" })
    }
    public func updateIndex(p: GitServiceProposal, candidate: String, token: TurnToken): GitQueryResult {
        calls += 1
        if (failIndex) { return GitQueryResult("", "合成失败", 1, false, "fixture-command-failed") }
        if (!exists(candidate)) {
            let initResult = run(p.observation.directory, ["read-tree", "--empty"], candidate)
            if (initResult.exitCode != 0) { return initResult }
        }
        let args = ArrayList<String>()
        if (p.kind == "stage") { args.add("add"); args.add("--all") }
        else if (p.observation.head.size == 0) { args.add("update-index"); args.add("--force-remove") }
        else { args.add("reset"); args.add(p.observation.head) }
        args.add("--"); for (path in p.paths()) { args.add(path) }
        let result = run(p.observation.directory, args.toArray(), candidate)
        if (tamperCandidate) { run(p.observation.directory, ["add", "--", "other.txt"], candidate) }
        if (changeSource) { File.writeTo(p.observation.directory + "/a.txt", "后续外部修改\n".toArray()) }
        return result
    }
    public func commit(p: GitServiceProposal, token: TurnToken): GitQueryResult {
        calls += 1
        if (throwCommit) { throw Exception("fixture-transport-lost") }
        if (commitFailure) { return GitQueryResult("", "合成hook/签名拒绝", 1, false, "git-command-failed") }
        return run(p.observation.directory, ["commit", "-m", p.message], "")
    }
    public func stash(p: GitServiceProposal, token: TurnToken): GitQueryResult {
        calls += 1
        if (p.kind == "stash-push") {
            let args = ArrayList<String>(); args.add("stash"); args.add("push"); args.add("--")
            for (path in p.paths()) { args.add(path) }; return run(p.observation.directory, args.toArray(), "")
        }
        if (p.kind == "stash-apply") { return run(p.observation.directory, ["stash", "apply", p.stashOid], "") }
        return run(p.observation.directory, ["stash", "drop", "stash@{0}"], "")
    }
}

func gsTestError(action: () -> Unit): String {
    try { action(); return "" } catch (e: Exception) { return e.message }
}

@When[os == "Windows"]
func gsTestExecutableHook(path: String, root: String): Bool { return true }
@When[os != "Windows"]
func gsTestExecutableHook(path: String, root: String): Bool {
    return wtRunProgram("chmod", ["700", path], root, 5000).exitCode == 0
}

@Test
func gitServiceRejectsUnsafePaths() {
    for (path in ["", ".", "..", "a/../b", "a//b", "/a", "C:/a", "a\\b", ".git/index", "a/.GIT/config", "a\n", "a\0", ":(glob)*", "nul.txt"]) {
        @Expect(gsTestError({=> gitServiceCheckedPath(path); () }), "bad-git-path")
    }
    @Expect(gitServiceCheckedPath("目录/a [1].txt"), "目录/a [1].txt")
    @Expect(gitServiceCheckedPath("-option.txt"), "-option.txt")
}

@Test
func gitServicePrepareDoesNotStageOrCommit() {
    let f = GsFixture()
    try {
        f.write("a.txt", "new\n"); let service = f.service()
        let before = service.observe(); let p = service.gitStage(["a.txt"])
        @Expect(p.kind, "stage"); @Expect(service.observe().indexDigest, before.indexDigest)
        @Expect(gsRef(f.repo, "HEAD"), "")
        let paths = p.paths(); paths[0] = "other.txt"
        @Expect(p.paths()[0], "a.txt")
    } finally { f.close() }
}

@Test
func gitServiceNoProductionBackendFailsClosed() {
    let f = GsFixture()
    try {
        f.write("a.txt", "new\n"); let service = f.service(); let p = service.gitStage(["a.txt"])
        let id = f.approve(p)
        @Expect(gsTestError({=> service.gitApply(p.id, id, f.desk); () }), "git-provider-unavailable")
        @Expect(exists(f.repo + "/.git/index"), false)
    } finally { f.close() }
}

@Test
func gitServiceApprovalIsExactAndActionSpecific() {
    let f = GsFixture()
    try {
        f.write("a.txt", "new\n"); let backend = GsFixtureBackend(); let service = f.service(backend: Some(backend))
        let p = service.gitStage(["a.txt"]); let wrong = f.desk.askForCall("workspace/git-commit", p.approvalArguments())
        f.desk.answer(wrong, "allowed-once")
        @Expect(gsTestError({=> service.gitApply(p.id, wrong, f.desk); () }), "not-authorized")
        @Expect(backend.calls, Int64(0))
    } finally { f.close() }
}

@Test
func gitServiceStagePublishesOnlySelectedPathsAndIsIdempotent() {
    let f = GsFixture()
    try {
        f.write("a.txt", "A\n"); f.write("other.txt", "B\n")
        let backend = GsFixtureBackend(); let service = f.service(backend: Some(backend)); let p = service.gitStage(["a.txt"])
        let id = f.approve(p); let result = service.gitApply(p.id, id, f.desk)
        @Expect(result.outcome, "succeeded"); @Expect(result.verified, true)
        let entries = gsText(f.repo, ["ls-files", "--stage", "-z"])
        @Expect(entries.contains("\ta.txt\0"), true); @Expect(entries.contains("other.txt"), false)
        @Expect(service.gitApply(p.id, id, f.desk).outcome, "succeeded"); @Expect(backend.calls, Int64(1))
        @Expect(exists(f.repo + "/.git/index.lock"), false)
    } finally { f.close() }
}

@Test
func gitServiceUnstageUnbornPreservesWorktree() {
    let f = GsFixture()
    try {
        f.write("a.txt", "A\n"); let backend = GsFixtureBackend(); let service = f.service(backend: Some(backend))
        let stage = service.gitStage(["a.txt"]); service.gitApply(stage.id, f.approve(stage), f.desk)
        let p = service.gitUnstage(["a.txt"]); let result = service.gitApply(p.id, f.approve(p), f.desk)
        @Expect(result.outcome, "succeeded"); @Expect(gsText(f.repo, ["ls-files", "-z"]), "")
        @Expect(String.fromUtf8(gsRead(f.repo + "/a.txt", 100)), "A\n")
    } finally { f.close() }
}

@Test
func gitServiceRejectsPartialStageAndStaleContent() {
    let f = GsFixture()
    try {
        f.write("a.txt", "A\n"); let backend = GsFixtureBackend(); let service = f.service(backend: Some(backend))
        let p = service.gitStage(["a.txt"]); let id = f.approve(p); f.write("a.txt", "later\n")
        @Expect(gsTestError({=> service.gitApply(p.id, id, f.desk); () }), "git-observation-stale")
        @Expect(backend.calls, Int64(0))
        f.command(["add", "--", "a.txt"]); f.write("a.txt", "partial\n")
        @Expect(gsTestError({=> service.gitStage(["a.txt"]); () }), "git-partial-index-requires-review")
    } finally { f.close() }
}

@Test
func gitServiceIndexLockNeverDeletesOtherOwner() {
    let f = GsFixture()
    try {
        f.write("a.txt", "A\n"); let backend = GsFixtureBackend(); let service = f.service(backend: Some(backend))
        let p = service.gitStage(["a.txt"]); File.writeTo(f.repo + "/.git/index.lock", "other-owner".toArray())
        let result = service.gitApply(p.id, f.approve(p), f.desk)
        @Expect(result.outcome, "unknown"); @Expect(result.reason, "git-index-busy")
        @Expect(String.fromUtf8(gsRead(f.repo + "/.git/index.lock", 100)), "other-owner")
        @Expect(backend.calls, Int64(0))
    } finally { f.close() }
}

@Test
func gitServiceCandidateFailureDoesNotPublishIndex() {
    let f = GsFixture()
    try {
        f.write("a.txt", "A\n"); let backend = GsFixtureBackend(); backend.failIndex = true
        let service = f.service(backend: Some(backend)); let p = service.gitStage(["a.txt"])
        @Expect(service.gitApply(p.id, f.approve(p), f.desk).outcome, "failed")
        @Expect(exists(f.repo + "/.git/index"), false); @Expect(exists(f.repo + "/.git/index.lock"), false)
    } finally { f.close() }
}

@Test
func gitServiceCandidateCannotIncludeUnselectedFile() {
    let f = GsFixture()
    try {
        f.write("a.txt", "A\n"); f.write("other.txt", "B\n")
        let backend = GsFixtureBackend(); backend.tamperCandidate = true
        let service = f.service(backend: Some(backend)); let p = service.gitStage(["a.txt"])
        let result = service.gitApply(p.id, f.approve(p), f.desk)
        @Expect(result.outcome, "unknown"); @Expect(result.reason, "git-index-scope-mismatch")
        @Expect(exists(f.repo + "/.git/index"), false)
    } finally { f.close() }
}

@Test
func gitServiceChangeDuringCandidateBuildBlocksPublication() {
    let f = GsFixture()
    try {
        f.write("a.txt", "A\n"); let backend = GsFixtureBackend(); backend.changeSource = true
        let service = f.service(backend: Some(backend)); let p = service.gitStage(["a.txt"])
        @Expect(service.gitApply(p.id, f.approve(p), f.desk).reason, "git-observation-stale")
        @Expect(exists(f.repo + "/.git/index"), false)
        @Expect(String.fromUtf8(gsRead(f.repo + "/a.txt", 100)), "后续外部修改\n")
    } finally { f.close() }
}

@Test
func gitServiceCommitAndLogVerifyRealObject() {
    let f = GsFixture()
    try {
        f.write("a.txt", "A\n"); let backend = GsFixtureBackend(); let service = f.service(backend: Some(backend))
        let stage = service.gitStage(["a.txt"]); service.gitApply(stage.id, f.approve(stage), f.desk)
        let commit = service.gitCommit("合成首提交"); let result = service.gitApply(commit.id, f.approve(commit), f.desk)
        @Expect(result.outcome, "succeeded"); @Expect(result.commitOid, gsRef(f.repo, "HEAD"))
        let page = service.gitLog(limit: 1)
        @Expect(page.commits.size, Int64(1)); @Expect(page.commits[0].subject, "合成首提交")
        @Expect(page.nextOffset, Int64(-1))
    } finally { f.close() }
}

@Test
func gitServiceCommitFailureAndUnknownAreNotReplayed() {
    let f = GsFixture()
    try {
        f.initial(); f.write("a.txt", "updated\n"); f.command(["add", "--", "a.txt"])
        let backend = GsFixtureBackend(); backend.commitFailure = true
        let service = f.service(backend: Some(backend)); let before = gsRef(f.repo, "HEAD")
        let p = service.gitCommit("failure"); let result = service.gitApply(p.id, f.approve(p), f.desk)
        @Expect(result.outcome, "failed"); @Expect(gsRef(f.repo, "HEAD"), before)
        backend.commitFailure = false; backend.throwCommit = true
        let next = service.gitCommit("unknown"); let id = f.approve(next)
        @Expect(service.gitApply(next.id, id, f.desk).outcome, "unknown")
        let calls = backend.calls
        @Expect(service.gitApply(next.id, id, f.desk).outcome, "unknown"); @Expect(backend.calls, calls)
    } finally { f.close() }
}

@Test
func gitServiceLogAnchorsPaginationAndRejectsOptions() {
    let f = GsFixture()
    try {
        f.initial(); f.write("a.txt", "second\n"); f.command(["add", "--", "a.txt"])
        f.command(["-c", "user.name=合成测试", "-c", "user.email=test@example.invalid", "commit", "-m", "second"])
        let service = f.service(); let first = service.gitLog(limit: 1)
        @Expect(first.nextOffset, Int64(1)); @Expect(first.commits[0].subject, "second")
        let next = service.gitLog(anchorOid: first.anchorOid, offset: first.nextOffset, limit: 1)
        @Expect(next.commits[0].subject, "initial"); @Expect(next.nextOffset, Int64(-1))
        @Expect(gsTestError({=> service.gitLog(anchorOid: "--all"); () }), "bad-git-log-arguments")
        @Expect(gsTestError({=> service.gitLog(offset: 1); () }), "bad-git-log-arguments")
    } finally { f.close() }
}

@Test
func gitServiceStashPushApplyPreservesEntryUntilSeparateDrop() {
    let f = GsFixture()
    try {
        f.initial(); f.write("a.txt", "stash-me\n")
        let backend = GsFixtureBackend(); let service = f.service(backend: Some(backend))
        let p = service.gitStash("push", paths: ["a.txt"])
        @Expect(service.gitApply(p.id, f.approve(p), f.desk).outcome, "succeeded")
        let oid = gsRef(f.repo, "refs/stash")
        @Expect(service.gitStashRead("list").output.contains(oid), true)
        let apply = service.gitStash("apply", oid: oid)
        @Expect(service.gitApply(apply.id, f.approve(apply), f.desk).outcome, "succeeded")
        @Expect(gsRef(f.repo, "refs/stash"), oid)
        @Expect(String.fromUtf8(gsRead(f.repo + "/a.txt", 100)), "stash-me\n")
        @Expect(gsTestError({=> service.gitStash("pop"); () }), "bad-git-stash-action")
    } finally { f.close() }
}

@Test
func gitServiceCancellationAndRecoveryNeverStartOldProposal() {
    let f = GsFixture()
    try {
        f.write("a.txt", "A\n"); let backend = GsFixtureBackend(); let service = f.service(backend: Some(backend))
        let p = service.gitStage(["a.txt"]); let token = TurnToken(); token.cancel()
        @Expect(service.gitApply(p.id, f.approve(p), f.desk, token: token).outcome, "cancelled-before-start")
        @Expect(backend.calls, Int64(0))
        let recovered = f.service(backend: Some(backend))
        @Expect(recovered.gitDescribe(p.id).outcome, "unknown")
        @Expect(gsTestError({=> recovered.gitApply(p.id, 0, f.desk); () }), "git-action-recovery-read-only")
    } finally { f.close() }
}

@Test
func gitServicePersistenceFailureBlocksBackend() {
    let f = GsFixture()
    try {
        f.write("a.txt", "A\n"); let backend = GsFixtureBackend(); let service = f.service(backend: Some(backend))
        let p = service.gitStage(["a.txt"]); let id = f.approve(p); f.log.freezeAfterDurableFailure()
        @Expect(gsTestError({=> service.gitApply(p.id, id, f.desk); () }), "persistence-failed")
        @Expect(backend.calls, Int64(0)); @Expect(exists(f.repo + "/.git/index"), false)
    } finally { f.close() }
}

@Test
func gitServiceUnselectedIndexEntriesCannotChange() {
    let oid = "0123456789012345678901234567890123456789"
    let original = "100644 ${oid} 0\ta.txt\0" + "100644 ${oid} 0\tother.txt\0"
    @Expect(gsTestError({=> gsAssertIndexScope(original, "100644 ${oid} 0\ta.txt\0", ["a.txt"]) }), "git-index-scope-mismatch")
}

@Test
func gitServiceUnstageKeepsOtherStagedContent() {
    let f = GsFixture()
    try {
        f.initial(); f.write("a.txt", "changed\n"); f.write("other.txt", "user-staged\n")
        f.command(["add", "--", "a.txt", "other.txt"])
        let backend = GsFixtureBackend(); let service = f.service(backend: Some(backend))
        let before = gsIndexMap(gsText(f.repo, ["ls-files", "--stage", "-z"]))
        let p = service.gitUnstage(["a.txt"])
        @Expect(service.gitApply(p.id, f.approve(p), f.desk).outcome, "succeeded")
        let after = gsIndexMap(gsText(f.repo, ["ls-files", "--stage", "-z"]))
        @Expect(before.get("other.txt"), after.get("other.txt"))
        @Expect(String.fromUtf8(gsRead(f.repo + "/a.txt", 100)), "changed\n")
    } finally { f.close() }
}

@Test
func gitServiceRealHookFailureNeverSkipsHook() {
    let f = GsFixture()
    try {
        f.initial(); f.write("a.txt", "changed\n"); f.command(["add", "--", "a.txt"])
        // 仅本测试仓库的hook；不修改用户配置，不用--no-verify或禁签名绕过。
        File.writeTo(f.repo + "/.git/hooks/pre-commit", "#!/bin/sh\nexit 1\n".toArray())
        @Expect(gsTestExecutableHook(f.repo + "/.git/hooks/pre-commit", f.root), true)
        let backend = GsFixtureBackend(); let service = f.service(backend: Some(backend))
        let head = gsRef(f.repo, "HEAD"); let p = service.gitCommit("must fail hook")
        @Expect(service.gitApply(p.id, f.approve(p), f.desk).outcome, "failed")
        @Expect(gsRef(f.repo, "HEAD"), head)
        @Expect(queryWorkspaceGit(f.repo, "diff", "a.txt", "index").output.contains("+changed"), true)
    } finally { f.close() }
}

@Test
func gitServiceStashDropRequiresAnotherExactApproval() {
    let f = GsFixture()
    try {
        f.initial(); f.write("a.txt", "stash\n")
        let backend = GsFixtureBackend(); let service = f.service(backend: Some(backend))
        let push = service.gitStash("push", paths: ["a.txt"]); let oldTicket = f.approve(push)
        service.gitApply(push.id, oldTicket, f.desk)
        let oid = gsRef(f.repo, "refs/stash"); let drop = service.gitStash("drop", oid: oid)
        @Expect(gsTestError({=> service.gitApply(drop.id, oldTicket, f.desk); () }), "not-authorized")
        @Expect(gsRef(f.repo, "refs/stash"), oid)
        @Expect(service.gitApply(drop.id, f.approve(drop), f.desk).outcome, "succeeded")
        @Expect(gsRef(f.repo, "refs/stash"), "")
    } finally { f.close() }
}

@Test
func gitServiceRejectsBadMessageAndUnsupportedStashBeforeWrite() {
    let f = GsFixture()
    try {
        f.initial(); f.write("a.txt", "new\n"); f.command(["add", "--", "a.txt"])
        let service = f.service()
        @Expect(gsTestError({=> service.gitCommit(" "); () }), "bad-git-message")
        @Expect(gsTestError({=> service.gitCommit("x\0y"); () }), "bad-git-message")
        @Expect(gsTestError({=> service.gitStash("clear"); () }), "bad-git-stash-action")
        @Expect(gsTestError({=> service.gitStash("apply", oid: "stash@{0}"); () }), "git-stash-stale")
    } finally { f.close() }
}
