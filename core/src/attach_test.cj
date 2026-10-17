package core
import std.collection.*
import std.fs.*
import std.unittest.*

// 附件上游契约（本次直读 docs/subsystems/attachment.md + .zh.md
// @639ed015397290b3745d163aafe02ffee4aa3f84 所得，原文 18168/17766 字节全正文）：
// 1. 会话事件与模型可见的附件块只含引用与元数据，绝不含 blob/URL/base64；
// 2. 宿主接受用户消息后，先把它携带的图片落到 attachments/v1 下，再追加用户事件
//    （先持久化、后事件）；
// 3. AttachmentId 是不透明串，本地后端形如 sha256:<digest>，消费方不得解析它、
//    也不得据此派生路径；
// 4. 图片准入：每消息最多 20 张、编码源数据合计 200 MiB，单张源图 20 MiB、
//    64000000 像素、单边 8192 像素；
// 5. 通用文件按契约**没有任何准入上限**：任意内容与长度，落盘对象逐字节等于提交的字节；
// 6. 批量图片先校验每一个成员再发布整批（拒绝时不留半个对象）；
// 7. 引用登记与 GC 与会话生命周期无关（续跑/分叉会话可共享对象）。
//
// 已知偏离（都在证据文档里单列，不假装对上）：
// - 上游的规范化阶段（长边 2048、编码 4 MiB）要图像编解码器，本仓没有，
//   所以按「准入上限照抄、超限直接拒」处理，落盘存源图原样；
// - image/webp 的 RIFF 变体（VP8/VP8L/VP8X）尺寸读法本机没有可核验的真夹具，
//   本切片只认 png/jpeg/gif；webp 仍可作为通用文件附件上传。
//
// 抛断写法统一用「赋值的 try/catch」而不是把 lambda 塞进 @Expect：
// @Expect 宏自己按逗号切表达式，遇到 `() =>` 会解到 unclosed delimiter。

func pngBytes(width: Int64, height: Int64): Array<Byte> {
    let out = ArrayList<Byte>()
    for (v in [UInt8(137), UInt8(80), UInt8(78), UInt8(71), UInt8(13), UInt8(10), UInt8(26), UInt8(10)]) { out.add(v) }
    for (v in [UInt8(0), UInt8(0), UInt8(0), UInt8(13), UInt8(73), UInt8(72), UInt8(68), UInt8(82)]) { out.add(v) }
    out.add(UInt8((width / 16777216) % 256))
    out.add(UInt8((width / 65536) % 256))
    out.add(UInt8((width / 256) % 256))
    out.add(UInt8(width % 256))
    out.add(UInt8((height / 16777216) % 256))
    out.add(UInt8((height / 65536) % 256))
    out.add(UInt8((height / 256) % 256))
    out.add(UInt8(height % 256))
    for (v in [UInt8(8), UInt8(6), UInt8(0), UInt8(0), UInt8(0), UInt8(0), UInt8(0), UInt8(0), UInt8(0)]) { out.add(v) }
    return out.toArray()
}

func gifBytes(): Array<Byte> {
    return [UInt8(71), UInt8(73), UInt8(70), UInt8(56), UInt8(57), UInt8(97), UInt8(3), UInt8(0), UInt8(2), UInt8(0), UInt8(0), UInt8(0), UInt8(0), UInt8(59)]
}

func jpegBytes(): Array<Byte> {
    return [UInt8(255), UInt8(216), UInt8(255), UInt8(192), UInt8(0), UInt8(17), UInt8(8), UInt8(0), UInt8(5), UInt8(0), UInt8(7), UInt8(3), UInt8(1), UInt8(34), UInt8(0), UInt8(2), UInt8(17), UInt8(1), UInt8(3), UInt8(17), UInt8(1)]
}

func objectCount(dir: String): Int64 {
    var n = Int64(0)
    // 「一条都没落盘」正是几组用例要证的形态，此时目录根本还没建；
    // Directory.readFrom 对不存在的目录是抛而不是交回空清单，所以先探一次。
    if (!exists(dir)) { return Int64(0) }
    for (info in Directory.readFrom(dir)) {
        if (info.isRegular()) { n += 1 }
    }
    return n
}

func newStore(dir: String, log: SessionLog): AttachmentStore {
    return AttachmentStore(dir, log, AttachmentLimits.localBackend())
}

func tightStore(dir: String, log: SessionLog, maxImageBytes: Int64, maxImages: Int64, maxAggregate: Int64, maxPixels: Int64, maxDimension: Int64): AttachmentStore {
    return AttachmentStore(dir, log, AttachmentLimits(maxImageBytes, maxImages, maxAggregate, maxPixels, maxDimension))
}

// 「abc」的 sha256，由 Node crypto.createHash 算出：引用形态按上游只当不透明串比，不解析。
let ABC_DIGEST = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
let PNG2X1_DIGEST = "496b9d0c20230f204855e8ece795c15394493e4f32200f742f46f3bdd73576cf"

@Test
func attachmentFileIsContentAddressedAndStoredVerbatim() {
    let root = "core-att-verbatim"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let dir = "${root}/attachments/v1"
    let store = newStore(dir, SessionLog("${root}/session.log"))
    let ref = store.saveFile([UInt8(97), UInt8(98), UInt8(99)], "报告.txt")
    @Expect(ref.attachmentId, "sha256:${ABC_DIGEST}")
    @Expect(ref.kind, "file")
    @Expect(ref.bytes, Int64(3))
    @Expect(ref.name, "报告.txt")
    @Expect(String.fromUtf8(File.readFrom(store.hostPath(ref.attachmentId))), "abc")
    // 通用文件按契约没有任何准入上限：空内容也收，落盘对象就是提交的 0 字节。
    let empty = store.saveFile(Array<Byte>(0, repeat: UInt8(0)), "")
    @Expect(empty.bytes, Int64(0))
    @Expect(objectCount(dir), Int64(2))
    removeIfExists(root, recursive: true)
}

@Test
func attachmentSameBytesDedupToOneObjectAcrossSessions() {
    let root = "core-att-dedup"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let dir = "${root}/attachments/v1"
    let first = newStore(dir, SessionLog("${root}/a.log")).saveFile([UInt8(97), UInt8(98), UInt8(99)], "一.txt")
    let second = newStore(dir, SessionLog("${root}/b.log")).saveFile([UInt8(97), UInt8(98), UInt8(99)], "二.txt")
    @Expect(first.attachmentId, second.attachmentId)
    @Expect(objectCount(dir), Int64(1))
    removeIfExists(root, recursive: true)
}

@Test
func attachmentReadVerifiesDigestAndRejectsCorruption() {
    let root = "core-att-corrupt"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let dir = "${root}/attachments/v1"
    let store = newStore(dir, SessionLog("${root}/session.log"))
    let ref = store.saveFile([UInt8(97), UInt8(98), UInt8(99)], "x")
    let clean = store.read(ref.attachmentId)
    @Expect(clean.size, Int64(3))
    let path = store.hostPath(ref.attachmentId)
    File.writeTo(path, [UInt8(122), UInt8(122), UInt8(122)])
    var code = ""
    try {
        let sunk = store.read(ref.attachmentId)
        code = "no-throw:${sunk.size}"
    } catch (e: Exception) {
        code = e.message
    }
    @Expect(code, "attachment-corrupt-object")
    var missing = ""
    try {
        let sunk = store.read("sha256:0000000000000000000000000000000000000000000000000000000000000000")
        missing = "no-throw:${sunk.size}"
    } catch (e: Exception) {
        missing = e.message
    }
    @Expect(missing, "attachment-missing-object")
    removeIfExists(root, recursive: true)
}

@Test
func attachmentImageRefCarriesVerifiedTypeAndDimensions() {
    let root = "core-att-image"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let store = newStore("${root}/attachments/v1", SessionLog("${root}/session.log"))
    let png = store.saveImage(pngBytes(2, 1), "image/png", "a.png")
    @Expect(png.attachmentId, "sha256:${PNG2X1_DIGEST}")
    @Expect(png.kind, "image")
    @Expect(png.mediaType, "image/png")
    @Expect(png.width, Int64(2))
    @Expect(png.height, Int64(1))
    @Expect(png.bytes, Int64(33))
    let gif = store.saveImage(gifBytes(), "image/gif", "b.gif")
    @Expect(gif.width, Int64(3))
    @Expect(gif.height, Int64(2))
    let jpg = store.saveImage(jpegBytes(), "image/jpeg", "c.jpg")
    @Expect(jpg.width, Int64(7))
    @Expect(jpg.height, Int64(5))
    removeIfExists(root, recursive: true)
}

@Test
func attachmentImageRejectsTypeMismatchAndUnknownType() {
    let root = "core-att-mismatch"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let dir = "${root}/attachments/v1"
    let store = newStore(dir, SessionLog("${root}/session.log"))
    // 字节是 PNG 却说自己是 JPEG：照声明类型去读宽高会读出垃圾，必须先拒。
    var mismatch = ""
    try {
        let sunk = store.saveImage(pngBytes(2, 1), "image/jpeg", "x")
        mismatch = "no-throw:${sunk.attachmentId}"
    } catch (e: Exception) {
        mismatch = e.message
    }
    @Expect(mismatch, "attachment-media-type-mismatch")
    var notImage = ""
    try {
        let sunk = store.saveImage([UInt8(1), UInt8(2), UInt8(3)], "image/png", "x")
        notImage = "no-throw:${sunk.attachmentId}"
    } catch (e: Exception) {
        notImage = e.message
    }
    @Expect(notImage, "attachment-media-type-mismatch")
    var unsupported = ""
    try {
        let sunk = store.saveImage(gifBytes(), "image/webp", "x")
        unsupported = "no-throw:${sunk.attachmentId}"
    } catch (e: Exception) {
        unsupported = e.message
    }
    @Expect(unsupported, "attachment-unsupported-media-type")
    @Expect(objectCount(dir), Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func attachmentImageSourceCapsRejectBeforePersisting() {
    let root = "core-att-caps"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let dir = "${root}/attachments/v1"
    let log = SessionLog("${root}/session.log")
    var tooLarge = ""
    try {
        let sunk = tightStore(dir, log, Int64(8), Int64(20), Int64(209715200), Int64(64000000), Int64(8192))
            .saveImage(pngBytes(2, 1), "image/png", "x")
        tooLarge = "no-throw:${sunk.attachmentId}"
    } catch (e: Exception) {
        tooLarge = e.message
    }
    @Expect(tooLarge, "attachment-image-too-large")
    @Expect(objectCount(dir), Int64(0))
    var tooWide = ""
    try {
        let sunk = tightStore(dir, log, Int64(20971520), Int64(20), Int64(209715200), Int64(64000000), Int64(100))
            .saveImage(pngBytes(9000, 1), "image/png", "x")
        tooWide = "no-throw:${sunk.attachmentId}"
    } catch (e: Exception) {
        tooWide = e.message
    }
    @Expect(tooWide, "attachment-image-dimension-exceeded")
    var tooManyPixels = ""
    try {
        let sunk = tightStore(dir, log, Int64(20971520), Int64(20), Int64(209715200), Int64(5000), Int64(8192))
            .saveImage(pngBytes(100, 100), "image/png", "x")
        tooManyPixels = "no-throw:${sunk.attachmentId}"
    } catch (e: Exception) {
        tooManyPixels = e.message
    }
    @Expect(tooManyPixels, "attachment-image-pixels-exceeded")
    @Expect(objectCount(dir), Int64(0))
    @Expect(log.eventCount(), Int64(0))
    // 上游默认档位本身也要钉住，否则「注入小值能跑」掩盖了默认值写错
    let defaults = AttachmentLimits.localBackend()
    @Expect(defaults.maxImageBytes, Int64(20971520))
    @Expect(defaults.maxImagesPerMessage, Int64(20))
    @Expect(defaults.maxMessageImageBytes, Int64(209715200))
    @Expect(defaults.maxImagePixels, Int64(64000000))
    @Expect(defaults.maxImageDimension, Int64(8192))
    removeIfExists(root, recursive: true)
}

@Test
func attachmentImageBatchValidatesEveryMemberBeforePersistingAny() {
    let root = "core-att-batch"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let dir = "${root}/attachments/v1"
    let store = newStore(dir, SessionLog("${root}/session.log"))
    let broken = ArrayList<ImageInput>()
    broken.add(ImageInput(pngBytes(2, 1), "image/png", "好图.png"))
    broken.add(ImageInput([UInt8(1), UInt8(2), UInt8(3)], "image/png", "坏图.png"))
    var rejected = ""
    try {
        let sunk = store.saveImages(broken)
        rejected = "no-throw:${sunk.size}"
    } catch (e: Exception) {
        rejected = e.message
    }
    @Expect(rejected, "attachment-media-type-mismatch")
    // 第二个成员坏掉，第一个也不能留在盘上占位
    @Expect(objectCount(dir), Int64(0))
    let good = ArrayList<ImageInput>()
    good.add(ImageInput(pngBytes(2, 1), "image/png", "好图.png"))
    good.add(ImageInput(gifBytes(), "image/gif", "动图.gif"))
    let refs = store.saveImages(good)
    @Expect(refs.size, Int64(2))
    @Expect(refs[0].attachmentId, "sha256:${PNG2X1_DIGEST}")
    @Expect(objectCount(dir), Int64(2))
    removeIfExists(root, recursive: true)
}

@Test
func attachmentPerMessageCountAndAggregateBytes() {
    let root = "core-att-permsg"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let dir = "${root}/attachments/v1"
    let log = SessionLog("${root}/session.log")
    let pair = ArrayList<ImageInput>()
    pair.add(ImageInput(pngBytes(2, 1), "image/png", "一.png"))
    pair.add(ImageInput(gifBytes(), "image/gif", "二.gif"))
    var overCount = ""
    try {
        let sunk = tightStore(dir, log, Int64(20971520), Int64(1), Int64(209715200), Int64(64000000), Int64(8192))
            .saveImages(pair)
        overCount = "no-throw:${sunk.size}"
    } catch (e: Exception) {
        overCount = e.message
    }
    @Expect(overCount, "attachment-image-count-exceeded")
    @Expect(objectCount(dir), Int64(0))
    // 条数放行，但整批编码字节超了每消息额度
    var overBytes = ""
    try {
        let sunk = tightStore(dir, log, Int64(20971520), Int64(20), Int64(20), Int64(64000000), Int64(8192))
            .saveImages(pair)
        overBytes = "no-throw:${sunk.size}"
    } catch (e: Exception) {
        overBytes = e.message
    }
    @Expect(overBytes, "attachment-image-bytes-exceeded")
    @Expect(objectCount(dir), Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func attachmentCommitPersistsBeforeEventAndCarriesNoBlob() {
    let root = "core-att-commit"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let dir = "${root}/attachments/v1"
    let log = SessionLog("${root}/session.log")
    let store = newStore(dir, log)
    let refs = ArrayList<AttachmentRef>()
    refs.add(store.saveImage(pngBytes(2, 1), "image/png", "/etc/宿主机路径.png"))
    // 先持久化：一条事件都还没写，对象已经在盘上了
    @Expect(log.eventCount(), Int64(0))
    @Expect(objectCount(dir), Int64(1))
    store.commitMessage("看下这张图", refs)
    let events = log.snapshotEvents()
    @Expect(events.size, Int64(2))
    @Expect(events[0].eventType, "attachment/record")
    @Expect(events[1].eventType, "user/message")
    @Expect(events[1].data, "看下这张图")
    // 事件只含引用与元数据：既没有 base64 载荷，也没有宿主路径
    @Expect(events[0].data.contains(PNG2X1_DIGEST), true)
    @Expect(events[0].data.contains("image/png"), true)
    @Expect(events[0].data.contains("iVBOR"), false)
    @Expect(events[0].data.contains(dir), false)
    // 显示名只留文件名本身：路径段不能进事件
    @Expect(events[0].data.contains("宿主机路径.png"), true)
    @Expect(events[0].data.contains("/etc"), false)
    // 引用事件不进模型可见历史（不变量 7 冻的那五类）
    @Expect(log.deriveMessages().size, Int64(1))
    @Expect(log.deriveMessages()[0], "user/message: 看下这张图")
    @Expect(exists(store.hostPath(refs[0].attachmentId)), true)
    removeIfExists(root, recursive: true)
}

@Test
func attachmentForeignIdIsRejectedBeforeTouchingTheFilesystem() {
    let root = "core-att-badid"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let store = newStore("${root}/attachments/v1", SessionLog("${root}/session.log"))
    // 引用是从界面/对端递进来的，对象名就是摘要本身：外来串必须在这里挡掉，
    // 否则分隔符与点号等于把目录穿越交给调用方。
    var escaped = ""
    try {
        escaped = store.hostPath("../../escape")
    } catch (e: Exception) {
        escaped = "throw:${e.message}"
    }
    @Expect(escaped, "throw:attachment-bad-id")
    var shortHex = ""
    try {
        shortHex = store.hostPath("sha256:abc")
    } catch (e: Exception) {
        shortHex = "throw:${e.message}"
    }
    @Expect(shortHex, "throw:attachment-bad-id")
    var nonHex = ""
    try {
        let sunk = store.read("sha256:000000000000000000000000000000000000000000000000000000000000000g")
        nonHex = "no-throw:${sunk.size}"
    } catch (e: Exception) {
        nonHex = e.message
    }
    @Expect(nonHex, "attachment-bad-id")
    removeIfExists(root, recursive: true)
}

@Test
func attachmentRecordReplaysAndOrphanYieldsNothing() {
    let root = "core-att-replay"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let dir = "${root}/attachments/v1"
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let store = newStore(dir, log)
    let refs = ArrayList<AttachmentRef>()
    refs.add(store.saveFile([UInt8(97), UInt8(98), UInt8(99)], "附件.txt"))
    store.commitMessage("带附件的一句", refs)
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    let replayed = newStore(dir, fresh)
    let listed = replayed.entries()
    @Expect(listed.size, Int64(1))
    @Expect(listed[0].contains("附件.txt"), true)
    @Expect(listed[0].contains(ABC_DIGEST), true)
    let paired = replayed.refsForMessage()
    @Expect(paired.size, Int64(1))
    @Expect(paired[0].attachmentId, "sha256:${ABC_DIGEST}")
    // 尾部截断的形态：引用事件留下、它服务的用户消息没了。孤儿引用不得凭空配对出消息。
    let orphanPath = "${root}/orphan.log"
    File.writeTo(orphanPath, "0\tattachment/record\t${listed[0]}\n".toArray())
    let orphan = SessionLog(orphanPath)
    @Expect(orphan.load(), true)
    @Expect(orphan.eventCount(), Int64(1))
    @Expect(newStore(dir, orphan).refsForMessage().size, Int64(0))
    removeIfExists(root, recursive: true)
}
