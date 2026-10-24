package cli

import core.*
import std.env.getStdErr
import std.fs.*
import std.convert.*

func runAcpCommand(args: Array<String>): Int64 {
    if (args.size > 1 && args[1] == "codebuddy") {
        let selected = Array<String>(args.size - 1, {
            i => if (i == 0) {
            args[0]
        } else {
            args[i + 1]
        }
        })
        return runAcpProviderCommand(selected, "codebuddy")
    }
    return runAcpProviderCommand(args, "opencode")
}

func runAcpProviderCommand(args: Array<String>, peerId: String): Int64 {
    let list = args.size == 2 && args[1] == "list"
    let detail = args.size == 3 && args[1] == "describe"
    let settings = args.size == 2 && args[1] == "settings"
    let probe = args.size == 2 && args[1] == "probe"
    let configure = args.size == 3 && (args[1] == "enable" || args[1] == "disable")
    let diagnostics = args.size == 2 && args[1] == "diagnostics"
    let keep = args.size == 4 && args[1] == "keep"
    if (peerId == "codebuddy" && (list || detail)) {
        getStdErr().writeln(
            "CodeBuddy 控制入口现支持 settings/probe/diagnostics/keep/enable/disable；委派历史请使用 acp list。")
        return 64
    }
    if (!list && !detail && !settings && !probe && !configure && !diagnostics && !keep) {
        getStdErr().writeln(
            "用法：sacode acp list | describe <委派身份> | settings | probe | diagnostics | keep <诊断编号> <修订> | enable <预期修订> | disable <预期修订>")
        getStdErr().writeln("当前目录 session.log；开启仅保存当前项目会话配置，不发送任务。probe 不发送模型任务。")
        return 64
    }
    try {
        if (probe) {
            let source = SessionLog("session.log")
            let lease = WriteLease("session.log")
            if (!lease.takeoverIfStale()) {
                throw Exception(leaseFailureLabel(lease))
            }
            try {
                if (!source.load()) {
                    throw Exception("replay-rejected")
                }
                if (!AcpSessionSettings(source, lease, peerId: peerId).effective.describe("project").enabled) {
                    throw Exception("provider-unavailable:acp-disabled")
                }
                let workspace = canonicalize(".").toString()
                let journal = AcpDiagnosticJournal(source, lease, "current", workspace, peerId: peerId)
                let scope = journal.scopeRevision()
                let report = if (peerId == "codebuddy") {
                    probeConfiguredCodeBuddy(workspace, TurnToken())
                } else {
                    probeConfiguredOpenCode(workspace, TurnToken())
                }
                journal.record(report, scope)
                println(acpReadinessJson(peerId, report, diagnosticSaved: Some(true)))
                return if (report.environment == "installed-usable" && report.verdict == "measured" &&
                    report.protocolVersion == 1) {
                    0
                } else {
                    2
                }
            } finally {
                if (!source.isDurableFrozen()) {
                    lease.release()
                }
            }
        }
        let log = SessionLog("session.log")
        if (configure || keep) {
            let expectedRevision = Int64.parse(args[if (keep) {
                    3
                } else {
                    2
                }])
            if (expectedRevision < 0) {
                throw Exception("invalid-input:acp-settings-revision")
            }
            let lease = WriteLease("session.log")
            if (!lease.takeoverIfStale()) {
                throw Exception(leaseFailureLabel(lease))
            }
            try {
                if (!log.load()) {
                    throw Exception("replay-rejected")
                }
                println(if (keep) {
                    AcpDiagnosticJournal(log, lease, "current", canonicalize(".").toString(), peerId: peerId).keep(
                        args[2], expectedRevision)
                } else {
                    AcpSessionSettings(log, lease, peerId: peerId).setEnabled(args[1] == "enable", expectedRevision)
                })
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
        if (diagnostics) {
            println(
                AcpDiagnosticJournal(log, WriteLease("session.log"), "current", canonicalize(".").toString(),
                    peerId: peerId).describe())
            return 0
        }
        if (settings) {
            println(AcpSessionSettings(log, WriteLease("session.log"), peerId: peerId).describe());
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
