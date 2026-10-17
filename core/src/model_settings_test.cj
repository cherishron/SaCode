package core

import std.fs.*
import std.unittest.*

@Test
func modelSettingsPersistsOnlyMetadataAndCredentialReference() {
    let root = "core-model-settings-roundtrip"
    removeIfExists(root, recursive: true); Directory.create(root)
    try {
        ModelSettings(root).save("https://api.example.com/v1", "中文模型", "test-key-ref")
        let saved = ModelSettings(root).read()
        @Expect(saved.baseUrl, "https://api.example.com/v1")
        @Expect(saved.model, "中文模型")
        @Expect(saved.credentialRef, "test-key-ref")
        @Expect(String.fromUtf8(File.readFrom("${root}/model-settings.log")).contains("apiKey"), false)
        @Expect(exists("${root}/model-settings.log.lease"), false)
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func modelSettingsRejectsInsecureOrCredentialBearingUrls() {
    for (url in ["http://remote.example/v1", "https://user:secret@example.com/v1", "https://example.com/v1?key=secret"]) {
        var rejected = false
        try { ModelSettings.validate(url, "model", "ref") } catch (_: Exception) { rejected = true }
        @Expect(rejected, true)
    }
    ModelSettings.validate("http://127.0.0.1:12345/v1", "model", "")
}
