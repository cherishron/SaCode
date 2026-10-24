import { defineStore } from 'pinia';
import { markRaw } from 'vue';
import { api } from '../api/client';
import type { EventFrameView, SessionDetail, SessionSummary, TargetInfo } from '@shared/types';

export const useSessionsStore = defineStore('sessions', {
  state: () => ({
    targets: [] as TargetInfo[],
    selectedTargetId: null as string | null,
    sessions: [] as SessionSummary[],
    workspaceId: null as string | null,
    selectedSessionId: null as string | null,
    detail: null as SessionDetail | null,
    events: [] as EventFrameView[],
    cursor: null as string | null,
    generation: 0,
    error: null as string | null,
    /** SSE 连接状态：idle / connecting / open / closed */
    streamStatus: 'idle' as 'idle' | 'connecting' | 'open' | 'closed',
    /** 是否正在补读（断线或代际变化后） */
    refilling: false,
    loadingMore: false,
    /** 首次加载历史事件（用于显示骨架屏） */
    loadingEvents: false,
    /** 游标是否还能取到更多历史 */
    hasMore: false,
    es: null as EventSource | null,
    selectionRevision: 0,
  }),
  actions: {
    async loadTargets(): Promise<void> {
      try {
        const r = await api.targets();
        this.targets = r.targets;
        this.error = null;
      } catch (e) {
        this.error = (e as Error).message;
      }
    },

    returnHome(): void {
      this.selectionRevision += 1;
      this.disconnectStream();
      this.selectedSessionId = null;
      this.detail = null;
      this.events = [];
      this.cursor = null;
      this.hasMore = false;
      this.loadingEvents = false;
      this.loadingMore = false;
      this.error = null;
    },

    async selectTarget(targetId: string): Promise<void> {
      this.returnHome();
      const revision = this.selectionRevision;
      this.selectedTargetId = targetId;
      this.sessions = [];
      this.workspaceId = null;
      try {
        const r = await api.sessions(targetId);
        if (revision !== this.selectionRevision) return;
        this.sessions = r.sessions;
        this.workspaceId = r.workspaceId;
        this.error = null;
      } catch (e) {
        if (revision !== this.selectionRevision) return;
        this.error = (e as Error).message;
      }
    },

    async selectSession(sessionId: string): Promise<void> {
      if (!this.selectedTargetId) return;
      const targetId = this.selectedTargetId;
      this.returnHome();
      const revision = this.selectionRevision;
      this.selectedSessionId = sessionId;
      try {
        const d = await api.sessionDetail(targetId, sessionId);
        if (revision !== this.selectionRevision) return;
        this.detail = d.session;
        this.error = null;
      } catch (e) {
        if (revision !== this.selectionRevision) return;
        this.error = (e as Error).message;
        return;
      }
      await this.loadEvents();
      if (revision === this.selectionRevision) this.connectStream();
    },

    /**
     * 拉取历史。initial=true 时整体替换（切换会话）；
     * 否则按游标增量追加（翻页 / 补读），去重且不覆盖已收到的实时事件。
     */
    async loadEvents(initial = true): Promise<void> {
      if (!this.selectedTargetId || !this.selectedSessionId) return;
      const revision = this.selectionRevision;
      if (initial) this.loadingEvents = true;
      try {
        const page = await api.events(this.selectedTargetId, this.selectedSessionId, this.cursor);
        if (revision !== this.selectionRevision) return;
        if (initial) {
          this.events = page.frames;
        } else {
          this.mergeEvents(page.frames);
        }
        this.cursor = page.nextCursor;
        this.generation = page.generation;
        this.hasMore = page.nextCursor !== null && page.frames.length > 0;
        this.error = null;
      } catch (e) {
        if (revision !== this.selectionRevision) return;
        this.error = (e as Error).message;
      } finally {
        if (initial && revision === this.selectionRevision) this.loadingEvents = false;
      }
    },

    /** 加载更早/后续一页历史（按服务端不透明游标） */
    async loadMoreEvents(): Promise<void> {
      if (!this.cursor || this.loadingMore) return;
      this.loadingMore = true;
      try {
        await this.loadEvents(false);
      } finally {
        this.loadingMore = false;
      }
    },

    /** 按 id 去重合并，保持顺序；避免补读覆盖已到达的实时帧 */
    mergeEvents(incoming: EventFrameView[]): void {
      const seen = new Set(this.events.map((e) => e.id));
      for (const f of incoming) {
        if (!seen.has(f.id)) {
          seen.add(f.id);
          this.events.push(f);
        }
      }
    },

    connectStream(): void {
      this.disconnectStream();
      if (!this.selectedTargetId || !this.selectedSessionId) return;
      this.streamStatus = 'connecting';
      const es = markRaw(new EventSource(api.streamUrl(this.selectedTargetId, this.selectedSessionId)));
      const revision = this.selectionRevision;
      let opened = false;
      const refill = async (): Promise<void> => {
        if (revision !== this.selectionRevision || this.es !== es || this.refilling) return;
        this.refilling = true;
        try {
          await this.loadEvents(false);
        } finally {
          if (revision === this.selectionRevision && this.es === es) this.refilling = false;
        }
      };
      es.onopen = () => {
        if (this.es !== es || revision !== this.selectionRevision) return;
        this.streamStatus = 'open';
        // 自动重连不保证恢复所有历史；从持久接口补读，不把环形回放当真源。
        if (opened) void refill();
        opened = true;
      };
      es.onmessage = (ev) => {
        if (this.es !== es || revision !== this.selectionRevision) return;
        try {
          const f = JSON.parse(ev.data) as EventFrameView;
          this.mergeEvents([f]);
        } catch {
          /* ignore malformed */
        }
      };
      // 服务端要求补读：慢客户端断开或上游代际变化。不断开任务，只补历史。
      es.addEventListener('refill', () => {
        void refill();
      });
      es.addEventListener('auth-expired', () => {
        if (this.es !== es) return;
        this.disconnectStream();
        this.error = '登录已失效，请重新登录';
      });
      es.onerror = () => {
        if (this.es !== es || revision !== this.selectionRevision) return;
        // 浏览器会按服务端 retry 自动重连；断开不假取消，仅如实展示状态
        this.streamStatus = 'closed';
      };
      this.es = es;
    },

    disconnectStream(): void {
      this.es?.close();
      this.es = null;
      this.streamStatus = 'idle';
      this.refilling = false;
    },
  },
});
