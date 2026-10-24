import type { ServerResponse } from 'node:http';

export interface SseOptions {
  slowClientMs?: number;
  heartbeatMs?: number;
}

type Writable = Pick<
  ServerResponse,
  'write' | 'end' | 'destroy' | 'on' | 'removeListener' | 'destroyed' | 'writableEnded'
>;

/** 仅保存一个补读原因；背压期间不另建事件队列。 */
export class SseConnection {
  private closed = false;
  private slow = false;
  private refillReason: string | null = null;
  private slowTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeat: ReturnType<typeof setInterval>;

  constructor(
    private readonly raw: Writable,
    private readonly authorized: () => boolean,
    private readonly onClose: () => void,
    private readonly options: SseOptions = {},
  ) {
    raw.on('close', this.onResponseClose);
    raw.on('error', this.onResponseError);
    raw.on('drain', this.onDrain);
    this.heartbeat = setInterval(() => {
      this.write(': ping\n\n', false);
    }, options.heartbeatMs ?? 15_000);
    this.heartbeat.unref();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  private alive(): boolean {
    if (this.closed) return false;
    if (this.raw.destroyed || this.raw.writableEnded) {
      this.close();
      return false;
    }
    if (!this.authorized()) {
      this.expire();
      return false;
    }
    return !this.closed;
  }

  write(chunk: string, event = true): void {
    if (!this.alive()) return;
    if (this.slow) {
      if (event && !this.refillReason) this.refillReason = 'slow-client';
      return;
    }
    try {
      if (!this.raw.write(chunk)) {
        this.slow = true;
        this.slowTimer = setTimeout(() => this.close(true), this.options.slowClientMs ?? 30_000);
        this.slowTimer.unref();
      }
    } catch {
      this.close(true);
    }
  }

  promptRefill(reason: string): void {
    if (!this.alive()) return;
    if (this.slow) {
      this.refillReason = reason;
      return;
    }
    this.write(`event: refill\nretry: 1000\ndata: ${JSON.stringify({ reason })}\n\n`);
  }

  private onDrain = (): void => {
    if (!this.alive()) return;
    this.slow = false;
    clearTimeout(this.slowTimer);
    this.slowTimer = undefined;
    const reason = this.refillReason;
    this.refillReason = null;
    if (reason) this.promptRefill(reason);
  };

  private onResponseClose = (): void => this.close();
  private onResponseError = (): void => this.close(true);

  /**
   * 上游失联：先尽力告知浏览器（背压时直接断开，不追加控制帧），再关闭。
   * 与 expire 的区别是语义：这不是会话失效，浏览器重连后应重新拉取而非重新登录。
   */
  upstreamLost(): void {
    if (this.closed) return;
    if (!this.slow && !this.raw.destroyed && !this.raw.writableEnded) {
      try {
        this.slow = !this.raw.write('event: upstream-lost\ndata: {}\n\n');
      } catch {
        this.close(true);
        return;
      }
    }
    this.close();
  }

  expire(): void {
    if (this.closed) return;
    if (!this.slow && !this.raw.destroyed && !this.raw.writableEnded) {
      try {
        this.slow = !this.raw.write('event: auth-expired\ndata: {}\n\n');
      } catch {
        this.close(true);
        return;
      }
    }
    this.close();
  }

  close(abort = false): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.heartbeat);
    clearTimeout(this.slowTimer);
    this.raw.removeListener('close', this.onResponseClose);
    this.raw.removeListener('error', this.onResponseError);
    this.raw.removeListener('drain', this.onDrain);
    this.onClose();
    if (this.raw.destroyed || this.raw.writableEnded) return;
    if (abort || this.slow) this.raw.destroy();
    else this.raw.end();
  }
}
