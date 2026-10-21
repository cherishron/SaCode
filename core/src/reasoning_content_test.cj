package core

import std.fs.*
import std.io.*
import std.unittest.*
import stdx.encoding.json.*

func reasoningProbeProvider(tool: Bool): RealSseProvider {
    let stream = ByteBuffer()
    let last = if (tool) { ##"{"tool_calls":[{"index":0,"id":"r-call","function":{"name":"missing-tool","arguments":"{}"}}]}"## } else { ##"{"content":"可见答案"}"## }
    let finish = if (tool) { "tool_calls" } else { "stop" }
    stream.write(("data: {\"choices\":[{\"index\":0,\"delta\":{\"reasoning_content\":\"思考\\n\"}}]}\n\n" +
        "data: {\"choices\":[{\"index\":1,\"delta\":{\"reasoning_content\":\"不能拼入\"}}]}\n\n" +
        "data: {\"choices\":[{\"delta\":{\"reasoning_content\":null}}]}\n\n" +
        "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"后半段\"}}]}\n\n" +
        "data: {\"choices\":[{\"delta\":${last},\"finish_reason\":\"${finish}\"}]}\n\ndata: [DONE]\n\n").toArray())
    return RealSseProvider(stream, TurnToken())
}

@Test
func reasoningSeparateFromVisibleContentAndRoundTripsAfterReload() {
    if (!exists("../target/tmp")) { Directory.create("../target/tmp", recursive: true) }
    let root = canonicalize(Directory.createTemp("../target/tmp")).toString()
    try {
        for (tool in [false, true]) {
            let path = "${root}/${tool}.log"
            let log = SessionLog(path)
            log.append("user/message", "合成任务")
            let result = ModelAgentLoop().run(reasoningProbeProvider(tool), { _ => reasoningProbeProvider(false) },
                "probe", TurnToken(), log, DeliveryQueue(1000), false)
            @Expect(result.text, "可见答案")
            var assistants: Int64 = 0
            for (event in log.snapshotEvents()) {
                if (event.eventType != "assistant/message") { continue }
                let msg = JsonValue.fromStr(modelWireMessage(event.data).getOrThrow()).asObject()
                @Expect(msg["reasoning_content"].asString().getValue(), "思考\n后半段")
                @Expect(msg["content"].asString().getValue().contains("思考"), false)
                assistants += 1
            }
            @Expect(assistants, if (tool) { Int64(2) } else { Int64(1) })
            @Expect(log.flush(), true)
            let replay = SessionLog(path)
            @Expect(replay.load(), true)
            let request = JsonValue.fromStr(modelRequestJson("probe", replay.snapshotEvents().toArray())).asObject()
            var rebuilt: Int64 = 0
            for (message in request["messages"].asArray().getItems()) {
                let msg = message.asObject()
                if (msg["role"].asString().getValue() != "assistant") { continue }
                @Expect(msg["reasoning_content"].asString().getValue(), "思考\n后半段")
                rebuilt += 1
            }
            @Expect(rebuilt, assistants)
        }
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func reasoningChunkKindAndLegacyCompatibility() {
    let p = reasoningProbeProvider(false)
    @Expect(p.next().getOrThrow().kind, "reasoning")
    @Expect(p.next().getOrThrow().text, "后半段")
    @Expect(p.next().getOrThrow().text, "可见答案")
    p.close()
    let log = SessionLog("unused-reasoning.log")
    log.append("assistant/message", "旧答案")
    @Expect(modelRequestJson("probe", log.snapshotEvents().toArray()).contains("reasoning_content"), false)
    log.append("assistant/message", modelWireData(##"{"role":"assistant","content":"x","reasoning_content":42}"##))
    @ExpectThrows[Exception](modelRequestJson("probe", log.snapshotEvents().toArray()))
}
