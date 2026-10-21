package host

import core.*
import stdx.encoding.json.*

// 与生产 WebRpc 同包独立编译，避免主入口及其他 RPC 影响薄适配验证。
// 帧辅助函数只记录调用实参，不代替生产 main.cj 的协议编码验收。
var frames = Array<String>()
func emit(frame: String): Unit { frames = frames.concat([frame]) }
func okFrame(id: String, result: String): String { return "ok:${id}:${result}" }
func errFrame(id: String, code: Int64, message: String): String { return "error:${id}:${code}:${message}" }
func check(value: Bool): Unit { if (!value) { throw Exception("web-rpc-probe-failed") } }
func rejects(rpc: WebRpc, method: String, params: String, reason: String): Unit {
    var rejected = false
    try { rpc.dispatch(method, params) } catch (e: Exception) { rejected = e.message == reason }
    check(rejected)
}

main() {
    let settings = WebSettings("./web.json")
    settings.updateJson("{\"revision\":0,\"enabled\":true,\"selectedProvider\":\"exa\"}")
    let credentials = CredentialStore("credentials.env", { _ => "invalid-probe-placeholder" })
    let fetchCalls = Array<Int64>(1, repeat: 0)
    let searchCalls = Array<Int64>(1, repeat: 0)
    let fetcher = WebFetchService(settings, transport: { _, token =>
        check(!token.cancelled())
        fetchCalls[0] += 1
        return WebHttpResponse(200, "text/plain; charset=utf-8", "", "合成网页".toArray(), false)
    })
    let searcher = WebSearchService(settings, credentials, transport: { _, _, _, _, token, _ =>
        check(!token.cancelled())
        searchCalls[0] += 1
        return WebHttpResponse(200, "application/json", "",
            "{\"results\":[{\"url\":\"https://example.com/\",\"title\":\"合成来源\",\"highlights\":[\"合成摘要\"]}]}".toArray(), false)
    })
    let rpc = WebRpc(fetcher, searcher)
    check(WebRpc.handles("web/fetch") && WebRpc.handles("web/search"))
    check(!WebRpc.handles("web/settings/describe"))
    let fetched = JsonValue.fromStr(rpc.dispatch("web/fetch", "{\"url\":\"https://example.com/\"}")).asObject()
    check(fetched["result"].asObject()["body"].asString().getValue() == "合成网页")
    check(fetched["result"].asObject()["externalContent"].asBool().getValue())
    check(fetched["text"].asString().getValue().contains("不可信"))
    let searched = JsonValue.fromStr(rpc.dispatch("web/search", "{\"queries\":[\"合成查询\"]}")).asObject()
    check(searched["result"].asObject()["sources"].asArray().size() == 1)
    check(searched["text"].asString().getValue().contains("合成来源"))
    for (params in ["{}", "[]", "broken", "{\"url\":1}", "{\"url\":\"x\",\"key\":\"invalid\"}"]) {
        rejects(rpc, "web/fetch", params, "web-bad-args")
    }
    for (params in ["{}", "{\"queries\":\"x\"}", "{\"queries\":[1]}", "{\"queries\":[],\"key\":\"invalid\"}"]) {
        rejects(rpc, "web/search", params, "web-bad-args")
    }
    rejects(rpc, "web/search", "{\"queries\":[]}", "web-query-count")
    rejects(rpc, "web/search", "{\"queries\":[\" \" ]}", "web-empty-query")
    rejects(rpc, "web/unknown", "{}", "web-method-not-found")
    let cancelled = TurnToken()
    cancelled.cancel()
    var didCancel = false
    try { rpc.dispatch("web/fetch", "{\"url\":\"https://example.com/\"}", token: cancelled) }
    catch (e: Exception) { didCancel = e.message == "web-cancelled" }
    check(didCancel && fetchCalls[0] == 1 && searchCalls[0] == 1)
    check(!rpc.request("unknown", "broken", "7") && frames.size == 0)
    check(rpc.request("web/fetch", "{\"params\":{\"url\":\"https://example.com/\"}}", "7"))
    check(frames[0].startsWith("ok:7:"))
    check(rpc.request("web/search", "{\"params\":{\"queries\":[1]}}", "8"))
    check(frames[1] == "error:8:-32602:web-bad-args")
    check(rpc.request("web/fetch", "{}", "9"))
    check(frames[2] == "error:9:-32602:web-bad-args")
    let failing = WebRpc(WebFetchService(settings, transport: { _, _ =>
        throw Exception("private-provider-diagnostic-do-not-echo")
    }), searcher)
    check(failing.request("web/fetch", "{\"params\":{\"url\":\"https://example.com/\"}}", "10"))
    check(frames[3] == "error:10:-32030:web-request-unavailable")
    println("WebRpc probe PASS")
}
