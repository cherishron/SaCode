package core

import std.unittest.*
import std.fs.*

@Test
func webFetchServiceFollowsOnlySameOriginAndPreservesErrorBody() {
    let root = "web-fetch-service-test"
    Directory.create(root, recursive: true)
    try {
        let settings = WebSettings("${root}/web.json")
        settings.updateJson("{\"revision\":0,\"enabled\":true}")
        let transport: (String, TurnToken) -> WebHttpResponse = { url, _ =>
            if (url.endsWith("/start")) { return WebHttpResponse(302, "text/plain", "/final", Array<Byte>(), false) }
            if (url.endsWith("/cross")) { return WebHttpResponse(302, "text/plain", "https://other.example/path", Array<Byte>(), false) }
            return WebHttpResponse(404, "text/plain; charset=utf-8", "", "中文错误正文".toArray(), false)
        }
        let service = WebFetchService(settings, transport: transport)
        let result = service.fetch("https://example.com/start")
        @Expect(result.url, "https://example.com/final")
        @Expect(result.status, Int64(404))
        @Expect(result.body, "中文错误正文")
        var rejected = false
        try { service.fetch("https://example.com/cross") } catch (_: Exception) { rejected = true }
        @Expect(rejected, true)
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func webFetchTextDecodesChineseAndPreservesNewlines() {
    @Expect(webDecodeContent("中文\n下一行".toArray(), "text/plain; charset=utf-8", false), "中文\n下一行")
    @Expect(webDecodeContent([UInt8(65), UInt8(233)], "text/plain; charset=iso-8859-1", false), "Aé")
    var rejected = false
    try { webDecodeContent([UInt8(0)], "application/octet-stream", false) }
    catch (_: Exception) { rejected = true }
    @Expect(rejected, true)
}

@Test
func webFetchHtmlConvertsSemanticContentAndDropsActiveContent() {
    let html = "<html><head><title>忽略</title><script>危险</script></head><body><h1>标题</h1><p>中文 <strong>重点</strong> <a href=\"https://example.com/\">来源</a></p><script>不要出现</script><div hidden>隐藏</div></body></html>"
    let text = webHtmlToMarkdown(html)
    @Expect(text.contains("# 标题"), true)
    @Expect(text.contains("**重点**"), true)
    @Expect(text.contains("[来源](https://example.com/)"), true)
    @Expect(text.contains("危险"), false)
    @Expect(text.contains("不要出现"), false)
    @Expect(text.contains("隐藏"), false)
}
