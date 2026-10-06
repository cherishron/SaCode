package core

import std.fs.*
import std.unittest.*

// Office→PDF 真实驱动测试（H/W70）：本机**没有装 LibreOffice**（soffice 不在 PATH），
// 所以分两半验：
//   A. 工具缺失时如实 fail-closed，绝不假装有结果；
//   B. 注入一个**真的** node 转换工具，跑完整的真子进程编排 + 真产物校验，
//      证明驱动逻辑本身是真转换、不是记日志。
// 产物校验不只看退出码：工具返回 0 但没写出 %PDF 也算失败。

let opdfConverterScript: String = "core-opdf-converter.js"
let opdfFailScript: String = "core-opdf-fail.js"
let opdfTextScript: String = "core-opdf-text.js"
let opdfStallScript: String = "core-opdf-stall.js"
// 注意：模板的第一项必须是脚本路径——converter="node" 时，
// argv = [脚本路径, --src, {source}, --out, {outdir}]，脚本路径漏了的话
// node 会把 --src 当成自己的旗标解析然后非零退出。
func opdfConvTemplate(): Array<String> { return [opdfConverterScript, "--src", "{source}", "--out", "{outdir}"] }

// 真转换工具：读 --src/--out，把源文件「转」成一份真 PDF（%PDF- 魔数 + EOF 标记）。
func opdfConverterBody(): String {
    return joinStrings([
        "const fs = require('fs');",
        "let src = '';",
        "let out = '';",
        "const a = process.argv.slice(2);",
        "for (let i = 0; i + 1 < a.length; i++) {",
        "  if (a[i] === '--src') { src = a[i+1]; }",
        "  if (a[i] === '--out') { out = a[i+1]; }",
        "}",
        "if (!src || !out) { process.exit(2); }",
        "if (!fs.existsSync(src)) { process.exit(2); }",
        "const stem = src.replace(/^.*[\\/]/, '').replace(/\\.[^.]+$/, '');",
        "fs.writeFileSync(out + '/' + stem + '.pdf', Buffer.from('%PDF-1.4\\n%body-of-' + src + '\\n%%EOF\\n'));",
        "process.exit(0);",
    ], "\n")
}

// 失败工具：直接非零退出。
func opdfFailBody(): String {
    return joinStrings(["process.exit(3);"], "\n")
}

// 假转换：退出码 0，但产物不是 PDF（故意写纯文本）。
func opdfTextBody(): String {
    return joinStrings([
        "const fs = require('fs');",
        "let src = '';",
        "let out = '';",
        "const a = process.argv.slice(2);",
        "for (let i = 0; i + 1 < a.length; i++) {",
        "  if (a[i] === '--src') { src = a[i+1]; }",
        "  if (a[i] === '--out') { out = a[i+1]; }",
        "}",
        "const stem = src.replace(/^.*[\\/]/, '').replace(/\\.[^.]+$/, '');",
        "fs.writeFileSync(out + '/' + stem + '.pdf', 'this is not a pdf');",
        "process.exit(0);",
    ], "\n")
}

// 卡死工具：挂着不退，用于触发超时。
func opdfStallBody(): String {
    return joinStrings(["setTimeout(() => process.exit(0), 5000);"], "\n")
}

func opdfWriteFixture(path: String, body: String): Unit {
    File.writeTo(path, body.toArray())
}

func opdfCleanupScripts(): Unit {
    removeIfExists(opdfConverterScript, recursive: false)
    removeIfExists(opdfFailScript, recursive: false)
    removeIfExists(opdfTextScript, recursive: false)
    removeIfExists(opdfStallScript, recursive: false)
}

func opdfSetup(tag: String): (String, String, String, SessionLog, OfficeToPdfLedger) {
    let root = "core-opdfexec-${tag}"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let srcDir = "${root}/src"
    let outDir = "${root}/out"
    Directory.create(srcDir, recursive: true)
    Directory.create(outDir, recursive: true)
    let src = "${srcDir}/report.docx"
    File.writeTo(src, "placeholder source document".toArray())
    let log = SessionLog("${root}/session.log")
    return (root, src, outDir, log, OfficeToPdfLedger(log))
}

func opdfLedgerCount(log: SessionLog, kind: String): Int64 {
    var n: Int64 = 0
    for (event in log.snapshotEvents()) {
        if (event.eventType == "office-to-pdf/task" && event.data.startsWith("${kind}::")) {
            n = n + 1
        }
    }
    return n
}

// 工具不存在：如实报 converter-not-found，账本落到 failed，绝不伪造成功。
@Test
func opdfReportsConverterNotFound() {
    let (root, src, outDir, log, ledger) = opdfSetup("noconv")
    let exec = OpdfExecutor(ledger)
    let r = exec.convert("t-1", src, outDir)
    @Expect(r.ok, false)
    @Expect(r.failureKind, "converter-not-found")
    @Expect(r.message, "opdf-converter-not-found")
    @Expect(r.pdfPath, "${outDir}/report.pdf")
    @Expect(ledger.status("t-1"), "failed")
    @Expect(opdfLedgerCount(log, "start"), Int64(1))
    @Expect(opdfLedgerCount(log, "fail"), Int64(1))
    @Expect(opdfLedgerCount(log, "done"), Int64(0))
    removeIfExists(root, recursive: true)
}

// 真转换：注入真的 node 转换工具，产出真 PDF，账本走到 done。
@Test
func opdfConvertsRealDocumentWithRealOutput() {
    let (root, src, outDir, log, ledger) = opdfSetup("real")
    opdfWriteFixture(opdfConverterScript, opdfConverterBody())
    let exec = OpdfExecutor(ledger, converter: "node", template: opdfConvTemplate(), timeoutMs: 20000)
    let r = exec.convert("t-1", src, outDir)
    @Expect(r.ok, true)
    @Expect(r.failureKind, "")
    @Expect(r.exitCode, Int64(0))
    @Expect(r.pdfPath, "${outDir}/report.pdf")
    @Expect(r.outputBytes > Int64(0), true)
    @Expect(ledger.status("t-1"), "done")
    @Expect(opdfLedgerCount(log, "done"), Int64(1))
    let info = FileInfo(r.pdfPath)
    @Expect(info.isRegular(), true)
    let bytes = File.readFrom(r.pdfPath)
    @Expect(Int64(bytes[0]), Int64(37))
    @Expect(Int64(bytes[1]), Int64(80))
    @Expect(Int64(bytes[2]), Int64(68))
    @Expect(Int64(bytes[3]), Int64(70))
    @Expect(Int64(bytes[4]), Int64(45))
    opdfCleanupScripts()
    removeIfExists(root, recursive: true)
}

// 产物校验不是只看退出码：工具退出 0 但产物不是 PDF → no-output + 账本 failed。
@Test
func opdfRejectsNonPdfOutput() {
    let (root, src, outDir, log, ledger) = opdfSetup("textout")
    opdfWriteFixture(opdfTextScript, opdfTextBody())
    let exec = OpdfExecutor(ledger, converter: "node", template: [opdfTextScript, "--src", "{source}", "--out", "{outdir}"], timeoutMs: 20000)
    let r = exec.convert("t-1", src, outDir)
    @Expect(r.ok, false)
    @Expect(r.failureKind, "no-output")
    @Expect(r.message, "opdf-not-pdf")
    @Expect(ledger.status("t-1"), "failed")
    @Expect(opdfLedgerCount(log, "fail"), Int64(1))
    opdfCleanupScripts()
    removeIfExists(root, recursive: true)
}

// 转换工具非零退出 → converter-exit，退出码原样带出。
@Test
func opdfReportsConverterExitFailure() {
    let (root, src, outDir, log, ledger) = opdfSetup("convfail")
    opdfWriteFixture(opdfFailScript, opdfFailBody())
    let exec = OpdfExecutor(ledger, converter: "node", template: [opdfFailScript], timeoutMs: 20000)
    let r = exec.convert("t-1", src, outDir)
    @Expect(r.ok, false)
    @Expect(r.failureKind, "converter-exit")
    @Expect(r.message, "opdf-exit-3")
    @Expect(ledger.status("t-1"), "failed")
    opdfCleanupScripts()
    removeIfExists(root, recursive: true)
}

// 源文件缺失：连账本都不该落 start。
@Test
func opdfReportsSourceMissing() {
    let (root, _, outDir, log, ledger) = opdfSetup("nosrc")
    let exec = OpdfExecutor(ledger, converter: "node", template: opdfConvTemplate(), timeoutMs: 10000)
    let r = exec.convert("t-1", "${root}/does-not-exist.docx", outDir)
    @Expect(r.ok, false)
    @Expect(r.failureKind, "source-missing")
    @Expect(opdfLedgerCount(log, "start"), Int64(0))
    @Expect(opdfLedgerCount(log, "fail"), Int64(0))
    removeIfExists(root, recursive: true)
}

// 参数校验：空 id 拒，且不碰账本。
@Test
func opdfRejectsBadArgs() {
    let (root, src, outDir, log, ledger) = opdfSetup("badargs")
    let exec = OpdfExecutor(ledger, converter: "node", template: opdfConvTemplate(), timeoutMs: 10000)
    let r = exec.convert("", src, outDir)
    @Expect(r.ok, false)
    @Expect(r.failureKind, "bad-args")
    @Expect(opdfLedgerCount(log, "start"), Int64(0))
    removeIfExists(root, recursive: true)
}

// 取消闭环：令牌已取消 → 不 spawn、不落账。
@Test
func opdfCancelledTokenShortCircuits() {
    let (root, src, outDir, log, ledger) = opdfSetup("cancelled")
    let exec = OpdfExecutor(ledger, converter: "node", template: opdfConvTemplate(), timeoutMs: 10000)
    let token = TurnToken()
    token.cancel()
    let r = exec.convert("t-1", src, outDir, token: token)
    @Expect(r.ok, false)
    @Expect(r.cancelled, true)
    @Expect(r.failureKind, "cancelled")
    @Expect(opdfLedgerCount(log, "start"), Int64(0))
    @Expect(opdfLedgerCount(log, "fail"), Int64(0))
    removeIfExists(root, recursive: true)
}

// 超时：卡死的转换工具被强杀，账本落 failed，reason 是 opdf-timeout。
@Test
func opdfTimeoutKillsStallingConverter() {
    let (root, src, outDir, log, ledger) = opdfSetup("timeout")
    opdfWriteFixture(opdfStallScript, opdfStallBody())
    let exec = OpdfExecutor(ledger, converter: "node", template: [opdfStallScript], timeoutMs: 1500)
    let r = exec.convert("t-1", src, outDir)
    @Expect(r.ok, false)
    @Expect(r.timedOut, true)
    @Expect(r.failureKind, "timeout")
    @Expect(r.message, "opdf-timeout")
    @Expect(ledger.status("t-1"), "failed")
    @Expect(opdfLedgerCount(log, "fail"), Int64(1))
    opdfCleanupScripts()
    removeIfExists(root, recursive: true)
}

// 审计对账：两次成功 + 一次失败 = start×3 / done×2 / fail×1。
@Test
func opdfAuditMatchesRealRuns() {
    let (root, src, outDir, log, ledger) = opdfSetup("audit")
    opdfWriteFixture(opdfConverterScript, opdfConverterBody())
    opdfWriteFixture(opdfFailScript, opdfFailBody())
    let ok = OpdfExecutor(ledger, converter: "node", template: opdfConvTemplate(), timeoutMs: 20000)
    let bad = OpdfExecutor(ledger, converter: "node", template: [opdfFailScript], timeoutMs: 20000)
    let r1 = ok.convert("a-1", "${root}/src/report.docx", outDir)
    let r2 = ok.convert("a-2", "${root}/src/report.docx", "${root}/out")
    let r3 = bad.convert("a-3", "${root}/src/report.docx", "${root}/out")
    @Expect(r1.ok, true)
    @Expect(r2.ok, true)
    @Expect(r3.ok, false)
    @Expect(r3.failureKind, "converter-exit")
    @Expect(ledger.status("a-1"), "done")
    @Expect(ledger.status("a-2"), "done")
    @Expect(ledger.status("a-3"), "failed")
    @Expect(opdfLedgerCount(log, "start"), Int64(3))
    @Expect(opdfLedgerCount(log, "done"), Int64(2))
    @Expect(opdfLedgerCount(log, "fail"), Int64(1))
    opdfCleanupScripts()
    removeIfExists(root, recursive: true)
}
