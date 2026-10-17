package core

import std.fs.*
import std.io.*
import std.process.*
import std.unittest.*

// CFFI 可用性与动作执行分开验收；未实现的输入注入必须失败关闭。

func cuSetup(tag: String): (String, SessionLog, ComputerUseLedger) {
    let root = "core-cuexec-${tag}"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    return (root, log, ComputerUseLedger(log))
}

func cuCleanup(root: String): Unit {
    removeIfExists(root, recursive: true)
}

func cuExecCount(log: SessionLog, kind: String): Int64 {
    var n: Int64 = 0
    for (event in log.snapshotEvents()) {
        if (event.eventType == kind) {
            n = n + 1
        }
    }
    return n
}

// CFFI 符号可解析：GetSystemMetrics(0) 不抛。
@Test
func computerCffiSymbolsResolve() {
    // 此探针只读屏幕指标，不代表点击或键盘输入已经执行。
    let width = unsafe { GetSystemMetrics(0) }
    @Expect(width >= 0, true)
}

@Test
func computerUnavailableActionsNeverReportSuccess() {
    let (root, log, ledger) = cuSetup("unsupported")
    let exec = ComputerExecutor(ledger)
    for (verb in ["click", "type", "press_key", "drag", "scroll"]) {
        let r = exec.perform(verb, "original-target")
        @Expect(r.ok, false)
        @Expect(r.exitCode, Int64(-1))
        @Expect(r.cancelled, false)
        @Expect(r.failureKind, "action-not-supported")
        @Expect(r.verb, verb)
        @Expect(r.target, "original-target")
        @Expect(r.message, "computer-input-injection-unavailable")
    }
    @Expect(cuExecCount(log, "computer-use/action"), Int64(5))
    @Expect(cuExecCount(log, "computer/exec"), Int64(0))
    cuCleanup(root)
}

// 非法动词：不落账、不执行。
@Test
func computerRejectsBadVerb() {
    let (root, log, ledger) = cuSetup("badverb")
    let exec = ComputerExecutor(ledger)
    let r = exec.perform("delete", "window")
    @Expect(r.ok, false)
    @Expect(r.failureKind, "bad-verb")
    @Expect(cuExecCount(log, "computer-use/action"), Int64(0))
    cuCleanup(root)
}

// 空 target：不落账。
@Test
func computerRejectsEmptyTarget() {
    let (root, log, ledger) = cuSetup("empty")
    let exec = ComputerExecutor(ledger)
    let r = exec.perform("click", "")
    @Expect(r.ok, false)
    @Expect(r.failureKind, "bad-target")
    @Expect(cuExecCount(log, "computer-use/action"), Int64(0))
    cuCleanup(root)
}

// 取消闭环：令牌已取消 → 不执行。
@Test
func computerCancelledTokenShortCircuits() {
    let (root, log, ledger) = cuSetup("cancelled")
    let exec = ComputerExecutor(ledger)
    let token = TurnToken()
    token.cancel()
    let r = exec.perform("click", "current", token: token)
    @Expect(r.ok, false)
    @Expect(r.cancelled, true)
    @Expect(r.failureKind, "cancelled")
    @Expect(cuExecCount(log, "computer-use/action"), Int64(0))
    @Expect(cuExecCount(log, "computer/exec"), Int64(0))
    cuCleanup(root)
}

// 合法请求的审计表示尝试；没有执行就不能生成执行回执。
@Test
func computerAuditRecordsAttemptsWithoutExecutionReceipts() {
    let (root, log, ledger) = cuSetup("audit")
    let exec = ComputerExecutor(ledger)
    exec.perform("click", "current")
    exec.perform("scroll", "sel")
    @Expect(cuExecCount(log, "computer-use/action"), Int64(2))
    @Expect(cuExecCount(log, "computer/exec"), Int64(0))
    cuCleanup(root)
}
