package core

import std.fs.*
import std.unittest.*

// 拉取通道的两条硬规矩：重复拉不增条数；坏响应一条都不写。
// 本批只交付「ID 清单 → 合并落盘」这一层；发现结果的结构化富记录
// （模态/上下文/计价单位/来源证据）与 13 家适配是并列的未闭修订点，
// 不因本批落成 ID 形态就宣称「填 key 可拉取」。
let upFile = "core-test-pull-providers.log"

func upCleanup(): Unit {
    if (exists(upFile)) {
        try { removeIfExists(upFile, recursive: false) } catch (e: Exception) {}
    }
}

func upDraft(modelIds: String): String {
    var models = ""
    for (m in modelIds.split(",")) {
        if (models.size > 0) { models += "," }
        models += "{\"id\":\"${m}\",\"name\":\"${m}\",\"contextWindow\":\"128k\",\"maxTokens\":\"4k\",\"image\":false}"
    }
    return "{\"id\":\"step\",\"name\":\"显示名\",\"baseUrl\":\"https://api.example.com/v1\","
        + "\"protocol\":\"openai-completions\",\"credentialRef\":\"SA_KEY\",\"models\":[${models}]}"
}

@Test
func mergePulledIsIdempotentAndKeepsExistingMetadata() {
    // 在册条目：人工确认过能力的 m-a
    let existing: Array<ModelSpec> = [ModelSpec("m-a", "已改名", "128k", "4k", false,
        outputModalities: ["text"], provenance: "human-confirmed")]
    let twice = mergePulledIds(mergePulledIds(existing, ["m-a", "m-b"]), ["m-a", "m-b", "m-c"])
    @Expect(twice.size, Int64(3))
    // 已在册的条目必须原样保留：人工确认过的能力面不能被一次拉取冲掉
    @Expect(twice[0].name, "已改名")
    @Expect(twice[0].provenance, "human-confirmed")
    // 新拉到的条目一律 unknown 且 provenance=provider-listed，不许自动启用
    @Expect(twice[1].provenance, "provider-listed")
    @Expect(twice[1].availability, "unknown")
    @Expect(twice[1].meterUnit, "unknown")
    @Expect(twice[2].id, "m-c")
}

@Test
func mergePulledIgnoresBlankAndDuplicateEntriesInOneResponse() {
    let none: Array<ModelSpec> = []
    let out = mergePulledIds(none, ["m-a", "m-a", "", "  "])
    @Expect(out.size, Int64(1))
}

@Test
func manualAddUsesUserEnteredProvenanceAndSameDedupe() {
    let none: Array<ModelSpec> = []
    let one = mergeManualIds(none, ["m-x"])
    @Expect(one[0].provenance, "user-entered")
    @Expect(mergeManualIds(one, ["m-x"]).size, Int64(1))
}

@Test
func badCatalogBodyThrowsInsteadOfReportingZeroModels() {
    var thrown = ""
    var count = Int64(-1)
    try {
        count = Int64(ModelCatalog().ids("{\"data\":null}").size)
    } catch (e: Exception) {
        thrown = e.message
    }
    // 「0 个模型」和「读不出模型」是两件事：后者必须抛，不能报空
    @Expect(thrown, "bad-model-catalog")
    @Expect(count, Int64(-1))
}

// 落盘侧幂等：重复拉取同一实例，模型条数不增、文档版本也不涨——
// 「不增条数但 revision 照涨」会让用户每拉一次就看到一次「有新改动」的冲突提示。
@Test
func applyPulledTwiceIsANoOpOnTheDocument() {
    upCleanup()
    let r = ProviderRegistry(upFile)
    r.update(upDraft("m-a"), -1)
    r.applyPulledModels("step", ["m-a", "m-b"], r.describe().revision)
    let after = ProviderRegistry(upFile).describe()
    @Expect(after.providers[0].models.size, Int64(2))
    r.applyPulledModels("step", ["m-a", "m-b"], ProviderRegistry(upFile).describe().revision)
    let again = ProviderRegistry(upFile).describe()
    @Expect(again.providers[0].models.size, Int64(2))
    @Expect(again.revision, after.revision)
    upCleanup()
}

// 手动添加：provenance=user-entered，且「已在册」是没发生而不是成功
@Test
func manualAddMarksProvenanceAndRejectsDuplicates() {
    upCleanup()
    let r = ProviderRegistry(upFile)
    r.update(upDraft("m-a"), -1)
    r.addUpstreamModel("step", "m-x", r.describe().revision)
    let view = ProviderRegistry(upFile).describe()
    @Expect(view.providers[0].models.size, Int64(2))
    @Expect(view.providers[0].models[1].provenance, "user-entered")
    var thrown = ""
    try {
        r.addUpstreamModel("step", "m-x", r.describe().revision)
    } catch (e: Exception) {
        thrown = e.message
    }
    @Expect(thrown, "settings-rejected")
    @Expect(ProviderRegistry(upFile).describe().providers[0].models.size, Int64(2))
    upCleanup()
}
