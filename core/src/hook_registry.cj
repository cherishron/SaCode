package core
import std.collection.ArrayList
import std.regex.Regex

public enum HookEvent {
    PreToolUse,
    PostToolUse,
    PostToolUseFailure,
    UserPromptSubmit,
    SessionStart,
    SessionEnd,
    SessionDelete,
    MessageDisplay,
    Stop,
    StopFailure,
    SubagentStart,
    SubagentStop,
    PreCompact,
    PostCompact,
    Notification,
    PermissionRequest,
    PermissionDenied,
    TodoCreated,
    TodoCompleted,
    WebhookDelivery,
    ScheduleFire,
    WorkflowStepStart,
    WorkflowStepDone,
    WorkflowStepFail
}

public enum HookDecision {
    Allow, Deny, Block, Ask
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
}

public enum HookEventData {
    Tool { toolId: String, toolInput: String }
    Prompt { submittedPrompt: Option<String>, prompt: String }
    Session { source: String }
    End { reason: String }
    Delete {}
    Message { role: String, contentPreview: String }
    Stop { contextUsage: Int64, contextLimit: Int64, inputTokens: Int64 }
    StopFailure { error: String }
    Subagent { agentId: String, agentType: String }
    Compact { trigger: String }
    Notification { type: String }
    Permission { toolId: String }
    Todo { todoId: String, content: String }
    Webhook { deliveryId: String, kind: String }
    Schedule { taskId: String, cron: String }
    WorkflowStep { stepId: String, label: String, reason: Option<String> }
}
