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

// 第 2 层能力面闭集：能力只能显式登记，名字像不算；缺失一律 unknown。
// 这些闭集与 ModelSpec 的字段一一对应，解析与落盘共用同一份真源。
let modalities = ["text", "image", "audio", "video", "embedding"]
let capabilityFlags = ["tools", "stream", "structured-output", "image-output"]
let meterUnits = ["token", "image", "second", "request", "unknown"]
let provenances = ["provider-listed", "user-entered", "human-confirmed", "unknown"]
let availabilities = ["available", "unsupported", "unknown"]

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
    public let inputModalities: Array<String>
    public let outputModalities: Array<String>
    public let supports: Array<String>
    public let meterUnit: String
    public let provenance: String
    public let availability: String
    public init(id: String, name: String, contextWindow: String, maxTokens: String, image: Bool,
        inputModalities!: Array<String> = [], outputModalities!: Array<String> = [],
        supports!: Array<String> = [], meterUnit!: String = "unknown",
        provenance!: String = "unknown", availability!: String = "unknown") {
        this.id = id; this.name = name; this.contextWindow = contextWindow
        this.maxTokens = maxTokens; this.image = image
        this.inputModalities = inputModalities; this.outputModalities = outputModalities
        this.supports = supports; this.meterUnit = meterUnit
        this.provenance = provenance; this.availability = availability
    }
    public func toJson(): String {
        var inArr = "["
        var i = Int64(0)
        while (i < Int64(inputModalities.size)) {
            if (i > 0) { inArr += "," }
            inArr += "\"${jsonEscapeText(inputModalities[i])}\""
            i += 1
        }
        inArr += "]"
        var outArr = "["
        i = Int64(0)
        while (i < Int64(outputModalities.size)) {
            if (i > 0) { outArr += "," }
            outArr += "\"${jsonEscapeText(outputModalities[i])}\""
            i += 1
        }
        outArr += "]"
        var supArr = "["
        i = Int64(0)
        while (i < Int64(supports.size)) {
            if (i > 0) { supArr += "," }
            supArr += "\"${jsonEscapeText(supports[i])}\""
            i += 1
        }
        supArr += "]"
        return "{\"id\":\"${jsonEscapeText(id)}\",\"name\":\"${jsonEscapeText(name)}\",\"contextWindow\":\"${jsonEscapeText(contextWindow)}\",\"maxTokens\":\"${jsonEscapeText(maxTokens)}\",\"image\":${image},"
            + "\"inputModalities\":${inArr},\"outputModalities\":${outArr},\"supports\":${supArr},"
            + "\"meterUnit\":\"${jsonEscapeText(meterUnit)}\",\"provenance\":\"${jsonEscapeText(provenance)}\",\"availability\":\"${jsonEscapeText(availability)}\"}"
    }
    // 只认显式登记：`unknown` 在能力过滤里不等于满足，名字像也不算。
    public func hasCapability(need: String): Bool {
        for (c in supports) {
            if (c == need) { return true }
        }
        return false
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
    public let sortOrder: Int64
    public let enabled: Bool
    public let transport: String
    public init(id: String, name: String, baseUrl: String, protocol: String, credentialRef: String, declared: Bool, models: Array<ModelSpec>,
        sortOrder!: Int64 = 0, enabled!: Bool = true, transport!: String = "direct") {
        this.id = id; this.name = name; this.baseUrl = baseUrl; this.protocol = protocol
        this.credentialRef = credentialRef; this.declared = declared; this.models = models
        this.sortOrder = sortOrder; this.enabled = enabled; this.transport = transport
    }
    public func toJson(): String {
        var arr = "["
        for (i in 0..models.size) {
            if (i > 0) { arr += "," }
            arr += models[i].toJson()
        }
        arr += "]"
        return "{\"id\":\"${jsonEscapeText(id)}\",\"name\":\"${jsonEscapeText(name)}\",\"baseUrl\":\"${jsonEscapeText(baseUrl)}\",\"protocol\":\"${jsonEscapeText(protocol)}\",\"credentialRef\":\"${jsonEscapeText(credentialRef)}\",\"declared\":${declared},\"models\":${arr},\"sortOrder\":${sortOrder},\"enabled\":${enabled},\"transport\":\"${jsonEscapeText(transport)}\"}"
    }
    public func hasModel(model: String): Bool {
        var found = false
        for (m in models) {
            if (m.id == model) { found = true }
        }
        return found
    }
    // 复制修改：class 字段是 let，逐字段重建新实例；
    // 不用 var——可变共享记录会让回放视图不安全。
    public func withEnabled(on: Bool): ProviderRecord {
        return ProviderRecord(id, name, baseUrl, protocol, credentialRef, declared, models,
            sortOrder: sortOrder, enabled: on, transport: transport)
    }
    public func withSortOrder(order: Int64): ProviderRecord {
        return ProviderRecord(id, name, baseUrl, protocol, credentialRef, declared, models,
            sortOrder: order, enabled: enabled, transport: transport)
    }
    public func withModels(next: Array<ModelSpec>): ProviderRecord {
        return ProviderRecord(id, name, baseUrl, protocol, credentialRef, declared, next,
            sortOrder: sortOrder, enabled: enabled, transport: transport)
    }
}

// 稳定升序：条目上限 128，用「按名次重建」而不是 ArrayList.insert——
// 后者的方法名与签名未经本机核验，不靠编译器猜（规格 B1 Task 2 Step 4）。
// 严格小于挑首选，保证同 sortOrder 时保持首次出现序。
func sortRecords(src: Array<ProviderRecord>): Array<ProviderRecord> {
    let out = ArrayList<ProviderRecord>()
    var used = Array<Bool>(src.size, repeat: false)
    var placed = Int64(0)
    while (placed < Int64(src.size)) {
        var pick = Int64(-1)
        var i = Int64(0)
        while (i < Int64(src.size)) {
            if (!used[i] && (pick < 0 || src[i].sortOrder < src[pick].sortOrder)) {
                pick = i
            }
            i += 1
        }
        used[pick] = true
        out.add(src[pick])
        placed += 1
    }
    return out.toArray()
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
    }}

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
            } else if (ev.eventType == "provider/enabled") {
                let target = fieldOfText(ev.data, "providerId")
                let on = boolOfText(ev.data, "enabled")
                var i = Int64(0)
                while (i < Int64(entries.size)) {
                    if (entries[i].id == target) {
                        entries[i] = entries[i].withEnabled(on)
                    }
                    i += 1
                }
            } else if (ev.eventType == "provider/sort") {
                let target = fieldOfText(ev.data, "providerId")
                let order = intOfText(ev.data, "sortOrder")
                var i = Int64(0)
                while (i < Int64(entries.size)) {
                    if (entries[i].id == target) {
                        entries[i] = entries[i].withSortOrder(order)
                    }
                    i += 1
                }
            }
        }
        // 视图恒按 sortOrder 升序。未点名（<=0）的条目按首次出现序补号；
        // 已有显式正值时，未点名条目接在最大显式值之后——「新增接末尾」，
        // 不与显式值相撞（相撞会让顺序取决于插入算法而不是用户配置）。
        var maxExplicit: Int64 = -1
        for (rec in entries) {
            if (rec.sortOrder > 0 && rec.sortOrder > maxExplicit) { maxExplicit = rec.sortOrder }
        }
        var next: Int64 = if (maxExplicit < 0) { 0 } else { maxExplicit + 1 }
        let fixed = ArrayList<ProviderRecord>()
        for (rec in entries) {
            if (rec.sortOrder <= 0) {
                fixed.add(rec.withSortOrder(next))
                next += 1
            } else {
                fixed.add(rec)
            }
        }
        entries = ArrayList<ProviderRecord>()
        for (rec in sortRecords(fixed.toArray())) {
            entries.add(rec)
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
        addInstanceFromCatalog(id, credentialRef)
    }

    // 号池的存储形态：同一目录项可反复添加，每次建一份新实例。
    // 目录项只是模板（地址、协议、初始模型列表），实例 id 由核心生成——
    // 拿目录 id 当唯一键就等于「一个品牌只能加一份」，与号池口径冲突。
    // 故意不返回 id：宿主动词的响应体统一是供应商视图，新实例 id 从视图读回，
    // 多加一条返回值等于给同一个事实造第二份来源。
    public func addInstanceFromCatalog(catalogId: String, credentialRef: String): Unit {
        reload()
        var picked: Option<CatalogEntry> = None
        for (e in saCodeCatalog) {
            if (e.id == catalogId) { picked = Some(e) }
        }
        if (picked.isNone()) {
            throw Exception("settings-rejected")
        }
        let e = picked.getOrThrow()
        // 实例 id：先试目录 id 本身，被占则依次 -2、-3……最多 64 个候选
        var instanceId = catalogId
        var attempt = Int64(2)
        while (find(instanceId).id.size > 0) {
            if (attempt > 64) {
                throw Exception("settings-rejected")
            }
            instanceId = "${catalogId}-${attempt}"
            attempt += 1
        }
        // 凭据引用：空 = 按实例 id 派生（两份实例天然不同名）；
        // 非空 = 过形状校验，且不得与任一已有实例重复——
        // 这道闸是「两把密钥塌成一把」的唯一堵口。
        var ref = credentialRef
        if (ref.size == 0) {
            ref = deriveCredentialRef(instanceId)
        } else {
            if (!isValidCredentialRef(ref)) {
                throw Exception("settings-rejected")
            }
            for (rec in entries) {
                if (rec.credentialRef == ref) {
                    throw Exception("settings-rejected")
                }
            }
        }
        // 显示名带实例后缀，同品牌多份必须可辨；name 不做唯一键
        var name = e.name
        if (instanceId != catalogId) {
            name = "${e.name} (${attempt - 1})"
        }
        let models = ArrayList<ModelSpec>()
        for (m in e.modelIds) {
            models.add(ModelSpec(m, m, "", "", false))
        }
        let rec = ProviderRecord(instanceId, name, e.baseUrl, e.protocol, ref, true, models.toArray())
        commit("provider/upsert", rec.toJson())
    }

    // 拖动/关断只改一列：绝不重写整条记录，否则会把别处刚改过的 baseUrl 盖回去。
    public func setEnabled(id: String, on: Bool, expectedRevision: Int64): Unit {
        reload()
        guardRevision(expectedRevision)
        if (find(id).id.size == 0) {
            throw Exception("settings-rejected")
        }
        commit("provider/enabled", "{\"providerId\":\"${jsonEscapeText(id)}\",\"enabled\":${if (on) { "true" } else { "false" }}}")
    }

    public func setSortOrder(id: String, order: Int64, expectedRevision: Int64): Unit {
        reload()
        guardRevision(expectedRevision)
        if (find(id).id.size == 0 || order < 0) {
            throw Exception("settings-rejected")
        }
        commit("provider/sort", "{\"providerId\":\"${jsonEscapeText(id)}\",\"sortOrder\":${order}}")
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
        // 排序列只接受非负：负值会被回放归一读成「未点名」而静默改号，
        // 用户拖出来的位置就丢了——这里显式拒绝，不静默修正。
        let sortOrder = intField(obj, "sortOrder", 0)
        if (sortOrder < 0) {
            throw Exception("settings-rejected")
        }
        return ProviderRecord(id, name, baseUrl, protocol, ref, declared, models,
            sortOrder: sortOrder,
            enabled: boolFieldDefault(obj, "enabled", true),
            transport: enumField(obj, "transport", ["direct", "relay"], "direct"))
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
                boolField(o, "image"),
                inputModalities: stringArrayField(o, "inputModalities", modalities),
                outputModalities: stringArrayField(o, "outputModalities", modalities),
                supports: stringArrayField(o, "supports", capabilityFlags),
                meterUnit: enumField(o, "meterUnit", meterUnits, "unknown"),
                provenance: enumField(o, "provenance", provenances, "unknown"),
                availability: enumField(o, "availability", availabilities, "unknown"))
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

    // 数组字段：缺省=空；给了就必须逐个落在闭集里，且不得重复——
    // 静默收下未知值等于把「不认识」伪装成「不支持」。
    private static func stringArrayField(obj: JsonObject, key: String, allowed: Array<String>): Array<String> {
        if (obj.get(key).isNone()) {
            return []
        }
        let v = obj.get(key).getOrThrow()
        if (isNullValue(v)) {
            return []
        }
        let arr = v.asArray()
        let out = ArrayList<String>()
        var pos: Int64 = 0
        while (let Some(item) <- arr.get(pos)) {
            pos += 1
            if (isNullValue(item)) {
                continue
            }
            let s = item.asString().getValue()
            var known = false
            for (a in allowed) {
                if (a == s) { known = true }
            }
            if (!known) { throw Exception("settings-rejected") }
            for (seen in out) {
                if (seen == s) { throw Exception("settings-rejected") }
            }
            out.add(s)
        }
        return out.toArray()
    }

    // 单值枚举：缺省或 null 都取 default（老日志没有这个字段，必须回放成功而不是整份作废）
    private static func enumField(obj: JsonObject, key: String, allowed: Array<String>, dflt: String): String {
        if (let Some(v) <- obj.get(key)) {
            if (isNullValue(v)) { return dflt }
            let s = v.asString().getValue()
            for (a in allowed) {
                if (a == s) { return s }
            }
            throw Exception("settings-rejected")
        }
        return dflt
    }

    private static func fieldOfText(text: String, key: String): String {
        let obj = json(text)
        if (let Some(v) <- obj.get(key)) {
            return v.asString().getValue()
        }
        return ""
    }

    // 自家事件的取值助手：与 fieldOfText 同一条解析路径，只是类型不同
    private static func boolOfText(text: String, key: String): Bool {
        let obj = json(text)
        if (let Some(v) <- obj.get(key)) {
            if (isNullValue(v)) { return false }
            return v.asBool().getValue()
        }
        return false
    }

    private static func intOfText(text: String, key: String): Int64 {
        let obj = json(text)
        if (let Some(v) <- obj.get(key)) {
            if (isNullValue(v)) { return 0 }
            return v.asInt().getValue()
        }
        return 0
    }

    // enabled 的缺省必须是 true：盘上的老记录根本没有这个字段，
    // 用 boolField 的「缺席即 false」会把全部历史提供商读成已关断。
    private static func boolFieldDefault(obj: JsonObject, key: String, dflt: Bool): Bool {
        if (let Some(v) <- obj.get(key)) {
            if (isNullValue(v)) { return dflt }
            return v.asBool().getValue()
        }
        return dflt
    }

    private static func intField(obj: JsonObject, key: String, dflt: Int64): Int64 {
        if (let Some(v) <- obj.get(key)) {
            if (isNullValue(v)) { return dflt }
            return v.asInt().getValue()
        }
        return dflt
    }
}
