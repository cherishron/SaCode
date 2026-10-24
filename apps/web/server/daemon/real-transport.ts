// 真实 daemon 的受控只读边界；默认构建不导入桌面源码。
import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DaemonInit, DaemonTransport, RawEventFrame, RawEventsPage } from './transport.js';
import type { TargetConfig } from '../config.js';

type ReadMethod = 'initialize' | 'session/catalog' | 'session/events';
type Subscription = (() => void) | { id?: unknown; abort: () => void };
export interface RealTransportHandle {
  sendRequest(method: string, params: unknown): Promise<unknown>;
  subscribeNotifications(onFrame: (frame: unknown) => void): Promise<Subscription>;
  close(): void;
}

const READ_METHODS = new Set<ReadMethod>(['initialize', 'session/catalog', 'session/events']);
const DECIMAL = /^(0|[1-9][0-9]{0,17})$/;
/** 轮询兜底的默认间隔与单次会话上限：控制只读 RPC 开销，不是实时推送的替代。 */
const DEFAULT_POLL_INTERVAL_MS = 30_000;
const POLL_SESSION_CAP = 20;

/** 可注入时钟，便于测试用假计时验证失联检测，不真实等待数十秒。 */
export interface RealTransportClock {
  setIntervalImpl: (fn: () => void, ms: number) => unknown;
  clearIntervalImpl: (handle: unknown) => void;
  pollIntervalMs: number;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('real-response-invalid');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.length) throw new Error('real-response-invalid');
  return value;
}
function binding(cfg: TargetConfig): { workspaceId: string; instanceId: string } {
  if (
    typeof cfg.workspaceId !== 'string' ||
    !cfg.workspaceId ||
    typeof cfg.instanceId !== 'string' ||
    !cfg.instanceId
  )
    throw new Error('real-resource-binding-required');
  return { workspaceId: cfg.workspaceId, instanceId: cfg.instanceId };
}

/** 凭据引用只能是环境变量名；TLS 链与可选 pin 仍由 RemoteTransport 校验。 */
export function realTransportOptions(cfg: TargetConfig, env: NodeJS.ProcessEnv = process.env) {
  binding(cfg);
  let url: URL;
  try {
    url = new URL(cfg.baseUrl);
  } catch {
    throw new Error('real-base-url-invalid');
  }
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /[?#]/.test(cfg.baseUrl)
  ) {
    throw new Error('real-base-url-unsafe');
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(cfg.credentialRef))
    throw new Error('real-credential-reference-invalid');
  const tokenProvider = async (): Promise<string> => {
    const token = env[cfg.credentialRef];
    if (!token || /[\r\n]/.test(token)) throw new Error('real-credential-unavailable');
    return token;
  };
  // 构造时即检查缺失；错误不包含引用名或凭据值。
  if (!env[cfg.credentialRef] || /[\r\n]/.test(env[cfg.credentialRef]!))
    throw new Error('real-credential-unavailable');
  return {
    baseUrl: url.href.replace(/\/$/, ''),
    tokenProvider,
    caCertificates: cfg.caCertificates,
    instanceFingerprint: cfg.instanceFingerprint,
  };
}

export async function createRealTransport(cfg: TargetConfig): Promise<DaemonTransport> {
  if (process.env['SACODE_WEB_DAEMON_REAL'] !== '1') throw new Error('real-transport-disabled');
  const options = realTransportOptions(cfg);
  const modPath = process.env['SACODE_WEB_REAL_TRANSPORT_PATH'];
  if (!modPath || !isAbsolute(modPath) || /^(?:\\\\|\/\/)/.test(modPath) || !/\.(mjs|js)$/.test(modPath)) {
    throw new Error('real-transport-path-required');
  }
  if (!statSync(modPath).isFile()) throw new Error('real-transport-path-invalid');
  const mod = (await import(pathToFileURL(modPath).href)) as {
    RemoteTransport: new (opts: typeof options) => RealTransportHandle;
  };
  if (typeof mod.RemoteTransport !== 'function') throw new Error('real-transport-export-invalid');
  return new RemoteTransportAdapter(cfg, new mod.RemoteTransport(options));
}

export class RealReplayGapError extends Error {
  constructor() {
    super('real-events-gap');
  }
}

type Position = { sessionId: string; generation: string; seq: string };
function eventId(position: Position): string {
  return `real:${Buffer.from(JSON.stringify(position)).toString('base64url')}`;
}
function positionOf(id: string, sessionId: string): Position {
  if (!id.startsWith('real:') || id.length > 2048) throw new Error('real-events-cursor-invalid');
  let p: Record<string, unknown>;
  try {
    p = record(JSON.parse(Buffer.from(id.slice(5), 'base64url').toString('utf8')));
  } catch {
    throw new Error('real-events-cursor-invalid');
  }
  if (
    p.sessionId !== sessionId ||
    typeof p.generation !== 'string' ||
    !p.generation ||
    typeof p.seq !== 'string' ||
    !DECIMAL.test(p.seq)
  )
    throw new Error('real-events-cursor-invalid');
  return p as Position;
}

export class RemoteTransportAdapter implements DaemonTransport {
  readonly targetId: string;
  private readonly workspaceId: string;
  private readonly instanceId: string;
  private initialized: Promise<DaemonInit> | undefined;
  private epochs = new Map<string, Map<string, number>>();
  private subscriptionClosers = new Set<() => void>();
  private failure: Error | undefined;
  private closed = false;
  private readonly setIntervalImpl: (fn: () => void, ms: number) => unknown;
  private readonly clearIntervalImpl: (handle: unknown) => void;
  private readonly pollIntervalMs: number;

  constructor(
    cfg: TargetConfig,
    private readonly handle: RealTransportHandle,
    clock: Partial<RealTransportClock> = {},
  ) {
    this.targetId = cfg.id;
    const bound = binding(cfg);
    this.workspaceId = bound.workspaceId;
    this.instanceId = bound.instanceId;
    this.setIntervalImpl = clock.setIntervalImpl ?? ((fn, ms) => setInterval(fn, ms));
    this.clearIntervalImpl =
      clock.clearIntervalImpl ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>));
    this.pollIntervalMs = clock.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  private async request(
    method: ReadMethod,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (this.closed) throw new Error('real-transport-closed');
    if (this.failure) throw this.failure;
    if (!READ_METHODS.has(method)) throw new Error('real-method-denied');
    return record(await this.handle.sendRequest(method, { ...params, workspaceId: this.workspaceId }));
  }

  initialize(): Promise<DaemonInit> {
    if (this.closed) return Promise.reject(new Error('real-transport-closed'));
    if (this.failure) return Promise.reject(this.failure);
    if (!this.initialized) {
      this.initialized = this.request('initialize', {}).then((r) => {
        if (r.instanceId !== this.instanceId) throw new Error('real-instance-mismatch');
        if (
          !Array.isArray(r.capabilities) ||
          !r.capabilities.every((c) => typeof c === 'string') ||
          ![...READ_METHODS].every((m) => (r.capabilities as string[]).includes(m))
        ) {
          throw new Error('real-capabilities-invalid');
        }
        return {
          capabilities: [...READ_METHODS],
          workspaceId: this.workspaceId,
          instanceId: this.instanceId,
        };
      });
    }
    return this.initialized;
  }

  async catalogSessions(workspaceId: string): Promise<Record<string, unknown>[]> {
    if (workspaceId !== this.workspaceId) throw new Error('real-workspace-mismatch');
    await this.initialize();
    const r = await this.request('session/catalog', {});
    if (typeof r.root !== 'string' || !Array.isArray(r.entries)) throw new Error('real-catalog-invalid');
    const ids = new Set<string>();
    return r.entries.map((entry) => {
      const e = record(entry);
      const id = text(e.id);
      if (
        ids.has(id) ||
        typeof e.title !== 'string' ||
        typeof e.status !== 'string' ||
        !Number.isSafeInteger(e.durable) ||
        Number(e.durable) < 0
      )
        throw new Error('real-catalog-invalid');
      ids.add(id);
      return {
        id,
        title: e.title,
        status: e.status,
        workspaceId: this.workspaceId,
        createdAt: '',
        updatedAt: '',
      };
    });
  }

  async getSessionDetail(sessionId: string): Promise<Record<string, unknown>> {
    const sessions = await this.catalogSessions(this.workspaceId);
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) throw new Error('unknown-session');
    return session;
  }

  private epoch(sessionId: string, generation: string): number {
    let known = this.epochs.get(sessionId);
    if (!known) {
      known = new Map();
      this.epochs.set(sessionId, known);
    }
    if (!known.has(generation)) known.set(generation, known.size + 1);
    return known.get(generation)!;
  }

  async getSessionEvents(
    sessionId: string,
    afterEventId: string | null,
    limit: number,
  ): Promise<RawEventsPage> {
    if (!sessionId || !Number.isInteger(limit) || limit < 1) throw new Error('real-events-request-invalid');
    const position = afterEventId ? positionOf(afterEventId, sessionId) : null;
    await this.initialize();
    const r = await this.request('session/events', {
      sessionId,
      limit: String(Math.min(200, limit)),
      ...(position ? { afterSeq: position.seq, generation: position.generation } : {}),
    });
    const generation = text(r.generation);
    if (typeof r.gap === 'string' && r.gap.length > 0) throw new RealReplayGapError();
    if (
      r.gap !== null ||
      (position && position.generation !== generation) ||
      typeof r.nextSeq !== 'string' ||
      (r.nextSeq !== '' && !DECIMAL.test(r.nextSeq)) ||
      typeof r.hasMore !== 'boolean' ||
      !Array.isArray(r.events)
    ) {
      throw new Error('real-events-response-invalid');
    }
    const epoch = this.epoch(sessionId, generation);
    let previous = position?.seq;
    const frames = r.events.map((item): RawEventFrame => {
      const e = record(item);
      const seq = text(e.seq);
      if (
        !DECIMAL.test(seq) ||
        (previous !== undefined && BigInt(seq) <= BigInt(previous)) ||
        typeof e.eventType !== 'string' ||
        !e.eventType ||
        typeof e.data !== 'string'
      ) {
        throw new Error('real-event-invalid');
      }
      previous = seq;
      // 上游持久日志没有时间戳；不伪造客户端时间，也不展开结构化私密数据。
      return {
        id: eventId({ sessionId, generation, seq }),
        sessionId,
        generation: epoch,
        kind: e.eventType,
        at: '',
        summary: e.data,
      };
    });
    if (
      frames.length > Math.min(200, limit) ||
      r.nextSeq !== (previous ?? '') ||
      (r.hasMore && !frames.length)
    ) {
      throw new Error('real-events-response-invalid');
    }
    return {
      frames,
      generation: epoch,
      nextCursor: r.nextSeq === '' ? null : eventId({ sessionId, generation, seq: r.nextSeq }),
    };
  }

  async subscribe(
    onFrame: (frame: RawEventFrame) => void,
    opts?: { onLost?: () => void },
  ): Promise<{ close: () => void }> {
    await this.initialize();
    let stopped = false;
    let abort: (() => void) | undefined;
    let pollTimer: unknown;
    const positions = new Map<string, string | null>();
    let pending: Promise<void> | undefined;
    const dirty = new Set<string>();
    const close = () => {
      if (stopped) return;
      stopped = true;
      dirty.clear();
      abort?.();
      if (pollTimer !== undefined) {
        this.clearIntervalImpl(pollTimer);
        pollTimer = undefined;
      }
      this.subscriptionClosers.delete(close);
    };
    /** 失联/失败：标记后后续读取显式失败（不回落合成空成功），并尽力通知上层。 */
    const fail = (error: Error): void => {
      this.failure = error;
      close();
      try {
        opts?.onLost?.();
      } catch {
        /* 上层回调异常不阻断清理 */
      }
    };
    const scheduleRefill = (): void => {
      if (stopped || this.closed || pending) return;
      // 通知没有日志代次，必须回持久真源核验，不将 daemon 全局 seq 当会话游标。
      pending = Promise.resolve()
        .then(async () => {
          while (!stopped && dirty.size) {
            const sid = dirty.values().next().value!;
            dirty.delete(sid);
            let after = positions.get(sid) ?? null;
            while (!stopped) {
              let page: RawEventsPage;
              try {
                page = await this.getSessionEvents(sid, after, 200);
              } catch (error) {
                if (!(error instanceof RealReplayGapError) || after === null) throw error;
                after = null;
                continue;
              }
              if (stopped) return;
              for (const frame of page.frames) onFrame(frame);
              positions.set(sid, page.nextCursor);
              if (page.frames.length < 200) break;
              after = page.nextCursor;
            }
          }
        })
        .catch(() => {
          fail(new Error('real-subscription-refill-failed'));
        })
        .finally(() => {
          pending = undefined;
        });
    };
    const sub = await this.handle.subscribeNotifications((value) => {
      if (stopped || this.closed) return;
      let sessionId: string;
      try {
        const envelope = record(value);
        const e = envelope.method === 'daemon/event' ? record(envelope.params) : envelope;
        // 控制通知与缺失明确归属的旧直播通知不是会话事件。
        if (envelope.method !== undefined && envelope.method !== 'daemon/event') return;
        sessionId = text(e.sessionId);
        if (typeof e.seq !== 'string' && !Number.isSafeInteger(e.seq)) return;
        if (
          !DECIMAL.test(String(e.seq)) ||
          typeof (e.eventType ?? e.event) !== 'string' ||
          typeof e.data !== 'string'
        )
          return;
      } catch {
        return;
      }
      // 合并同会话提示，避免上游突发通知形成无界 Promise 队列。
      dirty.add(sessionId);
      if (dirty.size > 500) {
        fail(new Error('real-subscription-overflow'));
        return;
      }
      scheduleRefill();
    });
    if (typeof sub === 'function') abort = sub;
    else if (sub && typeof sub.abort === 'function') abort = () => sub.abort();
    else {
      close();
      this.handle.close();
      throw new Error('real-subscription-invalid');
    }
    if (stopped || this.closed) {
      abort();
      stopped = true;
    } else {
      this.subscriptionClosers.add(close);
      // 轮询兜底：上游 pump 静默结束时无法观测，改为定期回持久真源取新事件。
      // 它同时充当活性探测——取不到即判定上游不可达，而不是静默假装已连接。
      if (this.pollIntervalMs > 0) {
        const tick = (): void => {
          if (stopped || this.closed) return;
          void (async () => {
            try {
              const sessions = await this.catalogSessions(this.workspaceId);
              for (const item of sessions.slice(0, POLL_SESSION_CAP)) dirty.add(text(record(item).id));
              if (dirty.size > 500) {
                fail(new Error('real-subscription-overflow'));
                return;
              }
              scheduleRefill();
            } catch {
              fail(new Error('real-upstream-unreachable'));
            }
          })();
        };
        pollTimer = this.setIntervalImpl(tick, this.pollIntervalMs);
      }
    }
    return { close };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const close of [...this.subscriptionClosers]) close();
    this.handle.close();
  }
}
