package core

import std.collection.*
import std.fs.*

// 文件系统扩展工具：glob（文件模式匹配）与 grep（内容搜索）。
// 这两个工具只读不改盘，不需审批，与 read 同级。

// glob 匹配：支持 `*`（匹配不含 / 的任意字符）、`?`（匹配单个非 / 字符）、
// `**`（匹配含 / 的任意字符）。模式按 / 分段，逐段匹配。
func globMatchPattern(name: String, pattern: String): Bool {
    // 按 / 分段后再逐段匹配，`**` 作为整段时才允许跨段。
    let ns = name.split("/")
    let ps = pattern.split("/")
    return globMatchSegments(ns, Int64(0), ps, Int64(0))
}

// 整段只由 `*` 组成（`**`、`***`）才算跨段通配；单个 `*` 仍是段内通配。
func globIsCrossSegmentSeg(seg: String): Bool {
    if (seg.size < Int64(2)) {
        return false
    }
    for (c in seg) {
        if (Int64(c) != 42) {
            return false
        }
    }
    return true
}

// 段内匹配：`*` 匹配任意长度（本段内不含 /），`?` 匹配单个字符。
// 外层按 name 推进；回溯时 starI 单调递增且不超过 s.size，因此对任意输入都必然终止。
func globMatchSegment(seg: String, pat: String): Bool {
    let s = seg.toArray()
    let p = pat.toArray()
    var i: Int64 = 0
    var j: Int64 = 0
    var starI: Int64 = -1
    var starJ: Int64 = 0
    while (i < s.size) {
        if (j < p.size && Int64(p[j]) == 42) {
            starI = i
            starJ = j
            j += 1
        } else if (j < p.size && (Int64(p[j]) == 63 || Int64(p[j]) == Int64(s[i]))) {
            i += 1
            j += 1
        } else if (starI >= 0) {
            starI += 1
            i = starI
            j = starJ + 1
        } else {
            return false
        }
    }
    // name 已耗尽，剩余模式必须全是由 * 组成才算匹配
    while (j < p.size && Int64(p[j]) == 42) { j += 1 }
    return j == p.size
}

func globMatchSegments(ns: Array<String>, ni: Int64, ps: Array<String>, pi: Int64): Bool {
    var ni2 = ni
    var pi2 = pi
    while (pi2 < ps.size) {
        let pat = ps[pi2]
        if (globIsCrossSegmentSeg(pat)) {
            // 试探 `**` 吃掉 0 到剩余全部段
            var k: Int64 = ni2
            while (k <= ns.size) {
                if (globMatchSegments(ns, k, ps, pi2 + 1)) {
                    return true
                }
                k += 1
            }
            return false
        }
        if (ni2 >= ns.size || !globMatchSegment(ns[ni2], pat)) {
            return false
        }
        ni2 += 1
        pi2 += 1
    }
    return ni2 == ns.size
}

// 递归遍历目录，收集匹配 pattern 的所有文件路径。
// pattern 可以是 "dir/*.txt" 或 "*.cj" 或 "**/*.md"。
// 返回匹配的文件相对路径列表。
public func globFiles(pattern: String, cwd: String): ArrayList<String> {
    let results = ArrayList<String>()
    let parts = pattern.split("/")
    
    // 提取基础目录和文件名模式
    let dirs = ArrayList<String>()
    var filePattern = "*"
    var i: Int64 = 0
    while (i < parts.size) {
        let part = parts[i]
        if (part.contains("*") || part.contains("?")) {
            filePattern = part
            break
        }
        dirs.add(part)
        i += 1
    }
    // 如果所有部分都不含通配符，最后一个部分是文件名
    if (i >= Int64(parts.size)) {
        filePattern = parts[parts.size - 1]
    }
    
    // 从 cwd 开始，按 dirs 逐层进入
    let baseDir = if (dirs.size == 0) { cwd } else { joinPaths(cwd, dirs.toArray()) }
    
    if (!exists(baseDir)) {
        return results
    }
    
    // 检查 baseDir 是文件还是目录
    let baseInfo = FileInfo(baseDir)
    if (baseInfo.isRegular() && globMatchPattern(Path(baseDir).fileName, filePattern)) {
        let rel = relativizePath(baseDir, cwd)
        results.add(rel)
        return results
    }
    
    if (!baseInfo.isDirectory()) {
        return results
    }
    
    // 递归遍历 baseDir 下的所有文件
    globRecursive(baseDir, filePattern, cwd, results, Int64(0))
    return results
}

// 递归遍历目录收集匹配文件
func globRecursive(dir: String, filePattern: String, cwd: String, 
                   results: ArrayList<String>, depth: Int64): Unit {
    if (depth > Int64(20)) { return }  // 深度限制，防止无限递归
    
    for (info in Directory.readFrom(dir)) {
        let name = info.path.fileName
        if (info.isDirectory()) {
            // 递归进入子目录
            let subDir = dir + "/" + name
            globRecursive(subDir, filePattern, cwd, results, depth + 1)
        } else {
            // 检查文件名是否匹配
            if (globMatchPattern(name, filePattern)) {
                let fullPath = dir + "/" + name
                let rel = relativizePath(fullPath, cwd)
                results.add(rel)
            }
        }
    }
}

// 拼接路径
func joinPaths(base: String, parts: Array<String>): String {
    var result = base
    for (p in parts) {
        result = result + "/" + p
    }
    return result
}

// 将绝对路径转为相对路径（相对于 base）
func relativizePath(fullPath: String, base: String): String {
    let full = fullPath
    let b = base
    if (full.startsWith(b)) {
        return full[b.size..full.size]
    }
    return full
}

// grep：在文件或目录中搜索内容子串。
// path: 要搜索的文件或目录；pattern: 要搜索的子串。
// 返回匹配行的列表，格式 "文件路径:行号:行内容"。
public func grepFiles(pattern: String, path: String): ArrayList<String> {
    let results = ArrayList<String>()
    if (pattern.size == 0) { return results }
    
    let info = FileInfo(path)
    if (info.isRegular()) {
        // 搜索单个文件
        grepFile(path, pattern, results)
    } else if (info.isDirectory()) {
        // 递归搜索目录
        grepRecursive(path, pattern, results, Int64(0))
    }
    return results
}

// 在单个文件中搜索子串
func grepFile(filePath: String, pattern: String, results: ArrayList<String>): Unit {
    try {
        let bytes = File.readFrom(filePath)
        let content = String.fromUtf8(bytes)
        let lines = content.split("\n")
        for (i in 0..Int64(lines.size)) {
            if (lines[i].contains(pattern)) {
                results.add("${filePath}:${i + 1}:${lines[i]}")
            }
        }
    } catch (e: Exception) {
        // 无法读取的文件静默跳过
    }
}

// 递归搜索目录
func grepRecursive(dir: String, pattern: String, results: ArrayList<String>, depth: Int64): Unit {
    if (depth > Int64(20)) { return }
    
    for (info in Directory.readFrom(dir)) {
        let name = info.path.fileName
        if (info.isDirectory()) {
            let subDir = dir + "/" + name
            grepRecursive(subDir, pattern, results, depth + 1)
        } else {
            let fullPath = dir + "/" + name
            grepFile(fullPath, pattern, results)
        }
    }
}

// LSP 基础操作：从文件中提取符号（函数名、类名、变量名）。
// 当前实现只做简单的文本模式匹配，不依赖外部语言服务器。
// operation: "symbols" 返回文件中的符号列表。
// path: 要分析的文件路径。
public func lspSymbols(path: String): ArrayList<String> {
    let results = ArrayList<String>()
    try {
        let bytes = File.readFrom(path)
        let content = String.fromUtf8(bytes)
        let lines = content.split("\n")
        for (i in 0..Int64(lines.size)) {
            let line = lines[i].trimAscii()
            // 匹配函数定义
            if (line.contains("func ") || line.contains("function ") || line.contains("def ")) {
                // 提取函数名
                let name = extractSymbolName(line)
                if (name.size > 0) {
                    results.add("function:${name}:${path}:${i + 1}")
                }
            }
            // 匹配类定义
            if (line.contains("class ") || line.contains("struct ")) {
                let name = extractSymbolName(line)
                if (name.size > 0) {
                    results.add("class:${name}:${path}:${i + 1}")
                }
            }
        }
    } catch (e: Exception) {
        // 无法读取的文件返回空列表
    }
    return results
}

// 从行中提取符号名（跳过关键字，取关键字后的标识符）
func extractSymbolName(line: String): String {
    let trimmed = line.trimAscii()
    // 关键字表：出现这些词后，真正的符号名跟在后面
    let keywords = ["func ", "function ", "def ", "class ", "struct "]
    var rest = trimmed
    var matched = false
    for (kw in keywords) {
        if (rest.startsWith(kw)) {
            rest = rest[kw.size..rest.size]
            matched = true
            break
        }
    }
    if (!matched) { return "" }
    // 从 rest 中取第一个标识符
    let bytes = rest.toArray()
    let nameBytes = ArrayList<Byte>()
    var started = false
    // 跳过前导空白
    var k: Int64 = 0
    while (k < Int64(bytes.size) && (Int64(bytes[k]) == 32 || Int64(bytes[k]) == 9)) { k += 1 }
    while (k < Int64(bytes.size)) {
        let c = bytes[k]
        let n = Int64(c)
        let isIdentChar = (n >= 97 && n <= 122) || (n >= 65 && n <= 90) ||
                         (n >= 48 && n <= 57) || n == 95
        if (started) {
            if (!isIdentChar) { break }
            nameBytes.add(c)
        } else {
            if (isIdentChar) {
                nameBytes.add(c)
                started = true
            } else {
                break
            }
        }
        k += 1
    }
    return String.fromUtf8(nameBytes.toArray())
}
