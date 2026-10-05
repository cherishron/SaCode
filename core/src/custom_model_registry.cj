package core

import std.collection.*
import std.fs.*
import stdx.encoding.json.*

// 第 3 层自定义模型：日常任务只选它，不选供应商、不填密钥。
// 这一层不认识 baseUrl、不认识凭据——只认 (providerId, modelId) 绑定。
// 文档形态与 providers.log 同构：事件日志即真源、expectedRevision 乐观并发、
// settings-conflict（版本落后）与 settings-rejected（内容非法）分开报。
//
// 字段读取器与 provider_registry.cj 里自带一份逐字一致的副本：
// 收口进共享模块留到 B6，本批不做抽象——两份实现好过一份到处 import 的半共享。

let customModes = ["round-robin", "weighted"]
let customCategories = ["coding", "general", "vision", "embedding", "other"]
let customRequires = ["tools", "text-output", "image-output", "structured-output", "stream"]

public class BindingRecord {
    public let providerId: String
    public let modelId: String
    public let enabled: Bool
    public let order: Int64
    public let weight: Int64
    // 四档费率：-1 = 该维度未登记。缺省不是 0——
    // 0 是「明确登记的零费率」，-1 是「还没填」，两者在账本侧含义不同。
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
    public func toJson(): String {
        return "{\"providerId\":\"${jsonEscapeText(providerId)}\",\"modelId\":\"${jsonEscapeText(modelId)}\","
            + "\"enabled\":${if (enabled) { "true" } else { "false" }},\"order\":${order},\"weight\":${weight},"
            + "\"priceInMicro\":${priceInMicro},\"priceOutMicro\":${priceOutMicro},"
            + "\"priceCacheReadMicro\":${priceCacheReadMicro},\"priceCacheWriteMicro\":${priceCacheWriteMicro},"
            + "\"priceVersion\":${priceVersion},\"currency\":\"${jsonEscapeText(currency)}\"}"
    }
    // 复制修改：class 字段是 let，逐字段重建（同 ProviderRecord 的 withX 系列）
    public func withOrder(next: Int64): BindingRecord {
        return BindingRecord(providerId, modelId, enabled, next, weight,
            priceInMicro, priceOutMicro, priceCacheReadMicro, priceCacheWriteMicro,
            priceVersion, currency)
    }
}

public class CustomModelRecord {
    public let id: String
    public let name: String
    public let description: String
    public let enabled: Bool
    public let category: String
    public let requires: Array<String>
    public let bindings: Array<BindingRecord>
    public let mode: String
    public let sortOrder: Int64
    // 参数与模态预算是自由格式原文：核心不拍平键名，因为协议间叫法不同（§2.3）
    public let params: String
    public let modalityBudget: String
    // -1 = 未设置，0 = 有意的零额度。这两个值绝不能合并（断言 46）
    public let dailyTokens: Int64
    public let monthlyTokens: Int64
    public let dailyAmountMicro: Int64
    public let monthlyAmountMicro: Int64
    public let maxOutputTokens: Int64
    public let probeEnabled: Bool
    public let probeMaxPerDay: Int64
    public init(id: String, name: String, description: String, enabled: Bool, category: String,
        requires: Array<String>, bindings: Array<BindingRecord>, mode: String,
        sortOrder!: Int64 = 0, params!: String = "", modalityBudget!: String = "",
        dailyTokens!: Int64 = -1, monthlyTokens!: Int64 = -1, dailyAmountMicro!: Int64 = -1,
        monthlyAmountMicro!: Int64 = -1, maxOutputTokens!: Int64 = -1,
        probeEnabled!: Bool = true, probeMaxPerDay!: Int64 = 3) {
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
    // 落盘形态与解析形态必须成对，否则回放一次就丢字段。
    // ownerId 是归属戳记：只由本机 principal 在写侧盖，包里的 owner 声明不参与（§2.4 对偶）。
    public func toJson(ownerId!: String = ""): String {
        let head = if (ownerId.size > 0) { "\"ownerId\":\"${jsonEscapeText(ownerId)}\"," } else { "" }
        var req = "["
        var i = Int64(0)
        while (i < Int64(requires.size)) {
            if (i > 0) { req += "," }
            req += "\"${jsonEscapeText(requires[i])}\""
            i += 1
        }
        req += "]"
        var bnd = "["
        i = Int64(0)
        while (i < Int64(bindings.size)) {
            if (i > 0) { bnd += "," }
            bnd += bindings[i].toJson()
            i += 1
        }
        bnd += "]"
        return "{${head}\"id\":\"${jsonEscapeText(id)}\",\"name\":\"${jsonEscapeText(name)}\","
            + "\"description\":\"${jsonEscapeText(description)}\",\"enabled\":${if (enabled) { "true" } else { "false" }},"
            + "\"category\":\"${jsonEscapeText(category)}\",\"requires\":${req},\"bindings\":${bnd},"
            + "\"mode\":\"${jsonEscapeText(mode)}\",\"sortOrder\":${sortOrder},"
            + "\"params\":\"${jsonEscapeText(params)}\",\"modalityBudget\":\"${jsonEscapeText(modalityBudget)}\","
            + "\"dailyTokens\":${dailyTokens},\"monthlyTokens\":${monthlyTokens},"
            + "\"dailyAmountMicro\":${dailyAmountMicro},\"monthlyAmountMicro\":${monthlyAmountMicro},"
            + "\"maxOutputTokens\":${maxOutputTokens},\"probeEnabled\":${if (probeEnabled) { "true" } else { "false" }},"
            + "\"probeMaxPerDay\":${probeMaxPerDay}}"
    }
    // 复制修改：绑定数组换了就重建记录，其它十八个字段原样带着
    public func withBindings(next: Array<BindingRecord>): CustomModelRecord {
        return CustomModelRecord(id, name, description, enabled, category, requires, next, mode,
            sortOrder: sortOrder, params: params, modalityBudget: modalityBudget,
            dailyTokens: dailyTokens, monthlyTokens: monthlyTokens,
            dailyAmountMicro: dailyAmountMicro, monthlyAmountMicro: monthlyAmountMicro,
            maxOutputTokens: maxOutputTokens, probeEnabled: probeEnabled,
            probeMaxPerDay: probeMaxPerDay)
    }
    public func withBinding(b: BindingRecord): CustomModelRecord {
        let next = ArrayList<BindingRecord>()
        for (old in bindings) { next.add(old) }
        next.add(b)
        return withBindings(next.toArray())
    }
}

public class CustomModelView {
    public let models: Array<CustomModelRecord>
    public let revision: Int64
    public let writable: Bool
    public init(models: Array<CustomModelRecord>, revision: Int64, writable: Bool) {
        this.models = models; this.revision = revision; this.writable = writable
    }
    public func asJson(): String {
        var arr = ""
        for (i in 0..models.size) {
            if (i > 0) { arr += "," }
            arr += models[i].toJson()
        }
        return "{\"models\":[${arr}],\"revision\":${revision},\"writable\":${if (writable) { "true" } else { "false" }}}"
    }
}

public class CustomModelRegistry {
    let file: String
    // 归属标签只来自构造参数（forUser 传本机 installationId）：
    // 不提供「从入参/data 读一个 owner 覆盖」的通路，否则导入会把自己的条目藏掉。
    let owner: String
    var entries = ArrayList<CustomModelRecord>()
    var revision: Int64 = 0

    public init(file: String, owner!: String = "") {
        this.file = file
        this.owner = owner
    }

    // 与 providers.log 同目录：两个入口解析到同一份文档
    public static func forUser(): CustomModelRegistry {
        let dir = Path(GlobalAppearanceSettings.forUser().settingsPath()).parent.toString()
        return CustomModelRegistry("${dir}/custom-models.log", owner: Principal.forUser().installationId)
    }

    // 每次操作都从盘上重放：注册表是文档，不是进程内状态。
    private func reload(): Unit {
        entries = ArrayList<CustomModelRecord>()
        revision = Int64(0)
        if (!exists(file)) {
            return
        }
        let log = SessionLog(file)
        if (!log.load()) {
            throw Exception("custom-replay-rejected")
        }
        for (ev in log.snapshotEvents()) {
            // revision 是日志事件条数，跨 owner 一起涨：乐观并发认的是文档版本，
            // 不是可见条目数。两个入口并发写同一份日志时后写者拿 settings-conflict 是正确行为。
            revision += 1
            // 别人的条目当不存在：不报错、不合并、不销毁
            if (owner.size > 0 && fieldOfText(ev.data, "ownerId") != owner) {
                continue
            }
            if (ev.eventType == "custom/upsert") {
                let rec = parseRecord(ev.data)
                var replaced = false
                var i = Int64(0)
                while (i < Int64(entries.size)) {
                    if (entries[i].id == rec.id) { entries[i] = rec; replaced = true }
                    i += 1
                }
                if (!replaced) { entries.add(rec) }
            } else if (ev.eventType == "custom/remove") {
                let target = fieldOfText(ev.data, "customId")
                let kept = ArrayList<CustomModelRecord>()
                for (rec in entries) {
                    if (rec.id != target) { kept.add(rec) }
                }
                entries = kept
            }
        }
    }

    public func describe(): CustomModelView {
        reload()
        return CustomModelView(entries.toArray(), revision, true)
    }

    public func upsert(draft: String, expectedRevision: Int64): Unit {
        upsertObject(json(draft), expectedRevision)
    }

    public func upsertObject(obj: JsonObject, expectedRevision: Int64): Unit {
        reload()
        guardRevision(expectedRevision)
        let rec = parseRecordObject(obj)
        commit("custom/upsert", rec.toJson(ownerId: owner))
    }

    public func remove(id: String, expectedRevision: Int64): Unit {
        reload()
        guardRevision(expectedRevision)
        if (find(id).id.size == 0) {
            throw Exception("settings-rejected")
        }
        commit("custom/remove", "{\"customId\":\"${jsonEscapeText(id)}\",\"ownerId\":\"${jsonEscapeText(owner)}\"}")
    }

    private func find(id: String): CustomModelRecord {
        for (rec in entries) {
            if (rec.id == id) { return rec }
        }
        return CustomModelRecord("", "", "", false, "", [], [], "weighted")
    }

    // —— 绑定写面：保存时就拒，不等调度器运行时静默跳过 ——

    public func upsertBinding(customId: String, bindingJson: String, providers: ProviderView, expectedRevision: Int64): Unit {
        reload()
        guardRevision(expectedRevision)
        let rec = find(customId)
        if (rec.id.size == 0) {
            throw Exception("settings-rejected")
        }
        let b = parseBinding(bindingJson)
        // 同一 (providerId, modelId) 不得重复绑定：键是实例，不是品牌——
        // deepseek-a 与 deepseek-b 各绑一次是号池的正确形态
        if (hasBinding(rec, b.providerId, b.modelId)) {
            throw Exception("settings-rejected")
        }
        if (!fitsRequirements(rec, b, providers)) {
            throw Exception("settings-rejected")
        }
        if (Int64(rec.bindings.size) + 1 > 32) {
            throw Exception("settings-rejected")
        }
        let next = ArrayList<BindingRecord>()
        for (old in rec.bindings) { next.add(old) }
        next.add(b)
        commit("custom/upsert", rec.withBindings(next.toArray()).toJson(ownerId: owner))
    }

    public func removeBinding(customId: String, providerId: String, modelId: String, expectedRevision: Int64): Unit {
        reload()
        guardRevision(expectedRevision)
        let rec = find(customId)
        if (rec.id.size == 0) {
            throw Exception("settings-rejected")
        }
        var found = false
        let next = ArrayList<BindingRecord>()
        for (b in rec.bindings) {
            if (b.providerId == providerId && b.modelId == modelId) {
                found = true
            } else {
                next.add(b)
            }
        }
        if (!found) {
            throw Exception("settings-rejected")
        }
        commit("custom/upsert", rec.withBindings(next.toArray()).toJson(ownerId: owner))
    }

    // 重排必须整条给全：少给一段比不重排更糟（半途状态没法解释），
    // 键集与现存逐一对应才落盘，order 列按给定顺序重写 0..n-1。
    public func reorderBindings(customId: String, orderedKeys: Array<String>, expectedRevision: Int64): Unit {
        reload()
        guardRevision(expectedRevision)
        let rec = find(customId)
        if (rec.id.size == 0) {
            throw Exception("settings-rejected")
        }
        if (Int64(orderedKeys.size) != Int64(rec.bindings.size)) {
            throw Exception("settings-rejected")
        }
        var used = Array<Bool>(rec.bindings.size, repeat: false)
        let out = ArrayList<BindingRecord>()
        for (key in orderedKeys) {
            let parts = splitKey(key)
            var pick = Int64(-1)
            var i = Int64(0)
            while (i < Int64(rec.bindings.size)) {
                let b = rec.bindings[i]
                if (!used[i] && b.providerId == parts[0] && b.modelId == parts[1]) {
                    pick = i
                }
                i += 1
            }
            if (pick < 0) {
                throw Exception("settings-rejected")
            }
            used[pick] = true
            out.add(rec.bindings[pick].withOrder(Int64(out.size)))
        }
        commit("custom/upsert", rec.withBindings(out.toArray()).toJson(ownerId: owner))
    }

    // 供应商删了要显示「供应商已关闭/已删除」，不静默丢配置：
    // dangling 不是拒绝，是读面与 B2 过滤链的输入。
    public func isDangling(b: BindingRecord, providers: ProviderView): Bool {
        for (p in providers.providers) {
            if (p.id == b.providerId) { return false }
        }
        return true
    }

    private func fitsRequirements(rec: CustomModelRecord, b: BindingRecord, providers: ProviderView): Bool {
        if (isDangling(b, providers)) { return false }
        let spec = providerModel(b.providerId, b.modelId, providers)
        // unknown 不等于满足：不认识的能力不投放（§2.2）
        if (spec.availability != "available") { return false }
        // requires 里混着两类词，满足路径不同，不能都塞给 supports：
        //   能力位（tools/stream/structured-output/image-output）→ supports 登记；
        //   模态（text-output）→ outputModalities 含 text。
        // 把模态词也当 supports 查是死路——"text-output" 不是合法 supports 值，
        // 任何 requires 含 text-output 的模型都永远绑不上，能力适配会退化成空转。
        for (need in rec.requires) {
            if (need == "text-output") {
                if (!hasFlag(spec.outputModalities, "text")) { return false }
            } else if (!spec.hasCapability(need)) {
                return false
            }
        }
        if (hasFlag(rec.requires, "image-output") && !hasFlag(spec.outputModalities, "image")) {
            return false
        }
        return true
    }

    // 找不到上游模型时返回 availability=unknown 的空 spec：
    // 空值不特殊放行，与「unknown 不等于满足」同一条纪律。
    private static func providerModel(providerId: String, modelId: String, providers: ProviderView): ModelSpec {
        for (p in providers.providers) {
            if (p.id == providerId) {
                for (m in p.models) {
                    if (m.id == modelId) { return m }
                }
            }
        }
        return ModelSpec("", "", "", "", false)
    }

    private static func hasBinding(rec: CustomModelRecord, providerId: String, modelId: String): Bool {
        for (b in rec.bindings) {
            if (b.providerId == providerId && b.modelId == modelId) { return true }
        }
        return false
    }

    private static func hasFlag(list: Array<String>, value: String): Bool {
        for (v in list) {
            if (v == value) { return true }
        }
        return false
    }

    // 只按第一个 '/' 切，且只允许一段斜线：step/、/m-a、a/b/c 都拒
    private static func splitKey(key: String): Array<String> {
        let bs = key.toArray()
        var slash = Int64(-1)
        var i = Int64(0)
        while (i < Int64(bs.size)) {
            if (bs[i] == 47) { slash = i; break }
            i += 1
        }
        if (slash <= 0 || slash >= Int64(bs.size) - 1) {
            throw Exception("settings-rejected")
        }
        var j = slash + 1
        while (j < Int64(bs.size)) {
            if (bs[j] == 47) { throw Exception("settings-rejected") }
            j += 1
        }
        let head = ArrayList<Byte>()
        let tail = ArrayList<Byte>()
        i = Int64(0)
        while (i < slash) { head.add(bs[i]); i += 1 }
        i = slash + 1
        while (i < Int64(bs.size)) { tail.add(bs[i]); i += 1 }
        return [String.fromUtf8(head.toArray()), String.fromUtf8(tail.toArray())]
    }

    private func parseBinding(text: String): BindingRecord {
        let obj = json(text)
        return parseOneBinding(obj)
    }

    // —— 两种导入操作（规格 §9.1）：各建一个新模型 vs 加入已有模型 ——

    // 每个选中上游各建一个自定义模型，初始单绑定。新建入口**不预判能力**：
    // 用户可能先建结构、后配供应商或补填价格，能力适配由 importInto（加入带
    // requires 的已有模型）与 B2 调度过滤把守；这里拒了反而堵死「先建后配」。
    // 幂等键是 (providerId, modelId) 稳定派生的自定义模型 id：同一个包重复
    // 导入不重复创建，一条都没新建就不落事件。
    public func importNewModels(items: Array<String>, providers: ProviderView, expectedRevision: Int64): Array<String> {
        reload()
        guardRevision(expectedRevision)
        let created = ArrayList<String>()
        for (key in items) {
            let parts = splitKey(key)
            let derived = "${parts[0]}-${parts[1]}"
            // 派生不出合法 id 就整批拒：静默跳过会让用户以为导过了
            checkStableId(derived)
            if (find(derived).id.size > 0) { continue }
            let bindings = ArrayList<BindingRecord>()
            bindings.add(parseBinding(importedBindingJson(parts[0], parts[1], 0)))
            let rec = CustomModelRecord(derived, parts[1], "", true, "general", ["text-output"],
                bindings.toArray(), "weighted")
            commit("custom/upsert", rec.toJson(ownerId: owner))
            created.add(derived)
        }
        return created.toArray()
    }

    // 加入已有自定义模型：先过能力适配与重复绑定校验，整批原子——
    // 半途失败留下「一半已导入」会让用户重试时撞唯一键。
    // 返回本次真正新增的绑定条数；一条都没加是成功，但不落事件。
    public func importInto(customId: String, items: Array<String>, providers: ProviderView, expectedRevision: Int64): Int64 {
        reload()
        guardRevision(expectedRevision)
        let rec = find(customId)
        if (rec.id.size == 0) {
            throw Exception("settings-rejected")
        }
        var built = rec
        var added: Int64 = 0
        for (key in items) {
            let parts = splitKey(key)
            if (hasBinding(built, parts[0], parts[1])) { continue }
            let b = parseBinding(importedBindingJson(parts[0], parts[1], nextOrder(built)))
            if (!fitsRequirements(built, b, providers)) {
                throw Exception("settings-rejected")
            }
            built = built.withBinding(b)
            added += 1
        }
        if (added == 0) { return 0 }
        commit("custom/upsert", built.toJson(ownerId: owner))
        return added
    }

    private static func nextOrder(rec: CustomModelRecord): Int64 {
        var top: Int64 = -1
        for (b in rec.bindings) {
            if (b.order > top) { top = b.order }
        }
        return top + 1
    }

    // 导入 = 「候选进入调度」，不是「替用户决定价格」：币种留空 = 未定价，
    // 四档费率全 -1，账本侧对应用 待核算 状态承接（§7.1）。
    private static func importedBindingJson(providerId: String, modelId: String, order: Int64): String {
        return "{\"providerId\":\"${jsonEscapeText(providerId)}\",\"modelId\":\"${jsonEscapeText(modelId)}\","
            + "\"enabled\":true,\"order\":${order},\"weight\":1,"
            + "\"priceInMicro\":-1,\"priceOutMicro\":-1,\"priceCacheReadMicro\":-1,\"priceCacheWriteMicro\":-1,"
            + "\"priceVersion\":0,\"currency\":\"\"}"
    }

    private func guardRevision(expectedRevision: Int64): Unit {
        if (expectedRevision >= 0 && expectedRevision != revision) {
            throw Exception("settings-conflict")
        }
    }

    private func commit(eventType: String, data: String): Unit {
        let log = SessionLog(file)
        if (exists(file) && !log.load()) {
            throw Exception("custom-replay-rejected")
        }
        log.append(eventType, data)
        if (!log.flush()) {
            throw Exception("custom-flush-failed")
        }
        reload()
    }

    private func parseRecord(text: String): CustomModelRecord {
        return parseRecordObject(json(text))
    }

    // 校验清单顺序固定，任一不过 settings-rejected（本层是新文档，没有向后兼容负担）
    private func parseRecordObject(obj: JsonObject): CustomModelRecord {
        // 1. 禁明文槽位：这一层也没有能承载密钥的槽位
        rejectPlaintextSlots(obj)
        // 2. 稳定 ID 与 3. 文本字段
        let id = textField(obj, "id")
        checkStableId(id)
        let name = textField(obj, "name")
        checkText(name, 100)
        let description = optionalTextField(obj, "description")
        checkText(description, 500)
        let enabled = boolField(obj, "enabled", true)
        // 4. 主分类必填且在闭集内
        let category = textField(obj, "category")
        var categoryKnown = false
        for (c in customCategories) {
            if (c == category) { categoryKnown = true }
        }
        if (!categoryKnown) {
            throw Exception("settings-rejected")
        }
        // 5. 所需能力：闭集、去重、至少一项
        let requires = stringArrayField(obj, "requires", customRequires)
        if (Int64(requires.size) == 0) {
            throw Exception("settings-rejected")
        }
        // 6. 调度模式，缺省 weighted（平滑加权轮询）
        let mode = enumField(obj, "mode", customModes, "weighted")
        // 7. 绑定必填、可为空数组（空 = 暂不可调度），上限 32
        if (obj.get("bindings").isNone()) {
            throw Exception("settings-rejected")
        }
        let bindings = parseBindings(obj)
        if (Int64(bindings.size) > 32) {
            throw Exception("settings-rejected")
        }
        // 8. 排序列只接受非负（显示序，负值没有意义）
        let sortOrder = intField(obj, "sortOrder", 0)
        if (sortOrder < 0) {
            throw Exception("settings-rejected")
        }
        // 9. 同一模型内非空 currency 至多一种：跨币种必须显式登记换算，
        //    不许用统一单价把金额算错（断言 41）
        var currency = ""
        for (b in bindings) {
            if (b.currency.size == 0) { continue }
            if (currency.size == 0) {
                currency = b.currency
            } else if (currency != b.currency) {
                throw Exception("settings-rejected")
            }
        }
        // 10. 参数与模态预算：自由格式 JSON 原文，长度受限、键名过明文名单、逐字回读
        let params = freeFormJsonField(obj, "params")
        let modalityBudget = freeFormJsonField(obj, "modalityBudget")
        // 11. 预算与探测列：-1 = 未设置，0 = 有意的零额度，其它负数拒绝
        let dailyTokens = budgetField(obj, "dailyTokens")
        let monthlyTokens = budgetField(obj, "monthlyTokens")
        let dailyAmountMicro = budgetField(obj, "dailyAmountMicro")
        let monthlyAmountMicro = budgetField(obj, "monthlyAmountMicro")
        let maxOutputTokens = budgetField(obj, "maxOutputTokens")
        let probeEnabled = boolField(obj, "probeEnabled", true)
        let probeMaxPerDay = intField(obj, "probeMaxPerDay", 3)
        if (probeMaxPerDay < 0 || probeMaxPerDay > 100) {
            throw Exception("settings-rejected")
        }
        return CustomModelRecord(id, name, description, enabled, category, requires, bindings, mode,
            sortOrder: sortOrder, params: params, modalityBudget: modalityBudget,
            dailyTokens: dailyTokens, monthlyTokens: monthlyTokens,
            dailyAmountMicro: dailyAmountMicro, monthlyAmountMicro: monthlyAmountMicro,
            maxOutputTokens: maxOutputTokens, probeEnabled: probeEnabled,
            probeMaxPerDay: probeMaxPerDay)
    }

    private func parseBindings(obj: JsonObject): Array<BindingRecord> {
        let value = obj.get("bindings").getOrThrow()
        if (isNullValue(value)) {
            throw Exception("settings-rejected")
        }
        let arr = value.asArray()
        let out = ArrayList<BindingRecord>()
        var pos: Int64 = 0
        while (let Some(item) <- arr.get(pos)) {
            pos += 1
            out.add(parseOneBinding(item.asObject()))
        }
        // 去重在这里做：parseOneBinding 是单条判据，跨条一致性是本层的规则
        var i = Int64(0)
        while (i < Int64(out.size)) {
            var j = Int64(i + 1)
            while (j < Int64(out.size)) {
                if (out[i].providerId == out[j].providerId && out[i].modelId == out[j].modelId) {
                    throw Exception("settings-rejected")
                }
                j += 1
            }
            i += 1
        }
        return out.toArray()
    }

    // 单条绑定判据：唯一键查重、能力适配、写侧都走它——一份判据两个入口
    private static func parseOneBinding(o: JsonObject): BindingRecord {
        let providerId = textField(o, "providerId")
            let modelId = textField(o, "modelId")
            if (providerId.size == 0 || modelId.size == 0) {
                throw Exception("settings-rejected")
            }
            let enabled = boolField(o, "enabled", true)
            let order = intField(o, "order", 0)
            if (order < 0) {
                throw Exception("settings-rejected")
            }
            let weight = intField(o, "weight", 1)
            if (weight < 1 || weight > 1000) {
                throw Exception("settings-rejected")
            }
            let priceInMicro = priceField(o, "priceInMicro")
            let priceOutMicro = priceField(o, "priceOutMicro")
            let priceCacheReadMicro = priceField(o, "priceCacheReadMicro")
            let priceCacheWriteMicro = priceField(o, "priceCacheWriteMicro")
            let priceVersion = intField(o, "priceVersion", 0)
            if (priceVersion < 0) {
                throw Exception("settings-rejected")
            }
            // 空串 = 未定价（导入时用户还没填价，不凭空造单价）；给了就必须是 3 位大写字母
            let currency = optionalTextField(o, "currency")
            if (currency.size > 0 && !isCurrencyCode(currency)) {
                throw Exception("settings-rejected")
            }
            return BindingRecord(providerId, modelId, enabled, order, weight,
                priceInMicro, priceOutMicro, priceCacheReadMicro, priceCacheWriteMicro,
                priceVersion, currency)
    }

    // 币种码：3 位大写字母；空串 = 未定价（导入时用户还没填价，不凭空造单价）
    private static func isCurrencyCode(value: String): Bool {
        let bs = value.toArray()
        if (bs.size != 3) {
            return false
        }
        for (b in bs) {
            if (b < 65 || b > 90) {
                return false
            }
        }
        return true
    }

    // 费率维度：-1 = 未登记，>= 0 = 已登记；其它负数拒绝
    private static func priceField(obj: JsonObject, key: String): Int64 {
        let v = intField(obj, key, -1)
        if (v < -1) {
            throw Exception("settings-rejected")
        }
        return v
    }

    // 预算列：-1 = 未设置，0 = 有意的零额度；其它负数拒绝
    private static func budgetField(obj: JsonObject, key: String): Int64 {
        let v = intField(obj, key, -1)
        if (v < -1) {
            throw Exception("settings-rejected")
        }
        return v
    }

    // 自由格式 JSON 原文：解析只为校验（能解析 + 键名不带明文槽位），
    // 落盘写的还是用户给的那一串——重新序列化会重排键序。
    private static func freeFormJsonField(obj: JsonObject, key: String): String {
        let text = optionalTextField(obj, key)
        if (text.size == 0) {
            return ""
        }
        if (text.size > 4000) {
            throw Exception("settings-rejected")
        }
        let parsed = json(text)
        rejectPlaintextSlots(parsed)
        return text
    }

    // —— 以下私有助手与 provider_registry.cj 的同名助手逐字一致（收口留到 B6） ——

    private static func rejectPlaintextSlots(obj: JsonObject): Unit {
        for (forbidden in ["apiKey", "api_key", "key", "token", "secret", "value"]) {
            if (let Some(v) <- obj.get(forbidden)) {
                if (!isNullValue(v)) {
                    throw Exception("settings-rejected")
                }
            }
        }
    }

    private static func json(text: String): JsonObject {
        try {
            return JsonValue.fromStr(text).asObject()
        } catch (e: Exception) {
            throw Exception("settings-rejected")
        }
    }

    private static func isNullValue(v: JsonValue): Bool {
        match (v.kind()) {
            case JsNull => true
            case _ => false
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

    private static func optionalTextField(obj: JsonObject, key: String): String {
        if (let Some(v) <- obj.get(key)) {
            if (isNullValue(v)) {
                return ""
            }
            return v.asString().getValue()
        }
        return ""
    }

    private static func boolField(obj: JsonObject, key: String, dflt: Bool): Bool {
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

    private static func fieldOfText(text: String, key: String): String {
        let obj = json(text)
        if (let Some(v) <- obj.get(key)) {
            return v.asString().getValue()
        }
        return ""
    }
}
