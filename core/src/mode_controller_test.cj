package core

import std.fs.*
import std.unittest.*

@Test
func modeControllerTest() {
    let path = "mode-ctrl-test.log"
    removeIfExists(path, recursive: false)
    removeIfExists("${path}.lease", recursive: false)
    let log = SessionLog(path)
    let mc = ModeController(log)
    @Expect(mc.current() == "build")
    @Expect(mc.set("plan") == "committed")
    @Expect(mc.current() == "plan")
    @Expect(mc.set("plan") == "noop")
    var threw = false
    try { mc.set("foo"); threw = false } catch (_) { threw = true }
    @Expect(threw)
    log.append("plan/mode", "true")
    @Expect(mc.current() == "plan")
    log.append("permission/preset", "danger-full-access")
    @Expect(mc.current() == "yolo")
    removeIfExists(path, recursive: false)
    removeIfExists("${path}.lease", recursive: false)
}
