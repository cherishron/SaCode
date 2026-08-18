export interface DaemonConfig {
    host: string;
    port: number;
}

export interface CreateTaskResponse {
    task_id: string;
    status: string;
}

export interface TaskStatus {
    task_id: string;
    status: string;
    phase?: string;
}

export interface TaskResult {
    task_id: string;
    response: string;
    status: string;
    learned_facts: string[];
}

export interface SSEEvent {
    event: string;
    data: any;
    task_id?: string;
}