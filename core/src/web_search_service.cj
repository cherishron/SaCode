package core

import std.collection.*
import std.sync.*

class WebSearchFailure {
    let mutex = Mutex()
    var message = ""
    func record(value: String): Unit {
        synchronized(mutex) { if (message.size == 0) { message = value } }
    }
}

public class WebSearchService {
    let settings: WebSettings
    let credentials: CredentialStore
    let transport: (String, String, String, String, TurnToken, Bool) -> WebHttpResponse
    public init(settings: WebSettings, credentials: CredentialStore,
        transport!: (String, String, String, String, TurnToken, Bool) -> WebHttpResponse =
            { url, method, body, key, token, deepseek => WebHttpTransport().request(url, method, body, key, token, deepseek: deepseek) }) {
        this.settings = settings; this.credentials = credentials; this.transport = transport
    }
    public func search(queries: Array<String>, token!: TurnToken = TurnToken()): WebSearchResult {
        if (token.cancelled()) { throw Exception("web-cancelled") }
        let accepted = webParseQueries(queries)
        let snapshot = settings.snapshot()
        if (!snapshot.enabled) { throw Exception("web-disabled") }
        let candidates = ArrayList<WebProviderSettings>()
        for (provider in snapshot.providers) {
            if (provider.enabled && (snapshot.selectedProvider.size == 0 || snapshot.selectedProvider == provider.id) &&
                credentials.describe(provider.credentialRef).configured) { candidates.add(provider) }
        }
        if (candidates.size == 0) { throw Exception("web-provider-unavailable") }
        if (candidates.size > 1) { throw Exception("web-provider-selection-required") }
        let provider = candidates[0]
        let key = credentials.resolve(provider.credentialRef).getOrThrow().value
        let suffix = if (provider.id == "exa") { "/search" }
            else if (provider.id == "perplexity") { "/chat/completions" } else { "/messages" }
        var base = provider.endpoint
        while (base.endsWith("/")) { base = base[0..(base.size - 1)] }
        let endpoint = base + suffix
        let shared = token.child()
        let firstFailure = WebSearchFailure()
        let operations = Array<Future<WebSearchResult>>(accepted.size, { index =>
            spawn {
                try {
                    if (shared.cancelled()) { throw Exception("web-cancelled") }
                    let body = webSearchRequestBody(provider.id, accepted[index], model: provider.model,
                        maxTokens: provider.maxTokens, maxUses: provider.maxUses, searchType: provider.searchType,
                        highlights: provider.highlights, recency: provider.recency)
                    let response = transport(endpoint, "POST", body, key, shared, provider.id == "deepseek-official")
                    if (shared.cancelled()) { throw Exception("web-cancelled") }
                    if (response.status < 200 || response.status >= 300) {
                        throw Exception("web-provider-http:${response.status}")
                    }
                    if (response.truncated) { throw Exception("web-provider-response-too-large") }
                    return webParseSearchResponse(provider.id, String.fromUtf8(response.bytes))
                } catch (error: Exception) {
                    firstFailure.record(error.message)
                    shared.cancel()
                    throw error
                }
            }
        })
        let results = ArrayList<WebSearchResult>()
        for (operation in operations) {
            try { results.add(operation.get()) } catch (_: Exception) {}
        }
        if (token.cancelled()) { throw Exception("web-cancelled") }
        if (firstFailure.message.size > 0) { throw Exception(firstFailure.message) }
        return webMergeSearchResults(results.toArray())
    }
}
