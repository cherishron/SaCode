package core
import std.collection.ArrayList
import std.fs.*
import std.unittest.*

@Test
func modelContinuationGatesSteeredImagesAndPreservesTheirReferences() {
    for (enabled in [false, true]) {
        let root = if (enabled) { "core-image-step-enabled" } else { "core-image-step-disabled" }
        removeIfExists(root, recursive: true)
        Directory.create(root, recursive: true)
        let log = SessionLog("${root}/session.log")
        log.append("user/message", "先规划")
        let store = AttachmentStore("${root}/attachments/v1", log, AttachmentLimits.localBackend())
        let refs = ArrayList<AttachmentRef>()
        refs.add(store.saveImage(pngBytes(Int64(2), Int64(1)), "image/png", "补充.png"))
        let inbox = AgentInbox(log)
        inbox.queue("image-step", "补充图片", "rpc-image", attachments: refs)
        inbox.steerFromQueue("image-step")
        let first = AgentChunks([
            Chunk("tool-call-delta", "{\"todos\":[]}", "", toolIndex: Some(0), toolId: Some("plan"), toolName: Some("todo_write")),
            Chunk("finish", "", "tool_calls")])
        let requests = ArrayList<String>()
        let next: (String) -> Provider = { body => requests.add(body); AgentChunks([Chunk("text", "收到", ""), Chunk("finish", "", "stop")]) }
        let result = ModelAgentLoop().run(first, next, "test", TurnToken(), log, DeliveryQueue(32), false, attach: store, supportsImages: enabled)
        @Expect(log.snapshotEvents().toArray().filter({ e => e.eventType == "attachment/record" }).size, Int64(1))
        @Expect(log.deriveMessages().contains("user/message: 补充图片"), true)
        if (enabled) {
            @Expect(requests.size, Int64(1))
            @Expect(requests[0].contains("image_url"), true)
            @Expect(result.finishReason, "stop")
        } else {
            @Expect(requests.size, Int64(0))
            @Expect(result.finishReason, "error:model-image-not-supported")
        }
        removeIfExists(root, recursive: true)
    }
}
