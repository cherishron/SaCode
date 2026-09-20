import type { HttpResponse, HttpTransport } from './transport.js';
import { fetchTransport } from './transport.js';
import { ProtocolCompatibilityError, responseError } from './errors.js';
import {
    DEFAULT_AGENT_BACKEND_ID,
    MINIMUM_DAEMON_VERSION,
    TASK_PROTOCOL_VERSION,
    isProtocolVersionSupported,
    isVersionAtLeast,
    normalizeBackendId,
    normalizeExecutionMode,
    parseTaskSnapshot,
    type AgentDescriptor,
    type EntrySource,
    type ExecutionModeInput,
    type TaskSnapshot,
} from './index-types.js';

export interface DaemonConfig {
    host: string;
    port: number;
    /** Optional bearer token for daemon auth (M5). Omitted = no auth. */
    token?: string;
    transport?: HttpTransport;
    entrySource?: EntrySource;
}

export interface DaemonHealth {
    status: string;
    version: string;
}

export interface CreateTaskResponse {
    protocol_version: number;
    task_id: string;
    status: string;
    message: string;
    queue_status: string;
    task?: TaskSnapshot;
}

export interface TaskStatusBody {
    task_id: string;
    status: string;
    queue_status?: string;
    prompt?: string;
    mode?: string;
    error?: string | null;
    output?: string | null;
    duration_ms?: number | null;
    protocol_version?: number;
    task?: TaskSnapshot | null;
}

export interface TaskResultBody {
    task_id: string;
    response: string;
    status: string;
    learned_facts: string[];
}

export interface AgentsListResponse {
    agents: AgentDescriptor[];
    default_backend_id: string;
}

export interface PendingApproval {
    approval_id: string;
    task_id: string;
    tool_name: string;
    side_effect_level: string;
    args: Record<string, unknown>;
    waited_secs: number;
    timeout_secs: number;
    expires_in_secs: number;
}

/** Alias used by VSCode extension surface. */
export type PendingApprovalEntry = PendingApproval;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function daemonHealthError(health: DaemonHealth): string | null {
    if (health.status !== 'healthy') {
        return `SaCode daemon reported status "${health.status}".`;
    }
    if (!isVersionAtLeast(health.version, MINIMUM_DAEMON_VERSION)) {
        const version = health.version || 'unknown';
        return `SaCode daemon ${version} is incompatible. Upgrade to ${MINIMUM_DAEMON_VERSION} or newer.`;
    }
    return null;
}

export function protocolVersionError(version: unknown): string | null {
    if (isProtocolVersionSupported(version)) return null;
    const actual = typeof version === 'number' ? String(version) : 'missing';
    return `SaCode protocol version ${actual} is unsupported by this client (supports ${TASK_PROTOCOL_VERSION}).`;
}

export function parseTaskResponse(body: unknown): CreateTaskResponse {
    if (!isRecord(body)) throw new Error('Task creation returned an unexpected response body');
    const error = protocolVersionError(body.protocol_version);
    if (error) throw new ProtocolCompatibilityError(error);
    if (typeof body.task_id !== 'string' || typeof body.status !== 'string') {
        throw new Error('Task creation response is missing task_id or status');
    }
    return {
        protocol_version: body.protocol_version as number,
        task_id: body.task_id,
        status: body.status,
        message: typeof body.message === 'string' ? body.message : '',
        queue_status: typeof body.queue_status === 'string' ? body.queue_status : '',
        ...(parseTaskSnapshot(body.task) !== null ? { task: parseTaskSnapshot(body.task)! } : {}),
    };
}

export function parseTaskStatusBody(body: unknown): TaskStatusBody {
    if (!isRecord(body)) throw new Error('Task status returned an unexpected response body');
    const protocolError = body.protocol_version === undefined
        ? null
        : protocolVersionError(body.protocol_version);
    if (protocolError) throw new ProtocolCompatibilityError(protocolError);
    if (typeof body.task_id !== 'string' || typeof body.status !== 'string') {
        throw new Error('Task status response is missing task_id or status');
    }
    return {
        task_id: body.task_id,
        status: body.status,
        queue_status: typeof body.queue_status === 'string' ? body.queue_status : undefined,
        prompt: typeof body.prompt === 'string' ? body.prompt : undefined,
        mode: typeof body.mode === 'string' ? body.mode : undefined,
        error: typeof body.error === 'string' ? body.error : undefined,
        output: typeof body.output === 'string' ? body.output : undefined,
        duration_ms: typeof body.duration_ms === 'number' ? body.duration_ms : undefined,
        protocol_version: typeof body.protocol_version === 'number' ? body.protocol_version : undefined,
        task: parseTaskSnapshot(body.task),
    };
}

export function parseTaskResult(body: unknown): TaskResultBody {
    if (
        !isRecord(body) ||
        typeof body.task_id !== 'string' ||
        typeof body.status !== 'string' ||
        typeof body.response !== 'string'
    ) {
        throw new Error('Task result returned an unexpected response body');
    }
    const facts = body.learned_facts;
    return {
        task_id: body.task_id,
        response: body.response,
        status: body.status,
        learned_facts: Array.isArray(facts) ? facts.filter((x): x is string => typeof x === 'string') : [],
    };
}

function parsePendingApproval(value: unknown): PendingApproval | null {
    if (!isRecord(value)) return null;
    if (
        typeof value.approval_id !== 'string' ||
        typeof value.task_id !== 'string' ||
        typeof value.tool_name !== 'string'
    ) {
        return null;
    }
    return {
        approval_id: value.approval_id,
        task_id: value.task_id,
        tool_name: value.tool_name,
        side_effect_level: typeof value.side_effect_level === 'string' ? value.side_effect_level : 'Unknown',
        args: isRecord(value.args) ? value.args : {},
        waited_secs: typeof value.waited_secs === 'number' ? value.waited_secs : 0,
        timeout_secs: typeof value.timeout_secs === 'number' ? value.timeout_secs : 0,
        expires_in_secs: typeof value.expires_in_secs === 'number' ? value.expires_in_secs : 0,
    };
}

export function parseApprovalList(body: unknown): PendingApproval[] {
    if (!isRecord(body) || !Array.isArray(body.approvals)) return [];
    return body.approvals
        .map(parsePendingApproval)
        .filter((entry): entry is PendingApproval => entry !== null);
}

/** 解析工具列表：非字符串项跳过 */
export function parseToolList(body: unknown): string[] {
    if (!isRecord(body) || !Array.isArray(body.tools)) return [];
    return body.tools.filter((t): t is string => typeof t === 'string');
}

export function parseAgentsList(body: unknown): AgentsListResponse {
    if (!isRecord(body) || !Array.isArray(body.agents)) {
        return { agents: [], default_backend_id: DEFAULT_AGENT_BACKEND_ID };
    }
    const agents: AgentDescriptor[] = body.agents
        .filter(isRecord)
        .map((raw) => ({
            id: normalizeBackendId(raw.id),
            display_name: typeof raw.display_name === 'string' ? raw.display_name : normalizeBackendId(raw.id),
            kind: raw.kind === 'native' || raw.kind === 'acp' ? raw.kind : undefined,
            health: raw.health === 'unknown' || raw.health === 'ready' || raw.health === 'degraded' || raw.health === 'unavailable'
                ? raw.health
                : undefined,
        }));
    return {
        agents,
        default_backend_id: normalizeBackendId(body.default_backend_id),
    };
}

/**
 * Daemon HTTP client shared by VSCode and Desktop.
 * Desktop must inject a Tauri IPC transport so the WebView never holds the bearer token.
 */
export class DaemonClient {
    private readonly config: DaemonConfig;
    private readonly transport: HttpTransport;

    constructor(config: DaemonConfig) {
        this.config = config;
        this.transport = config.transport ?? fetchTransport;
    }

    get baseUrl(): string {
        return `http://${this.config.host}:${this.config.port}`;
    }

    private headers(extra?: Record<string, string>): Record<string, string> {
        return {
            ...(this.config.token ? { Authorization: `Bearer ${this.config.token}` } : {}),
            ...extra,
        };
    }

    private async request(
        method: 'GET' | 'POST',
        path: string,
        body?: unknown,
        signal?: AbortSignal,
    ): Promise<HttpResponse> {
        return this.transport({
            method,
            url: `${this.baseUrl}${path}`,
            headers: this.headers(body !== undefined ? { 'Content-Type': 'application/json' } : undefined),
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
            ...(signal ? { signal } : {}),
        });
    }

    async health(): Promise<DaemonHealth | null> {
        try {
            const res = await this.request('GET', '/health');
            if (!res.ok) return { status: `http_${res.status}`, version: '' };
            const body: unknown = await res.json();
            if (!isRecord(body) || typeof body.status !== 'string') {
                return { status: 'invalid_response', version: '' };
            }
            return {
                status: body.status,
                version: typeof body.version === 'string' ? body.version : '',
            };
        } catch {
            return null;
        }
    }

    async healthCheck(): Promise<boolean> {
        const health = await this.health();
        return health !== null && daemonHealthError(health) === null;
    }

    async listAgents(): Promise<AgentsListResponse> {
        const res = await this.request('GET', '/agents');
        if (!res.ok) throw await responseError(res, 'Agent list');
        return parseAgentsList(await res.json());
    }

    async createTask(options: {
        prompt: string;
        mode?: ExecutionModeInput;
        workspaceRoot?: string;
        backendId?: string;
        sessionId?: string;
        source?: EntrySource;
    }): Promise<CreateTaskResponse> {
        const body = {
            // Daemon TaskRequest (HTTP) is prompt/mode-first; protocol fields optional for clients.
            schema_version: TASK_PROTOCOL_VERSION,
            prompt: options.prompt,
            mode: normalizeExecutionMode(options.mode ?? 'build'),
            source: options.source ?? this.config.entrySource ?? 'vscode',
            workspace: { root: options.workspaceRoot ?? '.' },
            explicit_contexts: [],
            backend_id: normalizeBackendId(options.backendId),
            ...(options.sessionId ? { session_id: options.sessionId } : {}),
        };
        const res = await this.request('POST', '/task', body);
        if (!res.ok) throw await responseError(res, 'Task creation');
        return parseTaskResponse(await res.json());
    }

    async getTaskStatus(taskId: string): Promise<TaskStatusBody> {
        const res = await this.request('GET', `/task/${encodeURIComponent(taskId)}/status`);
        if (!res.ok) throw await responseError(res, 'Task status request');
        return parseTaskStatusBody(await res.json());
    }

    async getTaskResult(taskId: string): Promise<TaskResultBody> {
        const res = await this.request('GET', `/task/${encodeURIComponent(taskId)}/result`);
        if (!res.ok) throw await responseError(res, 'Task result request');
        return parseTaskResult(await res.json());
    }

    async cancelTask(taskId: string): Promise<void> {
        const res = await this.request('POST', `/task/${encodeURIComponent(taskId)}/cancel`);
        if (!res.ok) throw await responseError(res, 'Task cancellation');
    }

    async resolveApproval(
        taskId: string,
        approvalId: string,
        approved: boolean,
        reason?: string,
        argsOverride?: Record<string, unknown>,
    ): Promise<void> {
        if (!approvalId) throw new Error('Approval request is missing approval_id');
        const res = await this.request('POST', `/task/${encodeURIComponent(taskId)}/approve`, {
            approval_id: approvalId,
            approved,
            ...(reason ? { reason } : {}),
            ...(argsOverride ? { args_override: argsOverride } : {}),
        });
        if (!res.ok) throw await responseError(res, 'Approval resolution');
    }

    async listApprovals(taskId: string): Promise<PendingApproval[]> {
        const res = await this.request('GET', `/task/${encodeURIComponent(taskId)}/approvals`);
        if (!res.ok) throw await responseError(res, 'Approval list request');
        return parseApprovalList(await res.json());
    }
}
