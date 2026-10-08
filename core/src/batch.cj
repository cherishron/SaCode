package core
import std.fs.*
import std.env.*
import std.collection.*
import std.sort.*
import std.convert.*
import stdx.encoding.json.*

// P0 只校验独立配置、预览计划和管理已有本地记录；无创建任务或远端状态桩。
// 计划 inputs/outputDir 是本地提案：上游用户页没有公开完整计划 schema。
public func batchSnapshot(parts: Array<String>): String {
    let bytes = ArrayList<Byte>()
    for (part in parts) {
        // 十进制字节长度加冒号分帧，正文可含零字节且边界无歧义。
        for (b in "${part.toArray().size}:".toArray()) { bytes.add(b) }
        for (b in part.toArray()) { bytes.add(b) }
    }
    return sha256Hex(bytes.toArray())
}

func batchString(obj: JsonObject, key: String, fallback!: String = ""): String {
    if (let Some(v) <- obj.get(key)) { return v.asString().getValue() }
    return fallback
}

public func validateBatchTaskId(id: String): Unit {
    if (id.size == 0 || id.size > 100) { throw Exception("batch-task-id-invalid") }
    for (b in id.toArray()) {
        if (!((b >= 48 && b <= 57) || (b >= 65 && b <= 90) || (b >= 97 && b <= 122) || b == 45 || b == 95)) {
            throw Exception("batch-task-id-invalid")
        }
    }
    let upper = id.toAsciiUpper()
    for (reserved in ["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"]) {
        if (upper == reserved) { throw Exception("batch-task-id-invalid") }
    }
}

// canonicalize 要求目标存在；未创建路径递归解析最近存在的父目录，仍解析链接。
func batchResolve(path: String): String {
    let p = Path(path)
    if (exists(p)) { return canonicalize(p).toString() }
    let parent = p.parent.toString()
    if (parent.size == 0 || parent == path) { throw Exception("batch-path-rejected") }
    let name = p.fileName
    if (name == "." || name == ".." || name.size == 0) { throw Exception("batch-path-rejected") }
    return Path(batchResolve(parent)).join(name).toString()
}

public class BatchStore {
    let project: String
    let root: String
    let configPath: String
    public init(project: String, root: String, configPath: String) {
        this.project = canonicalize(project).toString()
        this.root = batchResolve(if (Path(root).isAbsolute()) { root } else { "${this.project}/${root}" })
        this.configPath = configPath
    }
    func confined(path: String, parent: String): String {
        let resolved = batchResolve(path)
        let base = batchResolve(parent)
        if (resolved != base && !resolved.startsWith("${base}/") && !resolved.startsWith("${base}\\")) {
            throw Exception("batch-path-rejected")
        }
        return resolved
    }
    func settings(): JsonObject {
        if (!exists(configPath)) { throw Exception("batch-config-missing") }
        return JsonValue.fromStr(String.fromUtf8(File.readFrom(configPath))).asObject()
    }
    public func check(): JsonObject {
        let all = settings()
        let cfg = all["batch"].asObject()
        let model = batchString(cfg, "model")
        let auth = batchString(cfg, "authType", fallback: "openai")
        if (model.trimAscii().size == 0) { throw Exception("batch-model-missing") }
        if (auth != "openai") { throw Exception("batch-auth-unsupported") }
        var url = batchString(cfg, "baseUrl")
        var ref = batchString(cfg, "credentialRef")
        var wire = batchString(cfg, "wireApi", fallback: "chat-completions")
        // 同时接受上游 settings.modelProviders 的独立 batch 模型选择。
        if (let Some(providers) <- all.get("modelProviders")) {
            var count: Int64 = 0
            let entries = providers.asObject()[auth].asArray()
            for (i in 0..entries.size()) {
                let entry = entries[i].asObject()
                if (batchString(entry, "id") == model && (url.size == 0 || batchString(entry, "baseUrl") == url)) {
                    count += 1
                    url = batchString(entry, "baseUrl")
                    ref = batchString(entry, "envKey")
                    wire = batchString(entry, "wireApi", fallback: "chat-completions")
                }
            }
            if (count != 1) { throw Exception("batch-provider-ambiguous-or-missing") }
        }
        if (wire != "chat-completions") { throw Exception("batch-wire-api-unsupported") }
        if (!url.startsWith("https://") || url.size <= 8 || url.contains("@") || url.contains("?") || url.contains("#")) {
            throw Exception("batch-url-invalid")
        }
        if (ref.size == 0 || ref.size > 100) { throw Exception("batch-credential-ref-invalid") }
        for (b in ref.toArray()) {
            if (!((b >= 48 && b <= 57) || (b >= 65 && b <= 90) || (b >= 97 && b <= 122) || b == 95)) {
                throw Exception("batch-credential-ref-invalid")
            }
        }
        var secret = getVariable(ref) ?? ""
        if (let Some(env) <- all.get("env")) {
            if (let Some(value) <- env.asObject().get(ref)) { secret = value.asString().getValue() }
        }
        if (secret.trimAscii().size == 0) { throw Exception("batch-credential-missing") }
        let result = JsonObject()
        result.put("model", JsonString(model)); result.put("authType", JsonString(auth))
        result.put("baseUrl", JsonString(url)); result.put("credentialRef", JsonString(ref))
        result.put("wireApi", JsonString(wire))
        return result
    }
    func outputPath(path: String): String {
        let normalized = path.replace("\\", "/")
        if (normalized.size == 0 || normalized.startsWith("/") || normalized.contains(":")) { throw Exception("batch-output-invalid") }
        for (part in normalized.split("/")) {
            if (part.size == 0 || part.startsWith(".") || part.endsWith(".") || part.endsWith(" ")) { throw Exception("batch-output-invalid") }
        }
        return confined("${project}/${normalized}", project)
    }
    func price(kind: String): Option<Float64> {
        let value = getVariable("QWEN_BATCH_${kind}_PRICE_PER_1M_USD") ?? ""
        if (value.size == 0) { return None }
        let n = Float64.parse(value)
        if (n < 0.0 || n.isNaN() || n.isInf()) { throw Exception("batch-price-invalid") }
        return Some(n)
    }
    public func preview(planPath: String, expect: String): JsonObject {
        let cfg = check()
        let original = String.fromUtf8(File.readFrom(planPath))
        let plan = JsonValue.fromStr(original).asObject()
        let output = outputPath(plan["outputDir"].asString().getValue())
        let maxTokens = plan["maxOutputTokens"].asInt().getValue()
        if (maxTokens <= 0 || maxTokens > 1000000) { throw Exception("batch-output-tokens-invalid") }
        if (let Some(budget) <- plan.get("thinking_budget")) {
            if (budget.asInt().getValue() < 0) { throw Exception("batch-thinking-budget-invalid") }
        }
        let frames = ArrayList<String>()
        frames.add("sacode-batch-preview-v1"); frames.add(canonicalize(planPath).toString()); frames.add(original)
        frames.add(cfg.toString())
        // 只纳入相关 batch/provider 配置，不把明文凭证写入预览或快照材料。
        let all = settings()
        frames.add(all["batch"].toString())
        if (let Some(providers) <- all.get("modelProviders")) { frames.add(providers.toString()) }
        let inputs = plan["inputs"].asArray()
        let captured = JsonArray()
        var inputBytes: Int64 = 0
        for (i in 0..inputs.size()) {
            let name = inputs[i].asString().getValue()
            let path = if (Path(name).isAbsolute()) { name } else { "${project}/${name}" }
            let resolved = confined(path, project)
            let content = String.fromUtf8(File.readFrom(resolved))
            frames.add(name); frames.add(resolved); frames.add(content)
            inputBytes += content.toArray().size
            let item = JsonObject(); item.put("path", JsonString(name)); item.put("content", JsonString(content)); captured.add(item)
        }
        let inputPrice = price("INPUT"); let outputPrice = price("OUTPUT")
        frames.add(getVariable("QWEN_BATCH_INPUT_PRICE_PER_1M_USD") ?? "unknown")
        frames.add(getVariable("QWEN_BATCH_OUTPUT_PRICE_PER_1M_USD") ?? "unknown")
        let snapshot = batchSnapshot(frames.toArray())
        if (expect.size > 0 && expect != snapshot) { throw Exception("batch-snapshot-mismatch") }
        let result = JsonObject()
        result.put("snapshot", JsonString(snapshot)); result.put("planRaw", JsonString(original)); result.put("plan", plan)
        result.put("inputs", captured); result.put("config", cfg); result.put("outputDir", JsonString(output))
        result.put("dryRun", JsonBool(true)); result.put("submitted", JsonBool(false))
        result.put("estimatedInputTokens", JsonInt((inputBytes + 3) / 4))
        result.put("estimatedOutputTokens", JsonInt(maxTokens * inputs.size()))
        result.put("tokenEstimateMethod", JsonString("rough-utf8-bytes-div-4"))
        result.put("costEstimateUsd", JsonNull()); result.put("costStatus", JsonString("unknown-price"))
        if (let Some(ip) <- inputPrice) {
            if (let Some(op) <- outputPrice) {
                let cost = (Float64((inputBytes + 3) / 4) * ip + Float64(maxTokens * inputs.size()) * op) / 1000000.0
                result.put("costEstimateUsd", JsonFloat(cost)); result.put("costStatus", JsonString("rough-estimate-not-billing"))
                if (let Some(limit) <- plan.get("maxCostUsd")) {
                    let n = match (limit.kind()) { case JsInt => Float64(limit.asInt().getValue()); case _ => limit.asFloat().getValue() }
                    if (n < 0.0 || cost > n) { throw Exception("batch-budget-exceeded") }
                }
            }
        }
        return result
    }
    func taskDir(id: String): String {
        validateBatchTaskId(id)
        confined("${root}/tasks", root)
        return confined("${root}/tasks/${id}", "${root}/tasks")
    }
    public func readTask(id: String): JsonObject {
        let directory = taskDir(id)
        let path = confined("${directory}/task.json", directory)
        if (!exists(path)) { throw Exception("batch-task-not-found") }
        let record = JsonValue.fromStr(String.fromUtf8(File.readFrom(path))).asObject()
        if (record["id"].asString().getValue() != id) { throw Exception("batch-task-id-mismatch") }
        return record
    }
    public func list(): JsonArray {
        let result = JsonArray()
        let directory = confined("${root}/tasks", root)
        if (!exists(directory)) { return result }
        let names = ArrayList<String>()
        for (entry in Directory.readFrom(directory)) { if (entry.isDirectory()) { names.add(entry.name) } }
        let ordered = names.toArray(); sort(ordered)
        for (id in ordered) { result.add(readTask(id)) }
        return result
    }
    public func clean(id: String, force: Bool): Unit {
        let record = readTask(id)
        // 上游未公开完整记录 schema，P0 不臆测哪些远端状态可以无确认删除。
        if (!force) { throw Exception("batch-clean-force-required") }
        let directory = taskDir(id)
        let lease = WriteLease(directory)
        if (!lease.acquire()) { throw Exception("batch-task-busy") }
        try { readTask(id); remove(directory, recursive: true) } finally { lease.release() }
    }
}
