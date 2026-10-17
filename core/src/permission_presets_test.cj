package core
import std.fs.*
import std.unittest.*

// 权限预设上游契约（167 行）：把 `SandboxMode` 与 `ApprovalPolicy` 捆绑成具名预设，
// `set` 先 append 一条 `permission/preset` log-only 事件（除非已是有效预设），再写 knob；
// 事件是持久用户意图，不在 model transcript 里。本切片实现默认表（workspace-write /
// danger-full-access）+ current/set + 未知名拒绝。

@Test
func permissionPresetsCurrentEmptyWhenNoEvent() {
    let root = "core-permission-empty"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    @Expect(PermissionPresets(log).current(), "")
    removeIfExists(root, recursive: true)
}

@Test
func permissionPresetsSetAppendsLogOnlyEvent() {
    let root = "core-permission-set"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let presets = PermissionPresets(log)
    log.append("user/message", "开工")
    @Expect(presets.set("workspace-write"), true)
    @Expect(presets.current(), "workspace-write")
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    @Expect(PermissionPresets(fresh).current(), "workspace-write")
    // log-only：模型历史只看到那一条 user/message。
    @Expect(fresh.deriveMessages().size, Int64(1))
    removeIfExists(root, recursive: true)
}

@Test
func permissionPresetsSameValueIsNoopWithoutAppending() {
    let root = "core-permission-noop"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let presets = PermissionPresets(log)
    @Expect(presets.set("danger-full-access"), true)
    @Expect(presets.set("danger-full-access"), false)
    @Expect(log.snapshotEvents().size, Int64(1))
    removeIfExists(root, recursive: true)
}

@Test
func permissionPresetsUnknownNameRejectedWithoutAppending() {
    let root = "core-permission-bad"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let presets = PermissionPresets(log)
    var threw = false
    try {
        presets.set("read-only-without-asking")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    @Expect(log.snapshotEvents().size, Int64(0))
    @Expect(presets.current(), "")
    removeIfExists(root, recursive: true)
}
