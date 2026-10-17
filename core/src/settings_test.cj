package core
import std.fs.*
import std.unittest.*

// 设置上游契约（156 行）：`ctx.settings` 有 configure/prepareDocument/describe/
// update/replace/mutate；`update` 合并、`replace` 先重置 live 字段为继承配置再应用、
// `mutate` 按路径编辑且保留未在响应中的 secret；每次写入验证完整 Config 并拒绝
// stale revision；`settings/document-updated` emit 事件通知客户端重读。
// 本切片落 update/replace/mutate 三方法与 document-updated log-only 事件。

@Test
func settingsUpdateMergesWithoutClearingOtherKeys() {
    let root = "core-settings-update"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let s = SettingsStore(log)
    s.update("theme", "dark")
    s.update("lang", "zh")
    log.append("user/message", "开工")
    @Expect(s.get("theme"), "dark")
    @Expect(s.get("lang"), "zh")
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    let replayed = SettingsStore(fresh)
    @Expect(replayed.get("theme"), "dark")
    @Expect(replayed.get("lang"), "zh")
    // 3 条：两次 document-updated + 一次 user/message。settings 事件是 log-only，
    // 不进模型历史。
    @Expect(fresh.snapshotEvents().size, Int64(3))
    @Expect(fresh.deriveMessages().size, Int64(1))
    removeIfExists(root, recursive: true)
}

@Test
func settingsReplaceResetsBeforeApplying() {
    let root = "core-settings-replace"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let s = SettingsStore(log)
    s.update("theme", "dark")
    s.update("lang", "zh")
    s.replace([["only-key", "only-value"]])
    @Expect(s.get("only-key"), "only-value")
    @Expect(s.get("theme"), "")
    @Expect(s.get("lang"), "")
    removeIfExists(root, recursive: true)
}

@Test
func settingsMutateRejectsStaleValue() {
    let root = "core-settings-mutate"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let s = SettingsStore(log)
    s.update("theme", "dark")
    let eventsBefore = log.snapshotEvents().size
    var threw = false
    try {
        // 期望「light」但当前是「dark」——CAS 拒绝。
        s.mutate("theme", "light", "blue")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    @Expect(s.get("theme"), "dark")
    @Expect(log.snapshotEvents().size, eventsBefore)
    removeIfExists(root, recursive: true)
}
