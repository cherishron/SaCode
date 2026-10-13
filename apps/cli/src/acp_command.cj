package cli
import core.*
import std.env.getStdErr

func runAcpCommand(args: Array<String>): Int64 {
    let list = args.size == 2 && args[1] == "list"
    let detail = args.size == 3 && args[1] == "describe"
    if (!list && !detail) { getStdErr().writeln("用法：sacode acp list | acp describe <委派身份>（当前目录 session.log，只读）"); return 64 }
    try {
        let log = SessionLog("session.log")
        if (!log.load()) { throw Exception("replay-rejected") }
        let params = if (detail) { "{\"sessionId\":\"current\",\"delegationId\":\"${jsonEscapeText(args[2])}\"}" } else { "{\"sessionId\":\"current\"}" }
        println(AcpHistory(log, "current").dispatch(if (detail) { "acp/delegation/describe" } else { "acp/delegation/list" }, params))
        return 0
    } catch (e: Exception) { getStdErr().writeln("ACP：${e.message}"); return 1 }
}
