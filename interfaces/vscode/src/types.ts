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
    id?: string;
    task_id?: string;
}

export interface PendingApprovalEntry {
    approval_id: string;
    task_id: string;
    tool_name: string;
    side_effect_level: string;
    args: Record<string, unknown>;
    waited_secs: number;
    timeout_secs: number;
    expires_in_secs: number;
}
