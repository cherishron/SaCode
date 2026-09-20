import assert from 'node:assert/strict';
import test from 'node:test';
import {
    DEFAULT_AGENT_BACKEND_ID,
    parseTaskSnapshot,
    normalizeBackendId,
    phaseForState,
} from '../src/task-protocol';
import { parseAgentsList, parseTaskResponse } from '../src/daemon-client';
import { parseSseFrame } from '../src/event-stream';

test('legacy task snapshot without backend meta parses', () => {
    const snapshot = parseTaskSnapshot({
        schema_version: 1,
        task_id: 'task-1',
        mode: 'build',
        source: 'daemon',
        state: 'completed',
        phase: 'finished',
        terminal_outcome: 'success',
        timestamps: {},
    });
    assert.ok(snapshot);
    assert.equal(snapshot.backend, undefined);
});

test('task snapshot with backend meta preserves backend_id', () => {
    const snapshot = parseTaskSnapshot({
        schema_version: 1,
        task_id: 'task-2',
        mode: 'build',
        source: 'daemon',
        state: 'running',
        phase: 'executing',
        timestamps: {},
        backend: { backend_id: 'opencode', backend_kind: 'acp' },
    });
    assert.ok(snapshot);
    assert.equal(snapshot.backend?.backend_id, 'opencode');
    assert.equal(snapshot.backend?.backend_kind, 'acp');
});

test('normalizeBackendId defaults empty to sacode', () => {
    assert.equal(normalizeBackendId(undefined), DEFAULT_AGENT_BACKEND_ID);
    assert.equal(normalizeBackendId(''), DEFAULT_AGENT_BACKEND_ID);
    assert.equal(normalizeBackendId('  '), DEFAULT_AGENT_BACKEND_ID);
    assert.equal(normalizeBackendId('opencode'), 'opencode');
});

test('phaseForState matches kernel mapping', () => {
    assert.equal(phaseForState('pending'), 'queued');
    assert.equal(phaseForState('running'), 'executing');
    assert.equal(phaseForState('completed'), 'finished');
});

test('parseTaskResponse requires protocol version', () => {
    assert.throws(() =>
        parseTaskResponse({ task_id: 't', status: 'queued', protocol_version: 0 }),
    );
    const ok = parseTaskResponse({
        protocol_version: 1,
        task_id: 't1',
        status: 'queued',
        message: 'ok',
        queue_status: 'pending',
        task: {
            schema_version: 1,
            task_id: 't1',
            mode: 'build',
            source: 'daemon',
            state: 'pending',
            phase: 'queued',
            timestamps: {},
            backend: { backend_id: 'sacode' },
        },
    });
    assert.equal(ok.task_id, 't1');
    assert.equal(ok.task?.backend?.backend_id, 'sacode');
});

test('parseAgentsList defaults empty', () => {
    const empty = parseAgentsList({});
    assert.equal(empty.agents.length, 0);
    assert.equal(empty.default_backend_id, 'sacode');
    const list = parseAgentsList({
        agents: [{ id: 'sacode', display_name: 'SaCode' }],
        default_backend_id: 'sacode',
    });
    assert.equal(list.agents[0].id, 'sacode');
});

test('parseSseFrame extracts id and task_id', () => {
    const frame = [
        'id: 42',
        'event: task_created',
        'data: {"task_id":"task-9","backend_id":"sacode"}',
    ].join('\n');
    const parsed = parseSseFrame(frame);
    assert.ok(parsed);
    assert.equal(parsed.id, '42');
    assert.equal(parsed.task_id, 'task-9');
    assert.equal((parsed.data as { backend_id?: string }).backend_id, 'sacode');
});
