package core

import std.unittest.*

// 远端模型清单：既给页面「从提供商拉取模型」用，也是「测试连接」这一动作的实体——
// 它必须真的发一次请求并只报告事实（通不通、几个、首个 id），任何摘要里都不许带上密钥。
@Test
func catalogParsesWellFormedIdListInOrder() {
    let ids = ModelCatalog.parseIds("{\"data\":[{\"id\":\"step-5-preview\"},{\"id\":\"step-3.5-flash\"}]}")
    @Expect(ids.size, Int64(2))
    @Expect(ids[0], "step-5-preview")
    @Expect(ids[1], "step-3.5-flash")
}

@Test
func catalogRejectsMalformedBodiesInsteadOfReturningEmpty() {
    // 空清单和「不是清单」是两件事：把坏响应读成 0 个模型，UI 会显示成提供商没有模型
    var codes = Int64(0)
    for (bad in ["", "not json", "[]", "{\"data\":{}}", "{\"data\":[1,2]}", "{\"error\":{\"message\":\"upstream\"}}"]) {
        try {
            ModelCatalog.parseIds(bad)
        } catch (e: Exception) {
            if (e.message == "bad-model-catalog") {
                codes += 1
            }
        }
    }
    @Expect(codes, Int64(6))
}

@Test
func catalogDedupesAndTrimsAndCapsSize() {
    let ids = ModelCatalog.parseIds("{\"data\":[{\"id\":\" a \"},{\"id\":\"a\"},{\"id\":\"b\"},{\"id\":null}]}")
    @Expect(ids.size, Int64(2))
    @Expect(ids[0], "a")
    @Expect(ids[1], "b")
    var big = "{\"data\":["
    var i: Int64 = 0
    while (i < 2000) {
        if (i > 0) {
            big += ","
        }
        big += "{\"id\":\"m-${i}\"}"
        i += 1
    }
    big += "]}"
    var overflow = ""
    try {
        ModelCatalog.parseIds(big)
    } catch (e: Exception) {
        overflow = e.message
    }
    @Expect(overflow, "bad-model-catalog")
}

@Test
func catalogParsesCapacityFromDiscoveryMetadata() {
    // 上游在列表里报的窗口是唯一可用的分母来源；没报就留空，不按模型名猜。
    let models = ModelCatalog.parseModels(
        "{\"data\":[{\"id\":\"a\",\"context_window\":1048576},{\"id\":\"b\",\"context_length\":\"128k\"}," +
        "{\"id\":\"c\"},{\"id\":\"d\",\"context_window\":0},{\"id\":\"e\",\"context_window\":\"abc\"}," +
        "{\"id\":\"f\",\"max_context_length\":\"1M\"}]}")
    @Expect(models.size, Int64(6))
    @Expect(models[0].id, "a")
    @Expect(models[0].contextWindow, "1048576")
    @Expect(models[1].contextWindow, "128000")
    @Expect(models[2].contextWindow, "")
    @Expect(models[3].contextWindow, "")
    @Expect(models[4].contextWindow, "")
    @Expect(models[5].contextWindow, "1000000")
}

// 连接摘要要给配置面用：只报通/不通、数量、首个 id 与耗时档，明文密钥不能出现在里面
@Test
func catalogSummaryCarriesNoCredentialMaterial() {
    let key = "sk-绝不该出现在摘要里的一串凭据"
    let summary = ModelCatalog.summary(key, ["step-5-preview", "step-3.5-flash"])
    @Expect(summary.contains("绝不该出现"), false)
    @Expect(summary.contains("sk-"), false)
    @Expect(summary.contains("step-5-preview"), true)
    @Expect(summary.contains("2"), true)
    @Expect(ModelCatalog.summary(key, []).contains("0"), true)
}
