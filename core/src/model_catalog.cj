package core

import std.io.*
import std.collection.*
import std.sync.AtomicBool
import stdx.net.http.*
import stdx.encoding.json.*

// 远端模型清单：既服务页面的「从提供商拉取模型」，也服务「测试连接」这个动作——
// 连接测试必须真的发一次请求并只回报事实（通不通、几条、首条 id），
// 摘要里没有任何槽位能带密钥，否则一次失败日志就把凭据写进了会话历史。
//
// 读侧口径：**坏响应不等于「0 个模型」**。把 404/HTML/缺字段读成空清单，
// UI 会显示成「这个提供商没有模型」，那是替提供商编结论。
// 发现结果的一条：id 之外只收上游明确报出的窗口大小。
// 空串语义是「上游没报」，由界面显示成容量未知；不从模型名或家族猜一个数。
public class CatalogModel {
    public let id: String
    public let contextWindow: String
    public init(id: String, contextWindow: String) {
        this.id = id
        this.contextWindow = contextWindow
    }
}

public class ModelCatalog {
    let idCap = Int64(512)
    let bodyCap = 1048576

    public static func parseIds(body: String): Array<String> {
        return ModelCatalog().ids(body)
    }

    public static func parseModels(body: String): Array<CatalogModel> {
        return ModelCatalog().entries(body)
    }

    private static func isNullValue(v: JsonValue): Bool {
        match (v.kind()) {
            case JsNull => true;
            case _ => false
        }
    }

    private static func isObjectValue(v: JsonValue): Bool {
        match (v.kind()) {
            case JsObject => true;
            case _ => false
        }
    }

    private static func isStringValue(v: JsonValue): Bool {
        match (v.kind()) {
            case JsString => true;
            case _ => false
        }
    }

    // 容量字段的不同上游拼写；只在列表对象里找，不翻模型名。
    private static func capacityFromInt(v: JsonValue): String {
        let n = v.asInt().getValue()
        if (n <= 0 || n > 100000000) { return "" }
        return "${n}"
    }

    // 与宿主 tipParseCapacity、渲染层 parseCapacity 同一口径：数字 + 可选单个 K/M。
    private static func capacityFromString(raw: String): String {
        let bs = raw.trimAscii().toArray()
        if (bs.size == 0) { return "" }
        var i: Int64 = 0
        var acc: Int64 = 0
        var digits: Int64 = 0
        while (i < bs.size && bs[i] >= 48 && bs[i] <= 57) {
            acc = acc * 10 + Int64(bs[i] - 48)
            digits += 1
            i += 1
        }
        if (digits == 0) { return "" }
        var value = acc
        if (i < bs.size) {
            if (i != bs.size - 1) { return "" }
            let last = bs[i]
            if (last == 107 || last == 75) {
                value = acc * 1000
            } else if (last == 109 || last == 77) {
                value = acc * 1000000
            } else {
                return ""
            }
        }
        if (value <= 0 || value > 100000000) { return "" }
        return "${value}"
    }

    private static func capacityFromValue(v: JsonValue): String {
        match (v.kind()) {
            case JsInt => capacityFromInt(v);
            case JsString => capacityFromString(v.asString().getValue());
            case _ => ""
        }
    }

    private static func capacityOf(o: JsonObject): String {
        for (name in ["context_window", "context_length", "max_context_length", "context_window_tokens"]) {
            if (let Some(v) <- o.get(name)) {
                if (isNullValue(v)) { continue }
                let text = capacityFromValue(v)
                if (text.size > 0) { return text }
            }
        }
        return ""
    }

    public func entries(body: String): Array<CatalogModel> {
        if (body.size > bodyCap) {
            throw Exception("bad-model-catalog")
        }
        let out = ArrayList<CatalogModel>()
        try {
            let obj = JsonValue.fromStr(body).asObject()
            // 上游用 error 字段表达失败；把它读成空清单会把「不通」说成「没有模型」
            if (let Some(v) <- obj.get("error")) {
                if (!isNullValue(v)) {
                    throw Exception("bad-model-catalog")
                }
            }
            if (obj.get("data").isNone()) {
                throw Exception("bad-model-catalog")
            }
            let arr = obj.get("data").getOrThrow().asArray()
            var pos: Int64 = 0
            while (let Some(item) <- arr.get(pos)) {
                pos += 1
                if (!isObjectValue(item)) {
                    throw Exception("bad-model-catalog")
                }
                let o = item.asObject()
                if (o.get("id").isNone()) {
                    throw Exception("bad-model-catalog")
                }
                let value = o.get("id").getOrThrow()
                // 显式 null 视为「这条没有对外 id」跳过；非字符串 id 是响应形态不对
                if (isNullValue(value)) {
                    continue
                }
                if (!isStringValue(value)) {
                    throw Exception("bad-model-catalog")
                }
                let trimmed = value.asString().getValue().trimAscii()
                if (trimmed.size == 0) {
                    throw Exception("bad-model-catalog")
                }
                var seen = false
                for (existing in out) {
                    if (existing.id == trimmed) {
                        seen = true
                    }
                }
                if (seen) {
                    continue
                }
                if (Int64(out.size) >= idCap) {
                    throw Exception("bad-model-catalog")
                }
                out.add(CatalogModel(trimmed, capacityOf(o)))
            }
        } catch (e: Exception) {
            throw Exception("bad-model-catalog")
        }
        return out.toArray()
    }

    public func ids(body: String): Array<String> {
        let out = ArrayList<String>()
        for (model in entries(body)) {
            out.add(model.id)
        }
        return out.toArray()
    }

    // 给配置面的一句话摘要：条数 + 首条 id，永不带凭据材料
    public static func summary(apiKey: String, ids: Array<String>): String {
        let head = if (ids.size > 0) {
            ids[0]
        } else {
            "-"
        }
        return "models=${ids.size} first=${head}"
    }

    // 生产通道：GET {baseUrl}/models。证书按系统 CA 校验，禁止重定向转发凭据。
    // 只负责把响应正文完整取回；解析留给两个读面，错误形态保持一致。
    private func fetchBody(baseUrl: String, apiKey: String, readTimeout!: Duration = Duration.second * 15,
        control!: ?ModelCatalogRequest = None): String {
        if (apiKey.size == 0) {
            throw Exception("model-credential-unavailable")
        }
        let stopped = AtomicBool(false)
        let monitor: ?Future<Unit> = if (control.isSome()) {
            Some(spawn {
                => if (let Some(request) <- control) {
                    while (!stopped.load()) {
                        if (request.reason().size > 0) {
                            request.closeNetwork()
                        }
                        sleep(Duration.millisecond * 10)
                    }
                }
            })
        } else {
            None
        }
        try {
            if (let Some(request) <- control) {
                request.checkpoint()
            }
            let builder = ClientBuilder().tlsConfig(tlsClientConfigForUrl(baseUrl)).autoRedirect(false)
            if (let Some(request) <- control) {
                builder.connector({address => request.connect(address)})
            }
            let client = builder.build()
            if (let Some(request) <- control) {
                request.attachClient(client)
            }
            var body = ""
            try {
                let req = HttpRequestBuilder()
                    .get()
                    .url("${baseUrl}/models")
                    .header("Authorization", "Bearer ${apiKey}")
                    .readTimeout(readTimeout)
                    .build()
                let resp = client.send(req)
                try {
                    if (let Some(request) <- control) {
                        request.checkpoint()
                    }
                    if (resp.status != 200) {
                        throw Exception("http-status:${resp.status}")
                    }
                    body = readBody(resp.body)
                } finally {
                    try {
                        resp.close()
                    } catch (e: Exception) {}
                }
            } catch (e: Exception) {
                try {
                    client.close()
                } catch (e2: Exception) {}
                if (let Some(request) <- control) {
                    request.checkpoint()
                }
                if (e.message.startsWith("http-status:") || e.message == "bad-model-catalog") {
                    throw Exception(e.message)
                }
                throw Exception("model-catalog-request-failed")
            }
            try {
                client.close()
            } catch (e: Exception) {}
            if (let Some(request) <- control) {
                request.checkpoint()
            }
            return body
        } finally {
            stopped.store(true)
            if (let Some(current) <- monitor) {
                current.get()
            }
            if (let Some(request) <- control) {
                request.closeNetwork()
            }
        }
    }

    // 只要 id 的调用面（连接测试、加速线路发现）保持原契约。
    public func fetch(baseUrl: String, apiKey: String, readTimeout!: Duration = Duration.second * 15,
        control!: ?ModelCatalogRequest = None): Array<String> {
        let body = fetchBody(baseUrl, apiKey, readTimeout: readTimeout, control: control)
        let parsed = ids(body)
        if (let Some(request) <- control) {
            request.checkpoint()
        }
        return parsed
    }

    // 拉取落盘面需要 id 与上游报的容量一起带回去，否则注册表只剩空窗口。
    public func fetchModels(baseUrl: String, apiKey: String, readTimeout!: Duration = Duration.second * 15,
        control!: ?ModelCatalogRequest = None): Array<CatalogModel> {
        let body = fetchBody(baseUrl, apiKey, readTimeout: readTimeout, control: control)
        let parsed = entries(body)
        if (let Some(request) <- control) {
            request.checkpoint()
        }
        return parsed
    }

    private func readBody(stream: InputStream): String {
        let buf = Array<UInt8>(8192, repeat: 0)
        let all = ArrayList<UInt8>()
        while (true) {
            let n = stream.read(buf)
            if (n <= 0) {
                break
            }
            var i: Int64 = 0
            while (i < n) {
                all.add(buf[i])
                i += 1
            }
            if (Int64(all.size) > bodyCap) {
                throw Exception("bad-model-catalog")
            }
        }
        let out = Array<UInt8>(all.size, repeat: 0)
        var j: Int64 = 0
        while (j < Int64(all.size)) {
            out[j] = all[j]
            j += 1
        }
        return String.fromUtf8(out)
    }
}
