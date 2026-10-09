package core

import std.collection.*
import std.fs.*
import std.sync.*
import stdx.encoding.json.*

// L1 LSP 语义工具契约（F21 / PRD §4.3）。协议基线：LSP 3.17。
//
// 职责切分（这条决定了本文件里为什么没有任何 language server 名字）：
//   核心 = 产品契约：7 个 verb、位置与范围口径、路径与工作区边界、请求身份与
//          取消、服务器身份与文档版本、路由与撤销、无插件回退形状。
//   插件 = 协议转换、文档同步、publishDiagnostics 缓存、进程管理。
// L1 不 spawn 任何 language server：路由表默认空，装配动作归 L2 的语言插件，
// 注入用的就是这里的 LspServer 接口。
//
// 位置口径：行号 0 起始，列号按 **UTF-16 代码单元** 计数（不是字节、不是码点），
// 范围左闭右开。仓颉 String.toArray() 给的是 UTF-8 字节，所以 utf16 长度要按
// lead byte 走一遍，不能直接取 size。

// ---------- verb 词表（唯一真源；工具名、method 名都从这里派生） ----------

public func lspVerbNames(): Array<String> {
    return ["define", "lookup", "references", "implementation", "call-hierarchy", "diagnostics", "rename"]
}

public func lspIsVerb(name: String): Bool {
    for (verb in lspVerbNames()) {
        if (verb == name) { return true }
    }
    return false
}

// 模型工具面用下划线（工具名里不能有 '/'）；Host 协议面用 lsp/<verb>。
public func lspToolName(verb: String): String {
    var out = "lsp_"
    var first = true
    for (part in verb.split("-")) {
        if (!first) { out += "_" }
        first = false
        out += part
    }
    return out
}

public func lspMethodName(verb: String): String {
    return "lsp/${verb}"
}

// ---------- 模型声明面（描述与入参 Schema）----------
//
// 7 个工具的描述与 Schema 都由这里生成，两个入口只做投影。各写一份的话，
// 「rename 只出预览不落盘」这类口径迟早在一个入口上漏掉。
// Schema 一律 additionalProperties:false，与 lspParseParams 的按键白名单同口径——
// 渲染层多塞一个字段在两个面上都得被拒，而不是一个拒一个静默忽略。

public func lspToolDescription(verb: String): String {
    if (verb == "define") { return "按 LSP 语义取符号定义位置（0 起始行号、UTF-16 列号）。" }
    if (verb == "lookup") { return "按 LSP 语义取符号 hover 说明（markdown）。" }
    if (verb == "references") { return "按 LSP 语义列符号引用位置，默认包含声明。" }
    if (verb == "implementation") { return "按 LSP 语义取符号实现位置。" }
    if (verb == "call-hierarchy") { return "按 LSP 语义列调用层次，direction 只能取 incoming 或 outgoing。" }
    if (verb == "diagnostics") { return "读取语言插件的 publishDiagnostics 快照；区分「有效空诊断」与「尚无快照」。" }
    if (verb == "rename") { return "按 LSP 语义出跨文件重命名编辑预览；只读，不落盘，应用变更另走审查授权。" }
    return "LSP 语义工具。"
}

// verb 各自允许的入参名。JSON Schema、CLI 短参数串与运行期按键白名单都由这一张表生成：
// 三处各写一份的话，总有一处会漏掉 documentVersion 这类字段，而「声明面拒绝、运行面放过」
// 是最难查的那种漂移。documentVersion 是请求信封字段（迟到结果按它判），7 个 verb 都收；
// diagnostics 是文件级的，不吃位置。
public func lspToolParamNames(verb: String): Array<String> {
    if (verb == "diagnostics") { return ["path", "documentVersion"] }
    if (verb == "references") { return ["path", "line", "character", "includeDeclaration", "documentVersion"] }
    if (verb == "call-hierarchy") { return ["path", "line", "character", "direction", "documentVersion"] }
    if (verb == "rename") { return ["path", "line", "character", "newName", "documentVersion"] }
    return ["path", "line", "character", "documentVersion"]
}

// 必填子集：位置类 verb 要行与列，调用层次要方向，重命名要新名。
func lspSchemaRequired(verb: String): Array<String> {
    if (verb == "diagnostics") { return ["path"] }
    if (verb == "call-hierarchy") { return ["path", "line", "character", "direction"] }
    if (verb == "rename") { return ["path", "line", "character", "newName"] }
    return ["path", "line", "character"]
}

// 表里出现的键一定有形状，表外的一律被 additionalProperties:false 拒掉。
func lspSchemaProp(name: String): String {
    if (name == "path") { return "\"path\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":1000}" }
    if (name == "line") { return "\"line\":{\"type\":\"integer\",\"minimum\":0}" }
    if (name == "character") { return "\"character\":{\"type\":\"integer\",\"minimum\":0}" }
    if (name == "documentVersion") { return "\"documentVersion\":{\"type\":\"integer\",\"minimum\":0}" }
    if (name == "includeDeclaration") { return "\"includeDeclaration\":{\"type\":\"boolean\"}" }
    if (name == "direction") { return "\"direction\":{\"type\":\"string\",\"enum\":[\"incoming\",\"outgoing\"]}" }
    if (name == "newName") { return "\"newName\":{\"type\":\"string\",\"minLength\":1,\"maxLength\":500}" }
    return ""
}

// 转义引号只出现在字面量与相加的右值上，不嵌进另一条字符串的插值——那种形状本仓没编译过。
public func lspToolSchema(verb: String): String {
    var props = ""
    for (name in lspToolParamNames(verb)) {
        if (props.size > 0) { props += "," }
        props += lspSchemaProp(name)
    }
    var required = ""
    for (name in lspSchemaRequired(verb)) {
        if (required.size > 0) { required += "," }
        required += "\"" + name + "\""
    }
    return "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[" + required + "],\"properties\":{" + props + "}}"
}

// ---------- 失败原因词表 ----------
// 失败、取消、断连必须是可归因的失败，绝不塌成「空结果」——空结果会被模型和
// 界面读成「这个符号没有定义」，那是一个谎言。

let lspFailNoServer = "lsp-no-server"
let lspFailUnsupported = "lsp-unsupported"
let lspFailServerGone = "lsp-server-gone"
let lspFailCancelled = "lsp-cancelled"
let lspFailBadVerb = "lsp-bad-verb"
let lspFailBadArgs = "lsp-bad-args"
let lspFailOutOfWorkspace = "lsp-out-of-workspace"
let lspFailStale = "lsp-stale-result"
let lspFailServerFailed = "lsp-server-failed"
let lspFailMissingIdentity = "lsp-missing-identity"
let lspFailResultOutOfWorkspace = "lsp-result-out-of-workspace"
let lspFailBadRange = "lsp-bad-range"
let lspFailNoSnapshot = "lsp-no-diagnostic-snapshot"
let lspFailExtensionConflict = "lsp-extension-conflict"

// 诊断快照三态：'none' 是插件从未 publish 过，'empty' 是「查过了，没问题」。
// 把这两者合并成一个空数组，就等于把「不知道」报成「干净」。
public let lspSnapshotNone = "none"
public let lspSnapshotEmpty = "empty"
public let lspSnapshotPresent = "present"

public func lspIsSnapshotState(state: String): Bool {
    return state == lspSnapshotNone || state == lspSnapshotEmpty || state == lspSnapshotPresent
}

// 入口侧只需要这两个原因词：其余失败原因都从响应里原样读出来，
// 抄第二份词表到公共入口就等于给漂移留位置。
public func lspReasonBadArgs(): String { return lspFailBadArgs }

public func lspReasonNoServer(): String { return lspFailNoServer }

// ---------- 位置 / 范围 / 载荷 ----------

public class LspPosition {
    public let line: Int64        // 0 起始
    public let character: Int64   // UTF-16 代码单元，0 起始
    public init(line: Int64, character: Int64) {
        this.line = line
        this.character = character
    }
}

public class LspRange {
    public let start: LspPosition
    public let end: LspPosition   // 左闭右开
    public init(start: LspPosition, end: LspPosition) {
        this.start = start
        this.end = end
    }
}

public class LspLocation {
    public var path: String
    public let range: LspRange
    public init(path: String, range: LspRange) {
        this.path = path
        this.range = range
    }
}

public class LspCallItem {
    public let name: String
    public let kind: String
    public let location: LspLocation
    public init(name: String, kind: String, location: LspLocation) {
        this.name = name
        this.kind = kind
        this.location = location
    }
}

public class LspDiagnostic {
    public var path: String
    public let range: LspRange
    public let severity: String   // error | warning | information | hint
    public let source: String
    public let code: String
    public let message: String
    public init(path: String, range: LspRange, severity: String, code: String, message: String, source!: String = "") {
        this.path = path
        this.range = range
        this.severity = severity
        this.code = code
        this.source = source
        this.message = message
    }
}

public class LspTextEdit {
    public let range: LspRange
    public let newText: String
    public init(range: LspRange, newText: String) {
        this.range = range
        this.newText = newText
    }
}

// 一个文件一组编辑；rename 的结果是「跨文件预览」，不落盘。
public class LspFileEdits {
    public var path: String
    public let edits = ArrayList<LspTextEdit>()
    public init(path: String) { this.path = path }
    public func add(edit: LspTextEdit): Unit { edits.add(edit) }
}

// ---------- 请求 ----------

public class LspRequest {
    public let sessionId: String
    public let requestId: String      // 请求身份：取消与在途归属都按它对齐
    public let verb: String
    public let path: String           // 调用方原样给的，可能是相对路径
    public let line: Int64
    public let character: Int64
    public let direction: String      // call-hierarchy: incoming | outgoing
    public let includeDeclaration: Bool
    public let newName: String        // rename
    public let workspaceRoot: String  // 会话工作区，越界判定的边界
    public let documentVersion: Int64
    public let token: TurnToken

    public init(sessionId!: String = "", requestId!: String = "", verb!: String = "", path!: String = "",
        line!: Int64 = 0, character!: Int64 = 0, direction!: String = "",
        includeDeclaration!: Bool = true, newName!: String = "", workspaceRoot!: String = "",
        documentVersion!: Int64 = 0, token!: TurnToken = TurnToken()) {
        this.sessionId = sessionId
        this.requestId = requestId
        this.verb = verb
        this.path = path
        this.line = line
        this.character = character
        this.direction = direction
        this.includeDeclaration = includeDeclaration
        this.newName = newName
        this.workspaceRoot = workspaceRoot
        this.documentVersion = documentVersion
        this.token = token
    }
}

// ---------- 响应 ----------
// 一个类装下五种形状（位置列表 / markdown hover / 调用层次 / 诊断 / 跨文件编辑），
// 但每个 verb 只允许填它那一格：失败与回退路径上语义字段一律留空。

public class LspResponse {
    public var ok: Bool = false
    public var reason: String = ""
    public var verb: String = ""
    public var sessionId: String = ""
    public var requestId: String = ""
    public var serverId: String = ""
    public var documentVersion: Int64 = 0
    public var nonSemantic: Bool = false       // true = 文本线索，不是语义结果
    public let locations = ArrayList<LspLocation>()
    public var hoverMarkdown: String = ""
    public let callItems = ArrayList<LspCallItem>()
    public let diagnostics = ArrayList<LspDiagnostic>()
    public var diagnosticSnapshot: String = lspSnapshotNone
    public let editFiles = ArrayList<LspFileEdits>()
    public let clues = ArrayList<String>()

    public init() {}
}

// ---------- 插件侧接口（L2 语言插件实现它；核心只认这三个成员） ----------

public interface LspServer {
    func serverId(): String
    func supports(verb: String): Bool
    func execute(req: LspRequest): LspResponse
}

// 无插件时的文本线索来源。做成接口有两个理由：一是回退扫描这件事必须能被
// 「参数错误/越界/取消不得触发扫描」这条不变量钉住——不注入就断言不了「没扫」；
// 二是核心不在这里持有具体 language server 或插件名字。
public interface LspFallbackScanner {
    func scan(req: LspRequest): Array<String>
}

// 默认实现：复用 fs_tools 里的文本符号提取（lspSymbols）。它一直是 grep 级别的
// 匹配，所以结果只配当线索，配上 nonSemantic 标记，不填语义字段。
public class LspTextSymbolScanner <: LspFallbackScanner {
    public init() {}
    public func scan(req: LspRequest): Array<String> {
        let out = ArrayList<String>()
        let full = lspNormalizePath(req.path, req.workspaceRoot)
        for (symbol in lspSymbols(full).toArray()) {
            out.add(symbol)
        }
        return out.toArray()
    }
}

// ---------- 注册记录 ----------

// ArrayList 的按值查找在本仓没有已编译形态，按 for 循环自己判——
// 注册冲突与扩展名分派都靠它，写成 helper 只此一处。
func lspListHas(list: ArrayList<String>, value: String): Bool {
    for (item in list) {
        if (item == value) { return true }
    }
    return false
}

public class LspRegistration {
    public let registrationId: String
    public let serverId: String
    public let server: LspServer
    public let extensions = ArrayList<String>()
    public var revoked: Bool = false
    public init(registrationId: String, serverId: String, server: LspServer) {
        this.registrationId = registrationId
        this.serverId = serverId
        this.server = server
    }
}

public class LspRegisterResult {
    public let ok: Bool
    public let registrationId: String
    public let reason: String
    public init(ok: Bool, registrationId: String, reason: String) {
        this.ok = ok
        this.registrationId = registrationId
        this.reason = reason
    }
}

// ---------- 路径口径 ----------

func lspToSlashes(value: String): String {
    var out = ""
    var first = true
    for (part in value.split("\\")) {
        if (!first) { out += "/" }
        first = false
        out += part
    }
    return out
}

func lspLastSlash(value: String): Int64 {
    let bs = value.toArray()
    var i: Int64 = Int64(bs.size) - 1
    while (i >= 0) {
        if (Int64(bs[i]) == 47) { return i }
        i -= 1
    }
    return Int64(-1)
}

func lspIsAbsolutePath(value: String): Bool {
    if (value.startsWith("/")) { return true }
    let bs = value.toArray()
    if (Int64(bs.size) < 2) { return false }
    let first = Int64(bs[0])
    let second = Int64(bs[1])
    let letter = (first >= 65 && first <= 90) || (first >= 97 && first <= 122)
    return letter && second == 58
}

// 纯词法归一：反斜杠→正斜杠、折叠 //、解 . 与 ..、去尾斜杠。
// 刻意不叫 canonicalize——那个要求路径已经在盘上，而插件返回的位置可能指向还没
// 落盘的编辑目标；把边界判定挂在磁盘状态上，等于让安全属性随文件系统心情变。
public func lspNormalizePath(raw: String, root: String): String {
    var base = lspToSlashes(root)
    while (base.size > 0 && base.endsWith("/")) {
        base = base[0..base.size - 1]
    }
    let slashed = lspToSlashes(raw)
    var full = slashed
    if (!lspIsAbsolutePath(slashed) && slashed != base && !slashed.startsWith("${base}/")) {
        if (base.size > 0) {
            full = if (slashed.startsWith("/")) { "${base}${slashed}" } else { "${base}/${slashed}" }
        }
    }
    let rooted = full.startsWith("/")
    var acc = ""
    for (part in full.split("/")) {
        if (part.size == 0 || part == ".") { continue }
        if (part == "..") {
            let cut = lspLastSlash(acc)
            acc = if (cut < 0) { "" } else { acc[0..cut] }
            continue
        }
        acc = if (acc.size == 0) { part } else { "${acc}/${part}" }
    }
    return if (rooted) { "/${acc}" } else { acc }
}

func lspSameOrLower(value: String): String { return value.toAsciiLower() }

// 工作区边界：规范化后必须等于根，或落在「根 + /」之下。根为空直接判不在内
// （没有会话工作区就没有边界，越界判定不能默认放行）。
public func lspPathInsideWorkspace(candidate: String, root: String): Bool {
    if (root.size == 0) { return false }
    let n = lspSameOrLower(lspNormalizePath(candidate, root))
    let r = lspSameOrLower(lspNormalizePath(root, ""))
    if (n.size == 0 || r.size == 0) { return false }
    if (n != r && !n.startsWith("${r}/")) { return false }
    // 复核已存在祖先，拒绝工作区内链接指向外部目录。
    try {
        let base = lspToSlashes(canonicalize(root).toString()).toAsciiLower()
        var ancestor = Path(lspNormalizePath(candidate, root))
        while (!exists(ancestor)) {
            let parent = ancestor.parent
            if (parent.toString().size == 0 || parent.toString() == ancestor.toString()) { return false }
            ancestor = parent
        }
        let actual = lspToSlashes(canonicalize(ancestor).toString()).toAsciiLower()
        return actual == base || actual.startsWith("${base}/")
    } catch (_: Exception) { return false }
}

// 入口没把会话工作区绑进来时的兜底（CLI 的 call/tool 手工面就是这种：它没有会话，
// 但它的 read/write/lsp 一直在用进程当前目录）。拿不到就给空串，让请求如实落
// lsp-out-of-workspace，而不是造一个假身份把工作区边界悄悄放开。
public func lspProcessWorkspace(): String {
    try { return canonicalize(".").toString() }
    catch (_: Exception) { return "" }
}

// 规范化文件扩展名：去点、小写、无扩展名给空串。路由只认这个形态。
public func lspExtensionOf(path: String): String {
    let normalized = lspToSlashes(path)
    let cut = lspLastSlash(normalized)
    let name = if (cut < 0) { normalized } else { normalized[cut + 1..normalized.size] }
    let bs = name.toArray()
    var dot: Int64 = -1
    var i: Int64 = Int64(bs.size) - 1
    while (i >= 0) {
        if (Int64(bs[i]) == 46) { dot = i; break }
        i -= 1
    }
    if (dot <= 0 || dot >= Int64(bs.size) - 1) { return "" }
    return name[dot + 1..name.size].toAsciiLower()
}

// UTF-16 代码单元数：按 UTF-8 lead byte 走，4 字节序列（U+10000 以上）算 2 个单元。
public func lspUtf16Length(value: String): Int64 {
    let bs = value.toArray()
    var units: Int64 = 0
    var i: Int64 = 0
    while (i < bs.size) {
        let n = Int64(bs[i])
        if (n < 128) { units += 1; i += 1 }
        else if (n >= 192 && n < 224) { units += 1; i += 2 }
        else if (n >= 224 && n < 240) { units += 1; i += 3 }
        else if (n >= 240 && n < 248) { units += 2; i += 4 }
        else { units += 1; i += 1 }
    }
    return units
}

func lspDocumentLines(path: String): Option<Array<String>> {
    try {
        if (!exists(path)) { return None }
        let content = String.fromUtf8(File.readFrom(path))
        return Some(content.split("\n"))
    } catch (_: Exception) { return None }
}

// ---------- 参数与载荷校验 ----------

// 请求侧校验。返回 "" 表示通过；否则给失败原因。
// 注意这里不做任何磁盘扫描：越界、参数错、取消都必须在扫文件之前返回。
public func lspCheckRequest(req: LspRequest): String {
    if (req.sessionId.size == 0 || req.requestId.size == 0) { return lspFailBadArgs }
    if (!lspIsVerb(req.verb)) { return lspFailBadVerb }
    if (req.path.size == 0) { return lspFailBadArgs }
    if (req.workspaceRoot.size == 0) { return lspFailOutOfWorkspace }
    if (req.line < 0 || req.character < 0) { return lspFailBadArgs }
    if (req.documentVersion < 0) { return lspFailBadArgs }
    if (req.verb == "call-hierarchy" && req.direction != "incoming" && req.direction != "outgoing") {
        return lspFailBadArgs
    }
    if (req.verb == "rename" && req.newName.trimAscii().size == 0) { return lspFailBadArgs }
    if (!lspPathInsideWorkspace(req.path, req.workspaceRoot)) { return lspFailOutOfWorkspace }
    return ""
}

func lspRangeOrdered(range: LspRange): Bool {
    if (range.start.line < 0 || range.start.character < 0) { return false }
    if (range.end.line < 0 || range.end.character < 0) { return false }
    if (range.end.line < range.start.line) { return false }
    if (range.end.line == range.start.line && range.end.character < range.start.character) { return false }
    return true
}

// 位置与编辑的复核口径和请求侧一致：行存在、列不超过该行 UTF-16 长度（右开到端点，
// 允许等于行尾），范围左闭右开。插件返回什么不代表核心就信什么。
func lspCheckRangeInDoc(path: String, range: LspRange): Bool {
    if (!lspRangeOrdered(range)) { return false }
    if (let Some(lines) <- lspDocumentLines(path)) {
        if (range.start.line >= Int64(lines.size)) { return false }
        if (range.end.line >= Int64(lines.size)) { return false }
        let startLine = lines[range.start.line]
        if (range.start.character > lspUtf16Length(startLine)) { return false }
        let endLine = lines[range.end.line]
        if (range.end.character > lspUtf16Length(endLine)) { return false }
    }
    return true
}

func lspCheckLocationPayload(req: LspRequest, location: LspLocation): String {
    let full = lspNormalizePath(location.path, req.workspaceRoot)
    if (!lspPathInsideWorkspace(location.path, req.workspaceRoot)) { return lspFailResultOutOfWorkspace }
    if (!lspCheckRangeInDoc(full, location.range)) { return lspFailBadRange }
    return ""
}

func lspCheckResponse(req: LspRequest, resp: LspResponse): String {
    for (location in resp.locations) {
        let problem = lspCheckLocationPayload(req, location)
        if (problem.size > 0) { return problem }
    }
    for (item in resp.callItems) {
        let problem = lspCheckLocationPayload(req, item.location)
        if (problem.size > 0) { return problem }
    }
    for (diagnostic in resp.diagnostics) {
        let full = lspNormalizePath(diagnostic.path, req.workspaceRoot)
        if (!lspPathInsideWorkspace(diagnostic.path, req.workspaceRoot)) { return lspFailResultOutOfWorkspace }
        if (!lspCheckRangeInDoc(full, diagnostic.range)) { return lspFailBadRange }
    }
    for (fileEdits in resp.editFiles) {
        let full = lspNormalizePath(fileEdits.path, req.workspaceRoot)
        if (!lspPathInsideWorkspace(fileEdits.path, req.workspaceRoot)) { return lspFailResultOutOfWorkspace }
        for (edit in fileEdits.edits) {
            if (!lspCheckRangeInDoc(full, edit.range)) { return lspFailBadRange }
        }
    }
    return ""
}

// ---------- 路由 ----------

public class LspRouter {
    let lock = Mutex()
    let registrations = ArrayList<LspRegistration>()
    let docVersions = HashMap<String, Int64>()
    var nextId: Int64 = 1
    let scanner: LspFallbackScanner

    public init(scanner!: LspFallbackScanner = LspTextSymbolScanner()) {
        this.scanner = scanner
    }

    // 按规范化扩展名匹配；不同扩展名可以各归各的插件同时在场。
    // 同一扩展名已被他人占着就明确拒绝——静默顶替等于两个插件抢同一个符号面，
    // 谁赢只有天知道，而模型拿到的定义会随注册顺序漂移。
    public func register(server: LspServer, extensions: Array<String>): LspRegisterResult {
        let owned = ArrayList<String>()
        for (raw in extensions) {
            let ext = raw.toAsciiLower()
            if (ext.size == 0) { return LspRegisterResult(false, "", lspFailBadArgs) }
            // 同一次注册里重复给同一扩展名也是冲突：否则该扩展名会在归属表里出现两次，
            // 卸载时撤销一条还剩一条，插件以为自己在场而实际已被顶替。
            if (lspListHas(owned, ext)) { return LspRegisterResult(false, "", lspFailExtensionConflict) }
            owned.add(ext)
        }
        if (owned.size == 0) { return LspRegisterResult(false, "", lspFailBadArgs) }
        lock.lock()
        var conflict = false
        for (item in registrations) {
            if (item.revoked) { continue }
            for (ext in owned) {
                if (lspListHas(item.extensions, ext)) { conflict = true }
            }
        }
        if (conflict) {
            lock.unlock()
            return LspRegisterResult(false, "", lspFailExtensionConflict)
        }
        let id = "lsp-reg-${nextId}"
        nextId += 1
        let reg = LspRegistration(id, server.serverId(), server)
        for (ext in owned) { reg.extensions.add(ext) }
        registrations.add(reg)
        lock.unlock()
        return LspRegisterResult(true, id, "")
    }

    // 撤销按注册身份，不按 serverId：同一身份可能注册过两次（先冲突被拒那次不算），
    // 只认注册时拿到的那条句柄，卸载就不会误伤别人的路由。
    public func unregister(registrationId: String): Bool {
        lock.lock()
        var found = false
        for (item in registrations) {
            if (item.registrationId == registrationId && !item.revoked) {
                item.revoked = true
                found = true
            }
        }
        lock.unlock()
        return found
    }

    public func liveCount(): Int64 {
        lock.lock()
        var count: Int64 = 0
        for (item in registrations) {
            if (!item.revoked) { count += 1 }
        }
        lock.unlock()
        return count
    }

    public func hasRegistration(registrationId: String): Bool {
        lock.lock()
        var alive = false
        for (item in registrations) {
            if (item.registrationId == registrationId && !item.revoked) { alive = true }
        }
        lock.unlock()
        return alive
    }

    // 文档版本表由插件在真正同步文档时更新；核心只用它判迟到。
    // 键与 route 用同一个规范化口径（path + 当次请求的工作区根），否则插件登记的
    // 相对路径和核心算出的绝对路径各写各的，迟到判定永远对不上。
    public func noteDocumentVersion(path: String, version: Int64, root: String): Unit {
        if (version < 0) { throw Exception("lsp-bad-document-version") }
        lock.lock()
        let key = lspNormalizePath(path, root)
        if (!docVersions.contains(key) || docVersions[key] <= version) { docVersions[key] = version }
        lock.unlock()
    }

    public func documentVersion(path: String, root: String): Int64 {
        lock.lock()
        let key = lspNormalizePath(path, root)
        var value: Int64 = -1
        if (docVersions.contains(key)) { value = docVersions[key] }
        lock.unlock()
        return value
    }

    private func pick(extension: String): Option<LspRegistration> {
        lock.lock()
        var picked: Option<LspRegistration> = None
        for (item in registrations) {
            if (item.revoked) { continue }
            if (lspListHas(item.extensions, extension)) { picked = Some(item) }
        }
        lock.unlock()
        return picked
    }

    public func route(req: LspRequest): LspResponse {
        // 1) verb 与参数：失败就到此为止，绝不触发文件扫描。
        if (!lspIsVerb(req.verb)) { return lspFailure(req, lspFailBadVerb) }
        let invalid = lspCheckRequest(req)
        if (invalid.size > 0) { return lspFailure(req, invalid) }
        // 2) 进来的时候已经取消：不执行、不扫描、不产出空结果。
        if (req.token.cancelled()) { return lspFailure(req, lspFailCancelled) }

        let full = lspNormalizePath(req.path, req.workspaceRoot)
        if (let Some(reg) <- pick(lspExtensionOf(full))) {
            return routeToServer(req, reg)
        }
        // 3) 无插件：保持失败态，附文本线索并标「非语义结果」。
        let fallback = lspFailure(req, lspFailNoServer)
        fallback.nonSemantic = true
        try { for (clue in scanner.scan(req).toArray()) { fallback.clues.add(clue) } } catch (_: Exception) { }
        if (req.token.cancelled()) { return lspFailure(req, lspFailCancelled) }
        return fallback
    }

    private func routeToServer(req: LspRequest, reg: LspRegistration): LspResponse {
        // 4) 已注册但不支持该 verb：这是能力缺失，不是没有插件，所以不回退扫描。
        try { if (!reg.server.supports(req.verb)) { return lspFailure(req, lspFailUnsupported) } } catch (_: Exception) { return lspFailure(req, lspFailServerFailed) }

        var body = LspResponse()
        var broken = false
        try {
            body = reg.server.execute(req)
        } catch (_: Exception) {
            broken = true
        }
        // 服务器炸了就是炸了：报失败，不报空列表。
        if (broken) { return lspFailure(req, lspFailServerFailed) }
        if (req.token.cancelled()) { return lspFailure(req, lspFailCancelled) }
        // 5) 在途期间被撤销：这份结果已经没有归宿了。
        if (!hasRegistration(reg.registrationId)) { return lspFailure(req, lspFailServerGone) }
        // 6) 响应必须带服务器身份，且就是被路由到的那一个。
        if (body.serverId.size == 0 || body.serverId != reg.serverId) {
            return lspFailure(req, lspFailMissingIdentity)
        }
        // 7) 迟到结果不能当作新文档版本的有效结果。
        let known = documentVersion(req.path, req.workspaceRoot)
        let current = if (known < 0) { req.documentVersion } else { known }
        if (body.documentVersion != req.documentVersion || body.documentVersion < current) { return lspFailure(req, lspFailStale) }

        // 8) 载荷复核：位置和编辑按与请求侧同一口径校验，不合格整份不采信。
        let problem = lspCheckResponse(req, body)
        if (problem.size > 0) { return lspFailure(req, problem) }
        // 9) 诊断三态：从未 publish 过 ≠ 查过且没问题。
        if (req.verb == "diagnostics") {
            if (!lspIsSnapshotState(body.diagnosticSnapshot)) { return lspFailure(req, lspFailNoSnapshot) }
            if (body.diagnosticSnapshot == lspSnapshotNone) { return lspFailure(req, lspFailNoSnapshot) }
            if (body.diagnosticSnapshot == lspSnapshotEmpty && body.diagnostics.size > 0) {
                return lspFailure(req, lspFailNoSnapshot)
            }
            if (body.diagnosticSnapshot == lspSnapshotPresent && body.diagnostics.size == 0) {
                return lspFailure(req, lspFailNoSnapshot)
            }
        }
        if (body.reason.size > 0) { return lspFailure(req, lspFailServerFailed) }
        for (location in body.locations) { location.path = lspNormalizePath(location.path, req.workspaceRoot) }
        for (item in body.callItems) { item.location.path = lspNormalizePath(item.location.path, req.workspaceRoot) }
        for (diagnostic in body.diagnostics) { diagnostic.path = lspNormalizePath(diagnostic.path, req.workspaceRoot) }
        for (file in body.editFiles) { file.path = lspNormalizePath(file.path, req.workspaceRoot) }
        body.sessionId = req.sessionId
        body.requestId = req.requestId
        body.ok = true
        body.reason = ""
        body.verb = req.verb
        body.nonSemantic = false
        body.clues.clear()
        return body
    }
}

func lspFailure(req: LspRequest, reason: String): LspResponse {
    let resp = LspResponse()
    resp.sessionId = req.sessionId
    resp.requestId = req.requestId
    resp.ok = false
    resp.reason = reason
    resp.verb = req.verb
    resp.documentVersion = req.documentVersion
    return resp
}

// 进程内共享路由：Host 的 lsp/* 分派与模型工具面必须落在同一个 router 上，
// 否则「桌面问到的一定和模型问到的一定不一致」。装配仍归 L2 插件。
public class LspRouters {
    static let instance = LspRouter()

    public static func sharedRouter(): LspRouter { return instance }
}

// ---------- 跨入口统一 JSON 形状 ----------
// 模型侧与 Host 侧共用这一份序列化：工具结果必须是对象形状，不能先转义成字符串
// 再被外层转义一次——那样模型看到的是一坨带反斜杠的文本，而授权/审查侧再也
// 解析不出这是哪个 verb、为什么失败。

func lspBoolText(value: Bool): String {
    return if (value) { "true" } else { "false" }
}

func lspRangeJson(range: LspRange): String {
    return "{\"start\":{\"line\":${range.start.line},\"character\":${range.start.character}},\"end\":{\"line\":${range.end.line},\"character\":${range.end.character}}}"
}

func lspLocationJson(location: LspLocation): String {
    return "{\"path\":\"${jsonEscapeText(location.path)}\",\"range\":${lspRangeJson(location.range)}}"
}

func lspDiagnosticJson(diagnostic: LspDiagnostic): String {
    return "{\"path\":\"${jsonEscapeText(diagnostic.path)}\",\"range\":${lspRangeJson(diagnostic.range)},\"severity\":\"${jsonEscapeText(diagnostic.severity)}\",\"source\":\"${jsonEscapeText(diagnostic.source)}\",\"code\":\"${jsonEscapeText(diagnostic.code)}\",\"message\":\"${jsonEscapeText(diagnostic.message)}\"}"
}

func lspCallItemJson(item: LspCallItem): String {
    return "{\"name\":\"${jsonEscapeText(item.name)}\",\"kind\":\"${jsonEscapeText(item.kind)}\",\"location\":${lspLocationJson(item.location)}}"
}

func lspFileEditsJson(fileEdits: LspFileEdits): String {
    var edits = "["
    var first = true
    for (edit in fileEdits.edits) {
        if (!first) { edits += "," }
        first = false
        edits += "{\"range\":${lspRangeJson(edit.range)},\"newText\":\"${jsonEscapeText(edit.newText)}\"}"
    }
    edits += "]"
    return "{\"path\":\"${jsonEscapeText(fileEdits.path)}\",\"edits\":${edits}}"
}

func lspStringArrayJson(items: ArrayList<String>): String {    var out = "["
    var first = true
    for (item in items) {
        if (!first) { out += "," }
        first = false
        out += "\"${jsonEscapeText(item)}\""
    }
    out += "]"
    return out
}

func lspLocationArrayJson(items: ArrayList<LspLocation>): String {
    var out = "["
    var first = true
    for (item in items) {
        if (!first) { out += "," }
        first = false
        out += lspLocationJson(item)
    }
    out += "]"
    return out
}

public func lspResponseJson(resp: LspResponse): String {
    var diagnostics = "["
    var firstDiagnostic = true
    for (item in resp.diagnostics) {
        if (!firstDiagnostic) { diagnostics += "," }
        firstDiagnostic = false
        diagnostics += lspDiagnosticJson(item)
    }
    diagnostics += "]"
    var calls = "["
    var firstCall = true
    for (item in resp.callItems) {
        if (!firstCall) { calls += "," }
        firstCall = false
        calls += lspCallItemJson(item)
    }
    calls += "]"
    var files = "["
    var firstFile = true
    for (item in resp.editFiles) {
        if (!firstFile) { files += "," }
        firstFile = false
        files += lspFileEditsJson(item)
    }
    files += "]"
    var out = "{"
    out += "\"verb\":\"${jsonEscapeText(resp.verb)}\""
    out += ",\"ok\":${lspBoolText(resp.ok)}"
    out += ",\"reason\":\"${jsonEscapeText(resp.reason)}\""
    out += ",\"sessionId\":\"${jsonEscapeText(resp.sessionId)}\",\"requestId\":\"${jsonEscapeText(resp.requestId)}\""
    out += ",\"serverId\":\"${jsonEscapeText(resp.serverId)}\""
    out += ",\"documentVersion\":${resp.documentVersion}"
    out += ",\"nonSemantic\":${lspBoolText(resp.nonSemantic)}"
    out += ",\"label\":\"${if (resp.nonSemantic) { "非语义结果" } else { "语义结果" }}\",\"previewOnly\":${lspBoolText(resp.verb == "rename")}"
    out += ",\"hover\":\"${jsonEscapeText(resp.hoverMarkdown)}\""
    out += ",\"diagnosticSnapshot\":\"${jsonEscapeText(resp.diagnosticSnapshot)}\""
    out += ",\"locations\":${lspLocationArrayJson(resp.locations)}"
    out += ",\"callItems\":${calls}"
    out += ",\"diagnostics\":${diagnostics}"
    out += ",\"editFiles\":${files}"
    out += ",\"clues\":${lspStringArrayJson(resp.clues)}"
    out += "}"
    return out
}

// Host 协议面读 params 用的解析：键集固定，多一个键就拒（与模型侧
// additionalProperties:false 同口径，避免协议面比声明面宽）。
public class LspParams {
    public var path = ""
    public var line: Int64 = 0
    public var character: Int64 = 0
    public var direction = ""
    public var includeDeclaration = true
    public var newName = ""
    public var documentVersion: Int64 = 0
    public var ok = false

    public init() {}
}

func lspKnownKeyCount(obj: JsonObject, keys: Array<String>): Int64 {
    var count: Int64 = 0
    for (key in keys) {
        if (obj.get(key).isSome()) { count += 1 }
    }
    return count
}

func lspTextOf(obj: JsonObject, key: String): String {
    if (let Some(value) <- obj.get(key)) { return value.asString().getValue() }
    return ""
}

func lspNumberOf(obj: JsonObject, key: String, fallback: Int64): Int64 {
    if (let Some(value) <- obj.get(key)) { return value.asInt().getValue() }
    return fallback
}

// 校验并解出 verb 允许的那几个键。这里的失败原因与核心侧一致，
// 由调用方（Host / Agent）原样转成各自的错误形态。
// 形状与仓库其余解析入口一致：整段包在 try 里，任何类型不对的取值都当成拒。
public func lspParseParams(text: String, verb: String): LspParams {
    let bad = LspParams()
    if (text.trimAscii().size == 0) { return bad }
    var obj: JsonObject = JsonObject()
    var parsed = false
    try {
        obj = JsonValue.fromStr(text).asObject()
        parsed = true
    } catch (_: Exception) {
        parsed = false
    }
    if (!parsed) { return bad }
    if (!lspIsVerb(verb)) { return bad }
    // 必填字段与模型 Schema 共用一张表；缺少位置不能默默查询 0:0。
    for (name in lspSchemaRequired(verb)) {
        if (obj.get(name).isNone()) { return bad }
    }
    // additionalProperties:false 的等价物：出现的键数必须等于本 verb 认识的键数。
    // 认识的键直接取声明面那张表，运行面与模型看到的 Schema 因此不可能各自收紧或放松。
    if (obj.size() != lspKnownKeyCount(obj, lspToolParamNames(verb))) { return bad }
    let out = LspParams()
    var shaped = false
    try {
        out.path = lspTextOf(obj, "path")
        out.line = lspNumberOf(obj, "line", 0)
        out.character = lspNumberOf(obj, "character", 0)
        out.documentVersion = lspNumberOf(obj, "documentVersion", 0)
        out.direction = lspTextOf(obj, "direction")
        if (let Some(value) <- obj.get("includeDeclaration")) {
            out.includeDeclaration = value.asBool().getValue()
        }
        out.newName = lspTextOf(obj, "newName")
        shaped = true
    } catch (_: Exception) {
        shaped = false
    }
    if (!shaped) { return bad }
    if (out.path.size == 0) { return bad }
    if (out.line < 0 || out.character < 0) { return bad }
    if (out.documentVersion < 0) { return bad }
    if (verb == "call-hierarchy" && out.direction != "incoming" && out.direction != "outgoing") { return bad }
    if (verb == "rename" && out.newName.trimAscii().size == 0) { return bad }
    out.ok = true
    return out
}

// 模型工具与 Host 共用的一次调用装配：把已校验的参数 + 入口侧身份拼成请求。
public func lspBuildRequest(sessionId: String, requestId: String, verb: String,
    params: LspParams, workspaceRoot: String, token: TurnToken): LspRequest {
    return LspRequest(
        sessionId: sessionId, requestId: requestId, verb: verb, path: params.path,
        line: params.line, character: params.character, direction: params.direction,
        includeDeclaration: params.includeDeclaration, newName: params.newName,
        workspaceRoot: workspaceRoot, documentVersion: params.documentVersion, token: token)
}

// 一次语义调用交出了多少条结果，供 tool/result 审计行用。
// 计的是「载荷条数」而不是「有没有成功」：失败响应到这里载荷必为空，
// 所以 0 同时说明「没结果」，而 reason 才说明「为什么没结果」，两者不混。
public func lspOutcomeCount(resp: LspResponse): Int64 {
    var total: Int64 = Int64(resp.locations.size) + Int64(resp.callItems.size)
    total += Int64(resp.diagnostics.size)
    total += Int64(resp.editFiles.size)
    if (resp.hoverMarkdown.size > 0) { total += Int64(1) }
    return total
}
