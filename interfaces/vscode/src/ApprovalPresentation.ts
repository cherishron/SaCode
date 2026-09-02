export interface ApprovalPresentation {
    detail: string;
    summary: string;
}

function normalizeValue(value: unknown): string {
    if (typeof value !== 'string') return '';
    return value.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
}

function truncate(value: string, maxLength: number): string {
    return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

export function buildApprovalPresentation(
    toolName: string,
    sideEffect: string,
    args: Record<string, unknown>,
): ApprovalPresentation {
    const target = normalizeValue(args.path || args.file || args.cwd || args.directory);
    const command = normalizeValue(args.command || args.cmd);
    const oldText = normalizeValue(args.old_string || args.old_str);
    const newText = normalizeValue(args.new_string || args.new_str);
    const explicitDiff = normalizeValue(args.patch || args.diff);
    const diff = explicitDiff || (oldText || newText ? `- ${oldText} + ${newText}` : '');
    const effect = sideEffect || 'Unknown';
    const details = [
        target ? `路径: ${truncate(target, 180)}` : '',
        command ? `命令: ${truncate(command, 180)}` : '',
        diff ? `Diff: ${truncate(diff, 240)}` : '',
    ].filter(Boolean);
    if (details.length === 0) {
        details.push(`参数: ${truncate(JSON.stringify(args), 180)}`);
    }
    details.push(`影响等级: ${effect}`);

    return {
        summary: `${toolName} · ${effect}`,
        detail: details.join('\n'),
    };
}
