package core

import std.collection.*
import std.fs.*
import std.sort.*
import std.sync.*
import stdx.encoding.json.*

public struct SecurityScanFile {
    public let path: String
    public let digest: String
    public init(path: String, digest: String) {
        this.path = securityScanRelative(path)
        if (!securityScanDigest(digest)) {
            throw Exception("scan-bad-digest")
        }
        this.digest = digest
    }
}

struct SecurityScanToken {
    let text: String
    let kind: String
    let start: Int64
    let end: Int64
    let line: Int64
    let column: Int64
    init(text: String, kind: String, start: Int64, end: Int64, line: Int64, column: Int64) {
        this.text = text
        this.kind = kind
        this.start = start
        this.end = end
        this.line = line
        this.column = column
    }
}

struct SecurityScanMatch {
    let rule: String
    let token: SecurityScanToken
    let fixStart: Int64
    let fixEnd: Int64
    init(rule: String, token: SecurityScanToken, fixStart!: Int64 = -1, fixEnd!: Int64 = -1) {
        this.rule = rule
        this.token = token
        this.fixStart = fixStart
        this.fixEnd = fixEnd
    }
}

class SecurityScanRun {
    let scope: Array<SecurityScanFile>
    let findings: Array<SecurityScanFinding>
    let report: String
    let phase: String
    init(scope: Array<SecurityScanFile>, findings: Array<SecurityScanFinding>, report: String, phase: String) {
        this.scope = scope
        this.findings = findings
        this.report = report
        this.phase = phase
    }
}

struct SecurityScanFinding {
    let id: String
    let path: String
    let digest: String
    let matchResult: SecurityScanMatch
    init(path: String, digest: String, result: SecurityScanMatch) {
        this.path = path
        this.digest = digest
        this.matchResult = result
        let binding = JsonArray()
        binding.add(JsonString(result.rule));
        binding.add(JsonString(path));
        binding.add(JsonString(digest))
        binding.add(JsonInt(result.token.start))
        id = "finding-" + sha256Hex(binding.toString().toArray())
    }
    func json(): JsonObject {
        let out = JsonObject()
        out.put("findingId", JsonString(id));
        out.put("path", JsonString(path));
        out.put("digest", JsonString(digest))
        out.put("ruleId", JsonString(matchResult.rule))
        let rule = securityScanRule(matchResult.rule)
        out.put("severity", rule.get("severity").getOrThrow())
        out.put("message", rule.get("message").getOrThrow())
        out.put("cwe", rule.get("cwe").getOrThrow())
        out.put("startLine", JsonInt(matchResult.token.line));
        out.put("endLine", JsonInt(matchResult.token.line))
        out.put("startCol", JsonInt(matchResult.token.column));
        out.put("columnKind", JsonString("utf8-byte"))
        out.put("layer", JsonString("static"));
        out.put("evidenceKind", JsonString("single-file-pattern"))
        out.put("autoFix", JsonBool(matchResult.fixStart >= 0))
        out.put("fixKind", JsonString(if (matchResult.fixStart >= 0) {
            "local-edit"
        } else {
            "none"
        }))
        out.put("evidenceRedacted", JsonBool(true))
        return out
    }
}

// 只读、同步、进程内规则引擎。显式 path+digest 必须由调用方绑定本轮写回成功集合；
// 不推导全仓范围，不执行源码，不上传，不自称 AST、污点分析或漏洞证明。
public class SecurityScan {
    let state: SessionWorkspace
    let workspace: String
    let identity: FileInfo
    let workspaceRevision: Int64
    let sessionId: String
    let maxFileBytes: Int64
    let maxTotalBytes: Int64
    let maxFindings: Int64
    let mutex = Mutex()
    let runs = HashMap<String, SecurityScanRun>()
    let requests = HashMap<String, String>()
    public init(state: SessionWorkspace, sessionId: String, maxFileBytes!: Int64 = 1048576,
        maxTotalBytes!: Int64 = 16777216, maxFindings!: Int64 = 10000) {
        if (!state.available() || state.directory().size == 0 || sessionId.trimAscii().size == 0 || sessionId.size > 128 ||
            maxFileBytes < 1 || maxFileBytes > 1048576 || maxTotalBytes < 1 || maxTotalBytes > 16777216 || maxFindings <
            1 || maxFindings > 10000) {
            throw Exception("scan-bad-arguments")
        }
        this.state = state
        this.sessionId = sessionId
        workspace = canonicalize(state.directory()).toString()
        identity = FileInfo(workspace)
        workspaceRevision = state.revision()
        this.maxFileBytes = maxFileBytes
        this.maxTotalBytes = maxTotalBytes
        this.maxFindings = maxFindings
    }

    public func describe(): String {
        let out = JsonObject()
        out.put("engineId", JsonString("core-builtin-static"));
        out.put("engineVersion", JsonString("1"))
        out.put("rulePackId", JsonString("core-security-baseline"));
        out.put("rulePackVersion", JsonString("1"))
        out.put("static", JsonBool(true));
        out.put("incremental", JsonBool(false));
        out.put("deep", JsonBool(false))
        out.put("interproceduralDataflow", JsonBool(false));
        out.put("upload", JsonBool(false))
        out.put("analysisKind", JsonString("single-file-pattern"))
        out.put("languages", JsonArray([JsonString("javascript"), JsonString("typescript")]))
        out.put("limitations",
            JsonString(
                "启发式规则可能误报或漏报；不解析完整语法，不跟踪别名、净化器或跨函数数据流；零发现不代表无漏洞。"))
        let rules = JsonArray()
        for (id in securityScanRuleIds()) {
            rules.add(securityScanRule(id))
        }
        out.put("rules", rules)
        return out.toString()
    }

    func checkWorkspace(): Unit {
        if (!state.available() || state.revision() != workspaceRevision || canonicalize(state.directory()).toString() !=
            workspace || FileInfo(workspace) != identity) {
            throw Exception("scan-workspace-changed")
        }
    }

    public func run(scope: Array<SecurityScanFile>, requestId: String, layer!: String = "static",
        trigger!: String = "manual", token!: TurnToken = TurnToken()): String {
        synchronized(mutex) {
            checkWorkspace()
            if (layer != "static") {
                throw Exception("scan-engine-unavailable")
            }
            if (!["manual", "cli", "auto-turn", "auto-apply"].contains(trigger) || requestId.trimAscii().size == 0 ||
                requestId.size > 128 || scope.size > 10000) {
                throw Exception("scan-bad-arguments")
            }
            let paths = ArrayList<String>()
            let byPath = HashMap<String, SecurityScanFile>()
            let seen = HashSet<String>()
            for (item in scope) {
                if (!seen.add(normalizeWriterPath(Path(item.path)))) {
                    throw Exception("scan-duplicate-path")
                }
                paths.add(item.path);
                byPath[item.path] = item
            }
            let names = paths.toArray();
            sort(names)
            let frozen = ArrayList<SecurityScanFile>()
            let files = JsonArray()
            for (name in names) {
                let item = byPath[name];
                frozen.add(item)
                let row = JsonObject();
                row.put("path", JsonString(name));
                row.put("digest", JsonString(item.digest));
                files.add(row)
            }
            let binding = JsonObject()
            binding.put("sessionId", JsonString(sessionId));
            binding.put("workspace", JsonString(workspace))
            binding.put("workspaceRevision", JsonInt(workspaceRevision));
            binding.put("engineVersion", JsonString("1"))
            binding.put("files", files);
            binding.put("trigger", JsonString(trigger));
            binding.put("requestId", JsonString(requestId))
            let scanId = "scan-" + sha256Hex(binding.toString().toArray())
            if (let Some(previous) <- requests.get(requestId)) {
                if (previous != scanId) {
                    throw Exception("scan-request-conflict")
                }
                return runs[scanId].report
            }
            if (runs.size >= 16) {
                throw Exception("scan-history-capacity")
            }
            let excluded = JsonArray();
            let unanalyzed = JsonArray();
            let unfinished = JsonArray()
            let found = ArrayList<SecurityScanFinding>()
            var scanned: Int64 = 0;
            var readBytes: Int64 = 0;
            var scannedBytes: Int64 = 0
            var cancelled = false;
            var limited = false
            for (file in frozen) {
                if (token.cancelled()) {
                    cancelled = true
                }
                if (cancelled || limited) {
                    securityScanReason(unfinished, file.path, if (cancelled) {
                        "cancelled"
                    } else {
                        "capacity"
                    })
                    continue
                }
                if (securityScanExcluded(file.path)) {
                    securityScanReason(excluded, file.path, "excluded");
                    continue
                }
                if (!securityScanSupported(file.path)) {
                    securityScanReason(unanalyzed, file.path, "unsupported-language");
                    continue
                }
                var readCompleted = false
                try {
                    let text = read(file.path, maxTotalBytes - readBytes, token)
                    readBytes += text.size
                    readCompleted = true
                    if (sha256Hex(text.toArray()) != file.digest) {
                        securityScanReason(unanalyzed, file.path, "digest-mismatch");
                        continue
                    }
                    let matches = securityScanAnalyze(text, token)
                    if (found.size + matches.size > maxFindings) {
                        securityScanReason(unanalyzed, file.path, "finding-limit");
                        limited = true
                        continue
                    }
                    var sensitive = false
                    for (item in matches) {
                        if (item.rule == "credential.literal") {
                            sensitive = true
                        }
                    }
                    for (item in matches) {
                        let result = if (securityScanFixExcluded(file.path) || sensitive) {
                            SecurityScanMatch(item.rule, item.token)
                        } else {
                            item
                        }
                        found.add(SecurityScanFinding(file.path, file.digest, result))
                    }
                    scanned += 1
                    scannedBytes += text.size
                } catch (e: Exception) {
                    // 解码失败等读取也消耗预算；失败前读了多少未知时按单文件上限保守计费。
                    if (!readCompleted) {
                        let remaining = maxTotalBytes - readBytes
                        readBytes += if (remaining < maxFileBytes) {
                            remaining
                        } else {
                            maxFileBytes
                        }
                    }
                    if (token.cancelled()) {
                        cancelled = true
                        securityScanReason(unfinished, file.path, "cancelled")
                    } else {
                        securityScanReason(unanalyzed, file.path, "unreadable-oversize-or-unsupported-syntax")
                    }
                }
            }
            checkWorkspace()
            if (token.cancelled()) {
                cancelled = true
            }
            let phase = if (cancelled) {
                "cancelled"
            } else if (unanalyzed.size() > 0 || unfinished.size() > 0 || excluded.size() > 0) {
                "partial"
            } else {
                "succeeded"
            }
            let out = JsonValue.fromStr(describe()).asObject()
            out.put("version", JsonInt(1));
            out.put("scanId", JsonString(scanId));
            out.put("sessionId", JsonString(sessionId))
            out.put("projectId", JsonString(sha256Hex(workspace.toArray())));
            out.put("requestId", JsonString(requestId))
            out.put("workspaceRevision", JsonInt(workspaceRevision));
            out.put("layer", JsonString("static"))
            out.put("trigger", JsonString(trigger));
            out.put("destination", JsonString("local"))
            out.put("phase", JsonString(phase));
            out.put("executionStatus", JsonString(phase));
            out.put("freshness", JsonString("snapshot"))
            out.put("files", files);
            out.put("excluded", excluded);
            out.put("unanalyzed", unanalyzed);
            out.put("unfinished", unfinished)
            out.put("normalization", JsonString(if (phase == "succeeded") {
                "valid"
            } else {
                "partial"
            }))
            let coverage = JsonObject();
            coverage.put("filesInScope", JsonInt(frozen.size));
            coverage.put("filesScanned", JsonInt(scanned))
            coverage.put("bytes", JsonInt(scannedBytes));
            out.put("coverage", coverage)
            let findings = JsonArray()
            for (finding in found) {
                findings.add(finding.json())
            }
            out.put("findings", findings);
            out.put("summary", securityScanSummary(found));
            out.put("issues", JsonArray())
            let report = out.toString()
            if (report.size > 16777216) {
                throw Exception("scan-report-capacity")
            }
            runs[scanId] = SecurityScanRun(frozen.toArray(), found.toArray(), report, phase)
            requests[requestId] = scanId
            return report
        }
    }

    // 报告是扫描时快照，不修改旧报告；范围内任一文件改变/删除则整份过期。
    public func freshness(scanId: String, token!: TurnToken = TurnToken()): String {
        synchronized(mutex) {
            return freshnessLocked(runFor(scanId), token)
        }
    }
    func runFor(scanId: String): SecurityScanRun {
        return runs.get(scanId).getOrThrow()
    }
    func freshnessLocked(run: SecurityScanRun, token: TurnToken): String {
        checkWorkspace()
        if (run.phase != "succeeded") {
            return "unverified"
        }
        var total: Int64 = 0
        for (file in run.scope) {
            if (token.cancelled()) {
                throw Exception("scan-cancelled")
            }
            try {
                let text = read(file.path, maxTotalBytes - total, token);
                total += text.size
                if (sha256Hex(text.toArray()) != file.digest) {
                    return "stale"
                }
            } catch (e: Exception) {
                if (token.cancelled()) {
                    throw e
                }
                return "stale"
            }
        }
        checkWorkspace()
        return "current"
    }

    public func fixDraft(scanId: String, findingIds: Array<String>, token!: TurnToken = TurnToken()): String {
        synchronized(mutex) {
            return draftLocked(runFor(scanId), findingIds, token).toString()
        }
    }
    func draftLocked(run: SecurityScanRun, ids: Array<String>, token: TurnToken): JsonObject {
        if (run.phase != "succeeded" || ids.size < 1 || ids.size > 128) {
            throw Exception("scan-fix-not-eligible")
        }
        if (freshnessLocked(run, token) != "current") {
            throw Exception("scan-report-stale")
        }
        let selected = ArrayList<SecurityScanFinding>();
        let seen = HashSet<String>()
        var path = "";
        var digest = ""
        for (id in ids) {
            if (!seen.add(id)) {
                throw Exception("scan-duplicate-finding")
            }
            var matched = false
            for (finding in run.findings) {
                if (finding.id != id) {
                    continue
                }
                if (finding.matchResult.fixStart < 0 || (path.size > 0 && path != finding.path)) {
                    throw Exception("scan-fix-not-eligible")
                }
                path = finding.path
                digest = finding.digest
                matched = true
                selected.add(finding);
                break
            }
            if (!matched) {
                throw Exception("scan-finding-not-found")
            }
        }
        for (finding in run.findings) {
            if (finding.path == path && finding.matchResult.rule == "credential.literal") {
                throw Exception("scan-fix-sensitive-source")
            }
        }
        let before = read(path, maxTotalBytes, token)
        if (sha256Hex(before.toArray()) != digest) {
            throw Exception("scan-report-stale")
        }
        let edits = selected.toArray();
        sort(edits, key: {item => item.matchResult.fixStart})
        var after = "";
        var cursor: Int64 = 0
        for (finding in edits) {
            let edit = finding.matchResult
            if (edit.fixStart < cursor || before[edit.fixStart..edit.fixEnd] != "true") {
                throw Exception("scan-fix-conflict")
            }
            after += before[cursor..edit.fixStart] + "false"
            cursor = edit.fixEnd
        }
        after += before[cursor..before.size]
        if (before.size > 65536 || after.size > 65536 || securityScanFixExcluded(path)) {
            throw Exception("scan-fix-high-impact")
        }
        let out = JsonObject()
        out.put("kind", JsonString("local-edit"));
        out.put("impact", JsonString("local"));
        out.put("path", JsonString(path))
        out.put("expectedDigest", JsonString(digest));
        out.put("afterDigest", JsonString(sha256Hex(after.toArray())))
        out.put("diff", JsonString(securityScanDiff(path, before, after)));
        out.put("replacement", JsonString(after))
        out.put("requiresApproval", JsonBool(true));
        out.put("applyMethod", JsonString("execution/review-apply"))
        out.put("status", JsonString("draft-not-applied"))
        out.put("sensitive", JsonBool(true))
        out.put("loggingPolicy", JsonString("do-not-log-source-or-diff"))
        return out
    }

    // 既有 review-prepare 不接任意 diff；必须先有承载恰好该修复的执行审查记录。
    // 不伪造 exited 执行或 review 事件，也不写源码；无记录时 fail closed，交由调用方走既有执行工作区。
    public func prepareFixReview(scanId: String, findingIds: Array<String>, service: ExecutionService,
        store: AttachmentStore, desk: ApprovalDesk, executionId: String, revision: Int64, requestId: String): String {
        synchronized(mutex) {
            let draft = draftLocked(runFor(scanId), findingIds, TurnToken())
            if (service.sessionId != sessionId || service.log.path != state.log.path) {
                throw Exception("scan-session-mismatch")
            }
            let execution = service.describe(executionId)
            if (execution.revision != revision) {
                throw Exception("revision-conflict")
            }
            let review = JsonValue.fromStr(service.review(executionId)).asObject()
            if (canonicalize(review.get("sourceDirectory").getOrThrow().asString().getValue()).toString() != workspace ||
                SessionWorkspace(service.log).revision() != workspaceRevision) {
                throw Exception("scan-workspace-changed")
            }
            let path = draft.get("path").getOrThrow().asString().getValue()
            let rows = review.get("files").getOrThrow().asArray()
            var matched = false
            for (i in 0..rows.size()) {
                let row = rows.get(i).getOrThrow().asObject()
                if (row.get("path").getOrThrow().asString().getValue() != path) {
                    continue
                }
                if (row.get("kind").getOrThrow().asString().getValue() != "modified") {
                    throw Exception("scan-fix-review-mismatch")
                }
                if (matched || row.get("beforeDigest").getOrThrow().asString().getValue() !=
                    draft.get("expectedDigest").getOrThrow().asString().getValue() ||
                    row.get("afterDigest").getOrThrow().asString().getValue() !=
                    draft.get("afterDigest").getOrThrow().asString().getValue()) {
                    throw Exception("scan-fix-review-mismatch")
                }
                for (side in ["before", "after"]) {
                    let digest = row.get(side + "Digest").getOrThrow().asString().getValue()
                    let objectId = row.get(side + "Object").getOrThrow().asString().getValue()
                    if (objectId != "sha256:" + digest || sha256Hex(store.read(objectId)) != digest) {
                        throw Exception("scan-fix-review-mismatch")
                    }
                }
                matched = true
            }
            if (!matched) {
                throw Exception("scan-fix-review-missing")
            }
            if (freshnessLocked(runFor(scanId), TurnToken()) != "current") {
                throw Exception("scan-report-stale")
            }
            let args = JsonObject();
            args.put("sessionId", JsonString(sessionId));
            args.put("executionId", JsonString(executionId))
            args.put("revision", JsonInt(revision));
            args.put("requestId", JsonString(requestId))
            args.put("paths", JsonArray([JsonString(path)]))
            return ExecutionReviewApi(service, store, desk, sessionId).dispatch("execution/review-prepare",
                args.toString())
        }
    }

    func read(relative: String, remaining: Int64, token: TurnToken): String {
        checkWorkspace()
        let path = securityScanSource(workspace, relative)
        let before = FileInfo(path)
        if (!before.isRegular() || before.size > maxFileBytes || before.size > remaining || remaining < 0) {
            throw Exception("scan-file-capacity")
        }
        let file = File(path, OpenMode.Read)
        try {
            if (file.info != before) {
                throw Exception("scan-file-changed")
            }
            let data = ArrayList<Byte>();
            let buffer = Array<Byte>(4096, repeat: 0)
            while (true) {
                if (token.cancelled()) {
                    throw Exception("scan-cancelled")
                }
                let count = file.read(buffer)
                if (count <= 0) {
                    break
                }
                if (data.size + count > maxFileBytes || data.size + count > remaining) {
                    throw Exception("scan-file-capacity")
                }
                for (i in 0..count) {
                    data.add(buffer[i])
                }
            }
            if (securityScanSource(workspace, relative) != path || FileInfo(path) != file.info) {
                throw Exception("scan-file-changed")
            }
            checkWorkspace()
            let text = String.fromUtf8(data.toArray())
            if (text.contains("\u{0}")) {
                throw Exception("scan-binary")
            }
            return text
        } finally {
            file.close()
        }
    }
}

func securityScanRuleIds(): Array<String> {
    return ["credential.literal", "injection.eval", "injection.shell", "injection.sql", "injection.html",
        "path.traversal"]
}

func securityScanRule(id: String): JsonObject {
    let out = JsonObject();
    out.put("ruleId", JsonString(id))
    var severity = "warning";
    var message = "";
    var cwe = ""
    match (id) {
        case "credential.literal" =>
            severity = "error"
            cwe = "CWE-798"
            message = "疑似硬编码凭据字面量；内容已隐藏，请移至受控秘密存储并评估轮换。"
        case "injection.eval" =>
            severity = "error"
            cwe = "CWE-95"
            message = "动态代码执行模式；未证明输入来源，需人工核实。"
        case "injection.shell" =>
            severity = "error"
            cwe = "CWE-78"
            message = "命令字符串或 shell:true 模式；需核实命令边界与参数。"
        case "injection.sql" =>
            cwe = "CWE-89"
            message = "SQL 调用中出现拼接或动态模板；优先使用参数化查询。"
        case "injection.html" =>
            cwe = "CWE-79"
            message = "HTML sink 接收非固定字面量；需验证编码或净化。"
        case "path.traversal" =>
            cwe = "CWE-22"
            message = "文件路径参数含请求字段或遍历拼接模式；需核实规范化后的目录边界。"
        case _ => throw Exception("scan-unknown-rule")
    }
    out.put("severity", JsonString(severity));
    out.put("message", JsonString(message));
    out.put("cwe", JsonString(cwe))
    out.put("autoFix", JsonBool(id == "injection.shell"));
    out.put("fixKind", JsonString(if (id == "injection.shell") {
        "local-edit"
    } else {
        "none"
    }))
    return out
}

func securityScanRelative(raw: String): String {
    let path = raw.replace("\\", "/")
    if (path.size < 1 || path.size > 1024 || path.startsWith("/") || path.contains(":")) {
        throw Exception("scan-bad-path")
    }
    for (byte in path.toArray()) {
        if (byte < 32 || byte == 127) {
            throw Exception("scan-bad-path")
        }
    }
    for (part in path.split("/", removeEmpty: false)) {
        if (part.size == 0 || part == "." || part == ".." || part.endsWith(".") || part.endsWith(" ")) {
            throw Exception("scan-bad-path")
        }
    }
    return path
}

func securityScanDigest(digest: String): Bool {
    if (digest.size != 64) {
        return false
    }
    for (b in digest.toArray()) {
        if (!((b >= 48 && b <= 57) || (b >= 97 && b <= 102))) {
            return false
        }
    }
    return true
}

func securityScanSource(root: String, relative: String): String {
    var path = Path(root)
    for (part in securityScanRelative(relative).split("/")) {
        path = path.join(part)
        if (FileInfo(path).isSymbolicLink() || normalizeWriterPath(canonicalize(path)) != normalizeWriterPath(path)) {
            throw Exception("scan-linked-path")
        }
    }
    if (!lspPathInsideWorkspace(path.toString(), root)) {
        throw Exception("scan-outside-workspace")
    }
    return canonicalize(path).toString()
}

func securityScanExcluded(path: String): Bool {
    for (part in path.toAsciiLower().split("/")) {
        if ([".git", "node_modules", "target", ".ssh", ".aws", ".venv"].contains(part) || part.startsWith(".env") ||
            part.endsWith(".pem") || part.endsWith(".key")) {
            return true
        }
    }
    return false
}

func securityScanSupported(path: String): Bool {
    return ["js", "jsx", "ts", "tsx", "mjs", "cjs"].contains(lspExtensionOf(path))
}

func securityScanFixExcluded(path: String): Bool {
    for (part in path.toAsciiLower().split("/")) {
        if (["test", "tests", "__tests__", "fixtures"].contains(part) || part.contains(".test.") || part.contains(
            ".spec.") || part.contains("auth") || part.contains("crypto")) {
            return true
        }
    }
    return false
}

func securityScanReason(out: JsonArray, path: String, reason: String): Unit {
    let row = JsonObject();
    row.put("path", JsonString(path));
    row.put("reason", JsonString(reason));
    out.add(row)
}

func securityScanSummary(findings: ArrayList<SecurityScanFinding>): JsonArray {
    let out = JsonArray();
    let counts = HashMap<String, JsonObject>();
    let order = ArrayList<String>()
    for (finding in findings) {
        let key = finding.path + ":" + finding.matchResult.rule
        if (!counts.contains(key)) {
            let row = JsonObject();
            row.put("path", JsonString(finding.path));
            row.put("ruleId", JsonString(finding.matchResult.rule))
            row.put("severity", securityScanRule(finding.matchResult.rule).get("severity").getOrThrow());
            row.put("count", JsonInt(0))
            counts[key] = row
            order.add(key)
        }
        let row = counts[key];
        row.put("count", JsonInt(row.get("count").getOrThrow().asInt().getValue() + 1))
    }
    for (key in order) {
        out.add(counts[key])
    }
    return out
}

func securityScanWord(b: Byte): Bool {
    return (b >= 65 && b <= 90) || (b >= 97 && b <= 122) || (b >= 48 && b <= 57) || b == 95 || b == 36
}
// 字节偏移用于精确局部改动。注释/字符串中的伪调用不会进入可执行 token 流。
// JSX、正则字面量等非覆盖语法 fail closed 为 unanalyzed，不把不完整 token 流当扫描完成。
func securityScanTokens(text: String, token: TurnToken): ArrayList<SecurityScanToken> {
    let bytes = text.toArray();
    let out = ArrayList<SecurityScanToken>()
    var i: Int64 = 0;
    var line: Int64 = 1;
    var col: Int64 = 1
    while (i < bytes.size) {
        if (i % 1024 == 0 && token.cancelled()) {
            throw Exception("scan-cancelled")
        }
        let b = bytes[i];
        let next = if (i + 1 < bytes.size) {
            bytes[i + 1]
        } else {
            0u8
        }
        if (b == 10) {
            line += 1
            col = 1
            i += 1
            continue
        }
        if (b == 32 || b == 9 || b == 13) {
            i += 1
            col += 1
            continue
        }
        if (b == 47 && (next == 47 || next == 42)) {
            let block = next == 42;
            i += 2
            col += 2
            var closed = !block
            while (i < bytes.size) {
                if (i % 1024 == 0 && token.cancelled()) {
                    throw Exception("scan-cancelled")
                }
                if (!block && bytes[i] == 10) {
                    break
                }
                if (block && i + 1 < bytes.size && bytes[i] == 42 && bytes[i + 1] == 47) {
                    i += 2
                    col += 2
                    closed = true
                    break
                }
                if (bytes[i] == 10) {
                    line += 1
                    col = 0
                }
                i += 1
                col += 1
            }
            if (!closed) {
                throw Exception("scan-unterminated-comment")
            }
            continue
        }
        let start = i;
        let startLine = line;
        let startCol = col
        if (b == 34 || b == 39 || b == 96) {
            i += 1
            col += 1
            var closed = false;
            var dynamic = false
            while (i < bytes.size) {
                if (i % 1024 == 0 && token.cancelled()) {
                    throw Exception("scan-cancelled")
                }
                if (bytes[i] == b) {
                    i += 1
                    col += 1
                    closed = true
                    break
                }
                if (bytes[i] == 92 && i + 1 < bytes.size) {
                    if (bytes[i + 1] == 10) {
                        line += 1
                        col = 0
                    }
                    i += 2
                    col += 2
                    continue
                }
                if (b == 96 && bytes[i] == 36 && i + 1 < bytes.size && bytes[i + 1] == 123) {
                    dynamic = true
                }
                if (bytes[i] == 10) {
                    if (b != 96) {
                        throw Exception("scan-unterminated-string")
                    }
                    line += 1
                    col = 0
                }
                i += 1
                col += 1
            }
            if (!closed) {
                throw Exception("scan-unterminated-string")
            }
            out.add(SecurityScanToken(text[start + 1..i - 1], if (dynamic) {
                "template"
            } else {
                "literal"
            }, start, i, startLine, startCol))
        } else if (securityScanWord(b)) {
            while (i < bytes.size && securityScanWord(bytes[i])) {
                i += 1
                col += 1
            }
            out.add(SecurityScanToken(text[start..i], "word", start, i, startLine, startCol))
        } else {
            if (b == 47 || b == 60) {
                throw Exception("scan-unsupported-syntax")
            }
            out.add(SecurityScanToken(text[i..i + 1], "punct", i, i + 1, line, col));
            i += 1
            col += 1
        }
        if (out.size > 65536) {
            throw Exception("scan-token-capacity")
        }
    }
    return out
}

// 返回实参 token 区间；不解析/执行表达式。嵌套与范围均有界。
func securityScanArguments(tokens: ArrayList<SecurityScanToken>, open: Int64): Array<(Int64, Int64)> {
    let args = ArrayList<(Int64, Int64)>();
    let stack = ArrayList<String>()
    var begin = open + 1;
    var i = begin
    while (i < tokens.size && i - open <= 4096) {
        let item = tokens[i]
        if (item.kind == "punct") {
            if (["(", "[", "{"].contains(item.text)) {
                stack.add(item.text)
            } else if ([")", "]", "}"].contains(item.text)) {
                if (stack.size == 0) {
                    if (item.text != ")") {
                        throw Exception("scan-unbalanced-call")
                    }
                    if (i > begin) {
                        args.add((begin, i))
                    }
                    break
                }
                let previous = stack.remove(at: stack.size - 1)
                if (!((previous == "(" && item.text == ")") || (previous == "[" && item.text == "]") || (previous == "{" &&
                    item.text == "}"))) {
                    throw Exception("scan-unbalanced-call")
                }
            } else if (item.text == "," && stack.size == 0) {
                args.add((begin, i));
                begin = i + 1
            }
        }
        i += 1
    }
    if (i >= tokens.size || i - open > 4096) {
        throw Exception("scan-call-capacity-or-unclosed")
    }
    for (range in args) {
        if (range[0] >= range[1]) {
            throw Exception("scan-empty-argument")
        }
    }
    return args.toArray()
}

func securityScanDynamic(tokens: ArrayList<SecurityScanToken>, range: (Int64, Int64)): Bool {
    return range[1] - range[0] != 1 || tokens[range[0]].kind != "literal"
}

func securityScanCredential(name: String): Bool {
    let key = name.toAsciiLower().replace("_", "").replace("-", "")
    return ["password", "passwd", "pwd", "secret", "clientsecret", "apikey", "accesstoken", "authtoken", "token",
        "privatekey"].contains(key)
}

func securityScanPlaceholder(text: String): Bool {
    let value = text.toAsciiLower()
    return value.size < 4 || ["placeholder", "your-api-key", "your-token", "redacted"].contains(value) ||
        value.startsWith("\u{24}{")
}

func securityScanAutoShell(tokens: ArrayList<SecurityScanToken>, args: Array<(Int64, Int64)>, at: Int64): Bool {
    if (args.size != 3 || securityScanDynamic(tokens, args[0])) {
        return false
    }
    let command = tokens[args[0][0]].text
    if (!["node", "node.exe", "git", "git.exe", "python", "python.exe", "python3"].contains(command)) {
        return false
    }
    let argv = args[1];
    let options = args[2]
    if (argv[1] - argv[0] < 2 || tokens[argv[0]].kind != "punct" || tokens[argv[1] - 1].kind != "punct" ||
        tokens[options[0]].kind != "punct" || tokens[options[1] - 1].kind != "punct" || tokens[argv[0]].text != "[" ||
        tokens[argv[1] - 1].text != "]" || options[1] - options[0] != 5 || options[0] + 3 != at ||
        tokens[options[0]].text != "{" || tokens[options[1] - 1].text != "}") {
        return false
    }
    for (i in argv[0] + 1..argv[1] - 1) {
        if (tokens[i].kind != "literal" && !(tokens[i].kind == "punct" && tokens[i].text == ",")) {
            return false
        }
    }
    // shell 元字符/环境展开会改变程序意义，拒绝自动改写。
    for (range in [args[0], argv]) {
        for (i in range[0]..range[1]) {
            if (tokens[i].kind != "literal") {
                continue
            }
            for (b in tokens[i].text.toArray()) {
                if (![45u8, 46u8, 47u8, 58u8, 95u8].contains(b) && !securityScanWord(b)) {
                    return false
                }
                if (b == 36) {
                    return false
                }
            }
        }
    }
    return true
}

func securityScanAnalyze(text: String, token: TurnToken): ArrayList<SecurityScanMatch> {
    let tokens = securityScanTokens(text, token);
    let out = ArrayList<SecurityScanMatch>()
    var work: Int64 = 0
    for (i in 0..tokens.size) {
        if (token.cancelled()) {
            throw Exception("scan-cancelled")
        }
        let item = tokens[i]
        if (item.kind == "template" && (item.text.contains("(") || item.text.contains("`"))) {
            throw Exception("scan-template-expression-needs-parser")
        }
        if (i + 2 < tokens.size && (item.kind == "word" || item.kind == "literal") && securityScanCredential(item.text) &&
            ["=", ":"].contains(tokens[i + 1].text) && tokens[i + 2].kind == "literal" &&
            !securityScanPlaceholder(tokens[i + 2].text)) {
            out.add(SecurityScanMatch("credential.literal", item))
        }
        if (item.kind != "word") {
            continue
        }
        if (["innerHTML", "outerHTML"].contains(item.text) && i + 2 < tokens.size && tokens[i + 1].text == "=" && (tokens[i +
                2].kind != "literal" || (i + 3 < tokens.size && tokens[i + 3].text == "+"))) {
            out.add(SecurityScanMatch("injection.html", item))
        }
        if (i + 1 >= tokens.size || tokens[i + 1].kind != "punct" || tokens[i + 1].text != "(" ||
            !["eval", "Function", "exec", "execSync", "spawn", "spawnSync", "execFile", "execFileSync", "query",
            "execute", "readFile", "readFileSync", "writeFile", "writeFileSync", "createReadStream", "sendFile"]
            .contains(item.text)) {
            continue
        }
        let args = securityScanArguments(tokens, i + 1)
        if (args.size > 0) {
            work += args[args.size - 1][1] - i
            if (work > 262144) {
                throw Exception("scan-analysis-capacity")
            }
        }
        if (args.size == 0) {
            continue
        }
        if (["eval", "Function"].contains(item.text) && securityScanDynamic(tokens, args[args.size - 1])) {
            out.add(SecurityScanMatch("injection.eval", item))
        } else if (["exec", "execSync"].contains(item.text) && securityScanDynamic(tokens, args[0])) {
            out.add(SecurityScanMatch("injection.shell", item))
        } else if (["spawn", "spawnSync", "execFile", "execFileSync"].contains(item.text)) {
            var reported = false
            for (a in args) {
                for (j in a[0]..a[1]) {
                    if (j + 2 < a[1] && tokens[j].text == "shell" && tokens[j + 1].text == ":" && tokens[j + 2].text ==
                        "true" && tokens[j + 2].kind == "word" && !reported) {
                        let fix = securityScanAutoShell(tokens, args, j + 2)
                        out.add(
                            SecurityScanMatch("injection.shell", item, fixStart: if (fix) {
                                tokens[j + 2].start
                            } else {
                                -1
                            }, fixEnd: if (fix) {
                                tokens[j + 2].end
                            } else {
                                -1
                            }));
                        reported = true
                    }
                }
            }
        } else if (["query", "execute"].contains(item.text)) {
            let first = args[0];
            var sql = false;
            var joined = false
            for (j in first[0]..first[1]) {
                let value = tokens[j]
                if (value.kind == "literal" || value.kind == "template") {
                    let upper = value.text.trimAscii().toAsciiUpper()
                    if (upper.startsWith("SELECT ") || upper.startsWith("INSERT ") || upper.startsWith("UPDATE ") ||
                        upper.startsWith("DELETE ") || upper.startsWith("DROP ")) {
                        sql = true
                    }
                    if (value.kind == "template") {
                        joined = true
                    }
                }
                if (value.text == "+") {
                    joined = true
                }
            }
            if (sql && joined) {
                out.add(SecurityScanMatch("injection.sql", item))
            }
        } else {
            let first = args[0];
            var request = false;
            var traversal = false
            for (j in first[0]..first[1]) {
                if (["req", "request"].contains(tokens[j].text) && j + 2 < first[1] && tokens[j + 1].text == "." &&
                    ["params", "query", "body", "url"].contains(tokens[j + 2].text)) {
                    request = true
                }
                if ((tokens[j].kind == "literal" || tokens[j].kind == "template") && (tokens[j].text.contains("../") ||
                    tokens[j].text.contains("..\\"))) {
                    traversal = true
                }
            }
            if (request || (traversal && securityScanDynamic(tokens, first))) {
                out.add(SecurityScanMatch("path.traversal", item))
            }
        }
    }
    return out
}

func securityScanDiff(path: String, before: String, after: String): String {
    if (before == after) {
        return ""
    }
    let oldLines = before.split("\n", removeEmpty: false);
    let newLines = after.split("\n", removeEmpty: false)
    let oldCount = oldLines.size - if (before.endsWith("\n")) {
        1
    } else {
        0
    }
    let newCount = newLines.size - if (after.endsWith("\n")) {
        1
    } else {
        0
    }
    var diff = "--- a/${path}\n+++ b/${path}\n@@ -1,${oldCount} +1,${newCount} @@\n"
    for (i in 0..oldCount) {
        diff += "-" + oldLines[i] + "\n"
    }
    if (!before.endsWith("\n")) {
        diff += "\\ No newline at end of file\n"
    }
    for (i in 0..newCount) {
        diff += "+" + newLines[i] + "\n"
    }
    if (!after.endsWith("\n")) {
        diff += "\\ No newline at end of file\n"
    }
    return diff
}
