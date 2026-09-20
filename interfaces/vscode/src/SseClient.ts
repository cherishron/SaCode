/**
 * VSCode-facing daemon client facade.
 * Protocol/SSE parsers come from @cherishron/sacode-client-core (M1).
 */
import {
    DaemonClient,
    MINIMUM_DAEMON_VERSION,
    ProtocolCompatibilityError,
    responseError,
    daemonHealthError,
    parseAgentsList,
    parseApprovalList,
    parseSseFrame,
    parseTaskResponse,
    parseTaskResult,
    parseTaskStatusBody,
    parseToolList,
    protocolVersionError,
    isVersionAtLeast,
} from '@cherishron/sacode-client-core';

import type {
    CreateTaskResponse,
    DaemonConfig,
    PendingApprovalEntry,
    SSEEvent,
    TaskResult,
    TaskStatus,
} from './types';
import type { ExecutionModeInput } from './taskProtocol';

export {
    MINIMUM_DAEMON_VERSION,
    ProtocolCompatibilityError,
    daemonHealthError,
    protocolVersionError,
    isVersionAtLeast,
    parseSseFrame,
    parseTaskResponse,
    parseTaskResult,
    parseTaskStatusBody,
    parseApprovalList,
    parseAgentsList,
    parseToolList,
};

export interface DaemonHealth {
    status: string;
    version: string;
}

/**
 * VSCode SseClient — thin wrapper over client-core DaemonClient.
 * Keeps the historical method names used by extension + tests.
 */
export class SseClient {
    private readonly client: DaemonClient;
    private readonly config: DaemonConfig;
    private abortController: AbortController | null = null;

    constructor(config: DaemonConfig) {
        this.config = config;
        this.client = new DaemonClient({
            host: config.host,
            port: config.port,
            token: config.token,
            entrySource: 'vscode',
        });
    }

    get baseUrl(): string {
        return `http://${this.config.host}:${this.config.port}`;
    }

    async health(): Promise<DaemonHealth | null> {
        // Keep VSCode-compatible error/status shapes (tests + DaemonManager).
        try {
            const res = await fetch(`${this.baseUrl}/health`, this.config.token
                ? { headers: { Authorization: `Bearer ${this.config.token}` } }
                : undefined);
            if (!res.ok) {
                return { status: `http_${res.status}`, version: '' };
            }
            try {
                const body: unknown = await res.json();
                if (typeof body !== 'object' || body === null) {
                    return { status: 'invalid_response', version: '' };
                }
                const record = body as Record<string, unknown>;
                if (typeof record.status !== 'string') {
                    return { status: 'invalid_response', version: '' };
                }
                return {
                    status: record.status,
                    version: typeof record.version === 'string' ? record.version : '',
                };
            } catch {
                return { status: 'invalid_response', version: '' };
            }
        } catch {
            return null;
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
        options?: { backendId?: string; sessionId?: string },
    ): Promise<CreateTaskResponse> {
        return this.client.createTask({
            prompt,
            mode,
            workspaceRoot,
            backendId: options?.backendId,
            sessionId: options?.sessionId,
            source: 'vscode',
        }) as Promise<CreateTaskResponse>;
    }

    async getTaskStatus(taskId: string): Promise<TaskStatus> {
        return this.client.getTaskStatus(taskId) as Promise<TaskStatus>;
    }

    async getTaskResult(taskId: string): Promise<TaskResult> {
        return this.client.getTaskResult(taskId) as Promise<TaskResult>;
    }

    async cancelTask(taskId: string): Promise<void> {
        return this.client.cancelTask(taskId);
    }

    async resolveApproval(
        taskId: string,
        approvalId: string,
        approved: boolean,
        reason?: string,
        argsOverride?: Record<string, unknown>,
    ): Promise<void> {
        return this.client.resolveApproval(taskId, approvalId, approved, reason, argsOverride);
    }

    async listApprovals(taskId: string): Promise<PendingApprovalEntry[]> {
        return this.client.listApprovals(taskId) as Promise<PendingApprovalEntry[]>;
    }

    async listTools(): Promise<string[]> {
        const res = await fetch(`${this.baseUrl}/tools`);
        if (!res.ok) throw new Error(`Tool list request failed (${res.status})`);
        const body: unknown = await res.json();
        if (typeof body !== 'object' || body === null || !Array.isArray((body as { tools?: unknown }).tools)) {
            return [];
        }
        return ((body as { tools: unknown[] }).tools.filter((t) => typeof t === 'string')) as string[];
    }

    /**
     * Stream events for one task. Returns an abort function.
     * Compatible with existing VSCode panel usage (fetch-based SSE + Last-Event-ID).
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
        const token = this.config.token;

        const connect = async (): Promise<void> => {
            try {
                const headers: Record<string, string> = { Accept: 'text/event-stream' };
                if (lastEventId) headers['Last-Event-ID'] = lastEventId;
                if (token) headers.Authorization = `Bearer ${token}`;
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
