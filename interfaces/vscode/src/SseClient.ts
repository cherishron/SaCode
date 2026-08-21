import * as vscode from 'vscode';
import { DaemonConfig, CreateTaskResponse, TaskResult, SSEEvent, TaskStatus } from './types';

export class SseClient {
    private config: DaemonConfig;
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
        if (!res.ok) throw new Error(`Task creation failed: ${res.statusText}`);
        return res.json();
    }

    async getTaskStatus(taskId: string): Promise<TaskStatus> {
        const res = await fetch(`${this.baseUrl}/task/${taskId}/status`);
        return res.json();
    }

    async getTaskResult(taskId: string): Promise<TaskResult> {
        const res = await fetch(`${this.baseUrl}/task/${taskId}/result`);
        return res.json();
    }

    async cancelTask(taskId: string): Promise<void> {
        await fetch(`${this.baseUrl}/task/${taskId}/cancel`, { method: 'POST' });
    }

    /**
     * P1-1: 提交审批结果
     * @param taskId 任务 ID
     * @param approved 是否批准
     */
    async resolveApproval(taskId: string, approved: boolean): Promise<void> {
        await fetch(`${this.baseUrl}/task/${taskId}/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ approved }),
        });
    }

    async listTools(): Promise<string[]> {
        const res = await fetch(`${this.baseUrl}/tools`);
        const data = await res.json();
        return data.tools || [];
    }

    /**
     * Stream events from /api/stream endpoint.
     * Returns an abort function to stop streaming.
     */
    streamEvents(onEvent: (event: SSEEvent) => void, onError: (err: Error) => void): () => void {
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        fetch(`${this.baseUrl}/api/stream`, { signal })
            .then(async (response) => {
                const reader = response.body?.getReader();
                if (!reader) {
                    onError(new Error('No response body'));
                    return;
                }
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    let currentEvent = 'message';
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (trimmed.startsWith('event: ')) {
                            currentEvent = trimmed.slice(7).trim();
                        } else if (trimmed.startsWith('data: ')) {
                            try {
                                const data = JSON.parse(trimmed.slice(6));
                                onEvent({ event: currentEvent, data, task_id: data.task_id });
                            } catch {
                                // Non-JSON data line, skip
                            }
                            currentEvent = 'message';
                        }
                    }
                }
            })
            .catch((err) => {
                if (err.name !== 'AbortError') {
                    onError(err);
                }
            });

        return () => {
            this.abortController?.abort();
            this.abortController = null;
        };
    }
}