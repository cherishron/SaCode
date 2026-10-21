package host

import core.*
import stdx.encoding.json.*

// 网络执行适配层；不注册 main.cj、不改设置面，也不在 Host 复制网络策略。
// 调度方应复用实例并传入本次请求的取消令牌；授权与会话归属在调用本类前核对。
public class WebRpc {
    let fetcher: WebFetchService
    let searcher: WebSearchService

    public init(settings!: WebSettings = WebSettings.forUser(),
        credentials!: CredentialStore = CredentialStore.forUser()) {
        this.fetcher = WebFetchService(settings)
        this.searcher = WebSearchService(settings, credentials)
    }

    // 允许可信装配方注入核心服务及其测试传输，不接受 RPC 参数覆盖端点或凭据。
    public init(fetcher: WebFetchService, searcher: WebSearchService) {
        this.fetcher = fetcher
        this.searcher = searcher
    }

    public static func handles(method: String): Bool {
        return method == "web/fetch" || method == "web/search"
    }

    // params 是拆出的参数对象文本，返回值保持 WebTools 的 result/text 信封。
    public func dispatch(method: String, params: String, token!: TurnToken = TurnToken()): String {
        if (!WebRpc.handles(method)) {
            throw Exception("web-method-not-found")
        }
        let object: JsonObject
        var url = ""
        var queries = Array<String>()
        try {
            object = JsonValue.fromStr(params).asObject()
            if (object.size() != 1) {
                throw Exception("shape")
            }
            if (method == "web/fetch") {
                url = object["url"].asString().getValue()
            } else {
                let array = object["queries"].asArray()
                queries = Array<String>(array.size(), {index => array[index].asString().getValue()})
            }
        } catch (_: Exception) {
            throw Exception("web-bad-args")
        }
        if (token.cancelled()) {
            throw Exception("web-cancelled")
        }
        let envelope = JsonObject()
        if (method == "web/fetch") {
            let result = fetcher.fetch(url, token: token)
            envelope.put("result", JsonValue.fromStr(result.toJson()))
            envelope.put("text", JsonString(result.modelText()))
        } else {
            let result = searcher.search(queries, token: token)
            envelope.put("result", JsonValue.fromStr(result.toJson()))
            envelope.put("text", JsonString(result.modelText()))
        }
        return envelope.toString()
    }

    // body 为完整 JSON-RPC 请求；不属于本类的方法返回 false，且不发帧。
    public func request(method: String, body: String, idText: String, token!: TurnToken = TurnToken()): Bool {
        if (!WebRpc.handles(method)) {
            return false
        }
        try {
            let params: String
            try {
                params = JsonValue.fromStr(body).asObject().get("params").getOrThrow().asObject().toString()
            } catch (_: Exception) {
                throw Exception("web-bad-args")
            }
            emit(okFrame(idText, dispatch(method, params, token: token)))
        } catch (e: Exception) {
            // 严格白名单：供应商、传输或 JSON 异常可能带端点、正文与凭据，不回显原文。
            var reason = "web-request-unavailable"
            var code: Int64 = -32030
            for (known in ["web-bad-args", "web-query-count", "web-empty-query", "web-bad-url", "web-url-not-allowed",
                "web-disabled", "web-cancelled", "web-provider-unavailable", "web-provider-selection-required",
                "web-redirect-limit", "web-redirect-without-location", "web-cross-origin-redirect",
                "web-provider-response-too-large", "web-provider-no-search-result"]) {
                if (e.message == known) {
                    reason = known
                    break
                }
            }
            if (reason == "web-bad-args" || reason == "web-query-count" || reason == "web-empty-query" || reason ==
                "web-bad-url" || reason == "web-url-not-allowed") {
                code = -32602
            }
            emit(errFrame(idText, code, reason))
        }
        return true
    }
}
