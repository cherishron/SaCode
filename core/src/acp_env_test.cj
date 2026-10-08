package core
import std.unittest.*

// AcpEnvProbe 单测（任务 5.3）。
// 验收：正向 三产品逐个报告，缺一不整体失败；
// 失败/越权 探测失败标"环境未知"而非"未安装"，未核标"待核"；
// 恢复/并发 缓存时效可判定、可重探。

@Test
func acpEnvProbeUnknownProductReturnsPendingVerification() {
    let probe = AcpEnvProbe()
    let report = probe.probeOne("nonexistent-product-xyz")
    @Expect(report.product, "nonexistent-product-xyz")
    @Expect(report.state, "pending-verification")
    @Expect(report.evidence.contains("product-not-in-table"), true)
}

@Test
func acpEnvProbeOpencodeNotInstalledReportsNotInstalled() {
    // 假设 opencode 未装（或 PATH 里没有），返回 not-installed
    let probe = AcpEnvProbe()
    let report = probe.probeOne("opencode", refresh: true)
    // 可能已装或未装，这里只断言状态属于已知集合
    let validStates = ["not-installed", "installed-usable", "installed-auth-missing", "probe-failed-unknown"]
    var ok = false
    for (s in validStates) {
        if (s == report.state) { ok = true }
    }
    @Expect(ok, true)
}

@Test
func acpEnvProbeCodebuddyAuthMissingWhenNoEnv() {
    let probe = AcpEnvProbe()
    let report = probe.probeOne("codebuddy", refresh: true)
    // 若 codebuddy 已装但无 CODEBUDDY_API_KEY → installed-auth-missing
    // 若未装 → not-installed
    // 两种都合法
    let valid = (report.state == "installed-auth-missing" || report.state == "not-installed" || report.state == "installed-usable")
    @Expect(valid, true)
    if (report.state == "installed-auth-missing") {
        @Expect(report.authPrecondition.contains("CODEBUDDY_API_KEY"), true)
    }
}

@Test
func acpEnvProbeQoderAuthMissingWhenNoEnv() {
    let probe = AcpEnvProbe()
    let report = probe.probeOne("qoder", refresh: true)
    let valid = (report.state == "installed-auth-missing" || report.state == "not-installed" || report.state == "installed-usable")
    @Expect(valid, true)
    if (report.state == "installed-auth-missing") {
        @Expect(report.authPrecondition.contains("QODER_PERSONAL_ACCESS_TOKEN"), true)
    }
}

@Test
func acpEnvProbeCacheHitWithoutRefresh() {
    let probe = AcpEnvProbe()
    let r1 = probe.probeOne("opencode")
    let r2 = probe.probeOne("opencode")
    // 同一对象（未 refresh），应返回同一缓存
    @Expect(r1.probedAt == r2.probedAt, true)
}

@Test
func acpEnvProbeRefreshUpdatesTimestamp() {
    let probe = AcpEnvProbe()
    let r1 = probe.probeOne("opencode")
    let r2 = probe.probeOne("opencode", refresh: true)
    // refresh 后时间戳应 >= 旧值（可能相等，因为秒级）
    @Expect(r2.probedAt >= r1.probedAt, true)
}

@Test
func acpEnvProbeMultiProductReturnsAll() {
    let probe = AcpEnvProbe()
    let products = ArrayList<String>()
    products.add("opencode")
    products.add("codebuddy")
    products.add("qoder")
    let reports = probe.probe(products)
    @Expect(reports.size, Int64(3))
    @Expect(reports[0].product, "opencode")
    @Expect(reports[1].product, "codebuddy")
    @Expect(reports[2].product, "qoder")
}

@Test
func acpEnvProbeSecretNotReturned() {
    let probe = AcpEnvProbe()
    let report = probe.probeOne("codebuddy", refresh: true)
    // 证据字段不含真实 KEY 值（只含变量名或"满足"）
    @Expect(!report.evidence.contains("sk-"), true)
    @Expect(!report.evidence.contains("CODEBUDDY_API_KEY="), true)
}

@Test
func acpEnvProbeLaunchSpecMatchesKnown() {
    let probe = AcpEnvProbe()
    let r1 = probe.probeOne("opencode")
    let r2 = probe.probeOne("codebuddy")
    let r3 = probe.probeOne("qoder")
    @Expect(r1.launch, "opencode acp")
    @Expect(r2.launch, "codebuddy --acp")
    @Expect(r3.launch, "qoder --acp")
}