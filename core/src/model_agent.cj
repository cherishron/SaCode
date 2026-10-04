package core
import std.collection.ArrayList
import std.io.*
import std.convert.*

// 共享模型工具循环：一次 turn 可经历多次模型请求，每步以日志中的调用/结果继续。
public class ModelAgentLoop {
    public func run(first: Provider, nextProvider: (String) -> Provider, model: String,
        token: TurnToken, log: SessionLog, sink: FrameSink, allowParallel: Bool,
        maxSteps!: Int64 = 16): TurnResult {
        if (maxSteps < 1 || maxSteps > 128) { throw Exception("bad-agent-step-limit") }
        log.append("turn/start", "")
        let todo = TodoTool(log, allowParallel)
        var provider = first
        var providerOpen = true
        var delivered = Int64(0)
        var totalUsage = Int64(0)
        var text = ""
        var finish = ""
        var interrupted = true
        var settled = Int64(0)
        try {
            for (step in 0..maxSteps) {
                if (token.cancelled()) { break }
                let assembly = Assembly()
                let tools = ModelToolCalls()
                try {
                    while (!token.cancelled()) {
                        if (let Some(chunk) <- provider.next()) {
                            if (token.cancelled()) { break }
                            assembly.push(chunk)
                            if (chunk.kind == "tool-call-delta") { tools.push(chunk) }
                            log.append("stream/chunk", streamChunkJson(chunk))
                            sink.offer("${chunk.kind}:${chunk.text}")
                            delivered += 1
                            if (!assembly.interrupted) { break }
                        } else { break }
                    }
                } finally { providerOpen = false; if (let Some(resource) <- (provider as Resource)) { resource.close() } }
                text += assembly.assembledText()
                if (assembly.usage.size > 0) { totalUsage += Int64.parse(assembly.usage) }
                finish = assembly.finishReason
                interrupted = assembly.interrupted
                if (token.cancelled() || interrupted) { break }
                if (finish != "tool_calls") {
                    log.append("assistant/message", assembly.assembledText())
                    break
                }
                let calls = tools.complete()
                if (calls.size == 0) { throw Exception("empty-model-tool-calls") }
                var wire = "["
                for (index in 0..calls.size) {
                    if (index > 0) { wire += "," }
                    wire += calls[index].wireJson()
                }
                wire += "]"
                log.append("assistant/message", modelWireData("{\"role\":\"assistant\",\"content\":\"${jsonEscapeText(assembly.assembledText())}\",\"tool_calls\":${wire}}"))
                // 同一批调用全部结算；取消后其余调用写关联取消结果，永不留下孤儿。
                for (call in calls) {
                    log.append("tool/call", call.wireJson())
                    var result = ""
                    if (token.cancelled()) { result = "{\"error\":\"cancelled\"}" }
                    else {
                        try {
                            if (call.name != "todo_write") { throw Exception("unregistered-tool:${call.name}") }
                            result = todo.execute(call.args, true)
                            sink.offer("projection:todos")
                        } catch (e: Exception) { result = "{\"error\":\"${jsonEscapeText(e.message)}\"}" }
                    }
                    log.append("tool/result", modelToolResultData(call.id, result))
                    settled += 1
                }
                if (token.cancelled()) { break }
                if (step + 1 >= maxSteps) { finish = "step-limit"; interrupted = true; break }
                // 唯一请求来源是会话日志：不保留第二份 messages 状态。
                provider = nextProvider(modelRequestJson(model, log.snapshotEvents().toArray(), tools: [todo.spec()]))
                providerOpen = true
            }
        } catch (e: Exception) {
            finish = "error:${e.message}"
            interrupted = true
        } finally { if (providerOpen) { if (let Some(resource) <- (provider as Resource)) { resource.close() } } }
        if (token.cancelled()) { log.append("turn/cancelled", "after ${delivered} chunks") }
        else { log.append("turn/end", finish) }
        return TurnResult(token.cancelled(), delivered, text, finish, "${totalUsage}", interrupted, settled, 0)
    }
}

public class ModelAgentRunner {
    public func start(first: Provider, nextProvider: (String) -> Provider, model: String,
        token: TurnToken, log: SessionLog, sink: FrameSink, allowParallel: Bool,
        maxSteps!: Int64 = 16): TurnHandle {
        let future = spawn { => ModelAgentLoop().run(first, nextProvider, model, token, log, sink, allowParallel, maxSteps: maxSteps) }
        return TurnHandle(token, future)
    }
}
