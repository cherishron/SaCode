package core
import std.collection.ArrayList
import stdx.encoding.base64.*
import stdx.encoding.json.*

public class ComputerImageResult {
    public let text: String
    public let refs: ArrayList<AttachmentRef>
    public init(text: String, refs: ArrayList<AttachmentRef>) {
        this.text = text
        this.refs = refs
    }
}

// 只消费 provider envelope 的固定截图槽；路径永远不作为输入。
// 失败信息不回显解析器/文件系统异常，防止异常消息携带原始截图或本地路径。
public func materializeComputerResult(result: String, store: ?AttachmentStore): ComputerImageResult {
    let empty = ArrayList<AttachmentRef>()
    try {
        let envelope = JsonValue.fromStr(result).asObject()
        if (let Some(content) <- envelope.get("content")) {
            if (let Some(screenshot) <- content.asObject().get("screenshot")) {
                let shot = screenshot.asObject()
                if (let Some(images) <- shot.get("images")) {
                    let inputs = ArrayList<ImageInput>()
                    let values = images.asArray()
                    var i = Int64(0)
                    while (let Some(value) <- values.get(i)) {
                        let image = value.asObject()
                        let mime = image.get("mimeType").getOrThrow().asString().getValue()
                        if (!supportedMedia(mime)) { throw Exception("computer-image-unsupported-media") }
                        let encoded = image.get("dataBase64").getOrThrow().asString().getValue()
                        let bytes = fromBase64String(encoded).getOrThrow()
                        // 非规范编码也拒绝：避免宽松解码器忽略非法字符或尾部。
                        if (toBase64String(bytes) != encoded) { throw Exception("computer-image-bad-base64") }
                        inputs.add(ImageInput(bytes, mime, ""))
                        i += 1
                    }
                    if (inputs.size == 0) {
                        if (shot.containsKey("filePath")) { throw Exception("computer-image-path-only") }
                        return ComputerImageResult(computerImageSafeText(envelope, result), empty)
                    }
                    let refs = store.getOrThrow().saveImages(inputs)
                    // 去重对象也要复核，不把已经损坏的旧对象发布为有效引用。
                    for (ref in refs) { store.getOrThrow().read(ref.attachmentId) }
                    let safe = computerImageSafeJson(envelope).asObject()
                    let safeShot = safe["content"].asObject()["screenshot"].asObject()
                    let metadata = JsonArray()
                    for (ref in refs) { metadata.add(ref.toJsonObject()) }
                    safeShot.put("images", metadata)
                    return ComputerImageResult(safe.toString(), refs)
                }
                if (shot.containsKey("filePath") || shot.containsKey("dataBase64")) { throw Exception("computer-image-path-only") }
            }
        }
        return ComputerImageResult(computerImageSafeText(envelope, result), empty)
    } catch (_: Exception) {
        let failure = JsonObject()
        failure.put("ok", JsonBool(false))
        failure.put("failureKind", JsonString("computer-image-materialization-failed"))
        failure.put("message", JsonString("截图附件物化失败，动作终态不代表回滚"))
        try {
            let safe = computerImageSafeJson(JsonValue.fromStr(result)).asObject()
            if (let Some(content) <- safe.get("content")) { failure.put("content", content) }
        } catch (_: Exception) {}
        return ComputerImageResult(failure.toString(), empty)
    }
}

func computerImageSafeText(value: JsonValue, original: String): String {
    let safe = computerImageSafeJson(value).toString()
    return if (safe == value.toString()) { original } else { safe }
}

// 截图 envelope 的状态保留；禁止 base64 与路径在任意嵌套层逃进工具日志。
func computerImageSafeJson(value: JsonValue): JsonValue {
    if (let JsonKind.JsObject <- value.kind()) {
        let out = JsonObject()
        for ((key, field) in value.asObject().getFields()) {
            if (key != "dataBase64" && key != "filePath") { out.put(key, computerImageSafeJson(field)) }
        }
        return out
    }
    if (let JsonKind.JsArray <- value.kind()) {
        let out = JsonArray()
        var index = Int64(0)
        while (let Some(item) <- value.asArray().get(index)) {
            out.add(computerImageSafeJson(item))
            index += 1
        }
        return out
    }
    return value
}
