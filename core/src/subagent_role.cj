package core

import std.collection.{ArrayList, HashMap, HashSet}
import std.fs.*
import std.sort.sort
import stdx.encoding.json.*

// 角色预算只是结构上限；有效额度仍需与系统策略、用户授权、会话策略取交集。
// 角色定义不能自我扩权：这里的校验只证明“定义合法”，不证明“权限已批准”。
public struct SubagentBudget {
    public let maxTurns: Int64
    public let maxTokens: Int64
    public let maxTimeMs: Int64
    public init(maxTurns: Int64, maxTokens: Int64, maxTimeMs: Int64) {
        this.maxTurns = maxTurns
        this.maxTokens = maxTokens
        this.maxTimeMs = maxTimeMs
    }
}

// source: builtin | user | project。内置角色不可原地覆写，只能以新 id 复制后自定义。
public struct SubagentRole {
    public let id: String
    public let name: String
    public let description: String
    public let tools: Array<String>
    public let acpEnabled: Bool
    public let model: String
    public let budget: SubagentBudget
    public let systemPrompt: String
    public let source: String
    public init(id: String, name: String, description: String, tools: Array<String>, acpEnabled: Bool, model: String,
        budget: SubagentBudget, systemPrompt: String, source!: String = "user") {
        this.id = id
        this.name = name
        this.description = description
        this.tools = tools
        this.acpEnabled = acpEnabled
        this.model = model
        this.budget = budget
        this.systemPrompt = systemPrompt
        this.source = source
    }
}

// 工具白名单是闭集：只接受 SaCode 既有能力名，未知名一律拒绝，避免角色自定义逃逸工具。
func subagentRoleToolSet(): HashSet<String> {
    let allowed = HashSet<String>()
    for (name in ["read", "glob", "grep", "write", "edit", "exec", "browser", "ssh", "database", "mcp", "skill",
        "scan"]) {
        allowed.add(name)
    }
    return allowed
}

func subagentRoleBuiltinIds(): HashSet<String> {
    let ids = HashSet<String>()
    for (name in ["explorer", "planner", "implementer", "reviewer"]) {
        ids.add(name)
    }
    return ids
}

func subagentRoleIdValid(id: String): Bool {
    if (id.size == 0 || id.size > 64) { return false }
    let bytes = id.toArray()
    if (bytes[0] == 45 || bytes[bytes.size - 1] == 45) { return false }
    for (b in bytes) {
        let lower = b >= 97 && b <= 122
        let digit = b >= 48 && b <= 57
        if (!(lower || digit || b == 45)) { return false }
    }
    return true
}

// 结构校验：不读磁盘、不查授权，只拒绝非法定义。错误码保持 subagent-role-* 前缀供 Host 归一。
func subagentRoleValidate(role: SubagentRole): Unit {
    if (!subagentRoleIdValid(role.id)) { throw Exception("subagent-role-invalid-id") }
    if (role.name.trimAscii().size == 0 || role.name.size > 120) { throw Exception("subagent-role-invalid-name") }
    if (role.description.size > 2000) { throw Exception("subagent-role-invalid-description") }
    if (role.systemPrompt.size > 32768) { throw Exception("subagent-role-invalid-prompt") }
    if (role.model.size > 128 || role.model.contains("\u{0}")) { throw Exception("subagent-role-invalid-model") }
    if (role.tools.size > 32) { throw Exception("subagent-role-invalid-tools") }
    let allowed = subagentRoleToolSet()
    let seen = HashSet<String>()
    for (tool in role.tools) {
        if (!allowed.contains(tool)) { throw Exception("subagent-role-unknown-tool") }
        if (!seen.add(tool)) { throw Exception("subagent-role-duplicate-tool") }
    }
    // 上限是结构性保护，不替代运行期授权上限；正整数下限防止“0 轮”这类空定义。
    if (role.budget.maxTurns < 1 || role.budget.maxTurns > 128 || role.budget.maxTokens < 1 ||
        role.budget.maxTokens > 2000000 || role.budget.maxTimeMs < 1 || role.budget.maxTimeMs > 3600000) {
        throw Exception("subagent-role-invalid-budget")
    }
    if (role.source != "builtin" && role.source != "user" && role.source != "project") {
        throw Exception("subagent-role-invalid-source")
    }
}

func subagentRoleBudgetJson(budget: SubagentBudget): JsonObject {
    let obj = JsonObject()
    obj.put("maxTurns", JsonInt(budget.maxTurns))
    obj.put("maxTokens", JsonInt(budget.maxTokens))
    obj.put("maxTimeMs", JsonInt(budget.maxTimeMs))
    return obj
}

func subagentRoleJson(role: SubagentRole, withSource: Bool): JsonObject {
    let obj = JsonObject()
    obj.put("id", JsonString(role.id))
    obj.put("name", JsonString(role.name))
    obj.put("description", JsonString(role.description))
    let tools = JsonArray()
    for (tool in role.tools) { tools.add(JsonString(tool)) }
    obj.put("tools", tools)
    obj.put("acpEnabled", JsonBool(role.acpEnabled))
    obj.put("model", JsonString(role.model))
    obj.put("budget", subagentRoleBudgetJson(role.budget))
    obj.put("systemPrompt", JsonString(role.systemPrompt))
    if (withSource) { obj.put("source", JsonString(role.source)) }
    return obj
}

func subagentRoleField(obj: JsonObject, key: String): JsonValue {
    return obj.get(key).getOrThrow()
}

// 严格读取：字段必须成完整闭集，未知字段拒绝，避免旧版本静默丢弃新语义。
func subagentRoleFromJson(value: JsonValue, source: String): SubagentRole {
    let obj = value.asObject()
    if (obj.size() != 8) { throw Exception("subagent-role-replay-rejected") }
    let budget = subagentRoleField(obj, "budget").asObject()
    if (budget.size() != 3) { throw Exception("subagent-role-replay-rejected") }
    let tools = ArrayList<String>()
    for (item in subagentRoleField(obj, "tools").asArray().getItems()) {
        tools.add(item.asString().getValue())
    }
    let role = SubagentRole(
        subagentRoleField(obj, "id").asString().getValue(),
        subagentRoleField(obj, "name").asString().getValue(),
        subagentRoleField(obj, "description").asString().getValue(),
        tools.toArray(),
        subagentRoleField(obj, "acpEnabled").asBool().getValue(),
        subagentRoleField(obj, "model").asString().getValue(),
        SubagentBudget(subagentRoleField(budget, "maxTurns").asInt().getValue(),
            subagentRoleField(budget, "maxTokens").asInt().getValue(),
            subagentRoleField(budget, "maxTimeMs").asInt().getValue()),
        subagentRoleField(obj, "systemPrompt").asString().getValue(),
        source: source)
    subagentRoleValidate(role)
    return role
}

// 用户级 + 项目级角色定义存储；每份文件一个作用域，revision 做 CAS。
// 读取按 builtin → user → project 合并，同 id 后者覆盖前者；内置 id 不允许被保存覆盖。
public class SubagentRoleStore {
    let root: String
    let path: String
    public let scope: String
    public let workspace: String

    public init(directory: String, scope: String, workspace: String) {
        if (scope != "user" && scope != "project") { throw Exception("subagent-role-bad-scope") }
        root = canonicalize(directory).toString()
        this.scope = scope
        this.workspace = if (scope == "project") { canonicalize(workspace).toString() } else { "" }
        if (!FileInfo(root).isDirectory() || (scope == "project" && !FileInfo(this.workspace).isDirectory())) {
            throw Exception("subagent-role-directory-unavailable")
        }
        let key = if (scope == "user") { "user" } else { sha256Hex(this.workspace.toArray()) }
        path = "${root}/subagent-roles-${key}.json"
    }

    public static func forScope(scope: String, workspace: String): SubagentRoleStore {
        return SubagentRoleStore(Path(GlobalAppearanceSettings.forUser().settingsPath()).parent.toString(), scope,
            workspace)
    }

    func readScoped(): JsonObject {
        if (!exists(path)) {
            let empty = JsonObject()
            empty.put("schemaVersion", JsonInt(1))
            empty.put("scope", JsonString(scope))
            empty.put("workspace", JsonString(workspace))
            empty.put("revision", JsonInt(0))
            empty.put("roles", JsonArray())
            return empty
        }
        let info = FileInfo(path)
        if (!info.isRegular() || info.size > 1048576 || canonicalize(path).parent.toString() != root) {
            throw Exception("subagent-role-path-rejected")
        }
        let text = String.fromUtf8(File.readFrom(path))
        let obj = JsonValue.fromStr(text).asObject()
        if (obj.size() != 5) { throw Exception("subagent-role-replay-rejected") }
        if (subagentRoleField(obj, "schemaVersion").asInt().getValue() != 1 ||
            subagentRoleField(obj, "scope").asString().getValue() != scope ||
            subagentRoleField(obj, "workspace").asString().getValue() != workspace) {
            throw Exception("subagent-role-scope-mismatch")
        }
        let revision = subagentRoleField(obj, "revision").asInt().getValue()
        if (revision < 1) { throw Exception("subagent-role-replay-rejected") }
        for (value in subagentRoleField(obj, "roles").asArray().getItems()) {
            subagentRoleFromJson(value, scope)
        }
        return obj
    }

    // 暴露给调用方的合并视图：内置角色在前，项目级覆盖用户级同 id 定义。
    public func load(): Array<SubagentRole> {
        let merged = HashMap<String, SubagentRole>()
        for (role in SubagentRoleStore.presets()) { merged[role.id] = role }
        for (value in subagentRoleField(readScoped(), "roles").asArray().getItems()) {
            let role = subagentRoleFromJson(value, scope)
            merged[role.id] = role
        }
        let ordered = ArrayList<SubagentRole>()
        for ((_, role) in merged) { ordered.add(role) }
        let result = ordered.toArray()
        sort(result, key: {item => item.id})
        return result
    }

    public func snapshotJson(): String {
        let obj = readScoped()
        let roles = JsonArray()
        for (value in subagentRoleField(obj, "roles").asArray().getItems()) { roles.add(value) }
        let out = JsonObject()
        out.put("schemaVersion", JsonInt(1))
        out.put("scope", JsonString(scope))
        out.put("workspace", JsonString(workspace))
        out.put("revision", JsonInt(subagentRoleField(obj, "revision").asInt().getValue()))
        out.put("roles", roles)
        return out.toString()
    }

    // 保存是 upsert：id 已存在则替换，否则追加；source 强制为当前作用域。
    // 内置 id 直接拒绝——要定制必须换新 id（复制语义），避免全局预设被就地改写。
    public func save(role: SubagentRole, expectedRevision: Int64): String {
        subagentRoleValidate(role)
        if (subagentRoleBuiltinIds().contains(role.id)) { throw Exception("subagent-role-builtin-readonly") }
        if (expectedRevision < 0) { throw Exception("subagent-role-bad-revision") }
        let lease = WriteLease(path)
        if (!lease.takeoverIfStale()) { throw Exception("subagent-role-busy") }
        var temporary = ""
        try {
            let obj = readScoped()
            let revision = subagentRoleField(obj, "revision").asInt().getValue()
            if (revision != expectedRevision) { throw Exception("subagent-role-revision-conflict") }
            let written = JsonArray()
            var found = false
            for (value in subagentRoleField(obj, "roles").asArray().getItems()) {
                if (value.asObject().get("id").getOrThrow().asString().getValue() == role.id) {
                    found = true
                    written.add(subagentRoleJson(role, false))
                } else {
                    written.add(value)
                }
            }
            if (!found) { written.add(subagentRoleJson(role, false)) }
            if (written.size() > 200) { throw Exception("subagent-role-capacity") }
            obj.put("roles", written)
            obj.put("revision", JsonInt(revision + 1))
            let text = obj.toString()
            if (text.size > 1048576) { throw Exception("subagent-role-capacity") }
            let file = File.createTemp(Path(root))
            temporary = file.info.path.toString()
            file.close()
            File.writeTo(Path(temporary), text.toArray())
            if (!lease.protects(path)) { throw Exception("subagent-role-owner-unknown") }
            nativeReplaceFile(temporary, path)
            return snapshotJson()
        } finally {
            if (temporary.size > 0) {
                try { removeIfExists(temporary, recursive: false) } catch (_: Exception) {}
            }
            lease.release()
        }
    }

    public func remove(id: String, expectedRevision: Int64): String {
        if (subagentRoleBuiltinIds().contains(id)) { throw Exception("subagent-role-builtin-readonly") }
        if (!subagentRoleIdValid(id) || expectedRevision < 0) { throw Exception("subagent-role-bad-arguments") }
        let lease = WriteLease(path)
        if (!lease.takeoverIfStale()) { throw Exception("subagent-role-busy") }
        try {
            let obj = readScoped()
            let revision = subagentRoleField(obj, "revision").asInt().getValue()
            if (revision != expectedRevision) { throw Exception("subagent-role-revision-conflict") }
            let kept = JsonArray()
            var found = false
            for (value in subagentRoleField(obj, "roles").asArray().getItems()) {
                if (value.asObject().get("id").getOrThrow().asString().getValue() == id) {
                    found = true
                } else {
                    kept.add(value)
                }
            }
            if (!found) { throw Exception("subagent-role-not-found") }
            obj.put("roles", kept)
            obj.put("revision", JsonInt(revision + 1))
            let text = obj.toString()
            if (text.size > 1048576) { throw Exception("subagent-role-capacity") }
            let file = File.createTemp(Path(root))
            let temporary = file.info.path.toString()
            file.close()
            try {
                File.writeTo(Path(temporary), text.toArray())
                if (!lease.protects(path)) { throw Exception("subagent-role-owner-unknown") }
                nativeReplaceFile(temporary, path)
            } finally {
                try { removeIfExists(temporary, recursive: false) } catch (_: Exception) {}
            }
            return snapshotJson()
        } finally { lease.release() }
    }

    // 四个预设：工具集是闭集白名单；acpEnabled 只表示“允许申请”，不是已批准。
    // model 留空表示继承当前选择，避免在定义里硬编码未知模型 id。
    public static func presets(): Array<SubagentRole> {
        let roles = ArrayList<SubagentRole>()
        roles.add(SubagentRole("explorer", "探索者", "只读检索与阅读代码，适合并行搜索，不修改文件。",
            ["read", "glob", "grep"], true, "",
            SubagentBudget(24, 200000, 600000),
            "你是只读探索子代理。只使用 read/glob/grep 收集事实并引用路径；不得修改文件、不得执行命令、不得声称已写入。遇到权限不足如实报告。",
            source: "builtin"))
        roles.add(SubagentRole("planner", "规划者", "只读分析并产出方案与计划，不改代码。",
            ["read", "glob", "grep"], true, "",
            SubagentBudget(16, 200000, 600000),
            "你是只读规划子代理。产出可执行步骤、风险与验收点；不得修改文件或执行命令；计划不等于授权。",
            source: "builtin"))
        roles.add(SubagentRole("implementer", "实现者", "落地代码修改并运行命令，需要既有审批链。",
            ["read", "glob", "grep", "write", "edit", "exec"], true, "",
            SubagentBudget(48, 600000, 1800000),
            "你是实现子代理。可读写文件并在授权范围内运行命令；每次写入与执行仍受既有审批约束，不得自行扩大权限，失败与未知结果如实上报。",
            source: "builtin"))
        roles.add(SubagentRole("reviewer", "审查者", "只读审查与安全扫描，给出证据与缺口。",
            ["read", "glob", "grep", "scan"], true, "",
            SubagentBudget(24, 300000, 900000),
            "你是只读审查子代理。用 read/glob/grep/scan 取证，区分事实与推断；零发现不等于无风险，不改文件、不执行命令。",
            source: "builtin"))
        return roles.toArray()
    }
}
