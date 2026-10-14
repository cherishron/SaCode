package core

import std.collection.*
import std.env.getVariable
import std.fs.*
import std.time.DateTime
import stdx.encoding.json.*

func openCodeMetadataText(value: JsonObject, key: String, limit!: Int64 = 256): String {
    let text = value.get(key).getOrThrow().asString().getValue()
    if (text.size == 0 || text.size > limit) {
        throw Exception("invalid-opencode-metadata")
    }
    for (byte in text.toArray()) {
        if (byte < 32 || byte == 127) {
            throw Exception("invalid-opencode-metadata")
        }
    }
    return text
}

func openCodeMetadataRef(value: JsonValue): JsonValue {
    if (value is JsonNull) {
        return JsonNull()
    }
    let source = value.asObject();
    let result = JsonObject()
    result.put("providerId", JsonString(openCodeMetadataText(source, "providerId")))
    result.put("modelId", JsonString(openCodeMetadataText(source, "modelId")))
    if (let Some(variant) <- source.get("variant")) {
        result.put("variant", JsonString(openCodeMetadataText(source, "variant")))
    }
    return result
}

func openCodeMetadataSection(root: JsonObject, key: String, limit: Int64): (JsonObject, JsonArray) {
    let section = root.get(key).getOrThrow().asObject()
    let status = openCodeMetadataText(section, "status")
    let complete = section.get("complete").getOrThrow().asBool().getValue()
    let items = section.get("items").getOrThrow().asArray()
    if ((status != "observed" && status != "unknown") || items.size() > limit || (status == "unknown" && (complete ||
        items.size() != 0))) {
        throw Exception("invalid-opencode-metadata")
    }
    let result = JsonObject();
    result.put("status", JsonString(status));
    result.put("complete", JsonBool(complete))
    return (result, items)
}

func openCodeMetadataAvailability(value: JsonValue, known: HashSet<String>, complete: Bool): String {
    if (value is JsonNull) {
        return "inherits-default"
    }
    let ref = value.asObject()
    let key = openCodeMetadataText(ref, "providerId") + "\n" + openCodeMetadataText(ref, "modelId")
    if (known.contains(key)) {
        return "listed"
    }
    return if (complete) {
        "not-listed"
    } else {
        "unknown"
    }
}

// 丢弃任何未列明字段（包括 nonce）；只保存与同一次 ACP 会话绑定的注册表事实。
func sanitizeOpenCodeMetadata(raw: String, diagnosticId: String, nonce: String, workspace: String, sessionId: String,
    started: Int64, expires: Int64): String {
    if (raw.toArray().size > 262144) {
        throw Exception("opencode-metadata-too-large")
    }
    let source = JsonValue.fromStr(raw).asObject()
    if (source.get("version").getOrThrow().asInt().getValue() != 1 || openCodeMetadataText(source, "source") !=
        "opencode-v2-plugin" || openCodeMetadataText(source, "implementation") != "sacode-diagnostics-0.1.0" ||
        openCodeMetadataText(source, "diagnosticId") != diagnosticId || openCodeMetadataText(source, "nonce") != nonce ||
        openCodeMetadataText(source, "directory", limit: 4096) != workspace ||
        openCodeMetadataText(source, "sessionId") != sessionId || openCodeMetadataText(source, "providerVersion") !=
        "2.0.28") {
        throw Exception("opencode-metadata-binding-mismatch")
    }
    let captured = source.get("capturedAt").getOrThrow().asInt().getValue()
    let pid = source.get("providerPid").getOrThrow().asInt().getValue()
    if (captured < started || captured > expires || pid < 1 || pid > 4294967295) {
        throw Exception("invalid-opencode-metadata")
    }
    let result = JsonObject()
    result.put("version", JsonInt(1));
    result.put("source", JsonString("opencode-v2-plugin"))
    result.put("binding", JsonString("request-and-acp-session"));
    result.put("sessionId", JsonString(sessionId))
    result.put("directory", JsonString(workspace));
    result.put("providerVersion", JsonString("2.0.28"))
    result.put("providerPid", JsonInt(pid));
    result.put("osUser", JsonString(openCodeMetadataText(source, "osUser")))
    result.put("capturedAt", JsonInt(captured))
    let (modelSection, modelRows) = openCodeMetadataSection(source, "models", 256)
    let known = HashSet<String>();
    let models = JsonArray()
    for (index in 0..modelRows.size()) {
        let row = modelRows.get(index).getOrThrow().asObject()
        let copy = openCodeMetadataRef(row).asObject()
        let enabled = row.get("enabled").getOrThrow().asBool().getValue()
        copy.put("enabled", JsonBool(enabled));
        models.add(copy)
        if (enabled) {
            known.add(openCodeMetadataText(copy, "providerId") + "\n" + openCodeMetadataText(copy, "modelId"))
        }
    }
    modelSection.put("items", models);
    result.put("models", modelSection)
    let complete = modelSection.get("complete").getOrThrow().asBool().getValue()
    let defaultSource = source.get("defaultModel").getOrThrow().asObject()
    let selected = openCodeMetadataRef(defaultSource.get("ref").getOrThrow())
    let defaultModel = JsonObject();
    defaultModel.put("ref", selected)
    defaultModel.put("availability", JsonString(if (selected is JsonNull) {
        "unknown"
    } else {
        openCodeMetadataAvailability(selected, known, complete)
    }))
    result.put("defaultModel", defaultModel)
    let (agentSection, agentRows) = openCodeMetadataSection(source, "agents", 128)
    let agents = JsonArray()
    for (index in 0..agentRows.size()) {
        let row = agentRows.get(index).getOrThrow().asObject();
        let copy = JsonObject()
        copy.put("id", JsonString(openCodeMetadataText(row, "id")))
        let mode = openCodeMetadataText(row, "mode")
        if (mode != "primary" && mode != "subagent" && mode != "all") {
            throw Exception("invalid-opencode-metadata")
        }
        copy.put("mode", JsonString(mode))
        let model = openCodeMetadataRef(row.get("model").getOrThrow());
        copy.put("model", model)
        // 无模型继承与无法解析模型不同；后者不能被当作安全默认。
        let availability = if (model is JsonNull) {
            if (openCodeMetadataText(row, "availability") == "inherits-default") {
                "inherits-default"
            } else {
                "unknown"
            }
        } else {
            openCodeMetadataAvailability(model, known, complete)
        }
        copy.put("availability", JsonString(availability));
        agents.add(copy)
    }
    agentSection.put("items", agents);
    result.put("agents", agentSection)
    let (pluginSection, pluginRows) = openCodeMetadataSection(source, "plugins", 64)
    let plugins = JsonArray()
    for (index in 0..pluginRows.size()) {
        let row = pluginRows.get(index).getOrThrow().asObject();
        let copy = JsonObject()
        copy.put("id", JsonString(openCodeMetadataText(row, "id")))
        let status = openCodeMetadataText(row, "status")
        if (status != "ready" && status != "loading" && status != "failed" && status != "disabled" && status != "unknown") {
            throw Exception("invalid-opencode-metadata")
        }
        copy.put("status", JsonString(status));
        plugins.add(copy)
    }
    pluginSection.put("items", plugins);
    result.put("plugins", pluginSection)
    result.put("configSources", JsonString("not-exposed"));
    result.put("price", JsonString("unknown"))
    result.put("dynamicRoutes", JsonString("unknown"));
    result.put("modelTask", JsonString("not-tested"))
    return result.toString()
}

@When[os == "Windows"]
func openCodeMetadataTemp(): String {
    return getVariable("TEMP") ?? getVariable("TMP") ?? ""
}

@When[os != "Windows"]
func openCodeMetadataTemp(): String {
    return getVariable("TMPDIR") ?? getVariable("TMP") ?? getVariable("TEMP") ?? "/tmp"
}

func openCodeMetadataEnvironment(previous: Array<(String, String)>, request: String): Array<(String, String)> {
    let values = ArrayList<(String, String)>()
    for ((key, value) in previous) {
        if (key.toAsciiLower() != "sacode_acp_metadata_request") {
            values.add((key, value))
        }
    }
    values.add(("SACODE_ACP_METADATA_REQUEST", request))
    return values.toArray()
}

class OpenCodeProbeMetadata {
    public let diagnosticId = "acp-" + randomHex(16)
    let nonce = randomHex(32)
    let workspace: String
    let started = DateTime.now().toUnixTimeStamp().toMilliseconds()
    let expires: Int64
    var root = ""
    init(workspace: String) {
        this.workspace = workspace
        this.expires = started + 90000
        try {
            let selectedTemp = openCodeMetadataTemp()
            if (selectedTemp.size == 0) {
                return
            }
            let temp = canonicalize(selectedTemp).toString()
            let candidate = Path(temp).join("sacode-acp-metadata-" + randomHex(16)).toString()
            if (exists(candidate)) {
                return
            }
            Directory.create(candidate)
            root = canonicalize(candidate).toString()
            let request = JsonObject();
            request.put("version", JsonInt(1))
            request.put("diagnosticId", JsonString(diagnosticId));
            request.put("nonce", JsonString(nonce))
            request.put("directory", JsonString(workspace));
            request.put("expiresAt", JsonInt(expires))
            File.writeTo(Path(root).join("request.json"), request.toString().toArray())
        } catch (_: Exception) {}
    }
    func environment(previous: Array<(String, String)>): Array<(String, String)> {
        // 空值也覆盖继承的旧检查请求，防止进程误写别的诊断目录。
        return openCodeMetadataEnvironment(previous, if (root.size > 0) {
            Path(root).join("request.json").toString()
        } else {
            ""
        })
    }
    func readBounded(path: String): String {
        let file = File(path, OpenMode.Read);
        let output = ArrayList<Byte>();
        let buffer = Array<Byte>(4096, repeat: 0)
        try {
            while (true) {
                let count = file.read(buffer);
                if (count <= 0) {
                    break
                }
                if (output.size + count > 262144) {
                    throw Exception("opencode-metadata-too-large")
                }
                for (index in 0..count) {
                    output.add(buffer[index])
                }
            }
            return String.fromUtf8(output.toArray())
        } finally {
            file.close()
        }
    }
    func observe(previous: AcpProbeObservation, session: String, token: TurnToken): AcpProbeObservation {
        if (root.size == 0 || token.cancelled() || previous.agentName != "OpenCode" || previous.agentVersion != "2.0.28") {
            return previous
        }
        let path = Path(root).join("snapshot.json").toString()
        if (!exists(path)) {
            return previous
        }
        for (_ in 0..150) {
            if (token.cancelled()) {
                return previous
            }
            try {
                if (canonicalize(path).toString() != path) {
                    return previous
                }
                let raw = readBounded(path);
                let value = JsonValue.fromStr(raw).asObject()
                if (value.get("phase").isNone()) {
                    return previous.withInstanceMetadata(
                        sanitizeOpenCodeMetadata(raw, diagnosticId, nonce, workspace, session, started, expires))
                }
                if (openCodeMetadataText(value, "phase") != "waiting-session" ||
                    openCodeMetadataText(value, "diagnosticId") != diagnosticId ||
                    openCodeMetadataText(value, "nonce") != nonce ||
                    openCodeMetadataText(value, "directory", limit: 4096) != workspace) {
                    return previous
                }
            } catch (_: Exception) {
                return previous
            }
            sleep(10 * Duration.millisecond)
        }
        return previous
    }
    func close(): Unit {
        if (root.size == 0) {
            return
        }
        try {
            if (canonicalize(root).toString() == root && Path(root).fileName.startsWith("sacode-acp-metadata-")) {
                removeIfExists(root, recursive: true)
            }
        } catch (_: Exception) {}
    }
}
