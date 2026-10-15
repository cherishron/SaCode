package core
import std.fs.*
import std.env.getVariable
import std.unittest.*
import stdx.encoding.json.*

@Test
func automationDefinitionsPersistLiteralPromptAndRejectStaleEdits() {
    let root = canonicalize(Directory.createTemp(Path(getVariable("TMP").getOrThrow()))).toString()
    try {
        let input = JsonObject(); input.put("id", JsonString("test-one")); input.put("title", JsonString("定时检查"))
        input.put("prompt", JsonString("检查 :: 内容\n保留换行")); input.put("cron", JsonString("*/15 * * * *")); input.put("workspace", JsonString(root))
        input.put("modelId", JsonString("local-model")); input.put("timezone", JsonString("UTC")); input.put("permission", JsonString("build")); input.put("enabled", JsonBool(false))
        let store = AutomationStore(root, "user", "")
        let saved = JsonValue.fromStr(store.save(input.toString(), 0)).asObject()
        let rev = saved.get("revision").getOrThrow().asInt().getValue()
        let replay = JsonValue.fromStr(AutomationStore(root, "user", "").describe()).asObject()
        let task = replay.get("tasks").getOrThrow().asArray()[0].asObject()
        @Expect(task.get("prompt").getOrThrow().asString().getValue(), "检查 :: 内容\n保留换行")
        @Expect(task.get("enabled").getOrThrow().asBool().getValue(), false)
        @ExpectThrows[Exception](store.save(input.toString(), 0))
        input.put("timezone", JsonString("No/Such-Timezone"))
        var timezoneError = ""
        try { store.save(input.toString(), rev) } catch (e: Exception) { timezoneError = e.message }
        @Expect(timezoneError, "automation-timezone-load-failed")
        input.put("timezone", JsonString("UTC"))
        let enabled = JsonValue.fromStr(store.control("test-one", "resume", rev)).asObject()
        @Expect(enabled.get("tasks").getOrThrow().asArray()[0].asObject().get("enabled").getOrThrow().asBool().getValue(), true)
        let current = enabled.get("revision").getOrThrow().asInt().getValue()
        input.put("cron", JsonString("* * * * * extra"))
        @ExpectThrows[Exception](store.save(input.toString(), current))
        let removed = JsonValue.fromStr(store.control("test-one", "remove", current)).asObject()
        @Expect(removed.get("tasks").getOrThrow().asArray().size(), 0)
        @Expect(JsonValue.fromStr(AutomationStore(root, "project", root).describe()).asObject().get("tasks").getOrThrow().asArray().size(), 0)
    } finally { removeIfExists(root, recursive: true) }
}
