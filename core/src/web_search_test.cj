package core

import std.unittest.*
import stdx.encoding.json.*
import std.fs.*

@Test
func webSearchServiceSelectsOnlyAvailableProviderAndFailsClosed() {
    let root = "web-search-service-test"
    Directory.create(root, recursive: true)
    try {
        let settings = WebSettings("${root}/web.json")
        settings.updateJson("{\"revision\":0,\"enabled\":true}")
        let credentials = CredentialStore("${root}/credentials.env", { name => if (name == "EXA_API_KEY") { "test-key" } else { "" } })
        let transport: (String, String, String, String, TurnToken, Bool) -> WebHttpResponse = { url, method, body, key, _, _ =>
            @Expect(url, "https://api.exa.ai/search")
            @Expect(method, "POST")
            @Expect(key, "test-key")
            @Expect(JsonValue.fromStr(body).asObject()["query"].asString().getValue(), "中文")
            return WebHttpResponse(200, "application/json", "", "{\"results\":[{\"url\":\"https://example.com/a\",\"highlights\":[\"摘要\"]}]}".toArray(), false)
        }
        let service = WebSearchService(settings, credentials, transport: transport)
        @Expect(service.search(["中文"]).sources.size, Int64(1))
        let many = CredentialStore("${root}/credentials.env", { _ => "test-key" })
        var rejected = false
        try { WebSearchService(settings, many, transport: transport).search(["中文"]) }
        catch (_: Exception) { rejected = true }
        @Expect(rejected, true)
        settings.updateJson("{\"revision\":1,\"enabled\":false}")
        rejected = false
        try { service.search(["中文"]) } catch (_: Exception) { rejected = true }
        @Expect(rejected, true)
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func webSearchRequestsUseNativeProviderProtocols() {
    let exa = JsonValue.fromStr(webSearchRequestBody("exa", "中文查询")).asObject()
    @Expect(exa["query"].asString().getValue(), "中文查询")
    @Expect(exa["numResults"].asInt().getValue(), Int64(8))
    @Expect(exa["contents"].asObject()["highlights"].asObject()["highlightsPerUrl"].asInt().getValue(), Int64(1))
    let perplexity = JsonValue.fromStr(webSearchRequestBody("perplexity", "查询", recency: "week")).asObject()
    @Expect(perplexity["model"].asString().getValue(), "sonar")
    @Expect(perplexity["search_recency_filter"].asString().getValue(), "week")
    let deepseek = JsonValue.fromStr(webSearchRequestBody("deepseek-official", "查询")).asObject()
    let tool = deepseek["tools"].asArray()[0].asObject()
    @Expect(tool["type"].asString().getValue(), "web_search_20250305")
    @Expect(tool["max_uses"].asInt().getValue(), Int64(5))
    @Expect(deepseek["max_tokens"].asInt().getValue(), Int64(4096))
}

@Test
func webSearchMergeInterleavesDeduplicatesAndReportsTruncation() {
    let first = WebSearchResult([WebSearchSource("https://example.com/a"), WebSearchSource("https://example.com/shared"), WebSearchSource("https://example.com/c")])
    let second = WebSearchResult([WebSearchSource("https://example.com/b"), WebSearchSource("https://example.com/shared"), WebSearchSource("https://example.com/d")])
    let result = webMergeSearchResults([first, second], maxResults: 3)
    @Expect(result.sources.size, Int64(3))
    @Expect(result.sources[0].url, "https://example.com/a")
    @Expect(result.sources[1].url, "https://example.com/b")
    @Expect(result.sources[2].url, "https://example.com/shared")
    @Expect(result.truncated, true)
    @Expect(webMergeSearchResults([first, second], maxResults: 5).truncated, false)
}

@Test
func webSearchExaDropsMissingHighlightsAndPreservesMetadata() {
    let result = webParseSearchResponse("exa", "{\"results\":[{\"url\":\"https://example.com/a\",\"title\":\"中文\",\"highlights\":[\" \",\"有效摘要\"],\"publishedDate\":\"2026-10-08\"},{\"url\":\"https://example.com/b\"}]}")
    @Expect(result.sources.size, Int64(1))
    @Expect(result.toJson().contains("有效摘要"), true)
    @Expect(result.toJson().contains("2026-10-08"), true)
}

@Test
func webSearchPerplexityDoesNotFallbackFromEmptyStructuredResults() {
    let result = webParseSearchResponse("perplexity", "{\"choices\":[{\"message\":{\"content\":\"回答\"}}],\"search_results\":[],\"citations\":[\"https://example.com/ignored\"]}")
    @Expect(result.sources.size, Int64(0))
    @Expect(result.content, "回答")
    let fallback = webParseSearchResponse("perplexity", "{\"citations\":[\"https://example.com/a\"]}")
    @Expect(fallback.sources.size, Int64(1))
}

@Test
func webSearchDeepseekJoinsCitationsAndRejectsProseOnly() {
    let result = webParseSearchResponse("deepseek-official", "{\"content\":[{\"type\":\"text\",\"citations\":[{\"url\":\"https://example.com/a\",\"cited_text\":\"引文\"}]},{\"type\":\"web_search_tool_result\",\"content\":[{\"type\":\"web_search_result\",\"url\":\"https://example.com/a\",\"title\":\"来源\",\"page_age\":\"今天\"},{\"type\":\"web_search_result\",\"url\":\"https://example.com/a\"}]}]}")
    @Expect(result.sources.size, Int64(1))
    @Expect(result.toJson().contains("引文"), true)
    var rejected = false
    try { webParseSearchResponse("deepseek-official", "{\"content\":[{\"type\":\"text\",\"text\":\"假搜索\"}]}") }
    catch (_: Exception) { rejected = true }
    @Expect(rejected, true)
}

@Test
func webSearchQueryBoundsPrecedeDeduplication() {
    @Expect(webParseQueries(["中文", "中文", "second"]).size, Int64(2))
    var rejected = false
    try { webParseQueries(["a", "a", "a", "a", "a"]) } catch (_: Exception) { rejected = true }
    @Expect(rejected, true)
    rejected = false
    try { webParseQueries([" "]) } catch (_: Exception) { rejected = true }
    @Expect(rejected, true)
}
