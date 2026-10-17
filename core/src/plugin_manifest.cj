package core

import std.collection.*
import stdx.encoding.json.*

// 本地插件包 manifest 的解析与校验。这是「一切皆插件」从 0 到 1 的第一步：
// 在写任何安装、激活、装配代码之前，先把「一个插件包到底长什么样」钉成可执行断言。
//
// 纪律（与 provider_registry.cj 的配置面同源）：
//   1. 只信自家写出的规范形态，解析不过就当整份拒绝，不做任何静默修正；
//   2. 禁字段时间——这份文档面上根本没有能承载明文的槽位，而不是「存了但读的时候删掉」；
//   3. 工具名撞核心内置工具必须显式拒：后到者静默覆盖已有工具语义，模型看到的两份描述会打架；
//   4. 缺省值只给「老包没有这个字段」的兼容位，结构位（name/version/entry）一个都不给默认。
//
// 上游对应物待核：packages/util/package-manifest/src/{index,types}.ts 与
// .agents/notes/implemented/architecture/2026-09-05-package-manifest-types.md
// （冻结树可见路径，正文本次读不到）。本文件的字段名与闭集是 SaCode 设计，
// 与桌面侧 plugin-manager-adapter.ts 已承诺的视图形状逐字段对齐——那份适配器
// 是上游 ui-plugin-manager/manager-store.ts 的移植，是本研究里唯一可指认的契约面。

// 插件种类闭集。用户要求「一切皆插件」涵盖工具、模型、业务能力、前端贡献及预设装配，
// 所以闭集先按这五类定满；装配分阶段接，未接的种类在装配层拒（plugin-kind-not-wired），
// 不在解析层拒——否则将来接前端贡献时要重新解释旧包。
let pluginKinds = ["tool", "model", "service", "ui", "preset"]

// 核心内置工具名：manifest 声明的工具不得与它们相撞。
// 这份清单与 core/src/agent.cj 的 ToolRuntime.pipeline 实现三名一一对应，
// 与 core/src/model_tool_runtime.cj 的 files 分支登记两名一一对应。
let builtinToolNames = ["todo_write", "read", "write"]

// 与 provider_registry.cj 同一份禁字段名单：任何想顺路把密钥值塞进来的草稿一律拒绝。
let forbiddenManifestKeys = ["apiKey", "api_key", "key", "token", "secret", "value", "password", "authorization"]

// 长度上限与桌面 plugin-manager-adapter.ts 的 normalizePackage/normalizeRow 逐字段对齐：
// 宿主放宽一点，渲染层就会以 plugin-inventory-rejected 整份拒收，用户看到的是「读不到插件」
// 而不是「这个包名太长」——所以两边的上限必须是同一个数。
let nameLimit = 214
let versionLimit = 64
let titleLimit = 214
let descriptionLimit = 2000
let entryLimit = 300
let toolNameLimit = 100
let toolDescriptionLimit = 2000
let dependencyLimit = 214

// manifest 里声明的一个工具。name/description/params 必须与 entry 模块的导出逐字一致，
// 装配层负责核对（契约见 docs/evidence/backend-plugin-contract-2026-10-05.md §4.3）；
// 本层只校验形态，不碰文件系统、不加载模块——这样它才能在没有 Node 的环境里被单测钉住。
public class PluginToolDecl {
    public let name: String
    public let description: String
    public let params: String
    public let needsApproval: Bool

    public init(name: String, description: String, params: String, needsApproval: Bool) {
        this.name = name
        this.description = description
        this.params = params
        this.needsApproval = needsApproval
    }
}

// 非工具类贡献的声明：模型、服务、界面、预设共用同一形态。
// tools 有 params/撞内置工具名等专属规则，所以单独一支；其余四类只需
// 「名字唯一 + 描述 + 审批声明」。name 是各自贡献面内的唯一标识。
public class PluginContributionDecl {
    public let name: String
    public let description: String
    public let needsApproval: Bool

    public init(name: String, description: String, needsApproval: Bool) {
        this.name = name
        this.description = description
        this.needsApproval = needsApproval
    }
}

// 一份解析成功的 manifest。字段全是 public let：调用方拿到的是一份不可变快照，
// 改动它不会反向影响注册表（与 ToolRegistry.list() 返回副本同一条纪律）。
public class PluginManifest {
    public let name: String
    public let version: String
    public let title: String
    public let description: String
    public let descriptionZhCN: String
    public let kind: String
    public let entry: String
    public let optional: Bool
    public let enabled: Bool
    public let order: Int64
    public let dependencies: Array<String>
    public let runtimeRange: String
    public let tools: Array<PluginToolDecl>
    public let models: Array<PluginContributionDecl>
    public let services: Array<PluginContributionDecl>
    public let ui: Array<PluginContributionDecl>
    public let presets: Array<PluginContributionDecl>

    public init(name: String, version: String, title: String, description: String,
        descriptionZhCN: String, kind: String, entry: String, optional: Bool, enabled: Bool,
        order: Int64, dependencies: Array<String>, runtimeRange: String, tools: Array<PluginToolDecl>,
        models: Array<PluginContributionDecl>, services: Array<PluginContributionDecl>,
        ui: Array<PluginContributionDecl>, presets: Array<PluginContributionDecl>) {
        this.name = name
        this.version = version
        this.title = title
        this.description = description
        this.descriptionZhCN = descriptionZhCN
        this.kind = kind
        this.entry = entry
        this.optional = optional
        this.enabled = enabled
        this.order = order
        this.dependencies = dependencies
        this.runtimeRange = runtimeRange
        this.tools = tools
        this.models = models
        this.services = services
        this.ui = ui
        this.presets = presets
    }
}

public func parsePluginManifest(text: String): PluginManifest {
    let obj = manifestObject(text)
    rejectForbiddenKeys(obj)
    let name = textField(obj, "name")
    checkPluginName(name)
    let version = textField(obj, "version")
    checkPluginVersion(version)
    let kind = enumField(obj, "kind", pluginKinds, "tool")
    let entry = textField(obj, "entry")
    checkPluginEntry(entry)
    let declaredTitle = optionalTextField(obj, "title")
    let title = if (declaredTitle.size > 0) { declaredTitle } else { shortPluginName(name) }
    let description = optionalTextField(obj, "description")
    let descriptionZhCN = optionalTextField(obj, "descriptionZhCN")
    checkText(title, titleLimit)
    checkText(description, descriptionLimit)
    checkText(descriptionZhCN, descriptionLimit)
    let tools = parseToolDecls(obj)
    let models = parseContributionDecls(obj, "models")
    let services = parseContributionDecls(obj, "services")
    let ui = parseContributionDecls(obj, "ui")
    let presets = parseContributionDecls(obj, "presets")
    return PluginManifest(
        name,
        version,
        title,
        description,
        descriptionZhCN,
        kind,
        entry,
        boolFieldDefault(obj, "optional", false),
        boolFieldDefault(obj, "enabled", true),
        intFieldDefault(obj, "order", 0),
        stringArrayField(obj, "dependencies", dependencyLimit),
        runtimeRangeOf(obj),
        tools,
        models,
        services,
        ui,
        presets
    )
}

// 显示名从包名派生：去掉 scope 前缀，与桌面 mapPackage 的
// `p.title || p.name.replace(/^@[^/]+\//, '')` 是同一条规则——两边算出同一个名字，
// 用户才不会在安装前看到 @local/x、装完后看到 x。
public func shortPluginName(name: String): String {
    // 下标查找一律走 `?? Int64(-1)`：Option 与 nil 的比较在本仓没有先例，
    // 而 `?? 默认值` 是 slots.cj 等文件在用的同一条路。
    let slash = name.indexOf("/") ?? Int64(-1)
    if (slash < 0) {
        return name
    }
    let at = name.indexOf("@") ?? Int64(-1)
    if (at == 0) {
        return name[(slash + 1)..name.size]
    }
    return name
}

private func manifestObject(text: String): JsonObject {
    if (text.trimAscii().size == 0) {
        throw Exception("plugin-rejected")
    }
    try {
        return JsonValue.fromStr(text).asObject()
    } catch (e: Exception) {
        // 解析不过就是解析不过：不猜、不补默认、不退回「当作空 manifest」。
        throw Exception("plugin-rejected")
    }
}

private func rejectForbiddenKeys(obj: JsonObject): Unit {
    for (forbidden in forbiddenManifestKeys) {
        if (let Some(v) <- obj.get(forbidden)) {
            if (!isNullValue(v)) {
                throw Exception("plugin-rejected")
            }
        }
    }
}

// 包名：非空、不超上限、不含空白与反斜杠、不以点开头、`/` 只允许作用域形态一种。
// 不套用 npm 完整规范——本地包由用户手写或模型协助生成，收得太紧会把
// 「一个能用的本地插件」挡在门外。
private func checkPluginName(name: String): Unit {
    if (name.size == 0 || name.size > nameLimit) {
        throw Exception("plugin-rejected")
    }
    let bytes = name.toArray()
    var i: Int64 = 0
    while (i < bytes.size) {
        let b = bytes[i]
        // 空白与反斜杠永远禁：前者让包名在日志里对不齐，后者是 Windows 路径分隔符，
        // 会真被当成目录分隔符用。**`/` 不在这里禁**——见 checkScopedName。
        if (b == 32 || b == 9 || b == 10 || b == 13 || b == 92) {
            throw Exception("plugin-rejected")
        }
        i += 1
    }
    if (name.startsWith(".")) {
        throw Exception("plugin-rejected")
    }
    checkScopedName(name, bytes)
}

// `/` 是**包名分隔符**，不是路径分隔符——但只在作用域形态里成立。
//
// 这里曾有一个真 bug：把 `/`（47）无条件禁掉，理由写的是「会被当成目录用」。
// 可 `@scope/name` 本身就含 `/`，那是 npm 包名语法。于是一切作用域包名
// （`@local/x`、`@local/sacode-tool-echo`）都在最前面被通用码拒掉，
// 后面更具体的规则（撞名、禁字段）一条都测不出来——通用码把具体码全盖住了。
//
// 判据因此拆成三条，各自单独可反证：
//   1. 不以 `@` 开头 → 一个 `/` 都不许有（那是笔误或路径）；
//   2. 以 `@` 开头 → 恰好一个 `/`，且两侧都非空；
//   3. 反斜杠在上一层已经永远禁掉，与作不作用域无关。
private func checkScopedName(name: String, bytes: Array<UInt8>): Unit {
    let scoped = name.startsWith("@")
    var slashes = Int64(0)
    var slash = Int64(-1)
    var i: Int64 = 0
    while (i < Int64(bytes.size)) {
        if (bytes[i] == 47) {
            slashes += 1
            if (slash < 0) {
                slash = i
            }
        }
        i += 1
    }
    if (!scoped) {
        if (slashes > 0) {
            throw Exception("plugin-rejected")
        }
        return
    }
    if (slashes != 1) {
        // 两个及以上：`@a/b/c`、`@local//x`。放行它们会让「哪个目录是这个包的」
        // 取决于切分算法而不是用户的声明。
        throw Exception("plugin-rejected")
    }
    if (slash <= 1) {
        // `@/x`：`@` 之后紧接 `/`，scope 为空。
        throw Exception("plugin-rejected")
    }
    if (slash >= Int64(bytes.size) - 1) {
        // `@local/`：`/` 是最后一个字节，name 为空。
        throw Exception("plugin-rejected")
    }
}

// 版本：三段十进制，每段不超过 5 位（99999 足够本地包，也挡得住把整篇文章塞进版本号）。
// 不引入 prerelease/build 元数据——本地安装按目录名与版本号定位，不需要它们。
private func checkPluginVersion(version: String): Unit {
    if (version.size == 0 || version.size > versionLimit) {
        throw Exception("plugin-rejected")
    }
    var segment = 0
    var digits = 0
    var segments = 0
    let bytes = version.toArray()
    var i: Int64 = 0
    while (i < bytes.size) {
        let b = bytes[i]
        if (b == 46) {
            if (digits == 0) {
                throw Exception("plugin-rejected")
            }
            segments += 1
            segment = 0
            digits = 0
        } else if (b >= 48 && b <= 57) {
            // 先转 Int64 再算：UInt8 直接减字面量会被推断成 UInt8 运算，
            // 借位时静默绕回一个大数——provider_registry.cj 在同一处显式写了 UInt8(32)，
            // 这里选更稳的一种：转到 64 位再减。
            segment = segment * 10 + (Int64(b) - Int64(48))
            if (segment > 99999) {
                throw Exception("plugin-rejected")
            }
            digits += 1
            if (digits > 5) {
                throw Exception("plugin-rejected")
            }
        } else {
            throw Exception("plugin-rejected")
        }
        i += 1
    }
    if (digits == 0 || segments != 2) {
        throw Exception("plugin-rejected")
    }
}

// 入口：必须是 .cjs、相对路径、不含 `..`、不含反斜杠。
// 这条是安装态原子性的第一道闸——entry 能逃出插件目录，等于插件可以指到
// 宿主自己的代码上，「以你的权限运行」就不再是一句警告而是既成事实。
private func checkPluginEntry(entry: String): Unit {
    if (entry.size == 0 || entry.size > entryLimit) {
        throw Exception("plugin-rejected")
    }
    if (entry.startsWith("/") || entry.startsWith("\\")) {
        throw Exception("plugin-rejected")
    }
    if ((entry.indexOf("..") ?? Int64(-1)) >= 0) {
        throw Exception("plugin-rejected")
    }
    if ((entry.indexOf("\\") ?? Int64(-1)) >= 0) {
        throw Exception("plugin-rejected")
    }
    if (!entry.endsWith(".cjs")) {
        throw Exception("plugin-rejected")
    }
}

private func parseToolDecls(obj: JsonObject): Array<PluginToolDecl> {
    if (obj.get("tools").isNone()) {
        return []
    }
    let value = obj.get("tools").getOrThrow()
    if (isNullValue(value)) {
        return []
    }
    let arr = value.asArray()
    let out = ArrayList<PluginToolDecl>()
    var pos: Int64 = 0
    while (let Some(item) <- arr.get(pos)) {
        pos += 1
        if (isNullValue(item)) {
            continue
        }
        let o = item.asObject()
        let description = textField(o, "description")
        checkText(description, toolDescriptionLimit)
        let decl = PluginToolDecl(
            toolNameField(o),
            description,
            paramsField(o),
            boolFieldDefault(o, "needsApproval", false)
        )
        for (seen in out) {
            if (seen.name == decl.name) {
                throw Exception("plugin-rejected")
            }
        }
        out.add(decl)
    }
    return out.toArray()
}

// 四类非工具贡献声明的解析：models/services/ui/presets 共用同一形态。
// 参数非对象形态一律拒（与 tool params 必须为 JSON 对象同一条纪律：认不出就是不认，
// 不把看错的东西当成一类贡献装上）。
private func parseContributionDecls(obj: JsonObject, key: String): Array<PluginContributionDecl> {
    if (obj.get(key).isNone()) {
        return []
    }
    let value = obj.get(key).getOrThrow()
    if (isNullValue(value)) {
        return []
    }
    let arr = value.asArray()
    let out = ArrayList<PluginContributionDecl>()
    var pos: Int64 = 0
    while (let Some(item) <- arr.get(pos)) {
        pos += 1
        if (isNullValue(item)) {
            continue
        }
        var o: JsonObject
        try {
            o = item.asObject()
        } catch (e: Exception) {
            throw Exception("plugin-rejected")
        }
        let description = optionalTextField(o, "description")
        checkText(description, toolDescriptionLimit)
        let decl = PluginContributionDecl(
            contributionNameField(o),
            description,
            boolFieldDefault(o, "needsApproval", false)
        )
        for (seen in out) {
            if (seen.name == decl.name) {
                throw Exception("plugin-rejected")
            }
        }
        out.add(decl)
    }
    return out.toArray()
}

// 贡献名：非空、不超上限。不做撞内置工具名校验——内置工具名只对 tools 段成立，
// 模型/服务/界面/预设的命名空间与工具不是同一个。
private func contributionNameField(obj: JsonObject): String {
    let name = textField(obj, "name")
    if (name.size == 0 || name.size > toolNameLimit) {
        throw Exception("plugin-rejected")
    }
    return name
}

// 长度上限与桌面 plugin-manager-adapter.ts 的 normalizePackage/normalizeRow 是同一个数：
// 宿主放宽一点，渲染层就会以 plugin-inventory-rejected 整份拒收，用户看到的是
// 「读不到插件」而不是「这句说明太长」——所以上限必须在宿主这一侧就先卡住。
private func checkText(text: String, limit: Int64): Unit {
    if (text.size > limit) {
        throw Exception("plugin-rejected")
    }
}

private func toolNameField(obj: JsonObject): String {
    let name = textField(obj, "name")
    if (name.size == 0 || name.size > toolNameLimit) {
        throw Exception("plugin-rejected")
    }
    for (builtin in builtinToolNames) {
        if (builtin == name) {
            // 撞名必须单独一个码：它是「插件想冒充核心工具」，
            // 与「字段写错了」是两件需要不同处置的事。
            throw Exception("plugin-tool-shadowing")
        }
    }
    return name
}

// 参数 schema 必须是 JSON 对象：把旧的空格参数声明冒充模型 schema 塞进请求体，
// 提供方会直接 400，而用户看到的是「模型拒绝了」，答不出该改哪里。
private func paramsField(obj: JsonObject): String {
    if (obj.get("params").isNone()) {
        return ""
    }
    let value = obj.get("params").getOrThrow()
    if (isNullValue(value)) {
        return ""
    }
    let text = value.asString().getValue()
    if (text.size == 0) {
        return ""
    }
    try {
        JsonValue.fromStr(text).asObject()
    } catch (e: Exception) {
        throw Exception("plugin-rejected")
    }
    return text
}

// 兼容性声明。只支持 `>=x.y.z` 一种形态：别的运算符（^、~、*、区间）没有解析入口，
// 认不出就是认不出，绝不把「看不懂」当成「一定兼容」——那正是让不兼容的包
// 在运行期才炸的唯一路径。
private func runtimeRangeOf(obj: JsonObject): String {
    if (obj.get("sacode").isNone()) {
        return ">=0.1.0"
    }
    let value = obj.get("sacode").getOrThrow()
    if (isNullValue(value)) {
        return ">=0.1.0"
    }
    let o = value.asObject()
    if (o.get("runtime").isNone()) {
        return ">=0.1.0"
    }
    let r = o.get("runtime").getOrThrow()
    if (isNullValue(r)) {
        return ">=0.1.0"
    }
    let text = r.asString().getValue()
    if (!text.startsWith(">=")) {
        throw Exception("plugin-rejected")
    }
    let rest = text[2..text.size]
    if (rest.size == 0 || rest.size > versionLimit) {
        throw Exception("plugin-rejected")
    }
    checkPluginVersion(rest)
    return text
}

// 单值枚举：缺省或 null 都取 default（老包没有这个字段，必须回放成功而不是整份作废）；
// 给了但不在闭集里一律拒——静默收下未知值等于把「不认识」伪装成「这一类」。
private func enumField(obj: JsonObject, key: String, allowed: Array<String>, dflt: String): String {
    if (let Some(v) <- obj.get(key)) {
        if (isNullValue(v)) {
            return dflt
        }
        let s = v.asString().getValue()
        for (a in allowed) {
            if (a == s) {
                return s
            }
        }
        throw Exception("plugin-rejected")
    }
    return dflt
}

private func isNullValue(v: JsonValue): Bool {
    match (v.kind()) {
        case JsNull => true
        case _ => false
    }
}

private func textField(obj: JsonObject, key: String): String {
    if (let Some(v) <- obj.get(key)) {
        if (isNullValue(v)) {
            throw Exception("plugin-rejected")
        }
        return v.asString().getValue()
    }
    throw Exception("plugin-rejected")
}

private func optionalTextField(obj: JsonObject, key: String): String {
    if (let Some(v) <- obj.get(key)) {
        if (isNullValue(v)) {
            return ""
        }
        return v.asString().getValue()
    }
    return ""
}

private func boolFieldDefault(obj: JsonObject, key: String, dflt: Bool): Bool {
    if (let Some(v) <- obj.get(key)) {
        if (isNullValue(v)) {
            return dflt
        }
        return v.asBool().getValue()
    }
    return dflt
}

private func intFieldDefault(obj: JsonObject, key: String, dflt: Int64): Int64 {
    if (let Some(v) <- obj.get(key)) {
        if (isNullValue(v)) {
            return dflt
        }
        return v.asInt().getValue()
    }
    return dflt
}

// 字符串数组：缺省空；给了就必须逐个非空、不超上限、不重复。
// 静默收下重复项会让「依赖被激活几次」取决于去重算法而不是用户的声明。
private func stringArrayField(obj: JsonObject, key: String, limit: Int64): Array<String> {
    if (obj.get(key).isNone()) {
        return []
    }
    let value = obj.get(key).getOrThrow()
    if (isNullValue(value)) {
        return []
    }
    let arr = value.asArray()
    let out = ArrayList<String>()
    var pos: Int64 = 0
    while (let Some(item) <- arr.get(pos)) {
        pos += 1
        if (isNullValue(item)) {
            continue
        }
        let s = item.asString().getValue()
        if (s.size == 0 || s.size > limit) {
            throw Exception("plugin-rejected")
        }
        for (seen in out) {
            if (seen == s) {
                throw Exception("plugin-rejected")
            }
        }
        out.add(s)
    }
    return out.toArray()
}
