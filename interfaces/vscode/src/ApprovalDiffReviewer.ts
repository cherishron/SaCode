import * as path from 'path';
import * as vscode from 'vscode';
import { ApprovalRequestView } from './ApprovalUi';
import { applyHunks, parseUnifiedDiff } from './ApprovalDiff';

interface DiffPreview {
    path: string;
    original: string;
    proposed: string;
}

export interface DiffReviewResult {
    approved: boolean;
    reason?: string;
    argsOverride?: Record<string, unknown>;
}

export class ApprovalDiffReviewer implements vscode.Disposable {
    private static readonly scheme = 'sacode-approval-diff';
    private readonly contents = new Map<string, string>();
    private readonly registration: vscode.Disposable;

    constructor() {
        this.registration = vscode.workspace.registerTextDocumentContentProvider(
            ApprovalDiffReviewer.scheme,
            { provideTextDocumentContent: (uri) => this.contents.get(uri.toString()) || '' },
        );
    }

    dispose(): void {
        this.registration.dispose();
        this.contents.clear();
    }

    supports(request: ApprovalRequestView): boolean {
        return request.toolName === 'fs.edit' || request.toolName === 'fs.apply_patch';
    }

    async review(request: ApprovalRequestView): Promise<DiffReviewResult | undefined> {
        const previews = await this.buildPreviews(request);
        if (previews.length === 0) return undefined;

        const accepted: string[] = [];
        for (let index = 0; index < previews.length; index += 1) {
            const preview = previews[index];
            await this.openDiff(request, preview, index);
            const choice = await vscode.window.showInformationMessage(
                `审阅 ${preview.path}（${index + 1}/${previews.length}）：左侧为当前内容，右侧为批准后内容。`,
                '接受此文件',
                '拒绝此文件',
                '拒绝整个操作',
            );
            if (choice === '拒绝整个操作' || choice === undefined) {
                return { approved: false, reason: choice ? 'diff_review_denied' : 'user_dismissed' };
            }
            if (choice === '接受此文件') accepted.push(preview.path);
        }

        if (accepted.length === 0) {
            return { approved: false, reason: 'diff_review_all_files_rejected' };
        }
        if (request.toolName === 'fs.apply_patch' && accepted.length < previews.length) {
            return {
                approved: true,
                reason: 'diff_review_partial',
                argsOverride: { paths: accepted },
            };
        }
        return { approved: true, reason: 'diff_review_approved' };
    }

    private async buildPreviews(request: ApprovalRequestView): Promise<DiffPreview[]> {
        if (request.toolName === 'fs.edit') {
            const filePath = requiredString(request.args.path, 'path');
            const original = await this.readWorkspaceFile(filePath);
            const oldText = requiredString(request.args.old_string, 'old_string');
            const newText = requiredString(request.args.new_string, 'new_string');
            const replaceAll = request.args.replace_all === true;
            const occurrenceCount = original.split(oldText).length - 1;
            if (occurrenceCount === 0) throw new Error(`old_string 未在 ${filePath} 中找到`);
            if (!replaceAll && occurrenceCount !== 1) {
                throw new Error(`old_string 在 ${filePath} 中出现 ${occurrenceCount} 次`);
            }
            return [{
                path: filePath,
                original,
                proposed: replaceAll ? original.split(oldText).join(newText) : original.replace(oldText, newText),
            }];
        }

        const patch = requiredString(request.args.patch, 'patch');
        const allowed = Array.isArray(request.args.paths)
            ? new Set(request.args.paths.filter((value): value is string => typeof value === 'string'))
            : undefined;
        const filePatches = parseUnifiedDiff(patch).filter((item) => !allowed || allowed.has(item.path));
        const previews: DiffPreview[] = [];
        for (const filePatch of filePatches) {
            const original = await this.readWorkspaceFile(filePatch.path);
            previews.push({
                path: filePatch.path,
                original,
                proposed: applyHunks(original, filePatch.hunks),
            });
        }
        return previews;
    }

    private async openDiff(request: ApprovalRequestView, preview: DiffPreview, index: number): Promise<void> {
        const originalUri = workspaceUri(preview.path);
        const proposedUri = vscode.Uri.from({
            scheme: ApprovalDiffReviewer.scheme,
            path: `/${encodeURIComponent(request.approvalId)}/${index}/${path.basename(preview.path)}`,
            query: `path=${encodeURIComponent(preview.path)}`,
        });
        this.contents.set(proposedUri.toString(), preview.proposed);
        await vscode.commands.executeCommand(
            'vscode.diff',
            originalUri,
            proposedUri,
            `SaCode 审批: ${preview.path}`,
            { preview: true },
        );
    }

    private async readWorkspaceFile(relativePath: string): Promise<string> {
        const bytes = await vscode.workspace.fs.readFile(workspaceUri(relativePath));
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }
}

function workspaceUri(relativePath: string): vscode.Uri {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) throw new Error('请先打开工作区再审阅文件修改');
    const root = path.resolve(folder.uri.fsPath);
    const target = path.resolve(root, relativePath);
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`文件路径超出工作区: ${relativePath}`);
    }
    return vscode.Uri.file(target);
}

function requiredString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.length === 0) throw new Error(`缺少 ${field}`);
    return value;
}
