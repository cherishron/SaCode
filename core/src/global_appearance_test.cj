package core

import std.fs.*
import std.unittest.*

@Test
func globalAppearanceDefaultsAndRejectsInvalidSizes() {
    let root = "core-global-appearance-default"
    removeIfExists(root, recursive: true)
    Directory.create(root)
    let settings = GlobalAppearanceSettings(root)
    @Expect(settings.read().theme, "system")
    @Expect(settings.read().fontSize, Int64(14))
    @Expect(settings.setFontSize(14), false)
    @Expect(exists(settings.settingsPath()), false)
    for (size in [Int64(-1), 9, 23, 100]) {
        var rejected = false
        try { settings.setFontSize(size) } catch (e: Exception) { rejected = e.message == "bad-font-size" }
        @Expect(rejected, true)
    }
    @Expect(exists(settings.settingsPath()), false)
    removeIfExists(root, recursive: true)
}

@Test
func globalAppearancePersistsAcrossInstancesAndPreservesOtherField() {
    let root = "core-global-appearance-replay"
    removeIfExists(root, recursive: true)
    Directory.create(root)
    let first = GlobalAppearanceSettings(root)
    let stale = GlobalAppearanceSettings(root)
    @Expect(stale.read().fontSize, Int64(14))
    @Expect(first.setTheme("dark"), true)
    @Expect(stale.setFontSize(22), true)
    @Expect(first.read().theme, "dark")
    @Expect(first.read().fontSize, Int64(22))
    @Expect(GlobalAppearanceSettings(root).setFontSize(10), true)
    @Expect(first.read().fontSize, Int64(10))
    @Expect(stale.setTheme("light"), true)
    @Expect(first.read().fontSize, Int64(10))
    let log = SessionLog(first.settingsPath())
    @Expect(log.load(), true)
    @Expect(log.deriveMessages().size, Int64(0))
    @Expect(log.snapshotEvents().size, Int64(2))
    removeIfExists(root, recursive: true)
}

@Test
func globalAppearanceRespectsIndependentWriterLease() {
    let root = "core-global-appearance-lease"
    removeIfExists(root, recursive: true)
    Directory.create(root)
    let settings = GlobalAppearanceSettings(root)
    @Expect(settings.setFontSize(18), true)
    let before = File.readFrom(settings.settingsPath())
    let owner = WriteLease(settings.settingsPath())
    @Expect(owner.acquire(), true)
    var rejected = false
    try { settings.setTheme("dark") } catch (e: Exception) { rejected = e.message == "settings-already-owned" }
    @Expect(rejected, true)
    @Expect(String.fromUtf8(File.readFrom(settings.settingsPath())), String.fromUtf8(before))
    @Expect(settings.read().fontSize, Int64(18))
    owner.release()
    @Expect(settings.setTheme("dark"), true)
    removeIfExists(root, recursive: true)
}

@Test
func globalAppearanceCorruptionDoesNotFallBackOrOverwrite() {
    let root = "core-global-appearance-corrupt"
    removeIfExists(root, recursive: true)
    Directory.create(root)
    let settings = GlobalAppearanceSettings(root)
    for (text in ["0\tsettings/font-size\t99\n", "0\tsettings/theme\tunknown\n", "0\tuser/message\tfake\n", "0\tsettings/theme\tdark\n1\tsettings/font-size\t2"]) {
        File.writeTo(settings.settingsPath(), text.toArray())
        var rejected = false
        try { settings.setFontSize(18) } catch (e: Exception) { rejected = e.message == "settings-replay-rejected" }
        @Expect(rejected, true)
        @Expect(String.fromUtf8(File.readFrom(settings.settingsPath())), text)
        @Expect(WriteLease(settings.settingsPath()).held(), false)
    }
    removeIfExists(root, recursive: true)
}

@Test
func globalAppearanceDoesNotFollowOrPolluteSessionSelection() {
    let root = "core-global-appearance-sessions"
    removeIfExists(root, recursive: true)
    Directory.create(root)
    let catalog = SessionCatalog(root)
    let first = catalog.create("第一个会话")
    let second = catalog.create("第二个会话")
    let index = SessionLog(catalog.indexPath())
    @Expect(index.load(), true)
    catalog.select(index, first)
    @Expect(index.flush(), true)
    let before = String.fromUtf8(File.readFrom(catalog.indexPath()))
    let settings = GlobalAppearanceSettings(root)
    @Expect(settings.setFontSize(20), true)
    @Expect(settings.setTheme("light"), true)
    @Expect(String.fromUtf8(File.readFrom(catalog.indexPath())), before)
    catalog.select(index, second)
    @Expect(index.flush(), true)
    @Expect(SessionCatalog(root).selectedId(), second)
    @Expect(GlobalAppearanceSettings(root).read().fontSize, Int64(20))
    for (id in [first, second]) {
        let session = SessionLog(catalog.pathFor(id))
        @Expect(session.load(), true)
        @Expect(session.snapshotEvents().size, Int64(1))
        @Expect(session.deriveMessages().size, Int64(0))
    }
    removeIfExists(root, recursive: true)
}
