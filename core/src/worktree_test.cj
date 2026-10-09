package core

import std.collection.ArrayList
import std.env.*
import std.fs.*
import std.process.*
import std.time.*
import std.unittest.*
import stdx.encoding.json.*

// 会话级 worktree 核心的行为契约测试（计划 T1）。
// 口径唯一来源：docs/superpowers/plans/2026-10-08-session-worktree.md 的
// 「冻结契约」+「Global Constraints」。签名照契约；动作只有 keep|remove（草稿里的
// delete 一律不算合法取值）；describe() 恰好八字段；绑定只进会话日志；
// 删除受三重保护，第三重没有任何强制通路。
//
// 不变量 → 用例（编号在每条 @Test 的注释里）：
// I1 名称规则与随机名  I2 固定目录与分支  I3 仓库根/防嵌套  I4 绑定只进会话日志与失效恢复
// I5 describe 八字段  I6 动作闭集 keep|remove  I7 保护一·创建会话归属
// I8 保护二·未提交文件（含未跟踪，ignored 不算脏；discardChanges 只覆盖此项）
// I9 保护三·独有提交（discardChanges 越不过去）  I10 keep/remove 副作用  I11 agent 生命周期
// I12 cleanupAgents 只碰 agent- 前缀且 mtime 超 30 天  I13 PR 入口  I14 PR 提交的保留判定
// I15 失败不留半成品目录  I16 argv/超时/两管道抽干  I17 保护检查与删除之间串行化

// ---------- 夹具 ----------

// 每份用例各占一个私有临时目录：并发会话之间不共享 .sacode/worktrees 与归属判定。
func wtTempDir(): String {
    let base = getVariable("TMP") ?? (getVariable("TEMP") ?? ".")
    return Directory.createTemp(Path(base)).toString()
}

func wtGitAt(dir: String, args: Array<String>): String {
    let (rc, out, err) = executeWithOutput("git", args, workingDirectory: Some(Path(dir)))
    if (rc != 0) { throw Exception("git-${args[0]}:${String.fromUtf8(err)}") }
    return String.fromUtf8(out).trimAscii()
}

// 只在 rc==0 时返回 true：用于「引用不该存在」这类存在性核验，不走异常。
func wtGitOk(dir: String, args: Array<String>): Bool {
    let (rc, _, _) = executeWithOutput("git", args, workingDirectory: Some(Path(dir)))
    return rc == 0
}

func wtRefExists(dir: String, ref: String): Bool {
    return wtGitOk(dir, ["show-ref", "--verify", "--quiet", ref])
}

// 真实最小仓库：一个已提交文件 + 一份 gitignore（`.sacode/` 与 `ignored`）。
// 目录先自己建：workingDirectory 指向不存在的目录时 std.process 直接抛。
func wtFixtureIn(dir: String): String {
    if (!exists(dir)) { Directory.create(dir, recursive: true) }
    wtGitAt(dir, ["init", "-b", "main"])
    File.writeTo(Path(dir).join("seed"), "shared-seed".toArray())
    File.writeTo(Path(dir).join(".gitignore"), ".sacode/\nignored\n".toArray())
    wtGitAt(dir, ["add", "."])
    wtGitAt(dir, ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid",
        "-c", "commit.gpgsign=false", "commit", "-m", "worktree 夹具"])
    return canonicalize(dir).toString()
}

func wtFixture(): String {
    return wtFixtureIn(wtTempDir())
}

func wtCommit(dir: String, message: String): Unit {
    wtGitAt(dir, ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid",
        "-c", "commit.gpgsign=false", "commit", "-m", message])
}

// 只回错误码字符串：不抛即空串。契约要求错误码是稳定闭集，所以断言用全等而不是前缀。
func wtErrorCode(action: () -> Unit): String {
    try { action() } catch (e: Exception) { return e.message }
    return ""
}

func wtStringResult(action: () -> String): String {
    try { return action() } catch (e: Exception) { return "err:${e.message}" }
}

func wtSlashes(path: String): String {
    return path.replace("\\", "/")
}

func wtBaseDir(root: String): String {
    return Path(root).join(".sacode").join("worktrees").toString()
}

func wtBaseName(path: String): String {
    let parts = wtSlashes(path).split("/")
    return parts[parts.size - 1]
}

func wtMtimeSeconds(path: String): Int64 {
    return FileInfo(path).lastModificationTime.toUnixTimeStamp().toSeconds()
}

func wtObject(text: String): JsonObject {
    return JsonValue.fromStr(text).asObject()
}

func wtField(object: JsonObject, field: String): String {
    return object.get(field).getOrThrow().asString().getValue()
}

func wtBoolField(object: JsonObject, field: String): Bool {
    return object.get(field).getOrThrow().asBool().getValue()
}

func wtIntField(object: JsonObject, field: String): Int64 {
    return object.get(field).getOrThrow().asInt().getValue()
}

func wtEventNames(log: SessionLog): ArrayList<String> {
    let names = ArrayList<String>()
    for (event in log.snapshotEvents()) {
        var known = false
        for (name in names) { if (name == event.eventType) { known = true } }
        if (!known) { names.add(event.eventType) }
    }
    return names
}

func wtObjectFieldNames(object: JsonObject): ArrayList<String> {
    let names = ArrayList<String>()
    for ((key, _) in object.getFields()) { names.add(key) }
    return names
}

// 临时目录尽力清掉（Git 只读对象可能删不动，与 team_workspace_test 同口径：
// 清理失败不算用例失败，残留留在私有 TMP 里）。
func wtTidy(path: String): Unit {
    try { removeIfExists(path, recursive: true) } catch (_: Exception) {}
}

func wtStringOfLength(size: Int64): String {
    var out = ""
    for (_ in 0..size) { out += "a" }
    return out
}

// 生成的随机名形态：<形容词>-<名词>-<6hex>，三段全小写字母，末段恰好 6 位十六进制。
func wtIsGeneratedSlug(s: String): Bool {
    let parts = wtSlashes(s).split("-")
    if (parts.size != 3) { return false }
    for (index in 0..2) {
        let bytes = parts[index].toArray()
        if (bytes.size == 0) { return false }
        for (b in bytes) { if (!(b >= 97 && b <= 122)) { return false } }
    }
    return wtHexTailOfLength(s, 6)
}

// 代理临时目录名形态：agent- + 恰好 7 位十六进制。
func wtAgentDirName(s: String): Bool {
    if (!s.startsWith("agent-")) { return false }
    return wtHexTailOfLength(s, 7)
}

func wtHexTailOfLength(s: String, width: Int64): Bool {
    let bytes = s.toArray()
    if (Int64(bytes.size) != width) { return false }
    for (b in bytes) {
        if (!((b >= 48 && b <= 57) || (b >= 97 && b <= 102))) { return false }
    }
    return true
}

// ---------- I1 名称规则 ----------

@Test
func wtCoreSlugCharsetAndLengthRules() {
    // 允许集：字母、数字、. _ -，长度 ≤64；原样收下。
    for (good in ["keep", "a.b_c-d", "ABC123", "pull-17", "a", "agent", "agents-x", "worktree-agent-0123abc"]) {
        @Expect(wtValidateSlug(good), good)
    }
    // 逐个拒：空、路径分隔与穿越、flag 形态、首尾禁字符、空白与 shell 元字符、
    // Windows 保留名、agent- 保留前缀、非 ASCII、超长。
    for (bad in ["", "a/b", "a\\b", "../escape", "..", ".", "--flag", "-lead", "trail-", "trail.",
        "a b", "a;cmd", "a|b", "a`b", "a\nb", "CON", "nul.txt", "com1", "LPT9", "agent-manual",
        "AGENT-1", "agent-0123abc", "中文", wtStringOfLength(65)]) {
        @Expect(wtErrorCode({ => wtValidateSlug(bad) }), "worktree-bad-name")
    }
    let edge = wtStringOfLength(64)
    @Expect(wtValidateSlug(edge), edge)
}

@Test
func wtCoreGeneratedSlugShape() {
    let root = wtFixture()
    let tree = SessionWorktree(SessionLog(Path(root).join("a.log")), fallback: root)
    let first = tree.enter("")
    @Expect(exists(first), true)
    let generated = tree.name()
    @Expect(wtIsGeneratedSlug(generated), true)
    @Expect(generated.size <= 64, true)
    @Expect(wtSlashes(first), "${wtSlashes(canonicalize(wtBaseDir(root)).toString())}/${generated}")
    @Expect(tree.branch(), "worktree-${generated}")
    @Expect(tree.exit("keep").contains("\"active\":false"), true)
    // 再给一次空名要另起一个名字，不复用刚绑过的那个。
    let second = tree.enter("")
    @Expect(wtIsGeneratedSlug(tree.name()), true)
    @Expect(second != first, true)
    @Expect(tree.exit("remove").contains("\"active\":false"), true)
    @Expect(exists(second), false)
    wtTidy(root)
}

// ---------- I2 固定目录与分支 ----------

@Test
func wtCoreEnterCreatesFixedDirectoryAndBranch() {
    let root = wtFixture()
    let log = SessionLog(Path(root).join("a.log"))
    let tree = SessionWorktree(log, fallback: root)
    @Expect(tree.active(), false)
    @Expect(tree.directory(), root)
    @Expect(tree.name(), "")
    @Expect(tree.branch(), "")
    @Expect(tree.originalDirectory(), "")
    let dir = tree.enter("alpha")
    @Expect(dir, canonicalize(Path(wtBaseDir(root)).join("alpha")).toString())
    @Expect(exists(dir), true)
    @Expect(tree.active(), true)
    @Expect(tree.name(), "alpha")
    @Expect(tree.directory(), dir)
    @Expect(tree.originalDirectory(), root)
    @Expect(tree.branch(), "worktree-alpha")
    @Expect(SessionWorkspace(log).effectiveDirectory(), dir)
    // 分支与 worktree 注册都由 git 自己确认，不是我方另记一本账。
    @Expect(wtRefExists(root, "refs/heads/worktree-alpha"), true)
    @Expect(wtGitAt(dir, ["rev-parse", "--show-toplevel"]), wtSlashes(dir))
    let shape = wtObject(tree.describe())
    @Expect(wtBoolField(shape, "dirty"), false)
    @Expect(wtIntField(shape, "uncommittedCount"), Int64(0))
    @Expect(wtIntField(shape, "uniqueCommits"), Int64(0))
    wtTidy(root)
}

// ---------- I10 keep / remove ----------

@Test
func wtCoreKeepRestoresDirectoryAndKeepsWorktree() {
    let root = wtFixture()
    let log = SessionLog(Path(root).join("a.log"))
    let tree = SessionWorktree(log, fallback: root)
    let dir = tree.enter("kept")
    File.writeTo(Path(dir).join("note"), "keep me".toArray())
    @Expect(tree.exit("keep").contains("\"active\":false"), true)
    @Expect(tree.active(), false)
    @Expect(exists(dir), true)
    @Expect(SessionWorkspace(log).directory(), root)
    // 一次 enter 一条 workspace/directory，一次 keep 再一条：只这两条。
    var directoryEvents: Int64 = 0
    for (event in log.snapshotEvents()) { if (event.eventType == "workspace/directory") { directoryEvents += 1 } }
    @Expect(directoryEvents, Int64(2))
    // 目录与分支都还在：按名字再进是复用，不是重建，未提交的那份文件原样。
    @Expect(tree.enter("kept"), dir)
    @Expect(String.fromUtf8(File.readFrom(Path(dir).join("note"))), "keep me")
    @Expect(wtIntField(wtObject(tree.describe()), "uncommittedCount"), Int64(1))
    wtTidy(root)
}

@Test
func wtCoreRemoveDeletesDirectoryAndBranch() {
    let root = wtFixture()
    let log = SessionLog(Path(root).join("a.log"))
    let tree = SessionWorktree(log, fallback: root)
    let dir = tree.enter("gone")
    @Expect(tree.exit("remove").contains("\"active\":false"), true)
    @Expect(exists(dir), false)
    @Expect(tree.active(), false)
    @Expect(SessionWorkspace(log).directory(), root)
    // 分支随目录一起收掉：否则同名再进会被「branch already exists」永久堵住。
    @Expect(wtRefExists(root, "refs/heads/worktree-gone"), false)
    @Expect(exists(tree.enter("gone")), true)
    wtTidy(root)
}

// ---------- I6 动作闭集 ----------

@Test
func wtCoreUnknownExitActionRejected() {
    let root = wtFixture()
    let log = SessionLog(Path(root).join("a.log"))
    let tree = SessionWorktree(log, fallback: root)
    let dir = tree.enter("action")
    // 草稿里的 delete 不是合法取值；大小写、空串、复合值、带空格一样拒。
    for (bad in ["delete", "Delete", "KEEP", "", "remove-all", "keep ", "keep\t"]) {
        @Expect(wtErrorCode({ => tree.exit(bad) }), "worktree-unknown-action")
        @Expect(wtErrorCode({ => tree.exit(bad, discardChanges: true) }), "worktree-unknown-action")
    }
    @Expect(tree.active(), true)
    @Expect(exists(dir), true)
    @Expect(SessionWorkspace(log).effectiveDirectory(), dir)
    tree.exit("remove")
    @Expect(exists(dir), false)
    wtTidy(root)
}

@Test
func wtCoreExitWithoutBindingRejected() {
    let root = wtFixture()
    let tree = SessionWorktree(SessionLog(Path(root).join("a.log")), fallback: root)
    @Expect(wtErrorCode({ => tree.exit("keep") }), "worktree-not-active")
    @Expect(wtErrorCode({ => tree.exit("remove", discardChanges: true) }), "worktree-not-active")
    // 非法动作先于「有没有绑定」判：闭集是参数校验，不是状态校验。
    @Expect(wtErrorCode({ => tree.exit("delete") }), "worktree-unknown-action")
    // 没绑定也得能描述：面板要拿它判 inactive，而且不能抛。
    let shape = wtObject(tree.describe())
    @Expect(wtBoolField(shape, "active"), false)
    @Expect(wtBoolField(shape, "dirty"), false)
    @Expect(wtIntField(shape, "uncommittedCount"), Int64(0))
    @Expect(wtIntField(shape, "uniqueCommits"), Int64(0))
    @Expect(wtField(shape, "directory"), root)
    @Expect(wtField(shape, "name"), "")
    @Expect(exists(wtBaseDir(root)), false)
    wtTidy(root)
}

// ---------- I3 仓库根与防嵌套 ----------

@Test
func wtCoreRejectsOutsideRepository() {
    let outside = wtTempDir()
    let tree = SessionWorktree(SessionLog(Path(outside).join("a.log")), fallback: outside)
    @Expect(wtErrorCode({ => tree.enter("alpha") }), "worktree-not-a-repository")
    @Expect(wtErrorCode({ => tree.enterPullRequest("17") }), "worktree-not-a-repository")
    @Expect(wtErrorCode({ => tree.prepareAgent("one") }), "worktree-not-a-repository")
    @Expect(wtCleanupAgentDirs(Path(outside).join(".sacode").join("worktrees").toString(), [], Int64(0), Int64(0)), Int64(0))
    // 拒了就一个字节都不落：连基目录都不建。
    @Expect(exists(Path(outside).join(".sacode")), false)
    wtTidy(outside)
}

@Test
func wtCoreRejectsNestedLinkedWorktree() {
    let root = wtFixture()
    let outerLog = SessionLog(Path(root).join("a.log"))
    let outer = SessionWorktree(outerLog, fallback: root)
    let dir = outer.enter("outer")
    // 在已有 worktree 里再开一个会话并尝试进入：仓库根用 git 自己的查询得出，
    // 且必须靠 git-dir 与 common-dir 的差别识别出「这已经是工作树」，嵌套一律拒。
    let inner = SessionWorktree(SessionLog(Path(root).join("b.log")), fallback: dir)
    @Expect(wtErrorCode({ => inner.enter("inner") }), "worktree-nested")
    @Expect(wtErrorCode({ => inner.enterPullRequest("17") }), "worktree-nested")
    @Expect(exists(Path(wtBaseDir(root)).join("inner")), false)
    @Expect(wtErrorCode({ => inner.exit("remove") }), "worktree-not-active")
    // 代理目录不算进入，可以在已绑定的会话里准备（它落主仓基目录，不套娃）。
    let agent = inner.prepareAgent("helper")
    @Expect(exists(agent), true)
    @Expect(agent != dir, true)
    @Expect(wtSlashes(agent).startsWith(wtSlashes(dir)), false)
    @Expect(outer.exit("keep").contains("\"active\":false"), true)
    wtTidy(root)
}

@Test
func wtCoreRejectsWhenNoDirectoryIsKnown() {
    let dir = wtTempDir()
    let tree = SessionWorktree(SessionLog(Path(dir).join("a.log")))
    @Expect(wtErrorCode({ => tree.enter("alpha") }), "worktree-no-directory")
    @Expect(wtErrorCode({ => tree.enterPullRequest("1") }), "worktree-no-directory")
    @Expect(wtErrorCode({ => tree.prepareAgent("one") }), "worktree-no-directory")
    wtTidy(dir)
}

// ---------- I4 绑定只进会话日志 + 失效恢复 ----------

@Test
func wtCoreBindingIsSessionLogOnly() {
    let root = wtFixture()
    let path = Path(root).join("a.log").toString()
    let log = SessionLog(path)
    let tree = SessionWorktree(log, fallback: root)
    let dir = tree.enter("owned")
    // 事件集合恰好这三类：绑定与目录变更全在日志里，没有旁挂文件。
    let names = wtEventNames(log)
    @Expect(names.contains("workspace/directory"), true)
    @Expect(names.contains("worktree/create"), true)
    @Expect(names.contains("worktree/bind"), true)
    @Expect(names.size, Int64(3))
    @Expect(exists(Path(root).join("owned.worktree.json")), false)
    // append 只在实例内可见；没 flush 就不能当跨进程已提交。
    @Expect(log.pendingCount() > 0, true)
    let cold = SessionLog(path)
    @Expect(cold.load(), true)
    @Expect(SessionWorktree(cold, fallback: root).active(), false)
    @Expect(log.flush(), true)
    @Expect(log.pendingCount(), Int64(0))
    let replay = SessionLog(path)
    @Expect(replay.load(), true)
    let back = SessionWorktree(replay, fallback: root)
    @Expect(back.active(), true)
    @Expect(back.name(), "owned")
    @Expect(back.directory(), dir)
    @Expect(back.branch(), "worktree-owned")
    @Expect(back.originalDirectory(), root)
    // 同名的重入是幂等复用，不是第二次绑定。
    @Expect(back.enter("owned"), dir)
    // 别的会话（另一份日志）认领不到这份目录。
    let stranger = SessionWorktree(SessionLog(Path(root).join("b.log")), fallback: root)
    @Expect(wtErrorCode({ => stranger.enter("owned") }), "worktree-name-taken")
    // 磁盘上来源不明的同名目录也不认领，而且原样留在原地。
    Directory.create(Path(wtBaseDir(root)).join("handmade"), recursive: true)
    @Expect(wtErrorCode({ => stranger.enter("handmade") }), "worktree-name-taken")
    @Expect(exists(Path(wtBaseDir(root)).join("handmade")), true)
    wtTidy(root)
}

@Test
func wtCoreVanishedDirectoryClearsBindingAndContinues() {
    let root = wtFixture()
    let path = Path(root).join("a.log").toString()
    let log = SessionLog(path)
    let tree = SessionWorktree(log, fallback: root)
    let dir = tree.enter("outer")
    @Expect(log.flush(), true)
    // 外部把 worktree 连目录一起删掉（git worktree remove 会留下分支）。
    wtGitAt(root, ["worktree", "remove", dir])
    let replay = SessionLog(path)
    @Expect(replay.load(), true)
    let recover = SessionWorktree(replay, fallback: root)
    // 恢复判据：目录没了就清掉失效绑定并继续，不抛、不假装还在。
    @Expect(recover.active(), false)
    @Expect(recover.describe().contains("\"active\":false"), true)
    @Expect(SessionWorkspace(replay).directory(), root)
    // 清绑定是写日志，不是直接改磁盘：入口不 flush 就只在实例内可见。
    @Expect(replay.pendingCount() > 0, true)
    // 分支留着不影响再进：归属仍属本会话，走的是「复用既有分支」这条路。
    @Expect(recover.enter("outer"), dir)
    @Expect(exists(dir), true)
    @Expect(recover.branch(), "worktree-outer")
    wtTidy(root)
}

// ---------- I5 describe 恰好八字段 ----------

@Test
func wtCoreDescribeHasExactlyEightFields() {
    let root = wtFixture()
    let tree = SessionWorktree(SessionLog(Path(root).join("a.log")), fallback: root)
    let shape = wtObject(tree.describe())
    @Expect(shape.size(), Int64(8))
    let names = wtObjectFieldNames(shape)
    for (field in ["active", "name", "directory", "originalDirectory", "branch", "dirty", "uncommittedCount", "uniqueCommits"]) {
        @Expect(names.contains(field), true)
    }
    // 类型钉住：三个布尔位、五个字符串/整数位都不许换位。
    @Expect(shape.get("active").getOrThrow().asBool().isSome(), true)
    @Expect(shape.get("name").getOrThrow().asString().isSome(), true)
    @Expect(shape.get("uncommittedCount").getOrThrow().asInt().isSome(), true)
    @Expect(shape.get("uniqueCommits").getOrThrow().asInt().isSome(), true)
    // Host 侧按字面把这段 JSON 透传给桌面，序列化必须是紧凑的 "key":value。
    @Expect(tree.describe().contains("\"active\":false"), true)
    tree.enter("shape")
    File.writeTo(Path(tree.directory()).join("brand-new"), "x".toArray())
    let bound = wtObject(tree.describe())
    @Expect(bound.size(), Int64(8))
    @Expect(wtBoolField(bound, "active"), true)
    @Expect(wtField(bound, "name"), "shape")
    @Expect(wtField(bound, "branch"), "worktree-shape")
    @Expect(wtField(bound, "directory"), tree.directory())
    @Expect(wtField(bound, "originalDirectory"), root)
    @Expect(wtBoolField(bound, "dirty"), true)
    @Expect(wtIntField(bound, "uncommittedCount"), Int64(1))
    wtTidy(root)
}

// ---------- I7 保护一：创建会话归属 ----------

@Test
func wtCoreRemoveRequiresCreatingSession() {
    let root = wtFixture()
    let ownerLog = SessionLog(Path(root).join("owner.log"))
    let creator = SessionWorktree(ownerLog, fallback: root)
    let dir = creator.enter("owned")
    @Expect(ownerLog.flush(), true)
    // 回放同一份日志的实例拿到的是同一份归属，所以它删得动。
    let sameSession = SessionWorktree(SessionLog(Path(root).join("owner.log")), fallback: root)
    @Expect(sameSession.exit("remove").contains("\"active\":false"), true)
    @Expect(exists(dir), false)
    // 归属不明就凭空造不出删除：先手工建一个同名目录，别的会话既进不去也删不掉。
    let outsiderLog = SessionLog(Path(root).join("other.log"))
    let outsider = SessionWorktree(outsiderLog, fallback: root)
    Directory.create(Path(wtBaseDir(root)).join("foreign"), recursive: true)
    @Expect(wtErrorCode({ => outsider.enter("foreign") }), "worktree-name-taken")
    @Expect(exists(Path(wtBaseDir(root)).join("foreign")), true)
    // 归属核验在删除之前：另一会话即便有绑定，也删不动别人建的目录。
    @Expect(wtErrorCode({ => outsider.exit("remove") }), "worktree-not-active")
    wtTidy(root)
}

// ---------- I8 保护二：未提交文件 ----------

@Test
func wtCoreRemoveDirtyRules() {
    let root = wtFixture()
    let tree = SessionWorktree(SessionLog(Path(root).join("a.log")), fallback: root)
    // ignored 不算脏：只有被忽略文件时可以直接删。
    let ignoredOnly = tree.enter("onlyignored")
    File.writeTo(Path(ignoredOnly).join("ignored"), "still-valuable".toArray())
    @Expect(wtBoolField(wtObject(tree.describe()), "dirty"), false)
    @Expect(tree.exit("remove").contains("\"active\":false"), true)
    @Expect(exists(ignoredOnly), false)
    // 已跟踪文件改动：拒；discardChanges 正好覆盖这一项。
    let modified = tree.enter("modified")
    File.writeTo(Path(modified).join("seed"), "changed".toArray())
    @Expect(wtErrorCode({ => tree.exit("remove") }), "worktree-dirty")
    @Expect(wtErrorCode({ => tree.exit("remove", discardChanges: false) }), "worktree-dirty")
    @Expect(exists(modified), true)
    @Expect(wtIntField(wtObject(tree.describe()), "uncommittedCount"), Int64(1))
    @Expect(tree.exit("remove", discardChanges: true).contains("\"active\":false"), true)
    @Expect(exists(modified), false)
    // 未跟踪文件同样算脏（ignored 之外）。
    let untracked = tree.enter("untracked")
    File.writeTo(Path(untracked).join("brand-new"), "valuable".toArray())
    @Expect(wtErrorCode({ => tree.exit("remove") }), "worktree-dirty")
    @Expect(wtIntField(wtObject(tree.describe()), "uncommittedCount"), Int64(1))
    @Expect(tree.exit("remove", discardChanges: true).contains("\"active\":false"), true)
    @Expect(exists(untracked), false)
    wtTidy(root)
}

@Test
func wtCoreStatusCountCountsRenamedPairAndSkipsIgnored() {
    let root = wtFixture()
    let tree = SessionWorktree(SessionLog(Path(root).join("a.log")), fallback: root)
    let dir = tree.enter("status")
    wtGitAt(dir, ["mv", "seed", "renamed"])
    File.writeTo(Path(dir).join("ignored"), "x".toArray())
    File.writeTo(Path(dir).join("fresh"), "y".toArray())
    // --no-renames 口径：改名 = 删除 + 新增两条，加一条未跟踪 = 3；ignored 不进计数。
    @Expect(wtStatusCount(dir), Int64(3))
    // 过期清理口径只看已跟踪：未跟踪那条不计。
    @Expect(wtTrackedStatusCount(dir), Int64(2))
    @Expect(wtErrorCode({ => tree.exit("remove") }), "worktree-dirty")
    wtTidy(root)
}

// ---------- I9 保护三：独有提交，无任何强制通路 ----------

@Test
func wtCoreUniqueCommitsCannotBeForced() {
    let root = wtFixture()
    let tree = SessionWorktree(SessionLog(Path(root).join("a.log")), fallback: root)
    let dir = tree.enter("commit")
    File.writeTo(Path(dir).join("seed"), "changed".toArray())
    wtGitAt(dir, ["add", "."])
    wtCommit(dir, "独有提交")
    // 再叠一个未跟踪文件：让第二重保护也处于「要 discardChanges 才过得去」的状态，
    // 这样两条出口都验到——拒因必须是第三重保护，不是第二重。
    File.writeTo(Path(dir).join("brand-new"), "uncommitted".toArray())
    let shape = wtObject(tree.describe())
    @Expect(wtIntField(shape, "uniqueCommits"), Int64(1))
    @Expect(wtIntField(shape, "uncommittedCount"), Int64(1))
    @Expect(wtErrorCode({ => tree.exit("remove") }), "worktree-unique-commits")
    // 第三重保护的关键断言：discardChanges 也越不过去。
    @Expect(wtErrorCode({ => tree.exit("remove", discardChanges: true) }), "worktree-unique-commits")
    @Expect(exists(dir), true)
    @Expect(tree.active(), true)
    // 另一个本地分支接住 → 不再是独有 → 这时 discardChanges 才派上用场。
    wtGitAt(root, ["branch", "retained", "worktree-commit"])
    @Expect(wtIntField(wtObject(tree.describe()), "uniqueCommits"), Int64(0))
    @Expect(wtErrorCode({ => tree.exit("remove") }), "worktree-dirty")
    @Expect(tree.exit("remove", discardChanges: true).contains("\"active\":false"), true)
    @Expect(exists(dir), false)
    wtTidy(root)
}

@Test
func wtCoreRemoteRefAlsoRetainsCommits() {
    let root = wtFixture()
    let tree = SessionWorktree(SessionLog(Path(root).join("a.log")), fallback: root)
    let dir = tree.enter("remote")
    wtGitAt(dir, ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid",
        "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "远端留存"])
    let head = wtGitAt(dir, ["rev-parse", "HEAD"])
    wtGitAt(root, ["update-ref", "refs/remotes/origin/retained", head])
    @Expect(wtUniqueCommits(root, "refs/heads/worktree-remote"), Int64(0))
    @Expect(wtIntField(wtObject(tree.describe()), "uniqueCommits"), Int64(0))
    @Expect(tree.exit("remove").contains("\"active\":false"), true)
    @Expect(exists(dir), false)
    wtTidy(root)
}

// ---------- I15 失败不留半成品目录 ----------

@Test
func wtCoreCreateFailureLeavesNoDirectory() {
    let root = wtFixture()
    let log = SessionLog(Path(root).join("a.log"))
    let tree = SessionWorktree(log, fallback: root)
    // 别人占了这条分支名：本会话没有创建记录，不许拿来用，也不许留下目录。
    wtGitAt(root, ["branch", "worktree-taken", "HEAD"])
    @Expect(wtErrorCode({ => tree.enter("taken") }), "worktree-branch-taken")
    @Expect(exists(Path(wtBaseDir(root)).join("taken")), false)
    @Expect(tree.active(), false)
    @Expect(SessionWorkspace(log).directory(), "")
    // 非法名同样先拒再动手：连基目录都不该出现。
    @Expect(wtErrorCode({ => tree.enter("a/b") }), "worktree-bad-name")
    @Expect(exists(Path(root).join(".sacode")), false)
    wtTidy(root)
}

@Test
func wtCoreAlreadyActiveRejected() {
    let root = wtFixture()
    let tree = SessionWorktree(SessionLog(Path(root).join("a.log")), fallback: root)
    let first = tree.enter("one")
    // 一个会话只有一条活动绑定：换名字必须先退出（绑定检查在 origin/分支核验之前）。
    @Expect(wtErrorCode({ => tree.enter("two") }), "worktree-already-active")
    @Expect(wtErrorCode({ => tree.enter("") }), "worktree-already-active")
    @Expect(wtErrorCode({ => tree.enterPullRequest("7") }), "worktree-already-active")
    @Expect(tree.directory(), first)
    @Expect(exists(Path(wtBaseDir(root)).join("two")), false)
    // 同名的重入是幂等复用。
    @Expect(tree.enter("one"), first)
    wtTidy(root)
}

// ---------- I13 PR 入口 ----------

@Test
func wtCorePullRequestReferenceParsing() {
    @Expect(wtParsePrReference("17").number, Int64(17))
    @Expect(wtParsePrReference("#17").number, Int64(17))
    @Expect(wtParsePrReference("0017").number, Int64(17))
    @Expect(wtParsePrReference("2147483647").number, Int64(2147483647))
    @Expect(wtParsePrReference("17").byUrl, false)
    @Expect(wtParsePrReference("17").owner, "")
    @Expect(wtParsePrReference("17").repo, "")
    let url = wtParsePrReference("https://github.com/SomeOwner/SomeRepo/pull/42")
    @Expect(url.number, Int64(42))
    @Expect(url.byUrl, true)
    @Expect(url.owner, "SomeOwner")
    @Expect(url.repo, "SomeRepo")
    for (bad in ["", " ", " 17", "17 ", "0", "#0", "-1", "+1", "17;cmd", "17x", "x17", "1..7",
        "2147483648", "99999999999999999999", "pull/17", "17/head", "#",
        "http://github.com/a/b/pull/17", "https://github.com/a/b/pull/17/", "https://github.com/a/b/pull/18/x",
        "https://github.com/a/b/pull", "https://github.com/a/pull/17", "https://github.com/a/b/pull/0",
        "https://www.github.com/a/b/pull/17", "https://github.com/a/b/issues/17",
        "https://gitlab.com/a/b/pull/17", "HTTPS://github.com/a/b/pull/17", "https://github.com/a/b/pull/-3",
        "https://github.com/a/b/pull/2147483648"]) {
        @Expect(wtErrorCode({ => wtParsePrReference(bad) }), "worktree-pr-bad-reference")
    }
}

@Test
func wtCorePullRequestOriginMatching() {
    // GitHub 形态：https（可带 .git）、scp 与 ssh 形态都认，owner/repo 大小写不敏感。
    @Expect(wtOriginMatches("https://github.com/Owner/Repo", "owner", "repo"), true)
    @Expect(wtOriginMatches("https://github.com/owner/repo.git", "Owner", "Repo"), true)
    @Expect(wtOriginMatches("git@github.com:owner/repo.git", "owner", "repo"), true)
    @Expect(wtOriginMatches("ssh://git@github.com/owner/repo", "OWNER", "REPO"), true)
    // 非 GitHub、换主机、换仓库、本机路径都不认。
    @Expect(wtOriginMatches("https://gitlab.com/owner/repo", "owner", "repo"), false)
    @Expect(wtOriginMatches("https://github.com/owner/other", "owner", "repo"), false)
    @Expect(wtOriginMatches("https://github.com/owner", "owner", "repo"), false)
    @Expect(wtOriginMatches("https://github.com/a/b/c", "a", "b"), false)
    @Expect(wtOriginMatches("D:/Temp/pr1", "owner", "repo"), false)
    @Expect(wtOriginMatches("", "owner", "repo"), false)
    // 裸编号（没 owner/repo）时不做主机核验，只要求存在 origin。
    @Expect(wtOriginMatches("D:/Temp/pr1", "", ""), true)
    @Expect(wtOriginMatches("https://gitlab.com/owner/repo", "", ""), true)
}

@Test
func wtCorePullRequestEndToEndAgainstLocalOrigin() {
    let root = wtFixture()
    let remote = wtTempDir()
    wtGitAt(remote, ["init", "--bare"])
    wtGitAt(root, ["remote", "add", "origin", remote])
    wtGitAt(root, ["push", "origin", "HEAD:refs/pull/17/head"])
    let log = SessionLog(Path(root).join("a.log"))
    let tree = SessionWorktree(log, fallback: root)
    // 裸编号 + 本机 origin：抓 pull/<N>/head 建工作树，名字是 pull-<N>。
    let dir = tree.enterPullRequest("#17")
    @Expect(tree.name(), "pull-17")
    @Expect(tree.branch(), "worktree-pull-17")
    @Expect(wtSlashes(dir), "${wtSlashes(canonicalize(wtBaseDir(root)).toString())}/pull-17")
    @Expect(exists(dir), true)
    @Expect(SessionWorkspace(log).effectiveDirectory(), dir)
    // PR 自带的提交被刚抓下来的远程 ref 接住 → 不算独有。
    @Expect(wtIntField(wtObject(tree.describe()), "uniqueCommits"), Int64(0))
    // 在 PR 分支上的新提交那个远程 ref 接不住 → 第三重保护照样拦住，discardChanges 越不过。
    File.writeTo(Path(dir).join("mine"), "work".toArray())
    wtGitAt(dir, ["add", "mine"])
    wtCommit(dir, "我的提交")
    @Expect(wtErrorCode({ => tree.exit("remove", discardChanges: true) }), "worktree-unique-commits")
    @Expect(exists(dir), true)
    wtGitAt(root, ["update-ref", "refs/remotes/origin/mine", wtGitAt(dir, ["rev-parse", "HEAD"])])
    @Expect(tree.exit("remove", discardChanges: true).contains("\"active\":false"), true)
    @Expect(exists(dir), false)
    // URL 形态对着非 GitHub 的 origin 必须拒（编号本身合法，但 owner/repo 核不上）。
    @Expect(wtErrorCode({ => tree.enterPullRequest("https://github.com/a/b/pull/17") }), "worktree-pr-origin-mismatch")
    @Expect(exists(Path(wtBaseDir(root)).join("pull-17")), false)
    wtTidy(root)
    wtTidy(remote)
}

@Test
func wtCorePullRequestFailuresLeaveNoDirectory() {
    // 没有 origin 的仓库：编号形态也拒，不建目录、不建分支。
    let root = wtFixture()
    let log = SessionLog(Path(root).join("a.log"))
    let tree = SessionWorktree(log, fallback: root)
    @Expect(wtErrorCode({ => tree.enterPullRequest("17") }), "worktree-pr-origin-missing")
    @Expect(exists(wtBaseDir(root)), false)
    @Expect(tree.active(), false)
    @Expect(SessionWorkspace(log).directory(), "")
    // origin 在但 PR 不存在：fetch 非零 → 拒，且目录、分支、远程 ref 都不留。
    let remote = wtTempDir()
    wtGitAt(remote, ["init", "--bare"])
    wtGitAt(root, ["remote", "add", "origin", remote])
    @Expect(wtErrorCode({ => tree.enterPullRequest("999") }), "worktree-pr-fetch-failed")
    @Expect(exists(Path(wtBaseDir(root)).join("pull-999")), false)
    @Expect(wtRefExists(root, "refs/heads/worktree-pull-999"), false)
    @Expect(wtRefExists(root, "refs/remotes/origin/pull/999/head"), false)
    @Expect(wtErrorCode({ => tree.exit("remove") }), "worktree-not-active")
    wtTidy(root)
    wtTidy(remote)
}

// ---------- I11 / I12 agent 生命周期与过期清理 ----------

@Test
func wtCoreAgentPrepareFinishLifecycle() {
    let root = wtFixture()
    let tree = SessionWorktree(SessionLog(Path(root).join("a.log")), fallback: root)
    let clean = tree.prepareAgent("one")
    @Expect(exists(clean), true)
    @Expect(wtAgentDirName(wtBaseName(clean)), true)
    @Expect(wtRefExists(root, "refs/heads/worktree-${wtBaseName(clean)}"), true)
    // 同一个 agentId 再准备一次是复用同一份目录（幂等，不产生第二份工作树）。
    @Expect(tree.prepareAgent("one"), clean)
    // 无改动 → 回收，目录与分支都没了。
    let done = wtObject(tree.finishAgent("one"))
    @Expect(wtBoolField(done, "retained"), false)
    @Expect(wtField(done, "directory"), clean)
    @Expect(exists(clean), false)
    @Expect(wtRefExists(root, "refs/heads/worktree-${wtBaseName(clean)}"), false)
    // 有改动 → 保留并把位置交回调用方。
    let dirty = tree.prepareAgent("two")
    File.writeTo(Path(dirty).join("draft"), "work in progress".toArray())
    let kept = wtObject(tree.finishAgent("two"))
    @Expect(wtBoolField(kept, "retained"), true)
    @Expect(wtField(kept, "directory"), dirty)
    @Expect(exists(dirty), true)
    // 收束之后再收束就是「没有这个在途代理」。
    @Expect(wtErrorCode({ => tree.finishAgent("two") }), "worktree-agent-unknown")
    @Expect(wtErrorCode({ => tree.finishAgent("never-prepared") }), "worktree-agent-unknown")
    wtTidy(root)
}

@Test
func wtCoreAgentIdValidation() {
    let root = wtFixture()
    let tree = SessionWorktree(SessionLog(Path(root).join("a.log")), fallback: root)
    for (bad in ["", "../x", "a/b", "a b", "-x", "agent-x", "a;b", "中文", wtStringOfLength(65)]) {
        @Expect(wtErrorCode({ => tree.prepareAgent(bad) }), "worktree-bad-agent-id")
    }
    @Expect(exists(wtBaseDir(root)), false)
    @Expect(wtErrorCode({ => tree.finishAgent("") }), "worktree-bad-agent-id")
    // 代理 id 允许的点线数字母都要收下。
    @Expect(exists(tree.prepareAgent("worker.1_a-2")), true)
    wtTidy(root)
}

@Test
func wtCoreSlugAndAgentIdReservedPrefixSeparateSurfaces() {
    // enter 侧 agent- 是保留前缀；agent 侧则必须是 agent- 前缀的目录名。
    @Expect(wtErrorCode({ => wtValidateSlug("agent-0123abc") }), "worktree-bad-name")
    @Expect(wtAgentDirName("agent-0123abc"), true)
    @Expect(wtAgentDirName("agent-0123ab"), false)
    @Expect(wtAgentDirName("agent-0123abcd"), false)
    @Expect(wtAgentDirName("agent-0123abcg"), false)
    @Expect(wtAgentDirName("worktree-agent-0123abc"), false)
    @Expect(wtAgentDirName("pull-17"), false)
    // 清理面按 agent- 前缀筛，分支名前缀 worktree- 不参与。
    @Expect(wtIsAgentWorktreeName("agent-0123abc"), true)
    @Expect(wtIsAgentWorktreeName("worktree-agent-0123abc"), false)
    @Expect(wtIsAgentWorktreeName("user"), false)
}

@Test
func wtCoreCleanupAgentsOnlyOldAgentDirectories() {
    let root = wtFixture()
    let base = wtBaseDir(root)
    let log = SessionLog(Path(root).join("a.log"))
    let tree = SessionWorktree(log, fallback: root)
    let minAge: Int64 = 31 * 24 * 3600
    let oneDay: Int64 = 24 * 3600
    // 用户命名的目录永不自动清理，哪怕已经老了一个月。
    let userDir = tree.enter("user")
    // 在途未收束的代理目录受保护，不因过期被收。
    let inFlight = tree.prepareAgent("in-flight")
    // 已收束且干净的代理目录：finishAgent 当场就回收了，不留给清理面。
    let recycled = tree.prepareAgent("clean")
    @Expect(tree.finishAgent("clean").contains("\"retained\":false"), true)
    @Expect(exists(recycled), false)
    // 已收束但有已跟踪改动而保留的目录：老化后仍按「未提交已跟踪改动」跳过。
    let dirty = tree.prepareAgent("dirty")
    File.writeTo(Path(dirty).join("seed"), "changed".toArray())
    @Expect(tree.finishAgent("dirty").contains("\"retained\":true"), true)
    // 已收束、干净、但有不可达提交 → 跳过。
    let committed = tree.prepareAgent("committed")
    wtGitAt(committed, ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid",
        "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "不可达"])
    @Expect(tree.finishAgent("committed").contains("\"retained\":true"), true)
    // 已收束、只有未跟踪文件（清理口径只看已跟踪）→ 老化后可收。
    let scratchy = tree.prepareAgent("untracked")
    File.writeTo(Path(scratchy).join("scratch"), "junk".toArray())
    @Expect(tree.finishAgent("untracked").contains("\"retained\":true"), true)
    // 名字像 agent- 但不是工作树/仓库的目录 → git 读不出来就跳过，绝不盲删。
    let stray = Path(base).join("agent-notaworktree").toString()
    Directory.create(stray, recursive: true)
    // 没到 31 天：一个都不动。
    @Expect(wtCleanupAgentDirs(base, [inFlight], wtMtimeSeconds(userDir) + oneDay, minAge), Int64(0))
    @Expect(exists(userDir), true)
    @Expect(exists(inFlight), true)
    @Expect(exists(dirty), true)
    @Expect(exists(committed), true)
    @Expect(exists(scratchy), true)
    @Expect(exists(stray), true)
    // 老化判据到位：只有「已跟踪干净 + 提交可保留」的 agent 目录被收，其余四类都留下。
    let aged = wtMtimeSeconds(userDir) + minAge + oneDay
    @Expect(wtCleanupAgentDirs(base, [inFlight], aged, minAge), Int64(1))
    @Expect(exists(scratchy), false)
    @Expect(exists(dirty), true)
    @Expect(exists(committed), true)
    @Expect(exists(stray), true)
    @Expect(exists(userDir), true)
    @Expect(exists(inFlight), true)
    // 真实钟（30 天门槛）下刚建好的目录一个都不该被收，包括用户命名的。
    @Expect(tree.cleanupAgents(), Int64(0))
    @Expect(exists(userDir), true)
    // 基目录不存在时返回 0，不抛。
    @Expect(wtCleanupAgentDirs(Path(root).join("nowhere").toString(), [], aged, minAge), Int64(0))
    wtTidy(root)
}

// ---------- I16 argv / 超时 / 两管道抽干 ----------

@Test
func wtCoreRunnerPassesArgvLiterally() {
    // 目录名里带 shell 元字符：拼 shell 字符串的实现会在这里碎掉，argv 形态不受影响。
    let root = wtFixtureIn(Path(wtTempDir()).join("a&b'c").toString())
    let tree = SessionWorktree(SessionLog(Path(root).join("a.log")), fallback: root)
    let dir = tree.enter("amp")
    @Expect(exists(dir), true)
    @Expect(wtGitRun(root, ["rev-parse", "--show-toplevel"]).exitCode, Int64(0))
    @Expect(wtStatusCount(dir), Int64(0))
    wtTidy(root)
}

@Test
func wtCoreRunnerTimesOutInsteadOfHanging() {
    let root = wtFixture()
    // ping 每次约一秒：给 300ms 必然超时，但调用必须有界返回并标出 timedOut。
    let slow = wtRunProgram("ping", ["-n", "5", "127.0.0.1"], root, 300)
    @Expect(slow.timedOut, true)
    // 超时不是挂死：到这里已经返回了，退出码由 terminate 决定所以不钉死值。
    // 正常命令在有界窗口内跑完，两路管道都被读完。
    let ok = wtGitRun(root, ["status", "--porcelain"])
    @Expect(ok.exitCode, Int64(0))
    @Expect(ok.timedOut, false)
    @Expect(ok.output.size, Int64(0))
    @Expect(ok.diagnostic.size, Int64(0))
    // 失败命令的 stderr 被收进 diagnostic，不是丢掉。
    let bad = wtGitRun(root, ["rev-parse", "--verify", "refs/heads/nope"])
    @Expect(bad.exitCode != 0, true)
    @Expect(bad.timedOut, false)
    @Expect(bad.diagnostic.size > 0, true)
    wtTidy(root)
}

@Test
func wtCoreRunnerDrainsLargerOutputThanThePipeBuffer() {
    let root = wtTempDir()
    wtGitAt(root, ["init", "-b", "main"])
    // 一次性写出远大于 64 KiB 管道缓冲的正文：不并发抽干 stdout，子进程就会写阻塞、
    // 这边只能等到超时。
    let chunk = wtStringOfLength(4096)
    let body = ArrayList<Byte>()
    for (_ in 0..48) { for (b in chunk.toArray()) { body.add(b) } }
    File.writeTo(Path(root).join("big"), body.toArray())
    wtGitAt(root, ["add", "."])
    wtCommit(root, "大文件夹具")
    let result = wtGitRun(root, ["log", "-p", "HEAD"])
    @Expect(result.exitCode, Int64(0))
    @Expect(result.timedOut, false)
    @Expect(result.output.size > 65536, true)
    wtTidy(root)
}

// ---------- I17 保护检查与删除之间串行化 ----------

@Test
func wtCoreConcurrentRemoveHasExactlyOneWinner() {
    let root = wtFixture()
    let path = Path(root).join("a.log").toString()
    let seedLog = SessionLog(path)
    let seed = SessionWorktree(seedLog, fallback: root)
    let dir = seed.enter("race")
    // 绑定先落盘，两个并发实例才都从磁盘读到同一条归属。
    @Expect(seedLog.flush(), true)
    @Expect(seedLog.pendingCount(), Int64(0))
    for (_ in 0..3) {
        // 两个实例各自回放同一份日志并发删除：只有一个能删成，另一个必须看到「绑定已失效」。
        // 关键在于保护检查与删除之间不能放手——否则两边都以为自己是第一个。
        let firstLog = SessionLog(path)
        @Expect(firstLog.load(), true)
        let secondLog = SessionLog(path)
        @Expect(secondLog.load(), true)
        let first = SessionWorktree(firstLog, fallback: root)
        let second = SessionWorktree(secondLog, fallback: root)
        let winner = spawn { => wtStringResult({ => first.exit("remove") }) }
        let loser = spawn { => wtStringResult({ => second.exit("remove") }) }
        let outcomes = ArrayList<String>()
        outcomes.add(winner.get(30 * Duration.second))
        outcomes.add(loser.get(30 * Duration.second))
        var removed: Int64 = 0
        var refused: Int64 = 0
        for (outcome in outcomes) {
            if (outcome.contains("\"active\":false")) { removed += 1 }
            if (outcome == "err:worktree-not-active") { refused += 1 }
        }
        // 恰成一个：两个都成是双重删除，两个都拒是死锁或误判。
        @Expect(removed, Int64(1))
        @Expect(refused, Int64(1))
        @Expect(exists(dir), false)
        @Expect(wtRefExists(root, "refs/heads/worktree-race"), false)
        // 下一轮重新绑定并落盘；归属记录还在，所以同名目录能重建。
        let again = SessionLog(path)
        @Expect(again.load(), true)
        @Expect(SessionWorktree(again, fallback: root).enter("race"), dir)
        @Expect(again.flush(), true)
    }
    wtTidy(root)
}

// ---------- I1 目录穿越与重解析点 ----------

@Test
func wtCoreBaseDirectoryEscapeRejected() {
    let root = wtFixture()
    let other = wtFixture()
    // 本机无符号链接权限，但 junction 普通用户就能建（实测）：重解析点必须被
    // canonicalize 包含性检查或链接检查拒掉，绝不把 worktree 建到别人的仓库里。
    let link = wtSlashes(Path(root).join(".sacode").toString()).replace("/", "\\")
    let target = wtSlashes(other).replace("/", "\\")
    let (rc, _, err) = executeWithOutput("cmd", ["/c", "mklink", "/J", link, target])
    if (rc != 0) { throw Exception("junction-fixture-unavailable:${String.fromUtf8(err)}") }
    let tree = SessionWorktree(SessionLog(Path(root).join("a.log")), fallback: root)
    @Expect(wtErrorCode({ => tree.enter("escape") }), "worktree-base-escape")
    @Expect(wtErrorCode({ => tree.prepareAgent("escape") }), "worktree-base-escape")
    @Expect(tree.active(), false)
    // 逃逸被拒后不许在别人的仓库里留下任何东西（junction 把 .sacode 指过去，
    // 所以穿出去的路径是 other/worktrees/<...>）。
    @Expect(exists(Path(other).join("worktrees").join("escape")), false)
    @Expect(exists(Path(other).join("worktrees")), false)
    // junction 本身先摘掉，否则整目录递归清理会顺着链接删。
    executeWithOutput("cmd", ["/c", "rmdir", link])
    wtTidy(root)
    wtTidy(other)
}
