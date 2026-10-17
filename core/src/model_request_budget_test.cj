package core

import std.unittest.*
import stdx.encoding.json.*

@Test
func requestBudgetCapacitySupportsDecimalSuffixAndRejectsZero() {
    @Expect(requestCapacity("1.5k"), Int64(1500))
    @Expect(requestCapacity("2M"), Int64(2000000))
    @Expect(requestCapacity(""), Int64(-1))
    for (text in ["0", "-1", "k", ".", "1..5k", "1x", "999999999999999999999m"]) {
        var rejected = false
        try { requestCapacity(text) } catch (e: Exception) { rejected = e.message == "request-capacity-invalid" }
        @Expect(rejected, true)
    }
}

@Test
func requestBudgetWritesTheSmallerOutputCapWithoutChangingHistory() {
    let events = [SessionEvent(0, "user/message", "保留完整原文")]
    let request = modelRequestJson("model", events, contextWindow: "8k",
        modelOutputLimit: "4k", maxOutputTokens: 128)
    let body = JsonValue.fromStr(request).asObject()
    @Expect(body.get("max_tokens").getOrThrow().asInt().getValue(), Int64(128))
    @Expect(events[0].data, "保留完整原文")
}

@Test
func requestBudgetRejectsBeforeTruncatingMessages() {
    let events = [SessionEvent(0, "user/message", "必须保留")]
    var rejected = false
    try {
        modelRequestJson("model", events, contextWindow: "1", maxOutputTokens: 1)
    } catch (e: Exception) { rejected = e.message == "request-context-limit" }
    @Expect(rejected, true)
    @Expect(events[0].data, "必须保留")
}

@Test
func requestBudgetAccountsForOutputReservationAndModelCap() {
    var rejected = false
    try {
        modelRequestJson("model", [], contextWindow: "300", maxOutputTokens: 100)
    } catch (e: Exception) { rejected = e.message == "request-context-limit" }
    @Expect(rejected, true)
    let body = JsonValue.fromStr(modelRequestJson("model", [], modelOutputLimit: "16",
        maxOutputTokens: 32)).asObject()
    @Expect(body.get("max_tokens").getOrThrow().asInt().getValue(), Int64(16))
}

@Test
func requestBudgetIncludesToolCatalogAndDerivesUnconfiguredOutput() {
    let body = JsonValue.fromStr(modelRequestJson("model", [], contextWindow: "300")).asObject()
    @Expect(body.get("max_tokens").getOrThrow().asInt().getValue(), Int64(44))
    let tools = [ToolSpec("local_tool", "完整工具描述同样占用上下文", "{\"type\":\"object\",\"properties\":{}}", false)]
    var rejected = false
    try {
        modelRequestJson("model", [], tools: tools, contextWindow: "300")
    } catch (e: Exception) { rejected = e.message == "request-context-limit" }
    @Expect(rejected, true)
}

@Test
func requestBudgetUnconfiguredKeepsWireShapeAndRejectsInvalidOutput() {
    let body = JsonValue.fromStr(modelRequestJson("model", [])).asObject()
    @Expect(body.get("max_tokens").isNone(), true)
    for (cap in [Int64(0), Int64(-2)]) {
        var rejected = false
        try {
            modelRequestJson("model", [], maxOutputTokens: cap)
        } catch (e: Exception) { rejected = e.message == "request-output-limit-invalid" }
        @Expect(rejected, true)
    }
}
