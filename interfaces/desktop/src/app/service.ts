/** Daemon session service for Desktop (Tauri IPC or Vite same-origin proxy). */
import {
  DaemonClient,
  daemonHealthError,
  openEventStream,
  parseSseFrame,
  type AccountStatus,
  type AuditFinding,
  type AuditReportSummary,
  type AuditResponse,
  type CreateExtractionRequest,
  type CreateSessionRequest,
  type DaemonHealth,
  type KnowledgeNote,
  type KnowledgeHit,
  type AutomationRule,
  type AutomationRun,
  type AutomationRuleInput,
  type AuditScanTier,
  type DetectedTool,
  type GitAuthStatus,
  type GithubDeviceFlow,
  type GiteeAuthorizeFlow,
  type HookListView,
  type ImportedProvider,
  type DesignProjectContext,
  type DesignResourceCatalog,
  type DesignSession,
  type ExecutionModeInput,
  type ExtractionJob,
  type ImageGenerationRequest,
  type ImageGenerationResult,
  type ImplementationProfile,
  type PendingApproval,
  type UiCheckReport,
  type UiDocumentPatch,
  type UiPatchProposal,
  type TargetSurface,
  type TaskFileChange,
  type TaskListItem,
  type DesktopConversation,
  type DesktopConversationDetail,
  type TaskSnapshot,
  type UiDocument,
  type UpdateSessionRequest,
  type WorkspaceCapabilities,
} from '@cherishron/sacode-client-core';
import { createTauriTransport } from '../ipc-transport.ts';
import {
  isTauri,
  listenDaemonEvents,
  startDaemon,
  startEventBridge,
  stopDaemon,
  daemonInfo,
  type SidecarHandleDto,
} from '../tauri-bridge.ts';

export type RuntimeMode = 'tauri' | 'vite';

export interface TimelineItem {
  kind: 'user' | 'assistant' | 'tool' | 'system' | 'error' | 'approval' | 'change';
  text: string;
  detail?: string;
  taskId?: string;
}

export type ChangeItem = TaskFileChange;

export class DesktopApp {
  mode: RuntimeMode = isTauri() ? 'tauri' : 'vite';
  /** Diagnostics surface for the splash screen. */
  bootDiagnostics: string[] = [];
  private bootLog(msg: string) {
    this.bootDiagnostics.push(msg);
    this.emit();
  }  handle: SidecarHandleDto | null = null;
  client: DaemonClient | null = null;
  currentTaskId: string | null = null;
  lastTaskCreateError: string | null = null;
  tasks: TaskListItem[] = [];
  desktopConversations: DesktopConversation[] = [];
  conversationTurns: DesktopConversationDetail | null = null;
  currentConversationId: string | null = null;
  timeline: TimelineItem[] = [];
  changes: ChangeItem[] = [];
  approvals: PendingApproval[] = [];
  agents: { id: string; display_name: string; health?: string }[] = [];
  workspaceCapabilities: WorkspaceCapabilities = { workspace: '', models: [], skills: [], files: [] };
  defaultBackend = 'sacode';
  health: DaemonHealth | null = null;
  auditFindings: AuditFinding[] = [];
  auditReports: AuditReportSummary[] = [];
  currentAuditId: string | null = null;
  auditRunning = false;
  /** 当前安全扫描档位：static / lightweight / deep。 */
  auditTier: AuditScanTier = 'static';
  designContext: DesignProjectContext | null = null;
  designResources: DesignResourceCatalog | null = null;
  designLoading = false;
  designError: string | null = null;
  extractions: ExtractionJob[] = [];
  extractionRunning: Record<string, boolean> = {};
  sessions: DesignSession[] = [];
  currentSession: DesignSession | null = null;
  sessionLoading = false;
  imageResults: ImageGenerationResult[] = [];
  imageLoading = false;
  stopStream: (() => void) | null = null;
  pollTimer: ReturnType<typeof setInterval> | null = null;
  workspace = '';
  onChange: (() => void) | null = null;

  private emit() {
    this.onChange?.();
  }

  private push(item: TimelineItem) {
    this.timeline.push(item);
    if (this.timeline.length > 400) this.timeline.splice(0, this.timeline.length - 400);
    this.emit();
  }

  log(text: string) {
    this.push({ kind: 'system', text });
  }

  error(text: string) {
    this.push({ kind: 'error', text });
  }

  private buildClient(handle?: SidecarHandleDto | null) {
    if (this.mode === 'tauri') {
      const h = handle ?? this.handle;
      this.client = new DaemonClient({
        host: h?.host ?? '127.0.0.1',
        port: h?.port ?? 0,
        // Token intentionally omitted — Tauri shell attaches Bearer.
        transport: createTauriTransport(),
        entrySource: 'desktop',
      });
      return;
    }
    // Vite: same-origin proxy injects Authorization server-side.
    this.client = new DaemonClient({
      host: '127.0.0.1',
      port: window.location.port ? Number(window.location.port) : 5173,
      entrySource: 'desktop',
    });
  }

  async init(workspace?: string) {
    this.workspace = workspace ?? '';
    this.stopStream?.();
    this.stopStream = null;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;

    // Build a transport-only client immediately. In Tauri mode, all daemon
    // HTTP calls are proxied through the Rust shell via daemon_proxy; the
    // client doesn't need a live port. This lets the main UI render right
    // away while the sidecar starts in the background.
    this.buildClient(this.handle);

    if (this.mode === 'tauri') {
      this.bootLog('mode=tauri, starting daemon…');
      // Fire start_daemon without awaiting — the UI must not stall on IPC.
      void this.startSidecar(workspace);
    } else {
      this.bootLog('mode=vite (browser proxy)');
      this.log('Vite mode: using same-origin proxy (token not in WebView)');
      this.startViteStream();
    }

    this.currentTaskId = null;
    this.currentConversationId = null;
    this.conversationTurns = null;
    this.desktopConversations = [];
    this.tasks = [];
    this.timeline = [];
    this.changes = [];
    this.approvals = [];

    // In Vite mode, do a health check to verify the proxy works. In Tauri
    // mode, health is checked after the sidecar starts.
    if (this.mode !== 'tauri') {
      await this.refreshHealth();
    }

    // Supplemental data must never hold the application on its splash screen.
    void this.refreshAgents();
    void this.refreshWorkspaceCapabilities();
    void this.refreshDesignData();
    void this.refreshTasks();
    void this.refreshDesktopConversations();
    void this.refreshAuditList();
  }

  async changeWorkspace(workspace: string): Promise<void> {
    const next = workspace.trim();
    if (!next || next === this.workspace) return;
    localStorage.setItem('sacode.workspace', next);
    this.stopStream?.();
    this.stopStream = null;
    this.currentTaskId = null;
    this.currentConversationId = null;
    this.conversationTurns = null;
    this.desktopConversations = [];
    this.tasks = [];
    this.timeline = [];
    this.changes = [];
    this.approvals = [];
    this.workspace = next;
    this.health = null;
    this.emit();

    if (this.mode === 'tauri') {
      await this.startSidecar(next);
      return;
    }

    this.log(`浏览器开发模式无法切换 daemon 工作区：${next}`);
  }

  /**
   * Start the Tauri sidecar without blocking the UI. Updates health and
   * state as the sidecar comes online.
   */
  private async startSidecar(workspace?: string) {
    try {
      this.handle = await this.withTimeout(
        startDaemon(workspace || undefined),
        30000,
      );
      this.bootLog(`sidecar ready port=${this.handle.port}`);
      this.workspace = this.handle.workspace;
      this.health = { status: 'healthy', version: this.handle.version ?? '' };
      // Rebuild client with the real handle so transport has correct metadata.
      this.buildClient(this.handle);
      this.emit();
      this.log(
        `Tauri sidecar ready ${this.handle.base_url} pid=${this.handle.pid} v${this.handle.version ?? '?'}`,
      );

      // SSE is supplemental and must not block health checks or the main UI.
      void (async () => {
        try {
          const off = await listenDaemonEvents((payload) => this.onDaemonEvent(payload));
          this.stopStream = off;
          await startEventBridge();
          this.log('event bridge attached (daemon-event)');
        } catch (e) {
          this.error(`event bridge failed: ${e}`);
        }
      })();

      // Now that the sidecar is up, do a health check and load supplemental data.
      void this.refreshHealth();
      void this.refreshAgents();
      void this.refreshWorkspaceCapabilities();
      void this.refreshDesignData();
      void this.refreshTasks();
      void this.refreshDesktopConversations();
      void this.refreshAuditList();
    } catch (e) {
      this.bootLog(`start_daemon FAILED: ${e}`);
      this.error(`start_daemon failed: ${e}`);
      this.health = { status: 'degraded', version: '' };
      this.emit();
    }
  }

  private startViteStream(taskId?: string) {
    if (!this.client) return;
    this.stopStream?.();
    // Vite proxy: browser talks to same origin; token lives in dev server.
    const base = `${window.location.protocol}//${window.location.host}`;
    this.stopStream = openEventStream({
      baseUrl: base,
      ...(taskId ? { taskId } : {}),
      onEvent: (evt) => {
        this.onDaemonEvent({
          event: evt.event,
          data: evt.data,
          task_id: evt.task_id,
          id: evt.id,
        });
      },
      onError: (err) => {
        this.log(`sse: ${err.message} (auto-reconnect)`);
      },
      onOpen: () => this.log('sse connected'),
    });
  }

  onDaemonEvent(payload: { event: string; data: unknown; task_id?: string; id?: string }) {
    const data = payload.data;
    const rec = (data ?? {}) as Record<string, unknown>;
    const taskId =
      payload.task_id ??
      (typeof rec.task_id === 'string' ? rec.task_id : undefined) ??
      this.currentTaskId ??
      '';

    if (payload.event === 'tool_call' || payload.event === 'tool_started' || rec.type === 'tool') {
      const tool = String(rec.tool ?? rec.tool_name ?? rec.name ?? 'tool');
      const args = (rec.args ?? rec.input ?? {}) as Record<string, unknown>;
      const path = String(args.path ?? args.file ?? args.filename ?? '');
      const line = `${tool}${path ? ` → ${path}` : ''}`;
      this.push({ kind: 'tool', text: line, detail: JSON.stringify(args).slice(0, 500), taskId });
      if (
        path &&
        ['fs.write', 'fs.edit', 'fs.patch', 'fs.apply_patch', 'git.commit'].includes(tool) &&
        taskId === this.currentTaskId
      ) {
        void this.refreshChanges(taskId);
      }
    }

    if (payload.event === 'approval_requested' || rec.type === 'approval_requested') {
      const approvalId = String(rec.approval_id ?? '');
      const toolName = String(rec.tool_name ?? rec.tool ?? 'tool');
      this.push({
        kind: 'approval',
        text: `待审批: ${toolName}`,
        detail: JSON.stringify(rec.args ?? rec).slice(0, 600),
        taskId,
      });
      void this.refreshApprovals(taskId || this.currentTaskId || '');
      if (approvalId) this.emit();
    }

    if (payload.event === 'agent_message' || payload.event === 'message' || rec.type === 'assistant') {
      const text = String(rec.text ?? rec.content ?? rec.message ?? '');
      if (text) this.push({ kind: 'assistant', text, taskId });
    }

    if (
      payload.event === 'task_completed' ||
      payload.event === 'task_failed' ||
      payload.event === 'task_cancelled'
    ) {
      if (taskId) {
        if (taskId === this.currentTaskId) void this.refreshStatus(taskId, true);
        void this.refreshTasks();
        void this.refreshDesktopConversations();
        if (this.currentConversationId && this.conversationTurns?.turns.some((turn) => turn.task_id === taskId)) {
          void this.client?.getDesktopConversation(this.currentConversationId).then((detail) => {
            if (this.currentConversationId === detail.id) { this.conversationTurns = detail; this.emit(); }
          });
        }
        void this.refreshChanges(taskId);
      }
    }

    if (payload.event === 'task_run' || payload.event === 'task_status') {
      const status = String(rec.status ?? '');
      if (status) this.log(`task ${taskId || '?'} → ${status}`);
    }
  }

  async refreshHealth() {
    if (!this.client) return;
    try {
      this.health = await this.withTimeout(this.client.health(), 5000);
    } catch (e) {
      this.error(`health check failed: ${e}`);
    }
    this.emit();
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
      promise.then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e) => { clearTimeout(timer); reject(e); },
      );
    });
  }

  async refreshAgents() {
    if (!this.client) return;
    try {
      const list = await this.client.listAgents();
      this.agents = list.agents.map((a) => ({
        id: a.id,
        display_name: a.display_name || a.id,
        health: a.health,
      }));
      this.defaultBackend = list.default_backend_id || 'sacode';
    } catch (e) {
      this.error(`agents: ${e}`);
    }
    this.emit();
  }

  async accountStatus(): Promise<{ account: AccountStatus; login_state?: string | null }> {
    if (!this.client) throw new Error('daemon 未连接');
    return this.client.accountStatus();
  }

  async accountLogin(): Promise<void> {
    if (!this.client) throw new Error('daemon 未连接');
    await this.client.accountLogin();
  }

  async accountLogout(): Promise<void> {
    if (!this.client) throw new Error('daemon 未连接');
    await this.client.accountLogout();
    await this.refreshWorkspaceCapabilities();
  }

  async accountSyncModels(): Promise<void> {
    if (!this.client) throw new Error('daemon 未连接');
    await this.client.accountSyncModels();
    await this.refreshWorkspaceCapabilities();
  }

  async createLocalProvider(input: { name: string; base_url: string; api_key: string; models: string[]; thinking: boolean; reasoning_effort?: string }): Promise<void> {
    if (!this.client) throw new Error('daemon 未连接');
    await this.client.createLocalProvider(input);
    await this.refreshWorkspaceCapabilities();
  }

  async listLocalProviders() {
    if (!this.client) throw new Error('daemon 未连接');
    return this.client.listLocalProviders();
  }

  async deleteLocalProvider(name: string): Promise<void> {
    if (!this.client) throw new Error('daemon 未连接');
    await this.client.deleteLocalProvider(name);
    await this.refreshWorkspaceCapabilities();
  }

  async registerModelConnection(input: { name: string; base_url: string; upstream_api_key: string; models: { client_model: string; upstream_model: string }[] }): Promise<void> {
    if (!this.client) throw new Error('daemon 未连接');
    await this.client.registerModelConnection(input);
    await this.accountSyncModels();
  }

  async refreshWorkspaceCapabilities() {
    if (!this.client) return;
    try {
      this.workspaceCapabilities = await this.client.getWorkspaceCapabilities();
    } catch (e) {
      this.workspaceCapabilities = { workspace: this.workspace, models: [], skills: [], files: [] };
      this.error(`workspace capabilities: ${e}`);
    }
    this.emit();
  }

  async refreshDesignData() {
    if (!this.client || this.designLoading) return;
    this.designLoading = true;
    this.designError = null;
    this.emit();
    try {
      const [context, resources] = await Promise.all([
        this.client.getDesignContext(),
        this.client.listDesignResources(),
      ]);
      this.designContext = context;
      this.designResources = resources;
      await this.refreshExtractions();
      await this.refreshSessions();
    } catch (e) {
      this.designError = String(e);
      this.error(`design: ${e}`);
    } finally {
      this.designLoading = false;
      this.emit();
    }
  }

  async refreshKnowledge(scope: 'user' | 'project'): Promise<KnowledgeNote[]> {
    if (!this.client) throw new Error('daemon 未连接');
    return this.client.knowledgeEntries(scope);
  }
  async searchKnowledge(q: string, scope: 'user' | 'project'): Promise<KnowledgeHit[]> {
    if (!this.client) throw new Error('daemon 未连接');
    return this.client.searchKnowledge(q, scope);
  }
  async getKnowledgeNote(id: string, scope: 'user' | 'project'): Promise<KnowledgeNote> {
    if (!this.client) throw new Error('daemon 未连接');
    return this.client.getKnowledgeNote(id, scope);
  }
  async saveKnowledgeNote(input: { scope: 'user' | 'project'; title: string; content: string; id?: string; updated_at?: string | null }): Promise<KnowledgeNote> {
    if (!this.client) throw new Error('daemon 未连接');
    return input.id ? this.client.updateKnowledgeNote(input.id, input) : this.client.createKnowledgeNote(input);
  }
  async deleteKnowledgeNote(id: string, scope: 'user' | 'project'): Promise<void> {
    if (!this.client) throw new Error('daemon 未连接');
    await this.client.deleteKnowledgeNote(id, scope);
  }
  async refreshAutomation(): Promise<{ rules: AutomationRule[]; history: AutomationRun[] }> {
    if (!this.client) throw new Error('daemon 未连接');
    const [rules, history] = await Promise.all([this.client.listAutomationRules(), this.client.listAutomationHistory()]);
    return { rules, history };
  }
  async saveAutomationRule(input: AutomationRuleInput, id?: string): Promise<AutomationRule> {
    if (!this.client) throw new Error('daemon 未连接');
    return id ? this.client.updateAutomationRule(id, input) : this.client.createAutomationRule(input);
  }
  async deleteAutomationRule(id: string): Promise<void> {
    if (!this.client) throw new Error('daemon 未连接');
    await this.client.deleteAutomationRule(id);
  }
  async toggleAutomationRule(id: string): Promise<AutomationRule> {
    if (!this.client) throw new Error('daemon 未连接');
    return this.client.toggleAutomationRule(id);
  }
  async runAutomationRule(id: string): Promise<AutomationRun> {
    if (!this.client) throw new Error('daemon 未连接');
    return this.client.runAutomationRule(id);
  }

  async refreshGitAuth(): Promise<GitAuthStatus> {
    if (!this.client) throw new Error('daemon 未连接');
    return this.client.gitAuthStatus();
  }
  async startGithubDeviceFlow(clientId?: string): Promise<GithubDeviceFlow> {
    if (!this.client) throw new Error('daemon 未连接');
    return this.client.startGithubDeviceFlow(clientId);
  }
  async pollGithubDeviceFlow(deviceCode: string, timeoutSeconds?: number, clientId?: string): Promise<{ status: string; login?: string }> {
    if (!this.client) throw new Error('daemon 未连接');
    return this.client.pollGithubDeviceFlow(deviceCode, timeoutSeconds, clientId);
  }
  async authorizeGitee(redirectUri?: string): Promise<GiteeAuthorizeFlow> {
    if (!this.client) throw new Error('daemon 未连接');
    return this.client.authorizeGitee(redirectUri);
  }
  async completeGiteeAuth(code: string, redirectUri?: string): Promise<void> {
    if (!this.client) throw new Error('daemon 未连接');
    await this.client.completeGiteeAuth(code, redirectUri);
  }
  async gitAuthLogout(host: 'github' | 'gitee'): Promise<void> {
    if (!this.client) throw new Error('daemon 未连接');
    await this.client.gitAuthLogout(host);
  }

  async listHooks(): Promise<HookListView> {
    if (!this.client) throw new Error('daemon 未连接');
    return this.client.listHooks();
  }

  async listImportTools(): Promise<DetectedTool[]> {
    if (!this.client) throw new Error('daemon 未连接');
    return this.client.listImportTools();
  }
  async listImportProviders(toolId: string): Promise<ImportedProvider[]> {
    if (!this.client) throw new Error('daemon 未连接');
    return this.client.listImportProviders(toolId);
  }
  async applyImport(toolId: string, providerNames: string[], apiKeys?: Record<string, string>): Promise<void> {
    if (!this.client) throw new Error('daemon 未连接');
    await this.client.applyImport(toolId, providerNames, apiKeys);
  }

  async refreshTasks() {
    if (!this.client) return;
    try {
      const response = await this.client.listTasks();
      this.tasks = response.tasks;
    } catch (e) {
      this.error(`tasks: ${e}`);
    }
    this.emit();
  }

  async refreshDesktopConversations() {
    if (!this.client) return;
    try {
      this.desktopConversations = await this.client.listDesktopConversations();
      this.emit();
    } catch (e) { this.error(`conversations: ${e}`); }
  }

  async selectDesktopConversation(id: string) {
    if (!this.client) return;
    const detail = await this.client.getDesktopConversation(id);
    this.conversationTurns = detail;
    this.currentConversationId = id;
    const latest = detail.turns.at(-1);
    this.currentTaskId = latest?.task_id || null;
    if (latest) await this.selectTask(latest.task_id);
    if (this.mode === 'vite' && latest && typeof window !== 'undefined') this.startViteStream(latest.task_id);
    this.emit();
  }

  async deleteDesktopConversation(id: string) {
    if (!this.client) return;
    const taskIds = this.conversationTurns?.id === id ? this.conversationTurns.turns.map((t) => t.task_id) : [];
    await this.client.deleteDesktopConversation(id);
    this.desktopConversations = this.desktopConversations.filter((item) => item.id !== id);
    this.tasks = this.tasks.filter((item) => !taskIds.includes(item.task_id));
    this.timeline = this.timeline.filter((item) => !item.taskId || !taskIds.includes(item.taskId));
    if (this.currentConversationId === id) {
      this.currentConversationId = null;
      this.currentTaskId = null;
      this.conversationTurns = null;
    }
    this.emit();
  }

  /** 删除独立任务（不用于 Desktop 会话删除）。 */
  async deleteTask(taskId: string) {
    if (!this.client) return;
    await this.client.deleteTask(taskId);
    this.tasks = this.tasks.filter((item) => item.task_id !== taskId);
    if (this.currentTaskId === taskId) this.currentTaskId = null;
    this.timeline = this.timeline.filter((item) => item.taskId !== taskId);
    this.emit();
  }

  async selectTask(taskId: string) {
    if (!this.client || !taskId) return;
    const task = this.tasks.find((item) => item.task_id === taskId);
    this.currentTaskId = taskId;
    if (!this.conversationTurns?.turns.some((turn) => turn.task_id === taskId)) {
      this.currentConversationId = null;
      this.conversationTurns = null;
    }
    if (task && !this.timeline.some((item) => item.taskId === taskId && item.kind === 'user')) {
      this.push({ kind: 'user', text: task.prompt, taskId });
    }
    await this.refreshStatus(taskId, true);
    await this.refreshApprovals(taskId);
    await this.refreshChanges(taskId);
    const status = this.timelineStatus || task?.status || '';
    if (status === 'running' || status === 'pending' || status === 'ready' || status === 'retrying') {
      this.startPoll(taskId);
    }
    this.emit();
  }

  async refreshChanges(taskId: string) {
    if (!this.client || !taskId) return;
    try {
      const response = await this.client.getTaskChanges(taskId);
      if (taskId === this.currentTaskId) {
        this.changes = response.changes;
      }
    } catch (e) {
      this.error(`changes: ${e}`);
    }
    this.emit();
  }

  async runAudit(scanTier: AuditScanTier = 'static') {
    if (!this.client || this.auditRunning) return;
    this.auditRunning = true;
    this.auditTier = scanTier;
    this.emit();
    try {
      const response: AuditResponse = await this.client.runAuditScan({ scanTier, useAi: scanTier !== 'static' });
      this.currentAuditId = response.audit_id;
      this.auditFindings = response.findings;
      await this.refreshAuditList();
      this.log(`audit completed (${scanTier}): ${response.audit_id} findings=${response.findings.length}`);
    } catch (e) {
      this.error(`audit: ${e}`);
    }
    this.auditRunning = false;
    this.emit();
  }

  async refreshAuditList() {
    if (!this.client) return;
    try {
      const response = await this.client.listAudits();
      this.auditReports = response.reports;
    } catch (e) {
      this.error(`audit list: ${e}`);
    }
    this.emit();
  }

  async selectAudit(auditId: string) {
    if (!this.client) return;
    this.currentAuditId = auditId;
    try {
      const response = await this.client.getAuditReport(auditId);
      this.auditFindings = response.findings;
      this.log(`audit report loaded: ${auditId} findings=${response.findings.length}`);
    } catch (e) {
      this.error(`audit report: ${e}`);
    }
    this.emit();
  }

  async runTask(opts: {
    prompt: string;
    mode: ExecutionModeInput;
    backendId: string;
    modelProvider?: string;
    modelName?: string;
    skill?: string;
    contextPaths?: string[];
    conversationId?: string | null;
  }) {
    if (!this.client) {
      this.lastTaskCreateError = 'daemon client not ready';
      this.error(this.lastTaskCreateError);
      return false;
    }
    this.lastTaskCreateError = null;
    try {
      const created = await this.client.sendDesktopMessage({
        prompt: opts.prompt,
        mode: opts.mode,
        backendId: opts.backendId,
        conversationId: opts.conversationId || undefined,
        modelProvider: opts.modelProvider,
        modelName: opts.modelName,
        skill: opts.skill,
        contextPaths: opts.contextPaths,
      });
      if (created.status === 'error') throw new Error(created.message || '任务创建失败');
      this.currentTaskId = created.task_id;
      this.currentConversationId = created.conversation_id;
      this.changes = [];
      this.push({ kind: 'user', text: opts.prompt, taskId: created.task_id });
      this.log(`task created ${created.task_id} status=${created.status}`);
      try {
        await this.refreshTasks();
        await this.refreshDesktopConversations();
        this.conversationTurns = await this.client.getDesktopConversation(created.conversation_id);
      } catch (e) {
        this.error(`conversation refresh: ${e}`);
      }
      if (this.mode === 'tauri') {
        try {
          await startEventBridge(created.task_id);
        } catch {
          /* already bridged globally */
        }
      } else {
        this.startViteStream(created.task_id);
      }
      this.startPoll(created.task_id);
      this.emit();
      return true;
    } catch (e) {
      this.lastTaskCreateError = String(e);
      this.error(`createTask: ${e}`);
      return false;
    }
  }

  async refreshExtractions() {
    if (!this.client) return;
    try {
      this.extractions = await this.client.listExtractions();
      // Auto-poll active extraction jobs
      const active = this.extractions.filter(
        (job) =>
          job.status === 'queued' ||
          job.status === 'scanning' ||
          job.status === 'analyzing' ||
          job.status === 'packaging',
      );
      if (active.length > 0) {
        const ids = active.map((job) => job.id);
        for (const id of ids) {
          if (!this.extractionRunning[id]) {
            this.extractionRunning[id] = true;
            void this.pollExtraction(id);
          }
        }
      }
      this.emit();
    } catch {
      // Extractions list is best-effort; don't overwrite designError
    }
  }

  private async pollExtraction(jobId: string) {
    if (!this.client) return;
    for (let i = 0; i < 60; i++) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      try {
        const job = await this.client.getExtraction(jobId);
        const idx = this.extractions.findIndex((e) => e.id === jobId);
        if (idx >= 0) {
          this.extractions[idx] = job;
        } else {
          this.extractions.unshift(job);
        }
        this.emit();
        if (
          job.status === 'succeeded' ||
          job.status === 'failed' ||
          job.status === 'cancelled' ||
          job.status === 'expired'
        ) {
          break;
        }
      } catch {
        break;
      }
    }
    this.extractionRunning[jobId] = false;
  }

  async createExtraction(
    sourceType: string,
    sourceRef: string,
    confirmed: boolean,
    imageFilename?: string,
    imageContentType?: string,
    imageSize?: number,
  ): Promise<ExtractionJob | null> {
    if (!this.client) {
      this.error('daemon client not ready');
      return null;
    }
    try {
      const req: CreateExtractionRequest = {
        source_type: sourceType,
        source_ref: sourceRef,
        confirmed,
        image_filename: imageFilename,
        image_content_type: imageContentType,
        image_size: imageSize,
      };
      const job = await this.client.createExtraction(req);
      this.extractions.unshift(job);
      this.extractionRunning[job.id] = true;
      void this.pollExtraction(job.id);
      this.emit();
      return job;
    } catch (e) {
      this.error(`createExtraction: ${e}`);
      return null;
    }
  }

  async cancelExtraction(jobId: string) {
    if (!this.client) return;
    try {
      await this.client.cancelExtraction(jobId);
      const idx = this.extractions.findIndex((e) => e.id === jobId);
      if (idx >= 0) {
        this.extractions[idx] = {
          ...this.extractions[idx],
          status: 'cancelled',
        };
      }
      this.extractionRunning[jobId] = false;
      this.emit();
    } catch (e) {
      this.error(`cancelExtraction: ${e}`);
    }
  }

  // ── Design Sessions ──

  async refreshSessions() {
    if (!this.client) return;
    try {
      this.sessions = await this.client.listSessions();
      if (this.currentSession) {
        const updated = this.sessions.find((s) => s.id === this.currentSession?.id);
        if (updated) this.currentSession = updated;
      }
      this.emit();
    } catch {
      // best-effort
    }
  }

  async createSession(
    goal: string,
    request: string,
    backendId?: string,
    targetSurface?: TargetSurface,
  ): Promise<DesignSession | null> {
    if (!this.client) {
      this.error('daemon client not ready');
      return null;
    }
    try {
      this.sessionLoading = true;
      this.emit();
      const req: CreateSessionRequest = {
        workspace: this.workspace || undefined,
        goal,
        request,
        backend_id: backendId,
        target_surface: targetSurface,
      };
      const session = await this.client.createSession(req);
      this.currentSession = session;
      this.sessions.unshift(session);
      this.sessionLoading = false;
      this.emit();
      return session;
    } catch (e) {
      this.error(`createSession: ${e}`);
      this.sessionLoading = false;
      this.emit();
      return null;
    }
  }

  async updateSession(id: string, req: UpdateSessionRequest) {
    if (!this.client) return;
    try {
      const updated = await this.client.updateSession(id, req);
      this.currentSession = updated;
      const idx = this.sessions.findIndex((s) => s.id === id);
      if (idx >= 0) this.sessions[idx] = updated;
      this.emit();
    } catch (e) {
      this.error(`updateSession: ${e}`);
    }
  }

  async updateUiDocument(id: string, document: UiDocument): Promise<UiDocument | null> {
    if (!this.client) return null;
    try {
      const updated = await this.client.updateUiDocument(id, { document, expected_version: document.version });
      if (this.currentSession?.id === id) {
        this.currentSession = {
          ...this.currentSession,
          ui_document: updated,
          ui_check_report: null,
          implementation_profile: null,
          plan: null,
          status: 'ui_editing',
        };
      }
      this.emit();
      return updated;
    } catch (e) {
      this.error(`updateUiDocument: ${e}`);
      return null;
    }
  }

  async proposeUiPatch(id: string, instruction: string, expectedVersion: number): Promise<UiPatchProposal | null> {
    if (!this.client) return null;
    try {
      return await this.client.proposeUiPatch(id, { instruction, expected_version: expectedVersion });
    } catch (e) {
      this.error(`proposeUiPatch: ${e}`);
      return null;
    }
  }

  async applyUiPatch(id: string, patch: UiDocumentPatch): Promise<UiDocument | null> {
    if (!this.client) return null;
    try {
      const document = await this.client.applyUiPatch(id, { patch });
      if (this.currentSession?.id === id) {
        this.currentSession = { ...this.currentSession, ui_document: document, ui_check_report: null };
      }
      this.emit();
      return document;
    } catch (e) {
      this.error(`applyUiPatch: ${e}`);
      return null;
    }
  }

  async checkUiDocument(id: string): Promise<UiCheckReport | null> {
    if (!this.client) return null;
    try {
      const report = await this.client.checkUiDocument(id);
      if (this.currentSession?.id === id) {
        this.currentSession = { ...this.currentSession, ui_check_report: report };
      }
      this.emit();
      return report;
    } catch (e) {
      this.error(`checkUiDocument: ${e}`);
      return null;
    }
  }

  async confirmUiDocument(id: string, expectedVersion: number): Promise<DesignSession | null> {
    if (!this.client) return null;
    try {
      const session = await this.client.confirmUiDocument(id, {
        expected_version: expectedVersion,
        summary: '用户确认 UI 版本',
      });
      this.replaceSession(session);
      return session;
    } catch (e) {
      this.error(`confirmUiDocument: ${e}`);
      return null;
    }
  }

  async updateImplementationProfile(id: string, profile: ImplementationProfile): Promise<DesignSession | null> {
    if (!this.client) return null;
    try {
      const session = await this.client.updateImplementationProfile(id, { profile });
      this.replaceSession(session);
      return session;
    } catch (e) {
      this.error(`updateImplementationProfile: ${e}`);
      return null;
    }
  }

  private replaceSession(session: DesignSession) {
    this.currentSession = session;
    const idx = this.sessions.findIndex((item) => item.id === session.id);
    if (idx >= 0) this.sessions[idx] = session;
    else this.sessions.unshift(session);
    this.emit();
  }

  async planSession(id: string): Promise<DesignSession | null> {
    if (!this.client) {
      this.error('daemon client not ready');
      return null;
    }
    try {
      this.sessionLoading = true;
      this.emit();
      const session = await this.client.planSession(id);
      this.currentSession = session;
      const idx = this.sessions.findIndex((s) => s.id === id);
      if (idx >= 0) this.sessions[idx] = session;
      this.sessionLoading = false;
      this.emit();
      return session;
    } catch (e) {
      this.error(`planSession: ${e}`);
      this.sessionLoading = false;
      this.emit();
      return null;
    }
  }

  async generateSession(id: string): Promise<DesignSession | null> {
    if (!this.client) {
      this.error('daemon client not ready');
      return null;
    }
    try {
      const session = await this.client.generateSession(id);
      this.currentSession = session;
      const idx = this.sessions.findIndex((s) => s.id === id);
      if (idx >= 0) this.sessions[idx] = session;
      if (session.task_id) {
        this.currentTaskId = session.task_id;
        this.timeline = [];
        this.changes = [];
        this.push({ kind: 'user', text: session.prompt_snapshot || session.request, taskId: session.task_id });
        this.log(`design session ${id} → task ${session.task_id}`);
        if (this.mode === 'tauri') {
          try { await startEventBridge(session.task_id); } catch { /* bridged globally */ }
        } else {
          this.startViteStream(session.task_id);
        }
        this.startPoll(session.task_id);
      }
      this.emit();
      return session;
    } catch (e) {
      this.error(`generateSession: ${e}`);
      return null;
    }
  }

  async downloadDesignSystem(id: string): Promise<boolean> {
    if (!this.client) {
      this.error('daemon client not ready');
      return false;
    }
    try {
      const { format, body } = await this.client.downloadDesignSystem(id);
      const blob = new Blob([body], {
        type: format === 'zip' ? 'application/zip' : 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = format === 'zip' ? `${id}.zip` : `${id}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      this.log(`downloaded design system ${id} (${format})`);
      return true;
    } catch (e) {
      this.error(`downloadDesignSystem: ${e}`);
      return false;
    }
  }

  async importDesignSystem(id: string): Promise<boolean> {
    if (!this.client) {
      this.error('daemon client not ready');
      return false;
    }
    try {
      const result = await this.client.importDesignSystem(id);
      this.log(`design system imported: ${result.project_path}`);
      return result.imported;
    } catch (e) {
      this.error(`importDesignSystem: ${e}`);
      return false;
    }
  }

  async generateImages(
    prompt: string,
    size = '1024x1024',
    n = 1,
  ): Promise<ImageGenerationResult | null> {
    if (!this.client) {
      this.error('daemon client not ready');
      return null;
    }
    try {
      this.imageLoading = true;
      this.emit();
      const req: ImageGenerationRequest = {
        prompt,
        size,
        n,
        output_format: 'png',
        watermark: false,
      };
      const result = await this.client.generateImages(req);
      this.imageResults.unshift(result);
      this.log(`generated ${result.images.length} image(s) via ${result.provider}/${result.model}`);
      this.imageLoading = false;
      this.emit();
      return result;
    } catch (e) {
      this.error(`generateImages: ${e}`);
      this.imageLoading = false;
      this.emit();
      return null;
    }
  }

  startPoll(taskId: string) {
    this.pollTimer && clearInterval(this.pollTimer);
    let ticks = 0;
    this.pollTimer = setInterval(() => {
      void (async () => {
        ticks += 1;
        try {
          await this.refreshStatus(taskId, false);
          await this.refreshApprovals(taskId);
          if (this.currentTaskId !== taskId) {
            if (this.pollTimer) clearInterval(this.pollTimer);
            this.pollTimer = null;
            return;
          }
          const st = this.timelineStatus;
          if (st === 'completed' || st === 'failed' || st === 'cancelled' || st === 'error') {
            await this.refreshStatus(taskId, true);
            await this.refreshChanges(taskId);
            if (this.currentConversationId && this.conversationTurns?.turns.some((turn) => turn.task_id === taskId)) {
              this.conversationTurns = await this.client?.getDesktopConversation(this.currentConversationId) ?? null;
            }
            await this.refreshDesktopConversations();
            this.emit();
            if (this.pollTimer) clearInterval(this.pollTimer);
            this.pollTimer = null;
          }
        } catch (e) {
          this.error(`poll: ${e}`);
          if (this.pollTimer) clearInterval(this.pollTimer);
          this.pollTimer = null;
        }
        if (ticks > 180 && this.pollTimer) {
          clearInterval(this.pollTimer);
          this.pollTimer = null;
        }
      })();
    }, 1500);
  }

  timelineStatus = '';

  async refreshStatus(taskId: string, fetchResult: boolean) {
    if (!this.client || !taskId) return;
    const st = await this.client.getTaskStatus(taskId);
    if (taskId === this.currentTaskId) this.timelineStatus = st.status;
    if (
      st.output &&
      !this.timeline.some((item) => item.taskId === taskId && item.kind === 'assistant' && item.text === st.output)
    ) {
      this.push({ kind: 'assistant', text: st.output, taskId });
    }
    if (
      st.error &&
      !this.timeline.some((item) => item.taskId === taskId && item.kind === 'error' && item.text === st.error)
    ) {
      this.push({ kind: 'error', text: st.error, taskId });
    }
    if (fetchResult && (st.status === 'completed' || st.status === 'failed')) {
      try {
        const result = await this.client.getTaskResult(taskId);
        const text = result.response?.trim();
        if (text && !this.timeline.some((item) => item.taskId === taskId && item.kind === 'assistant' && item.text === text)) {
          this.push({ kind: 'assistant', text, taskId });
        }
        if (result.learned_facts.length) {
          this.log(`learned: ${result.learned_facts.join(' | ')}`);
        }
      } catch {
        /* status already has output */
      }
    }
    if (st.task) {
      this.applySnapshot(st.task);
    }
    this.emit();
  }

  applySnapshot(snap: TaskSnapshot) {
    // future: richer timeline from snapshot
    void snap;
  }

  async refreshApprovals(taskId: string) {
    if (!this.client || !taskId) return;
    try {
      const approvals = await this.client.listApprovals(taskId);
      if (taskId === this.currentTaskId) { this.approvals = approvals; this.emit(); }
    } catch {
      /* approvals endpoint optional while idle */
    }
  }

  async resolveApproval(approvalId: string, approved: boolean, reason?: string) {
    if (!this.client || !this.currentTaskId) return;
    await this.client.resolveApproval(
      this.currentTaskId,
      approvalId,
      approved,
      reason,
    );
    this.log(`approval ${approvalId} → ${approved ? 'allow' : 'deny'}`);
    await this.refreshApprovals(this.currentTaskId);
  }

  async stopTask() {
    if (!this.client || !this.currentTaskId) return;
    try {
      await this.client.cancelTask(this.currentTaskId);
      this.log(`cancel sent for ${this.currentTaskId}`);
    } catch (e) {
      this.error(`cancel: ${e}`);
    }
  }

  async stopSidecar() {
    if (this.mode !== 'tauri') {
      this.log('Vite mode: stop daemon via terminal (sacode serve)');
      return;
    }
    try {
      await stopDaemon();
      this.handle = null;
      this.log('sidecar stopped');
    } catch (e) {
      this.error(`stop_daemon: ${e}`);
    }
    this.emit();
  }

  healthLabel(): string {
    if (!this.health) {
      if (this.mode === 'tauri' && !this.handle) return 'starting…';
      return 'offline';
    }
    if (this.health.status === 'degraded') return 'degraded';
    const err = daemonHealthError(this.health);
    if (err) return err;
    return `healthy · v${this.health.version}`;
  }

  exportDiagnostics(): string {
    return JSON.stringify(
      {
        mode: this.mode,
        handle: this.handle
          ? {
              host: this.handle.host,
              port: this.handle.port,
              base_url: this.handle.base_url,
              pid: this.handle.pid,
              version: this.handle.version,
              auth_required: this.handle.auth_required,
            }
          : null,
        health: this.health,
        workspace: this.workspace,
        currentTaskId: this.currentTaskId,
        tasks: this.tasks,
        agents: this.agents,
        approvals: this.approvals,
        changes: this.changes.slice(-50),
        auditFindings: this.auditFindings,
        auditReports: this.auditReports,
        currentAuditId: this.currentAuditId,
        auditRunning: this.auditRunning,
        designContext: this.designContext,
        designResourceCounts: this.designResources
          ? {
              templates: this.designResources.templates.length,
              visual_styles: this.designResources.visual_styles.length,
              design_systems: this.designResources.design_systems.length,
              baselines: this.designResources.baselines.length,
            }
          : null,
        designError: this.designError,
        timeline_tail: this.timeline.slice(-30),
      },
      null,
      2,
    );
  }
}

export { isTauri, daemonInfo, parseSseFrame };
