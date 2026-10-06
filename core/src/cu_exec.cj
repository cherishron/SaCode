package core

import std.collection.*
import std.io.*
import std.process.*
import std.time.MonoTime

// 电脑执行契约（H/W70）：校验请求并审计尝试。
// 当前尚未实现输入注入，所有合法动作明确返回不支持。
// computer-use/action 表示请求尝试，不能作为动作执行成功的回执。

public class ComputerExecResult {
    public let ok: Bool
    public let verb: String
    public let target: String
    public let exitCode: Int64
    public let cancelled: Bool
    public let failureKind: String   // "" | bad-verb | bad-target | action-not-supported | cffi-failed | cancelled
    public let message: String
    public let elapsedMs: Int64

    public init(ok: Bool, verb: String, target: String, exitCode: Int64,
                cancelled: Bool, failureKind: String, message: String, elapsedMs: Int64) {
        this.ok = ok
        this.verb = verb
        this.target = target
        this.exitCode = exitCode
        this.cancelled = cancelled
        this.failureKind = failureKind
        this.message = message
        this.elapsedMs = elapsedMs
    }
}

func isAllowedComputerVerb(verb: String): Bool {
    if (verb == "click") { return true }
    if (verb == "drag") { return true }
    if (verb == "scroll") { return true }
    if (verb == "type") { return true }
    if (verb == "press_key") { return true }
    return false
}

func cuElapsed(started: MonoTime): Int64 {
    return (MonoTime.now() - started).toMilliseconds()
}

// 只读可用性探针；符号解析不证明鼠标或键盘动作已执行。
foreign func GetSystemMetrics(nIndex: Int32): Int32

public class ComputerExecutor {
    let ledger: ComputerUseLedger

    public init(ledger: ComputerUseLedger) {
        this.ledger = ledger
    }

    public func perform(verb: String, target: String,
                        token!: TurnToken = TurnToken()): ComputerExecResult {
        let started = MonoTime.now()
        if (token.cancelled()) {
            return ComputerExecResult(false, verb, target, Int64(-1), true,
                "cancelled", "computer-cancelled", cuElapsed(started))
        }
        if (!isAllowedComputerVerb(verb)) {
            return ComputerExecResult(false, verb, target, Int64(-1), false,
                "bad-verb", "computer-bad-verb", cuElapsed(started))
        }
        if (target.size == 0) {
            return ComputerExecResult(false, verb, target, Int64(-1), false,
                "bad-target", "computer-empty-target", cuElapsed(started))
        }
        try {
            ledger.perform(verb, target)
        } catch (e: Exception) {
            return ComputerExecResult(false, verb, target, Int64(-1), false,
                "bad-verb", e.message, cuElapsed(started))
        }
        // 没有真实输入注入实现时禁止返回成功，也不生成 computer/exec。
        return ComputerExecResult(false, verb, target, Int64(-1), false,
            "action-not-supported", "computer-input-injection-unavailable", cuElapsed(started))
    }
}
