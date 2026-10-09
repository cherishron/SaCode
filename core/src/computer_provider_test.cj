package core

import std.fs.*
import std.unittest.*
import stdx.encoding.json.*

func computerFixture(): ComputerProviderClient {
    return ComputerProviderClient("node", ["D:/Project/sa/saai/sa-code/core/test-support/computer-provider-fixture.mjs"], workingDirectory: Path("D:/Project/sa/saai/sa-code/core"))
}

@Test
func computerProviderNotStartedAndPreCancelledDoNotDispatch() {
    let client = computerFixture()
    @Expect(client.invoke("windows.list", "{}").failureKind, "provider-not-alive")
    @Expect(client.start(), true)
    try {
        let token = TurnToken()
        token.cancel()
        @Expect(client.invoke("windows.list", "{}", token: token).failureKind, "cancelled")
        let status = client.invoke("windows.list", ##"{"scenario":"status"}"##)
        @Expect(JsonValue.fromStr(status.content).asObject()["invokes"].asInt().getValue(), Int64(1))
    } finally { client.close() }
}

@Test
func computerProviderPreservesStructuredContentAndEscapedArguments() {
    let client = computerFixture()
    @Expect(client.start(), true)
    try {
        let r = client.invoke("windows.list", ##"{"text":"中文\n\"引号\"","path":"D:\\a"}"##)
        @Expect(r.ok, true)
        @Expect(r.verb, "windows.list")
        @Expect(r.failureKind, "")
        let obj = JsonValue.fromStr(r.content).asObject()
        @Expect(obj["echo"].asObject()["text"].asString().getValue(), "中文\n\"引号\"")
        @Expect(obj["nested"].asObject()["values"].asArray().size(), Int64(3))
    } finally { @Expect(client.close(), Int64(0)) }
}

@Test
func computerProviderNestedOkCannotOverrideRootFailure() {
    let client = computerFixture()
    @Expect(client.start(), true)
    try {
        let r = client.invoke("windows.list", ##"{"scenario":"nested"}"##)
        @Expect(r.ok, false)
        @Expect(r.failureKind, "native-refused")
        @Expect(r.message, "真实失败")
        @Expect(JsonValue.fromStr(r.content).asObject()["ok"].asBool().getValue(), true)
    } finally { client.close() }
}

@Test
func computerProviderRejectsMalformedEnvelopeIdAndTypes() {
    let client = computerFixture()
    @Expect(client.start(), true)
    try {
        // 只有配上这次调用的衣着才谈得上「信封非法」，解码层必须逐条拒下。
        for (scenario in ["bad-frame", "wrong-type", "error-envelope"]) {
            let r = client.invoke("windows.list", "{\"scenario\":\"${scenario}\"}", timeoutMs: 2000)
            @Expect(r.ok, false)
            @Expect(r.failureKind, "protocol-error")
        }
        // 错 id 配不上在途请求，传输层不替它编一个终态：有界等待到点只能记结果未知。
        let orphan = client.invoke("windows.list", ##"{"scenario":"wrong-id"}"##, timeoutMs: 600)
        @Expect(orphan.ok, false)
        @Expect(orphan.failureKind, "outcome-unknown")
        // 孤立帧不许冒充别人的应答：下一笔调用仍须按自己的 id 正确配对。
        @Expect(client.invoke("windows.list", "{}").ok, true)
    } finally { client.close() }
}

@Test
func computerProviderRejectsBadArgsBeforeSending() {
    let client = computerFixture()
    @Expect(client.start(), true)
    try {
        for (args in ["{oops", "[]", "null", "true"]) {
            @Expect(client.invoke("windows.list", args).failureKind, "invalid-args")
        }
        let r = client.invoke("windows.list", ##"{"scenario":"status"}"##)
        @Expect(JsonValue.fromStr(r.content).asObject()["invokes"].asInt().getValue(), Int64(1))
    } finally { client.close() }
}

@Test
func computerProviderCancellationWaitsForCommittedTerminalExactlyOnce() {
    let client = computerFixture()
    @Expect(client.start(), true)
    try {
        let token = TurnToken()
        let call = spawn { => client.invoke("click", ##"{"scenario":"cancel-committed"}"##, token: token, timeoutMs: 5000) }
        var ready = false
        for (_ in 0..100) {
            let status = client.invoke("windows.list", ##"{"scenario":"status"}"##)
            if (JsonValue.fromStr(status.content).asObject()["pending"].asInt().getValue() == 1) { ready = true; break }
            sleep(10 * Duration.millisecond)
        }
        @Expect(ready, true)
        token.cancel()
        let r = call.get(6000 * Duration.millisecond)
        @Expect(r.ok, true)
        let content = JsonValue.fromStr(r.content).asObject()
        @Expect(content["operation"].asObject()["committed"].asBool().getValue(), true)
        @Expect(content["cancelCount"].asInt().getValue(), Int64(1))
    } finally { client.close() }
}

@Test
func computerProviderCancellationPreservesRefusedTerminal() {
    let client = computerFixture()
    @Expect(client.start(), true)
    try {
        let token = TurnToken()
        let call = spawn { => client.invoke("click", ##"{"scenario":"cancel-refused"}"##, token: token, timeoutMs: 5000) }
        for (_ in 0..100) {
            let status = client.invoke("windows.list", ##"{"scenario":"status"}"##)
            if (JsonValue.fromStr(status.content).asObject()["pending"].asInt().getValue() == 1) { break }
            sleep(10 * Duration.millisecond)
        }
        token.cancel()
        let r = call.get(6000 * Duration.millisecond)
        @Expect(r.ok, false)
        @Expect(r.failureKind, "refused")
        @Expect(r.message, "已拒绝")
    } finally { client.close() }
}

@Test
func computerProviderTimeoutAfterCancellationIsOutcomeUnknown() {
    let client = computerFixture()
    @Expect(client.start(), true)
    try {
        let token = TurnToken()
        let call = spawn { => client.invoke("click", ##"{"scenario":"never"}"##, token: token, timeoutMs: 1200) }
        for (_ in 0..100) {
            let status = client.invoke("windows.list", ##"{"scenario":"status"}"##)
            if (JsonValue.fromStr(status.content).asObject()["pending"].asInt().getValue() == 1) { break }
            sleep(5 * Duration.millisecond)
        }
        token.cancel()
        @Expect(call.get(3000 * Duration.millisecond).failureKind, "outcome-unknown")
        let status = client.invoke("windows.list", ##"{"scenario":"status"}"##)
        @Expect(JsonValue.fromStr(status.content).asObject()["cancels"].asInt().getValue(), Int64(1))
    } finally { client.close() }
}

@Test
func computerProviderForwardsObservationAndDoesNotReuseConsumedEvidence() {
    let client = computerFixture()
    @Expect(client.start(), true)
    try {
        let observed = client.invoke("window.observe", ##"{"pid":1,"windowId":2}"##)
        let id = JsonValue.fromStr(observed.content).asObject()["observationId"].asString().getValue()
        let args = "{\"pid\":1,\"windowId\":2,\"x\":0,\"y\":0,\"observationId\":\"${id}\"}"
        @Expect(client.invoke("click", args).ok, true)
        @Expect(client.invoke("click", args).failureKind, "stale-observation")
    } finally { client.close() }
}
