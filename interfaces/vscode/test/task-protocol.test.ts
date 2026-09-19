import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import {
    ProtocolCompatibilityError,
    parseApprovalList,
    parseTaskResponse,
    parseTaskResult,
    parseTaskStatusBody,
    parseToolList,
} from '../src/SseClient';
import { decodeSseEvent } from '../src/sseEvents';
import {
    FAILURE_CATEGORY_LABELS,
    SUGGESTED_ACTION_LABELS,
    TASK_PROTOCOL_VERSION,
    TASK_STATE_LABELS,
    isProtocolVersionSupported,
    isTerminalState,
    normalizeExecutionMode,
    parseTaskSnapshot,
    phaseForState,
} from '../src/taskProtocol';
import type { TaskSnapshot } from '../src/taskProtocol';

const fixtureRoot = path.join(process.cwd(), 'test', 'fixtures', 'task-protocol');

interface Fixture {
    name: string;
    value: unknown;
}

function loadFixtures(folder: string): Fixture[] {
    const dir = path.join(fixtureRoot, folder);
    return fs.readdirSync(dir)
        .filter((file) => file.endsWith('.json'))
        .sort()
        .map((file) => ({
            name: path.basename(file, '.json'),
            value: JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as unknown,
        }));
}

/**
 * Rust serde 把 None 序列化为 null，TypeScript 解析时丢弃 null 键。
 * 两者语义等价，比较前先剔除 null 键。
 */
function withoutNulls(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(withoutNulls);
    if (value !== null && typeof value === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
            if (item === null) continue;
            result[key] = withoutNulls(item);
        }
        return result;
    }
    return value;
}

test('protocol version contract exposes a single supported version', () => {
    assert.equal(TASK_PROTOCOL_VERSION, 1);
    assert.equal(isProtocolVersionSupported(1), true);
    assert.equal(isProtocolVersionSupported(0), false);
    assert.equal(isProtocolVersionSupported(2), false);
    assert.equal(isProtocolVersionSupported(undefined), false);
    assert.equal(isProtocolVersionSupported(1.5), false);
});

test('valid task protocol fixtures parse into snapshots with stable terminal meaning', () => {
    const fixtures = loadFixtures('valid');
    assert.ok(fixtures.length >= 6, `expected at least 6 valid fixtures, got ${fixtures.length}`);

    for (const fixture of fixtures) {
        const raw = fixture.value as Record<string, unknown>;
        const snapshot = parseTaskSnapshot(fixture.value);
        assert.notEqual(snapshot, null, `${fixture.name} must parse`);
        const parsed = snapshot as TaskSnapshot;

        assert.equal(parsed.schema_version, 1, `${fixture.name} schema_version`);
        assert.equal(parsed.task_id, raw.task_id, `${fixture.name} task_id`);
        assert.equal(parsed.mode, raw.mode, `${fixture.name} mode`);
        assert.equal(parsed.source, raw.source, `${fixture.name} source`);
        assert.equal(parsed.state, raw.state, `${fixture.name} state`);
        assert.equal(parsed.phase, raw.phase, `${fixture.name} phase`);
        assert.equal(phaseForState(parsed.state), parsed.phase, `${fixture.name} phase matches state`);
        assert.deepEqual(parsed.timestamps, withoutNulls(raw.timestamps), `${fixture.name} timestamps`);
        if (raw.result !== null) {
            assert.deepEqual(parsed.result, withoutNulls(raw.result), `${fixture.name} result`);
        }
        if (raw.validation !== null) {
            assert.deepEqual(parsed.validation, withoutNulls(raw.validation), `${fixture.name} validation`);
        }
        if (raw.route !== null) {
            assert.deepEqual(parsed.route, withoutNulls(raw.route), `${fixture.name} route`);
        }


        if (isTerminalState(parsed.state)) {
            assert.notEqual(parsed.terminal_outcome, undefined, `${fixture.name} carries an outcome`);
            const outcome = parsed.terminal_outcome as string;
            const expected = parsed.state === 'completed'
                ? 'success'
                : parsed.state === 'failed' ? 'failure' : 'cancelled';
            assert.equal(outcome, expected, `${fixture.name} terminal outcome matches state`);
        } else {
            assert.equal(parsed.terminal_outcome, undefined, `${fixture.name} is not terminal`);
        }

        if (parsed.state === 'failed') {
            const failure = parsed.failure;
            assert.notEqual(failure, undefined, `${fixture.name} failed state carries failure`);
            assert.equal(typeof (failure as { code: unknown }).code, 'string');
        } else {
            assert.equal(parsed.failure, undefined, `${fixture.name} without failure`);
        }

        assert.deepEqual(parseTaskSnapshot(parsed), parsed, `${fixture.name} is idempotent`);
    }
});

test('invalid task protocol fixtures are rejected instead of misreported as success', () => {
    const fixtures = loadFixtures('invalid');
    assert.ok(fixtures.length >= 8, `expected at least 8 invalid fixtures, got ${fixtures.length}`);

    for (const fixture of fixtures) {
        assert.equal(parseTaskSnapshot(fixture.value), null, `${fixture.name} must be rejected`);
    }
    assert.equal(parseTaskSnapshot(null), null);
    assert.equal(parseTaskSnapshot(undefined), null);
    assert.equal(parseTaskSnapshot('not-an-object'), null);
    assert.equal(parseTaskSnapshot([]), null);
});

test('execution mode keeps yolo only as an input alias', () => {
    assert.equal(normalizeExecutionMode('yolo'), 'auto');
    assert.equal(normalizeExecutionMode('auto'), 'auto');
    assert.equal(normalizeExecutionMode('build'), 'build');
    assert.equal(normalizeExecutionMode('plan'), 'plan');
    assert.equal(normalizeExecutionMode(undefined), 'auto');
    assert.equal(normalizeExecutionMode('nope'), 'auto');
});

test('state to phase mapping mirrors the kernel mapping', () => {
    assert.equal(phaseForState('pending'), 'queued');
    assert.equal(phaseForState('ready'), 'queued');
    assert.equal(phaseForState('retrying'), 'queued');
    assert.equal(phaseForState('running'), 'executing');
    assert.equal(phaseForState('waiting_for_user'), 'waiting_for_user');
    assert.equal(phaseForState('waiting_for_approval'), 'waiting_for_approval');
    assert.equal(phaseForState('cancelling'), 'cancelling');
    assert.equal(phaseForState('completed'), 'finished');
    assert.equal(phaseForState('failed'), 'finished');
    assert.equal(phaseForState('cancelled'), 'finished');
    assert.equal(isTerminalState('cancelling'), false);
    assert.equal(isTerminalState('completed'), true);
});

test('labels cover every enum value so no terminal state renders as undefined', () => {
    const states = ['pending', 'ready', 'retrying', 'running', 'waiting_for_user',
        'waiting_for_approval', 'cancelling', 'completed', 'failed', 'cancelled'] as const;
    for (const state of states) {
        assert.equal(typeof TASK_STATE_LABELS[state], 'string');
        assert.ok(TASK_STATE_LABELS[state].length > 0);
    }
    assert.equal(FAILURE_CATEGORY_LABELS.provider, '模型服务');
    assert.equal(SUGGESTED_ACTION_LABELS.reconfigure_provider, '重新配置模型服务');
    assert.equal(Object.keys(SUGGESTED_ACTION_LABELS).length, 8);
});

test('task creation response requires a supported protocol version', () => {
    const body = {
        protocol_version: 1,
        task_id: 'task-1',
        status: 'pending',
        message: 'queued',
        queue_status: 'pending',
    };
    const parsed = parseTaskResponse(body);
    assert.equal(parsed.protocol_version, 1);
    assert.equal(parsed.task_id, 'task-1');

    assert.throws(() => parseTaskResponse({ ...body, protocol_version: 2 }), ProtocolCompatibilityError);
    assert.throws(() => parseTaskResponse({ task_id: 'task-1', status: 'pending' }), ProtocolCompatibilityError);
    assert.throws(() => parseTaskResponse({ protocol_version: 1, status: 'pending' }), /task_id or status/);
});

test('task creation response parses the nested snapshot when the daemon sends one', () => {
    const snapshot = parseTaskSnapshot(loadFixtures('valid').find((f) => f.name === 'queued')?.value);
    assert.notEqual(snapshot, null);
    const parsed = parseTaskResponse({
        protocol_version: 1,
        task_id: 'task-queued',
        status: 'pending',
        queue_status: 'pending',
        task: snapshot,
    });
    assert.equal(parsed.task?.task_id, 'task-queued');
    assert.equal(parsed.task?.state, 'pending');
});

test('task status tolerates a legacy daemon without protocol version', () => {
    const parsed = parseTaskStatusBody({ task_id: 'task-1', status: 'running' });
    assert.equal(parsed.protocol_version, undefined);
    assert.equal(parsed.task, null);

    assert.throws(() => parseTaskStatusBody({ task_id: 'task-1', status: 'running', protocol_version: 2 }),
        ProtocolCompatibilityError);
    assert.throws(() => parseTaskStatusBody({ status: 'running' }), /task_id or status/);

    const fixture = loadFixtures('valid').find((f) => f.name === 'failed');
    const withSnapshot = parseTaskStatusBody({
        task_id: 'task-1',
        status: 'failed',
        protocol_version: 1,
        task: fixture?.value,
    });
    assert.equal(withSnapshot.task?.state, 'failed');
    assert.equal(withSnapshot.task?.terminal_outcome, 'failure');
});

test('task result and list endpoints degrade safely on malformed bodies', () => {
    assert.deepEqual(parseTaskResult({ task_id: 't', status: 'completed', response: 'ok' }), {
        task_id: 't',
        status: 'completed',
        response: 'ok',
        learned_facts: [],
    });
    assert.deepEqual(parseTaskResult({
        task_id: 't',
        status: 'completed',
        response: 'ok',
        learned_facts: ['a', 7, 'b'],
    }).learned_facts, ['a', 'b']);
    assert.throws(() => parseTaskResult({ task_id: 't' }), /unexpected response body/);

    assert.deepEqual(parseApprovalList({ approvals: [{ approval_id: 'a1', task_id: 't1', tool_name: 'fs.write' }] }), [{
        approval_id: 'a1',
        task_id: 't1',
        tool_name: 'fs.write',
        side_effect_level: 'Unknown',
        args: {},
        waited_secs: 0,
        timeout_secs: 0,
        expires_in_secs: 0,
    }]);
    assert.deepEqual(parseApprovalList({ approvals: [{ tool_name: 'fs.write' }, 'bad'] }), []);
    assert.deepEqual(parseApprovalList({}), []);
    assert.deepEqual(parseToolList({ tools: ['fs.read', 3, 'fs.write'] }), ['fs.read', 'fs.write']);
    assert.deepEqual(parseToolList(null), []);
});

function envelope(eventType: string, payload: Record<string, unknown>): Record<string, unknown> {
    return {
        protocol_version: 1,
        task_id: 'task-1',
        event_type: eventType,
        schema_version: 1,
        payload,
        ...payload,
    };
}

test('sse events are decoded through the daemon payload envelope', () => {
    const message = decodeSseEvent({ event: 'message', data: envelope('message', { content: 'hello' }) });
    assert.equal(message.eventType, 'message');
    assert.equal(message.text?.content, 'hello');
    assert.equal(message.text?.kind, 'message');
    assert.equal(message.taskId, 'task-1');

    const tool = decodeSseEvent({ event: 'tool_call_started', data: envelope('tool_call_started', {
        name: 'fs.edit',
        args: { path: 'src/a.ts', old_string: 'a', new_string: 'b' },
    }) });
    assert.equal(tool.toolCall?.name, 'fs.edit');
    assert.deepEqual(tool.toolCall?.input, { path: 'src/a.ts', old_string: 'a', new_string: 'b' });

    const approval = decodeSseEvent({ event: 'approval_requested', data: envelope('approval_requested', {
        approval_id: 'approval-1',
        tool_name: 'fs.write',
        side_effect_level: 'Modify',
        args: { path: 'README.md' },
        task_id: 'task-2',
    }) });
    assert.equal(approval.approval?.approvalId, 'approval-1');
    assert.equal(approval.approval?.taskId, 'task-2');
    assert.equal(approval.approval?.sideEffect, 'Modify');
});

test('sse terminal events resolve the outcome without claiming success on done', () => {
    assert.equal(decodeSseEvent({ event: 'task_completed', data: envelope('task_completed', {}) }).terminal?.outcome,
        'completed');
    assert.deepEqual(decodeSseEvent({ event: 'task_failed', data: envelope('task_failed', { error: 'boom' }) })
        .terminal, { outcome: 'failed', message: 'boom' });
    assert.deepEqual(decodeSseEvent({ event: 'done', data: envelope('done', {}) }).terminal, {});

    const snapshot = parseTaskSnapshot(loadFixtures('valid').find((f) => f.name === 'cancelled')?.value);
    assert.notEqual(snapshot, null);
    const decoded = decodeSseEvent({
        event: 'task_completed',
        data: envelope('task_completed', { task: snapshot }),
    });
    assert.equal(decoded.snapshot?.state, 'cancelled');
    assert.equal(decoded.terminal?.outcome, 'completed');
});

test('sse status updates report the daemon state instead of an event outcome', () => {
    const running = decodeSseEvent({ event: 'message', data: envelope('task_status', { status: 'running' }) });
    assert.equal(running.terminal, undefined);
    assert.equal(running.snapshot, undefined);

    const finished = decodeSseEvent({ event: 'message', data: envelope('task_status', { status: 'failed' }) });
    assert.equal(finished.terminal?.outcome, 'failed');
});

test('unknown sse events and malformed payloads are ignored safely', () => {
    const unknown = decodeSseEvent({ event: 'unknown_event', data: envelope('unknown_event', { anything: 1 }) });
    assert.equal(unknown.toolCall, undefined);
    assert.equal(unknown.text, undefined);
    assert.equal(unknown.approval, undefined);
    assert.equal(unknown.terminal, undefined);
    assert.equal(unknown.snapshot, undefined);

    assert.equal(decodeSseEvent({ event: 'message', data: 'not-json' }).eventType, 'message');
    assert.equal(decodeSseEvent({ event: 'message', data: [1, 2] }).text, undefined);
    assert.equal(decodeSseEvent({ event: 'message', data: { event_type: 3 } }).eventType, 'message');

    const approvalWithoutId = decodeSseEvent({ event: 'approval_requested', data: envelope('approval_requested', {
        tool_name: 'fs.write',
    }) });
    assert.equal(approvalWithoutId.approval, undefined);
});