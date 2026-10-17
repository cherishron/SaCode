package daemon
import core.*

import std.collection.*
import std.unittest.*

// 审计完整性（规格 §7「审计保存 who/when/what/result；遍历日志断言无登记秘密」）的两侧，
// 本批把它从「有禁词就整条丢弃」改成「值脱敏、事件照记」。
//
// 为什么原来的行为是个洞：workspaceId / sessionId / operationId / approvalRef 都是从
// 调用方 params 里取的任意字符串，而 record() 遇到禁词整条抛异常不落盘。于是任何想
// 少留痕的调用方只要把 operationId 写成含 `"credential"` 的内容，这次授权判定就
// 在审计里**不存在**——fail-closed 是对的，但「谁在试什么」这条恰恰是规格要求留下的。
//
// /rpc 面这条其实还有第一道（RemoteRequestGate.sanitizeId 把越字符集的 id 换成固定标记），
// 所以真正在 wire 上裸奔的是 deviceId：它由登记请求体的 deviceName 拼出来，
// 而 /auth/token 的失败条目直接把请求体的 deviceId 原文写进审计。本批把它一起纳进
// 值级脱敏，wire 侧证据见 apps/daemon/test/remote-audit-integrity.test.mjs 后两条。
//
// 这些用例以 `package daemon + import core.*` 落在这里，是因为 core 侧的链接段在本机
// 40 分钟出不来 unittest_bin/core.exe（既有记录），运行验证走这条已确认可用的通道；
// core/src/remote_audit_test.cj 里的同名不变量同步改成新语义。

// 内存 sink：直接收行，便于逐条断言而不用等文件刷盘。
class CaptureAuditSink <: AuditSink {
    let lines = ArrayList<String>()
    var failFlush = false

    public func append(line: String): Bool {
        lines.add(line)
        return true
    }

    public func flush(): Bool {
        return !failFlush
    }
}

// 默认参数在本仓/本版编译器是 bang 形参形态：`name!: Type = 值`
// （不带 `!` 的 `name: Type = 值` 报 expected ',' or ')'，实测原文）。
func entryWith(operationId: String, workspaceId!: String = "ws-1", sessionId!: String = "s-1",
               approvalRef!: String = "", denyReason!: String = "", deviceId!: String = "dev-1"): AuditEntry {
    return AuditEntry(ts: Int64(1730000000000),
        principalId: "p-mobile", deviceId: deviceId, instanceId: "inst-1",
        workspaceId: workspaceId, sessionId: sessionId, method: "session/catalog",
        operationId: operationId, outcome: "allowed",
        approvalRef: approvalRef, denyReason: denyReason)
}

@Test
func auditRedactsBannedValueButStillRecordsTheDecision() {
    let sink = CaptureAuditSink()
    let log = RemoteAuditLog(sink)
    // 注入形态就是转义后会撞上禁用键串的那种：整段 JSON 塞进 operationId。
    let injected = "op\"credential\":\"sk-SECRET-LEAK\""
    let recorded = log.record(entryWith(injected))
    @Expect(recorded, true)
    @Expect(sink.lines.size, Int64(1))
    let line = sink.lines[0]
    // 第一侧：禁词与原文都不许落盘。
    @Expect(line.contains("SECRET-LEAK"), false)
    @Expect(line.contains("\\\"credential\\\""), false)
    // 第二侧（本批新增的强度）：判定本身必须留痕，who/when/what/result 一个都不能少。
    @Expect(line.contains("\"principalId\":\"p-mobile\""), true)
    @Expect(line.contains("\"deviceId\":\"dev-1\""), true)
    @Expect(line.contains("\"method\":\"session/catalog\""), true)
    @Expect(line.contains("\"outcome\":\"allowed\""), true)
    // 脱敏要看得出是脱敏，不能伪装成一个正常的 id。
    @Expect(line.contains("audit-redacted"), true)
}

@Test
func auditKeepsCleanValuesUntouched() {
    // 反向半边：普通 id 不许被顺手改写——否则审计只剩一堆占位符，等于没有。
    let sink = CaptureAuditSink()
    let log = RemoteAuditLog(sink)
    @Expect(log.record(entryWith("op-42", workspaceId: "ws/read-1")), true)
    let line = sink.lines[0]
    @Expect(line.contains("\"operationId\":\"op-42\""), true)
    @Expect(line.contains("\"workspaceId\":\"ws/read-1\""), true)
    @Expect(line.contains("audit-redacted"), false)
}

@Test
func auditRedactsEveryFreeTextFieldAndNamesWhichOnes() {
    let sink = CaptureAuditSink()
    let log = RemoteAuditLog(sink)
    let bad = "x\"token\":\"t\""
    @Expect(log.record(entryWith(bad, workspaceId: bad, sessionId: "s-1",
        approvalRef: bad, denyReason: bad)), true)
    let line = sink.lines[0]
    @Expect(line.contains("\\\"token\\\""), false)
    // 谁被脱敏了要能复原到字段粒度。这里断言的是**值等于该字段的标记**，
    // 不是「整行里含有那个名字」——JSON 键名本来就在行里，那样断言是空的。
    @Expect(line.contains("\"operationId\":\"audit-redacted:operationId\""), true)
    @Expect(line.contains("\"workspaceId\":\"audit-redacted:workspaceId\""), true)
    @Expect(line.contains("\"approvalRef\":\"audit-redacted:approvalRef\""), true)
    @Expect(line.contains("\"denyReason\":\"audit-redacted:denyReason\""), true)
    // 没被污染的字段必须原样保留，否则「留事件」会变成「留一堆占位符」。
    @Expect(line.contains("\"sessionId\":\"s-1\""), true)
}

@Test
func auditRedactsInjectedDeviceIdBecauseItComesFromClientDeviceName() {
    // deviceId 的取值链是「登记请求体 deviceName → `${deviceName}-${序号}`」，
    // 而 /auth/token 的失败条目把请求体 deviceId 原文直接写进审计。
    // 这条把「为什么 deviceId 在脱敏集合里」钉在单元测试层，不靠 wire 用例单独扛。
    let sink = CaptureAuditSink()
    let log = RemoteAuditLog(sink)
    let bad = "x\"credential\":\"sk-NOPE\""
    @Expect(log.record(entryWith("op-1", denyReason: "invalid-credential", deviceId: bad)), true)
    let line = sink.lines[0]
    @Expect(line.contains("sk-NOPE"), false)
    @Expect(line.contains("\\\"credential\\\""), false)
    @Expect(line.contains("\"deviceId\":\"audit-redacted:deviceId\""), true)
    // 同一行的判定与拒因照旧可读：脱敏是字段级，不是整行。
    @Expect(line.contains("\"denyReason\":\"invalid-credential\""), true)
    @Expect(line.contains("\"operationId\":\"op-1\""), true)
}

@Test
func auditServerSideFieldsAreNeverRedacted() {
    // 反向半边：principalId / instanceId / method 不是远程输入面
    // （principalId 与 instanceId 来自本地管理入口与服务端随机数，
    // method 在进 gate.check 前已过 methodViolation 字符集门禁），
    // 把它们也脱掉等于用「保护」的名义把真信息抹了。
    // 这里故意让 deviceId 带注入串，证明脱敏**不会**外溢到那三个字段。
    let sink = CaptureAuditSink()
    let log = RemoteAuditLog(sink)
    @Expect(log.record(entryWith("op", deviceId: "x\"token\":\"t\"")), true)
    let line = sink.lines[0]
    @Expect(line.contains("\"principalId\":\"p-mobile\""), true)
    @Expect(line.contains("\"instanceId\":\"inst-1\""), true)
    @Expect(line.contains("\"method\":\"session/catalog\""), true)
    @Expect(line.contains("\"ts\":1730000000000"), true)
    @Expect(line.contains("\"deviceId\":\"audit-redacted:deviceId\""), true)
}

@Test
func auditDenyReasonFromOurOwnVocabularyIsNotRedacted() {
    // 门禁自己的拒因（host-not-allowed 这类）必须原样可读，
    // 否则这条防线在日志里变成「原因被抹掉」。
    let sink = CaptureAuditSink()
    let log = RemoteAuditLog(sink)
    @Expect(log.record(AuditEntry(ts: Int64(1), principalId: "p", deviceId: "d", instanceId: "i",
        workspaceId: "w", sessionId: "s", method: "task/start", operationId: "o",
        outcome: "denied", approvalRef: "", denyReason: "sandbox-enforcement-unavailable")), true)
    let line = sink.lines[0]
    @Expect(line.contains("\"denyReason\":\"sandbox-enforcement-unavailable\""), true)
    @Expect(line.contains("audit-redacted"), false)
}

