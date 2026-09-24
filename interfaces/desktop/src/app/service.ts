/** Daemon session service for Desktop (Tauri IPC or Vite same-origin proxy). */
import {
  DaemonClient,
  daemonHealthError,
  openEventStream,
  parseSseFrame,
  type AuditFinding,
  type AuditReportSummary,
  type AuditResponse,
  type CreateExtractionRequest,
  type CreateSessionRequest,
  type DaemonHealth,
  type DesignProjectContext,
  type DesignResourceCatalog,
  type DesignSession,
  type ExecutionModeInput,
  type ExtractionJob,
  type ImageGenerationRequest,
  type ImageGenerationResult,
  type PendingApproval,
  type TaskFileChange,
  type TaskListItem,
  type TaskSnapshot,
  type UpdateSessionRequest,
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
  handle: SidecarHandleDto | null = null;
  client: DaemonClient | null = null;
  currentTaskId: string | null = null;
  tasks: TaskListItem[] = [];
  timeline: TimelineItem[] = [];
  changes: ChangeItem[] = [];
  approvals: PendingApproval[] = [];
  agents: { id: string; display_name: string; health?: string }[] = [];
  defaultBackend = 'sacode';
  health: DaemonHealth | null = null;
  auditFindings: AuditFinding[] = [];
  auditReports: AuditReportSummary[] = [];
  currentAuditId: string | null = null;
  auditRunning = false;
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
    if (this.mode === 'tauri') {
      try {
        this.handle = await startDaemon(workspace || undefined);
        this.workspace = this.handle.workspace;
        this.buildClient(this.handle);
        this.log(
          `Tauri sidecar ready ${this.handle.base_url} pid=${this.handle.pid} v${this.handle.version ?? '?'}`,
        );
        try {
          await startEventBridge();
          const off = await listenDaemonEvents((payload) => this.onDaemonEvent(payload));
          this.stopStream = off;
          this.log('event bridge attached (daemon-event)');
        } catch (e) {
          this.error(`event bridge failed: ${e}`);
        }
      } catch (e) {
        this.error(`start_daemon failed: ${e}`);
        this.buildClient(null);
      }
    } else {
      this.buildClient(null);
      this.log('Vite mode: using same-origin proxy (token not in WebView)');
      this.startViteStream();
    }
    this.currentTaskId = null;
    this.tasks = [];
    this.timeline = [];
    this.changes = [];
    this.approvals = [];
    await this.refreshHealth();
    await this.refreshAgents();
    await this.refreshDesignData();
    await this.refreshTasks();
    await this.refreshAuditList();
    if (this.tasks[0]) {
      await this.selectTask(this.tasks[0].task_id);
    }
    this.emit();
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
        void this.refreshStatus(taskId, true);
        void this.refreshTasks();
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
    this.health = await this.client.health();
    this.emit();
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

  async selectTask(taskId: string) {
    if (!this.client || !taskId) return;
    const task = this.tasks.find((item) => item.task_id === taskId);
    this.currentTaskId = taskId;
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

  async runAudit() {
    if (!this.client || this.auditRunning) return;
    this.auditRunning = true;
    this.emit();
    try {
      const response: AuditResponse = await this.client.runAudit({ use_ai: false });
      this.currentAuditId = response.audit_id;
      this.auditFindings = response.findings;
      await this.refreshAuditList();
      this.log(`audit completed: ${response.audit_id} findings=${response.findings.length}`);
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
  }) {
    if (!this.client) {
      this.error('daemon client not ready');
      return false;
    }
    try {
      const created = await this.client.createTask({
        prompt: opts.prompt,
        mode: opts.mode,
        backendId: opts.backendId,
        workspaceRoot: this.workspace || '.',
        source: 'desktop',
      });
      this.currentTaskId = created.task_id;
      this.changes = [];
      this.push({ kind: 'user', text: opts.prompt, taskId: created.task_id });
      this.log(`task created ${created.task_id} status=${created.status}`);
      await this.refreshTasks();
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
          const st = this.timelineStatus;
          if (st === 'completed' || st === 'failed' || st === 'cancelled' || st === 'error') {
            await this.refreshStatus(taskId, true);
            await this.refreshChanges(taskId);
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
    this.timelineStatus = st.status;
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
        const text = result.response || '(empty response)';
        if (!this.timeline.some((item) => item.taskId === taskId && item.kind === 'assistant' && item.text === text)) {
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
      this.approvals = await this.client.listApprovals(taskId);
      this.emit();
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
    if (!this.health) return 'offline';
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
