package core

import std.collection.*
import std.fs.*
import std.unittest.*
import stdx.encoding.json.*

class SkillLoadProbeProvider <: SkillProvider {
    public func name(): String { return "probe" }
    public func list(): ArrayList<SkillSummary> { return ArrayList<SkillSummary>() }
    public func get(name: String): ?SkillDefinition {
        if (name == "existing-skill") { return Some(SkillDefinition(SkillSummary(name, "测试技能"), "# 技能正文\n按需加载。")) }
        if (name == "manual-only") { return Some(SkillDefinition(SkillSummary(name, "手动技能", modelInvocable: false), "不可向模型加载")) }
        return None
    }
}

func skillLoadProbeCall(args: String): ModelToolCall {
    let call = ModelToolCall(0)
    call.id = "load-1"; call.name = "skill_load"; call.args = args
    return call
}

@Test
func skillLoadDeclarationBodyMissingAndReadOnlyModes() {
    let log = SessionLog("../target/tmp/skill-load-probe-unused.log")
    let skills = SkillRegistry(log)
    skills.registerProvider(SkillLoadProbeProvider())
    let approvals = Array<Int64>(1, repeat: 0)
    let runtime = ModelToolRuntime(log, false, skillRegistry: Some(skills), approval: { _ => approvals[0] += 1; Int64(0) })
    var count: Int64 = 0
    for (spec in runtime.specs()) { if (spec.name == "skill_load") { count += 1 } }
    @Expect(count, Int64(1))
    @Expect(runtime.registry.has("existing-skill"), false)
    @Expect(runtime.registry.requiresApproval("skill_load"), false)
    let schema = JsonValue.fromStr(runtime.registry.paramsOf("skill_load")).asObject()
    @Expect(schema["additionalProperties"].asBool().getValue(), false)
    @Expect(schema["required"].asArray().get(0).getOrThrow().asString().getValue(), "name")
    for (mode in ["plan", "build", "auto", "yolo"]) {
        log.append("mode/mode", mode)
        let result = runtime.execute(skillLoadProbeCall(##"{"name":"existing-skill"}"##))
        @Expect(result.allowed, true)
        @Expect(result.why, "# 技能正文\n按需加载。")
    }
    @Expect(approvals[0], Int64(0))
    @Expect(runtime.execute(skillLoadProbeCall(##"{"name":"nonexistent"}"##)).why, "skill-not-found")
    @Expect(runtime.execute(skillLoadProbeCall(##"{"name":"manual-only"}"##)).why, "skill-not-model-invocable")
    for (args in ["{}", ##"{"name":""}"##, ##"{"name":4}"##, ##"{"name":"existing-skill","extra":true}"##]) {
        @Expect(runtime.execute(skillLoadProbeCall(args)).why, "skill-bad-args")
    }
    let guarded = ModelToolRuntime(log, false, skillRegistry: Some(skills), guard: { _, _ => false })
    @Expect(guarded.execute(skillLoadProbeCall(##"{"name":"existing-skill"}"##)).why, "guard-denied")
    @Expect(ModelToolRuntime(log, false).registry.has("skill_load"), true)
}

@Test
func skillLoadUsesExistingFilesystemRegistryByDefault() {
    if (!exists("../target/tmp")) { Directory.create("../target/tmp", recursive: true) }
    let root = canonicalize(Directory.createTemp("../target/tmp")).toString()
    try {
        let skillDir = "${root}/.sa-code/skills/filesystem-probe"
        Directory.create(skillDir, recursive: true)
        File.writeTo("${skillDir}/SKILL.md", "---\nname: filesystem-probe\ndescription: 文件系统合成技能\n---\n# 文件系统正文\n".toArray())
        let log = SessionLog("${root}/session.log")
        let runtime = ModelToolRuntime(log, false, workingDirectory: root)
        let result = runtime.execute(skillLoadProbeCall(##"{"name":"filesystem-probe"}"##))
        @Expect(result.allowed, true)
        @Expect(result.why.contains("# 文件系统正文"), true)
    } finally { removeIfExists(root, recursive: true) }
}
