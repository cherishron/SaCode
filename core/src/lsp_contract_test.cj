package core

import std.collection.*
import std.fs.*
import std.unittest.*
import stdx.encoding.json.*

// L1 LSP 语义工具契约测试。上游契约基线：LSP 3.17（Position 0 起始行 + UTF-16 列，
// Range 左闭右开，textDocument/{definition,hover,references,implementation,
// prepareCallHierarchy+incoming/outgoing,publishDiagnostics,rename}）。
//
// 这里的服务器全部是内存契约夹具（ContractServer）：它只按 mode 拼出形状正确的响应，
// 不 spawn 进程、不做 LSP 协议转换。所以本文件证明的是「核心契约与路由的形状」，
// 不代表任何真实 language server 通信——那归 L2 的 TS 插件验收。

// ---------- 夹具 ----------

class ContractServer <: LspServer {
    var id = "fixture-server"
    var mode = "locations"
    var verbs = ArrayList<String>()
    var calls: Int64 = 0
    var lastRequest: LspRequest = LspRequest()
    var boundRouter: LspRouter = LspRouter()
    var boundId = ""
    var replyPath = ""
    var secondPath = ""
    var outsidePath = ""
    var newerVersion: Int64 = 9

    public init() {
        for (verb in lspVerbNames()) { verbs.add(verb) }
    }

    public func serverId(): String { return id }

    public func supports(verb: String): Bool { return verbs.contains(verb) }

    // 只去掉列出来的那几个 verb（重建 ArrayList，不依赖不确定的删除重载）
    public func without(list: Array<String>): Unit {
        let keep = ArrayList<String>()
        for (verb in verbs) {
            var hit = false
            for (drop in list) { if (drop == verb) { hit = true } }
            if (!hit) { keep.add(verb) }
        }
        verbs = keep
    }

    func pathFor(req: LspRequest): String {
        return if (replyPath.size > 0) { replyPath } else { req.path }
    }

    public func execute(req: LspRequest): LspResponse {
        calls += 1
        lastRequest = req
        if (mode == "throws") { throw Exception("fixture-server-boom") }
        if (mode == "self-gone") { boundRouter.unregister(boundId) }
        if (mode == "self-newer") { boundRouter.noteDocumentVersion(req.path, newerVersion, req.workspaceRoot) }
        let resp = LspResponse()
        resp.serverId = id
        resp.documentVersion = req.documentVersion
        if (mode == "no-identity") { resp.serverId = "" }
        if (mode == "other-identity") { resp.serverId = "not-the-routed-one" }
        if (mode == "late-version") { resp.documentVersion = req.documentVersion - Int64(2) }
        if (mode == "locations") {
            resp.locations.add(LspLocation(pathFor(req), LspRange(LspPosition(0, 0), LspPosition(0, 3))))
        }
        if (mode == "hover") { resp.hoverMarkdown = "**alpha(): number**" }
        if (mode == "call") {
            resp.callItems.add(LspCallItem("beta", "function",
                LspLocation(secondPath, LspRange(LspPosition(0, 0), LspPosition(0, 4)))))
        }
        if (mode == "diag-empty") { resp.diagnosticSnapshot = lspSnapshotEmpty }
        if (mode == "diag-none") { resp.diagnosticSnapshot = lspSnapshotNone }
        if (mode == "diag-present") {
            resp.diagnosticSnapshot = lspSnapshotPresent
            resp.diagnostics.add(LspDiagnostic(pathFor(req),
                LspRange(LspPosition(1, 2), LspPosition(1, 8)), "error", "E1", "no-such-symbol"))
        }
        if (mode == "edits") {
            let first = LspFileEdits(pathFor(req))
            first.add(LspTextEdit(LspRange(LspPosition(0, 9), LspPosition(0, 14)), "gamma"))
            resp.editFiles.add(first)
            let second = LspFileEdits(secondPath)
            second.add(LspTextEdit(LspRange(LspPosition(3, 6), LspPosition(3, 10)), "gamma"))
            resp.editFiles.add(second)
        }
        if (mode == "bad-outside") {
            resp.locations.add(LspLocation(outsidePath, LspRange(LspPosition(0, 0), LspPosition(0, 1))))
        }
        if (mode == "bad-range") {
            resp.locations.add(LspLocation(pathFor(req), LspRange(LspPosition(1, 4), LspPosition(1, 2))))
        }
        if (mode == "bad-column") {
            resp.locations.add(LspLocation(pathFor(req), LspRange(LspPosition(0, 0), LspPosition(0, 999))))
        }
        if (mode == "bad-line") {
            resp.locations.add(LspLocation(pathFor(req), LspRange(LspPosition(500, 0), LspPosition(500, 1))))
        }
        return resp
    }
}

// 回退扫描的计数器：「参数错误 / 越界 / 取消不得扫文件」只能靠注入探针来钉。
class CountingScanner <: LspFallbackScanner {
    var scans: Int64 = 0
    var lastPath = ""
    public init() {}
    public func scan(req: LspRequest): Array<String> {
        scans += 1
        lastPath = req.path
        return ["text-clue"]
    }
}

func lspWorkspace(tag: String): String {
    let root = "lsp-l1-${tag}"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    File.writeTo("${root}/sample.ts", "function alpha() {\n  return 1\n}\nclass Beta {}\n".toArray())
    File.writeTo("${root}/other.ts", "class Delta {\n  x = 1\n}\nconst alphaValue = 2\n".toArray())
    File.writeTo("${root}/unicode.ts", "a = \u{1F642}b\n".toArray())
    return root
}

func lspJsonIsObject(text: String): Bool {
    var shaped = false
    try {
        JsonValue.fromStr(text).asObject()
        shaped = true
    } catch (_: Exception) {
        shaped = false
    }
    return shaped
}

func lspReq(root: String, verb: String, path: String): LspRequest {
    return LspRequest(sessionId: "s1", requestId: "r1", verb: verb, path: path, workspaceRoot: root)
}

func lspBind(server: ContractServer, router: LspRouter, root: String, extensions: Array<String>): Unit {
    let result = router.register(server, extensions)
    server.boundRouter = router
    server.boundId = result.registrationId
}

// ---------- verb 词表与命名 ----------

@Test
func lspVerbVocabularyIsExactlySeven() {
    let names = lspVerbNames()
    @Expect(names.size == 7, true)
    @Expect(names[0], "define")
    @Expect(names[6], "rename")
    @Expect(lspIsVerb("call-hierarchy"), true)
    @Expect(lspIsVerb("formatting"), false)
    @Expect(lspIsVerb(""), false)
}

@Test
func lspToolAndMethodNamesDeriveFromVerb() {
    @Expect(lspToolName("define"), "lsp_define")
    @Expect(lspToolName("call-hierarchy"), "lsp_call_hierarchy")
    @Expect(lspToolName("rename"), "lsp_rename")
    @Expect(lspMethodName("lookup"), "lsp/lookup")
    @Expect(lspMethodName("call-hierarchy"), "lsp/call-hierarchy")
    // 两个入口共用同一份派生，不再各写一张映射表
    var counted: Int64 = 0
    for (verb in lspVerbNames()) {
        if (lspToolName(verb).startsWith("lsp_") && lspMethodName(verb).startsWith("lsp/")) { counted += 1 }
    }
    @Expect(counted, Int64(7))
}

// ---------- 参数校验：三类失败都不许扫文件 ----------

@Test
func lspRejectsUnknownVerbWithoutScanningFile() {
    let root = lspWorkspace("bad-verb")
    let scanner = CountingScanner()
    let router = LspRouter(scanner: scanner)
    let out = router.route(lspReq(root, "formatting", "sample.ts"))
    @Expect(out.ok, false)
    @Expect(out.reason, lspFailBadVerb)
    @Expect(scanner.scans, Int64(0))
    @Expect(out.nonSemantic, false)
    removeIfExists(root, recursive: true)
}

@Test
func lspRejectsEmptyIdentityAndBadPositionsWithoutScanning() {
    let root = lspWorkspace("bad-args")
    let scanner = CountingScanner()
    let router = LspRouter(scanner: scanner)
    @Expect(router.route(LspRequest(verb: "define", path: "sample.ts", workspaceRoot: root)).reason, lspFailBadArgs)
    @Expect(router.route(LspRequest(sessionId: "s1", requestId: "r1", verb: "define",
        path: "", workspaceRoot: root)).reason, lspFailBadArgs)
    @Expect(lspCheckRequest(lspReq(root, "define", "sample.ts")), "")
    @Expect(router.route(LspRequest(sessionId: "s1", requestId: "r1", verb: "define",
        path: "sample.ts", line: Int64(-1), workspaceRoot: root)).reason, lspFailBadArgs)
    @Expect(router.route(LspRequest(sessionId: "s1", requestId: "r1", verb: "define",
        path: "sample.ts", character: Int64(-3), workspaceRoot: root)).reason, lspFailBadArgs)
    @Expect(scanner.scans, Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func lspCallHierarchyDirectionIsClosedSet() {
    let root = lspWorkspace("direction")
    let scanner = CountingScanner()
    let router = LspRouter(scanner: scanner)
    let incoming = LspRequest(sessionId: "s1", requestId: "r1", verb: "call-hierarchy",
        path: "sample.ts", direction: "incoming", workspaceRoot: root)
    let outgoing = LspRequest(sessionId: "s1", requestId: "r1", verb: "call-hierarchy",
        path: "sample.ts", direction: "outgoing", workspaceRoot: root)
    let sideways = LspRequest(sessionId: "s1", requestId: "r1", verb: "call-hierarchy",
        path: "sample.ts", direction: "sideways", workspaceRoot: root)
    let missing = lspReq(root, "call-hierarchy", "sample.ts")
    @Expect(lspCheckRequest(incoming), "")
    @Expect(lspCheckRequest(outgoing), "")
    @Expect(lspCheckRequest(sideways), lspFailBadArgs)
    @Expect(lspCheckRequest(missing), lspFailBadArgs)
    @Expect(router.route(sideways).reason, lspFailBadArgs)
    @Expect(router.route(missing).reason, lspFailBadArgs)
    @Expect(scanner.scans, Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func lspRenameRequiresNewNameAndReferencesDefaultsToIncludeDeclaration() {
    let root = lspWorkspace("rename-args")
    let scanner = CountingScanner()
    let router = LspRouter(scanner: scanner)
    @Expect(lspCheckRequest(LspRequest(sessionId: "s1", requestId: "r1", verb: "rename",
        path: "sample.ts", workspaceRoot: root)), lspFailBadArgs)
    @Expect(lspCheckRequest(LspRequest(sessionId: "s1", requestId: "r1", verb: "rename",
        path: "sample.ts", newName: "gamma", workspaceRoot: root)), "")
    // references 默认含声明：不写 includeDeclaration 就是 true
    @Expect(lspReq(root, "references", "sample.ts").includeDeclaration, true)
    @Expect(scanner.scans, Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func lspRejectsPathOutsideSessionWorkspaceWithoutScanning() {
    let root = lspWorkspace("outside")
    let scanner = CountingScanner()
    let router = LspRouter(scanner: scanner)
    @Expect(lspCheckRequest(lspReq(root, "define", "../elsewhere/sample.ts")), lspFailOutOfWorkspace)
    @Expect(lspCheckRequest(lspReq(root, "define", "sub/../../elsewhere/sample.ts")), lspFailOutOfWorkspace)
    @Expect(router.route(lspReq(root, "define", "../elsewhere/sample.ts")).reason, lspFailOutOfWorkspace)
    @Expect(router.route(lspReq("", "define", "sample.ts")).reason, lspFailOutOfWorkspace)
    @Expect(scanner.scans, Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func lspCancelledRequestIsNotDisguisedAsEmptyResult() {
    let root = lspWorkspace("cancelled")
    let scanner = CountingScanner()
    let router = LspRouter(scanner: scanner)
    let server = ContractServer()
    lspBind(server, router, root, ["ts"])
    let token = TurnToken()
    token.cancel()
    let out = router.route(LspRequest(sessionId: "s1", requestId: "r1", verb: "define",
        path: "sample.ts", workspaceRoot: root, token: token))
    @Expect(out.ok, false)
    @Expect(out.reason, lspFailCancelled)
    @Expect(out.locations.size == 0, true)
    @Expect(scanner.scans, Int64(0))
    @Expect(server.calls, Int64(0))
    removeIfExists(root, recursive: true)
}

// ---------- 无插件回退 ----------

@Test
func lspNoServerKeepsFailureAndAddsMarkedTextClues() {
    let root = lspWorkspace("fallback")
    let router = LspRouter()
    let out = router.route(lspReq(root, "define", "sample.ts"))
    @Expect(out.ok, false)
    @Expect(out.reason, lspFailNoServer)
    @Expect(out.nonSemantic, true)
    @Expect(out.clues.size > 0, true)
    @Expect(out.clues[0].contains("function:alpha"), true)
    // 回退不填语义字段：定义、诊断、rename 的格子都保持空
    @Expect(out.locations.size == 0, true)
    @Expect(out.hoverMarkdown.size == 0, true)
    @Expect(out.callItems.size == 0, true)
    @Expect(out.diagnostics.size == 0, true)
    @Expect(out.diagnosticSnapshot, lspSnapshotNone)
    @Expect(out.editFiles.size == 0, true)
    let json = lspResponseJson(out)
    @Expect(lspJsonIsObject(json), true)
    @Expect(json.contains("\"nonSemantic\":true"), true)
    @Expect(json.contains("lsp-no-server"), true)
    removeIfExists(root, recursive: true)
}

@Test
func lspUnsupportedDoesNotFallBackToTextScan() {
    let root = lspWorkspace("unsupported")
    let scanner = CountingScanner()
    let router = LspRouter(scanner: scanner)
    let server = ContractServer()
    server.without(["references"])
    lspBind(server, router, root, ["ts"])
    let out = router.route(lspReq(root, "references", "sample.ts"))
    @Expect(out.ok, false)
    @Expect(out.reason, lspFailUnsupported)
    // 已注册但不支持 = 能力缺失，不是「没有插件」，所以不给文本线索
    @Expect(out.nonSemantic, false)
    @Expect(out.clues.size == 0, true)
    @Expect(scanner.scans, Int64(0))
    @Expect(router.route(lspReq(root, "define", "sample.ts")).ok, true)
    removeIfExists(root, recursive: true)
}

@Test
func lspServerFailureAndDisconnectAreNotEmptyResults() {
    let root = lspWorkspace("failed")
    let router = LspRouter()
    let server = ContractServer()
    server.mode = "throws"
    lspBind(server, router, root, ["ts"])
    let out = router.route(lspReq(root, "define", "sample.ts"))
    @Expect(out.ok, false)
    @Expect(out.reason, lspFailServerFailed)
    @Expect(out.locations.size == 0, true)
    @Expect(out.nonSemantic, false)
    removeIfExists(root, recursive: true)
}

// ---------- 路由：按规范化扩展名、冲突、撤销、在途失效 ----------

@Test
func lspRoutesByNormalizedExtensionAndAllowsDistinctOwners() {
    let root = lspWorkspace("routing")
    let router = LspRouter()
    let ts = ContractServer()
    ts.id = "ts-owner"
    let go = ContractServer()
    go.id = "go-owner"
    @Expect(router.register(ts, ["TS"]).ok, true)
    @Expect(router.register(go, ["go"]).ok, true)
    @Expect(router.liveCount(), Int64(2))
    let a = router.route(lspReq(root, "define", "sample.ts"))
    let b = router.route(lspReq(root, "define", "main.GO"))
    @Expect(a.ok, true)
    @Expect(a.serverId, "ts-owner")
    @Expect(b.ok, true)
    @Expect(b.serverId, "go-owner")
    // 没登记的扩展名走无插件回退，而不是借给别人的服务器
    @Expect(router.route(lspReq(root, "define", "readme.md")).reason, lspFailNoServer)
    @Expect(router.route(lspReq(root, "define", "noextension")).reason, lspFailNoServer)
    removeIfExists(root, recursive: true)
}

@Test
func lspSameExtensionRegistrationIsRejectedAndKeepsFirstOwner() {
    let root = lspWorkspace("conflict")
    let router = LspRouter()
    let first = ContractServer()
    first.id = "first"
    let second = ContractServer()
    second.id = "second"
    @Expect(router.register(first, ["ts"]).ok, true)
    let clash = router.register(second, ["ts", "tsx"])
    @Expect(clash.ok, false)
    @Expect(clash.reason, lspFailExtensionConflict)
    @Expect(clash.registrationId.size == 0, true)
    @Expect(router.liveCount(), Int64(1))
    @Expect(router.route(lspReq(root, "define", "sample.ts")).serverId, "first")
    // 被拒的那一方连一半都没占上：tsx 不能因为同一批里有 ts 就偷偷生效
    @Expect(router.route(lspReq(root, "define", "comp.tsx")).reason, lspFailNoServer)
    removeIfExists(root, recursive: true)
}

@Test
func lspMultiExtensionRegistrationServesAllRegisteredExtensions() {
    let root = lspWorkspace("multi-ext")
    let router = LspRouter()
    let server = ContractServer()
    let result = router.register(server, ["ts", "tsx"])
    @Expect(result.ok, true)
    @Expect(router.route(lspReq(root, "define", "sample.ts")).ok, true)
    @Expect(router.route(lspReq(root, "define", "comp.tsx")).ok, true)
    removeIfExists(root, recursive: true)
}

@Test
func lspUnregisterRevokesRoutingByRegistrationIdentity() {
    let root = lspWorkspace("unregister")
    let router = LspRouter()
    let server = ContractServer()
    let result = router.register(server, ["ts"])
    @Expect(router.unregister("lsp-reg-does-not-exist"), false)
    @Expect(router.route(lspReq(root, "define", "sample.ts")).ok, true)
    @Expect(router.unregister(result.registrationId), true)
    @Expect(router.liveCount(), Int64(0))
    @Expect(router.route(lspReq(root, "define", "sample.ts")).reason, lspFailNoServer)
    // 重复撤销是幂等的假，不是第二次成功
    @Expect(router.unregister(result.registrationId), false)
    removeIfExists(root, recursive: true)
}

@Test
func lspResultInFlightAfterUnregisterBecomesServerGone() {
    let root = lspWorkspace("gone")
    let router = LspRouter()
    let server = ContractServer()
    server.mode = "self-gone"
    lspBind(server, router, root, ["ts"])
    let out = router.route(lspReq(root, "define", "sample.ts"))
    @Expect(out.ok, false)
    @Expect(out.reason, lspFailServerGone)
    @Expect(out.locations.size == 0, true)
    @Expect(server.calls, Int64(1))
    @Expect(router.liveCount(), Int64(0))
    removeIfExists(root, recursive: true)
}

// ---------- 响应身份与文档版本 ----------

@Test
func lspResponseCarriesServerIdentityAndDocumentVersion() {
    let root = lspWorkspace("identity")
    let router = LspRouter()
    let server = ContractServer()
    lspBind(server, router, root, ["ts"])
    router.noteDocumentVersion("sample.ts", Int64(4), root)
    let out = router.route(LspRequest(sessionId: "s1", requestId: "r1", verb: "define",
        path: "sample.ts", workspaceRoot: root, documentVersion: Int64(4)))
    @Expect(out.ok, true)
    @Expect(out.serverId, "fixture-server")
    @Expect(out.documentVersion, Int64(4))
    @Expect(out.verb, "define")
    @Expect(out.locations.size == 1, true)
    @Expect(out.locations[0].range.start.line, Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func lspLateResultCannotBeTheValidResultForANewerDocument() {
    let root = lspWorkspace("stale")
    let router = LspRouter()
    let server = ContractServer()
    server.mode = "self-newer"
    server.newerVersion = Int64(9)
    lspBind(server, router, root, ["ts"])
    // 请求打在版本 3 上；执行期间文档改到 9，服务器交回的还是按 3 算的那份
    let out = router.route(LspRequest(sessionId: "s1", requestId: "r1", verb: "define",
        path: "sample.ts", workspaceRoot: root, documentVersion: Int64(3)))
    @Expect(out.ok, false)
    @Expect(out.reason, lspFailStale)
    @Expect(out.locations.size == 0, true)
    @Expect(router.documentVersion("sample.ts", root), Int64(9))
    removeIfExists(root, recursive: true)
}

@Test
func lspResponseWithoutMatchingServerIdentityIsRejected() {
    let root = lspWorkspace("identity-mismatch")
    let router = LspRouter()
    let anonymous = ContractServer()
    anonymous.mode = "no-identity"
    lspBind(anonymous, router, root, ["ts"])
    @Expect(router.route(lspReq(root, "define", "sample.ts")).reason, lspFailMissingIdentity)
    router.unregister(anonymous.boundId)
    let impostor = ContractServer()
    impostor.mode = "other-identity"
    lspBind(impostor, router, root, ["go"])
    @Expect(router.route(lspReq(root, "define", "main.go")).reason, lspFailMissingIdentity)
    removeIfExists(root, recursive: true)
}

// ---------- 插件返回的位置与编辑同样受校验 ----------

@Test
func lspLocationOutsideWorkspaceIsNotAdopted() {
    let root = lspWorkspace("result-outside")
    let router = LspRouter()
    let server = ContractServer()
    server.mode = "bad-outside"
    server.outsidePath = "../elsewhere/sample.ts"
    lspBind(server, router, root, ["ts"])
    let out = router.route(lspReq(root, "define", "sample.ts"))
    @Expect(out.reason, lspFailResultOutOfWorkspace)
    @Expect(out.ok, false)
    @Expect(out.locations.size == 0, true)
    removeIfExists(root, recursive: true)
}

@Test
func lspRangeMustBeHalfOpenAndWithinDocument() {
    let root = lspWorkspace("range")
    let router = LspRouter()
    let server = ContractServer()
    lspBind(server, router, root, ["ts"])
    server.mode = "bad-range"
    @Expect(router.route(lspReq(root, "define", "sample.ts")).reason, lspFailBadRange)
    server.mode = "bad-column"
    @Expect(router.route(lspReq(root, "define", "sample.ts")).reason, lspFailBadRange)
    server.mode = "bad-line"
    @Expect(router.route(lspReq(root, "define", "sample.ts")).reason, lspFailBadRange)
    server.mode = "locations"
    @Expect(router.route(lspReq(root, "define", "sample.ts")).ok, true)
    removeIfExists(root, recursive: true)
}

@Test
func lspColumnsCountUtf16UnitsNotBytesOrRunes() {
    let root = lspWorkspace("utf16")
    // 一个 U+1F642 是 2 个 UTF-16 单元、4 个 UTF-8 字节、1 个码点
    @Expect(lspUtf16Length("a = \u{1F642}b"), Int64(7))
    @Expect(lspUtf16Length("abc"), Int64(3))
    @Expect(lspUtf16Length(""), Int64(0))
    let router = LspRouter()
    let server = ContractServer()
    server.replyPath = "unicode.ts"
    lspBind(server, router, root, ["ts"])
    // 行尾本身是合法列（右开到端点），越过一格就不行
    server.mode = "locations"
    @Expect(router.route(lspReq(root, "define", "unicode.ts")).ok, true)
    server.mode = "bad-column"
    @Expect(router.route(lspReq(root, "define", "unicode.ts")).reason, lspFailBadRange)
    removeIfExists(root, recursive: true)
}

@Test
func lspPathNormalizationResolvesDotsAndBackslashes() {
    let root = lspWorkspace("normalize")
    @Expect(lspNormalizePath("sub\\..\\sample.ts", root), "${root}/sample.ts")
    @Expect(lspNormalizePath("./sample.ts", root), "${root}/sample.ts")
    @Expect(lspNormalizePath("a//./b.ts", root), "${root}/a/b.ts")
    @Expect(lspNormalizePath("a/b/../../c.ts", root), "${root}/c.ts")
    @Expect(lspNormalizePath("/abs/sample.ts", root), "/abs/sample.ts")
    @Expect(lspPathInsideWorkspace("a/../sample.ts", root), true)
    @Expect(lspPathInsideWorkspace("/abs/sample.ts", root), false)
    @Expect(lspPathInsideWorkspace("a/../../sample.ts", root), false)
    @Expect(lspExtensionOf("Main.TS"), "ts")
    @Expect(lspExtensionOf("archive.tar.gz"), "gz")
    @Expect(lspExtensionOf("Makefile"), "")
    @Expect(lspExtensionOf(".gitignore"), "")
    removeIfExists(root, recursive: true)
}

// ---------- 诊断三态 ----------

@Test
func lspEmptyDiagnosticSnapshotDiffersFromMissingSnapshot() {
    let root = lspWorkspace("diag")
    let router = LspRouter()
    let server = ContractServer()
    lspBind(server, router, root, ["ts"])
    server.mode = "diag-empty"
    let clean = router.route(lspReq(root, "diagnostics", "sample.ts"))
    @Expect(clean.ok, true)
    @Expect(clean.diagnosticSnapshot, lspSnapshotEmpty)
    @Expect(clean.diagnostics.size == 0, true)
    // 「查过了，没问题」必须是有效结果
    server.mode = "diag-none"
    let unknown = router.route(lspReq(root, "diagnostics", "sample.ts"))
    @Expect(unknown.ok, false)
    @Expect(unknown.reason, lspFailNoSnapshot)
    @Expect(unknown.diagnostics.size == 0, true)
    // 自相矛盾的快照形态也不采信
    server.mode = "diag-present"
    let real = router.route(lspReq(root, "diagnostics", "sample.ts"))
    @Expect(real.ok, true)
    @Expect(real.diagnosticSnapshot, lspSnapshotPresent)
    @Expect(real.diagnostics.size == 1, true)
    @Expect(real.diagnostics[0].message, "no-such-symbol")
    removeIfExists(root, recursive: true)
}

@Test
func lspNoServerDiagnosticsDoesNotClaimTheFileIsClean() {
    let root = lspWorkspace("diag-noserver")
    let router = LspRouter()
    let out = router.route(lspReq(root, "diagnostics", "sample.ts"))
    @Expect(out.reason, lspFailNoServer)
    @Expect(out.diagnosticSnapshot, lspSnapshotNone)
    @Expect(out.ok, false)
    removeIfExists(root, recursive: true)
}

// ---------- rename：只出跨文件预览，一个字都不落盘 ----------

@Test
func lspRenamePreviewSpansFilesAndLeavesEveryByteOnDiskUntouched() {
    let root = lspWorkspace("rename")
    let router = LspRouter()
    let server = ContractServer()
    server.mode = "edits"
    server.secondPath = "other.ts"
    lspBind(server, router, root, ["ts"])
    let firstBefore = sha256Hex(File.readFrom("${root}/sample.ts"))
    let secondBefore = sha256Hex(File.readFrom("${root}/other.ts"))
    let out = router.route(LspRequest(sessionId: "s1", requestId: "r1", verb: "rename",
        path: "sample.ts", line: Int64(0), character: Int64(9), newName: "gamma",
        workspaceRoot: root, documentVersion: Int64(2)))
    @Expect(out.ok, true)
    @Expect(out.editFiles.size == 2, true)
    @Expect(out.editFiles[0].edits.size == 1, true)
    @Expect(out.editFiles[1].path, "${root}/other.ts")
    @Expect(out.editFiles[1].edits[0].newText, "gamma")
    // 执行前后文件哈希逐字相同：核心只给预览，落盘归 F08 的审查与授权链
    @Expect(sha256Hex(File.readFrom("${root}/sample.ts")), firstBefore)
    @Expect(sha256Hex(File.readFrom("${root}/other.ts")), secondBefore)
    removeIfExists(root, recursive: true)
}

@Test
func lspRenameEditOutsideDocumentRangeIsRejected() {
    let root = lspWorkspace("rename-range")
    let router = LspRouter()
    let server = ContractServer()
    server.mode = "edits"
    server.secondPath = "unicode.ts"
    lspBind(server, router, root, ["ts"])
    // unicode.ts 只有 1 行且列上界很小，(3,6)-(3,10) 接不上
    let out = router.route(LspRequest(sessionId: "s1", requestId: "r1", verb: "rename",
        path: "sample.ts", newName: "gamma", workspaceRoot: root))
    @Expect(out.ok, false)
    @Expect(out.reason, lspFailBadRange)
    @Expect(out.editFiles.size == 0, true)
    removeIfExists(root, recursive: true)
}

// ---------- 参数解析（JSON Schema 之外的运行时二次校验） ----------

@Test
func lspParamParsingRejectsExtraKeysAndBadTypesPerVerb() {
    let ok = lspParseParams("{\"path\":\"sample.ts\",\"line\":0,\"character\":9}", "define")
    @Expect(ok.ok, true)
    @Expect(ok.path, "sample.ts")
    @Expect(ok.line, Int64(0))
    @Expect(ok.includeDeclaration, true)
    // additionalProperties:false：多一个键就整条拒
    @Expect(lspParseParams("{\"path\":\"sample.ts\",\"bogus\":1}", "define").ok, false)
    @Expect(lspParseParams("{\"path\":\"sample.ts\",\"line\":0,\"character\":9,\"newName\":\"gamma\"}", "define").ok, false)
    @Expect(lspParseParams("{}", "define").ok, false)
    @Expect(lspParseParams("", "define").ok, false)
    @Expect(lspParseParams("{\"line\":0}", "define").ok, false)
    @Expect(lspParseParams("{\"path\":\"sample.ts\",\"line\":-1}", "define").ok, false)
    @Expect(lspParseParams("{\"path\":\"sample.ts\",\"line\":\"x\"}", "define").ok, false)
    @Expect(lspParseParams("{\"path\":\"sample.ts\"}", "call-hierarchy").ok, false)
    @Expect(lspParseParams("{\"path\":\"sample.ts\",\"direction\":\"sideways\"}", "call-hierarchy").ok, false)
    let call = lspParseParams("{\"path\":\"sample.ts\",\"line\":0,\"character\":9,\"direction\":\"incoming\"}", "call-hierarchy")
    @Expect(call.ok, true)
    @Expect(call.direction, "incoming")
    @Expect(lspParseParams("{\"path\":\"sample.ts\",\"newName\":\"\"}", "rename").ok, false)
    let rename = lspParseParams("{\"path\":\"sample.ts\",\"line\":0,\"character\":9,\"newName\":\"gamma\",\"documentVersion\":7}", "rename")
    @Expect(rename.ok, true)
    @Expect(rename.newName, "gamma")
    @Expect(rename.documentVersion, Int64(7))
    // references 才认识 includeDeclaration
    let refs = lspParseParams("{\"path\":\"sample.ts\",\"line\":0,\"character\":9,\"includeDeclaration\":false}", "references")
    @Expect(refs.ok, true)
    @Expect(refs.includeDeclaration, false)
}

@Test
func lspBuildRequestCarriesSessionRequestIdentityAndCancelToken() {
    let params = lspParseParams("{\"path\":\"sample.ts\",\"line\":1,\"character\":2,\"documentVersion\":5}", "lookup")
    let token = TurnToken()
    let req = lspBuildRequest("sess-9", "rpc-3", "lookup", params, "/work", token)
    @Expect(req.sessionId, "sess-9")
    @Expect(req.requestId, "rpc-3")
    @Expect(req.verb, "lookup")
    @Expect(req.path, "sample.ts")
    @Expect(req.line, Int64(1))
    @Expect(req.character, Int64(2))
    @Expect(req.documentVersion, Int64(5))
    @Expect(req.workspaceRoot, "/work")
    req.token.cancel()
    @Expect(token.cancelled(), true)
}

@Test
func lspPositionVerbsRejectMissingPositionInSchemaAndRuntime() {
    for (verb in lspVerbNames()) {
        if (verb == "diagnostics") { continue }
        let suffix = if (verb == "rename") { ",\"newName\":\"gamma\"" }
            else if (verb == "call-hierarchy") { ",\"direction\":\"incoming\"" } else { "" }
        @Expect(lspParseParams("{\"path\":\"sample.ts\"" + suffix + "}", verb).ok, false)
        @Expect(lspParseParams("{\"path\":\"sample.ts\",\"line\":0" + suffix + "}", verb).ok, false)
        @Expect(lspParseParams("{\"path\":\"sample.ts\",\"character\":9" + suffix + "}", verb).ok, false)
        @Expect(lspParseParams("{\"path\":\"sample.ts\",\"line\":0,\"character\":9" + suffix + "}", verb).ok, true)
        let schema = JsonValue.fromStr(lspToolSchema(verb)).asObject()
        let required = schema.get("required").getOrThrow().asArray()
        var hasLine = false
        var hasCharacter = false
        for (index in 0..required.size()) {
            let item = required.get(index).getOrThrow()
            if (item.asString().getValue() == "line") { hasLine = true }
            if (item.asString().getValue() == "character") { hasCharacter = true }
        }
        @Expect(hasLine, true)
        @Expect(hasCharacter, true)
    }
    @Expect(lspParseParams("{\"path\":\"sample.ts\"}", "diagnostics").ok, true)
    @Expect(lspParseParams("{\"path\":\"sample.ts\"}", "unknown").ok, false)
}

// ---------- 模型工具接线 ----------

@Test
func lspModelToolsAreSevenNoApprovalAndClosedSchemas() {
    let root = lspWorkspace("tools")
    let log = SessionLog("lsp-model-tools-unused.log")
    let runtime = ModelToolRuntime(log, false, files: true, workingDirectory: root)
    let specs = runtime.specs()
    // 声明面总数会随别的批次增减，所以这里只钉「lsp_ 前缀恰好 7 条」：
    // 既能抓住「旧 lsp 换成 7 条」，也不会因为别的批次增删一个工具而假红。
    var lspPrefixed: Int64 = 0
    for (spec in specs) { if (spec.name.startsWith("lsp_")) { lspPrefixed += 1 } }
    @Expect(lspPrefixed, Int64(7))
    var found: Int64 = 0
    for (verb in lspVerbNames()) {
        let name = lspToolName(verb)
        var hit = false
        for (spec in specs) {
            if (spec.name == name) {
                hit = true
                @Expect(spec.needsApproval, false)
                @Expect(lspJsonIsObject(spec.params), true)
                @Expect(spec.params.contains("\"additionalProperties\":false"), true)
                @Expect(spec.params.contains("\"path\""), true)
            }
        }
        if (hit) { found += 1 }
        @Expect(hit, true)
    }
    @Expect(found, Int64(7))
    var legacy = false
    for (spec in specs) { if (spec.name == "lsp") { legacy = true } }
    // 模型声明面不再暴露旧的 lspSymbols 工具
    @Expect(legacy, false)
    removeIfExists(root, recursive: true)
}

@Test
func lspModelToolExecutesThroughSharedRouterAndKeepsObjectShape() {
    let root = lspWorkspace("tool-exec")
    let router = LspRouter()
    let server = ContractServer()
    server.mode = "hover"
    lspBind(server, router, root, ["ts"])
    let log = SessionLog("lsp-model-tool-exec-unused.log")
    let runtime = ModelToolRuntime(log, false, files: true, workingDirectory: root,
        lspRouter: router, lspSession: "s1")
    let call = ModelToolCall(0)
    call.id = "call-hover"
    call.name = "lsp_lookup"
    call.args = "{\"path\":\"sample.ts\",\"line\":0,\"character\":0}"
    let out = runtime.execute(call)
    @Expect(out.allowed, true)
    @Expect(out.why.contains("**alpha(): number**"), true)
    @Expect(lspJsonIsObject(out.why), true)
    @Expect(server.lastRequest.sessionId, "s1")
    @Expect(server.lastRequest.requestId.size > 0, true)
    // 参数错误在运行时再校验一遍：Schema 之外不放过
    let bad = ModelToolCall(1)
    bad.id = "call-bad"
    bad.name = "lsp_rename"
    bad.args = "{\"path\":\"sample.ts\",\"newName\":\"\"}"
    let badOut = runtime.execute(bad)
    @Expect(badOut.allowed, false)
    @Expect(badOut.structured, true)
    @Expect(lspJsonIsObject(badOut.why), true)
    @Expect(badOut.why.contains("lsp-bad-args"), true)
    removeIfExists(root, recursive: true)
}

@Test
func lspDiagnosticsEnterModelContextWithoutGoalProgress() {
    let root = lspWorkspace("model-diag")
    let router = LspRouter()
    let server = ContractServer()
    server.mode = "diag-present"
    lspBind(server, router, root, ["ts"])
    let log = SessionLog("lsp-model-diag-unused.log")
    log.append("user/message", "check the file")
    let runtime = ModelToolRuntime(log, false, files: true, workingDirectory: root,
        lspRouter: router, lspSession: "s1")
    let first = AgentChunks([
        Chunk("tool-call-delta", "{\"path\":\"sample.ts\"}", "", toolIndex: Some(0), toolId: Some("call-diag"), toolName: Some("lsp_diagnostics")),
        Chunk("finish", "", "tool_calls")])
    let final = AgentChunks([Chunk("text", "seen", ""), Chunk("finish", "", "stop")])
    let requests = ArrayList<String>()
    let next: (String) -> Provider = { body => requests.add(body); final }
    let result = ModelAgentLoop().run(first, next, "test-model", TurnToken(), log, DeliveryQueue(32), false, toolRuntime: runtime)
    @Expect(result.settledToolCalls, Int64(1))
    // 成功的诊断不算工作进展，于是不独立推进 GoalEvidence
    @Expect(result.successfulToolCalls, Int64(0))
    @Expect(requests.size == 1, true)
    @Expect(requests[0].contains("no-such-symbol"), true)
    removeIfExists(root, recursive: true)
}

@Test
func lspRenamePreviewDoesNotAdvanceGoalEvidence() {
    let root = lspWorkspace("model-rename")
    let router = LspRouter()
    let server = ContractServer()
    server.mode = "edits"
    server.secondPath = "other.ts"
    lspBind(server, router, root, ["ts"])
    let before = sha256Hex(File.readFrom("${root}/sample.ts"))
    let log = SessionLog("lsp-model-rename-unused.log")
    log.append("user/message", "preview rename")
    let runtime = ModelToolRuntime(log, false, files: true, workingDirectory: root,
        lspRouter: router, lspSession: "s1")
    let first = AgentChunks([
        Chunk("tool-call-delta", "{\"path\":\"sample.ts\",\"line\":0,\"character\":9,\"newName\":\"gamma\"}", "", toolIndex: Some(0), toolId: Some("call-rename"), toolName: Some("lsp_rename")),
        Chunk("finish", "", "tool_calls")])
    let final = AgentChunks([Chunk("text", "preview ready", ""), Chunk("finish", "", "stop")])
    let next: (String) -> Provider = { _ => final }
    let result = ModelAgentLoop().run(first, next, "test-model", TurnToken(), log, DeliveryQueue(32), false, toolRuntime: runtime)
    @Expect(result.settledToolCalls, Int64(1))
    @Expect(result.successfulToolCalls, Int64(0))
    @Expect(sha256Hex(File.readFrom("${root}/sample.ts")), before)
    removeIfExists(root, recursive: true)
}

@Test
func lspStructuredFailureReachesTheModelAsAnObjectNotAnEscapedString() {
    let root = lspWorkspace("model-fail")
    let log = SessionLog("lsp-model-fail-unused.log")
    log.append("user/message", "where is the definition")
    let runtime = ModelToolRuntime(log, false, files: true, workingDirectory: root,
        lspRouter: LspRouter(scanner: CountingScanner()), lspSession: "s1")
    let first = AgentChunks([
        Chunk("tool-call-delta", "{\"path\":\"sample.ts\",\"line\":0,\"character\":9}", "", toolIndex: Some(0), toolId: Some("call-look"), toolName: Some("lsp_lookup")),
        Chunk("finish", "", "tool_calls")])
    let final = AgentChunks([Chunk("text", "ok", ""), Chunk("finish", "", "stop")])
    let requests = ArrayList<String>()
    let next: (String) -> Provider = { body => requests.add(body); final }
    let result = ModelAgentLoop().run(first, next, "test-model", TurnToken(), log, DeliveryQueue(32), false, toolRuntime: runtime)
    @Expect(result.settledToolCalls, Int64(1))
    @Expect(result.successfulToolCalls, Int64(0))
    let body = JsonValue.fromStr(requests[0]).asObject()
    let messages = body.get("messages").getOrThrow().asArray()
    var content = ""
    var index: Int64 = 0
    while (let Some(value) <- messages.get(index)) {
        let obj = value.asObject()
        if (obj.get("role").getOrThrow().asString().getValue() == "tool") {
            content = obj.get("content").getOrThrow().asString().getValue()
        }
        index += 1
    }
    // 工具内容本身还是一个对象；不是 {"error":"..."} 那种被二次转义的字符串
    let inner = JsonValue.fromStr(content).asObject()
    @Expect(inner.get("reason").getOrThrow().asString().getValue(), lspFailNoServer)
    @Expect(inner.get("nonSemantic").getOrThrow().asBool().getValue(), true)
    @Expect(inner.get("error").isSome(), false)
}

// ---------- 旧入口兼容 ----------

@Test
func legacyLspExecutorStillServesManualCalls() {
    let root = lspWorkspace("legacy")
    let reg = ToolRegistry()
    reg.register(ToolSpec("lsp", "从文件中提取符号",
        "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"path\"],\"properties\":{\"path\":{\"type\":\"string\"}}}", false))
    let log = SessionLog("lsp-legacy-unused.log")
    let rt = ToolRuntime(log, reg, workingDirectory: root, lspSession: "s1")
    let out = rt.execute("lsp", "{\"path\":\"sample.ts\"}", "", true)
    @Expect(out.allowed, true)
    @Expect(out.why.contains("function:alpha"), true)
    // 旧的 lsp 只认 path 一个键
    @Expect(rt.execute("lsp", "{\"path\":\"sample.ts\",\"verb\":\"define\"}", "", true).why, "bad-args")
    removeIfExists(root, recursive: true)
}

@Test
func lspManualEntryWithoutSessionFallsBackToProcessWorkspace() {
    // CLI 的 call/tool 手工面既不绑会话身份也不传工作目录（apps/cli/src/main.cj 就是
    // ToolRuntime(log, reg)）。这一条钉住那类入口仍然接得上：请求必须走到路由并落
    // lsp-no-server，而不是带着空 sessionId 停在 lsp-bad-args——那等于该入口的 7 条工具
    // 只有声明面没有执行面。工作区身份在这里退回进程当前目录，仍是真实边界。
    let reg = ToolRegistry()
    for (verb in lspVerbNames()) {
        reg.register(ToolSpec(lspToolName(verb), lspToolDescription(verb), lspToolSchema(verb), false))
    }
    let log = SessionLog("lsp-manual-no-session-unused.log")
    let rt = ToolRuntime(log, reg, lspRouter: LspRouter())
    let out = rt.execute("lsp_define", "{\"path\":\"lsp-l1-manual-absent.ts\",\"line\":0,\"character\":0}", "", true)
    @Expect(out.allowed, false)
    @Expect(out.structured, true)
    @Expect(lspJsonIsObject(out.why), true)
    @Expect(out.why.contains(lspFailNoServer), true)
    @Expect(out.why.contains(lspFailBadArgs), false)
    // 会话身份不是空串：请求确实带着身份进了路由
    @Expect(out.why.contains("\"sessionId\":\"\""), false)
    // 同一条通道上，坏参数仍然是坏参数——兜底不放行非法负载
    let bad = rt.execute("lsp_define", "{\"path\":\"\",\"line\":0,\"character\":0}", "", true)
    @Expect(bad.why.contains(lspFailBadArgs), true)
}

@Test
func lspSharedRouterDefaultsToNoServerAndIsOneInstancePerProcess() {
    let router = LspRouters.sharedRouter()
    let root = lspWorkspace("shared")
    // L1 的装配面是空的：不注入插件时，共享 router 上任何扩展名都拿不到服务器。
    // 这条同时钉住「Host 默认无服务器」与「两个入口取到的是同一个实例」。
    @Expect(router.route(lspReq(root, "define", "sample.lsp1")).reason, lspFailNoServer)
    let server = ContractServer()
    let result = router.register(server, ["lsp1"])
    @Expect(result.ok, true)
    @Expect(LspRouters.sharedRouter().route(lspReq(root, "define", "sample.lsp1")).serverId, "fixture-server")
    @Expect(router.route(lspReq(root, "define", "sample.lsp1")).serverId, "fixture-server")
    router.unregister(result.registrationId)
    @Expect(LspRouters.sharedRouter().route(lspReq(root, "define", "sample.lsp1")).reason, lspFailNoServer)
    removeIfExists(root, recursive: true)
}
