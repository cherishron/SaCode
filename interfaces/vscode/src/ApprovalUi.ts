import * as vscode from 'vscode';
import { SseClient } from './SseClient';
import { ApprovalDeduplicator } from './ApprovalDeduplicator';
import { buildApprovalPresentation } from './ApprovalPresentation';

export interface ApprovalRequestView {
    taskId: string;
    approvalId: string;
    toolName: string;
    sideEffect: string;
    args: Record<string, unknown>;
}

export async function resolveApprovalWithRetry(
    client: SseClient,
    request: ApprovalRequestView,
    approved: boolean,
    reason?: string,
    argsOverride?: Record<string, unknown>,
): Promise<void> {
    while (true) {
        try {
            await client.resolveApproval(
                request.taskId,
                request.approvalId,
                approved,
                reason,
                argsOverride,
            );
            return;
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            const action = await vscode.window.showErrorMessage(
                `SaCode approval failed: ${message}`,
                '重试',
                '关闭',
            );
            if (action !== '重试') throw err;
        }
    }
}

export function approvalQuickPickOptions(request: ApprovalRequestView) {
    const presentation = buildApprovalPresentation(
        request.toolName,
        request.sideEffect,
        request.args,
    );
    return {
        presentation,
        items: [
            {
                label: '$(check) 允许执行',
                description: presentation.summary,
                detail: presentation.detail,
                approved: true,
            },
            {
                label: '$(x) 拒绝',
                description: presentation.summary,
                detail: presentation.detail,
                approved: false,
            },
        ],
    };
}

export { ApprovalDeduplicator };
