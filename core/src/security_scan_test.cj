package core

import std.collection.*
import std.fs.*
import std.unittest.*
import stdx.encoding.json.*

class SecurityScanFixture {
    let root: String
    let log: SessionLog
    let workspace: SessionWorkspace
    let scanner: SecurityScan
    init(maxFileBytes!: Int64 = 1048576, maxTotalBytes!: Int64 = 16777216, maxFindings!: Int64 = 10000) {
        root = canonicalize(Directory.createTemp(Path(coreTestRoot()))).toString()
        log = SessionLog("${root}/session.log")
        workspace = SessionWorkspace(log)
        workspace.setDirectory(root)
        scanner = SecurityScan(workspace, "scan-test", maxFileBytes: maxFileBytes, maxTotalBytes: maxTotalBytes,
            maxFindings: maxFindings)
    }
    func file(path: String, text: String): SecurityScanFile {
        let parent = Path("${root}/${path}").parent
        if (!exists(parent)) {
            Directory.create(parent, recursive: true)
        }
        File.writeTo("${root}/${path}", text.toArray())
        return SecurityScanFile(path, sha256Hex(text.toArray()))
    }
    func close(): Unit {
        coreTestTidy(root)
    }
}

func securityScanTestReport(text: String): JsonObject {
    return JsonValue.fromStr(text).asObject()
}

func securityScanTestString(obj: JsonObject, key: String): String {
    return obj.get(key).getOrThrow().asString().getValue()
}

func securityScanTestCount(obj: JsonObject, key: String): Int64 {
    return obj.get(key).getOrThrow().asArray().size()
}

func securityScanTestFind(report: JsonObject, rule: String): JsonObject {
    let findings = report.get("findings").getOrThrow().asArray()
    var result = JsonObject()
    for (i in 0..findings.size()) {
        let row = findings.get(i).getOrThrow().asObject()
        if (securityScanTestString(row, "ruleId") == rule) {
            result = row
            break
        }
    }
    if (result.size() == 0) {
        throw Exception("fixture-missing-finding")
    }
    return result
}

@Test
func securityScanDetectsRulesByFileAndSeverityWithoutLeakingCredential() {
    let f = SecurityScanFixture()
    try {
        let text = "const password = 'fixture-secret-not-real';\n" +
            "eval(req.body.code);\nexec('echo ' + req.query.arg);\n" +
            "db.query('SELECT * FROM users WHERE id=' + req.query.id);\n" +
            "node.innerHTML = req.body.html;\nfs.readFile(req.query.path, callback);\n"
        let file = f.file("src/risky.ts", text)
        let reportText = f.scanner.run([file], "all-rules")
        let report = securityScanTestReport(reportText)
        @Expect(securityScanTestString(report, "phase"), "succeeded")
        @Expect(securityScanTestCount(report, "findings"), Int64(6))
        @Expect(securityScanTestCount(report, "summary"), Int64(6))
        @Expect(securityScanTestString(securityScanTestFind(report, "credential.literal"), "severity"), "error")
        @Expect(securityScanTestString(securityScanTestFind(report, "path.traversal"), "severity"), "warning")
        @Expect(securityScanTestFind(report, "injection.eval").get("startLine").getOrThrow().asInt().getValue(), Int64(2))
        @Expect(reportText.contains("fixture-secret-not-real"), false)
        @Expect(reportText.contains("SELECT * FROM users"), false)
        @Expect(report.get("passed").isNone(), true)
        @Expect(report.get("clean").isNone(), true)
        @Expect(report.get("noVulnerabilities").isNone(), true)
        @Expect(String.fromUtf8(File.readFrom("${f.root}/src/risky.ts")), text)
    } finally {
        f.close()
    }
}

@Test
func securityScanSafePatternsAndQuotedInstructionsAreNotExecutableRules() {
    let f = SecurityScanFixture()
    try {
        let text = "// eval(req.body.code); password='fixture-secret';\n" +
            "const prose = \"exec(req.query.cmd); fs.readFile(req.query.path)\";\n" +
            "const password = process.env.PASSWORD;\nconst apiKey = 'placeholder';\n" +
            "db.query('SELECT * FROM users WHERE id=?', [req.query.id]);\n" +
            "spawn('node', ['--version'], {shell: false});\n" +
            "node.textContent = req.body.html;\nnode.innerHTML = '<b>fixed</b>';\n" +
            "fs.readFile('fixed.txt', callback);\n"
        let report = securityScanTestReport(f.scanner.run([f.file("safe.js", text)], "safe"))
        @Expect(securityScanTestString(report, "phase"), "succeeded")
        @Expect(securityScanTestCount(report, "findings"), Int64(0))
        @Expect(securityScanTestString(report, "analysisKind"), "single-file-pattern")
        @Expect(report.get("limitations").getOrThrow().asString().getValue().contains("零发现不代表无漏洞"), true)
    } finally {
        f.close()
    }
}

@Test
func securityScanRejectsDeepAndIncrementalWithoutRelabelingStatic() {
    let f = SecurityScanFixture()
    try {
        let file = f.file("code.js", "eval(input);")
        @ExpectThrows[Exception](f.scanner.run([file], "deep", layer: "deep"))
        @ExpectThrows[Exception](f.scanner.run([file], "incremental", layer: "incremental"))
        let capabilities = securityScanTestReport(f.scanner.describe())
        @Expect(capabilities.get("deep").getOrThrow().asBool().getValue(), false)
        @Expect(capabilities.get("interproceduralDataflow").getOrThrow().asBool().getValue(), false)
        let report = securityScanTestReport(f.scanner.run([file], "static"))
        let finding = securityScanTestFind(report, "injection.eval")
        @Expect(securityScanTestString(finding, "layer"), "static")
        @Expect(finding.get("dataflow").isNone(), true)
    } finally {
        f.close()
    }
}

@Test
func securityScanEmptyScopeIsNoOpAndNeverReadsUnrequestedFiles() {
    let f = SecurityScanFixture()
    try {
        f.file("unrequested.js", "eval(req.body.code);")
        let empty = securityScanTestReport(f.scanner.run([], "empty", trigger: "auto-turn"))
        @Expect(securityScanTestCount(empty, "files"), Int64(0))
        @Expect(securityScanTestCount(empty, "findings"), Int64(0))
        let safe = f.file("safe.js", "const count = 1;")
        let report = securityScanTestReport(f.scanner.run([safe], "scoped"))
        @Expect(securityScanTestCount(report, "files"), Int64(1))
        @Expect(securityScanTestCount(report, "findings"), Int64(0))
    } finally {
        f.close()
    }
}

@Test
func securityScanMarksUnsupportedMalformedExcludedAndOversizeAsNotCovered() {
    let f = SecurityScanFixture(maxFileBytes: 128)
    try {
        let unsupported = f.file("code.py", "eval(input)")
        let malformed = f.file("broken.js", "eval(input")
        let regex = f.file("regex.js", "const pattern = /eval(input)/;")
        let excluded = f.file("node_modules/code.js", "eval(input);")
        let huge = f.file("large.js", String(Array<Rune>(256, repeat: r'x')))
        let report = securityScanTestReport(f.scanner.run([unsupported, malformed, regex, excluded, huge], "coverage"))
        @Expect(securityScanTestString(report, "phase"), "partial")
        @Expect(securityScanTestCount(report, "unanalyzed"), Int64(4))
        @Expect(securityScanTestCount(report, "excluded"), Int64(1))
        @Expect(report.get("coverage").getOrThrow().asObject().get("filesScanned").getOrThrow().asInt().getValue(), Int64(0))
    } finally {
        f.close()
    }
}

@Test
func securityScanDetectsDynamicSqlTemplatesAndTraversalConcatenation() {
    let f = SecurityScanFixture()
    try {
        let text = "db.query(`SELECT * FROM users WHERE id=\u{24}{user}`);\n" +
            "fs.readFile('../' + filename, callback);\n" + "new Function('arg', source);\n"
        let report = securityScanTestReport(f.scanner.run([f.file("patterns.ts", text)], "patterns"))
        @Expect(securityScanTestCount(report, "findings"), Int64(3))
        @Expect(securityScanTestString(securityScanTestFind(report, "injection.sql"), "severity"), "warning")
    } finally {
        f.close()
    }
}

@Test
func securityScanBindsDigestAndWholeReportFreshness() {
    let f = SecurityScanFixture()
    try {
        let file = f.file("code.js", "eval(input);")
        let other = f.file("other.js", "const safe = 1;")
        let report = securityScanTestReport(f.scanner.run([file, other], "fresh"))
        let id = securityScanTestString(report, "scanId")
        @Expect(f.scanner.freshness(id), "current")
        f.file("new-outside.js", "eval(input);")
        @Expect(f.scanner.freshness(id), "current")
        f.file("other.js", "const changed = 2;")
        @Expect(f.scanner.freshness(id), "stale")
        let mismatch = securityScanTestReport(f.scanner.run([other], "old-digest"))
        @Expect(securityScanTestString(mismatch, "phase"), "partial")
        @Expect(securityScanTestCount(mismatch, "findings"), Int64(0))
        removeIfExists("${f.root}/code.js", recursive: false)
        @Expect(f.scanner.freshness(id), "stale")
    } finally {
        f.close()
    }
}

@Test
func securityScanRejectsTraversalAliasesWrongWorkspaceAndInvalidDigest() {
    let f = SecurityScanFixture()
    try {
        let file = f.file("safe.js", "const safe = 1;")
        for (path in ["../secret.js", "/secret.js", "C:/secret.js", "safe.js:stream", "a//b.js", "a/./b.js", "safe.js ",
            "a\n.js"]) {
            @ExpectThrows[Exception](SecurityScanFile(path, file.digest))
        }
        @ExpectThrows[Exception](SecurityScanFile("safe.js", "bad"))
        @ExpectThrows[Exception](f.scanner.run([file, SecurityScanFile("safe.js", file.digest)], "duplicate"))
        Directory.create("${f.root}/other")
        f.workspace.setDirectory("${f.root}/other")
        @ExpectThrows[Exception](f.scanner.run([file], "workspace"))
        f.workspace.setDirectory(f.root)
        @ExpectThrows[Exception](f.scanner.run([file], "workspace-return"))
    } finally {
        f.close()
    }
}

@Test
func securityScanCancelledAndCapacityReportsDoNotClaimSuccess() {
    let f = SecurityScanFixture(maxFindings: 1)
    try {
        let first = f.file("a.js", "eval(first); eval(second);")
        let second = f.file("b.js", "eval(third);")
        let cancelled = TurnToken();
        cancelled.cancel()
        let report = securityScanTestReport(f.scanner.run([first, second], "cancelled", token: cancelled))
        @Expect(securityScanTestString(report, "phase"), "cancelled")
        @Expect(securityScanTestCount(report, "unfinished"), Int64(2))
        let limited = securityScanTestReport(f.scanner.run([first, second], "limited"))
        @Expect(securityScanTestString(limited, "phase"), "partial")
        @Expect(securityScanTestCount(limited, "unanalyzed"), Int64(1))
        @Expect(securityScanTestCount(limited, "unfinished"), Int64(1))
    } finally {
        f.close()
    }
}

@Test
func securityScanTotalByteBudgetAndUnsupportedTemplatesCannotClaimCoverage() {
    let f = SecurityScanFixture(maxTotalBytes: 20)
    try {
        let a = f.file("a.js", "eval(first);")
        let b = f.file("b.js", "eval(second);")
        let report = securityScanTestReport(f.scanner.run([a, b], "total-limit"))
        @Expect(securityScanTestString(report, "phase"), "partial")
        @Expect(securityScanTestCount(report, "findings"), Int64(1))
        @Expect(securityScanTestCount(report, "unanalyzed"), Int64(1))
        @Expect(f.scanner.freshness(securityScanTestString(report, "scanId")), "unverified")
        @ExpectThrows[Exception](securityScanAnalyze("const text = `\u{24}{eval(input)}`;", TurnToken()))
        @ExpectThrows[Exception](securityScanAnalyze("exec(,input);", TurnToken()))
    } finally {
        f.close()
    }
}

@Test
func securityScanRequestReplayAndFindingIdsAreDeterministic() {
    let f = SecurityScanFixture()
    try {
        let a = f.file("a.js", "eval(input);")
        let b = f.file("b.js", "const safe = 1;")
        let report = f.scanner.run([a, b], "same-request")
        @Expect(f.scanner.run([b, a], "same-request"), report)
        @ExpectThrows[Exception](f.scanner.run([a], "same-request"))
        let next = securityScanTestReport(f.scanner.run([a, b], "next-request"))
        @Expect(securityScanTestString(securityScanTestFind(next, "injection.eval"), "findingId"),
            securityScanTestString(securityScanTestFind(securityScanTestReport(report), "injection.eval"), "findingId"))
    } finally {
        f.close()
    }
}

@Test
func securityScanFixIsAnApprovalDraftAndSafeCounterpartNoLongerMatches() {
    let f = SecurityScanFixture()
    try {
        let before = "spawn('node', ['--version'], {shell: true});\n"
        let file = f.file("runner.js", before)
        let report = securityScanTestReport(f.scanner.run([file], "fix"))
        let finding = securityScanTestFind(report, "injection.shell")
        @Expect(finding.get("autoFix").getOrThrow().asBool().getValue(), true)
        let draft = securityScanTestReport(
            f.scanner.fixDraft(securityScanTestString(report, "scanId"), [securityScanTestString(finding, "findingId")]))
        @Expect(securityScanTestString(draft, "applyMethod"), "execution/review-apply")
        @Expect(draft.get("requiresApproval").getOrThrow().asBool().getValue(), true)
        @Expect(securityScanTestString(draft, "status"), "draft-not-applied")
        @Expect(securityScanTestString(draft, "expectedDigest"), file.digest)
        @Expect(securityScanTestString(draft, "replacement"), before.replace("true", "false"))
        @Expect(securityScanTestString(draft, "diff").contains("--- a/runner.js\n+++ b/runner.js"), true)
        @Expect(String.fromUtf8(File.readFrom("${f.root}/runner.js")), before)
        let safe = securityScanAnalyze(securityScanTestString(draft, "replacement"), TurnToken())
        @Expect(safe.size, Int64(0))
        f.file("runner.js", "spawn('node', ['--help'], {shell: true});\n")
        @ExpectThrows[Exception](f.scanner.fixDraft(securityScanTestString(report, "scanId"), [securityScanTestString(finding, "findingId")]))
    } finally {
        f.close()
    }
}

@Test
func securityScanDoesNotAutofixDynamicCommandsTestsOrSensitiveSource() {
    let f = SecurityScanFixture()
    try {
        let a = f.file("runner.js", "spawn(program, args, {shell: true});")
        let b = f.file("runner.test.js", "spawn('node', ['--version'], {shell: true});")
        let c = f.file("credentials.js",
            "const password = 'fixture-not-real';\nspawn('node', ['--version'], {shell: true});")
        for (file in [a, b, c]) {
            let report = securityScanTestReport(f.scanner.run([file], file.path))
            let finding = securityScanTestFind(report, "injection.shell")
            @ExpectThrows[Exception](f.scanner.fixDraft(securityScanTestString(report, "scanId"), [securityScanTestString(finding, "findingId")]))
        }
        let quoted = securityScanAnalyze("spawn('node', [], {shell: 'true'});", TurnToken())
        @Expect(quoted.size, Int64(0))
    } finally {
        f.close()
    }
}

@Test
func securityScanFixReviewRejectsMissingExecutionWithoutWritingSourceOrApproving() {
    let f = SecurityScanFixture()
    try {
        let text = "spawn('node', [], {shell: true});"
        let report = securityScanTestReport(f.scanner.run([f.file("runner.js", text)], "review"))
        let finding = securityScanTestFind(report, "injection.shell")
        let lease = WriteLease(f.log.path)
        let service = ExecutionService(f.log, lease, "scan-test")
        let store = AttachmentStore("${f.root}/objects", f.log, AttachmentLimits(1024, 1, 1024, 1024, 1024))
        let desk = ApprovalDesk(f.log)
        let count = f.log.eventCount()
        @ExpectThrows[Exception](f.scanner.prepareFixReview(securityScanTestString(report, "scanId"),
            [securityScanTestString(finding, "findingId")], service, store, desk, "missing-execution", 1, "review"))
        @Expect(f.log.eventCount(), count)
        @Expect(String.fromUtf8(File.readFrom("${f.root}/runner.js")), text)
        let api = ExecutionReviewApi(service, store, desk, "scan-test")
        @ExpectThrows[Exception](api.dispatch("execution/review-apply", "{\"sessionId\":\"scan-test\",\"applyId\":\"missing\",\"approvalId\":1}"))
    } finally {
        f.close()
    }
}

// 仅构造既有执行真源的 mock 事实，不创建进程，不执行或应用修复。
@Test
func securityScanFixReviewRejectsMismatchedRecordedPatch() {
    let f = SecurityScanFixture()
    let lease = WriteLease(f.log.path)
    try {
        @Expect(lease.acquire(), true)
        let source = "spawn('node', [], {shell: true});"
        let report = securityScanTestReport(f.scanner.run([f.file("runner.js", source)], "mock-review"))
        let scanId = securityScanTestString(report, "scanId")
        let ids = [securityScanTestString(securityScanTestFind(report, "injection.shell"), "findingId")]
        let service = ExecutionService(f.log, lease, "scan-test")
        let proposal = JsonObject()
        proposal.put("cwd", JsonString(f.root));
        proposal.put("workspaceRevision", JsonInt(1))
        proposal.put("executable", JsonString("fixture-never-run"));
        proposal.put("argv", JsonArray())
        proposal.put("timeoutMs", JsonInt(1000));
        proposal.put("outputLimit", JsonInt(1024))
        let proposed = service.propose("fixture-task", "fixture-execution", proposal.toString())
        let desk = ApprovalDesk(f.log)
        let ticket = desk.askForCall("execution/start", service.approvalArguments(proposed.id))
        @Expect(desk.answer(ticket, "allowed-once"), true)
        let admitted = service.authorize(proposed.id, proposed.revision, ticket, desk)
        let starting = service.beginStart(admitted.id, admitted.revision)
        let running = service.started(starting.id, starting.revision, "fixture-not-a-process", TurnToken())
        let settled = service.finish(running.id, running.revision, 0, false, false, true)
        let snapshot = JsonObject()
        snapshot.put("version", JsonInt(1));
        snapshot.put("executionId", JsonString(settled.id))
        snapshot.put("sessionId", JsonString("scan-test"));
        snapshot.put("taskId", JsonString(settled.taskId))
        snapshot.put("requestId", JsonString(settled.requestId));
        snapshot.put("proposalDigest", JsonString(settled.digest))
        snapshot.put("executionDirectory", JsonString(f.root));
        snapshot.put("sourceDirectory", JsonString(f.root))
        snapshot.put("workspaceRevision", JsonInt(1));
        snapshot.put("manifestDigest", JsonString("fixture-manifest"))
        f.log.append("execution/workspace-snapshot", snapshot.toString())
        let rows = JsonArray();
        let row = JsonObject()
        row.put("path", JsonString("runner.js"));
        row.put("kind", JsonString("modified"))
        row.put("beforeDigest", JsonString(sha256Hex(source.toArray())))
        row.put("afterDigest", JsonString(sha256Hex("unrelated change".toArray())));
        rows.add(row)
        let review = JsonValue.fromStr(snapshot.toString()).asObject()
        review.put("executionRevision", JsonInt(settled.revision));
        review.put("files", rows)
        f.log.append("execution/review", review.toString())
        @Expect(f.log.durableCheckpoint(lease), true)
        let count = f.log.eventCount()
        let store = AttachmentStore("${f.root}/objects", f.log, AttachmentLimits(1024, 1, 1024, 1024, 1024))
        @ExpectThrows[Exception](f.scanner.prepareFixReview(scanId, ids, service, store, desk, settled.id, settled.revision, "mismatch"))
        @Expect(f.log.eventCount(), count)
        @Expect(String.fromUtf8(File.readFrom("${f.root}/runner.js")), source)
    } finally {
        lease.release();
        f.close()
    }
}

@Test
func securityScanUnclosedTokensBinaryAndEmptyArgumentsStayUnanalyzed() {
    let f = SecurityScanFixture()
    try {
        let a = f.file("a.js", "const text = 'unterminated")
        let b = f.file("b.js", "/* unterminated")
        let c = f.file("c.js", "spawn('node',, {shell: true});")
        let d = f.file("d.js", "\u{0}eval(input)")
        let report = securityScanTestReport(f.scanner.run([a, b, c, d], "invalid"))
        @Expect(securityScanTestString(report, "phase"), "partial")
        @Expect(securityScanTestCount(report, "unanalyzed"), Int64(4))
        @Expect(securityScanTestCount(report, "findings"), Int64(0))
    } finally {
        f.close()
    }
}

@Test
func securityScanLinkedFilesAreNeverScannedWhenFixtureCanCreateLink() {
    let f = SecurityScanFixture()
    let outsideRoot = canonicalize(Directory.createTemp(Path(coreTestRoot()))).toString()
    var linked = false
    try {
        let text = "eval(input);"
        File.writeTo("${outsideRoot}/outside.js", text.toArray())
        try {
            SymbolicLink.create("${f.root}/linked", to: outsideRoot);
            linked = true
        } catch (_: Exception) {}
        if (linked) {
            let report = securityScanTestReport(
                f.scanner.run([SecurityScanFile("linked/outside.js", sha256Hex(text.toArray()))], "linked"))
            @Expect(securityScanTestString(report, "phase"), "partial")
            @Expect(securityScanTestCount(report, "findings"), Int64(0))
            @Expect(securityScanTestCount(report, "unanalyzed"), Int64(1))
        } else {
            @Expect(exists("${f.root}/linked"), false)
        }
    } finally {
        if (linked) {
            removeIfExists("${f.root}/linked", recursive: false)
        }
        f.close();
        coreTestTidy(outsideRoot)
    }
}
