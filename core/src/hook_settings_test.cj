package core

import std.unittest.*
import std.collection.*
import std.env.*
import std.fs.*
import std.io.*

func hsTempRoot(name: String): Path {
    return getTempDirectory().join("sacode-hook-settings-${name}")
}

func hsWrite(root: Path, rel: String, text: String): Unit {
    let target = root.join(rel)
    Directory.create(target.parent, recursive: true)
    File.writeTo(target, text.toArray())
}

func hsCleanup(root: Path): Unit {
    try { remove(root, recursive: true) } catch (_: Exception) {}
}

@Test
func testHookSettingsProjectOverridesUser() {
    let root = hsTempRoot("override")
    hsCleanup(root)
    let project = root.join("project")
    let user = root.join("user")
    hsWrite(project, ".sacode/settings.json", "{\"security\":{\"allowedHookUrls\":[\"http://127.0.0.1:8080/a\"],\"allowedHookEnvVars\":[\"P_ONLY\"],\"allowPrivateNetworkHooks\":false},\"hooks\":{\"PreToolUse\":[{\"matcher\":\"^read$\",\"hooks\":[{\"type\":\"command\",\"command\":\"echo ok\",\"timeout\":3000}]}]}}")
    hsWrite(user, ".sacode/settings.json", "{\"security\":{\"allowedHookUrls\":[\"http://127.0.0.1:9/held\"],\"allowedHookEnvVars\":[\"U_ONLY\"]}}")
    let settings = loadHookSettings(project.toString(), userFile: user.join(".sacode/settings.json").toString())
    @Expect(settings.policy.allowedHookUrls.size, 1)
    @Expect(settings.policy.allowedHookUrls[0], "http://127.0.0.1:8080/a")
    @Expect(settings.policy.allowedHookEnvVars, ["P_ONLY"])
    @Expect(settings.policy.allowPrivateNetworkHooks, false)
    let rules = settings.registry.findMatchingRules(HookEvent.PreToolUse, "read")
    @Expect(rules.size, 1)
    @Expect(settings.registry.findMatchingRules(HookEvent.PreToolUse, "write").size, 0)
    hsCleanup(root)
}

@Test
func testHookSettingsUserAppliesWhenProjectSilent() {
    let root = hsTempRoot("fallback")
    hsCleanup(root)
    let project = root.join("project")
    let user = root.join("user")
    hsWrite(project, ".sacode/settings.json", "{\"hooks\":{\"Stop\":[{\"matcher\":\"\",\"hooks\":[{\"type\":\"command\",\"command\":\"echo s\",\"timeout\":2000}]}]}}")
    hsWrite(user, ".sacode/settings.json", "{\"security\":{\"allowedHookUrls\":[\"http://127.0.0.1:7/u\"],\"allowPrivateNetworkHooks\":true}}")
    let settings = loadHookSettings(project.toString(), userFile: user.join(".sacode/settings.json").toString())
    @Expect(settings.policy.allowedHookUrls, ["http://127.0.0.1:7/u"])
    @Expect(settings.policy.allowPrivateNetworkHooks, true)
    @Expect(settings.registry.findMatchingRules(HookEvent.Stop, "any").size, 1)
    hsCleanup(root)
}

@Test
func testHookSettingsAbsentFilesFailClosed() {
    let root = hsTempRoot("absent")
    hsCleanup(root)
    let settings = loadHookSettings(root.join("nope").toString(), userFile: root.join("none.json").toString())
    @Expect(settings.policy.allowedHookUrls.size, 0)
    @Expect(settings.policy.allowPrivateNetworkHooks, false)
    @Expect(settings.registry.findMatchingRules(HookEvent.PreToolUse, "read").size, 0)
}

@Test
func testHookSettingsUnknownEventRejected() {
    let root = hsTempRoot("badevent")
    hsCleanup(root)
    let project = root.join("project")
    hsWrite(project, ".sacode/settings.json", "{\"hooks\":{\"NotARealEvent\":[]}}")
    var thrown = ""
    try {
        loadHookSettings(project.toString(), userFile: "")
    } catch (e: Exception) {
        thrown = e.message
    }
    @Expect(thrown, "hook-settings-unknown-event")
    hsCleanup(root)
}

@Test
func testHookSettingsMalformedRejected() {
    let root = hsTempRoot("badjson")
    hsCleanup(root)
    let project = root.join("project")
    hsWrite(project, ".sacode/settings.json", "{\"security\":")
    var thrown = ""
    try {
        loadHookSettings(project.toString(), userFile: "")
    } catch (e: Exception) {
        thrown = e.message
    }
    @Expect(thrown.size > 0, true)
    hsCleanup(root)
}

@Test
func testHookSettingsHttpRuleAndExecutorTypeRejected() {
    let root = hsTempRoot("http")
    hsCleanup(root)
    let project = root.join("project")
    hsWrite(project, ".sacode/settings.json", "{\"security\":{\"allowedHookUrls\":[\"http://127.0.0.1:8080/hook\"]},\"hooks\":{\"SessionStart\":[{\"matcher\":\"\",\"hooks\":[{\"type\":\"http\",\"url\":\"http://127.0.0.1:8080/hook\",\"timeout\":5000}]}]}}")
    let settings = loadHookSettings(project.toString(), userFile: "")
    let rules = settings.registry.findMatchingRules(HookEvent.SessionStart, "resume")
    @Expect(rules.size, 1)
    @Expect(rules[0].timeout, 5000)
    hsCleanup(root)

    let bad = root.join("bad")
    hsWrite(bad, ".sacode/settings.json", "{\"hooks\":{\"Stop\":[{\"matcher\":\"\",\"hooks\":[{\"type\":\"prompt\",\"command\":\"x\"}]}]}}")
    var thrown = ""
    try {
        loadHookSettings(bad.toString(), userFile: "")
    } catch (e: Exception) {
        thrown = e.message
    }
    @Expect(thrown, "hook-settings-unknown-executor-type")
    hsCleanup(root)
}
