package core
import std.io.*
import std.sync.*

// 提示词增强：把「这一条草稿」交给当前会话选中的模型重述得更清楚。
// 它是草稿辅助面，不是执行面——请求里既不带工具定义，也不带会话历史，
// 结果只回给调用方，永不落进会话日志（会话日志是唯一真源，混进去就等于替用户说了话）。
let ENHANCE_INSTRUCTION = "你是需求表述助手。请把用户接下来给出的这一条草稿改写得更清楚、更有条理，"
    + "并保留他原本的意图、语气、感受和已经明确写出的约束。"
    + "可以在必要时把内容整理成背景、目标、要求、验收条件这类结构，但不要强行套用模板，也不要让篇幅无谓变长。"
    + "不要添加用户没有提到的功能、技术栈、时间、预算或限制。"
    + "信息不足时保留那份不确定，明确写成待确认，不要编造事实。"
    + "只输出改写后的草稿本身，不要解释你做了什么，也不要加前后缀说明。"

public class EnhanceResult {
    public let text: String
    public let usage: String
    public let cancelled: Bool
    public let finishReason: String
    public init(text: String, usage: String, cancelled: Bool, finishReason: String) {
        this.text = text; this.usage = usage; this.cancelled = cancelled; this.finishReason = finishReason
    }
}

// 「请求字节」的唯一构造点：两条消息，一条指令、一条草稿，没有第三个来源。
// 少一条或多一条都意味着这次增强看见了它本不该看见的东西。
public func enhanceRequestJson(model: String, draft: String): String {
    if (draft.trimAscii().size == 0) { throw Exception("enhance-empty-draft") }
    if (model.trimAscii().size == 0) { throw Exception("enhance-empty-model") }
    if (draft.size > 8000) { throw Exception("enhance-draft-too-large") }
    return "{\"model\":\"${jsonEscapeText(model)}\",\"messages\":["
        + "{\"role\":\"system\",\"content\":\"${jsonEscapeText(ENHANCE_INSTRUCTION)}\"},"
        + "{\"role\":\"user\",\"content\":\"${jsonEscapeText(draft)}\"}"
        + "],\"stream\":true,\"stream_options\":{\"include_usage\":true}}"
}

public class PromptEnhancer {
    // provider 由调用方构造并注入（真实请求或夹具流都一样），这里只管跑到终态并交回文本。
    public func run(provider: Provider, token: TurnToken): EnhanceResult {
        let assembly = Assembly()
        try {
            while (!token.cancelled()) {
                if (let Some(ch) <- provider.next()) {
                    assembly.push(ch)
                    if (!assembly.interrupted) { break }
                } else {
                    break
                }
            }
        } finally {
            if (let Some(resource) <- (provider as Resource)) { resource.close() }
        }
        // 取消优先于一切判定：半途而废的增强不能冒充一份可用结果。
        if (token.cancelled()) { return EnhanceResult("", "", true, "") }
        // 增强请求没给工具定义，模型却回了工具调用 —— 说明对面被当成了执行面用，
        // 宁可失败也不能把一份「模型想去动东西」的回应塞回输入框。
        if (assembly.toolCalls.size > 0) { throw Exception("enhance-unexpected-tool") }
        // 被 max-tokens 截断的是半截话，替换掉用户的完整草稿比不替换更糟。
        if (assembly.finishReason == "max-tokens") { throw Exception("enhance-max-tokens") }
        let text = assembly.assembledText()
        if (text.trimAscii().size == 0) { throw Exception("enhance-empty-result") }
        return EnhanceResult(text, assembly.usage, false, assembly.finishReason)
    }
}

// 线程边界的结算值：异常不得跨过 spawn，否则宿主只能看到一个永不结算的 future。
// running 是独立的一档——「还没跑完」必须和「跑完但失败/跑完但空」区分开，
// 否则轮询方会把进行中误读成一次失败的完成。
public class EnhanceOutcome {
    public let running: Bool
    public let ok: Bool
    public let error: String
    public let text: String
    public let usage: String
    public let cancelled: Bool
    public let finishReason: String
    init(running: Bool, ok: Bool, error: String, text: String, usage: String, cancelled: Bool, finishReason: String) {
        this.running = running; this.ok = ok; this.error = error; this.text = text
        this.usage = usage; this.cancelled = cancelled; this.finishReason = finishReason
    }
}

// provider 的构造就是真实 HTTPS 往返（RealSseProvider 在 init 里就 send 了请求），
// 所以构造必须和取帧一起发生在被 spawn 的那条线程上：主循环陪着它阻塞，
// 桌面的取消就只能排在一次连接后面。构造与取帧的失败都折成同一个结算值。
func enhanceSettled(factory: () -> Provider, token: TurnToken): EnhanceOutcome {
    try {
        let r = PromptEnhancer().run(factory(), token)
        return EnhanceOutcome(false, !r.cancelled, "", r.text, r.usage, r.cancelled, r.finishReason)
    } catch (e: Exception) {
        // 取消途中 provider 抛出来也算正常收场：不报成故障，只报 cancelled。
        if (token.cancelled()) { return EnhanceOutcome(false, false, "", "", "", true, "") }
        return EnhanceOutcome(false, false, e.message, "", "", false, "")
    }
}

public class EnhanceHandle {
    let token: TurnToken
    let future: Future<EnhanceOutcome>
    init(token: TurnToken, future: Future<EnhanceOutcome>) {
        this.token = token; this.future = future
    }
    public func cancel() {
        token.cancel()
        future.cancel()
    }
    public func isRunning(): Bool {
        if (let Some(_) <- future.tryGet()) { return false }
        return true
    }
    public func result(): EnhanceOutcome {
        return future.get()
    }
    // 未就绪时返回 running=true 占位，调用方据此判「还在跑」，不拿空文本当结果。
    public func tryOutcome(): EnhanceOutcome {
        match (future.tryGet()) {
            case Some(o) => o
            case None => EnhanceOutcome(true, false, "", "", "", false, "")
        }
    }
}

public class EnhanceRunner {
    public func start(factory: () -> Provider, token: TurnToken): EnhanceHandle {
        let future = spawn { => enhanceSettled(factory, token) }
        return EnhanceHandle(token, future)
    }
}
