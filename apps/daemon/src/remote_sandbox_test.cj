package daemon

import core.*
import std.unittest.*

// 远程执行门禁（任务 4 的 Windows 半）。
//
// 计划第 3 条写得很直白：核验不出 Job Object 之外的文件/网络隔离能力时，
// **拒绝远程执行并登记 BLOCKED，而不是只改 enforcement 字符串**。所以这里要钉的不是
// 「有没有那个字符串」，而是三件事：
//   ① enforcement 的值来自真实行为探针（问 core 的 confine 到底改不改 argv），
//      不是写死的 false——将来后端到位，宣告位会自己翻。
//   ② 拒绝只看权限类别，不看方法名白名单：类别由契约加载进 authorizer 的那张表给，
//      daemon 不维护第二份名单。
//   ③ 拒绝原因是稳定字符串，且限制清单必须点名文件与网络——seccomp/Job Object
//      单独都不构成那两样。
// 「拒绝发生在建账与转宿主之前」由 apps/daemon/test/remote-execution-gate.test.mjs
// 在真 HTTP 面上钉，本文件只验判定表与探针本身。

// indexOf 回 Option<Int64>，判「有没有」要先落回整数。写成
// `if (s.indexOf(x) ?? -1 >= 0) {` 会让条件在第一个右括号处提前收口，
// 编译器接着报 expected '{'——那是括号位置问题，不是这条运算符不能用。
func hasNeedle(hay: String, needle: String): Bool {
    let at = hay.indexOf(needle)
    if (let Some(pos) <- at) { return pos >= 0 }
    return false
}

@Test
func executePermissionWithoutEnforcementIsRefused() {
    @Expect(refusalReason(AUTHZ_PERM_EXECUTE, false) == SANDBOX_REASON_UNAVAILABLE, true)
}

@Test
func otherPermissionClassesAreNotRefusedByThisGate() {
    // 这条防止「顺手把所有远程写操作都关了」：门禁只管 OS 强制执行缺失时的那一族。
    @Expect(refusalReason("read", false) == "", true)
    @Expect(refusalReason("write", false) == "", true)
    @Expect(refusalReason("management", false) == "", true)
    @Expect(refusalReason("approval", false) == "", true)
    // 未知类别也不拒——它会在授权面拿到 method-not-registered，归因其一。
    @Expect(refusalReason("", false) == "", true)
}

@Test
func refusalDisappearsOnlyWhenEnforcementIsReal() {
    @Expect(refusalReason(AUTHZ_PERM_EXECUTE, true) == "", true)
}

@Test
func enforcementValueComesFromBehaviorNotAConstant() {
    // confine 原样返回 argv == 没有强制隔离。探针与宣告必须同源于这个行为判断。
    @Expect(confineRewritesArgv() == false, true)
    let e = RemoteSandboxEnforcement.current()
    @Expect(e.enforcing == false, true)
    @Expect(e.mode == SANDBOX_ENFORCE_NONE, true)
    @Expect(e.limitations.size > 0, true)
}

@Test
func limitationsNameFileAndNetworkExplicitly() {
    // 规格 §7：Job Object 只证明进程/资源管理，不能单独证明文件与网络隔离。
    // 所以即便将来接了它，限制清单里这两项也必须留着。
    let e = RemoteSandboxEnforcement.current()
    var hasFile = false
    var hasNet = false
    for (l in e.limitations) {
        if (hasNeedle(l, "file")) { hasFile = true }
        if (hasNeedle(l, "network")) { hasNet = true }
    }
    @Expect(hasFile, true)
    @Expect(hasNet, true)
}

@Test
func enforcementJsonAnnouncesModeEnforcingAndLimitations() {
    let j = RemoteSandboxEnforcement.current().toJson()
    var allKeys = true
    for (key in ["\"mode\"", "\"enforcing\"", "\"limitations\""]) {
        if (!hasNeedle(j, key)) { allKeys = false }
    }
    @Expect(allKeys, true)
    @Expect(hasNeedle(j, "\"enforcing\":false"), true)
    @Expect(hasNeedle(j, "no-file-system-isolation"), true)
    // 宣告面不带凭据字样：它是匿名可读的 /health 之外的公开面。
    @Expect(!hasNeedle(j, "token"), true)
}
