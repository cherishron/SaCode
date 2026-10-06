package core

import std.fs.*
import std.io.*
import std.process.*
import std.sync.AtomicInt64
import std.time.*

let buStampCounter = AtomicInt64(0)

// 浏览器真实驱动（H/W70）：上游 `ctx.browser` 的真 headless 子进程实现。
//
// 与 `bu.cj` 的分工：`BrowserUseLedger` 是**权限面**（verb 白名单 navigate/click/
// type/scroll + `browser-use/action` 审计事件），本执行器是**执行面**——真正拉起
// Chrome/Edge headless 子进程，加载页面，抓回渲染后的 DOM。
//
// 闭环：
//   1. 权限：verb 必须在白名单内、target 非空、navigate 的 URL 只允许 http/https
//      （挡住 file:// 和 javascript:）；不合规一律不 spawn；
//   2. 审计：通过 `ledger.perform` 落 `browser-use/action`，真正发起过的导航另落
//      `browser/exec` 事件 `<verb>::<exitCode>`，于是「这页导航过几次、各次结局」
//      在日志里一一对得上；
//   3. 诚实边界：headless `--dump-dom` 只能做 navigate（把渲染后的 DOM 抓回来）。
//      click/type/scroll 需要 CDP 交互通道，本驱动如实报 action-not-supported，
//      绝不假装做了；
//   4. 取消：`TurnToken` 在发起前与等待期间每步生效；超时/取消即强杀子进程；
//   5. fail-closed：浏览器不存在、参数为空、URL 不合规各自归一为结构化结果，不抛。
//
// 传输层：Chrome/Edge `--headless --no-sandbox --disable-gpu
// --virtual-time-budget=2000 --dump-dom <url>`，DOM 走 stdout，诊断走 stderr。

let buPollMs: Int64 = 50

public class BrowserExecResult {
    public let ok: Bool
    public let verb: String
    public let target: String
    public let dom: String
    public let exitCode: Int64
    public let timedOut: Bool
    public let cancelled: Bool
    public let failureKind: String   // "" | bad-verb | bad-target | bad-url | action-not-supported | browser-not-found | spawn-failed | browser-exit | timeout | cancelled
    public let message: String
    public let elapsedMs: Int64

    public init(ok: Bool, verb: String, target: String, dom: String,
                exitCode: Int64, timedOut: Bool, cancelled: Bool,
                failureKind: String, message: String, elapsedMs: Int64) {
        this.ok = ok
        this.verb = verb
        this.target = target
        this.dom = dom
        this.exitCode = exitCode
        this.timedOut = timedOut
        this.cancelled = cancelled
        this.failureKind = failureKind
        this.message = message
        this.elapsedMs = elapsedMs
    }
}

func isAllowedVerb(verb: String): Bool {
    if (verb == "navigate") { return true }
    if (verb == "click") { return true }
    if (verb == "type") { return true }
    if (verb == "scroll") { return true }
    return false
}

func isSafeUrlScheme(url: String): Bool {
    if (url.startsWith("http://")) { return true }
    if (url.startsWith("https://")) { return true }
    return false
}

func createBuUserDataDir(): String {
    let stamp = "${buStampCounter.fetchAdd(1)}"
    let dir = "core-bu-userdata-${stamp}"
    try { Directory.create(dir, recursive: true) } catch (_: Exception) {}
    return dir
}

func buElapsed(started: MonoTime): Int64 {
    return (MonoTime.now() - started).toMilliseconds()
}

public class BrowserExecutor {
    let ledger: BrowserUseLedger
    let binary: String
    let maxOutputBytes: Int64

    public init(ledger: BrowserUseLedger, binary!: String = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
                maxOutputBytes!: Int64 = 1048576) {
        this.ledger = ledger
        this.binary = binary
        this.maxOutputBytes = maxOutputBytes
    }

    // 按动词分派。只有 navigate 会真起浏览器；其余如实报不支持。
    public func perform(verb: String, target: String,
                        token!: TurnToken = TurnToken(), timeoutMs!: Int64 = 30000): BrowserExecResult {
        let started = MonoTime.now()
        if (token.cancelled()) {
            return BrowserExecResult(false, verb, target, "", Int64(-1), false, true,
                "cancelled", "browser-cancelled", buElapsed(started))
        }
        if (!isAllowedVerb(verb)) {
            return BrowserExecResult(false, verb, target, "", Int64(-1), false, false,
                "bad-verb", "browser-bad-verb", buElapsed(started))
        }
        if (target.size == 0) {
            return BrowserExecResult(false, verb, target, "", Int64(-1), false, false,
                "bad-target", "browser-empty-target", buElapsed(started))
        }
        // 审计：先落 browser-use/action（权限面），再决定要不要真跑
        try {
            ledger.perform(verb, target)
        } catch (e: Exception) {
            return BrowserExecResult(false, verb, target, "", Int64(-1), false, false,
                "bad-verb", e.message, buElapsed(started))
        }
        if (verb != "navigate") {
            return BrowserExecResult(false, verb, target, "", Int64(-1), false, false,
                "action-not-supported", "browser-headless-dump-dom-only-navigate",
                buElapsed(started))
        }
        if (!isSafeUrlScheme(target)) {
            return BrowserExecResult(false, verb, target, "", Int64(-1), false, false,
                "bad-url", "browser-url-must-be-http-or-https", buElapsed(started))
        }
        return navigateReal(target, token, timeoutMs, started)
    }

    func navigateReal(url: String, token: TurnToken, timeoutMs: Int64, started: MonoTime): BrowserExecResult {
        let tmpDir = createBuUserDataDir()
        let args = ["--headless", "--no-sandbox", "--disable-gpu",
            "--disable-dev-shm-usage", "--disable-web-security",
            "--user-data-dir=${tmpDir}", "--no-first-run",
            "--virtual-time-budget=3000", "--dump-dom", url]
        let launched = launchBrowser(args)
        if (launched.isNone()) {
            return BrowserExecResult(false, "navigate", url, "", Int64(-1), false, false,
                "browser-not-found", "browser-binary-not-found", buElapsed(started))
        }
        let proc = launched.getOrThrow()
        let stderrPipe = proc.stdErrPipe
        let stderr = spawn { => readAllStream(stderrPipe) }

        let stdout = readAllStream(proc.stdOutPipe)
        var stderrText = ""
        try { stderrText = stderr.get(3000 * Duration.millisecond) } catch (_: Exception) {}

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
                code = proc.wait(timeout: buPollMs * Duration.millisecond)
                break
            } catch (_: Exception) {
            }
        }
        if (cancelled || timedOut) {
            try { proc.terminate(force: true) } catch (_: Exception) {}
            try { code = proc.wait() } catch (_: Exception) { code = Int64(-1) }
        }
        if (cancelled) {
            return BrowserExecResult(false, "navigate", url, "", code, false, true,
                "cancelled", "browser-cancelled", buElapsed(started))
        }
        if (timedOut) {
            return BrowserExecResult(false, "navigate", url, "", code, true, false,
                "timeout", "browser-timeout", buElapsed(started))
        }
        // 审计：真正发起过的导航
        ledger.log.append("browser/exec", "navigate::${code}")
        if (code == 0 && stdout.size > 0) {
            return BrowserExecResult(true, "navigate", url, stdout, code, false, false,
                "", "", buElapsed(started))
        }
        return BrowserExecResult(false, "navigate", url, stdout, code, false, false,
            "browser-exit", "browser-exit-${code}::${stderrText}", buElapsed(started))
    }

    func launchBrowser(args: Array<String>): Option<SubProcess> {
        try {
            let p = launch(binary, args, stdIn: ProcessRedirect.Discard,
                stdOut: ProcessRedirect.Pipe, stdErr: ProcessRedirect.Pipe)
            return Some(p)
        } catch (_: Exception) {
            return None
        }
    }
}
