package core

import std.collection.ArrayList
import std.collection.HashMap
import std.env.*
import std.fs.*
import stdx.encoding.json.*

public class HookSettings {
    public let policy: HookSecurityPolicy
    public let registry: HookRegistry

    public init(policy!: HookSecurityPolicy, registry!: HookRegistry) {
        this.policy = policy
        this.registry = registry
    }
}

func hookUserSettingsFile(): String {
    let home = getVariable("USERPROFILE") ?? (getVariable("HOME") ?? "")
    if (home.size == 0) { return "" }
    return Path(home).join(".sacode").join("settings.json").toString()
}

func hookProjectSettingsFile(repoRoot: String): String {
    return Path(repoRoot).join(".sacode").join("settings.json").toString()
}

func hookReadObject(file: String): Option<JsonObject> {
    if (file.size == 0 || !exists(file)) {
        return None
    }
    var text = ""
    try {
        text = String.fromUtf8(File.readFrom(file))
    } catch (_: Exception) {
        throw Exception("hook-settings-unreadable")
    }
    var parsed: JsonValue = JsonString("")
    try {
        parsed = JsonValue.fromStr(text)
    } catch (_: Exception) {
        throw Exception("hook-settings-invalid-json")
    }
    var object = JsonObject()
    try {
        object = parsed.asObject()
    } catch (_: Exception) {
        throw Exception("hook-settings-invalid-json")
    }
    return Some(object)
}

func hookStringField(object: JsonObject, key: String, detail: String): String {
    if (let Some(value) <- object.get(key)) {
        try {
            return value.asString().getValue()
        } catch (_: Exception) {
            throw Exception("hook-settings-bad-field")
        }
    }
    throw Exception("hook-settings-missing-${detail}")
}

func hookOptionalStringField(object: JsonObject, key: String): Option<String> {
    if (let Some(value) <- object.get(key)) {
        if (let JsonKind.JsNull <- value.kind()) {
            return None
        }
        try {
            return Some(value.asString().getValue())
        } catch (_: Exception) {
            throw Exception("hook-settings-bad-field")
        }
    }
    return None
}

func hookStringArrayField(object: JsonObject, key: String): Array<String> {
    let out = ArrayList<String>()
    if (let Some(value) <- object.get(key)) {
        var list = JsonArray()
        try {
            list = value.asArray()
        } catch (_: Exception) {
            throw Exception("hook-settings-bad-field")
        }
        for (index in 0..list.size()) {
            var item: JsonValue = JsonString("")
            try {
                item = list.get(index).getOrThrow()
            } catch (_: Exception) {
                throw Exception("hook-settings-bad-field")
            }
            try {
                out.add(item.asString().getValue())
            } catch (_: Exception) {
                throw Exception("hook-settings-bad-field")
            }
        }
    }
    return out.toArray()
}

func hookBoolField(object: JsonObject, key: String, fallback: Bool): Bool {
    if (let Some(value) <- object.get(key)) {
        try {
            return value.asBool().getValue()
        } catch (_: Exception) {
            throw Exception("hook-settings-bad-field")
        }
    }
    return fallback
}

func hookIntField(object: JsonObject, key: String, fallback: Int64): Int64 {
    if (let Some(value) <- object.get(key)) {
        try {
            return Int64(value.asInt().getValue())
        } catch (_: Exception) {
            throw Exception("hook-settings-bad-field")
        }
    }
    return fallback
}

func hookEnvMapField(object: JsonObject, key: String): HashMap<String, String> {
    let out = HashMap<String, String>()
    if (let Some(value) <- object.get(key)) {
        var table = JsonObject()
        try {
            table = value.asObject()
        } catch (_: Exception) {
            throw Exception("hook-settings-bad-field")
        }
        for ((name, item) in table.getFields()) {
            try {
                out[name] = item.asString().getValue()
            } catch (_: Exception) {
                throw Exception("hook-settings-bad-field")
            }
        }
    }
    return out
}

func hookEventOf(name: String): Option<HookEvent> {
    return match (name) {
        case "PreToolUse" => Some(HookEvent.PreToolUse)
        case "PostToolUse" => Some(HookEvent.PostToolUse)
        case "PostToolUseFailure" => Some(HookEvent.PostToolUseFailure)
        case "UserPromptSubmit" => Some(HookEvent.UserPromptSubmit)
        case "SessionStart" => Some(HookEvent.SessionStart)
        case "SessionEnd" => Some(HookEvent.SessionEnd)
        case "SessionDelete" => Some(HookEvent.SessionDelete)
        case "MessageDisplay" => Some(HookEvent.MessageDisplay)
        case "Stop" => Some(HookEvent.Stop)
        case "StopFailure" => Some(HookEvent.StopFailure)
        case "SubagentStart" => Some(HookEvent.SubagentStart)
        case "SubagentStop" => Some(HookEvent.SubagentStop)
        case "PreCompact" => Some(HookEvent.PreCompact)
        case "PostCompact" => Some(HookEvent.PostCompact)
        case "Notification" => Some(HookEvent.Notification)
        case "PermissionRequest" => Some(HookEvent.PermissionRequest)
        case "PermissionDenied" => Some(HookEvent.PermissionDenied)
        case "TodoCreated" => Some(HookEvent.TodoCreated)
        case "TodoCompleted" => Some(HookEvent.TodoCompleted)
        case "WebhookDelivery" => Some(HookEvent.WebhookDelivery)
        case "ScheduleFire" => Some(HookEvent.ScheduleFire)
        case "WorkflowStepStart" => Some(HookEvent.WorkflowStepStart)
        case "WorkflowStepDone" => Some(HookEvent.WorkflowStepDone)
        case "WorkflowStepFail" => Some(HookEvent.WorkflowStepFail)
        case _ => None
    }
}

func hookSecurityOf(object: Option<JsonObject>): Option<HookSecurityPolicy> {
    if (let Some(root) <- object) {
        if (let Some(value) <- root.get("security")) {
            var section = JsonObject()
            try {
                section = value.asObject()
            } catch (_: Exception) {
                throw Exception("hook-settings-bad-field")
            }
            return Some(HookSecurityPolicy(
                allowedHookUrls: hookStringArrayField(section, "allowedHookUrls"),
                allowedHookEnvVars: hookStringArrayField(section, "allowedHookEnvVars"),
                allowPrivateNetworkHooks: hookBoolField(section, "allowPrivateNetworkHooks", false)))
        }
    }
    return None
}

func hookRegisterFrom(registry: HookRegistry, object: Option<JsonObject>, origin: String, policy: HookSecurityPolicy): Unit {
    if (let Some(root) <- object) {
        if (let Some(value) <- root.get("hooks")) {
            var block = JsonObject()
            try {
                block = value.asObject()
            } catch (_: Exception) {
                throw Exception("hook-settings-bad-field")
            }
            for ((eventName, entries) in block.getFields()) {
                if (let Some(event) <- hookEventOf(eventName)) {
                    var groups = JsonArray()
                    try {
                        groups = entries.asArray()
                    } catch (_: Exception) {
                        throw Exception("hook-settings-bad-field")
                    }
                    for (groupIndex in 0..groups.size()) {
                        var group = JsonObject()
                        try {
                            group = groups.get(groupIndex).getOrThrow().asObject()
                        } catch (_: Exception) {
                            throw Exception("hook-settings-bad-field")
                        }
                        let matcher = match (hookOptionalStringField(group, "matcher")) {
                            case Some(text) => text
                            case None => ""
                        }
                        var hooks = JsonArray()
                        if (let Some(listValue) <- group.get("hooks")) {
                            try {
                                hooks = listValue.asArray()
                            } catch (_: Exception) {
                                throw Exception("hook-settings-bad-field")
                            }
                        } else {
                            throw Exception("hook-settings-missing-hooks")
                        }
                        for (hookIndex in 0..hooks.size()) {
                            var item = JsonObject()
                            try {
                                item = hooks.get(hookIndex).getOrThrow().asObject()
                            } catch (_: Exception) {
                                throw Exception("hook-settings-bad-field")
                            }
                            let execType = hookStringField(item, "type", "type")
                            let timeout = hookIntField(item, "timeout", 30000)
                            let isAsync = hookBoolField(item, "async", false)
                            var executor: HookExecutorConfig = HookExecutorConfig.Command(execType, None, HashMap<String, String>())
                            if (execType == "command") {
                                executor = HookExecutorConfig.Command(
                                    hookStringField(item, "command", "command"),
                                    hookOptionalStringField(item, "shell"),
                                    hookEnvMapField(item, "env"))
                            } else if (execType == "http") {
                                executor = HookExecutorConfig.Http(
                                    hookStringField(item, "url", "url"),
                                    hookEnvMapField(item, "headers"),
                                    policy.allowedHookEnvVars)
                            } else {
                                throw Exception("hook-settings-unknown-executor-type")
                            }
                            registry.register(HookRule(
                                id: "${origin}:${eventName}:${groupIndex}:${hookIndex}",
                                event: event,
                                matcher: matcher,
                                executor: executor,
                                timeout: timeout,
                                asyncExecute: isAsync))
                        }
                    }
                } else {
                    throw Exception("hook-settings-unknown-event")
                }
            }
        }
    }
}

public func loadHookSettings(repoRoot: String, userFile!: String = hookUserSettingsFile()): HookSettings {
    let projectObject = hookReadObject(hookProjectSettingsFile(repoRoot))
    let userObject = hookReadObject(userFile)
    var policy = HookSecurityPolicy()
    if (let Some(fromProject) <- hookSecurityOf(projectObject)) {
        policy = fromProject
    } else if (let Some(fromUser) <- hookSecurityOf(userObject)) {
        policy = fromUser
    }
    let registry = HookRegistry.withPolicy(policy)
    hookRegisterFrom(registry, userObject, "user", policy)
    hookRegisterFrom(registry, projectObject, "project", policy)
    return HookSettings(policy: policy, registry: registry)
}
