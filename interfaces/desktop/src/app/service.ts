/** Daemon session service for Desktop (Tauri IPC or Vite same-origin proxy). */
import {
  DaemonClient,
  daemonHealthError,
  openEventStream,
  parseSseFrame,
  type DaemonHealth,
  type ExecutionModeInput,
  type PendingApproval,
  type TaskSnapshot,
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

export interface ChangeItem {
  tool: string;
  path: string;
  detail: string;
}

export class DesktopApp {
  mode: RuntimeMode = isTauri() ? 'tauri' : 'vite';
  handle: SidecarHandleDto | null = null;
  client: DaemonClient | null = null;
  currentTaskId: string | null = null;
  timeline: TimelineItem[] = [];
  changes: ChangeItem[] = [];
  approvals: PendingApproval[] = [];
  agents: { id: string; display_name: string; health?: string }[] = [];
  defaultBackend = 'sacode';
  health: DaemonHealth | null = null;
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
    if (this.mode === 'tauri') {
      try {
        this.handle = await startDaemon(workspace || undefined);
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
    await this.refreshHealth();
    await this.refreshAgents();
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
        ['fs.write', 'fs.edit', 'fs.patch', 'fs.apply_patch', 'git.commit'].includes(tool)
      ) {
        this.changes.push({
          tool,
          path,
          detail: JSON.stringify(args).slice(0, 800),
        });
        this.emit();
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

    if (payload.event === 'task_completed' || payload.event === 'task_failed') {
      if (taskId) void this.refreshStatus(taskId, true);
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

  async runTask(opts: {
    prompt: string;
    mode: ExecutionModeInput;
    backendId: string;
  }) {
    if (!this.client) {
      this.error('daemon client not ready');
      return;
    }
    this.push({ kind: 'user', text: opts.prompt });
    try {
      const created = await this.client.createTask({
        prompt: opts.prompt,
        mode: opts.mode,
        backendId: opts.backendId,
        workspaceRoot: this.workspace || '.',
        source: 'desktop',
      });
      this.currentTaskId = created.task_id;
      this.log(`task created ${created.task_id} status=${created.status}`);
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
    } catch (e) {
      this.error(`createTask: ${e}`);
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
          if (st === 'completed' || st === 'failed' || st === 'error') {
            await this.refreshStatus(taskId, true);
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
    if (st.output) {
      this.push({ kind: 'assistant', text: st.output, taskId });
    }
    if (st.error) {
      this.error(st.error);
    }
    if (fetchResult && (st.status === 'completed' || st.status === 'failed')) {
      try {
        const result = await this.client.getTaskResult(taskId);
        this.push({
          kind: 'assistant',
          text: result.response || '(empty response)',
          taskId,
        });
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
        agents: this.agents,
        approvals: this.approvals,
        changes: this.changes.slice(-50),
        timeline_tail: this.timeline.slice(-30),
      },
      null,
      2,
    );
  }
}

export { isTauri, daemonInfo, parseSseFrame };
