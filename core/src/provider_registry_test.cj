package core

import std.fs.*
import std.collection.*
import std.unittest.*
import stdx.encoding.json.*

// 提供商注册表：桌面模型页的 Adapter 契约（load/save/remove/revision/writable）要求后端是
// 「多提供商 + 乐观并发 + 读面不带明文槽位」的形状，而不是单路 base_url 配置。
// 上游 settings 子系统的两条分类必须区分开：版本不对是 settings-conflict，
// 内容不合法是 settings-rejected——把冲突说成拒绝，UI 就没法提示「别人先改了」。
let registryFile = "core-test-providers.log"

func regCleanup(): Unit {
    if (exists(registryFile)) {
        try { removeIfExists(registryFile, recursive: false) } catch (e: Exception) {}
    }
}

func reg(): ProviderRegistry {
    return ProviderRegistry(registryFile)
}

func draftJson(id: String, baseUrl: String, protocol: String, modelIds: String): String {
    var models = ""
    for (m in modelIds.split(",")) {
        if (models.size > 0) {
            models += ","
        }
        models += "{\"id\":\"${m}\",\"name\":\"${m}\",\"contextWindow\":\"128k\",\"maxTokens\":\"4k\",\"image\":false}"
    }
    return "{\"id\":\"${id}\",\"name\":\"显示名\",\"baseUrl\":\"${baseUrl}\",\"protocol\":\"${protocol}\",\"credentialRef\":\"SA_KEY\",\"models\":[${models}]}"
}

func fieldOf(json: String, key: String): String {
    let obj = JsonValue.fromStr(json).asObject()
    if (let Some(v) <- obj.get(key)) {
        return v.asString().getValue()
    }
    return ""
}

@Test
func registryStartsEmptyAndReportsRevisionZero() {
    regCleanup()
    let view = reg().describe()
    @Expect(view.providers.size, Int64(0))
    @Expect(view.revision, Int64(0))
    @Expect(view.writable, true)
    @Expect(view.defaultProviderId, "")
    regCleanup()
}

@Test
func registryUpsertReplaysEveryFieldFromTheLog() {
    regCleanup()
    let r = reg()
    r.update(draftJson("step", "https://api.example.com/v1", "openai-completions", "m-a,m-b"), -1)
    // 换一个全新实例：唯一的证据是盘上那份日志
    let view = reg().describe()
    @Expect(view.providers.size, Int64(1))
    @Expect(view.revision, Int64(1))
    let p = view.providers[0]
    @Expect(p.id, "step")
    @Expect(p.baseUrl, "https://api.example.com/v1")
    @Expect(p.protocol, "openai-completions")
    @Expect(p.credentialRef, "SA_KEY")
    @Expect(p.models.size, Int64(2))
    @Expect(p.models[1].id, "m-b")
    @Expect(p.declared, false)
    regCleanup()
}

// 修订号落后必须报冲突，而且不能留下半个改动——否则「重试」会盖在已污染的文档上
@Test
func registryRejectsStaleRevisionWithoutTouchingTheDocument() {
    regCleanup()
    let r = reg()
    r.update(draftJson("step", "https://a.example.com/v1", "openai-completions", "m-1"), -1)
    r.update(draftJson("step", "https://b.example.com/v1", "openai-completions", "m-1"), r.describe().revision)
    var code = ""
    try {
        r.update(draftJson("step", "https://c.example.com/v1", "openai-completions", "m-1"), 1)
    } catch (e: Exception) {
        code = e.message
    }
    @Expect(code, "settings-conflict")
    @Expect(reg().describe().providers[0].baseUrl, "https://b.example.com/v1")
    regCleanup()
}

// 不合法的内容一律拒绝：协议闭集、id 语法、https 或本机 http、模型 id 不重复
@Test
func registryRejectsMalformedDrafts() {
    regCleanup()
    let r = reg()
    var codes = ArrayList<String>()
    for (bad in [
        draftJson("Step", "https://a.example.com/v1", "openai-completions", "m-1"),
        draftJson("ok", "ftp://a.example.com", "openai-completions", "m-1"),
        draftJson("ok", "https://a.example.com/v1", "openai-whatever", "m-1"),
        draftJson("ok", "https://a.example.com/v1", "openai-completions", "dup,dup"),
        draftJson("ok", "https://a.example.com/v1", "openai-completions", ""),
        draftJson("ok", "https://user:pw@a.example.com/v1", "openai-completions", "m-1")
    ]) {
        try {
            r.update(bad, -1)
            codes.add("accepted")
        } catch (e: Exception) {
            codes.add(e.message)
        }
    }
    var rejected = Int64(0)
    for (c in codes) {
        if (c == "settings-rejected") {
            rejected += 1
        }
    }
    @Expect(rejected, Int64(6))
    @Expect(reg().describe().providers.size, Int64(0))
    regCleanup()
}

// 写面上没有能带明文密钥的槽位：draft 里塞 apiKey 就是拒绝，注册表只存引用
@Test
func registryHasNoSlotForTheSecretValue() {
    regCleanup()
    let r = reg()
    var code = ""
    // 除 apiKey 之外这是一份完全合法的草稿：只有「写面没有明文槽位」这一条闸能拒绝它。
    // （早先这里写的是 models:[]，于是它被空模型清单先拒了——那条断言当时并没有在检验这道闸，
    // 是靠变异反证才看出来的。）
    try {
        r.update("{\"id\":\"step\",\"name\":\"n\",\"baseUrl\":\"https://a.example.com/v1\",\"protocol\":\"openai-completions\",\"credentialRef\":\"SA_KEY\",\"apiKey\":\"绝不该被接受\",\"models\":[{\"id\":\"m-1\",\"name\":\"m-1\",\"contextWindow\":\"\",\"maxTokens\":\"\",\"image\":false}]}", -1)
    } catch (e: Exception) {
        code = e.message
    }
    @Expect(code, "settings-rejected")
    @Expect(reg().describe().asJson().contains("绝不该被接受"), false)
    regCleanup()
}

@Test
func registryRemoveDropsTheProviderAndBumpsRevision() {
    regCleanup()
    let r = reg()
    r.update(draftJson("one", "https://a.example.com/v1", "openai-completions", "m-1"), -1)
    r.update(draftJson("two", "https://b.example.com/v1", "anthropic-messages", "m-2"), r.describe().revision)
    let before = r.describe().revision
    r.remove("one", before)
    let view = reg().describe()
    @Expect(view.providers.size, Int64(1))
    @Expect(fieldOf(view.providers[0].toJson(), "id"), "two")
    @Expect(view.revision, before + 1)
    var code = ""
    try { r.remove("gone", view.revision) } catch (e: Exception) { code = e.message }
    @Expect(code, "settings-rejected")
    regCleanup()
}

// 默认指针不能凭空造出一个提供商：指向被删掉的条目时只能回落到「没有默认」
@Test
func registryDefaultFallsBackWhenProviderRemoved() {
    regCleanup()
    let r = reg()
    r.update(draftJson("step", "https://a.example.com/v1", "openai-completions", "m-a,m-b"), -1)
    r.setDefault("step", "m-b", r.describe().revision)
    @Expect(r.activeProvider().id, "step")
    @Expect(r.activeModel(), "m-b")
    r.remove("step", r.describe().revision)
    let fresh = reg()
    @Expect(fresh.describe().defaultProviderId, "")
    @Expect(fresh.activeProvider().id, "")
    // 默认模型不在该提供商的清单里时，不能把它交给请求装配器
    r.update(draftJson("other", "https://c.example.com/v1", "openai-completions", "m-x"), r.describe().revision)
    var badModel = ""
    try { r.setDefault("other", "不存在的模型", r.describe().revision) } catch (e: Exception) { badModel = e.message }
    @Expect(badModel, "settings-rejected")
    var code = ""
    try { r.setDefault("nope", "m-x", r.describe().revision) } catch (e: Exception) { code = e.message }
    @Expect(code, "settings-rejected")
    regCleanup()
}

// 同一份草稿写两次只留最后一次，但修订号按提交次数走——它是版本，不是条目数
@Test
func registryKeepsLastWritePerProviderAndCountsCommitsNotEntries() {
    regCleanup()
    let r = reg()
    r.update(draftJson("step", "https://v1.example.com/v1", "openai-completions", "m-1"), -1)
    r.update(draftJson("step", "https://v2.example.com/v1", "openai-completions", "m-1"), r.describe().revision)
    let view = r.describe()
    @Expect(view.providers.size, Int64(1))
    @Expect(view.providers[0].baseUrl, "https://v2.example.com/v1")
    @Expect(view.revision, Int64(2))
    regCleanup()
}

// 内置目录项由核心给出，不允许写侧伪造：改它的 baseUrl/protocol 就是拒绝，
// 但它可以被选为默认——这是页面「内置提供商隐藏自有 ID/协议编辑」的后端依据。
@Test
func registryCatalogEntriesAreNotForgiableOrEditable() {
    regCleanup()
    let r = reg()
    let catalog = r.catalogJson()
    @Expect(catalog.contains("\"declared\":true"), true)
    @Expect(catalog.contains("stepfun"), true)
    // 目录项的 id 与内置形态自动进入注册表，用户不能把它改成自定义
    r.addFromCatalog("stepfun", "SA_KEY")
    let added = reg().describe()
    @Expect(added.providers.size, Int64(1))
    @Expect(added.providers[0].declared, true)
    var code = ""
    try {
        r.update(draftJson("stepfun", "https://evil.example.com/v1", "anthropic-messages", "m-1"), r.describe().revision)
    } catch (e: Exception) {
        code = e.message
    }
    @Expect(code, "settings-rejected")
    @Expect(reg().describe().providers[0].baseUrl, "https://api.stepfun.com/step_plan/v1")
    regCleanup()
}
