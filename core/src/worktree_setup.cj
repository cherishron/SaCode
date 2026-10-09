package core

import std.collection.ArrayList
import std.env.*
import std.fs.*
import stdx.encoding.json.*

// 会话级 worktree 的「创建后装配」（计划 T2）。
//
// 职责只有一件事：把主仓里那些「不进版本库、但工作树必须看得见」的目录接过来——
// 按 `worktree.symlinkDirectories` 配置逐条建符号链接，再把 hooks 来源指过去。
// 不做的事：不建工作树（那是 SessionWorktree）、不改会话日志、不写第二本账、
// 不在 Windows 缺符号链接权限时偷偷改成复制——静默降级会让工作树和主仓变成
// 两份会各自漂移的副本，比失败更糟。
//
// 配置来源与优先级：`<repo>/.sacode/settings.json` 覆盖 `~/.sacode/settings.json`，
// 整份替换而不是逐条合并（列表设置半合并会让「项目里去掉一项」做不到）。
//
// hooks 口径：优先主仓 `.husky/`；主仓没有 `.husky/` 时用 `git rev-parse --git-path hooks`。
// 后者在链接工作树里解析出的就是主仓的 hooks 目录（本机 git 2.52 实测），
// 所以那种情况下工作树本来就在用同一套钩子，不需要额外链接。

// ---------- 失败出口 ----------

func wsFail(code: String, detail!: String = ""): Nothing {
    if (detail.size > 0) {
        getStdErr().writeln("worktree setup ${code}: ${detail}")
    }
    throw Exception(code)
}

// ---------- 设置文件与条目 ----------

let wsHooksDirectoryName: String = ".husky"

// 用户级设置文件：与 web_settings.cj 同一套 HOME 取法。取不到 HOME 就当没配。
func wsUserSettingsFile(): String {
    let home = getVariable("USERPROFILE") ?? (getVariable("HOME") ?? "")
    if (home.size == 0) { return "" }
    return Path(home).join(".sacode").join("settings.json").toString()
}

func wsProjectSettingsFile(repoRoot: String): String {
    return Path(repoRoot).join(".sacode").join("settings.json").toString()
}

func wsReadText(file: String): String {
    var text = ""
    try { text = String.fromUtf8(File.readFrom(file)) }
    catch (e: Exception) { wsFail("worktree-settings-unreadable", detail: file) }
    return text
}

// 读一份 settings.json 里的 worktree.symlinkDirectories。
// None = 这份文件没给这个键（文件不存在也算没给，缺文件不是错误）。
// 键在但形状不对、`worktree` 段里出现没声明的键、条目不是字符串——都当场拒：
// 把坏配置读成「没配」等于静默关掉装配，那是假成功。
func wsSymlinkDirectories(file: String): Option<Array<String>> {
    if (file.size == 0 || !exists(file)) { return None }
    var parsed: JsonValue = JsonString("")
    try { parsed = JsonValue.fromStr(wsReadText(file)) }
    catch (e: Exception) { wsFail("worktree-settings-invalid", detail: file) }
    var object = JsonObject()
    try { object = parsed.asObject() }
    catch (e: Exception) { wsFail("worktree-settings-invalid", detail: file) }
    if (let Some(section) <- object.get("worktree")) {
        var tree = JsonObject()
        try { tree = section.asObject() }
        catch (e: Exception) { wsFail("worktree-settings-invalid", detail: "${file}:worktree") }
        for ((key, _) in tree.getFields()) {
            if (key != "symlinkDirectories") { wsFail("worktree-settings-invalid", detail: "${file}:worktree/${key}") }
        }
        if (let Some(value) <- tree.get("symlinkDirectories")) {
            var list = JsonArray()
            try { list = value.asArray() }
            catch (e: Exception) { wsFail("worktree-settings-invalid", detail: "${file}:symlinkDirectories") }
            let entries = ArrayList<String>()
            for (index in 0..list.size()) {
                var item: JsonValue = JsonString("")
                try { item = list.get(index).getOrThrow() }
                catch (e: Exception) { wsFail("worktree-settings-invalid", detail: "${file}:entry") }
                var text = ""
                try { text = item.asString().getValue() }
                catch (e: Exception) { wsFail("worktree-settings-invalid", detail: "${file}:entry") }
                entries.add(text)
            }
            return Some(entries.toArray())
        }
    }
    return None
}

// 只收仓库内的相对路径。拒：绝对路径（`/x`、`\server\x`、`C:\x`、`~/x`）、
// 任何 `..` 或 `.` 段、空段、盘符与冒号、超长与过深的条目。通过核验后按段重拼，
// 归一化分隔符——配置里 `a\b` 与 `a/b` 是同一个目录，不给两套写法留分叉。
func wsNormaliseEntry(entry: String): String {
    if (entry.size == 0 || entry.size > 512) { wsFail("worktree-bad-symlink-entry", detail: entry) }
    if (entry.contains(":") || entry.startsWith("~")) { wsFail("worktree-bad-symlink-entry", detail: entry) }
    let unified = entry.replace("\\", "/")
    if (unified.startsWith("/")) { wsFail("worktree-bad-symlink-entry", detail: entry) }
    let segments = unified.split("/")
    if (segments.size == 0 || segments.size > 16) { wsFail("worktree-bad-symlink-entry", detail: entry) }
    let kept = ArrayList<String>()
    for (segment in segments) {
        if (segment.size == 0 || segment == ".." || segment == ".") { wsFail("worktree-bad-symlink-entry", detail: entry) }
        if (segment.contains("\n") || segment.contains("\r")) { wsFail("worktree-bad-symlink-entry", detail: entry) }
        kept.add(segment)
    }
    var path = ""
    for (index in 0..Int64(kept.size)) {
        if (index > 0) { path += "/" }
        path += kept[index]
    }
    return path
}

func wsCanonical(path: String): String {
    var resolved = ""
    try { resolved = canonicalize(path).toString() }
    catch (e: Exception) { wsFail("worktree-setup-path-unavailable", detail: path) }
    return resolved
}

func wsJoinRelative(base: String, relative: String): String {
    var path = base
    for (segment in relative.split("/")) { path = Path(path).join(segment).toString() }
    return path
}

// ---------- 装配结果 ----------

public class WorktreeLink {
    public let entry: String
    public let source: String
    public let link: String
    public let fromHooks: Bool
    public init(entry: String, source: String, link: String, fromHooks: Bool) {
        this.entry = entry
        this.source = source
        this.link = link
        this.fromHooks = fromHooks
    }
}

public class WorktreeSetup {
    let repoRoot: String
    let userFile: String
    let projectFile: String

    // 两个设置路径都可注入：生产走默认（~/.sacode 与 <repo>/.sacode），
    // 用例传私有路径，不拿真用户配置去赌断言。
    public init(repoRoot: String, userSettingsFile!: String = "", projectSettingsFile!: String = "") {
        this.repoRoot = repoRoot
        this.userFile = if (userSettingsFile.size > 0) { userSettingsFile } else { wsUserSettingsFile() }
        this.projectFile = if (projectSettingsFile.size > 0) { projectSettingsFile } else { wsProjectSettingsFile(repoRoot) }
    }

    // 生效的条目表：项目配了就整份覆盖用户。
    public func symlinkEntries(): Array<String> {
        if (let Some(list) <- wsSymlinkDirectories(projectFile)) { return list }
        if (let Some(list) <- wsSymlinkDirectories(userFile)) { return list }
        return ArrayList<String>().toArray()
    }

    // hooks 来源：主仓 `.husky/` 优先，其次问 git。
    public func hooksDirectory(): String {
        let root = wsCanonical(repoRoot)
        let husky = Path(root).join(wsHooksDirectoryName).toString()
        if (exists(husky) && FileInfo(husky).isDirectory()) { return wsCanonical(husky) }
        return wtResolveGitPath(root, wtGitText(root, ["rev-parse", "--git-path", "hooks"]))
    }

    // 纯核验：不做任何副作用。用例直接断言这张表，apply 也复用它。
    public func plan(worktreeDirectory: String): Array<WorktreeLink> {
        let root = wsCanonical(repoRoot)
        let worktree = wsCanonical(worktreeDirectory)
        let links = ArrayList<WorktreeLink>()
        for (entry in symlinkEntries()) {
            let relative = wsNormaliseEntry(entry)
            let source = wsJoinRelative(root, relative)
            // 源不存在 → 跳过：仓库里没装依赖时工作树也该进得去。
            if (!exists(source)) { continue }
            let real = wsCanonical(source)
            // 规范路径必须仍在主仓之内：条目写得合规、但解析出去到了仓外（重解析点）也拒。
            if (!wtIsUnder(real, root) || wtNormalisedPath(real) == wtNormalisedPath(root)) {
                wsFail("worktree-symlink-escape", detail: entry)
            }
            // 探针的异常只当「读不出链接位」，不能把拒装配的码一起吞掉，所以判空在外面。
            var isLink = false
            try { isLink = FileInfo(source).isSymbolicLink() }
            catch (e: Exception) { isLink = false }
            if (isLink) { wsFail("worktree-symlink-escape", detail: entry) }
            let link = wsJoinRelative(worktree, relative)
            // 目标已存在 → 跳过：不覆盖工作树里真实检出的那份目录。
            if (exists(link)) { continue }
            links.add(WorktreeLink(entry, real, link, false))
        }
        // hooks 继承只在主仓真有 `.husky/` 时发生；那时工作树里缺的就是这一份。
        let husky = Path(root).join(wsHooksDirectoryName).toString()
        if (exists(husky) && FileInfo(husky).isDirectory()) {
            let target = Path(worktree).join(wsHooksDirectoryName).toString()
            if (!exists(target)) {
                links.add(WorktreeLink(wsHooksDirectoryName, wsCanonical(husky), target, true))
            }
        }
        return links.toArray()
    }

    // 建链。任何一条建不成（Windows 普通用户没有符号链接权限是主要场景）就
    // 撤掉本次已建的链再原样抛出——绝不降级成复制。
    public func apply(worktreeDirectory: String): String {
        let created = ArrayList<String>()
        var linked: Int64 = 0
        var skipped: Int64 = 0
        var failure = ""
        for (item in plan(worktreeDirectory)) {
            // plan 之后到动手之前再核一遍：中间被人占了位就跳过，不去覆盖别人的东西；
            // 源消失也不再建断链。
            if (exists(item.link) || !exists(item.source)) { skipped += 1; continue }
            var denied = ""
            try { SymbolicLink.create(Path(item.link), to: Path(item.source)) }
            catch (e: Exception) { denied = e.message }
            if (denied.size > 0) {
                failure = "${item.entry}:${denied}"
                break
            }
            created.add(item.link)
            linked += 1
        }
        if (failure.size > 0) {
            // 摘链接而不是删目标：recursive:false 下目录链接删不掉就留在原地，
            // 下一次 apply 按「目标已存在」跳过，不会把主仓内容连带删走。
            for (path in created) {
                try { removeIfExists(path, recursive: false) } catch (e: Exception) {}
            }
            wsFail("worktree-symlink-denied", detail: failure)
        }
        return "{\"linked\":${linked},\"skipped\":${skipped}}"
    }
}

// 创建后装配的接线位（SessionWorktree 新建工作树之后调这里）。
// 没有任何条目、也没有 `.husky` 时是彻底的 no-op：不碰磁盘，也不试探符号链接权限。
func wtApplySetupAfterCreate(repoRoot: String, worktreeDirectory: String): Unit {
    let setup = WorktreeSetup(repoRoot)
    if (setup.plan(worktreeDirectory).size == 0) { return }
    setup.apply(worktreeDirectory)
}
