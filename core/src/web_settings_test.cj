package core

import std.fs.*
import std.unittest.*

@Test
func webSettingsPersistSelectionAndRejectStaleRevision() {
    let root = "web-settings-persist-test"
    Directory.create(root, recursive: true)
    let file = "${root}/web.json"
    try {
        let settings = WebSettings(file)
        @Expect(settings.snapshot().enabled, false)
        settings.updateJson("{\"revision\":0,\"enabled\":true,\"selectedProvider\":\"exa\"}")
        let reloaded = WebSettings(file).snapshot()
        @Expect(reloaded.enabled, true)
        @Expect(reloaded.selectedProvider, "exa")
        @Expect(reloaded.revision, Int64(1))
        var rejected = false
        try { settings.updateJson("{\"revision\":0,\"enabled\":false}") } catch (_: Exception) { rejected = true }
        @Expect(rejected, true)
        @Expect(WebSettings(file).snapshot().enabled, true)
        rejected = false
        try { settings.updateJson("{\"revision\":1,\"providers\":[{\"id\":\"exa\",\"endpoint\":\"http://127.0.0.1\"}]}") }
        catch (_: Exception) { rejected = true }
        @Expect(rejected, true)
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func webSettingsRejectUnknownFieldsAndSecretValues() {
    let settings = WebSettings("web-settings-invalid-test.json")
    var rejected = false
    try { settings.updateJson("{\"revision\":0,\"apiKey\":\"must-not-persist\"}") }
    catch (_: Exception) { rejected = true }
    @Expect(rejected, true)
    @Expect(exists("web-settings-invalid-test.json"), false)
}
