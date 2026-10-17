package core

import std.fs.*
import std.unittest.*

@Test
func busySendDefaultsAndSharedBoundaryPolicy() {
    let root = "core-busy-send-default"
    removeIfExists(root, recursive: true)
    Directory.create(root)
    @Expect(GlobalAppearanceSnapshot("system", 14).busySend, "queue")
    let settings = GlobalAppearanceSettings(root)
    @Expect(settings.read().busySend, "queue")
    @Expect(settings.setBusySend("queue"), false)
    @Expect(exists(settings.settingsPath()), false)
    for (preferred in ["queue", "steer"]) {
        @Expect(GlobalAppearanceSettings.sendMode(preferred, false, false), "queue")
        @Expect(GlobalAppearanceSettings.sendMode(preferred, false, true), "queue")
        @Expect(GlobalAppearanceSettings.sendMode(preferred, true, false), preferred)
        @Expect(GlobalAppearanceSettings.sendMode(preferred, true, true), if (preferred == "queue") { "steer" } else { "queue" })
    }
    var rejected = false
    try { settings.setBusySend("invalid") } catch (e: Exception) { rejected = e.message == "bad-busy-send" }
    @Expect(rejected, true)
    @Expect(exists(settings.settingsPath()), false)
    removeIfExists(root, recursive: true)
}

@Test
func busySendPersistsAndStaleWritersPreserveOtherPreferences() {
    let root = "core-busy-send-replay"
    removeIfExists(root, recursive: true)
    Directory.create(root)
    let first = GlobalAppearanceSettings(root)
    let stale = GlobalAppearanceSettings(root)
    @Expect(first.setBusySend("steer"), true)
    @Expect(stale.setFontSize(18), true)
    @Expect(stale.setTheme("dark"), true)
    let replay = GlobalAppearanceSettings(root).read()
    @Expect(replay.busySend, "steer")
    @Expect(replay.fontSize, Int64(18))
    @Expect(replay.theme, "dark")
    @Expect(first.setBusySend("queue"), true)
    @Expect(stale.read().busySend, "queue")
    @Expect(stale.read().theme, "dark")
    let log = SessionLog(first.settingsPath())
    @Expect(log.load(), true)
    @Expect(log.deriveMessages().size, Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func busySendRejectsCorruptPreferencesWithoutOverwriting() {
    let root = "core-busy-send-corrupt"
    removeIfExists(root, recursive: true)
    Directory.create(root)
    let settings = GlobalAppearanceSettings(root)
    let corrupt = "0\tsettings/busy-send\tunknown\n"
    File.writeTo(settings.settingsPath(), corrupt.toArray())
    var rejected = false
    try { settings.setTheme("dark") } catch (e: Exception) { rejected = e.message == "settings-replay-rejected" }
    @Expect(rejected, true)
    @Expect(String.fromUtf8(File.readFrom(settings.settingsPath())), corrupt)
    @Expect(WriteLease(settings.settingsPath()).held(), false)
    removeIfExists(root, recursive: true)
}
