package core
import std.collection.ArrayList
import std.fs.*
import std.io.InputStream
import std.process.*
import std.time.MonoTime

// 只读工作台查询；不经过 shell，不开放任意 argv，不获得 Git 写授权。
class GitOutput {
    let text: String
    let limited: Bool
    init(text: String, limited: Bool) { this.text = text; this.limited = limited }
}
func gitReadBounded(pipe: InputStream): GitOutput {
    let bytes = ArrayList<Byte>()
    let buffer = Array<Byte>(4096, repeat: 0)
    var limited = false
    while (true) {
        let count = pipe.read(buffer)
        if (count == 0) { break }
        for (i in 0..count) {
            if (bytes.size < 262144) { bytes.add(buffer[i]) } else { limited = true }
        }
    }
    // 限额可能切在 UTF-8 字符中间；不伪造损坏的 patch。
    try { return GitOutput(String.fromUtf8(bytes.toArray()), limited) }
    catch (_: Exception) { return GitOutput("", true) }
}
public class GitQueryResult {
    public let output: String
    public let diagnostic: String
    public let exitCode: Int64
    public let truncated: Bool
    public let failure: String
    public init(output: String, diagnostic: String, exitCode: Int64, truncated: Bool, failure: String) {
        this.output = output; this.diagnostic = diagnostic; this.exitCode = exitCode
        this.truncated = truncated; this.failure = failure
    }
}
func gitRun(directory: String, action: Array<String>): GitQueryResult {
    let args = ArrayList<String>()
    for (a in ["--no-optional-locks", "--literal-pathspecs", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-C", directory]) { args.add(a) }
    for (a in action) { args.add(a) }
    try {
        let p = launch("git", args.toArray(), stdIn: ProcessRedirect.Discard, stdOut: ProcessRedirect.Pipe, stdErr: ProcessRedirect.Pipe)
        let out = spawn { => gitReadBounded(p.stdOutPipe) }
        let err = spawn { => gitReadBounded(p.stdErrPipe) }
        var code: Int64 = -1
        var timedOut = false
        let start = MonoTime.now()
        while (true) {
            try { code = p.wait(timeout: 100 * Duration.millisecond); break }
            catch (_: Exception) {
                if ((MonoTime.now() - start).toMilliseconds() >= 2000) {
                    timedOut = true; p.terminate(force: true); code = p.wait(); break
                }
            }
        }
        let stdout = out.get(3000 * Duration.millisecond); let stderr = err.get(3000 * Duration.millisecond)
        return GitQueryResult(stdout.text, stderr.text, code, stdout.limited || stderr.limited,
            if (timedOut) { "git-timeout" } else if (code != 0) { "git-command-failed" } else { "" })
    } catch (e: Exception) { return GitQueryResult("", e.message, -1, false, "git-process-failed") }
}
public func queryWorkspaceGit(directory: String, kind: String, path: String, scope: String): GitQueryResult {
    if (kind != "status" && kind != "diff") { return GitQueryResult("", "", -1, false, "bad-git-query") }
    if (kind == "diff") {
        if (path.size == 0 || path.size > 512 || path.startsWith("/") || path.contains("\\") || path.contains(":") || path.contains("\0") || (scope != "working" && scope != "index")) {
            return GitQueryResult("", "", -1, false, "bad-git-path")
        }
        for (part in path.split("/")) { if (part == ".." || part == "." || part.size == 0) { return GitQueryResult("", "", -1, false, "bad-git-path") } }
    }
    // 不把项目子目录查询扩大到其父仓库。
    let root = gitRun(directory, ["rev-parse", "--show-toplevel"])
    if (root.failure.size > 0 || root.truncated) { return root }
    try {
        if (canonicalize(root.output.trimAscii()).toString() != canonicalize(directory).toString()) {
            return GitQueryResult("", "", -1, false, "workspace-is-not-repository-root")
        }
    } catch (_: Exception) { return GitQueryResult("", "", -1, false, "git-root-unavailable") }
    if (kind == "status") { return gitRun(directory, ["status", "--porcelain=v1", "-z", "--branch", "--untracked-files=normal", "--ignore-submodules=all"]) }
    let args = ArrayList<String>()
    for (a in ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--ignore-submodules=all"]) { args.add(a) }
    if (scope == "index") { args.add("--cached") }
    args.add("--"); args.add(path)
    return gitRun(directory, args.toArray())
}

// Resolve the effective push destination without exposing any configured URL or credential.
// The returned record is remote, refs/heads/<branch>, and the exact current commit object ID.
public func queryWorkspaceGitPushTarget(directory: String): GitQueryResult {
    let root = gitRun(directory, ["rev-parse", "--show-toplevel"])
    if (root.failure.size > 0 || root.truncated) { return root }
    try {
        if (canonicalize(root.output.trimAscii()).toString() != canonicalize(directory).toString()) {
            return GitQueryResult("", "", -1, false, "workspace-is-not-repository-root")
        }
    } catch (_: Exception) { return GitQueryResult("", "", -1, false, "git-root-unavailable") }

    let branchResult = gitRun(directory, ["symbolic-ref", "--quiet", "--short", "HEAD"])
    if (branchResult.failure.size > 0 || branchResult.truncated || branchResult.exitCode != 0) {
        return GitQueryResult("", "", branchResult.exitCode, branchResult.truncated, "git-push-branch-unavailable")
    }
    let branch = branchResult.output.trimAscii()
    if (branch.size == 0 || branch.contains("\n") || branch.contains("\r")) {
        return GitQueryResult("", "", -1, false, "git-push-branch-invalid")
    }

    // %(push:remotename) and %(push:short) reflect the effective push destination,
    // including branch.<name>.pushRemote and remote.pushDefault. Do not infer it from
    // the fetch upstream shown by `git status`.
    let destination = gitRun(directory, ["for-each-ref", "--format=%(push:remotename)\n%(push:short)", "refs/heads/${branch}"])
    if (destination.failure.size > 0 || destination.truncated || destination.exitCode != 0) {
        return GitQueryResult("", "", destination.exitCode, destination.truncated, "git-push-target-unavailable")
    }
    let destinationFields = destination.output.split("\n", removeEmpty: true)
    if (destinationFields.size != 2) {
        return GitQueryResult("", "", 1, false, "git-push-target-unconfigured")
    }
    let remote = destinationFields[0].trimAscii()
    let remoteBranch = destinationFields[1].trimAscii()
    if (remote.size == 0 || remote == "." || remote.startsWith("-") || remote.size > 128 ||
        remote.contains(":") || remote.contains("@") || remote.contains("\\") || remote.contains(" ") ||
        remote.contains("\t") || remote.contains("\r") || remote.contains("\n") ||
        !remoteBranch.startsWith("${remote}/") || remoteBranch.size <= remote.size + 1 ||
        remoteBranch.contains("\r") || remoteBranch.contains("\n")) {
        return GitQueryResult("", "", 1, false, "git-push-target-invalid")
    }
    let branchRef = "refs/heads/${remoteBranch[remote.size + 1..remoteBranch.size]}"

    // One remote alias can have multiple push URLs; Git would send the same authorized
    // ref to each. Reject that configuration instead of silently widening the target.
    let pushUrls = gitRun(directory, ["remote", "get-url", "--push", "--all", "--", remote])
    if (pushUrls.failure.size > 0 || pushUrls.truncated || pushUrls.exitCode != 0) {
        return GitQueryResult("", "", pushUrls.exitCode, pushUrls.truncated, "git-push-url-unavailable")
    }
    if (pushUrls.output.split("\n", removeEmpty: true).size != 1) {
        return GitQueryResult("", "", 1, false, "git-push-multiple-urls")
    }

    // Configured push options can trigger server-side actions outside the displayed ref.
    let pushOptions = gitRun(directory, ["config", "--get-all", "push.pushOption"])
    if (pushOptions.exitCode == 0) {
        return GitQueryResult("", "", 1, false, "git-push-options-configured")
    }
    if (pushOptions.exitCode != 1) {
        return GitQueryResult("", "", pushOptions.exitCode, pushOptions.truncated, "git-push-config-unavailable")
    }
    let mirror = gitRun(directory, ["config", "--bool", "--get", "remote.${remote}.mirror"])
    if (mirror.exitCode == 0 && mirror.output.trimAscii() == "true") {
        return GitQueryResult("", "", 1, false, "git-push-mirror-configured")
    }
    if (mirror.exitCode != 0 && mirror.exitCode != 1) {
        return GitQueryResult("", "", mirror.exitCode, mirror.truncated, "git-push-config-unavailable")
    }

    let head = gitRun(directory, ["rev-parse", "--verify", "HEAD^{commit}"])
    if (head.failure.size > 0 || head.truncated || head.exitCode != 0) {
        return GitQueryResult("", "", head.exitCode, head.truncated, "git-push-head-unavailable")
    }
    let commit = head.output.trimAscii()
    if ((commit.size != 40 && commit.size != 64) || commit.contains("\r") || commit.contains("\n")) {
        return GitQueryResult("", "", 1, false, "git-push-head-invalid")
    }

    // URL output is intentionally discarded. The UI receives only the alias, ref, and OID.
    return GitQueryResult("${remote}\n${branchRef}\n${commit}", "", 0, false, "")
}
