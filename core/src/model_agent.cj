package core
import std.collection.ArrayList
import std.io.*
import std.convert.*

// 共享模型工具循环：一次 turn 可经历多次模型请求，每步以日志中的调用/结果继续。
public class ModelAgentLoop {
    public func run(first: Provider, nextProvider: (String) -> Provider, model: String,
        token: TurnToken, log: SessionLog, sink: FrameSink, allowParallel: Bool,
        maxSteps!: Int64 = 16, attach!: ?AttachmentStore = None, supportsImages!: Bool = false): TurnResult {
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
                // 步边界：即时补充全部落地。摘走之后送达是另一件事——每条另写一条
                // user/message，队列事件本身不进模型可见历史，两条账互不冒充。
                // 只有「确要去发下一次请求」的位置才摘：step-limit 已经 break，
                // 在那之后摘走等于把消息吞进没人看的清单。
                for (note in AgentInbox(log).claimStep()) {
                    // 即时补充也必须结算绑定附件；仅写正文会让续跑静默丢图。
                    if (note.attachments.size > 0) {
                        if (let Some(store) <- attach) { store.commitMessage(note.text, note.attachments) }
                        else { throw Exception("attachment-store-absent") }
                    } else { log.append("user/message", note.text) }
                    sink.offer("projection:queue")
                }
                // 唯一请求来源是会话日志：不保留第二份 messages 状态。
                provider = nextProvider(modelRequestJson(model, log.snapshotEvents().toArray(), tools: [todo.spec()], attachStore: attach, supportsImages: supportsImages))
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
        maxSteps!: Int64 = 16, attach!: ?AttachmentStore = None, supportsImages!: Bool = false): TurnHandle {
        let future = spawn { => ModelAgentLoop().run(first, nextProvider, model, token, log, sink, allowParallel, maxSteps: maxSteps, attach: attach, supportsImages: supportsImages) }
        return TurnHandle(token, future)
    }
}
