package core

import std.unittest.*
import std.collection.ArrayList
import std.fs.*
import stdx.encoding.base64.*
import stdx.encoding.json.*

// JsonArray 没有文档化的 .size，本仓一律按 get(i) 探到 None 计数（attach.cj 同法）。
func jsonCount(arr: JsonArray): Int64 {
    var n = Int64(0)
    while (true) {
        if (arr.get(n).isNone()) { break }
        n += 1
    }
    return n
}

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

// 上游口径（直读 attachment.en.md @639ed01 L5 与 L149-166）：会话事件与模型可见的
// 附件块「只含引用与元数据，绝不含 base64」，而 provider 请求侧另有一份
// RequestImageAttachment（attachment + 编码后的请求字节）。所以本仓的装配点是
// 「引用 → 请求字节」唯一发生物化的地方：日志永远是引用，请求体才带 data URL。
@Test
func modelRequestMaterializesImageRefsOnlyAtTheRequestBoundary() {
    let root = "core-mreq-att"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let store = AttachmentStore("${root}/attachments/v1", log, AttachmentLimits.localBackend())
    let png = pngBytes(Int64(2), Int64(1))
    let img = store.saveImage(png, "image/png", "a.png")
    let refs = ArrayList<AttachmentRef>()
    refs.add(img)
    store.commitMessage("看图", refs)

    let body = JsonValue.fromStr(modelRequestJson("m", log.snapshotEvents().toArray(), attachStore: store)).asObject()
    let messages = body.get("messages").getOrThrow().asArray()
    @Expect(jsonCount(messages), Int64(1))
    let content = messages.get(0).getOrThrow().asObject().get("content").getOrThrow()
    let parts = content.asArray()
    @Expect(jsonCount(parts), Int64(2))
    let textPart = parts.get(0).getOrThrow().asObject()
    @Expect(textPart.get("type").getOrThrow().asString().getValue(), "text")
    @Expect(textPart.get("text").getOrThrow().asString().getValue(), "看图")
    let imagePart = parts.get(1).getOrThrow().asObject()
    @Expect(imagePart.get("type").getOrThrow().asString().getValue(), "image_url")
    let url = imagePart.get("image_url").getOrThrow().asObject().get("url").getOrThrow().asString().getValue()
    @Expect(url == "data:image/png;base64,${toBase64String(png)}", true)
    // 反向半条：日志侧一条 base64 都不许出现——否则「唯一真源」里就混进了可膨胀的字节。
    @Expect(log.snapshotEvents()[0].data.contains("base64"), false)
    @Expect(log.snapshotEvents()[1].data.contains("base64"), false)
    removeIfExists(root, recursive: true)
}

@Test
func modelRequestKeepsPlainStringContentWhenNothingIsAttached() {
    // 无附件的形态不能被新的多 part 分支带偏：历史里绝大多数消息走这条。
    let body = JsonValue.fromStr(modelRequestJson("m", [SessionEvent(0, "user/message", "只是文字")])).asObject()
    let content = body.get("messages").getOrThrow().asArray().get(0).getOrThrow().asObject().get("content").getOrThrow()
    @Expect(content.asString().getValue(), "只是文字")
}

@Test
func modelRequestRefusesRefsWithoutAStoreAndMissingObjects() {
    let root = "core-mreq-absent"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let store = AttachmentStore("${root}/attachments/v1", log, AttachmentLimits.localBackend())
    let refs = ArrayList<AttachmentRef>()
    refs.add(store.saveImage(pngBytes(Int64(2), Int64(1)), "image/png", "a.png"))
    store.commitMessage("看图", refs)
    let events = log.snapshotEvents().toArray()

    // 有引用却没有附件仓：静默丢图等于让模型看到一条被阉割的消息，必须响亮拒绝。
    var noStore = ""
    try {
        let sunk = modelRequestJson("m", events)
        noStore = "no-throw:${sunk.size}"
    } catch (e: Exception) {
        noStore = e.message
    }
    @Expect(noStore, "attachment-store-absent")

    removeIfExists(store.hostPath(refs[0].attachmentId), recursive: false)
    var missing = ""
    try {
        let sunk = modelRequestJson("m", events, attachStore: store)
        missing = "no-throw:${sunk.size}"
    } catch (e: Exception) {
        missing = e.message
    }
    @Expect(missing, "attachment-missing-object")
    removeIfExists(root, recursive: true)
}

@Test
func modelRequestDoesNotTurnGenericFilesIntoImageParts() {
    let root = "core-mreq-file"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let store = AttachmentStore("${root}/attachments/v1", log, AttachmentLimits.localBackend())
    let refs = ArrayList<AttachmentRef>()
    refs.add(store.saveFile([UInt8(1), UInt8(2), UInt8(3)], "notes.bin"))
    store.commitMessage("带个文件", refs)
    let body = JsonValue.fromStr(modelRequestJson("m", log.snapshotEvents().toArray(), attachStore: store)).asObject()
    let parts = body.get("messages").getOrThrow().asArray().get(0).getOrThrow().asObject().get("content").getOrThrow().asArray()
    // 没有 provider 侧的文件通道，就没有把任意二进制塞进 vision part 的余地；
    // 引用仍然在日志里，但请求体只交回文字那一条。
    @Expect(jsonCount(parts), Int64(1))
    @Expect(parts.get(0).getOrThrow().asObject().get("type").getOrThrow().asString().getValue(), "text")
    @Expect(log.snapshotEvents()[0].data.contains("sha256:"), true)
    removeIfExists(root, recursive: true)
}

