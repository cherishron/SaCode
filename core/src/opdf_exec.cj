package core

import std.collection.*
import std.fs.*
import std.io.*
import std.process.*
import std.time.MonoTime

// Office → PDF 真实驱动（H/W70）：上游 `ctx.office.toPdf(id, path)` 的真子进程实现。
//
// 与 `opdf.cj` 的分工：`OfficeToPdfLedger` 是**状态面**（`office-to-pdf/task`
// 事件承载 start/done/fail，pending → done/failed 终态不可逆），本执行器是
// **执行面**——真正拉起一个转换工具子进程，把文档转成 PDF，并和账本闭环：
//   1. 先落 `start`，再动手——于是账本上永远能回答「这个任务发起过没有」；
//   2. 真跑转换：拼 argv → launch → 带 deadline 的 wait → 超时/取消即强杀；
//   3. 真校验产物：产物必须存在、非空、且带 `%PDF-` 魔数——**转换工具返回 0
//      但没写出 PDF** 这种常见故障不会被当成成功；
//   4. 收尾写账：成功写 `done`，任何失败写 `fail`，reason 用同款的短码，
//      于是「发起-结局」在日志里一一对得上；
//   5. fail-closed：工具不存在、参数为空、源文件缺失、产物校验失败各自归一为
//      结构化结果，不抛。
//
// 为什么转换器可注入：本机没有装 LibreOffice（`soffice` 不在 PATH 上），
// 但 Office→PDF 的难点从来不是「怎么调 soffice」，而是「怎么保证转换真发生、
// 产物真可用、失败真上报」。把转换器当作可注入的外部件，驱动逻辑本身就是
// 完整的真子进程编排 + 真产物校验；工具缺失时如实报 `converter-not-found`，
// 绝不假装有结果。
//
// argv 模板：`{source}` / `{outdir}` 两个占位符。默认值就是 LibreOffice 的
// `--headless --convert-to pdf --outdir <dir> <file>` 形态。

// 产物魔数：%PDF-
let pdfHeader: Array<UInt8> = [UInt8(37), UInt8(80), UInt8(68), UInt8(70), UInt8(45)]

// 等待子进程的单步轮询粒度：够短让取消在 ~50ms 内被看见。
let opdfPollMs: Int64 = 50

// Office → PDF 执行结果：一律结构化返回（不抛）。
public class OpdfResult {
    public let ok: Bool
    public let taskId: String
    public let sourcePath: String
    public let pdfPath: String
    public let exitCode: Int64
    public let outputBytes: Int64
    public let timedOut: Bool
    public let cancelled: Bool
    public let failureKind: String   // "" | bad-args | source-missing | ledger-busy | converter-not-found | spawn-failed | converter-exit | no-output | output-unreadable | timeout | cancelled
    public let message: String
    public let elapsedMs: Int64

    public init(ok: Bool, taskId: String, sourcePath: String, pdfPath: String,
                exitCode: Int64, outputBytes: Int64, timedOut: Bool, cancelled: Bool,
                failureKind: String, message: String, elapsedMs: Int64) {
        this.ok = ok
        this.taskId = taskId
        this.sourcePath = sourcePath
        this.pdfPath = pdfPath
        this.exitCode = exitCode
        this.outputBytes = outputBytes
        this.timedOut = timedOut
        this.cancelled = cancelled
        this.failureKind = failureKind
        this.message = message
        this.elapsedMs = elapsedMs
    }
}

// 取文件名的「去扩展名」部分：report.docx → report。无扩展名原样返回。
func opdfStem(name: String): String {
    var i: Int64 = Int64(name.size) - Int64(1)
    var found: Int64 = Int64(-1)
    while (i >= Int64(0)) {
        if (name[i] == UInt8(46)) {   // '.'
            found = i
            break
        }
        i = i - Int64(1)
    }
    if (found <= Int64(0)) {
        return name
    }
    return name[0..found]
}

// 取路径最后一段（去分隔符）。用于把源路径映射到产物文件名。
func opdfBaseName(path: String): String {
    var last: Int64 = Int64(-1)
    var i: Int64 = Int64(path.size) - Int64(1)
    while (i >= Int64(0)) {
        let b = path[i]
        if (b == UInt8(47) || b == UInt8(92)) {   // '/' 或 '\'
            last = i
            break
        }
        i = i - Int64(1)
    }
    if (last < Int64(0)) {
        return path
    }
    return path[last + Int64(1)..Int64(path.size)]
}

func isPdfHeader(bytes: Array<Byte>): Bool {
    if (Int64(bytes.size) < Int64(pdfHeader.size)) {
        return false
    }
    var i: Int64 = Int64(0)
    while (i < Int64(pdfHeader.size)) {
        if (Int64(bytes[i]) != Int64(pdfHeader[i])) {
            return false
        }
        i = i + Int64(1)
    }
    return true
}

func elapsedOf(started: MonoTime): Int64 {
    return (MonoTime.now() - started).toMilliseconds()
}

// Office → PDF 真实执行器。
// converter：转换工具可执行文件（默认取 PATH 上的 soffice）。
// template：argv 模板，含 `{source}` 与 `{outdir}` 占位符。
// timeoutMs：转换总等待预算。
public class OpdfExecutor {
    let ledger: OfficeToPdfLedger
    let converter: String
    let template: Array<String>
    let timeoutMs: Int64

    public init(ledger: OfficeToPdfLedger, converter!: String = "soffice",
                template!: Array<String> = ["--headless", "--convert-to", "pdf", "--outdir", "{outdir}", "{source}"],
                timeoutMs!: Int64 = 60000) {
        this.ledger = ledger
        this.converter = converter
        this.template = template
        this.timeoutMs = timeoutMs
    }

    // 把 id 对应的源文件转成 PDF，写到 outputDir，并同步账本状态。
    public func convert(taskId: String, sourcePath: String, outputDir: String,
                        token!: TurnToken = TurnToken()): OpdfResult {
        let started = MonoTime.now()
        let pdfPath = opdfPdfPath(outputDir, sourcePath)

        if (token.cancelled()) {
            return cancelledResult(started, taskId, sourcePath, pdfPath)
        }
        if (taskId.size == 0 || sourcePath.size == 0 || outputDir.size == 0) {
            return failResult(started, taskId, sourcePath, pdfPath, "bad-args", "opdf-empty-arg")
        }
        // FileInfo 对不存在的路径会抛 FSException，包住
        var srcExists = false
        try {
            srcExists = FileInfo(sourcePath).isRegular()
        } catch (_: Exception) {
            srcExists = false
        }
        if (!srcExists) {
            return failResult(started, taskId, sourcePath, pdfPath, "source-missing", "opdf-source-missing")
        }

        // 先记账再动手：账本上能回答「这个任务发起过没有」
        try {
            ledger.start(taskId, sourcePath)
        } catch (_: Exception) {
            return failAndReport(started, taskId, sourcePath, pdfPath, ledger, "ledger-busy", "opdf-ledger-busy")
        }

        if (token.cancelled()) {
            return failAndReport(started, taskId, sourcePath, pdfPath, ledger, "cancelled", "opdf-cancelled")
        }

        let args = buildArgs(template, sourcePath, outputDir)

        let launched = launchConverter(converter, args)
        if (launched.isNone()) {
            return failAndReport(started, taskId, sourcePath, pdfPath, ledger, "converter-not-found", "opdf-converter-not-found")
        }
        let proc = launched.getOrThrow()

        // stderr 独立线程读，避免管道写满把转换工具卡死
        let stderrPipe = proc.stdErrPipe
        spawn { => readAllStream(stderrPipe) }

        var code: Int64 = Int64(-1)
        var timedOut = false
        var cancelled = false
        let deadline = MonoTime.now() + Duration.millisecond * timeoutMs
        while (true) {
            if (token.cancelled()) {
                cancelled = true
                break
            }
            if ((deadline - MonoTime.now()).toMilliseconds() <= 0) {
                timedOut = true
                break
            }
            try {
                code = proc.wait(timeout: opdfPollMs * Duration.millisecond)
                break
            } catch (_: Exception) {
                // 本步没等到退出，继续下一轮
            }
        }

        if (cancelled || timedOut) {
            try { proc.terminate(force: true) } catch (_: Exception) {}
            try { code = proc.wait() } catch (_: Exception) { code = Int64(-1) }
        }

        if (cancelled) {
            return failAndReport(started, taskId, sourcePath, pdfPath, ledger, "cancelled", "opdf-cancelled")
        }
        if (timedOut) {
            return failAndReport(started, taskId, sourcePath, pdfPath, ledger, "timeout", "opdf-timeout")
        }
        if (code != 0) {
            return failAndReport(started, taskId, sourcePath, pdfPath, ledger, "converter-exit",
                "opdf-exit-${code}")
        }

        // 校验产物：存在 + 非空 + %PDF 魔数
        var pdfExists = false
        try {
            pdfExists = FileInfo(pdfPath).isRegular()
        } catch (_: Exception) {
            pdfExists = false
        }
        if (!pdfExists) {
            return failAndReport(started, taskId, sourcePath, pdfPath, ledger, "no-output", "opdf-no-output")
        }
        var bytes: Array<Byte> = []
        var readable = false
        try {
            bytes = File.readFrom(pdfPath)
            readable = true
        } catch (_: Exception) {}
        if (!readable) {
            return failAndReport(started, taskId, sourcePath, pdfPath, ledger, "output-unreadable", "opdf-output-unreadable")
        }
        if (!isPdfHeader(bytes)) {
            return failAndReport(started, taskId, sourcePath, pdfPath, ledger, "no-output", "opdf-not-pdf")
        }

        try {
            ledger.done(taskId, pdfPath)
        } catch (_: Exception) {
            return failResult(started, taskId, sourcePath, pdfPath, "ledger-busy", "opdf-ledger-busy")
        }
        return OpdfResult(true, taskId, sourcePath, pdfPath, code, Int64(bytes.size),
            false, false, "", "", elapsedOf(started))
    }

    func buildArgs(template: Array<String>, source: String, outdir: String): Array<String> {
        let out = ArrayList<String>()
        for (part in template) {
            if (part == "{source}") {
                out.add(source)
            } else if (part == "{outdir}") {
                out.add(outdir)
            } else {
                out.add(part)
            }
        }
        return out.toArray()
    }

    func launchConverter(cmd: String, args: Array<String>): Option<SubProcess> {
        try {
            let p = launch(cmd, args, stdIn: ProcessRedirect.Discard,
                stdOut: ProcessRedirect.Pipe, stdErr: ProcessRedirect.Pipe)
            return Some(p)
        } catch (_: Exception) {
            return None
        }
    }

    func failAndReport(started: MonoTime, taskId: String, sourcePath: String, pdfPath: String,
                       ledger: OfficeToPdfLedger, kind: String, message: String): OpdfResult {
        // 终态不可逆：如果账本已经落到 done/failed，就不重复写（也不会抛）
        try {
            ledger.fail(taskId, message)
        } catch (_: Exception) {}
        return OpdfResult(false, taskId, sourcePath, pdfPath, Int64(-1), Int64(0),
            kind == "timeout", kind == "cancelled", kind, message, elapsedOf(started))
    }

    func cancelledResult(started: MonoTime, taskId: String, sourcePath: String,
                         pdfPath: String): OpdfResult {
        // 发生在 ledger.start 之前或之后但尚未写账：cancelled 分支各自处理
        return OpdfResult(false, taskId, sourcePath, pdfPath, Int64(-1), Int64(0),
            false, true, "cancelled", "opdf-cancelled", elapsedOf(started))
    }

    func failResult(started: MonoTime, taskId: String, sourcePath: String, pdfPath: String,
                    kind: String, message: String): OpdfResult {
        return OpdfResult(false, taskId, sourcePath, pdfPath, Int64(-1), Int64(0),
            false, false, kind, message, elapsedOf(started))
    }
}

func opdfPdfPath(outputDir: String, sourcePath: String): String {
    let base = opdfBaseName(sourcePath)
    let stem = opdfStem(base)
    let sep = if (outputDir.endsWith("/")) { "" } else { "/" }
    return "${outputDir}${sep}${stem}.pdf"
}
