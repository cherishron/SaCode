package core

import std.fs.*
import std.unittest.*

let enFile = "core-test-enabled-providers.log"

func enCleanup(): Unit {
    if (exists(enFile)) {
        try { removeIfExists(enFile, recursive: false) } catch (e: Exception) {}
    }
}

func enDraft(id: String): String {
    return "{\"id\":\"${id}\",\"name\":\"显示名\",\"baseUrl\":\"https://api.example.com/v1\","
        + "\"protocol\":\"openai-completions\",\"credentialRef\":\"SA_KEY\","
        + "\"models\":[{\"id\":\"m-a\",\"name\":\"m-a\",\"contextWindow\":\"128k\",\"maxTokens\":\"4k\",\"image\":false}]}"
}

@Test
func newProviderDefaultsToEnabledDirectWithNoSortHole() {
    enCleanup()
    let r = ProviderRegistry(enFile)
    r.update(enDraft("a"), -1)
    r.update(enDraft("b"), -1)
    let view = ProviderRegistry(enFile).describe()
    @Expect(view.providers[0].enabled, true)
    @Expect(view.providers[0].transport, "direct")
    // 拖动序允许空洞，但新增时必须接在末尾：0、1 而不是 0、0
    @Expect(view.providers[0].sortOrder, Int64(0))
    @Expect(view.providers[1].sortOrder, Int64(1))
    enCleanup()
}

@Test
func disableKeepsEveryOtherFieldAndSurvivesReplay() {
    enCleanup()
    let r = ProviderRegistry(enFile)
    r.update(enDraft("a"), -1)
    r.setEnabled("a", false, r.describe().revision)
    let p = ProviderRegistry(enFile).describe().providers[0]
    @Expect(p.enabled, false)
    @Expect(p.baseUrl, "https://api.example.com/v1")   // 关断不得顺手清空配置
    @Expect(p.models.size, Int64(1))
    enCleanup()
}

@Test
func unknownTransportIsRejected() {
    enCleanup()
    var thrown = ""
    try {
        ProviderRegistry(enFile).update(enDraft("a").replace("\"protocol\":\"openai-completions\"",
            "\"protocol\":\"openai-completions\",\"transport\":\"socks\""), -1)
    } catch (e: Exception) {
        thrown = e.message
    }
    @Expect(thrown, "settings-rejected")
    enCleanup()
}

// —— 以下三条对应规格 §2.1 实例池语义与断言 56：第 1 层的唯一键是实例，不是品牌 ——

let poolFile = "core-test-pool-providers.log"

func poolCleanup(): Unit {
    if (exists(poolFile)) {
        try { removeIfExists(poolFile, recursive: false) } catch (e: Exception) {}
    }
}

@Test
func sameCatalogEntryTwiceYieldsTwoInstances() {
    poolCleanup()
    let r = ProviderRegistry(poolFile)
    r.addInstanceFromCatalog("stepfun", "")
    r.addInstanceFromCatalog("stepfun", "")
    let view = ProviderRegistry(poolFile).describe()
    // 调用方不指定实例身份：id 由核心生成，两次必然落到两个 id 上
    @Expect(view.providers[0].id == view.providers[1].id, false)
    @Expect(view.providers.size, Int64(2))
    // 同地址是号池的正常形态，不是重复条目
    @Expect(view.providers[0].baseUrl == view.providers[1].baseUrl, true)
    @Expect(view.providers[0].credentialRef == view.providers[1].credentialRef, false)
    poolCleanup()
}

@Test
func eachInstanceDerivesItsOwnCredentialRef() {
    poolCleanup()
    let r = ProviderRegistry(poolFile)
    r.addInstanceFromCatalog("stepfun", "")
    r.addInstanceFromCatalog("stepfun", "")
    let view = ProviderRegistry(poolFile).describe()
    // ref 只准由「实例 id」派生：按目录 id 派生会让两份实例共用同一个环境变量名，
    // 后配的密钥静默顶掉先配的——比直接拒绝更坏。
    @Expect(view.providers[0].credentialRef, deriveCredentialRef(view.providers[0].id))
    @Expect(view.providers[1].credentialRef, deriveCredentialRef(view.providers[1].id))
    // 显式再钉一次不相等：若实现改成按「目录 id」派生，上面两条会同时通过而这条红
    @Expect(view.providers[0].credentialRef == view.providers[1].credentialRef, false)
    poolCleanup()
}

@Test
func duplicateCredentialRefAcrossInstancesIsRejected() {
    poolCleanup()
    let r = ProviderRegistry(poolFile)
    r.addInstanceFromCatalog("stepfun", "")
    let refA = ProviderRegistry(poolFile).describe().providers[0].credentialRef
    var thrown = ""
    try {
        r.addInstanceFromCatalog("stepfun", refA)
    } catch (e: Exception) {
        thrown = e.message
    }
    @Expect(thrown, "settings-rejected")
    // 拒了就不能留下半条：第二份既没建出来，第一份也原样还在
    @Expect(ProviderRegistry(poolFile).describe().providers.size, Int64(1))
    @Expect(ProviderRegistry(poolFile).describe().providers[0].credentialRef, refA)
    poolCleanup()
}
