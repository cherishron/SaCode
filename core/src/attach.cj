package core
import std.collection.*
import std.fs.*
import stdx.encoding.json.*

// 附件持久化 seam。上游契约（直读 docs/subsystems/attachment.md 与 .zh.md
// @639ed015397290b3745d163aafe02ffee4aa3f84）里这条线上成立的四条：
//   1. 会话事件与模型可见的附件块只携带引用与元数据，绝不含 blob/URL/base64；
//   2. 宿主接受用户消息后，先把它携带的对象落到 attachments/v1 下，再追加事件
//      ——「先持久化、后事件」，崩在中间只会留下没人引用的对象，不会留下
//      引用了不存在对象的消息；
//   3. AttachmentId 是不透明串，本地后端形如 sha256:<digest>；
//   4. 图片有准入额度（每消息 20 张 / 合计 200 MiB，单张 20 MiB / 64000000 像素 /
//      单边 8192 像素），通用文件按契约**没有任何准入额度**，落盘对象逐字节等于提交字节。
//
// 已知偏离（写进证据文档，不假装对上）：
// - 上游还有一个独立的规范化阶段（长边 2048、编码 4 MiB），要图像编解码器，本仓
//   没有，所以超限一律拒绝而不是缩小后收下，落盘存的是源图原样；
// - webp 的三种 RIFF 变体尺寸读法本机没有可核验的真夹具，本切片只认 png/jpeg/gif，
//   webp 仍可作为通用文件附件上传；
// - 上游把引用放进「拥有它的那条用户消息」内部。本仓的模型可见事件类型集合是不变量 7
//   冻住的五类，`user/message` 的正文要维持纯文本（标题投影直接取它），所以引用落成
//   紧邻其前的一条 log-only `attachment/record`：信息同一条消息一份，顺序同一条规则。

// 图片准入额度：上游称 deployment-resolved limits，档位由调用方注入，
// 默认值就是上游本地后端那一档。
public class AttachmentLimits {
    public let maxImageBytes: Int64
    public let maxImagesPerMessage: Int64
    public let maxMessageImageBytes: Int64
    public let maxImagePixels: Int64
    public let maxImageDimension: Int64

    public init(maxImageBytes: Int64, maxImagesPerMessage: Int64, maxMessageImageBytes: Int64, maxImagePixels: Int64, maxImageDimension: Int64) {
        this.maxImageBytes = maxImageBytes
        this.maxImagesPerMessage = maxImagesPerMessage
        this.maxMessageImageBytes = maxMessageImageBytes
        this.maxImagePixels = maxImagePixels
        this.maxImageDimension = maxImageDimension
    }

    public static func localBackend(): AttachmentLimits {
        return AttachmentLimits(Int64(20971520), Int64(20), Int64(209715200), Int64(64000000), Int64(8192))
    }
}

// 一条不可变引用。宿主只认它，不认字节。
public class AttachmentRef {
    public let attachmentId: String
    public let kind: String
    public let mediaType: String
    public let bytes: Int64
    public let width: Int64
    public let height: Int64
    public let name: String

    public init(attachmentId: String, kind: String, mediaType: String, bytes: Int64, width: Int64, height: Int64, name: String) {
        this.attachmentId = attachmentId
        this.kind = kind
        this.mediaType = mediaType
        this.bytes = bytes
        this.width = width
        this.height = height
        this.name = name
    }

    public func toJsonObject(): JsonObject {
        let obj = JsonObject()
        obj.put("attachmentId", JsonString(attachmentId))
        obj.put("kind", JsonString(kind))
        obj.put("bytes", JsonInt(bytes))
        if (mediaType.size > 0) {
            obj.put("mediaType", JsonString(mediaType))
        }
        if (kind == "image") {
            obj.put("width", JsonInt(width))
            obj.put("height", JsonInt(height))
        }
        if (name.size > 0) {
            obj.put("name", JsonString(name))
        }
        return obj
    }

    public func toJson(): String {
        return toJsonObject().toString()
    }
}

public class ImageInput {
    public let data: Array<Byte>
    public let mediaType: String
    public let name: String

    public init(data: Array<Byte>, mediaType: String, name: String) {
        this.data = data
        this.mediaType = mediaType
        this.name = name
    }
}

func byteAt(data: Array<Byte>, i: Int64): Int64 {
    return Int64(data[i])
}

func be16(data: Array<Byte>, at: Int64): Int64 {
    return byteAt(data, at) * 256 + byteAt(data, at + 1)
}

func le16(data: Array<Byte>, at: Int64): Int64 {
    return byteAt(data, at) + byteAt(data, at + 1) * 256
}

func be32(data: Array<Byte>, at: Int64): Int64 {
    return byteAt(data, at) * 16777216 + byteAt(data, at + 1) * 65536
        + byteAt(data, at + 2) * 256 + byteAt(data, at + 3)
}

func isPng(data: Array<Byte>): Bool {
    let sig = [137, 80, 78, 71, 13, 10, 26, 10]
    if (Int64(data.size) < 24) { return false }
    for (i in 0..8) {
        if (byteAt(data, Int64(i)) != sig[i]) { return false }
    }
    return byteAt(data, 12) == 73 && byteAt(data, 13) == 72 && byteAt(data, 14) == 68 && byteAt(data, 15) == 82
}

func isGif(data: Array<Byte>): Bool {
    if (Int64(data.size) < 10) { return false }
    return byteAt(data, 0) == 71 && byteAt(data, 1) == 73 && byteAt(data, 2) == 70
        && byteAt(data, 3) == 56 && (byteAt(data, 4) == 55 || byteAt(data, 4) == 57)
        && byteAt(data, 5) == 97
}

// JPEG 必须逐段走：变长段（DQT/DHT/COM…）会顶掉固定的 SOF 位置。
// SOF0..SOF15 里 0xC4/0xC8/0xCC 不是帧头（DHT/JPEG-LS/DHT），要按段长跳过。
func jpegSize(data: Array<Byte>): (Int64, Int64) {
    let n = Int64(data.size)
    var i = Int64(2)
    while (i + 4 <= n) {
        if (byteAt(data, i) != 255) { break }
        let marker = byteAt(data, i + 1)
        if (marker == 255) {
            i += 1
            continue
        }
        if (marker == 216 || marker == 1 || (marker >= 208 && marker <= 215)) {
            i += 1
            continue
        }
        if (marker >= 192 && marker <= 208 && marker != 196 && marker != 200 && marker != 204) {
            if (i + 10 > n) { break }
            return (be16(data, i + 7), be16(data, i + 5))
        }
        let segLen = be16(data, i + 2)
        if (segLen < 2) { break }
        i += 2 + segLen
    }
    return (Int64(0), Int64(0))
}

// 从字节头部认出真实类型与固有宽高；认不出来交回空串，由调用方按「声明不符」处理。
// 上游是整幅解码后取固有尺寸，本仓没有解码器，所以只读容器头部字段——
// 这也正是为什么声明与魔数不符必须先拒：照声明类型去读会读出垃圾。
func sniffImage(data: Array<Byte>): (String, Int64, Int64) {
    if (isPng(data)) { return ("image/png", be32(data, 16), be32(data, 20)) }
    if (isGif(data)) { return ("image/gif", le16(data, 6), le16(data, 8)) }
    if (Int64(data.size) >= 4 && byteAt(data, 0) == 255 && byteAt(data, 1) == 216) {
        let (w, h) = jpegSize(data)
        if (w > 0 && h > 0) { return ("image/jpeg", w, h) }
    }
    return ("", Int64(0), Int64(0))
}

func supportedMedia(mime: String): Bool {
    return mime == "image/png" || mime == "image/jpeg" || mime == "image/gif"
}

// 显示名只留文件名本身：上游明说 name 不得被当成本地路径解释，
// 事件里也就不能出现任何路径段。
func displayNameOf(name: String): String {
    let bytes = name.toArray()
    var keep = Int64(0)
    var i = Int64(0)
    for (b in bytes) {
        i += 1
        if (Int64(b) == 47 || Int64(b) == 92) { keep = i }
    }
    let out = ArrayList<Byte>()
    i = Int64(0)
    for (b in bytes) {
        i += 1
        if (i > keep) { out.add(b) }
    }
    return String.fromUtf8(out.toArray())
}

// 引用只当不透明串用，但它是从界面/对端递进来的，所以在这里验一次形态：
// 对象名就是摘要本身，混进分隔符或点号就等于把目录穿越交给外来串。
func digestOfId(attachmentId: String): String {
    if (!attachmentId.startsWith("sha256:")) {
        throw Exception("attachment-bad-id")
    }
    let hex = attachmentId[7..attachmentId.size]
    if (Int64(hex.size) != 64) {
        throw Exception("attachment-bad-id")
    }
    for (c in hex) {
        let n = Int64(c)
        let ok = (n >= 48 && n <= 57) || (n >= 97 && n <= 102)
        if (!ok) {
            throw Exception("attachment-bad-id")
        }
    }
    return hex
}

public class AttachmentStore {
    let dir: String
    let log: SessionLog
    let limits: AttachmentLimits
    static let RECORD_EVENT = "attachment/record"

    public init(dir: String, log: SessionLog, limits: AttachmentLimits) {
        this.dir = dir
        this.log = log
        this.limits = limits
    }

    // 先全量校验再整体发布：上游要求「拒绝时不留半个对象」，所以校验与落盘分成两段。
    public func saveImages(inputs: ArrayList<ImageInput>): ArrayList<AttachmentRef> {
        let refs = ArrayList<AttachmentRef>()
        var total = Int64(0)
        for (input in inputs) {
            let ref = admitImage(input)
            total += ref.bytes
            refs.add(ref)
        }
        if (Int64(refs.size) > limits.maxImagesPerMessage) {
            throw Exception("attachment-image-count-exceeded")
        }
        if (total > limits.maxMessageImageBytes) {
            throw Exception("attachment-image-bytes-exceeded")
        }
        for (i in 0..Int64(refs.size)) {
            persist(digestOfId(refs[i].attachmentId), inputs[i].data)
        }
        return refs
    }

    public func saveImage(data: Array<Byte>, mediaType: String, name: String): AttachmentRef {
        let refs = ArrayList<ImageInput>()
        refs.add(ImageInput(data, mediaType, name))
        return saveImages(refs)[0]
    }

    // 通用文件按契约没有任何准入额度：任意内容与长度都收，落盘对象逐字节等于提交字节。
    public func saveFile(data: Array<Byte>, name: String): AttachmentRef {
        let digest = sha256Hex(data)
        persist(digest, data)
        return AttachmentRef("sha256:${digest}", "file", "", Int64(data.size), Int64(0), Int64(0), displayNameOf(name))
    }

    // 每一次权威读都要复核摘要：引用说什么是什么，不能信对象名。
    public func read(attachmentId: String): Array<Byte> {
        let digest = digestOfId(attachmentId)
        let path = "${dir}/${digest}"
        if (!exists(path)) {
            throw Exception("attachment-missing-object")
        }
        let data = File.readFrom(path)
        if (sha256Hex(data) != digest) {
            throw Exception("attachment-corrupt-object")
        }
        return data
    }

    // 宿主对象位置只对「本后端是宿主文件后端」这一事实负责：能不能被模型工具读到，
    // 由当前执行文件系统另行判断，这里不替它下结论。
    public func hostPath(attachmentId: String): String {
        return "${dir}/${digestOfId(attachmentId)}"
    }

    // 引用随消息落地：先有对象（save* 已落盘）再有引用事件，再有那条用户消息。
    public func commitMessage(text: String, refs: ArrayList<AttachmentRef>): Unit {
        let arr = JsonArray()
        for (ref in refs) {
            arr.add(ref.toJsonObject())
        }
        log.append(RECORD_EVENT, arr.toString())
        log.append("user/message", text)
    }

    public func entries(): ArrayList<String> {
        let out = ArrayList<String>()
        for (event in log.snapshotEvents()) {
            if (event.eventType == RECORD_EVENT) {
                out.add(event.data)
            }
        }
        return out
    }

    // 投影：引用事件服务的是紧跟其后的那条用户消息。尾部截断只剩孤儿引用时交回空清单，
    // 不能凭空配对出一条消息来。
    public func refsForMessage(): ArrayList<AttachmentRef> {
        let out = ArrayList<AttachmentRef>()
        var pending = ArrayList<AttachmentRef>()
        for (event in log.snapshotEvents()) {
            if (event.eventType == RECORD_EVENT) {
                pending = parseRefs(event.data)
            } else if (event.eventType == "user/message") {
                out.clear()
                for (ref in pending) {
                    out.add(ref)
                }
                pending = ArrayList<AttachmentRef>()
            }
        }
        return out
    }

    private func admitImage(input: ImageInput): AttachmentRef {
        if (!supportedMedia(input.mediaType)) {
            throw Exception("attachment-unsupported-media-type")
        }
        let sniffed = sniffImage(input.data)
        if (sniffed[0] != input.mediaType) {
            throw Exception("attachment-media-type-mismatch")
        }
        let len = Int64(input.data.size)
        if (len > limits.maxImageBytes) {
            throw Exception("attachment-image-too-large")
        }
        if (sniffed[1] > limits.maxImageDimension || sniffed[2] > limits.maxImageDimension) {
            throw Exception("attachment-image-dimension-exceeded")
        }
        if (sniffed[1] * sniffed[2] > limits.maxImagePixels) {
            throw Exception("attachment-image-pixels-exceeded")
        }
        let digest = sha256Hex(input.data)
        return AttachmentRef("sha256:${digest}", "image", input.mediaType, len, sniffed[1], sniffed[2], displayNameOf(input.name))
    }

    private func persist(digest: String, data: Array<Byte>): Unit {
        if (!exists(dir)) {
            Directory.create(dir, recursive: true)
        }
        let path = "${dir}/${digest}"
        // 内容寻址：同内容同对象，已存在就什么都不做（既不复制也不覆盖）。
        if (!exists(path)) {
            publishNewFile(path, data)
        }
    }

    private func parseRefs(data: String): ArrayList<AttachmentRef> {
        let out = ArrayList<AttachmentRef>()
        let arr = JsonValue.fromStr(data).asArray()
        var i = Int64(0)
        while (true) {
            if (let Some(item) <- arr.get(i)) {
                let obj = item.asObject()
                out.add(AttachmentRef(
                    strField(obj, "attachmentId"), strField(obj, "kind"), strField(obj, "mediaType"),
                    intField(obj, "bytes"), intField(obj, "width"), intField(obj, "height"), strField(obj, "name")))
                i += 1
            } else {
                break
            }
        }
        return out
    }

    private func strField(obj: JsonObject, key: String): String {
        if (let Some(v) <- obj.get(key)) {
            return v.asString().getValue()
        }
        return ""
    }

    private func intField(obj: JsonObject, key: String): Int64 {
        if (let Some(v) <- obj.get(key)) {
            return v.asInt().getValue()
        }
        return Int64(0)
    }
}
