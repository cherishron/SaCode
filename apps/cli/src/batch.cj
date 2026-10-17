package cli
import core.*
import std.fs.*
import std.env.*
import std.convert.*
import stdx.encoding.json.*

// CLI 只解析参数和映射退出码；业务及本地记录都由共享核心负责。
func runBatch(args: Array<String>): Int64 {
    try {
        if (args.size < 2) { throw Exception("usage: sacode batch check|run <plan.json>|list|clean <task>|collect|retry|cancel") }
        let verb = args[1]
        var dry = false; var force = false; var expect = ""
        var i: Int64 = 3
        while (i < args.size) {
            let flag = args[i]
            if (flag == "--dry-run" && verb == "run" && !dry) { dry = true }
            else if (flag == "--force" && verb == "clean" && !force) { force = true }
            else if (flag == "--wait" && verb == "collect") {}
            else if ((flag == "--expect" && verb == "run") || (flag == "--timeout" && verb == "collect") || (flag == "--max-output-tokens" && verb == "retry")) {
                i += 1
                if (i >= args.size) { throw Exception("batch-option-value-missing") }
                if (flag == "--expect") { expect = args[i] }
                else if (Int64.parse(args[i]) <= 0) { throw Exception("batch-option-value-invalid") }
            } else { throw Exception("batch-option-invalid:${flag}") }
            i += 1
        }
        let project = getWorkingDirectory().toString()
        let home = getVariable("SACODE_BATCH_HOME") ?? (getVariable("QWEN_BATCH_HOME") ?? "${project}/.sacode/batch")
        let config = getVariable("SACODE_BATCH_CONFIG") ?? "${project}/.sacode/settings.json"
        let store = BatchStore(project, home, config)
        if (verb == "check" || verb == "list") {
            if (args.size != 2) { throw Exception("batch-unexpected-argument") }
            if (verb == "check") { println(store.check().toString()) }
            else { println(store.list().toString()) }
            return 0
        }
        if (args.size < 3) { throw Exception("batch-argument-missing") }
        if (verb == "run") {
            let preview = store.preview(args[2], expect)
            if (dry) { println(preview.toString()); return 0 }
        } else if (verb == "clean") {
            store.clean(args[2], force)
            let out = JsonObject(); out.put("cleanedLocal", JsonString(args[2])); out.put("remoteCancelled", JsonBool(false))
            println(out.toString()); return 0
        } else if (verb == "collect" || verb == "retry" || verb == "cancel") {
            validateBatchTaskId(args[2])
        } else { throw Exception("batch-command-unknown") }
        getStdErr().writeln("BLOCKED: remote-batch-api-contract-missing; P0 不提交、收取、重试或取消远端任务")
        return 69
    } catch (e: Exception) {
        getStdErr().writeln("batch: ${e.message}")
        return 64
    }
}
