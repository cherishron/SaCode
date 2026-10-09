package core

import std.collection.*
import std.sync.*
import std.time.*
import stdx.encoding.json.*

class WebCooldownEntry {
    let setAt: MonoTime
    let duration: Duration
    init(setAt: MonoTime, duration: Duration) {
        this.setAt = setAt; this.duration = duration
    }
}

let webCooldownMutex = Mutex()
let webCooldownEntries = HashMap<String, WebCooldownEntry>()

func webCooldownIsDown(id: String): Bool {
    synchronized(webCooldownMutex) {
        if (let Some(entry) <- webCooldownEntries.get(id)) {
            if (MonoTime.now() - entry.setAt < entry.duration) { return true }
            webCooldownEntries.remove(id)
        }
        return false
    }
}

func webCooldownSet(id: String, seconds: Int64): Unit {
    synchronized(webCooldownMutex) {
        webCooldownEntries.add(id, WebCooldownEntry(MonoTime.now(), Duration.millisecond * (seconds * 1000)))
    }
}

func webCooldownClear(id: String): Unit {
    synchronized(webCooldownMutex) {
        webCooldownEntries.remove(id)
    }
}

class WebSearchFailure {
    let mutex = Mutex()
    var message = ""
    var retryAfter = Int64(0)
    func record(value: String, retryAfter!: Int64 = 0): Unit {
        synchronized(mutex) {
            if (message.size == 0) { message = value; this.retryAfter = retryAfter }
        }
    }
}

public class WebSearchService {
    let settings: WebSettings
    let credentials: CredentialStore
    let transport: (String, String, String, String, TurnToken, Bool) -> WebHttpResponse
    var stickyId: Option<String> = None
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
        let pool = ArrayList<WebProviderSettings>()
        for (provider in snapshot.providers) {
            if (provider.enabled && credentials.describe(provider.credentialRef).configured) { pool.add(provider) }
        }
        if (pool.size == 0) { throw Exception("web-provider-unavailable") }
        let isRandom = snapshot.selectedProvider == "random"
        if (!isRandom) {
            let fixed = ArrayList<WebProviderSettings>()
            for (provider in pool) {
                if (snapshot.selectedProvider.size == 0 || snapshot.selectedProvider == provider.id) { fixed.add(provider) }
            }
            if (fixed.size == 0) { throw Exception("web-provider-unavailable") }
            if (fixed.size > 1) { throw Exception("web-provider-selection-required") }
            return searchWithProvider(fixed[0], accepted, token, WebSearchFailure())
        }
        return searchWithFailover(pool, accepted, token)
    }
    func searchWithFailover(pool: ArrayList<WebProviderSettings>, queries: Array<String>, token: TurnToken): WebSearchResult {
        var triedList = ArrayList<String>()
        var lastError = ""
        while (true) {
            if (token.cancelled()) { throw Exception("web-cancelled") }
            var found = false
            var provider = pool[0]
            if (let Some(id) <- stickyId) {
                for (p in pool) {
                    if (p.id == id && !webListContains(triedList, id) && !webCooldownIsDown(id)) {
                        provider = p; found = true; break
                    }
                }
            }
            if (!found) {
                for (p in pool) {
                    if (!webListContains(triedList, p.id) && !webCooldownIsDown(p.id)) {
                        provider = p; found = true; break
                    }
                }
            }
            if (!found) {
                if (lastError.size > 0) { throw Exception("web-all-providers-exhausted:${lastError}") }
                throw Exception("web-provider-unavailable")
            }
            let firstFailure = WebSearchFailure()
            try {
                let result = searchWithProvider(provider, queries, token, firstFailure)
                stickyId = Some(provider.id)
                return result
            } catch (error: Exception) {
                if (token.cancelled()) { throw Exception("web-cancelled") }
                if (firstFailure.message == "web-provider-http:429") {
                    let seconds = firstFailure.retryAfter
                    webCooldownSet(provider.id, if (seconds > 0) { seconds } else { 60 })
                    triedList.add(provider.id)
                    lastError = error.message
                    continue
                }
                throw error
            }
        }
        return WebSearchResult([], content: "") // unreachable: loop only exits via return or throw
    }
    func searchWithProvider(provider: WebProviderSettings, queries: Array<String>, token: TurnToken,
        firstFailure: WebSearchFailure): WebSearchResult {
        let key = credentials.resolve(provider.credentialRef).getOrThrow().value
        let suffix = if (provider.id == "exa" || provider.id == "tavily" || provider.id == "firecrawl") { "/search" }
            else if (provider.id == "perplexity") { "/chat/completions" }
            else if (provider.id == "parallel") { "/mcp" }
            else if (provider.id == "tinyfish") { "" }
            else { "/messages" }
        var base = provider.endpoint
        while (base.endsWith("/")) { base = base[0..(base.size - 1)] }
        let endpoint = base + suffix
        let shared = token.child()
        let operations = Array<Future<WebSearchResult>>(queries.size, { index =>
            spawn {
                try {
                    if (shared.cancelled()) { throw Exception("web-cancelled") }
                    let body = if (provider.id == "parallel") {
                        buildParallelMcpRequest(queries[index])
                    } else {
                        webSearchRequestBody(provider.id, queries[index], model: provider.model,
                            maxTokens: provider.maxTokens, maxUses: provider.maxUses, searchType: provider.searchType,
                            highlights: provider.highlights, recency: provider.recency)
                    }
                    let isParallel = provider.id == "parallel"
                    let isTinyfish = provider.id == "tinyfish"
                    let response = if (isTinyfish) {
                        transport(endpoint + "?query=" + queries[index], "GET", "", key, shared, false)
                    } else {
                        transport(endpoint, "POST", if (isParallel) { buildParallelMcpRequest(queries[index]) } else {
                            webSearchRequestBody(provider.id, queries[index], model: provider.model,
                                maxTokens: provider.maxTokens, maxUses: provider.maxUses, searchType: provider.searchType,
                                highlights: provider.highlights, recency: provider.recency)
                        }, key, shared, provider.id == "deepseek-official")
                    }
                    if (shared.cancelled()) { throw Exception("web-cancelled") }
                    if (response.status == 429) {
                        firstFailure.record("web-provider-http:429", retryAfter: response.retryAfter)
                        throw Exception("web-provider-http:429")
                    }
                    if (response.status < 200 || response.status >= 300) {
                        throw Exception("web-provider-http:${response.status}")
                    }
                    if (response.truncated) { throw Exception("web-provider-response-too-large") }
                    let parsed = if (isParallel) {
                        parseParallelMcpResponse(String.fromUtf8(response.bytes))
                    } else {
                        webParseSearchResponse(provider.id, String.fromUtf8(response.bytes))
                    }
                    return parsed
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

func buildParallelMcpRequest(query: String): String {
    let object = JsonObject()
    object.put("jsonrpc", JsonString("2.0"))
    object.put("id", JsonInt(1))
    object.put("method", JsonString("tools/call"))
    let params = JsonObject()
    params.put("name", JsonString("web_search"))
    let args = JsonObject()
    args.put("objective", JsonString(query))
    let queries = JsonArray()
    queries.add(JsonString(query))
    args.put("search_queries", queries)
    params.put("arguments", args)
    object.put("params", params)
    return object.toString()
}

func parseParallelMcpResponse(body: String): WebSearchResult {
    let trimmed = body.trimAscii()
    if (trimmed.size == 0) { return WebSearchResult([], content: "") }
    let sources = ArrayList<WebSearchSource>()
    var text = ""
    if (trimmed.startsWith("{")) {
        let result = parseMcpJson(trimmed)
        if (result.size > 0) { text = result }
    } else {
        for (line in trimmed.split("\n")) {
            let lineTrim = line.trimAscii()
            if (lineTrim.startsWith("data: ")) {
                let data = lineTrim[6..].trimAscii()
                if (data.startsWith("{")) {
                    let result = parseMcpJson(data)
                    if (result.size > 0) { text = result; break }
                }
            }
        }
    }
    return WebSearchResult(sources.toArray(), content: text)
}

func parseMcpJson(json: String): String {
    try {
        let object = JsonValue.fromStr(json).asObject()
        if (let Some(result) <- object.get("result")) {
            if (let Some(content) <- result.asObject().get("content")) {
                let arr = content.asArray()
                if (arr.size() > 0) {
                    let first = arr[0].asObject()
                    if (let Some(text) <- first.get("text")) {
                        return text.asString().getValue()
                    }
                }
            }
        }
    } catch (_: Exception) {}
    return ""
}

func webListContains(list: ArrayList<String>, value: String): Bool {
    for (item in list) { if (item == value) { return true } }
    return false
}
