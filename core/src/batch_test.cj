package core
import std.fs.*
import std.env.*
import std.unittest.*
import stdx.encoding.json.*

// 本地格式是 P0 提案，不声称上游未公开的计划 schema 兼容。
func batchFixture(): String {
    let root = Directory.createTemp(Path(getVariable("TMP") ?? ".")).toString()
    File.writeTo("${root}/settings.json", ##"{"batch":{"model":"qwen","authType":"openai","baseUrl":"https://example.com/v1","credentialRef":"DASHSCOPE_API_KEY"},"env":{"DASHSCOPE_API_KEY":"测试凭证"}}"##.toArray())
    File.writeTo("${root}/源.txt", "中文😀\u{0000}正文".toArray())
    File.writeTo("${root}/plan.json", ##"{"task":"翻译😀","inputs":["源.txt"],"outputDir":"docs/en","maxOutputTokens":100,"maxCostUsd":2,"thinking_budget":0}"##.toArray())
    return root
}
func batchError(action: () -> Unit): String {
    try { action(); return "" } catch (e: Exception) { return e.message }
}
@Test
func batchMissingConfigFailsClosed() {
    let root = batchFixture()
    try {
        remove("${root}/settings.json")
        @Expect(batchError({ => BatchStore(root, "${root}/batch", "${root}/settings.json").check() }), "batch-config-missing")
    } finally { remove(root, recursive: true) }
}
@Test
func batchIndependentConfigAndUnderscoreCredential() {
    let root = batchFixture()
    try {
        let cfg = BatchStore(root, "${root}/batch", "${root}/settings.json").check()
        @Expect(cfg["model"].asString().getValue(), "qwen")
        @Expect(cfg["credentialRef"].asString().getValue(), "DASHSCOPE_API_KEY")
        @Expect(cfg.toString().contains("测试凭证"), false)
    } finally { remove(root, recursive: true) }
}
@Test
func batchMissingCredentialAndUnsupportedProtocolRejected() {
    let root = batchFixture()
    try {
        let store = BatchStore(root, "${root}/batch", "${root}/settings.json")
        File.writeTo("${root}/settings.json", ##"{"batch":{"model":"qwen","baseUrl":"https://example.com/v1","credentialRef":"BATCH_P0_NEVER_SET"}}"##.toArray())
        @Expect(batchError({ => store.check() }), "batch-credential-missing")
        File.writeTo("${root}/settings.json", ##"{"batch":{"model":"qwen","baseUrl":"https://example.com/v1","credentialRef":"BATCH_P0_NEVER_SET","wireApi":"responses"}}"##.toArray())
        @Expect(batchError({ => store.check() }), "batch-wire-api-unsupported")
    } finally { remove(root, recursive: true) }
}
@Test
func batchDryRunStableUnicodeAndNoTask() {
    let root = batchFixture()
    try {
        let store = BatchStore(root, "${root}/batch", "${root}/settings.json")
        let a = store.preview("${root}/plan.json", "")
        let b = store.preview("${root}/plan.json", "")
        @Expect(a.toString(), b.toString())
        @Expect(a["plan"].asObject()["task"].asString().getValue(), "翻译😀")
        @Expect(match (a["costEstimateUsd"].kind()) { case JsNull => true; case _ => false }, true)
        @Expect(store.list().size(), Int64(0))
        @Expect(exists("${root}/batch"), false)
    } finally { remove(root, recursive: true) }
}
@Test
func batchSnapshotCoversRawPlanInputPathContentAndConfig() {
    let root = batchFixture()
    try {
        let store = BatchStore(root, "${root}/batch", "${root}/settings.json")
        let snap = store.preview("${root}/plan.json", "")["snapshot"].asString().getValue()
        File.appendTo("${root}/plan.json", " ".toArray())
        @Expect(batchError({ => store.preview("${root}/plan.json", snap) }), "batch-snapshot-mismatch")
        let next = store.preview("${root}/plan.json", "")["snapshot"].asString().getValue()
        File.writeTo("${root}/源.txt", "已改".toArray())
        @Expect(batchError({ => store.preview("${root}/plan.json", next) }), "batch-snapshot-mismatch")
        let third = store.preview("${root}/plan.json", "")["snapshot"].asString().getValue()
        File.writeTo("${root}/settings.json", ##"{"batch":{"model":"other","baseUrl":"https://example.com/v1","credentialRef":"DASHSCOPE_API_KEY"},"env":{"DASHSCOPE_API_KEY":"测试凭证"}}"##.toArray())
        @Expect(batchError({ => store.preview("${root}/plan.json", third) }), "batch-snapshot-mismatch")
    } finally { remove(root, recursive: true) }
}
@Test
func batchOutputConfinement() {
    let root = batchFixture()
    try {
        let store = BatchStore(root, "${root}/batch", "${root}/settings.json")
        for (output in ["../escape", ".secret", "docs/.hidden", "docs/../escape", "C:/escape"]) {
            let plan = JsonObject(); plan.put("inputs", JsonArray()); plan.put("outputDir", JsonString(output)); plan.put("maxOutputTokens", JsonInt(1))
            File.writeTo("${root}/plan.json", plan.toString().toArray())
            @Expect(batchError({ => store.preview("${root}/plan.json", "") }).size > 0, true)
        }
    } finally { remove(root, recursive: true) }
}
@Test
func batchTaskIdsAlwaysValidated() {
    let root = batchFixture()
    try {
        let store = BatchStore(root, "${root}/batch", "${root}/settings.json")
        for (id in ["../outside", "", "a/b", "a\\b", ".hidden", "C:escape", "CON"]) {
            @Expect(batchError({ => store.readTask(id) }), "batch-task-id-invalid")
            @Expect(batchError({ => store.clean(id, true) }), "batch-task-id-invalid")
        }
    } finally { remove(root, recursive: true) }
}
@Test
func batchLocalListCleanPreservesRealRecordAndRequiresForce() {
    let root = batchFixture()
    try {
        Directory.create("${root}/batch/tasks/task-1", recursive: true)
        let raw = ##"{"id":"task-1","status":"submitted","createdAt":"2026-10-08T00:00:00Z","providerJobId":"remote-1"}"##
        File.writeTo("${root}/batch/tasks/task-1/task.json", raw.toArray())
        let store = BatchStore(root, "${root}/batch", "${root}/settings.json")
        @Expect(store.list().size(), Int64(1))
        @Expect(store.readTask("task-1")["createdAt"].asString().getValue(), "2026-10-08T00:00:00Z")
        @Expect(batchError({ => store.clean("task-1", false) }), "batch-clean-force-required")
        store.clean("task-1", true)
        @Expect(exists("${root}/batch/tasks/task-1"), false)
        @Expect(exists("${root}/plan.json"), true)
    } finally { remove(root, recursive: true) }
}
@Test
func batchFramingDistinguishesEmbeddedZeroAndBoundaries() {
    @Expect(batchSnapshot(["a\u{0000}b", "c"]) == batchSnapshot(["a", "b\u{0000}c"]), false)
    @Expect(batchSnapshot(["ab", "c"]) == batchSnapshot(["a", "bc"]), false)
}
