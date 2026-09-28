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
    /** interaction.ask 挂起问题 */
    pending_question?: {
        question?: string;
        options?: Array<{ label?: string; value?: string; description?: string }>;
        allow_multiple?: boolean;
    } | null;
    /** Token 用量 */
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
    } | null;
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

export interface DesktopConversation {
    id: string;
    title: string;
    created_at: string;
    latest_task_id: string;
    status: string;
}

export interface DesktopConversationTurn {
    task_id: string;
    prompt: string;
    created_at: string;
    status: string;
    output?: string | null;
    error?: string | null;
    /** P0-3 回放帧 */
    frames?: Array<{ seq: number; kind: string; text: string; detail?: string | null }>;
}

export interface DesktopConversationDetail {
    id: string;
    turns: DesktopConversationTurn[];
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

export interface WorkspaceModelOption {
    id: string;
    provider: string;
    model: string;
    thinking: boolean;
    reasoning_effort?: string | null;
}

export interface WorkspaceSkillOption {
    name: string;
    description: string;
    source: 'user' | 'project' | 'workspace' | 'builtin' | string;
}

export interface WorkspaceFileOption {
    path: string;
    size: number;
    language: string;
    is_dir: boolean;
}

export interface WorkspaceFilePreview {
    path: string;
    size: number;
    content: string;
}

export interface AccountStatus {
    logged_in: boolean;
    subject?: string | null;
    provider_name: string;
    models_count: number;
    default_model?: string | null;
    gateway_base_url: string;
    logged_in_at?: string | null;
}

export interface EntitlementItem {
    id: string;
    product?: string | null;
    subject_type?: string | null;
    subject_id?: string | null;
    valid_from?: string | null;
    valid_until?: string | null;
    capabilities: string[];
    status?: string | null;
}

export interface WorkspaceCapabilities {
    workspace: string;
    models: WorkspaceModelOption[];
    model_status?: 'ready' | 'not_logged_in' | 'no_gateway_models' | 'credential_unavailable' | 'no_authorized_provider';
    account?: AccountStatus;
    skills: WorkspaceSkillOption[];
    files: WorkspaceFileOption[];
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

export interface UiViewport {
    id: string;
    name: string;
    width: number;
    height: number;
}

export interface TargetSurface {
    platform: string;
    input_modes: string[];
    viewports: UiViewport[];
    density: string;
    orientation: string;
    capabilities: string[];
}

export interface UiNode {
    id: string;
    name: string;
    type: string;
    content: Record<string, unknown>;
    props: Record<string, unknown>;
    layout: Record<string, unknown>;
    appearance: Record<string, unknown>;
    responsive: unknown[];
    states: Record<string, unknown>;
    interactions: unknown[];
    children: UiNode[];
    locked: boolean;
}

export interface UiPage {
    id: string;
    name: string;
    route_intent: string | null;
    root: UiNode;
}

export interface UiDocument {
    schema_version: 'sacode-ui/v1';
    id: string;
    name: string;
    target: TargetSurface;
    pages: UiPage[];
    reusable_components: unknown[];
    tokens: Record<string, unknown>;
    assets: unknown[];
    flows: unknown[];
    version: number;
    status: string;
    created_at: string;
    updated_at: string;
}

export interface UiPatchOperation {
    type: string;
    node_id?: string;
    parent_id?: string;
    index?: number;
    new_node_id?: string;
    width?: string;
    height?: string;
    patch?: Record<string, unknown>;
    interactions?: unknown[];
    name?: string;
    value?: string;
    locked?: boolean;
    node?: UiNode;
}

export interface UiDocumentPatch {
    schema_version: 'sacode-ui-patch/v1';
    base_version: number;
    summary: string;
    operations: UiPatchOperation[];
}

export interface UiPatchChange {
    operation: string;
    node_id: string | null;
    description: string;
}

export interface UiPatchProposal {
    patch: UiDocumentPatch;
    changes: UiPatchChange[];
    source: string;
}

export interface UiCheckFinding {
    id: string;
    severity: string;
    message: string;
    node_id: string | null;
}

export interface UiCheckReport {
    checked_version: number;
    passed: boolean;
    findings: UiCheckFinding[];
    checked_at: string;
}

export interface UiDocumentVersion {
    version: number;
    document: UiDocument;
    confirmed_at: string;
    summary: string;
}

export interface ImplementationProfile {
    schema_version: 'sacode-implementation/v1';
    project_mode: 'existing' | 'new';
    target_platform: string;
    distribution: string | null;
    operating_systems: string[];
    language: string;
    framework: string;
    runtime: string | null;
    desktop_shell: string | null;
    build_tool: string | null;
    package_manager: string | null;
    ui_library: string | null;
    styling: string | null;
    router: string | null;
    state_management: string | null;
    network_layer: string | null;
    test_framework: string | null;
    source: 'detected' | 'user-selected' | 'ai-recommended';
    confidence: number | null;
    evidence: unknown[];
    decisions: unknown[];
    confirmed: boolean;
    confirmed_at: string | null;
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
    target_surface: TargetSurface;
    ui_document: UiDocument | null;
    implementation_profile: ImplementationProfile | null;
    ui_versions: UiDocumentVersion[];
    ui_check_report: UiCheckReport | null;
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
    target_surface?: TargetSurface;
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
    target_surface?: TargetSurface;
}

export interface UpdateUiDocumentRequest {
    document: UiDocument;
    expected_version?: number;
}

export interface ConfirmUiDocumentRequest {
    expected_version?: number;
    summary?: string;
}

export interface GenerateUiPatchRequest {
    instruction: string;
    expected_version?: number;
}

export interface ApplyUiPatchRequest {
    patch: UiDocumentPatch;
}

export interface UpdateImplementationProfileRequest {
    profile: ImplementationProfile;
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

const DEFAULT_TARGET_SURFACE: TargetSurface = {
    platform: 'responsive-web',
    input_modes: ['mouse', 'keyboard', 'touch'],
    viewports: [
        { id: 'desktop', name: 'Desktop', width: 1440, height: 900 },
        { id: 'tablet', name: 'Tablet', width: 768, height: 1024 },
        { id: 'mobile', name: 'Mobile', width: 390, height: 844 },
    ],
    density: 'comfortable',
    orientation: 'adaptive',
    capabilities: [],
};

export function parseTargetSurface(body: unknown): TargetSurface {
    if (!isRecord(body)) return { ...DEFAULT_TARGET_SURFACE, viewports: [...DEFAULT_TARGET_SURFACE.viewports] };
    return {
        platform: typeof body.platform === 'string' ? body.platform : 'responsive-web',
        input_modes: stringArray(body.input_modes),
        viewports: parseRecordArray(body.viewports, (item) => ({
            id: requiredString(item.id, 'UI viewport id'),
            name: typeof item.name === 'string' ? item.name : String(item.id),
            width: typeof item.width === 'number' ? item.width : 0,
            height: typeof item.height === 'number' ? item.height : 0,
        })),
        density: typeof body.density === 'string' ? body.density : 'comfortable',
        orientation: typeof body.orientation === 'string' ? body.orientation : 'adaptive',
        capabilities: stringArray(body.capabilities),
    };
}

export function parseUiNode(body: unknown): UiNode {
    if (!isRecord(body)) throw new Error('UI node returned an unexpected response body');
    return {
        id: requiredString(body.id, 'UI node id'),
        name: typeof body.name === 'string' ? body.name : '',
        type: typeof body.type === 'string' ? body.type : 'container',
        content: isRecord(body.content) ? body.content : {},
        props: isRecord(body.props) ? body.props : {},
        layout: isRecord(body.layout) ? body.layout : {},
        appearance: isRecord(body.appearance) ? body.appearance : {},
        responsive: Array.isArray(body.responsive) ? body.responsive : [],
        states: isRecord(body.states) ? body.states : {},
        interactions: Array.isArray(body.interactions) ? body.interactions : [],
        children: Array.isArray(body.children) ? body.children.map(parseUiNode) : [],
        locked: typeof body.locked === 'boolean' ? body.locked : false,
    };
}

export function parseUiDocument(body: unknown): UiDocument {
    if (!isRecord(body)) throw new Error('UI document returned an unexpected response body');
    const schemaVersion = requiredString(body.schema_version, 'UI document schema version');
    if (schemaVersion !== 'sacode-ui/v1') throw new Error(`Unsupported UI document schema: ${schemaVersion}`);
    return {
        schema_version: schemaVersion,
        id: requiredString(body.id, 'UI document id'),
        name: requiredString(body.name, 'UI document name'),
        target: parseTargetSurface(body.target),
        pages: parseRecordArray(body.pages, (item) => ({
            id: requiredString(item.id, 'UI page id'),
            name: typeof item.name === 'string' ? item.name : '',
            route_intent: typeof item.route_intent === 'string' ? item.route_intent : null,
            root: parseUiNode(item.root),
        })),
        reusable_components: Array.isArray(body.reusable_components) ? body.reusable_components : [],
        tokens: isRecord(body.tokens) ? body.tokens : {},
        assets: Array.isArray(body.assets) ? body.assets : [],
        flows: Array.isArray(body.flows) ? body.flows : [],
        version: typeof body.version === 'number' ? body.version : 0,
        status: typeof body.status === 'string' ? body.status : 'draft',
        created_at: typeof body.created_at === 'string' ? body.created_at : '',
        updated_at: typeof body.updated_at === 'string' ? body.updated_at : '',
    };
}

export function parseUiDocumentPatch(body: unknown): UiDocumentPatch {
    if (!isRecord(body)) throw new Error('UI patch returned an unexpected response body');
    const schemaVersion = requiredString(body.schema_version, 'UI patch schema version');
    if (schemaVersion !== 'sacode-ui-patch/v1') throw new Error(`Unsupported UI patch schema: ${schemaVersion}`);
    return {
        schema_version: schemaVersion,
        base_version: typeof body.base_version === 'number' ? body.base_version : 0,
        summary: typeof body.summary === 'string' ? body.summary : '',
        operations: parseRecordArray(body.operations, (item) => ({
            type: requiredString(item.type, 'UI patch operation type'),
            ...(typeof item.node_id === 'string' ? { node_id: item.node_id } : {}),
            ...(typeof item.parent_id === 'string' ? { parent_id: item.parent_id } : {}),
            ...(typeof item.index === 'number' ? { index: item.index } : {}),
            ...(typeof item.new_node_id === 'string' ? { new_node_id: item.new_node_id } : {}),
            ...(typeof item.width === 'string' ? { width: item.width } : {}),
            ...(typeof item.height === 'string' ? { height: item.height } : {}),
            ...(isRecord(item.patch) ? { patch: item.patch } : {}),
            ...(Array.isArray(item.interactions) ? { interactions: item.interactions } : {}),
            ...(typeof item.name === 'string' ? { name: item.name } : {}),
            ...(typeof item.value === 'string' ? { value: item.value } : {}),
            ...(typeof item.locked === 'boolean' ? { locked: item.locked } : {}),
            ...(isRecord(item.node) ? { node: parseUiNode(item.node) } : {}),
        })),
    };
}

export function parseUiPatchProposal(body: unknown): UiPatchProposal {
    if (!isRecord(body)) throw new Error('UI patch proposal returned an unexpected response body');
    return {
        patch: parseUiDocumentPatch(body.patch),
        changes: parseRecordArray(body.changes, (item) => ({
            operation: requiredString(item.operation, 'UI patch change operation'),
            node_id: typeof item.node_id === 'string' ? item.node_id : null,
            description: typeof item.description === 'string' ? item.description : '',
        })),
        source: typeof body.source === 'string' ? body.source : 'ai',
    };
}

export function parseUiCheckReport(body: unknown): UiCheckReport {
    if (!isRecord(body)) throw new Error('UI check returned an unexpected response body');
    return {
        checked_version: typeof body.checked_version === 'number' ? body.checked_version : 0,
        passed: body.passed === true,
        findings: parseRecordArray(body.findings, (item) => ({
            id: requiredString(item.id, 'UI check finding id'),
            severity: typeof item.severity === 'string' ? item.severity : 'warning',
            message: typeof item.message === 'string' ? item.message : '',
            node_id: typeof item.node_id === 'string' ? item.node_id : null,
        })),
        checked_at: typeof body.checked_at === 'string' ? body.checked_at : '',
    };
}

function parseUiDocumentVersion(body: Record<string, unknown>): UiDocumentVersion {
    return {
        version: typeof body.version === 'number' ? body.version : 0,
        document: parseUiDocument(body.document),
        confirmed_at: typeof body.confirmed_at === 'string' ? body.confirmed_at : '',
        summary: typeof body.summary === 'string' ? body.summary : '',
    };
}

export function parseImplementationProfile(body: unknown): ImplementationProfile {
    if (!isRecord(body)) throw new Error('Implementation profile returned an unexpected response body');
    const schemaVersion = requiredString(body.schema_version, 'Implementation profile schema version');
    if (schemaVersion !== 'sacode-implementation/v1') throw new Error(`Unsupported implementation profile schema: ${schemaVersion}`);
    const projectMode = body.project_mode === 'new' ? 'new' : 'existing';
    const source = body.source === 'user-selected' || body.source === 'ai-recommended' ? body.source : 'detected';
    return {
        schema_version: schemaVersion,
        project_mode: projectMode,
        target_platform: typeof body.target_platform === 'string' ? body.target_platform : '',
        distribution: typeof body.distribution === 'string' ? body.distribution : null,
        operating_systems: stringArray(body.operating_systems),
        language: typeof body.language === 'string' ? body.language : '',
        framework: typeof body.framework === 'string' ? body.framework : '',
        runtime: typeof body.runtime === 'string' ? body.runtime : null,
        desktop_shell: typeof body.desktop_shell === 'string' ? body.desktop_shell : null,
        build_tool: typeof body.build_tool === 'string' ? body.build_tool : null,
        package_manager: typeof body.package_manager === 'string' ? body.package_manager : null,
        ui_library: typeof body.ui_library === 'string' ? body.ui_library : null,
        styling: typeof body.styling === 'string' ? body.styling : null,
        router: typeof body.router === 'string' ? body.router : null,
        state_management: typeof body.state_management === 'string' ? body.state_management : null,
        network_layer: typeof body.network_layer === 'string' ? body.network_layer : null,
        test_framework: typeof body.test_framework === 'string' ? body.test_framework : null,
        source,
        confidence: typeof body.confidence === 'number' ? body.confidence : null,
        evidence: Array.isArray(body.evidence) ? body.evidence : [],
        decisions: Array.isArray(body.decisions) ? body.decisions : [],
        confirmed: typeof body.confirmed === 'boolean' ? body.confirmed : false,
        confirmed_at: typeof body.confirmed_at === 'string' ? body.confirmed_at : null,
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
        target_surface: parseTargetSurface(body.target_surface),
        ui_document: body.ui_document != null ? parseUiDocument(body.ui_document) : null,
        implementation_profile: body.implementation_profile != null ? parseImplementationProfile(body.implementation_profile) : null,
        ui_versions: parseRecordArray(body.ui_versions, parseUiDocumentVersion),
        ui_check_report: body.ui_check_report != null ? parseUiCheckReport(body.ui_check_report) : null,
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
        pending_question: isRecord(body.pending_question)
            ? {
                question: typeof body.pending_question.question === 'string'
                    ? body.pending_question.question : undefined,
                options: Array.isArray(body.pending_question.options)
                    ? body.pending_question.options.filter(isRecord).map((o) => ({
                        label: typeof o.label === 'string' ? o.label : undefined,
                        value: typeof o.value === 'string' ? o.value : undefined,
                        description: typeof o.description === 'string' ? o.description : undefined,
                    }))
                    : undefined,
                allow_multiple: body.pending_question.allow_multiple === true,
            }
            : null,
        usage: isRecord(body.usage)
            ? {
                prompt_tokens: typeof body.usage.prompt_tokens === 'number' ? body.usage.prompt_tokens : undefined,
                completion_tokens: typeof body.usage.completion_tokens === 'number' ? body.usage.completion_tokens : undefined,
                total_tokens: typeof body.usage.total_tokens === 'number' ? body.usage.total_tokens : undefined,
            }
            : null,
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
export interface KnowledgeNote {
    id: string; title: string; scope: 'user' | 'project'; readonly: boolean;
    created_at?: string | null; updated_at?: string | null; content?: string;
}
export interface KnowledgeHit {
    id: string; title: string; scope: 'user' | 'project'; readonly: boolean; score: number; snippet: string;
}
export interface AutomationRule {
    id: string; name: string; cron_expr: string; prompt: string;
    backend_id: string | null; enabled: boolean; last_fired_at: string | null; next_run: string | null;
}
export interface AutomationRun {
    id: string; rule_id: string; task_id: string; triggered_at: string; status: string;
}
export interface AutomationRuleInput {
    name: string; cron_expr: string; prompt: string; backend_id?: string | null; enabled: boolean;
}
export interface GitAuthPlatformStatus {
    host: string; configured: boolean; token_present: boolean; mode: string | null;
    login: string | null; updated_at: string | null;
}
export interface GitAuthStatus {
    platforms: GitAuthPlatformStatus[];
}
export interface GithubDeviceFlow {
    device_code: string; user_code: string; verification_uri: string;
    verification_uri_complete?: string | null; expires_in: number; interval: number;
}
export interface GiteeAuthorizeFlow {
    authorize_url: string; state: string;
}
export interface HookConfig {
    name: string; event: string; command: string; enabled: boolean;
}
export interface HookListView {
    hooks: HookConfig[]; config_path: string; executed: false;
}
export interface DetectedTool {
    id: string; label: string; config_path: string; provider_count: number;
}
export interface ImportedProvider {
    name: string; base_url: string; model: string;
    auth_header?: string | null; auth_scheme?: string | null;
    has_api_key: boolean;
}
export type AuditScanTier = 'static' | 'lightweight' | 'deep';

function parseWrappedList<T>(body: unknown, key: string, valid: (value: unknown) => value is T): T[] {
    if (!isRecord(body) || !Array.isArray(body[key]) || !body[key].every(valid)) throw new Error(`Invalid ${key} response`);
    return body[key] as T[];
}
function isKnowledgeNote(value: unknown): value is KnowledgeNote {
    return isRecord(value) && typeof value.id === 'string' && typeof value.title === 'string'
        && (value.scope === 'user' || value.scope === 'project') && typeof value.readonly === 'boolean';
}
function isKnowledgeHit(value: unknown): value is KnowledgeHit {
    return isKnowledgeNote(value) && isRecord(value) && typeof value.score === 'number' && typeof value.snippet === 'string';
}
function isAutomationRule(value: unknown): value is AutomationRule {
    return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string'
        && typeof value.cron_expr === 'string' && typeof value.prompt === 'string' && typeof value.enabled === 'boolean';
}
function isAutomationRun(value: unknown): value is AutomationRun {
    return isRecord(value) && typeof value.id === 'string' && typeof value.rule_id === 'string'
        && typeof value.task_id === 'string' && typeof value.triggered_at === 'string' && typeof value.status === 'string';
}
function isGitAuthPlatformStatus(value: unknown): value is GitAuthPlatformStatus {
    return isRecord(value) && typeof value.host === 'string' && typeof value.configured === 'boolean'
        && typeof value.token_present === 'boolean' && typeof value.login === 'string'
        && typeof value.updated_at === 'string' && typeof value.mode === 'string';
}
function isGithubDeviceFlow(value: unknown): value is GithubDeviceFlow {
    return isRecord(value) && typeof value.device_code === 'string' && typeof value.user_code === 'string'
        && typeof value.verification_uri === 'string' && typeof value.expires_in === 'number'
        && typeof value.interval === 'number';
}
function isGiteeAuthorizeFlow(value: unknown): value is GiteeAuthorizeFlow {
    return isRecord(value) && typeof value.authorize_url === 'string' && typeof value.state === 'string';
}
function isHookConfig(value: unknown): value is HookConfig {
    return isRecord(value) && typeof value.name === 'string' && typeof value.event === 'string'
        && typeof value.command === 'string' && typeof value.enabled === 'boolean';
}
function isHookListView(value: unknown): value is HookListView {
    return isRecord(value) && Array.isArray(value.hooks) && value.hooks.every(isHookConfig)
        && typeof value.config_path === 'string' && value.executed === false;
}
function isDetectedTool(value: unknown): value is DetectedTool {
    return isRecord(value) && typeof value.id === 'string' && typeof value.label === 'string'
        && typeof value.config_path === 'string' && typeof value.provider_count === 'number';
}
function isGitAuthStatus(value: unknown): value is GitAuthStatus {
    return isRecord(value) && Array.isArray(value.platforms) && value.platforms.every(isGitAuthPlatformStatus);
}
function parseGitAuthStatus(body: unknown): GitAuthStatus {
    if (!isGitAuthStatus(body)) throw new Error('Invalid git auth status response');
    return body;
}
function isImportedProvider(value: unknown): value is ImportedProvider {
    return isRecord(value) && typeof value.name === 'string' && typeof value.base_url === 'string'
        && typeof value.model === 'string' && typeof value.has_api_key === 'boolean';
}
function parseWrappedItem<T>(body: unknown, key: string, valid: (value: unknown) => value is T): T {
    if (!isRecord(body) || !valid(body[key])) throw new Error(`Invalid ${key} response`);
    return body[key];
}

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
        method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
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

    /** HTML/空响应时不要 SyntaxError，给可识别错误 */
    private async parseJsonSafe(res: HttpResponse, label: string): Promise<unknown> {
        const text = await res.text();
        if (!text || text.trimStart().startsWith('<')) {
            throw new Error(`${label} returned non-JSON (HTTP ${res.status})`);
        }
        return JSON.parse(text) as unknown;
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

    async accountStatus(): Promise<{ account: AccountStatus; login_state?: string | null }> {
        const res = await this.request('GET', '/account/status');
        if (!res.ok) throw await responseError(res, 'Account status');
        return await res.json() as { account: AccountStatus; login_state?: string | null };
    }

    async accountLogin(): Promise<void> {
        const res = await this.request('POST', '/account/login');
        if (!res.ok) throw await responseError(res, 'Account login');
    }

    async accountLogout(): Promise<void> {
        const res = await this.request('POST', '/account/logout');
        if (!res.ok) throw await responseError(res, 'Account logout');
    }

    async accountSyncModels(): Promise<string[]> {
        const res = await this.request('POST', '/account/sync-models');
        if (!res.ok) throw await responseError(res, 'Account model sync');
        return ((await res.json()) as { models: string[] }).models;
    }

    async accountEntitlements(product?: string): Promise<{
        items: EntitlementItem[];
        entitlement_base_url?: string;
        needs_entitlement_auth?: boolean;
    }> {
        const qs = product ? `?product=${encodeURIComponent(product)}` : '';
        const res = await this.request('GET', `/account/entitlements${qs}`);
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        if (res.status === 401 && body.needs_entitlement_auth) {
            return { items: [], needs_entitlement_auth: true };
        }
        if (!res.ok) throw await responseError(res, 'Account entitlements');
        return {
            items: Array.isArray(body.items) ? (body.items as EntitlementItem[]) : [],
            entitlement_base_url: typeof body.entitlement_base_url === 'string' ? body.entitlement_base_url : undefined,
        };
    }

    async accountEntitlementLogin(): Promise<void> {
        const res = await this.request('POST', '/account/entitlement-login');
        if (!res.ok) throw await responseError(res, 'Entitlement login');
    }

    async accountLicenseStatus(): Promise<{
        present: boolean;
        status: string;
        kid?: string;
        product?: string;
        capabilities?: string[];
        expires_at?: string;
        license_id?: string;
        error?: string;
    }> {
        const res = await this.request('GET', '/account/license');
        if (!res.ok) throw await responseError(res, 'License status');
        return await res.json() as {
            present: boolean;
            status: string;
            kid?: string;
            product?: string;
            capabilities?: string[];
            expires_at?: string;
            license_id?: string;
            error?: string;
        };
    }

    async accountLicenseImport(license: string): Promise<{
        ok: boolean;
        kid?: string;
        product?: string;
        capabilities?: string[];
        expires_at?: string;
    }> {
        const res = await this.request('POST', '/account/license', { license });
        if (!res.ok) throw await responseError(res, 'License import');
        return await res.json() as {
            ok: boolean;
            kid?: string;
            product?: string;
            capabilities?: string[];
            expires_at?: string;
        };
    }

    async accountActivationRequest(input?: { device_name?: string; product?: string; platform?: string }): Promise<{
        ok: boolean;
        request: Record<string, unknown>;
    }> {
        const res = await this.request('POST', '/account/activation-request', input ?? {});
        if (!res.ok) throw await responseError(res, 'Activation request');
        return await res.json() as { ok: boolean; request: Record<string, unknown> };
    }

    async registerModelConnection(input: { name: string; base_url: string; upstream_api_key: string; models: { client_model: string; upstream_model: string }[] }): Promise<void> {
        const res = await this.request('POST', '/account/connections', input);
        if (!res.ok) throw await responseError(res, 'Gateway model registration');
    }

    async listLocalProviders(): Promise<{ providers: { name: string; base_url: string; models: string[]; has_credential: boolean }[] }> {
        const res = await this.request('GET', '/providers/local');
        if (!res.ok) throw await responseError(res, 'Local providers');
        return await res.json() as { providers: { name: string; base_url: string; models: string[]; has_credential: boolean }[] };
    }

    async createLocalProvider(input: { name: string; base_url: string; api_key: string; models: string[]; thinking: boolean; reasoning_effort?: string }): Promise<void> {
        const res = await this.request('POST', '/providers/local', input);
        if (!res.ok) throw await responseError(res, 'Create local provider');
    }

    async deleteLocalProvider(name: string): Promise<void> {
        const res = await this.request('DELETE', `/providers/local/${encodeURIComponent(name)}`);
        if (!res.ok) throw await responseError(res, 'Delete local provider');
    }

    async getWorkspaceCapabilities(): Promise<WorkspaceCapabilities> {
        const res = await this.request('GET', '/workspace/capabilities');
        if (!res.ok) throw await responseError(res, 'Workspace capabilities request');
        const body = await res.json() as Partial<WorkspaceCapabilities>;
        return {
            workspace: typeof body.workspace === 'string' ? body.workspace : '',
            models: Array.isArray(body.models) ? body.models : [],
            model_status: body.model_status,
            account: body.account,
            skills: Array.isArray(body.skills) ? body.skills : [],
            files: Array.isArray(body.files) ? body.files : [],
        };
    }

    async getWorkspaceFile(path: string): Promise<WorkspaceFilePreview> {
        const res = await this.request('GET', `/workspace/file?path=${encodeURIComponent(path)}`);
        if (!res.ok) throw await responseError(res, 'Workspace file preview');
        const body: unknown = await res.json();
        if (!isRecord(body) || typeof body.path !== 'string' || typeof body.size !== 'number' || typeof body.content !== 'string') {
            throw new Error('Invalid workspace file preview response');
        }
        return { path: body.path, size: body.size, content: body.content };
    }

    /** P2-5：按目录一层列表（path 空串 = 根） */
    async listWorkspaceDir(path: string): Promise<{
        path: string;
        entries: Array<{ path: string; name: string; is_dir: boolean; size: number; language?: string }>;
    }> {
        const res = await this.request('GET', `/workspace/list?path=${encodeURIComponent(path)}`);
        if (!res.ok) throw await responseError(res, 'Workspace list');
        return await res.json() as {
            path: string;
            entries: Array<{ path: string; name: string; is_dir: boolean; size: number; language?: string }>;
        };
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

    async getUiDocument(id: string): Promise<UiDocument> {
        const res = await this.request('GET', `/api/design/sessions/${encodeURIComponent(id)}/ui`);
        if (!res.ok) throw await responseError(res, 'UI document query');
        return parseUiDocument(await res.json());
    }

    async updateUiDocument(id: string, req: UpdateUiDocumentRequest): Promise<UiDocument> {
        const res = await this.request('PATCH', `/api/design/sessions/${encodeURIComponent(id)}/ui`, req);
        if (!res.ok) throw await responseError(res, 'UI document update');
        return parseUiDocument(await res.json());
    }

    async proposeUiPatch(id: string, req: GenerateUiPatchRequest): Promise<UiPatchProposal> {
        const res = await this.request('POST', `/api/design/sessions/${encodeURIComponent(id)}/ui/patch/propose`, req);
        if (!res.ok) throw await responseError(res, 'UI patch proposal');
        return parseUiPatchProposal(await res.json());
    }

    async applyUiPatch(id: string, req: ApplyUiPatchRequest): Promise<UiDocument> {
        const res = await this.request('POST', `/api/design/sessions/${encodeURIComponent(id)}/ui/patch/apply`, req);
        if (!res.ok) throw await responseError(res, 'UI patch application');
        return parseUiDocument(await res.json());
    }

    async checkUiDocument(id: string): Promise<UiCheckReport> {
        const res = await this.request('GET', `/api/design/sessions/${encodeURIComponent(id)}/ui/check`);
        if (!res.ok) throw await responseError(res, 'UI document check');
        return parseUiCheckReport(await res.json());
    }

    async confirmUiDocument(id: string, req: ConfirmUiDocumentRequest = {}): Promise<DesignSession> {
        const res = await this.request('POST', `/api/design/sessions/${encodeURIComponent(id)}/ui/confirm`, req);
        if (!res.ok) throw await responseError(res, 'UI document confirmation');
        return parseDesignSession(await res.json());
    }

    async updateImplementationProfile(id: string, req: UpdateImplementationProfileRequest): Promise<DesignSession> {
        const res = await this.request('PUT', `/api/design/sessions/${encodeURIComponent(id)}/implementation`, req);
        if (!res.ok) throw await responseError(res, 'Implementation profile update');
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

    async knowledgeEntries(scope: 'user' | 'project'): Promise<KnowledgeNote[]> {
        const res = await this.request('GET', `/api/knowledge/entries?scope=${scope}`);
        if (!res.ok) throw await responseError(res, 'Knowledge entries');
        return parseWrappedList(await res.json(), 'entries', isKnowledgeNote);
    }
    async createKnowledgeNote(input: { scope: 'user' | 'project'; title: string; content: string }): Promise<KnowledgeNote> {
        const res = await this.request('POST', '/api/knowledge/notes', input);
        if (!res.ok) throw await responseError(res, 'Knowledge note creation');
        return parseWrappedItem(await res.json(), 'note', isKnowledgeNote);
    }
    async getKnowledgeNote(id: string, scope: 'user' | 'project'): Promise<KnowledgeNote> {
        const res = await this.request('GET', `/api/knowledge/notes/${encodeURIComponent(id)}?scope=${scope}`);
        if (!res.ok) throw await responseError(res, 'Knowledge note');
        return parseWrappedItem(await res.json(), 'note', isKnowledgeNote);
    }
    async updateKnowledgeNote(id: string, input: { scope: 'user' | 'project'; title: string; content: string; updated_at?: string | null }): Promise<KnowledgeNote> {
        const res = await this.request('PUT', `/api/knowledge/notes/${encodeURIComponent(id)}`, input);
        if (!res.ok) throw await responseError(res, 'Knowledge note update');
        return parseWrappedItem(await res.json(), 'note', isKnowledgeNote);
    }
    async deleteKnowledgeNote(id: string, scope: 'user' | 'project'): Promise<void> {
        const res = await this.request('DELETE', `/api/knowledge/notes/${encodeURIComponent(id)}?scope=${scope}`);
        if (!res.ok) throw await responseError(res, 'Knowledge note delete');
    }
    async searchKnowledge(q: string, scope: 'user' | 'project'): Promise<KnowledgeHit[]> {
        const res = await this.request('GET', `/api/knowledge/search?scope=${scope}&q=${encodeURIComponent(q)}`);
        if (!res.ok) throw await responseError(res, 'Knowledge search');
        return parseWrappedList(await res.json(), 'results', isKnowledgeHit);
    }
    async listAutomationRules(): Promise<AutomationRule[]> {
        const res = await this.request('GET', '/api/automation/rules');
        if (!res.ok) throw await responseError(res, 'Automation rules');
        return parseWrappedList(await res.json(), 'rules', isAutomationRule);
    }
    async createAutomationRule(input: AutomationRuleInput): Promise<AutomationRule> {
        const res = await this.request('POST', '/api/automation/rules', input);
        if (!res.ok) throw await responseError(res, 'Automation rule creation');
        return parseWrappedItem(await res.json(), 'rule', isAutomationRule);
    }
    async updateAutomationRule(id: string, input: AutomationRuleInput): Promise<AutomationRule> {
        const res = await this.request('PUT', `/api/automation/rules/${encodeURIComponent(id)}`, input);
        if (!res.ok) throw await responseError(res, 'Automation rule update');
        return parseWrappedItem(await res.json(), 'rule', isAutomationRule);
    }
    async deleteAutomationRule(id: string): Promise<void> {
        const res = await this.request('DELETE', `/api/automation/rules/${encodeURIComponent(id)}`);
        if (!res.ok) throw await responseError(res, 'Automation rule delete');
    }
    async toggleAutomationRule(id: string): Promise<AutomationRule> {
        const res = await this.request('POST', `/api/automation/rules/${encodeURIComponent(id)}/toggle`);
        if (!res.ok) throw await responseError(res, 'Automation rule toggle');
        return parseWrappedItem(await res.json(), 'rule', isAutomationRule);
    }
    async runAutomationRule(id: string): Promise<AutomationRun> {
        const res = await this.request('POST', `/api/automation/rules/${encodeURIComponent(id)}/run`);
        if (!res.ok) throw await responseError(res, 'Automation rule run');
        return parseWrappedItem(await res.json(), 'run', isAutomationRun);
    }
    async listAutomationHistory(ruleId?: string): Promise<AutomationRun[]> {
        const res = await this.request('GET', `/api/automation/history${ruleId ? `?rule_id=${encodeURIComponent(ruleId)}` : ''}`);
        if (!res.ok) throw await responseError(res, 'Automation history');
        return parseWrappedList(await res.json(), 'runs', isAutomationRun);
    }

    async gitAuthStatus(): Promise<GitAuthStatus> {
        const res = await this.request('GET', '/api/git-auth/status');
        if (!res.ok) throw await responseError(res, 'Git auth status');
        return parseGitAuthStatus(await res.json());
    }
    async startGithubDeviceFlow(clientId?: string): Promise<GithubDeviceFlow> {
        const res = await this.request('POST', '/api/git-auth/github/device', { ...(clientId ? { client_id: clientId } : {}) });
        if (!res.ok) throw await responseError(res, 'GitHub device flow');
        return parseWrappedItem(await res.json(), 'device_flow', isGithubDeviceFlow);
    }
    async pollGithubDeviceFlow(deviceCode: string, timeoutSeconds?: number, clientId?: string): Promise<{ status: string; login?: string }> {
        const res = await this.request('POST', '/api/git-auth/github/poll', {
            device_code: deviceCode,
            ...(timeoutSeconds ? { timeout_seconds: timeoutSeconds } : {}),
            ...(clientId ? { client_id: clientId } : {}),
        });
        if (!res.ok) throw await responseError(res, 'GitHub device flow poll');
        const body = await res.json() as { status: string; login?: string };
        return { status: body.status, ...(body.login ? { login: body.login } : {}) };
    }
    async authorizeGitee(redirectUri?: string): Promise<GiteeAuthorizeFlow> {
        const res = await this.request('POST', '/api/git-auth/gitee/authorize', { ...(redirectUri ? { redirect_uri: redirectUri } : {}) });
        if (!res.ok) throw await responseError(res, 'Gitee authorize');
        return parseWrappedItem(await res.json(), 'authorize', isGiteeAuthorizeFlow);
    }
    async completeGiteeAuth(code: string, redirectUri?: string): Promise<{ status: string }> {
        const res = await this.request('POST', '/api/git-auth/gitee/callback', {
            code,
            ...(redirectUri ? { redirect_uri: redirectUri } : {}),
        });
        if (!res.ok) throw await responseError(res, 'Gitee callback');
        return { status: 'ok' };
    }
    async gitAuthLogout(host: 'github' | 'gitee'): Promise<void> {
        const res = await this.request('POST', '/api/git-auth/logout', { host });
        if (!res.ok) throw await responseError(res, 'Git auth logout');
    }

    async listHooks(): Promise<HookListView> {
        const res = await this.request('GET', '/api/hooks');
        if (!res.ok) throw await responseError(res, 'Hooks list');
        const body = await res.json();
        if (!isHookListView(body)) throw new Error('Invalid hooks response');
        return body;
    }

    async listImportTools(): Promise<DetectedTool[]> {
        const res = await this.request('GET', '/api/import/tools');
        if (!res.ok) throw await responseError(res, 'Import tools');
        return parseWrappedList(await res.json(), 'tools', isDetectedTool);
    }
    async listImportProviders(toolId: string): Promise<ImportedProvider[]> {
        const res = await this.request('GET', `/api/import/tools/${encodeURIComponent(toolId)}/providers`);
        if (!res.ok) throw await responseError(res, 'Import providers');
        return parseWrappedList(await res.json(), 'providers', isImportedProvider);
    }
    async applyImport(toolId: string, providerNames: string[], apiKeys?: Record<string, string>): Promise<{ providers: string[] }> {
        const res = await this.request('POST', '/api/import/apply', {
            tool: toolId,
            providers: providerNames,
            ...(apiKeys ? { api_keys: apiKeys } : {}),
        });
        if (!res.ok) throw await responseError(res, 'Import apply');
        const body = await res.json() as { providers: string[] };
        return { providers: body.providers };
    }

    async runAuditScan(options: {
        scanTier?: AuditScanTier;
        useAi?: boolean;
        maxFiles?: number;
        modelProvider?: string;
    }): Promise<AuditResponse> {
        const body = {
            ...(options.scanTier ? { scan_tier: options.scanTier } : {}),
            ...(options.useAi !== undefined ? { use_ai: options.useAi } : {}),
            ...(options.maxFiles !== undefined ? { max_files: options.maxFiles } : {}),
            ...(options.modelProvider ? { model_provider: options.modelProvider } : {}),
        };
        const res = await this.request('POST', '/audit', body);
        if (!res.ok) throw await responseError(res, 'Audit scan');
        return parseAuditResponse(await res.json());
    }

    async createTask(options: {
        prompt: string;
        mode?: ExecutionModeInput;
        workspaceRoot?: string;
        backendId?: string;
        sessionId?: string;
        source?: EntrySource;
        modelProvider?: string;
        modelName?: string;
        skill?: string;
        contextPaths?: string[];
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
            ...(options.modelProvider ? { model_provider: options.modelProvider } : {}),
            ...(options.modelName ? { model_name: options.modelName } : {}),
            ...(options.skill ? { skill: options.skill } : {}),
            context_paths: options.contextPaths ?? [],
        };
        const res = await this.request('POST', '/task', body);
        if (!res.ok) throw await responseError(res, 'Task creation');
        return parseTaskResponse(await res.json());
    }

    async listDesktopConversations(): Promise<DesktopConversation[]> {
        const res = await this.request('GET', '/api/desktop/conversations');
        if (!res.ok) throw await responseError(res, 'Conversation list');
        return (await res.json() as { conversations: DesktopConversation[] }).conversations;
    }

    async getDesktopConversation(id: string): Promise<DesktopConversationDetail> {
        const res = await this.request('GET', `/api/desktop/conversations/${encodeURIComponent(id)}`);
        if (!res.ok) throw await responseError(res, 'Conversation');
        return await res.json() as DesktopConversationDetail;
    }

    async sendDesktopMessage(options: {
        prompt: string; mode: ExecutionModeInput; backendId: string; conversationId?: string;
        modelProvider?: string; modelName?: string; skill?: string; contextPaths?: string[];
    }): Promise<CreateTaskResponse & { conversation_id: string }> {
        const res = await this.request('POST', options.conversationId
            ? `/api/desktop/conversations/${encodeURIComponent(options.conversationId)}`
            : '/api/desktop/conversations', {
            prompt: options.prompt, mode: normalizeExecutionMode(options.mode), backend_id: normalizeBackendId(options.backendId),
            model_provider: options.modelProvider, model_name: options.modelName, skill: options.skill, context_paths: options.contextPaths ?? [],
        });
        if (!res.ok) throw await responseError(res, 'Conversation message');
        return await res.json() as CreateTaskResponse & { conversation_id: string };
    }

    async deleteDesktopConversation(id: string): Promise<void> {
        const res = await this.request('DELETE', `/api/desktop/conversations/${encodeURIComponent(id)}`);
        if (!res.ok) throw await responseError(res, 'Conversation deletion');
    }

    async listTasks(): Promise<TaskListResponse> {
        const res = await this.request('GET', '/tasks');
        if (!res.ok) throw await responseError(res, 'Task list request');
        return parseTaskList(await res.json());
    }

    async deleteTask(taskId: string): Promise<void> {
        const res = await this.request('DELETE', `/task/${encodeURIComponent(taskId)}`);
        if (!res.ok) throw await responseError(res, 'Task delete request');
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

    /** P2-1：上传附件到工作区 .sacode/uploads，返回可入 context_paths 的相对路径 */
    async uploadWorkspaceAttachment(options: {
        filename: string;
        contentBase64: string;
        kind?: string;
    }): Promise<{ status: string; path: string; size: number; message?: string }> {
        const res = await this.request('POST', '/api/workspace/uploads', JSON.stringify({
            filename: options.filename,
            content_base64: options.contentBase64,
            kind: options.kind ?? '',
        }));
        if (!res.ok) throw await responseError(res, 'Upload attachment');
        return await res.json() as { status: string; path: string; size: number; message?: string };
    }

    /** P1-2：技能管理 */
    async listSkills(): Promise<{
        skills: Array<{
            name: string;
            description: string;
            source: string;
            path?: string;
            version?: string;
            author?: string;
            tags?: string[];
        }>;
        error?: string;
    }> {
        const res = await this.request('GET', '/api/skills');
        if (!res.ok) throw await responseError(res, 'Skills list');
        return await this.parseJsonSafe(res, 'Skills list') as Awaited<ReturnType<DaemonClient['listSkills']>>;
    }

    async upsertSkill(
        name: string,
        body: {
            description?: string;
            prompt: string;
            source?: 'user' | 'project' | 'workspace';
            version?: string;
            author?: string;
            tags?: string[];
        },
    ): Promise<{ status: string; name?: string; path?: string; message?: string }> {
        const res = await this.request('PUT', `/api/skills/${encodeURIComponent(name)}`, JSON.stringify(body));
        if (!res.ok) throw await responseError(res, 'Skill upsert');
        return await res.json() as { status: string; name?: string; path?: string; message?: string };
    }

    async deleteSkill(name: string, source?: 'user' | 'project' | 'workspace'): Promise<void> {
        const qs = source ? `?source=${encodeURIComponent(source)}` : '';
        const res = await this.request('DELETE', `/api/skills/${encodeURIComponent(name)}${qs}`);
        if (!res.ok) throw await responseError(res, 'Skill delete');
    }

    /** P1-1：MCP 服务器管理 */
    async listMcpServers(): Promise<{
        servers: Array<{
            name: string;
            type: string;
            url?: string;
            command?: string;
            args?: string[];
            env?: Record<string, string>;
            enabled: boolean;
            source: string;
        }>;
        error?: string;
    }> {
        const res = await this.request('GET', '/api/mcp/servers');
        if (!res.ok) throw await responseError(res, 'MCP list');
        return await this.parseJsonSafe(res, 'MCP list') as Awaited<ReturnType<DaemonClient['listMcpServers']>>;
    }

    async upsertMcpServer(
        name: string,
        body: {
            type: 'remote' | 'stdio';
            url?: string;
            command?: string;
            args?: string[];
            env?: Record<string, string>;
            enabled?: boolean;
            source?: 'user' | 'project';
        },
    ): Promise<{ status: string; name?: string; message?: string }> {
        const res = await this.request('PUT', `/api/mcp/servers/${encodeURIComponent(name)}`, JSON.stringify(body));
        if (!res.ok) throw await responseError(res, 'MCP upsert');
        return await res.json() as { status: string; name?: string; message?: string };
    }

    async deleteMcpServer(name: string): Promise<void> {
        const res = await this.request('DELETE', `/api/mcp/servers/${encodeURIComponent(name)}`);
        if (!res.ok) throw await responseError(res, 'MCP delete');
    }

    async toggleMcpServer(name: string, enabled: boolean, source?: 'user' | 'project'): Promise<void> {
        const res = await this.request(
            'POST',
            `/api/mcp/servers/${encodeURIComponent(name)}/toggle`,
            JSON.stringify({ enabled, source: source ?? 'project' }),
        );
        if (!res.ok) throw await responseError(res, 'MCP toggle');
    }

    async testMcpServer(name: string): Promise<{
        status: string;
        tools?: Array<{ name: string; description?: string }>;
        message?: string;
    }> {
        const res = await this.request('POST', `/api/mcp/servers/${encodeURIComponent(name)}/test`);
        if (!res.ok) throw await responseError(res, 'MCP test');
        return await res.json() as { status: string; tools?: Array<{ name: string; description?: string }>; message?: string };
    }

    /** P0-1：回答 interaction.ask 挂起问题，续写会话 */
    async answerTaskQuestion(
        taskId: string,
        body: { answer?: string; selected?: string[]; cancelled?: boolean },
    ): Promise<{ task_id?: string; conversation_id?: string; status?: string; message?: string }> {
        const res = await this.request(
            'POST',
            `/task/${encodeURIComponent(taskId)}/answer`,
            JSON.stringify(body),
        );
        if (!res.ok) throw await responseError(res, 'Answer question');
        return await res.json() as { task_id?: string; conversation_id?: string; status?: string; message?: string };
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
