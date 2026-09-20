import type { ExecutionMode, ExecutionModeInput, TaskSnapshot } from './taskProtocol';

export interface DaemonConfig {
    host: string;
    port: number;
    /** Optional daemon bearer token (M5). */
    token?: string;
}

/** Daemon /task 创建响应：协议版本 + 顶层兼容字段 + 嵌套任务快照 */
export interface CreateTaskResponse {
    protocol_version: number;
    task_id: string;
    status: string;
    message: string;
    queue_status: string;
    /** 嵌套任务快照；旧 daemon 缺失或解析失败时为 undefined */
    task?: TaskSnapshot;
}

export interface TaskStatus {
    task_id: string;
    status: string;
    queue_status?: string;
    prompt?: string;
    mode?: string;
    error?: string | null;
    output?: string | null;
    duration_ms?: number | null;
    protocol_version?: number;
    /** 嵌套任务快照（协议版本 >= 1 时存在）；解析失败为 null */
    task?: TaskSnapshot | null;
}

export interface TaskResult {
    task_id: string;
    response: string;
    status: string;
    learned_facts: string[];
}

/** SSE 事件：data 为未知边界，消费方必须用运行时校验处理 */
export interface SSEEvent {
    event: string;
    data: unknown;
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

export type { ExecutionMode, ExecutionModeInput, TaskSnapshot };
