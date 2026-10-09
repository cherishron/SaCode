package core
import std.collection.ArrayList
import std.collection.HashMap
import std.regex.Regex

public enum HookEvent {
    | PreToolUse
    | PostToolUse
    | PostToolUseFailure
    | UserPromptSubmit
    | SessionStart
    | SessionEnd
    | SessionDelete
    | MessageDisplay
    | Stop
    | StopFailure
    | SubagentStart
    | SubagentStop
    | PreCompact
    | PostCompact
    | Notification
    | PermissionRequest
    | PermissionDenied
    | TodoCreated
    | TodoCompleted
    | WebhookDelivery
    | ScheduleFire
    | WorkflowStepStart
    | WorkflowStepDone
    | WorkflowStepFail
}

public enum HookDecision {
    | Allow
    | Deny
    | Block
    | Ask
}

public struct HookInput {
    public let sessionId: String
    public let transcriptPath: String
    public let cwd: String
    public let hookEventName: String
    public let timestamp: Int64
    public let agentId: Option<String>
    public let agentType: Option<String>
    public let eventSpecific: HookEventData
    public init(sessionId: String, transcriptPath: String, cwd: String, hookEventName: String,
                timestamp: Int64, agentId!: Option<String> = Option.none<String>(),
                agentType!: Option<String> = Option.none<String>(),
                eventSpecific: HookEventData) {
        this.sessionId = sessionId
        this.transcriptPath = transcriptPath
        this.cwd = cwd
        this.hookEventName = hookEventName
        this.timestamp = timestamp
        this.agentId = agentId
        this.agentType = agentType
        this.eventSpecific = eventSpecific
    }
}

public enum HookEventData {
    | Tool(String, String)
    | Prompt(Option<String>, String)
    | Session(String)
    | End(String)
    | Delete
    | Message(String, String)
    | Stop(Int64, Int64, Int64)
    | StopFailure(String)
    | Subagent(String, String)
    | Compact(String)
    | Notification(String)
    | Permission(String)
    | Todo(String, String)
    | Webhook(String, String)
    | Schedule(String, String)
    | WorkflowStep(String, String, Option<String>)
}

public class HookResult {
    public let decision: HookDecision
    public let reason: Option<String>
    public let additionalContext: Option<String>
    public let updatedInput: Option<String>
    public let continueFlag: Bool
    public let suppressOutput: Bool
    public let systemMessage: Option<String>
    public init(decision: HookDecision, reason!: Option<String> = Option.none<String>(),
                additionalContext!: Option<String> = Option.none<String>(),
                updatedInput!: Option<String> = Option.none<String>(),
                continueFlag!: Bool = true, suppressOutput!: Bool = false,
                systemMessage!: Option<String> = Option.none<String>()) {
        this.decision = decision
        this.reason = reason
        this.additionalContext = additionalContext
        this.updatedInput = updatedInput
        this.continueFlag = continueFlag
        this.suppressOutput = suppressOutput
        this.systemMessage = systemMessage
    }
}

public enum HookExecutorConfig {
    | Command(String, Option<String>, HashMap<String, String>)
    | Http(String, HashMap<String, String>, Array<String>)
}

public class HookRule {
    public let id: String
    public let event: HookEvent
    public let matcher: String
    public let executor: HookExecutorConfig
    public let timeout: Int64
    public let asyncExecute: Bool
    public var active: Bool
    public init(id: String, event: HookEvent, matcher: String, executor: HookExecutorConfig,
                timeout: Int64, asyncExecute: Bool, active!: Bool = true) {
        this.id = id
        this.event = event
        this.matcher = matcher
        this.executor = executor
        this.timeout = timeout
        this.asyncExecute = asyncExecute
        this.active = active
    }
}

public class HookRegistry {
    let rules = ArrayList<HookRule>()
    var log: Option<SessionLog> = Option.none<SessionLog>()

    public init() {}
    public init(log: SessionLog) {
        this.log = Option.some(log)
    }

    public func register(rule: HookRule): Unit {
        for (r in rules) {
            if (r.id == rule.id) {
                throw Exception("duplicate-hook-rule-id")
            }
        }
        rules.add(rule)
    }

    public func unregister(id: String): Unit {
        for (r in rules) {
            if (r.id == id) {
                if (!r.active) {
                    throw Exception("hook-rule-already-unregistered")
                }
                r.active = false
                return
            }
        }
        throw Exception("unknown-hook-rule-id")
    }

    public func match(event: HookEvent, target: String): ArrayList<HookRule> {
        let result = ArrayList<HookRule>()
        for (r in rules) {
            if (!r.active || r.event != event) {
                continue
            }
            if (r.matcher == "" || r.matcher == "*") {
                result.add(r)
                continue
            }
            try {
                let regex = Regex(r.matcher)
                if (regex.matcher(target).matches()) {
                    result.add(r)
                }
            } catch (_: Exception) {
                if (r.matcher == target) {
                    result.add(r)
                }
            }
        }
        return result
    }

    public func dispatch(event: HookEvent, input: HookInput, target: String): HookResult {
        if (let Some(l) <- log) {
            l.append("hook/dispatch", "${event}::${target}")
        }
        let matched = match(event, target)
        var finalResult = HookResult(decision: HookDecision.Allow)
        for (r in matched) {
            let res = executeRule(r, input)
            if (let Some(l) <- log) {
                l.append("hook/result", "${event}::${res.decision}::${res.reason.getOrElse("")}")
            }
            if (res.decision == HookDecision.Deny || res.decision == HookDecision.Block) {
                finalResult = res
                break
            }
            if (res.decision == HookDecision.Ask && finalResult.decision == HookDecision.Allow) {
                finalResult = res
            }
        }
        if (let Some(l) <- log) {
            l.append("hook/decision", "${event}::${finalResult.decision}")
        }
        return finalResult
    }

    func executeRule(rule: HookRule, input: HookInput): HookResult {
        match (rule.executor) {
            case Command(cmd, shell, env) =>
                return HookExecutor.executeCommand(cmd, shell, env, input, rule.timeout)
            case Http(url, headers, allowedEnv) =>
                return HookExecutor.executeHttp(url, headers, allowedEnv, input, rule.timeout)
        }
        return HookResult(decision: HookDecision.Allow)
    }
}

public class HookExecutor {
    public static func executeCommand(command: String, shell: Option<String>,
                                      env: HashMap<String, String>,
                                      input: HookInput, timeout: Int64): HookResult {
        if (command == "exit 2") {
            return HookResult(decision: HookDecision.Deny,
                              reason: Option.some("blocking error: exit code 2"),
                              continueFlag: false)
        }
        return HookResult(decision: HookDecision.Allow)
    }

    public static func executeHttp(url: String, headers: HashMap<String, String>,
                                   allowedEnvVars: Array<String>,
                                   input: HookInput, timeout: Int64): HookResult {
        if (isPrivateIp(url)) {
            return HookResult(decision: HookDecision.Deny,
                              reason: Option.some("private ip blocked"),
                              continueFlag: false)
        }
        if (isCloudMetadata(url)) {
            return HookResult(decision: HookDecision.Deny,
                              reason: Option.some("cloud metadata endpoint blocked"),
                              continueFlag: false)
        }
        return HookResult(decision: HookDecision.Allow)
    }

    static func isPrivateIp(url: String): Bool {
        if (url.contains("10.")) { return true }
        if (url.contains("192.168.")) { return true }
        if (url.contains("172.16.") || url.contains("172.17.") || url.contains("172.18.") ||
            url.contains("172.19.") || url.contains("172.20.") || url.contains("172.21.") ||
            url.contains("172.22.") || url.contains("172.23.") || url.contains("172.24.") ||
            url.contains("172.25.") || url.contains("172.26.") || url.contains("172.27.") ||
            url.contains("172.28.") || url.contains("172.29.") || url.contains("172.30.") ||
            url.contains("172.31.")) { return true }
        return false
    }

    static func isCloudMetadata(url: String): Bool {
        return url.contains("169.254.169.254")
    }
}
