// 目标网关：每个配置的 target 维护一条 DaemonTransport 与一条 EventBroker。
// 满足“每 target 单条上游订阅、向浏览器 fan-out”的约束。游标嵌入 targetId，不可跨 target 伪造。
import type { WebConfig, TargetConfig } from '../config.js';
import { SimulatedDaemonTransport, type DaemonTransport } from './transport.js';
import { EventBroker } from '../events/broker.js';

export type RealFactory = (cfg: TargetConfig) => Promise<DaemonTransport>;
/** 合成 transport 工厂（仅验证/演示注入；缺省用 SimulatedDaemonTransport） */
export type SimFactory = (targetId: string) => DaemonTransport;

export class TargetGateway {
  private transports = new Map<string, DaemonTransport>();
  private brokers = new Map<string, EventBroker>();
  private pendingTransports = new Map<string, Promise<DaemonTransport>>();
  private pendingBrokers = new Map<string, Promise<EventBroker>>();
  private stopped = false;

  constructor(
    private readonly config: WebConfig,
    private readonly realFactory?: RealFactory,
    private readonly simFactory?: SimFactory,
  ) {}

  listTargets(): { id: string; label: string }[] {
    return this.config.targets.map((t) => ({ id: t.id, label: t.label }));
  }

  has(targetId: string): boolean {
    return this.config.targets.some((t) => t.id === targetId);
  }

  private async getTransport(targetId: string): Promise<DaemonTransport> {
    if (this.stopped) throw new Error('gateway-stopped');
    const existing = this.transports.get(targetId);
    if (existing) return existing;
    const pending = this.pendingTransports.get(targetId);
    if (pending) return pending;
    const cfg = this.config.targets.find((x) => x.id === targetId);
    if (!cfg) throw new Error('unknown-target');
    const creation = Promise.resolve().then(async () => {
      const transport = this.realFactory
        ? await this.realFactory(cfg)
        : this.simFactory
          ? this.simFactory(targetId)
          : new SimulatedDaemonTransport(targetId);
      if (this.stopped) {
        transport.close();
        throw new Error('gateway-stopped');
      }
      this.transports.set(targetId, transport);
      return transport;
    });
    this.pendingTransports.set(targetId, creation);
    try {
      return await creation;
    } finally {
      this.pendingTransports.delete(targetId);
    }
  }

  async getBroker(targetId: string): Promise<EventBroker> {
    if (this.stopped) throw new Error('gateway-stopped');
    const existing = this.brokers.get(targetId);
    if (existing) return existing;
    const pending = this.pendingBrokers.get(targetId);
    if (pending) return pending;
    const creation = Promise.resolve().then(async () => {
      const transport = await this.getTransport(targetId);
      if (this.stopped) throw new Error('gateway-stopped');
      const broker = new EventBroker(transport);
      try {
        await broker.start();
        if (this.stopped) throw new Error('gateway-stopped');
        this.brokers.set(targetId, broker);
        return broker;
      } catch (error) {
        broker.stop();
        throw error;
      }
    });
    this.pendingBrokers.set(targetId, creation);
    try {
      return await creation;
    } finally {
      this.pendingBrokers.delete(targetId);
    }
  }

  async initialize(targetId: string) {
    const transport = await this.getTransport(targetId);
    return transport.initialize();
  }

  async catalogSessions(targetId: string): Promise<Record<string, unknown>[]> {
    const transport = await this.getTransport(targetId);
    // 单 workspace 模式：以 target 初始化返回的 workspace 作为绑定上下文
    const init = await transport.initialize();
    const ws = init.workspaceId ?? '';
    const list = await transport.catalogSessions(ws);
    return list;
  }

  async getSessionDetail(targetId: string, sessionId: string): Promise<Record<string, unknown>> {
    const transport = await this.getTransport(targetId);
    return transport.getSessionDetail(sessionId);
  }

  async stopAll(): Promise<void> {
    this.stopped = true;
    for (const b of this.brokers.values()) b.stop();
    for (const t of this.transports.values()) t.close();
    this.brokers.clear();
    this.transports.clear();
  }
}
