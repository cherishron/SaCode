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
    parseImplementationProfile,
    parseUiCheckReport,
    parseUiDocument,
    parseUiDocumentPatch,
    parseUiPatchProposal,
    parseImageGenerationResult,
    parseTaskChanges,
    parseTaskList,
    parseTaskResponse,
} from '../src/daemon-client';
import { parseSseFrame } from '../src/event-stream';
import { DaemonClient } from '../src/daemon-client';
import type { HttpTransport } from '../src/transport';

test('knowledge and automation contracts validate responses and request paths', async () => {
    const requests: { method: string; url: string; body?: string }[] = [];
    const responses: unknown[] = [
        { entries: [{ id: 'note-1', title: '笔记', scope: 'project', readonly: false }] },
        { results: [{ id: 'docs/a.md', title: '文档', scope: 'project', readonly: true, score: 2, snippet: '正文' }] },
        { rule: { id: 'rule-1', name: '检查', cron_expr: '0 0 9 * * *', prompt: '检查', enabled: true } },
        { runs: [{ id: 'run-1', rule_id: 'rule-1', task_id: 'task-1', triggered_at: '2026-01-01T00:00:00Z', status: 'completed' }] },
    ];
    const transport: HttpTransport = async request => {
        requests.push({ method: request.method, url: request.url, body: request.body });
        const body = responses.shift();
        return { status: 200, statusText: 'OK', ok: true,
            text: async () => JSON.stringify(body), json: async () => body, arrayBuffer: async () => new ArrayBuffer(0) };
    };
    const client = new DaemonClient({ host: '127.0.0.1', port: 3000, token: 'test', transport });
    assert.equal((await client.knowledgeEntries('project'))[0].id, 'note-1');
    assert.equal((await client.searchKnowledge('汉 字', 'project'))[0].readonly, true);
    assert.equal((await client.createAutomationRule({ name: '检查', cron_expr: '0 0 9 * * *', prompt: '检查', enabled: true })).id, 'rule-1');
    assert.equal((await client.listAutomationHistory('rule-1'))[0].status, 'completed');
    assert.match(requests[1].url, /q=%E6%B1%89%20%E5%AD%97/);
    assert.equal(requests[2].method, 'POST');
    assert.equal(JSON.parse(requests[2].body!).cron_expr, '0 0 9 * * *');
    assert.match(requests[3].url, /rule_id=rule-1/);
});

test('task creation surfaces unavailable skill from HTTP 400', async () => {
    const transport: HttpTransport = async () => ({
        status: 400, statusText: 'Bad Request', ok: false,
        text: async () => JSON.stringify({ message: 'skill not available: missing-skill' }),
        json: async () => ({ message: 'skill not available: missing-skill' }),
        arrayBuffer: async () => new ArrayBuffer(0),
    });
    const client = new DaemonClient({ host: '127.0.0.1', port: 3000, transport });
    await assert.rejects(() => client.createTask({ prompt: 'hello', skill: 'missing-skill' }),
        /400 Bad Request.*skill not available: missing-skill/);
});

test('Desktop conversation requests preserve one id across messages', async () => {
    const requests: { method: string; url: string; body?: string }[] = [];
    const transport: HttpTransport = async request => {
        requests.push({ method: request.method, url: request.url, body: request.body });
        const body = { task_id: `task-${requests.length}`, status: 'queued', conversation_id: 'conversation-1' };
        return { status: 200, statusText: 'OK', ok: true,
            text: async () => JSON.stringify(body), json: async () => body, arrayBuffer: async () => new ArrayBuffer(0) };
    };
    const client = new DaemonClient({ host: '127.0.0.1', port: 3000, transport });
    const first = await client.sendDesktopMessage({ prompt: 'first', mode: 'build', backendId: 'sacode' });
    const second = await client.sendDesktopMessage({ prompt: 'second', mode: 'build', backendId: 'sacode', conversationId: first.conversation_id });
    assert.equal(first.conversation_id, second.conversation_id);
    assert.notEqual(first.task_id, second.task_id);
    assert.match(requests[0].url, /\/api\/desktop\/conversations$/);
    assert.match(requests[1].url, /\/api\/desktop\/conversations\/conversation-1$/);
    assert.equal(JSON.parse(requests[1].body!).prompt, 'second');
});

test('knowledge response rejects malformed entries', async () => {
    const transport: HttpTransport = async () => ({ status: 200, statusText: 'OK', ok: true,
        text: async () => '{}', json: async () => ({ entries: [{ id: 123 }] }),
        arrayBuffer: async () => new ArrayBuffer(0) });
    const client = new DaemonClient({ host: '127.0.0.1', port: 3000, transport });
    await assert.rejects(() => client.knowledgeEntries('user'), /Invalid entries response/);
});

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
        target_surface: {
            platform: 'web-desktop', input_modes: ['mouse', 'keyboard'], density: 'compact',
            orientation: 'landscape', capabilities: [],
            viewports: [{ id: 'desktop', name: 'Desktop', width: 1440, height: 900 }],
        },
        ui_document: null,
        implementation_profile: null,
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
    assert.equal(partial.target_surface.platform, 'responsive-web');
    assert.equal(partial.plan, null);
});

test('parseUiDocument and implementation profile enforce schema boundaries', () => {
    const document = parseUiDocument({
        schema_version: 'sacode-ui/v1',
        id: 'ui-1',
        name: 'Dashboard',
        target: { platform: 'desktop-app', viewports: [] },
        pages: [{
            id: 'home', name: 'Home',
            root: { id: 'root', name: 'Root', type: 'container', children: [] },
        }],
        version: 2,
        status: 'confirmed',
    });
    assert.equal(document.target.platform, 'desktop-app');
    assert.equal(document.pages[0].root.type, 'container');

    const profile = parseImplementationProfile({
        schema_version: 'sacode-implementation/v1',
        project_mode: 'new',
        target_platform: 'desktop',
        language: 'TypeScript',
        framework: 'Vue 3',
        source: 'ai-recommended',
        confirmed: true,
    });
    assert.equal(profile.project_mode, 'new');
    assert.equal(profile.framework, 'Vue 3');
    assert.equal(profile.confirmed, true);
});

test('parseUiDocumentPatch and proposal enforce patch schema', () => {
    const patch = parseUiDocumentPatch({
        schema_version: 'sacode-ui-patch/v1', base_version: 3, summary: 'Edit title',
        operations: [{ type: 'set-content', node_id: 'title', patch: { text: 'Changed' } }],
    });
    assert.equal(patch.base_version, 3);
    assert.equal(patch.operations[0].node_id, 'title');
    assert.throws(() => parseUiDocumentPatch({ schema_version: 'bad', operations: [] }), /Unsupported UI patch schema/);

    const proposal = parseUiPatchProposal({
        patch,
        changes: [{ operation: 'set-content', node_id: 'title', description: '修改标题' }],
        source: 'ai',
    });
    assert.equal(proposal.changes[0].description, '修改标题');
});

test('parseUiCheckReport normalizes confirmation findings', () => {
    const report = parseUiCheckReport({
        checked_version: 2,
        passed: false,
        findings: [{ id: 'unsafe-style', severity: 'blocker', message: 'unsafe', node_id: 'hero' }],
        checked_at: '2026-01-01T00:00:00Z',
    });
    assert.equal(report.passed, false);
    assert.equal(report.findings[0].node_id, 'hero');
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
