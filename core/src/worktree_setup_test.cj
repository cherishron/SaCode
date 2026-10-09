package core

import std.env.*
import std.fs.*
import std.process.*
import std.unittest.*

// 会话级 worktree 的「创建后装配」（计划 T2）契约测试。
// 口径来自 docs/superpowers/plans/2026-10-08-session-worktree.md 与任务书第 6 条：
// S1 项目设置整份覆盖用户设置
// S2 条目拒绝对外路径与含 `..` 的段
// S3 canonicalize 之后不许逃逸出主仓
// S4 源不存在 / 目标已存在都跳过（不是错误）
// S5 hooks 优先主仓 `.husky/`，没有才用 `git rev-parse --git-path hooks`
// S6 Windows 无符号链接权限时如实抛错，绝不静默改成复制
// S7 坏 settings.json 当场拒，不读成「没配」
// S8 装配只在创建工作树之后发生，失败不留半成品，且不写会话日志（不建第二真源）
//
// 本机实测前提（当轮直查）：普通用户建符号链接会被拒（PowerShell New-Item
// -ItemType SymbolicLink 报 "Administrator privilege required"），但 junction 能建。
// 所以符号链接的正向分支要按环境走两条路，两条都必须落到「不许复制」。

// ---------- 夹具 ----------

func wsTTemp(): String {
    let base = getVariable("TMP") ?? (getVariable("TEMP") ?? ".")
    return Directory.createTemp(Path(base)).toString()
}

func wsTGitAt(dir: String, args: Array<String>): String {
    let (rc, out, err) = executeWithOutput("git", args, workingDirectory: Some(Path(dir)))
    if (rc != 0) { throw Exception("git-${args[0]}:${String.fromUtf8(err)}") }
    return String.fromUtf8(out).trimAscii()
}

func wsTFixture(): String {
    let dir = wsTTemp()
    wsTGitAt(dir, ["init", "-b", "main"])
    File.writeTo(Path(dir).join("seed"), "shared-seed".toArray())
    File.writeTo(Path(dir).join(".gitignore"), ".sacode/\n".toArray())
    wsTGitAt(dir, ["add", "."])
    wsTGitAt(dir, ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid",
        "-c", "commit.gpgsign=false", "commit", "-m", "装配夹具"])
    return canonicalize(dir).toString()
}

func wsTError(action: () -> Unit): String {
    try { action() } catch (e: Exception) { return e.message }
    return ""
}

func wsTNorm(path: String): String {
    return path.replace("\\", "/")
}

func wsTWrite(file: String, text: String): Unit {
    File.writeTo(file, text.toArray())
}

// 项目设置写进 <repo>/.sacode/settings.json（走默认解析路径），用户设置给私有文件。
func wsTProjectFile(repo: String): String {
    return Path(repo).join(".sacode").join("settings.json").toString()
}

func wsTTidy(path: String): Unit {
    try { removeIfExists(path, recursive: true) } catch (e: Exception) {}
}

// 本机能不能建符号链接——直接探一次，不猜。探测产物只落在私有临时目录里。
func wsTSymlinkPossible(dir: String): Bool {
    let target = Path(dir).join("probe-target").toString()
    let link = Path(dir).join("probe-link").toString()
    Directory.create(target, recursive: false)
    var allowed = true
    try { SymbolicLink.create(Path(link), to: Path(target)) }
    catch (e: Exception) { allowed = false }
    if (allowed) { try { removeIfExists(link, recursive: false) } catch (e: Exception) {} }
    return allowed
}

// ---------- S1 / S7 设置读取与优先级 ----------

@Test
func wsTProjectSettingsOverrideUserEntirely() {
    let repo = wsTFixture()
    let worktree = wsTTemp()
    let dir = wsTTemp()
    let userFile = Path(dir).join("user.json").toString()
    let projectFile = Path(dir).join("project.json").toString()
    let setup = WorktreeSetup(repo, userSettingsFile: userFile, projectSettingsFile: projectFile)
    // 两份都没配 = 空表，不是错误。
    @Expect(setup.symlinkEntries().size, Int64(0))
    wsTWrite(userFile, "{\"worktree\":{\"symlinkDirectories\":[\"node_modules\"]}}")
    wsTWrite(projectFile, "{\"worktree\":{\"symlinkDirectories\":[\"dist\",\".cache\"]}}")
    // 整份覆盖，不是逐条合并。
    let merged = setup.symlinkEntries()
    @Expect(merged.size, Int64(2))
    @Expect(merged[0], "dist")
    @Expect(merged[1], ".cache")
    // 项目文件存在但没这个键 → 回落用户配置（不是清空）。
    wsTWrite(projectFile, "{\"editor\":{\"tabSize\":2}}")
    let fell = setup.symlinkEntries()
    @Expect(fell.size, Int64(1))
    @Expect(fell[0], "node_modules")
    // 项目文件干脆没有 → 同样回落用户。
    removeIfExists(projectFile, recursive: false)
    @Expect(setup.symlinkEntries().size, Int64(1))
    // 坏 JSON、worktree 段里的未知键、条目不是字符串：都当场拒，不能读成「没配」。
    wsTWrite(userFile, "{ not json")
    @Expect(wsTError({ => setup.symlinkEntries() }), "worktree-settings-invalid")
    wsTWrite(userFile, "{\"worktree\":{\"hooksPath\":\"x\"}}")
    @Expect(wsTError({ => setup.symlinkEntries() }), "worktree-settings-invalid")
    wsTWrite(userFile, "{\"worktree\":{\"symlinkDirectories\":[1]}}")
    @Expect(wsTError({ => setup.symlinkEntries() }), "worktree-settings-invalid")
    wsTWrite(userFile, "{\"worktree\":{\"symlinkDirectories\":\"node_modules\"}}")
    @Expect(wsTError({ => setup.symlinkEntries() }), "worktree-settings-invalid")
    // 缺文件不是错误：删掉坏配置就回到空表。
    removeIfExists(userFile, recursive: false)
    @Expect(setup.symlinkEntries().size, Int64(0))
    @Expect(setup.plan(worktree).size, Int64(0))
    wsTTidy(repo)
    wsTTidy(worktree)
    wsTTidy(dir)
}

// ---------- S2 条目核验 ----------

@Test
func wsTEntriesRejectExternalPathsAndDotDotSegments() {
    // 对外路径与穿越段是拒（抛），不是跳过——跳过等于替用户把错配置咽下去。
    for (bad in ["", "/abs", "/.", "C:/x", "c:\\x", "\\\\server\\share", "~/x", "node:modules",
        "..", "../x", "a/../b", "a/./b", "a//b", "a/", ".a/../../b"]) {
        @Expect(wsTError({ => wsNormaliseEntry(bad) }), "worktree-bad-symlink-entry")
    }
    // 仓库内相对路径收下，并把反斜杠写法归一化成同一条路径。
    @Expect(wsNormaliseEntry("node_modules"), "node_modules")
    @Expect(wsNormaliseEntry(".cache"), ".cache")
    @Expect(wsNormaliseEntry("a/b"), "a/b")
    @Expect(wsNormaliseEntry("a\\b"), "a/b")
    // 超长条目拒（也挡住 argv 侧的失控输入）。
    var longName = ""
    for (_ in 0..600) { longName += "a" }
    @Expect(wsTError({ => wsNormaliseEntry(longName) }), "worktree-bad-symlink-entry")
}

// ---------- S3 / S4 逃逸与跳过 ----------

@Test
func wsTPlanSkipsMissingSourceAndExistingTarget() {
    let repo = wsTFixture()
    let worktree = wsTTemp()
    let dir = wsTTemp()
    let projectFile = Path(dir).join("project.json").toString()
    wsTWrite(projectFile, "{\"worktree\":{\"symlinkDirectories\":[\"node_modules\",\"dist\"]}}")
    let setup = WorktreeSetup(repo, userSettingsFile: Path(dir).join("absent.json").toString(),
        projectSettingsFile: projectFile)
    // 源目录不存在 → 整份计划是空的（没装依赖的仓库也要能进得去）。
    @Expect(setup.plan(worktree).size, Int64(0))
    Directory.create(Path(repo).join("node_modules"), recursive: false)
    wsTWrite(Path(repo).join("node_modules").join("dep.js"), "export const one = 1")
    let links = setup.plan(worktree)
    @Expect(links.size, Int64(1))
    @Expect(links[0].entry, "node_modules")
    @Expect(links[0].fromHooks, false)
    @Expect(wsTNorm(links[0].source), wsTNorm(canonicalize(Path(repo).join("node_modules")).toString()))
    @Expect(wsTNorm(links[0].link), wsTNorm(Path(worktree).join("node_modules").toString()))
    // 目标已存在 → 跳过，不覆盖工作树里真实检出的那份。
    Directory.create(Path(worktree).join("node_modules"), recursive: false)
    @Expect(setup.plan(worktree).size, Int64(0))
    wsTTidy(repo)
    wsTTidy(worktree)
    wsTTidy(dir)
}

@Test
func wsTPlanRejectsSourceThatCanonicalisesOutOfRepo() {
    let repo = wsTFixture()
    let outside = wsTTemp()
    let worktree = wsTTemp()
    let dir = wsTTemp()
    wsTWrite(Path(outside).join("treasure"), "别人的东西".toArray())
    // 条目名合规（shared），但它在主仓里是个指出去的重解析点：canonicalize 必须抓到。
    let link = wsTNorm(Path(repo).join("shared").toString()).replace("/", "\\")
    let target = wsTNorm(outside).replace("/", "\\")
    let (rc, _, err) = executeWithOutput("cmd", ["/c", "mklink", "/J", link, target])
    if (rc != 0) { throw Exception("junction-fixture-unavailable:${String.fromUtf8(err)}") }
    let projectFile = Path(dir).join("project.json").toString()
    wsTWrite(projectFile, "{\"worktree\":{\"symlinkDirectories\":[\"shared\"]}}")
    let setup = WorktreeSetup(repo, userSettingsFile: Path(dir).join("absent.json").toString(),
        projectSettingsFile: projectFile)
    @Expect(wsTError({ => setup.plan(worktree) }), "worktree-symlink-escape")
    // 越界被拒后不装配任何东西，工作树里也不该出现指出去的链。
    @Expect(wsTError({ => setup.apply(worktree) }), "worktree-symlink-escape")
    @Expect(exists(Path(worktree).join("shared")), false)
    // 从 junction 走也不许在别人的目录里留痕。
    @Expect(exists(Path(outside).join("worktrees")), false)
    executeWithOutput("cmd", ["/c", "rmdir", link])
    wsTTidy(repo)
    wsTTidy(outside)
    wsTTidy(worktree)
    wsTTidy(dir)
}

// ---------- S5 hooks 来源 ----------

@Test
func wsTHooksPreferMainRepoHuskyThenGitPath() {
    let repo = wsTFixture()
    let dir = wsTTemp()
    let absent = Path(dir).join("absent.json").toString()
    // 主仓没有 .husky：用 git 的 hooks 路径，且必须是主仓 common 的那一份。
    let without = WorktreeSetup(repo, userSettingsFile: absent, projectSettingsFile: absent)
    @Expect(wsTNorm(without.hooksDirectory()),
        wsTNorm(canonicalize(Path(repo).join(".git").join("hooks")).toString()))
    // 主仓有 .husky：优先它，不再用 .git/hooks。
    Directory.create(Path(repo).join(".husky"), recursive: false)
    wsTWrite(Path(repo).join(".husky").join("pre-commit"), "#!/bin/sh".toArray())
    let withHusky = WorktreeSetup(repo, userSettingsFile: absent, projectSettingsFile: absent)
    @Expect(wsTNorm(withHusky.hooksDirectory()),
        wsTNorm(canonicalize(Path(repo).join(".husky")).toString()))
    // 链接工作树里问同一个问题，git 交回的还是主仓 common 的 hooks（本机 git 2.52 实测）：
    // 没有 .husky 时钩子本来就共享，所以那种情况下 plan 不再建 .husky 链。
    let detached = Path(repo).join("linked").toString()
    wsTGitAt(repo, ["worktree", "add", "--detach", detached, "HEAD"])
    removeIfExists(Path(repo).join(".husky").join("pre-commit").toString(), recursive: false)
    removeIfExists(Path(repo).join(".husky").toString(), recursive: false)
    let fromLinked = WorktreeSetup(detached, userSettingsFile: absent, projectSettingsFile: absent)
    @Expect(wsTNorm(fromLinked.hooksDirectory()),
        wsTNorm(canonicalize(Path(repo).join(".git").join("hooks")).toString()))
    // 有 .husky 时它才进计划，来源仍是主仓那一份。
    Directory.create(Path(repo).join(".husky"), recursive: false)
    wsTWrite(Path(repo).join(".husky").join("pre-commit"), "#!/bin/sh".toArray())
    let planned = WorktreeSetup(detached, userSettingsFile: absent, projectSettingsFile: absent).plan(detached)
    var hooks: Int64 = 0
    for (item in planned) {
        if (item.fromHooks) { hooks += 1 }
        @Expect(wsTNorm(item.link).endsWith("/.husky"), true)
    }
    @Expect(hooks, Int64(1))
    wsTTidy(repo)
    wsTTidy(dir)
}

// ---------- S6 无符号链接权限时如实抛错，绝不复制 ----------

@Test
func wsTApplyFailsLoudlyAndNeverCopies() {
    let repo = wsTFixture()
    let worktree = wsTTemp()
    let dir = wsTTemp()
    let absent = Path(dir).join("absent.json").toString()
    let projectFile = Path(dir).join("project.json").toString()
    wsTWrite(projectFile, "{\"worktree\":{\"symlinkDirectories\":[\"node_modules\"]}}")
    Directory.create(Path(repo).join("node_modules"), recursive: false)
    wsTWrite(Path(repo).join("node_modules").join("dep.js"), "the-only-copy".toArray())
    let setup = WorktreeSetup(repo, userSettingsFile: absent, projectSettingsFile: projectFile)
    let canSymlink = wsTSymlinkPossible(dir)
    if (!canSymlink) {
        // 本机就是这一支：必须报「权限被拒」这个码，而不是伪装成功。
        let report = wsTError({ => setup.apply(worktree) })
        @Expect(report, "worktree-symlink-denied")
    } else {
        let report = setup.apply(worktree)
        @Expect(report.contains("\"linked\":1"), true)
        // 再跑一次：目标已存在 → 跳过，不报错也不覆盖。
        @Expect(setup.apply(worktree).contains("\"skipped\":1"), true)
    }
    // 两支共有的硬性反证：没有把主仓内容复制进工作树。
    // 能建链时那份内容是透过链接看到的同一份；不能建链时必须什么都不是。
    if (!canSymlink) {
        @Expect(exists(Path(worktree).join("node_modules")), false)
        @Expect(exists(Path(worktree).join("node_modules").join("dep.js")), false)
    } else {
        @Expect(String.fromUtf8(File.readFrom(Path(worktree).join("node_modules").join("dep.js"))), "the-only-copy")
        @Expect(wsTSymlinkReadsAsLink(worktree, "node_modules"), true)
    }
    // 装配不写会话日志：日志里只有绑定与目录变更，不设第二真源。
    let log = SessionLog(Path(repo).join("a.log"))
    let before = log.eventCount()
    let settled = wsTError({ => setup.apply(worktree) })
    @Expect(log.eventCount(), before)
    // 同一份配置第二次跑：能建链时是「跳过」，不能建链时仍然是「拒」，不会假成功。
    @Expect(settled, if (canSymlink) { "" } else { "worktree-symlink-denied" })
    wsTTidy(repo)
    wsTTidy(worktree)
    wsTTidy(dir)
}

// 链接位是不是真链接（而不是被复制出来的目录）——只有能建链的环境用得上。
func wsTSymlinkReadsAsLink(worktree: String, entry: String): Bool {
    var linked = false
    try { linked = FileInfo(Path(worktree).join(entry).toString()).isSymbolicLink() }
    catch (e: Exception) { linked = false }
    return linked
}

// ---------- S8 接线：创建工作树之后才装配，失败不留半成品 ----------

@Test
func wsTEnterAssemblesCreatedWorktreeOnly() {
    let repo = wsTFixture()
    let dir = wsTTemp()
    let log = SessionLog(Path(repo).join("a.log"))
    let tree = SessionWorktree(log, fallback: repo)
    // 没配任何东西时是彻底 no-op：正常建得起工作树，工作树里也不多一个目录。
    let plain = tree.enter("plain")
    @Expect(exists(plain), true)
    @Expect(exists(Path(plain).join("node_modules")), false)
    @Expect(tree.exit("keep").contains("\"active\":false"), true)
    // 项目配置写进 <repo>/.sacode/settings.json：走 enter 的默认解析路径。
    // `.sacode` 这时已经被上面那次 enter 建出来了，只在缺失时补建。
    if (!exists(Path(repo).join(".sacode"))) { Directory.create(Path(repo).join(".sacode"), recursive: false) }
    wsTWrite(wsTProjectFile(repo), "{\"worktree\":{\"symlinkDirectories\":[\"node_modules\"]}}")
    Directory.create(Path(repo).join("node_modules"), recursive: false)
    wsTWrite(Path(repo).join("node_modules").join("dep.js"), "wired-copy".toArray())
    let canSymlink = wsTSymlinkPossible(dir)
    if (canSymlink) {
        let wired = tree.enter("wired")
        @Expect(String.fromUtf8(File.readFrom(Path(wired).join("node_modules").join("dep.js"))), "wired-copy")
        // 这里只解绑不删除：链进来的目录在未跟踪口径里算脏，删除要另走 discardChanges，
        // 与装配本身无关。
        @Expect(tree.exit("keep").contains("\"active\":false"), true)
    } else {
        // 无权限：如实抛「拒绝」而不是悄悄复制一份。
        @Expect(wsTError({ => tree.enter("wired") }), "worktree-symlink-denied")
        // 且不留半成品工作树、不留绑定、不写目录变更之外的日志。
        @Expect(exists(Path(repo).join(".sacode").join("worktrees").join("wired")), false)
        @Expect(tree.active(), false)
        var directoryEvents: Int64 = 0
        for (event in log.snapshotEvents()) { if (event.eventType == "workspace/directory") { directoryEvents += 1 } }
        @Expect(directoryEvents, Int64(2))
    }
    // 已存在的工作树走复用路径：不重复装配，也不因为装配而失败。
    let again = tree.enter("plain")
    @Expect(exists(again), true)
    @Expect(again, plain)
    wsTTidy(repo)
    wsTTidy(dir)
}
