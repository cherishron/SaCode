package cli

import core.*
import std.env.getStdErr
import std.fs.*
import std.convert.*

func runAcpCommand(args: Array<String>): Int64 {
    let list = args.size == 2 && args[1] == "list"
    let detail = args.size == 3 && args[1] == "describe"
    let settings = args.size == 2 && args[1] == "settings"
    let probe = args.size == 2 && args[1] == "probe"
    let configure = args.size == 3 && (args[1] == "enable" || args[1] == "disable")
    if (!list && !detail && !settings && !probe && !configure) {
        getStdErr().writeln(
            "用法：sacode acp list | describe <委派身份> | settings | probe | enable <预期修订> | disable <预期修订>")
        getStdErr().writeln("当前目录 session.log；开启仅保存当前项目会话配置，不发送任务。probe 不发送模型任务。")
        return 64
    }
    try {
        if (probe) {
            let report = OpenCodeAcpProvider(configuredOpenCodeExecutable()).probe(canonicalize(".").toString())
            println(openCodeReadinessJson(report))
            return if (report.environment == "installed-usable" && report.authenticated && report.verdict == "measured" &&
                report.protocolVersion == 1) {
                0
            } else {
                2
            }
        }
        let log = SessionLog("session.log")
        if (configure) {
            let expectedRevision = Int64.parse(args[2])
            if (expectedRevision < 0) {
                throw Exception("invalid-input:acp-settings-revision")
            }
            let lease = WriteLease("session.log")
            if (!lease.takeoverIfStale()) {
                throw Exception("already-owned")
            }
            try {
                if (!log.load()) {
                    throw Exception("replay-rejected")
                }
                println(AcpSessionSettings(log, lease).setEnabled(args[1] == "enable", expectedRevision))
                return 0
            } finally {
                if (!log.isDurableFrozen()) {
                    lease.release()
                } else {
                    getStdErr().writeln("ACP 配置持久化未确认，保留写租约。")
                }
            }
        }
        if (!log.load()) {
            throw Exception("replay-rejected")
        }
        if (settings) {
            println(AcpSessionSettings(log, WriteLease("session.log")).describe());
            return 0
        }
        let params = if (detail) {
            "{\"sessionId\":\"current\",\"delegationId\":\"${jsonEscapeText(args[2])}\"}"
        } else {
            "{\"sessionId\":\"current\"}"
        }
        println(AcpHistory(log, "current").dispatch(if (detail) {
            "acp/delegation/describe"
        } else {
            "acp/delegation/list"
        }, params))
        return 0
    } catch (e: Exception) {
        getStdErr().writeln("ACP：${e.message}");
        return 1
    }
}
