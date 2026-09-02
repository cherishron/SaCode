import { CreateTaskResponse, DaemonConfig, SSEEvent, TaskResult, TaskStatus } from './types';

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
    const dataLines: string[] = [];

    for (const rawLine of frame.split(/\r?\n/)) {
        if (!rawLine || rawLine.startsWith(':')) continue;
        const separator = rawLine.indexOf(':');
        const field = separator === -1 ? rawLine : rawLine.slice(0, separator);
        let value = separator === -1 ? '' : rawLine.slice(separator + 1);
        if (value.startsWith(' ')) value = value.slice(1);

        if (field === 'event') event = value || 'message';
        if (field === 'data') dataLines.push(value);
    }

    if (dataLines.length === 0) return null;
    try {
        const data = JSON.parse(dataLines.join('\n'));
        return { event, data, task_id: data.task_id };
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

    async healthCheck(): Promise<boolean> {
        try {
            const res = await fetch(`${this.baseUrl}/health`);
            return res.ok;
        } catch {
            return false;
        }
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
    ): Promise<void> {
        if (!approvalId) throw new Error('Approval request is missing approval_id');
        const res = await fetch(`${this.baseUrl}/task/${encodeURIComponent(taskId)}/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ approval_id: approvalId, approved, ...(reason ? { reason } : {}) }),
        });
        if (!res.ok) throw await responseError(res, 'Approval resolution');
    }

    async listTools(): Promise<string[]> {
        const res = await fetch(`${this.baseUrl}/tools`);
        if (!res.ok) throw await responseError(res, 'Tool list request');
        const data = await res.json() as { tools?: string[] };
        return data.tools || [];
    }

    /** Stream events for one task. Returns an abort function. */
    streamEvents(
        onEvent: (event: SSEEvent) => void,
        onError: (err: Error) => void,
        taskId?: string,
    ): () => void {
        const controller = new AbortController();
        this.abortController?.abort();
        this.abortController = controller;
        const query = taskId ? `?task_id=${encodeURIComponent(taskId)}` : '';

        void fetch(`${this.baseUrl}/api/stream${query}`, {
            signal: controller.signal,
            headers: { Accept: 'text/event-stream' },
        })
            .then(async (response) => {
                if (!response.ok) throw await responseError(response, 'Event stream');
                const reader = response.body?.getReader();
                if (!reader) throw new Error('Event stream returned no response body');

                const decoder = new TextDecoder();
                let buffer = '';
                while (true) {
                    const { done, value } = await reader.read();
                    buffer += decoder.decode(value, { stream: !done });
                    const frames = buffer.split(/\r?\n\r?\n/);
                    buffer = frames.pop() || '';
                    for (const frame of frames) {
                        const event = parseSseFrame(frame);
                        if (event) onEvent(event);
                    }
                    if (done) break;
                }
                const finalEvent = parseSseFrame(buffer);
                if (finalEvent) onEvent(finalEvent);
            })
            .catch((err: unknown) => {
                if (controller.signal.aborted) return;
                onError(err instanceof Error ? err : new Error(String(err)));
            })
            .finally(() => {
                if (this.abortController === controller) this.abortController = null;
            });

        return () => {
            controller.abort();
            if (this.abortController === controller) this.abortController = null;
        };
    }
}
