import { CreateTaskResponse, DaemonConfig, PendingApprovalEntry, SSEEvent, TaskResult, TaskStatus } from './types';

export const MINIMUM_DAEMON_VERSION = '1.1.1';

export interface DaemonHealth {
    status: string;
    version: string;
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
                const parsed = JSON.parse(body);
                detail = parsed.error || parsed.message || body;
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
        const data = JSON.parse(dataLines.join('\n'));
        return { event, data, ...(id !== undefined ? { id } : {}), task_id: data.task_id };
    } catch {
        return null;
    }
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
            const body = await res.json() as Partial<DaemonHealth>;
            if (typeof body.status !== 'string') {
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

    async createTask(prompt: string, mode: string = 'build'): Promise<CreateTaskResponse> {
        const res = await fetch(`${this.baseUrl}/task`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, mode }),
        });
        if (!res.ok) throw await responseError(res, 'Task creation');
        return res.json() as Promise<CreateTaskResponse>;
    }

    async getTaskStatus(taskId: string): Promise<TaskStatus> {
        const res = await fetch(`${this.baseUrl}/task/${encodeURIComponent(taskId)}/status`);
        if (!res.ok) throw await responseError(res, 'Task status request');
        return res.json() as Promise<TaskStatus>;
    }

    async getTaskResult(taskId: string): Promise<TaskResult> {
        const res = await fetch(`${this.baseUrl}/task/${encodeURIComponent(taskId)}/result`);
        if (!res.ok) throw await responseError(res, 'Task result request');
        return res.json() as Promise<TaskResult>;
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
        const data = await res.json() as { approvals?: PendingApprovalEntry[] };
        return data.approvals || [];
    }

    async listTools(): Promise<string[]> {
        const res = await fetch(`${this.baseUrl}/tools`);
        if (!res.ok) throw await responseError(res, 'Tool list request');
        const data = await res.json() as { tools?: string[] };
        return data.tools || [];
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
