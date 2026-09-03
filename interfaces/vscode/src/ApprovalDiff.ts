export interface ParsedFilePatch {
    path: string;
    hunks: ParsedHunk[];
}

export interface ParsedHunk {
    oldStart: number;
    lines: Array<{ kind: 'context' | 'add' | 'remove'; content: string }>;
}

export function parseUnifiedDiff(text: string): ParsedFilePatch[] {
    const patches: ParsedFilePatch[] = [];
    let current: ParsedFilePatch | undefined;
    let hunk: ParsedHunk | undefined;
    const lines = text.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (line.startsWith('diff --git ')) {
            const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
            if (!match) throw new Error(`无效 diff 头: ${line}`);
            current = { path: match[2], hunks: [] };
            patches.push(current);
            hunk = undefined;
        } else if (line.startsWith('@@')) {
            if (!current) throw new Error('hunk 前缺少 diff --git 头');
            const match = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(line);
            if (!match) throw new Error(`无效 hunk 头: ${line}`);
            hunk = { oldStart: Number(match[1]), lines: [] };
            current.hunks.push(hunk);
        } else if (hunk && !line.startsWith('--- ') && !line.startsWith('+++ ')) {
            if (line.startsWith('+')) hunk.lines.push({ kind: 'add', content: line.slice(1) });
            else if (line.startsWith('-')) hunk.lines.push({ kind: 'remove', content: line.slice(1) });
            else if (line.startsWith(' ')) hunk.lines.push({ kind: 'context', content: line.slice(1) });
            else if (line === '' && index < lines.length - 1) {
                hunk.lines.push({ kind: 'context', content: '' });
            }
        }
    }
    if (patches.length === 0) throw new Error('patch 中未找到 diff --git 块');
    return patches;
}

export function applyHunks(content: string, hunks: ParsedHunk[]): string {
    let current = content;
    for (const hunk of hunks) {
        const lines = current.split('\n');
        const hadTrailingNewline = current.endsWith('\n');
        if (hadTrailingNewline) lines.pop();
        const start = hunk.oldStart === 0 ? 0 : hunk.oldStart - 1;
        const expected = hunk.lines.filter((line) => line.kind !== 'add').map((line) => line.content);
        const replacement = hunk.lines.filter((line) => line.kind !== 'remove').map((line) => line.content);
        if (start + expected.length > lines.length) throw new Error('hunk 范围超出文件内容');
        for (let index = 0; index < expected.length; index += 1) {
            if (lines[start + index] !== expected[index]) {
                throw new Error(`hunk 匹配失败: 第 ${start + index + 1} 行`);
            }
        }
        lines.splice(start, expected.length, ...replacement);
        current = lines.join('\n') + (hadTrailingNewline ? '\n' : '');
    }
    return current;
}
