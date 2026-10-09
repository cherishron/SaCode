package core
import std.collection.*
import std.fs.*
import std.env.getVariable
import std.unittest.*
import stdx.encoding.base64.*
import stdx.encoding.json.*

// 真 GIF 字节；测试不用伪造附件仓或会话日志。
func computerImageBytes(): Array<Byte> {
    return fromBase64String("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7").getOrThrow()
}
func computerEnvelope(mime: String, data: String): String {
    return "{\"ok\":true,\"verb\":\"screenshot\",\"content\":{\"status\":\"ready\",\"screenshot\":{\"width\":1,\"height\":1,\"filePath\":\"C:/secret.png\",\"images\":[{\"mimeType\":\"${mime}\",\"dataBase64\":\"${data}\"}]}},\"failureKind\":\"\",\"message\":\"\"}"
}
func computerImageRoot(label: String): String {
    let root = "${getVariable("TMP").getOrThrow()}/computer-security-tests/${label}"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    return root
}
func computerAssistant(): String {
    return modelWireData("{\"role\":\"assistant\",\"content\":\"\",\"tool_calls\":[{\"id\":\"one\",\"type\":\"function\",\"function\":{\"name\":\"computer.screenshot\",\"arguments\":\"{}\"}},{\"id\":\"two\",\"type\":\"function\",\"function\":{\"name\":\"other\",\"arguments\":\"{}\"}}]}")
}
@Test
func computerImageSingleAndReplaySameBytes() {
    let root = computerImageRoot("replay")
    let log = SessionLog("${root}/session.log")
    let store = AttachmentStore("${root}/objects", log, AttachmentLimits.localBackend())
    let encoded = toBase64String(computerImageBytes())
    let material = materializeComputerResult(computerEnvelope("image/gif", encoded), Some(store))
    @Expect(material.refs.size, Int64(1))
    @Expect(material.text.contains(encoded), false)
    @Expect(material.text.contains("filePath"), false)
    @Expect(material.text.contains("ready"), true)
    log.append("assistant/message", computerAssistant())
    log.append("tool/result", modelToolResultData("one", material.text, refs: material.refs))
    var refused = false
    try { modelRequestJson("vision", log.snapshotEvents().toArray(), attachStore: Some(store), supportsImages: true) } catch (_: Exception) { refused = true }
    @Expect(refused, true)
    log.append("tool/result", modelToolResultData("two", "done"))
    @Expect(log.flush(), true)
    @Expect(String.fromUtf8(File.readFrom("${root}/session.log")).contains(encoded), false)
    let first = modelRequestJson("vision", log.snapshotEvents().toArray(), attachStore: Some(store), supportsImages: true)
    let messages = JsonValue.fromStr(first).asObject()["messages"].asArray()
    @Expect(messages[1].asObject()["role"].asString().getValue(), "tool")
    @Expect(messages[2].asObject()["role"].asString().getValue(), "tool")
    @Expect(messages[3].asObject()["role"].asString().getValue(), "user")
    @Expect(first.contains("\"attachments\""), false)
    @Expect(first.contains("data:image/gif;base64,${encoded}"), true)
    let replay = SessionLog("${root}/session.log")
    replay.load()
    let reopened = AttachmentStore("${root}/objects", replay, AttachmentLimits.localBackend())
    @Expect(modelRequestJson("vision", replay.snapshotEvents().toArray(), attachStore: Some(reopened), supportsImages: true), first)
}
@Test
func computerImageVisionAndStoreRequired() {
    let root = computerImageRoot("gates")
    let log = SessionLog("${root}/session.log")
    let store = AttachmentStore("${root}/objects", log, AttachmentLimits.localBackend())
    let material = materializeComputerResult(computerEnvelope("image/gif", toBase64String(computerImageBytes())), Some(store))
    log.append("assistant/message", computerAssistant())
    log.append("tool/result", modelToolResultData("one", material.text, refs: material.refs))
    log.append("tool/result", modelToolResultData("two", "done"))
    var noVision = false
    var noStore = false
    try { modelRequestJson("text", log.snapshotEvents().toArray(), attachStore: Some(store)) } catch (_: Exception) { noVision = true }
    try { modelRequestJson("vision", log.snapshotEvents().toArray(), supportsImages: true) } catch (_: Exception) { noStore = true }
    @Expect(noVision, true)
    @Expect(noStore, true)
}
@Test
func computerImageRejectsBadInputsWithoutLeakingPayload() {
    let root = computerImageRoot("reject")
    let store = AttachmentStore("${root}/objects", SessionLog("${root}/session.log"), AttachmentLimits.localBackend())
    for ((mime, data) in [("image/webp", "c2VjcmV0"), ("image/gif", "not!base64"), ("image/png", toBase64String(computerImageBytes()))]) {
        let result = materializeComputerResult(computerEnvelope(mime, data), Some(store))
        @Expect(result.refs.size, Int64(0))
        @Expect(JsonValue.fromStr(result.text).asObject()["ok"].asBool().getValue(), false)
        @Expect(result.text.contains(data), false)
    }
    let absent = materializeComputerResult(computerEnvelope("image/gif", toBase64String(computerImageBytes())), None)
    @Expect(absent.refs.size, Int64(0))
    @Expect(JsonValue.fromStr(absent.text).asObject()["ok"].asBool().getValue(), false)
    @Expect(exists("${root}/objects"), false)
}
@Test
func computerImageNoImagesPreservesParsedStatus() {
    let raw = "{ \"ok\":false, \"content\":{\"status\":\"denied\"} }"
    let safe = JsonValue.fromStr(materializeComputerResult(raw, None).text).asObject()
    @Expect(safe["ok"].asBool().getValue(), false)
    @Expect(safe["content"].asObject()["status"].asString().getValue(), "denied")
}

@Test
func computerImageEveryNoScreenshotExitRecursivelySanitizes() {
    // 标记和路径都是人工夹具，不包含真实凭证或用户截图。
    let nested = ##"{"operation":{"committed":true},"nested":[{"dataBase64":"fixture-payload","filePath":"C:/fixture-only.png","keep":[1,true,null]}]}"##
    for (raw in ["{\"ok\":true,\"metadata\":${nested}}",
        "{\"ok\":false,\"content\":${nested}}",
        "{\"ok\":true,\"content\":{\"screenshot\":{\"width\":1},\"other\":${nested}}}",
        "{\"ok\":true,\"content\":{\"screenshot\":{\"images\":[]},\"other\":${nested}}}"]) {
        let result = materializeComputerResult(raw, None)
        @Expect(result.refs.size, Int64(0))
        @Expect(result.text.contains("dataBase64"), false)
        @Expect(result.text.contains("filePath"), false)
        @Expect(result.text.contains("fixture-payload"), false)
        @Expect(result.text.contains("fixture-only"), false)
        @Expect(result.text.contains("committed"), true)
        @Expect(result.text.contains("keep"), true)
    }
}

@Test
func computerImageFailurePreservesCommittedContentWithoutPayload() {
    let root = computerImageRoot("failure-content")
    let store = AttachmentStore("${root}/objects", SessionLog("${root}/session.log"), AttachmentLimits.localBackend())
    for (shot in [##"{"filePath":"C:/fixture-only.png"}"##,
        ##"{"images":[],"filePath":"C:/fixture-only.png"}"##,
        ##"{"images":[{"mimeType":"image/gif","dataBase64":"not!base64"}]}"##]) {
        let raw = "{\"ok\":true,\"content\":{\"operation\":{\"committed\":true},\"status\":\"sent\",\"nested\":[{\"filePath\":\"C:/fixture-only.png\",\"dataBase64\":\"fixture-payload\"}],\"screenshot\":${shot}}}"
        let result = materializeComputerResult(raw, Some(store))
        let failure = JsonValue.fromStr(result.text).asObject()
        @Expect(result.refs.size, Int64(0))
        @Expect(failure["ok"].asBool().getValue(), false)
        @Expect(failure["failureKind"].asString().getValue(), "computer-image-materialization-failed")
        @Expect(failure.containsKey("content"), true)
        if (let Some(content) <- failure.get("content")) {
            @Expect(content.asObject()["operation"].asObject()["committed"].asBool().getValue(), true)
            @Expect(content.asObject()["status"].asString().getValue(), "sent")
        }
        @Expect(result.text.contains("dataBase64"), false)
        @Expect(result.text.contains("filePath"), false)
        @Expect(result.text.contains("fixture-payload"), false)
    }
}
@Test
func computerImageCorruptObjectRejected() {
    let root = computerImageRoot("corrupt")
    let log = SessionLog("${root}/session.log")
    let store = AttachmentStore("${root}/objects", log, AttachmentLimits.localBackend())
    let material = materializeComputerResult(computerEnvelope("image/gif", toBase64String(computerImageBytes())), Some(store))
    log.append("assistant/message", computerAssistant())
    log.append("tool/result", modelToolResultData("one", material.text, refs: material.refs))
    log.append("tool/result", modelToolResultData("two", "done"))
    for (ref in material.refs) { File.writeTo(store.hostPath(ref.attachmentId), "broken".toArray()) }
    var refused = false
    try { modelRequestJson("vision", log.snapshotEvents().toArray(), attachStore: Some(store), supportsImages: true) } catch (e: Exception) { refused = e.message == "attachment-corrupt-object" }
    @Expect(refused, true)
}
