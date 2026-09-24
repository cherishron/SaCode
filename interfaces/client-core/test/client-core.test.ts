import assert from 'node:assert/strict';
import test from 'node:test';
import {
    DEFAULT_AGENT_BACKEND_ID,
    parseTaskSnapshot,
    normalizeBackendId,
    phaseForState,
} from '../src/task-protocol';
import {
    parseAgentsList,
    parseAuditResponse,
    parseDesignProjectContext,
    parseDesignResourceCatalog,
    parseExtractionJob,
    parseDesignSession,
    parseImageGenerationResult,
    parseTaskChanges,
    parseTaskList,
    parseTaskResponse,
} from '../src/daemon-client';
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

test('parseDesignProjectContext normalizes project metadata', () => {
    const context = parseDesignProjectContext({
        workspace: 'C:/demo',
        project_name: 'demo',
        summary: 'Demo project',
        technologies: ['TypeScript', 1, 'Vite'],
        source_roots: ['src'],
        manifests: ['package.json'],
    });
    assert.equal(context.project_name, 'demo');
    assert.deepEqual(context.technologies, ['TypeScript', 'Vite']);
});

test('parseDesignResourceCatalog skips malformed resources', () => {
    const catalog = parseDesignResourceCatalog({
        templates: [
            { id: 'td-dashboard', title: '数据看板', components: ['Card'], layout_notes: [] },
            { title: 'broken' },
        ],
        visual_styles: [{ id: 'clean-tech', title: 'Clean Tech', tags: ['科技'] }],
        design_systems: [],
        baselines: [{ id: 'accessible-ui', title: 'Accessible UI' }],
    });
    assert.equal(catalog.templates.length, 1);
    assert.equal(catalog.visual_styles[0].id, 'clean-tech');
    assert.equal(catalog.baselines[0].summary, '');
});

test('parseExtractionJob normalizes fields and tolerates missing optionals', () => {
    const job = parseExtractionJob({
        id: 'ext-1',
        source_type: 'url',
        source_ref: 'https://example.com',
        status: 'succeeded',
        progress: 1.0,
        result_id: 'pkg-1',
        result_version: 1,
        result_size: 72000,
        result_sha256: 'abc123',
        result_expires_at: '2026-10-23T00:50:16Z',
        manifest: { schemaVersion: 'od-design-system-project/v1' },
        created_at: '2026-09-23T00:00:00Z',
        updated_at: '2026-09-23T00:01:00Z',
    });
    assert.equal(job.id, 'ext-1');
    assert.equal(job.status, 'succeeded');
    assert.equal(job.result_sha256, 'abc123');
    assert.equal(job.manifest?.schemaVersion, 'od-design-system-project/v1');

    const partial = parseExtractionJob({ id: 'ext-2' });
    assert.equal(partial.source_type, 'url');
    assert.equal(partial.progress, 0);
    assert.equal(partial.result_id, null);
});

test('parseDesignSession normalizes fields and tolerates missing optionals', () => {
    const session = parseDesignSession({
        id: 'sess-1',
        workspace: 'C:/demo',
        goal: 'page',
        request: '生成看板',
        notes: '',
        primary_template_id: 'td-dashboard',
        visual_style_id: null,
        design_system_id: null,
        baseline_ids: ['accessible-ui'],
        outputs: ['brief', 'code'],
        backend_id: 'sacode',
        mode: 'build',
        target_path: 'src/pages',
        status: 'planned',
        plan: {
            stages: [
                { id: 'context', label: 'Context', required: true, status: 'completed' },
                { id: 'brief', label: 'Brief', required: true, status: 'pending' },
            ],
            models: [{ stage: 'brief', backend_id: 'sacode', capability: 'text' }],
            estimated_outputs: ['brief', 'code'],
            target_files: ['src/pages/dashboard.tsx'],
        },
        prompt_snapshot: '# SaDesign...',
        context_hash: 'abc123',
        task_id: null,
        created_at: '2026-09-23T00:00:00Z',
        updated_at: '2026-09-23T00:01:00Z',
    });
    assert.equal(session.id, 'sess-1');
    assert.equal(session.status, 'planned');
    assert.equal(session.plan?.stages.length, 2);
    assert.equal(session.plan?.models[0].backend_id, 'sacode');

    const partial = parseDesignSession({ id: 'sess-2' });
    assert.equal(partial.goal, '');
    assert.equal(partial.backend_id, 'sacode');
    assert.equal(partial.plan, null);
});

test('parseImageGenerationResult extracts images and model info', () => {
    const result = parseImageGenerationResult({
        images: [
            { url: 'https://cdn.example.com/img1.png', size: '1024x1024', format: 'png' },
            { url: 'https://cdn.example.com/img2.png', size: '1024x1024', format: 'png' },
        ],
        model: 'sensenova-u1.5-fast',
        provider: 'sensenova',
    });
    assert.equal(result.images.length, 2);
    assert.equal(result.images[0].url, 'https://cdn.example.com/img1.png');
    assert.equal(result.model, 'sensenova-u1.5-fast');

    const partial = parseImageGenerationResult({ id: 'x' });
    assert.equal(partial.images.length, 0);
    assert.equal(partial.model, 'unknown');
});

test('parseTaskResult accepts daemon output field', async () => {
    const { parseTaskResult } = await import('../src/daemon-client');
    const result = parseTaskResult({
        task_id: 'task-result',
        status: 'completed',
        output: 'final answer',
    });
    assert.equal(result.response, 'final answer');
});

test('parseTaskList keeps valid persisted tasks and skips malformed entries', () => {
    const list = parseTaskList({
        protocol_version: 1,
        tasks: [
            {
                task_id: 'task-2',
                prompt: 'restore me',
                mode: 'build',
                created_at: '2026-09-22T10:00:00Z',
                status: 'completed',
                queue_status: 'completed',
                output: 'done',
                task: {
                    schema_version: 1,
                    task_id: 'task-2',
                    mode: 'build',
                    source: 'daemon',
                    state: 'completed',
                    phase: 'finished',
                    terminal_outcome: 'success',
                    timestamps: {},
                },
            },
            { task_id: 'broken' },
        ],
    });
    assert.equal(list.tasks.length, 1);
    assert.equal(list.tasks[0].prompt, 'restore me');
    assert.equal(list.tasks[0].task?.state, 'completed');
});

test('parseTaskChanges normalizes structured file diffs', () => {
    const response = parseTaskChanges({
        protocol_version: 1,
        task_id: 'task-diff',
        status: 'final',
        baseline_tree: 'base',
        final_tree: 'final',
        changes: [
            {
                path: 'src/demo.ts',
                kind: 'modified',
                additions: 2,
                deletions: 1,
                binary: false,
                diff: '@@ -1 +1 @@\n-old\n+new',
            },
            { invalid: true },
        ],
    });
    assert.equal(response.changes.length, 1);
    assert.equal(response.changes[0].path, 'src/demo.ts');
    assert.equal(response.changes[0].additions, 2);
});

test('parseAuditResponse normalizes findings and summary', () => {
    const response = parseAuditResponse({
        status: 'completed',
        audit_id: 'audit-2026',
        report: {
            schema_version: 1,
            created_at: '2026-09-23T00:00:00Z',
            root: '/workspace',
            findings: [
                {
                    id: 'CA-S-1',
                    severity: 'high',
                    category: 'security',
                    file: 'src/bad.rs',
                    line: 3,
                    title: 'secret',
                    detail: 'd',
                    suggestion: 's',
                    source: 'heuristic',
                },
                { invalid: true },
            ],
            summary: { high: 1, medium: 0, low: 0, info: 0 },
            ai_used: false,
        },
    });
    assert.equal(response.status, 'completed');
    assert.equal(response.audit_id, 'audit-2026');
    assert.equal(response.report.findings.length, 1);
    assert.equal(response.report.findings[0].file, 'src/bad.rs');
    assert.equal(response.report.summary.high, 1);
    assert.equal(response.findings.length, 1);
});

test('parseAuditResponse handles error status', () => {
    const response = parseAuditResponse({
        status: 'error',
        message: 'workdir unavailable',
    });
    assert.equal(response.status, 'error');
    assert.equal(response.message, 'workdir unavailable');
    assert.equal(response.report.findings.length, 0);
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
