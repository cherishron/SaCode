package core
import std.collection.*
import std.sync.*
import std.time.*
import stdx.encoding.json.*

public func userQuestionToolSpec(): ToolSpec {
    return ToolSpec("ask_user_question", "在当前任务中向用户展示单选、多选、确认或自定义输入卡片，等待回答后继续原任务。回答不是文件或命令执行授权；取消会结束当前任务。",
        "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"questions\"],\"properties\":{\"questions\":{\"type\":\"array\",\"minItems\":1,\"maxItems\":3,\"items\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"id\",\"question\",\"type\"],\"properties\":{\"id\":{\"type\":\"string\"},\"question\":{\"type\":\"string\"},\"type\":{\"type\":\"string\",\"enum\":[\"single\",\"multi\",\"confirm\",\"input\"]},\"allowCustom\":{\"type\":\"boolean\"},\"options\":{\"type\":\"array\",\"maxItems\":10,\"items\":{\"type\":\"object\",\"required\":[\"id\",\"label\"],\"properties\":{\"id\":{\"type\":\"string\"},\"label\":{\"type\":\"string\"},\"description\":{\"type\":\"string\"}}}}}}}}}", false)
}

func questionString(obj: JsonObject, key: String, limit: Int64): String {
    let value = obj.get(key).getOrThrow().asString().getValue()
    if (value.trimAscii().size == 0 || value.size > limit) { throw Exception("question-invalid-${key}") }
    return value
}

public func validateQuestionSpec(raw: String): JsonArray {
    if (raw.size > 32768) { throw Exception("question-too-large") }
    let obj = JsonValue.fromStr(raw).asObject()
    if (obj.size() != 1) { throw Exception("question-invalid-spec") }
    let questions = obj.get("questions").getOrThrow().asArray()
    if (questions.size() < 1 || questions.size() > 3) { throw Exception("question-invalid-count") }
    let ids = HashSet<String>()
    for (value in questions.getItems()) {
        let q = value.asObject()
        let id = questionString(q, "id", 80)
        if (ids.contains(id)) { throw Exception("question-duplicate-id") }; ids.add(id)
        questionString(q, "question", 2000)
        let kind = questionString(q, "type", 20)
        if (kind != "single" && kind != "multi" && kind != "confirm" && kind != "input") { throw Exception("question-invalid-type") }
        if (let Some(custom) <- q.get("allowCustom")) { custom.asBool().getValue() }
        if (kind == "single" || kind == "multi") {
            let options = q.get("options").getOrThrow().asArray()
            if (options.size() < 2 || options.size() > 10) { throw Exception("question-invalid-options") }
            let optionIds = HashSet<String>()
            for (option in options.getItems()) {
                let entry = option.asObject()
                let optionId = questionString(entry, "id", 80)
                if (optionIds.contains(optionId)) { throw Exception("question-duplicate-option") }; optionIds.add(optionId)
                questionString(entry, "label", 200)
                if (let Some(description) <- entry.get("description")) {
                    if (description.asString().getValue().size > 400) { throw Exception("question-description-too-large") }
                }
            }
        }
    }
    return questions
}

public func validateQuestionAnswers(questions: JsonArray, raw: String): JsonArray {
    if (raw.size > 32768) { throw Exception("question-answer-too-large") }
    let answers = JsonValue.fromStr(raw).asArray()
    if (answers.size() != questions.size()) { throw Exception("question-answer-count") }
    let seen = HashSet<String>()
    for (value in answers.getItems()) {
        let answer = value.asObject()
        if (answer.size() != 3) { throw Exception("question-answer-fields") }
        let id = questionString(answer, "id", 80)
        if (seen.contains(id)) { throw Exception("question-answer-duplicate") }; seen.add(id)
        var found: ?JsonObject = None
        for (q in questions.getItems()) {
            if (q.asObject().get("id").getOrThrow().asString().getValue() == id) { found = Some(q.asObject()) }
        }
        let q = found.getOrThrow()
        let kind = q.get("type").getOrThrow().asString().getValue()
        let selected = answer.get("selectedIds").getOrThrow().asArray()
        let text = answer.get("text").getOrThrow().asString().getValue()
        let custom = if (let Some(flag) <- q.get("allowCustom")) { flag.asBool().getValue() } else { false }
        if (text.size > 8000 || (text.size > 0 && kind != "input" && !custom)) { throw Exception("question-custom-not-allowed") }
        if (kind != "multi" && selected.size() > 1) { throw Exception("question-single-only") }
        if (kind == "input" && selected.size() > 0) { throw Exception("question-input-selection") }
        if (selected.size() == 0 && text.trimAscii().size == 0) { throw Exception("question-answer-required") }
        let chosen = HashSet<String>()
        for (option in selected.getItems()) {
            let optionId = option.asString().getValue()
            if (chosen.contains(optionId)) { throw Exception("question-answer-duplicate-option") }; chosen.add(optionId)
            var valid = kind == "confirm" && (optionId == "yes" || optionId == "no")
            if (kind == "single" || kind == "multi") {
                for (entry in q.get("options").getOrThrow().asArray().getItems()) {
                    if (entry.asObject().get("id").getOrThrow().asString().getValue() == optionId) { valid = true }
                }
            }
            if (!valid) { throw Exception("question-invalid-selection") }
        }
    }
    return answers
}

// 复用既有 UserQuestionStore 的事件与一次性应答；等待只在模型线程，协议线程可取消。
public class StructuredUserQuestions {
    let log: SessionLog
    let store: UserQuestionStore
    let mutex = Mutex()
    let specs = HashMap<String, JsonArray>()
    var activeId = ""
    public let sessionId: String
    public init(log: SessionLog, sessionId: String) {
        this.log = log; this.sessionId = sessionId; store = UserQuestionStore(log)
    }
    public func activeQuestionId(): String { return synchronized(mutex) { activeId } }
    public func answer(session: String, id: String, raw: String, cancelled: Bool): Unit {
        synchronized(mutex) {
            if (session != sessionId) { throw Exception("question-session-changed") }
            if (id != activeId || store.status(id) != "pending") { throw Exception("question-already-settled") }
            if (cancelled) { store.cancel(id, "user-cancelled") }
            else { store.answer(id, validateQuestionAnswers(specs.get(id).getOrThrow(), raw).toString()) }
        }
    }
    public func ask(call: ModelToolCall, token: TurnToken, changed: () -> Unit, maxWaitMs!: Int64 = 300000): ApprovalOutcome {
        if (maxWaitMs < 25 || maxWaitMs > 300000) { throw Exception("question-invalid-timeout") }
        let questions = validateQuestionSpec(call.args)
        let id = "question-${log.eventCount()}"
        synchronized(mutex) {
            if (activeId.size > 0) { throw Exception("question-already-pending") }
            let spec = JsonObject()
            spec.put("kind", JsonString("sacode-question-card")); spec.put("questions", questions)
            spec.put("sessionId", JsonString(sessionId)); spec.put("callId", JsonString(call.id))
            store.ask(id, spec.toString()); specs[id] = questions; activeId = id
        }
        try {
            changed()
            var waited = Int64(0)
            while (waited < maxWaitMs) {
                let status = synchronized(mutex) { store.status(id) }
                if (token.cancelled()) {
                    synchronized(mutex) { store.cancel(id, "task-cancelled") }
                    return ApprovalOutcome(false, "cancelled")
                }
                if (status == "answered") {
                    let answer = synchronized(mutex) { store.answerOf(id) }
                    return ApprovalOutcome(true, "{\"answers\":${answer}}")
                }
                if (status == "cancelled") { token.cancel(); return ApprovalOutcome(false, "cancelled") }
                sleep(25 * Duration.millisecond); waited += 25
            }
            synchronized(mutex) { store.cancel(id, "timeout") }
            token.cancel()
            return ApprovalOutcome(false, "question-timeout")
        } finally { synchronized(mutex) { activeId = "" }; changed() }
    }
}

public func projectQuestionCards(events: Array<SessionEvent>, activeId!: String = ""): String {
    let cards = ArrayList<JsonObject>()
    let byId = HashMap<String, JsonObject>()
    for (event in events) {
        if (!event.eventType.startsWith("user-questions/")) { continue }
        let cut = event.data.indexOf("::") ?? Int64(-1)
        if (cut < 0) { continue }
        let id = event.data[0..cut]
        let payload = event.data[(cut + 2)..event.data.size]
        try {
            if (event.eventType == "user-questions/request") {
                let obj = JsonValue.fromStr(payload).asObject()
                if (obj.get("kind").getOrThrow().asString().getValue() != "sacode-question-card") { continue }
                obj.put("id", JsonString(id)); obj.put("status", JsonString(if (id == activeId) { "pending" } else { "unknown" }))
                cards.add(obj); byId[id] = obj
            } else if (let Some(card) <- byId.get(id)) {
                if (event.eventType == "user-questions/answer") {
                    card.put("status", JsonString("answered")); card.put("answers", JsonValue.fromStr(payload).asArray())
                } else if (event.eventType == "user-questions/cancel") { card.put("status", JsonString("cancelled")) }
            }
        } catch (_: Exception) { /* 旧版纯文本提问不伪装成结构化卡片。 */ }
    }
    let result = JsonArray()
    let start = if (cards.size > 32) { cards.size - 32 } else { Int64(0) }
    for (i in start..cards.size) { result.add(cards[i]) }
    return result.toString()
}
