package core

import std.fs.*
import std.env.getHomeDirectory
import std.collection.ArrayList
import std.collection.HashSet

// FilesystemSkillProvider（第 2 段）：扫描四层根，解析 SKILL.md frontmatter，文件边界守卫。
// 对齐 docs/plans/skill-integration-design-2026-10-20.md §3.2。
//
// 四层优先级（先返回的覆盖后返回的同名——先到先得）：
//   project-native(<project>/.sa-code/skills) > project-agents(<project>/.agents/skills)
//   > user(<userHome>/.sacode/skills) > bundled(<appResources>/skills)
// 文件格式：Markdown + YAML frontmatter 子集（见 parseSkillFile）。不递归子目录（depth=1）。
// 文件边界：路径组件边界判定、符号链接/reparse 拒绝（candidate+祖先）、超 maxBytes 拒绝、
//   frontmatter 坏丢弃候选不抛。get() 最终读取重新核对路径/链接/大小/名称（TOCTOU 防护，见下）。

// ─── 内部记录 ───────────────────────────────────────────────

class SkillLayer {
    let source: String
    let dir: String
    init(source: String, dir: String) {
        this.source = source
        this.dir = dir
    }
}

class ParsedSkill {
    let name: String
    let description: String
    let whenToUse: String
    let modelInvocable: Bool
    let userInvocable: Bool
    let content: String
    init(name: String, description: String, whenToUse: String,
         modelInvocable: Bool, userInvocable: Bool, content: String) {
        this.name = name
        this.description = description
        this.whenToUse = whenToUse
        this.modelInvocable = modelInvocable
        this.userInvocable = userInvocable
        this.content = content
    }
}

class SkillPath {
    let path: String
    let resourceDir: String
    init(path: String, resourceDir: String) {
        this.path = path
        this.resourceDir = resourceDir
    }
}

// ─── 公共辅助函数（测试可见）──────────────────────────────

// 技能名校验：kebab-case，^[a-z0-9]+(-[a-z0-9]+)*$。手写避免正则依赖。
public func isValidSkillName(name: String): Bool {
    if (name.size == 0) { return false }
    var prevHyphen = true
    for (b in name) {
        if (b == b'-') {                            // '-'
            if (prevHyphen) { return false }      // 首位或连续连字符
            prevHyphen = true
        } else if ((b >= b'a' && b <= b'z') || (b >= b'0' && b <= b'9')) {
            prevHyphen = false                    // a-z / 0-9
        } else {
            return false                          // 大写或非 ASCII
        }
    }
    return !prevHyphen                            // 不允许尾随连字符
}

// 路径归一：反斜杠→正斜杠，去尾部斜杠。不做大小写折叠——canonicalize 在 Windows
// 上已返回真实大小写，跨平台按 canonical 后的字节序比较即可。
func normalizeSep(p: String): String {
    var s = p
    if (s.contains("\\")) {
        s = s.replace("\\", "/")
    }
    while (s.size > 0 && s.endsWith("/")) {
        s = s[0..s.size - Int64(1)]
    }
    return s
}

// 按路径组件边界判定 child 是否在 root 内（或等于 root）。
// 不用 startsWith：避免 skills-other/file.md 误判在 skills 内。
func isDescendantByComponent(child: String, root: String): Bool {
    let c = normalizeSep(child)
    let r = normalizeSep(root)
    if (c == r) { return true }
    return c.startsWith("${r}/")
}

// 路径穿越/链接越界守卫（§3.2 文件边界）。
// 1) candidate 本身是符号链接/reparse → 拒。
// 2) canonicalize 后必须按组件边界在 root 内 → 拒穿越。
// 3) 沿原始路径从父逐级到 root，任一祖先是符号链接 → 拒（depth=1 时通常无中间祖先，
//    作为 defense-in-depth）。
public func skillPathInsideRoot(candidate: String, root: String): Bool {
    try {
        if (FileInfo(candidate).isSymbolicLink()) { return false }
        let realCPath = canonicalize(candidate)
        let realC = realCPath.toString()
        let realRoot = canonicalize(root).toString()
        if (!isDescendantByComponent(realC, realRoot)) { return false }
        // 祖先 reparse 检查：沿原始路径从父到 root，任一是符号链接即拒
        // （depth=1 通常无中间祖先，作 defense-in-depth；用 canonicalize 保证 .parent 可用）
        var ap = realCPath.parent
        var loopGuard = Int64(0)
        while (loopGuard < Int64(64) && ap.toString().size > 0) {
            let apStr = ap.toString()
            let apReal = canonicalize(apStr).toString()
            if (apReal == realRoot || isDescendantByComponent(apReal, realRoot)) {
                break   // 已到 root，停止
            }
            if (FileInfo(apStr).isSymbolicLink()) { return false }
            ap = ap.parent
            loopGuard = loopGuard + Int64(1)
        }
        return true
    } catch (e: Exception) {
        return false
    }
}

// ─── frontmatter 严格子集解析 ──────────────────────────────
// 声明子集（仅这些键）：
//   name(必填, kebab-case) / description(必填, 非空) / whenToUse(可选, 单行字符串)
//   disable-model-invocation(可选, 仅 true|false) / user-invocable(可选, 仅 true|false)
// 拒绝：未知键（含 metadata，不解释故不入子集）、重复键、引号串("...'...)、
//   块标量(| 或 >)、多行续行（缩进续行会被当无冒号行拒）、空行、无冒号行、非法布尔。
// 不承诺完整 YAML 兼容；只接受上述严格子集，其余一律丢弃候选。
// String 无裸 .trim()；用 trimStart/trimEnd(set:String) 去首尾空白（含 \r 防 Windows 行尾）。
func trimS(s: String): String {
    return s.trimStart(" \t\r").trimEnd(" \t\r")
}

func parseSkillFile(text: String): ?ParsedSkill {
    if (!text.startsWith("---")) { return None }
    let lines = text.split("\n", removeEmpty: false)
    if (lines.size < Int64(2)) { return None }
    if (trimS(lines[0]) != "---") { return None }
    var i = Int64(1)
    var name = ""
    var description = ""
    var whenToUse = ""
    var modelInvocable = true
    var userInvocable = true
    var foundClose = false
    var seenName = false
    var seenDesc = false
    var seenWhen = false
    var seenModel = false
    var seenUser = false
    while (i < lines.size) {
        let line = trimS(lines[i])
        if (line == "---") { foundClose = true; break }
        if (line.size == 0) { return None }                       // 空行非法
        let idxOpt = line.indexOf(":")
        if (let Some(idx) <- idxOpt) {
            if (idx <= Int64(0)) { return None }                  // 空 key
            let key = trimS(line[0..idx])
            let val = trimS(line[(idx + Int64(1))..line.size])
            if (key.size == 0) { return None }
            if (val.size > 0 && (val.startsWith("\"") || val.startsWith("'"))) {
                return None                                       // 引号串不支持
            }
            if (val == "|" || val == ">") { return None }         // 块标量不支持
            if (key == "name") {
                if (seenName) { return None }; seenName = true; name = val
            } else if (key == "description") {
                if (seenDesc) { return None }; seenDesc = true; description = val
            } else if (key == "whenToUse") {
                if (seenWhen) { return None }; seenWhen = true; whenToUse = val
            } else if (key == "disable-model-invocation") {
                if (seenModel) { return None }; seenModel = true
                if (val == "true") { modelInvocable = false }
                else if (val == "false") { modelInvocable = true }
                else { return None }                              // 非法布尔
            } else if (key == "user-invocable") {
                if (seenUser) { return None }; seenUser = true
                if (val == "true") { userInvocable = true }
                else if (val == "false") { userInvocable = false }
                else { return None }                              // 非法布尔
            } else {
                return None                                       // 未知键（严格子集）
            }
        } else {
            return None                                           // 无冒号行非法
        }
        i = i + Int64(1)
    }
    if (!foundClose) { return None }
    if (!seenName || !seenDesc) { return None }                   // 必填缺失
    if (!isValidSkillName(name)) { return None }
    if (description.size == 0) { return None }
    var body = ""
    var j = i + Int64(1)
    while (j < lines.size) {
        if (body.size > 0) { body = body + "\n" }
        body = body + lines[j]
        j = j + Int64(1)
    }
    return Some(ParsedSkill(name, description, whenToUse, modelInvocable, userInvocable, body))
}

// ─── provider ───────────────────────────────────────────────

public class FilesystemSkillProvider <: SkillProvider {
    let projectRoot: String
    let appResources: String
    let maxBytes: Int64
    let userDir: String

    public init(projectRoot: String, appResources!: String = "", maxBytes!: Int64 = 65536,
                userDirOverride!: String = "") {
        this.projectRoot = projectRoot
        this.appResources = appResources
        this.maxBytes = maxBytes
        this.userDir = if (userDirOverride.size > 0) {
            userDirOverride
        } else {
            "${getHomeDirectory().toString()}/.sacode/skills"
        }
    }

    public func name(): String { return "filesystem" }

    // 按优先级顺序扫四层，先到先得去重。同层内目录(bundle)先于平铺文件、各自按路径排序。
    public func list(): ArrayList<SkillSummary> {
        let out = ArrayList<SkillSummary>()
        let seen = HashSet<String>()
        for (layer in layers()) {
            for (s in scanLayer(layer)) {
                if (!seen.contains(s.name)) {
                    seen.add(s.name)
                    out.add(s)
                }
            }
        }
        return out
    }

    // 取某 name 完整定义：找到所属源文件后，最终读取重新核对（TOCTOU 防护）。
    public func get(name: String): ?SkillDefinition {
        for (layer in layers()) {
            let found = findInLayer(layer, name)
            if (let Some(pair) <- found) {
                return verifiedRead(pair.path, pair.resourceDir, layer, name)
            }
        }
        return None
    }

    func layers(): ArrayList<SkillLayer> {
        let out = ArrayList<SkillLayer>()
        out.add(SkillLayer("project-native", "${projectRoot}/.sa-code/skills"))
        out.add(SkillLayer("project-agents", "${projectRoot}/.agents/skills"))
        out.add(SkillLayer("user", userDir))
        if (appResources.size > 0) {
            out.add(SkillLayer("bundled", "${appResources}/skills"))
        }
        return out
    }

    // 扫一层，返回合格候选 summary（解析只为取 name/description，不保留 content）。
    // 单个候选的任何 FS/解析失败都 try/catch 隔离，不拖垮整层清单。
    func scanLayer(layer: SkillLayer): ArrayList<SkillSummary> {
        let out = ArrayList<SkillSummary>()
        if (!exists(layer.dir)) { return out }
        var raw: Array<FileInfo> = Array<FileInfo>()
        try { raw = Directory.readFrom(layer.dir) } catch (e: Exception) { return out }
        let dirs = ArrayList<FileInfo>()
        let files = ArrayList<FileInfo>()
        for (fi in raw) {
            try {
                if (fi.isSymbolicLink()) { continue }
                if (fi.isDirectory()) { dirs.add(fi) } else { files.add(fi) }
            } catch (e: Exception) {
                continue
            }
        }
        sortByPath(dirs)
        sortByPath(files)
        for (fi in dirs) {
            try { tryAppend(fi, layer, out) } catch (e: Exception) { continue }
        }
        for (fi in files) {
            try { tryAppend(fi, layer, out) } catch (e: Exception) { continue }
        }
        return out
    }

    // 在一层里找某 name 的候选路径（解析以确认 name 匹配）。
    func findInLayer(layer: SkillLayer, name: String): ?SkillPath {
        if (!exists(layer.dir)) { return None }
        var raw: Array<FileInfo> = Array<FileInfo>()
        try { raw = Directory.readFrom(layer.dir) } catch (e: Exception) { return None }
        let dirs = ArrayList<FileInfo>()
        let files = ArrayList<FileInfo>()
        for (fi in raw) {
            try {
                if (fi.isSymbolicLink()) { continue }
                if (fi.isDirectory()) { dirs.add(fi) } else { files.add(fi) }
            } catch (e: Exception) {
                continue
            }
        }
        sortByPath(dirs)
        sortByPath(files)
        for (fi in dirs) {
            try {
                let cand = candidateOf(fi, layer)
                if (let Some(c) <- cand) {
                    if (!skillPathInsideRoot(c.path, layer.dir)) { continue }
                    let cInfo = FileInfo(c.path)
                    if (cInfo.size > maxBytes) { continue }
                    let parsed = parseSkillFile(readText(c.path, maxBytes))
                    if (let Some(p) <- parsed) {
                        if (p.name == name) { return Some(c) }
                    }
                }
            } catch (e: Exception) {
                continue
            }
        }
        for (fi in files) {
            try {
                let cand = candidateOf(fi, layer)
                if (let Some(c) <- cand) {
                    if (!skillPathInsideRoot(c.path, layer.dir)) { continue }
                    let cInfo = FileInfo(c.path)
                    if (cInfo.size > maxBytes) { continue }
                    let parsed = parseSkillFile(readText(c.path, maxBytes))
                    if (let Some(p) <- parsed) {
                        if (p.name == name) { return Some(c) }
                    }
                }
            } catch (e: Exception) {
                continue
            }
        }
        return None
    }

    // 最终读取重新核对（TOCTOU 防护）：路径/链接边界→有界读取（最多 maxBytes+1，超限即拒不读余下）→
    // 解析→名称仍等于请求名。任一不符返回 None。
    // 残留竞争说明：文件可能在 findInLayer 与本函数之间被替换/删除；verifiedRead 通过
    // 重核路径/链接 + 有界读取 + 名称核对把可被替换利用的窗口压到最小，但无法在理论上消除
    // "读取瞬间的真实内容"与"返回内容"完全一致——若需更强保证须用文件锁，本版不引入。
    func verifiedRead(path: String, resourceDir: String, layer: SkillLayer,
                      expectedName: String): ?SkillDefinition {
        try {
            if (!skillPathInsideRoot(path, layer.dir)) { return None }
            let bytesOpt = readBounded(path, maxBytes)             // 有界读取：最多 maxBytes+1
            if (let Some(bytes) <- bytesOpt) {
                let parsed = parseSkillFile(String.fromUtf8(bytes))
                if (let Some(p) <- parsed) {
                    if (p.name != expectedName) { return None }    // 文件被换为另一技能
                    let summary = SkillSummary(p.name, p.description, whenToUse: p.whenToUse,
                        modelInvocable: p.modelInvocable, userInvocable: p.userInvocable,
                        source: layer.source, provider: "filesystem", path: path,
                        resourceBase: Some(SkillResourceBase("directory", path: resourceDir)))
                    return Some(SkillDefinition(summary, p.content))
                }
                return None
            }
            return None                                            // 超限或读失败
        } catch (e: Exception) {
            return None
        }
    }

    // 判定目录项是 <name>/SKILL.md 还是平铺 .md，返回候选定位；否则 None。
    func candidateOf(fi: FileInfo, layer: SkillLayer): ?SkillPath {
        let p = fi.path.toString()
        if (fi.isDirectory()) {
            let skPath = "${p}/SKILL.md"
            if (!exists(skPath)) { return None }
            return Some(SkillPath(skPath, p))
        } else if (p.endsWith(".md")) {
            return Some(SkillPath(p, layer.dir))
        }
        return None
    }

    // 扫描单个候选并追加 summary（供 scanLayer 复用）。
    func tryAppend(fi: FileInfo, layer: SkillLayer, out: ArrayList<SkillSummary>): Unit {
        let cand = candidateOf(fi, layer)
        if (let Some(c) <- cand) {
            if (!skillPathInsideRoot(c.path, layer.dir)) { return }
            let cInfo = FileInfo(c.path)
            if (cInfo.size > maxBytes) { return }
            let parsed = parseSkillFile(readText(c.path, maxBytes))
            if (let Some(p) <- parsed) {
                out.add(SkillSummary(p.name, p.description, whenToUse: p.whenToUse,
                    modelInvocable: p.modelInvocable, userInvocable: p.userInvocable,
                    source: layer.source, provider: "filesystem", path: c.path,
                    resourceBase: Some(SkillResourceBase("directory", path: c.resourceDir))))
            }
        }
    }
}

// 有界读取：最多读 limit+1 字节；发现超限立即停止，不读取剩余内容。
// 用 File.read(buffer) 流式读，内存上限 ≈ limit+1 + 一个缓冲区。
// fail-soft：打开/读失败返回 None；超限（读到的字节 > limit）返回 None。
func readBounded(path: String, limit: Int64): ?Array<Byte> {
    var fOpt: ?File = None
    try {
        fOpt = Some(File(path, OpenMode.Read))
    } catch (e: Exception) {
        return None
    }
    if (let Some(f) <- fOpt) {
        let cap = limit + Int64(1)
        let out = ArrayList<Byte>()
        let buf = Array<Byte>(Int64(8192), repeat: 0u8)
        var oversize = false
        while (!oversize) {
            var n = Int64(-1)
            try {
                n = f.read(buf)
            } catch (e: Exception) {
                break
            }
            if (n <= Int64(0)) { break }                            // EOF 或空读
            var i = Int64(0)
            while (i < n) {
                if (out.size >= cap) { oversize = true; break }     // 到上限即停，不读余下
                out.add(buf[i])
                i = i + Int64(1)
            }
        }
        try { f.close() } catch (e: Exception) {}
        if (out.size > limit) { return None }                       // 超限
        return Some(out.toArray())
    }
    return None
}

// 读文本（bytes→utf8 string），有界：超过 limit 返回 ""。fail-soft：读失败/超限返回 ""。
func readText(path: String, limit: Int64): String {
    if (let Some(bytes) <- readBounded(path, limit)) {
        return String.fromUtf8(bytes)
    } else {
        return ""
    }
}

// ArrayList<FileInfo> 按路径字符串稳定排序（冒泡，避免引入 sort API 不确定性）。
func sortByPath(arr: ArrayList<FileInfo>): Unit {
    var a = Int64(0)
    while (a < arr.size) {
        var b = Int64(0)
        while (b < arr.size - Int64(1) - a) {
            if (arr[b].path.toString() > arr[b + Int64(1)].path.toString()) {
                let t = arr[b]
                arr[b] = arr[b + Int64(1)]
                arr[b + Int64(1)] = t
            }
            b = b + Int64(1)
        }
        a = a + Int64(1)
    }
}
