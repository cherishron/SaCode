package core
import std.fs.*
import std.unittest.*

// 会话标题的三条契约钉子：
// - `session/title` 是 log-only 事件，不进模型可见历史（isSurfaceEvent 白名单里没有它）。
// - 空标题拒绝写入、不落事件；非空 trim 后落 source="user"。
// - provider 是单槽注册（用一个前缀代表一个 provider），重复注册抛且首次的前缀保留。
// - provider 生成落 source="provider"；无 provider 时按 60 字符截断落 source="fallback"。

@Test
func titleRenamePersistsLogOnlyWithoutEnteringSurface() {
    let root = "core-title-rename"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let service = SessionTitleService(log)
    // 播种一条用户消息，验证投影里只有它，不掺杂标题。
    log.append("user/message", "第一句提示")
    service.rename("中文：冒号也不吞")
    @Expect(service.get(), "中文：冒号也不吞")
    @Expect(service.sourceKind(), "user")
    @Expect(log.flush(), true)

    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    let replayed = SessionTitleService(fresh)
    @Expect(replayed.get(), "中文：冒号也不吞")
    @Expect(replayed.sourceKind(), "user")
    // 关键：标题不进模型历史，deriveMessages 只看到那一条 user/message。
    @Expect(fresh.deriveMessages().size, Int64(1))
    removeIfExists(root, recursive: true)
}

@Test
func titleEmptyRenameRejectedWithoutAppending() {
    let root = "core-title-empty"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let service = SessionTitleService(log)
    var threw = false
    try {
        service.rename("   ")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    @Expect(service.get(), "")
    @Expect(service.sourceKind(), "")
    // 空改名一条事件都不许留下——否则日志会谎称曾经有过用户改名。
    @Expect(log.snapshotEvents().size, Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func titleDuplicateProviderRegistrationRejected() {
    let root = "core-title-provider"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let service = SessionTitleService(log)
    service.registerProvider("first-prefix")
    var threw = false
    try {
        service.registerProvider("second-prefix")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    // 首次的 provider 必须留着，第二次注册不许顶替它。
    service.generateFrom("开头")
    @Expect(service.get(), "first-prefix:开头")
    @Expect(service.sourceKind(), "provider")
    removeIfExists(root, recursive: true)
}

@Test
func titleFallbackTruncatesWhenNoProvider() {
    let root = "core-title-fallback"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let service = SessionTitleService(log)
    // 上游规定 fallback 截断到 60 上限（本仓按 byte 切，测试用 ASCII 避免与 rune 计数混淆）。
    var seed = ""
    for (_ in 0..80) {
        seed += "A"
    }
    service.generateFrom(seed)
    @Expect(service.get().size, Int64(60))
    @Expect(service.sourceKind(), "fallback")
    removeIfExists(root, recursive: true)
}
