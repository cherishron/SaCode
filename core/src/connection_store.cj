package core

import std.fs.*
import std.collection.*
import stdx.encoding.json.*

public class ConnectionDefinitionStore {
    let root: String
    let path: String
    public let scope: String
    public let workspace: String

    public init(directory: String, scope: String, workspace: String) {
        if (scope != "user" && scope != "project") { throw Exception("connection-bad-scope") }
        root = canonicalize(directory).toString()
        this.scope = scope
        this.workspace = if (scope == "project") { canonicalize(workspace).toString() } else { "" }
        if (!FileInfo(root).isDirectory() || (scope == "project" && !FileInfo(this.workspace).isDirectory())) {
            throw Exception("connection-path-rejected")
        }
        let key = if (scope == "user") { "user" } else { sha256Hex(this.workspace.toArray()) }
        path = "${root}/connections-${key}.log"
    }

    public static func forScope(scope: String, workspace: String): ConnectionDefinitionStore {
        return ConnectionDefinitionStore(Path(GlobalAppearanceSettings.forUser().settingsPath()).parent.toString(), scope, workspace)
    }

    func closed(object: JsonObject, keys: Array<String>): Unit {
        if (object.size() != keys.size) { throw Exception("connection-bad-definition") }
        for (key in keys) { if (object.get(key).isNone()) { throw Exception("connection-bad-definition") } }
    }

    func text(object: JsonObject, key: String, limit: Int64): String {
        let value = object.get(key).getOrThrow().asString().getValue()
        if (value.size == 0 || value.size > limit || value.contains("\u{0}")) { throw Exception("connection-bad-definition") }
        return value
    }

    func identifier(value: String): Unit {
        if (value.size == 0 || value.size > 80) { throw Exception("connection-bad-id") }
        for (byte in value.toArray()) {
            if (!((byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 90) ||
                (byte >= 97 && byte <= 122) || byte == 45 || byte == 95)) { throw Exception("connection-bad-id") }
        }
    }

    func credential(value: String): Unit {
        if (value.size == 0 || value.size > 128) { throw Exception("connection-bad-credential-ref") }
        var first = true
        for (byte in value.toArray()) {
            if (!((byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122) || byte == 95 ||
                (!first && byte >= 48 && byte <= 57))) { throw Exception("connection-bad-credential-ref") }
            first = false
        }
    }

    func validate(input: String): JsonObject {
        if (input.size > 65536) { throw Exception("connection-definition-too-large") }
        let row = JsonValue.fromStr(input).asObject()
        closed(row, ["id", "title", "kind", "enabled", "spec"])
        identifier(text(row, "id", 80))
        let title = text(row, "title", 600)
        if (title.trimAscii().size == 0) { throw Exception("connection-bad-definition") }
        row["enabled"].asBool().getValue()
        let kind = text(row, "kind", 16)
        let spec = row["spec"].asObject()
        if (kind == "ssh" || kind == "database") {
            if (kind == "ssh") { closed(spec, ["host", "port", "user", "credentialRef"]) }
            else { closed(spec, ["engine", "host", "port", "database", "user", "credentialRef", "tlsMode"]) }
            let host = text(spec, "host", 253)
            if (host.startsWith("-") || host.contains("/") || host.contains("\\") || host.contains("@") ||
                host.contains(" ") || host.contains("\n") || host.contains("\r")) { throw Exception("connection-bad-host") }
            let port = spec["port"].asInt().getValue()
            if (port < 1 || port > 65535) { throw Exception("connection-bad-port") }
            text(spec, "user", 256)
            credential(text(spec, "credentialRef", 128))
            if (kind == "database") {
                let engine = text(spec, "engine", 16)
                if (engine != "postgresql" && engine != "mysql" && engine != "dm") { throw Exception("connection-bad-engine") }
                text(spec, "database", 256)
                if (text(spec, "tlsMode", 32) != "verify-full") { throw Exception("connection-tls-required") }
            }
        } else if (kind == "mcp") {
            let transport = text(spec, "transport", 16)
            if (transport == "stdio") {
                closed(spec, ["transport", "command", "args", "envRefs"])
                text(spec, "command", 4096)
                let args = spec["args"].asArray()
                if (args.size() > 100) { throw Exception("connection-bad-definition") }
                for (arg in args.getItems()) {
                    let value = arg.asString().getValue()
                    if (value.size > 4096 || value.contains("\u{0}")) { throw Exception("connection-bad-definition") }
                }
                let refs = spec["envRefs"].asArray()
                if (refs.size() > 128) { throw Exception("connection-bad-definition") }
                let seen = HashMap<String, Bool>()
                for (entry in refs.getItems()) {
                    let ref = entry.asObject()
                    closed(ref, ["key", "credentialRef"])
                    let key = text(ref, "key", 128)
                    credential(key)
                    if (key.startsWith("SACODE_") || key == "PATH" || key == "NODE_OPTIONS" ||
                        key == "LD_PRELOAD" || key == "DYLD_INSERT_LIBRARIES" || seen.contains(key)) {
                        throw Exception("connection-bad-environment")
                    }
                    seen[key] = true
                    credential(text(ref, "credentialRef", 128))
                }
            } else if (transport == "http") {
                closed(spec, ["transport", "endpoint", "credentialRef"])
                let endpoint = text(spec, "endpoint", 4096)
                if (!webUrlAllowed(endpoint) || !endpoint.startsWith("https://") || endpoint.contains("?") || endpoint.contains("#")) {
                    throw Exception("connection-bad-endpoint")
                }
                credential(text(spec, "credentialRef", 128))
            } else { throw Exception("connection-bad-transport") }
        } else { throw Exception("connection-bad-kind") }
        return row
    }

    func load(): SessionLog {
        if (exists(path) && (canonicalize(path).parent.toString() != root || !FileInfo(path).isRegular() ||
            FileInfo(path).size > 16777216)) { throw Exception("connection-path-rejected") }
        let log = SessionLog(path)
        if (!log.load() || log.isTruncatedTail()) { throw Exception("connection-replay-rejected") }
        return log
    }

    func replay(log: SessionLog): ArrayList<JsonObject> {
        let rows = ArrayList<JsonObject>()
        for (event in log.snapshotEvents()) {
            if (event.eventType == "connection/definition") {
                let row = validate(event.data)
                let id = row["id"].asString().getValue()
                var found = false
                for (i in 0..rows.size) {
                    if (rows[i]["id"].asString().getValue() == id) { rows[i] = row; found = true; break }
                }
                if (!found) { rows.add(row) }
            } else if (event.eventType == "connection/remove") {
                identifier(event.data)
                var found = false
                for (i in 0..rows.size) {
                    if (rows[i]["id"].asString().getValue() == event.data) { rows.remove(at: i); found = true; break }
                }
                if (!found) { throw Exception("connection-replay-rejected") }
            } else { throw Exception("connection-replay-rejected") }
        }
        if (rows.size > 100) { throw Exception("connection-capacity") }
        return rows
    }

    func view(log: SessionLog): String {
        let result = JsonObject()
        result.put("scope", JsonString(scope)); result.put("workspace", JsonString(workspace))
        result.put("revision", JsonInt(log.eventCount()))
        let definitions = JsonArray()
        for (row in replay(log)) { definitions.add(row) }
        result.put("definitions", definitions)
        return result.toString()
    }

    public func describe(): String { return view(load()) }

    func mutate(expected: Int64, change: (SessionLog, ArrayList<JsonObject>) -> Unit): String {
        if (expected < 0) { throw Exception("connection-bad-revision") }
        let lease = WriteLease(path)
        if (!lease.takeoverIfStale()) { throw Exception("connection-busy") }
        try {
            let log = load()
            if (log.eventCount() != expected) { throw Exception("connection-revision-conflict") }
            change(log, replay(log))
            if (!lease.protects(path) || !log.durableCheckpoint(lease)) { throw Exception("connection-persistence-failed") }
            return view(log)
        } finally { lease.release() }
    }

    public func save(input: String, expected: Int64): String {
        let row = validate(input)
        return mutate(expected, { log, rows =>
            var found = false
            for (old in rows) { if (old["id"].asString().getValue() == row["id"].asString().getValue()) { found = true } }
            if (!found && rows.size >= 100) { throw Exception("connection-capacity") }
            log.append("connection/definition", row.toString())
        })
    }

    public func control(id: String, action: String, expected: Int64): String {
        identifier(id)
        if (action != "enable" && action != "disable" && action != "remove") { throw Exception("connection-bad-action") }
        return mutate(expected, { log, rows =>
            var found = false
            for (row in rows) {
                if (row["id"].asString().getValue() != id) { continue }
                found = true
                if (action == "remove") { log.append("connection/remove", id) }
                else {
                    row.put("enabled", JsonBool(action == "enable"))
                    log.append("connection/definition", row.toString())
                }
                break
            }
            if (!found) { throw Exception("connection-not-found") }
        })
    }
}
