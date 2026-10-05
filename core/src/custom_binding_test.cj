package core

import std.fs.*
import std.unittest.*

// 绑定校验：保存时就拒，而不是等调度器在运行时静默跳过——
// 用户配错了要当场知道，不该等到任务失败。
let bdFile = "core-test-binding-providers.log"
let bcFile = "core-test-binding-customs.log"

func bdCleanup(): Unit {
    for (f in [bdFile, bcFile]) {
        if (exists(f)) {
            try { removeIfExists(f, recursive: false) } catch (e: Exception) {}
        }
    }
}

// 四条上游：m-a 能 tools 且明确 available；m-img 只会出图；m-old 能力字段整段缺席（= unknown）；m-unknown-avail 能力齐全但 availability 缺席
func bdSpec(id: String, caps: String): String {
    return "{\"id\":\"${id}\",\"name\":\"${id}\",\"contextWindow\":\"128k\",\"maxTokens\":\"4k\",\"image\":false${caps}}"
}

func bdSeedProviders(): Unit {
    let m = bdSpec("m-a", ",\"inputModalities\":[\"text\"],\"outputModalities\":[\"text\"],"
        + "\"supports\":[\"tools\",\"stream\"],\"meterUnit\":\"token\",\"provenance\":\"human-confirmed\","
        + "\"availability\":\"available\"")
        + "," + bdSpec("m-img", ",\"inputModalities\":[\"text\"],\"outputModalities\":[\"image\"],"
        + "\"supports\":[\"image-output\"],\"meterUnit\":\"image\",\"provenance\":\"human-confirmed\","
        + "\"availability\":\"available\"")
        + "," + bdSpec("m-old", "")
        + "," + bdSpec("m-unknown-avail", ",\"inputModalities\":[\"text\"],\"outputModalities\":[\"text\"],"
        + "\"supports\":[\"tools\",\"stream\"],\"meterUnit\":\"token\",\"provenance\":\"provider-listed\"")
    ProviderRegistry(bdFile).update(
        "{\"id\":\"step\",\"name\":\"显示名\",\"baseUrl\":\"https://api.example.com/v1\","
        + "\"protocol\":\"openai-completions\",\"credentialRef\":\"SA_KEY\",\"models\":[${m}]}", -1)
}

@Test
func sameUpstreamModelCannotBindTwice() {
    bdCleanup()
    bdSeedProviders()
    let r = CustomModelRegistry(bcFile)
    r.upsert(bdDraft("code", bdBinding("step", "m-a", 0, 1)), -1)
    var thrown = ""
    try {
        r.upsertBinding("code", bdBinding("step", "m-a", 1, 1), ProviderRegistry(bdFile).describe(), r.describe().revision)
    } catch (e: Exception) {
        thrown = e.message
    }
    @Expect(thrown, "settings-rejected")
    @Expect(CustomModelRegistry(bcFile).describe().models[0].bindings.size, Int64(1))
    bdCleanup()
}

@Test
func imageOnlyModelCannotEnterAToolsModel() {
    bdCleanup()
    bdSeedProviders()
    let r = CustomModelRegistry(bcFile)
    r.upsert(bdDraft("code", ""), -1)
    var thrown = ""
    try {
        r.upsertBinding("code", bdBinding("step", "m-img", 0, 1), ProviderRegistry(bdFile).describe(), r.describe().revision)
    } catch (e: Exception) {
        thrown = e.message
    }
    @Expect(thrown, "settings-rejected")
    bdCleanup()
}

// 能力字段齐全、唯独 availability 缺席： modalities 与 supports 都满足，
// 只有 availability 判据能拒——这条把「unknown 不等于满足」单独钉住，
// 不让拒绝被 supports 缺失挡掉（本批变异反证实测抓到过那处假绿）。
@Test
func unknownAvailabilityWithFullCapabilitiesIsStillRejected() {
    bdCleanup()
    bdSeedProviders()
    let r = CustomModelRegistry(bcFile)
    r.upsert(bdDraft("code", ""), -1)
    var thrown = ""
    try {
        r.upsertBinding("code", bdBinding("step", "m-unknown-avail", 0, 1), ProviderRegistry(bdFile).describe(), r.describe().revision)
    } catch (e: Exception) {
        thrown = e.message
    }
    @Expect(thrown, "settings-rejected")
    bdCleanup()
}

@Test
func unknownCapabilityOnUpstreamIsNotSufficient() {
    bdCleanup()
    bdSeedProviders()
    let r = CustomModelRegistry(bcFile)
    r.upsert(bdDraft("code", ""), -1)
    // m-old 的 availability 是 unknown：不认识不等于支持
    var thrown = ""
    try {
        r.upsertBinding("code", bdBinding("step", "m-old", 0, 1), ProviderRegistry(bdFile).describe(), r.describe().revision)
    } catch (e: Exception) {
        thrown = e.message
    }
    @Expect(thrown, "settings-rejected")
    bdCleanup()
}

@Test
func bindingToRemovedProviderStaysVisibleButDangling() {
    bdCleanup()
    bdSeedProviders()
    let pr = ProviderRegistry(bdFile)
    let r = CustomModelRegistry(bcFile)
    r.upsert(bdDraft("code", bdBinding("step", "m-a", 0, 1)), -1)
    pr.remove("step", pr.describe().revision)
    let view = CustomModelRegistry(bcFile).describe().models[0]
    @Expect(view.bindings.size, Int64(1))        // 配置不丢
    @Expect(r.isDangling(view.bindings[0], ProviderRegistry(bdFile).describe()), true)
    bdCleanup()
}

@Test
func reorderRequiresTheExactSameKeySet() {
    bdCleanup()
    bdSeedProviders()
    let r = CustomModelRegistry(bcFile)
    r.upsert(bdDraft("code", bdBinding("step", "m-a", 0, 1) + "," + bdBinding("step", "m-old", 1, 1)), -1)
    // 少给一段：半途重排比不重排更糟，必须整条拒
    var thrown = ""
    try {
        r.reorderBindings("code", ["step/m-a"], r.describe().revision)
    } catch (e: Exception) {
        thrown = e.message
    }
    @Expect(thrown, "settings-rejected")
    bdCleanup()
}

// 长度相等但键不存在：只比条数的「重排」会把不存在的键静默映射到某个绑定，
// 用户看到的顺序与盘上的事实对不上——这条钉「逐一对应」而不只是「条数相等」。
@Test
func reorderWithSameLengthButUnknownKeyIsRejected() {
    bdCleanup()
    bdSeedProviders()
    let r = CustomModelRegistry(bcFile)
    r.upsert(bdDraft("code", bdBinding("step", "m-a", 0, 1) + "," + bdBinding("step", "m-old", 1, 1)), -1)
    var thrown = ""
    try {
        r.reorderBindings("code", ["step/m-a", "step/m-zzz"], r.describe().revision)
    } catch (e: Exception) {
        thrown = e.message
    }
    @Expect(thrown, "settings-rejected")
    // 拒了就一行都不能动：还是 m-a 在前
    let after = CustomModelRegistry(bcFile).describe().models[0]
    @Expect(after.bindings[0].modelId, "m-a")
    @Expect(after.bindings[1].modelId, "m-old")
    bdCleanup()
}

// 与 custom_model_registry_test.cj 的 helper 同形但不同名：package core 的
// 顶层作用域跨文件共享，同名 func 会 overload 冲突（本批实测），不共享副本。
func bdDraft(id: String, bindings: String): String {
    return "{\"id\":\"${id}\",\"name\":\"编程模型\",\"description\":\"\",\"enabled\":true,"
        + "\"category\":\"coding\",\"requires\":[\"tools\",\"text-output\"],\"mode\":\"weighted\","
        + "\"bindings\":[${bindings}]}"
}

func bdBinding(provider: String, model: String, order: Int64, weight: Int64): String {
    return "{\"providerId\":\"${provider}\",\"modelId\":\"${model}\",\"enabled\":true,"
        + "\"order\":${order},\"weight\":${weight},\"priceInMicro\":1000,\"priceOutMicro\":2000,\"priceCacheReadMicro\":-1,\"priceCacheWriteMicro\":-1,\"priceVersion\":1,"
        + "\"currency\":\"CNY\"}"
}
