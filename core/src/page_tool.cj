package core

import std.sync.*
import stdx.encoding.json.*

public class PageToolRequest {
    public let sessionId: String
    public let requestId: String
    public let name: String
    public let arguments: String
    public let token: TurnToken
    public init(sessionId: String, requestId: String, name: String, arguments: String, token: TurnToken) {
        this.sessionId = sessionId
        this.requestId = requestId
        this.name = name
        this.arguments = arguments
        this.token = token
    }
}

public class PageToolReply {
    public let sessionId: String
    public let requestId: String
    public let result: String
    public init(sessionId: String, requestId: String, result: String) {
        this.sessionId = sessionId
        this.requestId = requestId
        this.result = result
    }
}
// 提供方只处理经过核心管线的请求；声明面不得携带任意 JavaScript。
public interface PageToolProvider {
    func execute(request: PageToolRequest): PageToolReply
}

let pageToolRequestIds = AtomicInt64(0)

public func pageToolSpecs(): Array<ToolSpec> {
    return [
        ToolSpec("page.readState", "读取当前页面文本与元素状态",
            ##"{"type":"object","additionalProperties":false,"properties":{"selector":{"type":"string"}}}"##, false),
        ToolSpec("page.clickElement", "点击当前页面中的精确目标；需要一次性审批",
            ##"{"type":"object","additionalProperties":false,"required":["selector"],"properties":{"selector":{"type":"string","minLength":1},"selectorType":{"type":"string","enum":["css","text","role"]}}}"##,
            true),
        ToolSpec("page.inputText", "向当前页面精确目标输入文本；需要一次性审批",
            ##"{"type":"object","additionalProperties":false,"required":["selector","text"],"properties":{"selector":{"type":"string","minLength":1},"text":{"type":"string"}}}"##,
            true),
        ToolSpec("page.scroll", "滚动当前页面；需要一次性审批",
            ##"{"type":"object","additionalProperties":false,"properties":{"x":{"type":"number"},"y":{"type":"number"}}}"##,
            true)
    ]
}

// 模型函数名采用与 lsp_* 相同的形式；页面协议名保持既有 WebMCP 契约。
public func pageModelToolSpecs(): Array<ToolSpec> {
    let names = ["page_read_state", "page_click_element", "page_input_text", "page_scroll"]
    let specs = pageToolSpecs()
    return Array<ToolSpec>(names.size,
        {i => ToolSpec(names[i], specs[i].description, specs[i].params, specs[i].needsApproval)})
}

public func pageProtocolName(name: String): String {
    let model = pageModelToolSpecs();
    let protocol = pageToolSpecs()
    for (i in 0..model.size) {
        if (name == model[i].name) {
            return protocol[i].name
        }
    }
    return name
}

public class PageToolExecutor {
    let provider: PageToolProvider
    let instance = randomHex(16)
    public let sessionId: String
    public init(provider: PageToolProvider, sessionId: String) {
        if (sessionId.size == 0) {
            throw Exception("invalid-input:page-session")
        }
        this.provider = provider
        this.sessionId = sessionId
    }
    public func validateArguments(name: String, args: String) {
        if (args.size > 65536) {
            throw Exception("invalid-input:page-arguments")
        }
        let obj = JsonValue.fromStr(args).asObject()
        let keys = if (name == "page.readState") {
            ["selector"]
        } else if (name == "page.clickElement") {
            ["selector", "selectorType"]
        } else if (name == "page.inputText") {
            ["selector", "text"]
        } else if (name == "page.scroll") {
            ["x", "y"]
        } else {
            throw Exception("unsupported:page-tool")
        }
        var count: Int64 = 0
        for (key in keys) {
            if (let Some(value) <- obj.get(key)) {
                count += 1
                if (key == "x" || key == "y") {
                    try {
                        value.asInt()
                    } catch (_: Exception) {
                        value.asFloat()
                    }
                } else {
                    let text = value.asString().getValue()
                    if (key == "selector" && text.size > 4096) {
                        throw Exception("invalid-input:page-selector")
                    }
                    if (key == "selectorType" && text != "css" && text != "text" && text != "role") {
                        throw Exception("invalid-input:page-selector-type")
                    }
                }
            }
        }
        if (count != obj.size()) {
            throw Exception("invalid-input:page-arguments")
        }
        if (name == "page.clickElement" || name == "page.inputText") {
            if (obj.get("selector").getOrThrow().asString().getValue().size == 0) {
                throw Exception("invalid-input:page-selector")
            }
        }
        if (name == "page.inputText") {
            obj.get("text").getOrThrow().asString()
        }
    }
    public func execute(name: String, args: String, token: TurnToken): ApprovalOutcome {
        try {
            validateArguments(name, args)
        } catch (_: Exception) {
            return ApprovalOutcome(false, "invalid-input:page-arguments")
        }
        if (token.cancelled()) {
            return ApprovalOutcome(false, "cancelled-before-page-dispatch")
        }
        let request = PageToolRequest(sessionId, "page-${instance}-${pageToolRequestIds.fetchAdd(1) + 1}", name, args,
            token)
        try {
            let reply = provider.execute(request)
            if (token.cancelled()) {
                return ApprovalOutcome(false, "outcome-unknown:page-cancelled-after-dispatch")
            }
            if (reply.sessionId != sessionId || reply.requestId != request.requestId) {
                return ApprovalOutcome(false, "outcome-unknown:page-reply-identity-mismatch")
            }
            if (reply.result.size > 65536) {
                return ApprovalOutcome(false, "outcome-unknown:page-result-too-large")
            }
            let value = JsonValue.fromStr(reply.result).asObject()
            return ApprovalOutcome(value.get("error").isNone(), reply.result, structured: true)
        } catch (_: Exception) {
            return ApprovalOutcome(false, "outcome-unknown:page-provider-failed")
        }
    }
}
