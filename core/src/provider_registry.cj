package core

import std.fs.*
import std.collection.*
import stdx.encoding.json.*

// 提供商注册表：桌面模型页要的是「多提供商 + 乐观并发 + 读面没有能带明文的槽位」，
// 不是单路 base_url。文档形态沿用「事件日志即真源」——回放得到当前文档，
// 修订号按提交次数走（它是版本，不是条目数）。
//
// 上游 settings 子系统把两类拒绝分得很清，这里也分：
//   settings-conflict —— 调用方看到的版本已经不是当前版本（别人先改了）；
//   settings-rejected —— 内容本身不合法（协议不在闭集、id 语法不对、地址不是 https…）。
// 把冲突报成拒绝，UI 就只能提示「保存失败」，用户不知道要重新加载再改。

class CatalogEntry {
    let id: String
    let name: String
    let baseUrl: String
    let protocol: String
    let credentialRef: String
    let modelIds: Array<String>
    init(id: String, name: String, baseUrl: String, protocol: String, credentialRef: String, modelIds: Array<String>) {
        this.id = id; this.name = name; this.baseUrl = baseUrl
        this.protocol = protocol; this.credentialRef = credentialRef; this.modelIds = modelIds
    }
}

// SaCode 自带目录（去品牌化：不携带上游产品命名），条目一律 declared
let saCodeCatalog = [
    CatalogEntry(
        "stepfun",
        "StepFun",
        "https://api.stepfun.com/step_plan/v1",
        "openai-completions",
        "STEPFUN_API_KEY",
        ["step-5-preview", "step-3.5-flash"]
    )
]

let providerProtocols = ["openai-completions", "openai-responses", "anthropic-messages"]

// 凭据名从提供商 ID 派生（大写、短横线换下划线，套上 SaCode 命名空间）。
// 派生放在核心而不是宿主或渲染层：两个入口必须推出同一个名字，
// 否则 CLI 里配好的密钥在桌面端会解析成另一个空引用。
public func deriveCredentialRef(id: String): String {
    let body = ArrayList<UInt8>()
    for (b in id.toArray()) {
        body.add(if (b == 45) {
            UInt8(95)
        } else if (b >= 97 && b <= 122) {
            b - UInt8(32)
        } else {
            b
        })
    }
    let all = ArrayList<UInt8>()
    for (b in "SA_CODE_".toArray()) { all.add(b) }
    for (b in body.toArray()) { all.add(b) }
    for (b in "_API_KEY".toArray()) { all.add(b) }
    return String.fromUtf8(all.toArray())
}

public class ModelSpec {
    public let id: String
    public let name: String
    public let contextWindow: String
    public let maxTokens: String
    public let image: Bool
    public init(id: String, name: String, contextWindow: String, maxTokens: String, image: Bool) {
        this.id = id; this.name = name; this.contextWindow = contextWindow
        this.maxTokens = maxTokens; this.image = image
    }
    public func toJson(): String {
        return "{\"id\":\"${jsonEscapeText(id)}\",\"name\":\"${jsonEscapeText(name)}\",\"contextWindow\":\"${jsonEscapeText(contextWindow)}\",\"maxTokens\":\"${jsonEscapeText(maxTokens)}\",\"image\":${image}}"
    }
}

public class ProviderRecord {
    public let id: String
    public let name: String
    public let baseUrl: String
    public let protocol: String
    public let credentialRef: String
    public let declared: Bool
    public let models: Array<ModelSpec>
    public init(id: String, name: String, baseUrl: String, protocol: String, credentialRef: String, declared: Bool, models: Array<ModelSpec>) {
        this.id = id; this.name = name; this.baseUrl = baseUrl; this.protocol = protocol
        this.credentialRef = credentialRef; this.declared = declared; this.models = models
    }
    public func toJson(): String {
        var arr = "["
        for (i in 0..models.size) {
            if (i > 0) { arr += "," }
            arr += models[i].toJson()
        }
        arr += "]"
        return "{\"id\":\"${jsonEscapeText(id)}\",\"name\":\"${jsonEscapeText(name)}\",\"baseUrl\":\"${jsonEscapeText(baseUrl)}\",\"protocol\":\"${jsonEscapeText(protocol)}\",\"credentialRef\":\"${jsonEscapeText(credentialRef)}\",\"declared\":${declared},\"models\":${arr}}"
    }
    public func hasModel(model: String): Bool {
        var found = false
        for (m in models) {
            if (m.id == model) { found = true }
        }
        return found
    }
}

public class ProviderView {
    public let providers: Array<ProviderRecord>
    public let revision: Int64
    public let writable: Bool
    public let defaultProviderId: String
    public let defaultModel: String
    public init(providers: Array<ProviderRecord>, revision: Int64, writable: Bool, defaultProviderId: String, defaultModel: String) {
        this.providers = providers; this.revision = revision; this.writable = writable
        this.defaultProviderId = defaultProviderId; this.defaultModel = defaultModel
    }
    public func asJson(): String {
        var arr = "["
        for (i in 0..providers.size) {
            if (i > 0) { arr += "," }
            arr += providers[i].toJson()
        }
        arr += "]"
        return "{\"providers\":${arr},\"revision\":${revision},\"writable\":${writable},\"defaultProviderId\":\"${jsonEscapeText(defaultProviderId)}\",\"defaultModel\":\"${jsonEscapeText(defaultModel)}\"}"
    }
}

public class ProviderRegistry {
    let file: String
    var entries = ArrayList<ProviderRecord>()
    var revision = Int64(0)
    var defProvider = ""
    var defModel = ""

    public init(file: String) {
        this.file = file
    }

    // 与模型设置、全局外观同一个用户设置目录：两个入口（CLI 与桌面宿主）解析到同一份文档
    public static func forUser(): ProviderRegistry {
        let dir = Path(GlobalAppearanceSettings.forUser().settingsPath()).parent.toString()
        return ProviderRegistry("${dir}/providers.log")
    }

    // 每次操作都从盘上重放：注册表是文档，不是进程内状态——
    // 另一个入口改过之后，这里不能还拿旧视图去判断冲突。
    private func reload(): Unit {
        entries = ArrayList<ProviderRecord>()
        revision = Int64(0)
        defProvider = ""
        defModel = ""
        if (!exists(file)) {
            return
        }
        let log = SessionLog(file)
        if (!log.load()) {
            throw Exception("provider-replay-rejected")
        }
        for (ev in log.snapshotEvents()) {
            revision += 1
            if (ev.eventType == "provider/upsert") {
                let rec = parseRecord(ev.data, true)
                var replaced = false
                var i = Int64(0)
                while (i < Int64(entries.size)) {
                    if (entries[i].id == rec.id) {
                        entries[i] = rec
                        replaced = true
                    }
                    i += 1
                }
                if (!replaced) { entries.add(rec) }
            } else if (ev.eventType == "provider/remove") {
                let kept = ArrayList<ProviderRecord>()
                for (rec in entries) {
                    if (rec.id != ev.data) {
                        kept.add(rec)
                    }
                }
                entries = kept
                if (defProvider == ev.data) {
                    defProvider = ""
                    defModel = ""
                }
            } else if (ev.eventType == "provider/default") {
                defProvider = fieldOfText(ev.data, "providerId")
                defModel = fieldOfText(ev.data, "model")
            }
        }
        // 默认指针不能指向已经不存在的条目或模型
        if (defProvider.size > 0) {
            let rec = find(defProvider)
            if (rec.id.size == 0 || !rec.hasModel(defModel)) {
                defProvider = ""
                defModel = ""
            }
        }
    }

    private func find(id: String): ProviderRecord {
        for (rec in entries) {
            if (rec.id == id) { return rec }
        }
        return ProviderRecord("", "", "", "", "", false, [])
    }

    public func describe(): ProviderView {
        reload()
        return ProviderView(entries.toArray(), revision, true, defProvider, defModel)
    }

    public func activeProvider(): ProviderRecord {
        reload()
        return find(defProvider)
    }

    public func activeModel(): String {
        reload()
        return defModel
    }

    public func catalogJson(): String {
        var arr = "["
        var i = Int64(0)
        while (i < Int64(saCodeCatalog.size)) {
            if (i > 0) { arr += "," }
            let e = saCodeCatalog[i]
            var models = "["
            var j = Int64(0)
            while (j < Int64(e.modelIds.size)) {
                if (j > 0) { models += "," }
                models += "{\"id\":\"${jsonEscapeText(e.modelIds[j])}\",\"name\":\"${jsonEscapeText(e.modelIds[j])}\",\"contextWindow\":\"\",\"maxTokens\":\"\",\"image\":false}"
                j += 1
            }
            models += "]"
            arr += "{\"id\":\"${jsonEscapeText(e.id)}\",\"name\":\"${jsonEscapeText(e.name)}\",\"baseUrl\":\"${jsonEscapeText(e.baseUrl)}\",\"protocol\":\"${jsonEscapeText(e.protocol)}\",\"declared\":true,\"models\":${models}}"
            i += 1
        }
        return arr + "]"
    }

    public func addFromCatalog(id: String, credentialRef: String): Unit {
        reload()
        var picked: Option<CatalogEntry> = None
        for (e in saCodeCatalog) {
            if (e.id == id) { picked = Some(e) }
        }
        if (picked.isNone()) {
            throw Exception("settings-rejected")
        }
        let e = picked.getOrThrow()
        if (find(id).id.size > 0) {
            throw Exception("settings-rejected")
        }
        if (!isValidCredentialRef(credentialRef)) {
            throw Exception("settings-rejected")
        }
        let models = ArrayList<ModelSpec>()
        for (m in e.modelIds) {
            models.add(ModelSpec(m, m, "", "", false))
        }
        let rec = ProviderRecord(e.id, e.name, e.baseUrl, e.protocol, credentialRef, true, models.toArray())
        commit("provider/upsert", rec.toJson())
    }

    // 写侧只认白名单字段；任何想顺路把密钥值塞进来的草稿一律拒绝——
    // 这个文档面上根本没有能承载明文的槽位，而不是「存了但读的时候删掉」。
    // 写侧的两个入口：字符串形态给单测与日志回放用，对象形态给宿主直接用——
    // 宿主的请求体已经解析过了，再序列化一遍只为喂回字符串是白做一次编码转换。
    public func update(draft: String, expectedRevision: Int64): Unit {
        updateObject(json(draft), expectedRevision)
    }

    public func updateObject(obj: JsonObject, expectedRevision: Int64): Unit {
        reload()
        let rec = parseRecordObject(obj, false)
        let existing = find(rec.id)
        if (existing.declared) {
            throw Exception("settings-rejected")
        }
        guardRevision(expectedRevision)
        commit("provider/upsert", rec.toJson())
    }

    public func remove(id: String, expectedRevision: Int64): Unit {
        reload()
        if (find(id).id.size == 0) {
            throw Exception("settings-rejected")
        }
        guardRevision(expectedRevision)
        commit("provider/remove", id)
    }

    public func setDefault(providerId: String, model: String, expectedRevision: Int64): Unit {
        reload()
        let rec = find(providerId)
        if (rec.id.size == 0 || !rec.hasModel(model)) {
            throw Exception("settings-rejected")
        }
        guardRevision(expectedRevision)
        commit("provider/default", "{\"providerId\":\"${jsonEscapeText(providerId)}\",\"model\":\"${jsonEscapeText(model)}\"}")
    }

    private func guardRevision(expectedRevision: Int64): Unit {
        if (expectedRevision >= 0 && expectedRevision != revision) {
            throw Exception("settings-conflict")
        }
    }

    private func commit(eventType: String, data: String): Unit {
        let log = SessionLog(file)
        if (exists(file) && !log.load()) {
            throw Exception("provider-replay-rejected")
        }
        log.append(eventType, data)
        if (!log.flush()) {
            throw Exception("provider-flush-failed")
        }
        reload()
    }

    // 从事件里复原记录：只信自家写出的规范形态，解析不过就当回放被拒绝
    private func parseRecord(text: String, fromLog: Bool): ProviderRecord {
        return parseRecordObject(json(text), fromLog)
    }

    private func parseRecordObject(obj: JsonObject, fromLog: Bool): ProviderRecord {
        for (forbidden in ["apiKey", "api_key", "key", "token", "secret", "value"]) {
            if (let Some(v) <- obj.get(forbidden)) {
                if (!isNullValue(v)) {
                    throw Exception("settings-rejected")
                }
            }
        }
        let id = textField(obj, "id")
        let name = textField(obj, "name")
        let baseUrl = textField(obj, "baseUrl")
        let protocol = textField(obj, "protocol")
        let credentialRef = optionalTextField(obj, "credentialRef", fromLog)
        let declared = if (fromLog) { boolField(obj, "declared") } else { false }
        checkId(id)
        checkText(name, 100)
        checkBaseUrl(baseUrl)
        var known = false
        for (p in providerProtocols) {
            if (p == protocol) {
                known = true
            }
        }
        if (!known) {
            throw Exception("settings-rejected")
        }
        // 「没点名」才派生；给了但形状不对仍按非法拒绝，不能派生兜住。
        let ref = if (credentialRef.size == 0) { deriveCredentialRef(id) } else { credentialRef }
        if (!isValidCredentialRef(ref)) {
            throw Exception("settings-rejected")
        }
        let models = parseModels(obj)
        if (!declared && models.size == 0) {
            throw Exception("settings-rejected")
        }
        return ProviderRecord(id, name, baseUrl, protocol, ref, declared, models)
    }

    private func parseModels(obj: JsonObject): Array<ModelSpec> {
        if (obj.get("models").isNone()) {
            throw Exception("settings-rejected")
        }
        let value = obj.get("models").getOrThrow()
        let arr = value.asArray()
        let out = ArrayList<ModelSpec>()
        var pos: Int64 = 0
        while (let Some(item) <- arr.get(pos)) {
            pos += 1
            let o = item.asObject()
            let spec = ModelSpec(
                textField(o, "id"),
                textField(o, "name"),
                textField(o, "contextWindow"),
                textField(o, "maxTokens"),
                boolField(o, "image")
            )
            if (spec.id.size == 0 || spec.id.size > 200) {
                throw Exception("settings-rejected")
            }
            for (seen in out) {
                if (seen.id == spec.id) {
                    throw Exception("settings-rejected")
                }
            }
            checkCapacity(spec.contextWindow)
            checkCapacity(spec.maxTokens)
            checkText(spec.name, 100)
            out.add(spec)
        }
        if (Int64(out.size) > 128) {
            throw Exception("settings-rejected")
        }
        return out.toArray()
    }

    private static func checkId(id: String): Unit {
        let bs = id.toArray()
        if (bs.size == 0 || bs.size > 64) {
            throw Exception("settings-rejected")
        }
        let lower = bs[0] >= 97 && bs[0] <= 122
        if (!lower) {
            throw Exception("settings-rejected")
        }
        var i: Int64 = 1
        while (i < bs.size) {
            let b = bs[i]
            let ok = (b >= 97 && b <= 122) || (b >= 48 && b <= 57) || b == 45
            if (!ok) {
                throw Exception("settings-rejected")
            }
            i += 1
        }
    }

    private static func checkText(value: String, limit: Int64): Unit {
        if (value.size > limit) {
            throw Exception("settings-rejected")
        }
        for (b in value.toArray()) {
            if (b < 32 || b == 127) {
                throw Exception("settings-rejected")
            }
        }
    }

    // 只允许 https，或本机回环 http（联调用的本地 mock）；带凭据、查询、片段的一律拒绝
    private static func checkBaseUrl(url: String): Unit {
        if (url.size == 0 || url.size > 2048) {
            throw Exception("settings-rejected")
        }
        if (url.contains("@") || url.contains("?") || url.contains("#")) {
            throw Exception("settings-rejected")
        }
        let secure = url.startsWith("https://") && url.size > 8
        let local = url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:")
        if (!secure && !local) {
            throw Exception("settings-rejected")
        }
    }

    // 容量是「128k」「4k」这类正数带可选 K/M 后缀；空串表示未填
    private static func checkCapacity(value: String): Unit {
        if (value.size == 0) {
            return
        }
        let bs = value.toArray()
        var i: Int64 = 0
        var digits = 0
        while (i < bs.size && bs[i] >= 48 && bs[i] <= 57) {
            digits += 1
            i += 1
        }
        if (i < bs.size && bs[i] == 46) {
            i += 1
            while (i < bs.size && bs[i] >= 48 && bs[i] <= 57) {
                digits += 1
                i += 1
            }
        }
        if (digits == 0) {
            throw Exception("settings-rejected")
        }
        if (i == bs.size - 1) {
            let tail = bs[i]
            if (!(tail == 107 || tail == 109 || tail == 75 || tail == 77)) {
                throw Exception("settings-rejected")
            }
        } else if (i != bs.size) {
            throw Exception("settings-rejected")
        }
    }

    private static func isNullValue(v: JsonValue): Bool {
        match (v.kind()) {
            case JsNull => true
            case _ => false
        }
    }

    private static func json(text: String): JsonObject {
        try {
            return JsonValue.fromStr(text).asObject()
        } catch (e: Exception) {
            throw Exception("settings-rejected")
        }
    }

    private static func textField(obj: JsonObject, key: String): String {
        if (let Some(v) <- obj.get(key)) {
            if (isNullValue(v)) {
                return ""
            }
            return v.asString().getValue()
        }
        throw Exception("settings-rejected")
    }

    // 凭据名是这一份文档里唯一允许「不给」的字段：模型页的草稿上没有这一栏，
    // 由 ID 派生发生在核心。回放侧仍要严格——自家写出的形态一定带着它。
    private static func optionalTextField(obj: JsonObject, key: String, required: Bool): String {
        if (let Some(v) <- obj.get(key)) {
            if (isNullValue(v)) {
                return ""
            }
            return v.asString().getValue()
        }
        if (required) {
            throw Exception("settings-rejected")
        }
        return ""
    }

    private static func boolField(obj: JsonObject, key: String): Bool {
        if (let Some(v) <- obj.get(key)) {
            return v.asBool().getValue()
        }
        return false
    }

    private static func fieldOfText(text: String, key: String): String {
        let obj = json(text)
        if (let Some(v) <- obj.get(key)) {
            return v.asString().getValue()
        }
        return ""
    }
}
