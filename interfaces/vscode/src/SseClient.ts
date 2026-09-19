import {
    TASK_PROTOCOL_VERSION,
    isProtocolVersionSupported,
    normalizeExecutionMode,
    parseTaskSnapshot,
} from './taskProtocol';
import type { ExecutionModeInput, TaskCreateRequest } from './taskProtocol';
import {
    CreateTaskResponse,
    DaemonConfig,
    PendingApprovalEntry,
    SSEEvent,
    TaskResult,
    TaskStatus,
} from './types';

export const MINIMUM_DAEMON_VERSION = '1.1.1';

export interface DaemonHealth {
    status: string;
    version: string;
}

/** 协议版本不兼容：客户端能力低于 daemon 响应声明 */
export class ProtocolCompatibilityError extends Error {}

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

/**
 * 校验 daemon 声明的协议版本与扩展能力是否匹配。
 * 缺失或未知协议版本视为不兼容，明确失败而不是静默降级。
 */
export function protocolVersionError(version: unknown): string | null {
    if (isProtocolVersionSupported(version)) return null;
    const actual = typeof version === 'number' ? String(version) : 'missing';
    return `SaCode protocol version ${actual} is unsupported by this extension (supports ${TASK_PROTOCOL_VERSION}). Upgrade the SaCode extension or daemon.`;
}

export function isVersionAtLeast(actual: string, minimum: string): boolean {
    interface ParsedVersion {
        core: number[];
        prerelease: string[] | null;
    }
    const parse = (version: string): ParsedVersion | null => {
        const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
        if (!match) return null;
        return {
            core: match.slice(1, 4).map(Number),
            prerelease: match[4] ? match[4].split('.') : null,
        };
    };
    const actualVersion = parse(actual);
    const minimumVersion = parse(minimum);
    if (!actualVersion || !minimumVersion) return false;

    for (let index = 0; index < 3; index += 1) {
        if (actualVersion.core[index] !== minimumVersion.core[index]) {
            return actualVersion.core[index] > minimumVersion.core[index];
        }
    }

    if (!actualVersion.prerelease) return true;
    if (!minimumVersion.prerelease) return false;
    const length = Math.max(actualVersion.prerelease.length, minimumVersion.prerelease.length);
    for (let index = 0; index < length; index += 1) {
        const actualPart = actualVersion.prerelease[index];
        const minimumPart = minimumVersion.prerelease[index];
        if (actualPart === undefined) return false;
        if (minimumPart === undefined) return true;
        if (actualPart === minimumPart) continue;
        const actualNumber = /^\d+$/.test(actualPart) ? Number(actualPart) : null;
        const minimumNumber = /^\d+$/.test(minimumPart) ? Number(minimumPart) : null;
        if (actualNumber !== null && minimumNumber !== null) return actualNumber > minimumNumber;
        if (actualNumber !== null) return false;
        if (minimumNumber !== null) return true;
        return actualPart > minimumPart;
    }
    return true;
}

async function responseError(response: Response, action: string): Promise<Error> {
    let detail = '';
    try {
        const body = await response.text();
        if (body) {
            try {
                const parsed: unknown = JSON.parse(body);
                detail = errorText(parsed) || body;
            } catch {
                detail = body;
            }
        }
    } catch {
        // Keep the status-only fallback when the response body cannot be read.
    }

    const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
    return new Error(`${action} failed (${status})${detail ? `: ${detail}` : ''}`);
}

function errorText(value: unknown): string {
    if (!isRecord(value)) return '';
    if (typeof value.error === 'string') return value.error;
    if (typeof value.message === 'string') return value.message;
    return '';
}

export function parseSseFrame(frame: string): SSEEvent | null {
    let event = 'message';
    let id: string | undefined;
    const dataLines: string[] = [];

    for (const rawLine of frame.split(/\r?\n/)) {
        if (!rawLine || rawLine.startsWith(':')) continue;
        const separator = rawLine.indexOf(':');
        const field = separator === -1 ? rawLine : rawLine.slice(0, separator);
        let value = separator === -1 ? '' : rawLine.slice(separator + 1);
        if (value.startsWith(' ')) value = value.slice(1);

        if (field === 'event') event = value || 'message';
        if (field === 'id') id = value;
        if (field === 'data') dataLines.push(value);
    }

    if (dataLines.length === 0) return null;
    try {
        const data: unknown = JSON.parse(dataLines.join('\n'));
        const eventTaskId = extractTaskId(data);
        return {
            event,
            data,
            ...(id !== undefined ? { id } : {}),
            ...(eventTaskId !== undefined ? { task_id: eventTaskId } : {}),
        };
    } catch {
        return null;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractTaskId(value: unknown): string | undefined {
    if (!isRecord(value)) return undefined;
    const taskId = value.task_id;
    return typeof taskId === 'string' && taskId.length > 0 ? taskId : undefined;
}

/** 校验协议版本后解析 /task 创建响应；版本不兼容时抛 ProtocolCompatibilityError */
export function parseTaskResponse(body: unknown): CreateTaskResponse {
    if (!isRecord(body)) {
        throw new Error('Task creation returned an unexpected response body');
    }
    const error = protocolVersionError(body.protocol_version);
    if (error) throw new ProtocolCompatibilityError(error);
    if (typeof body.task_id !== 'string' || typeof body.status !== 'string') {
        throw new Error('Task creation response is missing task_id or status');
    }
    const taskSnapshot = parseTaskSnapshot(body.task);
    return {
        protocol_version: body.protocol_version as number,
        task_id: body.task_id,
        status: body.status,
        message: typeof body.message === 'string' ? body.message : '',
        queue_status: typeof body.queue_status === 'string' ? body.queue_status : '',
        ...(taskSnapshot !== null ? { task: taskSnapshot } : {}),
    };
}

/** 解析 /task/:id/result 响应：字段缺失时按协议错误处理 */
export function parseTaskResult(body: unknown): TaskResult {
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
        learned_facts: Array.isArray(facts) ? facts.filter(isString) : [],
    };
}

/**
 * 解析任务状态响应：嵌套快照可解析时返回 TaskSnapshot，否则降级为 null。
 * 顶层状态字段缺失时按协议错误处理，协议版本声明存在但不受支持时明确失败。
 */
export function parseTaskStatusBody(body: unknown): TaskStatus {
    if (!isRecord(body)) {
        throw new Error('Task status returned an unexpected response body');
    }
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

function isString(value: unknown): value is string {
    return typeof value === 'string';
}

function numberField(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** 解析待审批条目：非法条目跳过，不中断其余条目 */
function parsePendingApproval(value: unknown): PendingApprovalEntry | null {
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
        side_effect_level: typeof value.side_effect_level === 'string'
            ? value.side_effect_level
            : 'Unknown',
        args: isRecord(value.args) ? value.args : {},
        waited_secs: numberField(value.waited_secs) ?? 0,
        timeout_secs: numberField(value.timeout_secs) ?? 0,
        expires_in_secs: numberField(value.expires_in_secs) ?? 0,
    };
}

/** 解析审批列表：结构缺失或非法时安全降级为已解析子集 */
export function parseApprovalList(body: unknown): PendingApprovalEntry[] {
    if (!isRecord(body) || !Array.isArray(body.approvals)) return [];
    return body.approvals
        .map(parsePendingApproval)
        .filter((entry): entry is PendingApprovalEntry => entry !== null);
}

/** 解析工具列表：非字符串项跳过 */
export function parseToolList(body: unknown): string[] {
    if (!isRecord(body) || !Array.isArray(body.tools)) return [];
    return body.tools.filter(isString);
}

export class SseClient {
    private readonly config: DaemonConfig;
    private abortController: AbortController | null = null;

    constructor(config: DaemonConfig) {
        this.config = config;
    }

    get baseUrl(): string {
        return `http://${this.config.host}:${this.config.port}`;
    }

    async health(): Promise<DaemonHealth | null> {
        let res: Response;
        try {
            res = await fetch(`${this.baseUrl}/health`);
        } catch {
            return null;
        }
        if (!res.ok) {
            return { status: `http_${res.status}`, version: '' };
        }
        try {
            const body: unknown = await res.json();
            if (!isRecord(body) || typeof body.status !== 'string') {
                return { status: 'invalid_response', version: '' };
            }
            return {
                status: body.status,
                version: typeof body.version === 'string' ? body.version : '',
            };
        } catch {
            return { status: 'invalid_response', version: '' };
        }
    }

    async healthCheck(): Promise<boolean> {
        const health = await this.health();
        return health !== null && daemonHealthError(health) === null;
    }

    async createTask(
        prompt: string,
        mode: ExecutionModeInput = 'build',
        workspaceRoot?: string,
    ): Promise<CreateTaskResponse> {
        const request: TaskCreateRequest = {
            schema_version: TASK_PROTOCOL_VERSION,
            prompt,
            mode: normalizeExecutionMode(mode),
            source: 'vscode',
            workspace: { root: workspaceRoot ?? '.' },
            explicit_contexts: [],
        };
        const res = await fetch(`${this.baseUrl}/task`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
        });
        if (!res.ok) throw await responseError(res, 'Task creation');
        return parseTaskResponse(await res.json());
    }

    async getTaskStatus(taskId: string): Promise<TaskStatus> {
        const res = await fetch(`${this.baseUrl}/task/${encodeURIComponent(taskId)}/status`);
        if (!res.ok) throw await responseError(res, 'Task status request');
        return parseTaskStatusBody(await res.json());
    }

    async getTaskResult(taskId: string): Promise<TaskResult> {
        const res = await fetch(`${this.baseUrl}/task/${encodeURIComponent(taskId)}/result`);
        if (!res.ok) throw await responseError(res, 'Task result request');
        return parseTaskResult(await res.json());
    }

    async cancelTask(taskId: string): Promise<void> {
        const res = await fetch(`${this.baseUrl}/task/${encodeURIComponent(taskId)}/cancel`, {
            method: 'POST',
        });
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
        const res = await fetch(`${this.baseUrl}/task/${encodeURIComponent(taskId)}/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                approval_id: approvalId,
                approved,
                ...(reason ? { reason } : {}),
                ...(argsOverride ? { args_override: argsOverride } : {}),
            }),
        });
        if (!res.ok) throw await responseError(res, 'Approval resolution');
    }

    async listApprovals(taskId: string): Promise<PendingApprovalEntry[]> {
        const res = await fetch(`${this.baseUrl}/task/${encodeURIComponent(taskId)}/approvals`);
        if (!res.ok) throw await responseError(res, 'Approval list request');
        return parseApprovalList(await res.json());
    }

    async listTools(): Promise<string[]> {
        const res = await fetch(`${this.baseUrl}/tools`);
        if (!res.ok) throw await responseError(res, 'Tool list request');
        return parseToolList(await res.json());
    }

    /**
     * Stream events for one task. Returns an abort function.
     *
     * A stream that connected successfully is retried after an unexpected disconnect. The
     * latest SSE id is sent as Last-Event-ID so the daemon can replay missed events. `onOpen`
     * runs after every successful connection and lets callers reconcile non-event state such
     * as pending approvals.
     */
    streamEvents(
        onEvent: (event: SSEEvent) => void,
        onError: (err: Error) => void,
        taskId?: string,
        onOpen?: () => void,
    ): () => void {
        const controller = new AbortController();
        this.abortController?.abort();
        this.abortController = controller;
        const query = taskId ? `?task_id=${encodeURIComponent(taskId)}` : '';
        let lastEventId: string | undefined;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
        let connectedOnce = false;

        const connect = async (): Promise<void> => {
            try {
                const headers: Record<string, string> = { Accept: 'text/event-stream' };
                if (lastEventId) headers['Last-Event-ID'] = lastEventId;
                const response = await fetch(`${this.baseUrl}/api/stream${query}`, {
                    signal: controller.signal,
                    headers,
                });
                if (!response.ok) throw await responseError(response, 'Event stream');
                const reader = response.body?.getReader();
                if (!reader) throw new Error('Event stream returned no response body');

                connectedOnce = true;
                onOpen?.();
                const decoder = new TextDecoder();
                let buffer = '';
                while (true) {
                    const { done, value } = await reader.read();
                    buffer += decoder.decode(value, { stream: !done });
                    const frames = buffer.split(/\r?\n\r?\n/);
                    buffer = frames.pop() || '';
                    for (const frame of frames) {
                        const event = parseSseFrame(frame);
                        if (event) {
                            if (event.id !== undefined) lastEventId = event.id || undefined;
                            onEvent(event);
                        }
                    }
                    if (done) break;
                }
                const finalEvent = parseSseFrame(buffer);
                if (finalEvent) {
                    if (finalEvent.id !== undefined) lastEventId = finalEvent.id || undefined;
                    onEvent(finalEvent);
                }
                if (!controller.signal.aborted) {
                    reconnectTimer = setTimeout(() => void connect(), 1000);
                }
            } catch (err: unknown) {
                if (controller.signal.aborted) return;
                const error = err instanceof Error ? err : new Error(String(err));
                if (!connectedOnce) {
                    onError(error);
                    return;
                }
                reconnectTimer = setTimeout(() => void connect(), 1000);
            }
        };

        void connect();

        return () => {
            if (reconnectTimer) clearTimeout(reconnectTimer);
            controller.abort();
            if (this.abortController === controller) this.abortController = null;
        };
    }
}
