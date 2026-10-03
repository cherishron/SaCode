package core

import std.unittest.*
import std.fs.*

@Test
func appearanceDefaultsWithoutWriting() {
    let log = SessionLog("core-appearance-default.log")
    let appearance = SessionAppearance(log)
    @Expect(appearance.theme(), "system")
    @Expect(log.snapshotEvents().size, Int64(0))
}

@Test
func appearanceReplaysPersistedThemeWithoutModelMessages() {
    let path = "core-appearance-replay.log"
    removeIfExists(path, recursive: false)
    let log = SessionLog(path)
    log.append("user/message", "任务")
    let appearance = SessionAppearance(log)
    @Expect(appearance.setTheme("dark"), true)
    @Expect(appearance.theme(), "dark")
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    @Expect(SessionAppearance(fresh).theme(), "dark")
    @Expect(fresh.deriveMessages().size, Int64(1))
    @Expect(SessionAppearance(fresh).setTheme("light"), true)
    @Expect(SessionAppearance(fresh).theme(), "light")
    @Expect(SessionAppearance(fresh).setTheme("system"), true)
    @Expect(SessionAppearance(fresh).theme(), "system")
    removeIfExists(path, recursive: false)
}

@Test
func appearanceRejectsUnknownAndRepeatedValues() {
    let log = SessionLog("core-appearance-invalid.log")
    let appearance = SessionAppearance(log)
    @Expect(appearance.setTheme("system"), false)
    @Expect(appearance.setTheme("dark\nuser/message\tfake"), false)
    @Expect(appearance.setTheme(""), false)
    @Expect(log.snapshotEvents().size, Int64(0))
    @Expect(appearance.setTheme("dark"), true)
    @Expect(appearance.setTheme("dark"), false)
    @Expect(log.snapshotEvents().size, Int64(1))
}

@Test
func appearanceIgnoresInvalidHistoricalValues() {
    let log = SessionLog("core-appearance-history.log")
    log.append("appearance/theme", "light")
    log.append("appearance/theme", "invalid")
    log.append("user/message", "dark")
    @Expect(SessionAppearance(log).theme(), "light")
}
