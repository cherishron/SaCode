package core

import std.fs.*
import stdx.encoding.base64.*
import std.unittest.*
import stdx.encoding.json.*

@Test
func computerExecutorCancelledBeforeAudit(): Unit {
    let log = SessionLog("${computerImageRoot("computer-executor-cancel")}/session.log")
    let exec = ComputerToolExecutor(log, { verb, _, _ =>
        ComputerProviderResult(true, verb, "{}", "", "")
    })
    let token = TurnToken()
    token.cancel()
    let result = exec.perform("click", "{}", token: token)
    @Expect(result.ok, false)
    @Expect(result.failureKind, "cancelled")
    @Expect(log.snapshotEvents().size, 0)
}

@Test
func computerExecutorRecordsAttemptBeforeActualResult(): Unit {
    let log = SessionLog("${computerImageRoot("computer-executor-order")}/session.log")
    let sawAttempt = [false]
    let exec = ComputerToolExecutor(log, { verb, _, _ =>
        let events = log.snapshotEvents()
        sawAttempt[0] = events.size == 1 && events[0].eventType == "computer-use/action"
        ComputerProviderResult(false, verb, "{\"operation\":{\"committed\":true}}", "outcome-unknown", "unverified")
    })
    let result = exec.perform("click", "{\"pid\":1}")
    @Expect(sawAttempt[0], true)
    @Expect(result.ok, false)
    let events = log.snapshotEvents()
    @Expect(events.size, 2)
    @Expect(events[1].eventType, "computer/exec")
    @Expect(events[1].data.contains("committed"), true)
    @Expect(events[1].data.contains("outcome-unknown"), true)
}

@Test
func computerExecutorRejectsUnknownWithoutAudit(): Unit {
    let log = SessionLog("${computerImageRoot("computer-executor-verb")}/session.log")
    let invoked = [false]
    let exec = ComputerToolExecutor(log, { verb, _, _ =>
        invoked[0] = true
        ComputerProviderResult(true, verb, "{}", "", "")
    })
    let result = exec.perform("shell", "{}")
    @Expect(result.failureKind, "bad-verb")
    @Expect(invoked[0], false)
    @Expect(log.snapshotEvents().size, 0)
}

@Test
func computerExecutorRecordsInvokeExceptionAsFailure(): Unit {
    let log = SessionLog("${computerImageRoot("computer-executor-exception")}/session.log")
    let exec = ComputerToolExecutor(log, { _, _, _ => throw Exception("提供者\n\"异常\"") })
    let result = exec.perform("click", "{}")
    @Expect(result.ok, false)
    @Expect(result.failureKind, "provider-error")
    @Expect(result.message, "提供者\n\"异常\"")
    let events = log.snapshotEvents()
    @Expect(events.size, 2)
    if (events.size == 2) {
        @Expect(events[0].eventType, "computer-use/action")
        @Expect(events[1].eventType, "computer/exec")
        let data = JsonValue.fromStr(events[1].data).asObject()
        @Expect(data["ok"].asBool().getValue(), false)
        @Expect(data["failureKind"].asString().getValue(), result.failureKind)
        @Expect(data["message"].asString().getValue(), result.message)
        @Expect(data["content"].asObject().size(), Int64(0))
    }
}

@Test
func computerExecutorRejectsInvalidArgsWithoutAudit(): Unit {
    let log = SessionLog("${computerImageRoot("computer-executor-args")}/session.log")
    let invoked = [false]
    let exec = ComputerToolExecutor(log, { verb, _, _ =>
        invoked[0] = true
        ComputerProviderResult(true, verb, "{}", "", "")
    })
    for (args in ["{oops", "[]", "null", "true", "1", "\"text\""]) {
        let result = exec.perform("click", args)
        @Expect(result.ok, false)
        @Expect(result.failureKind, "invalid-args")
    }
    @Expect(invoked[0], false)
    @Expect(log.snapshotEvents().size, 0)
}

@Test
func computerExecutorPreservesRawArgsAndCommittedResultAfterCancel(): Unit {
    let log = SessionLog("${computerImageRoot("computer-executor-committed")}/session.log")
    let args = ##"{ "text": "中文\n\"引号\"", "nested": {"values":[1,true,null]} }"##
    let content = ##"{"operation":{"committed":true},"values":[1,true,null]}"##
    let token = TurnToken()
    let exec = ComputerToolExecutor(log, { verb, raw, passedToken =>
        @Expect(raw, args)
        @Expect(passedToken.cancelled(), false)
        let events = log.snapshotEvents()
        @Expect(events.size, 1)
        if (events.size == 1) {
            @Expect(events[0].data, "{\"verb\":\"${verb}\",\"args\":${args}}")
            let action = JsonValue.fromStr(events[0].data).asObject()
            @Expect(action["verb"].asString().getValue(), verb)
            @Expect(action["args"].asObject()["text"].asString().getValue(), "中文\n\"引号\"")
        }
        passedToken.cancel()
        ComputerProviderResult(true, verb, content, "", "已提交\n\"完成\"")
    })
    let result = exec.perform("click", args, token: token)
    @Expect(token.cancelled(), true)
    @Expect(result.ok, true)
    @Expect(result.failureKind, "")
    @Expect(result.content, content)
    let events = log.snapshotEvents()
    @Expect(events.size, 2)
    if (events.size == 2) {
        let data = JsonValue.fromStr(events[1].data).asObject()
        @Expect(data["ok"].asBool().getValue(), true)
        @Expect(data["failureKind"].asString().getValue(), "")
        @Expect(data["message"].asString().getValue(), result.message)
        @Expect(data["content"].asObject()["operation"].asObject()["committed"].asBool().getValue(), true)
        @Expect(data["content"].asObject()["values"].asArray().size(), Int64(3))
    }
}

@Test
func computerExecutorAcceptsExactlyProviderVerbs(): Unit {
    let log = SessionLog("${computerImageRoot("computer-executor-verbs")}/session.log")
    let exec = ComputerToolExecutor(log, { verb, _, _ => ComputerProviderResult(true, verb, "{}", "", "") })
    for (verb in ["windows.list", "windows.get", "window.observe", "click", "double_click", "right_click", "drag", "scroll", "type", "press_key", "hotkey", "set_value", "verify_state"]) {
        @Expect(exec.perform(verb, "{}").ok, true)
    }
    @Expect(log.snapshotEvents().size, 26)
    for (verb in ["", "CLICK", " click", "navigate", "screenshot"]) {
        @Expect(exec.perform(verb, "{}").failureKind, "bad-verb")
    }
    @Expect(log.snapshotEvents().size, 26)
}

@Test
func computerExecutorAuditIsSafeButReturnedImagesRemainMaterializable(): Unit {
    let root = computerImageRoot("executor-audit")
    let log = SessionLog("${root}/session.log")
    let store = AttachmentStore("${root}/objects", log, AttachmentLimits.localBackend())
    let encoded = toBase64String(computerImageBytes())
    let content = "{\"operation\":{\"committed\":true},\"screenshot\":{\"images\":[{\"mimeType\":\"image/gif\",\"dataBase64\":\"${encoded}\"}],\"filePath\":\"C:/fixture-only.png\"},\"nested\":[{\"dataBase64\":\"fixture-payload\",\"filePath\":\"C:/fixture-nested.png\",\"status\":\"sent\"}]}"
    let exec = ComputerToolExecutor(log, { verb, _, _ => ComputerProviderResult(true, verb, content, "", "完成") })
    let result = exec.perform("window.observe", "{}")
    @Expect(result.content, content)
    let events = log.snapshotEvents()
    @Expect(events.size, Int64(2))
    if (events.size == 2) {
        @Expect(events[1].eventType, "computer/exec")
        @Expect(events[1].data.contains("dataBase64"), false)
        @Expect(events[1].data.contains("filePath"), false)
        @Expect(events[1].data.contains(encoded), false)
        @Expect(events[1].data.contains("fixture-payload"), false)
        let audit = JsonValue.fromStr(events[1].data).asObject()["content"].asObject()
        @Expect(audit["operation"].asObject()["committed"].asBool().getValue(), true)
        @Expect(audit["nested"].asArray()[0].asObject()["status"].asString().getValue(), "sent")
    }
    @Expect(log.flush(), true)
    let replay = SessionLog("${root}/session.log")
    replay.load()
    for (event in replay.snapshotEvents()) {
        @Expect(event.data.contains(encoded), false)
        @Expect(event.data.contains("filePath"), false)
    }
    let material = materializeComputerResult("{\"ok\":${result.ok},\"content\":${result.content}}", Some(store))
    @Expect(material.refs.size, Int64(1))
    for (ref in material.refs) { @Expect(toBase64String(store.read(ref.attachmentId)), encoded) }
}
