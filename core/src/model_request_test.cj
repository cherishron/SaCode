package core

import std.unittest.*
import stdx.encoding.json.*

@Test
func modelRequestUsesCanonicalMessagesAndOrderedHistory() {
    let events = [SessionEvent(0, "system/message", "系统规则"),
        SessionEvent(1, "user/message", "第一轮"),
        SessionEvent(2, "assistant/message", "第一轮答复"),
        SessionEvent(3, "user/message", "继续\n包含\"引号\"与\\路径"),
        SessionEvent(4, "stream/chunk", "不能重复注入"),
        SessionEvent(5, "approval/asked", "内部审批"),
        SessionEvent(6, "user", "错误事件类型")]
    let body = JsonValue.fromStr(modelRequestJson("中文模型", events)).asObject()
    let messages = body.get("messages").getOrThrow().asArray()
    @Expect(messages.get(4).isNone(), true)
    @Expect(messages.get(0).getOrThrow().asObject().get("role").getOrThrow().asString().getValue(), "system")
    @Expect(messages.get(2).getOrThrow().asObject().get("role").getOrThrow().asString().getValue(), "assistant")
    @Expect(messages.get(3).getOrThrow().asObject().get("content").getOrThrow().asString().getValue(), "继续\n包含\"引号\"与\\路径")
    @Expect(body.get("model").getOrThrow().asString().getValue(), "中文模型")
}

@Test
func modelRequestDoesNotInventMessagesFromControlEvents() {
    let body = JsonValue.fromStr(modelRequestJson("model", [SessionEvent(0, "turn/start", "内部轮次"), SessionEvent(1, "tool/result", "无工具调用关联")])).asObject()
    @Expect(body.get("messages").getOrThrow().asArray().get(0).isNone(), true)
}
