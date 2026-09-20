export type {
    AgentBackendHealth,
    AgentBackendKind,
    AgentCapabilities,
    AgentDescriptor,
    BackendTaskMeta,
    EntrySource,
    ExecutionMode,
    ExecutionModeInput,
    TaskCreateRequest,
    TaskSnapshot,
} from './task-protocol.js';

export {
    DEFAULT_AGENT_BACKEND_ID,
    MINIMUM_DAEMON_VERSION,
    TASK_PROTOCOL_VERSION,
    TASK_STATE_LABELS,
    FAILURE_CATEGORY_LABELS,
    SUGGESTED_ACTION_LABELS,
    isProtocolVersionSupported,
    isVersionAtLeast,
    isTerminalState,
    normalizeBackendId,
    normalizeExecutionMode,
    parseTaskSnapshot,
    phaseForState,
} from './task-protocol.js';
