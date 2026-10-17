package core

import stdx.encoding.json.*
import stdx.encoding.base64.*

// 只接受任务清单中的路径与前/后侧，不接受对象 ID 或磁盘路径作为读取授权。
func executionReviewFile(service: ExecutionService, store: AttachmentStore, sessionId: String, id: String,
    revision: Int64, path: String, side: String): String {
    let state = service.describe(id)
    if (state.sessionId != sessionId || state.revision != revision) {
        throw Exception("revision-conflict")
    }
    let review = service.review(id)
    if (review.size == 0) {
        throw Exception("workspace-review-missing")
    }
    let files = JsonValue.fromStr(review).asObject().get("files").getOrThrow().asArray()
    var index: Int64 = 0
    while (let Some(item) <- files.get(index)) {
        let row = item.asObject()
        index += 1
        if (row.get("path").getOrThrow().asString().getValue() != path) {
            continue
        }
        let objectId = row.get(side + "Object").getOrThrow().asString().getValue()
        let digest = row.get(side + "Digest").getOrThrow().asString().getValue()
        let result = JsonObject()
        result.put("version", JsonInt(1));
        result.put("sessionId", JsonString(sessionId))
        result.put("executionId", JsonString(id));
        result.put("revision", JsonInt(revision))
        result.put("path", JsonString(path));
        result.put("side", JsonString(side))
        result.put("sha256", JsonString(digest));
        result.put("exists", JsonBool(objectId.size > 0))
        var data: Array<Byte> = []
        if (objectId.size > 0) {
            if (objectId != "sha256:" + digest) {
                throw Exception("workspace-review-object-corrupt")
            }
            data = store.read(objectId)
            if (sha256Hex(data) != digest || data.size > 8388608) {
                throw Exception("workspace-review-object-corrupt")
            }
        } else if (digest.size != 0) {
            throw Exception("workspace-review-object-corrupt")
        }
        let count = if (data.size > 65536) {
            Int64(65536)
        } else {
            Int64(data.size)
        }
        result.put("totalBytes", JsonInt(Int64(data.size)));
        result.put("returnedBytes", JsonInt(count))
        result.put("truncated", JsonBool(Int64(data.size) > count))
        result.put("data", JsonString(toBase64String(data[0..count])))
        return result.toString()
    }
    throw Exception("workspace-review-path-not-recorded")
}
