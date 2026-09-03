import assert from 'node:assert/strict';
import test from 'node:test';
import { applyHunks, parseUnifiedDiff } from '../src/ApprovalDiff';

test('parseUnifiedDiff separates files and applyHunks builds proposed content', () => {
    const patch = [
        'diff --git a/src/a.ts b/src/a.ts',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -1,2 +1,2 @@',
        ' const a = 1;',
        '-old',
        '+new',
        'diff --git a/src/b.ts b/src/b.ts',
        '--- a/src/b.ts',
        '+++ b/src/b.ts',
        '@@ -1 +1 @@',
        '-before',
        '+after',
        '',
    ].join('\n');

    const files = parseUnifiedDiff(patch);
    assert.deepEqual(files.map((file) => file.path), ['src/a.ts', 'src/b.ts']);
    assert.equal(applyHunks('const a = 1;\nold\n', files[0].hunks), 'const a = 1;\nnew\n');
    assert.equal(applyHunks('before\n', files[1].hunks), 'after\n');
});

test('applyHunks rejects stale context instead of showing a misleading preview', () => {
    const [file] = parseUnifiedDiff([
        'diff --git a/a.txt b/a.txt',
        '--- a/a.txt',
        '+++ b/a.txt',
        '@@ -1 +1 @@',
        '-expected',
        '+replacement',
    ].join('\n'));

    assert.throws(() => applyHunks('actual\n', file.hunks), /hunk 匹配失败/);
});
