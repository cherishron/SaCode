package core
import std.unittest.*

@Test
func messageProjectionPairsRefsOnlyWithTheirUserAndKeepsEventIdentity() {
    let refs = "[{\"attachmentId\":\"sha256:abc\",\"kind\":\"file\",\"bytes\":3,\"name\":\"说明.txt\"}]"
    let events = [SessionEvent(3, "attachment/record", refs), SessionEvent(4, "user/message", "同文"),
        SessionEvent(5, "turn/start", ""), SessionEvent(6, "assistant/message", "答复"), SessionEvent(7, "user/message", "同文")]
    let rows = projectMessageRows(events)
    @Expect(rows.size, Int64(3))
    @Expect(rows[0].id, "event-4")
    @Expect(rows[0].line(), "user/message: 同文")
    @Expect(rows[0].attachments.size, Int64(1))
    @Expect(rows[1].attachments.size, Int64(0))
    @Expect(rows[2].attachments.size, Int64(0))
    @Expect(rows[2].id, "event-7")
    @Expect(rows[0].toJson().contains("说明.txt"), true)
    @Expect(rows[0].toJson().contains("base64"), false)
}
