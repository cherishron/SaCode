import type { HttpResponse, HttpTransport } from './transport.js';
import { fetchTransport } from './transport.js';
import { ProtocolCompatibilityError, responseError } from './errors.js';
import {
    DEFAULT_AGENT_BACKEND_ID,
    MINIMUM_DAEMON_VERSION,
    TASK_PROTOCOL_VERSION,
    isProtocolVersionSupported,
    isVersionAtLeast,
    normalizeBackendId,
    normalizeExecutionMode,
    parseTaskSnapshot,
    type AgentDescriptor,
    type EntrySource,
    type ExecutionModeInput,
    type TaskSnapshot,
} from './index-types.js';

export interface DaemonConfig {
    host: string;
    port: number;
    /** Optional bearer token for daemon auth (M5). Omitted = no auth. */
    token?: string;
    transport?: HttpTransport;
    entrySource?: EntrySource;
}

export interface DaemonHealth {
    status: string;
    version: string;
}

export interface CreateTaskResponse {
    protocol_version: number;
    task_id: string;
    status: string;
    message: string;
    queue_status: string;
    task?: TaskSnapshot;
}

export interface TaskStatusBody {
    task_id: string;
    status: string;
    queue_status?: string;
    prompt?: string;
    mode?: string;
    error?: string | null;
    output?: string | null;
    duration_ms?: number | null;
    protocol_version?: number;
    task?: TaskSnapshot | null;
}

export interface TaskResultBody {
    task_id: string;
    response: string;
    status: string;
    learned_facts: string[];
}

export interface TaskListItem {
    task_id: string;
    prompt: string;
    mode: string;
    created_at: string;
    status: string;
    queue_status: string;
    duration_ms?: number;
    error?: string;
    output?: string;
    task?: TaskSnapshot;
}

export interface TaskListResponse {
    protocol_version: number;
    tasks: TaskListItem[];
}

export interface TaskFileChange {
    path: string;
    previous_path?: string;
    kind: string;
    additions: number;
    deletions: number;
    binary: boolean;
    diff: string;
}

export interface TaskChangesResponse {
    protocol_version: number;
    task_id: string;
    status: string;
    baseline_tree?: string;
    final_tree?: string;
    message?: string;
    changes: TaskFileChange[];
}

export interface AuditFinding {
    schema_version?: number;
    id: string;
    severity: string;
    category: string;
    file: string;
    line?: number;
    title: string;
    detail: string;
    suggestion: string;
    source: string;
}

export interface AuditSummary {
    high: number;
    medium: number;
    low: number;
    info: number;
}

export interface AuditReport {
    schema_version: number;
    created_at: string;
    root: string;
    findings: AuditFinding[];
    summary: AuditSummary;
    provider?: string;
    ai_used: boolean;
}

export interface AuditResponse {
    status: string;
    audit_id: string;
    report: AuditReport;
    findings: AuditFinding[];
    report_json_path?: string;
    message?: string;
}

export interface AuditReportSummary {
    audit_id: string;
    created_at: string;
    root: string;
    ai_used: boolean;
    high: number;
    medium: number;
    low: number;
    info: number;
    finding_count: number;
}

export interface AuditListResponse {
    reports: AuditReportSummary[];
}

export interface AgentsListResponse {
    agents: AgentDescriptor[];
    default_backend_id: string;
}

export interface DesignProjectContext {
    workspace: string;
    project_name: string;
    summary: string;
    technologies: string[];
    source_roots: string[];
    manifests: string[];
}

export interface DesignTemplateResource {
    id: string;
    title: string;
    summary: string;
    components: string[];
    layout_notes: string[];
}

export interface DesignResourceItem {
    id: string;
    title: string;
    summary: string;
    tags: string[];
}

export interface DesignResourceCatalog {
    templates: DesignTemplateResource[];
    visual_styles: DesignResourceItem[];
    design_systems: DesignResourceItem[];
    baselines: DesignResourceItem[];
}

export interface ExtractionJob {
    id: string;
    source_type: string;
    source_ref: string;
    status: string;
    progress: number;
    result_id: string | null;
    result_version: number | null;
    result_size: number | null;
    result_sha256: string | null;
    result_expires_at: string | null;
    manifest: Record<string, unknown> | null;
    error: string | null;
    created_at: string;
    updated_at: string;
}

export interface CreateExtractionRequest {
    source_type: string;
    source_ref: string;
    confirmed: boolean;
    image_filename?: string;
    image_content_type?: string;
    image_size?: number;
}

export interface GenerationStage {
    id: string;
    label: string;
    model_id: string | null;
    status: string;
    required: boolean;
}

export interface ModelAssignment {
    stage: string;
    backend_id: string;
    capability: string;
}

export interface GenerationPlan {
    stages: GenerationStage[];
    models: ModelAssignment[];
    estimated_outputs: string[];
    target_files: string[];
}

export interface DesignSession {
    id: string;
    workspace: string;
    goal: string;
    request: string;
    notes: string;
    primary_template_id: string | null;
    visual_style_id: string | null;
    design_system_id: string | null;
    baseline_ids: string[];
    outputs: string[];
    backend_id: string;
    mode: string;
    target_path: string;
    status: string;
    plan: GenerationPlan | null;
    prompt_snapshot: string | null;
    context_hash: string | null;
    task_id: string | null;
    created_at: string;
    updated_at: string;
}

export interface CreateSessionRequest {
    workspace?: string;
    goal: string;
    request: string;
    backend_id?: string;
}

export interface UpdateSessionRequest {
    goal?: string;
    request?: string;
    notes?: string;
    primary_template_id?: string | null;
    visual_style_id?: string | null;
    design_system_id?: string | null;
    baseline_ids?: string[];
    outputs?: string[];
    backend_id?: string;
    mode?: string;
    target_path?: string;
}

export interface ImageGenerationRequest {
    prompt: string;
    size?: string;
    n?: number;
    output_format?: string;
    watermark?: boolean;
}

export interface GeneratedImage {
    url: string;
    size: string;
    format: string;
}

export interface ImageGenerationResult {
    images: GeneratedImage[];
    model: string;
    provider: string;
}

export interface PendingApproval {
    approval_id: string;
    task_id: string;
    tool_name: string;
    side_effect_level: string;
    args: Record<string, unknown>;
    waited_secs: number;
    timeout_secs: number;
    expires_in_secs: number;
}

/** Alias used by VSCode extension surface. */
export type PendingApprovalEntry = PendingApproval;

export function parseDesignProjectContext(body: unknown): DesignProjectContext {
    if (!isRecord(body)) throw new Error('Design context returned an unexpected response body');
    return {
        workspace: typeof body.workspace === 'string' ? body.workspace : '',
        project_name: typeof body.project_name === 'string' ? body.project_name : 'Project',
        summary: typeof body.summary === 'string' ? body.summary : '',
        technologies: stringArray(body.technologies),
        source_roots: stringArray(body.source_roots),
        manifests: stringArray(body.manifests),
    };
}

export function parseDesignResourceCatalog(body: unknown): DesignResourceCatalog {
    if (!isRecord(body)) throw new Error('Design resources returned an unexpected response body');
    return {
        templates: parseRecordArray(body.templates, (item) => ({
            id: requiredString(item.id, 'Design template id'),
            title: requiredString(item.title, 'Design template title'),
            summary: typeof item.summary === 'string' ? item.summary : '',
            components: stringArray(item.components),
            layout_notes: stringArray(item.layout_notes),
        })),
        visual_styles: parseDesignResourceItems(body.visual_styles),
        design_systems: parseDesignResourceItems(body.design_systems),
        baselines: parseDesignResourceItems(body.baselines),
    };
}

export function parseExtractionJob(body: unknown): ExtractionJob {
    if (!isRecord(body)) throw new Error('Extraction job returned an unexpected response body');
    return {
        id: requiredString(body.id, 'Extraction job id'),
        source_type: typeof body.source_type === 'string' ? body.source_type : 'url',
        source_ref: typeof body.source_ref === 'string' ? body.source_ref : '',
        status: typeof body.status === 'string' ? body.status : 'queued',
        progress: typeof body.progress === 'number' ? body.progress : 0,
        result_id: body.result_id != null && typeof body.result_id === 'string' ? body.result_id : null,
        result_version: body.result_version != null && typeof body.result_version === 'number' ? body.result_version : null,
        result_size: body.result_size != null && typeof body.result_size === 'number' ? body.result_size : null,
        result_sha256: body.result_sha256 != null && typeof body.result_sha256 === 'string' ? body.result_sha256 : null,
        result_expires_at: body.result_expires_at != null && typeof body.result_expires_at === 'string' ? body.result_expires_at : null,
        manifest: body.manifest != null && isRecord(body.manifest) ? body.manifest as Record<string, unknown> : null,
        error: body.error != null && typeof body.error === 'string' ? body.error : null,
        created_at: typeof body.created_at === 'string' ? body.created_at : '',
        updated_at: typeof body.updated_at === 'string' ? body.updated_at : '',
    };
}

export function parseGenerationStage(body: unknown): GenerationStage {
    if (!isRecord(body)) throw new Error('Generation stage returned an unexpected response body');
    const id = requiredString(body.id, 'Generation stage id');
    return {
        id,
        label: typeof body.label === 'string' ? body.label : id,
        model_id: body.model_id != null && typeof body.model_id === 'string' ? body.model_id : null,
        status: typeof body.status === 'string' ? body.status : 'pending',
        required: typeof body.required === 'boolean' ? body.required : false,
    };
}

export function parseGenerationPlan(body: unknown): GenerationPlan {
    if (!isRecord(body)) throw new Error('Generation plan returned an unexpected response body');
    return {
        stages: parseRecordArray(body.stages, parseGenerationStage),
        models: parseRecordArray(body.models, (item) => ({
            stage: requiredString(item.stage, 'Model assignment stage'),
            backend_id: requiredString(item.backend_id, 'Model assignment backend'),
            capability: typeof item.capability === 'string' ? item.capability : 'text',
        })),
        estimated_outputs: stringArray(body.estimated_outputs),
        target_files: stringArray(body.target_files),
    };
}

export function parseDesignSession(body: unknown): DesignSession {
    if (!isRecord(body)) throw new Error('Design session returned an unexpected response body');
    return {
        id: requiredString(body.id, 'Design session id'),
        workspace: typeof body.workspace === 'string' ? body.workspace : '',
        goal: typeof body.goal === 'string' ? body.goal : '',
        request: typeof body.request === 'string' ? body.request : '',
        notes: typeof body.notes === 'string' ? body.notes : '',
        primary_template_id: body.primary_template_id != null && typeof body.primary_template_id === 'string' ? body.primary_template_id : null,
        visual_style_id: body.visual_style_id != null && typeof body.visual_style_id === 'string' ? body.visual_style_id : null,
        design_system_id: body.design_system_id != null && typeof body.design_system_id === 'string' ? body.design_system_id : null,
        baseline_ids: stringArray(body.baseline_ids),
        outputs: stringArray(body.outputs),
        backend_id: typeof body.backend_id === 'string' ? body.backend_id : 'sacode',
        mode: typeof body.mode === 'string' ? body.mode : 'build',
        target_path: typeof body.target_path === 'string' ? body.target_path : '',
        status: typeof body.status === 'string' ? body.status : 'draft',
        plan: body.plan != null && isRecord(body.plan) ? parseGenerationPlan(body.plan) : null,
        prompt_snapshot: body.prompt_snapshot != null && typeof body.prompt_snapshot === 'string' ? body.prompt_snapshot : null,
        context_hash: body.context_hash != null && typeof body.context_hash === 'string' ? body.context_hash : null,
        task_id: body.task_id != null && typeof body.task_id === 'string' ? body.task_id : null,
        created_at: typeof body.created_at === 'string' ? body.created_at : '',
        updated_at: typeof body.updated_at === 'string' ? body.updated_at : '',
    };
}

export function parseImageGenerationResult(body: unknown): ImageGenerationResult {
    if (!isRecord(body)) throw new Error('Image generation result returned an unexpected response body');
    const images: GeneratedImage[] = [];
    const rawImages = body.images;
    if (Array.isArray(rawImages)) {
        for (const item of rawImages) {
            if (isRecord(item) && typeof item.url === 'string') {
                images.push({
                    url: item.url,
                    size: typeof item.size === 'string' ? item.size : '1024x1024',
                    format: typeof item.format === 'string' ? item.format : 'png',
                });
            }
        }
    }
    return {
        images,
        model: typeof body.model === 'string' ? body.model : 'unknown',
        provider: typeof body.provider === 'string' ? body.provider : 'unknown',
    };
}

function parseDesignResourceItems(value: unknown): DesignResourceItem[] {
    return parseRecordArray(value, (item) => ({
        id: requiredString(item.id, 'Design resource id'),
        title: requiredString(item.title, 'Design resource title'),
        summary: typeof item.summary === 'string' ? item.summary : '',
        tags: stringArray(item.tags),
    }));
}

function parseRecordArray<T>(value: unknown, parser: (item: Record<string, unknown>) => T): T[] {
    if (!Array.isArray(value)) return [];
    const parsed: T[] = [];
    for (const item of value) {
        if (!isRecord(item)) continue;
        try {
            parsed.push(parser(item));
        } catch {
            // Skip malformed catalog items while keeping valid resources usable.
        }
    }
    return parsed;
}

function stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function requiredString(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} is missing`);
    return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function daemonHealthError(health: DaemonHealth): string | null {
    if (health.status !== 'healthy') {
        return `SaCode daemon reported status "${health.status}".`;
    }
    if (!isVersionAtLeast(health.version, MINIMUM_DAEMON_VERSION)) {
        const version = health.version || 'unknown';
        return `SaCode daemon ${version} is incompatible. Upgrade to ${MINIMUM_DAEMON_VERSION} or newer.`;
    }
    return null;
}

export function protocolVersionError(version: unknown): string | null {
    if (isProtocolVersionSupported(version)) return null;
    const actual = typeof version === 'number' ? String(version) : 'missing';
    return `SaCode protocol version ${actual} is unsupported by this client (supports ${TASK_PROTOCOL_VERSION}).`;
}

export function parseTaskResponse(body: unknown): CreateTaskResponse {
    if (!isRecord(body)) throw new Error('Task creation returned an unexpected response body');
    const error = protocolVersionError(body.protocol_version);
    if (error) throw new ProtocolCompatibilityError(error);
    if (typeof body.task_id !== 'string' || typeof body.status !== 'string') {
        throw new Error('Task creation response is missing task_id or status');
    }
    return {
        protocol_version: body.protocol_version as number,
        task_id: body.task_id,
        status: body.status,
        message: typeof body.message === 'string' ? body.message : '',
        queue_status: typeof body.queue_status === 'string' ? body.queue_status : '',
        ...(parseTaskSnapshot(body.task) !== null ? { task: parseTaskSnapshot(body.task)! } : {}),
    };
}

export function parseTaskStatusBody(body: unknown): TaskStatusBody {
    if (!isRecord(body)) throw new Error('Task status returned an unexpected response body');
    const protocolError = body.protocol_version === undefined
        ? null
        : protocolVersionError(body.protocol_version);
    if (protocolError) throw new ProtocolCompatibilityError(protocolError);
    if (typeof body.task_id !== 'string' || typeof body.status !== 'string') {
        throw new Error('Task status response is missing task_id or status');
    }
    return {
        task_id: body.task_id,
        status: body.status,
        queue_status: typeof body.queue_status === 'string' ? body.queue_status : undefined,
        prompt: typeof body.prompt === 'string' ? body.prompt : undefined,
        mode: typeof body.mode === 'string' ? body.mode : undefined,
        error: typeof body.error === 'string' ? body.error : undefined,
        output: typeof body.output === 'string' ? body.output : undefined,
        duration_ms: typeof body.duration_ms === 'number' ? body.duration_ms : undefined,
        protocol_version: typeof body.protocol_version === 'number' ? body.protocol_version : undefined,
        task: parseTaskSnapshot(body.task),
    };
}

export function parseTaskResult(body: unknown): TaskResultBody {
    if (!isRecord(body) || typeof body.task_id !== 'string' || typeof body.status !== 'string') {
        throw new Error('Task result returned an unexpected response body');
    }
    const response = typeof body.response === 'string'
        ? body.response
        : typeof body.output === 'string'
        ? body.output
        : '';
    const facts = body.learned_facts;
    return {
        task_id: body.task_id,
        response,
        status: body.status,
        learned_facts: Array.isArray(facts) ? facts.filter((x): x is string => typeof x === 'string') : [],
    };
}

function parseTaskListItem(value: unknown): TaskListItem | null {
    if (!isRecord(value)) return null;
    if (
        typeof value.task_id !== 'string' ||
        typeof value.prompt !== 'string' ||
        typeof value.mode !== 'string' ||
        typeof value.created_at !== 'string' ||
        typeof value.status !== 'string'
    ) {
        return null;
    }
    const task = parseTaskSnapshot(value.task);
    return {
        task_id: value.task_id,
        prompt: value.prompt,
        mode: value.mode,
        created_at: value.created_at,
        status: value.status,
        queue_status: typeof value.queue_status === 'string' ? value.queue_status : value.status,
        duration_ms: typeof value.duration_ms === 'number' ? value.duration_ms : undefined,
        error: typeof value.error === 'string' ? value.error : undefined,
        output: typeof value.output === 'string' ? value.output : undefined,
        ...(task ? { task } : {}),
    };
}

export function parseTaskList(body: unknown): TaskListResponse {
    if (!isRecord(body) || !Array.isArray(body.tasks)) {
        throw new Error('Task list returned an unexpected response body');
    }
    const error = protocolVersionError(body.protocol_version);
    if (error) throw new ProtocolCompatibilityError(error);
    return {
        protocol_version: body.protocol_version as number,
        tasks: body.tasks
            .map(parseTaskListItem)
            .filter((item): item is TaskListItem => item !== null),
    };
}

function parseTaskFileChange(value: unknown): TaskFileChange | null {
    if (!isRecord(value) || typeof value.path !== 'string' || typeof value.kind !== 'string') {
        return null;
    }
    return {
        path: value.path,
        previous_path: typeof value.previous_path === 'string' ? value.previous_path : undefined,
        kind: value.kind,
        additions: typeof value.additions === 'number' ? value.additions : 0,
        deletions: typeof value.deletions === 'number' ? value.deletions : 0,
        binary: value.binary === true,
        diff: typeof value.diff === 'string' ? value.diff : '',
    };
}

export function parseTaskChanges(body: unknown): TaskChangesResponse {
    if (
        !isRecord(body) ||
        typeof body.task_id !== 'string' ||
        typeof body.status !== 'string' ||
        !Array.isArray(body.changes)
    ) {
        throw new Error('Task changes returned an unexpected response body');
    }
    const error = protocolVersionError(body.protocol_version);
    if (error) throw new ProtocolCompatibilityError(error);
    return {
        protocol_version: body.protocol_version as number,
        task_id: body.task_id,
        status: body.status,
        baseline_tree: typeof body.baseline_tree === 'string' ? body.baseline_tree : undefined,
        final_tree: typeof body.final_tree === 'string' ? body.final_tree : undefined,
        message: typeof body.message === 'string' ? body.message : undefined,
        changes: body.changes
            .map(parseTaskFileChange)
            .filter((change): change is TaskFileChange => change !== null),
    };
}

function parseAuditFinding(value: unknown): AuditFinding | null {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.severity !== 'string') {
        return null;
    }
    return {
        schema_version: typeof value.schema_version === 'number' ? value.schema_version : undefined,
        id: value.id,
        severity: value.severity,
        category: typeof value.category === 'string' ? value.category : '',
        file: typeof value.file === 'string' ? value.file : '',
        line: typeof value.line === 'number' ? value.line : undefined,
        title: typeof value.title === 'string' ? value.title : '',
        detail: typeof value.detail === 'string' ? value.detail : '',
        suggestion: typeof value.suggestion === 'string' ? value.suggestion : '',
        source: typeof value.source === 'string' ? value.source : '',
    };
}

export function parseAuditResponse(body: unknown): AuditResponse {
    if (!isRecord(body) || typeof body.status !== 'string') {
        throw new Error('Audit response returned an unexpected body');
    }
    if (body.status === 'error') {
        return {
            status: 'error',
            audit_id: typeof body.audit_id === 'string' ? body.audit_id : '',
            report: { schema_version: 0, created_at: '', root: '', findings: [], summary: { high: 0, medium: 0, low: 0, info: 0 }, ai_used: false },
            findings: [],
            message: typeof body.message === 'string' ? body.message : 'unknown error',
        };
    }
    if (!isRecord(body.report)) {
        throw new Error('Audit response missing report object');
    }
    const report = body.report;
    const findings: AuditFinding[] = Array.isArray(report.findings)
        ? report.findings.map(parseAuditFinding).filter((f): f is AuditFinding => f !== null)
        : [];
    return {
        status: body.status,
        audit_id: typeof body.audit_id === 'string' ? body.audit_id : '',
        report: {
            schema_version: typeof report.schema_version === 'number' ? report.schema_version : 0,
            created_at: typeof report.created_at === 'string' ? report.created_at : '',
            root: typeof report.root === 'string' ? report.root : '',
            findings,
            summary: {
                high: isRecord(report.summary) && typeof report.summary.high === 'number' ? report.summary.high : 0,
                medium: isRecord(report.summary) && typeof report.summary.medium === 'number' ? report.summary.medium : 0,
                low: isRecord(report.summary) && typeof report.summary.low === 'number' ? report.summary.low : 0,
                info: isRecord(report.summary) && typeof report.summary.info === 'number' ? report.summary.info : 0,
            },
            provider: typeof report.provider === 'string' ? report.provider : undefined,
            ai_used: report.ai_used === true,
        },
        findings,
        report_json_path: typeof body.report_json_path === 'string' ? body.report_json_path : undefined,
    };
}

export function parseAuditList(body: unknown): AuditListResponse {
    if (!isRecord(body) || !Array.isArray(body.reports)) {
        throw new Error('Audit list returned an unexpected body');
    }
    return {
        reports: body.reports
            .filter((v: unknown): v is Record<string, unknown> => isRecord(v) && typeof v.audit_id === 'string')
            .map((v) => ({
                audit_id: v.audit_id as string,
                created_at: typeof v.created_at === 'string' ? v.created_at : '',
                root: typeof v.root === 'string' ? v.root : '',
                ai_used: v.ai_used === true,
                high: typeof v.high === 'number' ? v.high : 0,
                medium: typeof v.medium === 'number' ? v.medium : 0,
                low: typeof v.low === 'number' ? v.low : 0,
                info: typeof v.info === 'number' ? v.info : 0,
                finding_count: typeof v.finding_count === 'number' ? v.finding_count : 0,
            })),
    };
}

function parsePendingApproval(value: unknown): PendingApproval | null {
    if (!isRecord(value)) return null;
    if (
        typeof value.approval_id !== 'string' ||
        typeof value.task_id !== 'string' ||
        typeof value.tool_name !== 'string'
    ) {
        return null;
    }
    return {
        approval_id: value.approval_id,
        task_id: value.task_id,
        tool_name: value.tool_name,
        side_effect_level: typeof value.side_effect_level === 'string' ? value.side_effect_level : 'Unknown',
        args: isRecord(value.args) ? value.args : {},
        waited_secs: typeof value.waited_secs === 'number' ? value.waited_secs : 0,
        timeout_secs: typeof value.timeout_secs === 'number' ? value.timeout_secs : 0,
        expires_in_secs: typeof value.expires_in_secs === 'number' ? value.expires_in_secs : 0,
    };
}

export function parseApprovalList(body: unknown): PendingApproval[] {
    if (!isRecord(body) || !Array.isArray(body.approvals)) return [];
    return body.approvals
        .map(parsePendingApproval)
        .filter((entry): entry is PendingApproval => entry !== null);
}

/** 解析工具列表：非字符串项跳过 */
export function parseToolList(body: unknown): string[] {
    if (!isRecord(body) || !Array.isArray(body.tools)) return [];
    return body.tools.filter((t): t is string => typeof t === 'string');
}

export function parseAgentsList(body: unknown): AgentsListResponse {
    if (!isRecord(body) || !Array.isArray(body.agents)) {
        return { agents: [], default_backend_id: DEFAULT_AGENT_BACKEND_ID };
    }
    const agents: AgentDescriptor[] = body.agents
        .filter(isRecord)
        .map((raw) => ({
            id: normalizeBackendId(raw.id),
            display_name: typeof raw.display_name === 'string' ? raw.display_name : normalizeBackendId(raw.id),
            kind: raw.kind === 'native' || raw.kind === 'acp' ? raw.kind : undefined,
            health: raw.health === 'unknown' || raw.health === 'ready' || raw.health === 'degraded' || raw.health === 'unavailable'
                ? raw.health
                : undefined,
        }));
    return {
        agents,
        default_backend_id: normalizeBackendId(body.default_backend_id),
    };
}

/**
 * Daemon HTTP client shared by VSCode and Desktop.
 * Desktop must inject a Tauri IPC transport so the WebView never holds the bearer token.
 */
export class DaemonClient {
    private readonly config: DaemonConfig;
    private readonly transport: HttpTransport;

    constructor(config: DaemonConfig) {
        this.config = config;
        this.transport = config.transport ?? fetchTransport;
    }

    get baseUrl(): string {
        return `http://${this.config.host}:${this.config.port}`;
    }

    private headers(extra?: Record<string, string>): Record<string, string> {
        return {
            ...(this.config.token ? { Authorization: `Bearer ${this.config.token}` } : {}),
            ...extra,
        };
    }

    private async request(
        method: 'GET' | 'POST',
        path: string,
        body?: unknown,
        signal?: AbortSignal,
    ): Promise<HttpResponse> {
        return this.transport({
            method,
            url: `${this.baseUrl}${path}`,
            headers: this.headers(body !== undefined ? { 'Content-Type': 'application/json' } : undefined),
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
            ...(signal ? { signal } : {}),
        });
    }

    async health(): Promise<DaemonHealth | null> {
        try {
            const res = await this.request('GET', '/health');
            if (!res.ok) return { status: `http_${res.status}`, version: '' };
            const body: unknown = await res.json();
            if (!isRecord(body) || typeof body.status !== 'string') {
                return { status: 'invalid_response', version: '' };
            }
            return {
                status: body.status,
                version: typeof body.version === 'string' ? body.version : '',
            };
        } catch {
            return null;
        }
    }

    async healthCheck(): Promise<boolean> {
        const health = await this.health();
        return health !== null && daemonHealthError(health) === null;
    }

    async listAgents(): Promise<AgentsListResponse> {
        const res = await this.request('GET', '/agents');
        if (!res.ok) throw await responseError(res, 'Agent list');
        return parseAgentsList(await res.json());
    }

    async getDesignContext(): Promise<DesignProjectContext> {
        const res = await this.request('GET', '/api/design/context');
        if (!res.ok) throw await responseError(res, 'Design context request');
        return parseDesignProjectContext(await res.json());
    }

    async listDesignResources(): Promise<DesignResourceCatalog> {
        const res = await this.request('GET', '/api/design/resources');
        if (!res.ok) throw await responseError(res, 'Design resource request');
        return parseDesignResourceCatalog(await res.json());
    }

    async createExtraction(req: CreateExtractionRequest): Promise<ExtractionJob> {
        const res = await this.request('POST', '/api/design/extractions', req);
        if (!res.ok) throw await responseError(res, 'Extraction creation');
        return parseExtractionJob(await res.json());
    }

    async listExtractions(): Promise<ExtractionJob[]> {
        const res = await this.request('GET', '/api/design/extractions');
        if (!res.ok) throw await responseError(res, 'Extraction list');
        const body = await res.json();
        if (!Array.isArray(body)) return [];
        const jobs: ExtractionJob[] = [];
        for (const item of body) {
            try { jobs.push(parseExtractionJob(item)); } catch { /* skip malformed */ }
        }
        return jobs;
    }

    async getExtraction(id: string): Promise<ExtractionJob> {
        const res = await this.request('GET', `/api/design/extractions/${encodeURIComponent(id)}`);
        if (!res.ok) throw await responseError(res, 'Extraction job query');
        return parseExtractionJob(await res.json());
    }

    async cancelExtraction(id: string): Promise<void> {
        const res = await this.request('POST', `/api/design/extractions/${encodeURIComponent(id)}/cancel`);
        if (!res.ok) throw await responseError(res, 'Extraction cancellation');
    }

    async createSession(req: CreateSessionRequest): Promise<DesignSession> {
        const res = await this.request('POST', '/api/design/sessions', req);
        if (!res.ok) throw await responseError(res, 'Session creation');
        return parseDesignSession(await res.json());
    }

    async listSessions(): Promise<DesignSession[]> {
        const res = await this.request('GET', '/api/design/sessions');
        if (!res.ok) throw await responseError(res, 'Session list');
        const body = await res.json();
        if (!Array.isArray(body)) return [];
        const sessions: DesignSession[] = [];
        for (const item of body) {
            try { sessions.push(parseDesignSession(item)); } catch { /* skip malformed */ }
        }
        return sessions;
    }

    async getSession(id: string): Promise<DesignSession> {
        const res = await this.request('GET', `/api/design/sessions/${encodeURIComponent(id)}`);
        if (!res.ok) throw await responseError(res, 'Session query');
        return parseDesignSession(await res.json());
    }

    async updateSession(id: string, req: UpdateSessionRequest): Promise<DesignSession> {
        const res = await this.request('POST', `/api/design/sessions/${encodeURIComponent(id)}`, req);
        if (!res.ok) throw await responseError(res, 'Session update');
        return parseDesignSession(await res.json());
    }

    async planSession(id: string): Promise<DesignSession> {
        const res = await this.request('POST', `/api/design/sessions/${encodeURIComponent(id)}/plan`);
        if (!res.ok) throw await responseError(res, 'Session planning');
        return parseDesignSession(await res.json());
    }

    async generateSession(id: string): Promise<DesignSession> {
        const res = await this.request('POST', `/api/design/sessions/${encodeURIComponent(id)}/generate`);
        if (!res.ok) throw await responseError(res, 'Session generation');
        return parseDesignSession(await res.json());
    }

    async downloadDesignSystem(id: string): Promise<{ format: string; body: ArrayBuffer }> {
        const res = await this.request('GET', `/api/design/systems/${encodeURIComponent(id)}/download`);
        if (!res.ok) throw await responseError(res, 'Design system download');
        const format = res.headers?.['x-package-format'] ?? 'json';
        return { format, body: await res.arrayBuffer() };
    }

    async importDesignSystem(id: string): Promise<{ imported: boolean; project_path: string }> {
        const res = await this.request('POST', `/api/design/systems/${encodeURIComponent(id)}/import`);
        if (!res.ok) throw await responseError(res, 'Design system import');
        const body = await res.json();
        if (!isRecord(body)) throw new Error('Import returned unexpected body');
        return {
            imported: typeof body.imported === 'boolean' ? body.imported : false,
            project_path: typeof body.project_path === 'string' ? body.project_path : '',
        };
    }

    async generateImages(req: ImageGenerationRequest): Promise<ImageGenerationResult> {
        const res = await this.request('POST', '/api/design/images/generate', req);
        if (!res.ok) throw await responseError(res, 'Image generation');
        return parseImageGenerationResult(await res.json());
    }

    async createTask(options: {
        prompt: string;
        mode?: ExecutionModeInput;
        workspaceRoot?: string;
        backendId?: string;
        sessionId?: string;
        source?: EntrySource;
    }): Promise<CreateTaskResponse> {
        const body = {
            // Daemon TaskRequest (HTTP) is prompt/mode-first; protocol fields optional for clients.
            schema_version: TASK_PROTOCOL_VERSION,
            prompt: options.prompt,
            mode: normalizeExecutionMode(options.mode ?? 'build'),
            source: options.source ?? this.config.entrySource ?? 'vscode',
            workspace: { root: options.workspaceRoot ?? '.' },
            explicit_contexts: [],
            backend_id: normalizeBackendId(options.backendId),
            ...(options.sessionId ? { session_id: options.sessionId } : {}),
        };
        const res = await this.request('POST', '/task', body);
        if (!res.ok) throw await responseError(res, 'Task creation');
        return parseTaskResponse(await res.json());
    }

    async listTasks(): Promise<TaskListResponse> {
        const res = await this.request('GET', '/tasks');
        if (!res.ok) throw await responseError(res, 'Task list request');
        return parseTaskList(await res.json());
    }

    async getTaskChanges(taskId: string): Promise<TaskChangesResponse> {
        const res = await this.request('GET', `/task/${encodeURIComponent(taskId)}/changes`);
        if (!res.ok) throw await responseError(res, 'Task changes request');
        return parseTaskChanges(await res.json());
    }

    async runAudit(opts?: { use_ai?: boolean; max_files?: number }): Promise<AuditResponse> {
        const res = await this.request('POST', '/audit', opts ? JSON.stringify(opts) : '{}');
        if (!res.ok) throw await responseError(res, 'Audit scan request');
        return parseAuditResponse(await res.json());
    }

    async getAuditReport(auditId: string): Promise<AuditResponse> {
        const res = await this.request('GET', `/audit/${encodeURIComponent(auditId)}`);
        if (!res.ok) throw await responseError(res, 'Audit report request');
        return parseAuditResponse(await res.json());
    }

    async listAudits(): Promise<AuditListResponse> {
        const res = await this.request('GET', '/audit');
        if (!res.ok) throw await responseError(res, 'Audit list request');
        return parseAuditList(await res.json());
    }

    async getTaskStatus(taskId: string): Promise<TaskStatusBody> {
        const res = await this.request('GET', `/task/${encodeURIComponent(taskId)}/status`);
        if (!res.ok) throw await responseError(res, 'Task status request');
        return parseTaskStatusBody(await res.json());
    }

    async getTaskResult(taskId: string): Promise<TaskResultBody> {
        const res = await this.request('GET', `/task/${encodeURIComponent(taskId)}/result`);
        if (!res.ok) throw await responseError(res, 'Task result request');
        return parseTaskResult(await res.json());
    }

    async cancelTask(taskId: string): Promise<void> {
        const res = await this.request('POST', `/task/${encodeURIComponent(taskId)}/cancel`);
        if (!res.ok) throw await responseError(res, 'Task cancellation');
    }

    async resolveApproval(
        taskId: string,
        approvalId: string,
        approved: boolean,
        reason?: string,
        argsOverride?: Record<string, unknown>,
    ): Promise<void> {
        if (!approvalId) throw new Error('Approval request is missing approval_id');
        const res = await this.request('POST', `/task/${encodeURIComponent(taskId)}/approve`, {
            approval_id: approvalId,
            approved,
            ...(reason ? { reason } : {}),
            ...(argsOverride ? { args_override: argsOverride } : {}),
        });
        if (!res.ok) throw await responseError(res, 'Approval resolution');
    }

    async listApprovals(taskId: string): Promise<PendingApproval[]> {
        const res = await this.request('GET', `/task/${encodeURIComponent(taskId)}/approvals`);
        if (!res.ok) throw await responseError(res, 'Approval list request');
        return parseApprovalList(await res.json());
    }
}
