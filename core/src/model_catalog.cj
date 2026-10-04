package core

import std.io.*
import std.collection.*
import stdx.net.http.*
import stdx.net.tls.*
import stdx.encoding.json.*

// 远端模型清单：既服务页面的「从提供商拉取模型」，也服务「测试连接」这个动作——
// 连接测试必须真的发一次请求并只回报事实（通不通、几条、首条 id），
// 摘要里没有任何槽位能带密钥，否则一次失败日志就把凭据写进了会话历史。
//
// 读侧口径：**坏响应不等于「0 个模型」**。把 404/HTML/缺字段读成空清单，
// UI 会显示成「这个提供商没有模型」，那是替提供商编结论。
public class ModelCatalog {
    let idCap = Int64(512)
    let bodyCap = 1048576

    public static func parseIds(body: String): Array<String> {
        return ModelCatalog().ids(body)
    }

    private static func isNullValue(v: JsonValue): Bool {
        match (v.kind()) { case JsNull => true; case _ => false }
    }

    private static func isObjectValue(v: JsonValue): Bool {
        match (v.kind()) { case JsObject => true; case _ => false }
    }

    private static func isStringValue(v: JsonValue): Bool {
        match (v.kind()) { case JsString => true; case _ => false }
    }

    public func ids(body: String): Array<String> {
        if (body.size > bodyCap) {
            throw Exception("bad-model-catalog")
        }
        let out = ArrayList<String>()
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
                    if (existing == trimmed) {
                        seen = true
                    }
                }
                if (seen) {
                    continue
                }
                if (Int64(out.size) >= idCap) {
                    throw Exception("bad-model-catalog")
                }
                out.add(trimmed)
            }
        } catch (e: Exception) {
            throw Exception("bad-model-catalog")
        }
        return out.toArray()
    }

    // 给配置面的一句话摘要：条数 + 首条 id，永不带凭据材料
    public static func summary(apiKey: String, ids: Array<String>): String {
        let head = if (ids.size > 0) { ids[0] } else { "-" }
        return "models=${ids.size} first=${head}"
    }

    // 生产通道：GET {baseUrl}/models。证书按系统 CA 校验，禁止重定向转发凭据。
    public func fetch(baseUrl: String, apiKey: String, readTimeout!: Duration = Duration.second * 15): Array<String> {
        if (apiKey.size == 0) {
            throw Exception("model-credential-unavailable")
        }
        let client = ClientBuilder().tlsConfig(TlsClientConfig()).autoRedirect(false).build()
        var body = ""
        try {
            let req = HttpRequestBuilder().get().url("${baseUrl}/models")
                .header("Authorization", "Bearer ${apiKey}")
                .readTimeout(readTimeout).build()
            let resp = client.send(req)
            try {
                if (resp.status != 200) {
                    throw Exception("http-status:${resp.status}")
                }
                body = readBody(resp.body)
            } finally {
                try { resp.close() } catch (e: Exception) {}
            }
        } catch (e: Exception) {
            try { client.close() } catch (e2: Exception) {}
            if (e.message.startsWith("http-status:") || e.message == "bad-model-catalog") {
                throw Exception(e.message)
            }
            throw Exception("model-catalog-request-failed")
        }
        try { client.close() } catch (e: Exception) {}
        return ids(body)
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
