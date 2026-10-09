package core

import std.fs.*
import std.unittest.*
import std.sync.AtomicBool
import stdx.encoding.json.*

@Test
func teamToolsDeclareOnlyBoundIdentityOperations() {
    let specs = teamToolSpecs()
    var names = ""
    for (spec in specs) {
        if (names.size > 0) { names += "," }
        names += spec.name
        @Expect(spec.params.contains("senderSessionId"), false)
        @Expect(spec.params.contains("actorSessionId"), false)
    }
    @Expect(names, "team_describe,team_member_create,team_message_send,team_message_broadcast,team_task_create,team_task_assign,team_task_claim,team_task_complete,team_member_stop")
}

@Test
func teamToolsRejectActorSpoofingWithoutDispatch() {
    let called = AtomicBool(false)
    let tools = TeamTools("bound-session", { _, _, _ => called.store(true); "{}" })
    let outcome = tools.execute("team_message_send", "{\"target\":\"worker\",\"text\":\"hello\",\"actorSessionId\":\"leader\"}")
    @Expect(outcome.allowed, false)
    @Expect(called.load(), false)
}

@Test
func teamToolsDispatchUseBoundSessionAndPreserveText() {
    let tools = TeamTools("worker-session", { actor, name, args => "${actor}::${name}::${args}" })
    let outcome = tools.execute("team_message_send", "{\"target\":\"leader\",\"text\":\"中文::你好\"}")
    @Expect(outcome.allowed, true)
    @Expect(outcome.why, "worker-session::team_message_send::{\"target\":\"leader\",\"text\":\"中文::你好\"}")
}

// 去掉额外字段守卫、必填检查或类型检查，均须被这一组拒绝用例抓住。
@Test
func teamToolsRejectInvalidSchemasWithoutDispatch() {
    let called = AtomicBool(false)
    let tools = TeamTools("bound", { _, _, _ => called.store(true); "{}" })
    let cases: Array<(String, String)> = [
        ("team_unknown", "{}"),
        ("team_describe", "{\"extra\":true}"),
        ("team_describe", "[]"),
        ("team_describe", "{} garbage"),
        ("team_describe", "{}{}"),
        ("team_describe", "{broken"),
        ("team_member_create", "{\"name\":\"worker\"}"),
        ("team_member_create", "{\"name\":\"\",\"role\":\"worker\"}"),
        ("team_member_create", "{\"name\":\"worker\",\"role\":null}"),
        ("team_message_send", "{\"target\":\"worker\",\"text\":\"hello\",\"senderSessionId\":\"leader\"}"),
        ("team_message_send", "{\"target\":\"worker\",\"sender\":\"leader\"}"),
        ("team_message_send", "{\"target\":\"worker\",\"text\":42}"),
        ("team_message_broadcast", "{\"text\":\"   \"}"),
        ("team_task_create", "{\"title\":\"task\"}"),
        ("team_task_create", "{\"title\":\"task\",\"dependencies\":\"id\"}"),
        ("team_task_create", "{\"title\":\"task\",\"dependencies\":[1]}"),
        ("team_task_create", "{\"title\":\"task\",\"dependencies\":[\"\"]}"),
        ("team_task_assign", "{\"taskId\":\"t\",\"memberId\":\"\"}"),
        ("team_task_claim", "{\"taskId\":false}"),
        ("team_task_complete", "{\"taskId\":\"t\",\"result\":\"\"}"),
        ("team_member_stop", "{\"memberId\":null}")
    ]
    for ((name, args) in cases) {
        let outcome = tools.execute(name, args)
        @Expect(outcome.allowed, false)
        @Expect(called.load(), false)
    }
}

// 九条 schema 与执行校验逐字段对齐；删除任一必填/空值检查必须转红。
@Test
func teamToolsAllSchemasDispatchOnlyExactFields() {
    let tools = TeamTools("bound", { actor, name, args => "${actor}::${name}::${args}" })
    let requests: Array<String> = [
        "{}", "{\"name\":\"worker\",\"role\":\"implementer\"}",
        "{\"target\":\"leader\",\"text\":\"hello\"}", "{\"text\":\"hello\"}",
        "{\"title\":\"task\",\"dependencies\":[\"t0\"]}",
        "{\"taskId\":\"t\",\"memberId\":\"worker\"}", "{\"taskId\":\"t\"}",
        "{\"taskId\":\"t\",\"result\":\"done\"}", "{\"memberId\":\"worker\"}"
    ]
    var index: Int64 = 0
    for (spec in teamToolSpecs()) {
        @Expect(spec.description.size > 0, true)
        @Expect(spec.needsApproval, spec.name != "team_describe")
        let schema = JsonValue.fromStr(spec.params).asObject()
        @Expect(schema["type"].asString().getValue(), "object")
        @Expect(schema["additionalProperties"].asBool().getValue(), false)
        let props = schema["properties"].asObject()
        let required = schema["required"].asArray()
        let args = requests[index]
        let outcome = tools.execute(spec.name, args)
        @Expect(outcome.allowed, true)
        @Expect(outcome.why, "bound::${spec.name}::${args}")
        @Expect(outcome.structured, false)
        @Expect(props.size(), required.size())
        for (i in 0..required.size()) {
            let key = required[i].asString().getValue()
            let field = props[key].asObject()
            let bad = JsonValue.fromStr(args).asObject()
            bad.put(key, JsonString(""))
            @Expect(tools.execute(spec.name, bad.toString()).allowed, false)
            bad.put(key, JsonNull())
            @Expect(tools.execute(spec.name, bad.toString()).allowed, false)
            if (key == "dependencies") {
                @Expect(field["type"].asString().getValue(), "array")
                @Expect(field["items"].asObject()["type"].asString().getValue(), "string")
            } else {
                @Expect(field["type"].asString().getValue(), "string")
            }
        }
        for (key in ["actor", "sender", "actorSessionId", "senderSessionId", "extra"]) {
            let called = AtomicBool(false)
            let guarded = TeamTools("bound", { _, _, _ => called.store(true); "{}" })
            let injected = JsonValue.fromStr(args).asObject()
            injected.put(key, JsonString("spoof"))
            @Expect(guarded.execute(spec.name, injected.toString()).allowed, false)
            @Expect(called.load(), false)
        }
        index += 1
    }
    @Expect(tools.execute("team_task_create", "{\"title\":\"task\",\"dependencies\":[]}").allowed, true)
}

@Test
func teamToolsDispatchExceptionsAreStructuredDenials() {
    let tools = TeamTools("bound", { _, _, args =>
        if (args.size > 0) { throw Exception("后端\"失败\n") }
        ""
    })
    let outcome = tools.execute("team_describe", "{}")
    @Expect(outcome.allowed, false)
    @Expect(outcome.structured, true)
    let error = JsonValue.fromStr(outcome.why).asObject()
    @Expect(error.get("error").isSome(), true)
    if (let Some(reason) <- error.get("error")) {
        @Expect(reason.asString().getValue(), "team-dispatch-failed")
    }
}

@Test
func teamToolsEmptyBoundIdentityNeverDispatches() {
    let called = AtomicBool(false)
    let tools = TeamTools("  ", { _, _, _ => called.store(true); "{}" })
    @Expect(tools.execute("team_describe", "{}").allowed, false)
    @Expect(called.load(), false)
}
