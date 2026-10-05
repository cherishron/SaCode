package core

import std.collection.*
import stdx.encoding.json.*
import stdx.crypto.digest.*

// 迁移包（B5）：配置导出/导入的核心逻辑。
//
// 两种包（§8.1）：
//   config        —— 供应商 + 自定义模型 + 绑定 + 预算 + 探测，不含密钥
//   secret-bundle —— 上述全部 + 选中供应商的凭据值（用独立口令加密，见 secret_bundle.cj）
//
// 导入流程（§8.3）：
//   选文件 → 校验 format/schema/摘要 → 计算差异 → 用户选合并或替换 → 原子落盘
//
// 关键不变量：
//   * 按稳定 ID 对齐，不按名称；同名不同 ID 视为两个不同条目
//   * 幂等：重复导入不产生重复供应商、重复上游模型、重复绑定
//   * 号池保号：同地址多实例按稳定 ID 对齐，不许按 baseUrl 或显示名做智能合并
//   * 凭据覆盖需单独确认；导入配置永不静默换密钥
//   * 归属字段不信任、不落盘（§2.4 对偶、断言 78）
//   * 导入走与在线编辑相同的校验与拒绝分诊
//
// 明确不在此模块（§8.4）：
//   usage-ledger.log、route-health.log、待核算记录、已用额度
//   整套服务搬迁走独立的数据目录备份恢复流程。

// 包格式标识（与 secret_bundle.cj 的 SECRET_BUNDLE_FORMAT 一致）
public let MIGRATION_FORMAT = "sacode-migrate/1"
public let MIGRATION_SCHEMA_VERSION: Int64 = 1

// kind 的两个取值
public let MIGRATION_KIND_CONFIG = "config"
public let MIGRATION_KIND_SECRET = "secret-bundle"

// 拒绝码：闭集，调用方按码分诊
public let MIGRATION_BAD_FORMAT = "migration-bad-format"
public let MIGRATION_BAD_SCHEMA = "migration-bad-schema"
public let MIGRATION_BAD_CHECKSUM = "migration-bad-checksum"
public let MIGRATION_BAD_KIND = "migration-bad-kind"
public let MIGRATION_MALFORMED = "migration-malformed"
public let MIGRATION_CREDENTIAL_CONFIRM_REQUIRED = "migration-credential-confirm-required"

// 从 JsonObject 解析 ModelSpec（本地辅助，不依赖 provider_registry 的 fromJson）
func modelSpecFromJson(obj: JsonObject): Option<ModelSpec> {
    let id = mgField(obj, "id")
    let name = mgField(obj, "name")
    if (id.size == 0) { return None }
    let contextWindow = mgField(obj, "contextWindow")
    let maxTokens = mgField(obj, "maxTokens")
    let image = mgBoolField(obj, "image") ?? false
    let inMods = mgStringArray(obj, "inputModalities")
    let outMods = mgStringArray(obj, "outputModalities")
    let supMods = mgStringArray(obj, "supports")
    let mu = mgField(obj, "meterUnit")
    let prov = mgField(obj, "provenance")
    let avail = mgField(obj, "availability")
    return Some(ModelSpec(id, name, contextWindow, maxTokens, image,
        inputModalities: inMods, outputModalities: outMods, supports: supMods,
        meterUnit: if (mu.size == 0) { "unknown" } else { mu },
        provenance: if (prov.size == 0) { "unknown" } else { prov },
        availability: if (avail.size == 0) { "unknown" } else { avail }))
}

// 从 JsonObject 解析字符串数组字段
func mgStringArray(obj: JsonObject, key: String): Array<String> {
    let out = ArrayList<String>()
    if (let Some(v) <- obj.get(key)) {
        let arr = v.asArray()
        var pos: Int64 = 0
        while (let Some(item) <- arr.get(pos)) {
            pos += 1
            out.add(item.asString().getValue())
        }
    }
    return out.toArray()
}

// 一个迁移包里的供应商条目。结构与 ProviderRecord 一一对应，但只取配置面字段。
// 不含凭据值——凭据走独立的 credential 段（§8.1 config 包结构上没有承载明文的槽位）。
public class MigrationProviderEntry {
    public let id: String
    public let name: String
    public let baseUrl: String
    public let protocol: String
    public let credentialRef: String
    public let declared: Bool
    public let sortOrder: Int64
    public let enabled: Bool
    public let transport: String
    public let models: Array<ModelSpec>

    public init(id: String, name: String, baseUrl: String, protocol: String, credentialRef: String,
                declared: Bool, sortOrder: Int64, enabled: Bool, transport: String,
                models: Array<ModelSpec>) {
        this.id = id
        this.name = name
        this.baseUrl = baseUrl
        this.protocol = protocol
        this.credentialRef = credentialRef
        this.declared = declared
        this.sortOrder = sortOrder
        this.enabled = enabled
        this.transport = transport
        this.models = models
    }

    // 从 ProviderRecord 提取
    public static func fromProvider(p: ProviderRecord): MigrationProviderEntry {
        return MigrationProviderEntry(p.id, p.name, p.baseUrl, p.protocol, p.credentialRef,
            p.declared, p.sortOrder, p.enabled, p.transport, p.models)
    }

    // 转回 ProviderRecord（用于导入落盘）
    public func toProvider(): ProviderRecord {
        return ProviderRecord(id, name, baseUrl, protocol, credentialRef, declared, models,
            sortOrder: sortOrder, enabled: enabled, transport: transport)
    }

    public func toJson(): String {
        var arr = "["
        var i: Int64 = 0
        while (i < Int64(models.size)) {
            if (i > 0) { arr += "," }
            arr += models[i].toJson()
            i += 1
        }
        arr += "]"
        return "{\"id\":\"${jsonEscapeText(id)}\",\"name\":\"${jsonEscapeText(name)}\","
            + "\"baseUrl\":\"${jsonEscapeText(baseUrl)}\",\"protocol\":\"${jsonEscapeText(protocol)}\","
            + "\"credentialRef\":\"${jsonEscapeText(credentialRef)}\",\"declared\":${if (declared) { "true" } else { "false" }},{"
            + "\"sortOrder\":${sortOrder},\"enabled\":${if (enabled) { "true" } else { "false" }},{"
            + "\"transport\":\"${jsonEscapeText(transport)}\",\"models\":${arr}}"
    }

    public static func fromJson(obj: JsonObject): Option<MigrationProviderEntry> {
        let id = mgField(obj, "id")
        let name = mgField(obj, "name")
        let baseUrl = mgField(obj, "baseUrl")
        let protocol = mgField(obj, "protocol")
        let credentialRef = mgField(obj, "credentialRef")
        if (id.size == 0 || name.size == 0 || baseUrl.size == 0 || protocol.size == 0) {
            return None
        }
        let declared = mgBoolField(obj, "declared") ?? false
        let sortOrder = mgIntField(obj, "sortOrder") ?? 0
        let enabled = mgBoolField(obj, "enabled") ?? true
        let transport = mgField(obj, "transport")
        if (transport.size == 0) {
            return None
        }
        // 解析 models
        let models = ArrayList<ModelSpec>()
        if (let Some(v) <- obj.get("models")) {
            let arr = v.asArray()
            var pos: Int64 = 0
            while (let Some(item) <- arr.get(pos)) {
                pos += 1
                if (let Some(ms) <- modelSpecFromJson(item.asObject())) {
                    models.add(ms)
                }
            }
        }
        return Some(MigrationProviderEntry(id, name, baseUrl, protocol, credentialRef,
            declared, sortOrder, enabled, transport, models.toArray()))
    }
}

// 迁移包里的绑定条目。结构与 BindingRecord 一一对应。
public class MigrationBindingEntry {
    public let providerId: String
    public let modelId: String
    public let enabled: Bool
    public let order: Int64
    public let weight: Int64
    public let priceInMicro: Int64
    public let priceOutMicro: Int64
    public let priceCacheReadMicro: Int64
    public let priceCacheWriteMicro: Int64
    public let priceVersion: Int64
    public let currency: String

    public init(providerId: String, modelId: String, enabled: Bool, order: Int64, weight: Int64,
                priceInMicro: Int64, priceOutMicro: Int64, priceCacheReadMicro: Int64,
                priceCacheWriteMicro: Int64, priceVersion: Int64, currency: String) {
        this.providerId = providerId
        this.modelId = modelId
        this.enabled = enabled
        this.order = order
        this.weight = weight
        this.priceInMicro = priceInMicro
        this.priceOutMicro = priceOutMicro
        this.priceCacheReadMicro = priceCacheReadMicro
        this.priceCacheWriteMicro = priceCacheWriteMicro
        this.priceVersion = priceVersion
        this.currency = currency
    }

    public static func fromBinding(b: BindingRecord): MigrationBindingEntry {
        return MigrationBindingEntry(b.providerId, b.modelId, b.enabled, b.order, b.weight,
            b.priceInMicro, b.priceOutMicro, b.priceCacheReadMicro,
            b.priceCacheWriteMicro, b.priceVersion, b.currency)
    }

    public func toBinding(): BindingRecord {
        return BindingRecord(providerId, modelId, enabled, order, weight,
            priceInMicro, priceOutMicro, priceCacheReadMicro,
            priceCacheWriteMicro, priceVersion, currency)
    }

    public func toJson(): String {
        return "{\"providerId\":\"${jsonEscapeText(providerId)}\",\"modelId\":\"${jsonEscapeText(modelId)}\","
            + "\"enabled\":${if (enabled) { "true" } else { "false" }},\"order\":${order},\"weight\":${weight},"
            + "\"priceInMicro\":${priceInMicro},\"priceOutMicro\":${priceOutMicro},"
            + "\"priceCacheReadMicro\":${priceCacheReadMicro},\"priceCacheWriteMicro\":${priceCacheWriteMicro},"
            + "\"priceVersion\":${priceVersion},\"currency\":\"${jsonEscapeText(currency)}\"}"
    }

    public static func fromJson(obj: JsonObject): Option<MigrationBindingEntry> {
        let providerId = mgField(obj, "providerId")
        let modelId = mgField(obj, "modelId")
        if (providerId.size == 0 || modelId.size == 0) {
            return None
        }
        let enabled = mgBoolField(obj, "enabled") ?? true
        let order = mgIntField(obj, "order") ?? 0
        let weight = mgIntField(obj, "weight") ?? 1
        let priceIn = mgIntField(obj, "priceInMicro") ?? -1
        let priceOut = mgIntField(obj, "priceOutMicro") ?? -1
        let priceCR = mgIntField(obj, "priceCacheReadMicro") ?? -1
        let priceCW = mgIntField(obj, "priceCacheWriteMicro") ?? -1
        let priceVer = mgIntField(obj, "priceVersion") ?? 0
        let currency = mgField(obj, "currency")
        if (currency.size == 0) {
            return None
        }
        return Some(MigrationBindingEntry(providerId, modelId, enabled, order, weight,
            priceIn, priceOut, priceCR, priceCW, priceVer, currency))
    }
}

// 迁移包里的自定义模型条目。结构与 CustomModelRecord 一一对应。
public class MigrationCustomModelEntry {
    public let id: String
    public let name: String
    public let description: String
    public let enabled: Bool
    public let category: String
    public let requires: Array<String>
    public let bindings: Array<MigrationBindingEntry>
    public let mode: String
    public let sortOrder: Int64
    public let params: String
    public let modalityBudget: String
    public let dailyTokens: Int64
    public let monthlyTokens: Int64
    public let dailyAmountMicro: Int64
    public let monthlyAmountMicro: Int64
    public let maxOutputTokens: Int64
    public let probeEnabled: Bool
    public let probeMaxPerDay: Int64

    public init(id: String, name: String, description: String, enabled: Bool, category: String,
                requires: Array<String>, bindings: Array<MigrationBindingEntry>, mode: String,
                sortOrder: Int64, params: String, modalityBudget: String,
                dailyTokens: Int64, monthlyTokens: Int64, dailyAmountMicro: Int64,
                monthlyAmountMicro: Int64, maxOutputTokens: Int64,
                probeEnabled: Bool, probeMaxPerDay: Int64) {
        this.id = id
        this.name = name
        this.description = description
        this.enabled = enabled
        this.category = category
        this.requires = requires
        this.bindings = bindings
        this.mode = mode
        this.sortOrder = sortOrder
        this.params = params
        this.modalityBudget = modalityBudget
        this.dailyTokens = dailyTokens
        this.monthlyTokens = monthlyTokens
        this.dailyAmountMicro = dailyAmountMicro
        this.monthlyAmountMicro = monthlyAmountMicro
        this.maxOutputTokens = maxOutputTokens
        this.probeEnabled = probeEnabled
        this.probeMaxPerDay = probeMaxPerDay
    }

    public static func fromCustomModel(cm: CustomModelRecord): MigrationCustomModelEntry {
        let bds = ArrayList<MigrationBindingEntry>()
        for (b in cm.bindings) {
            bds.add(MigrationBindingEntry.fromBinding(b))
        }
        return MigrationCustomModelEntry(cm.id, cm.name, cm.description, cm.enabled, cm.category,
            cm.requires, bds.toArray(), cm.mode, cm.sortOrder, cm.params, cm.modalityBudget,
            cm.dailyTokens, cm.monthlyTokens, cm.dailyAmountMicro, cm.monthlyAmountMicro,
            cm.maxOutputTokens, cm.probeEnabled, cm.probeMaxPerDay)
    }

    public func toCustomModel(): CustomModelRecord {
        let bds = ArrayList<BindingRecord>()
        for (b in bindings) {
            bds.add(b.toBinding())
        }
        return CustomModelRecord(id, name, description, enabled, category, requires,
            bds.toArray(), mode,
            sortOrder: sortOrder, params: params, modalityBudget: modalityBudget,
            dailyTokens: dailyTokens, monthlyTokens: monthlyTokens,
            dailyAmountMicro: dailyAmountMicro, monthlyAmountMicro: monthlyAmountMicro,
            maxOutputTokens: maxOutputTokens, probeEnabled: probeEnabled,
            probeMaxPerDay: probeMaxPerDay)
    }

    public func toJson(): String {
        var req = "["
        var i: Int64 = 0
        while (i < Int64(requires.size)) {
            if (i > 0) { req += "," }
            req += "\"${jsonEscapeText(requires[i])}\""
            i += 1
        }
        req += "]"
        var bnd = "["
        i = 0
        while (i < Int64(bindings.size)) {
            if (i > 0) { bnd += "," }
            bnd += bindings[i].toJson()
            i += 1
        }
        bnd += "]"
        return "{\"id\":\"${jsonEscapeText(id)}\",\"name\":\"${jsonEscapeText(name)}\","
            + "\"description\":\"${jsonEscapeText(description)}\",\"enabled\":${if (enabled) { "true" } else { "false" }},"
            + "\"category\":\"${jsonEscapeText(category)}\",\"requires\":${req},\"bindings\":${bnd},"
            + "\"mode\":\"${jsonEscapeText(mode)}\",\"sortOrder\":${sortOrder},"
            + "\"params\":\"${jsonEscapeText(params)}\",\"modalityBudget\":\"${jsonEscapeText(modalityBudget)}\","
            + "\"dailyTokens\":${dailyTokens},\"monthlyTokens\":${monthlyTokens},"
            + "\"dailyAmountMicro\":${dailyAmountMicro},\"monthlyAmountMicro\":${monthlyAmountMicro},"
            + "\"maxOutputTokens\":${maxOutputTokens},\"probeEnabled\":${if (probeEnabled) { "true" } else { "false" }},"
            + "\"probeMaxPerDay\":${probeMaxPerDay}}"
    }

    public static func fromJson(obj: JsonObject): Option<MigrationCustomModelEntry> {
        let id = mgField(obj, "id")
        let name = mgField(obj, "name")
        if (id.size == 0 || name.size == 0) {
            return None
        }
        let description = mgField(obj, "description")
        let enabled = mgBoolField(obj, "enabled") ?? true
        let category = mgField(obj, "category")
        let mode = mgField(obj, "mode")
        let sortOrder = mgIntField(obj, "sortOrder") ?? 0
        let params = mgField(obj, "params")
        let modalityBudget = mgField(obj, "modalityBudget")
        let dailyTokens = mgIntField(obj, "dailyTokens") ?? -1
        let monthlyTokens = mgIntField(obj, "monthlyTokens") ?? -1
        let dailyAmount = mgIntField(obj, "dailyAmountMicro") ?? -1
        let monthlyAmount = mgIntField(obj, "monthlyAmountMicro") ?? -1
        let maxOutput = mgIntField(obj, "maxOutputTokens") ?? -1
        let probeEnabled = mgBoolField(obj, "probeEnabled") ?? true
        let probeMax = mgIntField(obj, "probeMaxPerDay") ?? 3
        // requires
        let requires = ArrayList<String>()
        if (let Some(v) <- obj.get("requires")) {
            let arr = v.asArray()
            var pos: Int64 = 0
            while (let Some(item) <- arr.get(pos)) {
                pos += 1
                requires.add(item.asString().getValue())
            }
        }
        // bindings
        let bds = ArrayList<MigrationBindingEntry>()
        if (let Some(v) <- obj.get("bindings")) {
            let arr = v.asArray()
            var pos: Int64 = 0
            while (let Some(item) <- arr.get(pos)) {
                pos += 1
                if (let Some(be) <- MigrationBindingEntry.fromJson(item.asObject())) {
                    bds.add(be)
                }
            }
        }
        return Some(MigrationCustomModelEntry(id, name, description, enabled, category,
            requires.toArray(), bds.toArray(), mode, sortOrder, params, modalityBudget,
            dailyTokens, monthlyTokens, dailyAmount, monthlyAmount, maxOutput,
            probeEnabled, probeMax))
    }
}

// 迁移包信封。
// config 包：providers + customModels
// secret-bundle 包：providers + customModels + credentials（加密后作为 SecretBundle 单独存储）
public class MigrationBundle {
    public let format: String
    public let kind: String
    public let generatedAt: Int64
    public let schemaVersion: Int64
    public let checksum: String  // SHA-256 hex of entries JSON
    public let providers: Array<MigrationProviderEntry>
    public let customModels: Array<MigrationCustomModelEntry>
    // credentials 只在 secret-bundle 里有，且只存引用名（值在 SecretBundle 里）
    public let credentialRefs: Array<String>

    public init(format: String, kind: String, generatedAt: Int64, schemaVersion: Int64,
                checksum: String, providers: Array<MigrationProviderEntry>,
                customModels: Array<MigrationCustomModelEntry>,
                credentialRefs: Array<String>) {
        this.format = format
        this.kind = kind
        this.generatedAt = generatedAt
        this.schemaVersion = schemaVersion
        this.checksum = checksum
        this.providers = providers
        this.customModels = customModels
        this.credentialRefs = credentialRefs
    }

    // 计算 entries 的 JSON 表示（不含信封头，只含条目内容）
    func entriesJson(): String {
        var prov = "["
        var i: Int64 = 0
        while (i < Int64(providers.size)) {
            if (i > 0) { prov += "," }
            prov += providers[i].toJson()
            i += 1
        }
        prov += "]"
        var cust = "["
        i = 0
        while (i < Int64(customModels.size)) {
            if (i > 0) { cust += "," }
            cust += customModels[i].toJson()
            i += 1
        }
        cust += "]"
        return "{\"providers\":${prov},\"customModels\":${cust}}"
    }

    public func toJson(): String {
        var refs = "["
        var i: Int64 = 0
        while (i < Int64(credentialRefs.size)) {
            if (i > 0) { refs += "," }
            refs += "\"${jsonEscapeText(credentialRefs[i])}\""
            i += 1
        }
        refs += "]"
        return "{\"format\":\"${jsonEscapeText(format)}\",\"kind\":\"${jsonEscapeText(kind)}\","
            + "\"generatedAt\":${generatedAt},\"schemaVersion\":${schemaVersion},"
            + "\"checksum\":\"${jsonEscapeText(checksum)}\","
            + "\"providers\":${entriesJson()},\"credentialRefs\":${refs}}"
    }

    // 从 JSON 解析
    public static func fromJson(text: String): Option<MigrationBundle> {
        let obj = mgJson(text)
        let format = mgField(obj, "format")
        let kind = mgField(obj, "kind")
        if (format.size == 0 || kind.size == 0) {
            return None
        }
        let generatedAt = mgIntField(obj, "generatedAt") ?? 0
        let schemaVersion = mgIntField(obj, "schemaVersion") ?? 0
        let checksum = mgField(obj, "checksum")
        // providers
        let provs = ArrayList<MigrationProviderEntry>()
        if (let Some(v) <- obj.get("providers")) {
            let arr = v.asArray()
            var pos: Int64 = 0
            while (let Some(item) <- arr.get(pos)) {
                pos += 1
                if (let Some(pe) <- MigrationProviderEntry.fromJson(item.asObject())) {
                    provs.add(pe)
                }
            }
        }
        // customModels
        let custs = ArrayList<MigrationCustomModelEntry>()
        if (let Some(v) <- obj.get("customModels")) {
            let arr = v.asArray()
            var pos: Int64 = 0
            while (let Some(item) <- arr.get(pos)) {
                pos += 1
                if (let Some(cm) <- MigrationCustomModelEntry.fromJson(item.asObject())) {
                    custs.add(cm)
                }
            }
        }
        // credentialRefs
        let refs = ArrayList<String>()
        if (let Some(v) <- obj.get("credentialRefs")) {
            let arr = v.asArray()
            var pos: Int64 = 0
            while (let Some(item) <- arr.get(pos)) {
                pos += 1
                refs.add(item.asString().getValue())
            }
        }
        return Some(MigrationBundle(format, kind, generatedAt, schemaVersion, checksum,
            provs.toArray(), custs.toArray(), refs.toArray()))
    }

    // 校验包的基本结构（不验摘要）
    public func structuralValidation(): String {
        if (format != MIGRATION_FORMAT) {
            return MIGRATION_BAD_FORMAT
        }
        if (schemaVersion < 1 || schemaVersion > MIGRATION_SCHEMA_VERSION) {
            return MIGRATION_BAD_SCHEMA
        }
        if (kind != MIGRATION_KIND_CONFIG && kind != MIGRATION_KIND_SECRET) {
            return MIGRATION_BAD_KIND
        }
        return ""
    }

    // 校验摘要
    public func checksumValidation(): String {
        if (checksum.size != 64) {
            return MIGRATION_BAD_CHECKSUM
        }
        // 重算 entries 的 SHA-256
        let computed = computeEntriesSha256(entriesJson())
        if (computed != checksum) {
            return MIGRATION_BAD_CHECKSUM
        }
        return ""
    }

    // 完整校验：结构 + 摘要
    public func validate(): String {
        let sv = structuralValidation()
        if (sv.size > 0) {
            return sv
        }
        return checksumValidation()
    }

    // 读面摘要：不含条目内容
    public func safeSummary(): String {
        return "format=${format} kind=${kind} schemaVersion=${schemaVersion} "
            + "providers=${providers.size} customModels=${customModels.size} "
            + "credentialRefs=${credentialRefs.size}"
    }
}

// 差异预览条目：一个包内条目与本机现有状态的对比结果。
// action 的取值：
//   new       —— 本机没有这个 ID，需要新建
//   updated   —— 本机有这个 ID，但内容不同，需要更新
//   unchanged —— 本机有这个 ID，且内容相同，不需要动
//   conflict  —— 本机有这个 ID，但存在冲突（如凭据覆盖需确认）
public class MigrationPlanEntry {
    public let kind: String      // "provider" | "customModel"
    public let id: String
    public let action: String
    public let provider: Option<MigrationProviderEntry>
    public let customModel: Option<MigrationCustomModelEntry>

    public init(kind: String, id: String, action: String,
                provider: Option<MigrationProviderEntry>, customModel: Option<MigrationCustomModelEntry>) {
        this.kind = kind
        this.id = id
        this.action = action
        this.provider = provider
        this.customModel = customModel
    }

    public func toJson(): String {
        let prov = if (let Some(p) <- provider) { "\"${jsonEscapeText(p.toJson())}\"" } else { "null" }
        let cust = if (let Some(c) <- customModel) { "\"${jsonEscapeText(c.toJson())}\"" } else { "null" }
        return "{\"kind\":\"${jsonEscapeText(kind)}\",\"id\":\"${jsonEscapeText(id)}\","
            + "\"action\":\"${jsonEscapeText(action)}\",\"provider\":${prov},\"customModel\":${cust}}"
    }
}

// 差异预览结果
public class MigrationPlan {
    public let entries: Array<MigrationPlanEntry>
    public let needsCredentialConfirmation: Bool
    public let bundleKind: String

    public init(entries: Array<MigrationPlanEntry>, needsCredentialConfirmation: Bool,
                bundleKind: String) {
        this.entries = entries
        this.needsCredentialConfirmation = needsCredentialConfirmation
        this.bundleKind = bundleKind
    }

    public func toJson(): String {
        var arr = "["
        var i: Int64 = 0
        while (i < Int64(entries.size)) {
            if (i > 0) { arr += "," }
            arr += entries[i].toJson()
            i += 1
        }
        arr += "]"
        return "{\"entries\":${arr},\"needsCredentialConfirmation\":${if (needsCredentialConfirmation) { "true" } else { "false" }},"
            + "\"bundleKind\":\"${jsonEscapeText(bundleKind)}\"}"
    }

    // 有多少条需要实际写入
    public func writeCount(): Int64 {
        var count: Int64 = 0
        for (e in entries) {
            if (e.action == "new" || e.action == "updated") {
                count += 1
            }
        }
        return count
    }

    public func newCount(): Int64 {
        var count: Int64 = 0
        for (e in entries) {
            if (e.action == "new") {
                count += 1
            }
        }
        return count
    }

    public func updatedCount(): Int64 {
        var count: Int64 = 0
        for (e in entries) {
            if (e.action == "updated") {
                count += 1
            }
        }
        return count
    }

    public func unchangedCount(): Int64 {
        var count: Int64 = 0
        for (e in entries) {
            if (e.action == "unchanged") {
                count += 1
            }
        }
        return count
    }
}

// 导入应用结果
public class MigrationApplyResult {
    public let imported: Int64
    public let updated: Int64
    public let unchanged: Int64
    public let errors: Array<String>
    public let credentialRefWritten: Int64

    public init(imported: Int64, updated: Int64, unchanged: Int64,
                errors: Array<String>, credentialRefWritten: Int64) {
        this.imported = imported
        this.updated = updated
        this.unchanged = unchanged
        this.errors = errors
        this.credentialRefWritten = credentialRefWritten
    }

    public func toJson(): String {
        var errs = "["
        var i: Int64 = 0
        while (i < Int64(errors.size)) {
            if (i > 0) { errs += "," }
            errs += "\"${jsonEscapeText(errors[i])}\""
            i += 1
        }
        errs += "]"
        return "{\"imported\":${imported},\"updated\":${updated},\"unchanged\":${unchanged},"
            + "\"errors\":${errs},\"credentialRefWritten\":${credentialRefWritten}}"
    }

    public func isSuccess(): Bool {
        return Int64(errors.size) == 0
    }
}

// 比较两个 provider 条目是否内容相同（按稳定 ID 对齐后的内容比较）
public func migrationProviderEqual(a: MigrationProviderEntry, b: MigrationProviderEntry): Bool {
    if (a.id != b.id) { return false }
    if (a.name != b.name) { return false }
    if (a.baseUrl != b.baseUrl) { return false }
    if (a.protocol != b.protocol) { return false }
    if (a.credentialRef != b.credentialRef) { return false }
    if (a.declared != b.declared) { return false }
    if (a.sortOrder != b.sortOrder) { return false }
    if (a.enabled != b.enabled) { return false }
    if (a.transport != b.transport) { return false }
    if (Int64(a.models.size) != Int64(b.models.size)) { return false }
    // 模型列表逐个比较（按顺序）
    var i: Int64 = 0
    while (i < Int64(a.models.size)) {
        if (a.models[i].id != b.models[i].id) { return false }
        if (a.models[i].name != b.models[i].name) { return false }
        if (a.models[i].contextWindow != b.models[i].contextWindow) { return false }
        if (a.models[i].maxTokens != b.models[i].maxTokens) { return false }
        if (a.models[i].image != b.models[i].image) { return false }
        i += 1
    }
    return true
}

// 比较两个 custom model 条目是否内容相同
public func migrationCustomModelEqual(a: MigrationCustomModelEntry, b: MigrationCustomModelEntry): Bool {
    if (a.id != b.id) { return false }
    if (a.name != b.name) { return false }
    if (a.description != b.description) { return false }
    if (a.enabled != b.enabled) { return false }
    if (a.category != b.category) { return false }
    if (a.mode != b.mode) { return false }
    if (a.sortOrder != b.sortOrder) { return false }
    if (a.params != b.params) { return false }
    if (a.modalityBudget != b.modalityBudget) { return false }
    if (a.dailyTokens != b.dailyTokens) { return false }
    if (a.monthlyTokens != b.monthlyTokens) { return false }
    if (a.dailyAmountMicro != b.dailyAmountMicro) { return false }
    if (a.monthlyAmountMicro != b.monthlyAmountMicro) { return false }
    if (a.maxOutputTokens != b.maxOutputTokens) { return false }
    if (a.probeEnabled != b.probeEnabled) { return false }
    if (a.probeMaxPerDay != b.probeMaxPerDay) { return false }
    if (Int64(a.requires.size) != Int64(b.requires.size)) { return false }
    if (Int64(a.bindings.size) != Int64(b.bindings.size)) { return false }
    return true
}

// 比较两个 binding 条目是否内容相同
public func migrationBindingEqual(a: MigrationBindingEntry, b: MigrationBindingEntry): Bool {
    if (a.providerId != b.providerId) { return false }
    if (a.modelId != b.modelId) { return false }
    if (a.enabled != b.enabled) { return false }
    if (a.order != b.order) { return false }
    if (a.weight != b.weight) { return false }
    if (a.priceInMicro != b.priceInMicro) { return false }
    if (a.priceOutMicro != b.priceOutMicro) { return false }
    if (a.priceCacheReadMicro != b.priceCacheReadMicro) { return false }
    if (a.priceCacheWriteMicro != b.priceCacheWriteMicro) { return false }
    if (a.priceVersion != b.priceVersion) { return false }
    if (a.currency != b.currency) { return false }
    return true
}

// 计算差异预览：把包内条目与本机现有条目按稳定 ID 对齐比较。
// 幂等保证：内容相同的条目标为 unchanged，不会重复创建。
// 凭据覆盖检测：secret-bundle 包中如果包含 credentialRefs，且本机已有对应凭据，
//              则 needsCredentialConfirmation = true。
public func computeMigrationPlan(bundle: MigrationBundle,
                                  currentProviders: Array<ProviderRecord>,
                                  currentCustomModels: Array<CustomModelRecord>,
                                  existingCredentialRefs: Array<String>): MigrationPlan {
    let entries = ArrayList<MigrationPlanEntry>()

    // 比较 providers
    for (bp in bundle.providers) {
        let existing = findProviderById(currentProviders, bp.id)
        if (existing.id.size == 0) {
            entries.add(MigrationPlanEntry("provider", bp.id, "new", Some(bp), None))
        } else {
            let existingEntry = MigrationProviderEntry.fromProvider(existing)
            if (migrationProviderEqual(bp, existingEntry)) {
                entries.add(MigrationPlanEntry("provider", bp.id, "unchanged", Some(bp), None))
            } else {
                entries.add(MigrationPlanEntry("provider", bp.id, "updated", Some(bp), None))
            }
        }
    }

    // 比较 custom models
    for (bc in bundle.customModels) {
        let existing = findCustomModelById(currentCustomModels, bc.id)
        if (existing.id.size == 0) {
            entries.add(MigrationPlanEntry("customModel", bc.id, "new", None, Some(bc)))
        } else {
            let existingEntry = MigrationCustomModelEntry.fromCustomModel(existing)
            if (migrationCustomModelEqual(bc, existingEntry)) {
                entries.add(MigrationPlanEntry("customModel", bc.id, "unchanged", None, Some(bc)))
            } else {
                entries.add(MigrationPlanEntry("customModel", bc.id, "updated", None, Some(bc)))
            }
        }
    }

    // 检测凭据覆盖
    var needsConfirm = false
    if (bundle.kind == MIGRATION_KIND_SECRET) {
        for (ref in bundle.credentialRefs) {
            for (existing in existingCredentialRefs) {
                if (ref == existing) {
                    needsConfirm = true
                    break
                }
            }
            if (needsConfirm) {
                break
            }
        }
    }

    return MigrationPlan(entries.toArray(), needsConfirm, bundle.kind)
}

// 按稳定 ID 查找 provider
func findProviderById(providers: Array<ProviderRecord>, id: String): ProviderRecord {
    for (p in providers) {
        if (p.id == id) {
            return p
        }
    }
    return ProviderRecord("", "", "", "", "", false, [])
}

// 按稳定 ID 查找 custom model
func findCustomModelById(models: Array<CustomModelRecord>, id: String): CustomModelRecord {
    for (m in models) {
        if (m.id == id) {
            return m
        }
    }
    return CustomModelRecord("", "", "", true, "general", [], [], "weighted")
}

// 构建 config 包（不含密钥）
public func buildConfigBundle(providers: Array<ProviderRecord>,
                              customModels: Array<CustomModelRecord>,
                              generatedAt: Int64): MigrationBundle {
    let provs = ArrayList<MigrationProviderEntry>()
    for (p in providers) {
        provs.add(MigrationProviderEntry.fromProvider(p))
    }
    let custs = ArrayList<MigrationCustomModelEntry>()
    for (c in customModels) {
        custs.add(MigrationCustomModelEntry.fromCustomModel(c))
    }
    // 收集所有 credentialRefs（作为信息，不含值）
    let refs = ArrayList<String>()
    for (p in providers) {
        if (p.credentialRef.size > 0) {
            refs.add(p.credentialRef)
        }
    }
    let bundle = MigrationBundle(MIGRATION_FORMAT, MIGRATION_KIND_CONFIG, generatedAt,
        MIGRATION_SCHEMA_VERSION, "", provs.toArray(), custs.toArray(), refs.toArray())
    // 计算摘要
    let checksum = computeEntriesSha256(bundle.entriesJson())
    return MigrationBundle(MIGRATION_FORMAT, MIGRATION_KIND_CONFIG, generatedAt,
        MIGRATION_SCHEMA_VERSION, checksum, provs.toArray(), custs.toArray(), refs.toArray())
}

// 构建 secret-bundle 包（含凭据引用）
// 注意：凭据值不在此包里——它们由调用方用 sealSecretBundle 加密后单独存储。
// 本函数只构建信封部分，credentialRefs 列出需要加密的引用名。
public func buildSecretBundle(providers: Array<ProviderRecord>,
                              customModels: Array<CustomModelRecord>,
                              credentialRefs: Array<String>,
                              generatedAt: Int64): MigrationBundle {
    let provs = ArrayList<MigrationProviderEntry>()
    for (p in providers) {
        provs.add(MigrationProviderEntry.fromProvider(p))
    }
    let custs = ArrayList<MigrationCustomModelEntry>()
    for (c in customModels) {
        custs.add(MigrationCustomModelEntry.fromCustomModel(c))
    }
    let bundle = MigrationBundle(MIGRATION_FORMAT, MIGRATION_KIND_SECRET, generatedAt,
        MIGRATION_SCHEMA_VERSION, "", provs.toArray(), custs.toArray(), credentialRefs)
    let checksum = computeEntriesSha256(bundle.entriesJson())
    return MigrationBundle(MIGRATION_FORMAT, MIGRATION_KIND_SECRET, generatedAt,
        MIGRATION_SCHEMA_VERSION, checksum, provs.toArray(), custs.toArray(), credentialRefs)
}

// 计算 entries JSON 的 SHA-256 摘要（hex 字符串）
func computeEntriesSha256(entriesJson: String): String {
    return sha256Hex(entriesJson.toArray())
}

// SHA-256 摘要转 hex 字符串
func sha256ToHex(bytes: Array<Byte>): String {
    let hexChars = "0123456789abcdef"
    var result = ""
    for (b in bytes) {
        let i = Int64(b)
        result += "${hexChars[i / 16]}${hexChars[i % 16]}"
    }
    return result
}

// —— JSON 字段读取助手 ——

func mgJson(text: String): JsonObject {
    try {
        return JsonValue.fromStr(text).asObject()
    } catch (e: Exception) {
        return mgJson("{}")
    }
}

func mgField(obj: JsonObject, key: String): String {
    if (let Some(v) <- obj.get(key)) {
        return v.asString().getValue()
    }
    return ""
}

func mgBoolField(obj: JsonObject, key: String): Option<Bool> {
    if (let Some(v) <- obj.get(key)) {
        return Some(v.asBool().getValue())
    }
    return None
}

func mgIntField(obj: JsonObject, key: String): Option<Int64> {
    if (let Some(v) <- obj.get(key)) {
        return Some(v.asInt().getValue())
    }
    return None
}
