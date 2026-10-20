package host

import core.*
import std.collection.ArrayList
import std.collection.HashMap
import std.fs.*
import std.sort.*
import std.time.*
import stdx.encoding.json.*

// F19 导入宿主面。桌面主进程负责选择文件与解析第三方格式；本模块只接收
// 「规范化候选 / 配置包原文」，重新计算指纹与去重，生成计划并逐条写入。
//
// 安全边界：
// - 不接收任意文件路径，pick-file 只返回选择器描述；
// - 配置包先看 kind，secret-bundle 在任何读写前整包拒绝；
// - 只写会话标题/导入来源/消息、知识文档、供应商与自定义模型，不写工具、审批、
//   执行、goal、queue 事件，也不读写任何凭据值；
// - 报告只含截断标题、状态、原因码与目标 id，不含正文。
//
// 泵模型：apply 每次最多推进一个不可分割条目；取消只在条目之间生效，
// 已提交条目保留。作业状态只存在本进程内，不宣称重启恢复。

let IMPORT_REPORT_FORMAT = "sacode-import-report/1"
let IMPORT_SESSION_FORMAT = "sacode-import/session/1"
let IMPORT_MAX_CONVERSATIONS: Int64 = 2000
let IMPORT_MAX_KNOWLEDGE: Int64 = 200
let IMPORT_MAX_MESSAGES: Int64 = 10000
let IMPORT_MAX_MESSAGE_BYTES: Int64 = 1048576
let IMPORT_MAX_KNOWLEDGE_BYTES: Int64 = 65536
let IMPORT_MAX_CONFIG_BYTES: Int64 = 8388608
let IMPORT_MAX_TITLE_BYTES: Int64 = 512
let IMPORT_MAX_DISPLAY_BYTES: Int64 = 200
let IMPORT_MAX_REPORT_ITEMS: Int64 = 200
let IMPORT_STATE_TTL_MS: Int64 = 1800000

func importNowMs(): Int64 {
    return DateTime.nowUTC().toUnixTimeStamp().toMilliseconds()
}

func importNowText(): String {
    return DateTime.nowUTC().format("yyyy-MM-dd HH:mm:ss") + "Z"
}

// 按 UTF-8 字节截断，但绝不把多字节字符切成半个。
func importTruncateBytes(text: String, maxBytes: Int64): String {
    if (text.size <= maxBytes) {
        return text
    }
    let bytes = text.toArray()
    var n = maxBytes
    while (n > 0 && bytes[n] >= 0x80 && bytes[n] < 0xC0) {
        n -= 1
    }
    return String.fromUtf8(bytes[0..n])
}

func importValidTitle(title: String): Bool {
    if (title.size == 0 || title.size > IMPORT_MAX_TITLE_BYTES) {
        return false
    }
    if (title.trimAscii().size == 0) {
        return false
    }
    for (b in title.toArray()) {
        if (b < 32 || b == 127) {
            return false
        }
    }
    return true
}

func importTerminal(status: String): Bool {
    return status == "completed" || status == "partial" || status == "cancelled" || status == "failed"
}

func importKindOfSource(sourceId: String): String {
    if (sourceId == "chatgpt-export") {
        return "conversation"
    }
    if (sourceId == "sacode-migrate") {
        return "config"
    }
    if (sourceId == "text-file") {
        return "knowledge"
    }
    return ""
}

func importRequiredString(obj: JsonObject, key: String): String {
    let value = obj.get(key).getOrThrow()
    try {
        return value.asString().getValue()
    } catch (_: Exception) {
        throw Exception("import-bad-args")
    }
}

func importOptionalString(obj: JsonObject, key: String): String {
    if (let Some(value) <- obj.get(key)) {
        try {
            return value.asString().getValue()
        } catch (_: Exception) {
            throw Exception("import-bad-args")
        }
    }
    return ""
}

func importRequiredObject(obj: JsonObject, key: String): JsonObject {
    let value = obj.get(key).getOrThrow()
    try {
        return value.asObject()
    } catch (_: Exception) {
        throw Exception("import-bad-args")
    }
}

func importRequiredArray(obj: JsonObject, key: String): JsonArray {
    let value = obj.get(key).getOrThrow()
    try {
        return value.asArray()
    } catch (_: Exception) {
        throw Exception("import-bad-args")
    }
}

func importOptionalInt(obj: JsonObject, key: String, fallback: Int64): Int64 {
    if (let Some(value) <- obj.get(key)) {
        try {
            return value.asInt().getValue()
        } catch (_: Exception) {
            throw Exception("import-bad-args")
        }
    }
    return fallback
}

// 只把闭集原因码交给调用方；系统异常正文（可能带路径）不越过这条线。
func importReasonOf(e: Exception): String {
    let m = e.message
    if (m.startsWith("import-")) {
        return m
    }
    if (m == "migration-bad-format" || m == "migration-bad-schema" || m == "migration-bad-checksum" || m ==
        "migration-bad-kind" || m == "migration-malformed") {
        return "import-invalid-candidate"
    }
    if (m == "knowledge-revision-conflict" || m == "knowledge-busy" || m == "settings-conflict" || m ==
        "provider-settings-busy") {
        return "import-revision-conflict"
    }
    if (m == "knowledge-capacity") {
        return "import-target-limit"
    }
    if (m == "knowledge-bad-document" || m == "settings-rejected") {
        return "import-invalid-candidate"
    }
    if (m == "bad-session-title") {
        return "import-invalid-candidate"
    }
    if (m == "session-create-flush-failed") {
        return "import-persistence-failed"
    }
    return "import-persistence-failed"
}

func importRpcCode(reason: String): Int64 {
    if (reason == "import-plan-stale" || reason == "import-request-conflict" || reason == "import-revision-conflict") {
        return -32031
    }
    return -32003
}

class ImportMessage {
    let role: String
    let text: String
    init(role: String, text: String) {
        this.role = role
        this.text = text
    }
}

class ImportCandidate {
    let index: Int64
    let candidateId: String
    let sourceKey: String
    let sourceTitle: String
    let messages: Array<ImportMessage>
    let content: String
    let skippedMessages: Int64
    let textBytes: Int64
    let invalidReason: String

    init(index: Int64, candidateId: String, sourceKey: String, sourceTitle: String, messages: Array<ImportMessage>,
        content: String, skippedMessages: Int64, textBytes: Int64, invalidReason: String) {
        this.index = index
        this.candidateId = candidateId
        this.sourceKey = sourceKey
        this.sourceTitle = sourceTitle
        this.messages = messages
        this.content = content
        this.skippedMessages = skippedMessages
        this.textBytes = textBytes
        this.invalidReason = invalidReason
    }
}

class ImportIssue {
    let index: Int64
    let code: String
    let message: String

    init(index: Int64, code: String, message: String) {
        this.index = index
        this.code = code
        this.message = message
    }
}

class ImportMappingState {
    let titleMode: String
    let displayTitle: String
    let prefix: String
    let workspaceMode: String
    let conflictPolicy: String
    let updatePolicy: String
    let credentialBindings: HashMap<String, String>

    init(titleMode: String, displayTitle: String, prefix: String, workspaceMode: String, conflictPolicy: String,
        updatePolicy: String, credentialBindings: HashMap<String, String>) {
        this.titleMode = titleMode
        this.displayTitle = displayTitle
        this.prefix = prefix
        this.workspaceMode = workspaceMode
        this.conflictPolicy = conflictPolicy
        this.updatePolicy = updatePolicy
        this.credentialBindings = credentialBindings
    }
}

class ImportPreviewState {
    let token: String
    let sourceId: String
    let kind: String
    let mapping: ImportMappingState
    let mappingJson: String
    let scope: String
    let workspace: String
    let candidates: Array<ImportCandidate>
    let configText: String
    let issues: Array<ImportIssue>
    let createdAtMs: Int64

    init(token: String, sourceId: String, kind: String, mapping: ImportMappingState, mappingJson: String, scope: String,
        workspace: String, candidates: Array<ImportCandidate>, configText: String, issues: Array<ImportIssue>,
        createdAtMs: Int64) {
        this.token = token
        this.sourceId = sourceId
        this.kind = kind
        this.mapping = mapping
        this.mappingJson = mappingJson
        this.scope = scope
        this.workspace = workspace
        this.candidates = candidates
        this.configText = configText
        this.issues = issues
        this.createdAtMs = createdAtMs
    }
}

class ImportPlanItemState {
    let itemId: String
    let index: Int64
    let displayTitle: String
    let action: String
    let dedupeKey: String
    var messages: Int64 = 0
    var skippedMessages: Int64 = 0
    var reason: String = ""
    var candidateIndex: Int64 = -1
    var targetDocId: String = ""
    var configKind: String = ""
    var configId: String = ""
    var configJson: String = ""

    init(itemId: String, index: Int64, displayTitle: String, action: String, dedupeKey: String) {
        this.itemId = itemId
        this.index = index
        this.displayTitle = displayTitle
        this.action = action
        this.dedupeKey = dedupeKey
    }
}

class ImportCounts {
    let total: Int64
    let newCount: Int64
    let duplicate: Int64
    let conflict: Int64
    let invalid: Int64
    let skipped: Int64

    init(total: Int64, newCount: Int64, duplicate: Int64, conflict: Int64, invalid: Int64, skipped: Int64) {
        this.total = total
        this.newCount = newCount
        this.duplicate = duplicate
        this.conflict = conflict
        this.invalid = invalid
        this.skipped = skipped
    }

    func toJson(): String {
        return "{\"total\":${total},\"new\":${newCount},\"duplicate\":${duplicate}," +
            "\"conflict\":${conflict},\"invalid\":${invalid},\"skipped\":${skipped}}"
    }
}

class ImportBuiltPlan {
    let items: Array<ImportPlanItemState>
    let counts: ImportCounts
    let issues: Array<ImportIssue>
    let planHash: String

    init(items: Array<ImportPlanItemState>, counts: ImportCounts, issues: Array<ImportIssue>, planHash: String) {
        this.items = items
        this.counts = counts
        this.issues = issues
        this.planHash = planHash
    }
}

class ImportPlanState {
    let planHash: String
    let ownerSessionId: String
    let preview: ImportPreviewState
    let built: ImportBuiltPlan
    let createdAtMs: Int64

    init(planHash: String, ownerSessionId: String, preview: ImportPreviewState, built: ImportBuiltPlan,
        createdAtMs: Int64) {
        this.planHash = planHash
        this.ownerSessionId = ownerSessionId
        this.preview = preview
        this.built = built
        this.createdAtMs = createdAtMs
    }
}

class ImportConfirmationState {
    let planHash: String
    let decisions: HashMap<String, String>
    let selected: Array<String>
    let createdAtMs: Int64

    init(planHash: String, decisions: HashMap<String, String>, selected: Array<String>, createdAtMs: Int64) {
        this.planHash = planHash
        this.decisions = decisions
        this.selected = selected
        this.createdAtMs = createdAtMs
    }
}

class ImportJobItem {
    let itemId: String
    let index: Int64
    let displayTitle: String
    let action: String
    var status: String
    var code: String = ""
    var targetKind: String = ""
    var targetId: String = ""
    let candidateIndex: Int64
    let configKind: String
    let configId: String
    let configJson: String

    init(itemId: String, index: Int64, displayTitle: String, action: String, status: String, candidateIndex: Int64,
        configKind: String, configId: String, configJson: String) {
        this.itemId = itemId
        this.index = index
        this.displayTitle = displayTitle
        this.action = action
        this.status = status
        this.candidateIndex = candidateIndex
        this.configKind = configKind
        this.configId = configId
        this.configJson = configJson
    }
}

class ImportJobState {
    let jobId: String
    let requestId: String
    let ownerSessionId: String
    let planHash: String
    let preview: ImportPreviewState
    let items: Array<ImportJobItem>
    let issues: Array<ImportIssue>
    var status: String
    var createdAt: String
    var updatedAt: String
    var createdAtMs: Int64
    var committed: Int64 = 0
    var duplicates: Int64 = 0
    var failed: Int64 = 0
    var remaining: Int64
    let total: Int64
    var currentItemId: String = ""
    var currentTitle: String = ""

    init(jobId: String, requestId: String, ownerSessionId: String, planHash: String, preview: ImportPreviewState,
        items: Array<ImportJobItem>, issues: Array<ImportIssue>, status: String, createdAt: String, updatedAt: String,
        createdAtMs: Int64, total: Int64, remaining: Int64) {
        this.jobId = jobId
        this.requestId = requestId
        this.ownerSessionId = ownerSessionId
        this.planHash = planHash
        this.preview = preview
        this.items = items
        this.issues = issues
        this.status = status
        this.createdAt = createdAt
        this.updatedAt = updatedAt
        this.createdAtMs = createdAtMs
        this.total = total
        this.remaining = remaining
    }
}

class ImportedSessionRecord {
    let sourceId: String
    let sourceKey: String
    let fingerprint: String

    init(sourceId: String, sourceKey: String, fingerprint: String) {
        this.sourceId = sourceId
        this.sourceKey = sourceKey
        this.fingerprint = fingerprint
    }
}

func importMappingFrom(kind: String, obj: JsonObject): ImportMappingState {
    var titleMode = importOptionalString(obj, "titleMode")
    var displayTitle = importOptionalString(obj, "displayTitle")
    var prefix = importOptionalString(obj, "prefix")
    if (prefix.size == 0) {
        prefix = importOptionalString(obj, "titlePrefix")
    }
    var workspaceMode = importOptionalString(obj, "workspaceMode")
    var conflictPolicy = importOptionalString(obj, "conflictPolicy")
    var updatePolicy = importOptionalString(obj, "updatePolicy")
    if (displayTitle.size > IMPORT_MAX_TITLE_BYTES || prefix.size > IMPORT_MAX_TITLE_BYTES) {
        throw Exception("import-bad-args")
    }
    if (kind == "conversation") {
        if (titleMode.size == 0) {
            titleMode = "keep"
        }
        if (titleMode != "keep" && titleMode != "custom" && titleMode != "prefix") {
            throw Exception("import-bad-args")
        }
        if (workspaceMode.size == 0) {
            workspaceMode = "none"
        }
        if (workspaceMode != "none" && workspaceMode != "current") {
            throw Exception("import-bad-args")
        }
    } else if (kind == "knowledge") {
        if (titleMode.size == 0 || titleMode == "keep") {
            titleMode = "source"
        }
        if (titleMode != "source" && titleMode != "filename" && titleMode != "custom" && titleMode != "prefix") {
            throw Exception("import-bad-args")
        }
        workspaceMode = "none"
    } else {
        titleMode = ""
        workspaceMode = "none"
    }
    if (conflictPolicy.size == 0) {
        conflictPolicy = "skip"
    }
    if (conflictPolicy != "skip" && conflictPolicy != "new-copy") {
        throw Exception("import-bad-args")
    }
    if (kind == "config") {
        if (updatePolicy.size == 0) {
            updatePolicy = "new-only"
        }
        if (updatePolicy != "new-only" && updatePolicy != "allow-updates") {
            throw Exception("import-bad-args")
        }
    } else {
        updatePolicy = "new-only"
    }
    let bindings = HashMap<String, String>()
    if (let Some(value) <- obj.get("credentialBindings")) {
        var bindObj: ?JsonObject = None
        try {
            bindObj = Some(value.asObject())
        } catch (_: Exception) {
            throw Exception("import-bad-args")
        }
        if (let Some(fields) <- bindObj) {
            let store = CredentialStore.forUser()
            for (key in fields.getFields().keys()) {
                if (key.size == 0 || key.size > 64) {
                    throw Exception("import-bad-args")
                }
                let ref = fields.get(key).getOrThrow().asString().getValue()
                if (!isValidCredentialRef(ref)) {
                    throw Exception("import-bad-args")
                }
                if (!store.describe(ref).configured) {
                    throw Exception("import-bad-args")
                }
                bindings.add(key, ref)
            }
        }
    }
    return ImportMappingState(titleMode, displayTitle, prefix, workspaceMode, conflictPolicy, updatePolicy, bindings)
}

func importMappingCanonical(mapping: ImportMappingState): String {
    let obj = JsonObject()
    obj.put("titleMode", JsonString(mapping.titleMode))
    obj.put("displayTitle", JsonString(mapping.displayTitle))
    obj.put("prefix", JsonString(mapping.prefix))
    obj.put("workspaceMode", JsonString(mapping.workspaceMode))
    obj.put("conflictPolicy", JsonString(mapping.conflictPolicy))
    obj.put("updatePolicy", JsonString(mapping.updatePolicy))
    let keys = ArrayList<String>()
    for (key in mapping.credentialBindings.keys()) {
        keys.add(key)
    }
    sort(keys)
    let bindings = JsonObject()
    for (key in keys) {
        bindings.put(key, JsonString(mapping.credentialBindings.get(key).getOrThrow()))
    }
    obj.put("credentialBindings", bindings)
    return obj.toString()
}

func importFileName(sourceKey: String): String {
    let bytes = sourceKey.toArray()
    var start: Int64 = 0
    var i: Int64 = 0
    while (i < bytes.size) {
        if (bytes[i] == 47 || bytes[i] == 92) {
            start = i + 1
        }
        i += 1
    }
    if (start >= bytes.size) {
        return ""
    }
    return String.fromUtf8(bytes[start..bytes.size])
}

func importMappedConversationTitle(mapping: ImportMappingState, sourceTitle: String): String {
    var title = sourceTitle
    if (mapping.titleMode == "custom") {
        title = mapping.displayTitle
    } else if (mapping.titleMode == "prefix") {
        title = mapping.prefix + sourceTitle
    }
    if (title.trimAscii().size == 0) {
        title = "导入的会话"
    }
    return importTruncateBytes(title, IMPORT_MAX_TITLE_BYTES)
}

func importMappedKnowledgeTitle(mapping: ImportMappingState, sourceTitle: String, sourceKey: String): String {
    var title = sourceTitle
    if (title.size == 0) {
        title = importFileName(sourceKey)
    }
    if (mapping.titleMode == "filename") {
        title = importFileName(sourceKey)
    } else if (mapping.titleMode == "custom") {
        title = mapping.displayTitle
    } else if (mapping.titleMode == "prefix") {
        title = mapping.prefix + title
    }
    if (title.trimAscii().size == 0) {
        title = "导入的知识"
    }
    return importTruncateBytes(title, IMPORT_MAX_TITLE_BYTES)
}

func importConversationFingerprint(candidate: ImportCandidate): String {
    var material = candidate.sourceKey + "\u{0}" + candidate.sourceTitle + "\u{0}"
    for (message in candidate.messages) {
        material += message.role + "\u{0}" + message.text + "\u{0}"
    }
    return sha256Hex(material.toArray())
}

func importKnowledgeFingerprint(candidate: ImportCandidate): String {
    return sha256Hex(candidate.content.toArray())
}

func importConversationDedupeKey(sourceId: String, candidate: ImportCandidate, fingerprint: String): String {
    return sha256Hex(("conversation" + "\u{0}" + sourceId + "\u{0}" + candidate
        .sourceKey + "\u{0}" + fingerprint)
        .toArray())
}

func importKnowledgeDedupeKey(sourceId: String, candidate: ImportCandidate, fingerprint: String): String {
    return sha256Hex(("knowledge" + "\u{0}" + sourceId + "\u{0}" + candidate.sourceKey + "\u{0}" + fingerprint)
        .toArray())
}

// 知识文档 id 故意不含指纹：同来源键、正文变化时落到同一个 id，才能在计划阶段
// 识别成 conflict 而不是悄悄多出一份文档。冲突后“作为新副本”才追加指纹后缀。
func importKnowledgeBaseId(sourceId: String, sourceKey: String): String {
    let h = sha256Hex(("knowledge" + "\u{0}" + sourceId + "\u{0}" + sourceKey).toArray())
    return "imp-" + h[0..16]
}

func importIssuesJson(issues: Array<ImportIssue>): JsonArray {
    let arr = JsonArray()
    for (issue in issues) {
        let obj = JsonObject()
        obj.put("index", JsonInt(issue.index))
        obj.put("code", JsonString(issue.code))
        obj.put("message", JsonString(importTruncateBytes(issue.message, 300)))
        arr.add(obj)
    }
    return arr
}

func importPlanItemsJson(items: Array<ImportPlanItemState>): JsonArray {
    let arr = JsonArray()
    for (item in items) {
        let obj = JsonObject()
        obj.put("itemId", JsonString(item.itemId))
        obj.put("index", JsonInt(item.index))
        obj.put("displayTitle", JsonString(item.displayTitle))
        obj.put("action", JsonString(item.action))
        obj.put("dedupeKey", JsonString(item.dedupeKey))
        let detail = JsonObject()
        if (item.messages > 0) {
            detail.put("messages", JsonInt(item.messages))
        }
        if (item.skippedMessages > 0) {
            detail.put("skippedMessages", JsonInt(item.skippedMessages))
        }
        if (item.reason.size > 0) {
            detail.put("reason", JsonString(item.reason))
        }
        obj.put("detail", detail)
        arr.add(obj)
    }
    return arr
}

func importSourceDescriptor(id: String): String {
    let obj = JsonObject()
    obj.put("id", JsonString(id))
    if (id == "chatgpt-export") {
        obj.put("displayName", JsonString("ChatGPT 导出 JSON"))
        let kinds = JsonArray()
        kinds.add(JsonString("conversation"))
        obj.put("kinds", kinds)
        obj.put("formatVersion", JsonString("synthetic-1"))
        obj.put("compatibility", JsonString("synthetic-only"))
        obj.put("requiresFile", JsonBool(true))
        let limits = JsonObject()
        limits.put("bytes", JsonInt(16777216))
        limits.put("items", JsonInt(IMPORT_MAX_CONVERSATIONS))
        limits.put("nodes", JsonInt(20000))
        limits.put("messages", JsonInt(IMPORT_MAX_MESSAGES))
        limits.put("textBytes", JsonInt(IMPORT_MAX_MESSAGE_BYTES))
        obj.put("limits", limits)
        let mapping = JsonArray()
        mapping.add(JsonString("title"))
        obj.put("mapping", mapping)
        let notes = JsonArray()
        notes.add(JsonString("仅支持结构化 JSON 数组；真实导出格式尚未验收"))
        notes.add(JsonString("不支持分享网页或 ZIP"))
        obj.put("notes", notes)
    } else if (id == "sacode-migrate") {
        obj.put("displayName", JsonString("SaCode 迁移包"))
        let kinds = JsonArray()
        kinds.add(JsonString("config"))
        obj.put("kinds", kinds)
        obj.put("formatVersion", JsonString("sacode-migrate/1"))
        obj.put("compatibility", JsonString("self"))
        obj.put("requiresFile", JsonBool(true))
        let limits = JsonObject()
        limits.put("bytes", JsonInt(IMPORT_MAX_CONFIG_BYTES))
        obj.put("limits", limits)
        let mapping = JsonArray()
        mapping.add(JsonString("updatePolicy"))
        obj.put("mapping", mapping)
        let notes = JsonArray()
        notes.add(JsonString("仅接受 kind=config；secret-bundle 整包拒绝"))
        notes.add(JsonString("不读取密钥值；导入后需配置凭据并启用"))
        obj.put("notes", notes)
    } else {
        obj.put("displayName", JsonString("Markdown/TXT 知识文件"))
        let kinds = JsonArray()
        kinds.add(JsonString("knowledge"))
        obj.put("kinds", kinds)
        obj.put("formatVersion", JsonString("text"))
        obj.put("compatibility", JsonString("text-only"))
        obj.put("requiresFile", JsonBool(true))
        let limits = JsonObject()
        limits.put("bytes", JsonInt(IMPORT_MAX_KNOWLEDGE_BYTES))
        limits.put("items", JsonInt(IMPORT_MAX_KNOWLEDGE))
        obj.put("limits", limits)
        let mapping = JsonArray()
        mapping.add(JsonString("title"))
        mapping.add(JsonString("scope"))
        obj.put("mapping", mapping)
        let notes = JsonArray()
        notes.add(JsonString("文本文件，不解析 HTML/脚本"))
        notes.add(JsonString("按一次快照批量写入；单条非法不拖垮整批"))
        obj.put("notes", notes)
    }
    return obj.toString()
}

public class ImportRpc {
    let previews = HashMap<String, ImportPreviewState>()
    let plans = HashMap<String, ImportPlanState>()
    let confirmations = HashMap<String, ImportConfirmationState>()
    let jobs = HashMap<String, ImportJobState>()
    let activeJobs = HashMap<String, String>()
    let requestJobs = HashMap<String, String>()
    var seq: Int64 = 0

    public init() {}

    // 方法名写成字面量链：与 worktree/knowledge 同形，门禁按字面量取分派集。
    public func isMethod(method: String): Bool {
        return method == "import/sources" || method == "import/pick-file" || method == "import/preview" || method ==
            "import/plan" || method == "import/confirm" || method == "import/apply" || method == "import/describe" ||
            method == "import/cancel"
    }

    // apply 会写会话/知识/注册表；cancel 只改作业状态但同属写面。
    public func isWriteMethod(method: String): Bool {
        return method == "import/apply" || method == "import/cancel"
    }

    public func handle(method: String, body: String, idText: String, activeId: String, shared: SessionLog): Bool {
        if (!isMethod(method)) {
            return false
        }
        try {
            let params = JsonValue.fromStr(paramsTextOf(body)).asObject()
            if (importRequiredString(params, "sessionId") != activeId) {
                throw Exception("import-session-changed")
            }
            if (method == "import/sources") {
                emit(okFrame(idText, this.sourcesResult()))
            } else if (method == "import/pick-file") {
                emit(okFrame(idText, this.pickFileResult(importRequiredString(params, "sourceId"))))
            } else if (method == "import/preview") {
                emit(okFrame(idText, this.previewResult(params, activeId, shared)))
            } else if (method == "import/plan") {
                emit(okFrame(idText, this.planResult(params, activeId, shared)))
            } else if (method == "import/confirm") {
                emit(okFrame(idText, this.confirmResult(params, activeId)))
            } else if (method == "import/apply") {
                emit(okFrame(idText, this.applyResult(params, activeId, shared)))
            } else if (method == "import/describe") {
                emit(okFrame(idText, this.describeResult(params, activeId)))
            } else {
                emit(okFrame(idText, this.cancelResult(params, activeId)))
            }
        } catch (e: Exception) {
            let reason = importReasonOf(e)
            emit(errFrame(idText, importRpcCode(reason), reason))
        }
        return true
    }

    func sourcesResult(): String {
        let sources = JsonArray()
        sources.add(JsonValue.fromStr(importSourceDescriptor("chatgpt-export")).asObject())
        sources.add(JsonValue.fromStr(importSourceDescriptor("sacode-migrate")).asObject())
        sources.add(JsonValue.fromStr(importSourceDescriptor("text-file")).asObject())
        let obj = JsonObject()
        obj.put("sources", sources)
        return obj.toString()
    }

    func pickFileResult(sourceId: String): String {
        let kind = importKindOfSource(sourceId)
        if (kind.size == 0) {
            throw Exception("import-unsupported-source")
        }
        let obj = JsonObject()
        obj.put("sourceId", JsonString(sourceId))
        obj.put("kind", JsonString(kind))
        obj.put("requiresDesktopDialog", JsonBool(true))
        obj.put("hostReadsFilePath", JsonBool(false))
        let extensions = JsonArray()
        if (sourceId == "chatgpt-export" || sourceId == "sacode-migrate") {
            extensions.add(JsonString(".json"))
        } else {
            extensions.add(JsonString(".md"))
            extensions.add(JsonString(".markdown"))
            extensions.add(JsonString(".txt"))
        }
        obj.put("extensions", extensions)
        if (sourceId == "chatgpt-export") {
            obj.put("maxBytes", JsonInt(16777216))
        } else if (sourceId == "sacode-migrate") {
            obj.put("maxBytes", JsonInt(IMPORT_MAX_CONFIG_BYTES))
        } else {
            obj.put("maxBytes", JsonInt(IMPORT_MAX_KNOWLEDGE_BYTES))
        }
        obj.put("note", JsonString("文件选择与解析在桌面主进程完成；Host 不接收文件路径"))
        return obj.toString()
    }

    func previewResult(params: JsonObject, activeId: String, shared: SessionLog): String {
        this.prune(importNowMs())
        let preview = this.parsePreview(params, shared)
        this.previews.add(preview.token, preview)
        let built = this.buildPlan(preview, activeId, shared)
        let obj = JsonObject()
        obj.put("previewToken", JsonString(preview.token))
        obj.put("sourceId", JsonString(preview.sourceId))
        obj.put("kind", JsonString(preview.kind))
        let target = JsonObject()
        target.put("scope", JsonString(preview.scope))
        obj.put("target", target)
        let summary = JsonObject()
        if (preview.kind == "config") {
            summary.put("candidates", JsonInt(built.items.size))
        } else {
            summary.put("candidates", JsonInt(preview.candidates.size))
        }
        summary.put("duplicates", JsonInt(built.counts.duplicate))
        summary.put("conflicts", JsonInt(built.counts.conflict))
        summary.put("issues", JsonInt(built.issues.size))
        obj.put("summary", summary)
        let items = JsonArray()
        if (preview.kind == "config") {
            for (item in built.items) {
                let entry = JsonObject()
                entry.put("candidateId", JsonString(item.itemId))
                entry.put("index", JsonInt(item.index))
                entry.put("displayTitle", JsonString(item.displayTitle))
                entry.put("messages", JsonInt(0))
                entry.put("textBytes", JsonInt(0))
                entry.put("action", JsonString(item.action))
                if (item.reason.size > 0) {
                    entry.put("reason", JsonString(item.reason))
                }
                items.add(entry)
            }
        } else {
            for (candidate in preview.candidates) {
                let entry = JsonObject()
                entry.put("candidateId", JsonString(candidate.candidateId))
                entry.put("index", JsonInt(candidate.index))
                var action = "invalid"
                var reason = candidate.invalidReason
                for (item in built.items) {
                    if (item.candidateIndex == candidate.index) {
                        action = item.action
                        reason = item.reason
                    }
                }
                var display = candidate.sourceTitle
                if (preview.kind == "conversation") {
                    display = importMappedConversationTitle(preview.mapping, candidate.sourceTitle)
                } else {
                    display = importMappedKnowledgeTitle(preview.mapping, candidate.sourceTitle, candidate.sourceKey)
                }
                entry.put("displayTitle", JsonString(importTruncateBytes(display, IMPORT_MAX_DISPLAY_BYTES)))
                entry.put("messages", JsonInt(candidate.messages.size))
                entry.put("textBytes", JsonInt(candidate.textBytes))
                entry.put("action", JsonString(action))
                if (reason.size > 0) {
                    entry.put("reason", JsonString(reason))
                }
                items.add(entry)
            }
        }
        obj.put("items", items)
        obj.put("issues", importIssuesJson(built.issues))
        obj.put("requiresConfirmation", JsonBool(true))
        return obj.toString()
    }

    func planResult(params: JsonObject, activeId: String, shared: SessionLog): String {
        this.prune(importNowMs())
        let token = importRequiredString(params, "previewToken")
        var preview: ?ImportPreviewState = None
        if (let Some(found) <- this.previews.get(token)) {
            preview = Some(found)
        }
        if (let Some(state) <- preview) {
            if (let Some(value) <- params.get("mapping")) {
                var mappingObj: ?JsonObject = None
                try {
                    mappingObj = Some(value.asObject())
                } catch (_: Exception) {
                    throw Exception("import-bad-args")
                }
                if (let Some(m) <- mappingObj) {
                    let mapping = importMappingFrom(state.kind, m)
                    if (importMappingCanonical(mapping) != state.mappingJson) {
                        throw Exception("import-plan-stale")
                    }
                }
            }
            if (let Some(value) <- params.get("target")) {
                var targetObj: ?JsonObject = None
                try {
                    targetObj = Some(value.asObject())
                } catch (_: Exception) {
                    throw Exception("import-bad-args")
                }
                if (let Some(t) <- targetObj) {
                    if (importRequiredString(t, "scope") != state.scope) {
                        throw Exception("import-plan-stale")
                    }
                }
            }
            let built = this.buildPlan(state, activeId, shared)
            this.plans.add(built.planHash, ImportPlanState(built.planHash, activeId, state, built, importNowMs()))
            return this.planJson(state, built)
        }
        throw Exception("import-plan-stale")
    }

    func planJson(preview: ImportPreviewState, built: ImportBuiltPlan): String {
        let obj = JsonObject()
        obj.put("planHash", JsonString(built.planHash))
        obj.put("sourceId", JsonString(preview.sourceId))
        obj.put("kind", JsonString(preview.kind))
        let target = JsonObject()
        target.put("scope", JsonString(preview.scope))
        obj.put("target", target)
        obj.put("counts", JsonValue.fromStr(built.counts.toJson()).asObject())
        obj.put("items", importPlanItemsJson(built.items))
        obj.put("issues", importIssuesJson(built.issues))
        obj.put("requiresConfirmation", JsonBool(true))
        return obj.toString()
    }

    func confirmResult(params: JsonObject, activeId: String): String {
        let planHash = importRequiredString(params, "planHash")
        var plan: ?ImportPlanState = None
        if (let Some(found) <- this.plans.get(planHash)) {
            plan = Some(found)
        }
        if (let Some(state) <- plan) {
            if (state.ownerSessionId != activeId) {
                throw Exception("import-session-changed")
            }
            let decisionObj = importRequiredObject(params, "decisions")
            let decisions = HashMap<String, String>()
            let selected = ArrayList<String>()
            let fields = decisionObj.getFields()
            for (key in fields.keys()) {
                let decision = fields.get(key).getOrThrow().asString().getValue()
                var item: ?ImportPlanItemState = None
                for (candidate in state.built.items) {
                    if (candidate.itemId == key) {
                        item = Some(candidate)
                    }
                }
                if (let Some(found) <- item) {
                    let allowed = importDecisionAllowed(found.action, state.preview.kind, decision)
                    if (!allowed) {
                        throw Exception("import-bad-args")
                    }
                    decisions.add(key, decision)
                    if (decision == "append" || decision == "overwrite") {
                        selected.add(key)
                    }
                } else {
                    throw Exception("import-bad-args")
                }
            }
            // 未点名的条目按前端同款默认：new 默认 append，其余 skip。
            for (item in state.built.items) {
                if (!decisions.contains(item.itemId)) {
                    decisions.add(item.itemId, if (item.action == "new") {
                        "append"
                    } else {
                        "skip"
                    })
                    if (item.action == "new") {
                        selected.add(item.itemId)
                    }
                }
            }
            this
                .confirmations
                .add(planHash, ImportConfirmationState(planHash, decisions, selected.toArray(), importNowMs()))
            let obj = JsonObject()
            obj.put("planHash", JsonString(planHash))
            let decisionOut = JsonObject()
            for (item in state.built.items) {
                decisionOut.put(item.itemId, JsonString(decisions.get(item.itemId).getOrThrow()))
            }
            obj.put("decisions", decisionOut)
            let selectedOut = JsonArray()
            for (itemId in selected) {
                selectedOut.add(JsonString(itemId))
            }
            obj.put("selected", selectedOut)
            let counts = JsonObject()
            counts.put("selected", JsonInt(Int64(selected.size)))
            counts.put("skipped", JsonInt(Int64(state.built.items.size) - Int64(selected.size)))
            obj.put("counts", counts)
            return obj.toString()
        }
        throw Exception("import-plan-stale")
    }

    func applyResult(params: JsonObject, activeId: String, shared: SessionLog): String {
        let jobId = importOptionalString(params, "jobId")
        if (jobId.size > 0) {
            let job = this.jobLookup(jobId, activeId)
            this.advanceJob(job, activeId, shared)
            return this.jobJson(job)
        }
        let requestId = importRequiredString(params, "requestId")
        if (requestId.size == 0 || requestId.size > 200) {
            throw Exception("import-bad-args")
        }
        let planHash = importRequiredString(params, "planHash")
        // 幂等重放先于计划重算：作业已落库后目标必然变化（新增项变成 duplicate），
        // 再重建计划只会把同一次请求误判成 stale。
        if (let Some(existingId) <- this.requestJobs.get(requestId)) {
            if (let Some(existing) <- this.jobs.get(existingId)) {
                if (existing.ownerSessionId != activeId) {
                    throw Exception("import-session-changed")
                }
                if (existing.planHash != planHash) {
                    throw Exception("import-request-conflict")
                }
                return this.jobJson(existing)
            }
        }
        var plan: ?ImportPlanState = None
        if (let Some(found) <- this.plans.get(planHash)) {
            plan = Some(found)
        }
        if (let Some(state) <- plan) {
            if (state.ownerSessionId != activeId) {
                throw Exception("import-session-changed")
            }
            var confirmation: ?ImportConfirmationState = None
            if (let Some(found) <- this.confirmations.get(planHash)) {
                confirmation = Some(found)
            }
            if (let Some(confirmed) <- confirmation) {
                // 重新计算一次计划：目标在 plan 与 apply 之间变化时返回 stale，不写目标。
                let rebuilt = this.buildPlan(state.preview, activeId, shared)
                if (rebuilt.planHash != planHash) {
                    throw Exception("import-plan-stale")
                }
                if (let Some(value) <- params.get("selection")) {
                    var selectionObj: ?JsonObject = None
                    try {
                        selectionObj = Some(value.asObject())
                    } catch (_: Exception) {
                        throw Exception("import-bad-args")
                    }
                    if (let Some(selection) <- selectionObj) {
                        let ids = importRequiredArray(selection, "itemIds")
                        let requested = ArrayList<String>()
                        for (item in ids.getItems()) {
                            requested.add(item.asString().getValue())
                        }
                        if (!importSameStringSet(requested, confirmed.selected)) {
                            throw Exception("import-plan-stale")
                        }
                    }
                }
                if (let Some(activeJobId) <- this.activeJobs.get(activeId)) {
                    var busy = false
                    if (let Some(activeJob) <- this.jobs.get(activeJobId)) {
                        if (!importTerminal(activeJob.status)) {
                            busy = true
                        }
                    }
                    if (busy) {
                        throw Exception("import-job-busy")
                    }
                    this.activeJobs.remove(activeId)
                }
                let job = this.makeJob(state, confirmed, requestId, activeId)
                this.jobs.add(job.jobId, job)
                this.requestJobs.add(requestId, job.jobId)
                if (job.remaining > 0) {
                    this.activeJobs.add(activeId, job.jobId)
                }
                this.advanceJob(job, activeId, shared)
                return this.jobJson(job)
            }
            throw Exception("import-bad-args")
        }
        throw Exception("import-plan-stale")
    }

    func describeResult(params: JsonObject, activeId: String): String {
        let jobId = importRequiredString(params, "jobId")
        let job = this.jobLookup(jobId, activeId)
        var offset = importOptionalInt(params, "offset", 0)
        var limit = importOptionalInt(params, "limit", 100)
        if (offset < 0) {
            offset = 0
        }
        if (limit < 1) {
            limit = 1
        }
        if (limit > IMPORT_MAX_REPORT_ITEMS) {
            limit = IMPORT_MAX_REPORT_ITEMS
        }
        let obj = JsonObject()
        obj.put("job", JsonValue.fromStr(this.jobJson(job)).asObject())
        obj.put("report", JsonValue.fromStr(this.reportJson(job, offset, limit)).asObject())
        return obj.toString()
    }

    func cancelResult(params: JsonObject, activeId: String): String {
        let jobId = importRequiredString(params, "jobId")
        let job = this.jobLookup(jobId, activeId)
        if (!importTerminal(job.status)) {
            job.status = "cancelled"
            for (item in job.items) {
                if (item.status == "pending") {
                    item.status = "skipped"
                    item.code = "import-cancelled"
                }
            }
            job.remaining = 0
            job.currentItemId = ""
            job.currentTitle = ""
            job.updatedAt = importNowText()
            if (let Some(mapped) <- this.activeJobs.get(activeId)) {
                if (mapped == job.jobId) {
                    this.activeJobs.remove(activeId)
                }
            }
        }
        let obj = JsonValue.fromStr(this.jobJson(job)).asObject()
        obj.put("committedRetained", JsonBool(true))
        return obj.toString()
    }

    func parsePreview(params: JsonObject, shared: SessionLog): ImportPreviewState {
        let sourceId = importRequiredString(params, "sourceId")
        let kind = importRequiredString(params, "kind")
        let expected = importKindOfSource(sourceId)
        if (expected.size == 0 || expected != kind) {
            throw Exception("import-unsupported-source")
        }
        let target = importRequiredObject(params, "target")
        let scope = importRequiredString(target, "scope")
        if (scope != "user" && scope != "project") {
            throw Exception("import-bad-args")
        }
        if (kind == "config" && scope != "user") {
            throw Exception("import-bad-args")
        }
        var workspace = ""
        if (scope == "project") {
            workspace = SessionWorkspace(shared).directory()
            if (workspace.size == 0) {
                throw Exception("import-bad-args")
            }
        }
        let mappingObj = importRequiredObject(params, "mapping")
        let mapping = importMappingFrom(kind, mappingObj)
        let mappingJson = importMappingCanonical(mapping)
        let issues = ArrayList<ImportIssue>()
        var candidates = Array<ImportCandidate>()
        var configText = ""
        if (kind == "conversation") {
            candidates = this.parseConversationCandidates(params, issues)
        } else if (kind == "knowledge") {
            candidates = this.parseKnowledgeCandidates(params, issues)
        } else {
            configText = this.parseConfigPayload(params)
        }
        let token = this.nextToken("pv-")
        return ImportPreviewState(token, sourceId, kind, mapping, mappingJson, scope, workspace, candidates, configText,
            issues.toArray(), importNowMs())
    }

    func parseConversationCandidates(params: JsonObject, issues: ArrayList<ImportIssue>): Array<ImportCandidate> {
        let arr = importRequiredArray(params, "candidates")
        if (arr.size() > IMPORT_MAX_CONVERSATIONS) {
            throw Exception("import-input-limit")
        }
        let out = ArrayList<ImportCandidate>()
        var totalMessages: Int64 = 0
        var index: Int64 = 0
        for (value in arr.getItems()) {
            let idx = index
            index += 1
            var parsed: ?JsonObject = None
            try {
                parsed = Some(value.asObject())
            } catch (_: Exception) {
                issues.add(ImportIssue(idx, "import-invalid-candidate", "候选不是对象"))
                out.add(ImportCandidate(idx, "c${idx}", "", "", Array<ImportMessage>(), "", 0, 0,
                    "import-invalid-candidate"))
                continue
            }
            if (let Some(obj) <- parsed) {
                var candidateId = "c${idx}"
                if (let Some(cid) <- obj.get("candidateId")) {
                    try {
                        let text = cid.asString().getValue()
                        if (text.size > 0) {
                            candidateId = text
                        }
                    } catch (_: Exception) {}
                }
                let sourceKey = importOptionalString(obj, "sourceKey")
                var sourceTitle = importOptionalString(obj, "title")
                sourceTitle = importTruncateBytes(sourceTitle, IMPORT_MAX_TITLE_BYTES)
                var invalid = ""
                if (sourceKey.size == 0 || sourceKey.size > 512) {
                    invalid = "import-invalid-candidate"
                }
                let kept = ArrayList<ImportMessage>()
                var skipped: Int64 = 0
                var textBytes: Int64 = 0
                var hasMessages = false
                if (invalid.size == 0) {
                    if (let Some(messageValue) <- obj.get("messages")) {
                        hasMessages = true
                        var messageArr: ?JsonArray = None
                        try {
                            messageArr = Some(messageValue.asArray())
                        } catch (_: Exception) {
                            invalid = "import-invalid-candidate"
                        }
                        if (let Some(messages) <- messageArr) {
                            for (messageValue in messages.getItems()) {
                                totalMessages += 1
                                if (totalMessages > IMPORT_MAX_MESSAGES) {
                                    invalid = "import-input-limit"
                                    break
                                }
                                var messageObj: ?JsonObject = None
                                try {
                                    messageObj = Some(messageValue.asObject())
                                } catch (_: Exception) {}
                                if (let Some(message) <- messageObj) {
                                    let role = importOptionalString(message, "role")
                                    let text = importOptionalString(message, "text")
                                    if (role != "user" && role != "assistant") {
                                        skipped += 1
                                    } else if (text.trimAscii().size == 0) {
                                        skipped += 1
                                    } else if (text.size > IMPORT_MAX_MESSAGE_BYTES) {
                                        invalid = "import-input-limit"
                                        break
                                    } else {
                                        kept.add(ImportMessage(role, text))
                                        textBytes += text.size
                                    }
                                } else {
                                    skipped += 1
                                }
                            }
                        }
                    } else {
                        invalid = "import-invalid-candidate"
                    }
                }
                if (invalid.size == 0 && kept.size == 0) {
                    invalid = "import-empty-conversation"
                }
                if (invalid.size > 0) {
                    issues.add(ImportIssue(idx, invalid, "会话候选无法导入"))
                }
                out.add(
                    ImportCandidate(idx, candidateId, sourceKey, sourceTitle, kept.toArray(), "", skipped, textBytes,
                        invalid))
            }
        }
        return out.toArray()
    }

    func parseKnowledgeCandidates(params: JsonObject, issues: ArrayList<ImportIssue>): Array<ImportCandidate> {
        let arr = importRequiredArray(params, "candidates")
        if (arr.size() > IMPORT_MAX_KNOWLEDGE) {
            throw Exception("import-input-limit")
        }
        let out = ArrayList<ImportCandidate>()
        var index: Int64 = 0
        for (value in arr.getItems()) {
            let idx = index
            index += 1
            var parsed: ?JsonObject = None
            try {
                parsed = Some(value.asObject())
            } catch (_: Exception) {
                issues.add(ImportIssue(idx, "import-invalid-candidate", "候选不是对象"))
                out.add(ImportCandidate(idx, "d${idx}", "", "", Array<ImportMessage>(), "", 0, 0,
                    "import-invalid-candidate"))
                continue
            }
            if (let Some(obj) <- parsed) {
                var candidateId = "d${idx}"
                if (let Some(cid) <- obj.get("candidateId")) {
                    try {
                        let text = cid.asString().getValue()
                        if (text.size > 0) {
                            candidateId = text
                        }
                    } catch (_: Exception) {}
                }
                let sourceKey = importOptionalString(obj, "sourceKey")
                var sourceTitle = importOptionalString(obj, "title")
                sourceTitle = importTruncateBytes(sourceTitle, IMPORT_MAX_TITLE_BYTES)
                let content = importOptionalString(obj, "content")
                var invalid = ""
                if (sourceKey.size == 0 || sourceKey.size > 512) {
                    invalid = "import-invalid-candidate"
                } else if (content.size > IMPORT_MAX_KNOWLEDGE_BYTES) {
                    invalid = "import-input-limit"
                } else if (content.contains("\u{0}")) {
                    invalid = "import-invalid-candidate"
                }
                if (invalid.size > 0) {
                    issues.add(ImportIssue(idx, invalid, "知识候选无法导入"))
                }
                out.add(
                    ImportCandidate(idx, candidateId, sourceKey, sourceTitle, Array<ImportMessage>(), content, 0,
                        content.size, invalid))
            }
        }
        return out.toArray()
    }

    func parseConfigPayload(params: JsonObject): String {
        let payload = importRequiredObject(params, "payload")
        let payloadKind = importRequiredString(payload, "kind")
        if (payloadKind == MIGRATION_KIND_SECRET) {
            throw Exception("import-secret-refused")
        }
        if (payloadKind != MIGRATION_KIND_CONFIG) {
            throw Exception("import-bad-args")
        }
        let text = importRequiredString(payload, "text")
        if (text.size > IMPORT_MAX_CONFIG_BYTES) {
            throw Exception("import-input-limit")
        }
        var bundle: ?MigrationBundle = None
        try {
            bundle = MigrationBundle.fromJson(text)
        } catch (_: Exception) {
            throw Exception("import-invalid-candidate")
        }
        if (let Some(parsed) <- bundle) {
            if (parsed.kind == MIGRATION_KIND_SECRET) {
                throw Exception("import-secret-refused")
            }
            if (parsed.kind != MIGRATION_KIND_CONFIG || parsed.format != MIGRATION_FORMAT) {
                throw Exception("import-invalid-candidate")
            }
            if (parsed.validate().size > 0) {
                throw Exception("import-invalid-candidate")
            }
            // 任何凭据载体都不进 F19；config 包正常不应带 credentialRefs。
            if (parsed.credentialRefs.size > 0) {
                throw Exception("import-secret-refused")
            }
            if (parsed.providers.size > 200 || parsed.customModels.size > 200) {
                throw Exception("import-input-limit")
            }
            return text
        }
        throw Exception("import-invalid-candidate")
    }

    func buildPlan(preview: ImportPreviewState, activeId: String, shared: SessionLog): ImportBuiltPlan {
        let items = ArrayList<ImportPlanItemState>()
        let issues = ArrayList<ImportIssue>()
        for (issue in preview.issues) {
            issues.add(issue)
        }
        if (preview.kind == "conversation") {
            this.buildConversationPlan(preview, items, issues)
        } else if (preview.kind == "knowledge") {
            this.buildKnowledgePlan(preview, items, issues)
        } else {
            this.buildConfigPlan(preview, items, issues)
        }
        var newCount: Int64 = 0
        var duplicate: Int64 = 0
        var conflict: Int64 = 0
        var invalid: Int64 = 0
        for (item in items) {
            if (item.action == "new") {
                newCount += 1
            } else if (item.action == "duplicate") {
                duplicate += 1
            } else if (item.action == "conflict") {
                conflict += 1
            } else if (item.action == "invalid") {
                invalid += 1
            }
        }
        let counts = ImportCounts(Int64(items.size), newCount, duplicate, conflict, invalid, 0)
        var material = "import-plan/1" + "\u{0}" + preview.sourceId + "\u{0}" + preview.kind + "\u{0}" + preview.scope +
            "\u{0}" + preview.mappingJson + "\u{0}" + preview.workspace + "\u{0}"
        if (preview.kind == "config") {
            material += sha256Hex(preview.configText.toArray()) + "\u{0}"
        }
        for (item in items) {
            material += item.itemId + "\u{0}" + item.action + "\u{0}" + item.dedupeKey + "\u{0}" + item.displayTitle +
                "\u{0}" + item.configJson + "\u{0}"
        }
        let planHash = sha256Hex(material.toArray())
        return ImportBuiltPlan(items.toArray(), counts, issues.toArray(), planHash)
    }

    func buildConversationPlan(preview: ImportPreviewState, items: ArrayList<ImportPlanItemState>,
        issues: ArrayList<ImportIssue>) {
        let imported = this.scanSessionImports()
        let batch = HashMap<String, String>()
        for (candidate in preview.candidates) {
            let idx = candidate.index
            if (candidate.invalidReason.size > 0) {
                let item = ImportPlanItemState("invalid-${idx}", idx, "(无效候选)", "invalid", "")
                item.messages = Int64(candidate.messages.size)
                item.skippedMessages = candidate.skippedMessages
                item.reason = candidate.invalidReason
                item.candidateIndex = idx
                items.add(item)
                issues.add(ImportIssue(idx, candidate.invalidReason, "会话候选无法导入"))
                continue
            }
            let title = importMappedConversationTitle(preview.mapping, candidate.sourceTitle)
            if (!importValidTitle(title)) {
                let item = ImportPlanItemState("invalid-${idx}", idx, "(无效标题)", "invalid", "")
                item.messages = Int64(candidate.messages.size)
                item.skippedMessages = candidate.skippedMessages
                item.reason = "import-invalid-candidate"
                item.candidateIndex = idx
                items.add(item)
                issues.add(ImportIssue(idx, "import-invalid-candidate", "标题为空、超长或含控制字符"))
                continue
            }
            let fingerprint = importConversationFingerprint(candidate)
            let dedupeKey = importConversationDedupeKey(preview.sourceId, candidate, fingerprint)
            let itemId = dedupeKey[0..24]
            let batchKey = preview.sourceId + "\u{0}" + candidate.sourceKey
            var action = "new"
            var reason = ""
            if (let Some(previous) <- batch.get(batchKey)) {
                if (previous == fingerprint) {
                    action = "duplicate"
                    reason = "import-batch-duplicate"
                } else {
                    action = "conflict"
                    reason = "import-batch-conflict"
                }
            } else {
                batch.add(batchKey, fingerprint)
                var exact = false
                var different = false
                for (record in imported) {
                    if (record.sourceId == preview.sourceId && record.sourceKey == candidate.sourceKey) {
                        if (record.fingerprint == fingerprint) {
                            exact = true
                        } else {
                            different = true
                        }
                    }
                }
                if (exact) {
                    action = "duplicate"
                    reason = "import-already-imported"
                } else if (different) {
                    action = "conflict"
                    reason = "import-source-changed"
                }
            }
            let item = ImportPlanItemState(itemId, idx, importTruncateBytes(title, IMPORT_MAX_DISPLAY_BYTES), action,
                dedupeKey)
            item.messages = Int64(candidate.messages.size)
            item.skippedMessages = candidate.skippedMessages
            item.reason = reason
            item.candidateIndex = idx
            items.add(item)
        }
    }

    func buildKnowledgePlan(preview: ImportPreviewState, items: ArrayList<ImportPlanItemState>,
        issues: ArrayList<ImportIssue>) {
        var docs = HashMap<String, String>()
        var docCount: Int64 = 0
        try {
            let store = KnowledgeStore.forScope(preview.scope, preview.workspace)
            let snapshot = store.read()
            for (value in snapshot.get("documents").getOrThrow().asArray().getItems()) {
                let doc = value.asObject()
                let id = doc.get("id").getOrThrow().asString().getValue()
                let content = doc.get("content").getOrThrow().asString().getValue()
                docs.add(id, content)
                docCount += 1
            }
        } catch (e: Exception) {
            throw Exception("import-persistence-failed")
        }
        let batch = HashMap<String, String>()
        var plannedNew: Int64 = 0
        for (candidate in preview.candidates) {
            let idx = candidate.index
            if (candidate.invalidReason.size > 0) {
                let item = ImportPlanItemState("invalid-${idx}", idx, "(无效候选)", "invalid", "")
                item.reason = candidate.invalidReason
                item.candidateIndex = idx
                items.add(item)
                issues.add(ImportIssue(idx, candidate.invalidReason, "知识候选无法导入"))
                continue
            }
            let title = importMappedKnowledgeTitle(preview.mapping, candidate.sourceTitle, candidate.sourceKey)
            if (!importValidTitle(title)) {
                let item = ImportPlanItemState("invalid-${idx}", idx, "(无效标题)", "invalid", "")
                item.reason = "import-invalid-candidate"
                item.candidateIndex = idx
                items.add(item)
                issues.add(ImportIssue(idx, "import-invalid-candidate", "标题为空、超长或含控制字符"))
                continue
            }
            let fingerprint = importKnowledgeFingerprint(candidate)
            let dedupeKey = importKnowledgeDedupeKey(preview.sourceId, candidate, fingerprint)
            let itemId = dedupeKey[0..24]
            let baseId = importKnowledgeBaseId(preview.sourceId, candidate.sourceKey)
            var action = "new"
            var reason = ""
            if (let Some(previous) <- batch.get(baseId)) {
                if (previous == fingerprint) {
                    action = "duplicate"
                    reason = "import-batch-duplicate"
                } else {
                    action = "conflict"
                    reason = "import-batch-conflict"
                }
            } else {
                batch.add(baseId, fingerprint)
                if (let Some(existing) <- docs.get(baseId)) {
                    if (existing == candidate.content) {
                        action = "duplicate"
                        reason = "import-already-imported"
                    } else {
                        action = "conflict"
                        reason = "import-source-changed"
                    }
                }
            }
            if (action == "new" && docCount + plannedNew >= 200) {
                action = "invalid"
                reason = "import-target-limit"
            }
            if (action == "new") {
                plannedNew += 1
            }
            let item = ImportPlanItemState(itemId, idx, importTruncateBytes(title, IMPORT_MAX_DISPLAY_BYTES), action,
                dedupeKey)
            item.reason = reason
            item.candidateIndex = idx
            item.targetDocId = baseId
            items.add(item)
        }
    }

    func buildConfigPlan(preview: ImportPreviewState, items: ArrayList<ImportPlanItemState>,
        issues: ArrayList<ImportIssue>) {
        var bundle: ?MigrationBundle = None
        try {
            bundle = MigrationBundle.fromJson(preview.configText)
        } catch (_: Exception) {
            throw Exception("import-invalid-candidate")
        }
        if (let Some(parsed) <- bundle) {
            if (parsed.kind == MIGRATION_KIND_SECRET) {
                throw Exception("import-secret-refused")
            }
            if (parsed.kind != MIGRATION_KIND_CONFIG || parsed.format != MIGRATION_FORMAT || parsed.validate().size > 0) {
                throw Exception("import-invalid-candidate")
            }
            let providerView = ProviderRegistry.forUser().describe()
            let customView = CustomModelRegistry.forUser().describe()
            // 本机已有 + 本次包内可落地的供应商，供绑定引用校验。
            let availableProviders = ArrayList<String>()
            for (provider in providerView.providers) {
                availableProviders.add(provider.id)
            }
            let packageProviders = ArrayList<String>()
            var index: Int64 = 0
            for (entry in parsed.providers) {
                if (!entry.declared) {
                    packageProviders.add(entry.id)
                }
                let desired = this.configProviderRecord(entry, preview.mapping)
                var action = "new"
                var reason = ""
                if (entry.declared) {
                    action = "invalid"
                    reason = "import-builtin-rejected"
                } else if (let Some(existing) <- importFindProvider(providerView.providers, entry.id)) {
                    if (existing.declared) {
                        action = "invalid"
                        reason = "import-builtin-rejected"
                    } else if (existing.toJson() == desired.toJson()) {
                        action = "duplicate"
                        reason = "import-unchanged"
                    } else if (preview.mapping.updatePolicy == "allow-updates") {
                        action = "updated"
                        reason = "import-update-allowed"
                    } else {
                        action = "conflict"
                        reason = "import-existing-different"
                    }
                }
                if (action == "invalid") {
                    var dropAt: Int64 = -1
                    var probe: Int64 = 0
                    for (existing in availableProviders) {
                        if (existing == entry.id) {
                            dropAt = probe
                        }
                        probe += 1
                    }
                    if (dropAt >= 0) {
                        availableProviders.remove(at: dropAt)
                    }
                }
                let item = ImportPlanItemState("provider:${entry.id}", index,
                    importTruncateBytes(if (desired.name.size > 0) {
                        desired.name
                    } else {
                        entry.id
                    }, IMPORT_MAX_DISPLAY_BYTES), action, "provider:${entry.id}")
                item.reason = reason
                item.configKind = "provider"
                item.configId = entry.id
                item.configJson = desired.toJson()
                items.add(item)
                if (action == "invalid") {
                    issues.add(ImportIssue(index, reason, "供应商条目无法导入"))
                }
                index += 1
            }
            for (providerId in packageProviders) {
                var present = false
                for (existing in availableProviders) {
                    if (existing == providerId) {
                        present = true
                    }
                }
                if (!present) {
                    availableProviders.add(providerId)
                }
            }
            for (entry in parsed.customModels) {
                let desired = entry.toCustomModel()
                var action = "new"
                var reason = ""
                var bindingMissing = false
                for (binding in entry.bindings) {
                    var found = false
                    for (providerId in availableProviders) {
                        if (providerId == binding.providerId) {
                            found = true
                        }
                    }
                    if (!found) {
                        bindingMissing = true
                    }
                }
                if (bindingMissing) {
                    action = "invalid"
                    reason = "import-binding-provider-missing"
                } else if (let Some(existing) <- importFindCustomModel(customView.models, entry.id)) {
                    if (existing.toJson() == desired.toJson()) {
                        action = "duplicate"
                        reason = "import-unchanged"
                    } else if (preview.mapping.updatePolicy == "allow-updates") {
                        action = "updated"
                        reason = "import-update-allowed"
                    } else {
                        action = "conflict"
                        reason = "import-existing-different"
                    }
                }
                let item = ImportPlanItemState("customModel:${entry.id}", index,
                    importTruncateBytes(if (desired.name.size > 0) {
                        desired.name
                    } else {
                        entry.id
                    }, IMPORT_MAX_DISPLAY_BYTES), action, "customModel:${entry.id}")
                item.reason = reason
                item.configKind = "customModel"
                item.configId = entry.id
                item.configJson = desired.toJson()
                items.add(item)
                if (action == "invalid") {
                    issues.add(ImportIssue(index, reason, "自定义模型条目无法导入"))
                }
                index += 1
            }
            return
        }
        throw Exception("import-invalid-candidate")
    }

    func configProviderRecord(entry: MigrationProviderEntry, mapping: ImportMappingState): ProviderRecord {
        let base = entry.toProvider()
        // 计划里的目标形态必须与注册表真正落盘的形态一致：未绑定时注册表按稳定 ID
        // 派生凭据引用，配置则默认禁用。少做这一步，重复导入会被误判成 conflict。
        var credentialRef = deriveCredentialRef(base.id)
        var enabled = false
        if (let Some(ref) <- mapping.credentialBindings.get(base.id)) {
            credentialRef = ref
            enabled = base.enabled
        }
        return ProviderRecord(base.id, base.name, base.baseUrl, base.protocol, credentialRef, false, base.models,
            sortOrder: base.sortOrder, enabled: enabled, transport: base.transport)
    }

    func scanSessionImports(): ArrayList<ImportedSessionRecord> {
        let out = ArrayList<ImportedSessionRecord>()
        this.scanSessionLog("session.log", out)
        if (exists("sessions") && FileInfo("sessions").isDirectory()) {
            for (info in Directory.readFrom("sessions")) {
                if (!info.isDirectory()) {
                    continue
                }
                let path = info.path.toString() + "/session.log"
                this.scanSessionLog(path, out)
            }
        }
        return out
    }

    func scanSessionLog(path: String, out: ArrayList<ImportedSessionRecord>) {
        if (!exists(path) || !FileInfo(path).isRegular()) {
            return
        }
        let log = SessionLog(path)
        if (!log.load() || log.isTruncatedTail()) {
            return
        }
        for (event in log.snapshotEvents()) {
            if (event.eventType != "import/source") {
                continue
            }
            var parsed: ?JsonObject = None
            try {
                parsed = Some(JsonValue.fromStr(event.data).asObject())
            } catch (_: Exception) {}
            if (let Some(obj) <- parsed) {
                let format = importOptionalString(obj, "format")
                if (!format.startsWith("sacode-import/session/")) {
                    continue
                }
                let sourceId = importOptionalString(obj, "sourceId")
                let sourceKey = importOptionalString(obj, "sourceKey")
                let fingerprint = importOptionalString(obj, "fingerprint")
                if (sourceId.size > 0 && sourceKey.size > 0 && fingerprint.size > 0) {
                    out.add(ImportedSessionRecord(sourceId, sourceKey, fingerprint))
                }
            }
        }
    }

    func makeJob(plan: ImportPlanState, confirmation: ImportConfirmationState, requestId: String, activeId: String): ImportJobState {
        let jobItems = ArrayList<ImportJobItem>()
        var total: Int64 = 0
        for (item in plan.built.items) {
            var decision = "skip"
            if (let Some(explicit) <- confirmation.decisions.get(item.itemId)) {
                decision = explicit
            } else if (item.action == "new") {
                decision = "append"
            }
            var status = "skipped"
            if (item.action == "duplicate") {
                status = "duplicate"
            } else if (item.action == "invalid") {
                status = "invalid"
            } else if (item.action == "new" && decision == "append") {
                status = "pending"
                total += 1
            } else if (item.action == "conflict" && (decision == "append" || decision == "overwrite")) {
                status = "pending"
                total += 1
            }
            jobItems.add(
                ImportJobItem(item.itemId, item.index, item.displayTitle, item.action, status, item.candidateIndex,
                    item.configKind, item.configId, item.configJson))
        }
        let jobId = this.nextJobId()
        let now = importNowText()
        return ImportJobState(jobId, requestId, activeId, plan.planHash, plan.preview, jobItems.toArray(),
            plan.built.issues, "created", now, now, importNowMs(), total, total)
    }

    func advanceJob(job: ImportJobState, activeId: String, shared: SessionLog) {
        if (importTerminal(job.status)) {
            return
        }
        if (job.remaining <= 0) {
            this.finalizeJob(job)
            return
        }
        var index: Int64 = -1
        var i: Int64 = 0
        while (i < Int64(job.items.size)) {
            if (job.items[i].status == "pending") {
                index = i
                break
            }
            i += 1
        }
        if (index < 0) {
            this.finalizeJob(job)
            return
        }
        job.status = "running"
        let item = job.items[index]
        job.currentItemId = item.itemId
        job.currentTitle = item.displayTitle
        job.updatedAt = importNowText()
        try {
            if (job.preview.kind == "conversation") {
                this.applyConversationItem(job, item, shared)
            } else if (job.preview.kind == "knowledge") {
                this.applyKnowledgeItem(job, item)
            } else if (job.preview.kind == "config") {
                this.applyConfigItem(job, item)
            } else {
                throw Exception("import-invalid-candidate")
            }
        } catch (e: Exception) {
            let reason = importReasonOf(e)
            item.status = "failed"
            item.code = reason
            job.failed += 1
            // 跨注册表没有事务：配置阶段一旦出现确定性失败就停止，避免在未知状态上继续写。
            if (job.preview.kind == "config") {
                for (other in job.items) {
                    if (other.status == "pending") {
                        other.status = "skipped"
                        other.code = "import-config-stopped"
                    }
                }
            }
        }
        job.remaining = this.pendingCount(job)
        job.updatedAt = importNowText()
        if (job.remaining <= 0) {
            this.finalizeJob(job)
        } else {
            var next = ""
            var nextTitle = ""
            for (candidate in job.items) {
                if (candidate.status == "pending") {
                    next = candidate.itemId
                    nextTitle = candidate.displayTitle
                    break
                }
            }
            job.currentItemId = next
            job.currentTitle = nextTitle
        }
    }

    func pendingCount(job: ImportJobState): Int64 {
        var count: Int64 = 0
        for (item in job.items) {
            if (item.status == "pending") {
                count += 1
            }
        }
        return count
    }

    func finalizeJob(job: ImportJobState) {
        if (importTerminal(job.status)) {
            return
        }
        if (job.status == "cancelled") {
            job.currentItemId = ""
            job.currentTitle = ""
        } else if (job.failed > 0) {
            job.status = if (job.committed > 0) {
                "partial"
            } else {
                "failed"
            }
        } else {
            job.status = "completed"
        }
        job.currentItemId = ""
        job.currentTitle = ""
        job.remaining = this.pendingCount(job)
        job.updatedAt = importNowText()
        if (let Some(mapped) <- this.activeJobs.get(job.ownerSessionId)) {
            if (mapped == job.jobId) {
                this.activeJobs.remove(job.ownerSessionId)
            }
        }
    }

    func applyConversationItem(job: ImportJobState, item: ImportJobItem, shared: SessionLog) {
        let candidate = job.preview.candidates[item.candidateIndex]
        let staging = "imports/staging/${job.jobId}/${item.itemId}"
        if (exists(staging)) {
            removeIfExists(staging, recursive: true)
        }
        Directory.create(staging, recursive: true)
        let log = SessionLog(staging + "/session.log")
        log.append("session/title", item.displayTitle)
        log.append("import/source", this.sessionSourceJson(job, item, candidate).toString())
        if (job.preview.mapping.workspaceMode == "current") {
            let workspace = SessionWorkspace(shared).directory()
            if (workspace.size > 0) {
                log.append("workspace/directory", workspace)
            }
        }
        for (message in candidate.messages) {
            if (message.role == "user") {
                log.append("user/message", message.text)
            } else {
                log.append("assistant/message", message.text)
            }
        }
        if (!log.flush()) {
            throw Exception("import-persistence-failed")
        }
        if (!exists("sessions")) {
            Directory.create("sessions", recursive: true)
        }
        let target = this.chooseSessionDirectory(job.jobId, item.itemId)
        rename(staging, to: target, overwrite: false)
        item.status = "committed"
        item.targetKind = "session"
        item.targetId = target
        job.committed += 1
    }

    func sessionSourceJson(job: ImportJobState, item: ImportJobItem, candidate: ImportCandidate): JsonObject {
        let obj = JsonObject()
        obj.put("format", JsonString(IMPORT_SESSION_FORMAT))
        obj.put("sourceId", JsonString(job.preview.sourceId))
        obj.put("sourceKey", JsonString(candidate.sourceKey))
        obj.put("fingerprint", JsonString(importConversationFingerprint(candidate)))
        obj.put("jobId", JsonString(job.jobId))
        obj.put("itemId", JsonString(item.itemId))
        obj.put("title", JsonString(item.displayTitle))
        obj.put("messageCount", JsonInt(Int64(candidate.messages.size)))
        obj.put("skippedMessages", JsonInt(candidate.skippedMessages))
        obj.put("importedAt", JsonString(importNowText()))
        if (item.action == "conflict") {
            let base = sha256Hex((job.preview.sourceId + "\u{0}" + candidate.sourceKey).toArray())
            obj.put("conflictOf", JsonString(base[0..24]))
        }
        return obj
    }

    func chooseSessionDirectory(jobId: String, itemId: String): String {
        var attempt: Int64 = 0
        while (attempt < 1024) {
            let h = sha256Hex((jobId + "\u{0}" + itemId + "\u{0}" + "${attempt}").toArray())
            let target = "sessions/session-import-" + h[0..16] + "-${attempt}"
            if (!exists(target)) {
                return target
            }
            attempt += 1
        }
        throw Exception("import-persistence-failed")
    }

    func applyKnowledgeItem(job: ImportJobState, item: ImportJobItem) {
        let candidate = job.preview.candidates[item.candidateIndex]
        let store = KnowledgeStore.forScope(job.preview.scope, job.preview.workspace)
        var docId = importKnowledgeBaseId(job.preview.sourceId, candidate.sourceKey)
        if (item.action == "conflict") {
            let fingerprint = importKnowledgeFingerprint(candidate)
            docId = docId + "-" + fingerprint[0..8]
        }
        var attempts: Int64 = 0
        var done = false
        while (!done && attempts < 4) {
            attempts += 1
            try {
                let snapshot = store.read()
                let revision = snapshot.get("revision").getOrThrow().asInt().getValue()
                var found = false
                var existingContent = ""
                for (value in snapshot.get("documents").getOrThrow().asArray().getItems()) {
                    let doc = value.asObject()
                    if (doc.get("id").getOrThrow().asString().getValue() == docId) {
                        found = true
                        existingContent = doc.get("content").getOrThrow().asString().getValue()
                    }
                }
                if (found) {
                    if (existingContent == candidate.content) {
                        item.status = "duplicate"
                        item.code = "import-already-imported"
                        job.duplicates += 1
                        done = true
                    } else {
                        throw Exception("import-revision-conflict")
                    }
                } else {
                    store.save(docId, item.displayTitle, candidate.content, revision, false)
                    item.status = "committed"
                    item.targetKind = "knowledge"
                    item.targetId = docId
                    job.committed += 1
                    done = true
                }
            } catch (e: Exception) {
                if (e.message != "knowledge-revision-conflict" || attempts >= 4) {
                    throw e
                }
            }
        }
        if (!done) {
            throw Exception("import-revision-conflict")
        }
    }

    func applyConfigItem(job: ImportJobState, item: ImportJobItem) {
        var desired: ?JsonObject = None
        try {
            desired = Some(JsonValue.fromStr(item.configJson).asObject())
        } catch (_: Exception) {
            throw Exception("import-invalid-candidate")
        }
        if (let Some(obj) <- desired) {
            if (item.configKind == "provider") {
                let registry = ProviderRegistry.forUser()
                let view = registry.describe()
                var existing: ?ProviderRecord = None
                for (provider in view.providers) {
                    if (provider.id == item.configId) {
                        existing = Some(provider)
                    }
                }
                var skipWrite = false
                if (let Some(current) <- existing) {
                    if (current.declared) {
                        throw Exception("import-builtin-rejected")
                    }
                    if (current.toJson() == item.configJson) {
                        item.status = "duplicate"
                        item.code = "import-unchanged"
                        job.duplicates += 1
                        skipWrite = true
                    } else if (item.action == "new") {
                        throw Exception("import-revision-conflict")
                    }
                }
                if (!skipWrite) {
                    registry.updateObject(obj, view.revision)
                    item.status = "committed"
                    item.targetKind = "provider"
                    item.targetId = item.configId
                    job.committed += 1
                }
            } else if (item.configKind == "customModel") {
                let registry = CustomModelRegistry.forUser()
                let view = registry.describe()
                var existing: ?CustomModelRecord = None
                for (model in view.models) {
                    if (model.id == item.configId) {
                        existing = Some(model)
                    }
                }
                var skipWrite = false
                if (let Some(current) <- existing) {
                    if (current.toJson() == item.configJson) {
                        item.status = "duplicate"
                        item.code = "import-unchanged"
                        job.duplicates += 1
                        skipWrite = true
                    } else if (item.action == "new") {
                        throw Exception("import-revision-conflict")
                    }
                }
                if (!skipWrite) {
                    registry.upsertObject(obj, view.revision)
                    item.status = "committed"
                    item.targetKind = "customModel"
                    item.targetId = item.configId
                    job.committed += 1
                }
            } else {
                throw Exception("import-invalid-candidate")
            }
            return
        }
        throw Exception("import-invalid-candidate")
    }

    func nextToken(prefix: String): String {
        this.seq += 1
        let h = sha256Hex("${prefix}\u{0}${importNowMs()}\u{0}${this.seq}".toArray())
        return prefix + h[0..24]
    }

    func nextJobId(): String {
        var attempt: Int64 = 0
        while (attempt < 64) {
            let h = sha256Hex("${importNowMs()}\u{0}${this.seq}\u{0}${attempt}".toArray())
            this.seq += 1
            let id = "impjob-" + h[0..16]
            if (!this.jobs.get(id).isSome()) {
                return id
            }
            attempt += 1
        }
        throw Exception("import-persistence-failed")
    }

    func jobLookup(jobId: String, activeId: String): ImportJobState {
        if (let Some(job) <- this.jobs.get(jobId)) {
            if (job.ownerSessionId != activeId) {
                throw Exception("import-session-changed")
            }
            return job
        }
        throw Exception("import-job-not-found")
    }

    func jobJson(job: ImportJobState): String {
        let obj = JsonObject()
        obj.put("jobId", JsonString(job.jobId))
        obj.put("requestId", JsonString(job.requestId))
        obj.put("sourceId", JsonString(job.preview.sourceId))
        obj.put("kind", JsonString(job.preview.kind))
        obj.put("status", JsonString(job.status))
        let counts = JsonObject()
        counts.put("total", JsonInt(job.total))
        counts.put("committed", JsonInt(job.committed))
        counts.put("duplicate", JsonInt(job.duplicates))
        counts.put("failed", JsonInt(job.failed))
        counts.put("remaining", JsonInt(job.remaining))
        obj.put("counts", counts)
        if (job.status == "running" && job.currentItemId.size > 0) {
            let current = JsonObject()
            current.put("itemId", JsonString(job.currentItemId))
            current.put("displayTitle", JsonString(job.currentTitle))
            obj.put("current", current)
        } else {
            obj.put("current", JsonNull())
        }
        obj.put("terminal", JsonBool(importTerminal(job.status)))
        obj.put("createdAt", JsonString(job.createdAt))
        obj.put("updatedAt", JsonString(job.updatedAt))
        obj.put("planHash", JsonString(job.planHash))
        obj.put("resumable", JsonBool(false))
        return obj.toString()
    }

    func reportJson(job: ImportJobState, offset: Int64, limit: Int64): String {
        let obj = JsonObject()
        obj.put("format", JsonString(IMPORT_REPORT_FORMAT))
        obj.put("jobId", JsonString(job.jobId))
        obj.put("status", JsonString(job.status))
        var committed: Int64 = 0
        var duplicate: Int64 = 0
        var failed: Int64 = 0
        var skipped: Int64 = 0
        var invalid: Int64 = 0
        for (item in job.items) {
            if (item.status == "committed") {
                committed += 1
            } else if (item.status == "duplicate") {
                duplicate += 1
            } else if (item.status == "failed") {
                failed += 1
            } else if (item.status == "skipped") {
                skipped += 1
            } else if (item.status == "invalid") {
                invalid += 1
            }
        }
        let counts = JsonObject()
        counts.put("total", JsonInt(Int64(job.items.size)))
        counts.put("committed", JsonInt(committed))
        counts.put("duplicate", JsonInt(duplicate))
        counts.put("failed", JsonInt(failed))
        counts.put("skipped", JsonInt(skipped))
        counts.put("invalid", JsonInt(invalid))
        obj.put("counts", counts)
        let items = JsonArray()
        var index = offset
        var emitted: Int64 = 0
        while (index < Int64(job.items.size) && emitted < limit) {
            let item = job.items[index]
            let entry = JsonObject()
            entry.put("itemId", JsonString(item.itemId))
            entry.put("index", JsonInt(item.index))
            entry.put("displayTitle", JsonString(item.displayTitle))
            entry.put("action", JsonString(item.action))
            entry.put("status", JsonString(item.status))
            entry.put("code", JsonString(item.code))
            if (item.targetKind.size > 0) {
                let target = JsonObject()
                target.put("kind", JsonString(item.targetKind))
                target.put("id", JsonString(item.targetId))
                entry.put("target", target)
            } else {
                entry.put("target", JsonNull())
            }
            items.add(entry)
            index += 1
            emitted += 1
        }
        obj.put("items", items)
        obj.put("issues", importIssuesJson(job.issues))
        if (index < Int64(job.items.size)) {
            obj.put("nextOffset", JsonInt(index))
            obj.put("complete", JsonBool(false))
        } else {
            obj.put("nextOffset", JsonNull())
            obj.put("complete", JsonBool(importTerminal(job.status)))
        }
        return obj.toString()
    }

    func prune(nowMs: Int64) {
        let stalePreviews = ArrayList<String>()
        for (key in this.previews.keys()) {
            if (nowMs - this.previews.get(key).getOrThrow().createdAtMs > IMPORT_STATE_TTL_MS) {
                stalePreviews.add(key)
            }
        }
        for (key in stalePreviews) {
            this.previews.remove(key)
        }
        let stalePlans = ArrayList<String>()
        for (key in this.plans.keys()) {
            if (nowMs - this.plans.get(key).getOrThrow().createdAtMs > IMPORT_STATE_TTL_MS) {
                stalePlans.add(key)
            }
        }
        for (key in stalePlans) {
            this.plans.remove(key)
        }
        let staleConfirmations = ArrayList<String>()
        for (key in this.confirmations.keys()) {
            if (nowMs - this.confirmations.get(key).getOrThrow().createdAtMs > IMPORT_STATE_TTL_MS) {
                staleConfirmations.add(key)
            }
        }
        for (key in staleConfirmations) {
            this.confirmations.remove(key)
        }
    }
}

func importDecisionAllowed(action: String, kind: String, decision: String): Bool {
    if (action == "new") {
        return decision == "append" || decision == "skip"
    }
    if (action == "conflict") {
        if (kind == "config") {
            return decision == "overwrite" || decision == "skip" || decision == "dismiss"
        }
        return decision == "append" || decision == "skip" || decision == "dismiss"
    }
    return decision == "skip"
}

func importFindProvider(providers: Array<ProviderRecord>, id: String): Option<ProviderRecord> {
    for (provider in providers) {
        if (provider.id == id) {
            return Some(provider)
        }
    }
    return None
}

func importFindCustomModel(models: Array<CustomModelRecord>, id: String): Option<CustomModelRecord> {
    for (model in models) {
        if (model.id == id) {
            return Some(model)
        }
    }
    return None
}

func importSameStringSet(left: ArrayList<String>, right: Array<String>): Bool {
    if (Int64(left.size) != Int64(right.size)) {
        return false
    }
    for (candidate in left) {
        var found = false
        for (other in right) {
            if (candidate == other) {
                found = true
            }
        }
        if (!found) {
            return false
        }
    }
    return true
}
