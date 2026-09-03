import assert from 'node:assert/strict';
import test from 'node:test';
import { ApprovalDeduplicator } from '../src/ApprovalDeduplicator';
import { buildApprovalPresentation } from '../src/ApprovalPresentation';
import { daemonHealthError, isVersionAtLeast, MINIMUM_DAEMON_VERSION, parseSseFrame, SseClient } from '../src/SseClient';

test('minimum daemon version accepts compatible patch and newer releases', () => {
    assert.equal(MINIMUM_DAEMON_VERSION, '1.1.1');
    assert.equal(isVersionAtLeast('1.1.1', MINIMUM_DAEMON_VERSION), true);
    assert.equal(isVersionAtLeast('v1.1.2', MINIMUM_DAEMON_VERSION), true);
    assert.equal(isVersionAtLeast('1.2.0-beta.1', MINIMUM_DAEMON_VERSION), true);
    assert.equal(isVersionAtLeast('1.1.1+build.7', MINIMUM_DAEMON_VERSION), true);
    assert.equal(isVersionAtLeast('1.1.1-beta.1', MINIMUM_DAEMON_VERSION), false);
    assert.equal(isVersionAtLeast('1.1.1-beta.2', '1.1.1-beta.1'), true);
    assert.equal(isVersionAtLeast('1.1.1-beta.1', '1.1.1-beta.2'), false);
    assert.equal(isVersionAtLeast('1.1.0', MINIMUM_DAEMON_VERSION), false);
    assert.equal(isVersionAtLeast('invalid', MINIMUM_DAEMON_VERSION), false);
});

test('daemon health errors distinguish compatibility and status failures', () => {
    assert.equal(daemonHealthError({ status: 'healthy', version: '1.1.1' }), null);
    assert.match(daemonHealthError({ status: 'healthy', version: '1.1.0' }) || '', /incompatible/);
    assert.match(daemonHealthError({ status: 'unhealthy', version: '1.1.1' }) || '', /unhealthy/);
});

test('health parses daemon version and rejects malformed responses', async () => {
    const originalFetch = globalThis.fetch;
    try {
        globalThis.fetch = async () => new Response(
            JSON.stringify({ status: 'healthy', version: '1.1.1' }),
            { status: 200 },
        );
        const client = new SseClient({ host: '127.0.0.1', port: 8080 });
        assert.deepEqual(await client.health(), { status: 'healthy', version: '1.1.1' });
        assert.equal(await client.healthCheck(), true);

        globalThis.fetch = async () => new Response(
            JSON.stringify({ status: 'healthy' }),
            { status: 200 },
        );
        assert.deepEqual(await client.health(), { status: 'healthy', version: '' });
        assert.equal(await client.healthCheck(), false);

        globalThis.fetch = async () => new Response(
            JSON.stringify({ status: 'unhealthy', version: '1.1.1' }),
            { status: 200 },
        );
        assert.equal(await client.healthCheck(), false);

        globalThis.fetch = async () => new Response('not found', { status: 404 });
        assert.deepEqual(await client.health(), { status: 'http_404', version: '' });

        globalThis.fetch = async () => new Response('not-json', { status: 200 });
        assert.deepEqual(await client.health(), { status: 'invalid_response', version: '' });
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('parseSseFrame parses CRLF frames and event names', () => {
    const event = parseSseFrame('event: approval_requested\r\ndata: {"task_id":"task-1","approval_id":"a-1"}\r\n');
    assert.deepEqual(event, {
        event: 'approval_requested',
        data: { task_id: 'task-1', approval_id: 'a-1' },
        task_id: 'task-1',
    });
});

test('parseSseFrame joins multiline data and ignores comments', () => {
    const event = parseSseFrame(': keepalive\ndata: {"task_id":"task-2",\ndata: "status":"completed"}');
    assert.equal(event?.event, 'message');
    assert.deepEqual(event?.data, { task_id: 'task-2', status: 'completed' });
});

test('parseSseFrame rejects malformed or empty frames', () => {
    assert.equal(parseSseFrame('event: message\ndata: not-json'), null);
    assert.equal(parseSseFrame(': keepalive'), null);
});

test('ApprovalDeduplicator accepts each approval id once until cleared', () => {
    const approvals = new ApprovalDeduplicator();
    assert.equal(approvals.accept('approval-1'), true);
    assert.equal(approvals.accept('approval-1'), false);
    assert.equal(approvals.accept(''), false);
    approvals.clear();
    assert.equal(approvals.accept('approval-1'), true);
});

test('buildApprovalPresentation normalizes target and displays side effect', () => {
    const presentation = buildApprovalPresentation('fs.edit', 'Modify', {
        path: '  src\\file.ts\n',
        diff: '@@ -1 +1 @@\n-old\n+new',
    });
    assert.equal(presentation.summary, 'fs.edit · Modify');
    assert.match(presentation.detail, /路径: src\\file.ts/);
    assert.match(presentation.detail, /Diff: @@ -1 \+1 @@ -old \+new/);
    assert.match(presentation.detail, /影响等级: Modify/);
});

test('resolveApproval sends approval reason in request body', async () => {
    const originalFetch = globalThis.fetch;
    let requestBody = '';
    globalThis.fetch = async (_input, init) => {
        requestBody = String(init?.body || '');
        return new Response(null, { status: 200 });
    };
    try {
        const client = new SseClient({ host: '127.0.0.1', port: 8080 });
        await client.resolveApproval('task-1', 'approval-1', false, 'user_dismissed');
        assert.deepEqual(JSON.parse(requestBody), {
            approval_id: 'approval-1',
            approved: false,
            reason: 'user_dismissed',
        });
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('resolveApproval surfaces daemon status and JSON error detail', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(
        JSON.stringify({ error: 'approval task mismatch' }),
        { status: 409, statusText: 'Conflict' },
    );
    try {
        const client = new SseClient({ host: '127.0.0.1', port: 8080 });
        await assert.rejects(
            client.resolveApproval('task-1', 'approval-1', true),
            /Approval resolution failed \(409 Conflict\): approval task mismatch/,
        );
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('streamEvents filters by encoded task id and reports HTTP errors', async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = '';
    let requestedAccept = '';
    globalThis.fetch = async (input, init) => {
        requestedUrl = String(input);
        requestedAccept = new Headers(init?.headers).get('Accept') || '';
        return new Response('stream unavailable', { status: 503, statusText: 'Unavailable' });
    };
    try {
        const client = new SseClient({ host: '127.0.0.1', port: 8080 });
        const error = await new Promise<Error>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('stream error callback timed out')), 500);
            client.streamEvents(
                () => reject(new Error('unexpected event')),
                (err) => {
                    clearTimeout(timer);
                    resolve(err);
                },
                'task/with space',
            );
        });
        assert.equal(requestedUrl, 'http://127.0.0.1:8080/api/stream?task_id=task%2Fwith%20space');
        assert.equal(requestedAccept, 'text/event-stream');
        assert.match(error.message, /Event stream failed \(503 Unavailable\): stream unavailable/);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
