package cli
import core.*
import std.env.getStdErr

func runApprovalModeCommand(args: Array<String>): Int64 {
    let read = args.size == 2 && args[1] == "get"
    let write = args.size == 3 && args[1] == "set"
    if (!read && !write) {
        getStdErr().writeln("usage: sacode mode get | mode set <plan|build|auto|yolo> （当前目录 session.log）")
        return 64
    }
    if (write && args[2] != "plan" && args[2] != "build" && args[2] != "auto" && args[2] != "yolo") {
        getStdErr().writeln("mode: bad-approval-mode"); return 64
    }
    let lease = WriteLease("session.log")
    // log 必须在 try 之外构造，finally 才能按 isDurableFrozen 决定是否归还租约。
    let log = SessionLog("session.log")
    try {
        if (write && !lease.takeoverIfStale()) {
            getStdErr().writeln("mode: ${leaseFailureLabel(lease)}")
            return leaseFailureExitCode(lease)
        }
        if (!log.load()) { throw Exception("replay-rejected") }
        let mode = ModeController(log)
        if (read) { println("{\"ok\":true,\"mode\":\"${mode.current()}\"}") }
        else {
            let result = mode.setDurable(args[2], lease)
            println("{\"ok\":true,\"result\":\"${result}\"}")
        }
        return 0
    } catch (_: Exception) { getStdErr().writeln("mode: persistence-or-replay-failed"); return 1 }
    // 落盘未确认时保留租约（与 sacode call / worktree 同一口径），
    // 不让下一个写者带着未结算的内存态进场。
    finally { if (write && !log.isDurableFrozen()) { lease.release() } }
}
