package core

import std.unittest.*
import std.collection.ArrayList
import std.fs.*
import std.io.*
import std.process.*

@Test
func gitWorkbenchRejectsWritesAndUnsafePathsBeforeLaunching() {
    @Expect(queryWorkspaceGit("missing", "commit", "", "").failure, "bad-git-query")
    for (path in ["../a", "/a", "a\\b", "C:/a", "a//b", "./a"]) {
        @Expect(queryWorkspaceGit("missing", "diff", path, "working").failure, "bad-git-path")
    }
    @Expect(queryWorkspaceGit("missing", "diff", "a", "unknown").failure, "bad-git-path")
}

@Test
func gitWorkbenchReadsWorkingAndIndexDiffWithoutMutatingIndex() {
    let root = Directory.createTemp(Path(coreTestRoot())).toString()
    try {
        @Expect(launch("git", ["init", root], stdOut: ProcessRedirect.Discard,
            stdErr: ProcessRedirect.Discard).wait(), Int64(0))
        File.writeTo("${root}/a.txt", "original\n".toArray())
        @Expect(launch("git", ["-C", root, "add", "--", "a.txt"],
            stdOut: ProcessRedirect.Discard, stdErr: ProcessRedirect.Discard).wait(), Int64(0))
        let index = File.readFrom("${root}/.git/index")
        File.writeTo("${root}/a.txt", "changed\n".toArray())
        let working = queryWorkspaceGit(root, "diff", "a.txt", "working")
        @Expect(working.failure, "")
        @Expect(working.output.contains("+changed"), true)
        let staged = queryWorkspaceGit(root, "diff", "a.txt", "index")
        @Expect(staged.failure, "")
        @Expect(staged.output.contains("+original"), true)
        @Expect(queryWorkspaceGit(root, "status", "", "").failure, "")
        let after = File.readFrom("${root}/.git/index")
        @Expect(after.size, index.size)
        if (after.size == index.size) {
            for (i in 0..index.size) { @Expect(after[i], index[i]) }
        }
        Directory.create("${root}/child")
        @Expect(queryWorkspaceGit("${root}/child", "status", "", "").failure,
            "workspace-is-not-repository-root")
    } finally { coreTestTidy(root) }
}

@Test
func gitWorkbenchOutputLimitStillDrainsPipe() {
    let pipe = ByteBuffer()
    pipe.write(Array<Byte>(262150, repeat: 97))
    let result = gitReadBounded(pipe)
    @Expect(result.limited, true)
    @Expect(result.text.toArray().size, Int64(262144))
    @Expect(pipe.read(Array<Byte>(1, repeat: 0)), Int64(0))
}

func gitWorkbenchTestCommand(directory: String, action: Array<String>): Int64 {
    let args = ArrayList<String>()
    args.add("-C"); args.add(directory)
    for (item in action) { args.add(item) }
    return launch("git", args.toArray(), stdOut: ProcessRedirect.Discard,
        stdErr: ProcessRedirect.Discard).wait()
}

@Test
func gitWorkbenchPushTargetIsExactAndDoesNotExposeUrls() {
    let root = Directory.createTemp(Path(coreTestRoot())).toString()
    try {
        let repo = "${root}/work"
        let remote = "${root}/remote.git"
        let second = "${root}/second.git"
        Directory.create(repo)
        @Expect(launch("git", ["init", "--bare", remote], stdOut: ProcessRedirect.Discard,
            stdErr: ProcessRedirect.Discard).wait(), Int64(0))
        @Expect(launch("git", ["init", "-b", "main", repo], stdOut: ProcessRedirect.Discard,
            stdErr: ProcessRedirect.Discard).wait(), Int64(0))
        @Expect(gitWorkbenchTestCommand(repo, ["config", "user.name", "SaCode Test"]), Int64(0))
        @Expect(gitWorkbenchTestCommand(repo, ["config", "user.email", "test@example.invalid"]), Int64(0))
        File.writeTo("${repo}/a.txt", "first\n".toArray())
        @Expect(gitWorkbenchTestCommand(repo, ["add", "--", "a.txt"]), Int64(0))
        @Expect(gitWorkbenchTestCommand(repo, ["commit", "-m", "initial"]), Int64(0))
        @Expect(gitWorkbenchTestCommand(repo, ["remote", "add", "origin", remote]), Int64(0))
        @Expect(gitWorkbenchTestCommand(repo, ["push", "-q", "-u", "origin", "main"]), Int64(0))

        let target = queryWorkspaceGitPushTarget(repo)
        @Expect(target.failure, "")
        @Expect(target.diagnostic, "")
        let fields = target.output.split("\n", removeEmpty: true)
        @Expect(fields.size, 3)
        @Expect(fields[0], "origin")
        @Expect(fields[1], "refs/heads/main")
        @Expect(fields[2].size == 40 || fields[2].size == 64, true)

        // A configured push URL may contain credentials; the read contract never returns it.
        @Expect(gitWorkbenchTestCommand(repo,
            ["remote", "set-url", "--push", "origin", "https://user:secret@example.invalid/private.git"]), Int64(0))
        let redacted = queryWorkspaceGitPushTarget(repo)
        @Expect(redacted.failure, "")
        @Expect(redacted.output.contains("secret"), false)
        @Expect(redacted.diagnostic.contains("secret"), false)

        @Expect(launch("git", ["init", "--bare", second], stdOut: ProcessRedirect.Discard,
            stdErr: ProcessRedirect.Discard).wait(), Int64(0))
        @Expect(gitWorkbenchTestCommand(repo, ["remote", "set-url", "--add", "--push", "origin", second]), Int64(0))
        @Expect(queryWorkspaceGitPushTarget(repo).failure, "git-push-multiple-urls")

        @Expect(gitWorkbenchTestCommand(repo, ["config", "--add", "push.pushOption", "unsafe-side-effect"]), Int64(0))
        // Multiple URLs are rejected before push options are consulted.
        @Expect(queryWorkspaceGitPushTarget(repo).failure, "git-push-multiple-urls")
        // Remove both accumulated push URLs explicitly; `remote set-url` cannot
        // reliably collapse an already multi-valued pushurl configuration.
        @Expect(gitWorkbenchTestCommand(repo, ["config", "--unset-all", "remote.origin.pushurl"]), Int64(0))
        @Expect(queryWorkspaceGitPushTarget(repo).failure, "git-push-options-configured")
    } finally { coreTestTidy(root) }
}
