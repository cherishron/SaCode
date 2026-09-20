/** SSE frame parsing + reconnect stream for daemon /api/stream */

export interface SSEEvent {
    event: string;
    data: unknown;
    id?: string;
    task_id?: string;
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
        return {
            event,
            data,
            ...(id !== undefined ? { id } : {}),
            ...(extractTaskId(data) !== undefined ? { task_id: extractTaskId(data) } : {}),
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

export interface StreamOptions {
    baseUrl: string;
    taskId?: string;
    token?: string;
    onEvent: (event: SSEEvent) => void;
    onError: (err: Error) => void;
    onOpen?: () => void;
    /** Injectable for tests; defaults to global fetch. */
    fetchImpl?: typeof fetch;
}

/**
 * Open /api/stream with Last-Event-ID reconnect.
 * Returns an abort function.
 */
export function openEventStream(options: StreamOptions): () => void {
    const fetchImpl = options.fetchImpl ?? fetch;
    const controller = new AbortController();
    const query = options.taskId ? `?task_id=${encodeURIComponent(options.taskId)}` : '';
    let lastEventId: string | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let connectedOnce = false;

    const connect = async (): Promise<void> => {
        try {
            const headers: Record<string, string> = { Accept: 'text/event-stream' };
            if (lastEventId) headers['Last-Event-ID'] = lastEventId;
            if (options.token) headers.Authorization = `Bearer ${options.token}`;
            const response = await fetchImpl(`${options.baseUrl}/api/stream${query}`, {
                signal: controller.signal,
                headers,
            });
            if (!response.ok) throw new Error(`Event stream failed (${response.status})`);
            const reader = response.body?.getReader();
            if (!reader) throw new Error('Event stream returned no response body');

            connectedOnce = true;
            options.onOpen?.();
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
                        options.onEvent(event);
                    }
                }
                if (done) break;
            }
            const finalEvent = parseSseFrame(buffer);
            if (finalEvent) {
                if (finalEvent.id !== undefined) lastEventId = finalEvent.id || undefined;
                options.onEvent(finalEvent);
            }
            if (!controller.signal.aborted) {
                reconnectTimer = setTimeout(() => void connect(), 1000);
            }
        } catch (err: unknown) {
            if (controller.signal.aborted) return;
            const error = err instanceof Error ? err : new Error(String(err));
            if (!connectedOnce) {
                options.onError(error);
                return;
            }
            reconnectTimer = setTimeout(() => void connect(), 1000);
        }
    };

    void connect();

    return () => {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        controller.abort();
    };
}
