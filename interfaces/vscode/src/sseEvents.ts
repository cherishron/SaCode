/**
 * SSE 事件类型化解析。
 *
 * Daemon 事件负载属于未知边界：解析失败或形状不匹配时返回 undefined，
 * 调用方按「安全忽略」处理，不崩溃、不误报成功。
 */

import { parseTaskSnapshot } from './taskProtocol';
import type { TaskSnapshot } from './taskProtocol';
import type { SSEEvent } from './types';

export type TerminalOutcome = 'completed' | 'failed' | 'cancelled';

export interface ToolCallInfo {
    name: string;
    input: Record<string, unknown> | string;
}

export interface TextInfo {
    content: string;
    kind: 'message' | 'thinking';
}

export interface ApprovalInfo {
    approvalId: string;
    taskId: string;
    toolName: string;
    sideEffect: string;
    args: Record<string, unknown>;
}

/** 终态标记：`outcome` 缺失表示事件声明结束但未声明具体结局（如 `done`） */
export interface TerminalInfo {
    outcome?: TerminalOutcome;
    message?: string;
}

export interface DecodedSseEvent {
    eventType: string;
    data: Record<string, unknown>;
    payload: Record<string, unknown>;
    taskId?: string;
    toolCall?: ToolCallInfo;
    text?: TextInfo;
    approval?: ApprovalInfo;
    terminal?: TerminalInfo;
    snapshot?: TaskSnapshot;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstString(values: unknown[], fallback: string): string {
    for (const value of values) {
        if (typeof value === 'string' && value.length > 0) return value;
    }
    return fallback;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function outcomeForEventType(eventType: string): TerminalOutcome | undefined {
    switch (eventType) {
        case 'task_completed':
        case 'task_success':
            return 'completed';
        case 'task_failed':
        case 'task_failure':
            return 'failed';
        case 'task_cancelled':
            return 'cancelled';
        default:
            return undefined;
    }
}

const STATUS_TO_OUTCOME: Readonly<Record<string, TerminalOutcome>> = {
    completed: 'completed',
    success: 'completed',
    failed: 'failed',
    failure: 'failed',
    cancelled: 'cancelled',
    canceled: 'cancelled',
};

const TOOL_EVENTS: ReadonlySet<string> = new Set([
    'tool_call_started',
    'tool_call_completed',
    'tool',
    'tool_call',
]);

const TEXT_EVENTS: ReadonlySet<string> = new Set([
    'message',
    'text',
    'thinking',
    'delta',
    'message_delta',
]);

const APPROVAL_EVENTS: ReadonlySet<string> = new Set(['approval_requested']);

function decodeToolCall(data: Record<string, unknown>, payload: Record<string, unknown>): ToolCallInfo | undefined {
    const name = firstString(
        [data.name, data.tool_name, payload.name, payload.tool_name, payload.tool],
        'tool',
    );
    const candidates = [data.input, payload.input, data.args, payload.args];
    for (const candidate of candidates) {
        if (typeof candidate === 'string') return { name, input: candidate };
        if (isRecord(candidate)) return { name, input: candidate };
    }
    return { name, input: {} };
}

function decodeText(data: Record<string, unknown>, payload: Record<string, unknown>, eventType: string): TextInfo | undefined {
    const content = optionalString(data.content)
        ?? optionalString(data.text)
        ?? optionalString(payload.content)
        ?? optionalString(payload.text)
        ?? optionalString(payload.delta);
    if (!content) return undefined;
    const kind = eventType === 'thinking' || data.kind === 'thinking' || payload.kind === 'thinking'
        ? 'thinking'
        : 'message';
    return { content, kind };
}

function decodeApproval(data: Record<string, unknown>, payload: Record<string, unknown>): ApprovalInfo | undefined {
    const approvalId = optionalString(data.approval_id) ?? optionalString(payload.approval_id);
    if (!approvalId) return undefined;
    const args = isRecord(data.args)
        ? data.args
        : isRecord(payload.args)
            ? payload.args
            : {};
    return {
        approvalId,
        taskId: optionalString(data.task_id) ?? optionalString(payload.task_id) ?? '',
        toolName: firstString([data.tool_name, payload.tool_name], 'unknown'),
        sideEffect: firstString([data.side_effect_level, payload.side_effect_level], 'Unknown'),
        args,
    };
}

function decodeTerminal(data: Record<string, unknown>, payload: Record<string, unknown>, eventType: string): TerminalInfo | undefined {
    const outcome = outcomeForEventType(eventType);
    if (outcome) {
        const message = optionalString(data.error)
            ?? optionalString(payload.error)
            ?? optionalString(data.message)
            ?? optionalString(payload.message)
            ?? optionalString(data.output)
            ?? optionalString(payload.output);
        return message !== undefined ? { outcome, message } : { outcome };
    }

    const status = optionalString(data.status) ?? optionalString(payload.status);
    const statusOutcome = status ? STATUS_TO_OUTCOME[status] : undefined;
    if (statusOutcome) {
        const message = optionalString(data.error) ?? optionalString(payload.error);
        return message !== undefined ? { outcome: statusOutcome, message } : { outcome: statusOutcome };
    }

    if (eventType === 'done') return {};
    return undefined;
}

function decodeSnapshot(data: Record<string, unknown>, payload: Record<string, unknown>): TaskSnapshot | undefined {
    for (const candidate of [data.task, data.snapshot, payload.task, payload.snapshot, data]) {
        const snapshot = parseTaskSnapshot(candidate);
        if (snapshot) return snapshot;
    }
    return undefined;
}

/**
 * 类型化解析 SSE 事件。
 *
 * 事件名与负载字段都做运行时校验：未知事件名、未知字段形状一律安全忽略。
 * `terminal` 优先于 `snapshot` 判定，两者都命中时以事件显式终态为准。
 */
export function decodeSseEvent(event: SSEEvent): DecodedSseEvent {
    const data = isRecord(event.data) ? event.data : {};
    const payload = isRecord(data.payload) ? data.payload : data;
    const eventType = firstString([data.event_type, data.event, data.kind, event.event], 'message');
    const decoded: DecodedSseEvent = { eventType, data, payload };

    if (typeof event.task_id === 'string' && event.task_id.length > 0) {
        decoded.taskId = event.task_id;
    } else {
        decoded.taskId = optionalString(data.task_id) ?? optionalString(payload.task_id);
    }

    if (TOOL_EVENTS.has(eventType)) decoded.toolCall = decodeToolCall(data, payload);
    if (TEXT_EVENTS.has(eventType)) decoded.text = decodeText(data, payload, eventType);
    if (APPROVAL_EVENTS.has(eventType)) decoded.approval = decodeApproval(data, payload);
    decoded.terminal = decodeTerminal(data, payload, eventType);
    decoded.snapshot = decodeSnapshot(data, payload);

    return decoded;
}