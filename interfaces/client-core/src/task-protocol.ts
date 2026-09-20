/**
 * Shared Task Protocol types + runtime validators (M1 client-core).
 * Mirrors kernel `schema/task_protocol.rs` and the optional Agent Backend fields from M0.
 */

export const TASK_PROTOCOL_VERSION = 1;
export const DEFAULT_AGENT_BACKEND_ID = 'sacode';
export const MINIMUM_DAEMON_VERSION = '1.1.1';

export type EntrySource =
    | 'cli'
    | 'tui'
    | 'repl'
    | 'vscode'
    | 'automation'
    | 'sdk'
    | 'daemon'
    | 'desktop';

export type ExecutionMode = 'auto' | 'plan' | 'build';
export type ExecutionModeInput = ExecutionMode | 'yolo';

export type TaskState =
    | 'pending'
    | 'ready'
    | 'retrying'
    | 'running'
    | 'waiting_for_user'
    | 'waiting_for_approval'
    | 'cancelling'
    | 'completed'
    | 'failed'
    | 'cancelled';

export type TaskPhase =
    | 'queued'
    | 'executing'
    | 'waiting_for_user'
    | 'waiting_for_approval'
    | 'cancelling'
    | 'finished';

export type TerminalOutcome = 'success' | 'failure' | 'cancelled';

export type FailureCategory =
    | 'provider'
    | 'permission'
    | 'approval'
    | 'tool'
    | 'validation'
    | 'recovery'
    | 'compatibility'
    | 'system';

export type SuggestedAction =
    | 'retry'
    | 'reconfigure_provider'
    | 'request_approval'
    | 'check_permissions'
    | 'update_client'
    | 'review_recovery_source'
    | 'report_issue'
    | 'none';

export type ValidationStatus = 'passed' | 'failed' | 'not_run' | 'unknown';

export type AgentBackendKind = 'native' | 'acp';
export type AgentBackendHealth = 'unknown' | 'ready' | 'degraded' | 'unavailable';

export interface FailureDetail {
    category: FailureCategory;
    code: string;
    retryable: boolean;
    suggested_action: SuggestedAction;
    safe_message: string;
}

export interface WorkspaceBoundary {
    root: string;
}

export interface ExplicitContextRef {
    path: string;
    start_line?: number;
    end_line?: number;
    character_count?: number;
}

export interface BackendTaskMeta {
    backend_id: string;
    backend_kind?: AgentBackendKind;
    agent_session_id?: string;
}

export interface TaskCreateRequest {
    schema_version: number;
    prompt: string;
    mode: ExecutionMode;
    source: EntrySource;
    workspace: WorkspaceBoundary;
    explicit_contexts: ExplicitContextRef[];
    backend_id?: string;
    session_id?: string;
}

export interface ResultSummary {
    text?: string;
    changed_objects: string[];
}

export interface RouteSummary {
    provider: string;
    model: string;
    switched: boolean;
    reason?: string;
}

export interface ValidationSummary {
    status: ValidationStatus;
    checks: string[];
}

export interface TaskTimestamps {
    created_at?: string;
    started_at?: string;
    updated_at?: string;
    finished_at?: string;
}

export interface TaskSnapshot {
    schema_version: number;
    task_id: string;
    mode: ExecutionMode;
    source: EntrySource;
    state: TaskState;
    phase: TaskPhase;
    terminal_outcome?: TerminalOutcome;
    failure?: FailureDetail;
    result?: ResultSummary;
    validation?: ValidationSummary;
    route?: RouteSummary;
    timestamps: TaskTimestamps;
    backend?: BackendTaskMeta;
}

export interface AgentCapabilities {
    streaming: boolean;
    tool_calls: boolean;
    approvals: boolean;
    cancel: boolean;
    sessions: boolean;
    modes: string[];
    notes?: string;
}

export interface AgentDescriptor {
    id: string;
    display_name: string;
    kind?: AgentBackendKind;
    health?: AgentBackendHealth;
    capabilities?: AgentCapabilities;
    executable?: string;
    version?: string;
    diagnostic?: string;
}

const ENTRY_SOURCES: readonly EntrySource[] = [
    'cli', 'tui', 'repl', 'vscode', 'automation', 'sdk', 'daemon', 'desktop',
];

const TASK_STATES: readonly TaskState[] = [
    'pending', 'ready', 'retrying', 'running', 'waiting_for_user',
    'waiting_for_approval', 'cancelling', 'completed', 'failed', 'cancelled',
];

const FAILURE_CATEGORIES: readonly FailureCategory[] = [
    'provider', 'permission', 'approval', 'tool', 'validation',
    'recovery', 'compatibility', 'system',
];

const SUGGESTED_ACTIONS: readonly SuggestedAction[] = [
    'retry', 'reconfigure_provider', 'request_approval', 'check_permissions',
    'update_client', 'review_recovery_source', 'report_issue', 'none',
];

const VALIDATION_STATUSES: readonly ValidationStatus[] = ['passed', 'failed', 'not_run', 'unknown'];

export function normalizeExecutionMode(value: unknown): ExecutionMode {
    if (value === 'yolo') return 'auto';
    return value === 'plan' || value === 'auto' || value === 'build' ? value : 'auto';
}

export function normalizeBackendId(value: unknown): string {
    if (typeof value !== 'string') return DEFAULT_AGENT_BACKEND_ID;
    const trimmed = value.trim();
    return trimmed.length === 0 ? DEFAULT_AGENT_BACKEND_ID : trimmed;
}

export function phaseForState(state: TaskState): TaskPhase {
    switch (state) {
        case 'pending':
        case 'ready':
        case 'retrying':
            return 'queued';
        case 'running':
            return 'executing';
        case 'waiting_for_user':
            return 'waiting_for_user';
        case 'waiting_for_approval':
            return 'waiting_for_approval';
        case 'cancelling':
            return 'cancelling';
        case 'completed':
        case 'failed':
        case 'cancelled':
            return 'finished';
    }
}

export function isTerminalState(state: TaskState): boolean {
    return state === 'completed' || state === 'failed' || state === 'cancelled';
}

function terminalOutcomeFor(state: TaskState): TerminalOutcome | undefined {
    switch (state) {
        case 'completed': return 'success';
        case 'failed': return 'failure';
        case 'cancelled': return 'cancelled';
        default: return undefined;
    }
}

function isString(value: unknown): value is string {
    return typeof value === 'string';
}

function isOptionalString(value: unknown): value is string | undefined {
    return value === undefined || value === null || typeof value === 'string';
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
    return value === undefined || value === null || typeof value === 'boolean';
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
    return allowed.includes(value as T) ? (value as T) : null;
}

export function isProtocolVersionSupported(version: unknown): boolean {
    return typeof version === 'number' && Number.isInteger(version) && version === TASK_PROTOCOL_VERSION;
}

export function isVersionAtLeast(actual: string, minimum: string): boolean {
    const parse = (version: string) => {
        const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
        if (!match) return null;
        return {
            core: match.slice(1, 4).map(Number),
            prerelease: match[4] ? match[4].split('.') : null,
        };
    };
    const a = parse(actual);
    const m = parse(minimum);
    if (!a || !m) return false;
    for (let i = 0; i < 3; i += 1) {
        if (a.core[i] !== m.core[i]) return a.core[i] > m.core[i];
    }
    if (!a.prerelease) return true;
    if (!m.prerelease) return false;
    const len = Math.max(a.prerelease.length, m.prerelease.length);
    for (let i = 0; i < len; i += 1) {
        const ap = a.prerelease[i];
        const mp = m.prerelease[i];
        if (ap === undefined) return false;
        if (mp === undefined) return true;
        if (ap === mp) continue;
        const an = /^\d+$/.test(ap) ? Number(ap) : null;
        const mn = /^\d+$/.test(mp) ? Number(mp) : null;
        if (an !== null && mn !== null) return an > mn;
        if (an !== null) return false;
        if (mn !== null) return true;
        return ap > mp;
    }
    return true;
}

function parseBackendMeta(value: unknown): BackendTaskMeta | undefined {
    if (value === undefined || value === null || typeof value !== 'object') return undefined;
    const raw = value as Record<string, unknown>;
    if (!isString(raw.backend_id) || raw.backend_id.trim().length === 0) return undefined;
    const kind = raw.backend_kind === 'native' || raw.backend_kind === 'acp' ? raw.backend_kind : undefined;
    return {
        backend_id: normalizeBackendId(raw.backend_id),
        ...(kind ? { backend_kind: kind } : {}),
        ...(isOptionalString(raw.agent_session_id) && raw.agent_session_id
            ? { agent_session_id: raw.agent_session_id }
            : {}),
    };
}

function parseTimestamps(value: unknown): TaskTimestamps | null {
    if (value !== undefined && value !== null && typeof value !== 'object') return null;
    const raw = (value ?? {}) as Record<string, unknown>;
    const fields = ['created_at', 'started_at', 'updated_at', 'finished_at'] as const;
    const timestamps: TaskTimestamps = {};
    for (const field of fields) {
        if (!isOptionalString(raw[field])) return null;
        const text = raw[field];
        if (typeof text === 'string') timestamps[field] = text;
    }
    return timestamps;
}

function parseFailureDetail(value: unknown): FailureDetail | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;
    const category = oneOf(raw.category, FAILURE_CATEGORIES);
    if (!category || !isString(raw.code) || !isOptionalBoolean(raw.retryable)) return null;
    const suggestedAction = oneOf(raw.suggested_action, SUGGESTED_ACTIONS);
    if (!suggestedAction || !isString(raw.safe_message)) return null;
    return {
        category,
        code: raw.code,
        retryable: raw.retryable === true,
        suggested_action: suggestedAction,
        safe_message: raw.safe_message,
    };
}

function parseResultSummary(value: unknown): ResultSummary | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;
    if (!isOptionalString(raw.text)) return null;
    const changed = raw.changed_objects;
    if (changed !== undefined && !Array.isArray(changed)) return null;
    if (Array.isArray(changed) && !changed.every(isString)) return null;
    return {
        ...(typeof raw.text === 'string' ? { text: raw.text } : {}),
        changed_objects: Array.isArray(changed) ? changed : [],
    };
}

function parseRouteSummary(value: unknown): RouteSummary | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;
    if (!isString(raw.provider) || !isString(raw.model) || !isOptionalBoolean(raw.switched)) return null;
    if (!isOptionalString(raw.reason)) return null;
    return {
        provider: raw.provider,
        model: raw.model,
        switched: raw.switched === true,
        ...(typeof raw.reason === 'string' ? { reason: raw.reason } : {}),
    };
}

function parseValidationSummary(value: unknown): ValidationSummary | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;
    const status = oneOf(raw.status, VALIDATION_STATUSES);
    if (!status) return null;
    const checks = raw.checks;
    if (checks !== undefined && !Array.isArray(checks)) return null;
    if (Array.isArray(checks) && !checks.every(isString)) return null;
    return { status, checks: Array.isArray(checks) ? checks : [] };
}

export function parseTaskSnapshot(value: unknown): TaskSnapshot | null {
    if (value === null || value === undefined || typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;
    if (!isProtocolVersionSupported(raw.schema_version)) return null;
    if (!isString(raw.task_id) || raw.task_id.trim().length === 0) return null;
    const mode = oneOf(raw.mode, ['auto', 'plan', 'build'] as const);
    const source = oneOf(raw.source, ENTRY_SOURCES);
    const state = oneOf(raw.state, TASK_STATES);
    const phase = oneOf(raw.phase, [
        'queued', 'executing', 'waiting_for_user', 'waiting_for_approval', 'cancelling', 'finished',
    ] as const);
    if (!mode || !source || !state || !phase) return null;
    if (phase !== phaseForState(state)) return null;
    if (raw.terminal_outcome !== undefined && raw.terminal_outcome !== null) {
        if (raw.terminal_outcome !== terminalOutcomeFor(state)) return null;
    } else if (isTerminalState(state)) {
        return null;
    }
    const failure = parseFailureDetail(raw.failure);
    if ((state === 'failed') !== (failure !== null)) return null;
    const result = parseResultSummary(raw.result);
    const validation = parseValidationSummary(raw.validation);
    const route = parseRouteSummary(raw.route);
    const timestamps = parseTimestamps(raw.timestamps);
    if (!timestamps) return null;
    const backend = parseBackendMeta(raw.backend);

    const snapshot: TaskSnapshot = {
        schema_version: raw.schema_version as number,
        task_id: raw.task_id,
        mode,
        source,
        state,
        phase,
        timestamps,
    };
    const outcome = terminalOutcomeFor(state);
    if (outcome) snapshot.terminal_outcome = outcome;
    if (failure) snapshot.failure = failure;
    if (result) snapshot.result = result;
    if (validation) snapshot.validation = validation;
    if (route) snapshot.route = route;
    if (backend) snapshot.backend = backend;
    return snapshot;
}

export const TASK_STATE_LABELS: Readonly<Record<TaskState, string>> = {
    pending: '排队中',
    ready: '待执行',
    retrying: '重试中',
    running: '执行中',
    waiting_for_user: '等待输入',
    waiting_for_approval: '等待审批',
    cancelling: '取消中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
};

export const FAILURE_CATEGORY_LABELS: Readonly<Record<FailureCategory, string>> = {
    provider: '模型服务',
    permission: '权限',
    approval: '审批',
    tool: '工具',
    validation: '验证',
    recovery: '恢复',
    compatibility: '兼容性',
    system: '系统',
};

export const SUGGESTED_ACTION_LABELS: Readonly<Record<SuggestedAction, string>> = {
    retry: '重试任务',
    reconfigure_provider: '重新配置模型服务',
    request_approval: '请求审批',
    check_permissions: '检查权限',
    update_client: '升级扩展',
    review_recovery_source: '检查恢复源',
    report_issue: '报告问题',
    none: '无需操作',
};
