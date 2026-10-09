package core
import std.collection.ArrayList
import std.collection.HashMap
import std.regex.Regex
import std.deriving.*

@Derive[Equatable, ToString]
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

@Derive[Equatable, ToString]
public enum HookDecision {
    | Allow
    | Deny
    | Block
    | Ask
}

public func hookEventName(event: HookEvent): String {
    return match (event) {
        case PreToolUse => "PreToolUse"
        case PostToolUse => "PostToolUse"
        case PostToolUseFailure => "PostToolUseFailure"
        case UserPromptSubmit => "UserPromptSubmit"
        case SessionStart => "SessionStart"
        case SessionEnd => "SessionEnd"
        case SessionDelete => "SessionDelete"
        case MessageDisplay => "MessageDisplay"
        case Stop => "Stop"
        case StopFailure => "StopFailure"
        case SubagentStart => "SubagentStart"
        case SubagentStop => "SubagentStop"
        case PreCompact => "PreCompact"
        case PostCompact => "PostCompact"
        case Notification => "Notification"
        case PermissionRequest => "PermissionRequest"
        case PermissionDenied => "PermissionDenied"
        case TodoCreated => "TodoCreated"
        case TodoCompleted => "TodoCompleted"
        case WebhookDelivery => "WebhookDelivery"
        case ScheduleFire => "ScheduleFire"
        case WorkflowStepStart => "WorkflowStepStart"
        case WorkflowStepDone => "WorkflowStepDone"
        case WorkflowStepFail => "WorkflowStepFail"
    }
}

public func hookDecisionName(decision: HookDecision): String {
    return match (decision) {
        case Allow => "Allow"
        case Deny => "Deny"
        case Block => "Block"
        case Ask => "Ask"
    }
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
    public init(sessionId!: String, transcriptPath!: String, cwd!: String, hookEventName!: String,
                timestamp!: Int64, eventSpecific!: HookEventData,
                agentId!: Option<String> = None,
                agentType!: Option<String> = None) {
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
    public init(decision!: HookDecision, reason!: Option<String> = None,
                additionalContext!: Option<String> = None,
                updatedInput!: Option<String> = None,
                continueFlag!: Bool = true, suppressOutput!: Bool = false,
                systemMessage!: Option<String> = None) {
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
    public init(id!: String, event!: HookEvent, matcher!: String, executor!: HookExecutorConfig,
                timeout!: Int64, asyncExecute!: Bool, active!: Bool = true) {
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
    var log: Option<SessionLog> = None

    let policy: HookSecurityPolicy

    public init(policy!: HookSecurityPolicy = HookSecurityPolicy()) { this.policy = policy }
    public init(log!: SessionLog, policy!: HookSecurityPolicy = HookSecurityPolicy()) {
        this.log = Some(log)
        this.policy = policy
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

    public func findMatchingRules(event: HookEvent, target: String): ArrayList<HookRule> {
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
                if (regex.matches(target)) {
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
        let name = hookEventName(event)
        if (let Some(l) <- log) {
            l.append("hook/dispatch", "${name}::${target}")
        }
        let matched = findMatchingRules(event, target)
        var finalResult = HookResult(decision: HookDecision.Allow)
        for (r in matched) {
            let res = executeRule(r, input)
            if (let Some(l) <- log) {
                l.append("hook/result", "${name}::${hookDecisionName(res.decision)}::${res.reason ?? ""}")
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
            l.append("hook/decision", "${name}::${hookDecisionName(finalResult.decision)}")
        }
        return finalResult
    }

    func executeRule(rule: HookRule, input: HookInput): HookResult {
        match (rule.executor) {
            case Command(cmd, shell, env) =>
                return HookExecutor.executeCommand(cmd, shell, env, input, rule.timeout)
            case Http(url, headers, allowedEnv) =>
                return HookExecutor.executeHttp(url, headers, allowedEnv, input, rule.timeout, policy: policy)
        }
        return HookResult(decision: HookDecision.Allow)
    }
}

