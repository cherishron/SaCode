package core

import std.fs.*
import std.unittest.*
import stdx.encoding.base64.*
import stdx.encoding.json.*

@Test
func computerProjectionToolImagesAuthorizeOnlyLoggedSessionAndReplay() {
    let root = computerImageRoot("projection")
    let log = SessionLog("${root}/session.log")
    let store = AttachmentStore("${root}/objects", log, AttachmentLimits.localBackend())
    let encoded = toBase64String(computerImageBytes())
    let material = materializeComputerResult(computerEnvelope("image/gif", encoded), Some(store))
    @Expect(material.refs.size, Int64(1))
    for (ref in material.refs) {
        var refused = false
        try { sessionImageJson(log, store, ref.attachmentId) } catch (e: Exception) { refused = e.message == "attachment-image-not-referenced" }
        @Expect(refused, true)
        log.append("computer/exec", "{}")
        log.append("tool/result", modelToolResultData("one", material.text, refs: material.refs))
        // 同正文不携带引用的另一条工具结果不能继承附件。
        log.append("tool/result", modelToolResultData("two", material.text))
        let rows = projectMessageRows(log.snapshotEvents().toArray())
        @Expect(rows.size, Int64(2))
        if (rows.size == 2) {
            @Expect(rows[0].id, "event-1")
            @Expect(rows[0].text, material.text)
            @Expect(rows[0].attachments.size, Int64(1))
            for (picked in rows[0].attachments) { @Expect(picked.attachmentId, ref.attachmentId) }
            @Expect(rows[1].attachments.size, Int64(0))
        }
        // 绿态读取必须返回原对象字节；红态预期拒绝，不转成 ERROR 桶。
        var authorized = false
        try {
            let image = JsonValue.fromStr(sessionImageJson(log, store, ref.attachmentId)).asObject()
            authorized = image["data"].asString().getValue() == encoded && image["attachmentId"].asString().getValue() == ref.attachmentId
        } catch (_: Exception) {}
        @Expect(authorized, true)
        @Expect(log.flush(), true)
        let replay = SessionLog("${root}/session.log")
        replay.load()
        let reopened = AttachmentStore("${root}/objects", replay, AttachmentLimits.localBackend())
        var replayAuthorized = false
        try { replayAuthorized = JsonValue.fromStr(sessionImageJson(replay, reopened, ref.attachmentId)).asObject()["data"].asString().getValue() == encoded } catch (_: Exception) {}
        @Expect(replayAuthorized, true)
        let otherSession = SessionLog("${root}/other-session.log")
        var foreignRefused = false
        try { sessionImageJson(otherSession, store, ref.attachmentId) } catch (e: Exception) { foreignRefused = e.message == "attachment-image-not-referenced" }
        @Expect(foreignRefused, true)
        File.writeTo(store.hostPath(ref.attachmentId), "broken".toArray())
        var corruptRefused = false
        try { sessionImageJson(replay, reopened, ref.attachmentId) } catch (e: Exception) { corruptRefused = e.message == "attachment-corrupt-object" }
        @Expect(corruptRefused, true)
    }
}
