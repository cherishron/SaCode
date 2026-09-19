/**
 * SaCode 任务协议（Rust kernel task_protocol.rs 的 TypeScript 精确映射）。
 *
 * 协议原则：旧格式可读、新格式只写；`yolo` 仅作为输入别名，客户端统一输出 `auto`；
 * 未知协议边界使用 `unknown` + 运行时校验，解析失败安全降级为 null，不崩溃、不误报成功。
 */

export const TASK_PROTOCOL_VERSION = 1;

export type EntrySource =
    | 'cli'
    | 'tui'
    | 'repl'
    | 'vscode'
    | 'automation'
    | 'sdk'
    | 'daemon';

export type ExecutionMode = 'auto' | 'plan' | 'build';

/** 可接受的输入模式：`yolo` 仅为旧值别名，规范化为 `auto` */
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

export interface TaskCreateRequest {
    schema_version: number;
    prompt: string;
    mode: ExecutionMode;
    source: EntrySource;
    workspace: WorkspaceBoundary;
    explicit_contexts: ExplicitContextRef[];
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
}

const ENTRY_SOURCES: readonly EntrySource[] = [
    'cli', 'tui', 'repl', 'vscode', 'automation', 'sdk', 'daemon',
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

const VALIDATION_STATUSES: readonly ValidationStatus[] = [
    'passed', 'failed', 'not_run', 'unknown',
];

export function normalizeExecutionMode(value: unknown): ExecutionMode {
    if (value === 'yolo') return 'auto';
    return value === 'plan' || value === 'auto' || value === 'build'
        ? value
        : 'auto';
}

/** 与 Rust `TaskPhase::from(TaskState)` 一致的状态→阶段映射 */
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

function isProtocolVersion(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value);
}

/** 校验协议版本：0 视为旧协议，>1 视为未知新协议，均不受支持 */
export function isProtocolVersionSupported(version: unknown): boolean {
    return isProtocolVersion(version) && version === TASK_PROTOCOL_VERSION;
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

/**
 * 运行时校验并解析 TaskSnapshot。
 *
 * 对应 Rust `TaskSnapshot::validate()` 的语义；任何不匹配（未知枚举、
 * phase 与 state 不一致、终态矛盾、failure 矛盾、schema 不支持）返回 null，
 * 调用方按降级提示处理，不得误报成功。
 */
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