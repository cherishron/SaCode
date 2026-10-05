package core

import std.fs.*
import std.unittest.*

// 两种导入操作：各建一个新模型 vs 加入已有模型。
// 导入 = 「候选进入调度」，不是「替用户决定价格」：导入生成的绑定一律未定价
// （四档费率全 -1、currency 空串、priceVersion 0），账本侧走 待核算 承接。
let imFile = "core-test-import-customs.log"
let imP = "core-test-import-providers.log"

func imCleanup(): Unit {
    for (f in [imFile, imP]) {
        if (exists(f)) {
            try { removeIfExists(f, recursive: false) } catch (e: Exception) {}
        }
    }
}

// m-a / m-c：文本 + tools 且明确 available；m-img：只会出图。
// importInto 要过能力适配，夹具必须真的在册——空 providers 视图下任何绑定都
// dangling，那样「整批原子」的拒绝会被第一条就挡掉，钉子等于没钉。
func imSeedProviders(): Unit {
    func spec(id: String, caps: String): String {
        return "{\"id\":\"${id}\",\"name\":\"${id}\",\"contextWindow\":\"128k\",\"maxTokens\":\"4k\",\"image\":false${caps}}"
    }
    let m = spec("m-a", ",\"inputModalities\":[\"text\"],\"outputModalities\":[\"text\"],"
        + "\"supports\":[\"tools\",\"stream\"],\"meterUnit\":\"token\",\"availability\":\"available\"")
        + "," + spec("m-c", ",\"inputModalities\":[\"text\"],\"outputModalities\":[\"text\"],"
        + "\"supports\":[\"tools\",\"stream\"],\"meterUnit\":\"token\",\"availability\":\"available\"")
        + "," + spec("m-img", ",\"inputModalities\":[\"text\"],\"outputModalities\":[\"image\"],"
        + "\"supports\":[\"image-output\"],\"meterUnit\":\"image\",\"availability\":\"available\"")
    ProviderRegistry(imP).update(
        "{\"id\":\"step\",\"name\":\"显示名\",\"baseUrl\":\"https://api.example.com/v1\","
        + "\"protocol\":\"openai-completions\",\"credentialRef\":\"SA_KEY\",\"models\":[${m}]}", -1)
}

func imDraft(id: String, bindings: String): String {
    return "{\"id\":\"${id}\",\"name\":\"编程模型\",\"description\":\"\",\"enabled\":true,"
        + "\"category\":\"coding\",\"requires\":[\"tools\",\"text-output\"],\"mode\":\"weighted\","
        + "\"bindings\":[${bindings}]}"
}

func imBinding(provider: String, model: String, order: Int64, weight: Int64): String {
    return "{\"providerId\":\"${provider}\",\"modelId\":\"${model}\",\"enabled\":true,"
        + "\"order\":${order},\"weight\":${weight},\"priceInMicro\":1000,\"priceOutMicro\":2000,\"priceCacheReadMicro\":-1,\"priceCacheWriteMicro\":-1,\"priceVersion\":1,"
        + "\"currency\":\"CNY\"}"
}

@Test
func importNewMakesOneModelPerItem() {
    imCleanup()
    let ids = CustomModelRegistry(imFile).importNewModels(["step/m-a", "step/m-b"], ProviderRegistry(imP).describe(), -1)
    @Expect(ids.size, Int64(2))
    @Expect(CustomModelRegistry(imFile).describe().models.size, Int64(2))
    @Expect(CustomModelRegistry(imFile).describe().models[0].bindings.size, Int64(1))
    // 导入生成的绑定是未定价形态：不凭空造单价
    let b = CustomModelRegistry(imFile).describe().models[0].bindings[0]
    @Expect(b.priceInMicro, Int64(-1))
    @Expect(b.currency, "")
    @Expect(b.priceVersion, Int64(0))
    imCleanup()
}

@Test
func repeatedImportOfSameBundleAddsNothing() {
    imCleanup()
    let r = CustomModelRegistry(imFile)
    r.importNewModels(["step/m-a"], ProviderRegistry(imP).describe(), -1)
    let again = r.importNewModels(["step/m-a"], ProviderRegistry(imP).describe(), r.describe().revision)
    @Expect(again.size, Int64(0))                       // 幂等：不重复创建
    @Expect(CustomModelRegistry(imFile).describe().models.size, Int64(1))
    @Expect(CustomModelRegistry(imFile).describe().revision, Int64(1))   // 一条都没加就不落事件
    imCleanup()
}

@Test
func importIntoSkipsExistingAndCountsOnlyNewOnes() {
    imCleanup()
    imSeedProviders()
    let r = CustomModelRegistry(imFile)
    r.upsert(imDraft("code", imBinding("step", "m-a", 0, 1)), -1)
    let added = r.importInto("code", ["step/m-a", "step/m-c"], ProviderRegistry(imP).describe(), r.describe().revision)
    @Expect(added, Int64(1))
    @Expect(CustomModelRegistry(imFile).describe().models[0].bindings.size, Int64(2))
    imCleanup()
}

// 整批原子：m-c 适配合格、m-img 能力不适配——拒绝时一条都不能落，
// 否则用户重试会撞唯一键，盘上留下「一半已导入」的没法解释的状态。
@Test
func importIntoRejectsMismatchedCapabilityAtomically() {
    imCleanup()
    imSeedProviders()
    let r = CustomModelRegistry(imFile)
    r.upsert(imDraft("code", imBinding("step", "m-a", 0, 1)), -1)
    var thrown = ""
    try {
        r.importInto("code", ["step/m-c", "step/m-img"], ProviderRegistry(imP).describe(), r.describe().revision)
    } catch (e: Exception) {
        thrown = e.message
    }
    @Expect(thrown, "settings-rejected")
    @Expect(CustomModelRegistry(imFile).describe().models[0].bindings.size, Int64(1))
    imCleanup()
}
