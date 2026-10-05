package core

import std.fs.*
import std.unittest.*

// 第 3 层：日常任务只选自定义模型。这一层不认识 baseUrl/凭据，只认 (providerId, modelId)。
let cmFile = "core-test-custom-models.log"

func cmCleanup(): Unit {
    if (exists(cmFile)) {
        try { removeIfExists(cmFile, recursive: false) } catch (e: Exception) {}
    }
}

func cmDraft(id: String, bindings: String): String {
    return "{\"id\":\"${id}\",\"name\":\"编程模型\",\"description\":\"\",\"enabled\":true,"
        + "\"category\":\"coding\",\"requires\":[\"tools\",\"text-output\"],\"mode\":\"weighted\","
        + "\"bindings\":[${bindings}]}"
}

func cmBinding(provider: String, model: String, order: Int64, weight: Int64): String {
    return "{\"providerId\":\"${provider}\",\"modelId\":\"${model}\",\"enabled\":true,"
        + "\"order\":${order},\"weight\":${weight},\"priceInMicro\":1000,\"priceOutMicro\":2000,\"priceCacheReadMicro\":-1,\"priceCacheWriteMicro\":-1,\"priceVersion\":1,"
        + "\"currency\":\"CNY\"}"
}

@Test
func customModelStartsEmpty() {
    cmCleanup()
    let v = CustomModelRegistry(cmFile).describe()
    @Expect(v.models.size, Int64(0))
    @Expect(v.revision, Int64(0))
    @Expect(v.writable, true)
    cmCleanup()
}

@Test
func customModelUpsertReplaysBindingsVerbatim() {
    cmCleanup()
    CustomModelRegistry(cmFile).upsert(
        cmDraft("code", cmBinding("step", "m-a", 0, 3) + "," + cmBinding("step", "m-b", 1, 1)), -1)
    let rec = CustomModelRegistry(cmFile).describe().models[0]
    @Expect(rec.id, "code")
    @Expect(rec.category, "coding")
    @Expect(rec.requires.size, Int64(2))
    @Expect(rec.mode, "weighted")
    @Expect(rec.bindings.size, Int64(2))
    @Expect(rec.bindings[0].weight, Int64(3))
    @Expect(rec.bindings[1].providerId, "step")
    cmCleanup()
}

@Test
func customModelStaleRevisionIsConflictNotRejection() {
    cmCleanup()
    let r = CustomModelRegistry(cmFile)
    r.upsert(cmDraft("code", cmBinding("step", "m-a", 0, 1)), -1)
    var thrown = ""
    try {
        r.upsert(cmDraft("code", cmBinding("step", "m-b", 0, 1)), 0)   // 落后一位
    } catch (e: Exception) {
        thrown = e.message
    }
    @Expect(thrown, "settings-conflict")
    // 冲突不留半个改动：盘上还应该是 m-a
    @Expect(CustomModelRegistry(cmFile).describe().models[0].bindings[0].modelId, "m-a")
    cmCleanup()
}

@Test
func customModelRejectsUnknownMode() {
    cmCleanup()
    var thrown = ""
    try {
        CustomModelRegistry(cmFile).upsert(
            cmDraft("code", cmBinding("step", "m-a", 0, 1)).replace("\"mode\":\"weighted\"", "\"mode\":\"lottery\""), -1)
    } catch (e: Exception) {
        thrown = e.message
    }
    @Expect(thrown, "settings-rejected")
    cmCleanup()
}

// —— 以下四条对应规格 §2.3「落盘形态在 B1 一次定死」与 §11 断言 41、46 ——

@Test
func paramsBudgetAndProbePolicySurviveReplay() {
    cmCleanup()
    let draft = cmDraft("code", cmBinding("step", "m-a", 0, 1))
        .replace("\"bindings\"",
            "\"params\":\"{\\\"temperature\\\":0.7}\",\"modalityBudget\":\"{\\\"image\\\":50}\","
            + "\"dailyTokens\":200000,\"maxOutputTokens\":8192,\"probeMaxPerDay\":5,\"bindings\"")
    CustomModelRegistry(cmFile).upsert(draft, -1)
    let rec = CustomModelRegistry(cmFile).describe().models[0]
    // 原文无损：核心不拍平参数键、不重新序列化，否则 B2/B3 读到的已经不是用户写的那份
    @Expect(rec.params, "{\"temperature\":0.7}")
    @Expect(rec.modalityBudget, "{\"image\":50}")
    @Expect(rec.dailyTokens, Int64(200000))
    @Expect(rec.maxOutputTokens, Int64(8192))
    @Expect(rec.probeMaxPerDay, Int64(5))
    cmCleanup()
}

@Test
func unsetBudgetReplaysAsMinusOneNotZero() {
    cmCleanup()
    // 普通草稿里根本没有预算列——缺省只能是「未设置」，不能是 0
    CustomModelRegistry(cmFile).upsert(cmDraft("code", cmBinding("step", "m-a", 0, 1)), -1)
    let rec = CustomModelRegistry(cmFile).describe().models[0]
    @Expect(rec.dailyTokens, Int64(-1))
    @Expect(rec.monthlyTokens, Int64(-1))
    @Expect(rec.dailyAmountMicro, Int64(-1))
    @Expect(rec.monthlyAmountMicro, Int64(-1))
    @Expect(rec.maxOutputTokens, Int64(-1))
    @Expect(rec.params, "")
    @Expect(rec.probeEnabled, true)
    @Expect(rec.probeMaxPerDay, Int64(3))
    // 而「有意的零额度」是另一种值，两者必须在盘上区分得开
    CustomModelRegistry(cmFile).upsert(
        cmDraft("code", cmBinding("step", "m-a", 0, 1)).replace("\"bindings\"", "\"dailyTokens\":0,\"bindings\""), 1)
    @Expect(CustomModelRegistry(cmFile).describe().models[0].dailyTokens, Int64(0))
    cmCleanup()
}

@Test
func secretShapedKeyInsideParamsIsRejected() {
    cmCleanup()
    var thrown = ""
    try {
        // 借「自由格式参数」把明文写进第 3 层文档，正是 §8.1 拒绝清单要堵的那类绕行
        CustomModelRegistry(cmFile).upsert(
            cmDraft("code", cmBinding("step", "m-a", 0, 1))
                .replace("\"bindings\"", "\"params\":\"{\\\"api_key\\\":\\\"sk-abcdef\\\"}\",\"bindings\""), -1)
    } catch (e: Exception) {
        thrown = e.message
    }
    @Expect(thrown, "settings-rejected")
    @Expect(CustomModelRegistry(cmFile).describe().models.size, Int64(0))
    cmCleanup()
}

@Test
func twoCurrenciesInOneModelAreRejectedWithoutMerge() {
    cmCleanup()
    let cny = cmBinding("step", "m-a", 0, 1)
    let usd = cmBinding("step", "m-b", 1, 1).replace("\"currency\":\"CNY\"", "\"currency\":\"USD\"")
    var thrown = ""
    try {
        CustomModelRegistry(cmFile).upsert(cmDraft("code", cny + "," + usd), -1)
    } catch (e: Exception) {
        thrown = e.message
    }
    @Expect(thrown, "settings-rejected")
    @Expect(CustomModelRegistry(cmFile).describe().models.size, Int64(0))
    // 未定价（空串）不参与冲突判定，否则 Task 6 的「先导入再填价」立不住
    let free = cmBinding("step", "m-c", 2, 1).replace("\"currency\":\"CNY\"", "\"currency\":\"\"")
    CustomModelRegistry(cmFile).upsert(cmDraft("code", cny + "," + free), -1)
    @Expect(CustomModelRegistry(cmFile).describe().models[0].bindings.size, Int64(2))
    cmCleanup()
}

// 本地身份只是归属标签：同一份日志两个 owner 各写一条，各自只看得见自己那条。
// 查询按 principal 过滤时，这一条与「导入结果本机可见」是同一机制的两个方向。
@Test
func entriesOfAnotherOwnerAreInvisibleButNotDestroyed() {
    cmCleanup()
    // 同一份日志、两个 owner 各写一条：各自只看得见自己那条
    CustomModelRegistry(cmFile, owner: "inst-a").upsert(cmDraft("code", ""), -1)
    CustomModelRegistry(cmFile, owner: "inst-b").upsert(cmDraft("other", ""), -1)
    let a = CustomModelRegistry(cmFile, owner: "inst-a").describe()
    @Expect(a.models.size, Int64(1))
    @Expect(a.models[0].id, "code")
    // 第二个 owner 的写入没抹掉第一条：日志仍是两条事件，revision 跨 owner 一起涨
    @Expect(CustomModelRegistry(cmFile, owner: "inst-b").describe().revision, a.revision)
    cmCleanup()
}
