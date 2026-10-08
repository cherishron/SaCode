package core

import stdx.encoding.json.*

public class WebTools {
    let fetcher: WebFetchService
    let searcher: WebSearchService
    public init(settings: WebSettings, credentials: CredentialStore,
        fetchTransport!: (String, TurnToken) -> WebHttpResponse =
            { url, token => WebHttpTransport().request(url, "GET", "", "", token) },
        searchTransport!: (String, String, String, String, TurnToken, Bool) -> WebHttpResponse =
            { url, method, body, key, token, deepseek => WebHttpTransport().request(url, method, body, key, token, deepseek: deepseek) }) {
        this.fetcher = WebFetchService(settings, transport: fetchTransport)
        this.searcher = WebSearchService(settings, credentials, transport: searchTransport)
    }
    public func execute(name: String, args: String, token: TurnToken): String {
        let object = JsonValue.fromStr(args).asObject()
        if (object.size() != 1) { throw Exception("web-bad-args") }
        let envelope = JsonObject()
        if (name == "web_fetch") {
            let result = fetcher.fetch(object["url"].asString().getValue(), token: token)
            envelope.put("result", JsonValue.fromStr(result.toJson()))
            envelope.put("text", JsonString(result.modelText()))
        } else if (name == "web_search") {
            let array = object["queries"].asArray()
            let queries = Array<String>(array.size(), { index => array[index].asString().getValue() })
            let result = searcher.search(queries, token: token)
            envelope.put("result", JsonValue.fromStr(result.toJson()))
            envelope.put("text", JsonString(result.modelText()))
        } else { throw Exception("web-unknown-tool") }
        return envelope.toString()
    }
}
