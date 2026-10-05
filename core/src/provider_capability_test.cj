package core

import std.collection.*
import std.fs.*
import std.unittest.*

// 第 2 层能力面：能力只能登记，不能由模型名推断；老日志缺字段必须回放成功而不是整份文档作废。
let capFile = "core-test-capability-providers.log"

func capCleanup(): Unit {
    if (exists(capFile)) {
        try { removeIfExists(capFile, recursive: false) } catch (e: Exception) {}
    }
}

// 带能力字段的草稿：只在本用例里拼，形状与模型页提交给宿主的 JSON 一致。
func capDraft(id: String, modelId: String): String {
    return "{\"id\":\"${id}\",\"name\":\"显示名\",\"baseUrl\":\"https://api.example.com/v1\","
        + "\"protocol\":\"openai-completions\",\"credentialRef\":\"SA_KEY\",\"models\":[{"
        + "\"id\":\"${modelId}\",\"name\":\"${modelId}\",\"contextWindow\":\"128k\",\"maxTokens\":\"4k\","
        + "\"image\":false,\"inputModalities\":[\"text\"],\"outputModalities\":[\"text\"],"
        + "\"supports\":[\"tools\",\"stream\"],\"meterUnit\":\"token\",\"provenance\":\"provider-listed\","
        + "\"availability\":\"available\"}]}"
}

@Test
func capabilityFieldsRoundTripThroughTheLog() {
    capCleanup()
    ProviderRegistry(capFile).update(capDraft("step", "m-a"), -1)
    // 换新实例：唯一的证据是盘上那份日志
    let spec = ProviderRegistry(capFile).describe().providers[0].models[0]
    @Expect(spec.inputModalities.size, Int64(1))
    @Expect(spec.inputModalities[0], "text")
    @Expect(spec.outputModalities[0], "text")
    @Expect(spec.supports.size, Int64(2))
    @Expect(spec.meterUnit, "token")
    @Expect(spec.provenance, "provider-listed")
    @Expect(spec.availability, "available")
    capCleanup()
}

@Test
func unknownMeterUnitIsRejectedNotCoerced() {
    capCleanup()
    var thrown = ""
    try {
        ProviderRegistry(capFile).update(
            capDraft("step", "m-a").replace("\"meterUnit\":\"token\"", "\"meterUnit\":\"characters\""), -1)
    } catch (e: Exception) {
        thrown = e.message
    }
    @Expect(thrown, "settings-rejected")
    // 拒绝必须留下完整的前态：坏草稿不能把文档写成半条
    @Expect(ProviderRegistry(capFile).describe().providers.size, Int64(0))
    capCleanup()
}

@Test
func nameLikeAModelDoesNotGrantCapability() {
    capCleanup()
    ProviderRegistry(capFile).update(capDraft("step", "m-a"), -1)
    let spec = ProviderRegistry(capFile).describe().providers[0].models[0]
    // 登记里没有 image-output，名字像也不能算满足
    @Expect(spec.hasCapability("image-output"), false)
    @Expect(spec.hasCapability("tools"), true)
    capCleanup()
}

@Test
func legacyRecordWithoutCapabilitiesStillReplays() {
    capCleanup()
    // 现有 5 字段形态（今天盘上的样子）：新字段一律缺席
    ProviderRegistry(capFile).update(
        "{\"id\":\"step\",\"name\":\"显示名\",\"baseUrl\":\"https://api.example.com/v1\","
        + "\"protocol\":\"openai-completions\",\"credentialRef\":\"SA_KEY\","
        + "\"models\":[{\"id\":\"m-a\",\"name\":\"m-a\",\"contextWindow\":\"128k\",\"maxTokens\":\"4k\",\"image\":false}]}", -1)
    let spec = ProviderRegistry(capFile).describe().providers[0].models[0]
    @Expect(spec.meterUnit, "unknown")
    @Expect(spec.provenance, "unknown")
    @Expect(spec.availability, "unknown")
    @Expect(spec.inputModalities.size, Int64(0))
    capCleanup()
}
