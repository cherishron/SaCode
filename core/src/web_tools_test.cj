package core

import std.fs.*
import std.unittest.*

@Test
func webToolsRejectUnknownArgumentsWithoutDispatch() {
    let root = "web-tools-args-test"
    Directory.create(root, recursive: true)
    try {
        let settings = WebSettings("${root}/web.json")
        let credentials = CredentialStore("${root}/credentials.env", { _ => "" })
        let tools = WebTools(settings, credentials)
        var rejected = false
        try { tools.execute("web_fetch", "{\"url\":\"https://example.com/\",\"headers\":{}}", TurnToken()) }
        catch (_: Exception) { rejected = true }
        @Expect(rejected, true)
        rejected = false
        try { tools.execute("web_search", "{\"query\":\"wrong-schema\"}", TurnToken()) }
        catch (_: Exception) { rejected = true }
        @Expect(rejected, true)
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func webToolsPreserveStructuredMetadataAndModelTrustNotice() {
    let root = "web-tools-result-test"
    Directory.create(root, recursive: true)
    try {
        let settings = WebSettings("${root}/web.json")
        settings.updateJson("{\"revision\":0,\"enabled\":true}")
        let credentials = CredentialStore("${root}/credentials.env", { _ => "" })
        let fetcher: (String, TurnToken) -> WebHttpResponse = { _, _ =>
            WebHttpResponse(200, "text/plain", "", "资料".toArray(), false)
        }
        let tools = WebTools(settings, credentials, fetchTransport: fetcher)
        let result = tools.execute("web_fetch", "{\"url\":\"https://example.com/\"}", TurnToken())
        @Expect(result.contains("资料"), true)
        @Expect(result.contains("不可信"), true)
        @Expect(result.contains("externalContent"), true)
    } finally { removeIfExists(root, recursive: true) }
}
