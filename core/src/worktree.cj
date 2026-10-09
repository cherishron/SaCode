package core

import std.collection.ArrayList
import std.convert.*
import std.env.*
import std.fs.*
import std.io.InputStream
import std.process.*
import std.random.Random
import std.sync.Mutex
import std.time.*

// 会话级 worktree 生命周期（计划 T1）。
//
// 三条地基口径，都来自 docs/superpowers/plans/2026-10-08-session-worktree.md：
// 1) 会话日志是唯一真源。绑定、归属、代理在途状态一律写进 SessionLog 事件
//    （worktree/create、worktree/bind、worktree/unbind、worktree/agent），目录切换复用
//    SessionWorkspace 的 workspace/directory。这里不建第二本账：不写旁挂 .json、
//    不靠实例字段跨进程记忆。append 只在实例内可见，flush 由入口负责。
// 2) Git 元数据只用来核验外部实体（分支、脏文件、提交可达性、仓库根），不用来存我们的状态。
//    仓库根必须由 git 自己回答，并且要区分 git-dir 与 common-dir：两者不同就说明当前目录
//    已经是一份链接工作树，嵌套一律拒。
// 3) 删除受三重保护：创建会话归属、未提交文件（含未跟踪，ignored 不算脏）、
//    worktree-<slug> 上未被任何其他本地分支或远程 ref 保留的提交。
//    discardChanges 只能覆盖第二项，第三项没有任何强制通路。
//
// 本文件自带进程调用，不依赖 git_workbench.cj（那还没入库，引了本批提交态就编不过）。
// git 一律 argv 传参，绝不拼 shell 字符串；stdout 与 stderr 都离开等待线程抽干。

// ---------- 常量 ----------

// 固定目录与分支前缀（Global Constraints 冻死的字符串）。
let wtDirectoryName: String = ".sacode"
let wtWorktreesName: String = "worktrees"
let wtBranchPrefix: String = "worktree-"
let wtAgentPrefix: String = "agent-"
let wtNameLimit: Int64 = 64
// PR 抓取给 30 秒；建工作树按检出量级给到两分钟；本地只读核验 10 秒。
// 超了就说明环境出问题，必须 fail-closed，不能让它吊住会话。
let wtFetchTimeoutMs: Int64 = 30000
let wtAddTimeoutMs: Int64 = 120000
let wtGitTimeoutMs: Int64 = 10000
// 过期代理目录门槛：30 天。
let wtAgentMaxAgeSeconds: Int64 = 30 * 24 * 60 * 60
// 保留 ref 集合按 argv 传给 git；超过这个数就 fail-closed，不猜「大概没人保留」。
let wtRetentionRefLimit: Int64 = 400
// 随机名词表：全小写字母，保证生成的名字一定过名称校验。
let wtAdjectives: Array<String> = ["swift", "calm", "brave", "bright", "clever", "eager", "gentle", "steady", "quiet", "lucky"]
let wtNouns: Array<String> = ["river", "maple", "otter", "falcon", "lantern", "harbor", "meadow", "summit", "tundra", "wren"]
let wtHexAlphabet: String = "0123456789abcdef"

// 检查与副作用之间的进程级串行化：同一进程里多个 SessionWorktree 实例（Host 每条 RPC
// 现建一个）共享它。跨进程由 git 自己的 worktree 记账与「目录已消失」复核兜住。
let wtProcessLock = Mutex()

// 事件类型（新增的 worktree 事件族；不进模型可见历史，见 session.cj 的 surface 闭集）。
let wtEventCreate: String = "worktree/create"
let wtEventBind: String = "worktree/bind"
let wtEventUnbind: String = "worktree/unbind"
let wtEventAgent: String = "worktree/agent"

// ---------- 失败出口 ----------

// 错误码是稳定闭集，消息体只有码：细节写进 stderr，别让调用方去解析变长的原因串。
func wtFail(code: String, detail!: String = ""): Nothing {
    if (detail.size > 0) {
        getStdErr().writeln("worktree ${code}: ${detail}")
    }
    throw Exception(code)
}

// ---------- 进程调用 ----------

// 一路管道的读取结果：complete=false 表示流没读完或编码不可解，绝不拿半截正文当空输出。
class WtCapture {
    let text: String
    let truncated: Bool
    let complete: Bool
    init(text: String, truncated: Bool, complete: Bool) {
        this.text = text
        this.truncated = truncated
        this.complete = complete
    }
}

// 读到 EOF 为止：超过限额只丢正文、不丢管道，否则子进程会被反压吊死。
func wtReadPipeBounded(pipe: InputStream, limit!: Int64 = 1048576): WtCapture {
    let kept = ArrayList<Byte>()
    let buffer = Array<Byte>(4096, repeat: 0)
    var truncated = false
    var drained = true
    try {
        while (true) {
            let count = pipe.read(buffer)
            if (count == 0) { break }
            for (i in 0..count) {
                if (kept.size < limit) { kept.add(buffer[i]) } else { truncated = true }
            }
        }
    } catch (e: Exception) {
        drained = false
    }
    if (!drained) { return WtCapture("", truncated, false) }
    try {
        return WtCapture(String.fromUtf8(kept.toArray()), truncated, true)
    } catch (e: Exception) {
        // 非 UTF-8（比如被本地化编码写脏的 stderr）：正文交空但如实标不可解。
        return WtCapture("", truncated, false)
    }
}

public class WtRunResult {
    public let exitCode: Int64
    public let output: String
    public let diagnostic: String
    public let timedOut: Bool
    public let incomplete: Bool
    public init(exitCode: Int64, output: String, diagnostic: String, timedOut: Bool, incomplete: Bool) {
        this.exitCode = exitCode
        this.output = output
        this.diagnostic = diagnostic
        this.timedOut = timedOut
        this.incomplete = incomplete
    }
}

// argv 直传，不经过 shell：程序名与每个参数原样交给 CreateProcess。
// 两个管道都在 spawn 里抽干，主线程只做有界轮询等待；超时先 terminate 再把两路收干。
public func wtRunProgram(program: String, args: Array<String>, directory: String, timeoutMs: Int64): WtRunResult {
    if (timeoutMs < 1 || timeoutMs > 300000) { return WtRunResult(-1, "", "bad-timeout", false, true) }
    if (!exists(directory)) { return WtRunResult(-1, "", "directory-missing", false, true) }
    try {
        let p = launch(program, args, workingDirectory: Some(Path(directory)),
            stdIn: ProcessRedirect.Discard, stdOut: ProcessRedirect.Pipe, stdErr: ProcessRedirect.Pipe)
        let stdout = spawn { => wtReadPipeBounded(p.stdOutPipe) }
        let stderr = spawn { => wtReadPipeBounded(p.stdErrPipe) }
        var code: Int64 = -1
        var timedOut = false
        let start = MonoTime.now()
        while (true) {
            if ((MonoTime.now() - start).toMilliseconds() >= timeoutMs) {
                timedOut = true
                try { p.terminate(force: true); code = p.wait(timeout: 3000 * Duration.millisecond) }
                catch (e: Exception) { code = -1 }
                break
            }
            try { code = p.wait(timeout: 50 * Duration.millisecond); break }
            catch (e: Exception) {}
        }
        var out = WtCapture("", false, false)
        var err = WtCapture("", false, false)
        try { out = stdout.get(5000 * Duration.millisecond) } catch (e: Exception) {}
        try { err = stderr.get(5000 * Duration.millisecond) } catch (e: Exception) {}
        return WtRunResult(code, out.text, err.text, timedOut, timedOut || !out.complete || !err.complete)
    } catch (e: Exception) {
        return WtRunResult(-1, "", e.message, false, true)
    }
}

// git 调用：一律 -C 指定目录 + workingDirectory 同目录，绝不靠进程当前目录。
public func wtGitRun(directory: String, action: Array<String>, timeoutMs!: Int64 = wtGitTimeoutMs): WtRunResult {
    let args = ArrayList<String>()
    args.add("-C")
    args.add(directory)
    for (a in action) { args.add(a) }
    return wtRunProgram("git", args.toArray(), directory, timeoutMs)
}

// 只认成功：非零、超时、流不可解都算 git 读不出来，调用方据此 fail-closed。
func wtGitText(directory: String, action: Array<String>, timeoutMs!: Int64 = wtGitTimeoutMs): String {
    let result = wtGitRun(directory, action, timeoutMs: timeoutMs)
    if (result.timedOut) { wtFail("worktree-git-timeout", detail: action[0]) }
    if (result.incomplete) { wtFail("worktree-git-incomplete", detail: action[0]) }
    if (result.exitCode != 0) { wtFail("worktree-git-failed", detail: "${action[0]}:${result.exitCode}:${result.diagnostic}") }
    return result.output
}

func wtGitCode(directory: String, action: Array<String>): Int64 {
    return wtGitRun(directory, action).exitCode
}

// ---------- 路径工具 ----------

// 只用于比较：统一分隔符并去掉尾部斜杠，不改存储形态。
func wtNormalisedPath(path: String): String {
    var out = path.replace("\\", "/")
    while (out.size > 1 && out.endsWith("/")) { out = out[0..out.size - 1] }
    return out
}

func wtIsUnder(path: String, root: String): Bool {
    let a = wtNormalisedPath(path)
    let b = wtNormalisedPath(root)
    return a == b || a.startsWith("${b}/")
}

func wtJoin(parent: String, child: String): String {
    return Path(parent).join(child).toString()
}

func wtBaseNameOf(path: String): String {
    return Path(path).fileName
}

func wtCanonical(path: String): String {
    var resolved = ""
    try { resolved = canonicalize(path).toString() }
    catch (e: Exception) { wtFail("worktree-path-unavailable", detail: path) }
    return resolved
}

// git 的 --git-common-dir 在主工作树里回相对路径（实测就是 `.git`），在链接工作树里回
// 绝对路径；两种都要按「git 当时所在的目录」解析再规范。
func wtResolveGitPath(directory: String, raw: String): String {
    let trimmed = raw.trimAscii()
    if (trimmed.size == 0) { wtFail("worktree-git-query-empty", detail: directory) }
    let candidate = if (Path(trimmed).isAbsolute()) { trimmed } else { wtJoin(directory, trimmed) }
    return wtCanonical(candidate)
}

func wtParentOf(path: String): String {
    return wtCanonical(Path(path).parent.toString())
}

func wtBaseDirectory(repoRoot: String): String {
    return wtJoin(wtJoin(repoRoot, wtDirectoryName), wtWorktreesName)
}

// 基目录必须是真目录、必须还在仓库根之内：`.sacode` 被人换成符号链接/junction 时，
// worktree 会被建到别人的仓库里，一律拒。
func wtAssertInside(repoRoot: String, path: String): Unit {
    if (!exists(path)) { wtFail("worktree-path-unavailable", detail: path) }
    let real = wtCanonical(path)
    if (wtNormalisedPath(real) == wtNormalisedPath(repoRoot) || !wtIsUnder(real, repoRoot)) {
        wtFail("worktree-base-escape", detail: path)
    }
    // 第二道：重解析点本身。规范路径解析不出来的那一类也要被拦下——宁可误拒，不可能放行。
    // 探针的异常只当「读不出链接位」，不能把拒删的码一起吞掉，所以判空在外面。
    var isLink = false
    try { isLink = FileInfo(path).isSymbolicLink() }
    catch (e: Exception) { isLink = false }
    if (isLink) { wtFail("worktree-base-escape", detail: path) }
}

func wtEnsureBaseDirectory(repoRoot: String): String {
    let marker = wtJoin(repoRoot, wtDirectoryName)
    let base = wtBaseDirectory(repoRoot)
    if (exists(marker)) { wtAssertInside(repoRoot, marker) }
    if (exists(base)) {
        wtAssertInside(repoRoot, base)
        return wtCanonical(base)
    }
    if (!exists(marker)) {
        try { Directory.create(marker, recursive: false) }
        catch (e: Exception) { wtFail("worktree-base-unavailable", detail: e.message) }
        wtAssertInside(repoRoot, marker)
    }
    try { Directory.create(base, recursive: false) }
    catch (e: Exception) { wtFail("worktree-base-unavailable", detail: e.message) }
    // 建完再核一次：中途被人换成链接也要当场发现。
    wtAssertInside(repoRoot, base)
    return wtCanonical(base)
}

// ---------- 名称与引用解析 ----------

let wtReservedDeviceNames: Array<String> = ["con", "prn", "aux", "nul",
    "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
    "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9"]

func wtLowerEquals(a: String, b: String): Bool {
    let left = a.toArray()
    let right = b.toArray()
    if (left.size != right.size) { return false }
    for (i in 0..Int64(left.size)) {
        var x = Int64(left[i])
        var y = Int64(right[i])
        if (x >= 65 && x <= 90) { x += 32 }
        if (y >= 65 && y <= 90) { y += 32 }
        if (x != y) { return false }
    }
    return true
}

// Windows 保留设备名按第一个点段判（`nul.txt` 同样建不出来）。
func wtIsWindowsReservedName(name: String): Bool {
    let head = name.split(".")[0]
    for (reserved in wtReservedDeviceNames) {
        if (wtLowerEquals(head, reserved)) { return true }
    }
    return false
}

// 名称闭集：字母、数字、. _ -，长度 ≤64；另加四条硬规矩——不能是 flag 形态（首字符 -）、
// 不能以 - 或 . 结尾、不能含 ..（穿越）、不能撞 Windows 保留设备名，
// 也不能用 agent- 前缀（那是清理面的保留位：agent 目录会被按前缀老化回收）。
public func wtValidateSlug(raw: String): String {
    if (raw.size == 0 || raw.size > wtNameLimit) { wtFail("worktree-bad-name", detail: raw) }
    let bytes = raw.toArray()
    for (b in bytes) {
        let allowed = (b >= 48 && b <= 57) || (b >= 65 && b <= 90) || (b >= 97 && b <= 122) || b == 46 || b == 95 || b == 45
        if (!allowed) { wtFail("worktree-bad-name", detail: raw) }
    }
    if (bytes[0] == 45) { wtFail("worktree-bad-name", detail: raw) }
    let tail = bytes[Int64(bytes.size) - 1]
    if (tail == 45 || tail == 46) { wtFail("worktree-bad-name", detail: raw) }
    if (raw.contains("..") || raw == ".") { wtFail("worktree-bad-name", detail: raw) }
    if (wtIsWindowsReservedName(raw)) { wtFail("worktree-bad-name", detail: raw) }
    if (raw.startsWith(wtAgentPrefix)) { wtFail("worktree-bad-name", detail: raw) }
    return raw
}

public func wtIsAgentWorktreeName(name: String): Bool {
    return name.startsWith(wtAgentPrefix)
}

func wtBranchOf(name: String): String {
    return "${wtBranchPrefix}${name}"
}

func wtHexByte(value: Int64): Byte {
    return wtHexAlphabet.toArray()[value]
}

// <形容词>-<名词>-<6hex>；hex 取 std.random，本文件不引扩展库。
public func wtGeneratedSlug(): String {
    let r = Random()
    let adjective = wtAdjectives[r.nextInt64(Int64(wtAdjectives.size))]
    let noun = wtNouns[r.nextInt64(Int64(wtNouns.size))]
    let tail = ArrayList<Byte>()
    for (_ in 0..6) { tail.add(wtHexByte(r.nextInt64(16))) }
    return "${adjective}-${noun}-${String.fromUtf8(tail.toArray())}"
}

// 代理目录名固定 agent-<7hex>：按 seed 派生，同一 id 幂等；被占了就换 seed 再派生。
// 滚动哈希自己折，只为把 id 变成 7 位十六进制，不引外部依赖。
// 每步都取模、值域压在 2^25 以内：仓颉的整数溢出是运行时错误，不做无声回绕。
func wtAgentDirName(seed: String): String {
    var laneA: Int64 = 8191
    var laneB: Int64 = 6151
    for (b in seed.toArray()) {
        let value = Int64(b)
        laneA = (laneA * 31 + value) % 1048576
        laneB = (laneB * 37 + value * 7 + 1) % 1048576
    }
    let digits = ArrayList<Byte>()
    var rest = (laneB % 256) * 65536 + laneA
    for (_ in 0..7) {
        digits.add(wtHexByte(rest & 15))
        rest = rest >> 4
    }
    return "${wtAgentPrefix}${String.fromUtf8(digits.toArray())}"
}

public class WtPrReference {
    public let number: Int64
    public let owner: String
    public let repo: String
    public let byUrl: Bool
    public init(number: Int64, owner: String, repo: String, byUrl: Bool) {
        this.number = number
        this.owner = owner
        this.repo = repo
        this.byUrl = byUrl
    }
}

// 编号闭集：纯数字，允许前导零，值在 [1, 2147483647]。
func wtParsePrNumber(raw: String): Int64 {
    if (raw.size == 0 || raw.size > 20) { wtFail("worktree-pr-bad-reference", detail: raw) }
    let bytes = raw.toArray()
    for (b in bytes) { if (b < 48 || b > 57) { wtFail("worktree-pr-bad-reference", detail: raw) } }
    var first: Int64 = 0
    while (first < Int64(bytes.size) - 1 && bytes[first] == 48) { first += 1 }
    let digits = raw[first..raw.size]
    if (digits.size > 10) { wtFail("worktree-pr-bad-reference", detail: raw) }
    let value = Int64.parse(digits)
    if (value < 1 || value > 2147483647) { wtFail("worktree-pr-bad-reference", detail: raw) }
    return value
}

// 只收三种形态：`N`、`#N`、`https://github.com/<owner>/<repo>/pull/<N>`。
// http、带尾斜杠、带额外段、非 github.com 主机都拒——URL 是身份核验的输入，不是装饰。
public func wtParsePrReference(reference: String): WtPrReference {
    let text = reference.trimAscii()
    if (text.startsWith("#")) {
        return WtPrReference(wtParsePrNumber(text[1..text.size]), "", "", false)
    }
    if (text.startsWith("http://")) { wtFail("worktree-pr-bad-reference", detail: reference) }
    if (text.startsWith("https://github.com/")) {
        let rest = text["https://github.com/".size..text.size]
        let parts = rest.split("/")
        if (parts.size != 4) { wtFail("worktree-pr-bad-reference", detail: reference) }
        if (parts[0].size == 0 || parts[1].size == 0 || parts[2] != "pull") { wtFail("worktree-pr-bad-reference", detail: reference) }
        return WtPrReference(wtParsePrNumber(parts[3]), parts[0], parts[1], true)
    }
    if (text.contains("/") || text.contains(":")) { wtFail("worktree-pr-bad-reference", detail: reference) }
    return WtPrReference(wtParsePrNumber(text), "", "", false)
}

// origin 是不是那对 owner/repo：认 https（可带 .git）、scp 与 ssh 形态，大小写不敏感。
// 裸编号（没 owner/repo）时只要求存在 origin，不做主机核验——本机镜像仓也要能用。
public func wtOriginMatches(url: String, owner: String, repo: String): Bool {
    if (url.size == 0) { return false }
    if (owner.size == 0 && repo.size == 0) { return true }
    var tail = url
    if (tail.startsWith("https://github.com/")) {
        tail = tail["https://github.com/".size..tail.size]
    } else if (tail.startsWith("ssh://git@github.com/")) {
        tail = tail["ssh://git@github.com/".size..tail.size]
    } else if (tail.startsWith("git@github.com:")) {
        tail = tail["git@github.com:".size..tail.size]
    } else {
        return false
    }
    if (tail.endsWith("/")) { tail = tail[0..tail.size - 1] }
    if (tail.endsWith(".git")) { tail = tail[0..tail.size - 4] }
    let parts = tail.split("/")
    if (parts.size != 2) { return false }
    return wtLowerEquals(parts[0], owner) && wtLowerEquals(parts[1], repo)
}

// ---------- 仓库根：git 自己说，并且分清 git-dir 与 common-dir ----------

public class WtRoots {
    public let repoRoot: String
    public let worktreeRoot: String
    public let gitCommonDir: String
    public let linked: Bool
    public init(repoRoot: String, worktreeRoot: String, gitCommonDir: String, linked: Bool) {
        this.repoRoot = repoRoot
        this.worktreeRoot = worktreeRoot
        this.gitCommonDir = gitCommonDir
        this.linked = linked
    }
}

// 链接工作树的 git-dir 是 <repo>/.git/worktrees/<id>，common-dir 是 <repo>/.git：
// 两者不同即「已经在工作树里」。仓库根按 common-dir 折出来（主工作树与链接工作树同解）。
public func wtRepoRoots(directory: String): WtRoots {
    if (directory.size == 0) { wtFail("worktree-no-directory") }
    if (!exists(directory)) { wtFail("worktree-directory-missing", detail: directory) }
    let top = wtGitText(directory, ["rev-parse", "--show-toplevel"])
    let gitDir = wtResolveGitPath(directory, wtGitText(directory, ["rev-parse", "--absolute-git-dir"]))
    let common = wtResolveGitPath(directory, wtGitText(directory, ["rev-parse", "--git-common-dir"]))
    let worktreeRoot = wtResolveGitPath(directory, top)
    let repoRoot = if (wtLowerEquals(wtBaseNameOf(common), ".git")) { wtParentOf(common) } else { common }
    if (!exists(repoRoot) || !FileInfo(repoRoot).isDirectory()) { wtFail("worktree-not-a-repository", detail: repoRoot) }
    return WtRoots(repoRoot, worktreeRoot, common, wtNormalisedPath(gitDir) != wtNormalisedPath(common))
}

// ---------- git 侧核验：脏文件与独有提交 ----------

// porcelain v1 + -z + --no-renames：一条记录一个 NUL 结尾，改名拆成删除与新增两条，
// 计数就不必再解析配对的原始路径。ignored 不进（默认就不进，也不加 --ignored）。
func wtStatusRecords(directory: String, includeUntracked: Bool): Int64 {
    let args = ArrayList<String>()
    for (a in ["status", "--porcelain=v1", "-z", "--no-renames", "--ignore-submodules=all"]) { args.add(a) }
    args.add(if (includeUntracked) { "--untracked-files=all" } else { "--untracked-files=no" })
    let output = wtGitText(directory, args.toArray())
    var count: Int64 = 0
    for (b in output.toArray()) { if (b == 0) { count += 1 } }
    return count
}

// 删除保护用的「未提交」口径：已跟踪 + 未跟踪，ignored 不算脏。
public func wtStatusCount(directory: String): Int64 {
    return wtStatusRecords(directory, true)
}

// 过期清理用的口径：条款只看未提交的已跟踪改动。
public func wtTrackedStatusCount(directory: String): Int64 {
    return wtStatusRecords(directory, false)
}

// ref 上不被任何其他本地分支 / 远程 ref / 标签保留的提交数。
// 保留集按 argv 传给 rev-list；条数超上限就 fail-closed（宁可拒删，不猜「没人保留」）。
public func wtUniqueCommits(directory: String, ref: String): Int64 {
    let listed = wtGitText(directory, ["for-each-ref", "--exclude=${ref}", "--format=%(refname)",
        "refs/heads", "refs/remotes", "refs/tags"])
    let retainers = ArrayList<String>()
    for (line in listed.split("\n")) {
        let name = line.trimAscii()
        if (name.size > 0) { retainers.add(name) }
    }
    if (retainers.size > wtRetentionRefLimit) { wtFail("worktree-retention-unbounded", detail: "${retainers.size}") }
    let args = ArrayList<String>()
    for (a in ["rev-list", "--count", ref]) { args.add(a) }
    if (retainers.size > 0) {
        args.add("--not")
        for (name in retainers) { args.add(name) }
    }
    let digits = wtGitText(directory, args.toArray()).trimAscii()
    if (digits.size == 0 || digits.size > 19) { wtFail("worktree-git-bad-count", detail: digits) }
    for (b in digits.toArray()) { if (b < 48 || b > 57) { wtFail("worktree-git-bad-count", detail: digits) } }
    return Int64.parse(digits)
}

func wtBranchExists(directory: String, branch: String): Bool {
    return wtGitCode(directory, ["show-ref", "--verify", "--quiet", "refs/heads/${branch}"]) == 0
}

// 建工作树。owned 指「本会话日志里认这条目录」：分支已存在时只有我们
// 自己建过才允许复用分支，否则一律拒——不去接管别人建的分支。
// 任何失败都把半成品目录擦掉，绝不把残骸留给下一次进入。
func wtCreateWorktree(repoRoot: String, target: String, branch: String, owned: Bool, startRef!: String = "HEAD"): String {
    let args = ArrayList<String>()
    for (a in ["worktree", "add"]) { args.add(a) }
    if (wtBranchExists(repoRoot, branch)) {
        if (!owned) { wtFail("worktree-branch-taken", detail: branch) }
        args.add(target)
        args.add(branch)
    } else {
        for (a in ["-b", branch, target, startRef]) { args.add(a) }
    }
    let result = wtGitRun(repoRoot, args.toArray(), timeoutMs: wtAddTimeoutMs)
    if (result.exitCode != 0 || result.timedOut || result.incomplete) {
        try { removeIfExists(target, recursive: true) } catch (e: Exception) {}
        wtFail("worktree-create-failed", detail: "${result.exitCode}:${result.diagnostic}")
    }
    return wtCanonical(target)
}

func wtRemoveWorktree(repoRoot: String, target: String, force: Bool): Unit {
    let args = ArrayList<String>()
    for (a in ["worktree", "remove"]) { args.add(a) }
    // 不给 --force 留默认位：只有调用方显式放弃未提交文件时，才越过 git 自己的脏检查。
    if (force) { args.add("--force") }
    args.add(target)
    let result = wtGitRun(repoRoot, args.toArray())
    if (result.exitCode != 0 || result.timedOut || result.incomplete) {
        wtFail("worktree-remove-failed", detail: "${result.exitCode}:${result.diagnostic}")
    }
}

// ---------- 事件载荷：k=v 行式，随 SessionLog 的 escField 一起往返 ----------

class WtFields {
    let keys = ArrayList<String>()
    let values = ArrayList<String>()

    func put(key: String, value: String): Unit {
        keys.add(key)
        values.add(value)
    }

    func get(key: String): String {
        for (i in 0..Int64(keys.size)) { if (keys[i] == key) { return values[i] } }
        return ""
    }

    func require(key: String): String {
        let value = get(key)
        if (value.size == 0) { wtFail("worktree-log-damaged", detail: key) }
        return value
    }
}

func wtBuildPayload(pairs: Array<Array<String>>): String {
    var text = ""
    for (pair in pairs) {
        if (pair.size != 2 || pair[0].size == 0 || pair[1].size == 0 || pair[1].contains("\n")) {
            wtFail("worktree-log-damaged", detail: if (pair.size > 0) { pair[0] } else { "" })
        }
        if (text.size > 0) { text += "\n" }
        text += "${pair[0]}=${pair[1]}"
    }
    return text
}

// 严格解析：未知键、重复键、缺等号都当损坏。日志是唯一真源，坏数据不能被「读成空」。
func wtParsePayload(text: String, allowed: Array<String>): WtFields {
    let fields = WtFields()
    if (text.size == 0) { return fields }
    for (line in text.split("\n")) {
        if (line.size == 0) { continue }
        let parts = line.split("=")
        if (parts.size < 2) { wtFail("worktree-log-damaged", detail: line) }
        let key = parts[0]
        var known = false
        for (name in allowed) { if (name == key) { known = true } }
        if (!known || fields.get(key).size > 0) { wtFail("worktree-log-damaged", detail: key) }
        fields.put(key, line[key.size + 1..line.size])
    }
    return fields
}

let wtBindKeys: Array<String> = ["name", "directory", "branch", "originalDirectory"]
let wtCreateKeys: Array<String> = ["name", "directory"]
let wtUnbindKeys: Array<String> = ["name", "directory", "action", "restoredDirectory"]
let wtAgentKeys: Array<String> = ["agentId", "directory", "branch", "state"]

class WtBinding {
    let name: String
    let directory: String
    let branch: String
    let originalDirectory: String
    init(name: String, directory: String, branch: String, originalDirectory: String) {
        this.name = name
        this.directory = directory
        this.branch = branch
        this.originalDirectory = originalDirectory
    }
}

class WtAgentRecord {
    let directory: String
    let branch: String
    let prepared: Bool
    init(directory: String, branch: String, prepared: Bool) {
        this.directory = directory
        this.branch = branch
        this.prepared = prepared
    }
}

// ---------- describe 的 JSON：恰好八个键，顺序固定，紧凑无空格 ----------

func wtJsonQuote(value: String): String {
    let hex = wtHexAlphabet.toArray()
    let out = ArrayList<Byte>()
    out.add(34)
    for (b in value.toArray()) {
        let n = Int64(b)
        if (b == 34) { out.add(92); out.add(34) }
        else if (b == 92) { out.add(92); out.add(92) }
        else if (b == 8) { out.add(92); out.add(98) }
        else if (b == 9) { out.add(92); out.add(116) }
        else if (b == 10) { out.add(92); out.add(110) }
        else if (b == 12) { out.add(92); out.add(102) }
        else if (b == 13) { out.add(92); out.add(114) }
        else if (n < 32) {
            out.add(92); out.add(117); out.add(48); out.add(48)
            out.add(hex[n >> 4])
            out.add(hex[n & 15])
        } else { out.add(b) }
    }
    out.add(34)
    return String.fromUtf8(out.toArray())
}

func wtJsonBool(value: Bool): String {
    return if (value) { "true" } else { "false" }
}

func wtJsonOf(active: Bool, name: String, directory: String, original: String, branch: String,
              dirty: Bool, uncommittedCount: Int64, uniqueCommits: Int64): String {
    return "{\"active\":${wtJsonBool(active)},\"name\":${wtJsonQuote(name)},\"directory\":${wtJsonQuote(directory)},"
        + "\"originalDirectory\":${wtJsonQuote(original)},\"branch\":${wtJsonQuote(branch)},"
        + "\"dirty\":${wtJsonBool(dirty)},\"uncommittedCount\":${uncommittedCount},"
        + "\"uniqueCommits\":${uniqueCommits}}"
}

// ---------- 生命周期 ----------

public class SessionWorktree {
    let log: SessionLog
    let fallback: String
    let workspace: SessionWorkspace

    public init(log: SessionLog, fallback!: String = "") {
        this.log = log
        this.fallback = fallback
        this.workspace = SessionWorkspace(log, fallback: fallback)
    }

    // ---- 只读投影：一律从会话日志算，实例字段不记事 ----

    public func active(): Bool {
        synchronized(wtProcessLock) {
            return currentBinding().isSome()
        }
    }

    public func name(): String {
        synchronized(wtProcessLock) {
            if (let Some(state) <- currentBinding()) { return state.name }
            return ""
        }
    }

    // 无绑定时回落到会话有效目录：后续所有相对路径的基准。
    public func directory(): String {
        synchronized(wtProcessLock) {
            if (let Some(state) <- currentBinding()) { return state.directory }
            return workspace.effectiveDirectory()
        }
    }

    public func originalDirectory(): String {
        synchronized(wtProcessLock) {
            if (let Some(state) <- currentBinding()) { return state.originalDirectory }
            return ""
        }
    }

    public func branch(): String {
        synchronized(wtProcessLock) {
            if (let Some(state) <- currentBinding()) { return state.branch }
            return ""
        }
    }

    // 恰好八字段；Host 透传、桌面逐字段校验，任何一面不得增删或改名。
    public func describe(): String {
        synchronized(wtProcessLock) {
            if (let Some(state) <- currentBinding()) {
                let uncommitted = wtStatusCount(state.directory)
                let unique = wtUniqueCommits(state.directory, "refs/heads/${state.branch}")
                return wtJsonOf(true, state.name, state.directory, state.originalDirectory,
                    state.branch, uncommitted > 0, uncommitted, unique)
            }
            // 没绑定就没有 worktree 可言：脏与独有计数按零报，不去替主检出回答。
            return wtJsonOf(false, "", workspace.effectiveDirectory(), "", "", false, Int64(0), Int64(0))
        }
    }

    // ---- 进入 ----

    public func enter(given: String): String {
        synchronized(wtProcessLock) {
            let slug = if (given.size == 0) { wtGeneratedSlug() } else { wtValidateSlug(given) }
            if (let Some(state) <- currentBinding()) {
                // 同名重入是幂等复用（回放之后再进也走这条）；换名字必须先退出。
                if (state.name != slug) { wtFail("worktree-already-active", detail: state.name) }
                return state.directory
            }
            let roots = wtRepoRoots(workspace.effectiveDirectory())
            if (roots.linked) { wtFail("worktree-nested", detail: roots.worktreeRoot) }
            return bindCreated(roots, slug, "HEAD")
        }
    }

    public func enterPullRequest(reference: String): String {
        synchronized(wtProcessLock) {
            let parsed = wtParsePrReference(reference)
            if (currentBinding().isSome()) { wtFail("worktree-already-active") }
            let roots = wtRepoRoots(workspace.effectiveDirectory())
            if (roots.linked) { wtFail("worktree-nested", detail: roots.worktreeRoot) }
            let origin = wtGitRun(roots.repoRoot, ["remote", "get-url", "origin"])
            if (origin.exitCode != 0) { wtFail("worktree-pr-origin-missing", detail: roots.repoRoot) }
            let url = origin.output.trimAscii()
            if (parsed.byUrl && !wtOriginMatches(url, parsed.owner, parsed.repo)) {
                wtFail("worktree-pr-origin-mismatch", detail: parsed.owner)
            }
            // 先抓再建目录：抓不到就是没有这个 PR，一个字节都不落。
            // 落到 refs/remotes/origin/pull/<N>/head：PR 自带的提交因此算「远程 ref 保留」，
            // 用户在这之上叠的新提交仍然算独有——第三重保护对 PR 分支同样成立。
            let refspec = "pull/${parsed.number}/head:refs/remotes/origin/pull/${parsed.number}/head"
            let fetched = wtGitRun(roots.repoRoot, ["fetch", "origin", refspec], timeoutMs: wtFetchTimeoutMs)
            if (fetched.timedOut) { wtFail("worktree-pr-fetch-timeout", detail: "${parsed.number}") }
            if (fetched.exitCode != 0) { wtFail("worktree-pr-fetch-failed", detail: "${fetched.exitCode}:${fetched.diagnostic}") }
            return bindCreated(roots, "pull-${parsed.number}", "refs/remotes/origin/pull/${parsed.number}/head")
        }
    }

    // 固定目录 <repoRoot>/.sacode/worktrees/<slug> + 分支 worktree-<slug>。
    private func bindCreated(roots: WtRoots, slug: String, startRef: String): String {
        let base = wtEnsureBaseDirectory(roots.repoRoot)
        let target = wtJoin(base, slug)
        let branch = wtBranchOf(slug)
        if (exists(target)) {
            // 磁盘上已有同名目录：只有本会话建过的才算我们的东西。
            if (!hasCreateRecord(target)) { wtFail("worktree-name-taken", detail: target) }
            let real = wtCanonical(target)
            let top = wtGitText(real, ["rev-parse", "--show-toplevel"])
            if (wtNormalisedPath(wtResolveGitPath(real, top)) != wtNormalisedPath(real)) {
                wtFail("worktree-name-taken", detail: real)
            }
            writeBind(real, slug, branch, roots.repoRoot)
            return real
        }
        let created = wtCreateWorktree(roots.repoRoot, target, branch, false, startRef: startRef)
        // 创建后装配（T2）：装配失败就把刚建出来的工作树撤掉，再把原异常码原样交回去——
        // 「进入」要么完整生效，要么像没发生过，不留一份没接好依赖的半成品。
        var refused: Option<Exception> = None
        try { wtApplySetupAfterCreate(roots.repoRoot, created) }
        catch (e: Exception) { refused = Some(e) }
        if (let Some(error) <- refused) {
            try { wtRemoveWorktree(roots.repoRoot, created, true) } catch (e: Exception) {}
            throw error
        }
        log.append(wtEventCreate, wtBuildPayload([["name", slug], ["directory", created]]))
        writeBind(created, slug, branch, roots.repoRoot)
        return created
    }

    private func writeBind(directory: String, slug: String, branch: String, original: String): Unit {
        log.append(wtEventBind, wtBuildPayload([["name", slug], ["directory", directory],
            ["branch", branch], ["originalDirectory", original]]))
        // 目录变更只走 SessionWorkspace：workspace/directory 是本会话有效目录的唯一投影源。
        workspace.setDirectory(directory)
    }

    // ---- 退出 ----

    public func exit(action: String, discardChanges!: Bool = false): String {
        // 动作闭集先判：它是参数校验，与「有没有绑定」无关，delete 永远不是取值。
        if (action != "keep" && action != "remove") { wtFail("worktree-unknown-action", detail: action) }
        synchronized(wtProcessLock) {
            // 绑定、三重保护与删除整段串行：不给「两边都以为自己是第一个」留缝。
            if (let Some(state) <- currentBinding()) {
                if (action == "keep") {
                    writeUnbind(state, "keep")
                    return describe()
                }
                // 保护一：创建会话归属。
                if (!hasCreateRecord(state.directory)) { wtFail("worktree-not-owned", detail: state.directory) }
                let roots = wtRepoRoots(state.directory)
                // 保护三：独有提交。排在脏文件之前判——它没有任何强制通路，调用方必须先看到
                // 这条硬约束，而不是先拿到一个能用 discardChanges 抹掉的码。
                let unique = wtUniqueCommits(state.directory, "refs/heads/${state.branch}")
                if (unique > 0) { wtFail("worktree-unique-commits", detail: "${unique}") }
                // 保护二：未提交文件（含未跟踪，ignored 不算脏）。discardChanges 只覆盖这一项。
                let uncommitted = wtStatusCount(state.directory)
                if (uncommitted > 0 && !discardChanges) { wtFail("worktree-dirty", detail: "${uncommitted}") }
                wtRemoveWorktree(roots.repoRoot, state.directory, discardChanges)
                if (wtBranchExists(roots.repoRoot, state.branch)) {
                    // 走到这里提交已被别的分支或远程 ref 保留，删分支不丢东西；
                    // 留着它反而会把这个名字的下一次进入永久堵住。
                    let dropped = wtGitRun(roots.repoRoot, ["branch", "-D", state.branch])
                    if (dropped.exitCode != 0) { wtFail("worktree-branch-cleanup-failed", detail: dropped.diagnostic) }
                }
                writeUnbind(state, "remove")
                return describe()
            }
            wtFail("worktree-not-active")
        }
    }

    private func writeUnbind(state: WtBinding, action: String): Unit {
        log.append(wtEventUnbind, wtBuildPayload([["name", state.name], ["directory", state.directory],
            ["action", action], ["restoredDirectory", state.originalDirectory]]))
        restoreDirectory(state.originalDirectory)
    }

    private func restoreDirectory(restored: String): Unit {
        if (restored.size == 0) { return }
        try {
            workspace.setDirectory(restored)
        } catch (e: Exception) {
            // 原目录也没了就如实说一声并继续：绑定已清掉，日志不能留着一条指向虚无的目录。
            getStdErr().writeln("worktree restore skipped: ${e.message}")
        }
    }

    // ---- 代理临时目录（agent-<7hex>） ----

    public func prepareAgent(agentId: String): String {
        synchronized(wtProcessLock) {
            let id = wtAgentIdOf(agentId)
            let roots = wtRepoRoots(workspace.effectiveDirectory())
            // 代理目录不套在会话 worktree 里：它落主仓基目录，所以这里不判 linked。
            let base = wtEnsureBaseDirectory(roots.repoRoot)
            if (let Some(record) <- agentRecord(id)) {
                if (exists(record.directory)) { return record.directory }
            }
            var target = ""
            for (attempt in 0..8) {
                let seed = if (attempt == 0) { id } else { "${id}#${attempt}" }
                let candidate = wtJoin(base, wtAgentDirName(seed))
                if (exists(candidate) || isProtectedAgentDirectory(candidate)) { continue }
                target = candidate
                break
            }
            if (target.size == 0) { wtFail("worktree-agent-slot-taken", detail: id) }
            let branch = wtBranchOf(wtBaseNameOf(target))
            // 目录被外部删掉但分支还在时，只有我们自己的记录能复用那条分支。
            let created = wtCreateWorktree(roots.repoRoot, target, branch, hasAgentRecordFor(target))
            log.append(wtEventAgent, wtBuildPayload([["agentId", id], ["directory", created],
                ["branch", branch], ["state", "prepared"]]))
            return created
        }
    }

    public func finishAgent(agentId: String): String {
        synchronized(wtProcessLock) {
            let id = wtAgentIdOf(agentId)
            if (let Some(record) <- agentRecord(id)) {
                var retained = false
                var removed = false
                if (exists(record.directory)) {
                    let roots = wtRepoRoots(record.directory)
                    // 收束判据按「无改动」全量核（已跟踪 + 未跟踪，ignored 不算），
                    // 再加上不可达提交：干净但有独有提交的目录回收就等于把提交丢了。
                    let uncommitted = wtStatusCount(record.directory)
                    let unique = wtUniqueCommits(record.directory, "refs/heads/${record.branch}")
                    retained = uncommitted > 0 || unique > 0
                    if (!retained) {
                        wtRemoveWorktree(roots.repoRoot, record.directory, false)
                        if (wtBranchExists(roots.repoRoot, record.branch)) {
                            let dropped = wtGitRun(roots.repoRoot, ["branch", "-D", record.branch])
                            if (dropped.exitCode != 0) { wtFail("worktree-branch-cleanup-failed", detail: dropped.diagnostic) }
                        }
                        removed = true
                    }
                }
                log.append(wtEventAgent, wtBuildPayload([["agentId", id], ["directory", record.directory],
                    ["branch", record.branch], ["state", "finished"]]))
                return "{\"agentId\":${wtJsonQuote(id)},\"directory\":${wtJsonQuote(record.directory)},"
                    + "\"retained\":${wtJsonBool(retained)},\"removed\":${wtJsonBool(removed)}}"
            }
            wtFail("worktree-agent-unknown", detail: id)
        }
    }

    // 过期清理：只碰 agent- 前缀、mtime 超过 30 天，且三项判据全过。
    // 用户命名的目录永不自动清理——清理面按前缀筛，与 enter 拒 agent- 前缀是一对。
    public func cleanupAgents(): Int64 {
        synchronized(wtProcessLock) {
            let roots = wtRepoRoots(workspace.effectiveDirectory())
            return wtCleanupAgentDirs(wtBaseDirectory(roots.repoRoot), unfinishedAgentDirectories(),
                DateTime.now().toUnixTimeStamp().toSeconds(), wtAgentMaxAgeSeconds)
        }
    }

    // ---- 日志侧读取 ----

    // 活动绑定：最后一条 bind/unbind 说了算。目录已经不在了就当场写一条 unbind(invalidate)
    // 清掉失效绑定、把会话目录归位并继续——恢复也是写日志，不是改内存装样子。
    func currentBinding(): Option<WtBinding> {
        var state: Option<WtBinding> = None
        for (event in log.snapshotEvents()) {
            if (event.eventType == wtEventBind) {
                let fields = wtParsePayload(event.data, wtBindKeys)
                state = Some(WtBinding(fields.require("name"), fields.require("directory"),
                    fields.require("branch"), fields.require("originalDirectory")))
            } else if (event.eventType == wtEventUnbind) {
                state = None
            }
        }
        if (let Some(binding) <- state) {
            if (exists(binding.directory)) { return state }
            getStdErr().writeln("worktree binding lost: ${binding.directory}")
            log.append(wtEventUnbind, wtBuildPayload([["name", binding.name], ["directory", binding.directory],
                ["action", "invalidate"], ["restoredDirectory", binding.originalDirectory]]))
            restoreDirectory(binding.originalDirectory)
            return None
        }
        return None
    }

    func hasCreateRecord(directory: String): Bool {
        let wanted = wtNormalisedPath(directory)
        var hit = false
        for (event in log.snapshotEvents()) {
            if (event.eventType != wtEventCreate) { continue }
            let fields = wtParsePayload(event.data, wtCreateKeys)
            if (wtNormalisedPath(fields.get("directory")) == wanted) { hit = true }
        }
        return hit
    }

    // 同一 agentId 的最后一条记录：prepared 才算在途，finished 之后不再受保护。
    func agentRecord(agentId: String): Option<WtAgentRecord> {
        var latest: Option<WtAgentRecord> = None
        for (event in log.snapshotEvents()) {
            if (event.eventType != wtEventAgent) { continue }
            let fields = wtParsePayload(event.data, wtAgentKeys)
            if (fields.get("agentId") != agentId) { continue }
            latest = Some(WtAgentRecord(fields.require("directory"), fields.require("branch"),
                fields.require("state") == "prepared"))
        }
        return latest
    }

    func hasAgentRecordFor(directory: String): Bool {
        let wanted = wtNormalisedPath(directory)
        var hit = false
        for (event in log.snapshotEvents()) {
            if (event.eventType != wtEventAgent) { continue }
            let fields = wtParsePayload(event.data, wtAgentKeys)
            if (wtNormalisedPath(fields.get("directory")) == wanted) { hit = true }
        }
        return hit
    }

    // 每个 agentId 只留最后一条状态：prepared 且没被 finished 覆盖的才算在途。
    func unfinishedAgentDirectories(): Array<String> {
        let ids = ArrayList<String>()
        let directories = ArrayList<String>()
        let states = ArrayList<String>()
        for (event in log.snapshotEvents()) {
            if (event.eventType != wtEventAgent) { continue }
            let fields = wtParsePayload(event.data, wtAgentKeys)
            var slot: Int64 = -1
            for (i in 0..Int64(ids.size)) { if (ids[i] == fields.get("agentId")) { slot = Int64(i) } }
            if (slot < 0) {
                ids.add(fields.get("agentId"))
                directories.add(fields.require("directory"))
                states.add(fields.require("state"))
            } else {
                directories[slot] = fields.require("directory")
                states[slot] = fields.require("state")
            }
        }
        let open = ArrayList<String>()
        for (i in 0..Int64(ids.size)) { if (states[i] == "prepared") { open.add(directories[i]) } }
        return open.toArray()
    }

    func isProtectedAgentDirectory(candidate: String): Bool {
        let wanted = wtNormalisedPath(candidate)
        for (held in unfinishedAgentDirectories()) {
            if (wtNormalisedPath(held) == wanted) { return true }
        }
        return false
    }

    // 代理 id 沿用同一套名称闭集（含 agent- 前缀禁用：id 不许冒充清理面的保留位）。
    func wtAgentIdOf(agentId: String): String {
        var validated = ""
        try { validated = wtValidateSlug(agentId) }
        catch (e: Exception) { wtFail("worktree-bad-agent-id", detail: agentId) }
        return validated
    }
}

// ---------- 过期清理的判据本体 ----------

// 抽成包级函数、并把「现在几点」与「门槛多长」交出来：30 天这条时间判据要能被推进，
// 不能靠改系统时钟或等一个月——真实钟由 cleanupAgents() 自己填。
// 任何一项读不出来就跳过这个目录：宁可少收，不可误删。
public func wtCleanupAgentDirs(base: String, protectedDirs: Array<String>, nowSeconds: Int64, minAgeSeconds: Int64): Int64 {
    if (!exists(base) || !FileInfo(base).isDirectory()) { return Int64(0) }
    let entries = ArrayList<FileInfo>()
    try {
        for (info in Directory.readFrom(base)) { entries.add(info) }
    } catch (e: Exception) {
        return Int64(0)
    }
    var cleaned: Int64 = 0
    for (info in entries) {
        if (!wtIsAgentWorktreeName(info.name)) { continue }
        let path = wtJoin(base, info.name)
        if (wtIsProtectedDirectory(path, protectedDirs)) { continue }
        if (!agentDirIsCollectable(path, nowSeconds, minAgeSeconds)) { continue }
        // 只走 git 的回收路径：非工作树目录（名字像但来源不明）会被 git 当场拒掉，
        // 我们绝不替它做「顺手 rmdir」。分支只是收尾，删不掉不改变已回收计数。
        let result = wtGitRun(base, ["worktree", "remove", "--force", path])
        if (result.exitCode == 0 && !result.timedOut) {
            wtGitRun(base, ["branch", "-D", wtBranchOf(wtBaseNameOf(path))])
            cleaned += 1
        }
    }
    return cleaned
}

func wtIsProtectedDirectory(path: String, protectedDirs: Array<String>): Bool {
    let wanted = wtNormalisedPath(path)
    for (held in protectedDirs) { if (wtNormalisedPath(held) == wanted) { return true } }
    return false
}

// 三条判据：够老、无未提交已跟踪改动、没有只存在于这份工作树的提交。
// git 读不出来（不是工作树、元数据坏、目录被搬走）一律算不合格。
// 注：只有未跟踪文件的过期目录算可回收，与清理条款一致；
// finishAgent 的「无改动」按全量口径判，两者不同是有意的。
func agentDirIsCollectable(path: String, nowSeconds: Int64, minAgeSeconds: Int64): Bool {
    var age: Int64 = 0
    try {
        age = nowSeconds - FileInfo(path).lastModificationTime.toUnixTimeStamp().toSeconds()
    } catch (e: Exception) {
        return false
    }
    if (age < minAgeSeconds) { return false }
    var uncommitted: Int64 = -1
    var unique: Int64 = -1
    try {
        uncommitted = wtTrackedStatusCount(path)
        unique = wtUniqueCommits(path, "refs/heads/${wtBranchOf(wtBaseNameOf(path))}")
    } catch (e: Exception) {
        return false
    }
    return uncommitted == 0 && unique == 0
}
