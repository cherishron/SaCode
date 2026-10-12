package core

import std.unittest.*
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
